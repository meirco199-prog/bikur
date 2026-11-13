#!/usr/bin/env node
// מחקר: "קונים כל יום את המניות שירדו הכי הרבה ב-3 הימים האחרונים" (בקשת מאיר, 13/11/2026). מחקר בלבד — אין כסף, אין פקודות.
// השאלה: 50,000$ מחולקים שווה בשווה ל-5 המניות שירדו הכי הרבה ב-3 ימים. קונים בפתיחה, מחזיקים עד הפתיחה של מחר, ואז מחליפים
//   ל-5 החדשות. כל יום. וגם: קנייה רגע לפני הסגירה עד לפני הסגירה של מחר; 1/3/5/10 מניות; גרסאות נוספות. שנה, 2, 3, 4 ו-5 שנים,
//   כל שנה בנפרד וסה״כ — כמה נשאר מ-50,000$.
//
// נתונים: אותו מקור כמו research-xsec/bracket2 — Yahoo Finance יומי (מתואם לפיצולים ודיבידנדים), הרכב S&P 500 היסטורי.
//   רק מניות שהיו ב-S&P 500 באותו יום, עם מחזור ממוצע ≥ 100 מיליון דולר ביום (20 הימים שלפני) — כמו הסריקה שנתתי למאיר.
//   ⚠️ הטיית שורדים: מניות שנמחקו (פשיטת רגל, מיזוג) ואין להן מחירים ב-Yahoo — חסרות. בשיטה שקונה את היורדות זה מייפה את התוצאה.
// ביצוע:
//   open  — הדירוג לפי 3 הימים שנסגרו (סגירה של אתמול מול סגירה לפני 4 ימים); קנייה בפתיחה, מכירה בפתיחה של מחר.
//   close — הדירוג לפי 3 הימים כולל היום, במחיר הסגירה (קירוב ל"קצת לפני הסגירה"); קנייה בסגירה, מכירה בסגירה של מחר.
//   כל יום הסל מתחלק שווה בשווה; מניה שנשארת בסל — לא נמכרת ונקנית מחדש (בלי עלות). ריבית דריבית: מה שנשאר מושקע מחדש.
// עלויות: חצי מרווח (לפי מחזור, כמו research-xsec) + עמלה 0.01% בכל קנייה ובכל מכירה. רגישות: עלויות כפולות.
// הכרעה (נקבעה מראש, לפני הריצה): גרסה "שווה דמו" רק אם על 5 השנים — (1) גמרה מעל קניית מדד S&P 500 (SPY) והחזקה, (2) רווח יומי
//   ממוצע חיובי עם t ≥ 2 גם בחצי הראשון וגם בשני, (3) חיובית ב-4 שנים קלנדריות לפחות מתוך 6, (4) עדיין רווחית עם עלויות כפולות.
// גרסה נוספת (בקשת מאיר, אותו יום): רק מניות שביום השלישי ירדו יותר מבכל אחד משני הימים הקודמים ("הירידה מאיצה").
//   נבדקות ~20 גרסאות — גרסה אחת שעוברת בקושי יכולה להיות מקרה.
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const START = 50000, MIN_ADV = 1e8, YEARS = 5, FEE = 1e-4;
export const VARIANTS = [
  ...['open', 'close'].flatMap((mode) => [1, 3, 5, 10].map((N) => ({ k: `${mode}-L3-${N}`, mode, N, look: 3, side: 'down', main: true }))),
  ...['open', 'close'].flatMap((mode) => [
    { k: `${mode}-L1-5`, mode, N: 5, look: 1, side: 'down' },
    { k: `${mode}-L5-5`, mode, N: 5, look: 5, side: 'down' },
    { k: `${mode}-U3-5`, mode, N: 5, look: 3, side: 'up' },
    { k: `${mode}-L3-5-trend`, mode, N: 5, look: 3, side: 'down', trend: true },
    { k: `${mode}-L3-5-accel`, mode, N: 5, look: 3, side: 'down', accel: true },
    { k: `${mode}-L3-3-accel`, mode, N: 3, look: 3, side: 'down', accel: true },
  ]),
];
const MODE_HE = { open: 'פתיחה→פתיחה', close: 'סגירה→סגירה' };
export const variantHe = (v) => `${MODE_HE[v.mode]} · ${v.N} ${v.N === 1 ? 'מניה' : 'מניות'} ש${v.side === 'up' ? 'עלו' : 'ירדו'} הכי הרבה ב-${v.look === 1 ? 'יום אחד' : `${v.look} ימים`}${v.trend ? ' · רק כשהמדד מעל ממוצע 200 יום' : ''}${v.accel ? ' · רק אם ביום השלישי ירדה יותר מבכל אחד מהימים הקודמים' : ''}`;
// "הירידה מאיצה": שלושת הימים האחרונים d1 (הישן), d2, d3 (האחרון) — d3 שלילי וגדול בירידה מ-d1 ומ-d2. c = [סגירה לפני 3, לפני 2, לפני 1, אחרונה]
export function accelerating(c){
  if (!c.every((x) => x > 0)) return false;
  const d1 = c[1] / c[0] - 1, d2 = c[2] / c[1] - 1, d3 = c[3] / c[2] - 1;
  return d3 < 0 && d3 < d1 && d3 < d2;
}

// בחירת הסל: cands = [{ s, sig, ret, c }] (sig = תשואת התקופה, ret = תשואת ההחזקה, c = עלות צד אחד). מחזיר N מניות
export function pickBasket(cands, N, side = 'down'){
  return [...cands].sort((a, b) => (side === 'down' ? a.sig - b.sig : b.sig - a.sig) || (a.s < b.s ? -1 : 1)).slice(0, N);
}
// יום אחד: רווח הסל אחרי עלויות. prev = Map(מניה → עלות צד אחד) של הסל של אתמול (מה שיוצא נמכר, מה שנכנס נקנה)
export function dayReturn(basket, prev, costMul = 1){
  const N = basket.length;
  if (!N){ let cost = 0; for (const [, c] of prev) cost += c / (prev.size || 1); return { r: cost ? -costMul * cost : 0, held: new Map() }; } // אין סל → מוכרים את של אתמול, מזומן
  const held = new Map(basket.map((x) => [x.s, x.c]));
  let gross = 0, cost = 0;
  for (const x of basket){ gross += x.ret / N; if (!prev.has(x.s)) cost += x.c / N; }
  for (const [s, c] of prev) if (!held.has(s)) cost += c / (prev.size || 1);
  return { r: gross - costMul * cost, held };
}
// סטטיסטיקה על מערך רווחים יומיים: סכום סופי מ-START, אחוז, ירידה מקסימלית, ימים מרוויחים, t
export function grow(rs, start = START){
  let v = start, peak = start, dd = 0, win = 0, n = 0, s = 0, s2 = 0;
  for (const r of rs){ if (!Number.isFinite(r)) continue; v *= 1 + r; peak = Math.max(peak, v); dd = Math.max(dd, 1 - v / peak); n++; s += r; s2 += r * r; if (r > 0) win++; }
  const m = n ? s / n : NaN, sd = n > 1 ? Math.sqrt((s2 - n * m * m) / (n - 1)) : NaN;
  return { end: v, pnl: v - start, pct: v / start - 1, dd, win: n ? win / n : NaN, n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : NaN };
}

async function main(){
  const { universes, daily, build, dayIso, inIv, halfSpread } = await import('./research-xsec.mjs');
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUTDIR = arg('--outdir', 'reversal3-out'), log = (...a) => console.error(...a), t0 = Date.now();
  mkdirSync(OUTDIR, { recursive: true });
  const U = await universes();
  const since = new Date(Date.now() - (YEARS * 365.25 + 400) * 86400e3).toISOString().slice(0, 10);
  const hist = Object.entries(U.iv500).filter(([, ivs]) => ivs.some(([, b]) => b === null || b >= since)).map(([s]) => s).filter((s) => /^[A-Z]{1,5}(-[A-Z]{1,2})?$/.test(s));
  const syms = [...new Set(['SPY', ...U.sp500, ...hist])];
  log(`fetching ${syms.length} symbols`); let raw = {}; const q = [...syms];
  await Promise.all(Array.from({ length: 8 }, async () => { for (let s; (s = q.shift());){ const b = await daily(s); if (b) raw[s] = b; await new Promise((r) => setTimeout(r, 60)); } }));
  if (!raw.SPY) throw new Error('אין נתוני SPY');
  const calT = raw.SPY.t, cal = Array.from(calT, dayIso), L = cal.length, S = build(raw, calT); raw = null;
  const start = new Date(Date.now() - YEARS * 365.25 * 86400e3).toISOString().slice(0, 10);
  const k0 = cal.findIndex((d) => d >= start), kMid = k0 + Math.floor((L - k0) / 2);
  const stocks = Object.keys(S).filter((s) => s !== 'SPY');
  log(`loaded ${stocks.length} · ${cal[k0]} → ${cal.at(-1)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  // מחזור ממוצע 20 יום עד אתמול
  const ADV = {};
  for (const s of stocks){ const X = S[s], a = new Float32Array(L).fill(NaN); for (let k = Math.max(21, k0 - 1); k < L; k++){ let t = 0, n = 0; for (let j = k - 20; j < k; j++) if (X.DV[j] >= 0){ t += X.DV[j]; n++; } if (n >= 15) a[k] = t / n; } ADV[s] = a; }
  const spy = S.SPY, ma200 = new Float64Array(L).fill(NaN);
  for (let k = 200; k < L; k++){ let t = 0; for (let j = k - 200; j < k; j++) t += spy.C[j]; ma200[k] = t / 200; }
  // R[v.k][k] = רווח נטו ביום k (open: פתיחה k → פתיחה k+1; close: סגירה k → סגירה k+1). R2 = עם עלויות כפולות
  const R = {}, R2 = {}, PICKS = {};
  for (const v of VARIANTS){
    const r = new Float64Array(L).fill(NaN), r2 = new Float64Array(L).fill(NaN); let prev = new Map(), prev2 = new Map(); const picks = [];
    for (let k = k0; k < L - 1; k++){
      const sk = v.mode === 'open' ? k - 1 : k; // היום האחרון שידוע בזמן הקנייה
      let basket = [];
      if (!v.trend || spy.C[sk] > ma200[sk]){
        const cands = [];
        for (const s of stocks){
          const X = S[s];
          if (!inIv(U.iv500[s], cal[k]) || !(ADV[s][k] >= MIN_ADV)) continue;
          const a = X.C[sk - v.look], b = X.C[sk], e0 = v.mode === 'open' ? X.O[k] : X.C[k], e1 = v.mode === 'open' ? X.O[k + 1] : X.C[k + 1];
          if (!(a > 0 && b > 0 && e0 > 0 && e1 > 0)) continue;
          if (v.accel && !accelerating([X.C[sk - 3], X.C[sk - 2], X.C[sk - 1], X.C[sk]])) continue;
          cands.push({ s, sig: b / a - 1, ret: e1 / e0 - 1, c: halfSpread(ADV[s][k]) + FEE });
        }
        if (cands.length >= (v.accel ? 5 : 50)) basket = pickBasket(cands, v.N, v.side);
      }
      const d = dayReturn(basket, prev, 1), d2 = dayReturn(basket, prev2, 2);
      r[k] = d.r; r2[k] = d2.r; prev = d.held; prev2 = d2.held;
      if (k >= L - 6) picks.push(`${cal[k]}: ${basket.map((x) => `${x.s} ${(x.sig * 100).toFixed(1)}%`).join(', ') || '—'}`);
    }
    R[v.k] = r; R2[v.k] = r2; PICKS[v.k] = picks;
  }
  // מדד: SPY סגירה→סגירה (קנייה והחזקה)
  const spyR = new Float64Array(L).fill(NaN); for (let k = k0; k < L - 1; k++) spyR[k] = spy.C[k + 1] / spy.C[k] - 1;
  log(`simulated ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const sl = (arr, a, z) => Array.from(arr.slice(a, z));
  const f$ = (x) => (Number.isFinite(x) ? '$' + Math.round(x).toLocaleString('en-US') : '—'), fs$ = (x) => (Number.isFinite(x) ? (x < 0 ? '−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US') : '—');
  const fp = (x, d = 1) => (Number.isFinite(x) ? `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%` : '—'), ft = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
  const kAgo = (y) => { const d = new Date(Date.parse(cal.at(-1)) - y * 365.25 * 86400e3).toISOString().slice(0, 10); return Math.max(k0, cal.findIndex((x) => x >= d)); };
  const years = [...new Set(cal.slice(k0, L - 1).map((d) => d.slice(0, 4)))];
  const yIdx = (y) => { const a = cal.findIndex((d, k) => k >= k0 && d.startsWith(y)); let z = a; while (z < L - 1 && cal[z].startsWith(y)) z++; return [a, z]; };
  const ROWS = [...VARIANTS.map((v) => ({ k: v.k, he: variantHe(v), r: R[v.k], v })), { k: 'SPY', he: 'השוואה: קונים את מדד S&P 500 (SPY) ומחזיקים', r: spyR }];

  const md = [`# "5 המניות שירדו הכי הרבה ב-3 ימים" — כל יום מחדש, 50,000$ (${cal[k0]} → ${cal.at(-1)})`, '',
    'בקשת מאיר (13/11/2026): לשים 50,000$ שווה בשווה על 5 המניות שירדו הכי הרבה ב-3 הימים האחרונים, לקנות בפתיחה ולמכור בפתיחה של מחר, ולהחליף כל יום. גם: קנייה לפני הסגירה; 1/3/5/10 מניות; שנה עד 5 שנים.', '',
    `- **מניות:** S&P 500 של אותו יום, מחזור ממוצע ≥ 100 מיליון דולר ביום (~${Math.round(stocks.length / 10) * 10} סמלים נבדקו). **עלויות:** מרווח + עמלה בכל קנייה ומכירה; מניה שנשארת בסל — בלי עלות.`,
    '- **פתיחה→פתיחה:** הדירוג לפי 3 הימים שנסגרו, קנייה בפתיחה, מכירה בפתיחה של מחר. **סגירה→סגירה:** הדירוג כולל היום (במחיר הסגירה — קירוב ל"רגע לפני הסגירה"), קנייה בסגירה, מכירה בסגירה של מחר.',
    '- **ימים בלי סל:** נסחר רק אם היו לפחות 50 מועמדים (בגרסת "הירידה מאיצה" — 5); אחרת, וגם כשמסנן המגמה סוגר — מוכרים את הסל של אתמול (בעלות) ונשארים במזומן.',
    '- **משקלות:** הרווח היומי מחושב כממוצע שווה של המניות בסל (קירוב: כאילו הסל מאוזן מחדש כל יום בלי עלות; מניה שנשארת בסל לא נמכרת ונקנית מחדש).',
    '- **"הירידה מאיצה":** הירידה של היום השלישי גדולה מהשינוי בכל אחד משני הימים הקודמים (הם יכולים להיות גם עלייה), ובתוך 5 היורדות הכי הרבה ב-3 ימים.',
    '- **ריבית דריבית:** כל הכסף מושקע מחדש כל יום. ⚠️ **הטיית שורדים:** מניות שנמחקו מהבורסה חסרות — בשיטה שקונה את היורדות זה מייפה את התוצאה.',
    `- **הכרעה שנקבעה מראש:** "שווה דמו" רק אם על 5 שנים גמרה מעל המדד, רווח יומי חיובי עם t ≥ 2 בשני החצאים (${cal[k0]} → ${cal[kMid - 1]} · ${cal[kMid]} → ${cal.at(-1)}), חיובית ב-4 שנים לפחות, ורווחית גם עם עלויות כפולות.`, ''];
  // 1. כל התקופה
  md.push('## 1. חמש שנים — כמה נשאר מ-50,000$', '', '| גרסה | נשאר | רווח / הפסד | % | ירידה מקס׳ מהשיא | ימים ברווח | t | עלויות כפולות → נשאר | עוברת? |', '|---|---|---|---|---|---|---|---|---|');
  const spyAll = grow(sl(spyR, k0, L - 1)), verdict = {};
  for (const x of ROWS){
    const g = grow(sl(x.r, k0, L - 1)), h1 = grow(sl(x.r, k0, kMid)), h2 = grow(sl(x.r, kMid, L - 1)), g2 = x.v ? grow(sl(R2[x.k], k0, L - 1)) : null;
    const posYears = years.filter((y) => { const [a, z] = yIdx(y); return grow(sl(x.r, a, z)).pct > 0; }).length;
    const pass = x.v ? g.end > spyAll.end && h1.mean > 0 && h1.t >= 2 && h2.mean > 0 && h2.t >= 2 && posYears >= 4 && g2.pct > 0 : null;
    if (x.v) verdict[x.k] = { pass, end: g.end, pct: g.pct, t: g.t, h1: h1.t, h2: h2.t, posYears, end2x: g2.end };
    md.push(`| ${x.v?.main && x.v.N === 5 ? `**${x.he}**` : x.he} | ${f$(g.end)} | ${fs$(g.pnl)} | ${fp(g.pct)} | ${fp(-g.dd)} | ${Math.round(g.win * 100)}% | ${ft(g.t)} | ${g2 ? f$(g2.end) : '—'} | ${pass == null ? '—' : pass ? '✅' : '❌'} |`);
  }
  // 2. שנה אחרונה, שנתיים... חמש
  md.push('', '## 2. כמה נשאר מ-50,000$ — לפי אורך התקופה (עד היום)', '', '| גרסה | שנה | שנתיים | 3 שנים | 4 שנים | 5 שנים |', '|---|---|---|---|---|---|');
  for (const x of ROWS) md.push(`| ${x.he} | ${[1, 2, 3, 4, 5].map((y) => { const g = grow(sl(x.r, kAgo(y), L - 1)); return `${f$(g.end)} (${fp(g.pct, 0)})`; }).join(' | ')} |`);
  // 3. כל שנה בנפרד: מתחילים כל שנה עם 50,000$
  md.push('', '## 3. כל שנה בנפרד — מתחילים את השנה עם 50,000$, רווח / הפסד בסוף השנה', '', `| גרסה | ${years.map((y) => (y === years[0] ? `${y} (מ-${cal[k0].slice(5)})` : y === years.at(-1) ? `${y} (עד ${cal.at(-1).slice(5)})` : y)).join(' | ')} | סה״כ 5 שנים |`, `|---|${years.map(() => '---').join('|')}|---|`);
  for (const x of ROWS) md.push(`| ${x.he} | ${years.map((y) => { const [a, z] = yIdx(y), g = grow(sl(x.r, a, z)); return `${fs$(g.pnl)} (${fp(g.pct, 0)})`; }).join(' | ')} | ${fs$(grow(sl(x.r, k0, L - 1)).pnl)} |`);
  // 4. מה הסל בחר בימים האחרונים (לבדיקת שפיות)
  md.push('', '## 4. מה נבחר בימים האחרונים (5 מניות, פתיחה→פתיחה)', '', ...PICKS['open-L3-5'].map((p) => `- ${p}`));
  const passing = VARIANTS.filter((v) => verdict[v.k].pass), main5 = verdict['open-L3-5'], close5 = verdict['close-L3-5'];
  md.push('', '## 5. מסקנה', '',
    `- **מה שמאיר שאל (5 מניות, פתיחה→פתיחה):** 50,000$ → ${f$(main5.end)} (${fp(main5.pct)}) ב-5 שנים; המדד: ${f$(spyAll.end)} (${fp(spyAll.pct)}). עם עלויות כפולות: ${f$(main5.end2x)}.`,
    `- **לפני הסגירה (5 מניות, סגירה→סגירה):** ${f$(close5.end)} (${fp(close5.pct)}).`,
    passing.length ? `- **עוברות את ההכרעה שנקבעה מראש:** ${passing.map((v) => variantHe(v)).join(' · ')}. נבדקו ${VARIANTS.length} גרסאות — לפני כסף אמיתי צריך גם דמו.` : `- **אף גרסה לא עוברת את ההכרעה שנקבעה מראש** (מתוך ${VARIANTS.length}).`);
  writeFileSync(`${OUTDIR}/report.md`, md.join('\n') + '\n');
  writeFileSync(`${OUTDIR}/meta.json`, JSON.stringify({ from: cal[k0], mid: cal[kMid], to: cal.at(-1), symbols: stocks.length, spy: spyAll, verdict }, null, 1));
  log(`done ${((Date.now() - t0) / 1000).toFixed(0)}s`); console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
