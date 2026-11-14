#!/usr/bin/env node
// בקשת מאיר (14/11/2026): המומנטום המשודרג (7 מנות) עם ההגנות — תשואה לפי שנה, ו-50,000$ שהושקעו מתחילת השנה / לפני 2, 3, 4, 5 שנים:
// תשואה, עמלות, רווח באחוזים ובדולרים. בלי שינוי כללים: אותן גרסאות בדיוק כמו ב-7יט/7כ (engine/xsra-protect.js). מחקר בלבד.
// גרסה "מציאותית": 38 המטבעות של Bybit, כל מטבע רק מיום הרישום שלו בספוט, עלות לפי ספר הפקודות (פקודה של עד 5,000$ — תיק של 50K$
// מתחלק ל-7 מנות × 4 מטבעות, כ-1,800$ לפקודה; לוקחים את המדידה של 5,000$, שמרני). משקיע חדש: קונה הכול ביום ההתחלה, כולל העמלות.
// שימוש: node invest-api/scripts/research-xsra-50k.mjs --data xsra-data.json.gz --bybit invest/docs/research/xs-protect/bybit-probe.json [--out r.md] [--json r.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { align, DCOST } from '../engine/research-daily.js';
import { simulate, VERSIONS, CYCLES } from '../engine/xsra-protect.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const CYC = arg('--cycle', 'weekly'), CY = CYCLES[CYC] ? { cycle: CYCLES[CYC] } : {}; // --cycle monthly: אותו חישוב לאיזון החודשי (7כז)
const DATA = arg('--data', 'xsra-data.json.gz'), BYB = arg('--bybit', 'invest/docs/research/xs-protect/bybit-probe.json'), OUT = arg('--out', ''), JOUT = arg('--json', '');
const DAY = 86400e3, T21 = Date.UTC(2021, 0, 1), CAP = 50000, log = (...a) => console.error(...a);
const d0 = JSON.parse(gunzipSync(readFileSync(DATA))), byb = JSON.parse(readFileSync(BYB, 'utf8'));
for (const bars of Object.values(d0.bars)) for (const b of bars){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }
const ALL = Object.fromEntries(Object.entries(d0.bars).filter(([c]) => byb.listing[c]));
const CUT = Object.fromEntries(Object.entries(ALL).map(([c, b]) => [c, b.filter((x) => x.t >= T21)]).filter(([, b]) => b.length));
const listT = Object.fromEntries(Object.entries(byb.listing).map(([c, d]) => [c, Date.parse(d + 'T00:00:00Z')]));
const AF = align(ALL), AC = align(CUT), allowC = (k, t) => t >= (listT[AC.coins[k]] ?? Infinity);
const C5 = { ...DCOST, slipBps: Object.fromEntries(Object.keys(byb.listing).map((c) => { const m = byb.book[c]?.buy5k; return [c, Math.max(DCOST.slipBps[c] ?? DCOST.slipOther, m == null ? 300 : m)]; })) };
const V = ['base', 'A', 'B', 'AB'].map((k) => VERSIONS.find((v) => v.key === k));
const NAME = { base: 'בלי הגנות (המקורית)', A: 'א. תקרה 15% למטבע', B: 'ב. יעד תנודתיות 40%', AB: 'א+ב — שתי ההגנות שנבדקו באימות' };
const iso = (t) => new Date(t).toISOString().slice(0, 10), yr = (t) => new Date(t).getUTCFullYear();
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
const usd = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x < 0 ? '−' : ''}${Math.round(Math.abs(x)).toLocaleString('en-US')}$`);
const LASTT = AC.days.at(-1), NOW = new Date(LASTT);
const back = (y) => Date.UTC(NOW.getUTCFullYear() - y, NOW.getUTCMonth(), NOW.getUTCDate());
const STARTS = [['מתחילת השנה', Date.UTC(NOW.getUTCFullYear(), 0, 1)], ['לפני שנתיים', back(2)], ['לפני 3 שנים', back(3)], ['לפני 4 שנים', back(4)], ['לפני 5 שנים', back(5)]];
const yearly = (sr, from = -Infinity) => { const m = new Map(), f = new Map(); let E = 1;
  for (const x of sr){ if (x.t < from) continue; const y = yr(x.t); if (!m.has(y)) m.set(y, { e0: E, fee: 0 }); f.set(y, (f.get(y) ?? 0) + x.cost * E); E *= 1 + x.net; m.get(y).e1 = E; }
  return Object.fromEntries([...m].map(([y, v]) => [y, { ret: v.e1 / v.e0 - 1, feePct: (f.get(y) ?? 0) / v.e0 }])); };
const ddOf = (sr) => { let E = 1, pk = 1, dd = 0; for (const x of sr){ E *= 1 + x.net; pk = Math.max(pk, E); dd = Math.max(dd, 1 - E / pk); } return dd; };
// BTC קנה והחזק מאותו יום (קנייה בפתיחה, עמלה + החלקה)
const iB = AC.coins.indexOf('BTC'), btcFee = (DCOST.spotBps + DCOST.slipBps.BTC) / 1e4;
const btc = (si) => { const o = AC.O[iB][si], c = AC.C[iB].at(-1); let pk = 0, dd = 0; for (let d = si; d < AC.days.length; d++){ const x = AC.C[iB][d]; pk = Math.max(pk, x); dd = Math.max(dd, 1 - x / pk); } return { ret: (1 - btcFee) * c / o - 1, dd }; };
const RES = { meta: { last: iso(LASTT), cap: CAP, cost: 'ספר פקודות 5,000$' }, yearlyReal: {}, yearlyLong: {}, invest: {} };
for (const v of V){
  log(v.key);
  RES.yearlyReal[v.key] = yearly(simulate(AC, { ...v, ...CY, allow: allowC, C: C5 }).series);
  RES.yearlyLong[v.key] = yearly(simulate(AF, { ...v, ...CY }).series, Date.UTC(2017, 0, 1));
  RES.invest[v.key] = STARTS.map(([lab, t]) => { const si = AC.days.findIndex((x) => x >= t);
    const sr = simulate(AC, { ...v, ...CY, allow: allowC, C: C5, startIdx: si }).series.filter((x) => x.t >= AC.days[si]);
    let E = 1, fee = 0; for (const x of sr){ fee += x.cost * E; E *= 1 + x.net; } const yrs = sr.length / 365;
    return { lab, from: iso(AC.days[si]), ret: E - 1, cagr: yrs >= 1 ? E ** (1 / yrs) - 1 : null, fee: fee * CAP, end: E * CAP, profit: (E - 1) * CAP, dd: ddOf(sr), btc: btc(si) }; });
}
const L = [];
L.push(`# מומנטום משודרג (7 מנות) עם ההגנות — תשואה לפי שנה, ו-50,000$ מנקודות התחלה שונות${CYC === 'monthly' ? ' — איזון חודשי (7כז)' : ''}`, '',
  `נתונים עד ${iso(LASTT)}. **אותם כללים בדיוק כמו בסעיפים 7יט–7כ — בלי שום שינוי.** מחקר בלבד: אין פקודות ואין כסף אמיתי. **בלי מס** (במס של 25% נשאר בערך שליש פחות מהרווח — סעיף 7יז).`, '',
  '**הגרסה המציאותית:** 38 המטבעות שנסחרים בספוט של Bybit, כל מטבע רק מהיום שנרשם שם (לפני 7/2021 — מזומן), ועלות מסחר לפי ספר הפקודות של Bybit (עמלה 0.1% + החלקה לפי פקודה של 5,000$, ' +
  'שמרני לתיק של 50,000$). משקיע חדש קונה הכול ביום הראשון, והעמלות של הקנייה הראשונה כלולות.', '');
L.push('## 1. 50,000$ — כמה היה היום (הגרסה המציאותית)', '');
for (const v of V){
  L.push(`### ${NAME[v.key]}`, '', '| התחלה | מתאריך | היה היום | רווח בדולרים | רווח באחוזים | בשנה | עמלות ששולמו | ירידה מקסימלית בדרך | ביטקוין באותה תקופה: רווח / ירידה |', '|---|---|---|---|---|---|---|---|---|');
  for (const r of RES.invest[v.key]) L.push(`| ${r.lab} | ${r.from} | ${usd(r.end)} | ${usd(r.profit)} | ${pct(r.ret)} | ${r.cagr == null ? '—' : pct(r.cagr)} | ${usd(r.fee)} | ${pct(-r.dd)} | ${usd(r.btc.ret * CAP)} (${pct(r.btc.ret)}) / ${pct(-r.btc.dd)} |`);
  L.push('');
}
const ysR = [...new Set(V.flatMap((v) => Object.keys(RES.yearlyReal[v.key])))].sort(), ysL = [...new Set(V.flatMap((v) => Object.keys(RES.yearlyLong[v.key])))].sort();
L.push('## 2. תשואה לפי שנה — הגרסה המציאותית (Bybit, מ-2021)', '', 'בכל תא: תשואה בשנה (העמלות ששולמו באותה שנה, באחוזים מההון בתחילתה).', '', `| גרסה | ${ysR.join(' | ')} |`, `|---|${ysR.map(() => '---').join('|')}|`);
for (const v of V) L.push(`| ${NAME[v.key]} | ${ysR.map((y) => { const x = RES.yearlyReal[v.key][y]; return x ? `${pct(x.ret)} (${pct(-x.feePct)})` : '—'; }).join(' | ')} |`);
L.push('', `(${ysR[0]}: עד 7/2021 אין מטבעות רשומים ב-Bybit — מזומן; ${ysR.at(-1)} עד ${iso(LASTT)}.)`, '');
L.push('## 3. תשואה לפי שנה — היסטוריה ארוכה (מחירי Coinbase, אותם 38 מטבעות, כאילו היו זמינים מתחילת המסחר בהם; עלות לפי המודל)', '', '**פחות מציאותי** — רק להראות איך השיטה התנהגה בשנים מוקדמות.', '', `| גרסה | ${ysL.join(' | ')} |`, `|---|${ysL.map(() => '---').join('|')}|`);
for (const v of V) L.push(`| ${NAME[v.key]} | ${ysL.map((y) => { const x = RES.yearlyLong[v.key][y]; return x ? `${pct(x.ret)} (${pct(-x.feePct)})` : '—'; }).join(' | ')} |`);
L.push('');
const md = L.join('\n') + '\n';
if (OUT) writeFileSync(OUT, md); else process.stdout.write(md);
if (JOUT) writeFileSync(JOUT, JSON.stringify(RES, null, 1));
