// מיפוי טהור בין יקום הסוכן (engine/instruments.js) לחוזים ופקודות של IBKR (Client Portal Web API), והשוואת מילויים.
// בלי רשת ובלי KV: הגשר (scripts/ibkr-bridge.mjs) משתמש בזה מול ה-Gateway, ה-Worker משתמש בזה להשוואה (reconcile).
// כללים: פקודות שוק בלבד (MKT, DAY), כמויות שלמות למניות/ETF/חוזים (IBKR לא מקבל שורט חלקי), 6 ספרות לקריפטו/מט"ח.
import { instrumentOf } from './instruments.js';
import { round, isNum } from './util.js';
import { isOptionSymbol, parseOptionSymbol } from './options.js';

// חוזי micro אמיתיים ל"חוזים הסינתטיים" של הסימולציה. ZN~ הוא אג"ח 10 שנים ב-CBOT (לא micro; חוזה אחד = 100k$ נומינלי)
const FUT_SPEC = { MES: ['MES', 'CME'], MNQ: ['MNQ', 'CME'], M2K: ['M2K', 'CME'], MGC: ['MGC', 'COMEX'], MCL: ['MCL', 'NYMEX'], MBT: ['MBT', 'CME'], 'ZN~': ['ZN', 'CBOT'] };

/** מפרט חוזה IBKR למכשיר של הסוכן → { secType, symbol, exchange, currency, ...fields } או null אם אין מיפוי */
export function ibkrContractSpec(instOrSymbol){
  const inst = typeof instOrSymbol === 'string' ? instrumentOf(instOrSymbol) : instOrSymbol;
  if (!inst) return null;
  switch (inst.class){
    case 'stock': case 'etf': return { secType: 'STK', symbol: inst.symbol, exchange: 'SMART', currency: 'USD' };
    case 'crypto': { const base = inst.symbol.split('-')[0]; return { secType: 'CRYPTO', symbol: base, exchange: 'PAXOS', currency: 'USD' }; }
    case 'fx': { const b = inst.symbol.slice(0, 3), q = inst.symbol.slice(3, 6); return { secType: 'CASH', symbol: b, currency: q, exchange: 'IDEALPRO', pair: `${b}.${q}` }; }
    case 'future': { const [sym, exch] = FUT_SPEC[inst.symbol] || [inst.symbol, 'CME']; return { secType: 'FUT', symbol: sym, exchange: exch, currency: 'USD', frontMonth: true }; }
    default: return null;
  }
}

/** בחירת החוזה הקרוב (front month) מרשימת /trsrv/futures: הראשון שפג לפחות minDays אחרי day (YYYY-MM-DD) */
export function pickFrontMonth(contracts = [], day, { minDays = 5 } = {}){
  const dayNum = Number(String(day).replace(/-/g, ''));
  const minMs = minDays * 86400000;
  const ok = (contracts || []).filter((c) => c && c.conid && /^\d{8}$/.test(String(c.expirationDate || ''))).map((c) => ({ ...c, exp: Number(c.expirationDate) }))
    .filter((c) => c.exp >= dayNum && (Date.parse(fmt(c.exp)) - Date.parse(day)) >= minMs).sort((a, b) => a.exp - b.exp);
  return ok[0] || null;
}
const fmt = (n) => { const s = String(n); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };

export const IBKR_SIDE = Object.freeze({ buy: 'BUY', sell: 'SELL', short: 'SELL', cover: 'BUY' });

// --- אופציות (קנייה בלבד): הסימבול הפנימי <UNDER>-<YYYYMMDD>-<C|P>-<strike> → חוזה OPT אמיתי ב-IBKR. פקודות LMT בלבד (ספרד רחב) ---
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
/** '2026-11-20' → 'NOV26' (הפורמט של /iserver/secdef/strikes ו-/info) */
export const optionMonth = (expiry) => { const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(expiry || '')); return m ? MONTHS[Number(m[2]) - 1] + m[1].slice(2) : null; };
/** ציטוט snapshot של IBKR: '14.79' / 'C14.98' (קידומת C = מחיר סגירה קודם, H = halted) → מספר או null */
export const parseQuoteNum = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.\-]/g, '')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null; };
/**
 * מחיר LMT לפקודת אופציה לפי ציטוט אמיתי: קנייה בצד ה-ask, מכירה בצד ה-bid (כך מתמלאת). קנייה שה-ask שלה גבוה ממחיר המודל של הסימולציה ביותר
 * מ-maxDeviation נדחית (לא משלמים הרבה מעל מה שהסוכן הניח). אין ציטוט → retry (הפקודה לא מסומנת כנשלחה). אופציה חסרת ערך (bid 0) נמכרת ב-0.01.
 */
export function optionLimit({ side, bid, ask, simPrice, maxDeviation = 0.4 } = {}){
  const buy = side === 'buy' || side === 'cover';
  if (buy){
    if (!(ask > 0)) return { ok: false, retry: true, reason: 'אין ask בציטוט' };
    if (isNum(simPrice) && simPrice > 0 && ask > simPrice * (1 + maxDeviation)) return { ok: false, reason: `ask ${ask} גבוה ממחיר המודל ${simPrice} ביותר מ-${Math.round(maxDeviation * 100)}% — לא קונים` };
    return { ok: true, price: round(ask, 2) };
  }
  if (bid > 0) return { ok: true, price: round(bid, 2) };
  if (bid === 0 && isNum(ask)) return { ok: true, price: 0.01 };
  return { ok: false, retry: true, reason: 'אין bid בציטוט' };
}
export const OPTION_MAX_NOTIONAL_USD = 15000;   // תקרה קשיחה בגשר לפקודת אופציה אחת בדמה (פרמיה × 100 × חוזים)

/** כמות לפקודה ב-IBKR: שלמים למניות/ETF/חוזים (עיגול למטה), 6 ספרות לקריפטו/מט"ח. 0 = לא ניתן לשלוח */
export function ibkrQty(inst, qty){
  if (!inst || !(qty > 0)) return 0;
  if (inst.class === 'crypto' || inst.class === 'fx') return round(qty, 6);
  return Math.floor(qty + 1e-9);
}

/** פקודת הסוכן → גוף פקודה ל-POST /iserver/account/{acct}/orders. מחזיר { ok, order, reason } */
export function toIbkrOrder({ order, conid, acctId, tif = 'DAY', limitPrice = null } = {}){
  if (isOptionSymbol(order?.symbol)){
    if (!conid) return { ok: false, reason: 'חסר conid' };
    const side = IBKR_SIDE[order.side]; if (!side) return { ok: false, reason: `צד לא מוכר: ${order.side}` };
    const quantity = Math.floor((Number(order.qty) || 0) + 1e-9); if (!(quantity > 0)) return { ok: false, reason: `כמות ${order.qty} מתעגלת ל-0 חוזים` };
    if (!(limitPrice > 0)) return { ok: false, reason: 'אופציה נשלחת רק כפקודת LMT עם מחיר' };
    if ((side === 'BUY') && limitPrice * 100 * quantity > OPTION_MAX_NOTIONAL_USD) return { ok: false, reason: `פרמיה ${round(limitPrice * 100 * quantity, 0)}$ מעל התקרה ${OPTION_MAX_NOTIONAL_USD}$ לפקודה` };
    return { ok: true, inst: { class: 'option', units: 100 }, order: { acctId, conid: Number(conid), secType: `${Number(conid)}:OPT`, orderType: 'LMT', price: round(limitPrice, 2), side, quantity, tif, cOID: String(order.clientOrderId || '').slice(0, 64), outsideRTH: false } };
  }
  const inst = instrumentOf(order?.symbol);
  if (!inst) return { ok: false, reason: `מכשיר לא מוכר: ${order?.symbol}` };
  if (!conid) return { ok: false, reason: 'חסר conid' };
  const side = IBKR_SIDE[order.side]; if (!side) return { ok: false, reason: `צד לא מוכר: ${order.side}` };
  const quantity = ibkrQty(inst, order.qty);
  if (!(quantity > 0)) return { ok: false, reason: `כמות ${order.qty} מתעגלת ל-0 יחידות שלמות` };
  const o = { acctId, conid: Number(conid), orderType: 'MKT', side, quantity, tif, cOID: String(order.clientOrderId || '').slice(0, 64), outsideRTH: false, ...(inst.class === 'fx' ? { cashQty: undefined } : {}) };
  Object.keys(o).forEach((k) => o[k] === undefined && delete o[k]);
  return { ok: true, order: o, inst };
}

/** תגובת פקודה של IBKR יכולה להיות בקשת אישור: [{ id, message:[...] }] — צריך POST /iserver/reply/{id} {confirmed:true} */
export const needsConfirm = (resp) => Array.isArray(resp) && resp.length > 0 && !!resp[0]?.id && !resp[0]?.order_id && Array.isArray(resp[0]?.message);
export const orderIdOf = (resp) => (Array.isArray(resp) ? resp.find((x) => x?.order_id)?.order_id : resp?.order_id) || null;

/**
 * יציאה (עצירה/חיסול) של הסימולציה מול מה שהדמה באמת מחזיק: הדמה קיבל רק פקודות שנשלחו מאז שהגשר התחבר,
 * אז פוזיציה שהסימולציה פתחה לפני כן לא קיימת בו — "מכירה" כזו הייתה פותחת שורט בדמה. לכן: אין פוזיציה מתאימה → דילוג,
 * פוזיציה קטנה יותר → הכמות נחתכת למה שמוחזק. held = כמות חתומה בדמה (שלילי = שורט).
 * → { ok, qty, reason }
 */
export function clipExitToHeld(order = {}, held = 0){
  const isExit = order.kind === 'stop' || order.kind === 'liquidation' || order.kind === 'option-exit';
  if (!isExit) return { ok: true, qty: order.qty };
  const h = Number(held) || 0;
  const closingLong = order.side === 'sell', closingShort = order.side === 'cover';
  if (!closingLong && !closingShort) return { ok: true, qty: order.qty };
  const avail = closingLong ? h : -h;
  if (!(avail > 0)) return { ok: false, qty: 0, reason: `הדמה לא מחזיק ${closingLong ? 'לונג' : 'שורט'} ב-${order.symbol} (נפתח בסימולציה לפני חיבור הגשר) — לא סוגרים` };
  const qty = Math.min(Number(order.qty) || 0, avail);
  return { ok: qty > 0, qty, reason: qty < (Number(order.qty) || 0) ? `כמות נחתכה ל-${qty} (מוחזק בדמה)` : undefined };
}

/** מילוי מ-/iserver/account/orders (או trades) → שורה אחידה */
export function normalizeBrokerOrder(o = {}){
  const filled = Number(o.filledQuantity ?? o.filled_quantity ?? o.size ?? 0) || 0;
  const avg = Number(o.avgPrice ?? o.avg_price ?? o.price ?? 0) || null;
  return { orderId: String(o.orderId ?? o.order_id ?? ''), clientOrderId: o.order_ref ?? o.cOID ?? o.orderRef ?? null, conid: o.conid ?? null, symbol: o.ticker ?? o.symbol ?? null, side: String(o.side || '').toUpperCase(), status: String(o.status || o.order_status || '').toLowerCase(), qty: Number(o.totalSize ?? o.total_size ?? o.remainingQuantity ?? 0) || filled, filledQty: filled, avgPrice: avg, at: o.lastExecutionTime_r ? new Date(Number(o.lastExecutionTime_r)).toISOString() : (o.trade_time_r ? new Date(Number(o.trade_time_r)).toISOString() : null) };
}

/**
 * השוואת מילויי הסימולציה למילויי הברוקר לפי clientOrderId.
 * simFills: [{ clientOrderId, symbol, side, qty, price }] · brokerFills: [{ clientOrderId, filledQty, avgPrice, status }]
 * → { rows: [{ id, symbol, side, simQty, simPrice, brokerQty, brokerPrice, slipPct, status }], summary }
 */
export function reconcileFills(simFills = [], brokerFills = []){
  const byId = new Map((brokerFills || []).filter((b) => b?.clientOrderId).map((b) => [b.clientOrderId, b]));
  const rows = (simFills || []).map((s) => {
    const b = byId.get(s.clientOrderId);
    const slip = b && isNum(b.avgPrice) && isNum(s.price) && s.price ? round((b.avgPrice / s.price - 1) * (s.side === 'buy' || s.side === 'cover' ? 1 : -1), 4) : null; // חיובי = הברוקר יקר יותר לנו
    let status = 'missing'; if (b){ status = b.filledQty >= ibkrQty(instrumentOf(s.symbol) || (isOptionSymbol(s.symbol) ? { class: 'option' } : null), s.qty) - 1e-9 && b.filledQty > 0 ? 'filled' : (b.filledQty > 0 ? 'partial' : (b.status || 'sent')); }
    return { id: s.clientOrderId, symbol: s.symbol, side: s.side, simQty: s.qty, simPrice: s.price, brokerQty: b?.filledQty ?? null, brokerPrice: b?.avgPrice ?? null, slipPct: slip, status };
  });
  const extra = [...byId.keys()].filter((id) => !(simFills || []).some((s) => s.clientOrderId === id));
  const filled = rows.filter((r) => r.status === 'filled');
  const slips = filled.map((r) => r.slipPct).filter(isNum);
  return { rows, extraBroker: extra, summary: { sim: rows.length, filled: filled.length, partial: rows.filter((r) => r.status === 'partial').length, missing: rows.filter((r) => r.status === 'missing').length, avgSlipPct: slips.length ? round(slips.reduce((a, b) => a + b, 0) / slips.length, 4) : null } };
}
