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
export const RISK = Object.freeze({ riskUsd: 400, maxNotional: 190000, minStopPct: 0.15, maxStopPct: 2.5 });
export const TF_MIN = Object.freeze({ '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240 });
const HOLD = { '1m': 60, '5m': 48, '15m': 32, '1h': 24 };             // יציאת זמן: מספר נרות של טווח הזמן
const DAY = 86400e3;

// ---------- נתונים ומדדים ----------

// נרות דקה [{t,o,h,l,c,v}] (v = מחזור בדולרים) → טווח זמן גדול יותר. מקבלים קבוצה עם לפחות חצי מהדקות (ב-Coinbase דקה בלי
// עסקאות פשוט חסרה). t = תחילת הנר, end = סופו.
export function aggregate(m1, tf){
  const m = TF_MIN[tf], ms = m * 60e3;
  if (m === 1){ for (const b of m1) b.end = b.t + 60e3; return m1; } // בלי העתקה (זיכרון: שנה של נרות דקה)
  const out = []; let cur = null, n = 0;
  const flush = () => { if (cur && n >= m / 2) out.push(cur); };
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
export function prepare(m1){
  const ctx = { m1, t1: Float64Array.from(m1, (b) => b.t), tf: {} };
  for (const tf of Object.keys(TF_MIN)){
    const bars = aggregate(m1, tf), bb = rollingBands(bars), a = atr(bars), e50 = ema(bars, 50);
    const atrPct = Float64Array.from(bars, (b, i) => a[i] / b.c * 100), bbw = Float64Array.from(bars, (b, i) => (bb.up[i] - bb.lo[i]) / bb.mid[i] * 100);
    const ends = bars.map((b) => b.end);
    ctx.tf[tf] = { bars, bb, atr: a, ema50: e50, atrPct, bbw, ends,
      thrAtr: trailingDailyThreshold(ends, atrPct), thrBbw: trailingDailyThreshold(ends, bbw) };
  }
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
  return {
    trend: side > 0 ? tr1 > 0 && tr4 > 0 : tr1 < 0 && tr4 < 0,
    atr: T.atrPct[i] >= T.thrAtr(t), vol: T.bbw[i] >= T.thrBbw(t), rvol: rvol >= 1.5,
    liq: liq >= H.thrLiq(t), sess: hour >= 13 && hour < 21,
  };
}
export const FILTERS = Object.freeze(['trend', 'atr', 'vol', 'rvol', 'liq', 'sess']);

// ---------- אסטרטגיות: נרות → אותות ----------
// אות = { t (זמן ההחלטה = סוף נר האות), legs: [{ side, type: 'limit'|'market', price? , stop(entry), target(entry, stop) }],
//        validMs (לפקודה ממתינה), holdMs, be (הזזת סטופ לכניסה בחצי הדרך), feat: { long: {...}, short: {...} } }

const stopFromPct = (pct) => (side, entry) => entry * (1 - side * pct / 100);
function targetFn(spec, bandTgt){ // spec: 'opp' | 'mid' | מספר R
  if (typeof spec === 'number') return (side, entry, stop) => entry + side * spec * Math.abs(entry - stop);
  return (side) => bandTgt(side, spec);
}

export function* signals(ctx, s){
  const T = ctx.tf[s.tf], { bars, bb, atr: A } = T, tfMs = TF_MIN[s.tf] * 60e3, holdMs = (s.holdBars || HOLD[s.tf]) * tfMs;
  const lowest = (i, n) => { let m = Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) m = Math.min(m, bars[j].l); return m; };
  const highest = (i, n) => { let m = -Infinity; for (let j = Math.max(0, i - n + 1); j <= i; j++) m = Math.max(m, bars[j].h); return m; };
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
    const leg = (side, type, price) => ({ side, type, price, stop: stopOf(side), target: targetFn(s.target, (sd, w) => band(sd, w)), minRR: s.minRR || 0, tpMaker: !s.tpTaker });
    let legs = null, validMs = 0;
    if (s.family === 'touch'){
      if (b.c < bb.lo[i] || b.c > bb.up[i] || T.bbw[i] < (s.minWidthPct || 0)) continue;
      legs = [leg(1, 'limit', bb.lo[i]), leg(-1, 'limit', bb.up[i])]; validMs = tfMs;
    } else if (s.family === 'sweep'){
      if (b.l < bb.lo[i] && b.c > bb.lo[i] && b.c > b.o) legs = [leg(1, 'market')];
      else if (b.h > bb.up[i] && b.c < bb.up[i] && b.c < b.o) legs = [leg(-1, 'market')];
      else continue;
    } else if (s.family === 'retrace'){
      let avg = 0; for (let j = i - 14; j < i; j++) avg += bars[j].h - bars[j].l; avg /= 14;
      const rng = b.h - b.l; if (!(avg > 0) || rng < 2 * avg || b.c === b.o) continue;
      const up = b.c > b.o, sd = up ? 1 : -1, price = up ? b.h - s.retrace * rng : b.l + s.retrace * rng;
      const lo0 = b.l, hi0 = b.h;
      legs = [{ side: sd, type: 'limit', price, stop: () => (up ? lo0 * 0.999 : hi0 * 1.001), target: () => (up ? hi0 : lo0), cancelAt: up ? hi0 : lo0, minRR: 0, tpMaker: true }];
      validMs = 4 * tfMs;
    } else if (s.family === 'breakout'){
      // השוואה (לא מעמית): פריצת שיא/שפל של 20 נרות קודמים
      const hh = highest(i - 1, 20), ll = lowest(i - 1, 20);
      if (b.c > hh) legs = [leg(1, 'market')]; else if (b.c < ll) legs = [leg(-1, 'market')]; else continue;
    }
    // המאפיינים מחושבים רק כשצריך (אות שמגיע בזמן פוזיציה פתוחה מדולג בלי לחשב)
    const fi = i; let fl = null, fs = null;
    yield { t: b.end, legs, validMs, holdMs, be: !!s.be, feat: { get long(){ return fl ||= features(ctx, s.tf, fi, 1); }, get short(){ return fs ||= features(ctx, s.tf, fi, -1); } } };
  }
}

// ---------- ביצוע על נרות דקה ----------

function fundingCost(funding, side, notional, t0, t1, C){
  if (!funding || !funding.length){ return notional * C.fundingBpsPer8h / 1e4 * (t1 - t0) / (8 * 3600e3); }
  let s = 0; for (let k = lastLE(funding, t0, (f) => f.t) + 1; k < funding.length && funding[k].t <= t1; k++) s += side * funding[k].rate * notional;
  return s;
}

// מריץ אותות של מטבע אחד: פוזיציה אחת בכל רגע. מחזיר עסקאות עם פירוק עלויות.
// opt: { coin, risk, cost, filters: [שמות], funding: [{t, rate}] }
export function execute(ctx, sigs, opt = {}){
  const C = { ...COST, ...(opt.cost || {}) }, R = { ...RISK, ...(opt.risk || {}) }, coin = opt.coin || 'BTC';
  const hs = (C.halfSpreadBps[coin] ?? 1) / 1e4, sl = (C.slipBps[coin] ?? 2) / 1e4, pen = C.penBps / 1e4, filters = opt.filters || [];
  const { m1, t1 } = ctx, trades = [];
  let busy = -Infinity;
  for (const sg of sigs){
    if (sg.t < busy) continue;
    let j = lastLE(t1, sg.t - 1) + 1; // נר הדקה הראשון שמתחיל אחרי ההחלטה
    if (j >= m1.length) break;
    const legs = sg.legs.filter((L) => filters.every((f) => (L.side > 0 ? sg.feat.long : sg.feat.short)[f]));
    if (!legs.length) continue;
    // --- כניסה ---
    let pos = null;
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
        const L = hit[0], stop = L.stop(L.side, L.price), N = sizeFor(L.price, stop);
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
    trades.push(tr); busy = tr.tExit;
  }
  return trades;

  function sizeFor(entry, stop){
    let dist = Math.abs(entry - stop) / entry * 100;
    if (!(dist > 0) || dist > R.maxStopPct) return null;
    dist = Math.max(dist, R.minStopPct);
    return { dist, notional: Math.min(R.riskUsd / (dist / 100), R.maxNotional) };
  }
  function open(L, entryMid, stop0, j, maker, frac){
    const S = sizeFor(entryMid, stop0); if (!S) return null;
    const side = L.side;
    if (!(side * (entryMid - stop0) > 0)) return null; // סטופ בצד הלא נכון
    const stop = Math.abs(entryMid - stop0) / entryMid * 100 < R.minStopPct ? entryMid * (1 - side * R.minStopPct / 100) : stop0; // סטופ מינימלי
    const target = L.target(side, entryMid, stop);
    if (!(side * (target - entryMid) > 0)) return null;
    if (L.minRR && side * (target - entryMid) / Math.abs(entryMid - stop) < L.minRR) return null;
    const notional = S.notional * frac;
    return { side, entry: entryMid, stop, target, j, maker, notional, frac, risk$: notional * S.dist / 100, tpMaker: L.tpMaker !== false };
  }
  function manage(p, sg){
    const tEnd = m1[p.j].t + sg.holdMs, side = p.side, long = side > 0;
    let k = p.j, exit = null, why = '', exitMaker = false, be = false, stop = p.stop;
    const beAt = p.entry + 0.5 * (p.target - p.entry);
    // נר הכניסה: רק סטופ (אם המחיר המשיך נגדנו באותה דקה); יעד באותה דקה לא נספר (שמרני)
    const b0 = m1[k];
    if (long ? b0.l <= stop : b0.h >= stop){ exit = stop; why = 'סטופ'; }
    else for (k = p.j + 1; k < m1.length; k++){
      const b = m1[k];
      if (long ? b.l <= stop : b.h >= stop){ exit = long ? Math.min(stop, b.o) : Math.max(stop, b.o); why = be ? 'סטופ בכניסה' : 'סטופ'; break; }
      if (long ? b.h >= p.target * (1 + (p.tpMaker ? pen : 0)) : b.l <= p.target * (1 - (p.tpMaker ? pen : 0))){
        exit = p.tpMaker ? p.target : (long ? Math.max(p.target, b.o) : Math.min(p.target, b.o)); exitMaker = p.tpMaker; why = 'יעד'; break;
      }
      if (sg.be && !be && (long ? b.h >= beAt : b.l <= beAt)){ be = true; stop = p.entry * (1 + side * 0.0006); }
      if (b.t + 60e3 >= tEnd){ exit = b.c; why = 'זמן'; break; }
    }
    if (!exit){ k = m1.length - 1; exit = m1[k].c; why = 'סוף נתונים'; }
    const N = p.notional, Nx = N * exit / p.entry, tExit = m1[k].t + 60e3;
    const gross = side * (exit - p.entry) / p.entry * N;
    const fees = N * (p.maker ? C.makerBps : C.takerBps) / 1e4 + Nx * (exitMaker ? C.makerBps : C.takerBps) / 1e4;
    const spread = (p.maker ? 0 : N * hs) + (exitMaker ? 0 : Nx * hs), slip = (p.maker ? 0 : N * sl) + (exitMaker ? 0 : Nx * sl);
    const funding = fundingCost(opt.funding, side, N, m1[p.j].t, tExit, C);
    const net = gross - fees - spread - slip - funding;
    return { coin, side, tEntry: m1[p.j].t, tExit, entry: p.entry, exit, why, frac: p.frac, notional: N, risk: p.risk$,
      gross, fees, spread, slip, funding, net, r: p.risk$ > 0 ? net / p.risk$ : 0, rGross: p.risk$ > 0 ? gross / p.risk$ : 0,
      feat: (side > 0 ? sg.feat.long : sg.feat.short) };
  }
}

// ---------- סטטיסטיקה ----------

const phi = (z) => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };
const meanSd = (a) => { const n = a.length; if (!n) return [NaN, NaN]; const m = a.reduce((s, x) => s + x, 0) / n; return [m, n > 1 ? Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : NaN]; };

// costMult מכפיל עמלות+מרווח+החלקה (רגישות לעלויות). period = [from, to) לפי זמן כניסה. days = ימים קלנדריים בתקופה.
export function stats(trades, { from = -Infinity, to = Infinity, costMult = 1, coins } = {}){
  const t = trades.filter((x) => x.tEntry >= from && x.tEntry < to).sort((a, b) => a.tExit - b.tExit);
  const net = (x) => x.gross - costMult * (x.fees + x.spread + x.slip) - x.funding;
  const n = t.length, nets = t.map(net), rs = t.map((x, i) => (x.risk > 0 ? nets[i] / x.risk : 0)), rg = t.map((x) => x.rGross);
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
    n, net: r2(eq), gross: r2(sum((x) => x.gross)), fees: r2(costMult * sum((x) => x.fees)), spreadSlip: r2(costMult * sum((x) => x.spread + x.slip)), funding: r2(sum((x) => x.funding)),
    winRate: n ? r2(nets.filter((v) => v > 0).length / n * 100) : null, pf: loss > 0 ? r2(win / loss) : (win > 0 ? Infinity : null),
    exp: n ? r2(eq / n) : null, expR: r3(mR), ciR: n > 1 ? [r3(mR - 1.96 * sR / Math.sqrt(n)), r3(mR + 1.96 * sR / Math.sqrt(n))] : null,
    expRGross: r3(mG), ciRGross: n > 1 ? [r3(mG - 1.96 * sG / Math.sqrt(n)), r3(mG + 1.96 * sG / Math.sqrt(n))] : null,
    maxDD: r2(dd), days: daily.length, perDay: r2(mD), ciDay: daily.length > 1 ? [r2(mD - 1.96 * sD / Math.sqrt(daily.length)), r2(mD + 1.96 * sD / Math.sqrt(daily.length))] : null,
    pDay: r3(1 - phi(zD)), byCoin: Object.fromEntries(Object.entries(byCoin).map(([k, v]) => [k, r2(v)])),
    coinsPos: Object.values(byCoin).filter((v) => v > 0).length,
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
  // השוואה (לא מעמית): פריצה עם סטופ 1.5 ATR, יעד 2R/3R — לבדוק אם יש בכלל יתרון שעובר עלויות בנתונים האלה
  ...['15m', '1h'].flatMap((tf) => [2, 3].map((R) => ({ id: `X-breakout-${tf}-${R}R`, exp: 0, family: 'breakout', tf, stop: { atr: 1.5 }, target: R }))),
]);
