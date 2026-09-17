// Financial Modeling Prep — screener, פרופיל, יחסים, דוחות, תחזיות אנליסטים, יעדי מחיר, ETF holdings, מחירים (גיבוי).
import { getJSON, num } from '../lib/http.js';

const base = 'https://financialmodelingprep.com/stable';
async function call(ctx, path, params = {}){
  await ctx.budget.spend('fmp');
  const q = new URLSearchParams({ ...params, apikey: ctx.env.FMP_KEY });
  const r = await getJSON('fmp', `${base}/${path}?${q}`);
  if (r && r['Error Message']) throw new Error('fmp: ' + r['Error Message']);
  return r;
}
const first = (x) => (Array.isArray(x) ? x[0] : x);
const today = () => new Date().toISOString().slice(0, 10);

export const fmp = {
  id: 'fmp', priority: 2, supports: ['profile', 'ratios', 'facts', 'estimates', 'targets', 'analyst', 'etf', 'screener', 'prices', 'insider', 'earnings'],
  available: (env) => !!env.FMP_KEY,
  async profile(symbol, _o, ctx){
    const p = first(await call(ctx, 'profile', { symbol }));
    if (!p || !p.companyName) return { missing: true, reason: 'FMP: אין פרופיל' };
    return { name: p.companyName, exchange: p.exchangeShortName || p.exchange, country: p.country, currency: p.currency, sector: p.sector, industry: p.industry, marketCap: num(p.marketCap), beta: num(p.beta), sharesOut: num(p.marketCap) && num(p.price) ? p.marketCap / p.price : null, description: (p.description || '').slice(0, 600), website: p.website, type: p.isEtf ? 'etf' : p.isFund ? 'fund' : 'stock', lastDividend: num(p.lastDividend), source: 'fmp', asOf: today(), quality: 0.8 };
  },
  async ratios(symbol, _o, ctx){
    const [r, k] = await Promise.all([call(ctx, 'ratios-ttm', { symbol }).then(first).catch(() => null), call(ctx, 'key-metrics-ttm', { symbol }).then(first).catch(() => null)]);
    if (!r && !k) return { missing: true, reason: 'FMP: אין יחסים' };
    const g = (obj, ...keys) => { for (const key of keys){ const v = num(obj?.[key]); if (v !== null) return v; } return null; };
    return {
      pe: g(r, 'priceToEarningsRatioTTM', 'peRatioTTM'), forwardPe: null, peg: g(r, 'priceToEarningsGrowthRatioTTM', 'pegRatioTTM'), ps: g(r, 'priceToSalesRatioTTM'), pb: g(r, 'priceToBookRatioTTM'),
      evEbitda: g(k, 'evToEBITDATTM', 'enterpriseValueOverEBITDATTM') ?? g(r, 'enterpriseValueMultipleTTM'), roe: g(k, 'returnOnEquityTTM') ?? g(r, 'returnOnEquityTTM'), roic: g(k, 'returnOnInvestedCapitalTTM'),
      netMargin: g(r, 'netProfitMarginTTM'), grossMargin: g(r, 'grossProfitMarginTTM'), operatingMargin: g(r, 'operatingProfitMarginTTM'), fcfYield: g(k, 'freeCashFlowYieldTTM'), netDebtToEbitda: g(k, 'netDebtToEBITDATTM'), dividendYield: g(r, 'dividendYieldTTM', 'dividendYielTTM'),
      source: 'fmp', asOf: today(), quality: 0.8,
    };
  },
  // דוחות שנתיים+רבעוניים → facts.series באותו מבנה של EDGAR (filed = filingDate)
  async facts(symbol, _o, ctx){
    const get = (p, period) => call(ctx, p, { symbol, period, limit: period === 'annual' ? 10 : 12 }).catch(() => []);
    const [ia, ba, ca, iq] = await Promise.all([get('income-statement', 'annual'), get('balance-sheet-statement', 'annual'), get('cash-flow-statement', 'annual'), get('income-statement', 'quarter')]);
    if (!Array.isArray(ia) || !ia.length) return { missing: true, reason: 'FMP: אין דוחות' };
    const series = {};
    const add = (k, f) => { (series[k] ||= []).push(f); };
    const yearStart = (end) => { const d = new Date(end + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() - 1); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
    const qStart = (end) => { const d = new Date(end + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 3); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
    for (const s of ia){
      const meta = { start: yearStart(s.date), end: s.date, filed: s.filingDate || s.fillingDate || s.acceptedDate?.slice(0, 10) || s.date, form: '10-K', fy: num(s.fiscalYear) ?? +s.date.slice(0, 4), fp: 'FY' };
      const m = (k, v) => { if (num(v) !== null) add(k, { ...meta, val: v }); };
      m('Revenue', s.revenue); m('NetIncome', s.netIncome); m('EPSDiluted', s.epsDiluted ?? s.epsdiluted); m('EBIT', s.operatingIncome); m('GrossProfit', s.grossProfit); m('InterestExpense', s.interestExpense); m('DA', s.depreciationAndAmortization);
    }
    for (const s of iq){
      const meta = { start: qStart(s.date), end: s.date, filed: s.filingDate || s.fillingDate || s.date, form: '10-Q', fy: num(s.fiscalYear), fp: s.period };
      const m = (k, v) => { if (num(v) !== null) add(k, { ...meta, val: v }); };
      m('Revenue', s.revenue); m('NetIncome', s.netIncome); m('EPSDiluted', s.epsDiluted ?? s.epsdiluted);
    }
    for (const s of ba){
      const meta = { end: s.date, filed: s.filingDate || s.fillingDate || s.date, form: '10-K', fy: num(s.fiscalYear), fp: 'FY' };
      const m = (k, v) => { if (num(v) !== null) add(k, { ...meta, val: v }); };
      m('Cash', s.cashAndCashEquivalents); m('LongTermDebt', s.longTermDebt); m('TotalDebt', s.totalDebt); m('Equity', s.totalStockholdersEquity); m('TotalAssets', s.totalAssets);
    }
    for (const s of ca){
      const meta = { start: yearStart(s.date), end: s.date, filed: s.filingDate || s.fillingDate || s.date, form: '10-K', fy: num(s.fiscalYear), fp: 'FY' };
      const m = (k, v) => { if (num(v) !== null) add(k, { ...meta, val: v }); };
      m('OCF', s.operatingCashFlow); m('Capex', s.capitalExpenditure); m('Dividends', s.dividendsPaid ?? s.commonDividendsPaid);
    }
    // מניות: מהדוח (weightedAverageShsOutDil)
    for (const s of ia) if (num(s.weightedAverageShsOutDil)) add('Shares', { end: s.date, filed: s.filingDate || s.date, form: '10-K', val: s.weightedAverageShsOutDil });
    for (const k of Object.keys(series)) series[k].sort((a, b) => a.end.localeCompare(b.end));
    return { series, source: 'fmp', asOf: ia[0].date, quality: 0.8 };
  },
  async estimates(symbol, _o, ctx){
    const arr = await call(ctx, 'analyst-estimates', { symbol, period: 'annual', limit: 4 });
    if (!Array.isArray(arr) || !arr.length) return { missing: true, reason: 'FMP: אין תחזיות' };
    const fut = arr.filter((e) => e.date >= today()).sort((a, b) => a.date.localeCompare(b.date));
    const fy1 = fut[0], fy2 = fut[1];
    return { eps: { fy1: num(fy1?.epsAvg), fy2: num(fy2?.epsAvg), fy1Date: fy1?.date, fy2Date: fy2?.date }, revenue: { fy1: num(fy1?.revenueAvg), fy2: num(fy2?.revenueAvg) }, analysts: num(fy1?.numAnalystsEps ?? fy1?.numberAnalystsEstimatedEps), source: 'fmp', asOf: today(), quality: 0.7, kind: 'ESTIMATE' };
  },
  async targets(symbol, _o, ctx){
    const t = first(await call(ctx, 'price-target-consensus', { symbol }));
    if (!t || num(t.targetConsensus) === null) return { missing: true, reason: 'FMP: אין יעדי מחיר' };
    return { avg: num(t.targetConsensus), median: num(t.targetMedian), high: num(t.targetHigh), low: num(t.targetLow), source: 'fmp', asOf: today(), quality: 0.7 };
  },
  async analyst(symbol, _o, ctx){
    const g = first(await call(ctx, 'grades-consensus', { symbol }));
    if (!g) return { missing: true, reason: 'FMP: אין קונצנזוס' };
    const total = (g.strongBuy || 0) + (g.buy || 0) + (g.hold || 0) + (g.sell || 0) + (g.strongSell || 0);
    return { strongBuy: g.strongBuy, buy: g.buy, hold: g.hold, sell: g.sell, strongSell: g.strongSell, total, consensus: g.consensus, source: 'fmp', asOf: today(), quality: 0.7, kind: 'ANALYST OPINION' };
  },
  async etf(symbol, _o, ctx){
    const [h, info] = await Promise.all([call(ctx, 'etf/holdings', { symbol }).catch(() => []), call(ctx, 'etf/info', { symbol }).then(first).catch(() => null)]);
    if (!Array.isArray(h) || !h.length) return { missing: true, reason: 'FMP: אין החזקות' };
    return { holdings: h.slice(0, 25).map((x) => ({ symbol: x.asset || x.symbol, name: x.name, weight: num(x.weightPercentage) !== null ? x.weightPercentage / 100 : null })), expense: num(info?.expenseRatio), aum: num(info?.aum ?? info?.assetsUnderManagement), source: 'fmp', asOf: today(), quality: 0.8 };
  },
  // תאריכי דוחות: הבא (ללא תוצאה בפועל) + 4 אחרונים עם הפתעה
  async earnings(symbol, _o, ctx){
    const arr = await call(ctx, 'earnings', { symbol, limit: 12 });
    if (!Array.isArray(arr) || !arr.length) return { missing: true, reason: 'FMP: אין תאריכי דוחות' };
    const t = today();
    const next = arr.filter((e) => e.date >= t && num(e.epsActual) === null).map((e) => e.date).sort()[0] || null;
    const last = arr.filter((e) => num(e.epsActual) !== null && e.date < t).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4)
      .map((e) => ({ date: e.date, epsActual: num(e.epsActual), epsEst: num(e.epsEstimated), surprisePct: num(e.epsEstimated) && num(e.epsActual) !== null ? (e.epsActual - e.epsEstimated) / Math.abs(e.epsEstimated) : null }));
    return { next, last, source: 'fmp', asOf: t };
  },
  async screener(filters = {}, _o, ctx){
    const p = { limit: String(filters.limit || 100), isActivelyTrading: 'true' };
    if (filters.minMarketCap) p.marketCapMoreThan = String(filters.minMarketCap);
    if (filters.maxMarketCap) p.marketCapLowerThan = String(filters.maxMarketCap);
    if (filters.sector) p.sector = filters.sector;
    if (filters.country) p.country = filters.country;
    if (filters.exchange) p.exchange = filters.exchange;
    if (filters.minDividend) p.dividendMoreThan = String(filters.minDividend);
    if (filters.maxBeta) p.betaLowerThan = String(filters.maxBeta);
    if (filters.minVolume) p.volumeMoreThan = String(filters.minVolume);
    if (filters.isEtf !== undefined) p.isEtf = String(!!filters.isEtf);
    const arr = await call(ctx, 'company-screener', p);
    return { items: (Array.isArray(arr) ? arr : []).map((x) => ({ symbol: x.symbol, name: x.companyName, marketCap: num(x.marketCap), sector: x.sector, industry: x.industry, beta: num(x.beta), price: num(x.price), dividend: num(x.lastAnnualDividend), volume: num(x.volume), exchange: x.exchangeShortName, country: x.country, type: x.isEtf ? 'etf' : x.isFund ? 'fund' : 'stock', currency: 'USD' })), source: 'fmp', asOf: today() };
  },
  async prices(symbol, { from } = {}, ctx){
    const r = await call(ctx, 'historical-price-eod/full', { symbol, from: from || '2000-01-01' });
    const arr = Array.isArray(r) ? r : r?.historical || [];
    if (!arr.length) return { missing: true, reason: 'FMP: אין מחירים' };
    const rows = arr.map((x) => [x.date, num(x.open), num(x.high), num(x.low), num(x.close), num(x.volume) ?? 0]).filter((x) => x[4] !== null).sort((a, b) => a[0].localeCompare(b[0]));
    return { rows, currency: 'USD', source: 'fmp', asOf: rows[rows.length - 1][0], quality: 0.8 };
  },
  async insider(symbol, _o, ctx){
    const arr = await call(ctx, 'insider-trading/search', { symbol, limit: 40 });
    return { items: (Array.isArray(arr) ? arr : []).map((t) => ({ name: t.reportingName, role: t.typeOfOwner, type: /P-Purchase|A-Award/i.test(t.transactionType) ? 'buy' : 'sell', shares: num(t.securitiesTransacted), price: num(t.price), date: t.transactionDate, filedAt: t.filingDate, source: 'fmp' })), source: 'fmp', asOf: today(), quality: 0.8 };
  },
};
