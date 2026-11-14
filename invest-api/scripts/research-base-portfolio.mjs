#!/usr/bin/env node
// תיק בסיס (בקשת מאיר 14/11/2026, אחרי כיוון 2): 70% ביטקוין / 30% אתריום, עם כלל סיכון יחיד — לכל מטבע בנפרד: סגירה מעל ממוצע
// 200 ימים מחזיקים, מתחת — מזומן; חזרה מעל → קונים בפתיחה שאחרי. ספוט, בלי מינוף, בלי שורט, בלי מס. איזון ל-70/30 בתחילת כל חודש.
// השוואה: 70/30 פסיבי, ביטקוין פסיבי, ביטקוין עם ממוצע 200; עמידות: ממוצע 150 ו-250 (בלי בחירה בדיעבד). קריטריון שנקבע מראש: PASS.
// שימוש: node invest-api/scripts/research-base-portfolio.mjs --data xsra-data.json.gz [--out r.md] [--json r.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { align, runDaily, dstats, DCOST } from '../engine/research-daily.js';
import { smaFilter, combine5050, longestRecovery } from '../engine/trend-btceth.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'xsra-data.json.gz'), OUT = arg('--out', ''), JOUT = arg('--json', '');
const DAY = 86400e3, COINS = ['BTC', 'ETH'], WARM = 250, WB = 0.7, NS = [150, 200, 250], log = (...a) => console.error(...a);
const PASS = Object.freeze({ ddGain: 0.10, windows: ['val', 'test', 's22'] }); // נקבע מראש (14/11/2026)
const d0 = JSON.parse(gunzipSync(readFileSync(DATA)));
for (const c of COINS) for (const b of d0.bars[c]){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }
const AC = Object.fromEntries(COINS.map((c) => [c, align({ [c]: d0.bars[c] })]));
const first = Math.max(...COINS.map((c) => AC[c].days[0])), START = first + WARM * DAY, LAST = Math.max(...COINS.map((c) => AC[c].days.at(-1))) + DAY;
const W = { train: { from: START, to: Date.UTC(2022, 10, 18) }, val: { from: Date.UTC(2022, 10, 18), to: Date.UTC(2024, 10, 12) }, test: { from: Date.UTC(2024, 10, 12), to: LAST }, s22: { from: Date.UTC(2022, 0, 1), to: LAST }, all: { from: START, to: LAST } };
const WN = { train: 'אימון', val: 'אימות 2022–2024', test: 'מבחן 2024–2026', s22: 'מ-2022', all: 'הכול' };
const iso = (t) => new Date(t).toISOString().slice(0, 10), yr = (t) => new Date(t).getUTCFullYear();
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
const f2 = (x) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '' : '−') + Math.abs(x).toFixed(2));
const BPS = DCOST.spotBps + DCOST.slipBps.BTC, cut = (sr) => sr.filter((x) => x.t >= START);
const leg = (c, s, costMult = 1) => cut(runDaily(AC[c], s, { drift: true, costMult }).series);
const hold = { id: 'HOLD', weights: () => [1] };
const nTrades = (sr, w) => { let n = 0, prev = 0; for (const x of sr){ if (x.t < w.from || x.t >= w.to){ prev = x.exp; continue; } if (x.exp > 0 && !(prev > 0)) n++; prev = x.exp; } return n; };
function metrics(sr, legs){
  const o = {}; for (const [k, w] of Object.entries(W)){ const s = dstats(sr, w), tr = legs.reduce((a, l) => a + nTrades(l, w), 0);
    o[k] = { cagr: s.cagr, maxDD: s.maxDD, calmar: s.maxDD > 0 ? Math.round(s.cagr / s.maxDD * 100) / 100 : null, sharpe: s.sharpe, ci: s.ci, exposure: s.exposure, costTotal: s.costTotal, years: s.years, tradesYr: s.years ? Math.round(tr / s.years * 10) / 10 : null, rec: longestRecovery(sr, w) }; }
  const m = new Map(); for (const x of sr){ const y = yr(x.t); m.set(y, (m.get(y) ?? 1) * (1 + x.net)); } o.yearly = Object.fromEntries([...m].map(([y, e]) => [y, Math.round((e - 1) * 1000) / 1000]));
  return o;
}
const V = {}, mk = (key, name, b, e, costMult = 1) => { const lb = b === 'HOLD' ? leg('BTC', hold, costMult) : leg('BTC', smaFilter({ n: b }), costMult);
  if (!e) { V[key] = { name, m: metrics(lb, [lb]) }; return; }
  const le = e === 'HOLD' ? leg('ETH', hold, costMult) : leg('ETH', smaFilter({ n: e }), costMult); const c = combine5050(lb, le, { bps: BPS * costMult, wa: WB }); V[key] = { name, m: metrics(c, [lb, le]) }; };
mk('P70', '70/30 פסיבי', 'HOLD', 'HOLD');
for (const n of NS) mk(`F70-${n}`, `70/30 עם ממוצע ${n}`, n, n);
mk('BTC', 'ביטקוין פסיבי', 'HOLD', null);
for (const n of NS) mk(`BTC-${n}`, `ביטקוין עם ממוצע ${n}`, n, null);
mk('F70-200x2', '70/30 עם ממוצע 200, עלויות כפולות', 200, 200, 2);
// הקריטריון: 70/30 עם ממוצע n מול 70/30 פסיבי, בכל אחד מהחלונות: יחס תשואה לירידה (קלמר) גבוה יותר וירידה מקסימלית נמוכה ב-10 נקודות לפחות
const passOf = (k) => Object.fromEntries(PASS.windows.map((w) => { const a = V[k].m[w], p = V.P70.m[w]; return [w, { calmar: a.calmar > p.calmar, dd: a.maxDD <= p.maxDD - PASS.ddGain }]; }));
const PS = Object.fromEntries(NS.map((n) => [n, passOf(`F70-${n}`)])), ok = (n) => Object.values(PS[n]).every((x) => x.calmar && x.dd);
const VERDICT = { primary: ok(200), robust: NS.every(ok) };
log(`70/30+200: ${VERDICT.primary ? 'עובר' : 'לא עובר'} · עמידות: ${VERDICT.robust ? 'כן' : 'לא'}`);
const L = [], yn = (b) => (b ? '✅' : '❌');
L.push('# תיק בסיס — 70% ביטקוין / 30% אתריום עם כלל ממוצע 200 ימים, מול החזקה פסיבית (מחקר 7כג)', '',
  `נתונים: נרות יומיים של Coinbase, מ-${iso(START)} (250 ימי חימום) עד ${iso(LAST - DAY)}. תקופות כמו במחקר 7כא. עלויות: עמלה 0.1% + החלקה 0.02% לכל צד, כולל האיזון החודשי. בלי מס.`, '',
  `**הכלל:** לכל מטבע בנפרד — סגירה מעל ממוצע n ימים: מחזיקים את ההקצאה שלו; מתחת: מזומן; ביצוע בפתיחה שאחרי. איזון ל-70/30 בתחילת כל חודש.`, '',
  `**קריטריון שנקבע מראש:** 70/30 עם ממוצע 200 מול 70/30 פסיבי — בכל אחד מהחלונות (אימות, מבחן, מ-2022): יחס תשואה לירידה גבוה יותר, וירידה מקסימלית נמוכה ב-${PASS.ddGain * 100} נקודות לפחות. עמידות: אותו דבר עם ממוצע 150 ו-250.`, '',
  `**תוצאה:** ממוצע 200 — ${VERDICT.primary ? '**עובר**' : '**לא עובר**'} · עמידות (150, 200, 250) — ${VERDICT.robust ? '**כן**' : '**לא**'}`, '');
for (const w of ['val', 'test', 's22', 'train', 'all']){
  L.push(`## ${WN[w]}`, '', '| | תשואה שנתית | ירידה מקס׳ | תשואה ÷ ירידה | שארפ | זמן בשוק | עסקאות בשנה | עלות כוללת | התאוששות ארוכה (ימים) |', '|---|---|---|---|---|---|---|---|---|');
  for (const v of Object.values(V)){ const m = v.m[w]; L.push(`| ${v.name} | ${pct(m.cagr)} | ${pct(-m.maxDD)} | ${f2(m.calmar)} | ${f2(m.sharpe)} | ${Math.round(m.exposure * 100)}% | ${m.tradesYr} | ${pct(m.costTotal)} | ${m.rec} |`); }
  L.push('');
}
L.push('## הקריטריון בפירוט', '', '| ממוצע | חלון | תשואה ÷ ירידה גבוהה יותר | ירידה נמוכה ב-10 נק׳ |', '|---|---|---|---|');
for (const n of NS) for (const w of PASS.windows) L.push(`| ${n} | ${WN[w]} | ${yn(PS[n][w].calmar)} (${f2(V[`F70-${n}`].m[w].calmar)} מול ${f2(V.P70.m[w].calmar)}) | ${yn(PS[n][w].dd)} (${pct(-V[`F70-${n}`].m[w].maxDD)} מול ${pct(-V.P70.m[w].maxDD)}) |`);
const ys = Object.keys(V.P70.m.yearly).sort();
L.push('', '## תשואה לפי שנה', '', `| | ${ys.join(' | ')} |`, `|---|${ys.map(() => '---').join('|')}|`);
for (const v of Object.values(V)) L.push(`| ${v.name} | ${ys.map((y) => pct(v.m.yearly[y])).join(' | ')} |`);
L.push('', `(${ys[0]} חלקית — מ-${iso(START)}.)`, '');
const md = L.join('\n') + '\n';
if (OUT) writeFileSync(OUT, md); else process.stdout.write(md);
if (JOUT) writeFileSync(JOUT, JSON.stringify({ meta: { start: iso(START), last: iso(LAST - DAY), pass: PASS }, variants: V, criterion: PS, verdict: VERDICT }, null, 1));
