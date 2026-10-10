// מגבלות הגשר לחשבון האמיתי (IBKR live). קובץ CODEOWNERS. פונקציות טהורות: בלי רשת, בלי KV, בלי משתני סביבה (הגשר מעביר env כארגומנט).
// הרקע: מאיר, 10/10/2026 — "תכין גשר לאמיתי". IBKR לא מציעה מסחר אוטונומי דרך הקונקטור (רק הוראות שהמשתמש מאשר), אז הדרך היחידה היא API
// פרטי מול חשבון אמיתי — החלטה של בעל הריפו על כסף אמיתי. לכן: **כבוי כברירת מחדל**, ולא נפתח בלי שלוש הוכחות מפורשות של בעל הריפו (ראה checkArming):
// מזהה החשבון, hash של המגבלות האלה (שינוי כלשהו בהן מבטל את האישור), ותאריך תפוגה קרוב. הגשר מחמיר את הסימולציה ולא מקל:
// קנייה/מכירה של ETF בלבד, long בלבד, בלי מינוף מהברוקר (מזומן בלבד — מינוף רק דרך ETF ממונף), LMT בלבד, תקרות לפקודה/פוזיציה/הפסד.
import { policyHash } from './order-gate.js';
import { instrumentOf } from './instruments.js';
import { isOptionSymbol } from './options.js';
import { round, isNum } from './util.js';

export const LIVE_LIMITS = Object.freeze({
  version: 1,
  mode: 'live',
  allowedClasses: Object.freeze(['etf']),     // ETF בלבד (כולל ממונפים/הפוכים); בלי מניות בודדות, אופציות, חוזים, קריפטו, מט"ח
  longOnly: true,                             // אין שורט; "הפוך" רק דרך קניית ETF הפוך
  cashOnly: true,                             // קנייה רק עד המזומן שבחשבון — בלי margin מהברוקר
  approvedCapitalUsd: 250,                    // ההון שאושר: מעבר לו הגשר מחשב גדלים כאילו יש רק 250$ (הפקדה גדולה בטעות לא מגדילה פוזיציות)
  minEquityUsd: 50,                           // מתחת לזה הגשר לא פותח פוזיציות חדשות
  maxOrderUsd: 60,                            // פקודה אחת
  maxPositionShare: 0.60,                     // פוזיציה אחת ÷ ההון המאושר (כמויות שלמות בחשבון קטן מחייבות תקרה רחבה)
  maxOpenPositions: 3,
  maxOrdersPerDay: 4,                         // פקודות פתיחה ביום (סגירות לא נספרות)
  maxDailyLossPct: 0.08,                      // 8% מההון בתחילת היום → אין פתיחות עד מחר
  maxDrawdownPct: 0.25,                       // 25% מהשיא שהגשר ראה → אין פתיחות עד החלטת בעל הריפו
  positionStopPct: 0.15,                      // הפסד של 15% על פוזיציה (לא ממומש, מול העלות הממוצעת) → הגשר מוכר, בלי קשר לסימולציה
  maxSlippagePct: 0.004,                      // LMT: קנייה עד ask+0.4%, מכירה עד bid−0.4%
  maxSpreadPct: 0.02,                         // spread מעל 2% → לא שולחים (נזילות לא מספקת)
  maxArmDays: 45,                             // תוקף ההפעלה המקסימלי קדימה — שגיאת הקלדה לא מפעילה לשנים
});

/** hash יציב של המגבלות — LIVE_APPROVAL חייב להיות שווה לו (כמו approval.policyHash ב-order-gate) */
export const liveHash = (limits = LIVE_LIMITS) => policyHash(limits);

const isLiveAccountId = (a) => typeof a === 'string' && /^U\d{5,}$/i.test(a);   // חשבון אמיתי; DU… (דמה) לא עובר

/**
 * האם הגשר מותר לשלוח פקודות? env: { LIVE_ACCOUNT, LIVE_APPROVAL, LIVE_ARMED_UNTIL }. כל הסיבות מוחזרות.
 * לא מוכן → הגשר רק קורא ומדווח (מצב "כבוי"), לא שולח כלום.
 */
export function checkArming({ env = {}, now = new Date(), limits = LIVE_LIMITS } = {}){
  const reasons = [];
  if (!isLiveAccountId(env.LIVE_ACCOUNT)) reasons.push('LIVE_ACCOUNT חסר או לא נראה כחשבון אמיתי (U…)');
  if (env.LIVE_APPROVAL !== liveHash(limits)) reasons.push('LIVE_APPROVAL חסר או לא תואם ל-hash של המגבלות הנוכחיות (שינוי במגבלות מבטל אישור)');
  const until = Date.parse(env.LIVE_ARMED_UNTIL || '');
  if (!Number.isFinite(until)) reasons.push('LIVE_ARMED_UNTIL חסר או לא תאריך');
  else if (until <= now.getTime()) reasons.push('ההפעלה פגה (LIVE_ARMED_UNTIL עבר)');
  else if (until - now.getTime() > limits.maxArmDays * 86400000) reasons.push(`LIVE_ARMED_UNTIL רחוק מ-${limits.maxArmDays} ימים`);
  return { armed: reasons.length === 0, reasons };
}

/** הגשר עובד מול החשבון שאושר בלבד, ורק אם הוא חשבון אמיתי */
export function assertLiveAccount(acct, expected){
  if (!isLiveAccountId(expected)) throw new Error('LIVE_ACCOUNT לא מוגדר או לא חשבון אמיתי (U…)');
  if (!isLiveAccountId(acct) || String(acct).toUpperCase() !== String(expected).toUpperCase()) throw new Error('החשבון שמחובר ל-Gateway לא תואם ל-LIVE_ACCOUNT — הגשר מסרב לפעול');
  return acct;
}

/** סימולציה → חי: משקל הפקודה בסימולציה (שווי הפקודה ÷ הון הסימולציה) × הון חי מאושר, מעוגל לכמות שלמה. 0 = לא ניתן לשלוח */
export function scaleQty({ simQty, simPrice, simEquityUsd, liveBaseUsd, livePrice, units = 1 }){
  if (![simQty, simPrice, simEquityUsd, liveBaseUsd, livePrice].every((x) => isNum(x) && x > 0)) return 0;
  const weight = (simQty * simPrice * units) / simEquityUsd;
  return Math.max(0, Math.round((weight * liveBaseUsd) / livePrice));
}

/** מחיר LMT לפי ציטוט בזמן אמת. קנייה: ask+slip, מכירה: bid−slip. אין ציטוט/spread רחב/ציטוט מושהה → לא שולחים */
export function liveLimitPrice({ side, bid, ask, availability = null, limits = LIVE_LIMITS }){
  if (!(bid > 0) || !(ask > 0)) return { ok: false, retry: true, reason: 'אין bid/ask בציטוט' };
  // 6509: 'R…' = זמן אמת, 'D…' = מושהה (15 דק'). מסחר בכסף אמיתי על מחיר מושהה אסור — דורש מינוי נתוני שוק של ארה"ב
  if (!/^R/i.test(String(availability || ''))) return { ok: false, retry: true, reason: `ציטוט לא בזמן אמת (${availability || 'ללא סימון'}) — נדרש מינוי נתוני שוק` };
  if ((ask - bid) / ask > limits.maxSpreadPct) return { ok: false, retry: true, reason: `spread ${round((ask - bid) / ask * 100, 2)}% > ${limits.maxSpreadPct * 100}%` };
  return side === 'buy' ? { ok: true, price: round(ask * (1 + limits.maxSlippagePct), 2) } : { ok: true, price: round(bid * (1 - limits.maxSlippagePct), 2) };
}

/**
 * שער הפקודה החי — אחרי ההתאמה לגודל החשבון, לפני שליחה. order: { symbol, side: buy|sell, qty, price (אומדן לשווי) }.
 * account: { equityUsd, cashUsd, dayStartEquityUsd, hwmUsd }. positions: [{ symbol, qty, valueUsd }]. state: { opensToday }.
 * מכירה מותרת רק מול פוזיציה מוחזקת (מקטינה סיכון, לא נחסמת בעצירת הפסד); קנייה עוברת את כל הבדיקות. → { allowed, reasons, reducing }
 */
export function gateLiveOrder({ order = {}, account = {}, positions = [], state = {}, killed = false, limits = LIVE_LIMITS } = {}){
  const reasons = [];
  const fail = (m) => reasons.push(m);
  const sym = order.symbol, side = order.side, qty = Number(order.qty), price = Number(order.price);
  const inst = instrumentOf(sym);
  if (killed) fail('kill switch מופעל');
  if (!sym || isOptionSymbol(sym) || !inst) fail(`מכשיר לא מוכר/לא מאושר: ${sym}`);
  else if (!limits.allowedClasses.includes(inst.class)) fail(`סוג ${inst.class} לא מאושר בחשבון האמיתי (רק ${limits.allowedClasses.join(', ')})`);
  if (side !== 'buy' && side !== 'sell') fail(`צד ${side} לא מאושר (רק buy/sell — long בלבד)`);
  if (!(Number.isInteger(qty) && qty > 0)) fail('כמות לא תקינה (נדרש מספר שלם חיובי)');
  if (!(price > 0)) fail('אין מחיר לאומדן שווי');
  if (reasons.length) return { allowed: false, reasons, reducing: false };
  const held = positions.filter((p) => p.symbol === sym).reduce((s, p) => s + (Number(p.qty) || 0), 0);
  if (side === 'sell'){
    if (!(held > 0)) fail(`אין פוזיציה ב-${sym} למכירה (אין שורט)`);
    else if (qty > held) fail(`מכירה ${qty} > מוחזק ${held}`);
    return { allowed: reasons.length === 0, reasons, reducing: true };
  }
  const equity = Number(account.equityUsd), cash = Number(account.cashUsd);
  const base = Math.min(isNum(equity) ? equity : 0, limits.approvedCapitalUsd);
  const notional = qty * price;
  if (!(equity >= limits.minEquityUsd)) fail(`הון ${isNum(equity) ? round(equity, 2) : '?'}$ מתחת למינימום ${limits.minEquityUsd}$`);
  if (notional > limits.maxOrderUsd) fail(`פקודה ${round(notional, 2)}$ > תקרה ${limits.maxOrderUsd}$`);
  if (!(cash >= notional)) fail(`מזומן ${isNum(cash) ? round(cash, 2) : '?'}$ לא מכסה ${round(notional, 2)}$ (בלי margin)`);
  const same = positions.filter((p) => p.symbol === sym).reduce((s, p) => s + Math.abs(Number(p.valueUsd) || 0), 0);
  if (base > 0 && (same + notional) / base > limits.maxPositionShare + 1e-9) fail(`${sym} אחרי הפקודה ${round((same + notional) / base * 100, 1)}% מההון > ${limits.maxPositionShare * 100}%`);
  const open = new Set(positions.filter((p) => (Number(p.qty) || 0) > 0).map((p) => p.symbol));
  if (!open.has(sym) && open.size >= limits.maxOpenPositions) fail(`כבר ${open.size} פוזיציות פתוחות (מקסימום ${limits.maxOpenPositions})`);
  if ((state.opensToday || 0) >= limits.maxOrdersPerDay) fail(`מכסת פקודות פתיחה יומית (${limits.maxOrdersPerDay}) נוצלה`);
  const dayStart = Number(account.dayStartEquityUsd);
  if (dayStart > 0 && isNum(equity) && (dayStart - equity) / dayStart >= limits.maxDailyLossPct) fail(`הפסד יומי ${round((dayStart - equity) / dayStart * 100, 2)}% ≥ ${limits.maxDailyLossPct * 100}%`);
  const hwm = Number(account.hwmUsd);
  if (hwm > 0 && isNum(equity) && (hwm - equity) / hwm >= limits.maxDrawdownPct) fail(`ירידה מהשיא ${round((hwm - equity) / hwm * 100, 2)}% ≥ ${limits.maxDrawdownPct * 100}%`);
  return { allowed: reasons.length === 0, reasons, reducing: false };
}

/** עצירת הפסד מקומית של הגשר: פוזיציה שההפסד הלא-ממומש שלה מול העלות ≥ positionStopPct → מכירה מלאה. positions: [{ symbol, qty, avgPrice, marketPrice }] */
export function stopOuts(positions = [], limits = LIVE_LIMITS){
  return positions.filter((p) => (Number(p.qty) || 0) > 0 && p.avgPrice > 0 && p.marketPrice > 0 && (p.avgPrice - p.marketPrice) / p.avgPrice >= limits.positionStopPct)
    .map((p) => ({ symbol: p.symbol, side: 'sell', qty: Math.floor(Number(p.qty)), price: p.marketPrice, lossPct: round((p.avgPrice - p.marketPrice) / p.avgPrice * 100, 1) }));
}

/** גוף פקודת LMT ל-Client Portal API (מניות/ETF בלבד) */
export function liveOrderBody({ acctId, conid, side, qty, price, cOID }){
  return { acctId, conid: Number(conid), secType: `${Number(conid)}:STK`, orderType: 'LMT', price: round(price, 2), side: side === 'buy' ? 'BUY' : 'SELL', quantity: Math.floor(qty), tif: 'DAY', cOID: String(cOID || '').slice(0, 64), outsideRTH: false };
}
