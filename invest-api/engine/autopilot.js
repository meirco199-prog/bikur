// אוטומט לחשבון התרגול: כללים גלויים ודטרמיניסטיים. שום LLM לא מחליט כאן.
// הקלט: טבלת הדירוג של היום, משטר השוק, מצב החשבון. הפלט: רשימת פקודות עם הסבר בעברית לכל אחת.
import { isNum, round } from './util.js';
import { PROFILES } from './portfolio.js';

export const AUTO_RULES = {
  version: 4,               // שינוי כללים מאפשר הערכה מחדש באותו יום (פעם אחת לכל גרסה)
  maxConcentration: 1.5,    // פוזיציה גדולה מפי 1.5 מהיעד לנייר → מוכרים את העודף עד היעד
  stopLoss: 0.12,           // עצירת הפסד: מוכרים הכל אם הפוזיציה ירדה 12% מהקנייה (8% בשוק דובי)
  stopLossBear: 0.08,
  tranches: 3,              // קונים בשלבים: שליש מהיעד בכל ריצה
  maxBuysPerRun: 3,         // לא יותר מ-3 קניות ביום
  minOrderIls: 1500,        // לא קונים בסכומים זעירים (עמלה יחסית גבוהה)
  earningsBlackoutDays: 5,  // לא קונים 5 ימים לפני דוח
  buyTargetFactor: { 'STRONG BUY': 1, BUY: 0.7 }, // יעד משקל: מלא לקנייה חזקה, 70% לקנייה
  bearCoreFactor: 0.5,      // שוק דובי: ליבת המניות יורדת לחצי מהיעד
};
// ליבה אסטרטגית (לפי sleeves של הפרופיל), נקנית בשלבים בלי קשר לסיגנלים: הראשון ברשימה שיש לו נתונים היום
export const CORE_PICKS = { coreEquity: ['VTI', 'SPY', 'VOO'], bonds: ['BND', 'AGG', 'IEF'], gold: ['GLD', 'IAU'] };
const CORE_HE = { coreEquity: 'קרן מדד רחבה (כל שוק המניות האמריקאי)', bonds: 'קרן אג"ח', gold: 'זהב' };

const SIG_HE = { 'STRONG BUY': 'קנייה חזקה', BUY: 'קנייה', WATCH: 'במעקב', HOLD: 'החזקה', REDUCE: 'הקטנה', SELL: 'מכירה', 'NO SIGNAL': 'אין סיגנל' };

function whyHe(r){
  const c = r.components || {}; const good = [], bad = [];
  const say = (k, g, b) => { const v = c[k]; if (!isNum(v)) return; if (v >= 70) good.push(g); else if (v <= 40) bad.push(b); };
  say('fundamental', 'רווחית ויציבה', 'לא רווחית מספיק'); say('valuation', 'מחיר סביר', 'מחיר יקר'); say('growth', 'צומחת', 'לא צומחת'); say('technical', 'מגמה עולה', 'מגמה יורדת'); say('momentum', 'בתנופה', 'מאבדת תנופה'); say('risk', 'יציבה', 'תנודתית');
  return [...good.slice(0, 3), ...bad.slice(0, 2)].join(', ');
}
const daysUntil = (from, to) => { if (!from || !to) return null; return Math.round((Date.parse(to) - Date.parse(from)) / 86400000); };

/**
 * decideOrders — מחזיר { orders, skipped, notes, rules } בלי לבצע כלום.
 * table: שורות הדירוג (symbol, price, currency, signal, score, sector, type, riskLevel, vol1y, nextEarnings, components)
 * regime: { trend, risk }
 * perf: תוצאת PaperBroker.performance (positions, cashIls, totalIls)
 */
export function decideOrders({ table = [], regime = null, perf, profile = 'balanced', fx = 3.7, today = null, buysToday = 0, rules = AUTO_RULES } = {}){
  const P = PROFILES[profile] || PROFILES.balanced;
  const notes = [], orders = [], skipped = [];
  const by = new Map(table.map((r) => [r.symbol, r]));
  const total = perf?.totalIls || 0, cash = perf?.cashIls || 0;
  const positions = perf?.positions || [];
  const bear = regime?.trend === 'Bear Trend', riskOff = regime?.risk === 'Risk Off';
  const rateOf = (r) => (r.currency === 'ILS' ? 1 : fx);
  const stop = bear ? rules.stopLossBear : rules.stopLoss;

  // ליבה: sleeve → סימבול זמין היום
  const coreSym = {}; for (const [sl, list] of Object.entries(CORE_PICKS)){ if ((P.sleeves[sl] || 0) > 0){ const pick = list.find((sym) => { const r = by.get(sym); return r && isNum(r.price) && r.price > 0; }); if (pick) coreSym[sl] = pick; } }
  const coreOf = (sym) => Object.keys(coreSym).find((sl) => coreSym[sl] === sym) || null;
  const coreTarget = (sl) => (P.sleeves[sl] || 0) * total * (sl === 'coreEquity' && bear ? rules.bearCoreFactor : 1);

  // ---- מכירות (קודם: משחררות מזומן) ----
  for (const p of positions){
    const r = by.get(p.symbol);
    if (!r){ notes.push(`${p.symbol}: אין נתוני דירוג היום — מחזיקים`); continue; }
    const sig = r.signal;
    const sl = coreOf(p.symbol);
    if (sl){ // ליבה: לא נמכרת לפי סיגנל; בשוק דובי ליבת המניות מוקטנת לחצי
      const t = coreTarget(sl); const val = p.valueIls ?? p.costIls ?? 0;
      if (bear && sl === 'coreEquity' && val > t * 1.1 && isNum(r.price) && r.price > 0){ const q = Math.min(p.qty - 1, Math.ceil((val - t) / (r.price * rateOf(r)))); if (q >= 1) orders.push({ side: 'sell', symbol: p.symbol, qty: q, priceRef: r.price, currency: r.currency, rule: 'bear-core', reason: `שוק דובי: מקטינים את ליבת המניות לחצי מהיעד (${Math.round(t / total * 100)}% מהתיק)` }); }
      continue;
    }
    if (isNum(p.pnlPct) && p.pnlPct <= -stop){ orders.push({ side: 'sell', symbol: p.symbol, qty: p.qty, priceRef: r.price, currency: r.currency, rule: 'stop', reason: `עצירת הפסד: ירדה ${Math.round(-p.pnlPct * 100)}% מהקנייה (הגבול ${Math.round(stop * 100)}%)` }); continue; }
    if (sig === 'SELL'){ orders.push({ side: 'sell', symbol: p.symbol, qty: p.qty, priceRef: r.price, currency: r.currency, rule: 'signal', reason: `הסיגנל הפך ל"מכירה" (ציון ${r.score}${whyHe(r) ? ': ' + whyHe(r) : ''})` }); continue; }
    if (sig === 'REDUCE' && p.qty >= 2){ orders.push({ side: 'sell', symbol: p.symbol, qty: Math.ceil(p.qty / 2), priceRef: r.price, currency: r.currency, rule: 'reduce', reason: `הסיגנל הפך ל"הקטנה" — מוכרים חצי (ציון ${r.score})` }); continue; }
    // ריכוז: פוזיציה אחת גדולה מדי ביחס לתיק (למשל קניות ידניות) — מקטינים ליעד, גם אם הסיגנל טוב
    const cap = (r.type === 'etf' ? P.maxEtfPosition : P.maxPosition) * total;
    const val = p.valueIls ?? p.costIls ?? 0;
    if (total > 0 && val > cap * rules.maxConcentration && isNum(r.price) && r.price > 0){
      const unit = r.price * rateOf(r);
      const sellQty = Math.min(p.qty - 1, Math.ceil((val - cap) / unit));
      if (sellQty >= 1) orders.push({ side: 'sell', symbol: p.symbol, qty: sellQty, priceRef: r.price, currency: r.currency, rule: 'trim', reason: `ריכוז גבוה: ${Math.round(val / total * 100)}% מהתיק בנייר אחד (הגבול ${Math.round(cap / total * 100)}%) — מוכרים את העודף כדי לפזר` });
    }
  }
  const sellProceeds = orders.reduce((s, o) => s + o.qty * o.priceRef * (o.currency === 'ILS' ? 1 : fx), 0);

  // ---- קניות ----
  if (bear) notes.push('שוק דובי: לא קונים מניות היום (רק אג"ח וזהב לליבה), עצירת הפסד הדוקה');
  if (riskOff) notes.push('המשקיעים מפחדים (Risk Off): קונים רק "קנייה חזקה" ובחצי מהגודל');
  const reserve = (P.sleeves.cash || 0.05) * total;
  let free = cash + sellProceeds - reserve;
  const sold = new Set(orders.map((o) => o.symbol));
  // משקלים אחרי המכירות של הריצה הזאת (לא לפניהן)
  const soldIls = {}; for (const o of orders) soldIls[o.symbol] = (soldIls[o.symbol] || 0) + o.qty * o.priceRef * (o.currency === 'ILS' ? 1 : fx);
  const heldIls = new Map(positions.map((p) => [p.symbol, Math.max(0, (p.valueIls ?? p.costIls ?? 0) - (soldIls[p.symbol] || 0))]));
  const sectorIls = {}; for (const p of positions){ const r = by.get(p.symbol); const sec = r?.sector || 'אחר'; sectorIls[sec] = (sectorIls[sec] || 0) + (heldIls.get(p.symbol) || 0); }
  let count = positions.filter((p) => (heldIls.get(p.symbol) || 0) > 0 && !coreOf(p.symbol)).length;
  const maxCount = P.maxStocks + 2;
  // ---- ליבה: קנייה בשלבים עד היעד, בלי קשר לסיגנל (בשוק דובי ליבת המניות לא נקנית) ----
  for (const sl of Object.keys(coreSym)){
    const sym = coreSym[sl], r = by.get(sym);
    const target = coreTarget(sl), cur = heldIls.get(sym) || 0;
    if (bear && sl === 'coreEquity') continue;
    if (cur >= target * 0.9) continue;
    const step = target / rules.tranches;
    let ils = Math.min(target - cur, step, free);
    if (ils < rules.minOrderIls){ skipped.push({ symbol: sym, reason: free < rules.minOrderIls ? 'אין מספיק מזומן פנוי (שומרים רזרבה)' : 'הסכום שנותר עד היעד קטן מדי' }); continue; }
    const unit = r.price * rateOf(r); const qty = Math.floor(ils / unit);
    if (qty < 1){ skipped.push({ symbol: sym, reason: 'יחידה אחת יקרה מהתקציב לשלב' }); continue; }
    const est = round(qty * unit, 0); const stage = Math.min(rules.tranches, Math.floor(cur / step) + 1);
    orders.push({ side: 'buy', symbol: sym, qty, priceRef: r.price, currency: r.currency, estIls: est, rule: 'core', reason: `ליבה: ${CORE_HE[sl]} · יעד ${Math.round(target / total * 100)}% מהתיק · שלב ${stage} מתוך ${rules.tranches}` });
    free -= est; heldIls.set(sym, cur + est);
  }
  // ---- לוויין: מניות בודדות (וקרנות ענפיות) עם סיגנל קנייה, בתוך תקציב ה-sleeve ----
  const isCore = (r) => !!coreOf(r.symbol) || r.assetClass === 'bond' || r.assetClass === 'gold' || r.role === 'core';
  const stocksBudget = (P.sleeves.stocks || 0) * total;
  let satIls = 0; for (const [sym, v] of heldIls){ const r = by.get(sym); if (r && !isCore(r)) satIls += v; }
  const cands = bear ? [] : table.filter((r) => !isCore(r) && ['STRONG BUY', 'BUY'].includes(r.signal) && isNum(r.price) && r.price > 0 && (r.score ?? 0) >= P.minScore && (!riskOff || r.signal === 'STRONG BUY'))
    .sort((a, b) => (a.signal === b.signal ? b.score - a.score : a.signal === 'STRONG BUY' ? -1 : 1));
  let buys = Math.max(0, buysToday | 0); // מכסה יומית כוללת ריצות קודמות היום
  for (const r of cands){
    if (satIls >= stocksBudget * 0.98){ skipped.push({ symbol: r.symbol, reason: `תקציב המניות הבודדות (${Math.round((P.sleeves.stocks || 0) * 100)}% מהתיק) מלא` }); continue; }
    if (buys >= rules.maxBuysPerRun){ skipped.push({ symbol: r.symbol, reason: `מכסת ${rules.maxBuysPerRun} קניות ליום` }); continue; }
    if (sold.has(r.symbol)) continue;
    const dE = daysUntil(today, r.nextEarnings);
    if (isNum(dE) && dE >= 0 && dE <= rules.earningsBlackoutDays){ skipped.push({ symbol: r.symbol, reason: `דוח בעוד ${dE} ימים — מחכים` }); continue; }
    if (isNum(r.vol1y) && r.vol1y > P.maxVol){ skipped.push({ symbol: r.symbol, reason: `תנודתית מדי לפרופיל (${Math.round(r.vol1y * 100)}%)` }); continue; }
    const maxPos = (r.type === 'etf' ? P.maxEtfPosition : P.maxPosition) * total;
    const target = maxPos * (rules.buyTargetFactor[r.signal] || 0.7) * (riskOff ? 0.5 : 1);
    const cur = heldIls.get(r.symbol) || 0;
    if (cur >= target * 0.9){ skipped.push({ symbol: r.symbol, reason: 'כבר בגודל היעד' }); continue; }
    if (!cur && count >= maxCount){ skipped.push({ symbol: r.symbol, reason: `כבר ${count} פוזיציות (המקסימום ${maxCount})` }); continue; }
    const sec = r.sector || 'אחר';
    if (r.type !== 'etf' && (sectorIls[sec] || 0) >= P.maxSector * total){ skipped.push({ symbol: r.symbol, reason: `ענף ${sec} כבר במשקל המרבי` }); continue; }
    let ils = Math.min(target - cur, target / rules.tranches, free, stocksBudget - satIls);
    if (ils < rules.minOrderIls){ skipped.push({ symbol: r.symbol, reason: free < rules.minOrderIls ? 'אין מספיק מזומן פנוי (שומרים רזרבה)' : stocksBudget - satIls < rules.minOrderIls ? 'תקציב המניות הבודדות כמעט מלא' : 'הסכום שנותר עד היעד קטן מדי' }); continue; }
    const unit = r.price * rateOf(r);
    const qty = Math.floor(ils / unit);
    if (qty < 1){ skipped.push({ symbol: r.symbol, reason: target - cur < unit ? 'קרוב ליעד: נותר פחות ממחיר יחידה אחת' : 'יחידה אחת יקרה מהתקציב לשלב' }); continue; }
    const est = round(qty * unit, 0);
    orders.push({ side: 'buy', symbol: r.symbol, qty, priceRef: r.price, currency: r.currency, estIls: est, rule: cur ? 'add' : 'open', reason: `${SIG_HE[r.signal]} · ציון ${r.score}${whyHe(r) ? ' · ' + whyHe(r) : ''} · ${cur ? 'שלב נוסף' : 'שלב ראשון'} מתוך ${rules.tranches} (יעד ${Math.round(target / total * 100)}% מהתיק)` });
    free -= est; buys++; satIls += est; if (!cur) count++; if (r.type !== 'etf') sectorIls[sec] = (sectorIls[sec] || 0) + est; heldIls.set(r.symbol, cur + est);
  }
  if (!orders.length && !notes.length) notes.push(cands.length ? 'כל המועמדים כבר בגודל היעד או נדחו לפי הכללים' : 'אין היום סיגנלי קנייה שעומדים בכללים');
  return { orders, skipped, notes, rules: { ...rules, profile, stop, reserveIls: round(reserve, 0) } };
}
