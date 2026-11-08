#!/usr/bin/env node
// "תנופת בוקר" — בדיקת מרווחים ועלויות על ההיסטוריה (בקשת מאיר, 8/11/2026): "אין צורך לעשות קדימה אם יש אחורה. תעשה בדיקה של מרווחים
// וכל מה שצריך". מחקר בלבד, בלי פקודות.
// אין היסטוריית Bid/Ask חינמית (גם IBKR מחזיר רק מחירי עסקאות), ולכן המרווח של כל מניה בכל יום נאמד ממחירי השיא/שפל/סגירה של 21 הימים
// שלפניו (Abdi & Ranaldo 2017 — אומדן מקובל במחקר; נוטה להעריך ביתר במניות תנודתיות, כלומר שמרני). חצי מרווח = עלות צד אחד בפקודת שוק.
// הכלל: מבין המניות שעלו 3+ ימים ברצף — 3 שעלו הכי הרבה ב-3 הימים; קנייה בפתיחה, יציאה ב-11:30/12:30 או בסטופ ±250$/±500$ לכל התיק.
// מודלי עלות: קבוע 0.05%/0.15% (כמו קודם), MOO בכניסה (מחיר הפתיחה הרשמי — כמעט בלי החלקה) + חצי מרווח ביציאה, פקודות שוק בשני
// הצדדים, ושמרני (מרווח מלא בפתיחה — המרווחים הכי רחבים בפתיחה — ו-1.5 חצאי מרווח ביציאה). ובנוסף: רבעונים, הוצאת הימים הטובים, וגודל המניות.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadData, prepare, run, select, label, slips, START_USD } from './research-losers-grid.mjs';

const COSTS = [
  ['קבוע 0.05% לצד (ההנחה הקודמת)', { inFix: 0.0005, outFix: 0.0005 }],
  ['קבוע 0.15% לצד', { inFix: 0.0015, outFix: 0.0015 }],
  ['MOO בכניסה (0.01%) + חצי מרווח ביציאה', { inFix: 0.0001, outK: 1 }],
  ['פקודות שוק: חצי מרווח בכל צד', { inK: 1, outK: 1 }],
  ['שמרני: מרווח מלא בפתיחה + 1.5 חצאי מרווח ביציאה', { inK: 2, outK: 1.5 }],
  ['שמרני מאוד: מרווח מלא בשני הצדדים', { inK: 2, outK: 2 }],
];
const BASE = { side: 'L', sel: 'hi', key: 'r3', N: 3, filt: 'up3', entry: 'O', hold: 1 };
const EXITS = [['מכירה ב-11:30', { exit: 'hour', hr: 11.5 }], ['מכירה ב-12:30', { exit: 'hour', hr: 12.5 }],
  ['סטופ תיק ±250$', { exit: 'close', port: { tpUsd: 250, slUsd: 250 } }], ['סטופ תיק ±500$', { exit: 'close', port: { tpUsd: 500, slUsd: 500 } }],
  ['מכירה בסגירה (להשוואה)', { exit: 'close' }]];

// הרצה עם רישום תשואה יומית (cfg.trace) — אותה ריצה בדיוק כמו run, כדי לבדוק רבעונים ותלות בימים בודדים
function trace(P, cfg, k0, k1){ const c = { ...cfg, trace: [] }, r = run(P, c, k0, k1); return { rets: c.trace, end: r.end }; }
const pctl = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : NaN; };

async function main(){
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUT = arg('--out', ''), CACHE = arg('--cache', '');
  const { D, Hr } = await loadData({ cache: CACHE, range: '3y' });
  const P = prepare(D, Hr), L = P.L, days = P.days;
  const W = { y2: [L - 1 - 504, L - 1], m6: [L - 1 - 126, L - 1] };
  const usd = (x) => `${Math.round(x).toLocaleString('en-US')}$`, pct = (x, d = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%`;
  const pl = (x) => `${x >= 0 ? 'רווח' : 'הפסד'} ${usd(Math.abs(x))}`, bp = (x) => `${(x * 1e4).toFixed(1)}bp`;
  const out = [`# תנופת בוקר — בדיקת מרווחים ועלויות (${days[W.y2[0]]} → ${days.at(-1)})`, '',
    '- הכלל: מבין מניות S&P 1500 (מחיר > 5$, מחזור > 20M$) שעלו 3+ ימים ברצף — 3 שעלו הכי הרבה ב-3 הימים. קנייה בפתיחה ביום הרביעי בשלישים מ-50,000$, יציאה לפי העמודה.',
    '- מרווח (Bid/Ask) משוער לכל מניה בכל יום: Abdi & Ranaldo (2017) על 21 הימים שלפני. bp = 0.01%. 1bp על 16,700$ = 1.67$.', ''];

  // 1. אימות האומדן: המרווח המשוער לפי נזילות, ובמניות שהכלל בוחר
  const allHs = { big: [], mid: [], small: [] }, picks = [], pickPx = [];
  for (let k = W.y2[0]; k < W.y2[1]; k++){
    for (const x of P.cand[k]) if (x.hs != null) (x.adv >= 1e9 ? allHs.big : x.adv >= 1e8 ? allHs.mid : allHs.small).push(2 * x.hs);
    for (const x of select(P, { ...BASE, exit: 'close' }, k)){ if (x.hs != null) picks.push(2 * x.hs); pickPx.push(x.px); }
  }
  out.push('## 1. כמה רחב המרווח? (מרווח מלא משוער; עלות צד אחד בפקודת שוק = חצי מזה)', '| קבוצה | חציון | רבעון עליון (75%) | 90% |', '|---|---|---|---|',
    ...[['מחזור מעל 1B$ ביום (ענקיות)', allHs.big], ['מחזור 100M$–1B$', allHs.mid], ['מחזור 20M$–100M$', allHs.small], ['**המניות שהכלל בחר**', picks]]
      .map(([n, a]) => `| ${n} | ${bp(pctl(a, 0.5))} | ${bp(pctl(a, 0.75))} | ${bp(pctl(a, 0.9))} |`),
    '', `מחיר המניות שנבחרו: חציון ${pctl(pickPx, 0.5).toFixed(1)}$, ${(pickPx.filter((x) => x < 20).length / pickPx.length * 100).toFixed(0)}% מתחת ל-20$.`,
    'לשם השוואה (מקורות ציבוריים): במניות S&P 500 גדולות המרווח בפועל הוא בדרך כלל 1–5bp, במניות קטנות 10–30bp.', '');

  // 2. התוצאה לפי מודל עלות
  const hd = ['| מודל עלות | ' + EXITS.map(([n]) => n).join(' | ') + ' |', '|---|' + EXITS.map(() => '---').join('|') + '|'];
  for (const [wn, wl] of [['y2', 'שנתיים'], ['m6', 'חצי שנה']]){
    out.push(`## 2${wn === 'y2' ? 'א' : 'ב'}. ${wl}: 50,000$ → (3 מניות)`, ...hd);
    for (const [cn, cost] of COSTS) out.push(`| ${cn} | ${EXITS.map(([, e]) => { const r = run(P, { ...BASE, ...e, cost }, ...W[wn]); return `${usd(r.end)} (${pl(r.end - START_USD)})`; }).join(' | ')} |`);
    out.push('');
  }
  // עלות ממוצעת בפועל לפי המודל
  const avgCost = COSTS.map(([cn, cost]) => { let a = 0, m = 0; for (let k = W.y2[0]; k < W.y2[1]; k++) for (const x of select(P, { ...BASE, exit: 'close' }, k)){ const [si, so] = slips({ cost }, x); a += si + so; m += 1; } return `${cn}: ${bp(a / m)} הלוך-חזור`; });
  out.push('**עלות החלקה ממוצעת לעסקה (הלוך-חזור, בלי עמלה):** ' + avgCost.join(' · '), '');

  // 3. יציבות: רבעונים, והוצאת הימים הטובים — במודל "פקודות שוק" (חצי מרווח בכל צד) ובמודל השמרני
  for (const [cn, cost] of [COSTS[3], COSTS[4]]) for (const [en, e] of [EXITS[1], EXITS[2]]){
    const cfg = { ...BASE, ...e, cost }, t = trace(P, cfg, ...W.y2);
    const q = []; for (let s = 0; s < 8; s++){ const a = W.y2[0] + s * 63, b = Math.min(a + 63, W.y2[1]); const r = t.rets.filter((x) => x.k >= a && x.k < b).reduce((v, x) => v * (1 + x.r), 1) - 1; q.push(`${days[a].slice(2, 7)}: ${pct(r)}`); }
    const sorted = [...t.rets].sort((a, b) => b.r - a.r), drop = (n) => sorted.slice(n).reduce((v, x) => v * (1 + x.r), 1) * START_USD;
    out.push(`## 3. יציבות — ${en}, ${cn}`, `- שנתיים: ${usd(t.end)} (${pl(t.end - START_USD)}) · ימים ברווח: ${t.rets.filter((x) => x.r > 0).length}/${t.rets.filter((x) => x.r !== 0).length}`,
      `- לפי רבעון: ${q.join(' · ')}`, `- בלי 5 הימים הטובים: ${usd(drop(5))} · בלי 10 הטובים: ${usd(drop(10))} · בלי 20 הטובים: ${usd(drop(20))}`, '');
  }
  // 4. 5 מניות, ורק מניות במחיר מעל 20$ (מרווח קטן יותר)
  out.push('## 4. וריאציות (שנתיים, פקודות שוק — חצי מרווח בכל צד)', '| כלל | מכירה ב-12:30 | סטופ ±250$ |', '|---|---|---|');
  for (const v of [{ N: 5 }, { N: 10 }, { filt: 'up3+liq' }]) out.push(`| ${label({ ...BASE, ...v, exit: 'close' }).replace(' · כניסה בפתיחה למחרת · מכירה בסגירה', '')} | ${[EXITS[1], EXITS[2]].map(([, e]) => { const r = run(P, { ...BASE, ...v, ...e, cost: COSTS[3][1] }, ...W.y2); return `${usd(r.end)} (${pl(r.end - START_USD)})`; }).join(' | ')} |`);
  const md = out.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
