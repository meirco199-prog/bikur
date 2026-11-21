#!/usr/bin/env node
// בוט 2 לפי משטר תנודתיות — מחקר בלבד (אין פקודות, אין מפתחות). פרוטוקול נעול: invest/docs/research/bot2-regime/PROTOCOL_v1.0.md. הרצה אחת.
// האות והביצוע: בדיוק `base` מ-research-bot2-maker.mjs (כמו הבוט היום). רק סיווג העסקאות לפי תנודתיות 24 שעות שהייתה ידועה לפני הכניסה.
// שימוש: node --max-old-space-size=6500 invest-api/scripts/research-bot2-regime.mjs --from 2020-01 --to 2026-10 --cache DIR --outdir DIR
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BOT2, signal } from '../engine/amit2-exec.js';
import { bars15 } from './research-amit2-be.mjs';
import { VARIANTS, COSTS, runB2, pnlOf } from './research-bot2-maker.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const log = (...a) => console.error(...a), DAY = 86400e3, WEEK = 7 * DAY;
export const EXPLORE = 'ETH', VALIDATE = Object.freeze(['BTC', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'LINK', 'LTC']);
export const SLIP_OF = (coin) => (coin === 'ETH' || coin === 'BTC' ? 0.01 : 0.03);
export const VOL_N = 96, MIN_DAYS = 90, LOOKBACK_DAYS = 365, CUTS = [1 / 3, 2 / 3], SEED = 20261121, REPS = 5000;
export const SPLIT = Date.parse('2024-01-01T00:00:00Z');
export const REG = ['נמוך', 'בינוני', 'גבוה'];

// תנודתיות 24 שעות בכל נר 15 דקות: סטיית תקן של 96 תשואות לוג עד הנר כולל (NaN אם אין מספיק)
export function vol24(b15, n = VOL_N){
  const V = new Float64Array(b15.length).fill(NaN); let s = 0, s2 = 0; const r = [];
  for (let k = 1; k < b15.length; k++){
    const x = Math.log(b15[k].c / b15[k - 1].c); r.push(x); s += x; s2 += x * x;
    if (r.length > n){ const y = r[r.length - n - 1]; s -= y; s2 -= y * y; }
    if (r.length >= n){ const m = s / n; V[k] = Math.sqrt(Math.max(0, s2 / n - m * m) * n / (n - 1)); }
  }
  return V;
}
const quant = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)))];

// ספים יומיים מהנתונים של לפני היום בלבד (חלון מתרחב עד 365 יום, מינימום 90). מחזיר פונקציה: (k) → אחוזון או NaN
export function percentileOf(b15, V, cuts = CUTS){
  const days = new Map(); // day → { sorted }
  let lo = 0;
  const firstT = b15.find((_, k) => Number.isFinite(V[k]))?.t ?? Infinity;
  return (k) => {
    const t = b15[k].t, day = Math.floor(t / DAY) * DAY;
    if (day - firstT < MIN_DAYS * DAY || !Number.isFinite(V[k])) return null;
    let d = days.get(day);
    if (!d){
      const from = day - LOOKBACK_DAYS * DAY;
      while (lo < b15.length && b15[lo].t < from) lo++;
      const vals = []; for (let j = lo; j < b15.length && b15[j].t < day; j++) if (Number.isFinite(V[j])) vals.push(V[j]);
      const sorted = Float64Array.from(vals).sort();
      d = { sorted, th: cuts.map((p) => quant(sorted, p)), q5: [0.2, 0.4, 0.6, 0.8].map((p) => quant(sorted, p)) };
      days.set(day, d);
    }
    const v = V[k];
    return { reg: v < d.th[0] ? 0 : v < d.th[1] ? 1 : 2, q5: d.q5.filter((x) => v >= x).length };
  };
}

// עסקאות base של מטבע, עם משטר, סיכון ו-R
export function coinTrades(coin, m1){
  const b15 = bars15(m1), V = vol24(b15), pct = percentileOf(b15, V), idx = new Map(b15.map((b, k) => [b.t, k]));
  const base = runB2(m1, b15, VARIANTS[0]).trades, slip = SLIP_OF(coin), out = [];
  for (const x of base){
    const k = idx.get(x.t), sig = signal(b15.slice(k - BOT2.bbN + 1, k + 1), BOT2), p = pct(k);
    if (!p) continue;
    const risk = x.qty * Math.abs(sig.entryRef - sig.sl), net = pnlOf(x, COSTS.actual, slip);
    out.push({ coin, t: x.t, reg: p.reg, q5: p.q5, net, gross: pnlOf(x, COSTS.zero, 0), net2: pnlOf(x, COSTS.actual, slip * 2), risk, R: net / risk });
  }
  return out;
}

export function rng(seed){ let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
// מדגם חוזר בבלוקים של שבוע קלנדרי (כל המטבעות באותו שבוע = בלוק אחד): רווח בר-סמך 95% לממוצע לעסקה
export function blockBoot(tr, reps = REPS, seed = SEED){
  const wk = new Map(); for (const x of tr){ const w = Math.floor(x.t / WEEK); const b = wk.get(w) || { s: 0, n: 0 }; b.s += x.net; b.n++; wk.set(w, b); }
  const B = [...wk.values()], R = rng(seed), m = [];
  if (B.length < 2) return { lo: NaN, hi: NaN, weeks: B.length, posWeeks: NaN };
  for (let r = 0; r < reps; r++){ let s = 0, n = 0; for (let i = 0; i < B.length; i++){ const b = B[Math.floor(R() * B.length)]; s += b.s; n += b.n; } m.push(s / n); }
  m.sort((a, b) => a - b);
  return { lo: m[Math.floor(0.025 * reps)], hi: m[Math.floor(0.975 * reps)], weeks: B.length, posWeeks: B.filter((b) => b.s > 0).length / B.length };
}
export function summary(tr, seed = SEED){
  const n = tr.length, s = (f) => tr.reduce((a, x) => a + f(x), 0);
  if (!n) return { n: 0 };
  const sorted = [...tr].sort((a, b) => a.t - b.t); let eq = 0, pk = 0, dd = 0; for (const x of sorted){ eq += x.net; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  const byNet = tr.map((x) => x.net).sort((a, b) => b - a), total = s((x) => x.net), Rs = tr.map((x) => x.R).sort((a, b) => a - b);
  const q = (p) => Rs[Math.min(n - 1, Math.floor(p * n))];
  return { n, mean: total / n, gross: s((x) => x.gross) / n, mean2: s((x) => x.net2) / n, total, fees: s((x) => x.gross - x.net), dd,
    noTop1: total - byNet.slice(0, 1).reduce((a, b) => a + b, 0), noTop3: total - byNet.slice(0, 3).reduce((a, b) => a + b, 0), noTop5: total - byNet.slice(0, 5).reduce((a, b) => a + b, 0),
    R: { p5: q(0.05), p50: q(0.5), p95: q(0.95), max: Rs[n - 1], over2: Rs.filter((x) => x > 2).length / n }, boot: blockBoot(tr, REPS, seed) };
}
export function decide(valTrades){
  const hi = valTrades.filter((x) => x.reg === 2), lo = valTrades.filter((x) => x.reg === 0), S = summary(hi);
  const perCoin = VALIDATE.map((c) => { const t = hi.filter((x) => x.coin === c); return { coin: c, n: t.length, mean: t.length ? t.reduce((a, x) => a + x.net, 0) / t.length : NaN }; });
  const pos = perCoin.filter((x) => x.mean > 0).length;
  const p1 = summary(hi.filter((x) => x.t < SPLIT)).mean, p2 = summary(hi.filter((x) => x.t >= SPLIT)).mean, loM = summary(lo).mean;
  const c = { c1: S.mean > 0 && S.boot.lo > 0, c2: pos >= 5, c3: p1 > 0 && p2 > 0, c4: S.mean > loM };
  return { ...c, pass: c.c1 && c.c2 && c.c3 && c.c4, hi: S, perCoin, pos, p1, p2, loMean: loM };
}

const f$ = (x) => (!Number.isFinite(x) ? '—' : (x < 0 ? '‎−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US'));
const fp = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—'), fr = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
function table(title, tr){
  const L = [`### ${title}`, '', '| משטר | עסקאות | $ לעסקה (אחרי) | לפני עלויות | החלקה כפולה | סה״כ | עמלות | ירידה מקס׳ | בלי הטובה / 3 / 5 | R חציון / 95% / מקס׳ | R>2 | שבועות חיוביים | בר-סמך 95% (בלוקים) |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const [i, name] of [[0, REG[0]], [1, REG[1]], [2, REG[2]], [-1, 'הכול']]){
    const S = summary(i < 0 ? tr : tr.filter((x) => x.reg === i)); if (!S.n){ L.push(`| ${name} | 0 |||||||||||| `); continue; }
    L.push(`| ${name} | ${S.n} | ${f$(S.mean)} | ${f$(S.gross)} | ${f$(S.mean2)} | ${f$(S.total)} | ${f$(-S.fees)} | ${f$(-S.dd)} | ${f$(S.noTop1)} / ${f$(S.noTop3)} / ${f$(S.noTop5)} | ${fr(S.R.p50)} / ${fr(S.R.p95)} / ${fr(S.R.max)} | ${fp(S.R.over2)} | ${fp(S.boot.posWeeks)} | ${f$(S.boot.lo)} … ${f$(S.boot.hi)} |`);
  }
  L.push('', '| חמישון תנודתיות (לתצוגה בלבד) | ' + [1, 2, 3, 4, 5].join(' | ') + ' |', '|---|---|---|---|---|---|');
  L.push('| $ לעסקה (עסקאות) | ' + [0, 1, 2, 3, 4].map((q) => { const t = tr.filter((x) => x.q5 === q); return t.length ? `${f$(t.reduce((a, x) => a + x.net, 0) / t.length)} (${t.length})` : '—'; }).join(' | ') + ' |', '');
  return L;
}

async function main(){
  const OUTDIR = arg('--outdir', 'invest/docs/research/bot2-regime');
  const { loadCoin } = await import('./research-amit-course.mjs');
  const t0 = Date.now(), all = {}, meta = {};
  for (const coin of [EXPLORE, ...VALIDATE]){
    const d = await loadCoin(coin); meta[coin] = { first: d.first, bars: d.m1.t.length };
    if (d.m1.t.length < 100000){ log(`${coin}: אין מספיק נרות — לא נכלל`); all[coin] = []; continue; }
    all[coin] = coinTrades(coin, d.m1); log(`${coin}: ${all[coin].length} עסקאות עם משטר`);
    d.m1 = null;
  }
  const val = VALIDATE.flatMap((c) => all[c]), dec = decide(val);
  const md = ['# בוט 2 לפי משטר תנודתיות — 2020 → 10/2026, נרות דקה', '', 'פרוטוקול נעול: [`PROTOCOL_v1.0.md`](PROTOCOL_v1.0.md). הרצה אחת. האות והביצוע כמו הבוט היום; משטר = אחוזון התנודתיות של 24 השעות שלפני הכניסה, מול השנה שקדמה.', '',
    '## 1. גישוש — ETH (ההשערה נולדה מנתוני ETH; לא להכרעה)', '', ...table('ETH', all[EXPLORE]),
    '## 2. אימות — 8 מטבעות מאוחדים (ההכרעה)', '', ...table('8 מטבעות', val),
    '### המשטר הגבוה לפי מטבע ולפי תקופה', '', '| מטבע | עסקאות במשטר הגבוה | $ לעסקה |', '|---|---|---|', ...dec.perCoin.map((x) => `| ${x.coin} | ${x.n} | ${f$(x.mean)} |`), '',
    `- 2020–2023: ${f$(dec.p1)} לעסקה · 2024 → 10/2026: ${f$(dec.p2)} לעסקה · המשטר הנמוך: ${f$(dec.loMean)} לעסקה.`, '',
    '## 3. הכרעה', '',
    `1. ממוצע במשטר הגבוה > 0 וגבול תחתון של בר-סמך > 0: ${dec.c1 ? '✅' : '❌'} (${f$(dec.hi.mean)}; ${f$(dec.hi.boot.lo)} … ${f$(dec.hi.boot.hi)})`,
    `2. חיובי ב-5 מטבעות לפחות מתוך 8: ${dec.c2 ? '✅' : '❌'} (${dec.pos}/8)`,
    `3. חיובי בשתי התקופות: ${dec.c3 ? '✅' : '❌'}`,
    `4. הגבוה טוב מהנמוך: ${dec.c4 ? '✅' : '❌'}`, '',
    dec.pass ? '**ההשערה מאושרת — מועמד לבדיקה נוספת בלבד** (עמידות לזנבות, עלויות ביצוע, אימות קדימה). לא שינוי בדמו ולא כסף אמיתי.' : '**`FAIL` — אין משטר תנודתיות שבו בוט 2 רווחי אחרי עלויות במטבעות האימות.**'];
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(join(OUTDIR, 'report.md'), md.join('\n') + '\n');
  writeFileSync(join(OUTDIR, 'results.json'), JSON.stringify({ meta, decision: dec, eth: [0, 1, 2].map((r) => summary(all[EXPLORE].filter((x) => x.reg === r))) }, null, 1));
  log(`סיום (${Math.round((Date.now() - t0) / 1000)}s)`); console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
