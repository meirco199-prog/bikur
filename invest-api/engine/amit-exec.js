// ביצוע מסלול "עמית" (engine/amit-rules.js) בחשבון הדמו של Bybit — החלטות בלבד (פונקציות טהורות, בלי רשת). את הפעולות מבצע
// scripts/bybit-amit-bot.mjs על השרת. החלטת מאיר (7/11/2026, "תבנה"): בוט שסוחר לבד בחשבון הדמו של Bybit, מגבלת הפסד יומית 1,000$.
// אותם כללים כמו הסימולציה (גרסה 1), מתורגמים לפקודות אמיתיות:
//   • שטוח + הנר האחרון נסגר בתוך הרצועות (נגיעה טרייה) → שתי פקודות מוגבלות: קנייה על הרצועה התחתונה ומכירה על העליונה,
//     כל אחת עם סטופ −0.22% מצורף (נשמר בבורסה — מגן גם אם השרת נופל). מחודשות בכל נר (הרצועות זזות).
//   • נכנסנו → מבטלים מיד את פקודת הכניסה הנגדית; בכל נר: פקודת יעד reduce-only על הרצועה הנגדית.
//   • 60 דקות בעסקה → סגירה בפקודת שוק. • הפסד יומי (ממומש + פתוח) ≤ −1,000$ → סגירה, ביטול הכול, ועצירה עד מחר (שעון ישראל).
//   • קובץ STOP על השרת → אותו דבר, עד שנמחק.
// מה שונה מהסימולציה, בכוונה: מילוי אמיתי (כולל החלקה), ובנר שנוגע בשתי הרצועות ייתכן מילוי כפול — הבוט מבטל את הנגדית תוך שניות.
import { createHmac } from 'node:crypto';
import { AMIT, bands } from './amit-rules.js';

export const BOT = Object.freeze({
  version: 1, symbol: 'BTCUSDT', category: 'linear',
  base: 'https://api-demo.bybit.com',      // חשבון הדמו בלבד. אין בקוד הזה כתובת של החשבון האמיתי
  market: 'https://api.bybit.com',         // נרות (מחירי השוק האמיתי, כמו בדמו של Bybit)
  notional: AMIT.notional, slPct: AMIT.slPct, maxMins: AMIT.maxBars, bbN: AMIT.bbN, bbK: AMIT.bbK,
  leverage: 50, dailyLossUsd: 1000, tick: 0.1, qtyStep: 0.001, maxQty: 5,
  tag: 'amit',                             // קידומת orderLinkId — הבוט נוגע רק בפקודות שלו
});

const fix = (x, step) => { const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9)); return (Math.round(x / step) * step).toFixed(d); };
export const pxDown = (x, P = BOT) => fix(Math.floor(x / P.tick + 1e-9) * P.tick, P.tick);
export const pxUp = (x, P = BOT) => fix(Math.ceil(x / P.tick - 1e-9) * P.tick, P.tick);
export const pxRound = (x, P = BOT) => fix(x, P.tick);
export function qtyFor(price, P = BOT){
  const q = Math.floor(P.notional / price / P.qtyStep + 1e-9) * P.qtyStep;
  return fix(Math.min(q, P.maxQty), P.qtyStep);
}

// חתימת Bybit v5: HMAC-SHA256(secret, timestamp + apiKey + recvWindow + (queryString | jsonBody))
export const sign = (secret, ts, key, rw, payload) => createHmac('sha256', secret).update(String(ts) + key + String(rw) + payload).digest('hex');

// יום מסחר לפי שעון ישראל (המגבלה היומית מתאפסת בחצות)
export function ilDay(ms){
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// נרות Bybit: { result: { list: [[startMs, o, h, l, c, vol, turnover], ...] } } מהחדש לישן → רק נרות סגורים, מהישן לחדש
export function closedKlines(j, nowMs, barMs = 60e3){
  const list = j?.result?.list;
  if (!Array.isArray(list)) throw new Error('kline: תשובה לא צפויה');
  return list.map((r) => ({ t: Number(r[0]), c: Number(r[4]) }))
    .filter((b) => Number.isFinite(b.t) && b.c > 0 && b.t + barMs <= nowMs)
    .sort((a, b) => a.t - b.t);
}

// רמות לנר הבא מ-20 הסגירות האחרונות: אזור הסגירה האחרונה + מחירי כניסה, סטופ ויעד
export function levels(closes, P = BOT){
  if (!Array.isArray(closes) || closes.length < P.bbN) return null;
  const c = closes.slice(-P.bbN), b = bands(c, P.bbK), last = c.at(-1);
  const zone = last < b.lo ? 'below' : last > b.up ? 'above' : 'in';
  const buy = Number(pxDown(b.lo, P)), sell = Number(pxUp(b.up, P));
  return { zone, lo: b.lo, up: b.up, mid: b.mid,
    buy: { price: buy, sl: Number(pxRound(buy * (1 - P.slPct / 100), P)) },
    sell: { price: sell, sl: Number(pxRound(sell * (1 + P.slPct / 100), P)) } };
}

const isEntry = (o, P) => String(o.orderLinkId || '').startsWith(`${P.tag}-e-`);
const isTp = (o, P) => String(o.orderLinkId || '').startsWith(`${P.tag}-tp-`);

// ההחלטה: snapshot → רשימת פעולות. snapshot = { pos: {side:'long'|'short', size, entry, sinceMs}|null, orders: [פקודות פתוחות],
//   closes: [סגירות דקה], newBar: האם נסגר נר מאז הריצה הקודמת, halt: null|'daily'|'stop', nowMs, barT }
// פעולות: {type:'cancel', orderId} · {type:'place', order} · {type:'close'} (סגירה בשוק, reduce-only) · {type:'cancelAll'}
export function decide(s, P = BOT){
  const out = [], mine = (s.orders || []).filter((o) => isEntry(o, P) || isTp(o, P));
  const pos = s.pos && Number(s.pos.size) > 0 ? s.pos : null;
  if (s.halt){
    if (mine.length) out.push({ type: 'cancelAll' });
    if (pos) out.push({ type: 'close', why: s.halt === 'daily' ? 'מגבלת הפסד יומית' : 'עצירה ידנית' });
    return out;
  }
  if (pos){
    // בעסקה: פקודות כניסה שנשארו (הנגדית) — מבטלים מיד, גם באמצע נר
    for (const o of mine.filter((x) => isEntry(x, P))) out.push({ type: 'cancel', orderId: o.orderId });
    const ageMin = (s.nowMs - pos.sinceMs) / 60e3;
    if (ageMin >= P.maxMins){ for (const o of mine.filter((x) => isTp(x, P))) out.push({ type: 'cancel', orderId: o.orderId }); out.push({ type: 'close', why: 'זמן (60 דק׳)' }); return out; }
    if (!s.newBar) return out;
    const L = levels(s.closes, P);
    if (!L) return out;
    const tp = pos.side === 'long' ? L.sell.price : L.buy.price, side = pos.side === 'long' ? 'Sell' : 'Buy';
    for (const o of mine.filter((x) => isTp(x, P))) out.push({ type: 'cancel', orderId: o.orderId });
    out.push({ type: 'place', order: { side, orderType: 'Limit', qty: String(pos.size), price: pxRound(tp, P), timeInForce: 'GTC', reduceOnly: true, orderLinkId: `${P.tag}-tp-${s.barT}` } });
    return out;
  }
  // שטוח: פקודות יעד שנשארו אחרי סטופ — מבטלים
  for (const o of mine.filter((x) => isTp(x, P))) out.push({ type: 'cancel', orderId: o.orderId });
  if (!s.newBar) return out;
  for (const o of mine.filter((x) => isEntry(x, P))) out.push({ type: 'cancel', orderId: o.orderId });
  const L = levels(s.closes, P);
  if (!L || L.zone !== 'in') return out; // רק אחרי סגירה בתוך הרצועות — נגיעה טרייה
  for (const [k, side] of [['buy', 'Buy'], ['sell', 'Sell']]){
    const x = L[k];
    out.push({ type: 'place', order: { side, orderType: 'Limit', qty: qtyFor(x.price, P), price: pxRound(x.price, P), timeInForce: 'GTC',
      stopLoss: pxRound(x.sl, P), slTriggerBy: 'LastPrice', tpslMode: 'Full', slOrderType: 'Market', orderLinkId: `${P.tag}-e-${k}-${s.barT}` } });
  }
  return out;
}

// מגבלת הפסד יומית: ממומש היום (אחרי עמלות) + פתוח
export const dailyHalt = (realizedTodayUsd, unrealizedUsd, P = BOT) => (Number(realizedTodayUsd) || 0) + (Number(unrealizedUsd) || 0) <= -P.dailyLossUsd;

// דוח לשרת (כל שעתיים ובעצירה): עסקאות סגורות מ-closed-pnl של Bybit, מקובצות ליום ישראל
export function summarize(trades, { day, equity, pos, halt, startedAt, lastError } = {}){
  const t = Array.isArray(trades) ? trades : [], today = t.filter((x) => ilDay(x.t) === day);
  const sum = (a) => Math.round(a.reduce((s, x) => s + x.pnl, 0) * 100) / 100;
  return { v: 1, day, startedAt: startedAt || null, equity: Number.isFinite(equity) ? Math.round(equity * 100) / 100 : null,
    today: { n: today.length, wins: today.filter((x) => x.pnl > 0).length, netUsd: sum(today) },
    total: { n: t.length, wins: t.filter((x) => x.pnl > 0).length, netUsd: sum(t) },
    pos: pos ? { side: pos.side, size: Number(pos.size), entry: Number(pos.entry) } : null, halt: halt || null,
    lastError: lastError ? String(lastError).slice(0, 200) : null };
}
