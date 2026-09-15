// מחוללי נתונים סינתטיים דטרמיניסטיים לבדיקות (בלי רשת).
export function rng(seed = 42){
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
export function tradingDates(n, start = '2015-01-02'){
  const out = []; const d = new Date(start + 'T00:00:00Z');
  while (out.length < n){ const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
// הליכה אקראית גיאומטרית עם drift; מחזירה rows [[date,o,h,l,c,v]]
export function syntheticRows({ n = 1500, start = '2015-01-02', price = 100, drift = 0.0004, vol = 0.015, seed = 7, volume = 5e6 } = {}){
  const r = rng(seed), dates = tradingDates(n, start), rows = [];
  let c = price;
  for (let i = 0; i < n; i++){
    const z = (r() + r() + r() + r() - 2) * Math.sqrt(3); // ~N(0,1)
    const o = c * (1 + (r() - 0.5) * vol * 0.5);
    c = Math.max(1, c * Math.exp(drift + vol * z));
    const h = Math.max(o, c) * (1 + r() * vol * 0.6), l = Math.min(o, c) * (1 - r() * vol * 0.6);
    rows.push([dates[i], +o.toFixed(2), +h.toFixed(2), +l.toFixed(2), +c.toFixed(2), Math.round(volume * (0.5 + r()))]);
  }
  return rows;
}
// עובדות בסגנון EDGAR מנורמלות: 6 שנים + רבעונים, עם filed ~45 יום אחרי end
export function syntheticFacts({ years = 6, rev0 = 1e9, growth = 0.12, margin = 0.15, shares = 1e8, fyEnd = '-12-31', startYear = 2018 } = {}){
  const series = { Revenue: [], NetIncome: [], EPSDiluted: [], OCF: [], Capex: [], Cash: [], LongTermDebt: [], Equity: [], Shares: [], EBIT: [], GrossProfit: [], InterestExpense: [] };
  const filedAfter = (end, days) => { const d = new Date(end + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  for (let y = 0; y < years; y++){
    const year = startYear + y, rev = rev0 * Math.pow(1 + growth, y), ni = rev * margin;
    const end = `${year}${fyEnd}`, start = `${year}-01-01`, filed = filedAfter(end, 55);
    const push = (k, val, extra = {}) => series[k].push({ start, end, val, filed, form: '10-K', fy: year, fp: 'FY', ...extra });
    push('Revenue', rev); push('NetIncome', ni); push('EPSDiluted', ni / shares); push('OCF', ni * 1.3); push('Capex', -ni * 0.3); push('EBIT', ni * 1.35); push('GrossProfit', rev * 0.45); push('InterestExpense', 2e7);
    series.Cash.push({ end, val: 3e8 + y * 5e7, filed, form: '10-K', fy: year, fp: 'FY' });
    series.LongTermDebt.push({ end, val: 4e8, filed, form: '10-K', fy: year, fp: 'FY' });
    series.Equity.push({ end, val: 2e9 + ni * y, filed, form: '10-K', fy: year, fp: 'FY' });
    series.Shares.push({ end, val: shares * Math.pow(0.99, y), filed, form: '10-K', fy: year, fp: 'FY' });
    // רבעונים Q1-Q3
    for (let q = 1; q <= 3; q++){
      const qs = `${year}-${String((q - 1) * 3 + 1).padStart(2, '0')}-01`, qe = `${year}-${String(q * 3).padStart(2, '0')}-${q === 1 ? '31' : q === 2 ? '30' : '30'}`;
      const f = filedAfter(qe, 40);
      series.Revenue.push({ start: qs, end: qe, val: rev / 4, filed: f, form: '10-Q', fy: year, fp: 'Q' + q });
      series.NetIncome.push({ start: qs, end: qe, val: ni / 4, filed: f, form: '10-Q', fy: year, fp: 'Q' + q });
      series.EPSDiluted.push({ start: qs, end: qe, val: ni / shares / 4, filed: f, form: '10-Q', fy: year, fp: 'Q' + q });
    }
  }
  return { source: 'EDGAR', cik: '0000000001', series };
}
export function macroSeries(n, start = 20, drift = 0, seed = 3, dates = null){
  const r = rng(seed); const ds = dates || tradingDates(n);
  let v = start; return ds.map((d) => { v = Math.max(0.1, v + (r() - 0.5) * 0.5 + drift); return [d, +v.toFixed(2)]; });
}
