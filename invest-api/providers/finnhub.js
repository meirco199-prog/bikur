// Finnhub — quote, profile, metrics, קונצנזוס אנליסטים, חדשות, insider, earnings, peers. חינם: ארה"ב.
import { getJSON, num } from '../lib/http.js';

const base = 'https://finnhub.io/api/v1';
async function call(ctx, path, params = {}){
  await ctx.budget.spend('finnhub');
  const q = new URLSearchParams({ ...params, token: ctx.env.FINNHUB_KEY });
  return getJSON('finnhub', `${base}${path}?${q}`);
}
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

export const finnhub = {
  id: 'finnhub', priority: 1, supports: ['quote', 'profile', 'ratios', 'analyst', 'news', 'insider', 'earnings', 'peers'],
  available: (env) => !!env.FINNHUB_KEY,
  async quote(symbol, _o, ctx){
    const q = await call(ctx, '/quote', { symbol });
    if (!num(q.c)) return { missing: true, reason: 'Finnhub: אין quote' };
    return { price: q.c, change: q.d, changePct: num(q.dp) !== null ? q.dp / 100 : null, high: q.h, low: q.l, open: q.o, prevClose: q.pc, asOf: q.t ? new Date(q.t * 1000).toISOString() : null, source: 'finnhub', quality: 0.9 };
  },
  async profile(symbol, _o, ctx){
    const p = await call(ctx, '/stock/profile2', { symbol });
    if (!p.name) return { missing: true, reason: 'Finnhub: אין פרופיל' };
    return { name: p.name, exchange: p.exchange, country: p.country, currency: p.currency, industry: p.finnhubIndustry, sector: p.finnhubIndustry, marketCap: num(p.marketCapitalization) ? p.marketCapitalization * 1e6 : null, sharesOut: num(p.shareOutstanding) ? p.shareOutstanding * 1e6 : null, ipo: p.ipo, website: p.weburl, logo: p.logo, type: 'stock', source: 'finnhub', asOf: ymd(Date.now()), quality: 0.8 };
  },
  async ratios(symbol, _o, ctx){
    const r = await call(ctx, '/stock/metric', { symbol, metric: 'all' });
    const m = r.metric || {};
    if (!Object.keys(m).length) return { missing: true, reason: 'Finnhub: אין metrics' };
    return { pe: num(m.peTTM ?? m.peBasicExclExtraTTM), ps: num(m.psTTM), pb: num(m.pbAnnual), roe: num(m.roeTTM) !== null ? m.roeTTM / 100 : null, netMargin: num(m.netProfitMarginTTM) !== null ? m.netProfitMarginTTM / 100 : null, beta: num(m.beta), dividendYield: num(m.dividendYieldIndicatedAnnual) !== null ? m.dividendYieldIndicatedAnnual / 100 : null, high52: num(m['52WeekHigh']), low52: num(m['52WeekLow']), epsGrowth: num(m.epsGrowthTTMYoy) !== null ? m.epsGrowthTTMYoy / 100 : null, revenueGrowth: num(m.revenueGrowthTTMYoy) !== null ? m.revenueGrowthTTMYoy / 100 : null, source: 'finnhub', asOf: ymd(Date.now()), quality: 0.8 };
  },
  async analyst(symbol, _o, ctx){
    const arr = await call(ctx, '/stock/recommendation', { symbol });
    if (!Array.isArray(arr) || !arr.length) return { missing: true, reason: 'Finnhub: אין המלצות' };
    const cur = arr[0], prev = arr[1];
    const total = (cur.strongBuy || 0) + (cur.buy || 0) + (cur.hold || 0) + (cur.sell || 0) + (cur.strongSell || 0);
    const bullish = (x) => (x?.strongBuy || 0) + (x?.buy || 0);
    return { strongBuy: cur.strongBuy, buy: cur.buy, hold: cur.hold, sell: cur.sell, strongSell: cur.strongSell, total, period: cur.period, trendDelta: prev ? bullish(cur) - bullish(prev) : null, history: arr.slice(0, 6), targets: null, source: 'finnhub', asOf: cur.period, quality: 0.8, kind: 'ANALYST OPINION' };
  },
  async news(symbol, { from } = {}, ctx){
    const to = ymd(Date.now()), f = from || ymd(Date.now() - 30 * 86400000);
    const arr = await call(ctx, '/company-news', { symbol, from: f, to });
    if (!Array.isArray(arr)) return { missing: true, reason: 'Finnhub: אין חדשות' };
    return { items: arr.slice(0, 80).map((n) => ({ id: 'fh' + n.id, title: n.headline, url: n.url, publisher: n.source, publishedAt: new Date(n.datetime * 1000).toISOString(), summary: (n.summary || '').slice(0, 400), source: 'finnhub' })), source: 'finnhub', asOf: to, quality: 0.8 };
  },
  async insider(symbol, _o, ctx){
    const r = await call(ctx, '/stock/insider-transactions', { symbol });
    const data = r.data || [];
    return { items: data.slice(0, 40).map((t) => ({ name: t.name, type: (t.change || 0) > 0 ? 'buy' : 'sell', shares: Math.abs(t.change || 0), price: num(t.transactionPrice), date: t.transactionDate, filedAt: t.filingDate, code: t.transactionCode, source: 'finnhub' })), source: 'finnhub', asOf: ymd(Date.now()), quality: 0.8 };
  },
  async earnings(symbol, _o, ctx){
    const from = ymd(Date.now() - 7 * 86400000), to = ymd(Date.now() + 120 * 86400000);
    const [cal, hist] = await Promise.all([call(ctx, '/calendar/earnings', { symbol, from, to }), call(ctx, '/stock/earnings', { symbol })]);
    const next = (cal.earningsCalendar || []).map((e) => e.date).filter((d) => d >= ymd(Date.now())).sort()[0] || null;
    return { next, last: (Array.isArray(hist) ? hist : []).slice(0, 4).map((e) => ({ date: e.period, epsActual: e.actual, epsEst: e.estimate, surprisePct: num(e.surprisePercent) !== null ? e.surprisePercent / 100 : null })), source: 'finnhub', asOf: ymd(Date.now()), quality: 0.8 };
  },
  async peers(symbol, _o, ctx){
    const arr = await call(ctx, '/stock/peers', { symbol });
    return { peers: (Array.isArray(arr) ? arr : []).filter((p) => p !== symbol).slice(0, 10), source: 'finnhub' };
  },
};
