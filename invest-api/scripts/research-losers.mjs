#!/usr/bin/env node
// סימולציה (בקשת מאיר, 8/11/2026): "כל יום ב-3 החודשים האחרונים שמתי על 5 או 10 המניות שירדו הכי הרבה ואז מכרתי בסוף המסחר —
// אם התחלתי ב-50,000$ כמה היה לי היום, וכמה עמלות שילמתי". מחקר בלבד, בלי פקודות.
// יקום: S&P 1500 (500+400+600 מוויקיפדיה, הרכב של היום — הטיית שורדים), נרות יומיים מ-Yahoo (ציבורי). סינון כמו בסורק: מחיר > 5$,
// מחזור ממוצע 20 יום > 20 מיליון $. שתי גרסאות:
//   A — קנייה בסגירה של יום הירידה (פקודת MOC), מכירה בסגירה של היום הבא.
//   B — קנייה בפתיחה של היום הבא, מכירה בסגירה שלו (יום מסחר אחד).
// עלויות: עמלת IBKR Pro Fixed (0.005$ למניה, מינימום 1$, מקסימום 1% מהעסקה) + עמלות רגולטור במכירה (SEC 0.00278%, FINRA TAF),
// והחלקה/מרווח 0.05% לכל צד (רגישות: 0.15%). כל ההון מושקע מחדש כל יום, חלקים שווים, מניות שלמות.
// תוספת (בקשה נוספת): סטופ של 500$ לכל מניה — כשהרווח או ההפסד בפוזיציה מגיע ל-500$ מוכרים. נבדק על נרות שעה (Yahoo): פער בפתיחה
// מעבר לרמה → יציאה במחיר הפתיחה; נר שנגע בשתי הרמות → מניחים שההפסד קרה קודם (שמרני). אחרת — יציאה בסגירה כרגיל.
// גרסה שנייה (בקשה נוספת): סטופ של 500$ על כל התיק ביום — הרווח/הפסד המשותף של כל המניות נמדד בסגירת כל נר שעה (ובפתיחה בגרסה A);
// כשהוא מגיע ל-+500$ או ל-−500$ מוכרים את הכול באותם מחירים.
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out', ''), CACHE = arg('--cache', ''), START_USD = 50000, DAYS = 63;
const UA = { 'User-Agent': 'Mozilla/5.0 (research backtest)', Accept: '*/*' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (...a) => console.error(...a);
async function get(url, tries = 4){ for (let k = 0; k < tries; k++){ try { const r = await fetch(url, { headers: UA }); if (r.status === 429){ await sleep(3000 * (k + 1)); continue; } if (!r.ok) return null; return await r.text(); } catch { await sleep(1000 * (k + 1)); } } return null; }

async function universe(){
  const pages = ['List_of_S%26P_500_companies', 'List_of_S%26P_400_companies', 'List_of_S%26P_600_companies'], set = new Set();
  for (const p of pages){
    const h = await get(`https://en.wikipedia.org/wiki/${p}`); if (!h) { log('wiki fail', p); continue; }
    const t = h.slice(h.indexOf('<table'), h.indexOf('</table>'));
    for (const m of t.matchAll(/<tr>\s*<td[^>]*>\s*(?:<a[^>]*>)?([A-Z][A-Z0-9.\-]{0,6})(?:<\/a>)?\s*<\/td>/g)) set.add(m[1].replace('.', '-'));
  }
  return [...set];
}
async function bars(sym){
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=6mo&interval=1d&includeAdjustedClose=false`);
  try { const r = JSON.parse(j).chart.result[0], q = r.indicators.quote[0]; return r.timestamp.map((t, i) => ({ d: new Date(t * 1000).toISOString().slice(0, 10), o: q.open[i], c: q.close[i], v: q.volume[i] })).filter((b) => b.o > 0 && b.c > 0); } catch { return null; }
}
async function hourly(sym){
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=6mo&interval=1h&includePrePost=false`);
  try { const r = JSON.parse(j).chart.result[0], q = r.indicators.quote[0], out = {};
    r.timestamp.forEach((t, i) => { if (!(q.high[i] > 0 && q.low[i] > 0)) return; const d = new Date(t * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); (out[d] ||= []).push({ t, h: q.high[i], l: q.low[i], c: q.close[i] > 0 ? q.close[i] : null }); });
    return out; } catch { return null; }
}
async function load(){
  if (CACHE && existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, 'utf8'));
  const syms = await universe(); log(`universe: ${syms.length}`);
  const data = {}, q = [...syms, 'SPY'];
  const worker = async () => { for (let s; (s = q.shift());){ const b = await bars(s); if (b && b.length > 60) data[s] = b; await sleep(120); } };
  await Promise.all(Array.from({ length: 6 }, worker));
  log(`loaded: ${Object.keys(data).length}`);
  if (CACHE) writeFileSync(CACHE, JSON.stringify(data));
  return data;
}

const comm = (sh, px) => Math.min(Math.max(1, 0.005 * sh), 0.01 * sh * px);
const sellFees = (sh, px) => 0.0000278 * sh * px + Math.min(0.000166 * sh, 8.3);
function sim(data, days, N, mode, slip, stopUsd = 0, H = {}){
  let eq = START_USD, fees = 0, slipUsd = 0, trades = 0, wins = 0, peak = eq, dd = 0, worst = 0, best = 0, hitTp = 0, hitSl = 0, noData = 0; const log_ = [];
  const idx = {}; for (const [s, b] of Object.entries(data)) idx[s] = new Map(b.map((x, i) => [x.d, i]));
  for (let k = 0; k < days.length - 1; k++){
    const d = days[k], nx = days[k + 1], cand = [];
    for (const [s, b] of Object.entries(data)){
      if (s === 'SPY') continue;
      const i = idx[s].get(d), j = idx[s].get(nx); if (i === undefined || j === undefined || i < 21 || j !== i + 1) continue;
      const adv = b.slice(i - 20, i).reduce((a, x) => a + x.c * (x.v || 0), 0) / 20;
      if (b[i].c <= 5 || adv < 20e6) continue;
      cand.push({ s, r: b[i].c / b[i - 1].c - 1, buy: mode === 'A' ? b[i].c : b[j].o, sell: b[j].c, open: b[j].o, day: nx });
    }
    cand.sort((a, b) => a.r - b.r);
    const pick = cand.slice(0, N); if (!pick.length) continue;
    let end = 0; const per = eq / pick.length;
    for (const p of pick){
      const bpx = p.buy * (1 + slip), sh = Math.floor(per / bpx); if (sh < 1){ end += per; continue; }
      let out = p.sell;
      if (stopUsd > 0){
        const tp = bpx + stopUsd / sh, sl = bpx - stopUsd / sh, hb = H[p.s]?.[p.day];
        if (!hb) noData += 1;
        if (mode === 'A' && p.open >= tp){ out = p.open; hitTp += 1; } // פער בפתיחה מעל היעד
        else if (mode === 'A' && p.open <= sl){ out = p.open; hitSl += 1; } // פער בפתיחה מתחת לסטופ
        else for (const x of hb || []){ if (x.l <= sl){ out = sl; hitSl += 1; break; } if (x.h >= tp){ out = tp; hitTp += 1; break; } }
      }
      const spx = out * (1 - slip), f = comm(sh, bpx) + comm(sh, spx) + sellFees(sh, spx);
      const val = per - sh * bpx + sh * spx - f;
      fees += f; slipUsd += sh * (p.buy * slip + out * slip); trades += 2; end += val;
    }
    const r = end / eq - 1; if (r > 0) wins += 1; worst = Math.min(worst, r); best = Math.max(best, r);
    eq = end; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
    log_.push({ d: nx, eq, r, picks: pick.map((p) => `${p.s} ${(p.r * 100).toFixed(1)}%`) });
  }
  return { eq, fees, slipUsd, trades, wins, n: log_.length, dd, worst, best, hitTp, hitSl, noData, log: log_ };
}

function simPort(data, days, N, mode, slip, stopUsd, H){
  let eq = START_USD, fees = 0, wins = 0, peak = eq, dd = 0, hitTp = 0, hitSl = 0, n = 0;
  const idx = {}; for (const [s, b] of Object.entries(data)) idx[s] = new Map(b.map((x, i) => [x.d, i]));
  for (let k = 0; k < days.length - 1; k++){
    const d = days[k], nx = days[k + 1], cand = [];
    for (const [s, b] of Object.entries(data)){
      if (s === 'SPY') continue;
      const i = idx[s].get(d), j = idx[s].get(nx); if (i === undefined || j === undefined || i < 21 || j !== i + 1) continue;
      const adv = b.slice(i - 20, i).reduce((a, x) => a + x.c * (x.v || 0), 0) / 20;
      if (b[i].c <= 5 || adv < 20e6) continue;
      cand.push({ s, r: b[i].c / b[i - 1].c - 1, buy: mode === 'A' ? b[i].c : b[j].o, sell: b[j].c, open: b[j].o });
    }
    cand.sort((a, b) => a.r - b.r);
    const pick = cand.slice(0, N); if (!pick.length) continue;
    const per = eq / pick.length; let cash = 0; const pos = [];
    for (const p of pick){ const bpx = p.buy * (1 + slip), sh = Math.floor(per / bpx); if (sh < 1){ cash += per; continue; } const cb = comm(sh, bpx); cash += per - sh * bpx - cb; fees += cb; pos.push({ ...p, sh, bpx, last: mode === 'A' ? p.open : p.buy }); }
    const pnl = () => pos.reduce((a, x) => a + x.sh * (x.last - x.bpx), 0);
    let exitAt = null; // מחיר יציאה = last של כל פוזיציה
    if (mode === 'A'){ const v = pnl(); if (v >= stopUsd){ exitAt = 'tp'; } else if (v <= -stopUsd){ exitAt = 'sl'; } }
    if (!exitAt){
      const ts = [...new Set(pos.flatMap((x) => (H[x.s]?.[nx] || []).map((b) => b.t)))].sort((a, b) => a - b);
      const maps = pos.map((x) => new Map((H[x.s]?.[nx] || []).filter((b) => b.c).map((b) => [b.t, b.c])));
      for (const t of ts){ pos.forEach((x, q) => { const c = maps[q].get(t); if (c) x.last = c; }); const v = pnl(); if (v >= stopUsd){ exitAt = 'tp'; break; } if (v <= -stopUsd){ exitAt = 'sl'; break; } }
      if (!exitAt) for (const x of pos) x.last = x.sell;
    }
    if (exitAt === 'tp') hitTp += 1; if (exitAt === 'sl') hitSl += 1;
    let end = cash;
    for (const x of pos){ const spx = x.last * (1 - slip), f = comm(x.sh, spx) + sellFees(x.sh, spx); fees += f; end += x.sh * spx - f; }
    if (end > eq) wins += 1; eq = end; n += 1; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
  }
  return { eq, fees, wins, n, dd, hitTp, hitSl };
}

const data = await load();
const all = [...new Set(Object.values(data).flatMap((b) => b.map((x) => x.d)))].sort();
const spyDays = new Set((data.SPY || []).map((x) => x.d)), tradingDays = all.filter((d) => spyDays.has(d));
const days = tradingDays.slice(-(DAYS + 1)); // 63 ימי החזקה = ~3 חודשים
const spy = data.SPY, si = new Map(spy.map((x, i) => [x.d, i])), spyRet = spy[si.get(days.at(-1))].c / spy[si.get(days[0])].c - 1;
const usd = (x) => `${Math.round(x).toLocaleString('en-US')}$`, pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
const L = [`# סימולציה — קנייה יומית של המניות שירדו הכי הרבה (${days[0]} → ${days.at(-1)}, ${days.length - 1} ימי מסחר)`,
  `יקום: ${Object.keys(data).length - 1} מניות S&P 1500 (הרכב של היום), מחיר > 5$, מחזור ממוצע > 20M$. התחלה: ${usd(START_USD)}. SPY באותה תקופה: ${pct(spyRet)} (${usd(START_USD * (1 + spyRet))}).`, '',
  '| גרסה | מניות ביום | החלקה לצד | סוף | תשואה | עמלות IBKR + רגולטור | עלות החלקה | עסקאות | ימים רווחיים | יום גרוע / טוב | ירידה מקס׳ |', '|---|---|---|---|---|---|---|---|---|---|---|'];
const res = {};
for (const mode of ['A', 'B']) for (const N of [5, 10]) for (const slip of [0.0005, 0.0015]){
  const r = sim(data, days, N, mode, slip); res[`${mode}${N}${slip}`] = r;
  L.push(`| ${mode === 'A' ? 'A: קנייה בסגירה, מכירה בסגירה למחרת' : 'B: קנייה בפתיחה למחרת, מכירה בסגירה'} | ${N} | ${(slip * 100).toFixed(2)}% | **${usd(r.eq)}** | ${pct(r.eq / START_USD - 1)} | ${usd(r.fees)} | ${usd(r.slipUsd)} | ${r.trades} | ${r.wins}/${r.n} | ${pct(r.worst)} / ${pct(r.best)} | ${pct(-r.dd)} |`);
  const g = sim(data, days, N, mode, 0); if (slip === 0.0005) L.push(`| ↳ אותה גרסה לפני עמלות והחלקה (בקירוב) | ${N} | 0 | ${usd(g.eq + g.fees)} | | | | | | | |`);
}
// סטופ 500$: נרות שעה רק למניות שנבחרו באחת הגרסאות
const picked = new Set(); for (const r of Object.values(res)) for (const x of r.log) for (const p of x.picks) picked.add(p.split(' ')[0]);
const H = {}, hq = process.argv.includes('--no-hourly') ? [] : [...picked]; log(`hourly for ${hq.length} symbols`);
await Promise.all(Array.from({ length: 4 }, async () => { for (let s_; (s_ = hq.shift());){ const h = await hourly(s_); if (h) H[s_] = h; await sleep(150); } }));
L.push('', '## עם סטופ של 500$ לכל מניה (מוכרים כשהרווח או ההפסד בפוזיציה מגיע ל-500$; אחרת בסגירה)');
L.push(`נרות שעה נטענו ל-${Object.keys(H).length}/${picked.size} מניות. 5 מניות = כ-10,000$ למניה (500$ = 5%); 10 מניות = כ-5,000$ למניה (500$ = 10%).`);
L.push('| גרסה | מניות ביום | החלקה לצד | סוף | תשואה | עמלות | יצאו ברווח 500$ | יצאו בהפסד 500$ | בלי נתון שעתי | ירידה מקס׳ | בלי סטופ (להשוואה) |', '|---|---|---|---|---|---|---|---|---|---|---|');
for (const mode of ['A', 'B']) for (const N of [5, 10]) for (const slip of [0.0005, 0.0015]){
  const r = sim(data, days, N, mode, slip, 500, H), b = res[`${mode}${N}${slip}`];
  L.push(`| ${mode === 'A' ? 'A: סגירה → סגירה למחרת' : 'B: פתיחה → סגירה'} | ${N} | ${(slip * 100).toFixed(2)}% | **${usd(r.eq)}** | ${pct(r.eq / START_USD - 1)} | ${usd(r.fees)} | ${r.hitTp} | ${r.hitSl} | ${r.noData} | ${pct(-r.dd)} | ${usd(b.eq)} |`);
}
L.push('', '## עם סטופ של 500$ על כל התיק ביום (כשהרווח או ההפסד של כל המניות ביחד מגיע ל-500$ מוכרים הכול; אחרת בסגירה)');
L.push('נמדד בסגירת כל נר שעה (ובפתיחה בגרסה A). 500$ = 1% מ-50,000$.');
L.push('| גרסה | מניות ביום | החלקה לצד | סוף | תשואה | עמלות | ימים שנסגרו ברווח 500$ | ימים שנסגרו בהפסד 500$ | ימים רווחיים | ירידה מקס׳ | בלי סטופ (להשוואה) |', '|---|---|---|---|---|---|---|---|---|---|---|');
for (const mode of ['A', 'B']) for (const N of [5, 10]) for (const slip of [0.0005, 0.0015]){
  const r = simPort(data, days, N, mode, slip, 500, H), b = res[`${mode}${N}${slip}`];
  L.push(`| ${mode === 'A' ? 'A: סגירה → סגירה למחרת' : 'B: פתיחה → סגירה'} | ${N} | ${(slip * 100).toFixed(2)}% | **${usd(r.eq)}** | ${pct(r.eq / START_USD - 1)} | ${usd(r.fees)} | ${r.hitTp} | ${r.hitSl} | ${r.wins}/${r.n} | ${pct(-r.dd)} | ${usd(b.eq)} |`);
}
L.push('', '## לפי חודש (גרסה A, 10 מניות, החלקה 0.05%)');
const r10 = res['A100.0005'], byM = {}; let prev = START_USD;
for (const x of r10.log){ const m = x.d.slice(0, 7); byM[m] ||= { start: prev }; byM[m].end = x.eq; prev = x.eq; }
for (const [m, v] of Object.entries(byM)) L.push(`- ${m}: ${usd(v.start)} → ${usd(v.end)} (${pct(v.end / v.start - 1)})`);
L.push('', '## 10 הימים האחרונים (גרסה A, 5 מניות)');
for (const x of res['A50.0005'].log.slice(-10)) L.push(`- ${x.d}: ${pct(x.r)} → ${usd(x.eq)} · ${x.picks.join(', ')}`);
const md = L.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md);
