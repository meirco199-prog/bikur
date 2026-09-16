// Universe זרעי: נכסים נזילים שנסרקים בכל cron. מורחב אוטומטית מ-FMP screener ומה-watchlist (meta:universe).
// שדות: symbol, name, type, assetClass, role, sector, country, currency, stooq (סימבול ב-Stooq), tags
const US = (symbol, name, sector, extra = {}) => ({ symbol, name, type: 'stock', assetClass: 'equity', role: 'satellite', sector, country: 'US', currency: 'USD', exchange: 'US', stooq: symbol.toLowerCase() + '.us', ...extra });
const ETF = (symbol, name, assetClass, role, extra = {}) => ({ symbol, name, type: 'etf', assetClass, role, sector: extra.sector || (assetClass === 'equity' ? 'רב-ענפי' : assetClass), country: extra.country || 'US', currency: 'USD', exchange: 'US', stooq: symbol.toLowerCase() + '.us', ...extra });

export const SEED_UNIVERSE = [
  // --- ליבה: ETF רחבים ---
  ETF('SPY', 'SPDR S&P 500', 'equity', 'core', { benchmark: true }), ETF('VOO', 'Vanguard S&P 500', 'equity', 'core'), ETF('QQQ', 'Invesco Nasdaq-100', 'equity', 'core', { sector: 'Technology' }),
  ETF('VTI', 'Vanguard Total US Market', 'equity', 'core'), ETF('IWM', 'iShares Russell 2000', 'equity', 'core'), ETF('VEA', 'Vanguard Developed ex-US', 'equity', 'core', { country: 'Intl' }),
  ETF('VWO', 'Vanguard Emerging Markets', 'equity', 'core', { country: 'EM' }), ETF('EIS', 'iShares MSCI Israel', 'equity', 'core', { country: 'IL' }), ETF('SCHD', 'Schwab US Dividend', 'equity', 'core', { tags: ['dividend'] }),
  ETF('VIG', 'Vanguard Dividend Appreciation', 'equity', 'core', { tags: ['dividend'] }), ETF('RSP', 'Invesco S&P 500 Equal Weight', 'equity', 'core'),
  // --- סקטורים ---
  ETF('XLK', 'Technology Select', 'equity', 'satellite', { sector: 'Technology' }), ETF('XLV', 'Health Care Select', 'equity', 'satellite', { sector: 'Healthcare' }), ETF('XLF', 'Financial Select', 'equity', 'satellite', { sector: 'Financial Services' }),
  ETF('XLE', 'Energy Select', 'equity', 'satellite', { sector: 'Energy' }), ETF('XLU', 'Utilities Select', 'equity', 'satellite', { sector: 'Utilities' }), ETF('XLP', 'Consumer Staples Select', 'equity', 'satellite', { sector: 'Consumer Defensive' }),
  ETF('XLI', 'Industrial Select', 'equity', 'satellite', { sector: 'Industrials' }), ETF('SMH', 'VanEck Semiconductor', 'equity', 'satellite', { sector: 'Technology' }), ETF('XLY', 'Consumer Discretionary Select', 'equity', 'satellite', { sector: 'Consumer Cyclical' }),
  // --- אג"ח / זהב / מזומן ---
  ETF('AGG', 'iShares Core US Aggregate Bond', 'bond', 'bond', { benchmark: true }), ETF('BND', 'Vanguard Total Bond', 'bond', 'bond'), ETF('IEF', 'iShares 7-10Y Treasury', 'bond', 'bond'), ETF('TLT', 'iShares 20+Y Treasury', 'bond', 'bond'),
  ETF('SHY', 'iShares 1-3Y Treasury', 'bond', 'bond'), ETF('TIP', 'iShares TIPS', 'bond', 'bond'), ETF('LQD', 'iShares IG Corporate', 'bond', 'bond'), ETF('HYG', 'iShares High Yield', 'bond', 'bond'),
  ETF('GLD', 'SPDR Gold', 'gold', 'gold'), ETF('IAU', 'iShares Gold', 'gold', 'gold'),
  // --- מניות ארה"ב (ליבת S&P) ---
  US('AAPL', 'Apple', 'Technology'), US('MSFT', 'Microsoft', 'Technology'), US('NVDA', 'NVIDIA', 'Technology'), US('AMZN', 'Amazon', 'Consumer Cyclical'), US('GOOGL', 'Alphabet', 'Communication Services'),
  US('META', 'Meta Platforms', 'Communication Services'), US('TSLA', 'Tesla', 'Consumer Cyclical'), US('BRK.B', 'Berkshire Hathaway', 'Financial Services', { stooq: 'brk-b.us' }), US('AVGO', 'Broadcom', 'Technology'), US('AMD', 'AMD', 'Technology'),
  US('JPM', 'JPMorgan Chase', 'Financial Services'), US('V', 'Visa', 'Financial Services'), US('MA', 'Mastercard', 'Financial Services'), US('UNH', 'UnitedHealth', 'Healthcare'), US('JNJ', 'Johnson & Johnson', 'Healthcare'),
  US('LLY', 'Eli Lilly', 'Healthcare'), US('ABBV', 'AbbVie', 'Healthcare'), US('MRK', 'Merck', 'Healthcare'), US('PFE', 'Pfizer', 'Healthcare'), US('XOM', 'Exxon Mobil', 'Energy'), US('CVX', 'Chevron', 'Energy'),
  US('PG', 'Procter & Gamble', 'Consumer Defensive'), US('KO', 'Coca-Cola', 'Consumer Defensive'), US('PEP', 'PepsiCo', 'Consumer Defensive'), US('COST', 'Costco', 'Consumer Defensive'), US('WMT', 'Walmart', 'Consumer Defensive'),
  US('HD', 'Home Depot', 'Consumer Cyclical'), US('MCD', "McDonald's", 'Consumer Cyclical'), US('NKE', 'Nike', 'Consumer Cyclical'), US('DIS', 'Disney', 'Communication Services'), US('NFLX', 'Netflix', 'Communication Services'),
  US('ORCL', 'Oracle', 'Technology'), US('CRM', 'Salesforce', 'Technology'), US('ADBE', 'Adobe', 'Technology'), US('CSCO', 'Cisco', 'Technology'), US('INTC', 'Intel', 'Technology'), US('QCOM', 'Qualcomm', 'Technology'),
  US('TXN', 'Texas Instruments', 'Technology'), US('IBM', 'IBM', 'Technology'), US('NOW', 'ServiceNow', 'Technology'), US('PLTR', 'Palantir', 'Technology'), US('UBER', 'Uber', 'Technology'),
  US('CAT', 'Caterpillar', 'Industrials'), US('DE', 'Deere', 'Industrials'), US('HON', 'Honeywell', 'Industrials'), US('GE', 'GE Aerospace', 'Industrials'), US('LMT', 'Lockheed Martin', 'Industrials'), US('RTX', 'RTX', 'Industrials'),
  US('BA', 'Boeing', 'Industrials'), US('UPS', 'UPS', 'Industrials'), US('LIN', 'Linde', 'Basic Materials'), US('NEE', 'NextEra Energy', 'Utilities'), US('SO', 'Southern Co', 'Utilities'),
  US('GS', 'Goldman Sachs', 'Financial Services'), US('BAC', 'Bank of America', 'Financial Services'), US('WFC', 'Wells Fargo', 'Financial Services'), US('AXP', 'American Express', 'Financial Services'), US('BLK', 'BlackRock', 'Financial Services'),
  US('T', 'AT&T', 'Communication Services'), US('VZ', 'Verizon', 'Communication Services'), US('TMO', 'Thermo Fisher', 'Healthcare'), US('ABT', 'Abbott', 'Healthcare'), US('AMGN', 'Amgen', 'Healthcare'), US('ISRG', 'Intuitive Surgical', 'Healthcare'),
  US('SBUX', 'Starbucks', 'Consumer Cyclical'), US('LOW', "Lowe's", 'Consumer Cyclical'), US('BKNG', 'Booking', 'Consumer Cyclical'), US('SHOP', 'Shopify', 'Technology', { country: 'CA' }), US('ASML', 'ASML', 'Technology', { country: 'NL' }), US('TSM', 'TSMC (ADR)', 'Technology', { country: 'TW' }),
  US('MU', 'Micron', 'Technology'), US('ARM', 'Arm Holdings', 'Technology', { country: 'UK' }), US('SNOW', 'Snowflake', 'Technology'), US('CRWD', 'CrowdStrike', 'Technology'), US('PANW', 'Palo Alto Networks', 'Technology'),
  // --- חברות ישראליות הנסחרות בארה"ב (חשיפה לישראל בלי TASE) ---
  US('TEVA', 'Teva (ADR)', 'Healthcare', { country: 'IL' }), US('CHKP', 'Check Point', 'Technology', { country: 'IL' }), US('NICE', 'NICE (ADR)', 'Technology', { country: 'IL' }), US('WIX', 'Wix.com', 'Technology', { country: 'IL' }),
  US('MNDY', 'monday.com', 'Technology', { country: 'IL' }), US('CYBR', 'CyberArk', 'Technology', { country: 'IL' }), US('ESLT', 'Elbit Systems', 'Industrials', { country: 'IL' }), US('TSEM', 'Tower Semiconductor', 'Technology', { country: 'IL' }),
  US('NVMI', 'Nova', 'Technology', { country: 'IL' }), US('CAMT', 'Camtek', 'Technology', { country: 'IL' }), US('GLBE', 'Global-E', 'Technology', { country: 'IL' }), US('ZIM', 'ZIM Shipping', 'Industrials', { country: 'IL' }),
  US('ICL', 'ICL Group', 'Basic Materials', { country: 'IL' }), US('ORA', 'Ormat Technologies', 'Utilities', { country: 'IL' }), US('SEDG', 'SolarEdge', 'Technology', { country: 'IL' }), US('INMD', 'InMode', 'Healthcare', { country: 'IL' }),
  US('FVRR', 'Fiverr', 'Technology', { country: 'IL' }), US('PLTK', 'Playtika', 'Communication Services', { country: 'IL' }), US('KRNT', 'Kornit Digital', 'Technology', { country: 'IL' }), US('SPNS', 'Sapiens', 'Technology', { country: 'IL' }),
  US('RDWR', 'Radware', 'Technology', { country: 'IL' }), US('ITRN', 'Ituran', 'Technology', { country: 'IL' }), US('CGNT', 'Cognyte', 'Technology', { country: 'IL' }), US('NNDM', 'Nano Dimension', 'Technology', { country: 'IL' }),
  US('OPRX', 'OptimizeRx', 'Healthcare'), US('GILT', 'Gilat Satellite', 'Technology', { country: 'IL' }), US('MGIC', 'Magic Software', 'Technology', { country: 'IL' }), US('URGN', 'UroGen Pharma', 'Healthcare', { country: 'IL' }),
];

// בורסת תל אביב — מחירים דרך ספק שתומך ב-XTAE (EODHD בתשלום, או Marketstack חינמי-מוגבל). ללא מפתח מתאים הנכסים מסומנים "אין מחירים".
const TA = (symbol, name, nameHe, sector, extra = {}) => ({ symbol: symbol + '.TA', name, nameHe, type: 'stock', assetClass: 'equity', role: 'satellite', sector, country: 'IL', currency: 'ILS', exchange: 'TASE', eodhd: symbol + '.TA', marketstack: symbol + '.XTAE', ...extra });
export const TASE_UNIVERSE = [
  TA('LUMI', 'Bank Leumi', 'בנק לאומי', 'Financial Services'), TA('POLI', 'Bank Hapoalim', 'בנק הפועלים', 'Financial Services'), TA('DSCT', 'Israel Discount Bank', 'בנק דיסקונט', 'Financial Services'), TA('MZTF', 'Mizrahi Tefahot', 'מזרחי טפחות', 'Financial Services'),
  TA('FIBI', 'First International Bank', 'הבינלאומי', 'Financial Services'), TA('TEVA', 'Teva', 'טבע', 'Healthcare'), TA('ICL', 'ICL', 'איי.סי.אל', 'Basic Materials'), TA('ESLT', 'Elbit Systems', 'אלביט מערכות', 'Industrials'),
  TA('NICE', 'NICE', 'נייס', 'Technology'), TA('TSEM', 'Tower Semiconductor', 'טאואר', 'Technology'), TA('NVMI', 'Nova', 'נובה', 'Technology'), TA('CAMT', 'Camtek', 'קמטק', 'Technology'),
  TA('BEZQ', 'Bezeq', 'בזק', 'Communication Services'), TA('AZRG', 'Azrieli Group', 'עזריאלי', 'Real Estate'), TA('MLSR', 'Melisron', 'מליסרון', 'Real Estate'), TA('DLEKG', 'Delek Group', 'קבוצת דלק', 'Energy'),
  TA('NWMD', 'NewMed Energy', 'ניומד אנרג\'י', 'Energy'), TA('PHOE', 'Phoenix', 'הפניקס', 'Financial Services'), TA('HARL', 'Harel', 'הראל', 'Financial Services'), TA('MMHD', 'Menora Mivtachim', 'מנורה מבטחים', 'Financial Services'),
  TA('STRS', 'Strauss', 'שטראוס', 'Consumer Defensive'), TA('SAE', 'Shufersal', 'שופרסל', 'Consumer Defensive'), TA('ELAL', 'El Al', 'אל על', 'Industrials'), TA('ORL', 'Bazan', 'בז\'ן', 'Energy'),
  TA('ENLT', 'Enlight Renewable', 'אנלייט', 'Utilities'), TA('SPEN', 'Shapir', 'שפיר', 'Industrials'), TA('AMOT', 'Amot Investments', 'אמות', 'Real Estate'), TA('ISCD', 'Isracard', 'ישראכרט', 'Financial Services'),
];
export const NAME_HE = { AAPL: 'אפל', MSFT: 'מיקרוסופט', NVDA: 'אנבידיה', AMZN: 'אמזון', GOOGL: 'גוגל (אלפבית)', META: 'מטא (פייסבוק)', TSLA: 'טסלה', 'BRK.B': 'ברקשייר האת\'וויי', AVGO: 'ברודקום', AMD: 'AMD', JPM: 'ג\'יי.פי מורגן', V: 'ויזה', MA: 'מאסטרקארד', UNH: 'יונייטד הלת\'', JNJ: 'ג\'ונסון אנד ג\'ונסון', LLY: 'אלי לילי', ABBV: 'אבווי', MRK: 'מרק', PFE: 'פייזר', XOM: 'אקסון מוביל', CVX: 'שברון', PG: 'פרוקטר אנד גמבל', KO: 'קוקה קולה', PEP: 'פפסיקו', COST: 'קוסטקו', WMT: 'וולמארט', HD: 'הום דיפו', MCD: 'מקדונלדס', NKE: 'נייקי', DIS: 'דיסני', NFLX: 'נטפליקס', ORCL: 'אורקל', CRM: 'סיילספורס', ADBE: 'אדובי', CSCO: 'סיסקו', INTC: 'אינטל', QCOM: 'קוואלקום', TXN: 'טקסס אינסטרומנטס', IBM: 'IBM', NOW: 'סרוויס-נאו', PLTR: 'פלנטיר', UBER: 'אובר', CAT: 'קטרפילר', DE: 'ג\'ון דיר', HON: 'האניוול', GE: 'GE תעופה', LMT: 'לוקהיד מרטין', RTX: 'RTX', BA: 'בואינג', UPS: 'UPS', LIN: 'לינדה', NEE: 'נקסט-ארה אנרג\'י', SO: 'סאות\'רן', GS: 'גולדמן זאקס', BAC: 'בנק אוף אמריקה', WFC: 'וולס פארגו', AXP: 'אמריקן אקספרס', BLK: 'בלאקרוק', T: 'AT&T', VZ: 'ורייזון', TMO: 'ת\'רמו פישר', ABT: 'אבוט', AMGN: 'אמג\'ן', ISRG: 'אינטואיטיב סרג\'יקל', SBUX: 'סטארבקס', LOW: 'לואוס', BKNG: 'בוקינג', SHOP: 'שופיפיי', ASML: 'ASML', TSM: 'TSMC', MU: 'מיקרון', ARM: 'ARM', SNOW: 'סנופלייק', CRWD: 'קראודסטרייק', PANW: 'פאלו אלטו', TEVA: 'טבע', CHKP: 'צ\'ק פוינט', NICE: 'נייס', WIX: 'וויקס', MNDY: 'מאנדיי', CYBR: 'סייברארק', ESLT: 'אלביט מערכות', TSEM: 'טאואר', NVMI: 'נובה', CAMT: 'קמטק', GLBE: 'גלובל-אי', ZIM: 'צים', ICL: 'איי.סי.אל', ORA: 'אורמת', SEDG: 'סולאראדג\'', INMD: 'אינמוד', FVRR: 'פייבר', PLTK: 'פלייטיקה', KRNT: 'קורנית', SPNS: 'ספיינס', RDWR: 'רדוור', ITRN: 'איתוראן', CGNT: 'קוגנייט', NNDM: 'ננו דיימנשן', GILT: 'גילת', MGIC: 'מג\'יק', URGN: 'יורוג\'ן',
  SPY: 'S&P 500 (SPY)', VOO: 'S&P 500 (VOO)', QQQ: 'נאסד"ק 100 (QQQ)', VTI: 'כל שוק ארה"ב', IWM: 'מניות קטנות ארה"ב', VEA: 'שווקים מפותחים', VWO: 'שווקים מתפתחים', EIS: 'ישראל (EIS)', SCHD: 'דיבידנד ארה"ב', VIG: 'צמיחת דיבידנד', RSP: 'S&P משקל שווה', XLK: 'טכנולוגיה', XLV: 'בריאות', XLF: 'פיננסים', XLE: 'אנרגיה', XLU: 'תשתיות', XLP: 'צריכה בסיסית', XLI: 'תעשייה', SMH: 'שבבים', XLY: 'צריכה מחזורית', AGG: 'אג"ח ארה"ב כללי', BND: 'אג"ח ארה"ב כללי (BND)', IEF: 'אג"ח ממשלתי 7-10', TLT: 'אג"ח ממשלתי ארוך', SHY: 'אג"ח ממשלתי קצר', TIP: 'אג"ח צמוד', LQD: 'אג"ח חברות', HYG: 'אג"ח תשואה גבוהה', GLD: 'זהב', IAU: 'זהב (IAU)' };
for (const a of SEED_UNIVERSE) if (NAME_HE[a.symbol]) a.nameHe = NAME_HE[a.symbol];

// מדדים ומאקרו (Stooq / FRED / EODHD)
export const INDICES = [
  { id: 'SPX', symbol: '^SPX', name: 'S&P 500', stooq: '^spx', twelvedata: 'SPX', proxy: 'SPY', type: 'index', currency: 'USD' },
  { id: 'NDQ', symbol: '^NDQ', name: 'Nasdaq Composite', stooq: '^ndq', proxy: 'QQQ', type: 'index', currency: 'USD' },
  { id: 'NDX', symbol: '^NDX', name: 'Nasdaq 100', stooq: '^ndx', proxy: 'QQQ', type: 'index', currency: 'USD' },
  { id: 'RUT', symbol: '^RUT', name: 'Russell 2000', stooq: '^rut', proxy: 'IWM', type: 'index', currency: 'USD' },
  { id: 'DJI', symbol: '^DJI', name: 'Dow Jones', stooq: '^dji', proxy: 'DIA', type: 'index', currency: 'USD' },
  { id: 'TA35', symbol: 'TA35.TA', name: 'ת"א 35', eodhd: 'TA35.INDX', type: 'index', currency: 'ILS' },
  { id: 'TA125', symbol: 'TA125.TA', name: 'ת"א 125', eodhd: 'TA125.INDX', type: 'index', currency: 'ILS' },
];

export const MACRO_SERIES = [
  { id: 'VIXCLS', title: 'VIX', units: 'index' }, { id: 'DGS10', title: 'תשואת אג"ח 10 שנים', units: '%' }, { id: 'DGS2', title: 'תשואת אג"ח 2 שנים', units: '%' },
  { id: 'T10Y2Y', title: 'עקום 10y−2y', units: '%' }, { id: 'DGS3MO', title: 'תשואה 3 חודשים', units: '%' }, { id: 'FEDFUNDS', title: 'ריבית הפד', units: '%' },
  { id: 'CPIAUCSL', title: 'CPI ארה"ב', units: 'index' }, { id: 'BAMLH0A0HYM2', title: 'מרווח High Yield', units: '%' }, { id: 'DEXISUS', title: 'USD/ILS (FRED)', units: 'ILS' },
  { id: 'DCOILWTICO', title: 'נפט WTI', units: '$' }, { id: 'UNRATE', title: 'אבטלה ארה"ב', units: '%' }, { id: 'DTWEXBGS', title: 'מדד הדולר', units: 'index' },
];

export const BENCHMARK_FOR = (asset) => (asset?.assetClass === 'bond' ? 'AGG' : asset?.sector === 'Technology' ? 'QQQ' : asset?.type === 'stock' && asset?.marketCap && asset.marketCap < 5e9 ? 'IWM' : 'SPY');

export function findAsset(symbol){
  const s = String(symbol || '').toUpperCase();
  return SEED_UNIVERSE.find((a) => a.symbol === s) || TASE_UNIVERSE.find((a) => a.symbol === s) || INDICES.find((a) => a.symbol === s || a.id === s) || null;
}

// סינון universe לפי פילטרים (משמש גם ל-screener מקומי)
export function filterUniverse(list, f = {}){
  return list.filter((a) => {
    if (f.type && a.type !== f.type) return false;
    if (f.country && a.country !== f.country) return false;
    if (f.sector && a.sector !== f.sector) return false;
    if (f.currency && a.currency !== f.currency) return false;
    if (f.assetClass && a.assetClass !== f.assetClass) return false;
    if (f.exchange && a.exchange !== f.exchange) return false;
    if (isFinite(f.minMarketCap) && (a.marketCap ?? 0) < f.minMarketCap) return false;
    if (isFinite(f.maxMarketCap) && (a.marketCap ?? Infinity) > f.maxMarketCap) return false;
    if (isFinite(f.maxVol) && a.vol1y != null && a.vol1y > f.maxVol) return false;
    if (isFinite(f.minDividend) && (a.dividendYield ?? 0) < f.minDividend) return false;
    if (isFinite(f.minReturn1y) && a.r12m != null && a.r12m < f.minReturn1y) return false;
    if (f.risk && a.riskLevel && a.riskLevel !== f.risk) return false;
    if (f.q){ const q = f.q.toLowerCase(); if (!a.symbol.toLowerCase().includes(q) && !(a.name || '').toLowerCase().includes(q)) return false; }
    return true;
  });
}
