#!/usr/bin/env node
// מחקר שיטתי של 12 משפחות אסטרטגיות חתך (בקשת מאיר, 8/11/2026). מחקר בלבד — אין כסף, אין פקודות.
//
// נתונים (מקור — ציבורי, ללא מפתחות):
//   - מחירים יומיים 2007 → היום: Yahoo Finance chart API, מתואמים לפיצולים ולדיבידנדים (adjclose; O/H/L מוכפלים באותו מקדם).
//   - S&P 500: הרכב היסטורי משוחזר מטבלת השינויים בוויקיפדיה (Selected changes), אחורה מההרכב הנוכחי. מניות שנמחקו נכללות רק אם
//     ל-Yahoo עדיין יש להן מחירים — הכיסוי מודפס בדוח לכל שנה (מה שחסר = הטיית שורדים שנשארה).
//   - Nasdaq 100: ההרכב הנוכחי בלבד (אין היסטוריה אמינה) → הטיית שורדים מסומנת.
//   - Russell 2000: אחזקות IWM הנוכחיות (iShares); אם לא זמין — S&P 600 כקירוב. הרכב נוכחי בלבד → הטיית שורדים מסומנת.
//   - יקום רחב: איחוד כל המניות שנטענו (עם סינון נזילות).
//   - סקטורים: 11 קרנות SPDR (XLB…XLC; XLRE מ-2015, XLC מ-2018).
//   - דוחות כספיים (משפחה 7): אין היסטוריית תאריכי דוחות והפתעות חינמית ל-10 שנים — **פרוקסי**: גאפ חיובי חד + מחזור חריג (רוב
//     המקרים כאלה הם דוחות). מסומן כפרוקסי.
// מניעת מידע עתידי: האות נקבע בסגירת יום k ממידע עד k בלבד; קנייה בפתיחת k+1 (במשפחת הגאפים: בפתיחת k עצמו, אחרי שרואים את הגאפ,
//   עם תוספת החלקה). יציאה בסגירת היום ה-H של ההחזקה. מדדי עזר (ממוצע 20 יום וכו') מחושבים רק מימים קודמים.
// ביצוע: 50,000$; החזקה של H ימים = H תיקי-משנה מדורגים (חפיפה מטופלת, אין מינוף); בכל כניסה הון תיק-המשנה ÷ N לכל מניה (פחות מ-N
//   מועמדות → היתרה במזומן); השקעה מחדש מלאה. מניות חלקיות (IBKR מאפשר), אבל עמלת מינימום 1$ לפקודה — לכן פוזיציות קטנות יקרות.
// עלויות: עמלת IBKR Pro Fixed (0.005$ למניה, מינ׳ 1$, מקס׳ 1%) + עמלות רגולטור במכירה + חצי מרווח לפי מחזור המניה (1.5–30bp לצד;
//   גאפ באותו יום +5bp) + שורט: השאלה 0.02% ליום. מוצג גם "לפני עלויות" ורגישות של מרווח ×2.
// בחירה: פיתוח 2008–2018, מבחן 2019 → היום (לא שימש לבחירה), ו-Walk-Forward שנתי (בחירה לפי שארפ של 3 השנים הקודמות).
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const START_USD = 50000, P1 = Math.floor(Date.UTC(2007, 0, 1) / 1000), DEV_END = '2018-12-31', SIG_START = '2008-01-02';
const UA = { 'User-Agent': 'Mozilla/5.0 (research backtest)', Accept: '*/*' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (...a) => console.error(...a);
async function get(url, tries = 4){ for (let k = 0; k < tries; k++){ try { const r = await fetch(url, { headers: UA }); if (r.status === 429){ await sleep(3000 * (k + 1)); continue; } if (!r.ok) return null; return await r.text(); } catch { await sleep(1000 * (k + 1)); } } return null; }

// ---------- יקומים ----------
const TICK = /^[A-Z]{1,5}([.\-][A-Z]{1,2})?$/;
const yh = (t) => t.replace('.', '-');
const strip = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#160;|&nbsp;/g, ' ').trim();
const cells = (row) => [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => strip(m[1]));
function tableById(html, id){ const i = html.indexOf(`id="${id}"`); if (i < 0) return null; return html.slice(i, html.indexOf('</table>', i)); }
const allTables = (html) => [...html.matchAll(/<table[^>]*>[\s\S]*?<\/table>/g)].map((m) => m[0]);
const headText = (t) => strip((t.match(/<tr[\s\S]*?<\/tr>/g) || []).slice(0, 2).join(' ')).replace(/\s+/g, ' ');
const tickerRows = (t) => t.split('<tr').slice(1).filter((row) => cells(row).some((x) => TICK.test(x))).length;
// אבחון: אילו טבלאות יש בעמוד (מזהה, כותרת, כמה שורות עם טיקר) — מודפס כשהפענוח נכשל
export const tableInfo = (html) => allTables(html).map((t) => `${(t.match(/id="([^"]+)"/) || [])[1] || '-'}: "${headText(t).slice(0, 80)}" (${tickerRows(t)} rows)`);
// טבלת הרכב: לכל שורה — התא הראשון שנראה כמו טיקר
export function parseConstituents(html){
  // קודם טבלה עם id="constituents"; אחרת — הטבלה שכותרתה כוללת Ticker/Symbol ויש בה הכי הרבה שורות עם טיקר
  let t = tableById(html, 'constituents');
  if (!t){ const c = allTables(html).filter((x) => /Ticker|Symbol/i.test(headText(x)) && !/Added|Removed/i.test(headText(x))).sort((a, b) => tickerRows(b) - tickerRows(a))[0]; if (c && tickerRows(c) >= 50) t = c; }
  if (!t){ const out = new Set(); for (const m of html.matchAll(/<td[^>]*>\s*<a[^>]*href="https?:\/\/(?:www\.)?(?:nyse|nasdaq)\.com[^"]*"[^>]*>([A-Z][A-Z0-9.\-]{0,6})<\/a>/g)) out.add(yh(m[1])); return [...out]; }
  const out = new Set();
  for (const row of t.split('<tr').slice(1)){ const c = cells(row).find((x) => TICK.test(x)); if (c) out.add(yh(c)); }
  return [...out];
}
// טבלת שינויי S&P 500: תאריך | נוסף (טיקר, שם) | הוצא (טיקר, שם) | סיבה. תאריך עם rowspan — שורות המשך בלי תא תאריך
export function parseChanges(html){
  // טבלת השינויים: id="changes", או הטבלה שכותרתה כוללת Added ו-Removed
  const t = tableById(html, 'changes') || allTables(html).find((x) => /Added/i.test(headText(x)) && /Removed/i.test(headText(x))); if (!t) return [];
  const out = []; let cur = null;
  for (const row of t.split('<tr').slice(1)){
    if (/<th/.test(row) && !/<td/.test(row)) continue;
    let c = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
    if (!c.length) continue;
    const ds = c[0].replace(/\[[^\]]*\]/g, '').trim(), d = Date.parse(ds + ' UTC');
    if (Number.isFinite(d) && /\d{4}/.test(ds)){ cur = new Date(d).toISOString().slice(0, 10); c = c.slice(1); }
    if (!cur || c.length < 4) continue;
    const add = TICK.test(c[0]) ? yh(c[0]) : null, rem = TICK.test(c[2]) ? yh(c[2]) : null;
    if (add || rem) out.push({ date: cur, add, rem });
  }
  return out;
}
// הרכב היסטורי: מהרכב נוכחי אחורה בזמן. מחזיר לכל טיקר רשימת מקטעים [מ-, עד) (null = פתוח)
export function membership(current, changes){
  const iv = {}, active = new Map(current.map((s) => [s, null])); // טיקר → סוף המקטע הפעיל (null = עד היום)
  for (const ch of [...changes].sort((a, b) => (a.date < b.date ? 1 : -1))){
    if (ch.add && active.has(ch.add)){ (iv[ch.add] ||= []).push([ch.date, active.get(ch.add)]); active.delete(ch.add); }
    if (ch.rem && !active.has(ch.rem)) active.set(ch.rem, ch.date);
  }
  for (const [s, end] of active) (iv[s] ||= []).push([null, end]);
  return iv;
}
// הרכב היסטורי מתמונות מצב (תאריך → רשימת חברים), למשל github.com/fja05680/sp500. מחזיר אותו מבנה כמו membership()
export function membershipFromSnapshots(snaps){
  const iv = {}, open = new Map();
  for (const { date, set } of [...snaps].sort((a, b) => (a.date < b.date ? -1 : 1))){
    for (const s of set) if (!open.has(s)) open.set(s, date);
    for (const [s, start] of [...open]) if (!set.has(s)){ (iv[s] ||= []).push([start, date]); open.delete(s); }
  }
  for (const [s, start] of open) (iv[s] ||= []).push([start, null]);
  return iv;
}
// CSV של fja05680/sp500: date,tickers  (tickers = "AAA,BBB,...")
export function parseSnapshotsCsv(csv){
  const out = [];
  for (const line of csv.split('\n').slice(1)){ const m = line.match(/^(\d{4}-\d{2}-\d{2}),"?([^"]*)"?/); if (!m) continue; out.push({ date: m[1], set: new Set(m[2].split(',').map((x) => x.trim()).filter((x) => TICK.test(x)).map(yh)) }); }
  return out;
}
const inIv = (ivs, d) => ivs?.some(([a, b]) => (a === null || d >= a) && (b === null || d < b));

async function universes(){
  const page = async (p) => (await get(`https://en.wikipedia.org/wiki/${p}`)) || '';
  const h500 = await page('List_of_S%26P_500_companies'), h400 = await page('List_of_S%26P_400_companies'), h600 = await page('List_of_S%26P_600_companies');
  const sp500 = parseConstituents(h500), sp400 = parseConstituents(h400), sp600 = parseConstituents(h600);
  let ndx = []; for (const p of ['List_of_Nasdaq-100_companies', 'List_of_NASDAQ-100_companies', 'Nasdaq-100']){ const h = await page(p); ndx = parseConstituents(h); log(`ndx from ${p}: ${ndx.length}`); if (ndx.length >= 80) break; if (h) log('  tables: ' + tableInfo(h).slice(0, 8).join(' | ')); }
  // הרכב S&P 500 היסטורי: טבלת השינויים בוויקיפדיה (אם קיימת), אחרת תמונות המצב של github.com/fja05680/sp500
  let changes = parseChanges(h500), iv500 = null, memSrc = 'ויקיפדיה (טבלת השינויים)';
  if (changes.length >= 100) iv500 = membership(sp500, changes);
  else {
    const list = await get('https://api.github.com/repos/fja05680/sp500/contents');
    let files = []; try { files = JSON.parse(list).filter((f) => /Historical Components.*\.csv$/i.test(f.name)); } catch {}
    const dt = (n) => { const m = n.match(/(\d{2})-(\d{2})-(\d{4})/); return m ? `${m[3]}-${m[1]}-${m[2]}` : ''; };
    files.sort((a, b) => (dt(a.name) < dt(b.name) ? 1 : -1));
    const f = files[0], csv = f ? await get(f.download_url) : null, snaps = csv ? parseSnapshotsCsv(csv) : [];
    log(`fja05680/sp500: ${f?.name || 'not found'} — ${snaps.length} snapshots${snaps.length ? `, ${snaps[0].date} → ${snaps.at(-1).date}` : ''}`);
    if (snaps.length >= 100){ snaps.push({ date: new Date().toISOString().slice(0, 10), set: new Set(sp500) }); iv500 = membershipFromSnapshots(snaps); memSrc = `github.com/fja05680/sp500 (${f.name}) + ההרכב הנוכחי מוויקיפדיה`; changes = []; }
  }
  log(`wiki: sp500 ${sp500.length}, sp400 ${sp400.length}, sp600 ${sp600.length}, ndx ${ndx.length}; S&P 500 history: ${iv500 ? Object.keys(iv500).length + ' tickers' : 'none'} (${memSrc})`);
  if (sp500.length < 400 || ndx.length < 80 || !iv500 || Object.keys(iv500).length < 600) throw new Error('רשימות מדדים / הרכב היסטורי חלקיים — לא מריצים על נתונים חסרים');
  let r2k = [], r2kSrc = 'iShares IWM (אחזקות נוכחיות)';
  const csv = await get('https://www.ishares.com/us/products/239710/ishares-russell-2000-etf/1467271812596.ajax?fileType=csv&fileName=IWM_holdings&dataType=fund');
  if (csv){ for (const line of csv.split('\n')){ const f = line.split('","').map((x) => x.replace(/^"|"$/g, '')); if (f.length > 4 && TICK.test(f[0]) && /Equity/i.test(line)) r2k.push(yh(f[0])); } }
  if (r2k.length < 1500){ r2k = sp600; r2kSrc = 'S&P 600 (קירוב — אחזקות IWM לא זמינות)'; }
  log(`russell2000: ${r2k.length} (${r2kSrc})`);
  return { sp500, sp400, sp600, ndx, r2k, r2kSrc, changes, iv500, memSrc };
}

// ---------- מחירים ----------
async function daily(sym){
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?period1=${P1}&period2=${Math.floor(Date.now() / 1000)}&interval=1d&includeAdjustedClose=true`);
  try {
    const r = JSON.parse(j).chart.result[0], q = r.indicators.quote[0], adj = r.indicators.adjclose?.[0]?.adjclose;
    const t = [], o = [], h = [], l = [], c = [], cr = [], v = [];
    (r.timestamp || []).forEach((ts, i) => {
      const cl = q.close[i]; if (!(cl > 0 && q.open[i] > 0 && q.high[i] > 0 && q.low[i] > 0 && adj?.[i] > 0)) return;
      const f = adj[i] / cl; // מקדם התאמה (פיצולים + דיבידנדים) — זהה ל-O/H/L
      t.push(Math.floor(ts / 86400)); o.push(q.open[i] * f); h.push(q.high[i] * f); l.push(q.low[i] * f); c.push(adj[i]); cr.push(cl); v.push(q.volume[i] || 0);
    });
    if (t.length < 60) return null;
    const F = (a) => Float32Array.from(a); // דחוס: ימים כמספרים, מחירים ב-32 ביט
    return { t: Int32Array.from(t), o: F(o), h: F(h), l: F(l), c: F(c), cr: F(cr), v: F(v) };
  } catch { return null; }
}

// ---------- הכנה: יישור ללוח המסחר ומדדים ----------
const NaNArr = (L) => new Float32Array(L).fill(NaN);
export const dayIso = (t) => new Date(t * 86400e3).toISOString().slice(0, 10);
export function build(raw, calT){
  const L = calT.length, dk = new Map(Array.from(calT, (d, k) => [d, k])), S = {};
  for (const [s, b] of Object.entries(raw)){
    const X = { O: NaNArr(L), H: NaNArr(L), Lo: NaNArr(L), C: NaNArr(L), CR: NaNArr(L), DV: NaNArr(L) };
    Array.from(b.t).forEach((d, i) => { const k = dk.get(d); if (k === undefined) return; X.O[k] = b.o[i]; X.H[k] = b.h[i]; X.Lo[k] = b.l[i]; X.C[k] = b.c[i]; X.CR[k] = b.cr[i]; X.DV[k] = b.cr[i] * b.v[i]; });
    S[s] = X;
  }
  return S;
}
// מדדי עזר לכל מניה — כל ערך ביום k משתמש רק בנתונים עד k (וממוצעי מחזור — עד k−1)
export function indicators(X, spyR){
  const L = X.C.length, { C, H, DV } = X;
  const adv = NaNArr(L), vr = NaNArr(L), rsi14 = NaNArr(L), rsi3 = NaNArr(L), ma200 = NaNArr(L), vol60 = NaNArr(L), rsd = NaNArr(L), mh = { 20: NaNArr(L), 55: NaNArr(L), 252: NaNArr(L) };
  // ממוצע מחזור דולרי 20 יום (k−20..k−1)
  for (let k = 20; k < L; k++){ let s = 0, n = 0; for (let j = k - 20; j < k; j++) if (DV[j] >= 0){ s += DV[j]; n += 1; } if (n >= 15){ adv[k] = s / n; if (DV[k] >= 0 && adv[k] > 0) vr[k] = DV[k] / adv[k]; } }
  // RSI (Wilder); מתאפס אחרי חור בנתונים
  for (const [n, out] of [[14, rsi14], [3, rsi3]]){
    let ag = 0, al = 0, cnt = 0;
    for (let k = 1; k < L; k++){
      if (!(C[k] > 0 && C[k - 1] > 0)){ cnt = 0; ag = 0; al = 0; continue; }
      const ch = C[k] - C[k - 1], g = ch > 0 ? ch : 0, l = ch < 0 ? -ch : 0;
      if (cnt < n){ ag += g / n; al += l / n; cnt += 1; } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; }
      if (cnt >= n) out[k] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
  }
  // ממוצע 200, תנודתיות 60 יום, חוזק יחסי בימים שהמדד ירד (20 יום)
  let s200 = 0, n200 = 0;
  for (let k = 0; k < L; k++){
    if (C[k] > 0){ s200 += C[k]; n200 += 1; } if (k >= 200 && C[k - 200] > 0){ s200 -= C[k - 200]; n200 -= 1; } if (k >= 199 && n200 >= 190) ma200[k] = s200 / n200;
  }
  for (let k = 61; k < L; k++){
    let s = 0, s2 = 0, n = 0, rs = 0, nd = 0;
    for (let j = k - 59; j <= k; j++){ if (!(C[j] > 0 && C[j - 1] > 0)) continue; const r = Math.log(C[j] / C[j - 1]); s += r; s2 += r * r; n += 1; if (j > k - 20 && spyR[j] < 0){ rs += (C[j] / C[j - 1] - 1) - spyR[j]; nd += 1; } }
    if (n >= 50) vol60[k] = Math.sqrt(Math.max(s2 / n - (s / n) ** 2, 0));
    if (nd >= 3) rsd[k] = rs;
  }
  // שיא של n הימים הקודמים (בלי היום)
  for (const n of [20, 55, 252]){ const out = mh[n]; for (let k = n; k < L; k++){ let m = -Infinity, ok = 0; for (let j = k - n; j < k; j++) if (H[j] > 0){ if (H[j] > m) m = H[j]; ok += 1; } if (ok >= n * 0.9) out[k] = m; } }
  return { adv, vr, rsi14, rsi3, ma200, vol60, rsd, mh };
}

// ---------- אסטרטגיות ----------
const ret = (C, k, n) => (C[k] > 0 && C[k - n] > 0 ? C[k] / C[k - n] - 1 : NaN);
const FAMS = {
  F01: 'קניית היורדות (1–10 ימים)', F02: 'קניית העולות / מומנטום (10–252 ימים)', F03: 'מניות חזקות אחרי תיקון חד', F04: 'RSI נמוך',
  F05: 'פריצת שיא (20/55/252)', F06: 'עלייה חריגה + מחזור חריג', F07: 'אחרי דוחות חיוביים (פרוקסי: גאפ + מחזור)', F08: 'חוזק יחסי כשהמדד יורד',
  F09: 'רוטציית סקטורים (מומנטום)', F10: 'גאפ למעלה / גאפ למטה', F11: 'שורט על עליות קיצוניות', F12: 'תנודתיות נמוכה / מומנטום מותאם סיכון', F00: 'בחירה אקראית (קו בסיס)',
};
// score(X, I, k, ctx) — גבוה = עדיף; NaN = לא מועמדת. off = 1 (קנייה בפתיחה למחרת) או 0 (בפתיחת אותו יום — גאפים)
export function variants(){
  const V = [];
  const add = (fam, id, he, score, o = {}) => V.push({ fam, id, he, score, side: o.side || 'L', off: o.off ?? 1, extra: o.extra || 0 });
  for (const n of [1, 2, 3, 5, 10]) add('F01', `LOS${n}`, `ירדו הכי הרבה ב-${n} ימים`, (X, I, k) => { const r = ret(X.C, k, n); return r < 0 ? -r : NaN; });
  for (const n of [10, 20, 60, 120, 252]) add('F02', `MOM${n}`, `עלו הכי הרבה ב-${n} ימים`, (X, I, k) => { const r = ret(X.C, k, n); return r > 0 ? r : NaN; });
  add('F02', 'MOM12-1', 'מומנטום 12 חודשים בלי החודש האחרון', (X, I, k) => { const r = X.C[k - 21] > 0 && X.C[k - 252] > 0 ? X.C[k - 21] / X.C[k - 252] - 1 : NaN; return r > 0 ? r : NaN; });
  for (const p of [1, 2, 3, 5]) add('F03', `PB${p}`, `חזקה (מעל ממוצע 200, +20% בשנה) שירדה 3%+ ב-${p} ימים`, (X, I, k) => {
    if (!(X.C[k] > I.ma200[k])) return NaN; const y = ret(X.C, k, 252); if (!(y >= 0.2)) return NaN; const r = ret(X.C, k, p); return r <= -0.03 ? -r : NaN; });
  for (const [nm, key] of [['RSI14', 'rsi14'], ['RSI3', 'rsi3']]) for (const t of [20, 25, 30]) add('F04', `${nm}<${t}`, `${nm} מתחת ל-${t}`, (X, I, k) => (I[key][k] < t ? t - I[key][k] : NaN));
  for (const n of [20, 55, 252]) add('F05', `BRK${n}`, `פריצת שיא ${n} יום`, (X, I, k) => (X.C[k] > I.mh[n][k] ? ret(X.C, k, 20) : NaN));
  add('F06', 'VOLX4-2', 'עלייה 4%+ עם מחזור פי 2+', (X, I, k) => (ret(X.C, k, 1) >= 0.04 && I.vr[k] >= 2 ? I.vr[k] : NaN));
  add('F06', 'VOLX7-3', 'עלייה 7%+ עם מחזור פי 3+', (X, I, k) => (ret(X.C, k, 1) >= 0.07 && I.vr[k] >= 3 ? I.vr[k] : NaN));
  const gap = (X, k) => (X.O[k] > 0 && X.C[k - 1] > 0 ? X.O[k] / X.C[k - 1] - 1 : NaN);
  add('F07', 'EARN4', 'פרוקסי דוח חיובי: גאפ 4%+ ומחזור פי 3+ (קנייה למחרת)', (X, I, k) => { const g = gap(X, k); return g >= 0.04 && I.vr[k] >= 3 && X.C[k] >= X.O[k] ? g : NaN; });
  add('F07', 'EARN8', 'פרוקסי דוח חיובי: גאפ 8%+ ומחזור פי 3+ (קנייה למחרת)', (X, I, k) => { const g = gap(X, k); return g >= 0.08 && I.vr[k] >= 3 && X.C[k] >= X.O[k] ? g : NaN; });
  add('F08', 'RSDAY', 'עלו הכי הרבה ביום שהמדד ירד 1%+', (X, I, k, c) => (c.spyR[k] <= -0.01 && ret(X.C, k, 1) > 0 ? ret(X.C, k, 1) : NaN));
  add('F08', 'RSD20', 'החזקות ביותר בימי ירידה של המדד (20 יום)', (X, I, k) => (I.rsd[k] > 0 ? I.rsd[k] : NaN));
  for (const n of [20, 60, 120, 252]) add('F09', `SEC${n}`, `סקטור עם מומנטום ${n} יום`, (X, I, k) => ret(X.C, k, n));
  add('F10', 'GAPUP', 'גאפ למעלה 2%+ (קנייה בפתיחה, המשך)', (X, I, k) => { const g = gap(X, k); return g >= 0.02 ? g : NaN; }, { off: 0, extra: 5e-4 });
  add('F10', 'GAPDN', 'גאפ למטה 2%+ (קנייה בפתיחה, היפוך)', (X, I, k) => { const g = gap(X, k); return g <= -0.02 ? -g : NaN; }, { off: 0, extra: 5e-4 });
  for (const n of [1, 3, 5, 20]) add('F11', `SHT${n}`, `שורט על העולות הקיצוניות ב-${n} ימים`, (X, I, k) => { const r = ret(X.C, k, n); return r > 0.05 ? r : NaN; }, { side: 'S' });
  add('F12', 'LOWVOL', 'תנודתיות 60 יום הנמוכה ביותר', (X, I, k) => (I.vol60[k] > 0 ? -I.vol60[k] : NaN));
  add('F12', 'RAMOM', 'מומנטום 12 חודשים ÷ תנודתיות', (X, I, k) => { const r = ret(X.C, k, 252); return r > 0 && I.vol60[k] > 0 ? r / I.vol60[k] : NaN; });
  add('F12', 'RAMOM12-1', 'מומנטום 12-1 ÷ תנודתיות', (X, I, k) => { const r = X.C[k - 21] > 0 && X.C[k - 252] > 0 ? X.C[k - 21] / X.C[k - 252] - 1 : NaN; return r > 0 && I.vol60[k] > 0 ? r / I.vol60[k] : NaN; });
  add('F00', 'RANDOM', 'בחירה אקראית מהיקום', (X, I, k, c, si) => { let h = (si * 2654435761 + k * 40503) >>> 0; h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0; return h / 4294967296; });
  return V;
}

// ---------- דירוג: 20 המועמדות הראשונות לכל אסטרטגיה, יקום ויום ----------
export const TOPK = 20;
export function rankAll(ctx, V, uniName, elig){
  const { L } = ctx, out = {};
  for (const v of V) out[v.id] = new Int32Array(L * TOPK).fill(-1);
  const bufS = new Float64Array(TOPK + 1), bufI = new Int32Array(TOPK + 1);
  for (let k = ctx.k0; k < L; k++){
    const E = elig[k]; if (!E || !E.length) continue;
    for (const v of V){
      let n = 0;
      for (let q = 0; q < E.length; q++){
        const si = E[q], X = ctx.X[si], I = ctx.I[si];
        if (v.off === 0 && !(X.O[k] > 0)) continue;
        const sc = v.score(X, I, k, ctx, si); if (!Number.isFinite(sc)) continue;
        if (n < TOPK || sc > bufS[n - 1]){ let p = n < TOPK ? n++ : TOPK - 1; while (p > 0 && bufS[p - 1] < sc){ bufS[p] = bufS[p - 1]; bufI[p] = bufI[p - 1]; p -= 1; } bufS[p] = sc; bufI[p] = si; }
      }
      const T = out[v.id]; for (let q = 0; q < n; q++) T[k * TOPK + q] = bufI[q];
    }
  }
  return out;
}

// ---------- סימולציה ----------
const halfSpread = (adv) => (adv >= 1e9 ? 1.5e-4 : adv >= 1e8 ? 3e-4 : adv >= 2e7 ? 7e-4 : adv >= 5e6 ? 15e-4 : 30e-4);
const commission = (sh, px) => Math.min(Math.max(1, 0.005 * sh), 0.01 * sh * px);
const secFees = (sh, px) => 0.0000278 * sh * px + Math.min(0.000166 * sh, 8.3);
// cost: 'net' | 'gross' | 'net2x'. מחזיר סטטיסטיקה לפי שנה, לחלונות (מלא/פיתוח/מבחן) ולעסקאות
export function simulate(ctx, top, { N, H, side = 'L', off = 1, extra = 0, cost = 'net', etf = false }){
  const { L, cal, X, I, k0, kDev } = ctx, gross = cost === 'gross', mul = cost === 'net2x' ? 2 : 1;
  const sl = Array.from({ length: H }, () => ({ cash: START_USD / H, pos: [], exit: -1 }));
  const yr = {}, win = { all: { pk: 1, eq: 1, dd: 0 }, dev: { pk: 1, eq: 1, dd: 0 }, test: { pk: 1, eq: 1, dd: 0 } };
  let prev = START_USD, trades = 0, wins = 0, sumTr = 0, feesUsd = 0;
  const hs = (si, k) => (gross ? 0 : etf ? 1e-4 : halfSpread(I[si].adv[k]) * mul + extra);
  for (let t = k0 + 1; t < L; t++){
    // כניסה בפתיחת t
    const j = (t - k0 - 1) % H, Sl = sl[j], sig = t - off;
    if (!Sl.pos.length && t + H - 1 < L && sig >= k0){
      const picks = []; for (let q = 0; q < TOPK && picks.length < N; q++){ const si = top[sig * TOPK + q]; if (si < 0) break; if (X[si].O[t] > 0) picks.push(si); }
      const per = Sl.cash / N;
      for (const si of picks){
        const px = X[si].O[t], h = hs(si, sig);
        if (side === 'L'){ const bp = px * (1 + h), sh = per / bp, cm = gross ? 0 : commission(sh, bp); if (per < 5) continue; Sl.cash -= sh * bp + cm; feesUsd += cm; Sl.pos.push({ si, sh, basis: sh * bp + cm, last: px }); }
        else { const sp = px * (1 - h), sh = per / sp, cm = gross ? 0 : commission(sh, sp) + secFees(sh, sp); if (per < 5) continue; Sl.cash += sh * sp - cm; feesUsd += cm; Sl.pos.push({ si, sh: -sh, basis: sh * sp - cm, last: px }); }
      }
      Sl.exit = t + H - 1;
    }
    // סגירת t: שערוך, השאלה, יציאות
    let tot = 0;
    for (const s of sl){
      for (const p of s.pos){ const c = X[p.si].C[t]; if (c > 0) p.last = c; if (p.sh < 0 && !gross){ const b = -p.sh * p.last * 2e-4 * mul; s.cash -= b; feesUsd += b; } }
      if (s.exit === t && s.pos.length){
        for (const p of s.pos){
          const h = hs(p.si, t), px = p.last;
          if (p.sh > 0){ const sp = px * (1 - h), cm = gross ? 0 : commission(p.sh, sp) + secFees(p.sh, sp), v = p.sh * sp - cm; s.cash += v; feesUsd += cm; const r = v / p.basis - 1; trades += 1; sumTr += r; if (r > 0) wins += 1; }
          else { const sh = -p.sh, bp = px * (1 + h), cm = gross ? 0 : commission(sh, bp), v = sh * bp + cm; s.cash -= v; feesUsd += cm; const r = p.basis / v - 1; trades += 1; sumTr += r; if (r > 0) wins += 1; }
        }
        s.pos = [];
      }
      tot += s.cash; for (const p of s.pos) tot += p.sh * p.last;
    }
    const r = tot / prev - 1; prev = tot;
    const y = cal[t].slice(0, 4), Y = (yr[y] ||= { n: 0, s: 0, s2: 0, g: 1 }); Y.n += 1; Y.s += r; Y.s2 += r * r; Y.g *= 1 + r;
    for (const [w, ok] of [['all', true], ['dev', t <= kDev], ['test', t > kDev]]){ if (!ok) continue; const W = win[w]; W.eq *= 1 + r; W.pk = Math.max(W.pk, W.eq); W.dd = Math.max(W.dd, 1 - W.eq / W.pk); }
  }
  return { yr, dd: { all: win.all.dd, dev: win.dev.dd, test: win.test.dd }, trades, wins, avgTr: trades ? sumTr / trades : 0, feesUsd, end: prev };
}
// מדדים לחלון שנים
export function stats(yr, y0, y1){
  let n = 0, s = 0, s2 = 0, g = 1; const ys = Object.keys(yr).filter((y) => y >= y0 && y <= y1);
  for (const y of ys){ const Y = yr[y]; n += Y.n; s += Y.s; s2 += Y.s2; g *= Y.g; }
  const mu = n ? s / n : 0, sd = n ? Math.sqrt(Math.max(s2 / n - mu * mu, 0)) : 0;
  return { n, ret: g - 1, cagr: n ? g ** (252 / n) - 1 : 0, sharpe: sd > 0 ? (mu / sd) * Math.sqrt(252) : 0, pos: ys.filter((y) => yr[y].g > 1).length, years: ys.length };
}

// ---------- ראשי ----------
async function main(){
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUTDIR = arg('--outdir', 'xsec-out'), CACHE = arg('--cache', ''), t0 = Date.now();
  mkdirSync(OUTDIR, { recursive: true });
  let U, raw;
  if (CACHE && existsSync(CACHE)) ({ U, raw } = JSON.parse(readFileSync(CACHE, 'utf8')));
  else {
    U = await universes();
    // כל מי שהיה חבר ב-S&P 500 מאז 2007 (גם שנמחקו) — נטען אם יש לו מחירים
    const removed = Object.entries(U.iv500).filter(([, ivs]) => ivs.some(([, b]) => b === null || b >= '2007-01-01')).map(([s]) => s), adds = [];
    const ETF = ['SPY', 'QQQ', 'IWM', 'IJR', 'XLB', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XLRE', 'XLC'];
    const syms = [...new Set([...ETF, ...U.sp500, ...U.sp400, ...U.sp600, ...U.ndx, ...U.r2k, ...removed, ...adds])];
    log(`fetching ${syms.length} symbols`); raw = {}; const q = [...syms];
    await Promise.all(Array.from({ length: 8 }, async () => { for (let s; (s = q.shift());){ const b = await daily(s); if (b) raw[s] = b; await sleep(60); } }));
    log(`loaded ${Object.keys(raw).length}/${syms.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (!raw.SPY) throw new Error('אין נתוני SPY');
    if (CACHE) try { writeFileSync(CACHE, JSON.stringify({ U, raw })); } catch (e) { log('cache not saved: ' + e.message); }
  }
  const calT = raw.SPY.t, cal = Array.from(calT, dayIso), L = cal.length, S = build(raw, calT), syms = Object.keys(S); raw = null;
  const spyR = new Float64Array(L); for (let k = 1; k < L; k++) spyR[k] = S.SPY.C[k] / S.SPY.C[k - 1] - 1;
  const idx = new Map(syms.map((s, i) => [s, i])), Xs = syms.map((s) => S[s]), Is = Xs.map((X) => indicators(X, spyR));
  const k0 = cal.findIndex((d) => d >= SIG_START), kDev = cal.findIndex((d) => d > DEV_END) - 1;
  const ctx = { L, cal, X: Xs, I: Is, k0, kDev, spyR };
  log(`calendar ${cal[0]} → ${cal.at(-1)} (${L}); signals from ${cal[k0]}; dev → ${cal[kDev]}; indicators ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // יקומים לכל יום: חברות + מחיר > 5$ + נזילות
  const ETFSET = new Set(['SPY', 'QQQ', 'IWM', 'IJR', 'XLB', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XLRE', 'XLC']), SECT = ['XLB', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XLRE', 'XLC'];
  const setN = new Set(U.ndx), setR = new Set(U.r2k);
  const UNI = {
    sp500: { he: 'S&P 500 (הרכב היסטורי)', bench: 'SPY', minAdv: 1e7, inU: (s, d) => inIv(U.iv500[s], d) },
    ndx: { he: 'Nasdaq 100 (הרכב נוכחי — הטיית שורדים)', bench: 'QQQ', minAdv: 1e7, inU: (s) => setN.has(s) },
    r2k: { he: `Russell 2000 — ${U.r2kSrc} (הטיית שורדים)`, bench: 'IWM', minAdv: 2e6, inU: (s) => setR.has(s) },
    broad: { he: 'יקום רחב (כל המניות שנטענו)', bench: 'SPY', minAdv: 5e6, inU: (s) => !ETFSET.has(s) },
    sectors: { he: 'קרנות סקטור SPDR', bench: 'SPY', minAdv: 0, inU: (s) => SECT.includes(s), etf: true },
  };
  // זכאות ביום k לפי נתונים עד k−1 בלבד (מחיר, מחזור ממוצע, חברות) — כך שגם אסטרטגיות הגאפ (החלטה בפתיחת k) נקיות ממידע עתידי
  const EC = {}, eligOf = (u, un) => EC[un] ||= (() => { const E = new Array(L); for (let k = k0; k < L; k++){ const a = []; for (let i = 0; i < syms.length; i++){ const X = Xs[i]; if (!(X.C[k - 1] > 0)) continue; if (!u.inU(syms[i], cal[k])) continue; if (!u.etf && !(X.CR[k - 1] > 5 && Is[i].adv[k] >= u.minAdv)) continue; a.push(i); } E[k] = Int32Array.from(a); } return E; })();
  const V = variants(), Ns = [2, 3, 5, 10, 20], Hs = [1, 2, 3, 5, 10, 20], rows = [], yearsAll = [...new Set(cal.slice(k0).map((d) => d.slice(0, 4)))];
  const coverage = {}; // S&P 500: כמה מהחברים ההיסטוריים יש להם מחירים
  for (const y of yearsAll){ const d = `${y}-07-01`; const mem = Object.keys(U.iv500).filter((s) => inIv(U.iv500[s], d)); coverage[y] = { members: mem.length, withData: mem.filter((s) => idx.has(s) && S[s].C.some((c, k) => cal[k] >= `${y}-01-01` && cal[k] <= `${y}-12-31` && c > 0)).length }; }
  const bench = {};
  for (const b of ['SPY', 'QQQ', 'IWM', 'IJR']){ if (!S[b]) continue; const yr = {}; for (let t = k0 + 1; t < L; t++){ const r = S[b].C[t] / S[b].C[t - 1] - 1; const Y = (yr[cal[t].slice(0, 4)] ||= { n: 0, s: 0, s2: 0, g: 1 }); Y.n += 1; Y.s += r; Y.s2 += r * r; Y.g *= 1 + r; } bench[b] = { yr }; }
  // מקס׳ ירידה של המדדים
  for (const b of Object.keys(bench)){ const C = S[b].C; for (const [w, a, z] of [['all', k0, L - 1], ['dev', k0, kDev], ['test', kDev, L - 1]]){ let pk = 0, dd = 0; for (let t = a; t <= z; t++){ pk = Math.max(pk, C[t]); dd = Math.max(dd, 1 - C[t] / pk); } (bench[b].dd ||= {})[w] = dd; } }

  for (const [un, u] of Object.entries(UNI)){
    const tU = Date.now(), E = eligOf(u, un), Vu = V.filter((v) => (un === 'sectors' ? v.fam === 'F09' : v.fam !== 'F09'));
    const top = rankAll(ctx, Vu, un, E);
    const NsU = un === 'sectors' ? [2, 3, 5] : Ns;
    for (const v of Vu) for (const N of NsU) for (const H of Hs){
      const o = { N, H, side: v.side, off: v.off, extra: v.extra, etf: !!u.etf };
      const net = simulate(ctx, top[v.id], { ...o, cost: 'net' }), gr = simulate(ctx, top[v.id], { ...o, cost: 'gross' });
      rows.push({ uni: un, fam: v.fam, id: v.id, he: v.he, side: v.side, N, H, net, gross: gr });
    }
    log(`${un}: elig avg ${(E.slice(k0).reduce((a, x) => a + x.length, 0) / (L - k0)).toFixed(0)}, ${Vu.length} variants, ${((Date.now() - tU) / 1000).toFixed(0)}s`);
  }

  // ---------- הערכה ----------
  const y0 = yearsAll[0], yDev = DEV_END.slice(0, 4), yT0 = String(Number(yDev) + 1), yEnd = yearsAll.at(-1);
  for (const r of rows){ r.dev = stats(r.net.yr, y0, yDev); r.test = stats(r.net.yr, yT0, yEnd); r.all = stats(r.net.yr, y0, yEnd); r.testG = stats(r.gross.yr, yT0, yEnd); r.allG = stats(r.gross.yr, y0, yEnd); }
  const rnd = new Map(rows.filter((r) => r.fam === 'F00').map((r) => [`${r.uni}|${r.N}|${r.H}`, r]));
  const bS = (b, a, z) => stats(bench[b].yr, a, z);
  for (const r of rows){
    const base = rnd.get(`${r.uni}|${r.N}|${r.H}`), bm = UNI[r.uni].bench;
    r.bTest = bS(bm, yT0, yEnd); r.rndTest = base ? base.test : null;
    r.passA = r.fam !== 'F00' && r.dev.sharpe >= 0.5 && r.dev.cagr > 0 && r.test.sharpe >= 0.3 && r.test.cagr > 0 && (r.side === 'S' || !base || r.test.cagr > base.test.cagr);
    r.passB = r.passA && r.test.sharpe > r.bTest.sharpe;
  }
  // Walk-Forward לכל משפחה ויקום: בכל שנה — התצורה עם השארפ הגבוה ב-3 השנים הקודמות
  const wf = [];
  for (const un of Object.keys(UNI)) for (const fam of Object.keys(FAMS)){
    const R = rows.filter((r) => r.uni === un && r.fam === fam); if (!R.length) continue;
    const chain = []; let g = 1, n = 0, s = 0, s2 = 0;
    for (const y of yearsAll.filter((y) => Number(y) >= Number(y0) + 3)){
      const a = String(Number(y) - 3), b = String(Number(y) - 1);
      const best = R.reduce((m, r) => { const st = stats(r.net.yr, a, b); return !m || st.sharpe > m.st.sharpe ? { r, st } : m; }, null);
      const Y = best.r.net.yr[y]; if (!Y) continue; chain.push({ y, id: best.r.id, N: best.r.N, H: best.r.H, ret: Y.g - 1 }); g *= Y.g; n += Y.n; s += Y.s; s2 += Y.s2;
    }
    const mu = n ? s / n : 0, sd = n ? Math.sqrt(Math.max(s2 / n - mu * mu, 0)) : 0;
    const bm = UNI[un].bench, bst = bS(bm, chain[0]?.y, yEnd);
    wf.push({ uni: un, fam, chain, cagr: n ? g ** (252 / n) - 1 : 0, sharpe: sd ? (mu / sd) * Math.sqrt(252) : 0, posY: chain.filter((c) => c.ret > 0).length, nY: chain.length, bCagr: bst.cagr, bSharpe: bst.sharpe });
  }
  // רגישות עלויות ×2 ל-20 המובילות
  const passing = rows.filter((r) => r.passA).sort((a, b) => b.dev.sharpe - a.dev.sharpe), top20 = passing.slice(0, 20);
  for (const r of top20){ const u = UNI[r.uni], v = V.find((x) => x.id === r.id); const E = eligOf(u, r.uni); const top = rankAll(ctx, [v], r.uni, E)[v.id]; r.x2 = stats(simulate(ctx, top, { N: r.N, H: r.H, side: v.side, off: v.off, extra: v.extra, etf: !!u.etf, cost: 'net2x' }).yr, yT0, yEnd); }

  // ---------- פלט ----------
  const pct = (x, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%` : '—'), f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
  const usd = (x) => `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x)).toLocaleString('en-US')}$`;
  const csvRows = [['universe', 'family', 'id', 'side', 'N', 'H', 'dev_cagr', 'dev_sharpe', 'dev_mdd', 'test_cagr', 'test_sharpe', 'test_mdd', 'all_ret', 'all_cagr', 'all_sharpe', 'all_mdd', 'end_usd', 'pnl_usd', 'trades', 'win_rate', 'avg_trade', 'fees_usd', 'test_cagr_gross', 'all_cagr_gross', 'test_vs_bench_sharpe', 'test_vs_random_cagr', 'passA', 'passB'].join(',')];
  for (const r of rows) csvRows.push([r.uni, r.fam, r.id, r.side, r.N, r.H, r.dev.cagr, r.dev.sharpe, r.net.dd.dev, r.test.cagr, r.test.sharpe, r.net.dd.test, r.all.ret, r.all.cagr, r.all.sharpe, r.net.dd.all, r.net.end, r.net.end - START_USD, r.net.trades, r.net.trades ? r.net.wins / r.net.trades : 0, r.net.avgTr, r.net.feesUsd, r.testG.cagr, r.allG.cagr, r.test.sharpe - r.bTest.sharpe, r.rndTest ? r.test.cagr - r.rndTest.cagr : '', r.passA ? 1 : 0, r.passB ? 1 : 0].map((x) => (typeof x === 'number' ? +x.toFixed(5) : x)).join(','));
  writeFileSync(`${OUTDIR}/results.csv`, csvRows.join('\n'));
  writeFileSync(`${OUTDIR}/yearly.csv`, [['universe', 'id', 'N', 'H', ...yearsAll].join(','), ...rows.map((r) => [r.uni, r.id, r.N, r.H, ...yearsAll.map((y) => (r.net.yr[y] ? +(r.net.yr[y].g - 1).toFixed(5) : ''))].join(','))].join('\n'));
  writeFileSync(`${OUTDIR}/walkforward.json`, JSON.stringify(wf, null, 1));
  writeFileSync(`${OUTDIR}/meta.json`, JSON.stringify({ generated: new Date().toISOString(), calendar: [cal[0], cal.at(-1)], signals_from: cal[k0], dev: [cal[k0], cal[kDev]], test: [cal[kDev + 1], cal.at(-1)], symbols_loaded: syms.length, universes: Object.fromEntries(Object.entries(UNI).map(([k, u]) => [k, u.he])), sp500_history_source: U.memSrc, sp500_history_tickers: Object.keys(U.iv500).length, coverage, configs: rows.length }, null, 1));

  const md = [];
  const T = (h, rs) => { md.push(`| ${h.join(' | ')} |`, `|${h.map(() => '---').join('|')}|`, ...rs.map((x) => `| ${x.join(' | ')} |`), ''); };
  md.push(`# מחקר שיטתי — 12 משפחות אסטרטגיות (${cal[k0]} → ${cal.at(-1)})`, '',
    `- **נתונים:** Yahoo Finance (מחירים יומיים מתואמים לפיצולים ודיבידנדים), ויקיפדיה (הרכב נוכחי: S&P 500/400/600, Nasdaq 100), הרכב S&P 500 היסטורי: ${U.memSrc || 'ויקיפדיה'}, ${U.r2kSrc}. נטענו ${syms.length} סימבולים.`,
    `- **פיתוח:** ${cal[k0]} → ${cal[kDev]} · **מבחן (לא שימש לבחירה):** ${cal[kDev + 1]} → ${cal.at(-1)} · Walk-Forward שנתי (3 שנים אחורה).`,
    `- **ביצוע:** 50,000$, השקעה מחדש, H תיקי-משנה מדורגים, מניות חלקיות, עמלת IBKR (מינ׳ 1$), חצי מרווח לפי מחזור (1.5–30bp לצד), שורט: השאלה 0.02% ליום.`,
    `- **נבדקו ${rows.length.toLocaleString('en-US')} תצורות** (${V.length - 1} גרסאות × ${Ns.length} גדלי סל × ${Hs.length} תקופות החזקה × 4 יקומים + סקטורים).`,
    `- **עברו מחוץ למדגם (A):** ${rows.filter((r) => r.passA).length} · **וגם ניצחו את המדד בשארפ במבחן (B):** ${rows.filter((r) => r.passB).length}.`,
    '- **תנאי A:** שארפ פיתוח ≥ 0.5 ותשואה חיובית; שארפ מבחן ≥ 0.3 ותשואה חיובית אחרי עלויות; ובלונג — תשואת המבחן גבוהה מבחירה אקראית באותו יקום, סל והחזקה (מנטרל הטיית שורדים ובטא).', '');
  md.push('## כיסוי S&P 500 ההיסטורי (חברים באמצע השנה שיש להם מחירים)');
  T(['שנה', ...yearsAll], [['חברים', ...yearsAll.map((y) => coverage[y].members)], ['עם מחירים', ...yearsAll.map((y) => `${coverage[y].withData} (${Math.round(coverage[y].withData / coverage[y].members * 100)}%)`)]]);
  md.push('## קנה והחזק (מדדים)');
  T(['מדד', 'פיתוח CAGR / שארפ', 'מבחן CAGR / שארפ', 'מבחן ירידה מקס׳', 'כל התקופה CAGR', ...yearsAll], Object.keys(bench).map((b) => { const d = bS(b, y0, yDev), t = bS(b, yT0, yEnd), a = bS(b, y0, yEnd); return [b, `${pct(d.cagr)} / ${f2(d.sharpe)}`, `${pct(t.cagr)} / ${f2(t.sharpe)}`, pct(-bench[b].dd.test), pct(a.cagr), ...yearsAll.map((y) => pct(bench[b].yr[y].g - 1, 0))]; }));
  md.push('## קו בסיס: בחירה אקראית מאותו יקום (כמה "מגיע" בלי שום יתרון)');
  T(['יקום', 'N', 'H', 'פיתוח CAGR / שארפ', 'מבחן CAGR / שארפ'], rows.filter((r) => r.fam === 'F00' && [5, 10].includes(r.N) && [1, 5, 20].includes(r.H)).map((r) => [r.uni, r.N, r.H, `${pct(r.dev.cagr)} / ${f2(r.dev.sharpe)}`, `${pct(r.test.cagr)} / ${f2(r.test.sharpe)}`]));
  const desc = (r) => `${r.id} · ${r.he} · ${r.N} מניות · החזקה ${r.H}`;
  md.push('## 20 האסטרטגיות המובילות שעברו את המבחן מחוץ למדגם', 'מדורגות לפי שארפ בתקופת הפיתוח (לא לפי המבחן — כדי לא לבחור שוב על המבחן). ✅ = גם שארפ מבחן גבוה משל המדד.', '');
  T(['#', 'יקום', 'אסטרטגיה', 'פיתוח CAGR / שארפ / ירידה', 'מבחן CAGR / שארפ / ירידה', 'מבחן לפני עלויות', 'מבחן עלויות ×2', 'מדד במבחן', 'אקראי במבחן', 'כל התקופה: מצטבר / 50K→', 'עסקאות / הצלחה / ממוצע', 'B'],
    top20.map((r, i) => [i + 1, r.uni, desc(r), `${pct(r.dev.cagr)} / ${f2(r.dev.sharpe)} / ${pct(-r.net.dd.dev)}`, `${pct(r.test.cagr)} / ${f2(r.test.sharpe)} / ${pct(-r.net.dd.test)}`, pct(r.testG.cagr), r.x2 ? pct(r.x2.cagr) : '—', `${pct(r.bTest.cagr)} / ${f2(r.bTest.sharpe)}`, r.rndTest ? pct(r.rndTest.cagr) : '—', `${pct(r.all.ret, 0)} / ${usd(r.net.end - START_USD)}`, `${r.net.trades.toLocaleString('en-US')} / ${pct(r.net.trades ? r.net.wins / r.net.trades : 0, 0)} / ${pct(r.net.avgTr, 2)}`, r.passB ? '✅' : '']));
  if (top20.length){ md.push('### לפי שנה (אחרי עלויות)'); T(['#', ...yearsAll], top20.map((r, i) => [i + 1, ...yearsAll.map((y) => (r.net.yr[y] ? pct(r.net.yr[y].g - 1, 0) : '—'))])); }
  md.push('## כל משפחה: התצורה הטובה בפיתוח — ומה קרה לה במבחן (כולל כישלונות)');
  const famRows = [];
  for (const un of Object.keys(UNI)) for (const fam of Object.keys(FAMS)){
    const R = rows.filter((r) => r.uni === un && r.fam === fam); if (!R.length) continue;
    const b = R.reduce((m, r) => (!m || r.dev.sharpe > m.dev.sharpe ? r : m), null), w = wf.find((x) => x.uni === un && x.fam === fam), nPass = R.filter((r) => r.passA).length;
    famRows.push([un, `${fam} ${FAMS[fam]}`, `${b.id} · ${b.N}/${b.H}`, `${pct(b.dev.cagr)} / ${f2(b.dev.sharpe)}`, `${pct(b.test.cagr)} / ${f2(b.test.sharpe)}`, pct(b.testG.cagr), `${pct(b.bTest.cagr)} / ${f2(b.bTest.sharpe)}`, w ? `${pct(w.cagr)} / ${f2(w.sharpe)} (${w.posY}/${w.nY})` : '—', `${nPass}/${R.length}`, b.passB ? '✅' : b.passA ? '🟡' : '❌']);
  }
  T(['יקום', 'משפחה', 'הטובה בפיתוח (N/H)', 'פיתוח CAGR / שארפ', 'מבחן CAGR / שארפ', 'מבחן לפני עלויות', 'מדד במבחן', 'Walk-Forward CAGR / שארפ (שנים חיוביות)', 'עברו A', 'פסיקה'], famRows);
  md.push('## משפחות שאף תצורה בהן לא עברה (בשום יקום)');
  for (const fam of Object.keys(FAMS)){ if (fam === 'F00') continue; const R = rows.filter((r) => r.fam === fam); if (R.length && !R.some((r) => r.passA)) md.push(`- ❌ ${fam} ${FAMS[fam]} — 0 מתוך ${R.length} תצורות`); }
  md.push('', '## מגבלות שנשארו', '- Nasdaq 100 ו-Russell 2000: הרכב נוכחי בלבד → הטיית שורדים לטובת קנייה. ההשוואה לבחירה אקראית מאותו יקום מנטרלת חלק ממנה.',
    '- S&P 500: מניות שנמחקו ואין להן מחירים ב-Yahoo חסרות (ראו טבלת הכיסוי).', '- משפחה 7 היא פרוקסי (אין נתוני דוחות היסטוריים). מרווחים הם הערכה לפי מחזור, לא ציטוטים היסטוריים.',
    '- שארפ בלי ריבית חסרת סיכון. מניות חלקיות; ההון לא ממונף; שורט בלי מגבלות זמינות השאלה.', '', `קבצים: results.csv (כל ${rows.length} התצורות, לפני/אחרי עלויות), yearly.csv, walkforward.json, meta.json. זמן ריצה: ${((Date.now() - t0) / 60000).toFixed(1)} דקות.`);
  writeFileSync(`${OUTDIR}/report.md`, md.join('\n'));
  console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
