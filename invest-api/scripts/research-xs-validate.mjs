#!/usr/bin/env node
// בדיקת אימות ממוקדת (בקשת מאיר 13/11/2026): גרסה א' (תקרה 15% למטבע) וגרסה ב' (יעד תנודתיות 40%) מול המקורית, על 38 המטבעות של Bybit.
// בלי אופטימיזציה: אותם ספים בדיוק (PROTECT ב-engine/xsra-protect.js). כל מדד בכל שכבה נלקח מהרצה אחת.
// שכבות: (1) מחירי Coinbase, כל ההיסטוריה · (2) + יקום לפי תאריכי הרישום ב-Bybit · (3) + עלות לפי ספר הפקודות של היום, לפי גודל פקודה ·
// (4) נתוני ביצוע היסטוריים של Bybit — לא זמינים (מתועד). 1,000 בחירות אקראיות לכל גרסה (worker_threads), עלויות ×1/×2/×3 ותוספת
// קבועה, יציבות של א' (שנים, שוק עולה/יורד, חלונות מתגלגלים, הוצאת כל מטבע), ומס בנפרד עם הנחות מפורשות. מחקר בלבד.
// שימוש: node invest-api/scripts/research-xs-validate.mjs --data xsra-data.json.gz --bybit invest/docs/research/xs-protect/bybit-probe.json [--out r.md] [--json r.json] [--n 1000]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { align, dstats, DCOST } from '../engine/research-daily.js';
import { simulate, VERSIONS } from '../engine/xsra-protect.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DAY = 86400e3, T21 = Date.UTC(2021, 0, 1);
const lcg = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); };
const V3 = ['base', 'A', 'B'].map((k) => VERSIONS.find((v) => v.key === k));

function load(DATA, BYB){
  const d0 = JSON.parse(gunzipSync(readFileSync(DATA))), byb = JSON.parse(readFileSync(BYB, 'utf8'));
  for (const bars of Object.values(d0.bars)) for (const b of bars){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }
  const ALL = Object.fromEntries(Object.entries(d0.bars).filter(([c]) => byb.listing[c]));
  const CUT = Object.fromEntries(Object.entries(ALL).map(([c, b]) => [c, b.filter((x) => x.t >= T21)]).filter(([, b]) => b.length));
  const listT = Object.fromEntries(Object.entries(byb.listing).map(([c, d]) => [c, Date.parse(d + 'T00:00:00Z')]));
  return { ALL, CUT, byb, listT };
}
const periods = (A) => { const od = A.days.filter((t) => t < Date.UTC(2026, 10, 7)), at = (k) => od[Math.floor(od.length * k)], LAST = A.days.at(-1) + DAY; return { od, at, LAST }; };

// ---- worker: בחירות אקראיות ----
if (!isMainThread){
  const { DATA, BYB, key, from, to, P } = workerData, { CUT, listT } = load(DATA, BYB), A = align(CUT), v = VERSIONS.find((x) => x.key === key);
  const allow = (k, t) => t >= (listT[A.coins[k]] ?? Infinity), out = [];
  for (let seed = from; seed < to; seed++){
    const sr = simulate(A, { ...v, allow, rng: (j) => lcg(seed * 7919 + j * 104729 + 17) }).series;
    out.push({ s22: dstats(sr, P.s22).cagr, test: dstats(sr, P.test).cagr, shS22: dstats(sr, P.s22).sharpe, dd22: dstats(sr, P.s22).maxDD });
  }
  parentPort.postMessage(out);
} else {
  const DATA = arg('--data', 'xsra-data.json.gz'), BYB = arg('--bybit', 'invest/docs/research/xs-protect/bybit-probe.json'), OUT = arg('--out', ''), JOUT = arg('--json', ''), N = +arg('--n', '1000');
  const log = (...a) => console.error(...a);
  const { ALL, CUT, byb, listT } = load(DATA, BYB);
  const AF = align(ALL), AC = align(CUT), iBF = AF.coins.indexOf('BTC');
  const { at, LAST } = periods(AF);
  const P = { train: { from: AF.days[0], to: at(0.6) }, val: { from: at(0.6), to: at(0.8) }, val22: { from: Date.UTC(2022, 0, 1), to: at(0.8) }, test: { from: at(0.8), to: LAST }, s22: { from: Date.UTC(2022, 0, 1), to: LAST } };
  const iso = (t) => new Date(t).toISOString().slice(0, 10), yr = (t) => new Date(t).getUTCFullYear();
  const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
  const f2 = (x) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '' : '−') + Math.abs(x).toFixed(2));
  const ci = (s) => (s?.ci ? `[${f2(s.ci[0])}, ${f2(s.ci[1])}]` : '');
  const allowC = (k, t) => t >= (listT[AC.coins[k]] ?? Infinity);
  // עלות לפי ספר הפקודות, לפי גודל פקודה (נמדד היום): 500$/1,000$ → הקנייה של 1,000$; 5,000$ → 5,000$; 25,000$ → 25,000$; אין עומק → 300 נק׳ בסיס
  const SIZES = [500, 1000, 5000, 25000], NODEPTH = 300;
  const bookCost = (size) => { const f = size <= 1000 ? 'buy1k' : size <= 5000 ? 'buy5k' : 'buy25k';
    return { ...DCOST, slipBps: Object.fromEntries(Object.keys(byb.listing).map((c) => { const m = byb.book[c]?.[f]; return [c, Math.max(DCOST.slipBps[c] ?? DCOST.slipOther, m == null ? NODEPTH : m)]; })) }; };
  const extraCost = (bps) => ({ ...DCOST, slipBps: Object.fromEntries(Object.keys(byb.listing).map((c) => [c, (DCOST.slipBps[c] ?? DCOST.slipOther) + bps])), slipOther: DCOST.slipOther + bps });
  const stats = (r, Pk) => { const sr = r.series, out = {}; for (const [k, w] of Object.entries(Pk)){ const s = dstats(sr, w); const sel = sr.filter((x) => x.t >= w.from && x.t < w.to), y = sel.length / 365;
    out[k] = { ...s, turnYr: y ? sel.reduce((a, x) => a + x.turn, 0) / y : null, costYr: y ? sel.reduce((a, x) => a + x.cost, 0) / y : null }; } return out; };
  const RES = { layers: {} }, L = [];
  L.push('# בדיקת אימות ממוקדת — א\' (תקרה 15% למטבע) וב\' (יעד תנודתיות 40%) מול המקורית, 38 המטבעות של Bybit', '',
    'בלי אופטימיזציה: אותם ספים בדיוק כמו בסעיף 7יט (`PROTECT`). **כל מדד בכל שורה נלקח מהרצה אחת** (תשואה, שארפ, ירידה, מחזור ועלות — מאותה סדרה). עמלת Taker 0.1% + החלקה לכל צד; בלי מינוף.', '',
    `**תקופות:** אימון ${iso(P.train.from)}→${iso(P.train.to)} · אימות →${iso(P.val.to)} (ב-Bybit יש נתונים רק מ-7/2021, ולכן "אימות" בשכבות 2–3 = 1/2022→${iso(P.val.to)}) · מבחן ${iso(P.test.from)}→ · מ-2022. כל התקופות כבר נחשפו במחקר הקודם — אין כאן מבחן עצמאי חדש.`, '');

  // ---- 1. שכבות ----
  const row = (lab, s, keys) => `| ${lab} | ${keys.map((k) => `${pct(s[k].cagr)} / ${f2(s[k].sharpe)} / ${pct(-s[k].maxDD)}`).join(' | ')} | ${s.s22.turnYr?.toFixed(1)}× | ${pct(-s.s22.costYr)} |`;
  L.push('## 1. שלוש שכבות, כל אחת הרצה אחת (תשואה שנתית / שארפ / ירידה מקסימלית; מחזור ועלות בשנה — מ-2022)', '');
  L.push('### שכבה 1 — מחירי Coinbase, 38 המטבעות, כל ההיסטוריה (כאילו היו זמינים ב-Bybit מ-2016)', '', '| גרסה | אימון | אימות | מבחן | מ-2022 | מחזור בשנה | עלות בשנה |', '|---|---|---|---|---|---|---|');
  const L1 = {}; for (const v of V3){ log(`שכבה 1 ${v.key}`); L1[v.key] = stats(simulate(AF, v), P); L.push(row(v.lab, L1[v.key], ['train', 'val', 'test', 's22'])); }
  const btcSeries = (A) => { const i = A.coins.indexOf('BTC'), out = []; for (let d = 1; d < A.days.length; d++){ const c0 = A.C[i][d - 1], c = A.C[i][d]; out.push({ t: A.days[d], net: Number.isFinite(c0) && Number.isFinite(c) ? c / c0 - 1 : 0, cost: 0, fund: 0, gross: 0, turn: 0, exp: 1 }); } return out; };
  const BT = stats({ series: btcSeries(AF) }, P); L.push(`| BTC קנה והחזק | ${['train', 'val', 'test', 's22'].map((k) => `${pct(BT[k].cagr)} / ${f2(BT[k].sharpe)} / ${pct(-BT[k].maxDD)}`).join(' | ')} | — | — |`);
  const P2 = { val22: P.val22, test: P.test, s22: P.s22 };
  L.push('', '### שכבה 2 — + יקום לפי תאריכי הרישום ב-Bybit (מטבע נכנס רק מהנר הראשון שלו בספוט; לפני 7/2021 — מזומן); עלות לפי המודל', '', '| גרסה | 1/2022→9/2024 | מבחן | מ-2022 | מחזור בשנה | עלות בשנה |', '|---|---|---|---|---|---|');
  const L2 = {}, L2runs = {}; for (const v of V3){ log(`שכבה 2 ${v.key}`); L2runs[v.key] = simulate(AC, { ...v, allow: allowC }); L2[v.key] = stats(L2runs[v.key], P2); L.push(row(v.lab, L2[v.key], ['val22', 'test', 's22'])); }
  const BT2 = stats({ series: btcSeries(AC) }, P2); L.push(`| BTC קנה והחזק | ${['val22', 'test', 's22'].map((k) => `${pct(BT2[k].cagr)} / ${f2(BT2[k].sharpe)} / ${pct(-BT2[k].maxDD)}`).join(' | ')} | — | — |`);
  L.push('', '### שכבה 3 — + עלות לפי ספר הפקודות של Bybit (נמדד ב-13/11/2026), לפי גודל פקודה', '',
    'החלקה לכל מטבע = המחיר הממוצע בקנייה בגודל הזה מול אמצע הספר (500$ ו-1,000$ — לפי המדידה של 1,000$; מטבע בלי עומק — 300 נק׳ בסיס), ולפחות המודל. **ספר הפקודות של היום לא מייצג בהכרח את העבר** — לכן גם סעיף 3. גודל פקודה ≈ 3.6% מהתיק (1/7 × 25%): 500$ ≈ תיק של 14K$, 1,000$ ≈ 28K$, 5,000$ ≈ 140K$, 25,000$ ≈ 700K$.', '',
    '| גרסה | גודל פקודה | 1/2022→9/2024 | מבחן | מ-2022 | מחזור בשנה | עלות בשנה |', '|---|---|---|---|---|---|---|');
  const L3 = {}; for (const v of V3){ L3[v.key] = {}; for (const sz of SIZES){ log(`שכבה 3 ${v.key} ${sz}`); const s = stats(simulate(AC, { ...v, allow: allowC, C: bookCost(sz) }), P2); L3[v.key][sz] = s;
    L.push(`| ${v.lab} | ${sz.toLocaleString('en-US')}$ | ${['val22', 'test', 's22'].map((k) => `${pct(s[k].cagr)} / ${f2(s[k].sharpe)} / ${pct(-s[k].maxDD)}`).join(' | ')} | ${s.s22.turnYr?.toFixed(1)}× | ${pct(-s.s22.costYr)} |`); } }
  L.push('', '### שכבה 4 — נתוני ביצוע היסטוריים אמיתיים של Bybit', '', '**לא זמינים** בבדיקה הזו: אין לנו היסטוריה של ספר הפקודות או של הביצועים של Bybit בספוט, ואין חשבון שביצע את השיטה. השכבה הזו תתקבל רק ממסחר אמיתי או מדמו, שלא הופעלו (לפי ההנחיה).');
  RES.layers = { L1, L2, L3, BT, BT2 };

  // ---- 2. 1,000 בחירות אקראיות ----
  log(`אקראי: ${N} × 3`);
  const nW = Math.max(1, Math.min(cpus().length, 4)), self = fileURLToPath(import.meta.url);
  const runRand = (key) => Promise.all(Array.from({ length: nW }, (_, w) => new Promise((res, rej) => { const from = 1 + Math.floor(N * w / nW), to = 1 + Math.floor(N * (w + 1) / nW);
    const wk = new Worker(self, { workerData: { DATA, BYB, key, from, to, P: { s22: P.s22, test: P.test } } }); wk.on('message', res); wk.on('error', rej); }))).then((a) => a.flat());
  const pctile = (arr, x) => (arr.filter((q) => q < x).length + 0.5 * arr.filter((q) => q === x).length) / arr.length; // אחוזון (שוויון — חצי)
  const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  L.push('', `## 2. ${N} בחירות אקראיות לכל גרסה (שכבה 2: יקום Bybit לפי תאריכי רישום, אותם מסננים, אותו מספר מטבעות — רק הדירוג מוחלף בבחירה אקראית)`, '',
    '| גרסה | מדד | השיטה | אקראי: 5% / חציון / 95% | אחוזון השיטה |', '|---|---|---|---|---|');
  RES.rand = {};
  for (const v of V3){ const rr = await runRand(v.key), s = L2[v.key]; RES.rand[v.key] = { n: rr.length };
    for (const [m, lab, val] of [['s22', 'תשואה מ-2022', s.s22.cagr], ['test', 'תשואה במבחן', s.test.cagr], ['shS22', 'שארפ מ-2022', s.s22.sharpe]]){
      const a = rr.map((x) => x[m]).filter(Number.isFinite), p = pctile(a, val); RES.rand[v.key][m] = { p, q05: q(a, 0.05), q50: q(a, 0.5), q95: q(a, 0.95) };
      const fm = m === 'shS22' ? f2 : pct; L.push(`| ${v.lab} | ${lab} | ${fm(val)} | ${fm(q(a, 0.05))} / ${fm(q(a, 0.5))} / ${fm(q(a, 0.95))} | **${(p * 100).toFixed(1)}%** |`); } }

  // ---- 3. רגישות לעלויות (שכבה 2) ----
  L.push('', '## 3. רגישות לעלויות — שכבה 2 (לא מניחים שהעלות של היום מייצגת את העבר)', '', '| גרסה | ×1 | ×2 | ×3 | +10 נק׳ בסיס לכל צד | +25 | +50 |', '|---|---|---|---|---|---|---|');
  RES.cost = {};
  for (const v of V3){ const cells = [], rk = {};
    for (const [lab, o] of [['x1', { costMult: 1 }], ['x2', { costMult: 2 }], ['x3', { costMult: 3 }], ['p10', { C: extraCost(10) }], ['p25', { C: extraCost(25) }], ['p50', { C: extraCost(50) }]]){ log(`עלות ${v.key} ${lab}`);
      const s = stats(simulate(AC, { ...v, allow: allowC, ...o }), P2); rk[lab] = { s22: s.s22.cagr, test: s.test.cagr }; cells.push(`${pct(s.s22.cagr)} / ${pct(s.test.cagr)}`); }
    RES.cost[v.key] = rk; L.push(`| ${v.lab} | ${cells.join(' | ')} |`); }
  L.push('', '(כל תא: מ-2022 / מבחן.)');

  // ---- 4. יציבות השיפור של א' ----
  const yearly = (sr) => { const y = {}; for (const x of sr){ const k = yr(x.t); y[k] = (y[k] ?? 1) * (1 + x.net); } return y; };
  const b1 = simulate(AF, V3[0]), a1 = simulate(AF, V3[1]), b2 = L2runs.base, a2 = L2runs.A;
  const yb1 = yearly(b1.series), ya1 = yearly(a1.series), yb2 = yearly(b2.series), ya2 = yearly(a2.series), ybt = yearly(btcSeries(AF));
  const YS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  L.push('', '## 4. האם השיפור של א\' נשמר — לפי שנה, שוק עולה מול יורד, חלונות מתגלגלים, והוצאת כל מטבע', '', '| שנה | BTC | מקורית (שכבה 1) | א\' (שכבה 1) | א\' פחות מקורית | מקורית (שכבה 2) | א\' (שכבה 2) | א\' פחות מקורית |', '|---|---|---|---|---|---|---|---|');
  let up = [], dn = [];
  for (const y of YS){ const d1 = (ya1[y] ?? 1) - (yb1[y] ?? 1), has2 = y >= 2022, d2 = has2 ? (ya2[y] ?? 1) - (yb2[y] ?? 1) : null; (((ybt[y] ?? 1) - 1) >= 0 ? up : dn).push(d1);
    L.push(`| ${y} | ${pct((ybt[y] ?? 1) - 1)} | ${pct((yb1[y] ?? 1) - 1)} | ${pct((ya1[y] ?? 1) - 1)} | ${pct(d1)} | ${has2 ? pct((yb2[y] ?? 1) - 1) : '—'} | ${has2 ? pct((ya2[y] ?? 1) - 1) : '—'} | ${has2 ? pct(d2) : '—'} |`); }
  const winsY = YS.filter((y) => (ya1[y] ?? 1) > (yb1[y] ?? 1)).length;
  L.push('', `- **שנים שבהן א\' עדיפה על המקורית (שכבה 1):** ${winsY} מתוך ${YS.length}. בשנים ש-BTC עלה: ${up.filter((x) => x > 0).length}/${up.length}; בשנים ש-BTC ירד: ${dn.filter((x) => x > 0).length}/${dn.length}.`);
  // חלונות מתגלגלים: תשואה ו"ירידה מקסימלית" בכל 365 ימים
  const roll = (bs, as) => { const n = Math.min(bs.length, as.length), Eb = [], Ea = []; let e1 = 1, e2 = 1; for (let i = 0; i < n; i++){ Eb.push(e1 *= 1 + bs[i].net); Ea.push(e2 *= 1 + as[i].net); }
    let w = 0, c = 0, ddw = 0; for (let i = 365; i < n; i += 7){ c += 1; if (Ea[i] / Ea[i - 365] > Eb[i] / Eb[i - 365]) w += 1;
      const dd = (E) => { let pk = E[i - 365], m = 0; for (let j = i - 364; j <= i; j++){ pk = Math.max(pk, E[j]); m = Math.max(m, 1 - E[j] / pk); } return m; }; if (dd(Ea) < dd(Eb)) ddw += 1; } return { w, c, ddw }; };
  const r1 = roll(b1.series.filter((x) => x.t >= Date.UTC(2017, 0, 1)), a1.series.filter((x) => x.t >= Date.UTC(2017, 0, 1))), r2 = roll(b2.series.filter((x) => x.t >= Date.UTC(2022, 0, 1)), a2.series.filter((x) => x.t >= Date.UTC(2022, 0, 1)));
  L.push(`- **חלונות של 12 חודשים (כל שבוע):** שכבה 1 (מ-2017) — א' עם תשואה גבוהה יותר ב-${Math.round(r1.w / r1.c * 100)}% מהחלונות, וירידה קטנה יותר ב-${Math.round(r1.ddw / r1.c * 100)}%. שכבה 2 (מ-2022) — תשואה גבוהה יותר ב-${Math.round(r2.w / r2.c * 100)}%, ירידה קטנה יותר ב-${Math.round(r2.ddw / r2.c * 100)}%.`);
  // הוצאת כל מטבע (שכבה 2): האם א' עדיין עדיפה מ-2022 (תשואה ושארפ)
  log('הוצאת כל מטבע');
  const coinsNoBtc = Object.keys(CUT).filter((c) => c !== 'BTC'), loo = [];
  for (const c of coinsNoBtc){ const bars = Object.fromEntries(Object.entries(CUT).filter(([k]) => k !== c)), AA = align(bars), al = (k, t) => t >= (listT[AA.coins[k]] ?? Infinity);
    const sb = dstats(simulate(AA, { ...V3[0], allow: al }).series, P.s22), sa = dstats(simulate(AA, { ...V3[1], allow: al }).series, P.s22); loo.push({ c, dC: sa.cagr - sb.cagr, dS: sa.sharpe - sb.sharpe, dD: sb.maxDD - sa.maxDD }); }
  loo.sort((x, y) => x.dC - y.dC);
  L.push(`- **הוצאת כל מטבע בתורו (${loo.length}, שכבה 2, מ-2022):** א' עם תשואה גבוהה יותר ב-${loo.filter((x) => x.dC > 0).length}/${loo.length}, שארפ גבוה יותר ב-${loo.filter((x) => x.dS > 0).length}/${loo.length}, ירידה קטנה יותר ב-${loo.filter((x) => x.dD > 0).length}/${loo.length}. ההפרש בתשואה נע בין ${pct(loo[0].dC)} (בלי ${loo[0].c}) ל-${pct(loo.at(-1).dC)} (בלי ${loo.at(-1).c}).`);
  RES.stability = { winsY, up, dn, r1, r2, loo };

  // ---- 5. מס בנפרד ----
  const i22 = AC.days.findIndex((t) => t >= Date.UTC(2022, 0, 1)), y22 = (AC.days.length - i22) / 365;
  const SC = [['פרטי, רווח הון 25%, דיווח ותשלום חצי-שנתי, העברת הפסדים', { rate: 0.25, period: 'semi', carry: true }], ['פרטי, 25% + מס יסף 5% = 30%', { rate: 0.30, period: 'semi', carry: true }], ['פרטי, סיווג כהכנסה מעסק ≈ 50% (מדרגה עליונה + יסף + ביטוח לאומי), שנתי', { rate: 0.50, period: 'annual', carry: true }],
    ['חברה בע"מ, 23% שנתי ובסוף דיבידנד 30%', { rate: 0.23, period: 'annual', carry: true, divRate: 0.30 }], ['חברה בע"מ, 23% והכסף נשאר בחברה', { rate: 0.23, period: 'annual', carry: true }]];
  L.push('', '## 5. מס — סימולציה נפרדת (לא ייעוץ מס)', '',
    '**ההנחות:** (1) כל מכירה או החלפת מטבע היא אירוע מס (כך נוהגת רשות המסים במטבעות דיגיטליים); (2) בסיס עלות ממוצע לכל מטבע; (3) הפסד ממומש מתקזז בתקופה ועובר קדימה; (4) המס משולם מהתיק במכירה יחסית; (5) בסוף מוכרים הכול; (6) משקיע שמתחיל ב-1/1/2022, שכבה 3 בפקודות של 1,000$.',
    '**למה זה טווח ולא מספר אחד:** מחזור של כ-11–18 פעמים ההון בשנה ומאות עסקאות בשנה עלולים להביא לסיווג **כעסק** (מס שולי ולא 25%). מס יסף תלוי בהכנסה הכוללת. בחברה יש דחיית מס עד החלוקה. לא כלול: תיאום אינפלציה, מקדמות, הוצאות מוכרות, אמנות מס ושינויי חקיקה. ההכרעה — רק עם רואה חשבון.', '',
    '| גרסה | בלי מס | ' + SC.map((s) => s[0]).join(' | ') + ' |', '|---|---|' + SC.map(() => '---').join('|') + '|');
  RES.tax = {};
  for (const v of V3){ const C1 = bookCost(1000), cells = [], rk = {}; const n0 = simulate(AC, { ...v, allow: allowC, C: C1, startIdx: i22 }).series.reduce((e, x) => e * (1 + x.net), 1);
    for (const [lab, t] of SC){ log(`מס ${v.key} ${lab.slice(0, 10)}`); const ti = simulate(AC, { ...v, allow: allowC, C: C1, startIdx: i22, tax: t }).taxInfo; const c = ti.net ** (1 / y22) - 1; rk[lab] = c; cells.push(pct(c)); }
    RES.tax[v.key] = rk; L.push(`| ${v.lab} | ${pct(n0 ** (1 / y22) - 1)} | ${cells.join(' | ')} |`); }

  // ---- 6. סיכום ראיות (עובדות בלבד; המסקנה — בדוח המחקר) ----
  const be = (r, A) => { const i = A.coins.indexOf('BTC'), sr = r.series; return sr.map((s, k) => { const d = k + 1, c0 = A.C[i][d - 1], c = A.C[i][d]; return { t: s.t, net: (k ? sr[k - 1].exp : 0) * (Number.isFinite(c0) && Number.isFinite(c) ? c / c0 - 1 : 0), cost: 0, fund: 0, gross: 0, turn: 0, exp: 0 }; }); };
  L.push('', '## 6. ראיות ליתרון אחרי עלויות — שכבה 3 (פקודות של 1,000$), מ-2022 ובמבחן', '', `| גרסה | מ-2022: תשואה / שארפ [95%] / ירידה | מבחן: תשואה / שארפ [95%] | BTC באותה חשיפה יומית: מ-2022 / מבחן | BTC קנה והחזק: מ-2022 / מבחן | אחוזון מול ${N} אקראיים (מ-2022 / מבחן, שכבה 2) |`, '|---|---|---|---|---|---|');
  for (const v of V3){ const r = simulate(AC, { ...v, allow: allowC, C: bookCost(1000) }), s22 = dstats(r.series, P.s22), st = dstats(r.series, P.test), e = be(r, AC), e22 = dstats(e, P.s22), et = dstats(e, P.test);
    L.push(`| ${v.lab} | ${pct(s22.cagr)} / ${f2(s22.sharpe)} ${ci(s22)} / ${pct(-s22.maxDD)} | ${pct(st.cagr)} / ${f2(st.sharpe)} ${ci(st)} | ${pct(e22.cagr)} / ${pct(et.cagr)} | ${pct(BT2.s22.cagr)} / ${pct(BT2.test.cagr)} | ${(RES.rand[v.key].s22.p * 100).toFixed(1)}% / ${(RES.rand[v.key].test.p * 100).toFixed(1)}% |`); }
  const md = L.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md); if (JOUT) writeFileSync(JOUT, JSON.stringify(RES, null, 1));
}
