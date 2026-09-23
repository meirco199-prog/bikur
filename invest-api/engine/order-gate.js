// שער הפקודות הדטרמיניסטי של הסוכן האוטונומי. כל פקודה — מכל אסטרטגיה, מכל מודל — עוברת כאן לפני הברוקר.
// פונקציה טהורה: אותם קלטים → אותה תשובה. בלי רשת, בלי KV, בלי מודל שפה. מחזירה allowed + כל הסיבות (לא רק הראשונה),
// כדי שהיומן יראה למה פקודה נדחתה. עקרון: "עצירה" חוסמת סיכון חדש; סגירה/הקטנה של פוזיציה מותרת גם בעצירה (חוץ מ-kill switch).
import { TRADING_POLICY } from './trading-policy.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const share = (a, b) => (b > 0 ? a / b : Infinity);

// hash יציב של המדיניות (FNV-1a על JSON ממוין) — האישור לחי נקשר אליו; שינוי כלשהו במדיניות = אישור לא תקף
export function policyHash(policy = TRADING_POLICY){
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  const s = JSON.stringify(sorted({ ...policy, approval: undefined }));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ('0000000' + h.toString(16)).slice(-8) + '-' + s.length;
}

// מזהה פקודה דטרמיניסטי: שליחה חוזרת אחרי ניתוק/timeout מייצרת אותו מזהה → הברוקר/היומן מזהים כפילות
export function clientOrderId({ day, strategy, symbol, side, decisionVersion = 1 }){
  return ['agent', day, strategy, symbol, side, 'v' + decisionVersion].join(':').replace(/[^A-Za-z0-9:._-]/g, '_');
}

// האם הפקודה מקטינה סיכון (סגירה/הקטנה של פוזיציה קיימת באותו כיוון)
export function isRiskReducing(order, positions = []){
  const p = positions.find((x) => x.symbol === order.symbol);
  if (!p) return false;
  const long = num(p.qty) > 0, short = num(p.qty) < 0;
  return (long && (order.side === 'sell')) || (short && (order.side === 'cover' || order.side === 'buy'));
}

// מצב עצירה של החשבון (בלי קשר לפקודה מסוימת)
export function haltState({ policy = TRADING_POLICY, account = {} } = {}){
  const reasons = [];
  const cap = num(policy.capitalIls);
  if (policy.killSwitch) reasons.push('kill switch מופעל');
  const dayLoss = -num(account.dayPnlIls);
  if (cap > 0 && dayLoss > 0 && dayLoss / cap >= policy.maxDailyLoss) reasons.push(`הפסד יומי ${(dayLoss / cap * 100).toFixed(2)}% ≥ ${(policy.maxDailyLoss * 100).toFixed(1)}%`);
  const hwm = num(account.hwmIls), eq = num(account.equityIls);
  if (hwm > 0 && eq > 0 && (hwm - eq) / hwm >= policy.maxDrawdown) reasons.push(`ירידה מהשיא ${((hwm - eq) / hwm * 100).toFixed(2)}% ≥ ${(policy.maxDrawdown * 100).toFixed(1)}%`);
  if (account.reconciliationOk === false) reasons.push('אי-התאמה בין הברוקר למערכת (reconciliation)');
  return { halted: reasons.length > 0, reasons };
}

/**
 * gateOrder — בודק פקודה אחת מול המדיניות, החשבון, הפוזיציות, מפת היכולות והיומן של היום.
 * order: { symbol, class, side: buy|sell|short|cover, qty, priceRef, notionalIls, currency, strategy, sector, exchange,
 *          exposureMultiplier (1 למניה; מכפיל לחוזה/ETF ממונף), worstCaseLossIls (null = בלתי מוגבל), day, decisionVersion,
 *          quoteAsOf, marketOpen }
 * account: { equityIls, cashIls, grossExposureIls, dayPnlIls, hwmIls, availableFundsIls, maintenanceMarginIls, reconciliationOk }
 * positions: [{ symbol, class, sector, strategy, qty, valueIls, pnlIls }]
 * capabilities: { tradable: Set|Array של סימבולים, classes: Set|Array, exchanges: Set|Array } — מפת היכולות של החשבון; null = לא ידוע → חוסם
 * journal: פקודות שנשלחו היום [{ clientOrderId, symbol, side }]
 */
export function gateOrder({ order = {}, policy = TRADING_POLICY, account = {}, positions = [], capabilities = null, journal = [], now = new Date() } = {}){
  const reasons = [], checks = {};
  const cap = num(policy.capitalIls);
  const eq = num(account.equityIls, cap);
  const reducing = isRiskReducing(order, positions);
  const notional = Math.abs(num(order.notionalIls, num(order.qty) * num(order.priceRef))) * Math.max(1, num(order.exposureMultiplier, 1));
  const id = order.clientOrderId || clientOrderId({ day: order.day || now.toISOString().slice(0, 10), strategy: order.strategy || 'unknown', symbol: order.symbol || '?', side: order.side || '?', decisionVersion: order.decisionVersion });
  const fail = (key, msg) => { checks[key] = false; reasons.push(msg); };
  const pass = (key) => { checks[key] = true; };

  // 0. תקינות בסיסית
  if (!order.symbol || !order.side || !(num(order.qty) > 0) || !(notional > 0)) fail('valid', 'פקודה לא תקינה (symbol/side/qty/notional)'); else pass('valid');

  // 1. kill switch — חוסם הכול, גם סגירה אוטומטית
  if (policy.killSwitch) fail('killSwitch', 'kill switch מופעל — אין פקודות אוטומטיות'); else pass('killSwitch');

  // 2. מצב הפעלה: live דורש אישור עם hash תואם
  if (policy.mode === 'live'){
    const a = policy.approval;
    if (!a || a.policyHash !== policyHash(policy) || !(num(a.capitalIls) >= cap)) fail('approval', 'מצב live בלי אישור תקף (hash המדיניות לא תואם או ההון חורג מהאישור)'); else pass('approval');
  } else if (!['simulation', 'paper'].includes(policy.mode)) fail('approval', `מצב לא מוכר: ${policy.mode}`); else pass('approval');

  // 3. כפילות (idempotency)
  if ((journal || []).some((j) => j.clientOrderId === id)) fail('duplicate', `פקודה כפולה: ${id} כבר נשלחה היום`); else pass('duplicate');

  // 4. יכולות החשבון — לא ידוע = לא סוחרים
  const has = (set, v) => (set instanceof Set ? set.has(v) : Array.isArray(set) ? set.includes(v) : false);
  if (!capabilities) fail('capability', 'מפת היכולות של החשבון לא ידועה');
  else {
    const okSym = has(capabilities.tradable, order.symbol), okClass = !capabilities.classes || has(capabilities.classes, order.class), okEx = !order.exchange || !capabilities.exchanges || has(capabilities.exchanges, order.exchange);
    if (!okSym || !okClass || !okEx) fail('capability', `לא ניתן למסחר בחשבון: ${order.symbol} (${order.class || '?'}${order.exchange ? ' @' + order.exchange : ''})`); else pass('capability');
  }

  // 5. סוג מכשיר, שורט, הפסד בלתי מוגבל
  if (!policy.allowedClasses.includes(order.class)) fail('class', `סוג מכשיר לא מאושר: ${order.class || '?'}`); else pass('class');
  if (policy.allowedExchanges && order.exchange && !policy.allowedExchanges.includes(order.exchange)) fail('exchange', `בורסה לא מאושרת: ${order.exchange}`); else pass('exchange');
  if ((order.side === 'short') && !policy.shorting) fail('shorting', 'שורט לא מאושר במדיניות'); else pass('shorting');
  if (!reducing && order.worstCaseLossIls === null && !policy.unboundedLoss) fail('unboundedLoss', 'הפסד בלתי מוגבל (worstCaseLossIls=null) לא מאושר במדיניות'); else pass('unboundedLoss');

  // 6. נתונים ושעות מסחר (לפתיחת סיכון)
  const day = (order.day || now.toISOString().slice(0, 10));
  const quoteDay = order.quoteAsOf ? String(order.quoteAsOf).slice(0, 10) : null;
  if (!reducing && policy.requireFreshData && quoteDay !== day) fail('freshData', `אין ציטוט חי מהיום (${quoteDay || 'אין'} ≠ ${day})`); else pass('freshData');
  if (!reducing && policy.requireMarketOpen && order.marketOpen !== true) fail('marketOpen', 'השוק לא פתוח (או לא ידוע)'); else pass('marketOpen');

  // 7. עצירות חשבון — חוסמות סיכון חדש בלבד
  const halt = haltState({ policy, account });
  if (halt.halted && !reducing) fail('halt', 'עצירה: ' + halt.reasons.join(' · ')); else pass('halt');

  // 8. מכסת פקודות יומית
  if ((journal || []).length >= policy.maxOrdersPerDay && !reducing) fail('ordersPerDay', `מכסת פקודות יומית (${policy.maxOrdersPerDay}) נוצלה`); else pass('ordersPerDay');

  // 9. גדלים וחשיפות (לפתיחת/הגדלת סיכון)
  if (!reducing){
    const base = Math.max(1, Math.min(cap, eq));
    if (share(notional, base) > policy.maxTradeShare) fail('tradeShare', `פקודה ${(share(notional, base) * 100).toFixed(1)}% מההון > ${(policy.maxTradeShare * 100).toFixed(0)}%`); else pass('tradeShare');
    const sameAsset = positions.filter((p) => p.symbol === order.symbol).reduce((s, p) => s + Math.abs(num(p.valueIls)), 0);
    if (share(sameAsset + notional, base) > policy.maxAssetShare) fail('assetShare', `${order.symbol} אחרי הפקודה ${(share(sameAsset + notional, base) * 100).toFixed(1)}% > ${(policy.maxAssetShare * 100).toFixed(0)}%`); else pass('assetShare');
    if (order.sector){
      const sec = positions.filter((p) => p.sector === order.sector).reduce((s, p) => s + Math.abs(num(p.valueIls)), 0);
      if (share(sec + notional, base) > policy.maxSectorShare) fail('sectorShare', `ענף ${order.sector} אחרי הפקודה ${(share(sec + notional, base) * 100).toFixed(1)}% > ${(policy.maxSectorShare * 100).toFixed(0)}%`); else pass('sectorShare');
    } else pass('sectorShare');
    if (order.strategy){
      const st = positions.filter((p) => p.strategy === order.strategy).reduce((s, p) => s + Math.abs(num(p.valueIls)), 0);
      if (share(st + notional, base) > policy.maxStrategyShare) fail('strategyShare', `אסטרטגיה ${order.strategy} אחרי הפקודה ${(share(st + notional, base) * 100).toFixed(1)}% > ${(policy.maxStrategyShare * 100).toFixed(0)}%`); else pass('strategyShare');
    } else pass('strategyShare');
    const classCap = policy.maxClassShare?.[order.class];
    if (classCap !== undefined){
      const cls = positions.filter((p) => p.class === order.class).reduce((s, p) => s + Math.abs(num(p.valueIls)), 0);
      if (share(cls + notional, base) > classCap) fail('classShare', `סוג ${order.class} אחרי הפקודה ${(share(cls + notional, base) * 100).toFixed(1)}% > ${(classCap * 100).toFixed(0)}%`); else pass('classShare');
    } else pass('classShare');
    // מינוף: חשיפה ברוטו אחרי הפקודה ÷ הון
    const gross = num(account.grossExposureIls, positions.reduce((s, p) => s + Math.abs(num(p.valueIls)), 0)) + notional;
    const levCap = Math.min(num(policy.leverage.total, 1), num(policy.leverage.byClass?.[order.class], 1));
    if (share(gross, base) > levCap + 1e-9) fail('leverage', `מינוף אחרי הפקודה ${share(gross, base).toFixed(2)} > ${levCap}`); else pass('leverage');
    // רזרבת נזילות (לקנייה במזומן)
    if (order.side === 'buy'){
      const cashAfter = num(account.cashIls) - notional / Math.max(1, num(order.exposureMultiplier, 1));
      if (share(cashAfter, base) < policy.liquidityReserve - 1e-9) fail('liquidity', `מזומן אחרי הפקודה ${(share(cashAfter, base) * 100).toFixed(1)}% < רזרבה ${(policy.liquidityReserve * 100).toFixed(0)}%`); else pass('liquidity');
    } else pass('liquidity');
    // margin buffer כשיש נתונים
    if (num(account.maintenanceMarginIls) > 0){
      const ratio = num(account.availableFundsIls) / num(account.maintenanceMarginIls);
      if (ratio < 1 + policy.marginBuffer) fail('margin', `כספים זמינים ÷ margin = ${ratio.toFixed(2)} < ${(1 + policy.marginBuffer).toFixed(2)}`); else pass('margin');
    } else pass('margin');
    // אין הגדלת פוזיציה מפסידה
    const p = positions.find((x) => x.symbol === order.symbol);
    const adding = p && ((num(p.qty) > 0 && order.side === 'buy') || (num(p.qty) < 0 && order.side === 'short'));
    if (policy.noAveragingDown && adding && num(p.pnlIls) < 0 && !order.allowAddToLoser) fail('averagingDown', `הגדלת פוזיציה מפסידה ב-${order.symbol} (${num(p.pnlIls).toFixed(0)} ₪) אסורה`); else pass('averagingDown');
  }

  return { allowed: reasons.length === 0, reducing, clientOrderId: id, notionalIls: Math.round(notional), reasons, checks, policyVersion: policy.version, mode: policy.mode };
}
