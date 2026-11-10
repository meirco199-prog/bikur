// בדיקה לאחור של שיטת הקורס של עמית ("מסחר יומי בקריפטו", 15 שיעורים) — גרסה מכנית. מחקר בלבד: פונקציות טהורות, בלי רשת ובלי פקודות.
// בקשת מאיר (10/11/2026), אחרי ניתוח הקורס (תמלולים + פריימים מהסרטונים). AI_COUNCIL#31: אסטרטגיה חדשה — קודם בדיקה לאחור.
//
// הכללים כפי שנלמדו בקורס (מקור לכל כלל בסוגריים: שיעור [דקה]) ואיך הם מוכנו:
//   1. עוגן: השפל של דשדוש/תמיכה על נרות 15 דקות (3-1, 4-1, 4-3). מכני: חלון של M שעות שטווחו ≤ W × תחתית אזור הריזיקה → העוגן = השפל
//      בחלון. דשדוש חדש נמוך יותר מעגן מחדש (4-3). עוגן ישן מ-4 ימים פג (4-3).
//   2. אזור ריזיקה לפי סוג המטבע (טבלת 3-1, נקראה מהמסך): BTC 1.2–2%, ETH 1.5–2.5%, עוקבים 1.8–3%, תנודתי קל 3.8–5.5%.
//      אירוע ווליום (נר 15 דק׳ בירידה עם ווליום ≥ ×3 מהממוצע היומי) → עוברים לעמודת "כניסה עם ווליום" (3-1, 4-3, 4-4).
//   3. טריגר: נר דקה שנסגר בתוך האזור, מתחת לחצי שלו (4-1: "20% מעל החצי, 80% מתחת"), עם ווליום ≥ kv × ממוצע 60 הדקות הקודמות (3-2).
//      וריאנט: רק נר ירוק (היפוך) או כל נר.
//   4. 30-60-90 (3-3): משקלות 1/6, 1/3, 1/2. 30 בסגירת הטריגר (שוק), 60 ו-90 בפקודות ממתינות בהנזלה: ‎−f0 ו-‎−f1 מהשפל של נר הטריגר
//      (4-1, אומת על 3 דוגמאות מהגרף). סטופ אחד: עוד stopExtra מתחת לקו ה-f1 (3-1; ETH 1,633.4 → 1,587.7 ב-4-2).
//      וריאנט השוואה: כל הסכום בטריגר (בלי מיצוע), אותו סטופ.
//   5. יציאה (4-1, 4-2, 4-8): 75% בממוצע הקרוב מעל המחיר (EMA20/EMA50/VWAP של 15 דק׳), 25% רצים עם סטופ שעובר לכניסה, עד EMA200 או
//      הרמה הרחוקה. וריאנט: 100% ברמה הקרובה. יציאת זמן: 24 שעות. אזור שנתן עסקה "מת" (4-2) — צריך עוגן חדש.
//   גודל: סיכון קבוע (400$) אם כל המנות התמלאו והסטופ נפגע — כך R משקף נכון את חוסר הסימטריה (רווח על מנה קטנה, הפסד על מלאה).
//   עלויות: עמלות Bybit (Maker 2bp / Taker 5.5bp), חצי מרווח + החלקה בכל ביצוע מיידי, Funding קבוע 1bp ל-8 שעות (לונג משלם).
//   פקודה ממתינה מתמלאת רק אם המחיר עבר אותה ב-1bp. סטופ ויעד באותה דקה → סטופ (שמרני). מנה שהתמלאה בדקה מסוימת לא יוצאת ביעד באותה דקה.
// מה לא מוכן (שיפוט ידני בקורס): בחירת "השפל המשמעותי" (4-5), מוטיבים (4-7), תרחישי קריסה (3-4), RSI (2-6), שורטים ("50-50", 3-2).
import { COST } from './research.js';

export const CATS = Object.freeze({
  btc: { zone: [1.2, 2], flush: [0.4, 1.4], stopExtra: 1.4, next: { zone: [1.8, 3], flush: [0.4, 1.4], stopExtra: 1.4 } },
  eth: { zone: [1.5, 2.5], flush: [0.4, 1.4], stopExtra: 1.4, next: { zone: [2, 4.5], flush: [0.4, 1.4], stopExtra: 1.4 } },
  follow: { zone: [1.8, 3], flush: [0.4, 1.4], stopExtra: 1.4, next: { zone: [3.8, 5.5], flush: [0.4, 1.4], stopExtra: 1.4 } },
  vol: { zone: [3.8, 5.5], flush: [0.4, 1.4], stopExtra: 1.4, next: { zone: [7, 9], flush: [0.8, 2.8], stopExtra: 2.8 } },
});
export const COIN_CAT = Object.freeze({ BTC: 'btc', ETH: 'eth', SOL: 'follow', AVAX: 'follow', ADA: 'follow', INJ: 'follow', RENDER: 'follow', NEAR: 'vol', FARTCOIN: 'vol' });
export const COURSE_COST = Object.freeze({
  ...COST,
  halfSpreadBps: { BTC: 0.5, ETH: 0.5, SOL: 1, AVAX: 1.5, ADA: 1.5, INJ: 2, RENDER: 2, NEAR: 1.5, FARTCOIN: 3 },
  slipBps: { BTC: 1, ETH: 1, SOL: 2, AVAX: 2, ADA: 3, INJ: 3, RENDER: 3, NEAR: 2, FARTCOIN: 5 },
});
export const RISK_USD = 400, MAX_NOTIONAL = 400000;
const M15 = 900e3, DAY = 86400e3;
// הגרסה הנאמנה לקורס — נקבעה מראש, לפני הרצה (לא נבחרה לפי תוצאות)
export const CANON = Object.freeze({ consH: 4, consW: 1, kv: 3, candle: 'any', volSwitch: true, entry: 'ladder', exit: 'course' });

// m1: { t: Float64Array, o,h,l,c,v: Float32Array|Float64Array } (v = מחזור בדולרים) → נרות 15 דק׳ + EMA20/50/200 + VWAP יומי + ממוצע ווליום
export function prepare(m1){
  const n = m1.t.length, idx15 = new Int32Array(n), T = [], O = [], H = [], L = [], C = [], V = [];
  let cur = -1;
  for (let i = 0; i < n; i++){
    const k = Math.floor(m1.t[i] / M15);
    if (k !== cur){ cur = k; T.push(k * M15); O.push(m1.o[i]); H.push(m1.h[i]); L.push(m1.l[i]); C.push(m1.c[i]); V.push(m1.v[i]); }
    else { const j = T.length - 1; if (m1.h[i] > H[j]) H[j] = m1.h[i]; if (m1.l[i] < L[j]) L[j] = m1.l[i]; C[j] = m1.c[i]; V[j] += m1.v[i]; }
    idx15[i] = T.length - 1;
  }
  const q = { t: Float64Array.from(T), o: Float64Array.from(O), h: Float64Array.from(H), l: Float64Array.from(L), c: Float64Array.from(C), v: Float64Array.from(V) };
  const emaOf = (N) => { const out = new Float64Array(q.c.length).fill(NaN), k = 2 / (N + 1); let e = NaN; for (let i = 0; i < q.c.length; i++){ e = i === 0 ? q.c[0] : q.c[i] * k + e * (1 - k); if (i >= N - 1) out[i] = e; } return out; };
  q.ema20 = emaOf(20); q.ema50 = emaOf(50); q.ema200 = emaOf(200);
  q.vwap = new Float64Array(q.c.length).fill(NaN);
  { let d = -1, pv = 0, vv = 0; for (let i = 0; i < q.c.length; i++){ const dd = Math.floor(q.t[i] / DAY); if (dd !== d){ d = dd; pv = 0; vv = 0; } pv += (q.h[i] + q.l[i] + q.c[i]) / 3 * q.v[i]; vv += q.v[i]; q.vwap[i] = vv > 0 ? pv / vv : NaN; } }
  q.vAvg96 = trailingMean(q.v, 96);           // ממוצע ווליום של היום הקודם (96 נרות), בלי הנר הנוכחי
  const vAvg60 = trailingMean(m1.v, 60);      // ממוצע ווליום של 60 הדקות הקודמות
  return { m1, n, idx15, q, vAvg60 };
}
export function trailingMean(v, N){
  const out = new Float64Array(v.length).fill(NaN); let s = 0;
  for (let i = 0; i < v.length; i++){ if (i >= N) out[i] = s / N; s += v[i]; if (i >= N) s -= v[i - N]; }
  return out;
}

// אותות: רשימת טריגרים כרונולוגית. cfg: { consH, consW, kv, candle, volSwitch, zone }
//   zone: 'half' (ברירת מחדל — מתחת לחצי האזור) | 'deep' (רק ברבע התחתון)
//   candle: 'any' | 'green' | 'reclaim' (המחיר כבר ירד מתחת לאזור לתוך ההנזלה, ונר ירוק סוגר בחזרה בתוך האזור — "אחרי שכולם נמחקו")
export function triggers(ctx, cat, cfg){
  const { m1, n, idx15, q, vAvg60 } = ctx, K = Math.max(2, Math.round(cfg.consH * 4)), base = CATS[cat], out = [];
  const W = cfg.consW * base.zone[0] / 100, maxAge = 4 * DAY;
  let anchor = NaN, anchorT = 0, evt = false, swept = false;
  const close15 = (j) => {
    if (j < K - 1) return;
    let hi = -Infinity, lo = Infinity, at = -1; for (let k = j - K + 1; k <= j; k++){ if (q.h[k] > hi) hi = q.h[k]; if (q.l[k] < lo){ lo = q.l[k]; at = k; } }
    const end = q.t[j] + M15;
    // דשדוש = טווח צר, והשפל נקבע לפחות 2 נרות לפני הסוף (תחילת ירידה היא לא דשדוש)
    if ((hi - lo) / lo <= W && at <= j - 2){ if (lo !== anchor){ evt = false; swept = false; } anchor = lo; anchorT = end; return; } // דשדוש (גם חדש ונמוך יותר) → עוגן
    if (Number.isFinite(anchor) && end - anchorT > maxAge){ anchor = NaN; return; }
    if (Number.isFinite(anchor) && q.c[j] < anchor && q.v[j] >= 3 * q.vAvg96[j] && q.c[j] < q.o[j]) evt = true; // נר ירידה עם ווליום חריג
  };
  for (let i = 1; i < n; i++){
    if (idx15[i] !== idx15[i - 1]) close15(idx15[i - 1]);   // נר 15 דק׳ נסגר לפני הדקה הזו
    if (!Number.isFinite(anchor)) continue;
    const P = evt && cfg.volSwitch ? base.next : base, c = m1.c[i];
    const half = anchor * (1 - (cfg.zone === 'deep' ? P.zone[0] + 0.75 * (P.zone[1] - P.zone[0]) : (P.zone[0] + P.zone[1]) / 2) / 100), bottom = anchor * (1 - P.zone[1] / 100);
    if (m1.l[i] < bottom * (1 - P.flush[0] / 100)) swept = true;
    if (!(c <= half && c >= bottom)) continue;
    if (!(m1.v[i] >= cfg.kv * vAvg60[i])) continue;
    if ((cfg.candle === 'green' || cfg.candle === 'reclaim') && !(c > m1.o[i])) continue;
    if (cfg.candle === 'reclaim' && !swept) continue;
    out.push({ i, t: m1.t[i], anchor, evt: evt && cfg.volSwitch, P, L: m1.l[i], c });
    anchor = NaN; evt = false; swept = false;                // האזור "מת" — צריך דשדוש חדש
  }
  return out;
}

// ביצוע: פוזיציה אחת בכל רגע למטבע. opt: { coin, entry, exit, stop, maxHoldMin, cost }
//   entry: 'ladder' (30-60-90) | 'single' (הכול בטריגר) | 'deep' (רק מנות 60 ו-90 בפקודות ממתינות בהנזלה; לא התמלאו תוך 4 שעות → אין עסקה)
//   exit: 'course' (75% ברמה הקרובה + 25% רץ) | 'first' (100% ברמה הקרובה) | מספר = יעד קבוע באחוזים מעל מחיר הכניסה הממוצע
//   stop: 'course' (עוד stopExtra מתחת לקו ההנזלה העמוק) | מספר = סטופ צמוד באחוזים מתחת למחיר הכניסה הנמוך המתוכנן
export function execute(ctx, trigs, opt = {}){
  const { m1, n, idx15, q } = ctx, coin = opt.coin || 'BTC', Cc = { ...COURSE_COST, ...(opt.cost || {}) };
  const hs = (Cc.halfSpreadBps[coin] ?? 2) / 1e4, sl = (Cc.slipBps[coin] ?? 3) / 1e4, pen = Cc.penBps / 1e4, mk = Cc.makerBps / 1e4, tk = Cc.takerBps / 1e4;
  const maxHold = opt.maxHoldMin || 1440, W = opt.entry === 'single' ? [1, 0, 0] : opt.entry === 'deep' ? [0, 0.4, 0.6] : [1 / 6, 1 / 3, 1 / 2], trades = [];
  const tpFix = typeof opt.exit === 'number' ? opt.exit / 100 : 0, stopFix = typeof opt.stop === 'number' ? opt.stop / 100 : 0;
  let busy = -1;
  for (const g of trigs){
    if (g.i <= busy) continue;
    const P = g.P, Lw = g.L, px = [g.c, Lw * (1 - P.flush[0] / 100), Lw * (1 - P.flush[1] / 100)];
    const lowest = W[2] > 0 ? px[2] : px[0], stop = stopFix ? lowest * (1 - stopFix) : Lw * (1 - (P.flush[1] + P.stopExtra) / 100);
    if (!(lowest > stop && px[0] > px[1])) continue;
    const lossPer = W.reduce((s, w, k) => s + w * (1 - stop / px[k]), 0), N = Math.min(RISK_USD / lossPer, MAX_NOTIONAL);
    // מצב: כמויות (בדולרים נומינליים לפי מחיר הכניסה של כל מנה)
    let qty = 0, cost$ = 0, fees = 0, spread = 0, slip = 0, gross = 0, fills = 0, held = 0, maxCost = 0, tIn = 0;
    const buy = (k, price, maker) => { const usd = W[k] * N, units = usd / price; qty += units; cost$ += usd; maxCost += usd; fills++; if (maker) fees += usd * mk; else { fees += usd * tk; spread += usd * hs; slip += usd * sl; } };
    const sell = (fracQ, price, maker) => { const u = qty * fracQ, usd = u * price; gross += usd - cost$ * fracQ; cost$ -= cost$ * fracQ; qty -= u; if (maker) fees += usd * mk; else { fees += usd * tk; spread += usd * hs; slip += usd * sl; } };
    if (W[0] > 0){ buy(0, px[0], false); tIn = g.t; }
    const open = [W[1] > 0, W[2] > 0], waitEnd = g.t + 240 * 60e3;
    let st = stop, phase = 0, why = 'זמן', k = g.i + 1, runnerTgt = NaN, tp1 = NaN, lastJ = -1, lv = [];
    const tEnd = g.t + maxHold * 60e3;
    for (; k < n && m1.t[k] <= tEnd; k++){
      const lo = m1.l[k], hi = m1.h[k], o = m1.o[k];
      let filled = false;
      if (phase === 0) for (let s = 0; s < 2; s++) if (open[s] && lo <= px[s + 1] * (1 - pen)){ buy(s + 1, px[s + 1], true); open[s] = false; filled = true; if (!tIn) tIn = m1.t[k]; }
      if (!(qty > 0)){ if (m1.t[k] > waitEnd) break; continue; }   // 'deep': עדיין לא התמלא
      if (lo <= st){ const p = Math.min(st, o); sell(1, p, false); why = phase ? 'סטופ בכניסה' : 'סטופ'; break; }
      // יעד: הרמה הקרובה מעל הממוצע (EMA20/50/VWAP של נר 15 הדקות האחרון שנסגר), מינימום +0.3%
      const j = idx15[k] - 1; if (j < 0) continue;
      const avgPx = cost$ / qty;
      if (j !== lastJ || filled){ lastJ = j; lv = [q.ema20[j], q.ema50[j], q.vwap[j], q.ema200[j]].filter((x) => x > avgPx * 1.003).sort((a, b) => a - b); } // רק כשנר 15 דק׳ נסגר או מנה התמלאה
      if (tpFix){ if (!filled && hi >= avgPx * (1 + tpFix) * (1 + pen)){ sell(1, avgPx * (1 + tpFix), true); why = 'יעד'; break; } continue; }
      if (phase === 0){
        tp1 = lv.length ? lv[0] : avgPx * (1 + P.zone[0] / 100);
        if (!filled && hi >= tp1 * (1 + pen)){
          if (opt.exit === 'first'){ sell(1, tp1, true); why = 'יעד'; break; }
          sell(0.75, tp1, true); phase = 1; st = avgPx * 1.0006; runnerTgt = Math.max(lv.at(-1) || 0, tp1 * (1 + P.zone[0] / 200));
          if (hi >= runnerTgt * (1 + pen)){ sell(1, runnerTgt, true); why = 'יעד + רץ'; break; }
        }
      } else if (hi >= runnerTgt * (1 + pen)){ sell(1, runnerTgt, true); why = 'יעד + רץ'; break; }
    }
    if (!fills){ busy = Math.min(k, n - 1); continue; }               // לא התמלא — אין עסקה
    if (qty > 1e-12){ const kk = Math.min(k, n - 1); sell(1, m1.c[kk], false); if (why === 'זמן' && phase) why = 'יעד + זמן'; }
    const tExit = m1.t[Math.min(k, n - 1)];
    held = (tExit - tIn) / 3600e3;
    const funding = maxCost * 1e-4 * held / 8;
    trades.push({ coin, tEntry: tIn, tExit, gross, fees, spread, slip, funding, budget: RISK_USD, notional: maxCost, planned: N, fills, why, evt: g.evt, anchor: g.anchor, entry: px[0] });
    busy = Math.min(k, n - 1);
  }
  return trades;
}

// קבוצת ביקורת: אותה גאומטריה (אחוזי מנות, סטופ ויציאה) בזמנים אקראיים — האם בחירת האזור והטריגר מוסיפה מידע?
export function randomTriggers(ctx, trigs, seed = 1){
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const { m1, n } = ctx;
  return trigs.map((g) => {
    const i = 1500 + Math.floor(rnd() * (n - 3000)), rel = g.L / g.c, c = m1.c[i];
    return { ...g, i, t: m1.t[i], c, L: c * rel };
  }).sort((a, b) => a.i - b.i);
}

export function grid(){
  const out = [];
  for (const consH of [4, 8]) for (const consW of [0.5, 1]) for (const kv of [3, 5]) for (const candle of ['any', 'green']) for (const volSwitch of [true, false])
    for (const entry of ['ladder', 'single']) for (const exit of ['course', 'first']) out.push({ consH, consW, kv, candle, volSwitch, entry, exit });
  return out;
}
// רשת החקירה (בקשת מאיר 10/11: סטופ צמוד, יציאה מהירה ברווח, הרבה עסקאות, ווליום כשיקול) — 18 אותות × 90 ביצועים = 1,620
export function grid2(){
  const out = [];
  for (const zone of ['half', 'deep']) for (const kv of [3, 5, 10]) for (const candle of ['any', 'green', 'reclaim'])
    for (const entry of ['ladder', 'single', 'deep']) for (const stop of ['course', 1, 0.5]) for (const exit of ['course', 'first', 0.5, 1, 1.5]) for (const hold of [1440, 240])
      out.push({ consH: 4, consW: 1, volSwitch: true, zone, kv, candle, entry, stop, exit, hold });
  return out;
}
export const key2 = (v) => `${v.zone}-kv${v.kv}-${v.candle}|${v.entry}-sl${v.stop}-tp${v.exit}-${v.hold / 60}h`;
export const sig2 = (v) => `${v.zone}-kv${v.kv}-${v.candle}`;
export const keyOf = (v) => `M${v.consH}h-W${v.consW}-kv${v.kv}-${v.candle}-${v.volSwitch ? 'vs' : 'nv'}-${v.entry}-${v.exit}`;
export const sigKey = (v) => `M${v.consH}h-W${v.consW}-kv${v.kv}-${v.candle}-${v.volSwitch ? 'vs' : 'nv'}`;
