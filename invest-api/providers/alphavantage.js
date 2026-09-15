// Alpha Vantage — 25 קריאות/יום: מחירים (גיבוי), OVERVIEW, חדשות+סנטימנט, insider, ETF_PROFILE, EARNINGS, TOP_GAINERS_LOSERS.
import { getJSON, num } from '../lib/http.js';

async function call(ctx, params){
  if (!(await ctx.budget.canSpend('alphavantage'))) throw Object.assign(new Error('alphavantage: תקציב יומי נגמר'), { kind: 'quota' });
  await ctx.budget.spend('alphavantage');
  const q = new URLSearchParams({ ...params, apikey: ctx.env.ALPHAVANTAGE_KEY });
  const r = await getJSON('alphavantage', `https://www.alphavantage.co/query?${q}`);
  if (r.Note || r.Information) throw Object.assign(new Error('alphavantage: ' + (r.Note || r.Information).slice(0, 120)), { kind: 'quota' });
  if (r['Error Message']) throw new Error('alphavantage: ' + r['Error Message']);
  return r;
}
const today = () => new Date().toISOString().slice(0, 10);
const avDate = (s) => (s && s.length >= 15 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:00Z` : null);

export const alphavantage = {
  id: 'alphavantage', priority: 3, supports: ['prices', 'profile', 'ratios', 'analyst', 'news', 'insider', 'etf', 'earnings', 'movers'],
  available: (env) => !!env.ALPHAVANTAGE_KEY,
  async prices(symbol, { from } = {}, ctx){
    const r = await call(ctx, { function: 'TIME_SERIES_DAILY', symbol, outputsize: from && from > '2020' ? 'compact' : 'full' });
    const ts = r['Time Series (Daily)'];
    if (!ts) return { missing: true, reason: 'AV: אין סדרה' };
    const rows = Object.entries(ts).map(([d, v]) => [d, num(v['1. open']), num(v['2. high']), num(v['3. low']), num(v['4. close']), num(v['5. volume']) ?? 0]).filter((x) => !from || x[0] >= from).sort((a, b) => a[0].localeCompare(b[0]));
    return { rows, currency: 'USD', source: 'alphavantage', asOf: rows[rows.length - 1]?.[0], quality: 0.8 };
  },
  async overview(symbol, ctx){ return call(ctx, { function: 'OVERVIEW', symbol }); },
  async profile(symbol, _o, ctx){
    const o = await this.overview(symbol, ctx);
    if (!o.Name) return { missing: true, reason: 'AV: אין OVERVIEW' };
    return { name: o.Name, exchange: o.Exchange, country: o.Country, currency: o.Currency, sector: o.Sector, industry: o.Industry, marketCap: num(o.MarketCapitalization), sharesOut: num(o.SharesOutstanding), beta: num(o.Beta), description: (o.Description || '').slice(0, 600), type: o.AssetType === 'ETF' ? 'etf' : 'stock', source: 'alphavantage', asOf: o.LatestQuarter || today(), quality: 0.8, _overview: o };
  },
  ratiosFromOverview(o){
    const pct = (x) => (num(x) !== null ? num(x) : null);
    return { pe: num(o.PERatio), forwardPe: num(o.ForwardPE), peg: num(o.PEGRatio), ps: num(o.PriceToSalesRatioTTM), pb: num(o.PriceToBookRatio), evEbitda: num(o.EVToEBITDA), roe: pct(o.ReturnOnEquityTTM), netMargin: pct(o.ProfitMargin), operatingMargin: pct(o.OperatingMarginTTM), beta: num(o.Beta), dividendYield: num(o.DividendYield), eps: num(o.EPS), epsGrowth: pct(o.QuarterlyEarningsGrowthYOY), revenueGrowth: pct(o.QuarterlyRevenueGrowthYOY), marketCap: num(o.MarketCapitalization), source: 'alphavantage', asOf: o.LatestQuarter || today(), quality: 0.8 };
  },
  async ratios(symbol, _o, ctx){ const o = await this.overview(symbol, ctx); if (!o.Symbol) return { missing: true, reason: 'AV: אין OVERVIEW' }; return this.ratiosFromOverview(o); },
  analystFromOverview(o){
    const sb = num(o.AnalystRatingStrongBuy) || 0, b = num(o.AnalystRatingBuy) || 0, h = num(o.AnalystRatingHold) || 0, s = num(o.AnalystRatingSell) || 0, ss = num(o.AnalystRatingStrongSell) || 0;
    const total = sb + b + h + s + ss;
    if (!total && num(o.AnalystTargetPrice) === null) return { missing: true, reason: 'AV: אין דירוגים' };
    return { strongBuy: sb, buy: b, hold: h, sell: s, strongSell: ss, total, targets: num(o.AnalystTargetPrice) !== null ? { avg: num(o.AnalystTargetPrice), median: null, high: null, low: null } : null, source: 'alphavantage', asOf: o.LatestQuarter || today(), quality: 0.7, kind: 'ANALYST OPINION' };
  },
  async analyst(symbol, _o, ctx){ const o = await this.overview(symbol, ctx); return this.analystFromOverview(o); },
  async news(symbol, _o, ctx){
    const r = await call(ctx, { function: 'NEWS_SENTIMENT', tickers: symbol, limit: '50', sort: 'LATEST' });
    if (!Array.isArray(r.feed)) return { missing: true, reason: 'AV: אין feed' };
    return { items: r.feed.map((n) => { const ts = (n.ticker_sentiment || []).find((t) => t.ticker === symbol); return { id: 'av' + (n.url || n.title).slice(-40), title: n.title, url: n.url, publisher: n.source, publishedAt: avDate(n.time_published), summary: (n.summary || '').slice(0, 400), sentiment: { score: num(ts?.ticker_sentiment_score ?? n.overall_sentiment_score), label: ts?.ticker_sentiment_label || n.overall_sentiment_label, method: 'provider', relevance: num(ts?.relevance_score) }, source: 'alphavantage' }; }), source: 'alphavantage', asOf: today(), quality: 0.8 };
  },
  async insider(symbol, _o, ctx){
    const r = await call(ctx, { function: 'INSIDER_TRANSACTIONS', symbol });
    return { items: (r.data || []).slice(0, 40).map((t) => ({ name: t.executive, role: t.executive_title, type: t.acquisition_or_disposal === 'A' ? 'buy' : 'sell', shares: num(t.shares), price: num(t.share_price), date: t.transaction_date, source: 'alphavantage' })), source: 'alphavantage', asOf: today(), quality: 0.8 };
  },
  async etf(symbol, _o, ctx){
    const r = await call(ctx, { function: 'ETF_PROFILE', symbol });
    if (!r.holdings) return { missing: true, reason: 'AV: אין ETF_PROFILE' };
    return { holdings: r.holdings.slice(0, 25).map((h) => ({ symbol: h.symbol, name: h.description, weight: num(h.weight) })), sectors: (r.sectors || []).map((s) => ({ sector: s.sector, weight: num(s.weight) })), expense: num(r.net_expense_ratio), aum: num(r.net_assets), dividendYield: num(r.dividend_yield), inception: r.inception_date, source: 'alphavantage', asOf: today(), quality: 0.8 };
  },
  async earnings(symbol, _o, ctx){
    const r = await call(ctx, { function: 'EARNINGS', symbol });
    const q = r.quarterlyEarnings || [];
    return { next: null, last: q.slice(0, 4).map((e) => ({ date: e.reportedDate, period: e.fiscalDateEnding, epsActual: num(e.reportedEPS), epsEst: num(e.estimatedEPS), surprisePct: num(e.surprisePercentage) !== null ? e.surprisePercentage / 100 : null })), source: 'alphavantage', asOf: today(), quality: 0.8 };
  },
  async movers(ctx){
    const r = await call(ctx, { function: 'TOP_GAINERS_LOSERS' });
    const map = (a) => (a || []).slice(0, 20).map((x) => ({ symbol: x.ticker, price: num(x.price), changePct: num(x.change_percentage) !== null ? num(x.change_percentage) / 100 : null, volume: num(x.volume) }));
    return { gainers: map(r.top_gainers), losers: map(r.top_losers), active: map(r.most_actively_traded), asOf: r.last_updated, source: 'alphavantage' };
  },
};
