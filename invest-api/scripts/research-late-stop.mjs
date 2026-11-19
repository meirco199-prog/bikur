#!/usr/bin/env node
// סטופ מאוחר לבוט 1 ולבוט 2 — מחקר בלבד, אין פקודות ואין מפתחות. פרוטוקול נעול: invest/docs/research/late-stop/PROTOCOL_v1.0.md
// בקשת מאיר (19/11/2026): "תמצא לי שיטה שאנחנו יכולים לשים את הסטופ בשלב מאוחר יותר".
// האותות: בדיוק כמו research-amit1-guard.mjs (גרסה now) ו-research-amit2-be.mjs (גרסה be0.5-0.06). משתנה רק ניהול הסטופ.
// שימוש: node --max-old-space-size=6500 invest-api/scripts/research-late-stop.mjs --from 2020-01 --to 2026-10 --cache DIR --outdir DIR [--fees FEEJSON]
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BOT1, bandsAt } from './research-amit1-guard.mjs';
import { bars15 } from './research-amit2-be.mjs';
import { BOT2, signal } from '../engine/amit2-exec.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const log = (...a) => console.error(...a), D = (s) => Date.parse(`${s}T00:00:00Z`);
export const PERIODS = { dev: { from: D('2020-01-01'), to: D('2024-01-01'), he: 'פיתוח 2020–2023' }, test: { from: D('2024-01-01'), to: D('2026-11-01'), he: 'מבחן 2024 → 10/2026' } };
export const CAT = 3;            // סטופ חירום = 3 × המרחק הבסיסי
export const SEED = 20261119, REPS = 20;
export const VARIANTS = Object.freeze([
  { k: 'base', he: 'כמו היום (סטופ מיד)' },
  ...[5, 15, 30, 60].map((m) => ({ k: `delay${m}`, delay: m, he: `סטופ רגיל רק אחרי ${m} דק׳ (חירום ×3 מההתחלה)` })),
  ...[15, 60].map((m) => ({ k: `close${m}`, closeT: m, he: `סטופ רק על סגירת נר ${m} דק׳ (חירום ×3 בנגיעה)` })),
  ...[2, 3].map((x) => ({ k: `wide${x}`, mult: x, he: `סטופ רחב ×${x} (נגיעה, מיד)` })),
]);
// עלויות באחוזים לכל צד. ראשי: שיעורי החשבון (מהביקורת, אם הועברה) או VIP0. החלקה: בוט 1 0.02%, בוט 2 0.01% (כמו 7יג ו-7י)
export const COSTS = {
  vip0: { maker: 0.02, taker: 0.055 },
  amit: { maker: 0.014, taker: 0.035 },
  zero: { maker: 0, taker: 0 },
};
export const SLIP = { bot1: 0.02, bot2: 0.01 };

// ---------- עסקה אחת עם ניהול סטופ לפי גרסה ----------
// spec: { i (דקת הכניסה), sg, entry (מחיר ללא החלקה), d (שבר), qty, entryMaker, inMinute (בוט 1: המילוי בתוך הדקה — רק סטופ נבדק בה),
//         tp: number | null (קבוע) או tpFn(j), tpMaker, maxMins, timeByIndex (בוט 1: j−i; בוט 2: לפי זמן), be: { at, pct, toTp } | null }
export function simLS(m1, spec, v){
  const { t, o, h, l, c } = m1, n = t.length, { i, sg, entry, d } = spec;
  const ref = spec.ref ?? entry, mult = v.mult || 1, normal = ref * (1 - sg * d * mult), cat = ref * (1 - sg * d * CAT);
  const lateRule = v.delay != null || v.closeT != null;
  const better = (a, b) => (b == null ? a : sg > 0 ? Math.max(a, b) : Math.min(a, b));
  let beStop = null, exit = null, why = null, exitMaker = false, j = i, pending = false;
  const touchStop = (jj) => {
    const el = (t[jj] - t[i]) / 60e3;
    let s = !lateRule ? normal : v.delay != null && el >= v.delay ? normal : cat;
    return better(s, beStop);
  };
  const hit = (s, jj) => (sg > 0 ? l[jj] <= s : h[jj] >= s);
  const fillAt = (s, jj) => (sg > 0 ? Math.min(s, o[jj]) : Math.max(s, o[jj]));
  let start = i;
  if (spec.inMinute){
    const s = touchStop(i);
    if (hit(s, i)) { exit = s; why = 'סטופ'; }
    start = i + 1;
  }
  if (exit == null) for (j = start; j < n; j++){
    if (j > i && t[j] - t[j - 1] > 30 * 60e3){ exit = o[j]; why = 'פער בנתונים'; break; }
    if (pending){ exit = o[j]; why = 'סטופ בסגירה'; break; }
    const s = touchStop(j);
    if (hit(s, j)){ exit = fillAt(s, j); why = s === cat && lateRule ? 'סטופ חירום' : beStop != null && s === beStop ? 'סטופ בכניסה' : 'סטופ'; break; }
    const tp = spec.tpFn ? spec.tpFn(j) : spec.tp;
    if (tp != null && (sg > 0 ? h[j] >= tp : l[j] <= tp)){ exit = sg > 0 ? Math.max(tp, o[j]) : Math.min(tp, o[j]); why = 'יעד'; exitMaker = spec.tpMaker; break; }
    const timeUp = spec.timeByIndex ? j - i >= spec.maxMins : t[j] + 60e3 - t[i] >= spec.maxMins * 60e3;
    if (timeUp){ exit = c[j]; why = 'זמן'; break; }
    // בסגירת הדקה: הזזה לכניסה (בוט 2), וסטופ על סגירת נר
    if (spec.be && beStop == null && spec.be.toTp > 0 && sg * (c[j] - spec.beFrom) >= spec.be.at * spec.be.toTp){
      const nb = spec.beFrom * (1 + sg * spec.be.pct / 100), cur = touchStop(j);
      if (sg * (nb - cur) > 0 && sg * (c[j] - nb) > 0) beStop = nb;
    }
    if (v.closeT != null && Math.round((t[j] + 60e3) / 60e3) % v.closeT === 0 && sg * (c[j] - better(normal, beStop)) <= 0) pending = true;
  }
  if (exit == null){ j = n - 1; exit = c[j]; why = 'סוף הנתונים'; }
  return { exit, why, exitMaker, exitI: j, exitT: t[j] + 60e3 };
}

// נטו של עסקה לפי עלויות (C באחוזים) והחלקה (באחוזים)
export function pnlOf(x, C, slip){
  const ef = x.entryMaker ? x.entry : x.entry * (1 + x.sg * slip / 100);
  const xf = x.exitMaker ? x.exit : x.exit * (1 - x.sg * slip / 100);
  const fees = x.qty * ef * (x.entryMaker ? C.maker : C.taker) / 100 + x.qty * xf * (x.exitMaker ? C.maker : C.taker) / 100;
  return x.sg * x.qty * (xf - ef) - fees;
}

// ---------- בוט 1 (אותו לולאה כמו research-amit1-guard.runVariant) ----------
export function runBot1(m1, v, P = BOT1){
  const { t, o, h, l, c } = m1, out = [], q = P.queuePct / 100;
  for (let i = P.bbN + 1; i < t.length; i++){
    const b = bandsAt(c, i, P.bbN, P.bbK);
    if (!(c[i - 1] >= b.lo && c[i - 1] <= b.up)) continue;
    if ((b.up - b.lo) / b.mid * 100 < P.minWidthPct) continue;
    const lo = l[i] <= b.lo * (1 - q) && o[i] > b.lo, up = h[i] >= b.up * (1 + q) && o[i] < b.up;
    if (lo === up) continue;
    const sg = lo ? 1 : -1, entry = lo ? b.lo : b.up, d = P.slPct / 100;
    const spec = { i, sg, entry, d, qty: P.notional / entry, entryMaker: true, inMinute: true, tpMaker: true, maxMins: P.maxMins, timeByIndex: true,
      tpFn: (j) => { const bb = bandsAt(c, j, P.bbN, P.bbK); return sg > 0 ? bb.up : bb.lo; } };
    const r = simLS(m1, spec, v);
    out.push({ t: t[i], side: sg, sg, entry, qty: spec.qty, entryMaker: true, exit: r.exit, exitMaker: r.exitMaker, why: r.why, d, tpd: (b.up - b.lo) / entry });
    i = r.exitI;
  }
  return out;
}

// ---------- בוט 2 (אותו לולאה כמו research-amit2-be.runVariant, עם ההזזה של היום) ----------
export function runBot2(m1, b15, v, P = BOT2, slip = SLIP.bot2){
  const out = []; let busyUntil = -Infinity;
  for (let k = P.bbN - 1; k < b15.length; k++){
    const bar = b15[k];
    if (bar.next >= m1.t.length || !(m1.t[bar.next] >= busyUntil)) continue;
    const sig = signal(b15.slice(k - P.bbN + 1, k + 1), P);
    if (!sig || sig.skip) continue;
    const sg = sig.side === 'long' ? 1 : -1, i0 = bar.next, entry = m1.o[i0];
    const notional = Math.min(P.riskUsd / Math.abs(sig.entryRef - sig.sl) * sig.entryRef, P.maxNotional), qty = notional / sig.entryRef;
    const ef = entry * (1 + sg * slip / 100);
    // הסטופ הבסיסי = בדיוק מחיר הסטופ של האות (כמו בבוט); המרחק נמדד ממחיר הייחוס של האות, והגרסאות הרחבות/החירום — כפולות שלו
    const spec = { i: i0, sg, entry, ref: sig.entryRef, d: Math.abs(sig.entryRef - sig.sl) / sig.entryRef, qty, entryMaker: false, inMinute: false, tp: sig.tp, tpMaker: false,
      maxMins: P.maxMins, timeByIndex: false, be: { at: P.beAt, pct: P.bePct, toTp: sg * (sig.tp - ef) }, beFrom: ef };
    const r = simLS(m1, spec, v);
    out.push({ t: bar.t, side: sig.side, sg, entry, qty, entryMaker: false, exit: r.exit, exitMaker: false, why: r.why, d: spec.d, tpd: Math.abs(sig.tp - entry) / entry, notional });
    busyUntil = r.exitT;
  }
  return out;
}

// ---------- כניסות אקראיות ----------
export function rng(seed){ let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
const monthKey = (t) => { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
export function randomRun(m1, base, v, bot, seed){
  const R = rng(seed), { t, o } = m1, n = t.length, byMonth = new Map();
  for (const x of base) byMonth.set(monthKey(x.t), (byMonth.get(monthKey(x.t)) || 0) + 1);
  // אינדקס תחילת כל חודש
  const starts = new Map(); for (let i = 0; i < n; i++){ const k = monthKey(t[i]); if (!starts.has(k)) starts.set(k, [i, i]); starts.get(k)[1] = i; }
  const out = [];
  let busy = -1;
  for (const [mk, cnt] of [...byMonth.entries()].sort((a, b) => a[0] - b[0])){
    const se = starts.get(mk); if (!se) continue;
    const [a, b] = se, idx = Array.from({ length: cnt }, () => a + Math.floor(R() * (b - a + 1))).sort((x, y) => x - y);
    for (const i of idx){
      if (i <= busy || i < 25 || i >= n - 1) continue;
      const proto = base[Math.floor(R() * base.length)], sg = R() < 0.5 ? 1 : -1, entry = o[i];
      const ef = bot === 'bot2' ? entry * (1 + sg * SLIP.bot2 / 100) : entry;
      const tp = entry * (1 + sg * proto.tpd), qty = bot === 'bot1' ? BOT1.notional / entry : proto.notional / entry;
      const spec = { i, sg, entry, d: proto.d, qty, entryMaker: bot === 'bot1', inMinute: bot === 'bot1', tp, tpMaker: bot === 'bot1',
        maxMins: bot === 'bot1' ? BOT1.maxMins : BOT2.maxMins, timeByIndex: bot === 'bot1',
        be: bot === 'bot2' ? { at: BOT2.beAt, pct: BOT2.bePct, toTp: sg * (tp - ef) } : null, beFrom: ef };
      const r = simLS(m1, spec, v);
      out.push({ t: t[i], side: sg, sg, entry, qty, entryMaker: spec.entryMaker, exit: r.exit, exitMaker: r.exitMaker, why: r.why });
      busy = r.exitI;
    }
  }
  return out;
}

// ---------- סטטיסטיקה ----------
export const inP = (tr, p) => tr.filter((x) => x.t >= p.from && x.t < p.to);
export function stats(tr, C, slip){
  const v = tr.map((x) => pnlOf(x, C, slip)), n = v.length, sum = v.reduce((a, b) => a + b, 0), mean = n ? sum / n : NaN;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
  let eq = 0, pk = 0, dd = 0; for (const x of v){ eq += x; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  const why = {}; for (const x of tr) why[x.why] = (why[x.why] || 0) + 1;
  const stops = tr.filter((x) => /סטופ/.test(x.why)).length;
  return { n, sum, mean, t: n > 1 && sd > 0 ? mean / (sd / Math.sqrt(n)) : NaN, win: n ? v.filter((x) => x > 0).length / n : NaN, worst: n ? v.reduce((a, b) => Math.min(a, b), Infinity) : NaN, dd, stopShare: n ? stops / n : NaN, why };
}
export function paired(a, base, C, slip){
  const mb = new Map(base.map((x) => [`${x.t}|${x.side}`, pnlOf(x, C, slip)])), d = [];
  for (const x of a){ const y = mb.get(`${x.t}|${x.side}`); if (y != null) d.push(pnlOf(x, C, slip) - y); }
  const n = d.length, m = n ? d.reduce((s, x) => s + x, 0) / n : NaN, sd = n > 1 ? Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : NaN;
  return { n, mean: m, t: n > 1 && sd > 0 ? m / (sd / Math.sqrt(n)) : NaN };
}
// הכרעה לפי סעיף 7 בפרוטוקול
export function decide(res, rnd, C, slip){
  const base = res.get('base'), bd = stats(inP(base, PERIODS.dev), C, slip).mean, bt = stats(inP(base, PERIODS.test), C, slip).mean;
  return VARIANTS.filter((v) => v.k !== 'base').map((v) => {
    const tr = res.get(v.k), dv = stats(inP(tr, PERIODS.dev), C, slip).mean, ts = stats(inP(tr, PERIODS.test), C, slip).mean, pr = paired(tr, base, C, slip);
    const rTest = (rnd.get(v.k) || []).filter(Number.isFinite);
    const beatsAll = rTest.length > 0 && rTest.every((x) => ts > x);
    const c1 = dv > 0 && ts > 0, c2 = pr.t >= 3, c3 = beatsAll;
    return { k: v.k, dev: dv, test: ts, pr, rndMax: rTest.length ? Math.max(...rTest) : NaN, rndBelow: rTest.filter((x) => x < ts).length, c1, c2, c3, saves: c1 && c2 && c3, better: dv > bd && ts > bt && c2 };
  });
}

// ---------- דוח ----------
const f$ = (x) => (x == null || !Number.isFinite(x) ? '—' : (x < 0 ? '‎−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US'));
const fp = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—'), ft = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
export function botSection(name, res, rnd, Cp, slip, cpLabel){
  const L = [`## ${name}`, '', `עלויות ראשיות: ${cpLabel}; החלקה ${slip}% בכל מילוי בשוק.`, '',
    '| גרסה | עסקאות | הצלחה | נסגרו בסטופ | לפני עלויות | נטו פיתוח | נטו מבחן | נטו הכול | t | סה"כ | הפסד מקס׳ לעסקה | ירידה מקס׳ | נטו בשיעורי עמית |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const v of VARIANTS){
    const tr = res.get(v.k), a = stats(tr, Cp, slip), g = stats(tr, COSTS.zero, 0), am = stats(tr, COSTS.amit, slip);
    const dv = stats(inP(tr, PERIODS.dev), Cp, slip), ts = stats(inP(tr, PERIODS.test), Cp, slip);
    L.push(`| ${v.k === 'base' ? `**${v.he}**` : v.he} | ${a.n.toLocaleString()} | ${fp(a.win)} | ${fp(a.stopShare)} | ${f$(g.mean)} | ${f$(dv.mean)} | ${f$(ts.mean)} | ${f$(a.mean)} | ${ft(a.t)} | ${f$(a.sum)} | ${f$(a.worst)} | ${f$(-a.dd)} | ${f$(am.mean)} |`);
  }
  const dec = decide(res, rnd, Cp, slip);
  L.push('', '### מול היום ומול כניסות אקראיות (עלויות ראשיות)', '', '| גרסה | שיפור לעסקה מול היום (אותם אותות) | t | רווחית בשתי התקופות | t ≥ 3 | מנצחת את כל 20 האקראיות במבחן | אקראי מקס׳ (מבחן) | עדיפה על היום | **מצילה** |', '|---|---|---|---|---|---|---|---|---|');
  for (const x of dec){ const v = VARIANTS.find((y) => y.k === x.k); L.push(`| ${v.he} | ${f$(x.pr.mean)} | ${ft(x.pr.t)} | ${x.c1 ? '✅' : '—'} | ${x.c2 ? '✅' : '—'} | ${x.c3 ? '✅' : `— (${x.rndBelow}/20)`} | ${f$(x.rndMax)} | ${x.better ? '✅' : '—'} | ${x.saves ? '✅' : '—'} |`); }
  const years = [...new Set(res.get('base').map((x) => new Date(x.t).getUTCFullYear()))].sort();
  L.push('', '### לפי שנה — נטו לעסקה (עלויות ראשיות)', '', `| גרסה | ${years.join(' | ')} |`, `|---|${years.map(() => '---').join('|')}|`);
  for (const v of VARIANTS){ const tr = res.get(v.k); L.push(`| ${v.he} | ${years.map((y) => f$(stats(tr.filter((x) => new Date(x.t).getUTCFullYear() === y), Cp, slip).mean)).join(' | ')} |`); }
  return { md: L.join('\n'), dec };
}

export function primaryCosts(feeJsonPath){
  if (feeJsonPath && existsSync(feeJsonPath)){
    try {
      const j = JSON.parse(readFileSync(feeJsonPath, 'utf8')), fr = (j.feeRates || []).find((x) => x.symbol === 'BTCUSDT') || (j.feeRates || [])[0];
      if (fr && Number.isFinite(Number(fr.takerFeeRate)) && Number.isFinite(Number(fr.makerFeeRate)))
        return { C: { maker: Number(fr.makerFeeRate) * 100, taker: Number(fr.takerFeeRate) * 100 }, label: `שיעורי החשבון מהביקורת (${(Number(fr.makerFeeRate) * 100).toFixed(3)}% / ${(Number(fr.takerFeeRate) * 100).toFixed(3)}%)` };
    } catch {}
  }
  return { C: COSTS.vip0, label: 'VIP0 (0.02% / 0.055%) — הביקורת לא הועברה' };
}

async function main(){
  const OUTDIR = arg('--outdir', 'invest/docs/research/late-stop'), FEES = arg('--fees', '');
  const { loadCoin } = await import('./research-amit-course.mjs');
  const t0 = Date.now(), P = primaryCosts(FEES), out = [], dec = {};
  const md = ['# סטופ מאוחר — בוט 1 ובוט 2, 2020 → 10/2026, נרות דקה', '', 'פרוטוקול נעול: [`PROTOCOL_v1.0.md`](PROTOCOL_v1.0.md). הרצה אחת.', ''];
  for (const [bot, coin] of [['bot1', 'BTC'], ['bot2', 'ETH']]){
    const d = await loadCoin(coin), m1 = d.m1; if (m1.t.length < 100000) throw new Error(`אין מספיק נרות של ${coin}`);
    const b15 = bot === 'bot2' ? bars15(m1) : null;
    const res = new Map(VARIANTS.map((v) => { const r = bot === 'bot1' ? runBot1(m1, v) : runBot2(m1, b15, v); log(`${bot} ${v.k}: ${r.length}`); return [v.k, r]; }));
    const base = res.get('base'), rnd = new Map();
    // לכל חזרה אקראית שומרים רק את הנטו הממוצע לעסקה במבחן (עלויות ראשיות) — כדי לא להחזיק מיליוני עסקאות בזיכרון
    for (const v of VARIANTS){ const reps = []; for (let r = 0; r < REPS; r++) reps.push(stats(inP(randomRun(m1, base, v, bot, SEED + r * 7919 + VARIANTS.indexOf(v) * 104729 + (bot === 'bot2' ? 1 : 0)), PERIODS.test), P.C, SLIP[bot]).mean); rnd.set(v.k, reps); log(`${bot} ${v.k}: אקראי ✓`); }
    const s = botSection(bot === 'bot1' ? `בוט 1 (ביטקוין, ${d.first} →)` : `בוט 2 (את'ריום, ${d.first} →)`, res, rnd, P.C, SLIP[bot], P.label);
    md.push(s.md, ''); dec[bot] = s.dec;
    out.push({ bot, bars: m1.t.length, first: d.first, variants: Object.fromEntries(VARIANTS.map((v) => [v.k, { all: stats(res.get(v.k), P.C, SLIP[bot]), dev: stats(inP(res.get(v.k), PERIODS.dev), P.C, SLIP[bot]), test: stats(inP(res.get(v.k), PERIODS.test), P.C, SLIP[bot]), gross: stats(res.get(v.k), COSTS.zero, 0).mean, amit: stats(res.get(v.k), COSTS.amit, SLIP[bot]).mean }])) });
  }
  const saves = Object.entries(dec).flatMap(([b, xs]) => xs.filter((x) => x.saves).map((x) => `${b}:${x.k}`));
  md.push('## הכרעה', '', saves.length ? `**CANDIDATE:** ${saves.join(', ')} — עוברת לדמו רק באישור מאיר.` : '**`FAIL`** — אף גרסה של סטופ מאוחר / על סגירת נר / רחב לא הופכת את בוט 1 או בוט 2 לרווחי לפי הקריטריונים הנעולים.');
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(join(OUTDIR, 'report.md'), md.join('\n') + '\n');
  writeFileSync(join(OUTDIR, 'results.json'), JSON.stringify({ costs: P, slip: SLIP, cat: CAT, reps: REPS, seed: SEED, bots: out, decision: dec }, null, 1));
  log(`סיום (${Math.round((Date.now() - t0) / 1000)}s)`); console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
