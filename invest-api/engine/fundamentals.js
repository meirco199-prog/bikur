// פונדמנטלס: נרמול סדרות דוחות (EDGAR/FMP) עם point-in-time (filed ≤ date), TTM, צמיחה ויחסים.
// מבנה facts.series[metric] = [{end, start?, val, filed, form, fy, fp}] (ממוין לפי end עולה).
import { isNum, round, pctChange, cagr, daysBetween, mean, std } from './util.js';

export const FLOW = ['Revenue', 'NetIncome', 'EPSDiluted', 'OCF', 'Capex', 'EBIT', 'DA', 'Dividends', 'GrossProfit', 'InterestExpense', 'CostOfRevenue', 'OperatingIncome'];
export const INSTANT = ['Cash', 'LongTermDebt', 'TotalDebt', 'Equity', 'Shares', 'TotalAssets', 'CurrentLiabilities'];

// point-in-time: רק עובדות שהוגשו עד התאריך. זה הבסיס למניעת look-ahead ב-As-Of ו-backtest.
export function asOf(facts, date){
  if (!facts || !facts.series) return facts;
  if (!date) return facts;
  const series = {};
  for (const [k, arr] of Object.entries(facts.series)){
    series[k] = (arr || []).filter((f) => !f.filed || f.filed <= date);
  }
  return { ...facts, series, asOfDate: date };
}

function duration(f){
  if (!f.start) return null;
  return daysBetween(f.start, f.end);
}

// ערכים שנתיים (משך ~שנה), אחד לכל תאריך סיום (הגרסה שהוגשה אחרונה גוברת — restatement)
export function annual(facts, metric){
  const arr = (facts?.series?.[metric] || []).filter((f) => { const d = duration(f); return d !== null && d > 340 && d < 380; });
  const byEnd = new Map();
  for (const f of arr){
    const prev = byEnd.get(f.end);
    if (!prev || (f.filed || '') > (prev.filed || '')) byEnd.set(f.end, f);
  }
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}

// ערכים רבעוניים (משך ~רבעון)
export function quarterly(facts, metric){
  const arr = (facts?.series?.[metric] || []).filter((f) => { const d = duration(f); return d !== null && d > 75 && d < 105; });
  const byEnd = new Map();
  for (const f of arr){
    const prev = byEnd.get(f.end);
    if (!prev || (f.filed || '') > (prev.filed || '')) byEnd.set(f.end, f);
  }
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}

// ערכים נקודתיים (מאזן)
export function instants(facts, metric){
  const arr = (facts?.series?.[metric] || []).filter((f) => !f.start);
  const byEnd = new Map();
  for (const f of arr){
    const prev = byEnd.get(f.end);
    if (!prev || (f.filed || '') > (prev.filed || '')) byEnd.set(f.end, f);
  }
  return [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
}

export function latestInstant(facts, metric){
  const a = instants(facts, metric);
  return a.length ? a[a.length - 1] : null;
}

// TTM: שנה אחרונה + רבעונים שאחריה − רבעונים מקבילים בשנה הקודמת.
// אם אין רבעונים מספקים — מחזיר את השנה המלאה האחרונה ומסמן basis:'FY'.
export function ttm(facts, metric){
  const ann = annual(facts, metric);
  const qs = quarterly(facts, metric);
  if (!ann.length && qs.length >= 4){
    const last4 = qs.slice(-4);
    return { value: last4.reduce((s, f) => s + f.val, 0), end: last4[3].end, basis: 'Q4sum', filed: last4[3].filed };
  }
  if (!ann.length) return null;
  const fy = ann[ann.length - 1];
  const after = qs.filter((q) => q.end > fy.end);
  if (!after.length) return { value: fy.val, end: fy.end, basis: 'FY', filed: fy.filed };
  // רבעונים מקבילים בשנה הקודמת: לפי מספר הרבעונים אחרי סוף השנה
  const n = Math.min(after.length, 3);
  const recent = after.slice(-n);
  const fyStartPrev = new Date(fy.end + 'T00:00:00Z'); fyStartPrev.setUTCFullYear(fyStartPrev.getUTCFullYear() - 1);
  const prevYearQs = qs.filter((q) => q.end > fyStartPrev.toISOString().slice(0, 10) && q.end <= fy.end);
  const prevMatch = prevYearQs.slice(0, n);
  if (prevMatch.length !== n) return { value: fy.val, end: fy.end, basis: 'FY', filed: fy.filed, note: 'אין רבעונים מקבילים — משתמש בשנה מלאה' };
  const v = fy.val + recent.reduce((s, f) => s + f.val, 0) - prevMatch.reduce((s, f) => s + f.val, 0);
  return { value: v, end: recent[recent.length - 1].end, basis: 'TTM', filed: recent[recent.length - 1].filed };
}

const safeDiv = (a, b) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null);

// מחשב את כל המדדים מהדוחות + מחיר. sharesOut/ratios (מספק חיצוני) אופציונליים.
export function computeMetrics(facts, { price, sharesOut, ratios, marketCap } = {}){
  if (!facts || !facts.series || !Object.keys(facts.series).length) return { missing: true, reason: 'אין דוחות כספיים' };
  const src = facts.source || 'EDGAR';
  const g = (m) => ttm(facts, m);
  const rev = g('Revenue'), ni = g('NetIncome'), eps = g('EPSDiluted'), ocf = g('OCF'), capex = g('Capex');
  const ebit = g('EBIT') || g('OperatingIncome'), da = g('DA'), gp = g('GrossProfit'), intExp = g('InterestExpense'), div = g('Dividends');
  const cash = latestInstant(facts, 'Cash'), debtLT = latestInstant(facts, 'LongTermDebt'), debtT = latestInstant(facts, 'TotalDebt');
  const equity = latestInstant(facts, 'Equity'), shares = latestInstant(facts, 'Shares');

  const revenue = rev?.value ?? null;
  const netIncome = ni?.value ?? null;
  const fcf = isNum(ocf?.value) ? ocf.value - Math.abs(capex?.value || 0) : null;
  const totalDebt = debtT?.value ?? debtLT?.value ?? null;
  const cashV = cash?.value ?? null;
  const netDebt = isNum(totalDebt) ? totalDebt - (cashV || 0) : null;
  const sh = sharesOut || shares?.val || null;
  const mcap = marketCap || (isNum(price) && isNum(sh) ? price * sh : null);
  const ebitda = isNum(ebit?.value) ? ebit.value + (da?.value || 0) : null;
  const ev = isNum(mcap) ? mcap + (netDebt || 0) : null;
  const epsV = eps?.value ?? (isNum(netIncome) && isNum(sh) ? netIncome / sh : null);

  // צמיחה: שנתי
  const revA = annual(facts, 'Revenue'), epsA = annual(facts, 'EPSDiluted'), niA = annual(facts, 'NetIncome');
  const ocfA = annual(facts, 'OCF'), capA = annual(facts, 'Capex');
  const fcfA = ocfA.map((o) => { const c = capA.find((x) => x.end === o.end); return { end: o.end, val: o.val - Math.abs(c?.val || 0) }; });
  const growthYoY = (arr) => (arr.length >= 2 ? pctChange(arr[arr.length - 1].val, arr[arr.length - 2].val) : null);
  const growth3y = (arr) => (arr.length >= 4 ? cagr(arr[arr.length - 1].val, arr[arr.length - 4].val, 3) : null);
  // TTM YoY: השוואת TTM לערך TTM לפני שנה — נשתמש בשנתי כברירת מחדל (יציב)
  const revGrowth = growthYoY(revA), epsGrowth = growthYoY(epsA), fcfGrowth3y = growth3y(fcfA);
  const declines = revA.slice(-5).filter((f, i, a) => i > 0 && f.val < a[i - 1].val).length;

  // ROIC ממוצע 3 שנים: EBIT×(1−21%)/(Equity+Debt)
  const ebitA = annual(facts, 'EBIT').length ? annual(facts, 'EBIT') : annual(facts, 'OperatingIncome');
  const eqI = instants(facts, 'Equity'), dI = instants(facts, 'TotalDebt').length ? instants(facts, 'TotalDebt') : instants(facts, 'LongTermDebt');
  const roicHist = ebitA.slice(-3).map((e) => {
    const eq = eqI.find((x) => x.end === e.end), d = dI.find((x) => x.end === e.end);
    const cap = (eq?.val || 0) + (d?.val || 0);
    return cap > 0 ? (e.val * 0.79) / cap : null;
  }).filter(isNum);
  const gmHist = annual(facts, 'GrossProfit').slice(-5).map((gpv) => { const r = revA.find((x) => x.end === gpv.end); return r && r.val ? gpv.val / r.val : null; }).filter(isNum);
  const shA = instants(facts, 'Shares');
  const dilution3y = shA.length >= 4 ? cagr(shA[shA.length - 1].val, shA[shA.length - 4].val, 3) : null;
  const divA = annual(facts, 'Dividends');
  const divGrowth5y = divA.length >= 6 && divA[divA.length - 6].val > 0 ? cagr(Math.abs(divA[divA.length - 1].val), Math.abs(divA[divA.length - 6].val), 5) : null;
  const divPerShare = isNum(div?.value) && isNum(sh) && sh > 0 ? Math.abs(div.value) / sh : null;

  const m = {
    source: src, asOf: rev?.end || ni?.end || null, filed: rev?.filed || null, basis: rev?.basis || null,
    revenue, revenueGrowth: revGrowth, revenueCagr3y: growth3y(revA), revenueDeclines5y: declines,
    eps: epsV, epsGrowth, netIncome, netIncomeGrowth: growthYoY(niA),
    grossMargin: safeDiv(gp?.value, revenue), operatingMargin: safeDiv(ebit?.value, revenue), netMargin: safeDiv(netIncome, revenue),
    fcf, fcfMargin: safeDiv(fcf, revenue), fcfGrowth3y,
    cash: cashV, totalDebt, netDebt, equity: equity?.val ?? null, shares: sh,
    roe: safeDiv(netIncome, equity?.val), roic: roicHist.length ? roicHist[roicHist.length - 1] : null, roicAvg3y: roicHist.length ? mean(roicHist) : null,
    netDebtToEbitda: safeDiv(netDebt, ebitda), netDebtToEquity: safeDiv(netDebt, equity?.val),
    interestCoverage: isNum(intExp?.value) && intExp.value !== 0 ? safeDiv(ebit?.value, Math.abs(intExp.value)) : null,
    cashConversion: safeDiv(fcf, netIncome), grossMarginStd5y: gmHist.length >= 3 ? std(gmHist) : null,
    dilution3y, dividendGrowth5y: divGrowth5y, dividendPerShare: divPerShare,
    marketCap: mcap, ev, ebitda,
    pe: isNum(epsV) && epsV > 0 && isNum(price) ? price / epsV : (isNum(epsV) && epsV <= 0 ? null : null),
    peNegative: isNum(epsV) && epsV <= 0,
    ps: safeDiv(mcap, revenue), evEbitda: isNum(ebitda) && ebitda > 0 ? safeDiv(ev, ebitda) : null,
    fcfYield: isNum(mcap) && mcap > 0 ? safeDiv(fcf, mcap) : null,
    dividendYield: isNum(divPerShare) && isNum(price) && price > 0 ? divPerShare / price : null,
    history: {
      revenue: revA.map((f) => [f.end, f.val]), eps: epsA.map((f) => [f.end, f.val]), netIncome: niA.map((f) => [f.end, f.val]),
      fcf: fcfA.map((f) => [f.end, f.val]),
    },
    derived: true,
  };
  // השלמה מספק חיצוני (FMP/AV) לשדות שאין לנו: forward PE, PEG, ו-fallback לחסרים. מסומן per-field.
  m.fields = {};
  const ext = ratios || {};
  const fill = (key, extKey) => {
    if (isNum(m[key])) { m.fields[key] = { source: src, kind: 'derived' }; return; }
    if (isNum(ext[extKey || key])){ m[key] = ext[extKey || key]; m.fields[key] = { source: ext.source || 'provider', kind: 'provider' }; }
  };
  ['revenue', 'revenueGrowth', 'eps', 'epsGrowth', 'netIncome', 'grossMargin', 'operatingMargin', 'netMargin', 'fcf', 'fcfMargin', 'cash', 'totalDebt', 'netDebt', 'roe', 'roic', 'pe', 'ps', 'evEbitda', 'fcfYield', 'dividendYield', 'netDebtToEbitda', 'marketCap'].forEach((k) => fill(k));
  if (isNum(ext.forwardPe)){ m.forwardPe = ext.forwardPe; m.fields.forwardPe = { source: ext.source, kind: 'estimate' }; }
  if (isNum(ext.peg)){ m.peg = ext.peg; m.fields.peg = { source: ext.source, kind: 'estimate' }; }
  else if (isNum(m.pe) && isNum(epsGrowth) && epsGrowth > 0){ m.peg = m.pe / (epsGrowth * 100); m.fields.peg = { source: src, kind: 'derived' }; }
  if (isNum(ext.beta)) m.beta = ext.beta;
  return m;
}

// היסטוריית P/E: לכל תאריך מחיר, EPS TTM לפי הדוח האחרון שהיה ידוע (filed ≤ date) — נכון מבחינת point-in-time
export function peHistory(facts, rows, step = 5){
  const epsA = annual(facts, 'EPSDiluted');
  if (!epsA.length || !rows?.length) return [];
  const out = [];
  for (let i = 0; i < rows.length; i += step){
    const date = rows[i][0];
    // EPS ידוע לתאריך: השנתי האחרון שהוגש עד date
    let known = null;
    for (const f of epsA){ if ((f.filed || f.end) <= date) known = f; }
    if (known && known.val > 0) out.push([date, rows[i][4] / known.val]);
  }
  return out;
}
