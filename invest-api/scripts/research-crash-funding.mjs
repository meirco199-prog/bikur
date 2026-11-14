#!/usr/bin/env node
// כיוון 2 (אישור מאיר 14/11/2026): קנייה בקריסות לפי דמי המימון — BTC ו-ETH, ספוט, רק לונג, בלי מינוף, בלי מס. סבב אחד.
// כללים וקריטריון שנקבעו לפני ההרצה (engine/crash-funding.js, PASS למטה). מקור המימון הראשי נקבע מראש: המקור עם ההיסטוריה הארוכה
// ביותר ל-BTC (BitMEX ← Bybit ← Binance ← Deribit); שאר המקורות — בדיקת עמידות בלבד.
// שימוש: node invest-api/scripts/research-crash-funding.mjs --data xsra-data.json.gz --funding invest/docs/research/funding-crash/funding-daily.json [--out r.md] [--json r.json] [--n 1000]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { align, runDaily, dstats, DCOST } from '../engine/research-daily.js';
import { combine5050, longestRecovery } from '../engine/trend-btceth.js';
import { CF, crashBuy, randomBuy, tradeList, toFundingMap, crashDepth, fundingView, fundOK } from '../engine/crash-funding.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'xsra-data.json.gz'), FUND = arg('--funding', 'invest/docs/research/funding-crash/funding-daily.json'), OUT = arg('--out', ''), JOUT = arg('--json', ''), N = +arg('--n', '1000');
const DAY = 86400e3, COINS = ['BTC', 'ETH'], log = (...a) => console.error(...a), T22 = Date.UTC(2022, 0, 1);
const PASS = Object.freeze({ cagr: 0.20, maxDD: 0.35, minEvents: 20, pctile: 0.95 }); // נקבע מראש (14/11/2026)
const ORDER = ['bitmex', 'bybit', 'binance', 'deribit'];
const iso = (t) => new Date(t).toISOString().slice(0, 10), yr = (t) => new Date(t).getUTCFullYear();
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
const f2 = (x) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '' : '−') + Math.abs(x).toFixed(2));
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN), med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const lcg = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); };

const d0 = JSON.parse(gunzipSync(readFileSync(DATA))), FJ = JSON.parse(readFileSync(FUND, 'utf8'));
for (const c of COINS) for (const b of d0.bars[c]){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }
const srcs = ORDER.filter((s) => FJ.daily?.[s]?.BTC?.length >= 730 && FJ.daily?.[s]?.ETH?.length >= 730); // מקור עם פחות משנתיים — לא בשימוש
if (!srcs.length) throw new Error('אין מקור מימון עם BTC ו-ETH');
const firstOf = (s, c) => Date.parse(FJ.daily[s][c][0][0] + 'T00:00:00Z');
const MAIN = srcs.slice().sort((a, b) => firstOf(a, 'BTC') - firstOf(b, 'BTC') || ORDER.indexOf(a) - ORDER.indexOf(b))[0];
const FM = Object.fromEntries(srcs.map((s) => [s, Object.fromEntries(COINS.map((c) => [c, toFundingMap(FJ.daily[s][c])]))]));
const AC = Object.fromEntries(COINS.map((c) => [c, align({ [c]: d0.bars[c] })]));
// תחילת ההערכה: כשלשני המטבעות יש מחיר ודמי מימון מהמקור הראשי + 30 ימים (חימום לממוצע ולשיא של 7 ימים); העשירון צריך 180 ימי היסטוריה משלו
const START = Math.max(...COINS.map((c) => Math.max(AC[c].days[0], firstOf(MAIN, c)))) + 30 * DAY;
const LAST = Math.max(...COINS.map((c) => AC[c].days.at(-1))) + DAY;
// אותם גבולות תקופה כמו במחקר 7כא (מגמה על BTC/ETH), כדי שההשוואה תהיה על אותן תקופות
const W = { train: { from: START, to: Date.UTC(2022, 10, 18) }, val: { from: Date.UTC(2022, 10, 18), to: Date.UTC(2024, 10, 12) }, test: { from: Date.UTC(2024, 10, 12), to: LAST }, pre22: { from: START, to: T22 }, s22: { from: T22, to: LAST }, all: { from: START, to: LAST } };
const WN = { train: 'אימון', val: 'אימות', test: 'מבחן', pre22: 'עד 2022', s22: 'מ-2022', all: 'הכול' };
const BPS = DCOST.spotBps + DCOST.slipBps.BTC;
const cut = (sr) => sr.filter((x) => x.t >= START);
const leg = (c, strat) => cut(runDaily(AC[c], strat, { drift: true }).series);
const metrics = (sr) => Object.fromEntries(Object.entries(W).map(([k, w]) => { const s = dstats(sr, w); return [k, { cagr: s.cagr, sharpe: s.sharpe, ci: s.ci, maxDD: s.maxDD, vol: s.vol, exposure: s.exposure, turnYr: s.turnYr, rec: longestRecovery(sr, w) }]; }));
const trades = (sr, w = W.all) => tradeList(sr).filter((x) => x.t >= w.from && x.t < w.to);
function runCfg(p, src = MAIN, f = p.f){ const lb = leg('BTC', crashBuy(AC.BTC, FM[src].BTC, 'BTC', { ...p, f })), le = leg('ETH', crashBuy(AC.ETH, FM[src].ETH, 'ETH', { ...p, f }));
  const tr = [...trades(lb).map((x) => ({ ...x, c: 'BTC' })), ...trades(le).map((x) => ({ ...x, c: 'ETH' }))].sort((a, b) => a.t - b.t);
  return { lb, le, comb: combine5050(lb, le, { bps: BPS }), tr }; }
const trStats = (tr) => { const r = tr.map((x) => x.ret); return { n: r.length, mean: mean(r), median: med(r), win: r.length ? r.filter((x) => x > 0).length / r.length : NaN, pre22: mean(tr.filter((x) => x.t < T22).map((x) => x.ret)), s22: mean(tr.filter((x) => x.t >= T22).map((x) => x.ret)), n22: tr.filter((x) => x.t >= T22).length }; };

// ---- מדדי ייחוס ----
const hold = { id: 'HOLD', weights: () => [1] }, Hb = leg('BTC', hold), He = leg('ETH', hold), Hc = combine5050(Hb, He, { bps: BPS });
const BENCH = { BTC: metrics(Hb), ETH: metrics(He), P5050: metrics(Hc) };
// תשואה ממוצעת קדימה (מפתיחת d+1, h ימים) בכל הימים — הבסיס הבלתי מותנה
const fwd = (c, h) => { const A = AC[c], o = []; for (let d = 0; d + h + 1 < A.days.length; d++){ if (A.days[d] < START) continue; const a = A.O[0][d + 1], b = A.O[0][d + h + 1]; if (Number.isFinite(a) && Number.isFinite(b)) o.push(b / a - 1); } return mean(o); };

// ---- הגרסה הראשית + בלי מסנן המימון + אקראי ----
const P0 = CF.primary, R0 = runCfg(P0), RN = runCfg(P0, MAIN, 'none');
const S0 = trStats(R0.tr), SN = trStats(RN.tr);
// אקראי: לכל מטבע אותו מספר עסקאות בממוצע (הסתברות כניסה = עסקאות / ימים מחוץ לשוק), אותה החזקה ואותה עצירה; N הרצות
const rnd = { mean: [], cagrS22: [], cagrAll: [] };
for (let s = 0; s < N; s++){ const per = {}, legs = {};
  for (const c of COINS){ const n = R0.tr.filter((x) => x.c === c).length, days = AC[c].days.filter((t) => t >= START).length, outDays = Math.max(1, days - n * P0.h);
    legs[c] = leg(c, randomBuy(lcg(s * 7919 + (c === 'ETH' ? 104729 : 17)), n / outDays, { h: P0.h })); per[c] = trades(legs[c]); }
  rnd.mean.push(mean([...per.BTC, ...per.ETH].map((x) => x.ret))); const cb = combine5050(legs.BTC, legs.ETH, { bps: BPS }); rnd.cagrS22.push(dstats(cb, W.s22).cagr); rnd.cagrAll.push(dstats(cb, W.all).cagr); }
const pctile = (arr, v) => arr.filter((x) => x < v).length / arr.length;
const M0 = metrics(R0.comb), MN = metrics(RN.comb);
const PR = { meanPct: pctile(rnd.mean, S0.mean), cagrAllPct: pctile(rnd.cagrAll, M0.all.cagr), cagrS22Pct: pctile(rnd.cagrS22, M0.s22.cagr), rndMeanMedian: med(rnd.mean), rndCagrAllMedian: med(rnd.cagrAll) };
const passA = { c1: M0.val.cagr >= PASS.cagr && M0.test.cagr >= PASS.cagr, c2: ['train', 'val', 'test'].every((k) => M0[k].maxDD <= PASS.maxDD) };
// ---- הרשת ----
const GRID = CF.grid.map((p) => { const R = runCfg(p), RNo = runCfg(p, MAIN, 'none'), s = trStats(R.tr), sn = trStats(RNo.tr), m = metrics(R.comb);
  return { id: `CF-${Math.round(p.x * 100)}-${p.f}-${p.h}`, p, primary: JSON.stringify(p) === JSON.stringify(P0), tr: s, trNone: sn, m, edge: s.n >= 5 && s.mean > 0 && s.mean > sn.mean }; });
const gridEdge = GRID.filter((g) => g.edge).length / GRID.length;
const passB = { events: S0.n >= PASS.minEvents, beatsNone: S0.mean > SN.mean, random: PR.meanPct >= PASS.pctile, bothHalves: S0.pre22 > 0 && S0.s22 > 0, grid: gridEdge >= 0.5 };
passB.all = Object.values(passB).every(Boolean); passA.all = passA.c1 && passA.c2;
// ---- עמידות למקור המימון ----
const BYSRC = srcs.map((s) => { const R = runCfg(P0, s), st = trStats(R.tr), m = metrics(R.comb); return { src: s, from: FJ.daily[s].BTC[0][0], tr: st, s22: m.s22, all: m.all }; });
// ---- תשואה קדימה לפי עומק הקריסה ומצב המימון (כל הימים שבהם יש קריסה, בלי כלל ההחזקה) ----
const FWD = {}; for (const c of COINS){ const A = AC[c], fv = fundingView(A, FM[MAIN][c]), X = c === 'ETH' ? P0.x * CF.ethMult : P0.x; const g = { neg: [], pos: [], all: [] };
  for (let d = 0; d + 21 < A.days.length; d++){ if (A.days[d] < START) continue; if (!(crashDepth(A, d) >= X)) continue; const r = A.O[0][d + 21] / A.O[0][d + 1] - 1; if (!Number.isFinite(r)) continue; g.all.push(r); (fundOK(fv, d, 'neg') ? g.neg : g.pos).push(r); }
  FWD[c] = { base20: fwd(c, 20), all: { n: g.all.length, mean: mean(g.all) }, neg: { n: g.neg.length, mean: mean(g.neg) }, pos: { n: g.pos.length, mean: mean(g.pos) } }; }

const RES = { meta: { main: MAIN, sources: srcs, start: iso(START), last: iso(LAST - DAY), pass: PASS, cf: CF }, bench: BENCH, primary: { m: M0, tr: S0, events: R0.tr.map((x) => ({ d: iso(x.t), c: x.c, ret: Math.round(x.ret * 1000) / 1000, days: x.days })), none: { m: MN, tr: SN }, random: PR, passA, passB }, grid: GRID.map(({ id, p, tr, trNone, m, edge }) => ({ id, p, tr, trNone, edge, m: { val: m.val, test: m.test, s22: m.s22, all: m.all } })), gridEdge, bySource: BYSRC, fwd: FWD };
log(`ראשי (${MAIN}): ${S0.n} עסקאות, ממוצע ${pct(S0.mean)} (בלי מסנן ${pct(SN.mean)}, אחוזון אקראי ${Math.round(PR.meanPct * 100)}%) · מ-2022 ${pct(M0.s22.cagr)} · רשת ${Math.round(gridEdge * 100)}%`);

// ---- דוח ----
const yn = (b) => (b ? '✅' : '❌'), L = [];
L.push('# קנייה בקריסות לפי דמי המימון — ביטקוין ואתריום, סבב אחד (מחקר 7כב)', '',
  `מחירים: נרות יומיים של Coinbase. דמי מימון: מקור ראשי **${MAIN}** (נקבע מראש: ההיסטוריה הארוכה ביותר); מקורות לעמידות: ${srcs.join(', ')}. ` +
  `תחילת ההערכה ${iso(START)}, סוף ${iso(LAST - DAY)}. תקופות כמו במחקר 7כא: אימון עד 2022-11-17, אימות עד 2024-11-11, מבחן אחרי.`, '',
  `**הכללים (נקבעו מראש):** קריסה = סגירה נמוכה ב-${P0.x * 100}% ומעלה מהשיא של ${CF.look} הסגירות הקודמות (באתריום ${Math.round(P0.x * CF.ethMult * 100)}%) · ` +
  `מסנן = ממוצע דמי המימון של ${CF.fN} הימים האחרונים שלילי · כניסה בפתיחה שאחרי · יציאה אחרי ${P0.h} ימים או ב-${CF.stop * 100}% מתחת לכניסה · אירוע חדש רק אחרי שהקריסה התבטלה. ` +
  `חצי מהתיק לכל מטבע; מחוץ לשוק — מזומן בלי ריבית. עמלה 0.1% + החלקה 0.02% לכל צד. בלי מס.`, '',
  `**קריטריון א' (יעד התשואה, כמו בכיוון 1):** לפחות ${PASS.cagr * 100}% בשנה באימות ובמבחן, וירידה של עד ${PASS.maxDD * 100}% בכל תקופה.`, '',
  `**קריטריון ב' (האם יש יתרון אמיתי):** (1) לפחות ${PASS.minEvents} עסקאות · (2) תשואה ממוצעת לעסקה גבוהה מאותו כלל בלי מסנן המימון · ` +
  `(3) באחוזון ${PASS.pctile * 100}% ומעלה מול ${N} הרצות אקראיות עם אותו מספר עסקאות ואותה החזקה · (4) ממוצע חיובי גם עד 2022 וגם מ-2022 · (5) לפחות חצי מהרשת: ממוצע חיובי וגבוה מהגרסה בלי מסנן.`, '');
L.push('## התוצאה', '', '| | עמידה |', '|---|---|',
  `| א' (1) לפחות 20% בשנה באימות ובמבחן | ${yn(passA.c1)} (${pct(M0.val.cagr)} / ${pct(M0.test.cagr)}) |`,
  `| א' (2) ירידה עד 35% | ${yn(passA.c2)} (${pct(-M0.train.maxDD)} / ${pct(-M0.val.maxDD)} / ${pct(-M0.test.maxDD)}) |`,
  `| ב' (1) לפחות ${PASS.minEvents} עסקאות | ${yn(passB.events)} (${S0.n}) |`,
  `| ב' (2) עדיף על אותו כלל בלי מסנן | ${yn(passB.beatsNone)} (${pct(S0.mean)} מול ${pct(SN.mean)}, ${SN.n} עסקאות) |`,
  `| ב' (3) אחוזון מול אקראי | ${yn(passB.random)} (${Math.round(PR.meanPct * 100)}%; חציון אקראי ${pct(PR.rndMeanMedian)}) |`,
  `| ב' (4) חיובי בשני החצאים | ${yn(passB.bothHalves)} (עד 2022 ${pct(S0.pre22)}, מ-2022 ${pct(S0.s22)}, ${S0.n22} עסקאות מ-2022) |`,
  `| ב' (5) רשת | ${yn(passB.grid)} (${Math.round(gridEdge * 100)}%) |`,
  `| **עוברת?** | א': ${passA.all ? '**כן**' : '**לא**'} · ב': ${passB.all ? '**כן**' : '**לא**'} |`, '');
L.push('## טבלת השוואה — התיק המשולב (תשואה שנתית)', '', '| | אימון | אימות | מבחן | עד 2022 | מ-2022 | ירידה מקס׳ | שארפ מ-2022 [טווח ביטחון] | חשיפה | התאוששות (ימים) |', '|---|---|---|---|---|---|---|---|---|---|');
const row = (n, m) => `| ${n} | ${pct(m.train.cagr)} | ${pct(m.val.cagr)} | ${pct(m.test.cagr)} | ${pct(m.pre22.cagr)} | ${pct(m.s22.cagr)} | ${pct(-m.all.maxDD)} | ${f2(m.s22.sharpe)} [${f2(m.s22.ci?.[0])}, ${f2(m.s22.ci?.[1])}] | ${Math.round(m.all.exposure * 100)}% | ${m.all.rec} |`;
L.push(row(`קנייה בקריסות + מימון (ראשית)`, M0), row('אותו כלל בלי מסנן המימון', MN), row('החזקת ביטקוין', BENCH.BTC), row('החזקת אתריום', BENCH.ETH), row('החזקת 50/50', BENCH.P5050), '',
  `אקראי (אותו מספר עסקאות, ${N} הרצות): חציון תשואה שנתית על כל התקופה ${pct(PR.rndCagrAllMedian)}; השיטה באחוזון ${Math.round(PR.cagrAllPct * 100)}% (כל התקופה) ו-${Math.round(PR.cagrS22Pct * 100)}% (מ-2022).`, '');
L.push('## העסקאות (הגרסה הראשית)', '', '| תאריך כניסה | מטבע | ימים | תשואה |', '|---|---|---|---|');
for (const x of R0.tr) L.push(`| ${iso(x.t)} | ${x.c === 'BTC' ? 'ביטקוין' : 'אתריום'} | ${x.days} | ${pct(x.ret)}${x.open ? ' (פתוחה)' : ''} |`);
L.push('', `סיכום: ${S0.n} עסקאות, ממוצע ${pct(S0.mean)}, חציון ${pct(S0.median)}, הצלחה ${Math.round(S0.win * 100)}%.`, '');
L.push('## האם המימון מוסיף מידע? תשואה של 20 ימים אחרי כל יום קריסה (בלי כלל ההחזקה)', '', '| מטבע | כל הימים (בסיס) | ימי קריסה | קריסה + מימון שלילי | קריסה + מימון חיובי |', '|---|---|---|---|---|');
for (const c of COINS){ const f = FWD[c]; L.push(`| ${c === 'BTC' ? 'ביטקוין' : 'אתריום'} | ${pct(f.base20)} | ${pct(f.all.mean)} (${f.all.n}) | ${pct(f.neg.mean)} (${f.neg.n}) | ${pct(f.pos.mean)} (${f.pos.n}) |`); }
L.push('', '(ימי קריסה צמודים חופפים — אלה לא תצפיות בלתי תלויות; זה תיאור, לא מבחן.)', '');
L.push('## עמידות למקור דמי המימון (הגרסה הראשית)', '', '| מקור | מתאריך | עסקאות | ממוצע לעסקה | מ-2022: תשואה שנתית | ירידה מקס׳ |', '|---|---|---|---|---|---|');
for (const b of BYSRC) L.push(`| ${b.src}${b.src === MAIN ? ' (ראשי)' : ''} | ${b.from} | ${b.tr.n} | ${pct(b.tr.mean)} | ${pct(b.s22.cagr)} | ${pct(-b.all.maxDD)} |`);
L.push('', '## הרשת — 27 גרסאות (שום גרסה לא נבחרה בדיעבד)', '', '| גרסה | עסקאות | ממוצע לעסקה | בלי מסנן | עד 2022 / מ-2022 | אימות / מבחן (שנתי) | מ-2022 | ירידה מקס׳ | יתרון |', '|---|---|---|---|---|---|---|---|---|');
for (const g of GRID) L.push(`| ${g.primary ? '**' + g.id + '** (ראשית)' : g.id} | ${g.tr.n} | ${pct(g.tr.mean)} | ${pct(g.trNone.mean)} | ${pct(g.tr.pre22)} / ${pct(g.tr.s22)} | ${pct(g.m.val.cagr)} / ${pct(g.m.test.cagr)} | ${pct(g.m.s22.cagr)} | ${pct(-g.m.all.maxDD)} | ${yn(g.edge)} |`);
L.push('', '## הערות', '', '- דמי המימון: סכום יומי (UTC) של התשלומים; ממוצע 3 הימים כולל את יום ההחלטה, שכל התשלומים שלו ידועים בסגירה.',
  '- "בלי מסנן" = אותו כלל קריסה ואותה החזקה, בלי תנאי המימון — כך בודקים אם המימון עצמו מוסיף משהו.',
  '- אקראי = כניסות בימים אקראיים, באותו קצב עסקאות, עם אותה החזקה ואותה עצירה.');
const md = L.join('\n') + '\n';
if (OUT) writeFileSync(OUT, md); else process.stdout.write(md);
if (JOUT) writeFileSync(JOUT, JSON.stringify(RES, null, 1));
