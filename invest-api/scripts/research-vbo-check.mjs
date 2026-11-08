#!/usr/bin/env node
// בדיקת עמידות לבוט A (פריצת תנודתיות תוך-יומית, VBO0.7-ma20-BE) — בקשת מאיר (8/11): "כן, תריץ בדיקת עמידות על בוט A".
// אותה שאלה שהפילה את "3 המטבעות": האם התוצאה תלויה במזל של עוגן זמן (כאן: תחילת היום ב-00:00 UTC) או של פרמטר?
// בודקים: 24 שעות תחילת יום, k (חלק מטווח אתמול) 0.5–0.8, ממוצע 10/20/50 יום או בלי, כל מטבע לבד, ועלויות ×2. מחקר בלבד.
// שימוש: node invest-api/scripts/research-vbo-check.mjs --data hourly-data.json.gz [--out r.md]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { alignH, vboStrategy, indicators, runBars, recost, tstats } from '../engine/research-hourly.js';
import { dstats } from '../engine/research-daily.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'hourly-data.json.gz'), OUT = arg('--out', ''), DAY = 86400e3;
const d = JSON.parse(gunzipSync(readFileSync(DATA)));
const bars = Object.fromEntries(['BTC', 'ETH'].map((c) => [c, d.bars[c].map(([t, o, h, l, cl, v]) => ({ t, o, h, l, c: cl, v }))]));
const F = {}; for (const c of ['BTC', 'ETH']) F[c] = new Map(d.funding?.[c] || []);
const A = alignH(bars), I = indicators(A);
const days = [...new Set(A.T.map((t) => Math.floor(t / DAY) * DAY))], D = days.length, at = (k) => days[Math.min(D - 1, Math.floor(D * k))];
const P = { all: { from: days[0], to: days.at(-1) + DAY }, train: { from: days[0], to: at(0.6) }, val: { from: at(0.6), to: at(0.8) }, test: { from: at(0.8), to: days.at(-1) + DAY }, since22: { from: Date.UTC(2022, 0, 1), to: days.at(-1) + DAY } };
const iso = (t) => new Date(t).toISOString().slice(0, 10), pct = (x) => (x == null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
const fs = (x) => (x == null ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2)), fci = (c) => (c ? `[${fs(c[0])}, ${fs(c[1])}]` : '—');
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

function run(opts){
  const s = vboStrategy(A, opts, I), { daily, trades } = runBars(A, s, { funding: F });
  const st = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, dstats(daily, p)]));
  return { daily, st, tt: tstats(trades, P.test), ta: tstats(trades, P.all), c2: dstats(recost(daily, { mult: 2 }), P.test) };
}
const row = (lab, r) => `| ${lab} | ${pct(r.st.train.cagr)} | ${pct(r.st.val.cagr)} | **${pct(r.st.test.cagr)}** / ${fs(r.st.test.sharpe)} ${fci(r.st.test.ci)} / ${pct(-r.st.test.maxDD)} | ${r.tt.pf ?? '—'} (${r.tt.n}) | ${fs(r.c2.sharpe)} | ${pct(r.st.all.cagr)} / ${pct(-r.st.all.maxDD)} | ${pct(r.st.since22.cagr)} |`;
const HDR = ['| גרסה | אימון שנתי | אימות שנתי | מבחן: שנתי / שארפ [95%] / ירידה | מבחן: Profit Factor (עסקאות) | מבחן בעלויות ×2: שארפ | 2019–2026: שנתי / ירידה | מ-2022 שנתי |', '|---|---|---|---|---|---|---|---|'];
const L = [`# בדיקת עמידות — בוט A (פריצת תנודתיות תוך-יומית, BTC/ETH), ${iso(days[0])} → ${iso(days.at(-1))}`,
  `אימון ${iso(P.train.from)}→${iso(P.train.to)} · אימות →${iso(P.val.to)} · מבחן →${iso(days.at(-1))}. חוזה: Taker 0.055% + החלקה 0.02% לכל צד, Funding שעתי. "שעת תחילת היום" = השעה (UTC) שבה מתחיל "יום המסחר": פתיחת היום, טווח אתמול, ממוצע הסגירות והיציאה בסוף היום — כולם לפיה.`, ''];

// 1. 24 שעות תחילת יום — הגרסה שנבחרה (k=0.7, ממוצע 20)
L.push('## 1. שעת תחילת היום (k=0.7, ממוצע 20 יום, BTC+ETH)', ...HDR);
const byOff = [];
for (let o = 0; o < 24; o++){ const r = run({ k0: 0.7, maN: 20, offH: o }); byOff.push(r); L.push(row(`${String(o).padStart(2, '0')}:00 UTC (${String((o + 2) % 24).padStart(2, '0')}:00 שעון ישראל בחורף)${o === 0 ? ' ← הנבחרת' : ''}`, r)); }
const tS = byOff.map((r) => r.st.test.sharpe), tC = byOff.map((r) => r.st.test.cagr), aC = byOff.map((r) => r.st.all.cagr), s22 = byOff.map((r) => r.st.since22.cagr), pf = byOff.map((r) => r.tt.pf).filter((x) => x != null);
L.push('', `**סיכום 24 השעות:** מבחן חיובי ב-${tS.filter((x) => x > 0).length}/24 · שארפ במבחן: חציון ${fs(med(tS))}, טווח ${fs(Math.min(...tS))} עד ${fs(Math.max(...tS))} · תשואה שנתית במבחן: חציון ${pct(med(tC))}, טווח ${pct(Math.min(...tC))} עד ${pct(Math.max(...tC))} · Profit Factor במבחן: חציון ${med(pf)?.toFixed(2)} · 2019–2026: חציון ${pct(med(aC))} · מ-2022: חציון ${pct(med(s22))}, חיובי ב-${s22.filter((x) => x > 0).length}/24.`);

// 2. פרמטרים שכנים: k × ממוצע — בשעה 00:00 ובסיכום על כל 24 השעות
L.push('', '## 2. פרמטרים שכנים — k (חלק מטווח אתמול) × מסנן הממוצע', '| k | מסנן | 00:00 — מבחן: שנתי / שארפ / PF | כל 24 השעות — מבחן חיובי | חציון שארפ במבחן | חציון שנתי במבחן | חציון מ-2022 |', '|---|---|---|---|---|---|---|');
for (const k0 of [0.5, 0.6, 0.7, 0.8]) for (const ma of [10, 20, 50, null]){
  const rs = Array.from({ length: 24 }, (_, o) => run({ k0, filt: ma !== null, maN: ma ?? 20, offH: o })), r0 = rs[0];
  const ts = rs.map((r) => r.st.test.sharpe);
  L.push(`| ${k0} | ${ma ? `ממוצע ${ma}` : 'בלי'} | ${pct(r0.st.test.cagr)} / ${fs(r0.st.test.sharpe)} / ${r0.tt.pf ?? '—'} | ${ts.filter((x) => x > 0).length}/24 | ${fs(med(ts))} | ${pct(med(rs.map((r) => r.st.test.cagr)))} | ${pct(med(rs.map((r) => r.st.since22.cagr)))} |`);
}

// 3. כל מטבע לבד (k=0.7, ממוצע 20)
L.push('', '## 3. כל מטבע לבד (k=0.7, ממוצע 20)', '| מטבע | 00:00 — מבחן: שנתי / שארפ / PF | כל 24 השעות — מבחן חיובי | חציון שארפ במבחן | חציון 2019–2026 | חציון מ-2022 |', '|---|---|---|---|---|---|');
for (const [name, U] of [['BTC בלבד', [A.coins.indexOf('BTC')]], ['ETH בלבד', [A.coins.indexOf('ETH')]]]){
  const rs = Array.from({ length: 24 }, (_, o) => run({ k0: 0.7, maN: 20, offH: o, U })), r0 = rs[0], ts = rs.map((r) => r.st.test.sharpe);
  L.push(`| ${name} | ${pct(r0.st.test.cagr)} / ${fs(r0.st.test.sharpe)} / ${r0.tt.pf ?? '—'} | ${ts.filter((x) => x > 0).length}/24 | ${fs(med(ts))} | ${pct(med(rs.map((r) => r.st.all.cagr)))} | ${pct(med(rs.map((r) => r.st.since22.cagr)))} |`);
}

// 4. לפי שנה — חציון על פני 24 השעות, ליד 00:00
L.push('', '## 4. לפי שנה (k=0.7, ממוצע 20): 00:00 מול החציון והגרועה מבין 24 השעות');
const ys = [...new Set(days.map((x) => new Date(x).getUTCFullYear()))];
const yv = (r, y) => dstats(r.daily, { from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) }).total;
L.push('| | ' + ys.join(' | ') + ' |', '|---|' + ys.map(() => '---').join('|') + '|');
L.push('| 00:00 | ' + ys.map((y) => pct(yv(byOff[0], y))).join(' | ') + ' |');
L.push('| חציון 24 השעות | ' + ys.map((y) => pct(med(byOff.map((r) => yv(r, y))))).join(' | ') + ' |');
L.push('| הגרועה מבין 24 | ' + ys.map((y) => pct(Math.min(...byOff.map((r) => yv(r, y))))).join(' | ') + ' |');
const md = L.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md);
