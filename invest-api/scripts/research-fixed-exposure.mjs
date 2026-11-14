#!/usr/bin/env node
// ניסוי אחרון (בקשת מאיר 14/11/2026): חשיפה קבועה 35% ביטקוין / 15% אתריום / 50% מזומן, איזון חודשי — מול 70/30 פסיבי, מול 70/30 + ממוצע
// 200 (המקורי), ומול פסיבי בחשיפה הממוצעת של המקורי. הקריטריון שמור ב-engine/base-vt.js (FIX_PASS) לפני ההרצה. בלי סטופים, בלי מסננים
// ובלי ספים חדשים. בנוסף: תאריכי השיא והשפל של הירידה המקסימלית בכל חלון (בירור "61% מול 31%").
// שימוש: node invest-api/scripts/research-fixed-exposure.mjs --data xsra-data.json.gz [--out r.md] [--json r.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { align, runDaily, dstats } from '../engine/research-daily.js';
import { baseStrat, BASE, FIX, FIX_PASS } from '../engine/base-vt.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'xsra-data.json.gz'), OUT = arg('--out', ''), JOUT = arg('--json', '');
const DAY = 86400e3, WARM = 250, log = (...a) => console.error(...a);
const d0 = JSON.parse(gunzipSync(readFileSync(DATA)));
for (const c of ['BTC', 'ETH']) for (const b of d0.bars[c]){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }
const A = align({ BTC: d0.bars.BTC, ETH: d0.bars.ETH });
const first = Math.max(d0.bars.BTC[0].t, d0.bars.ETH[0].t), START = Math.floor(first / DAY) * DAY + WARM * DAY, LAST = A.days.at(-1) + DAY;
const W = { train: { from: START, to: Date.UTC(2022, 10, 18) }, val: { from: Date.UTC(2022, 10, 18), to: Date.UTC(2024, 10, 12) }, test: { from: Date.UTC(2024, 10, 12), to: LAST }, s22: { from: Date.UTC(2022, 0, 1), to: LAST }, all: { from: START, to: LAST } };
const WN = { train: 'אימון (עד 11/2022)', val: 'אימות 2022–2024', test: 'מבחן 2024–2026', s22: 'מ-2022', all: `הכול (מ-${new Date(START).toISOString().slice(0, 7)})` };
const iso = (t) => new Date(t).toISOString().slice(0, 10), yr = (t) => new Date(t).getUTCFullYear();
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
const f2 = (x) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '' : '−') + Math.abs(x).toFixed(2));
const yn = (b) => (b ? '✅' : '❌');
const runV = (o, P = BASE) => { const s = baseStrat(A, o, P); return runDaily(A, s, { drift: true, rebal: s.rebal, partial: true, trace: true }).series.filter((x) => x.t >= START); };
const ddWhen = (sr, w) => { let e = 1, pk = 1, pkT = null, best = 0, out = { dd: 0 }; const s = sr.filter((x) => x.t >= w.from && x.t < w.to);
  for (const x of s){ if (pkT === null) pkT = x.t; e *= 1 + x.net; if (e > pk){ pk = e; pkT = x.t; } const dd = 1 - e / pk; if (dd > best){ best = dd; out = { dd, peak: pkT, trough: x.t, pkE: pk }; } }
  if (out.trough){ let e2 = 1; out.rec = null; for (const x of s){ e2 *= 1 + x.net; if (x.t > out.trough && e2 >= out.pkE){ out.rec = x.t; break; } } } return out; };
const metrics = (sr) => { const o = {}; for (const [k, w] of Object.entries(W)){ const s = dstats(sr, w), dd = ddWhen(sr, w);
  o[k] = { cagr: s.cagr, maxDD: s.maxDD, calmar: s.maxDD > 0 ? Math.round(s.cagr / s.maxDD * 100) / 100 : null, sharpe: s.sharpe, vol: s.vol, exposure: s.exposure, cost: s.costTotal, peak: dd.peak ? iso(dd.peak) : null, trough: dd.trough ? iso(dd.trough) : null, rec: dd.rec ? iso(dd.rec) : null }; }
  const m = new Map(); for (const x of sr){ const y = yr(x.t); m.set(y, (m.get(y) ?? 1) * (1 + x.net)); } o.yearly = Object.fromEntries([...m].map(([y, e]) => [y, Math.round((e - 1) * 1000) / 1000])); return o; };
const V = {};
const add = (key, name, o, P) => { V[key] = { name, m: metrics(runV(o, P)) }; log(key, pct(V[key].m.all.cagr), pct(-V[key].m.all.maxDD)); };
add('P', '70/30 פסיבי', { kind: 'passive' });
add('S200', '70/30 + ממוצע 200 (המקורי)', { n: 200 });
add('FIX', '35% ביטקוין / 15% אתריום / 50% מזומן — הניסוי', { kind: 'passive' }, { ...BASE, ...FIX });
const ex = V.S200.m.all.exposure; // החשיפה הממוצעת של המקורי על כל התקופה
add('PE', `פסיבי בחשיפה ${Math.round(ex * 100)}% (כמו הממוצע של המקורי)`, { kind: 'passive' }, { ...BASE, wb: 0.7 * ex, we: 0.3 * ex });
const T3 = ['train', 'val', 'test'];
const A1 = T3.every((w) => V.FIX.m[w].maxDD <= FIX_PASS.maxDD), A2 = V.FIX.m.all.calmar >= V.S200.m.all.calmar, A3 = V.FIX.m.s22.calmar >= V.S200.m.s22.calmar;
const winsB = T3.filter((w) => V.S200.m[w].calmar > V.PE.m[w].calmar).length, B = winsB >= FIX_PASS.wins && V.S200.m.all.calmar > V.PE.m.all.calmar;
const VERDICT = { A1, A2, A3, A: A1 && A2 && A3, winsB, B };
log(JSON.stringify(VERDICT));
const L = [];
L.push('# חשיפה קבועה 35/15/50 מול 70/30 פסיבי, ממוצע 200 ופסיבי בחשיפה זהה (מחקר 7כה)', '',
  `נתונים: נרות יומיים של Coinbase, לוח משותף, מ-${iso(START)} עד ${iso(LAST - DAY)}. איזון חודשי (החלטה בסגירת היום האחרון בחודש, ביצוע בפתיחת הראשון) — אותם מועדים לכל התיקים. עמלה 0.1% + החלקה 0.02% לכל צד. מזומן בלי ריבית. בלי מס.`, '',
  `**הקריטריון (נשמר בקוד לפני ההרצה, \`FIX_PASS\` ב-engine/base-vt.js):**`, '',
  `- **א' — האם 35/15/50 הוא כלי סיכון טוב לפחות כמו ממוצע 200:** (1) ירידה מקסימלית ≤ ${FIX_PASS.maxDD * 100}% באימון, באימות ובמבחן · (2) תשואה ÷ ירידה על כל התקופה ≥ המקורי · (3) תשואה ÷ ירידה מ-2022 ≥ המקורי.`,
  `- **ב' — האם ממוצע 200 מוסיף ערך מעבר להקטנת חשיפה:** המקורי מול פסיבי באותה חשיפה ממוצעת (${Math.round(ex * 100)}%) — תשואה ÷ ירידה גבוהה בלפחות ${FIX_PASS.wins} מ-3 התקופות וגם על כל התקופה.`, '',
  '| | עמידה |', '|---|---|',
  `| א(1) ירידה ≤ 35% בכל תקופה | ${yn(A1)} (${T3.map((w) => pct(-V.FIX.m[w].maxDD)).join(' / ')}) |`,
  `| א(2) תשואה ÷ ירידה על הכול ≥ המקורי | ${yn(A2)} (${f2(V.FIX.m.all.calmar)} מול ${f2(V.S200.m.all.calmar)}) |`,
  `| א(3) תשואה ÷ ירידה מ-2022 ≥ המקורי | ${yn(A3)} (${f2(V.FIX.m.s22.calmar)} מול ${f2(V.S200.m.s22.calmar)}) |`,
  `| **א' עובר?** | ${VERDICT.A ? '**כן**' : '**לא**'} |`,
  `| ב' ממוצע 200 מול פסיבי באותה חשיפה | ${yn(B)} (${winsB} מ-3; הכול ${f2(V.S200.m.all.calmar)} מול ${f2(V.PE.m.all.calmar)}) |`, '');
for (const w of ['train', 'val', 'test', 's22', 'all']){
  L.push(`## ${WN[w]}`, '', '| | תשואה שנתית | ירידה מקס׳ | שיא | שפל | חזרה לשיא | תשואה ÷ ירידה | שארפ | תנודתיות | חשיפה | עלות |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const v of Object.values(V)){ const m = v.m[w]; L.push(`| ${v.name} | ${pct(m.cagr)} | ${pct(-m.maxDD)} | ${m.peak ?? '—'} | ${m.trough ?? '—'} | ${m.rec ?? 'עוד לא'} | ${f2(m.calmar)} | ${f2(m.sharpe)} | ${pct(m.vol)} | ${Math.round(m.exposure * 100)}% | ${pct(m.cost)} |`); }
  L.push('');
}
const ys = Object.keys(V.P.m.yearly).sort();
L.push('## תשואה לפי שנה', '', `| | ${ys.join(' | ')} |`, `|---|${ys.map(() => '---').join('|')}|`);
for (const v of Object.values(V)) L.push(`| ${v.name} | ${ys.map((y) => pct(v.m.yearly[y])).join(' | ')} |`);
L.push('', `(${ys[0]} חלקית — מ-${iso(START)}.) הירידה המקסימלית בכל חלון נמדדת רק בתוך החלון: ירידה שהתחילה לפני תחילת החלון לא נספרת בו.`, '');
const md = L.join('\n') + '\n';
if (OUT) writeFileSync(OUT, md); else process.stdout.write(md);
if (JOUT) writeFileSync(JOUT, JSON.stringify({ meta: { start: iso(START), last: iso(LAST - DAY), FIX, FIX_PASS, exposureS200: ex }, variants: V, verdict: VERDICT }, null, 1));
