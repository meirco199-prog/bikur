#!/usr/bin/env node
// מודל מס ל"3 המטבעות החזקים" (בקשת מאיר 13/11/2026, "משימה א'"): מס רווחי הון 25% בישראל — כל החלפה שבועית היא מכירה = אירוע מס,
// קיזוז הפסדים בתוך השנה, תשלום בתחילת השנה הבאה מתוך התיק (וזה פוגע בריבית דריבית). המנוע: runDaily(..., { tax }) ב-engine/research-daily.js.
// כל התוצאות אחרי עמלת Taker (ספוט 0.1%) והחלקה לכל צד, ובסוף התקופה מוכרים הכול (כולל המס על הרווח שעוד לא מומש), כדי להשוות
// הוגן לקנה-והחזק. כל חלון מחושב כמשקיע שמתחיל בתחילתו (tax.from). מחקר בלבד — אין פקודות.
// שימוש: node invest-api/scripts/research-xs-tax.mjs --data daily-data.json.gz [--out r.md] [--json r.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { align, strategies, runDaily } from '../engine/research-daily.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'daily-data.json.gz'), OUT = arg('--out', ''), JOUT = arg('--json', '');
const DAY = 86400e3, RATE = 0.25;
const d = JSON.parse(gunzipSync(readFileSync(DATA)));
for (const bars of Object.values(d.bars)) for (const b of bars){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
const pp = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}`);
const usd = (x) => `${Math.round(x).toLocaleString('en-US')}$`;

const base = align(d.bars), days = base.days, D = days.length, at = (k) => days[Math.min(D - 1, Math.floor(D * k))], END = days.at(-1) + DAY;
// אותה חלוקה כמו במחקר המקורי (crypto-daily.md / xs-check.md): אימון 60%, אימות 20%, מבחן 20% — המס הוא לא פרמטר שנבחר, אבל מציגים בנפרד
const W = [
  { id: 'all', lab: `כל התקופה ${iso(days[0]).slice(0, 4)}→${iso(days.at(-1)).slice(0, 7)}`, from: days[0], to: END },
  { id: 'train', lab: `אימון →${iso(at(0.6)).slice(0, 7)}`, from: days[0], to: at(0.6) },
  { id: 'val', lab: `אימות →${iso(at(0.8)).slice(0, 7)}`, from: at(0.6), to: at(0.8) },
  { id: 'test', lab: `מבחן ${iso(at(0.8)).slice(0, 7)}→`, from: at(0.8), to: END },
  { id: 's22', lab: 'מ-2022', from: Date.UTC(2022, 0, 1), to: END },
];
const V = [
  { lab: '**3 מטבעות — ראשון + משקלות שזזים (= המעקב)**', id: 'XS14-top3-f200', dow: 0, key: 'top3' },
  { lab: '3 מטבעות — שישי (כמו המחקר המקורי) + משקלות שזזים', id: 'XS14-top3-f200', dow: 5, key: 'top3fri' },
  { lab: '5 מטבעות — ראשון + משקלות שזזים', id: 'XS14-top5-f200', dow: 0, key: 'top5' },
  { lab: 'Donchian 20/10 על 20 מטבעות', id: 'DC20-10-EW', dow: null, key: 'dc' },
  { lab: 'קנה והחזק BTC', id: 'BH-BTC', dow: null, key: 'btc' },
  { lab: 'קנה והחזק — סל שווה של 20 המטבעות', id: 'BH-EW', dow: null, key: 'ew' },
];
const cut = (to) => Object.fromEntries(Object.entries(d.bars).map(([c, b]) => [c, b.filter((x) => x.t < to)]).filter(([, b]) => b.length));
const memo = new Map();
function run(v, w, tax){
  const A = w.to === END ? base : (memo.get(w.to) || memo.set(w.to, align(cut(w.to))).get(w.to));
  const s = strategies(A.coins, { rebalDow: v.dow }).find((q) => q.id === v.id);
  const r = runDaily(A, s, { drift: true, tax: { ...tax, from: w.from } }), ti = r.taxInfo;
  const n = r.series.filter((x) => x.t >= w.from).length, mult = ti.liq.net / ti.from;
  const paid = r.series.filter((x) => x.t >= w.from && x.tax > 0).map((x) => x.tax);
  return { n, mult, cagr: mult ** (365 / n) - 1, ti, series: r.series, paidN: paid.length };
}
const res = {};
const L = [`# מודל מס רווחי הון (25%) — "3 המטבעות החזקים" מול חלופות, ${iso(days[0])} → ${iso(days.at(-1))}`, '',
  '**איך מחושב:**',
  '- כל מכירה היא אירוע מס: החלפה שבועית, יציאה בגלל מסנן ה-200, איזון.',
  '- בסיס העלות הוא עלות ממוצעת לכל מטבע, והעמלות בתוך הבסיס ובתוך התמורה.',
  '- רווחים והפסדים ממומשים מתקזזים בתוך השנה הקלנדרית.',
  '- 25% מהרווח נטו משולמים ביום הראשון של השנה הבאה, מהמזומן. אם אין מספיק מזומן, מוכרים חלק יחסי מכל המטבעות, וגם המכירה הזו היא אירוע מס.',
  '- **"קיזוז בשנה"** (מה שהתבקש): הפסד שנתי נטו נמחק. **"העברה"**: הפסד הון עובר לשנים הבאות, כמו שהחוק בישראל מאפשר.',
  '- בסוף כל חלון מוכרים הכול ומשלמים מס גם על רווח שעוד לא מומש. כך קנה-והחזק (שלא משלם מס עד המכירה) מושווה הוגן.',
  '- כל חלון מחושב כמשקיע שמתחיל בתחילתו.',
  '- עמלת Taker של 0.1% (ספוט) והחלקה לכל צד: 0.02% ב-BTC/ETH ו-0.05% בשאר.',
  '- **לא כלול:** תיאום אינפלציה (מקטין מעט את המס), מס יסף של 3% על הכנסה גבוהה (מגדיל), ודיני מס של חברה.', '',
  '## 1. תשואה שנתית ממוצעת (CAGR): לפני מס ואחרי מס', '',
  '| גרסה | חלון | לפני מס | אחרי מס (קיזוז בשנה) | אחרי מס (העברת הפסדים) | פגיעה (נק׳ אחוז בשנה) | 10,000$ → לפני / אחרי |',
  '|---|---|---|---|---|---|---|'];
for (const v of V){
  res[v.key] = {};
  for (const w of W){
    const pre = run(v, w, { rate: 0 }), y = run(v, w, { rate: RATE }), f = run(v, w, { rate: RATE, carry: 'forward' });
    res[v.key][w.id] = { pre: pre.cagr, year: y.cagr, fwd: f.cagr, drag: y.cagr - pre.cagr, preMult: pre.mult, yearMult: y.mult, fwdMult: f.mult, years: (pre.n / 365).toFixed(1) };
    L.push(`| ${v.lab} | ${w.lab} | ${pct(pre.cagr)} | **${pct(y.cagr)}** | ${pct(f.cagr)} | ${pp(y.cagr - pre.cagr)} | ${usd(1e4 * pre.mult)} / ${usd(1e4 * y.mult)} |`);
  }
}
// לפי שנה: 3 המטבעות (המעקב) — תשואה לפני מס, המס ששולם בינואר (מההון באותו יום), ואחרי מס
L.push('', '## 2. לפי שנה — 3 מטבעות (ראשון + משקלות שזזים), כל התקופה', '',
  '| שנה | תשואה לפני מס | רווח ממומש (מההון בתחילת השנה) | מס ששולם בינואר הבא (מההון) | תשואה אחרי מס (כולל תשלום המס) |', '|---|---|---|---|---|');
{
  const v = V[0], w = W[0], pre = run(v, w, { rate: 0 }), y = run(v, w, { rate: RATE });
  const ys = [...new Set(days.map((x) => new Date(x).getUTCFullYear()))];
  const eqAt = (sr, t) => sr.filter((x) => x.t < t).reduce((e, x) => e * (1 + x.net), 1);
  const tot = (sr, yy) => { const s = sr.filter((x) => new Date(x.t).getUTCFullYear() === yy); return s.length >= 30 ? s.reduce((e, x) => e * (1 + x.net), 1) - 1 : null; };
  res.top3.byYear = [];
  for (const yy of ys){
    const ty = y.ti.years.find((q) => q.y === yy), e0 = eqAt(y.series, Date.UTC(yy, 0, 1));
    const realized = ty ? ty.realized / e0 : (y.ti.open.y === yy ? y.ti.open.realized / e0 : null);
    const paidNext = y.series.find((x) => x.t === Date.UTC(yy + 1, 0, 1))?.tax;
    const row = { y: yy, pre: tot(pre.series, yy), realized, taxNextJan: paidNext ?? null, post: tot(y.series, yy) };
    res.top3.byYear.push(row);
    L.push(`| ${yy} | ${pct(row.pre)} | ${pct(row.realized)} | ${paidNext ? pct(-paidNext) : (yy === y.ti.open.y ? 'בסוף (מכירה)' : '0')} | ${pct(row.post)} |`);
  }
}
// כמה פעמים בשנה נמכר משהו — המקור של "כל החלפה היא אירוע מס"
L.push('', '## 3. למה המס פוגע: מחזור מסחר', '');
for (const v of V.slice(0, 4)){
  const A = base, s = strategies(A.coins, { rebalDow: v.dow }).find((q) => q.id === v.id), r = runDaily(A, s, { drift: true });
  const turn = r.series.reduce((a, x) => a + x.turn, 0) / r.series.length * 365, sells = r.series.filter((x) => x.turn > 1e-9).length / r.series.length * 365;
  L.push(`- ${v.lab.replace(/\*/g, '')}: מחזור ${turn.toFixed(1)}× מההון בשנה, ימים עם קנייה/מכירה: ${sells.toFixed(0)} בשנה.`);
}
const md = L.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md); if (JOUT) writeFileSync(JOUT, JSON.stringify(res, null, 1));
