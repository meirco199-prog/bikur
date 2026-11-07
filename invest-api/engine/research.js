// מסגרת ניסויים למסלול עמית: האם יש יתרון אמיתי שאפשר להפוך לאסטרטגיה אוטומטית רווחית? מחקר בלבד: פונקציות טהורות, בלי רשת,
// בלי פקודות. בקשת מאיר (7/11/2026, אחרי טורניר 30 הגרסאות, AI_COUNCIL#30): שמונה ניסויים, עלויות מלאות, ביצוע מציאותי של פקודות
// ממתינות, הפרדת אימון/אימות/מבחן, Walk-Forward, רגישות לעלויות ולתנאי שוק, ובחירה לפי ביטחון סטטיסטי ולא לפי הרווח הגבוה.
//
// ההבדלים מ-engine/tournament.js (שנשאר כפי שהוא):
//   • האותות מחושבים על נרות של טווח הזמן (1m/5m/15m/1h), אבל הביצוע מדומה על נרות הדקה. כך ידוע מה קרה קודם בתוך נר של 15 דקות
//     (סטופ או יעד). כשסטופ ויעד באותו נר דקה, מניחים סטופ (שמרני).
//   • עלויות: עמלת Maker/Taker, חצי מרווח קנייה־מכירה ו-Slippage לכל ביצוע מיידי (כניסה בשוק, סטופ, יציאת זמן, יעד בשוק),
//     ו-Funding לפי שעות ההחזקה (שיעור שעתי היסטורי אם סופק, אחרת 0.01% ל-8 שעות כעלות קבועה).
//   • פקודה ממתינה מתמלאת רק אם המחיר עבר אותה ב-penBps לפחות (נגיעה בדיוק = מקום בתור, אין מילוי). פקודה שהמחיר כבר עבר
//     כשהונחה נדחית (PostOnly). מילוי חלקי: לכל היותר partRate מהמחזור של נר הדקה; פחות מ-minFill מהגודל = לא נחשב מילוי.
//   • גודל: סיכון קבוע בדולרים לעסקה, עד maxNotional. מינוף לא עולה מעל מה שהבוטים משתמשים בו (190K$).
// הנחות שעדיין אופטימיות, ומופיעות בדוח: אין עיכוב רשת/שרת; מחזור Coinbase (ספוט) כמדד לנזילות של חוזה Bybit (בפועל גדול יותר,
// ולכן זה דווקא שמרני); ה-Funding מ-Hyperliquid (שעתי) כקירוב ל-Bybit (כל 8 שעות).

export const COST = Object.freeze({
  makerBps: 2, takerBps: 5.5,                                           // Bybit חשבון רגיל (נמדד בדמו, AI_COUNCIL#29)
  halfSpreadBps: { BTC: 0.5, ETH: 0.5, SOL: 1, XRP: 1, ADA: 1.5 },        // חצי מרווח בחוזה הצמוד, הערכה שמרנית
  slipBps: { BTC: 1, ETH: 1, SOL: 2, XRP: 2, ADA: 3 },                   // החלקה מעבר למרווח בפקודה מיידית
  fundingBpsPer8h: 1,                                                   // ברירת מחדל אם אין נתוני Funding: עלות תמיד
  penBps: 1, partRate: 0.1, minFill: 0.25,                              // מילוי פקודה ממתינה
});
export const RISK = Object.freeze({ riskUsd: 400, maxNotional: 190000, minStopPct: 0.15, maxStopPct: 3.5 });
export const TF_MIN = Object.freeze({ '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440 });
const HOLD = { '1m': 60, '5m': 48, '15m': 32, '1h': 24, '4h': 12, '1d': 60 };             // יציאת זמן: מספר נרות של טווח הזמן
const DAY = 86400e3;

// ---------- נתונים ומדדים ----------

// נרות דקה [{t,o,h,l,c,v}] (v = מחזור בדולרים) → טווח זמן גדול יותר. מקבלים קבוצה עם לפחות חצי מהדקות (ב-Coinbase דקה בלי
// עסקאות פשוט חסרה). t = תחילת הנר, end = סופו.
// baseMin: אורך נר הבסיס בדקות (1 = נרות דקה; 5 = בדיקה ארוכת טווח על נרות 5 דקות)
export function aggregate(m1, tf, baseMin = 1){
  const m = TF_MIN[tf], ms = m * 60e3;
  if (m < baseMin) return null;
  if (m === baseMin){ for (const b of m1) b.end = b.t + ms; return m1; } // בלי העתקה (זיכרון: שנה של נרות דקה)
  const out = []; let cur = null, n = 0;
  const flush = () => { if (cur && n >= m / baseMin / 2) out.push(cur); };
  for (const b of m1){
    const k = Math.floor(b.t / ms) * ms;
    if (!cur || cur.t !== k){ flush(); cur = { t: k, end: k + ms, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v || 0 }; n = 1; continue; }
    if (b.h > cur.h) cur.h = b.h; if (b.l < cur.l) cur.l = b.l; cur.c = b.c; cur.v += b.v || 0; n += 1;
  }
  flush();
  return out;
}

// רצועות בולינגר מתגלגלות (אוכלוסייה, כמו amit-rules.bands) על 20 הסגירות עד הנר i כולל
export function rollingBands(bars, n = 20, k = 2){
  const len = bars.length, lo = new Float64Array(len).fill(NaN), mid = new Float64Array(len).fill(NaN), up = new Float64Array(len).fill(NaN);
  for (let i = n - 1; i < len; i++){
    let s = 0; for (let j = i - n + 1; j <= i; j++) s += bars[j].c;
    const m = s / n; let v = 0; for (let j = i - n + 1; j <= i; j++) v += (bars[j].c - m) ** 2;
    const sd = Math.sqrt(v / n); lo[i] = m - k * sd; mid[i] = m; up[i] = m + k * sd;
  }
  return { lo, mid, up };
}
export function atr(bars, n = 14){
  const out = new Float64Array(bars.length).fill(NaN); let a = NaN;
  for (let i = 1; i < bars.length; i++){
    const b = bars[i], pc = bars[i - 1].c, tr = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
    a = i <= n ? (i === 1 ? tr : a + tr) : a; if (i === n) a /= n; else if (i > n) a = (a * (n - 1) + tr) / n;
    if (i >= n) out[i] = a;
  }
  return out;
}
export function ema(bars, n){
  const out = new Float64Array(bars.length).fill(NaN), k = 2 / (n + 1); let e = NaN;
  for (let i = 0; i < bars.length; i++){ e = i === 0 ? bars[0].c : bars[i].c * k + e * (1 - k); if (i >= n - 1) out[i] = e; }
  return out;
}
// האינדקס האחרון ב-arr (ממוין) שערכו ≤ x; ‎−1 אם אין
export function lastLE(arr, x, key = (a) => a){
  let lo = 0, hi = arr.length - 1, r = -1;
  while (lo <= hi){ const m = (lo + hi) >> 1; if (key(arr[m]) <= x){ r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}
const median = (a) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// סף סיבתי לפי יום: חציון החציונים היומיים של 30 הימים הקודמים (לפחות 10 ימים). אין שימוש בעתיד ואין כיול על כל התקופה.
export function trailingDailyThreshold(times, values, lookbackDays = 30, minDays = 10){
  const byDay = new Map();
  for (let i = 0; i < times.length; i++){ const v = values[i]; if (!Number.isFinite(v)) continue; const d = Math.floor(times[i] / DAY); (byDay.get(d) || byDay.set(d, []).get(d)).push(v); }
  const days = [...byDay.keys()].sort((a, b) => a - b), med = new Map(days.map((d) => [d, median(byDay.get(d))])), thr = new Map();
  for (const d of days){ const prev = []; for (let k = d - lookbackDays; k < d; k++) if (med.has(k)) prev.push(med.get(k)); thr.set(d, prev.length >= minDays ? median(prev) : NaN); }
  return (t) => { const v = thr.get(Math.floor(t / DAY)); return v === undefined ? NaN : v; };
}

// כל מה שהאותות והמסננים צריכים, לכל מטבע ולכל טווח זמן. m1 = נרות דקה עם v במחזור דולרי.
export function prepare(m1, { baseMin = 1 } = {}){
  const ctx = { m1, t1: Float64Array.from(m1, (b) => b.t), tf: {}, baseMs: baseMin * 60e3 };
  for (const tf of Object.keys(TF_MIN)){
    const bars = aggregate(m1, tf, baseMin); if (!bars) continue;
    const bb = rollingBands(bars), a = atr(bars), e50 = ema(bars, 50);
    const atrPct = Float64Array.from(bars, (b, i) => a[i] / b.c * 100), bbw = Float64Array.from(bars, (b, i) => (bb.up[i] - bb.lo[i]) / bb.mid[i] * 100);
    const ends = bars.map((b) => b.end);
    ctx.tf[tf] = { bars, bb, atr: a, ema50: e50, atrPct, bbw, ends, emaN: (n) => (ctx.tf[tf]['ema' + n] ||= ema(bars, n)),
      thrAtr: trailingDailyThreshold(ends, atrPct), thrBbw: trailingDailyThreshold(ends, bbw) };
  }
  // מפגש רמות (גל 2): EMA200 ו-VWAP יומי (מעוגן לחצות UTC) על נרות 15 דקות
  const Q = ctx.tf['15m']; Q.ema200 = ema(Q.bars, 200); Q.vwap = new Float64Array(Q.bars.length).fill(NaN);
  { let day = -1, pv = 0, vv = 0; Q.bars.forEach((b, i) => { const d = Math.floor(b.t / DAY); if (d !== day){ day = d; pv = 0; vv = 0; } pv += (b.h + b.l + b.c) / 3 * b.v; vv += b.v; Q.vwap[i] = vv > 0 ? pv / vv : NaN; }); }
  ctx.btc = ctx; // מוחלף ב-BTC על ידי הסקריפט (מסנן מגמת ביטקוין למטבעות האחרים)
  // נזילות: מחזור 24 שעות מנרות השעה, וסף יומי סיבתי
  const H = ctx.tf['1h'], liq = new Float64Array(H.bars.length).fill(NaN);
  for (let i = 23; i < H.bars.length; i++){ let s = 0; for (let j = i - 23; j <= i; j++) s += H.bars[j].v; liq[i] = s; }
  H.liq24 = liq; H.thrLiq = trailingDailyThreshold(H.ends, liq);
  return ctx;
}

// מגמה בנר הגבוה האחרון שנסגר עד t: מחיר מעל EMA50 ו-EMA50 עולה (3 נרות) = 1, הפוך = ‎−1, אחרת 0
function trendAt(T, t){
  const i = lastLE(T.ends, t); if (i < 3 || !Number.isFinite(T.ema50[i]) || !Number.isFinite(T.ema50[i - 3])) return 0;
  const c = T.bars[i].c, e = T.ema50[i], ep = T.ema50[i - 3];
  return c > e && e > ep ? 1 : c < e && e < ep ? -1 : 0;
}

// מאפייני האות (בזמן סגירת נר האות בלבד) + המסננים הבוליאניים. side: 1 לונג, ‎−1 שורט
function features(ctx, tf, i, side){
  const T = ctx.tf[tf], b = T.bars[i], t = b.end;
  let vs = 0, nv = 0; for (let j = Math.max(0, i - 20); j < i; j++){ vs += T.bars[j].v; nv += 1; }
  const rvol = nv && vs > 0 ? b.v / (vs / nv) : NaN, H = ctx.tf['1h'], hi = lastLE(H.ends, t), liq = hi >= 0 ? H.liq24[hi] : NaN;
  const tr1 = trendAt(ctx.tf['1h'], t), tr4 = trendAt(ctx.tf['4h'], t), hour = new Date(t).getUTCHours();
  const Q = ctx.tf['15m'], q = lastLE(Q.ends, t), ref = side > 0 ? b.l : b.h, tol = q >= 0 ? 0.25 * Q.atr[q] : NaN;
  const conf = q >= 0 && [Q.ema50[q], Q.ema200[q], Q.vwap[q]].some((x) => Number.isFinite(x) && Math.abs(ref - x) <= tol);
  const btc1 = trendAt((ctx.btc || ctx).tf['1h'], t);
  return {
    rvol2: rvol >= 2, conf, btc: side > 0 ? btc1 > 0 : btc1 < 0,
    trend: side > 0 ? tr1 > 0 && tr4 > 0 : tr1 < 0 && tr4 < 0,
    atr: T.atrPct[i] >= T.thrAtr(t), vol: T.bbw[i] >= T.thrBbw(t), rvol: rvol >= 1.5,
    liq: liq >= H.thrLiq(t), sess: hour >= 13 && hour < 21,
  };
}
export const FILTERS = Object.freeze(['trend', 'atr', 'vol', 'rvol', 'liq', 'sess', 'rvol2', 'conf', 'btc']);

// ---------- אסטרטגיות: נרות → אותות ----------
// אות = { t (זמן ההחלטה = סוף נר האות), legs: [{ side, type: 'limit'|'market', price? , stop(entry), target(entry, stop) }],
//        validMs (לפקודה ממתינה), holdMs, be (הזזת סטופ לכניסה בחצי הדרך), feat: { long: {...}, short: {...} } }

const stopFromPct = (pct) => (side, entry) => entry * (1 - side * pct / 100);
function targetFn(spec, bandTgt){ // spec: 'opp' | 'mid' | מספר R | 'none' (בלי יעד — יציאה בסטופ נגרר)
  if (spec === 'none') return (side) => side * Infinity;
  if (typeof spec === 'number') return (side, entry, stop) => entry + side * spec * Math.abs(entry - stop);
  return (side) => bandTgt(side, spec);
}

export function* signals(ctx, s){
  const T = ctx.tf[s.tf], { bars, bb, atr: A } = T, tfMs = TF_MIN[s.tf] * 60e3, holdMs = (s.holdBars || HOLD[s.tf]) * tfMs;
  const lowest = (i, n) => { let m = Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) m = Math.min(m, bars[j].l); return m; };
  const highest = (i, n) => { let m = -Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) m = Math.max(m, bars[j].h); return m; };
  let pend = null; // flash/reclaim: אירוע קריסה שמחכה לנר היפוך
  for (let i = 60; i < bars.length - 1; i++){
    if (!Number.isFinite(bb.mid[i]) || !Number.isFinite(A[i])) continue;
    const b = bars[i], band = (side, which) => which === 'mid' ? bb.mid[i] : side > 0 ? bb.up[i] : bb.lo[i];
    const stopOf = (side) => {
      if (s.stop.pct) return stopFromPct(s.stop.pct);
      if (s.stop.atr) return (sd, entry) => entry - sd * s.stop.atr * A[i];
      if (s.stop.bar) return (sd) => sd > 0 ? b.l * (1 - s.stop.bar / 100) : b.h * (1 + s.stop.bar / 100); // קצה נר האות + מרווח
      // מבנה שוק: מעבר לשפל/שיא של 10 הנרות האחרונים, ‏0.1 ATR מרווח
      return (sd, entry) => sd > 0 ? Math.min(lowest(i, 10), entry) - 0.1 * A[i] : Math.max(highest(i, 10), entry) + 0.1 * A[i];
    };
    const leg = (side, type, price) => ({ side, type, price, stop: stopOf(side), target: targetFn(s.target, (sd, w) => band(sd, w)), minRR: s.minRR || 0, tpMaker: !s.tpTaker, maxStop: s.maxStopPct });
    let legs = null, validMs = 0;
    const mk = (side) => {
      if (s.ladder){ // כניסה מדורגת: פקודות ממתינות מהרמה הראשונה ועד קרוב לסטופ, משקלות s.ladder (למשל 1:2:3)
        const L1 = b.c - side * 0.1 * A[i], stop = stopOf(side)(side, L1), w = s.ladder, tot = w.reduce((x, y) => x + y, 0), at = [0, 0.4, 0.75];
        if (!(side * (L1 - stop) > 0)) return null;
        const tgt = typeof s.target === 'number' ? L1 + side * s.target * Math.abs(L1 - stop) : band(side, s.target);
        if (!(side * (tgt - L1) > 0)) return null;
        return { side, type: 'ladder', rungs: w.map((x, k) => ({ price: L1 + (stop - L1) * at[k], w: x / tot })), stopPx: stop, targetPx: tgt };
      }
      if (s.entry === 'limit') return leg(side, 'limit', b.c - side * (s.pull ?? 0.25) * A[i]); // כניסה ממתינה בלבד (Maker), נסיגה קטנה
      return leg(side, 'market');
    };
    if (s.family === 'touch'){
      if (b.c < bb.lo[i] || b.c > bb.up[i] || T.bbw[i] < (s.minWidthPct || 0)) continue;
      legs = [leg(1, 'limit', bb.lo[i]), leg(-1, 'limit', bb.up[i])]; validMs = tfMs;
    } else if (s.family === 'sweep'){
      if (b.l < bb.lo[i] && b.c > bb.lo[i] && b.c > b.o) legs = [mk(1)];
      else if (b.h > bb.up[i] && b.c < bb.up[i] && b.c < b.o) legs = [mk(-1)];
      else continue;
      if (!legs[0]) continue;
      if (legs[0].type !== 'market') validMs = (s.ladder ? 4 : 2) * tfMs;
    } else if (s.family === 'retrace'){
      let avg = 0; for (let j = i - 14; j < i; j++) avg += bars[j].h - bars[j].l; avg /= 14;
      const rng = b.h - b.l; if (!(avg > 0) || rng < 2 * avg || b.c === b.o) continue;
      const up = b.c > b.o, sd = up ? 1 : -1, price = up ? b.h - s.retrace * rng : b.l + s.retrace * rng;
      const lo0 = b.l, hi0 = b.h;
      legs = [{ side: sd, type: 'limit', price, stop: () => (up ? lo0 * 0.999 : hi0 * 1.001), target: () => (up ? hi0 : lo0), cancelAt: up ? hi0 : lo0, minRR: 0, tpMaker: true }];
      validMs = 4 * tfMs;
    } else if (s.family === 'flash'){
      // קנייה בקריסה חדה (סרטון של עמית, 7/11: FARTCOIN נפל ~8% עם זינוק נפח, קנייה מדורגת בתוך הנפילה, חזרה למעלה).
      // אירוע: השפל של הנר נמוך ב-drop% לפחות מהשיא של n הנרות הקודמים, הנפח ≥ volX × ממוצע 48 הנרות הקודמים, והסגירה עדיין
      // בחצי התחתון של הנפילה. לונג בלבד (חיסולי לונגים).
      const pre = highest(i - 1, s.n), drop = (pre - b.l) / pre * 100;
      let avgV = 0; for (let j = i - 48; j < i; j++) avgV += bars[j].v; avgV /= 48;
      const evt = drop >= s.drop && avgV > 0 && b.v >= s.volX * avgV && b.c < pre * (1 - s.drop / 200);
      if (s.mode === 'ladder'){
        // שלוש פקודות ממתינות מתחת לסגירה (1.5% / 3% / 5%, משקלות 1:2:3), סטופ stopPct מתחת לסגירה, יעד: חצי/כל הדרך חזרה לשיא
        if (!evt) continue;
        const tgt = s.target === 'full' ? pre : b.c + 0.5 * (pre - b.c), w = [1, 2, 3], tot = 6;
        legs = [{ side: 1, type: 'ladder', rungs: [0.015, 0.03, 0.05].map((k, q) => ({ price: b.c * (1 - k), w: w[q] / tot })), stopPx: b.c * (1 - s.stopPct / 100), targetPx: tgt }];
        validMs = 24 * tfMs;
      } else {
        // reclaim: אחרי האירוע מחכים עד 6 נרות לנר ירוק ראשון → כניסה בשוק; סטופ מתחת לשפל הקריסה; יעד חצי/כל הדרך לשיא
        if (evt && !pend){ pend = { low: b.l, pre, until: i + 6 }; continue; }
        if (!pend) continue;
        pend.low = Math.min(pend.low, b.l);
        if (i > pend.until){ pend = null; continue; }
        if (!(b.c > b.o)) continue;
        const lowX = pend.low, preX = pend.pre, stopPx = lowX * 0.995, tgt = s.target === 'full' ? preX : lowX + 0.5 * (preX - lowX);
        pend = null;
        legs = [{ side: 1, type: 'market', stop: () => stopPx, target: () => tgt, minRR: 0, tpMaker: true, maxStop: s.maxStopPct }];
      }
    } else if (s.family === 'donchian'){
      // מגמה (לא מעמית): פריצת ערוץ של n נרות, סטופ נגרר ATR, בלי יעד
      const hh = highest(i - 1, s.n), ll = lowest(i - 1, s.n);
      if (b.c > hh) legs = [mk(1)]; else if (b.c < ll && !s.longOnly) legs = [mk(-1)]; else continue;
    } else if (s.family === 'emacross'){
      const f = T.emaN(s.fast), sl = T.emaN(s.slow);
      if (!Number.isFinite(sl[i - 1])) continue;
      if (f[i - 1] <= sl[i - 1] && f[i] > sl[i]) legs = [mk(1)]; else if (f[i - 1] >= sl[i - 1] && f[i] < sl[i] && !s.longOnly) legs = [mk(-1)]; else continue;
    } else if (s.family === 'breakout'){
      // השוואה (לא מעמית): פריצת שיא/שפל של 20 נרות קודמים
      const hh = highest(i - 1, 20), ll = lowest(i - 1, 20);
      if (b.c > hh) legs = [mk(1)]; else if (b.c < ll) legs = [mk(-1)]; else continue;
      if (!legs[0]) continue;
      if (legs[0].type !== 'market') validMs = 2 * tfMs;
    }
    // המאפיינים מחושבים רק כשצריך (אות שמגיע בזמן פוזיציה פתוחה מדולג בלי לחשב)
    const fi = i; let fl = null, fs = null;
    yield { t: b.end, legs, validMs, holdMs, be: !!s.be, trailDist: s.trail ? s.trail * A[i] : 0, partial: s.partial || null, maxPerDay: s.maxPerDay || 0, feat: { get long(){ return fl ||= features(ctx, s.tf, fi, 1); }, get short(){ return fs ||= features(ctx, s.tf, fi, -1); } } };
  }
}

// ---------- ביצוע על נרות דקה ----------

function fundingCost(funding, side, notional, t0, t1, C){
  if (!funding || !funding.length){ return notional * C.fundingBpsPer8h / 1e4 * (t1 - t0) / (8 * 3600e3); }
  let s = 0; for (let k = lastLE(funding, t0, (f) => f.t) + 1; k < funding.length && funding[k].t <= t1; k++) s += side * funding[k].rate * notional;
  if (t0 < funding[0].t) s += notional * C.fundingBpsPer8h / 1e4 * (Math.min(t1, funding[0].t) - t0) / (8 * 3600e3); // לפני תחילת הנתונים: עלות קבועה
  const last = funding.at(-1).t; if (t1 > last + 3600e3) s += notional * C.fundingBpsPer8h / 1e4 * (t1 - Math.max(t0, last + 3600e3)) / (8 * 3600e3); // אחרי סוף הנתונים (הערת GPT, #215)
  return s;
}

// מריץ אותות של מטבע אחד: פוזיציה אחת בכל רגע. מחזיר עסקאות עם פירוק עלויות.
// opt: { coin, risk, cost, filters: [שמות], funding: [{t, rate}] }
export function execute(ctx, sigs, opt = {}){
  const C = { ...COST, ...(opt.cost || {}) }, R = { ...RISK, ...(opt.risk || {}) }, coin = opt.coin || 'BTC';
  const hs = (C.halfSpreadBps[coin] ?? 1) / 1e4, sl = (C.slipBps[coin] ?? 2) / 1e4, pen = C.penBps / 1e4, filters = opt.filters || [];
  const { m1, t1 } = ctx, trades = [], bm = ctx.baseMs || 60e3;
  let busy = -Infinity; const perDay = new Map();
  for (const sg of sigs){
    if (sg.t < busy) continue;
    if (sg.maxPerDay && (perDay.get(Math.floor(sg.t / DAY)) || 0) >= sg.maxPerDay) continue; // מגבלת עסקאות ליום
    let j = lastLE(t1, sg.t - 1) + 1; // נר הדקה הראשון שמתחיל אחרי ההחלטה
    if (j >= m1.length) break;
    const legs = sg.legs.filter((L) => filters.every((f) => (L.side > 0 ? sg.feat.long : sg.feat.short)[f]));
    if (!legs.length) continue;
    // --- כניסה ---
    let pos = null;
    if (legs[0].type === 'ladder'){
      const tr = ladder(sg, legs[0], j);
      if (tr && tr.tExit){ trades.push(tr); busy = tr.tExit; perDay.set(Math.floor(tr.tEntry / DAY), (perDay.get(Math.floor(tr.tEntry / DAY)) || 0) + 1); }
      else busy = Math.max(busy, tr?.until ?? sg.t + sg.validMs);
      continue;
    }
    if (legs[0].type === 'market'){
      const L = legs[0], b = m1[j], mid = b.o, stop = L.stop(L.side, mid);
      pos = open(L, mid, stop, j, false, 1);
    } else {
      const live = legs.filter((L) => (L.side > 0 ? m1[j].o > L.price : m1[j].o < L.price)); // PostOnly: מחיר שכבר נחצה נדחה
      const until = sg.t + sg.validMs;
      for (; j < m1.length && m1[j].t < until && live.length && !pos; j++){
        const b = m1[j];
        for (const L of [...live]){ if (L.cancelAt !== undefined && (L.side > 0 ? b.h >= L.cancelAt : b.l <= L.cancelAt)) live.splice(live.indexOf(L), 1); }
        const hit = live.filter((L) => (L.side > 0 ? b.l <= L.price * (1 - pen) : b.h >= L.price * (1 + pen)));
        if (!hit.length) continue;
        hit.sort((x, y) => Math.abs(b.o - x.price) - Math.abs(b.o - y.price)); // שתיהן באותה דקה: הקרובה לפתיחה ראשונה, השנייה מבוטלת
        const L = hit[0], stop = L.stop(L.side, L.price), N = sizeFor(L.price, stop, L.maxStop);
        if (!N) { live.splice(live.indexOf(L), 1); continue; }
        const frac = Math.min(1, C.partRate * (b.v || 0) / N.notional);
        if (frac < C.minFill) continue; // מחזור דל: נשארים בתור
        pos = open(L, L.price, stop, j, true, frac);
        if (pos) break;
      }
      if (!pos){ busy = Math.max(busy, sg.t + sg.validMs); continue; }
    }
    if (!pos){ continue; }
    // --- ניהול: מנר הכניסה (סטופ בלבד, שמרני) ואילך ---
    const tr = manage(pos, sg);
    trades.push(tr); busy = tr.tExit; perDay.set(Math.floor(tr.tEntry / DAY), (perDay.get(Math.floor(tr.tEntry / DAY)) || 0) + 1);
  }
  return trades;

  function sizeFor(entry, stop, maxStop = R.maxStopPct){
    let dist = Math.abs(entry - stop) / entry * 100;
    if (!(dist > 0) || dist > maxStop) return null;
    dist = Math.max(dist, R.minStopPct);
    return { dist, notional: Math.min(R.riskUsd / (dist / 100), R.maxNotional) };
  }
  function open(L, entryMid, stop0, j, maker, frac){
    const S = sizeFor(entryMid, stop0, L.maxStop); if (!S) return null;
    const side = L.side;
    if (!(side * (entryMid - stop0) > 0)) return null; // סטופ בצד הלא נכון
    const stop = Math.abs(entryMid - stop0) / entryMid * 100 < R.minStopPct ? entryMid * (1 - side * R.minStopPct / 100) : stop0; // סטופ מינימלי
    const target = L.target(side, entryMid, stop);
    if (!(side * (target - entryMid) > 0)) return null;
    if (L.minRR && side * (target - entryMid) / Math.abs(entryMid - stop) < L.minRR) return null;
    const notional = S.notional * frac;
    return { side, entry: entryMid, stop, target, j, maker, notional, frac, risk$: notional * S.dist / 100, tpMaker: L.tpMaker !== false };
  }
  // ניהול: סטופ קודם (שמרני), אחר כך מימוש חלקי (אם הוגדר), אחר כך יעד, הזזת סטופ לכניסה, וזמן
  function manage(p, sg){
    const tEnd = m1[p.j].t + sg.holdMs, side = p.side, long = side > 0, risk = Math.abs(p.entry - p.stop);
    const part = sg.partial ? { tp: p.entry + side * sg.partial.at * risk, frac: sg.partial.frac } : null;
    const target = sg.partial ? p.entry + side * sg.partial.runner * risk : p.target;
    const acc = newAcc(p.notional, p.maker);
    const out = (px, maker, q) => accExit(acc, side, p.entry, px, maker, q);
    let k = p.j, rem = 1, why = '', be = false, stop = p.stop;
    const beAt = p.entry + 0.5 * (target - p.entry);
    const b0 = m1[k];
    if (long ? b0.l <= stop : b0.h >= stop){ out(stop, false, rem); rem = 0; why = 'סטופ'; } // נר הכניסה: רק סטופ
    else for (k = p.j + 1; k < m1.length; k++){
      const b = m1[k];
      if (long ? b.l <= stop : b.h >= stop){ out(long ? Math.min(stop, b.o) : Math.max(stop, b.o), false, rem); rem = 0; why = be ? 'סטופ בכניסה' : sg.trailDist > 0 && stop !== p.stop ? 'סטופ נגרר' : 'סטופ'; break; }
      const thr = (px, mk) => (long ? b.h >= px * (1 + (mk ? pen : 0)) : b.l <= px * (1 - (mk ? pen : 0)));
      if (part && rem === 1 && thr(part.tp, true)){ out(part.tp, true, part.frac); rem -= part.frac; be = true; stop = p.entry * (1 + side * 0.0006); continue; }
      if (thr(target, p.tpMaker)){ out(p.tpMaker ? target : (long ? Math.max(target, b.o) : Math.min(target, b.o)), p.tpMaker, rem); rem = 0; why = part ? 'יעד רץ' : 'יעד'; break; }
      if (sg.be && !be && thr(beAt, false)){ be = true; stop = p.entry * (1 + side * 0.0006); }
      if (sg.trailDist > 0){ stop = long ? Math.max(stop, b.h - sg.trailDist) : Math.min(stop, b.l + sg.trailDist); }
      if (b.t + bm >= tEnd){ out(b.c, false, rem); rem = 0; why = 'זמן'; break; }
    }
    if (rem > 0){ k = m1.length - 1; out(m1[k].c, false, rem); why = 'סוף נתונים'; }
    if (part && rem < 1 && why === 'סטופ בכניסה') why = 'מימוש חלקי + סטופ בכניסה';
    return finish(acc, { side, tEntry: m1[p.j].t, tExit: m1[Math.min(k, m1.length - 1)].t + bm, entry: p.entry, why, frac: p.frac, risk: p.risk$,
      feat: (side > 0 ? sg.feat.long : sg.feat.short) });
  }
  // צובר עלויות: כניסה (Maker/Taker) על כל הגודל, ויציאות בחלקים
  function newAcc(N, maker){ return { N, gross: 0, fM: maker ? N * C.makerBps / 1e4 : 0, fT: maker ? 0 : N * C.takerBps / 1e4, spread: maker ? 0 : N * hs, slip: maker ? 0 : N * sl, exitN: 0 }; }
  function accExit(acc, side, entry, px, maker, q, n = acc.N * q){
    const nx = n * px / entry; acc.gross += side * (px - entry) / entry * n; acc.exitN += nx; acc.lastPx = px;
    if (maker) acc.fM += nx * C.makerBps / 1e4; else { acc.fT += nx * C.takerBps / 1e4; acc.spread += nx * hs; acc.slip += nx * sl; }
  }
  function finish(acc, t){
    const funding = fundingCost(opt.funding, t.side, acc.N, t.tEntry, t.tExit, C), fees = acc.fM + acc.fT;
    const net = acc.gross - fees - acc.spread - acc.slip - funding;
    // R = ביחס לתקציב הסיכון המתוכנן לעסקה (riskUsd), לא לסיכון שהתמלא בפועל: אחרת עסקה שהתמלאה חלקית (כניסה מדורגת, מילוי חלקי)
    // מקבלת משקל R מנופח, ותוחלת R יכולה להיות חיובית כשהדולרים שליליים (נמצא בריצת הפיתוח, לפני פתיחת המבחן).
    const budget = R.riskUsd;
    return { coin, ...t, exit: t.exit ?? acc.lastPx, notional: acc.N, gross: acc.gross, fees, fM: acc.fM, fT: acc.fT, spread: acc.spread, slip: acc.slip, funding, net,
      budget, r: net / budget, rGross: acc.gross / budget };
  }
  // כניסה מדורגת: כל שלב פקודה ממתינה (PostOnly, תור, מילוי חלקי לפי מחזור); סטופ ויעד משותפים; הסיכון הכולל אם כל השלבים
  // התמלאו = riskUsd. יעד לפני מילוי ראשון → ביטול. מחזיר עסקה, או { until } אם לא התמלא כלום.
  function ladder(sg, L, j0){
    const side = L.side, long = side > 0, stop = L.stopPx, target = L.targetPx;
    const dist = (px) => Math.abs(px - stop) / px;
    if (dist(L.rungs[0].price) * 100 > R.maxStopPct || dist(L.rungs[0].price) * 100 < R.minStopPct) return null;
    const Nfull = Math.min(R.riskUsd / L.rungs.reduce((s2, r) => s2 + r.w * dist(r.price), 0), R.maxNotional);
    const open0 = m1[j0].o, rungs = L.rungs.filter((r) => (long ? open0 > r.price : open0 < r.price)).map((r) => ({ ...r, n: 0 }));
    if (!rungs.length) return null;
    const until = sg.t + sg.validMs; let k = j0, first = -1, tEnd = 0, exitPx = null, exitMaker = false, why = '';
    for (; k < m1.length; k++){
      const b = m1[k];
      if (first < 0 && (long ? b.h >= target : b.l <= target)) return { until: b.t + bm };
      if (b.t < until){
        let vol = C.partRate * (b.v || 0);
        for (const r of rungs){
          if (r.n || !(long ? b.l <= r.price * (1 - pen) : b.h >= r.price * (1 + pen))) continue;
          const want = r.w * Nfull, got = Math.min(want, vol);
          if (got >= C.minFill * want){ r.n = got; vol -= got; }
        }
      }
      const filled = rungs.filter((r) => r.n > 0);
      if (!filled.length){ if (b.t + bm >= until) return { until }; continue; }
      if (first < 0){ first = k; tEnd = b.t + sg.holdMs; }
      if (long ? b.l <= stop : b.h >= stop){ exitPx = k === first ? stop : (long ? Math.min(stop, b.o) : Math.max(stop, b.o)); why = 'סטופ'; break; }
      if (k > first && (long ? b.h >= target * (1 + pen) : b.l <= target * (1 - pen))){ exitPx = target; exitMaker = true; why = 'יעד'; break; }
      if (b.t + bm >= tEnd){ exitPx = b.c; why = 'זמן'; break; }
    }
    if (first < 0) return { until };
    if (exitPx === null){ k = m1.length - 1; exitPx = m1[k].c; why = 'סוף נתונים'; }
    const filled = rungs.filter((r) => r.n > 0), N = filled.reduce((s2, r) => s2 + r.n, 0);
    const acc = { N, gross: 0, fM: N * C.makerBps / 1e4, fT: 0, spread: 0, slip: 0, exitN: 0 };
    for (const r of filled) accExit(acc, side, r.price, exitPx, exitMaker, 0, r.n);
    const risk = filled.reduce((s2, r) => s2 + r.n * dist(r.price), 0), avg = N / filled.reduce((s2, r) => s2 + r.n / r.price, 0);
    return finish(acc, { side, tEntry: m1[first].t, tExit: m1[Math.min(k, m1.length - 1)].t + bm, entry: avg, exit: exitPx, why: `${why} (${filled.length}/${L.rungs.length} שלבים)`,
      frac: N / Nfull, risk, feat: (side > 0 ? sg.feat.long : sg.feat.short) });
  }
}

// ---------- סטטיסטיקה ----------

const phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
const meanSd = (a) => { const n = a.length; if (!n) return [NaN, NaN]; const m = a.reduce((s, x) => s + x, 0) / n; return [m, n > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : NaN]; };

// costMult מכפיל עמלות+מרווח+החלקה (רגישות לעלויות). period = [from, to) לפי זמן כניסה. days = ימים קלנדריים בתקופה.
// feeTier = { maker, taker } בנקודות בסיס: מחשב מחדש את העמלות לפי דרגה אחרת (למשל עמית/VIP 1.4/3.5)
export function stats(trades, { from = -Infinity, to = Infinity, costMult = 1, coins, feeTier } = {}){
  const t = trades.filter((x) => x.tEntry >= from && x.tEntry < to).sort((a, b) => a.tExit - b.tExit);
  const feeOf = (x) => (feeTier && x.fM !== undefined ? x.fM * feeTier.maker / COST.makerBps + x.fT * feeTier.taker / COST.takerBps : x.fees);
  const net = (x) => x.gross - costMult * (feeOf(x) + x.spread + x.slip) - x.funding;
  const unit = (x) => x.budget || x.risk; // תקציב הסיכון המתוכנן (עסקאות ישנות בלי budget: הסיכון בפועל)
  const n = t.length, nets = t.map(net), rs = t.map((x, i) => (unit(x) > 0 ? nets[i] / unit(x) : 0)), rg = t.map((x) => (unit(x) > 0 ? x.gross / unit(x) : 0));
  let eq = 0, peak = 0, dd = 0, win = 0, loss = 0;
  for (const v of nets){ eq += v; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); if (v > 0) win += v; else loss -= v; }
  const sum = (f) => t.reduce((s, x) => s + f(x), 0);
  const [mR, sR] = meanSd(rs), [mG, sG] = meanSd(rg);
  // רמה יומית (כולל ימים בלי עסקאות): מתחשבת בתלות בין עסקאות באותו יום
  const d0 = Number.isFinite(from) ? Math.floor(from / DAY) : (n ? Math.floor(t[0].tEntry / DAY) : 0), d1 = Number.isFinite(to) ? Math.ceil(to / DAY) : (n ? Math.floor(t.at(-1).tEntry / DAY) + 1 : 0);
  const daily = new Array(Math.max(0, d1 - d0)).fill(0); t.forEach((x, i) => { const d = Math.floor(x.tEntry / DAY) - d0; if (d >= 0 && d < daily.length) daily[d] += nets[i]; });
  const [mD, sD] = meanSd(daily), zD = sD > 0 ? mD / (sD / Math.sqrt(daily.length)) : 0;
  const byCoin = {}; for (const c of coins || [...new Set(t.map((x) => x.coin))]) byCoin[c] = t.reduce((s, x, i) => s + (x.coin === c ? nets[i] : 0), 0);
  const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : x), r3 = (x) => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : x);
  return {
    n, net: r2(eq), gross: r2(sum((x) => x.gross)), fees: r2(costMult * sum(feeOf)), spreadSlip: r2(costMult * sum((x) => x.spread + x.slip)), funding: r2(sum((x) => x.funding)),
    winRate: n ? r2(nets.filter((v) => v > 0).length / n * 100) : null, pf: loss > 0 ? r2(win / loss) : (win > 0 ? Infinity : null),
    exp: n ? r2(eq / n) : null, expR: r3(mR), ciR: n > 1 ? [r3(mR - 1.96 * sR / Math.sqrt(n)), r3(mR + 1.96 * sR / Math.sqrt(n))] : null,
    expRGross: r3(mG), ciRGross: n > 1 ? [r3(mG - 1.96 * sG / Math.sqrt(n)), r3(mG + 1.96 * sG / Math.sqrt(n))] : null,
    maxDD: r2(dd), days: daily.length, perDay: r2(mD), ciDay: daily.length > 1 ? [r2(mD - 1.96 * sD / Math.sqrt(daily.length)), r2(mD + 1.96 * sD / Math.sqrt(daily.length))] : null,
    pDay: r3(1 - phi(zD)), byCoin: Object.fromEntries(Object.entries(byCoin).map(([k, v]) => [k, r2(v)])),
    coinsPos: Object.values(byCoin).filter((v) => v > 0).length,
    // מכפיל העלויות שבו הגרסה מתאזנת (1 = העלויות הנוכחיות; 0.5 = צריך עלויות בחצי כדי להתאזן; שלילי = מפסידה גם בלי עלויות)
    breakEvenCost: (() => { const c = sum((x) => feeOf(x) + x.spread + x.slip); return c > 0 ? r2((sum((x) => x.gross) - sum((x) => x.funding)) / c) : null; })(),
  };
}

// ---------- בחירה בלי לבחור לפי הרווח הגבוה ----------
// ציון = הגבול התחתון של רווח הציפייה ב-R (95%), בתנאי מינימום עסקאות ועקביות בין מטבעות. מחזיר null אם לא עומד בתנאים.
export function score(st, { minTrades = 60, minCoinsPos = 3 } = {}){
  if (!st || st.n < minTrades || !st.ciR || st.coinsPos < minCoinsPos) return null;
  return st.ciR[0];
}

// בחירת מסננים חמדנית על תקופת אימון בלבד (קירוב: תת-קבוצה של עסקאות הבסיס). מחזיר { filters, st, score }
export function greedyFilters(baseTrades, period, opts = {}){
  const sub = (F) => baseTrades.filter((x) => F.every((f) => x.feat[f]));
  let F = [], best = score(stats(sub(F), period), opts);
  for (;;){
    let pick = null, pickScore = best;
    for (const f of FILTERS){ if (F.includes(f)) continue; const s = score(stats(sub([...F, f]), period), opts); if (s !== null && (pickScore === null || s > pickScore)){ pick = f; pickScore = s; } }
    if (!pick) break; F = [...F, pick]; best = pickScore;
  }
  return { filters: F, score: best, st: stats(sub(F), period) };
}

// סיווג תוצאה סופית — למה גרסה נכשלה או עברה
export function verdict({ train, val, test, wf, cost15 }){
  if (!(train?.n >= 30)) return { level: 'fail', why: 'מעט מדי עסקאות' };
  if (!(train.ciRGross && train.ciRGross[0] > 0)) return { level: 'fail', why: train.expRGross > 0 ? 'אין יתרון מובהק גם לפני עלויות (טווח הביטחון של הברוטו כולל אפס)' : 'אין יתרון גם לפני עלויות (תוחלת ברוטו ≤ 0)' };
  if (!(train.expR > 0)) return { level: 'fail', why: 'יש יתרון מובהק לפני עלויות, אבל העלויות מוחקות אותו' };
  if (!(train.ciR && train.ciR[0] > 0)) return { level: 'fail', why: 'רווחית נטו באימון, אבל לא מובהקת (טווח הביטחון כולל אפס)' };
  if (!(val?.net > 0) || (wf && !(wf.net > 0))) return { level: 'fail', why: 'רווחית באימון בלבד — לא החזיקה באימות/Walk-Forward (התאמת יתר)' };
  if (!test) return { level: 'pending', why: 'עברה אימון ואימות; תקופת המבחן לא נפתחה' };
  if (!(test.net > 0)) return { level: 'fail', why: 'נכשלה בתקופת המבחן' };
  if (test.ciR && test.ciR[0] > 0 && cost15?.net > 0) return { level: 'pass', why: 'רווחית במבחן, גבול תחתון 95% חיובי, שורדת עלויות ×1.5' };
  return { level: 'promising', why: 'רווחית במבחן, אבל טווח הביטחון כולל אפס (או לא שורדת עלויות ×1.5)' };
}

// ---------- רשימת הבסיסים לניסויים ----------
export const BASES = Object.freeze([
  // ניסוי 1: קבוצות ביקורת — בוט 1 (נגיעה, דקה, סטופ 0.22%, יעד נגדי, 60 דק׳) ובוט 2 (חציה וחזרה, 15 דק׳, סטופ בקצה+0.05%, יעד אמצע, RR≥1, נקודת איזון בחצי)
  { id: 'C1-bot1', exp: 1, family: 'touch', tf: '1m', stop: { pct: 0.22 }, target: 'opp' },
  { id: 'C2-bot2', exp: 1, family: 'sweep', tf: '15m', stop: { bar: 0.05 }, target: 'mid', minRR: 1, be: true, holdBars: 8, tpTaker: true },
  // ניסוי 3: 5 ו-15 דקות (סטופ 1×ATR במקום אחוז קבוע — אותו רעיון בקנה מידה של טווח הזמן)
  ...['5m', '15m'].flatMap((tf) => [
    ...['opp', 'mid'].map((t) => ({ id: `E3-touch-${tf}-${t}`, exp: 3, family: 'touch', tf, stop: { atr: 1 }, target: t })),
    ...['mid', 'opp'].map((t) => ({ id: `E3-sweep-${tf}-${t}`, exp: 3, family: 'sweep', tf, stop: { bar: 0.05 }, target: t, minRR: 1 })),
  ]),
  // ניסוי 4: שעה + תיקון אחרי תנופה
  ...['opp', 'mid'].map((t) => ({ id: `E4-touch-1h-${t}`, exp: 4, family: 'touch', tf: '1h', stop: { atr: 1 }, target: t })),
  ...['mid', 'opp'].map((t) => ({ id: `E4-sweep-1h-${t}`, exp: 4, family: 'sweep', tf: '1h', stop: { bar: 0.05 }, target: t, minRR: 1 })),
  ...['15m', '1h'].flatMap((tf) => [0.5, 0.75].map((r) => ({ id: `E4-retrace-${tf}-${r}`, exp: 4, family: 'retrace', tf, retrace: r, stop: {}, target: 'mid', be: true }))),
  // ניסוי 7: סטופ לפי מבנה שוק + יעדים 1.5R/2R/3R
  ...['touch', 'sweep'].flatMap((family) => ['5m', '15m', '1h'].flatMap((tf) => [1.5, 2, 3].map((R) =>
    ({ id: `E7-${family}-${tf}-${R}R`, exp: 7, family, tf, stop: { struct: true }, target: R })))),
  // ---------- גל 2 (הצעות שמאיר העביר, 7/11) ----------
  // ניסוי 9: טווח זמן גבוה + סטופ רחב 2%/3% → עסקה קטנה (20K–13K$ במקום 180K$), עמלה זניחה ביחס לסיכון
  ...['1h', '4h'].flatMap((tf) => [2, 3].flatMap((pct) => [
    ...['mid', 2].map((t) => ({ id: `E9-sweep-${tf}-sl${pct}-${t === 'mid' ? 'mid' : '2R'}`, exp: 9, family: 'sweep', tf, stop: { pct }, target: t, minRR: t === 'mid' ? 1 : 0 })),
    { id: `E9-touch-${tf}-sl${pct}-opp`, exp: 9, family: 'touch', tf, stop: { pct }, target: 'opp' },
  ])),
  // ניסוי 10: כניסה מדורגת 1:2:3 בפקודות ממתינות (Maker) מהרמה הראשונה ועד 75% מהדרך לסטופ המבני
  ...['15m', '1h', '4h'].flatMap((tf) => ['mid', 2].map((t) => ({ id: `E10-ladder-sweep-${tf}-${t === 'mid' ? 'mid' : '2R'}`, exp: 10, family: 'sweep', tf, stop: { struct: true }, target: t, ladder: [1, 2, 3] }))),
  // ניסוי 12: כניסה רק בפקודה ממתינה (אין Market בכניסה; סטופ נשאר Market — אחרת אין הגנה), עד 3 עסקאות ביום,
  //           מימוש חצי ב-1R + סטופ לכניסה + השאר רץ ל-3R
  ...['15m', '1h'].flatMap((tf) => [
    { id: `E12-sweep-${tf}-maker-run`, exp: 12, family: 'sweep', tf, entry: 'limit', stop: { struct: true }, target: 3, partial: { at: 1, frac: 0.5, runner: 3 }, maxPerDay: 3 },
    { id: `E12-sweep-${tf}-maker-2R`, exp: 12, family: 'sweep', tf, entry: 'limit', stop: { struct: true }, target: 2, maxPerDay: 3 },
    { id: `E12-touch-${tf}-run`, exp: 12, family: 'touch', tf, stop: { struct: true }, target: 3, partial: { at: 1, frac: 0.5, runner: 3 }, maxPerDay: 3 },
  ]),
  // שיטות מגמה ארוכות טווח (לא מעמית) — להשוואה: האם יש בנתונים האלה שיטה שמרוויחה לאורך שנים אחרי עלויות.
  // פריצת ערוץ (Donchian, "צבים") ו-חציית ממוצעים, סטופ 3 ATR נגרר, בלי יעד. גם גרסאות לונג בלבד.
  ...[20, 55].flatMap((n) => [false, true].map((lo) => ({ id: `T-donchian-1d-${n}${lo ? '-long' : ''}`, exp: 20, family: 'donchian', tf: '1d', n, longOnly: lo, stop: { atr: 3 }, trail: 3, target: 'none', maxStopPct: 40, holdBars: 365 }))),
  { id: 'T-donchian-4h-55', exp: 20, family: 'donchian', tf: '4h', n: 55, stop: { atr: 3 }, trail: 3, target: 'none', maxStopPct: 40, holdBars: 1000 },
  ...[false, true].map((lo) => ({ id: `T-ema-1d-20-100${lo ? '-long' : ''}`, exp: 20, family: 'emacross', tf: '1d', fast: 20, slow: 100, longOnly: lo, stop: { atr: 3 }, trail: 3, target: 'none', maxStopPct: 40, holdBars: 365 })),
  { id: 'T-ema-4h-50-200', exp: 20, family: 'emacross', tf: '4h', fast: 50, slow: 200, stop: { atr: 3 }, trail: 3, target: 'none', maxStopPct: 40, holdBars: 1000 },
  // השוואה (לא מעמית): פריצה עם סטופ 1.5 ATR, יעד 2R/3R — לבדוק אם יש בכלל יתרון שעובר עלויות בנתונים האלה
  ...['15m', '1h'].flatMap((tf) => [2, 3].map((R) => ({ id: `X-breakout-${tf}-${R}R`, exp: 0, family: 'breakout', tf, stop: { atr: 1.5 }, target: R }))),
]);

// קנייה בקריסות חדות (סרטון של עמית, 7/11): נפרד מ-BASES (רץ ב-scripts/research-flash.mjs על נרות 5 דקות, מטבעות קטנים ותנודתיים)
export const FLASH_BASES = Object.freeze([3, 12].flatMap((n) => [5, 8, 12].flatMap((drop) => ['ladder', 'reclaim'].flatMap((mode) => ['half', 'full'].map((target) =>
  ({ id: `F-${mode}-n${n}-d${drop}-${target}`, exp: 30, family: 'flash', tf: '5m', n, drop, volX: 3, mode, target, stopPct: 8, maxStopPct: 25, holdBars: 288, stop: {} }))))));
