#!/usr/bin/env node
// ענף מחקר נפרד: Slow Core Momentum (אישור מאיר 14/11/2026). הכללים והקריטריון — engine/slow-core.js (נשמרו לפני ההרצה). מחקר בלבד;
// לא נוגע במעקב הווירטואלי של XSRA-7. הגרסה המציאותית: נכס נכנס רק מיום הרישום שלו ב-Bybit, עלות לפי ספר הפקודות (5,000$) — כמו XSRA-7.
// שימוש: node invest-api/scripts/research-slow-core.mjs --data xsra-data.json.gz --bybit invest/docs/research/xs-protect/bybit-probe.json [--out r.md] [--json r.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { align, runDaily, dstats, DCOST } from '../engine/research-daily.js';
import { simulate, VERSIONS } from '../engine/xsra-protect.js';
import { slowCore, holdFrom, isReb30, SLOW_CORE, SC_PASS } from '../engine/slow-core.js';
import { longestRecovery } from '../engine/trend-btceth.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'xsra-data.json.gz'), BYB = arg('--bybit', 'invest/docs/research/xs-protect/bybit-probe.json'), OUT = arg('--out', ''), JOUT = arg('--json', '');
const DAY = 86400e3, T21 = Date.UTC(2021, 0, 1), T22 = Date.UTC(2022, 0, 1), log = (...a) => console.error(...a);
const d0 = JSON.parse(gunzipSync(readFileSync(DATA))), byb = JSON.parse(readFileSync(BYB, 'utf8'));
for (const bars of Object.values(d0.bars)) for (const b of bars){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }
const listT = Object.fromEntries(Object.entries(byb.listing).map(([c, d]) => [c, Date.parse(d + 'T00:00:00Z')]));
const ALL = Object.fromEntries(Object.entries(d0.bars).filter(([c]) => byb.listing[c]));
const CUT = Object.fromEntries(Object.entries(ALL).map(([c, b]) => [c, b.filter((x) => x.t >= T21)]).filter(([, b]) => b.length));
const C5 = { ...DCOST, slipBps: Object.fromEntries(Object.keys(byb.listing).map((c) => { const m = byb.book[c]?.buy5k; return [c, Math.max(DCOST.slipBps[c] ?? DCOST.slipOther, m == null ? 300 : m)]; })) };
const A3 = align(Object.fromEntries(SLOW_CORE.coins.map((c) => [c, CUT[c]]))), allow3 = (k, t) => t >= (listT[A3.coins[k]] ?? Infinity);
const AC = align(CUT), allowC = (k, t) => t >= (listT[AC.coins[k]] ?? Infinity), AF = align(ALL);
const START = Math.max(...SLOW_CORE.coins.map((c) => listT[c])), LAST = A3.days.at(-1) + DAY; // כשכל שלושת הנכסים רשומים ב-Bybit
const od = AF.days.filter((t) => t < Date.UTC(2026, 10, 7));
const W = { s22: { from: T22, to: LAST }, test: { from: od[Math.floor(od.length * 0.8)], to: LAST }, all: { from: START, to: LAST } };
const WN = { s22: 'מ-2022', test: 'מבחן', all: 'הכול' };
const iso = (t) => new Date(t).toISOString().slice(0, 10), yr = (t) => new Date(t).getUTCFullYear();
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
const f2 = (x) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '' : '−') + Math.abs(x).toFixed(2));
const yn = (b) => (b ? '✅' : '❌');
const cut = (sr) => sr.filter((x) => x.t >= START);
const metrics = (sr) => { const o = {}; for (const [k, w] of Object.entries(W)){ const s = dstats(sr, w), sel = sr.filter((x) => x.t >= w.from && x.t < w.to);
  o[k] = { cagr: s.cagr, maxDD: s.maxDD, sharpe: s.sharpe, ci: s.ci, turnYr: s.turnYr, exposure: s.exposure, cost: sel.reduce((a, x) => a + x.cost, 0), rec: longestRecovery(sr, w) }; }
  const m = new Map(); for (const x of sr){ const y = yr(x.t); m.set(y, (m.get(y) ?? 1) * (1 + x.net)); } o.yearly = Object.fromEntries([...m].map(([y, e]) => [y, e - 1])); return o; };
const V = {}, add = (key, name, sr) => { V[key] = { name, m: metrics(cut(sr)) }; log(key, pct(V[key].m.s22.cagr), pct(-V[key].m.all.maxDD)); };
const scm = (o = {}, costMult = 1) => { const s = slowCore(A3, { allow: allow3, ...o }); return runDaily(A3, s, { drift: true, rebal: s.rebal, C: C5, costMult, trace: true }).series; };
add('SCM', 'Slow Core Momentum (הראשית)', scm());
add('SCMx2', 'עמידות: עלויות כפולות', scm({}, 2));
add('SCMd1', 'עמידות: ביצוע מאוחר ביום', scm({ delay: 1 }));
add('SCM60', 'מידע: 60 יום', scm({ lookback: 60 }));
add('SCM120', 'מידע: 120 יום', scm({ lookback: 120 }));
const third = [1 / 3, 1 / 3, 1 / 3];
add('EQ3', 'קנה והחזק: שליש ביטקוין / אתריום / סולאנה (מדד הייחוס)', runDaily(A3, holdFrom(third, START), { drift: true, C: C5 }).series);
{ const s = holdFrom(third, START); add('EQ3r', 'מידע: שליש לכל אחד, מאוזן כל 30 יום', runDaily(A3, s, { drift: true, C: C5, rebal: (d) => isReb30(A3.days[d]) }).series); }
add('BTC', 'קנה והחזק: ביטקוין', runDaily(A3, holdFrom([1, 0, 0], START), { drift: true, C: C5 }).series);
for (const k of ['base', 'AB']){ const v = VERSIONS.find((x) => x.key === k); add(`XSRA-${k}`, k === 'base' ? 'XSRA-7 (המעקב הקיים, בלי הגנות)' : 'XSRA-7 עם שתי ההגנות (א+ב)', simulate(AC, { ...v, allow: allowC, C: C5 }).series); }
// ---- הקריטריון ----
const m = V.SCM.m, e = V.EQ3.m, P = SC_PASS;
const VERD = { c1: m.s22.cagr >= P.cagr && m.test.cagr >= P.cagr, c2: ['s22', 'test', 'all'].every((w) => m[w].maxDD <= P.maxDD), c3: m.s22.turnYr < P.turnover,
  c4: ['s22', 'test'].every((w) => m[w].cagr > e[w].cagr && m[w].maxDD < e[w].maxDD) };
VERD.pass = VERD.c1 && VERD.c2 && VERD.c3 && VERD.c4;
const ROB = Object.fromEntries(['SCMx2', 'SCMd1'].map((k) => { const x = V[k].m; return [k, { c1: x.s22.cagr >= P.cagr && x.test.cagr >= P.cagr, c2: ['s22', 'test', 'all'].every((w) => x[w].maxDD <= P.maxDD), c4: ['s22', 'test'].every((w) => x[w].cagr > e[w].cagr && x[w].maxDD < e[w].maxDD) }]; }));
log(JSON.stringify(VERD));
const L = [];
L.push('# Slow Core Momentum — ענף מחקר נפרד (מחקר 7כח)', '',
  `מחקר בלבד — **לא נוגע במעקב הווירטואלי של XSRA-7**. נתונים: נרות יומיים של Coinbase; כל נכס רק מיום הרישום שלו ב-Bybit; עלות לפי ספר הפקודות של Bybit (עמלה 0.1% + החלקה, פקודה של 5,000$) — כמו XSRA-7. ` +
  `ההערכה מ-${iso(START)} (שלושת הנכסים רשומים) עד ${iso(LAST - DAY)}; מבחן: ${iso(W.test.from)} → (אותם תאריכים כמו XSRA-7). מזומן — 0% ריבית. בלי מס.`, '',
  '**הכללים (נשמרו בקוד לפני ההרצה, `SLOW_CORE` ב-engine/slow-core.js):** שלושת נכסי הליבה — ביטקוין, אתריום, סולאנה. איזון **בדיוק כל 30 ימים קלנדריים** (יום שמספרו מ-1/1/1970 מתחלק ב-30), ביצוע בפתיחה שאחרי. ' +
  'כשיר = תשואת 90 יום חיובית. דירוג = תשואת 90 יום ÷ סטיית התקן היומית ב-90 הימים; מחזיקים את שני הראשונים. שניים כשירים — משקל לפי הציון, **תקרה 60%** לנכס; אחד — **50% בו ו-50% מזומן**; אף אחד — מזומן.', '',
  `**הקריטריון (\`SC_PASS\`):** (1) לפחות ${P.cagr * 100}% בשנה לפני מס, מ-2022 ובמבחן · (2) ירידה מקסימלית ≤ ${P.maxDD * 100}% בכל תקופה · (3) מחזור שנתי < פי ${P.turnover} · (4) מול קנה-והחזק של שלושת הנכסים (שליש לכל אחד): תשואה גבוהה יותר **וגם** ירידה קטנה יותר, מ-2022 ובמבחן.`, '',
  '| | עמידה |', '|---|---|',
  `| (1) 20% בשנה | ${yn(VERD.c1)} (מ-2022 ${pct(m.s22.cagr)}, מבחן ${pct(m.test.cagr)}) |`,
  `| (2) ירידה ≤ 35% | ${yn(VERD.c2)} (${['s22', 'test', 'all'].map((w) => pct(-m[w].maxDD)).join(' / ')}) |`,
  `| (3) מחזור < פי 4 | ${yn(VERD.c3)} (פי ${m.s22.turnYr.toFixed(1)}; XSRA-7: פי ${V['XSRA-base'].m.s22.turnYr.toFixed(1)}) |`,
  `| (4) מול 3 הנכסים הפסיביים | ${yn(VERD.c4)} (מ-2022 ${pct(m.s22.cagr)} / ${pct(-m.s22.maxDD)} מול ${pct(e.s22.cagr)} / ${pct(-e.s22.maxDD)}; מבחן ${pct(m.test.cagr)} / ${pct(-m.test.maxDD)} מול ${pct(e.test.cagr)} / ${pct(-e.test.maxDD)}) |`,
  `| **עובר?** | ${VERD.pass ? '**כן**' : '**לא**'} |`,
  `| עמידות — עלויות כפולות / ביצוע מאוחר | (1) ${yn(ROB.SCMx2.c1)} / ${yn(ROB.SCMd1.c1)} · (2) ${yn(ROB.SCMx2.c2)} / ${yn(ROB.SCMd1.c2)} · (4) ${yn(ROB.SCMx2.c4)} / ${yn(ROB.SCMd1.c4)} |`, '');
L.push('## הטבלה המלאה', '', '| | מ-2022: תשואה / ירידה / שארפ | מבחן: תשואה / ירידה | הכול: תשואה / ירידה | מחזור בשנה | עלויות מ-2022 | חשיפה | התאוששות ארוכה (ימים) |', '|---|---|---|---|---|---|---|---|');
for (const v of Object.values(V)){ const x = v.m; L.push(`| ${v.name} | ${pct(x.s22.cagr)} / ${pct(-x.s22.maxDD)} / ${f2(x.s22.sharpe)} | ${pct(x.test.cagr)} / ${pct(-x.test.maxDD)} | ${pct(x.all.cagr)} / ${pct(-x.all.maxDD)} | פי ${x.s22.turnYr.toFixed(1)} | ${pct(-x.s22.cost)} | ${Math.round(x.all.exposure * 100)}% | ${x.all.rec} |`); }
const ys = Object.keys(V.SCM.m.yearly).sort();
L.push('', '## תשואה לפי שנה', '', `| | ${ys.join(' | ')} |`, `|---|${ys.map(() => '---').join('|')}|`);
for (const v of Object.values(V)) L.push(`| ${v.name} | ${ys.map((y) => pct(v.m.yearly[y])).join(' | ')} |`);
L.push('', `(${ys[0]} חלקית — מ-${iso(START)}; ${ys.at(-1)} עד ${iso(LAST - DAY)}.) "מחזור" = סכום השינויים במשקלות (קנייה + מכירה) בשנה, כמו ב-XSRA-7.`, '');
const md = L.join('\n') + '\n';
if (OUT) writeFileSync(OUT, md); else process.stdout.write(md);
if (JOUT) writeFileSync(JOUT, JSON.stringify({ meta: { start: iso(START), last: iso(LAST - DAY), test: iso(W.test.from), SLOW_CORE, SC_PASS }, variants: V, verdict: VERD, robustness: ROB }, null, 1));
