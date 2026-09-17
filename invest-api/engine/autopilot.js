// אוטומט לחשבון התרגול: כללים גלויים ודטרמיניסטיים. שום LLM לא מחליט כאן.
// הקלט: טבלת הדירוג של היום, משטר השוק, מצב החשבון. הפלט: רשימת פקודות עם הסבר בעברית לכל אחת.
import { isNum, round } from './util.js';
import { PROFILES } from './portfolio.js';
import { RISK_LIMITS } from './risk-limits.js';

export const AUTO_RULES = {
  version: 8,               // שינוי כללים מאפשר הערכה מחדש באותו יום (פעם אחת לכל גרסה)
  maxConcentration: 1.5,    // פוזיציה גדולה מפי 1.5 מהיעד לנייר → מוכרים את העודף עד היעד
  // עצירת הפסד לפי תנודתיות: stop = clamp(vol1y × 0.5, 8%, 20%); בשוק דובי × 0.75. גודל פוזיציה = תקציב סיכון ÷ stop
  riskBudget: 0.005,        // כל פוזיציה מסכנת לכל היותר 0.5% מהתיק (1,000 ₪ ב-200,000)
  stopMin: 0.08, stopMax: 0.20, stopVolFactor: 0.5, stopBearFactor: 0.75,
  tranches: 3,              // קונים בשלבים: שליש מהיעד בכל ריצה
  maxBuysPerRun: 3,         // לא יותר מ-3 קניות ביום
  minOrderIls: 1500,        // לא קונים בסכומים זעירים (עמלה יחסית גבוהה)
  earningsBlackoutDays: 5,  // לא קונים 5 ימים לפני דוח
  buyTargetFactor: { 'STRONG BUY': 1, BUY: 0.7 }, // יעד משקל: מלא לקנייה חזקה, 70% לקנייה
  // איכות יחסית בנוסף למוחלטת: קנייה רק אם הציון גם ב-30% העליונים של המניות שנותחו היום; קנייה חזקה — 15%
  buyTopPct: 0.30, strongTopPct: 0.15,
  requireEarningsDate: false, // חשבון תרגול: אין תאריך דוח → מותר. כסף אמיתי: RISK_LIMITS.requireEarningsDateLive
  // ביטחון בנתונים: קנייה רק עם כיסוי נתונים ≥ 85% וכשרכיבי הליבה של הציון קיימים (ציון "יפה" על 70% מידע אינו ציון)
  minCoverage: 0.85, requiredComponents: ['fundamental', 'valuation', 'growth', 'momentum'],
  minEligibleUniverse: 100,   // פחות מ-100 מניות עם נתונים מלאים היום (תקלת ספק) → אין קניות של מניות בודדות
  maxChasePct: 0.10,          // שלב נוסף רק אם המחיר לא ברח יותר מ-10% מעל מחיר הכניסה הממוצע
};
// עצירת הפסד לנייר לפי התנודתיות השנתית שלו (אין vol → ברירת מחדל 12%)
export function stopPctFor(r, rules = AUTO_RULES, bear = false){
  const v = isNum(r?.vol1y) ? r.vol1y : 0.24;
  const s = Math.min(rules.stopMax, Math.max(rules.stopMin, v * rules.stopVolFactor));
  return round(bear ? s * rules.stopBearFactor : s, 4);
}
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
export function decideOrders({ table = [], regime = null, perf, profile = 'balanced', fx = 3.7, today = null, buysToday = 0, boughtToday = [], rules = AUTO_RULES } = {}){
  const P = PROFILES[profile] || PROFILES.balanced;
  const notes = [], orders = [], skipped = [];
  const by = new Map(table.map((r) => [r.symbol, r]));
  const total = perf?.totalIls || 0, cash = perf?.cashIls || 0;
  const positions = perf?.positions || [];
  const bear = regime?.trend === 'Bear Trend', riskOff = regime?.risk === 'Risk Off';
  const rateOf = (r) => (r.currency === 'ILS' ? 1 : fx);

  // ליבה: sleeve → סימבול זמין היום
  const coreSym = {}; for (const [sl, list] of Object.entries(CORE_PICKS)){ if ((P.sleeves[sl] || 0) > 0){ const pick = list.find((sym) => { const r = by.get(sym); return r && isNum(r.price) && r.price > 0; }); if (pick) coreSym[sl] = pick; } }
  const coreOf = (sym) => Object.keys(coreSym).find((sl) => coreSym[sl] === sym) || null;
  const coreTarget = (sl) => (P.sleeves[sl] || 0) * total; // הליבה היא ליבה: לא משתנה לפי מצב השוק

  // ---- מכירות (קודם: משחררות מזומן) ----
  for (const p of positions){
    const r = by.get(p.symbol);
    if (!r){ notes.push(`${p.symbol}: אין נתוני דירוג היום — מחזיקים`); continue; }
    const sig = r.signal;
    const sl = coreOf(p.symbol);
    if (sl) continue; // ליבה: לא נמכרת לפי סיגנל, עצירת הפסד או מצב שוק
    const stop = stopPctFor(r, rules, bear);
    if (isNum(p.pnlPct) && p.pnlPct <= -stop){ orders.push({ side: 'sell', symbol: p.symbol, qty: p.qty, priceRef: r.price, currency: r.currency, rule: 'stop', reason: `עצירת הפסד: ירדה ${Math.round(-p.pnlPct * 100)}% מהקנייה (הגבול לנייר הזה ${Math.round(stop * 100)}%, לפי תנודתיות ${Math.round((r.vol1y || 0.24) * 100)}%)` }); continue; }
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
  if (bear) notes.push('שוק דובי: לא קונים מניות בודדות היום, עצירות הפסד הדוקות ב-25%. הליבה נשארת.');
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
  // ---- תקציב הלוויין: אם המניות הבודדות עברו את ה-sleeve ב-10%+, מוכרים את אלה בלי סיגנל קנייה (החלשה קודם) עד שחוזרים לתקציב ----
  {
    const isCoreSym = (sym) => { const r = by.get(sym); return !r || !!coreOf(sym) || r.assetClass === 'bond' || r.assetClass === 'gold' || r.role === 'core'; };
    const budget = (P.sleeves.stocks || 0) * total;
    let sat = 0; for (const [sym, v] of heldIls) if (!isCoreSym(sym)) sat += v;
    if (budget > 0 && sat > budget * 1.1){
      const weak = positions.filter((p) => !isCoreSym(p.symbol) && !sold.has(p.symbol) && (heldIls.get(p.symbol) || 0) > 0 && !['STRONG BUY', 'BUY'].includes(by.get(p.symbol)?.signal)).sort((a, b) => (by.get(a.symbol)?.score ?? 0) - (by.get(b.symbol)?.score ?? 0));
      for (const p of weak){
        if (sat <= budget) break;
        const r = by.get(p.symbol); if (!isNum(r.price) || r.price <= 0) continue;
        const unit = r.price * rateOf(r), val = heldIls.get(p.symbol) || 0;
        const q = Math.min(p.qty, Math.ceil(Math.min(val, sat - budget) / unit)); if (q < 1) continue;
        orders.push({ side: 'sell', symbol: p.symbol, qty: q, priceRef: r.price, currency: r.currency, rule: 'sleeve', reason: `המניות הבודדות תופסות ${Math.round(sat / total * 100)}% מהתיק (התקציב ${Math.round(budget / total * 100)}%) — מוכרים את החלשה שאין לה סיגנל קנייה (${SIG_HE[r.signal] || r.signal}, ציון ${r.score})` });
        const ils = q * unit; sat -= ils; free += ils; heldIls.set(p.symbol, Math.max(0, val - ils)); sold.add(p.symbol); if (q >= p.qty) count--;
      }
    }
  }
  // ---- ליבה: קנייה בשלבים עד היעד, בלי קשר לסיגנל (בשוק דובי ליבת המניות לא נקנית) ----
  for (const sl of Object.keys(coreSym)){
    const sym = coreSym[sl], r = by.get(sym);
    const target = coreTarget(sl), cur = heldIls.get(sym) || 0;
    if (cur >= target * 0.9) continue;
    if (boughtToday.includes(sym)){ skipped.push({ symbol: sym, reason: 'שלב ליבה כבר נקנה היום — השלב הבא מחר' }); continue; }
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
  const stocksBudget = Math.min((P.sleeves.stocks || 0), RISK_LIMITS.maxActiveShare) * total;
  let satIls = 0; for (const [sym, v] of heldIls){ const r = by.get(sym); if (r && !isCore(r)) satIls += v; }
  // דירוג יחסי: אחוזון הציון בין המניות (לא ליבה) שנותחו היום
  const scored = table.filter((r) => !isCore(r) && isNum(r.score)).map((r) => r.score).sort((a, b) => b - a);
  const topCut = (pct) => (scored.length ? scored[Math.max(0, Math.ceil(scored.length * pct) - 1)] : -Infinity);
  const cutBuy = topCut(rules.buyTopPct), cutStrong = topCut(rules.strongTopPct);
  const relOk = (r) => scored.length < 20 || (r.signal === 'STRONG BUY' ? r.score >= cutStrong : r.score >= cutBuy); // יקום קטן מ-20 → אין משמעות לדירוג יחסי
  // יקום כשיר מינימלי: כמה מניות עברו היום עם נתונים מלאים (כיסוי ≥ 85%)
  const eligible = table.filter((r) => !isCore(r) && isNum(r.score) && (!isNum(r.coverage) || r.coverage >= rules.minCoverage)).length;
  const nonCoreN = table.filter((r) => !isCore(r) && isNum(r.score)).length;
  const needEligible = Math.min(rules.minEligibleUniverse, Math.floor(nonCoreN * 0.75)); // ביקום מלא: 100; ביקום קטן: 75% מהמניות שנותחו
  const universeOk = eligible >= needEligible;
  if (!universeOk) notes.push(`רק ${eligible} מניות עם נתונים מלאים היום (המינימום ${needEligible}) — אין קניות של מניות בודדות, כנראה תקלת נתונים`);
  const dataOk = (r) => (!isNum(r.coverage) || r.coverage >= rules.minCoverage) && !(r.missingComponents || []).some((k) => rules.requiredComponents.includes(k));
  const cands0 = (bear || !universeOk) ? [] : table.filter((r) => !isCore(r) && ['STRONG BUY', 'BUY'].includes(r.signal) && isNum(r.price) && r.price > 0 && (r.score ?? 0) >= P.minScore && (!riskOff || r.signal === 'STRONG BUY'));
  for (const r of cands0.filter((r) => !dataOk(r))) skipped.push({ symbol: r.symbol, reason: isNum(r.coverage) && r.coverage < rules.minCoverage ? `כיסוי נתונים ${Math.round(r.coverage * 100)}% < ${Math.round(rules.minCoverage * 100)}% — הציון לא מספיק מבוסס` : `חסר רכיב ליבה בציון (${(r.missingComponents || []).filter((k) => rules.requiredComponents.includes(k)).join(', ')})` });
  for (const r of cands0) if (dataOk(r) && !relOk(r)) skipped.push({ symbol: r.symbol, reason: `ציון ${r.score} לא ב-${Math.round((r.signal === 'STRONG BUY' ? rules.strongTopPct : rules.buyTopPct) * 100)}% העליונים היום (סף ${r.signal === 'STRONG BUY' ? cutStrong : cutBuy})` });
  const cands = cands0.filter((r) => dataOk(r) && relOk(r)).sort((a, b) => (a.signal === b.signal ? b.score - a.score : a.signal === 'STRONG BUY' ? -1 : 1));
  // סיכון פתוח: שווי × מרחק לעצירה, על כל המניות הבודדות ולפי ענף (מגבלות קשיחות מ-RISK_LIMITS)
  let openRisk = 0; const sectorRisk = {};
  for (const [sym, v] of heldIls){ const r = by.get(sym); if (!r || isCore(r) || v <= 0) continue; const rk = v * stopPctFor(r, rules, bear); openRisk += rk; const sec = r.sector || 'אחר'; sectorRisk[sec] = (sectorRisk[sec] || 0) + rk; }
  let buys = Math.max(0, buysToday | 0); // מכסה יומית כוללת ריצות קודמות היום
  for (const r of cands){
    if (satIls >= stocksBudget * 0.98){ skipped.push({ symbol: r.symbol, reason: `תקציב המניות הבודדות (${Math.round((P.sleeves.stocks || 0) * 100)}% מהתיק) מלא` }); continue; }
    if (buys >= rules.maxBuysPerRun){ skipped.push({ symbol: r.symbol, reason: `מכסת ${rules.maxBuysPerRun} קניות ליום` }); continue; }
    if (sold.has(r.symbol)) continue;
    const dE = daysUntil(today, r.nextEarnings);
    if (isNum(dE) && dE >= 0 && dE <= rules.earningsBlackoutDays){ skipped.push({ symbol: r.symbol, reason: `דוח בעוד ${dE} ימים — מחכים` }); continue; }
    if (rules.requireEarningsDate && !r.nextEarnings){ skipped.push({ symbol: r.symbol, reason: 'אין תאריך דוח ידוע — לא פותחים פוזיציה (fail-closed)' }); continue; }
    if (isNum(r.vol1y) && r.vol1y > P.maxVol){ skipped.push({ symbol: r.symbol, reason: `תנודתית מדי לפרופיל (${Math.round(r.vol1y * 100)}%)` }); continue; }
    const maxPos = Math.min(r.type === 'etf' ? P.maxEtfPosition : P.maxPosition, RISK_LIMITS.maxPositionShare) * total;
    const stopPct = stopPctFor(r, rules, bear);
    const riskCap = (rules.riskBudget * total) / stopPct; // גודל שבו הפסד עד העצירה = תקציב הסיכון
    const target = Math.min(maxPos, riskCap) * (rules.buyTargetFactor[r.signal] || 0.7) * (riskOff ? 0.5 : 1);
    const cur = heldIls.get(r.symbol) || 0;
    if (cur >= target * 0.9){ skipped.push({ symbol: r.symbol, reason: 'כבר בגודל היעד' }); continue; }
    const held = positions.find((p) => p.symbol === r.symbol);
    if (cur > 0 && held && isNum(held.avgPrice) && held.avgPrice > 0 && r.price > held.avgPrice * (1 + rules.maxChasePct)){ skipped.push({ symbol: r.symbol, reason: `המחיר עלה ${Math.round((r.price / held.avgPrice - 1) * 100)}% מעל מחיר הכניסה — לא רודפים אחרי שלב נוסף` }); continue; }
    if (!cur && count >= maxCount){ skipped.push({ symbol: r.symbol, reason: `כבר ${count} פוזיציות (המקסימום ${maxCount})` }); continue; }
    const sec = r.sector || 'אחר';
    if (r.type !== 'etf' && (sectorIls[sec] || 0) >= P.maxSector * total){ skipped.push({ symbol: r.symbol, reason: `ענף ${sec} כבר במשקל המרבי` }); continue; }
    let ils = Math.min(target - cur, target / rules.tranches, free, stocksBudget - satIls);
    if (ils < rules.minOrderIls){ skipped.push({ symbol: r.symbol, reason: free < rules.minOrderIls ? 'אין מספיק מזומן פנוי (שומרים רזרבה)' : stocksBudget - satIls < rules.minOrderIls ? 'תקציב המניות הבודדות כמעט מלא' : 'הסכום שנותר עד היעד קטן מדי' }); continue; }
    // מגבלת סיכון פתוח כולל ולענף: מקטינים את השלב כך שלא נחרוג, ואם לא נשאר כלום — דוחים
    const secR = r.sector || 'אחר';
    const roomTotal = RISK_LIMITS.maxOpenRisk * total - openRisk, roomSector = RISK_LIMITS.maxSectorOpenRisk * total - (sectorRisk[secR] || 0);
    const roomIls = Math.min(roomTotal, roomSector) / stopPct;
    if (roomIls < rules.minOrderIls){ skipped.push({ symbol: r.symbol, reason: roomTotal <= roomSector ? `סיכון פתוח כולל כבר ${round(openRisk / total * 100, 1)}% (הגבול ${RISK_LIMITS.maxOpenRisk * 100}%)` : `סיכון פתוח בענף ${secR} כבר ${round((sectorRisk[secR] || 0) / total * 100, 1)}% (הגבול ${RISK_LIMITS.maxSectorOpenRisk * 100}%)` }); continue; }
    ils = Math.min(ils, roomIls);
    const unit = r.price * rateOf(r);
    const qty = Math.floor(ils / unit);
    if (qty < 1){ skipped.push({ symbol: r.symbol, reason: target - cur < unit ? 'קרוב ליעד: נותר פחות ממחיר יחידה אחת' : 'יחידה אחת יקרה מהתקציב לשלב' }); continue; }
    const est = round(qty * unit, 0);
    openRisk += est * stopPct; sectorRisk[secR] = (sectorRisk[secR] || 0) + est * stopPct;
    orders.push({ side: 'buy', symbol: r.symbol, qty, priceRef: r.price, currency: r.currency, estIls: est, rule: cur ? 'add' : 'open', reason: `${SIG_HE[r.signal]} · ציון ${r.score}${whyHe(r) ? ' · ' + whyHe(r) : ''} · ${cur ? 'שלב נוסף' : 'שלב ראשון'} מתוך ${rules.tranches} (יעד ${round(target / total * 100, 1)}% מהתיק, עצירה ${Math.round(stopPct * 100)}%)` });
    free -= est; buys++; satIls += est; if (!cur) count++; if (r.type !== 'etf') sectorIls[sec] = (sectorIls[sec] || 0) + est; heldIls.set(r.symbol, cur + est);
  }
  if (!orders.length && !notes.length) notes.push(cands.length ? 'כל המועמדים כבר בגודל היעד או נדחו לפי הכללים' : 'אין היום סיגנלי קנייה שעומדים בכללים');
  return { orders, skipped, notes, rules: { ...rules, profile, reserveIls: round(reserve, 0), limits: RISK_LIMITS, openRiskPct: total ? round(openRisk / total, 4) : 0 } };
}
