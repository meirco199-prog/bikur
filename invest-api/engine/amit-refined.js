// "הגרסה המזוקקת" של שיטת עמית — הצעה שמאיר הדביק (10/11/2026, מקור חיצוני): קונפלואנס של 4 תנאים, 2 מנות שוות, סטופ קשיח,
// מימוש 50/30/20. נבדקת כמו שהיא — המפרט נקבע לפני הריצה, בלי כיול. מחקר בלבד: פונקציות טהורות, בלי רשת ובלי פקודות.
//
// המפרט (ופירוש מכני של מה שנכתב):
//   עוגן ואזור: כמו engine/amit-course.js (דשדוש 4 שעות על 15 דק׳, טווח ≤ תחתית האזור), קטגוריה קבועה — בלי מעבר באמצע ("הפסקת הדינמיות").
//   תנאים, כולם בנר 15 דק׳ שנסגר:
//     1. אזור: השפל של הנר ≤ עוגן × (1 − z0), והסגירה ≥ עוגן × (1 − z1 − 1.4%) (לא מעבר לסוף ההנזלה).
//     2. רמת עוגן: הנר נגע (±0.2%) ב-EMA200 של שעה / 4 שעות / יום (הנר הגבוה האחרון שנסגר) או ב-VWAP היומי.
//     3. דייברג'נס RSI(14) על 15 דק׳: שפל חדש (נמוך מהשפל של 6–48 הנרות הקודמים) עם RSI גבוה יותר מאשר בשפל הקודם.
//     4. נר אישור: פתיל תחתון ≥ 75% מהגוף וגם ≥ 40% מטווח הנר, וווליום ≥ ×3 מהממוצע היומי.
//   כניסה: 50% בסגירת נר האישור, 50% בפקודה ממתינה 0.9% מתחת לשפל הנר (אמצע ההנזלה 0.4–1.4%).
//   סטופ קשיח: 0.5% מתחת לקצה ההנזלה = 1.9% מתחת לשפל הנר. גודל: סיכון קבוע (400$ אם שתי המנות התמלאו).
//   יציאה: 50% ברמה הקרובה מעל הממוצע (EMA20/EMA50/VWAP של 15 דק׳) → סטופ לכניסה; 30% ב-EMA200 של 15 דק׳; 20% עם סטופ נגרר 1%
//   מתחת לשיא מאז המימוש הראשון. יציאת זמן: 24 שעות.
import { CATS, COURSE_COST, RISK_USD, MAX_NOTIONAL } from './amit-course.js';

const M15 = 900e3, H1 = 3600e3, DAY = 86400e3;

// EMA על נרות של טווח גבוה (סגירות של 15 דק׳ מקובצות), ממופה לכל נר 15 דק׳ = ערך הנר הגבוה האחרון שנסגר עד סוף הנר
function htfEma(q, ms, N){
  const out = new Float64Array(q.c.length).fill(NaN), k = 2 / (N + 1);
  let e = NaN, cnt = 0, lastB = -1, closed = true, prevC = NaN;
  const add = (c) => { e = cnt === 0 ? c : c * k + e * (1 - k); cnt++; };
  for (let j = 0; j < q.c.length; j++){
    const b = Math.floor(q.t[j] / ms);
    if (b !== lastB && !closed) add(prevC);                  // הנר הגבוה הקודם נסגר בלי שראינו את הרבע האחרון שלו (פער בנתונים)
    if (b !== lastB){ lastB = b; closed = false; }
    prevC = q.c[j];
    if (Math.floor((q.t[j] + M15) / ms) !== b){ add(q.c[j]); closed = true; } // הנר הזה סוגר את הנר הגבוה
    out[j] = cnt >= N ? e : NaN;
  }
  return out;
}
export function rsi(c, N = 14){
  const out = new Float64Array(c.length).fill(NaN); let up = 0, dn = 0;
  for (let i = 1; i < c.length; i++){
    const d = c[i] - c[i - 1], u = Math.max(d, 0), w = Math.max(-d, 0);
    if (i <= N){ up += u; dn += w; if (i === N){ up /= N; dn /= N; out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn); } continue; }
    up = (up * (N - 1) + u) / N; dn = (dn * (N - 1) + w) / N; out[i] = dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
  }
  return out;
}
// מוסיף ל-ctx של amit-course.prepare את מה שהגרסה המזוקקת צריכה
export function extend(ctx){
  const { q, idx15, n } = ctx;
  q.rsi = rsi(q.c, 14); q.e200h1 = htfEma(q, H1, 200); q.e200h4 = htfEma(q, 4 * H1, 200); q.e200d1 = htfEma(q, DAY, 200);
  q.first1m = new Int32Array(q.c.length).fill(-1);
  for (let i = n - 1; i >= 0; i--) q.first1m[idx15[i]] = i;
  return ctx;
}

// opt: { need: { zone, level, rsi, wick } (ברירת מחדל: הכול true), entry: 'two'|'single' }
export function signals(ctx, cat, opt = {}){
  const q = ctx.q, need = { zone: true, level: true, rsi: true, wick: true, ...(opt.need || {}) }, P = CATS[cat], out = [];
  const K = 16, W = P.zone[0] / 100, maxAge = 4 * DAY;
  let anchor = NaN, anchorT = 0;
  for (let j = K; j < q.c.length; j++){
    // עוגן (כמו amit-course): דשדוש של 4 שעות שהשפל שלו לא בשני הנרות האחרונים
    let hi = -Infinity, lo = Infinity, at = -1; for (let k = j - K + 1; k <= j; k++){ if (q.h[k] > hi) hi = q.h[k]; if (q.l[k] < lo){ lo = q.l[k]; at = k; } }
    const end = q.t[j] + M15;
    if ((hi - lo) / lo <= W && at <= j - 2){ anchor = lo; anchorT = end; continue; }
    if (!Number.isFinite(anchor)) continue;
    if (end - anchorT > maxAge){ anchor = NaN; continue; }
    const l = q.l[j], h = q.h[j], c = q.c[j], o = q.o[j];
    const zoneOk = l <= anchor * (1 - P.zone[0] / 100) && c >= anchor * (1 - (P.zone[1] + P.flush[1]) / 100);
    if (need.zone && !zoneOk) continue;
    if (!need.zone && !(l < anchor)) continue;
    if (need.level){ const lv = [q.e200h1[j], q.e200h4[j], q.e200d1[j], q.vwap[j]]; if (!lv.some((x) => Number.isFinite(x) && l <= x * 1.002 && h >= x * 0.998)) continue; }
    if (need.rsi){
      if (!(j >= 50 && l <= Math.min(q.l[j - 1], q.l[j - 2]))) continue;
      let pl = Infinity, p = -1; for (let k = j - 48; k <= j - 6; k++) if (q.l[k] < pl){ pl = q.l[k]; p = k; }
      if (!(l < pl && q.rsi[j] > q.rsi[p])) continue;
    }
    if (need.wick){ const wick = Math.min(o, c) - l, body = Math.abs(c - o); if (!(wick >= 0.75 * body && wick >= 0.4 * (h - l) && q.v[j] >= 3 * q.vAvg96[j])) continue; }
    if (j + 1 >= q.c.length || q.first1m[j + 1] < 0) continue;
    out.push({ j, i: q.first1m[j + 1], t: q.t[j] + M15, c, L: l, anchor });
    anchor = NaN; // אזור שנוצל
  }
  return out;
}

// ביצוע על נרות דקה. opt: { coin, entry: 'two'|'single', maxHoldMin }
export function execute(ctx, sigs, opt = {}){
  const { m1, n, idx15, q } = ctx, coin = opt.coin || 'BTC', C = COURSE_COST;
  const hs = (C.halfSpreadBps[coin] ?? 2) / 1e4, sl = (C.slipBps[coin] ?? 3) / 1e4, pen = C.penBps / 1e4, mk = C.makerBps / 1e4, tk = C.takerBps / 1e4;
  const W = opt.entry === 'single' ? [1, 0] : [0.5, 0.5], maxHold = (opt.maxHoldMin || 1440) * 60e3, trades = [];
  let busy = -1;
  for (const g of sigs){
    if (g.i <= busy || g.i >= n) continue;
    const px = [g.c, g.L * (1 - 0.009)], stop0 = g.L * (1 - 0.019);
    const lossPer = W.reduce((s, w, k) => s + w * (1 - stop0 / px[k]), 0), N = Math.min(RISK_USD / lossPer, MAX_NOTIONAL);
    let qty = 0, cost$ = 0, fees = 0, spread = 0, slip = 0, gross = 0, fills = 0, maxCost = 0;
    const fee = (usd, maker) => { if (maker) fees += usd * mk; else { fees += usd * tk; spread += usd * hs; slip += usd * sl; } };
    const buy = (k, price, maker) => { const usd = W[k] * N; qty += usd / price; cost$ += usd; maxCost += usd; fills++; fee(usd, maker); };
    const sellQ = (u, price, maker) => { if (u <= 0) return; const f = u / qty, usd = u * price; gross += usd - cost$ * f; cost$ -= cost$ * f; qty -= u; fee(usd, maker); };
    buy(0, px[0], false);
    let open2 = W[1] > 0, st = stop0, phase = 0, q0 = 0, peak = 0, why = 'זמן', k = g.i, tp2 = NaN;
    const tEnd = g.t + maxHold;
    for (; k < n && m1.t[k] <= tEnd; k++){
      const lo = m1.l[k], hi = m1.h[k], o = m1.o[k];
      let filled = false;
      if (open2 && phase === 0 && lo <= px[1] * (1 - pen)){ buy(1, px[1], true); open2 = false; filled = true; }
      const stopPx = phase === 2 ? Math.max(st, peak * 0.99) : st;
      if (lo <= stopPx){ sellQ(qty, Math.min(stopPx, o), false); why = phase === 0 ? 'סטופ' : phase === 1 ? 'יעד 1 + סטופ בכניסה' : 'יעד 1+2 + נגרר'; break; }
      const j = idx15[k] - 1; if (j < 0 || filled) continue;
      const avg = cost$ / qty;
      if (phase === 0){
        const lv = [q.ema20[j], q.ema50[j], q.vwap[j]].filter((x) => x > avg * 1.003).sort((a, b) => a - b), tp1 = lv.length ? lv[0] : avg * 1.01;
        if (hi >= tp1 * (1 + pen)){ q0 = qty; sellQ(q0 * 0.5, tp1, true); open2 = false; st = avg * 1.0006; phase = 1; tp2 = q.ema200[j] > tp1 * 1.002 ? q.ema200[j] : tp1 * 1.01; peak = hi; }
      } else if (phase === 1){
        peak = Math.max(peak, hi);
        if (hi >= tp2 * (1 + pen)){ sellQ(Math.min(qty, q0 * 0.3), tp2, true); phase = 2; }
      } else peak = Math.max(peak, hi);
    }
    if (qty > 1e-12){ sellQ(qty, m1.c[Math.min(k, n - 1)], false); if (why === 'זמן' && phase) why = phase === 1 ? 'יעד 1 + זמן' : 'יעד 1+2 + זמן'; }
    const tExit = m1.t[Math.min(k, n - 1)], funding = maxCost * 1e-4 * (tExit - g.t) / 3600e3 / 8;
    trades.push({ coin, tEntry: g.t, tExit, gross, fees, spread, slip, funding, budget: RISK_USD, notional: maxCost, planned: N, fills, why });
    busy = Math.min(k, n - 1);
  }
  return trades;
}
