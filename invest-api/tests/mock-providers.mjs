// fetch מדומה לספקים — מאפשר להריץ את ה-Worker ב-Node בלי רשת ובלי מפתחות.
import { syntheticRows, syntheticFacts, macroSeries, tradingDates } from './helpers.mjs';

const seedOf = (s) => [...s].reduce((a, c) => a + c.charCodeAt(0), 0);
const N_DAYS = tradingDates(5000, '2018-09-03').filter((d) => d <= new Date().toISOString().slice(0, 10)).length;
export function priceCSV(symbol){
  const rows = syntheticRows({ n: N_DAYS, start: '2018-09-03', price: 50 + (seedOf(symbol) % 200), drift: 0.0004, vol: 0.014, seed: seedOf(symbol) });
  return 'Date,Open,High,Low,Close,Volume\n' + rows.map((r) => r.join(',')).join('\n');
}
export function companyFacts(symbol){
  const f = syntheticFacts({ years: 7, startYear: 2018, rev0: 5e9 + (seedOf(symbol) % 50) * 1e8, growth: 0.08 + (seedOf(symbol) % 10) / 100, margin: 0.12 + (seedOf(symbol) % 8) / 100, shares: 5e8 });
  const gaap = {};
  const tag = { Revenue: 'Revenues', NetIncome: 'NetIncomeLoss', EPSDiluted: 'EarningsPerShareDiluted', OCF: 'NetCashProvidedByUsedInOperatingActivities', Capex: 'PaymentsToAcquirePropertyPlantAndEquipment', Cash: 'CashAndCashEquivalentsAtCarryingValue', LongTermDebt: 'LongTermDebtNoncurrent', Equity: 'StockholdersEquity', EBIT: 'OperatingIncomeLoss', GrossProfit: 'GrossProfit', InterestExpense: 'InterestExpense' };
  for (const [k, t] of Object.entries(tag)) gaap[t] = { units: { [k === 'EPSDiluted' ? 'USD/shares' : 'USD']: f.series[k].map((x) => ({ ...x, accn: 'x' })) } };
  return { cik: 1, entityName: symbol + ' Inc', facts: { 'us-gaap': gaap, dei: { EntityCommonStockSharesOutstanding: { units: { shares: f.series.Shares.map((x) => ({ ...x, form: '10-K' })) } } } } };
}
export const calls = [];
export const githubPosts = [];
export function installMockFetch({ fail = [] } = {}){
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url); calls.push(u);
    const ok = (data, type = 'application/json') => new Response(typeof data === 'string' ? data : JSON.stringify(data), { status: 200, headers: { 'content-type': type } });
    if (fail.some((f) => u.includes(f))) return new Response('boom', { status: 500 });
    if (u.includes('stooq.com')){ const s = new URL(u).searchParams.get('s'); if (s.includes('nodata')) return ok('No data'); return ok(priceCSV(s), 'text/csv'); }
    if (u.includes('finnhub.io')){
      const p = new URL(u); const sym = p.searchParams.get('symbol');
      if (u.includes('/quote')){ const last = +priceCSV(sym.toLowerCase().replace('.', '-') + '.us').trim().split('\n').pop().split(',')[4]; const c = +(last * 1.015).toFixed(2); return ok({ c, d: +(c - last).toFixed(2), dp: 1.5, h: c * 1.01, l: last * 0.99, o: last, pc: last, t: Math.floor(Date.now() / 1000) }); }
      if (u.includes('/profile2')) return ok({ name: sym + ' Corp', country: 'US', currency: 'USD', exchange: 'NASDAQ', finnhubIndustry: 'Technology', marketCapitalization: 150000, shareOutstanding: 1500 });
      if (u.includes('/metric')) return ok({ metric: { peTTM: 25, psTTM: 5, roeTTM: 30, netProfitMarginTTM: 20, beta: 1.2, '52WeekHigh': 120 } });
      if (u.includes('/recommendation')) return ok([{ buy: 10, hold: 5, sell: 1, strongBuy: 8, strongSell: 0, period: '2026-09-01', symbol: sym }, { buy: 9, hold: 6, sell: 1, strongBuy: 7, strongSell: 0, period: '2026-08-01' }]);
      if (u.includes('/company-news')) return ok([{ id: 1, headline: `${sym} beats estimates and raises full-year guidance`, url: 'https://reuters.com/a/1', source: 'Reuters', datetime: Math.floor(Date.now() / 1000) - 86400, summary: 'Strong quarter' }, { id: 2, headline: `${sym} beats estimates, raises guidance`, url: 'https://yahoo.com/b?utm_source=x', source: 'Yahoo', datetime: Math.floor(Date.now() / 1000) - 90000, summary: '' }, { id: 3, headline: `Analyst upgrades ${sym} to Buy`, url: 'https://cnbc.com/c', source: 'CNBC', datetime: Math.floor(Date.now() / 1000) - 3 * 86400, summary: '' }, { id: 4, headline: `${sym} faces regulatory probe in EU`, url: 'https://ft.com/d', source: 'Financial Times', datetime: Math.floor(Date.now() / 1000) - 5 * 86400, summary: '' }]);
      if (u.includes('/insider-transactions')) return ok({ data: [{ name: 'CEO', change: -1000, transactionPrice: 100, transactionDate: '2026-09-01', filingDate: '2026-09-03', transactionCode: 'S' }] });
      if (u.includes('/calendar/earnings')) return ok({ earningsCalendar: [{ date: new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10), symbol: sym }] });
      if (u.includes('/stock/earnings')) return ok([{ actual: 1.2, estimate: 1.1, period: '2026-06-30', surprisePercent: 9 }]);
      if (u.includes('/stock/peers')) return ok([sym, 'MSFT', 'GOOGL']);
    }
    if (u.includes('stlouisfed.org')){ const id = new URL(u).searchParams.get('series_id'); const start = { VIXCLS: 18, DGS10: 4.2, DGS2: 3.9, T10Y2Y: 0.3, DGS3MO: 4.5, FEDFUNDS: 4.3, CPIAUCSL: 310, BAMLH0A0HYM2: 3.4, DEXISUS: 3.7, DCOILWTICO: 75, UNRATE: 4.1, DTWEXBGS: 120 }[id] || 10; const rows = macroSeries(1200, start, id === 'CPIAUCSL' ? 0.02 : 0, seedOf(id), tradingDates(1200, '2022-01-03')); return ok({ observations: rows.map(([d, v]) => ({ date: d, value: String(v) })) }); }
    if (u.includes('sec.gov/files/company_tickers')) return ok({ 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple Inc.' }, 1: { cik_str: 789019, ticker: 'MSFT', title: 'Microsoft Corp' }, 2: { cik_str: 1, ticker: 'NVDA', title: 'NVIDIA' }, 3: { cik_str: 2, ticker: 'JPM', title: 'JPMorgan' } });
    if (u.includes('data.sec.gov/api/xbrl/companyfacts')) return ok(companyFacts('X'));
    if (u.includes('data.sec.gov/submissions')) return ok({ filings: { recent: { form: ['8-K', '10-Q', '4'], filingDate: ['2026-09-10', '2026-08-01', '2026-09-02'], accessionNumber: ['0001-26-1', '0001-26-2', '0001-26-3'], primaryDocument: ['a.htm', 'b.htm', 'c.htm'], items: ['2.02', '', ''], primaryDocDescription: ['8-K', '10-Q', '4'] } } });
    if (u.includes('boi.org.il')) return ok({ exchangeRates: [{ key: 'USD', currentExchangeRate: 3.72, currentChange: -0.3, unit: 1, lastUpdate: '2026-09-14T00:00:00' }] });
    if (u.includes('en.wikipedia.org/wiki/List_of_S%26P_500_companies')){
      const secs = ['Information Technology', 'Health Care', 'Financials', 'Industrials', 'Consumer Discretionary', 'Utilities'];
      const row = (sym, name, sec) => `<tr>\n<td><a rel="nofollow" class="external text" href="https://www.nyse.com/quote/XNYS:${sym}">${sym}</a>\n</td>\n<td><a href="/wiki/${name}" title="${name}">${name}</a>\n</td>\n<td>${sec}\n</td>\n<td>Sub\n</td>\n<td>City\n</td>\n<td>2000-01-01\n</td>\n<td>1\n</td>\n<td>1900\n</td></tr>`;
      const rows = ['AAPL', 'MSFT', 'NVDA', 'JPM', ...[...Array(500)].map((_, i) => 'W' + i)].map((sym, i) => row(sym, sym + ' Inc', secs[i % secs.length])).join('\n');
      return ok(`<html><table class="wikitable sortable" id="constituents"><tbody>${rows}</tbody></table></html>`, 'text/html');
    }
    if (u.includes('api.telegram.org')) return ok({ ok: true });
    if (u.includes('api.anthropic.com')) return ok({ model: 'claude-opus-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'תשובה מדומה (Stooq, 2026-09-12)' }] });
    if (u.includes('api.github.com/repos/') && u.includes('/issues/')){ const b = JSON.parse(opts.body || '{}'); githubPosts.push({ url: u, auth: (opts.headers || {}).Authorization || '', body: b.body }); if (String((opts.headers || {}).Authorization || '').includes('bad')) return new Response(JSON.stringify({ message: 'Resource not accessible by integration' }), { status: 403 }); return ok({ id: 1000 + githubPosts.length, html_url: 'https://github.com/x/issues/25#issuecomment-' + (1000 + githubPosts.length) }); }
    return new Response('not mocked: ' + u, { status: 404 });
  };
}
