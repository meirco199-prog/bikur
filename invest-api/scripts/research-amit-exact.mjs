#!/usr/bin/env node
// "בוט כמו עמית בדיוק" — מחקר בלבד, אין פקודות ואין מפתחות. פרוטוקול נעול: invest/docs/research/amit-exact/PROTOCOL_v1.0.md
// שימוש: node --max-old-space-size=6500 invest-api/scripts/research-amit-exact.mjs --from 2020-01 --to 2026-10 --cache DIR --outdir DIR
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const D = (s) => Date.parse(`${s}T00:00:00Z`);
export const P = Object.freeze({ bbN: 20, bbK: 2, minWidthPct: 0.35, queuePct: 0.01, notional: 270000, slip: 0.02, gapMs: 30 * 60e3, chaseGrace: 15 });
export const PERIODS = { dev: { from: D('2020-01-01'), to: D('2024-01-01'), he: 'פיתוח 2020–2023' }, test: { from: D('2024-01-01'), to: D('2026-11-01'), he: 'מבחן 2024 → 10/2026' } };
export const COSTS = { amit: { maker: 0.014, taker: 0.035 }, ours: { maker: 0.0201, taker: 0.0562 }, zero: { maker: 0, taker: 0 } };
export const SEED = 20261120, REPS = 20;
export const VARIANTS = Object.freeze([null, 5, 15].flatMap((C) => [0.5, 1, 2].flatMap((X) => [30, 120].flatMap((T) => ['both', 'long'].map((side) => ({
  k: `C${C ?? 'x'}-X${X}-T${T}-${side}`, C, X, T, side,
  he: `${C == null ? 'בלי רדיפה' : `רדיפה מדקה ${C}`} · חירום ${X}% · ${T} דק׳ · ${side === 'long' ? 'לונג בלבד' : 'שני הכיוונים'}` }))))));

// רצועות מ-n הסגירות שלפני הדקה i — מחושבות פעם אחת (ממוצע וסטיית תקן של האוכלוסייה, כמו amit-rules.bands)
export function bands(c, n = P.bbN, k = P.bbK){
  const N = c.length, lo = new Float64Array(N).fill(NaN), up = new Float64Array(N).fill(NaN), mid = new Float64Array(N).fill(NaN);
  let s = 0, s2 = 0;
  for (let i = 0; i < N; i++){
    if (i >= n){ const m = s / n, v = Math.max(0, s2 / n - m * m), sd = Math.sqrt(v); mid[i] = m; lo[i] = m - k * sd; up[i] = m + k * sd; }
    s += c[i]; s2 += c[i] * c[i];
    if (i >= n){ s -= c[i - n]; s2 -= c[i - n] * c[i - n]; }
  }
  return { lo, up, mid };
}

// עסקה אחת: כניסה בדקה i במחיר entry (ממתינה). מחזיר { exit, exitMaker, why, exitI }
export function simTrade(m1, B, i, sg, entry, v){
  const { t, o, h, l, c } = m1, n = t.length, S = entry * (1 - sg * v.X / 100), q = P.queuePct / 100;
  if (sg > 0 ? l[i] <= S : h[i] >= S) return { exit: S, exitMaker: false, why: 'חירום', exitI: i };
  let L = null, timeout = false;
  for (let j = i + 1; j < n; j++){
    if (t[j] - t[j - 1] > P.gapMs) return { exit: o[j], exitMaker: false, why: 'פער', exitI: j };
    if (sg > 0 ? l[j] <= S : h[j] >= S) return { exit: sg > 0 ? Math.min(S, o[j]) : Math.max(S, o[j]), exitMaker: false, why: 'חירום', exitI: j };
    if (L != null && (sg > 0 ? h[j] >= L * (1 + q) : l[j] <= L * (1 - q))) return { exit: sg > 0 ? Math.max(L, o[j]) : Math.min(L, o[j]), exitMaker: true, why: timeout ? 'זמן (ממתינה)' : 'רדיפה', exitI: j };
    const tgt = sg > 0 ? B.up[j] : B.lo[j];
    if (Number.isFinite(tgt) && (sg > 0 ? h[j] >= tgt * (1 + q) : l[j] <= tgt * (1 - q))) return { exit: sg > 0 ? Math.max(tgt, o[j]) : Math.min(tgt, o[j]), exitMaker: true, why: 'יעד', exitI: j };
    const el = j - i;
    if (el >= v.T + P.chaseGrace) return { exit: c[j], exitMaker: false, why: 'זמן (שוק)', exitI: j };
    if (el >= v.T){ L = c[j]; timeout = true; }
    else if (v.C != null && el >= v.C && sg * (c[j] - entry) > 0) L = c[j];
    else L = null;
  }
  return { exit: c[n - 1], exitMaker: false, why: 'סוף', exitI: n - 1 };
}
export function pnl(x, C, slip = P.slip){
  const qty = P.notional / x.entry, xf = x.exitMaker ? x.exit : x.exit * (1 - x.sg * slip / 100);
  return x.sg * qty * (xf - x.entry) - P.notional * C.maker / 100 - qty * xf * (x.exitMaker ? C.maker : C.taker) / 100;
}

export function runVariant(m1, B, v){
  const { t, o, h, l, c } = m1, out = [], q = P.queuePct / 100;
  for (let i = P.bbN + 1; i < t.length; i++){
    const lo = B.lo[i], up = B.up[i], mid = B.mid[i];
    if (!(c[i - 1] >= lo && c[i - 1] <= up)) continue;
    if ((up - lo) / mid * 100 < P.minWidthPct) continue;
    const L = l[i] <= lo * (1 - q) && o[i] > lo, U = h[i] >= up * (1 + q) && o[i] < up;
    if (L === U) continue;
    const sg = L ? 1 : -1;
    if (v.side === 'long' && sg < 0) continue;
    const entry = L ? lo : up, r = simTrade(m1, B, i, sg, entry, v);
    out.push({ t: t[i], sg, entry, exit: r.exit, exitMaker: r.exitMaker, why: r.why });
    i = r.exitI;
  }
  return out;
}

export function rng(seed){ let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const mk = (t) => { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
export function randomRun(m1, B, real, v, seed){
  const R = rng(seed), { t, o } = m1, n = t.length, cnt = new Map(), rngs = new Map();
  for (const x of real) cnt.set(mk(x.t), (cnt.get(mk(x.t)) || 0) + 1);
  for (let i = 0; i < n; i++){ const k = mk(t[i]); if (!rngs.has(k)) rngs.set(k, [i, i]); rngs.get(k)[1] = i; }
  const out = []; let busy = -1;
  for (const [k, c] of [...cnt.entries()].sort((a, b) => a[0] - b[0])){
    const se = rngs.get(k); if (!se) continue;
    const idx = Array.from({ length: c }, () => se[0] + Math.floor(R() * (se[1] - se[0] + 1))).sort((a, b) => a - b);
    for (const i of idx){
      if (i <= busy || i <= P.bbN || i >= n - 1) continue;
      const sg = v.side === 'long' ? 1 : R() < 0.5 ? 1 : -1, r = simTrade(m1, B, i, sg, o[i], v);
      out.push({ t: t[i], sg, entry: o[i], exit: r.exit, exitMaker: r.exitMaker, why: r.why }); busy = r.exitI;
    }
  }
  return out;
}
export function stats(tr, C, slip){
  const v = tr.map((x) => pnl(x, C, slip)), n = v.length, sum = v.reduce((a, b) => a + b, 0), mean = n ? sum / n : NaN;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
  let eq = 0, pk = 0, dd = 0; for (const x of v){ eq += x; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  const why = {}; for (const x of tr) why[x.why] = (why[x.why] || 0) + 1;
  return { n, sum, mean, t: n > 1 && sd > 0 ? mean / (sd / Math.sqrt(n)) : NaN, win: n ? v.filter((x) => x > 0).length / n : NaN, worst: n ? v.reduce((a, b) => Math.min(a, b), Infinity) : NaN, dd, why };
}
export const inP = (tr, p) => tr.filter((x) => x.t >= p.from && x.t < p.to);

async function main(){
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUTDIR = arg('--outdir', 'invest/docs/research/amit-exact'), log = (...a) => console.error(...a), t0 = Date.now();
  const { loadCoin } = await import('./research-amit-course.mjs');
  const d = await loadCoin('BTC'), m1 = d.m1; if (m1.t.length < 100000) throw new Error('אין מספיק נרות BTC');
  const B = bands(m1.c), Ca = COSTS.amit;
  const f$ = (x) => (Number.isFinite(x) ? (x < 0 ? '‎−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US') : '—'), fp = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—'), ft = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
  const rows = [];
  for (const [vi, v] of VARIANTS.entries()){
    const tr = runVariant(m1, B, v), a = stats(tr, Ca, P.slip), dv = stats(inP(tr, PERIODS.dev), Ca, P.slip), ts = stats(inP(tr, PERIODS.test), Ca, P.slip);
    const ours = stats(tr, COSTS.ours, P.slip), gross = stats(tr, COSTS.zero, 0);
    const rnd = []; for (let r = 0; r < REPS; r++) rnd.push(stats(inP(randomRun(m1, B, tr, v, SEED + r * 7919 + vi * 104729), PERIODS.test), Ca, P.slip).mean);
    const beats = rnd.every((x) => ts.mean > x), pass = dv.mean > 0 && ts.mean > 0 && a.t >= 3 && beats;
    rows.push({ v, a, dv, ts, ours, gross, rndMax: Math.max(...rnd), rndBelow: rnd.filter((x) => x < ts.mean).length, beats, pass });
    log(`${v.k}: ${tr.length} עסקאות, ${f$(a.mean)} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  const best = [...rows].sort((x, y) => y.dv.mean - x.dv.mean)[0];
  const md = [`# "בוט כמו עמית בדיוק" — ביטקוין, ${d.first} → ${new Date(m1.t.at(-1)).toISOString().slice(0, 10)}, נרות דקה`, '',
    'פרוטוקול נעול: [`PROTOCOL_v1.0.md`](PROTOCOL_v1.0.md). הרצה אחת. 270,000$ לעסקה, כניסה ממתינה על הרצועה, יעד ממתין ברצועה הנגדית, בלי סטופ צמוד.', '',
    '**עלויות ראשיות: התעריף של עמית** (0.014% ממתינה / 0.035% שוק + החלקה 0.02% בשוק).', '',
    '| גרסה | עסקאות | הצלחה | לפני עלויות | **בתעריף עמית** | פיתוח | מבחן | t | בתעריף שלנו | הפסד מקס׳ | ירידה מקס׳ | אקראי מקס׳ (מבחן) | עובר |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const x of rows) md.push(`| ${x === best ? `**${x.v.he}**` : x.v.he} | ${x.a.n.toLocaleString()} | ${fp(x.a.win)} | ${f$(x.gross.mean)} | **${f$(x.a.mean)}** | ${f$(x.dv.mean)} | ${f$(x.ts.mean)} | ${ft(x.a.t)} | ${f$(x.ours.mean)} | ${f$(x.a.worst)} | ${f$(-x.a.dd)} | ${f$(x.rndMax)} (${x.rndBelow}/20) | ${x.pass ? '✅' : '—'} |`);
  md.push('', `## הגרסה הטובה בפיתוח: ${best.v.he}`, '', `- פיתוח ${f$(best.dv.mean)} לעסקה · **מבחן ${f$(best.ts.mean)}** · יציאות: ${Object.entries(best.a.why).map(([k, n]) => `${k} ${fp(n / best.a.n)}`).join(', ')}.`);
  const years = [...new Set(VARIANTS.length ? runVariant(m1, B, best.v).map((x) => new Date(x.t).getUTCFullYear()) : [])].sort();
  const btr = runVariant(m1, B, best.v);
  md.push('', '| שנה | ' + years.join(' | ') + ' |', '|---|' + years.map(() => '---').join('|') + '|', `| $ לעסקה (תעריף עמית) | ${years.map((y) => f$(stats(btr.filter((x) => new Date(x.t).getUTCFullYear() === y), Ca, P.slip).mean)).join(' | ')} |`);
  const passing = rows.filter((x) => x.pass);
  md.push('', '## הכרעה', '', passing.length ? `**עוברות:** ${passing.map((x) => x.v.he).join(' · ')}.` : '**`FAIL`** — אף גרסה לא רווחית בשתי התקופות ומנצחת כניסות אקראיות, גם בתעריף של עמית.');
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(join(OUTDIR, 'report.md'), md.join('\n') + '\n');
  writeFileSync(join(OUTDIR, 'results.json'), JSON.stringify({ bars: m1.t.length, first: d.first, rows: rows.map((x) => ({ k: x.v.k, all: x.a, dev: x.dv, test: x.ts, ours: x.ours.mean, gross: x.gross.mean, rndMax: x.rndMax, pass: x.pass })), best: best.v.k }, null, 1));
  log(`סיום ${((Date.now() - t0) / 1000).toFixed(0)}s`); console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
