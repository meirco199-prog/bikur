#!/usr/bin/env node
// מחקר 7לב (מאיר + GPT, 15/11/2026): בדיקת רגישות נוספת ונפרדת לגרסה א+ב של 7ל (38 מטבעות Bybit). לא סבב אופטימיזציה:
// אותה הרצה בדיוק כמו 7ל/7לא, בלי שום שינוי פרמטרים, ובלי לגעת במעקבים. ארבעה חלקים:
//  1. בדיקת לחץ: השמטה משותפת של XRP, XLM ו-SHIB (שלושת התורמים הגדולים ב-7לא). נבחרה אחרי שראינו את התוצאות — לא אימות בלתי תלוי.
//  2. כל 8,436 הצירופים של השמטת 3 מטבעות מתוך 38: התפלגות (חציון, אחוזונים 5 ו-95, הגרוע ביותר) ושיעור הצירופים שמעל ביטקוין.
//     אלה לא 8,436 ניסויים עצמאיים — כולם על אותם נתונים ואותה אסטרטגיה. זו בדיקת עמידות, לא הוכחה סטטיסטית.
//  3. ריכוז הרווח לפי שנה: תרומת 5 המטבעות המובילים בכל שנה קלנדרית בנפרד (התיק הרציף מ-2022).
//  4. ריכוז מול בחירה אקראית: 1,000 הרצות שבהן הבחירה אקראית מבין המועמדים שעברו את אותם מסננים (אותן משקלות, הגנות ועלויות).
// לכל קבוצה: תשואה שנתית, ירידה מקסימלית, שארפ ומחזור מסחר.
// הקריאה — נקבעה ונשמרה כאן לפני ההרצה (LOO3.read). תיאורית בלבד: שום פרמטר לא משתנה בעקבותיה.
// שימוש: node invest-api/scripts/research-bybit-loo3.mjs --data xsra-data.json.gz --bybit invest/docs/research/xs-protect/bybit-probe.json [--out r.md] [--json r.json] [--limit N]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { align, DCOST } from '../engine/research-daily.js';
import { simulate, VERSIONS } from '../engine/xsra-protect.js';

export const LOO3 = Object.freeze({
  version: 'AB', k: 3, stress: Object.freeze(['XRP', 'XLM', 'SHIB']), windows: Object.freeze(['מ-2022', 'שנתיים']), randomN: 1000, topN: 5,
  read: Object.freeze({
    stressAboveBtc: true,       // (א) בלי XRP+XLM+SHIB, מ-2022 — מעל ביטקוין: "הרווח שורד את הסרת המקורות הבולטים"
    comboShareAboveBtc: 0.90,   // (ב) לפחות 90% מצירופי ההשמטה, מ-2022 — מעל ביטקוין: "לא תלוי במספר קטן של מטבעות"
    concBand: Object.freeze([0.05, 0.95]), // (ג) חלק 5 המובילים מסך הרווחים (מ-2022) בתוך אחוזונים 5–95 של הבחירה האקראית: "ריכוז אופייני"
  }),
});
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'xsra-data.json.gz'), BYB = arg('--bybit', 'invest/docs/research/xs-protect/bybit-probe.json'), OUT = arg('--out', ''), JOUT = arg('--json', '');
const LIMIT = +arg('--limit', '0') || Infinity; // לפיתוח בלבד
const CAP = 50000, T22 = Date.UTC(2022, 0, 1), log = (...a) => console.error(...a);
// ---- בדיוק כמו 7ל/7לא ----
const d0 = JSON.parse(gunzipSync(readFileSync(DATA))), byb = JSON.parse(readFileSync(BYB, 'utf8'));
for (const bars of Object.values(d0.bars)) for (const b of bars){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }
const listT = Object.fromEntries(Object.entries(byb.listing).map(([c, d]) => [c, Date.parse(d + 'T00:00:00Z')]));
const CUT = Object.fromEntries(Object.entries(d0.bars).filter(([c]) => byb.listing[c]).map(([c, b]) => [c, b.filter((x) => x.t >= Date.UTC(2021, 0, 1))]).filter(([, b]) => b.length));
const A = align(CUT), allow = (k, t) => t >= (listT[A.coins[k]] ?? Infinity);
const C5 = { ...DCOST, slipBps: Object.fromEntries(Object.keys(byb.listing).map((c) => { const m = byb.book[c]?.buy5k; return [c, Math.max(DCOST.slipBps[c] ?? DCOST.slipOther, m == null ? 300 : m)]; })) };
const LAST = A.days.at(-1), NOW = new Date(LAST);
const back = (y) => Date.UTC(NOW.getUTCFullYear() - y, NOW.getUTCMonth(), NOW.getUTCDate());
const WIN = { 'מ-2022': T22, 'שנתיים': back(2), 'שנה אחרונה': back(1) };
const V = VERSIONS.find((v) => v.key === LOO3.version), K = A.coins.length, iB = A.coins.indexOf('BTC');
const SI = Object.fromEntries(Object.entries(WIN).map(([l, t]) => [l, A.days.findIndex((x) => x >= t)]));
const iso = (t) => new Date(t).toISOString().slice(0, 10), yr = (t) => new Date(t).getUTCFullYear();
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`), usd = (x) => (x == null ? '—' : `${x < 0 ? '−' : ''}${Math.round(Math.abs(x)).toLocaleString('en-US')}$`);
const f2 = (x) => (x == null || !Number.isFinite(x) ? '—' : x.toFixed(2));
const lcg = (seed) => { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }; // כמו ב-7כ
const q = (arr, p) => { const v = arr.slice().sort((a, b) => a - b); if (!v.length) return null; const i = (v.length - 1) * p, lo = Math.floor(i); return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (i - lo); };
const rankOf = (arr, x) => arr.filter((v) => v < x).length / arr.length; // אחוזון של x בתוך arr
log(`מטבעות: ${K}, ימים: ${A.days.length}, עד ${iso(LAST)}`);

// הרצה אחת ממשקיע חדש ב-si; skip = קבוצת אינדקסים שלא נכנסים ליקום; rngSeed = בחירה אקראית; detail = תרומה ועמלות לפי מטבע ויום
function run(si, { skip = null, rngSeed = null, detail = false } = {}){
  const al = skip ? (k, t) => !skip.has(k) && allow(k, t) : allow;
  const fees = detail ? new Float64Array(A.days.length * K) : null;
  const r = simulate(A, { ...V, allow: al, C: C5, startIdx: si, trace: detail, rng: rngSeed === null ? null : (j) => lcg(rngSeed * 7919 + j * 104729 + 17),
    onTrade: detail ? (e) => { if (e.d >= si) fees[e.d * K + e.k] += e.fee; } : null });
  let E = 1, pk = 1, dd = 0, turn = 0, s1 = 0, s2 = 0, n = 0; const prevE = detail ? new Float64Array(A.days.length) : null;
  for (let d = si; d < A.days.length; d++){ const x = r.series[d - 1]; if (prevE) prevE[d] = E; E *= 1 + x.net; pk = Math.max(pk, E); dd = Math.max(dd, 1 - E / pk); turn += x.turn; s1 += x.net; s2 += x.net * x.net; n++; }
  const y = n / 365, m = s1 / n, sd = Math.sqrt(Math.max(0, s2 / n - m * m) * n / (n - 1));
  const out = { end: E * CAP, ret: E - 1, cagr: y >= 0.9 ? E ** (1 / y) - 1 : null, dd, sharpe: sd > 0 ? m / sd * Math.sqrt(365) : null, turnYr: turn / y };
  if (detail) out.detail = { contrib: r.contrib, fees, prevE };
  return out;
}
// תרומה נטו לפי מטבע בטווח ימים [a, b) (דולרים)
function coinNet(D, a, b){
  const net = new Float64Array(K);
  for (let d = a; d < b; d++) for (let k = 0; k < K; k++){ const c = D.contrib[d * K + k], f = D.fees[d * K + k]; if (c) net[k] += c * D.prevE[d] * CAP; if (f) net[k] -= f * CAP; }
  return net;
}
function conc(net){
  const rows = [...net].map((x, k) => ({ coin: A.coins[k], net: x })).sort((a, b) => b.net - a.net);
  const total = rows.reduce((s, x) => s + x.net, 0), top = rows.slice(0, LOO3.topN), topNet = top.reduce((s, x) => s + x.net, 0), gains = rows.filter((x) => x.net > 0).reduce((s, x) => s + x.net, 0);
  return { total, top: top.map((x) => [x.coin, Math.round(x.net)]), topNet, shareOfNet: total > 0 ? topNet / total : null, shareOfGains: gains > 0 ? topNet / gains : null };
}
const btc = (si) => { const r = (1 - 0.0012) * A.C[iB].at(-1) / A.O[iB][si] - 1; let pk = 0, dd = 0; for (let d = si; d < A.days.length; d++){ pk = Math.max(pk, A.C[iB][d]); dd = Math.max(dd, 1 - A.C[iB][d] / pk); }
  const y = (A.days.length - si) / 365; return { end: (1 + r) * CAP, ret: r, cagr: (1 + r) ** (1 / y) - 1, dd }; };
const BTC = Object.fromEntries(Object.keys(WIN).map((l) => [l, btc(SI[l])]));
const pick = (x) => ({ end: x.end, ret: x.ret, cagr: x.cagr, dd: x.dd, sharpe: x.sharpe, turnYr: x.turnYr });

// ---- מלא ----
const FULL = Object.fromEntries(Object.keys(WIN).map((l) => [l, pick(run(SI[l]))]));
// ---- 1. בדיקת לחץ ----
const stressSkip = new Set(LOO3.stress.map((c) => A.coins.indexOf(c)).filter((k) => k >= 0));
const STRESS = Object.fromEntries(Object.keys(WIN).map((l) => [l, pick(run(SI[l], { skip: stressSkip }))]));
log('stress', JSON.stringify(STRESS['מ-2022']));
// ---- 2. כל הצירופים ----
const combos = []; for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) for (let c = b + 1; c < K; c++) combos.push([a, b, c]);
const COMBO = {};
for (const l of LOO3.windows){
  const rows = []; let n = 0;
  for (const cb of combos){ if (n++ >= LIMIT) break; const r = run(SI[l], { skip: new Set(cb) }); rows.push({ cb, ...pick(r) }); if (n % 1000 === 0) log(l, n); }
  const ends = rows.map((x) => x.end), stat = (key) => { const v = rows.map((x) => x[key]).filter((x) => x != null && Number.isFinite(x)); return { p5: q(v, 0.05), med: q(v, 0.5), p95: q(v, 0.95), min: Math.min(...v), max: Math.max(...v) }; };
  const sorted = rows.slice().sort((a, b) => a.end - b.end), name = (x) => x.cb.map((k) => A.coins[k]).join('+');
  COMBO[l] = { n: rows.length, aboveBtc: ends.filter((x) => x > BTC[l].end).length / rows.length, aboveCap: ends.filter((x) => x > CAP).length / rows.length,
    end: stat('end'), cagr: stat('cagr'), dd: stat('dd'), sharpe: stat('sharpe'), turnYr: stat('turnYr'),
    worst: sorted.slice(0, 10).map((x) => ({ drop: name(x), end: Math.round(x.end), dd: x.dd })), best: sorted.slice(-5).reverse().map((x) => ({ drop: name(x), end: Math.round(x.end), dd: x.dd })),
    ends: ends.map((x) => Math.round(x)) };
}
// ---- 3. ריכוז לפי שנה (התיק הרציף מ-2022) ----
const s22 = SI['מ-2022'], F = run(s22, { detail: true }), years = [...new Set(A.days.slice(s22).map(yr))];
const YEARS = years.map((y) => { const a = A.days.findIndex((t, d) => d >= s22 && yr(t) === y), b = A.days.findLastIndex((t) => yr(t) === y) + 1;
  return { year: y, from: iso(A.days[a]), to: iso(A.days[b - 1]), start: F.detail.prevE[a] * CAP, ...conc(coinNet(F.detail, a, b)) }; });
for (const Y of YEARS) Y.ret = Y.total / Y.start; // תרומה נטו של השנה ביחס לשווי בתחילת השנה = תשואת השנה
const ALLC = conc(coinNet(F.detail, s22, A.days.length));
// ---- 4. מול בחירה אקראית ----
const RND = [];
for (let s = 1; s <= Math.min(LOO3.randomN, LIMIT); s++){ const r = run(s22, { rngSeed: s, detail: true }); RND.push({ ...pick(r), ...conc(coinNet(r.detail, s22, A.days.length)) }); delete r.detail; if (s % 100 === 0) log('random', s); }
const rs = (key) => { const v = RND.map((x) => x[key]).filter((x) => x != null && Number.isFinite(x)); return { n: v.length, p5: q(v, 0.05), med: q(v, 0.5), p95: q(v, 0.95) }; };
const RAND = { end: rs('end'), cagr: rs('cagr'), dd: rs('dd'), sharpe: rs('sharpe'), turnYr: rs('turnYr'), shareOfGains: rs('shareOfGains'), shareOfNet: rs('shareOfNet'),
  rankEnd: rankOf(RND.map((x) => x.end), FULL['מ-2022'].end), rankSharpe: rankOf(RND.map((x) => x.sharpe ?? -Infinity), FULL['מ-2022'].sharpe),
  rankGains: rankOf(RND.map((x) => x.shareOfGains).filter((x) => x != null), ALLC.shareOfGains), aboveBtc: RND.filter((x) => x.end > BTC['מ-2022'].end).length / RND.length };
// ---- הקריאה שנקבעה מראש ----
const R = LOO3.read, W0 = 'מ-2022';
const VERD = { a: STRESS[W0].end > BTC[W0].end, b: COMBO[W0].aboveBtc >= R.comboShareAboveBtc, c: RAND.rankGains >= R.concBand[0] && RAND.rankGains <= R.concBand[1], cHigh: RAND.rankGains > R.concBand[1] };
log(JSON.stringify(VERD));
// ---- דוח ----
const mrow = (lab, x) => `| ${lab} | ${usd(x.end)} | ${pct(x.cagr)} | ${pct(-x.dd)} | ${f2(x.sharpe)} | פי ${x.turnYr != null ? x.turnYr.toFixed(1) : '—'} |`;
const L = ['# בדיקת רגישות נוספת לגרסה א+ב של 7ל — השמטת 3 מטבעות, ריכוז הרווח לפי שנה, ומול בחירה אקראית (מחקר 7לב)', '',
  `אותה הרצה בדיוק כמו גרסה א+ב של מחקר 7ל ו-7לא: 38 המטבעות של Bybit, כל מטבע מיום הרישום שלו, 7 מנות, החלפה שבועית, תקרה 15%, יעד תנודתיות 40%, עלות לפי ספר הפקודות, 50,000$, משקיע חדש בתחילת כל חלון. נרות יומיים של Coinbase עד ${iso(LAST)}. מחקר בלבד — שום פרמטר לא שונה, והמעקבים לא נגעו.`, '',
  '> **עמידות היסטורית אינה הוכחה סטטיסטית.** כל ההרצות כאן — 8,436 הצירופים, 1,000 ההרצות האקראיות — רצות על אותם נתונים ואותה תקופה. הן מראות עד כמה התוצאה רגישה לבחירת המטבעות, לא שהיתרון יימשך. בדיקת הלחץ (XRP+XLM+SHIB) נבחרה אחרי שראינו את התוצאות.', '',
  '## 1. בדיקת לחץ — בלי XRP, XLM ו-SHIB יחד', '', '| חלון | תיק מלא | בלי שלושתם | ביטקוין |', '|---|---|---|---|'];
for (const l of Object.keys(WIN)) L.push(`| ${l} | ${usd(FULL[l].end)} (${pct(FULL[l].ret)}) | ${usd(STRESS[l].end)} (${pct(STRESS[l].ret)}) | ${usd(BTC[l].end)} (${pct(BTC[l].ret)}) |`);
L.push('', '| מ-2022 | שווי | תשואה שנתית | ירידה מקס׳ | שארפ | מחזור בשנה |', '|---|---|---|---|---|---|', mrow('תיק מלא', FULL[W0]), mrow('בלי XRP+XLM+SHIB', STRESS[W0]), `| ביטקוין | ${usd(BTC[W0].end)} | ${pct(BTC[W0].cagr)} | ${pct(-BTC[W0].dd)} | — | — |`);
L.push('', `## 2. כל ${combos.length.toLocaleString('en-US')} הצירופים של השמטת 3 מטבעות`, '');
for (const l of LOO3.windows){ const c = COMBO[l];
  L.push(`### ${l} (${c.n.toLocaleString('en-US')} צירופים)`, '', `- **מעל ביטקוין (${usd(BTC[l].end)}):** ${Math.round(c.aboveBtc * 1000) / 10}% מהצירופים · **מעל 50,000$:** ${Math.round(c.aboveCap * 1000) / 10}%`, '',
    '| | הגרוע ביותר | אחוזון 5 | חציון | אחוזון 95 | הטוב ביותר | תיק מלא |', '|---|---|---|---|---|---|---|',
    `| שווי סופי | ${usd(c.end.min)} | ${usd(c.end.p5)} | ${usd(c.end.med)} | ${usd(c.end.p95)} | ${usd(c.end.max)} | ${usd(FULL[l].end)} |`,
    `| תשואה שנתית | ${pct(c.cagr.min)} | ${pct(c.cagr.p5)} | ${pct(c.cagr.med)} | ${pct(c.cagr.p95)} | ${pct(c.cagr.max)} | ${pct(FULL[l].cagr)} |`,
    `| ירידה מקס׳ (הגרועה ← הטובה) | ${pct(-c.dd.max)} | ${pct(-c.dd.p95)} | ${pct(-c.dd.med)} | ${pct(-c.dd.p5)} | ${pct(-c.dd.min)} | ${pct(-FULL[l].dd)} |`,
    `| שארפ | ${f2(c.sharpe.min)} | ${f2(c.sharpe.p5)} | ${f2(c.sharpe.med)} | ${f2(c.sharpe.p95)} | ${f2(c.sharpe.max)} | ${f2(FULL[l].sharpe)} |`,
    `| מחזור בשנה | פי ${c.turnYr.min.toFixed(1)} | פי ${c.turnYr.p5.toFixed(1)} | פי ${c.turnYr.med.toFixed(1)} | פי ${c.turnYr.p95.toFixed(1)} | פי ${c.turnYr.max.toFixed(1)} | פי ${FULL[l].turnYr.toFixed(1)} |`, '',
    `10 הצירופים הגרועים: ${c.worst.map((x) => `${x.drop} ${usd(x.end)}`).join(' · ')}`, '', `5 הטובים: ${c.best.map((x) => `${x.drop} ${usd(x.end)}`).join(' · ')}`, ''); }
L.push('## 3. ריכוז הרווח לפי שנה (התיק הרציף מ-2022, אחרי עמלות)', '', '| שנה | תשואת השנה | רווח נטו | 5 המובילים (נטו) | חלקם מהנטו | חלקם מסך הרווחים |', '|---|---|---|---|---|---|');
for (const Y of YEARS) L.push(`| ${Y.year}${Y.year === yr(LAST) ? ` (עד ${Y.to})` : ''} | ${pct(Y.ret)} | ${usd(Y.total)} | ${Y.top.map(([c, x]) => `${c} ${usd(x)}`).join(', ')} | ${Y.shareOfNet !== null ? Math.round(Y.shareOfNet * 100) + '%' : 'הנטו שלילי'} | ${Y.shareOfGains !== null ? Math.round(Y.shareOfGains * 100) + '%' : '—'} |`);
L.push(`| **כל התקופה** | ${pct(FULL[W0].ret)} | ${usd(ALLC.total)} | ${ALLC.top.map(([c, x]) => `${c} ${usd(x)}`).join(', ')} | ${Math.round(ALLC.shareOfNet * 100)}% | ${Math.round(ALLC.shareOfGains * 100)}% |`, '',
  `## 4. מול בחירה אקראית (${RND.length.toLocaleString('en-US')} הרצות, מ-2022)`, '',
  'בכל הרצה, ביום ההחלפה נבחרים באקראי אותו מספר מטבעות מבין המועמדים שעברו את אותם מסננים (ביטקוין מעל ממוצע 100, מטבע מעל ממוצע 50, 15 בנפח). המשקלות, ההגנות והעלויות זהים.', '',
  '| | אחוזון 5 | חציון | אחוזון 95 | השיטה (דירוג) | האחוזון של השיטה |', '|---|---|---|---|---|---|',
  `| שווי סופי | ${usd(RAND.end.p5)} | ${usd(RAND.end.med)} | ${usd(RAND.end.p95)} | ${usd(FULL[W0].end)} | ${Math.round(RAND.rankEnd * 100)} |`,
  `| תשואה שנתית | ${pct(RAND.cagr.p5)} | ${pct(RAND.cagr.med)} | ${pct(RAND.cagr.p95)} | ${pct(FULL[W0].cagr)} | — |`,
  `| ירידה מקס׳ | ${pct(-RAND.dd.p95)} | ${pct(-RAND.dd.med)} | ${pct(-RAND.dd.p5)} | ${pct(-FULL[W0].dd)} | — |`,
  `| שארפ | ${f2(RAND.sharpe.p5)} | ${f2(RAND.sharpe.med)} | ${f2(RAND.sharpe.p95)} | ${f2(FULL[W0].sharpe)} | ${Math.round(RAND.rankSharpe * 100)} |`,
  `| מחזור בשנה | פי ${RAND.turnYr.p5.toFixed(1)} | פי ${RAND.turnYr.med.toFixed(1)} | פי ${RAND.turnYr.p95.toFixed(1)} | פי ${FULL[W0].turnYr.toFixed(1)} | — |`,
  `| חלק 5 המובילים מסך הרווחים | ${Math.round(RAND.shareOfGains.p5 * 100)}% | ${Math.round(RAND.shareOfGains.med * 100)}% | ${Math.round(RAND.shareOfGains.p95 * 100)}% | ${Math.round(ALLC.shareOfGains * 100)}% | ${Math.round(RAND.rankGains * 100)} |`,
  `| חלק 5 המובילים מהנטו (רק כשהנטו חיובי, ${RAND.shareOfNet.n} הרצות) | ${Math.round(RAND.shareOfNet.p5 * 100)}% | ${Math.round(RAND.shareOfNet.med * 100)}% | ${Math.round(RAND.shareOfNet.p95 * 100)}% | ${Math.round(ALLC.shareOfNet * 100)}% | — |`, '',
  `ההרצות האקראיות שמעל ביטקוין: ${Math.round(RAND.aboveBtc * 100)}%.`, '',
  '## 5. הקריאה שנקבעה מראש (תיאורית — שום פרמטר לא משתנה)', '',
  `- **(א) בלי XRP+XLM+SHIB, מ-2022, מעל ביטקוין:** ${VERD.a ? '✅' : '❌'} (${usd(STRESS[W0].end)} מול ${usd(BTC[W0].end)})`,
  `- **(ב) לפחות ${R.comboShareAboveBtc * 100}% מצירופי ההשמטה מעל ביטקוין, מ-2022:** ${VERD.b ? '✅' : '❌'} (${Math.round(COMBO[W0].aboveBtc * 1000) / 10}%)`,
  `- **(ג) ריכוז הרווח בתוך אחוזונים ${R.concBand[0] * 100}–${R.concBand[1] * 100} של הבחירה האקראית:** ${VERD.c ? '✅ ריכוז אופייני לבחירה עם אותם מסננים' : VERD.cHigh ? '❌ הריכוז גבוה מהאקראי' : '❌ הריכוז נמוך מהאקראי'} (אחוזון ${Math.round(RAND.rankGains * 100)})`, '');
const md = L.join('\n') + '\n'; if (OUT) writeFileSync(OUT, md); else process.stdout.write(md);
if (JOUT) writeFileSync(JOUT, JSON.stringify({ LOO3, last: iso(LAST), FULL, BTC, STRESS, COMBO, YEARS, ALLC, RAND, VERD }, null, 1));
