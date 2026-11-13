#!/usr/bin/env node
// משימת מאיר (13/11/2026): "שיפור שיטת המומנטום בקריפטו — יעד מינימום 20% בשנה". 4 הגנות + 3 שילובים שנקבעו מראש (engine/xsra-protect.js,
// PROTECT/VERSIONS), מול המקורית, על אותם נתונים (50 מטבעות מ-Coinbase כולל שקרסו), עלויות מלאות, בלי מינוף. בלי כיוונון: כל הספים קבועים.
// בדיקות עמידות: ירידות 2020/2022/2024, ריכוז הפסדים לפי מטבע, הוצאת המטבע התורם ביותר, BTC באותה חשיפה יומית, בחירה אקראית (10 זרעים),
// עלויות ×2/×3, לפי שנה, חלונות מתגלגלים של שנה, חשיפה בימי ירידה, ריכוז ומתאם; Bybit: 38 מטבעות, שחזור לפי תאריך רישום, עלות לפי ספר
// הפקודות; מס: תרחישים לפרטי ולחברה. מחקר בלבד — אין פקודות, לא נוגע במעקב החי.
// שימוש: node invest-api/scripts/research-xs-protect.mjs --data xsra-data.json.gz --bybit invest/docs/research/xs-protect/bybit-probe.json [--out r.md] [--json r.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { align, dstats, DCOST } from '../engine/research-daily.js';
import { simulate, VERSIONS, PROTECT } from '../engine/xsra-protect.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'xsra-data.json.gz'), BYB = arg('--bybit', 'invest/docs/research/xs-protect/bybit-probe.json'), OUT = arg('--out', ''), JOUT = arg('--json', '');
const DAY = 86400e3, log = (...a) => console.error(...a);
const d0 = JSON.parse(gunzipSync(readFileSync(DATA))), byb = JSON.parse(readFileSync(BYB, 'utf8'));
for (const bars of Object.values(d0.bars)) for (const b of bars){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }
const ALL = d0.bars, A = align(ALL), K = A.coins.length, iB = A.coins.indexOf('BTC');
const iso = (t) => new Date(t).toISOString().slice(0, 10), ym = (t) => iso(t).slice(0, 7), yr = (t) => new Date(t).getUTCFullYear();
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
const f2 = (x) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '' : '−') + Math.abs(x).toFixed(2));
const od = A.days.filter((t) => t < Date.UTC(2026, 10, 7)), at = (k) => od[Math.floor(od.length * k)], LAST = A.days.at(-1) + DAY;
const P = { train: { from: A.days[0], to: at(0.6) }, val: { from: at(0.6), to: at(0.8) }, test: { from: at(0.8), to: LAST }, s22: { from: Date.UTC(2022, 0, 1), to: LAST }, all: { from: A.days[0], to: LAST } };
const NM = { train: 'אימון', val: 'אימות', test: 'מבחן', s22: 'מ-2022', all: '2016–2026' };
const lcg = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); };
const idxOf = (t) => A.days.findIndex((x) => x >= t);
const eqProd = (sr, from, to) => sr.filter((x) => x.t >= from && x.t < to).reduce((e, x) => e * (1 + x.net), 1);
const ddIn = (sr, from, to) => { let e = 1, pk = 1, dd = 0; for (const x of sr) if (x.t >= from && x.t < to){ e *= 1 + x.net; pk = Math.max(pk, e); dd = Math.max(dd, 1 - e / pk); } return dd; };

// ---- הרצות ----
const RES = {}, runs = {};
const run = (opt, bars = null) => simulate(bars ? align(bars) : A, opt);
for (const v of VERSIONS){ log(`גרסה ${v.key}`); runs[v.key] = simulate(A, { ...v, trace: true }); }
const S = (sr) => Object.fromEntries(Object.entries(P).map(([k, w]) => [k, dstats(sr, w)]));
const contribBy = (r, from = -Infinity, to = Infinity) => { const c = new Float64Array(K); for (let d = 1; d < A.days.length; d++){ const t = A.days[d]; if (t < from || t >= to) continue; for (let k = 0; k < K; k++) c[k] += r.contrib[d * K + k]; } return c; };
const without = (cs) => Object.fromEntries(Object.entries(ALL).filter(([k]) => !cs.includes(k)));

const L = ['# שיפור המומנטום המשודרג (7 מנות) — 4 הגנות ו-3 שילובים שנקבעו מראש, מול המקורית', '',
  `**נתונים:** ${K} מטבעות מ-Coinbase (כולל 30 שקרסו או שהמסחר בהם הופסק), נרות יומיים ${iso(A.days[0])} → ${iso(A.days.at(-1))}. **עלויות:** עמלת Taker 0.1% + החלקה 0.02% (BTC/ETH) / 0.05% (השאר) בכל קנייה ומכירה. בלי מינוף.`,
  `**תקופות:** אימון ${iso(P.train.from)}→${iso(P.train.to)} · אימות →${iso(P.val.to)} · מבחן ${iso(P.test.from)}→. **שימו לב:** כל התקופות כבר נחשפו במחקר הקודם (7יח) — אף תוצאה כאן אינה הוכחה עצמאית מחוץ למדגם. ההכרעה הסופית — רק על נתונים עתידיים.`,
  '**ההגנות (קבועות מראש, `PROTECT` ב-`engine/xsra-protect.js`):** א. תקרה 15% למטבע בכל 7 המנות יחד (נבדק בקנייה, לפי שווי שוק; לא מוכרים כדי לעקוף) · ב. יעד תנודתיות 40% לשנה (30 ימים, ביום ההחלפה של כל מנה, לעולם לא מעל המשקל המקורי) · ג. 30% BTC קבוע בלי מסנן + 70% לשיטה, חזרה ל-30/70 בתחילת כל רבעון · ד. סך האלטים עד 60% (בקנייה, וקיצוץ יחסי יומי). שילובים: א+ב, א+ד, א+ג.',
  '**יעדי המחקר (נקבעו מראש):** תשואה שנתית ≥ 20% בכל אחת משלוש התקופות (מועדף 30%), ירידה מקסימלית ≤ 35% בכל תקופה, שארפ ≥ 1.2 בכל תקופה, וגם: בלי המטבע התורם ביותר — מבחן ≥ 20%; ובעלויות ×2 — מבחן ומ-2022 ≥ 20%.', ''];

// ---- 1. טבלה ראשית ----
const rows = [];
for (const v of VERSIONS){
  const r = runs[v.key], st = S(r.series), yrs = r.series.length / 365;
  const months = {}; for (const x of r.series){ const m = ym(x.t); months[m] = (months[m] ?? 1) * (1 + x.net); }
  const worstM = Math.min(...Object.values(months).map((x) => x - 1));
  const years = {}; for (const x of r.series){ const y = yr(x.t); years[y] = (years[y] ?? 1) * (1 + x.net); }
  const fullY = Object.entries(years).filter(([y]) => +y >= 2017 && +y <= 2025), worstY = fullY.reduce((a, [y, x]) => (x - 1 < a[1] ? [y, x - 1] : a), [null, Infinity]);
  const c = contribBy(r), pos = [...c].filter((x) => x > 0).reduce((a, b) => a + b, 0), topK = [...c.keys()].filter((k) => k !== iB).sort((a, b) => c[b] - c[a])[0]; // BTC לא מוצא (המסנן נשען עליו)
  const turn = r.series.reduce((a, x) => a + x.turn, 0) / yrs, exp = r.series.filter((x) => x.t >= P.train.from).reduce((a, x) => a + x.exp, 0) / r.series.length;
  rows.push({ v, st, trades: r.trades / yrs, turn, exp, worstM, worstY, years, topCoin: A.coins[topK], topShare: c[topK] / pos });
}
L.push('## 1. טבלת השוואה — כל שמונה הגרסאות', '', '| גרסה | אימון: שנתי / שארפ / ירידה | אימות: שנתי / שארפ / ירידה | מבחן: שנתי / שארפ / ירידה | מ-2022: שנתי / ירידה | עסקאות בשנה | מחזור בשנה | חשיפה ממוצעת | חודש גרוע | שנה גרועה |', '|---|---|---|---|---|---|---|---|---|---|');
const cell = (s) => `${pct(s.cagr)} / ${f2(s.sharpe)} / ${pct(-s.maxDD)}`;
for (const x of rows) L.push(`| ${x.v.lab} | ${cell(x.st.train)} | ${cell(x.st.val)} | ${cell(x.st.test)} | ${pct(x.st.s22.cagr)} / ${pct(-x.st.s22.maxDD)} | ${Math.round(x.trades)} | ${x.turn.toFixed(1)}× | ${Math.round(x.exp * 100)}% | ${pct(x.worstM)} | ${x.worstY[0]} ${pct(x.worstY[1])} |`);
const btc = { series: (() => { const out = []; for (let d = 1; d < A.days.length; d++){ const c0 = A.C[iB][d - 1], c = A.C[iB][d]; out.push({ t: A.days[d], net: Number.isFinite(c0) && Number.isFinite(c) ? c / c0 - 1 : 0, cost: 0, fund: 0, gross: 0, turn: 0, exp: 1 }); } return out; })() };
const sb = S(btc.series); L.push(`| קנה והחזק BTC | ${cell(sb.train)} | ${cell(sb.val)} | ${cell(sb.test)} | ${pct(sb.s22.cagr)} / ${pct(-sb.s22.maxDD)} | — | — | 100% | — | — |`);
RES.main = rows.map((x) => ({ key: x.v.key, st: x.st, trades: x.trades, turn: x.turn, exp: x.exp, worstM: x.worstM, worstY: x.worstY, topCoin: x.topCoin, topShare: x.topShare }));

// ---- 2. לפי שנה ----
const YS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
L.push('', '## 2. לפי שנה', '', '| גרסה | ' + YS.join(' | ') + ' |', '|---|' + YS.map(() => '---').join('|') + '|');
for (const x of rows) L.push(`| ${x.v.lab} | ` + YS.map((y) => pct((x.years[y] ?? 1) - 1)).join(' | ') + ' |');
{ const by = {}; for (const x of btc.series){ const y = yr(x.t); by[y] = (by[y] ?? 1) * (1 + x.net); } L.push('| BTC | ' + YS.map((y) => pct((by[y] ?? 1) - 1)).join(' | ') + ' |'); }

// ---- 3. הירידות הגדולות + "האם ה-52% היה נמנע" ----
const EPI = [['2020', Date.UTC(2020, 0, 1), Date.UTC(2021, 0, 1)], ['2022 (11/2021–12/2022)', Date.UTC(2021, 10, 1), Date.UTC(2023, 0, 1)], ['2024 (3–10/2024)', Date.UTC(2024, 2, 1), Date.UTC(2024, 10, 1)]];
const P52 = [Date.UTC(2024, 2, 31), Date.UTC(2024, 7, 5) + DAY];
L.push('', '## 3. הירידות הגדולות — ירידה מקסימלית בתוך כל חלון, והירידה של 52% (31/3/2024 → 5/8/2024)', '', '| גרסה | ' + EPI.map((e) => e[0]).join(' | ') + ' | 31/3→5/8/2024 | המטבע שהזיק הכי הרבה ב-2024 |', '|---|' + EPI.map(() => '---').join('|') + '|---|---|');
for (const x of rows){ const r = runs[x.v.key], c = contribBy(r, P52[0], P52[1]), worst = [...c.keys()].sort((a, b) => c[a] - c[b])[0];
  L.push(`| ${x.v.lab} | ` + EPI.map((e) => pct(-ddIn(r.series, e[1], e[2]))).join(' | ') + ` | ${pct(eqProd(r.series, P52[0], P52[1]) - 1)} | ${A.coins[worst]} ${pct(c[worst])} |`); }
L.push(`| BTC | ` + EPI.map((e) => pct(-ddIn(btc.series, e[1], e[2]))).join(' | ') + ` | ${pct(eqProd(btc.series, P52[0], P52[1]) - 1)} | — |`);

// ---- 4. מה ההגנה עלתה: רווחים שהוקטנו, הפסדים שנמנעו (מול המקורית, סכום תרומות יומיות לפי מטבע) ----
L.push('', '## 4. מחיר ההגנה מול המקורית (סכום תרומות יומיות של כל מטבע, נקודות אחוז מההון; 2016–2026)', '', '| גרסה | רווחים שהוקטנו | הפסדים שנמנעו | נטו | ב-31/3→5/8/2024: הפסדים שנמנעו |', '|---|---|---|---|---|');
const base = runs.base;
for (const x of rows.slice(1)){ const r = runs[x.v.key]; let lostG = 0, savedL = 0, epiSaved = 0;
  for (let d = 1; d < A.days.length; d++) for (let k = 0; k < K; k++){ const b = base.contrib[d * K + k], p = r.contrib[d * K + k]; if (b > 0) lostG += Math.max(0, b - p); else if (b < 0) { savedL += Math.max(0, p - b); if (A.days[d] >= P52[0] && A.days[d] < P52[1]) epiSaved += Math.max(0, p - b); } }
  L.push(`| ${x.v.lab} | ${pct(-lostG)} | ${pct(savedL)} | ${pct(savedL - lostG)} | ${pct(epiSaved)} |`); }

// ---- 5. תלות במטבע בודד: הוצאת המטבע התורם ביותר, ו-ZEC ----
L.push('', '## 5. תלות במטבע בודד — מוציאים את המטבע (שאינו BTC) שתרם הכי הרבה בכל גרסה, ואת ZEC', '', '| גרסה | המטבע התורם (חלק מהרווחים) | בלי המטבע: מבחן / מ-2022 / ירידה מבחן | בלי ZEC: מבחן / מ-2022 |', '|---|---|---|---|');
RES.loo = {};
for (const x of rows){ log(`הוצאת מטבע ${x.v.key}`); const a1 = S(run(x.v, without([x.topCoin])).series), a2 = x.topCoin === 'ZEC' ? a1 : S(run(x.v, without(['ZEC'])).series);
  RES.loo[x.v.key] = { coin: x.topCoin, test: a1.test.cagr, s22: a1.s22.cagr, zecTest: a2.test.cagr, zecS22: a2.s22.cagr };
  L.push(`| ${x.v.lab} | ${x.topCoin} (${Math.round(x.topShare * 100)}%) | ${pct(a1.test.cagr)} / ${pct(a1.s22.cagr)} / ${pct(-a1.test.maxDD)} | ${pct(a2.test.cagr)} / ${pct(a2.s22.cagr)} |`); }

// ---- 6. BTC באותה חשיפה יומית, ובחירה אקראית ----
L.push('', '## 6. מול BTC באותה חשיפה יומית, ומול בחירה אקראית (אותם מסננים, אותו מספר מטבעות, 10 זרעים)', '', '| גרסה | BTC באותה חשיפה: מבחן / מ-2022 / ירידה מ-2022 | אקראי — חציון: מבחן / מ-2022 | אקראי — הטוב מ-10: מבחן | הגרסה מעל כמה מ-10 האקראיים (מבחן / מ-2022) |', '|---|---|---|---|---|');
RES.rand = {};
for (const x of rows){ const r = runs[x.v.key]; const be = r.series.map((s, i) => ({ t: s.t, net: (i ? r.series[i - 1].exp : 0) * btc.series[i].net, cost: 0, fund: 0, gross: 0, turn: 0, exp: 0 })); const sbe = S(be);
  const rr = []; for (let seed = 1; seed <= 10; seed++){ log(`אקראי ${x.v.key} ${seed}`); rr.push(S(simulate(A, { ...x.v, rng: (j) => lcg(seed * 7919 + j * 104729) }).series)); }
  const med = (f) => { const a = rr.map(f).sort((p, q) => p - q); return (a[4] + a[5]) / 2; }, beat = (f, v0) => rr.filter((q) => f(q) < v0).length;
  RES.rand[x.v.key] = { medTest: med((q) => q.test.cagr), medS22: med((q) => q.s22.cagr), beatTest: beat((q) => q.test.cagr, x.st.test.cagr), beatS22: beat((q) => q.s22.cagr, x.st.s22.cagr) };
  L.push(`| ${x.v.lab} | ${pct(sbe.test.cagr)} / ${pct(sbe.s22.cagr)} / ${pct(-sbe.s22.maxDD)} | ${pct(RES.rand[x.v.key].medTest)} / ${pct(RES.rand[x.v.key].medS22)} | ${pct(Math.max(...rr.map((q) => q.test.cagr)))} | ${RES.rand[x.v.key].beatTest}/10 · ${RES.rand[x.v.key].beatS22}/10 |`); }

// ---- 7. רגישות לעלויות ----
L.push('', '## 7. רגישות לעלויות (עמלה + החלקה × 2 ו-× 3)', '', '| גרסה | ×1: מבחן / מ-2022 | ×2: מבחן / מ-2022 | ×3: מבחן / מ-2022 |', '|---|---|---|---|');
RES.cost = {};
for (const x of rows){ const c2 = S(simulate(A, { ...x.v, costMult: 2 }).series), c3 = S(simulate(A, { ...x.v, costMult: 3 }).series); RES.cost[x.v.key] = { c2test: c2.test.cagr, c2s22: c2.s22.cagr };
  L.push(`| ${x.v.lab} | ${pct(x.st.test.cagr)} / ${pct(x.st.s22.cagr)} | ${pct(c2.test.cagr)} / ${pct(c2.s22.cagr)} | ${pct(c3.test.cagr)} / ${pct(c3.s22.cagr)} |`); }

// ---- 8. יציבות: חלונות מתגלגלים של שנה, חשיפה בימי ירידה, ריכוז ומתאם ----
L.push('', '## 8. יציבות וריכוז', '', '| גרסה | חלונות של 12 חודשים (מ-2017): חיוביים / חציון / הגרוע | ימים שבהם BTC ירד 3%+: חשיפה ממוצעת / תשואה ממוצעת | מספר מטבעות אפקטיבי (חציון) | מתאם ממוצע בין המטבעות המוחזקים (60 יום) |', '|---|---|---|---|---|');
const rets = (sr) => sr.map((x) => x.net);
for (const x of rows){ const r = runs[x.v.key], sr = r.series, E = []; let e = 1; for (const s of sr) E.push((e *= 1 + s.net));
  const i0 = sr.findIndex((s) => s.t >= Date.UTC(2017, 0, 1)), roll = []; for (let i = i0 + 365; i < sr.length; i += 7) roll.push(E[i] / E[i - 365] - 1); roll.sort((a, b) => a - b);
  let nd = 0, expD = 0, retD = 0; for (let i = 1; i < sr.length; i++) if (btc.series[i].net < -0.03){ nd += 1; expD += sr[i - 1].exp; retD += sr[i].net; }
  const effN = [], corr = [];
  for (let d = 400; d < A.days.length; d += 7){ const w = []; let inv = 0; for (let k = 0; k < K; k++){ const q = r.wtr[d * K + k]; if (q > 0.005){ w.push([k, q]); inv += q; } } if (inv < 0.2) continue; effN.push(1 / w.reduce((a, [, q]) => a + (q / inv) ** 2, 0));
    if (w.length > 1){ let s = 0, n = 0; for (let a = 0; a < w.length; a++) for (let b = a + 1; b < w.length; b++){ const ra = [], rb = []; for (let i = d - 59; i <= d; i++){ ra.push(A.C[w[a][0]][i] / A.C[w[a][0]][i - 1] - 1); rb.push(A.C[w[b][0]][i] / A.C[w[b][0]][i - 1] - 1); }
      const ma = ra.reduce((p, q) => p + q, 0) / 60, mb = rb.reduce((p, q) => p + q, 0) / 60; let cv = 0, va = 0, vb = 0; for (let i = 0; i < 60; i++){ cv += (ra[i] - ma) * (rb[i] - mb); va += (ra[i] - ma) ** 2; vb += (rb[i] - mb) ** 2; } const c = cv / Math.sqrt(va * vb); if (Number.isFinite(c)){ s += c; n += 1; } } if (n) corr.push(s / n); } }
  const md = (a) => { const b = a.slice().sort((p, q) => p - q); return b.length ? b[Math.floor(b.length / 2)] : null; };
  L.push(`| ${x.v.lab} | ${Math.round(roll.filter((q) => q > 0).length / roll.length * 100)}% / ${pct(md(roll))} / ${pct(roll[0])} | ${Math.round(expD / nd * 100)}% / ${pct(retD / nd)} (${nd} ימים) | ${f2(md(effN))} | ${f2(corr.reduce((a, b) => a + b, 0) / corr.length)} |`); }

// ---- 9. Bybit ----
const BY = Object.keys(byb.listing), listT = Object.fromEntries(Object.entries(byb.listing).map(([c, d]) => [c, Date.parse(d + 'T00:00:00Z')]));
const BYBARS = Object.fromEntries(Object.entries(ALL).filter(([c]) => BY.includes(c)));
L.push('', '## 9. התאמה ל-Bybit (בדיקות רגישות — לא שחזור היסטורי מלא)', '',
  `- **38 המטבעות שנסחרים היום בספוט של Bybit** (חסרים: ${byb.missing.join(', ')}). מטבעות שהוסרו מ-Bybit לא ניתנים לשחזור — Bybit לא מחזירה אותם.`,
  '- **שחזור זמינות:** מטבע נכנס ליקום רק מתאריך הנר הראשון שלו בספוט של Bybit (BTC/ETH: 5/7/2021); לפני כן — מזומן. התוצאה רלוונטית רק מסוף 2021.',
  '- **עלות לפי ספר הפקודות (היום):** החלקה לכל מטבע = המחיר הממוצע בקנייה של 5,000$ מול אמצע הספר, במקום 0.02%/0.05%. נמדד היום בלבד — ההיסטוריה לא ידועה.', '',
  '| גרסה | 50 מטבעות: מבחן / מ-2022 / ירידה מ-2022 | 38 של Bybit (כל ההיסטוריה): מבחן / מ-2022 / ירידה | Bybit עם תאריכי רישום: מבחן / מ-2022 / ירידה | Bybit + תאריכים + עלות לפי ספר הפקודות: מבחן / מ-2022 |', '|---|---|---|---|---|');
const slipBook = Object.fromEntries(BY.map((c) => [c, byb.book[c]?.buy5k ?? 100]));
const COSTB = { ...DCOST, slipBps: Object.fromEntries(BY.map((c) => [c, Math.max(DCOST.slipBps[c] ?? DCOST.slipOther, slipBook[c])])) };
const AB = align(BYBARS), allowB = (k, t) => t >= (listT[AB.coins[k]] ?? Infinity);
RES.bybit = {};
for (const x of rows){ log(`Bybit ${x.v.key}`); const b1 = S(simulate(AB, x.v).series), b2 = S(simulate(AB, { ...x.v, allow: allowB }).series), b3 = S(simulate(AB, { ...x.v, allow: allowB, C: COSTB }).series);
  RES.bybit[x.v.key] = { u38: { test: b1.test.cagr, s22: b1.s22.cagr }, listed: { test: b2.test.cagr, s22: b2.s22.cagr, dd: b2.s22.maxDD }, book: { test: b3.test.cagr, s22: b3.s22.cagr } };
  L.push(`| ${x.v.lab} | ${pct(x.st.test.cagr)} / ${pct(x.st.s22.cagr)} / ${pct(-x.st.s22.maxDD)} | ${pct(b1.test.cagr)} / ${pct(b1.s22.cagr)} / ${pct(-b1.s22.maxDD)} | ${pct(b2.test.cagr)} / ${pct(b2.s22.cagr)} / ${pct(-b2.s22.maxDD)} | ${pct(b3.test.cagr)} / ${pct(b3.s22.cagr)} |`); }
L.push('', '**עלות ביצוע: המודל מול ספר הפקודות של Bybit היום (נק׳ בסיס מעל אמצע הספר, קנייה):**', '', '| מטבע | מרווח | 1,000$ | 5,000$ | 25,000$ | במודל | |', '|---|---|---|---|---|---|---|');
for (const c of BY){ const b = byb.book[c]; if (!b) continue; const m = DCOST.slipBps[c] ?? DCOST.slipOther, bad = b.buy5k != null && b.buy5k > 2 * m; if (!bad && !['BTC', 'ETH', 'SOL', 'XRP'].includes(c)) continue;
  L.push(`| ${c} | ${f2(b.spreadBps)} | ${f2(b.buy1k)} | ${f2(b.buy5k)} | ${b.buy25k == null ? 'אין עומק' : f2(b.buy25k)} | ${m} | ${bad ? '⚠️ יותר מפי 2 מהמודל' : ''} |`); }

// ---- 10. מס ----
const i22 = idxOf(Date.UTC(2022, 0, 1)), yrs22 = (A.days.length - i22) / 365, yrsAll = (A.days.length - 1) / 365;
const SCEN = [
  { k: 'cg25', lab: 'פרטי — רווח הון 25%, דיווח חצי-שנתי, העברת הפסדים', tax: { rate: 0.25, period: 'semi', carry: true } },
  { k: 'cg30', lab: 'פרטי — 25% + מס יסף 5% (הכנסה גבוהה) = 30%', tax: { rate: 0.30, period: 'semi', carry: true } },
  { k: 'biz', lab: 'פרטי — סיווג כעסק: מדרגה עליונה + יסף + ביטוח לאומי ≈ 50%, שנתי', tax: { rate: 0.50, period: 'annual', carry: true } },
  { k: 'co', lab: 'חברה — מס חברות 23% שנתי, ובסוף חלוקה: דיבידנד 30% (בעל מניות מהותי)', tax: { rate: 0.23, period: 'annual', carry: true, divRate: 0.30 } },
  { k: 'co0', lab: 'חברה — 23% בלבד, הכסף נשאר בחברה (בלי חלוקה)', tax: { rate: 0.23, period: 'annual', carry: true } },
];
const cagrOf = (m, y) => m ** (1 / y) - 1;
L.push('', '## 10. מס בישראל — תרחישים (לא ייעוץ מס; ההנחות בטבלה)', '',
  'בסיס עלות ממוצע לכל מטבע ברמת התיק; כל מכירה או החלפה היא אירוע מס; מס על הרווח הממומש נטו בכל תקופה, משולם מהתיק (מכירה יחסית); הפסד עובר לתקופות הבאות; בסוף מוכרים הכול. לא כלול: תיאום אינפלציה, מקדמות חודשיות של חברה (מקורבות לתשלום שנתי), הוצאות מוכרות, ושינויי חקיקה.', '',
  '| גרסה | בלי מס: מ-2022 / 2016–2026 | ' + SCEN.map((s) => s.lab).join(' | ') + ' |', '|---|---|' + SCEN.map(() => '---').join('|') + '|');
RES.tax = {};
for (const x of rows){ log(`מס ${x.v.key}`); const cells = [], rk = {};
  for (const sc of SCEN){ const a = simulate(A, { ...x.v, startIdx: i22, tax: sc.tax }).taxInfo, b = simulate(A, { ...x.v, tax: sc.tax }).taxInfo; const c22 = cagrOf(a.net, yrs22), cAll = cagrOf(b.net, yrsAll); rk[sc.k] = { s22: c22, all: cAll }; cells.push(`${pct(c22)} / ${pct(cAll)}`); }
  const n22 = simulate(A, { ...x.v, startIdx: i22 }).series.reduce((e, s) => e * (1 + s.net), 1); RES.tax[x.v.key] = rk;
  L.push(`| ${x.v.lab} | ${pct(cagrOf(n22, yrs22))} / ${pct(x.st.all.cagr)} | ${cells.join(' | ')} |`); }
L.push('', '(מ-2022 = משקיע שמתחיל ב-1/1/2022 עם כסף חדש. "2016–2026" = כל התקופה.)');

// ---- 11. עמידה ביעדים ----
L.push('', '## 11. עמידה ביעדי המחקר (נקבעו מראש)', '', '| גרסה | ≥20% בכל תקופה | ≥30% בכל תקופה | ירידה ≤35% בכל תקופה | שארפ ≥1.2 בכל תקופה | בלי המטבע התורם: מבחן ≥20% | עלויות ×2: מבחן ומ-2022 ≥20% | הכול |', '|---|---|---|---|---|---|---|---|');
const tri = ['train', 'val', 'test'], ok = (b) => (b ? '✅' : '❌');
RES.targets = {};
for (const x of rows){ const s = x.st, t = { c20: tri.every((k) => s[k].cagr >= 0.20), c30: tri.every((k) => s[k].cagr >= 0.30), dd: tri.every((k) => s[k].maxDD <= 0.35), sh: tri.every((k) => s[k].sharpe >= 1.2), loo: RES.loo[x.v.key].test >= 0.20, cost: RES.cost[x.v.key].c2test >= 0.20 && RES.cost[x.v.key].c2s22 >= 0.20 };
  t.all = t.c20 && t.dd && t.sh && t.loo && t.cost; RES.targets[x.v.key] = t;
  L.push(`| ${x.v.lab} | ${ok(t.c20)} | ${ok(t.c30)} | ${ok(t.dd)} | ${ok(t.sh)} | ${ok(t.loo)} | ${ok(t.cost)} | **${ok(t.all)}** |`); }
const md = L.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md); if (JOUT) writeFileSync(JOUT, JSON.stringify(RES, null, 1));
