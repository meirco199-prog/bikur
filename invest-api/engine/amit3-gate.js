// שער הפקודות של בוט 3 (דמו Bybit): כל פעולה מול הברוקר עוברת את order-gate.gateOrder (אותו שער דטרמיניסטי של הסוכן),
// עם מדיניות נפרדת לחשבון הדמו. invest-api/.ai/REVIEW.md: "פקודה לברוקר (גם דמה) עוברת את order-gate ואת מגבלות הסיכון".
// לא משנה את TRADING_POLICY (קובץ של בעל הריפו) — BOT3_POLICY נגזרת ממנה ומחמירה/מתאימה רק מה שנדרש לחוזים תמידיים בדמו.
// יחידות: שדות ה-"Ils" של השער מקבלים כאן דולרים (USDT) — השער לא ממיר מטבע, רק משווה יחסים.
import { gateOrder } from './order-gate.js';
import { TRADING_POLICY } from './trading-policy.js';
import { BOT3 } from './amit3-exec.js';

export const BOT3_POLICY = Object.freeze({
  ...TRADING_POLICY,
  version: 1, mode: 'paper',                       // חשבון דמו (כסף וירטואלי) — לא live
  capitalIls: 100000,                              // ההון הווירטואלי שבוט 3 רשאי לסכן (USDT)
  allowedClasses: Object.freeze(['crypto']), allowedExchanges: Object.freeze(['BYBIT']),
  shorting: false, unboundedLoss: false,           // לונג בלבד, תמיד עם סטופ בבורסה
  // מינוף 10 בבורסה (BOT3.leverage) = כמה מרג'ין נועל כל פוזיציה; החשיפה הכוללת בפועל מוגבלת כאן ל-×4 מההון הווירטואלי
  leverage: Object.freeze({ total: 4, byClass: Object.freeze({ ...TRADING_POLICY.leverage.byClass, crypto: 4 }) }),
  maxTradeShare: BOT3.maxNotional / 100000,        // מנה/עסקה עד 60,000$
  maxAssetShare: BOT3.maxNotional / 100000,
  maxSectorShare: 4, maxStrategyShare: 4,
  maxClassShare: Object.freeze({ ...TRADING_POLICY.maxClassShare, crypto: 4 }),
  maxDailyLoss: BOT3.dailyLossUsd / 100000,        // 1,000$ ביום → עצירת סיכון חדש
  maxDrawdown: 0.15,                               // ירידה של 15% מהשיא → עצירת סיכון חדש
  liquidityReserve: 0.10, marginBuffer: 0.30,
  noAveragingDown: true,                           // נשאר! מנות 60/90 עוברות רק עם allowAddToLoser מפורש (תוכנית שנקבעה לפני הכניסה)
  maxOrdersPerDay: 120, requireFreshData: true, requireMarketOpen: true, killSwitch: false,
});
export const CAPS3 = Object.freeze({ tradable: new Set(Object.keys(BOT3.coins).map((c) => `${c}USDT`)), classes: new Set(['crypto']), exchanges: new Set(['BYBIT']) });

// מזהה פקודה דטרמיניסטי (≤36 תווים ל-Bybit): אותה החלטה → אותו מזהה → השער והבורסה דוחים כפילות
export const linkId3 = (sym, signalT, k) => `${BOT3.tag}-${sym.replace(/USDT$/, '').slice(0, 8)}-${Math.floor(signalT / 60e3).toString(36)}-${k}`;

// req: { sym, side: 'buy'|'sell', qty, price, id, worstLoss?, addToPlan?, cancel? } · env: { now, equity, available, dayPnl, hwm, positions: {SYM:{size, avg, unrealized}}, journal: [{clientOrderId}] }
export function gate3(req, env){
  // ביטול פקודה ממתינה לא יכול להגדיל סיכון — מותר תמיד (גם בעצירה/מגבלה יומית), לא נספר במכסה, ונרשם ביומן כמו כל פעולה.
  // בלי זה, בעצירה יומית בלי פוזיציה פתוחה, השער היה חוסם ביטול של מנות 60/90 שעוד ממתינות — והן היו עלולות להתמלא.
  if (req.cancel) return { allowed: true, reducing: true, clientOrderId: req.id, reasons: [], checks: { cancel: true }, policyVersion: BOT3_POLICY.version, mode: BOT3_POLICY.mode };
  const positions = Object.entries(env.positions || {}).map(([s, p]) => ({ symbol: s, qty: p.size, valueIls: p.size * p.avg, pnlIls: p.unrealized, class: 'crypto', strategy: 'amit3' }));
  const order = {
    symbol: req.sym, side: req.side, qty: req.qty, priceRef: req.price, class: 'crypto', exchange: 'BYBIT', strategy: 'amit3', day: new Date(env.now).toISOString().slice(0, 10),
    clientOrderId: req.id, quoteAsOf: new Date(env.now).toISOString(), marketOpen: true, exposureMultiplier: BOT3.leverage,
    worstCaseLossIls: req.side === 'buy' ? (req.worstLoss ?? null) : 0, allowAddToLoser: !!req.addToPlan,
  };
  const account = { equityIls: env.equity, cashIls: env.available, dayPnlIls: env.dayPnl, hwmIls: env.hwm, grossExposureIls: positions.reduce((s, p) => s + Math.abs(p.valueIls), 0) };
  return gateOrder({ order, policy: BOT3_POLICY, account, positions, capabilities: CAPS3, journal: env.journal || [], now: new Date(env.now) });
}
