// בוט 1 גרסה 3 — "בדיוק כמו עמית" (חשבון הדמו של Bybit בלבד). החלטות בלבד: פונקציות טהורות, בלי רשת. את הפעולות מבצע
// scripts/bybit-amit-bot.mjs על השרת (אותו שירות bikur-bybit, אותו סימול, אותו קובץ STOP1).
//
// החלטת מאיר (20/11/2026): "אני מאמין לו. תבנה בדיוק את אותו בוט", ואחרי שראה שהבדיקה לאחור נכשלה (research/amit-exact,
// 0 מתוך 36 גרסאות, כולן מפסידות בכל שנה): "תעלה בכל זאת". זו חריגה מפורשת של בעל הריפו מהכלל של AI_COUNCIL#31 — בדמו בלבד,
// כסף וירטואלי. התיעוד: AI_COUNCIL#33.
//
// הגרסה שהכי קרובה לסרטון (רדיפה מדקה 5 · חירום 2% · 120 דק׳ · לונג בלבד), מתורגמת מהסימולציה (research-amit-exact.mjs, simTrade):
//   • שטוח + הנר האחרון נסגר בתוך הרצועות + רוחב ≥ 0.35% → קנייה PostOnly על הרצועה התחתונה, 270,000$, עם סטופ חירום −2% מצורף
//     (בשוק, נשמר בבורסה). מחודשת בכל נר. לונג בלבד.
//   • בעסקה, בכל נר (וגם כשאין פקודת יציאה — למשל PostOnly שנדחתה): פקודת יציאה ממתינה (PostOnly, reduce-only) אחת:
//       - דקה 5 ואילך, והעסקה ברווח בסגירת הנר → במחיר הסגירה ("רדיפה", כמו בסרטון);
//       - אחרת → על הרצועה העליונה (היעד);
//       - אחרי 120 דקות → במחיר הסגירה גם בהפסד; אחרי 135 דקות → סגירה בשוק.
//     המחיר לא נמוך מהמחיר המבוקש הנוכחי (ask), כדי שהפקודה תמתין בספר ותשלם עמלת maker.
//   • מגבלת הפסד יומית 6,000$ (ממומש + פתוח): גבוהה מהפסד של סטופ חירום אחד (~5,400$), אחרת המגבלה עצמה הופכת לסטופ צמוד של ~0.4%.
//   • קובץ STOP / STOP1 → ביטול הכול וסגירה, כמו בגרסה 2.
import { bands } from './amit-rules.js';
import { pxDown, pxUp, pxRound, qtyFor } from './amit-exec.js';

export const BOTX = Object.freeze({
  version: 3, name: 'amit-exact', symbol: 'BTCUSDT', category: 'linear', minWidthPct: 0.35,
  base: 'https://api-demo.bybit.com',      // חשבון הדמו בלבד. אין בקוד הזה כתובת של החשבון האמיתי
  market: 'https://api.bybit.com',         // נרות ומחיר נוכחי (מחירי השוק האמיתי, כמו בדמו של Bybit)
  notional: 270000, bbN: 20, bbK: 2, sides: Object.freeze(['long']),
  emergencyPct: 2, chaseFromMin: 5, maxMins: 120, graceMins: 15,
  leverage: 50, dailyLossUsd: 6000, tick: 0.1, qtyStep: 0.001, maxQty: 5,
  tag: 'amit',                             // קידומת orderLinkId — הבוט נוגע רק בפקודות שלו
});

const link = (o) => String(o.orderLinkId || '');
const isEntry = (o, P) => link(o).startsWith(`${P.tag}-e-`);
const isExit = (o, P) => link(o).startsWith(`${P.tag}-x-`) || link(o).startsWith(`${P.tag}-tp-`); // tp = יעד שנשאר מגרסה 2

// רצועות מ-20 הסגירות האחרונות; null אם אין מספיק נרות
export function bandsNow(closes, P = BOTX){
  if (!Array.isArray(closes) || closes.length < P.bbN) return null;
  const c = closes.slice(-P.bbN), b = bands(c, P.bbK), last = c.at(-1);
  return { ...b, last, widthPct: (b.up - b.lo) / b.mid * 100, zone: last < b.lo ? 'below' : last > b.up ? 'above' : 'in' };
}

// מחיר היציאה הרצוי (לפני התאמה למחיר הנוכחי). sg = 1 לונג, −1 שורט (שורט רק אם נשאר מגרסה 2)
export function exitPrice(pos, B, ageMin, P = BOTX){
  const sg = pos.side === 'long' ? 1 : -1, band = sg > 0 ? B.up : B.lo;
  let chase = null;
  if (ageMin >= P.maxMins) chase = B.last;                                            // זמן: רודפים גם בהפסד
  else if (ageMin >= P.chaseFromMin && sg * (B.last - Number(pos.entry)) > 0) chase = B.last; // רדיפה ברווח
  // היעד והרדיפה פעילים יחד בסימולציה — הקרובה מביניהן תתמלא קודם
  const want = chase == null ? band : sg > 0 ? Math.min(chase, band) : Math.max(chase, band);
  return { want, why: chase == null ? 'יעד' : ageMin >= P.maxMins ? 'זמן' : 'רדיפה' };
}

// snapshot = { pos: {side, size, entry, sinceMs}|null, orders, closes, newBar, halt, nowMs, barT, bid, ask }
// פעולות: {type:'cancel', orderId} · {type:'place', order} · {type:'close', why} · {type:'cancelAll'}
export function decideExact(s, P = BOTX){
  const out = [], mine = (s.orders || []).filter((o) => isEntry(o, P) || isExit(o, P));
  const pos = s.pos && Number(s.pos.size) > 0 ? s.pos : null;
  if (s.halt){
    if (mine.length) out.push({ type: 'cancelAll' });
    if (pos) out.push({ type: 'close', why: s.halt === 'daily' ? 'מגבלת הפסד יומית' : 'עצירה ידנית' });
    return out;
  }
  if (pos){
    for (const o of mine.filter((x) => isEntry(x, P))) out.push({ type: 'cancel', orderId: o.orderId });
    const exits = mine.filter((x) => isExit(x, P)), ageMin = (s.nowMs - pos.sinceMs) / 60e3;
    if (ageMin >= P.maxMins + P.graceMins){
      for (const o of exits) out.push({ type: 'cancel', orderId: o.orderId });
      out.push({ type: 'close', why: `זמן (${P.maxMins + P.graceMins} דק׳)` });
      return out;
    }
    if (!s.newBar && exits.length) return out;
    const B = bandsNow(s.closes, P);
    if (!B) return out;
    const long = pos.side === 'long', { want, why } = exitPrice(pos, B, ageMin, P);
    // PostOnly: מכירה לא מתחת למחיר המבוקש, קנייה לא מעל המחיר המוצע — אחרת הבורסה דוחה
    const px = long ? pxUp(Math.max(want, Number(s.ask) || 0), P) : pxDown(Math.min(want, Number(s.bid) || Infinity), P);
    const qty = String(pos.size);
    if (exits.length === 1 && Number(exits[0].price) === Number(px) && Number(exits[0].qty) === Number(qty)) return out; // כבר במקום
    for (const o of exits) out.push({ type: 'cancel', orderId: o.orderId });
    out.push({ type: 'place', why, order: { side: long ? 'Sell' : 'Buy', orderType: 'Limit', qty, price: px, timeInForce: 'PostOnly', reduceOnly: true,
      orderLinkId: `${P.tag}-x-${s.nowMs}` } });
    return out;
  }
  // שטוח: פקודות יציאה שנשארו (אחרי סטופ חירום) — מבטלים
  for (const o of mine.filter((x) => isExit(x, P))) out.push({ type: 'cancel', orderId: o.orderId });
  if (!s.newBar) return out;
  for (const o of mine.filter((x) => isEntry(x, P))) out.push({ type: 'cancel', orderId: o.orderId });
  const B = bandsNow(s.closes, P);
  if (!B || B.zone !== 'in' || B.widthPct < P.minWidthPct) return out;
  for (const side of P.sides){
    const long = side === 'long', price = Number(long ? pxDown(B.lo, P) : pxUp(B.up, P));
    const sl = price * (1 + (long ? -1 : 1) * P.emergencyPct / 100);
    out.push({ type: 'place', order: { side: long ? 'Buy' : 'Sell', orderType: 'Limit', qty: qtyFor(price, P), price: pxRound(price, P), timeInForce: 'PostOnly',
      stopLoss: pxRound(sl, P), slTriggerBy: 'LastPrice', tpslMode: 'Full', slOrderType: 'Market', orderLinkId: `${P.tag}-e-${long ? 'buy' : 'sell'}-${s.barT}` } });
  }
  return out;
}
