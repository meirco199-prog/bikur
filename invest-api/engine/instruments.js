// יקום המכשירים של הסוכן האוטונומי (סימולציית IBKR): כל סוגי הנכסים שאפשר לתמחר בנתונים הזמינים — מניות, ETF (כולל ממונפים
// והפוכים), סחורות דרך ETF/ETC, אג"ח, קריפטו (ספוט), מט"ח, וחוזים עתידיים סינתטיים (חוזה = N יחידות של ETF מייצג, עם margin
// ועמלות של חוזי micro ב-IBKR). כל מכשיר נושא את פרמטרי ה-margin, העמלות, שעות המסחר וסימבול הספק.
// זו סימולציה: הפרמטרים מקורבים למחירון IBKR Pro (ספטמבר 2026) ולא מחליפים את מפת היכולות של החשבון האמיתי (C2).

// margin (שיעור מהחשיפה): initial לפתיחה, maint לתחזוקה; shortMaint = תחזוקה לשורט. Reg T למניות/ETF; ETF ממונף ×מינוף
const STOCK = { initial: 0.5, maint: 0.25, shortInitial: 0.5, shortMaint: 0.3 };
const CRYPTO = { initial: 1, maint: 1, shortInitial: null, shortMaint: null };         // אין margin ואין שורט בקריפטו ספוט ב-IBKR
const FX = { initial: 0.05, maint: 0.03, shortInitial: 0.05, shortMaint: 0.03 };      // ~20:1 (IBKR: 2.5%–5% לפי צמד)
const FUT = { initial: 0.08, maint: 0.065, shortInitial: 0.08, shortMaint: 0.065 };  // חוזי micro על מדדים/סחורות

const etf = (symbol, name, nameHe, sector, extra = {}) => ({ symbol, name, nameHe, class: 'etf', sector, currency: 'USD', exchange: 'ARCA', session: 'us', settle: 'trade', units: 1, leverage: 1, margin: STOCK, shortable: true, borrowFee: 0.005, twelvedata: symbol, ...extra });
const lev = (symbol, name, nameHe, sector, leverage, extra = {}) => etf(symbol, name, nameHe, sector, { leverage, margin: { initial: Math.min(1, 0.5 * Math.abs(leverage)), maint: Math.min(1, 0.25 * Math.abs(leverage)), shortInitial: Math.min(1, 0.5 * Math.abs(leverage)), shortMaint: Math.min(1, 0.3 * Math.abs(leverage)) }, borrowFee: 0.03, ...extra });
const crypto = (symbol, name, nameHe, td) => ({ symbol, name, nameHe, class: 'crypto', sector: 'crypto', currency: 'USD', exchange: 'PAXOS', session: '24x7', settle: 'trade', units: 1, leverage: 1, margin: CRYPTO, shortable: false, borrowFee: 0, twelvedata: td, providersOnly: ['twelvedata'] });
const fx = (symbol, name, nameHe, td) => ({ symbol, name, nameHe, class: 'fx', sector: 'fx', currency: 'USD', exchange: 'IDEALPRO', session: '24x5', settle: 'trade', units: 1, leverage: 1, margin: FX, shortable: true, borrowFee: 0, twelvedata: td, providersOnly: ['twelvedata'] });
// חוזה סינתטי: מחיר = מחיר ה-ETF המייצג; חוזה אחד = units יחידות; P&L מסולק יומית למזומן (variation margin) כמו חוזה אמיתי
const fut = (symbol, name, nameHe, sector, proxy, units) => ({ symbol, name, nameHe, class: 'future', sector, currency: 'USD', exchange: 'CME', session: '23h', settle: 'daily', units, leverage: 1, margin: FUT, shortable: true, borrowFee: 0, proxy, synthetic: true });

export const AGENT_INSTRUMENTS = Object.freeze([
  // מדדים
  etf('SPY', 'S&P 500', 'S&P 500', 'index'), etf('QQQ', 'Nasdaq 100', 'נאסד"ק 100', 'index'), etf('IWM', 'Russell 2000', 'ראסל 2000', 'index'),
  etf('EFA', 'Developed ex-US', 'מפותחות מחוץ לארה"ב', 'index'), etf('EEM', 'Emerging markets', 'שווקים מתעוררים', 'index'), etf('EWJ', 'Japan', 'יפן', 'index'),
  // ממונפים והפוכים (מינוף יומי — שחיקה בהחזקה ארוכה)
  lev('TQQQ', 'Nasdaq 100 3x', 'נאסד"ק 100 פי 3', 'index', 3), lev('SQQQ', 'Nasdaq 100 -3x', 'נאסד"ק 100 הפוך פי 3', 'index', -3),
  lev('UPRO', 'S&P 500 3x', 'S&P 500 פי 3', 'index', 3), lev('SPXU', 'S&P 500 -3x', 'S&P 500 הפוך פי 3', 'index', -3),
  lev('SOXL', 'Semiconductors 3x', 'שבבים פי 3', 'tech', 3), lev('SOXS', 'Semiconductors -3x', 'שבבים הפוך פי 3', 'tech', -3),
  lev('UVXY', 'VIX short-term 1.5x', 'VIX פי 1.5', 'volatility', 1.5), lev('SVXY', 'VIX short-term -0.5x', 'VIX הפוך 0.5', 'volatility', -0.5),
  // סקטורים ונושאים
  etf('XLE', 'Energy', 'אנרגיה', 'energy'), etf('XLF', 'Financials', 'פיננסים', 'financials'), etf('XLK', 'Technology', 'טכנולוגיה', 'tech'), etf('XLV', 'Health care', 'בריאות', 'health'),
  etf('XBI', 'Biotech', 'ביוטק', 'health'), etf('ARKK', 'ARK Innovation', 'ARK חדשנות', 'tech'), etf('SMH', 'Semiconductors', 'שבבים', 'tech'), etf('URA', 'Uranium', 'אורניום', 'energy'), etf('COPX', 'Copper miners', 'כורי נחושת', 'materials'),
  // סחורות (ETF/ETC)
  etf('GLD', 'Gold', 'זהב', 'metals'), etf('SLV', 'Silver', 'כסף', 'metals'), etf('PPLT', 'Platinum', 'פלטינה', 'metals'), etf('CPER', 'Copper', 'נחושת', 'metals'), etf('DBB', 'Base metals', 'מתכות תעשייתיות', 'metals'),
  etf('USO', 'WTI crude oil', 'נפט WTI', 'energy'), etf('BNO', 'Brent crude oil', 'נפט ברנט', 'energy'), etf('UNG', 'Natural gas', 'גז טבעי', 'energy'),
  etf('DBA', 'Agriculture', 'חקלאות', 'agri'), etf('CORN', 'Corn', 'תירס', 'agri'), etf('WEAT', 'Wheat', 'חיטה', 'agri'), etf('SOYB', 'Soybeans', 'סויה', 'agri'), etf('CANE', 'Sugar', 'סוכר', 'agri'),
  // אג"ח וריבית
  etf('TLT', 'US Treasuries 20y+', 'אג"ח ארה"ב 20+', 'bonds'), etf('IEF', 'US Treasuries 7-10y', 'אג"ח ארה"ב 7-10', 'bonds'), etf('SHY', 'US Treasuries 1-3y', 'אג"ח ארה"ב 1-3', 'bonds'),
  etf('HYG', 'High yield', 'אג"ח זבל', 'bonds'), etf('LQD', 'Investment grade', 'אג"ח קונצרני', 'bonds'), etf('TIP', 'TIPS', 'אג"ח צמוד', 'bonds'),
  // קריפטו: ספוט (Twelve Data) + ETF
  crypto('BTC-USD', 'Bitcoin', 'ביטקוין', 'BTC/USD'), crypto('ETH-USD', 'Ethereum', 'את\'ריום', 'ETH/USD'), crypto('SOL-USD', 'Solana', 'סולאנה', 'SOL/USD'),
  etf('IBIT', 'Bitcoin ETF', 'ביטקוין ETF', 'crypto'), etf('ETHA', 'Ethereum ETF', 'את\'ריום ETF', 'crypto'),
  // מט"ח
  fx('EURUSD', 'EUR/USD', 'אירו/דולר', 'EUR/USD'), fx('GBPUSD', 'GBP/USD', 'פאונד/דולר', 'GBP/USD'), fx('USDJPY', 'USD/JPY', 'דולר/ין', 'USD/JPY'),
  fx('AUDUSD', 'AUD/USD', 'דולר אוסטרלי', 'AUD/USD'), fx('USDCHF', 'USD/CHF', 'דולר/פרנק', 'USD/CHF'), fx('USDILS', 'USD/ILS', 'דולר/שקל', 'USD/ILS'),
  // חוזים עתידיים סינתטיים (micro): חוזה = units × ETF מייצג
  fut('MES', 'Micro E-mini S&P 500', 'מיקרו S&P 500', 'index', 'SPY', 50), fut('MNQ', 'Micro E-mini Nasdaq 100', 'מיקרו נאסד"ק 100', 'index', 'QQQ', 40),
  fut('M2K', 'Micro Russell 2000', 'מיקרו ראסל 2000', 'index', 'IWM', 50), fut('MGC', 'Micro Gold', 'מיקרו זהב', 'metals', 'GLD', 100),
  fut('MCL', 'Micro WTI Crude', 'מיקרו נפט', 'energy', 'USO', 300), fut('MBT', 'Micro Bitcoin', 'מיקרו ביטקוין', 'crypto', 'BTC-USD', 0.1),
  fut('ZN~', '10-Year T-Note (proxy)', 'אג"ח 10 שנים', 'bonds', 'IEF', 100),
]);

export const instrumentOf = (symbol) => AGENT_INSTRUMENTS.find((i) => i.symbol === symbol) || null;
export const priceSymbolOf = (inst) => (inst?.proxy || inst?.symbol);   // הסימבול שממנו מגיעים המחירים
export const AGENT_CLASSES = Object.freeze(['stock', 'etf', 'crypto', 'fx', 'future']);

// עמלות IBKR Pro (מקורב, לצד אחד): מניות/ETF 0.005$/יחידה מינימום 1$ מקסימום 1% מהשווי; קריפטו 0.18% מינימום 1.75$;
// מט"ח 0.2 נקודות בסיס מינימום 2$; חוזי micro 0.85$ לחוזה (כולל עמלות בורסה מקורבות)
export function commissionUsd(inst, qty, price){
  const q = Math.abs(qty), notional = q * price * (inst?.units || 1);
  switch (inst?.class){
    case 'crypto': return Math.max(1.75, notional * 0.0018);
    case 'fx': return Math.max(2, notional * 0.00002);
    case 'future': return q * 0.85;
    default: return Math.min(Math.max(1, q * 0.005), notional * 0.01);
  }
}
// slippage מקורב לצד אחד (שוק נזיל, פקודת שוק בפתיחה): מניות/ETF 0.05%, ממונפים 0.1%, קריפטו 0.1%, מט"ח 0.01%, חוזים 0.02%
export function slippageRate(inst){
  if (!inst) return 0.0005;
  if (inst.class === 'crypto') return 0.001;
  if (inst.class === 'fx') return 0.0001;
  if (inst.class === 'future') return 0.0002;
  return Math.abs(inst.leverage || 1) > 1 ? 0.001 : 0.0005;
}
// ריבית margin שנתית של IBKR (benchmark + מרווח) — מקורב; borrow fee לשורט לפי המכשיר
export const MARGIN_RATES = Object.freeze({ benchmark: 0.0433, spread: 0.015 });
export const marginInterestAnnual = () => MARGIN_RATES.benchmark + MARGIN_RATES.spread;
