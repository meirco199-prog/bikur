#!/usr/bin/env node
// בוט 2 (ETH, 15 דק׳): יעד ו/או כניסה בפקודה ממתינה במקום פקודת שוק. מחקר בלבד — אין פקודות ואין מפתחות.
// פרוטוקול נעול: invest/docs/research/bot2-maker/PROTOCOL_v1.0.md. הרצה אחת.
// שימוש: node --max-old-space-size=6500 invest-api/scripts/research-bot2-maker.mjs --from 2020-01 --to 2026-10 --cache DIR --outdir DIR
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BOT2, signal } from '../engine/amit2-exec.js';
import { bars15 } from './research-amit2-be.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const log = (...a) => console.error(...a), D = (s) => Date.parse(`${s}T00:00:00Z`);
export const PERIODS = { dev: { from: D('2020-01-01'), to: D('2024-01-01'), he: 'פיתוח 2020–2023' }, test: { from: D('2024-01-01'), to: D('2026-11-01'), he: 'מבחן 2024 → 10/2026' } };
export const Q = 0.01, SLIP = 0.01;
export const COSTS = { actual: { maker: 0.0201, taker: 0.0562 }, amit: { maker: 0.014, taker: 0.035 }, zero: { maker: 0, taker: 0 } };
export const VARIANTS = Object.freeze([
  { k: 'base', em: null, tpm: false, he: 'כמו היום (כניסה ויעד בשוק)' },
  { k: 'tpm', em: null, tpm: true, he: 'יעד ממתין' },
  { k: 'em5', em: 5, tpm: false, he: 'כניסה ממתינה 5 דק׳' },
  { k: 'em15', em: 15, tpm: false, he: 'כניסה ממתינה 15 דק׳' },
  { k: 'em5-tpm', em: 5, tpm: true, he: 'כניסה ממתינה 5 דק׳ + יעד ממתין' },
  { k: 'em15-tpm', em: 15, tpm: true, he: 'כניסה ממתינה 15 דק׳ + יעד ממתין' },
]);

// עסקה אחת על נרות דקה. s: { i, sg, ef (מחיר כניסה בפועל), sl, tp, tpm, onlyStopFirst (כניסה ממתינה: בדקת המילוי רק סטופ) }
export function simB2(m1, s, P = BOT2){
  const { t, o, h, l, c } = m1, n = t.length, { i, sg, ef, sl, tp } = s, q = Q / 100;
  const toTp = sg * (tp - ef);
  let be = null, j;
  const stopNow = () => (be == null ? sl : be);
  const hitStop = (jj) => (sg > 0 ? l[jj] <= stopNow() : h[jj] >= stopNow());
  for (j = i; j < n; j++){
    if (j > i && t[j] - t[j - 1] > 30 * 60e3) return { exit: o[j], maker: false, why: 'פער', exitI: j };
    if (hitStop(j)){ const st = stopNow(); return { exit: sg > 0 ? Math.min(st, o[j]) : Math.max(st, o[j]), maker: false, why: be == null ? 'סטופ' : 'סטופ בכניסה', exitI: j }; }
    if (!(s.onlyStopFirst && j === i)){
      const touched = s.tpm ? (sg > 0 ? h[j] >= tp * (1 + q) : l[j] <= tp * (1 - q)) : (sg > 0 ? h[j] >= tp : l[j] <= tp);
      if (touched) return { exit: sg > 0 ? Math.max(tp, o[j]) : Math.min(tp, o[j]), maker: !!s.tpm, why: 'יעד', exitI: j };
      if (t[j] + 60e3 - t[i] >= P.maxMins * 60e3) return { exit: c[j], maker: false, why: 'זמן', exitI: j };
    }
    if (be == null && toTp > 0 && sg * (c[j] - ef) >= P.beAt * toTp){
      const nb = ef * (1 + sg * P.bePct / 100);
      if (sg * (nb - sl) > 0 && sg * (c[j] - nb) > 0) be = nb;
    }
  }
  return { exit: c[n - 1], maker: false, why: 'סוף', exitI: n - 1 };
}

// כל האותות של בוט 2 בגרסה v. מחזיר { trades, signals, missed: [אותות שלא התמלאו] }
export function runB2(m1, b15, v, P = BOT2){
  const out = [], missed = []; let busyUntil = -Infinity, signals = 0;
  const q = Q / 100;
  for (let k = P.bbN - 1; k < b15.length; k++){
    const bar = b15[k];
    if (bar.next >= m1.t.length || !(m1.t[bar.next] >= busyUntil)) continue;
    const sig = signal(b15.slice(k - P.bbN + 1, k + 1), P);
    if (!sig || sig.skip) continue;
    signals++;
    const sg = sig.side === 'long' ? 1 : -1, i0 = bar.next, L = sig.entryRef;
    const qty = Math.min(P.riskUsd / Math.abs(L - sig.sl) * L, P.maxNotional) / L;
    let i = i0, ef, entryMaker;
    if (v.em == null){ ef = m1.o[i0]; entryMaker = false; }
    else {
      let f = -1;
      for (let j = i0; j < m1.t.length && m1.t[j] < m1.t[i0] + v.em * 60e3; j++){
        if (j > i0 && m1.t[j] - m1.t[j - 1] > 30 * 60e3) break;
        if (sg > 0 ? m1.l[j] <= L * (1 - q) : m1.h[j] >= L * (1 + q)){ f = j; break; }
      }
      if (f < 0){ missed.push({ t: bar.t, side: sig.side }); continue; }
      i = f; ef = L; entryMaker = true;
    }
    const efSlip = entryMaker ? ef : ef * (1 + sg * SLIP / 100);
    const r = simB2(m1, { i, sg, ef: efSlip, sl: sig.sl, tp: sig.tp, tpm: v.tpm, onlyStopFirst: entryMaker }, P);
    out.push({ t: bar.t, side: sig.side, sg, qty, entry: ef, entryMaker, exit: r.exit, exitMaker: r.maker, why: r.why });
    busyUntil = m1.t[r.exitI] + 60e3;
  }
  return { trades: out, signals, missed };
}

export function pnlOf(x, C, slip = SLIP){
  const ef = x.entryMaker ? x.entry : x.entry * (1 + x.sg * slip / 100);
  const xf = x.exitMaker ? x.exit : x.exit * (1 - x.sg * slip / 100);
  return x.sg * x.qty * (xf - ef) - x.qty * ef * (x.entryMaker ? C.maker : C.taker) / 100 - x.qty * xf * (x.exitMaker ? C.maker : C.taker) / 100;
}
export const inP = (tr, p) => tr.filter((x) => x.t >= p.from && x.t < p.to);
export function stats(tr, C, slip = SLIP){
  const v = tr.map((x) => pnlOf(x, C, slip)), n = v.length, sum = v.reduce((a, b) => a + b, 0), mean = n ? sum / n : NaN;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN;
  const why = {}; for (const x of tr) why[x.why] = (why[x.why] || 0) + 1;
  return { n, sum, mean, t: n > 1 && sd > 0 ? mean / (sd / Math.sqrt(n)) : NaN, win: n ? v.filter((x) => x > 0).length / n : NaN, why };
}
const key = (x) => `${x.t}|${x.side}`;
export function paired(a, base, C){
  const mb = new Map(base.map((x) => [key(x), pnlOf(x, C)])), d = [];
  for (const x of a){ const y = mb.get(key(x)); if (y != null) d.push(pnlOf(x, C) - y); }
  const n = d.length, m = n ? d.reduce((s, x) => s + x, 0) / n : NaN, sd = n > 1 ? Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : NaN;
  return { n, mean: m, t: n > 1 && sd > 0 ? m / (sd / Math.sqrt(n)) : NaN };
}
export function decide(res, C){
  const base = res.get('base').trades, bd = stats(inP(base, PERIODS.dev), C).mean, bt = stats(inP(base, PERIODS.test), C).mean;
  return VARIANTS.map((v) => {
    const tr = res.get(v.k).trades, all = stats(tr, C), dev = stats(inP(tr, PERIODS.dev), C).mean, test = stats(inP(tr, PERIODS.test), C).mean;
    const pr = v.k === 'base' ? null : paired(tr, base, C);
    return { k: v.k, dev, test, all, pr, improves: v.k !== 'base' && dev > bd && test > bt && pr.t >= 3, profitable: dev > 0 && test > 0 && all.t >= 3 };
  });
}

const f$ = (x) => (!Number.isFinite(x) ? '—' : (x < 0 ? '‎−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US'));
const fp = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—'), ft = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');

async function main(){
  const OUTDIR = arg('--outdir', 'invest/docs/research/bot2-maker');
  const { loadCoin } = await import('./research-amit-course.mjs');
  const t0 = Date.now(), d = await loadCoin('ETH'), m1 = d.m1;
  if (m1.t.length < 100000) throw new Error('אין מספיק נרות של ETH');
  const b15 = bars15(m1), C = COSTS.actual;
  const res = new Map(VARIANTS.map((v) => { const r = runB2(m1, b15, v); log(`${v.k}: ${r.trades.length} עסקאות, ${r.missed.length} לא התמלאו`); return [v.k, r]; }));
  const dec = decide(res, C), base = res.get('base').trades, baseBy = new Map(base.map((x) => [key(x), x]));
  const md = [`# בוט 2: יעד וכניסה בפקודה ממתינה — ETH, ${d.first} → 10/2026, נרות דקה`, '', 'פרוטוקול נעול: [`PROTOCOL_v1.0.md`](PROTOCOL_v1.0.md). הרצה אחת. עלויות ראשיות: השיעורים בפועל בדמו (0.0201% / 0.0562%) + החלקה 0.01% במילוי בשוק.', '',
    '## 1. כל הגרסאות', '', '| גרסה | עסקאות | הצלחה | $ לעסקה פיתוח | $ לעסקה מבחן | $ לעסקה הכול | t | סה״כ | לפני עלויות | בעמלות עמית | מול היום (אותם אותות) | משפרת | רווחית |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const v of VARIANTS){
    const r = res.get(v.k), x = dec.find((y) => y.k === v.k), z = stats(r.trades, COSTS.zero, 0).mean, a = stats(r.trades, COSTS.amit).mean;
    md.push(`| ${v.he} | ${r.trades.length} | ${fp(x.all.win)} | ${f$(x.dev)} | ${f$(x.test)} | ${f$(x.all.mean)} | ${ft(x.all.t)} | ${f$(x.all.sum)} | ${f$(z)} | ${f$(a)} | ${x.pr ? `${f$(x.pr.mean)} (t ${ft(x.pr.t)}, ${x.pr.n})` : '—'} | ${x.improves ? '✅' : '—'} | ${x.profitable ? '✅' : '—'} |`);
  }
  md.push('', '## 2. כניסה ממתינה — מילוי והטיית בחירה', '', '| גרסה | אותות | התמלאו | לא התמלאו | "היום" על האותות שלא התמלאו ($ לעסקה) | "היום" על האותות שהתמלאו ($ לעסקה) |', '|---|---|---|---|---|---|');
  for (const v of VARIANTS.filter((y) => y.em != null)){
    const r = res.get(v.k), miss = r.missed.map((x) => baseBy.get(key(x))).filter(Boolean), got = r.trades.map((x) => baseBy.get(key(x))).filter(Boolean);
    md.push(`| ${v.he} | ${r.signals} | ${r.trades.length} (${fp(r.trades.length / r.signals)}) | ${r.missed.length} | ${f$(stats(miss, C).mean)} (${miss.length}) | ${f$(stats(got, C).mean)} (${got.length}) |`);
  }
  md.push('', '## 3. לפי שנה — $ לעסקה (עלויות ראשיות)', '', `| גרסה | ${[2020, 2021, 2022, 2023, 2024, 2025, 2026].join(' | ')} |`, '|---|---|---|---|---|---|---|---|');
  for (const v of VARIANTS){ const tr = res.get(v.k).trades; md.push(`| ${v.he} | ${[2020, 2021, 2022, 2023, 2024, 2025, 2026].map((y) => { const s = stats(tr.filter((x) => new Date(x.t).getUTCFullYear() === y), C); return `${f$(s.mean)} (${s.n})`; }).join(' | ')} |`); }
  const best = dec.filter((x) => x.k !== 'base').sort((a, b) => b.dev - a.dev)[0], imp = dec.filter((x) => x.improves), prof = dec.filter((x) => x.profitable);
  md.push('', '## 4. הכרעה', '', `- **הנבחרת לפי פיתוח:** ${VARIANTS.find((v) => v.k === best.k).he} — פיתוח ${f$(best.dev)}, מבחן ${f$(best.test)} לעסקה.`,
    `- **משפרת את היום (בשתי התקופות + t ≥ 3 על אותם אותות):** ${imp.length ? imp.map((x) => VARIANTS.find((v) => v.k === x.k).he).join(', ') : 'אף גרסה'}.`,
    `- **רווחית (> 0 בשתי התקופות, t ≥ 3):** ${prof.length ? prof.map((x) => VARIANTS.find((v) => v.k === x.k).he).join(', ') : '**אף גרסה — `FAIL`**'}.`);
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(join(OUTDIR, 'report.md'), md.join('\n') + '\n');
  writeFileSync(join(OUTDIR, 'results.json'), JSON.stringify({ first: d.first, bars: m1.t.length, costs: COSTS, slip: SLIP, q: Q, decision: dec.map((x) => ({ ...x, all: { n: x.all.n, mean: x.all.mean, t: x.all.t, sum: x.all.sum, win: x.all.win, why: x.all.why } })) }, null, 1));
  log(`סיום (${Math.round((Date.now() - t0) / 1000)}s)`); console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
