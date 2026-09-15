// SEC EDGAR — companyfacts (XBRL) עם תאריכי הגשה → point-in-time; submissions → אירועי דיווח (8-K/10-K/10-Q) כמקור ראשוני.
import { getJSON } from '../lib/http.js';

const UA = (env) => ({ 'User-Agent': env.EDGAR_UA || 'bikur-invest research contact@example.com', Accept: 'application/json' });
export const TAG_MAP = {
  Revenue: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'RevenuesNetOfInterestExpense'],
  NetIncome: ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
  EPSDiluted: ['EarningsPerShareDiluted', 'EarningsPerShareBasicAndDiluted'],
  OCF: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  Capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  Cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  LongTermDebt: ['LongTermDebtNoncurrent', 'LongTermDebt', 'LongTermDebtAndCapitalLeaseObligations'],
  DebtCurrent: ['DebtCurrent', 'LongTermDebtCurrent', 'ShortTermBorrowings'],
  Equity: ['StockholdersEquity', 'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest'],
  EBIT: ['OperatingIncomeLoss'],
  DA: ['DepreciationDepletionAndAmortization', 'DepreciationAndAmortization', 'DepreciationAmortizationAndAccretionNet'],
  Dividends: ['PaymentsOfDividendsCommonStock', 'PaymentsOfDividends'],
  GrossProfit: ['GrossProfit'],
  InterestExpense: ['InterestExpense', 'InterestExpenseNonoperating'],
  TotalAssets: ['Assets'],
  Shares: ['WeightedAverageNumberOfDilutedSharesOutstanding', 'WeightedAverageNumberOfSharesOutstandingBasic'],
};

export function normalizeCompanyFacts(json){
  const gaap = json?.facts?.['us-gaap'] || {};
  const dei = json?.facts?.dei || {};
  const series = {};
  const pick = (obj) => { const units = obj?.units || {}; const k = Object.keys(units).find((u) => /USD|shares|USD\/shares|pure/.test(u)); return units[k] || []; };
  for (const [metric, tags] of Object.entries(TAG_MAP)){
    const out = new Map();
    for (const tag of tags){
      const arr = pick(gaap[tag]);
      for (const f of arr){
        if (!/10-K|10-Q|20-F|40-F|10-KT|10-QT/.test(f.form || '')) continue;
        const isShares = metric === 'Shares';
        const e = { end: f.end, val: f.val, filed: f.filed, form: f.form, fy: f.fy, fp: f.fp };
        if (f.start && !isShares) e.start = f.start;
        const key = `${e.start || ''}|${e.end}|${e.val}|${e.filed}`;
        if (!out.has(key)) out.set(key, e);
      }
      if (out.size) break; // התגית הראשונה עם נתונים מנצחת — עקביות בתוך המטריקה
    }
    if (out.size) series[metric] = [...out.values()].sort((a, b) => a.end.localeCompare(b.end) || (a.filed || '').localeCompare(b.filed || ''));
  }
  // מניות: dei EntityCommonStockSharesOutstanding (instant) עדיף
  const deiSh = pick(dei.EntityCommonStockSharesOutstanding);
  if (deiSh.length) series.Shares = deiSh.filter((f) => f.val > 0).map((f) => ({ end: f.end, val: f.val, filed: f.filed, form: f.form, fy: f.fy, fp: f.fp })).sort((a, b) => a.end.localeCompare(b.end));
  // TotalDebt = LongTermDebt + DebtCurrent לאותו end (כשיש שניהם)
  if (series.LongTermDebt){
    const cur = new Map((series.DebtCurrent || []).map((f) => [f.end + '|' + f.filed, f.val]));
    series.TotalDebt = series.LongTermDebt.map((f) => ({ ...f, val: f.val + (cur.get(f.end + '|' + f.filed) ?? 0) }));
  }
  delete series.DebtCurrent;
  return { series, cik: json?.cik, name: json?.entityName, source: 'EDGAR', quality: 1 };
}

export const edgar = {
  id: 'edgar', priority: 1, supports: ['facts', 'filings', 'cik'],
  available: () => true,
  async cikFor(symbol, ctx){
    const key = 'edgar:tickers';
    let map = await ctx.db.get(key);
    if (!map || (Date.now() - Date.parse(map.fetchedAt)) > 30 * 86400000){
      await ctx.budget.spend('edgar');
      const j = await getJSON('edgar', 'https://www.sec.gov/files/company_tickers.json', { headers: UA(ctx.env) }, 20000);
      const m = {};
      for (const v of Object.values(j)) m[String(v.ticker).toUpperCase()] = { cik: String(v.cik_str).padStart(10, '0'), name: v.title };
      map = { map: m, fetchedAt: new Date().toISOString() };
      await ctx.db.put(key, map);
    }
    const s = symbol.toUpperCase().replace('.', '-');
    return map.map[s] || map.map[symbol.toUpperCase()] || null;
  },
  async facts(symbol, _o, ctx){
    const c = await this.cikFor(symbol, ctx);
    if (!c) return { missing: true, reason: 'EDGAR: אין CIK (לא חברה אמריקאית מדווחת?)' };
    await ctx.budget.spend('edgar');
    const j = await getJSON('edgar', `https://data.sec.gov/api/xbrl/companyfacts/CIK${c.cik}.json`, { headers: UA(ctx.env) }, 25000);
    const n = normalizeCompanyFacts(j);
    if (!Object.keys(n.series).length) return { missing: true, reason: 'EDGAR: אין תגיות us-gaap מוכרות' };
    const last = Object.values(n.series).flat().reduce((m, f) => (f.filed > m ? f.filed : m), '');
    return { ...n, asOf: last };
  },
  async filings(symbol, _o, ctx){
    const c = await this.cikFor(symbol, ctx);
    if (!c) return { missing: true, reason: 'EDGAR: אין CIK' };
    await ctx.budget.spend('edgar');
    const j = await getJSON('edgar', `https://data.sec.gov/submissions/CIK${c.cik}.json`, { headers: UA(ctx.env) }, 20000);
    const r = j?.filings?.recent || {};
    const items = [];
    for (let i = 0; i < (r.form || []).length && items.length < 40; i++){
      const form = r.form[i];
      if (!/^(8-K|10-K|10-Q|6-K|20-F|4|SC 13D|SC 13G|DEF 14A)$/.test(form)) continue;
      const acc = (r.accessionNumber[i] || '').replace(/-/g, '');
      const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(c.cik, 10)}/${acc}/${r.primaryDocument[i] || ''}`;
      const label = { '8-K': 'דיווח מיידי (8-K)', '10-K': 'דוח שנתי (10-K)', '10-Q': 'דוח רבעוני (10-Q)', 4: 'עסקת בעל עניין (Form 4)', '6-K': 'דיווח (6-K)', '20-F': 'דוח שנתי (20-F)', 'SC 13D': 'החזקה מהותית (13D)', 'SC 13G': 'החזקה מהותית (13G)', 'DEF 14A': 'זימון אסיפה' }[form] || form;
      items.push({ id: 'sec' + acc, title: `${c.name}: ${label}${r.items?.[i] ? ' — ' + r.items[i] : ''}`, url, publisher: 'SEC EDGAR', publishedAt: r.filingDate[i] + 'T00:00:00Z', summary: `טופס ${form}. ${r.primaryDocDescription?.[i] || ''}`, source: 'edgar', form });
    }
    return { items, cik: c.cik, source: 'edgar', asOf: new Date().toISOString().slice(0, 10), quality: 1 };
  },
};
