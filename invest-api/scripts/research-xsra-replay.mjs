#!/usr/bin/env node
// בקשת מאיר (15/11/2026): "בדיוק של 100 אחוז" — כמה היה עושה המעקב של XSRA-7 עם 50,000$ מתחילת 2026 ומתחילת 2025.
// (1) שחזור מדויק: אותו קוד בדיוק כמו המעקב החי (engine/xsra-paper.js → step), יום אחרי יום, עם חלון של 150 נרות יומיים כמו
//     ב-scripts/xsra-paper.mjs, אותם 50 מועמדים מ-Coinbase, אותן עלויות. השוני היחיד: startUsd = 50,000 (ההחלטה הראשונה בסגירת 31/12).
// (2) לצורך השוואה: הגרסה המציאותית (Bybit, תאריכי רישום, ספר פקודות 5,000$) — בלי הגנות ועם א+ב (engine/xsra-protect.js). מחקר בלבד.
// שימוש: node invest-api/scripts/research-xsra-replay.mjs --data xsra-data.json.gz --bybit invest/docs/research/xs-protect/bybit-probe.json [--out r.md] [--json r.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { XSRAP, step, totalWeights } from '../engine/xsra-paper.js';
import { align, DCOST } from '../engine/research-daily.js';
import { simulate, VERSIONS } from '../engine/xsra-protect.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'xsra-data.json.gz'), BYB = arg('--bybit', 'invest/docs/research/xs-protect/bybit-probe.json'), OUT = arg('--out', ''), JOUT = arg('--json', '');
const DAY = 86400e3, CAP = 50000, log = (...a) => console.error(...a);
const d0 = JSON.parse(gunzipSync(readFileSync(DATA))), byb = JSON.parse(readFileSync(BYB, 'utf8'));
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`, usd = (x) => `${x < 0 ? '−' : ''}${Math.round(Math.abs(x)).toLocaleString('en-US')}$`;
const P = { ...XSRAP, startUsd: CAP };
const bars = Object.fromEntries(Object.entries(d0.bars).filter(([c]) => P.universe.includes(c)));
const lastT = bars.BTC.at(-1).t;
// (1) שחזור מדויק של המעקב
function replay(startT){ // ההחלטה הראשונה בסגירת היום שלפני startT
  const win = (endT) => Object.fromEntries(Object.entries(bars).map(([c, b]) => [c, b.filter((x) => x.t < endT && x.t >= endT - 150 * DAY)]).filter(([, b]) => b.length));
  let s = null, held = new Map(); const daily = [];
  for (let t = startT; t <= lastT + DAY; t += DAY){
    const r = step(s, win(t), P); s = r.state;
    for (const e of r.events) if (!e.same) for (const c of e.held) held.set(c, (held.get(c) || 0) + 1);
    if (r.processed) daily.push({ day: s.lastDay.slice(0, 10), equity: s.equity, btc: s.btcEquity }); // s.daily נחתך ל-500 — שומרים כאן הכול
  }
  const byYear = {}; let prevE = CAP, prevB = CAP;
  for (const x of daily){ const yy = x.day.slice(0, 4); byYear[yy] ??= { e0: prevE, b0: prevB }; byYear[yy].e1 = x.equity; byYear[yy].b1 = x.btc; prevE = x.equity; prevB = x.btc; }
  return { start: s.startDay, last: s.lastDay?.slice(0, 10), equity: s.equity, btc: s.btcEquity, costs: s.costsUsd, maxDD: s.maxDD, btcMaxDD: s.btcMaxDD,
    years: Object.fromEntries(Object.entries(byYear).map(([k, v]) => [k, { ret: v.e1 / v.e0 - 1, btc: v.b1 / v.b0 - 1 }])), now: totalWeights(s),
    changes: s.changes.filter((e) => !e.same).length, held: [...held].sort((a, b) => b[1] - a[1]).slice(0, 10) };
}
const STARTS = [['מתחילת 2026', Date.UTC(2026, 0, 1)], ['מתחילת 2025', Date.UTC(2025, 0, 1)]];
const REP = STARTS.map(([lab, t]) => { log('replay', lab); return { lab, ...replay(t) }; });
// (2) הגרסה המציאותית ב-Bybit
const listT = Object.fromEntries(Object.entries(byb.listing).map(([c, d]) => [c, Date.parse(d + 'T00:00:00Z')]));
const CUT = Object.fromEntries(Object.entries(d0.bars).filter(([c]) => byb.listing[c]).map(([c, b]) => [c, b.filter((x) => x.t >= Date.UTC(2021, 0, 1))]).filter(([, b]) => b.length));
for (const b of Object.values(CUT)) for (const x of b){ const lo = Math.min(x.o, x.c); if (x.l < 0.1 * lo) x.l = lo; }
const AC = align(CUT), allowC = (k, t) => t >= (listT[AC.coins[k]] ?? Infinity);
const C5 = { ...DCOST, slipBps: Object.fromEntries(Object.keys(byb.listing).map((c) => { const m = byb.book[c]?.buy5k; return [c, Math.max(DCOST.slipBps[c] ?? DCOST.slipOther, m == null ? 300 : m)]; })) };
const REAL = {};
for (const k of ['base', 'AB']){ const v = VERSIONS.find((x) => x.key === k); REAL[k] = STARTS.map(([lab, t]) => { const si = AC.days.findIndex((x) => x >= t);
  const sr = simulate(AC, { ...v, allow: allowC, C: C5, startIdx: si }).series.filter((x) => x.t >= AC.days[si]); let E = 1, fee = 0, pk = 1, dd = 0; const yy = {};
  for (const x of sr){ fee += x.cost * E; const y = new Date(x.t).getUTCFullYear(); yy[y] ??= { e0: E }; E *= 1 + x.net; yy[y].e1 = E; pk = Math.max(pk, E); dd = Math.max(dd, 1 - E / pk); }
  return { lab, equity: E * CAP, fee: fee * CAP, dd, years: Object.fromEntries(Object.entries(yy).map(([y, v]) => [y, v.e1 / v.e0 - 1])) }; }); }
// ---- דוח ----
const L = ['# XSRA-7 — 50,000$ מתחילת 2026 ומתחילת 2025', '',
  `נתונים: נרות יומיים של Coinbase עד ${iso(lastT)}. בלי מס. מחקר בלבד.`, '',
  '## 1. שחזור מדויק של המעקב החי', '', 'אותו קוד בדיוק כמו המעקב (`engine/xsra-paper.js`), יום אחרי יום, אותם 50 מועמדים, אותן עלויות (0.1% עמלה + 0.02%–0.05% החלקה). ההגנות שבנויות בשיטה: ביטקוין מעל ממוצע 100 (אחרת מזומן), מטבע מעל ממוצע 50 שלו, 7 מנות. **ההגנות א+ב (תקרה 15%, יעד תנודתיות) לא חלק מהמעקב.**', '',
  '| התחלה | שווה היום | רווח | עמלות ששולמו | ירידה מקסימלית | ביטקוין: שווה / ירידה | החלפות |', '|---|---|---|---|---|---|---|'];
for (const r of REP) L.push(`| ${r.lab} (${r.start}) | ${usd(r.equity)} | ${usd(r.equity - CAP)} (${pct(r.equity / CAP - 1)}) | ${usd(r.costs)} | ${pct(-r.maxDD)} | ${usd(r.btc)} (${pct(r.btc / CAP - 1)}) / ${pct(-r.btcMaxDD)} | ${r.changes} |`);
L.push('', '**לפי שנה (מהשחזור מתחילת 2025):** ' + Object.entries(REP[1].years).map(([y, v]) => `${y}: ${pct(v.ret)} (ביטקוין ${pct(v.btc)})`).join(' · '));
L.push('', `**המטבעות שנקנו הכי הרבה פעמים (מתחילת 2025):** ${REP[1].held.map(([c, n]) => `${c} (${n})`).join(', ')}`, `**מה מחזיק היום:** ${Object.keys(REP[0].now).length ? Object.entries(REP[0].now).map(([c, w]) => `${c} ${Math.round(w * 100)}%`).join(', ') : 'מזומן'}`, '');
L.push('## 2. לשם השוואה — הגרסה המציאותית ב-Bybit (38 מטבעות, תאריכי רישום, ספר פקודות)', '', '| גרסה | התחלה | שווה היום | רווח | עמלות | ירידה מקסימלית |', '|---|---|---|---|---|---|');
for (const k of ['base', 'AB']) for (const r of REAL[k]) L.push(`| ${k === 'base' ? 'בלי הגנות א+ב' : 'עם א+ב'} | ${r.lab} | ${usd(r.equity)} | ${usd(r.equity - CAP)} (${pct(r.equity / CAP - 1)}) | ${usd(r.fee)} | ${pct(-r.dd)} |`);
const md = L.join('\n') + '\n'; if (OUT) writeFileSync(OUT, md); else process.stdout.write(md);
if (JOUT) writeFileSync(JOUT, JSON.stringify({ replay: REP, real: REAL }, null, 1));
