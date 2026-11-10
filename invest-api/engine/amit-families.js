// משפחות אסטרטגיה להשוואה מול שיטת הקורס של עמית (בריף המחקר של מאיר, 10/11/2026, סעיפים ו–ח). מחקר בלבד: פונקציות טהורות.
//
// כל המשפחות עובדות על נרות 15 דק׳ שנסגרו (בלי מבט לעתיד), והביצוע מדומה על נרות דקה מהדקה הראשונה שאחרי סגירת נר האות:
//   B  "שטיפה וחזרה": עוגן = שפל דשדוש (כמו בקורס); נר שירד מתחת לעוגן (≥0.2%, ולא מעבר לסוף ההנזלה), ואז תוך 8 נרות סגירה מעל העוגן.
//      סטופ 0.2% מתחת לשפל השטיפה. מסננים: none / ema (השטיפה נגעה ב-EMA200 של שעה/4ש׳/יום או ב-VWAP) / rsi (RSI בשפל השטיפה גבוה
//      מאשר בשפל העוגן) / vol (נר עם ווליום ≥ ×3 בשטיפה) / all.
//   C  "ריטסט": פריצה (סגירה מעל שיא הדשדוש + 0.2%), ואז ריטסט מס׳ 1/2/3: נר שנוגע בשיא (≤ +0.2%) וסוגר מעליו. סטופ: השיא − z0%.
//   X  קווי בסיס פשוטים: emaX (EMA20 חוצה מעל EMA50 כשהמחיר מעל EMA200), brk (סגירה מעל שיא 96 הנרות הקודמים), mr (RSI חוזר מעל 30),
//      rnd (זמן אקראי). סטופ: z0% מתחת לסגירה.
//   יציאות (H): R1 / R1.5 / R2 / R3 (יעד קבוע), part (50% ב-1R → סטופ לכניסה, השאר ב-3R), t4 (רק סטופ, יציאה אחרי 4 שעות), ema (הרמה
//      הקרובה EMA20/EMA50/VWAP של 15 דק׳). מקסימום 24 שעות.
//   שורט: כל משפחה רצה גם על הסדרה ההפוכה (מחיר → 1/מחיר; גבוה↔נמוך) — אותו קוד בדיוק, סימטריה מכוונת.
import { CATS, COURSE_COST, RISK_USD, MAX_NOTIONAL } from './amit-course.js';

const M15 = 900e3, DAY = 86400e3;

export function invert(m1){
  const n = m1.t.length, r = { t: m1.t, o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: m1.v };
  for (let i = 0; i < n; i++){ r.o[i] = 1 / m1.o[i]; r.h[i] = 1 / m1.l[i]; r.l[i] = 1 / m1.h[i]; r.c[i] = 1 / m1.c[i]; }
  return r;
}

// עוגן הדשדוש (כמו engine/amit-course.js): חלון של 4 שעות שטווחו ≤ z0, והשפל שלו לא בשני הנרות האחרונים
function consAt(q, j, K, W){
  let hi = -Infinity, lo = Infinity, at = -1; for (let k = j - K + 1; k <= j; k++){ if (q.h[k] > hi) hi = q.h[k]; if (q.l[k] < lo){ lo = q.l[k]; at = k; } }
  return (hi - lo) / lo <= W && at <= j - 2 ? { lo, hi, at } : null;
}
const sig = (q, j, extra) => (j + 1 < q.c.length && q.first1m[j + 1] >= 0 ? { j, i: q.first1m[j + 1], t: q.t[j] + M15, ...extra } : null);

export function sweepReclaim(ctx, cat, filter = 'none'){
  const q = ctx.q, P = CATS[cat], K = 16, W = P.zone[0] / 100, out = [];
  let A = null, sw = null;                                   // A = {lo, at, t}; sw = {low, lowJ, start, ema, vol}
  for (let j = K; j < q.c.length; j++){
    const c0 = consAt(q, j, K, W);
    if (c0 && !sw){ A = { lo: c0.lo, at: c0.at, t: q.t[j] }; continue; }
    if (!A) continue;
    if (q.t[j] - A.t > 4 * DAY){ A = null; sw = null; continue; }
    const deepMax = A.lo * (1 - (P.zone[1] + P.flush[1]) / 100);
    if (!sw){
      if (q.l[j] < A.lo * 0.998){
        if (q.l[j] < deepMax){ A = null; continue; }        // שבירה מעבר לסוף ההנזלה — לא שטיפה
        sw = { low: q.l[j], lowJ: j, start: j, ema: false, vol: false };
      } else continue;
    } else if (q.l[j] < sw.low){ if (q.l[j] < deepMax){ A = null; sw = null; continue; } sw.low = q.l[j]; sw.lowJ = j; }
    const lv = [q.e200h1[j], q.e200h4[j], q.e200d1[j], q.vwap[j]];
    if (lv.some((x) => Number.isFinite(x) && q.l[j] <= x * 1.002 && q.h[j] >= x * 0.998)) sw.ema = true;
    if (q.v[j] >= 3 * q.vAvg96[j]) sw.vol = true;
    if (j - sw.start > 8){ A = null; sw = null; continue; }
    if (q.c[j] > A.lo && j > sw.start){
      const rsiOk = q.rsi[sw.lowJ] > q.rsi[A.at];
      const ok = filter === 'none' || (filter === 'ema' && sw.ema) || (filter === 'rsi' && rsiOk) || (filter === 'vol' && sw.vol) || (filter === 'all' && sw.ema && rsiOk && sw.vol);
      if (ok){ const s = sig(q, j, { stop: sw.low * 0.998 }); if (s) out.push(s); }
      A = null; sw = null;
    }
  }
  return out;
}

export function retest(ctx, cat, nth = 1){
  const q = ctx.q, P = CATS[cat], K = 16, W = P.zone[0] / 100, out = [];
  let R = null;                                              // {hi, t, broke, n}
  for (let j = K; j < q.c.length; j++){
    const c0 = consAt(q, j, K, W);
    if (c0 && !(R && R.broke)){ R = { hi: c0.hi, t: q.t[j], broke: false, n: 0 }; continue; }
    if (!R) continue;
    if (q.t[j] - R.t > 4 * DAY){ R = null; continue; }
    if (!R.broke){ if (q.c[j] > R.hi * 1.002) R.broke = true; continue; }
    if (q.c[j] < R.hi * (1 - P.zone[0] / 100)){ R = null; continue; }  // הפריצה נכשלה
    if (q.l[j] <= R.hi * 1.002 && q.c[j] > R.hi){
      R.n++;
      if (R.n === nth){ const s = sig(q, j, { stop: R.hi * (1 - P.zone[0] / 100) }); if (s) out.push(s); R = null; }
    }
  }
  return out;
}

export function baseline(ctx, cat, kind, seed = 1){
  const q = ctx.q, z0 = CATS[cat].zone[0] / 100, out = [];
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  let hh = -Infinity;
  for (let j = 200; j < q.c.length; j++){
    let go = false;
    if (kind === 'emaX') go = q.ema20[j - 1] <= q.ema50[j - 1] && q.ema20[j] > q.ema50[j] && q.c[j] > q.ema200[j];
    else if (kind === 'brk'){ hh = -Infinity; for (let k = j - 96; k < j; k++) if (q.h[k] > hh) hh = q.h[k]; go = q.c[j] > hh; }
    else if (kind === 'mr') go = q.rsi[j - 1] < 30 && q.rsi[j] >= 30;
    else if (kind === 'rnd') go = rnd() < 1 / 96;            // בממוצע אות אחד ביום
    if (go){ const x = sig(q, j, { stop: q.c[j] * (1 - z0) }); if (x) out.push(x); }
  }
  return out;
}

// ביצוע כניסה אחת בשוק (פתיחת דקה אחרי האות), סטופ קשיח, יציאה לפי exit. פוזיציה אחת בכל רגע למטבע.
export function run(ctx, sigs, exit, opt = {}){
  const { m1, n, idx15, q } = ctx, coin = opt.coin || 'BTC', C = COURSE_COST;
  const hs = (C.halfSpreadBps[coin] ?? 2) / 1e4, sl = (C.slipBps[coin] ?? 3) / 1e4, pen = (opt.penBps ?? C.penBps) / 1e4, mk = C.makerBps / 1e4, tk = C.takerBps / 1e4;
  const trades = []; let busy = -1;
  for (const g of sigs){
    if (g.i <= busy || g.i >= n) continue;
    const e = m1.o[g.i] * (1 + hs + sl), dist = (e - g.stop) / e;      // מחיר כניסה בפועל (כולל מרווח והחלקה)
    if (!(dist > 0.0015 && dist < 0.2)) continue;
    const N = Math.min(RISK_USD / dist, MAX_NOTIONAL), Rpx = e - g.stop;
    let rem = 1, gross = 0, fees = N * tk, spread = N * hs, slip = N * sl, st = g.stop, why = 'זמן', k = g.i, part = false, mae = 0, mfe = 0;
    const out = (frac, px, maker) => { const usd = N * frac * px / e; gross += usd - N * frac; fees += usd * (maker ? mk : tk); if (!maker){ spread += usd * hs; slip += usd * sl; } rem -= frac; };
    const tgt = exit[0] === 'R' ? e + Number(exit.slice(1)) * Rpx : exit === 'part' ? e + 3 * Rpx : NaN;
    const tEnd = g.t + (exit === 't4' ? 4 : 24) * 3600e3;
    for (; k < n && m1.t[k] <= tEnd; k++){
      const lo = m1.l[k], hi = m1.h[k], o = m1.o[k];
      mae = Math.min(mae, (lo - e) / Rpx); mfe = Math.max(mfe, (hi - e) / Rpx);   // MAE/MFE ב-R עד היציאה
      if (lo <= st){ out(rem, Math.min(st, o), false); why = part ? 'יעד חלקי + סטופ בכניסה' : 'סטופ'; break; }
      if (k === g.i) continue;                                  // בדקת הכניסה — רק סטופ (שמרני)
      if (exit === 'part' && !part && hi >= (e + Rpx) * (1 + pen)){ out(0.5, e + Rpx, true); part = true; st = e * 1.0006; }
      let T = tgt;
      if (exit === 'ema'){ const j = idx15[k] - 1; const lv = [q.ema20[j], q.ema50[j], q.vwap[j]].filter((x) => x > e * 1.003); T = lv.length ? Math.min(...lv) : e + Rpx; }
      if (Number.isFinite(T) && hi >= T * (1 + pen)){ out(rem, T, true); why = part ? 'יעד חלקי + 3R' : 'יעד'; break; }
    }
    if (rem > 1e-9){ out(rem, m1.c[Math.min(k, n - 1)], false); }
    const tExit = m1.t[Math.min(k, n - 1)];
    trades.push({ coin, tEntry: g.t, tExit, gross, fees, spread, slip, funding: N * 1e-4 * (tExit - g.t) / 3600e3 / 8, budget: RISK_USD, planned: N, why, mae, mfe, entry: e, stop: g.stop });
    busy = Math.min(k, n - 1);
  }
  return trades;
}

// ---------- שכבת תיק: סיכון כאחוז מההון, מגבלת פוזיציות פתוחות, מגבלת הפסד יומית ----------
// trades: [{coin, tEntry, tExit, R}] (R = נטו/סיכון). מחזיר עקומת הון יומית ומדדים.
export function portfolio(trades, { riskPct = 0.5, maxOpen = 3, dayLossPct = 2, from = -Infinity, to = Infinity } = {}){
  const T = trades.filter((x) => x.tEntry >= from && x.tEntry < to).sort((a, b) => a.tEntry - b.tEntry);
  let eq = 1, open = [], day = -1, dayStart = 1, blocked = false, taken = 0, skipped = 0;
  const realized = [];                                           // [tExit, pnl]
  for (const x of T){
    open = open.filter((o) => { if (o.tExit <= x.tEntry){ eq += o.pnl; realized.push([o.tExit, o.pnl]); return false; } return true; });
    const d = Math.floor(x.tEntry / DAY); if (d !== day){ day = d; dayStart = eq; blocked = false; }
    if (eq <= dayStart * (1 - dayLossPct / 100)) blocked = true;
    if (blocked || open.length >= maxOpen){ skipped++; continue; }
    open.push({ tExit: x.tExit, pnl: eq * riskPct / 100 * x.R }); taken++;
  }
  for (const o of open){ eq += o.pnl; realized.push([o.tExit, o.pnl]); }
  realized.sort((a, b) => a[0] - b[0]);
  // עקומה יומית
  const byDay = new Map(); let e2 = 1; for (const [t, p] of realized){ e2 += p; byDay.set(Math.floor(t / DAY), e2); }
  const d0 = Number.isFinite(from) ? Math.floor(from / DAY) : (realized.length ? Math.floor(realized[0][0] / DAY) : 0), d1 = Number.isFinite(to) ? Math.floor(to / DAY) : (realized.length ? Math.floor(realized.at(-1)[0] / DAY) : 0);
  const curve = []; let last = 1; for (let d = d0; d <= d1; d++){ if (byDay.has(d)) last = byDay.get(d); curve.push(last); }
  let peak = 1, dd = 0; const rets = []; for (let i = 0; i < curve.length; i++){ peak = Math.max(peak, curve[i]); dd = Math.max(dd, 1 - curve[i] / peak); if (i) rets.push(curve[i] / curve[i - 1] - 1); }
  const m = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0, sd = rets.length > 1 ? Math.sqrt(rets.reduce((a, b) => a + (b - m) ** 2, 0) / (rets.length - 1)) : 0;
  const years = curve.length / 365, cagr = curve.length ? (curve.at(-1) ** (1 / Math.max(years, 1e-9)) - 1) : 0;
  const months = new Map(); for (let i = 0; i < curve.length; i++){ const mo = new Date((d0 + i) * DAY).toISOString().slice(0, 7); if (!months.has(mo)) months.set(mo, [curve[i - 1] ?? 1, curve[i]]); else months.get(mo)[1] = curve[i]; }
  const negMonths = [...months.values()].filter(([a, b]) => b < a).length;
  let streak = 0, maxStreak = 0; for (const [, p] of realized){ if (p < 0){ streak++; maxStreak = Math.max(maxStreak, streak); } else streak = 0; }
  return { final: curve.at(-1) ?? 1, cagr, maxDD: dd, sharpe: sd > 0 ? m / sd * Math.sqrt(365) : 0, negMonths, months: months.size, maxLossStreak: maxStreak, taken, skipped, dailyRets: rets };
}

// Bootstrap בבלוקים של ימים (שומר על תלות בתוך היום/השבוע): רווח סמך לתשואה השנתית הממוצעת
export function blockBootstrap(rets, { block = 7, iters = 1000, seed = 5 } = {}){
  if (rets.length < block * 4) return null;
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = [];
  for (let it = 0; it < iters; it++){
    let sum = 0, n = 0; while (n < rets.length){ const st = Math.floor(rnd() * (rets.length - block)); for (let k = 0; k < block && n < rets.length; k++, n++) sum += rets[st + k]; }
    out.push(sum / n * 365);
  }
  out.sort((a, b) => a - b);
  return { lo: out[Math.floor(iters * 0.025)], mid: out[Math.floor(iters * 0.5)], hi: out[Math.floor(iters * 0.975)] };
}
// Monte Carlo על סדר העסקאות: התפלגות הירידה המקסימלית (ב-R) — 5% / 50% / 95%
export function mcDrawdown(Rs, { iters = 1000, seed = 9 } = {}){
  if (Rs.length < 20) return null;
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const dds = [];
  for (let it = 0; it < iters; it++){
    const a = Rs.slice(); for (let i = a.length - 1; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    let eq = 0, pk = 0, dd = 0; for (const r of a){ eq += r; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); } dds.push(dd);
  }
  dds.sort((a, b) => a - b);
  return { p5: dds[Math.floor(iters * 0.05)], p50: dds[Math.floor(iters * 0.5)], p95: dds[Math.floor(iters * 0.95)] };
}
