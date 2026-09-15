// מנוע סיכון: מדדי נכס, מדדי תיק (ריכוזיות/קורלציה), תרחישים ו-stress.
import { isNum, round, mean, std, correlation, beta as betaFn, daysBetween } from './util.js';
import { closes, returns, annualizedVol, drawdowns } from './indicators.js';

// יישור סדרות לפי תאריכים משותפים → תשואות יומיות
export function alignedReturns(seriesMap, lookback = 252){
  const keys = Object.keys(seriesMap).filter((k) => seriesMap[k]?.length);
  if (!keys.length) return { dates: [], returns: {} };
  const maps = keys.map((k) => new Map(seriesMap[k].map((r) => [r[0], r[4] ?? r[1]])));
  let dates = [...maps[0].keys()].filter((d) => maps.every((m) => m.has(d)));
  dates = dates.sort().slice(-(lookback + 1));
  const rets = {};
  keys.forEach((k, idx) => {
    const m = maps[idx];
    rets[k] = [];
    for (let i = 1; i < dates.length; i++) rets[k].push(m.get(dates[i]) / m.get(dates[i - 1]) - 1);
  });
  return { dates: dates.slice(1), returns: rets };
}

export function assetRisk({ rows, benchRows, techRows, earningsDate, asOfDate, currency = 'USD', baseCurrency = 'ILS' }){
  if (!rows || rows.length < 60) return { missing: true, reason: 'פחות מ-60 ימי מסחר' };
  const c = closes(rows);
  const vol1y = annualizedVol(c, 252), vol3m = annualizedVol(c, 63);
  const dd = drawdowns(c.slice(-252));
  const dd3y = drawdowns(c.slice(-756));
  let beta = null, corr = null, techBeta = null;
  if (benchRows?.length){
    const a = alignedReturns({ a: rows, b: benchRows }, 252);
    beta = betaFn(a.returns.a, a.returns.b); corr = correlation(a.returns.a, a.returns.b);
  }
  if (techRows?.length){ const a = alignedReturns({ a: rows, q: techRows }, 252); techBeta = betaFn(a.returns.a, a.returns.q); }
  const last = rows.slice(-252);
  let gaps = 0;
  for (let i = 1; i < last.length; i++){ const g = Math.abs(last[i][1] / last[i - 1][4] - 1); if (g > 0.05) gaps++; }
  const gapRate = last.length > 1 ? gaps / (last.length - 1) : null;
  const dv = mean(rows.slice(-20).map((r) => r[4] * (r[5] || 0)));
  const ref = asOfDate || rows[rows.length - 1][0];
  const earningsInDays = earningsDate ? daysBetween(ref, earningsDate) : null;
  const level = (x, lo, hi) => (!isNum(x) ? 'לא ידוע' : x <= lo ? 'נמוך' : x <= hi ? 'בינוני' : 'גבוה');
  return {
    vol1y: round(vol1y, 4), vol3m: round(vol3m, 4), beta: round(beta, 2), correlationToBenchmark: round(corr, 2), techBeta: round(techBeta, 2),
    maxDrawdown1y: round(dd.maxDrawdown, 4), maxDrawdown3y: round(dd3y.maxDrawdown, 4), currentDrawdown: round(dd.series[dd.series.length - 1], 4),
    avgDollarVolume20: round(dv, 0), liquidity: !isNum(dv) ? 'לא ידוע' : dv > 5e7 ? 'גבוהה' : dv > 2e6 ? 'בינונית' : 'נמוכה',
    gapRate: round(gapRate, 4), gapRisk: level(gapRate, 0.01, 0.03),
    earningsInDays, earningsRisk: isNum(earningsInDays) && earningsInDays >= 0 && earningsInDays <= 14 ? 'גבוה (דוח קרוב)' : isNum(earningsInDays) ? 'נמוך' : 'לא ידוע',
    currency, currencyRisk: currency !== baseCurrency ? `חשיפה ל-${currency}/${baseCurrency}` : 'אין',
    volLevel: level(vol1y, 0.2, 0.4), summary: `תנודתיות ${level(vol1y, 0.2, 0.4)}, בטא ${isNum(beta) ? round(beta, 2) : '—'}, DD שנה ${isNum(dd.maxDrawdown) ? round(dd.maxDrawdown * 100, 0) + '%' : '—'}`,
  };
}

// סיכון תיק: משקלים {sym: w}, תשואות מיושרות, מטא (currency, sector, country)
export function portfolioRisk({ weights, seriesMap, meta = {}, benchRows, usdilsRows }){
  const syms = Object.keys(weights).filter((s) => seriesMap[s]?.length);
  const a = alignedReturns(Object.fromEntries(syms.map((s) => [s, seriesMap[s]])), 504);
  const n = a.dates.length;
  if (!syms.length || n < 40) return { missing: true, reason: 'אין מספיק היסטוריה משותפת' };
  const wsum = syms.reduce((s, k) => s + weights[k], 0) || 1;
  const w = Object.fromEntries(syms.map((s) => [s, weights[s] / wsum]));
  const port = [];
  for (let i = 0; i < n; i++) port.push(syms.reduce((s, k) => s + w[k] * a.returns[k][i], 0));
  const vol = std(port) * Math.sqrt(252);
  let eq = 1; const curve = port.map((r) => (eq *= 1 + r));
  const dd = drawdowns(curve);
  const corr = {};
  for (const x of syms){ corr[x] = {}; for (const y of syms) corr[x][y] = round(correlation(a.returns[x], a.returns[y]), 2); }
  const offDiag = syms.flatMap((x) => syms.filter((y) => y > x).map((y) => corr[x][y])).filter(isNum);
  const hhi = syms.reduce((s, k) => s + w[k] ** 2, 0);
  let beta = null;
  if (benchRows?.length){
    const ab = alignedReturns({ p: null, b: benchRows }, 504);
    // ממוצע משוקלל של בטא נכסים מול benchmark
    const betas = syms.map((k) => { const al = alignedReturns({ a: seriesMap[k], b: benchRows }, 252); return betaFn(al.returns.a, al.returns.b); });
    beta = syms.reduce((s, k, i) => s + (isNum(betas[i]) ? w[k] * betas[i] : 0), 0);
  }
  const by = (field) => { const m = {}; for (const k of syms){ const key = meta[k]?.[field] || 'לא ידוע'; m[key] = round((m[key] || 0) + w[k], 4); } return m; };
  const currencyExp = by('currency');
  return {
    volatility: round(vol, 4), maxDrawdown: round(dd.maxDrawdown, 4), beta: round(beta, 2), avgCorrelation: round(mean(offDiag), 2), correlation: corr,
    concentrationHHI: round(hhi, 3), effectiveN: round(1 / hhi, 1), largestPosition: round(Math.max(...syms.map((k) => w[k])), 4),
    sectorExposure: by('sector'), geoExposure: by('country'), currencyExposure: currencyExp, assetClassExposure: by('assetClass'),
    usdExposure: round(currencyExp.USD || 0, 4), days: n,
  };
}

// תרחישים: שימוש בבטות ואלסטיות היסטוריות בלבד — אומדן, לא תחזית.
export function scenarios({ positions, risk, sizeIls, usdils, rateSensitivity = {} }){
  const total = sizeIls || positions.reduce((s, p) => s + (p.ils || 0), 0) || 1;
  const usdShare = positions.filter((p) => p.currency === 'USD').reduce((s, p) => s + (p.ils || 0), 0) / total;
  const b = isNum(risk?.beta) ? risk.beta : 1;
  const techW = positions.filter((p) => /tech/i.test(p.sector || '') || /QQQ|XLK|SMH|SOXX|ARKK/.test(p.symbol)).reduce((s, p) => s + (p.ils || 0), 0) / total;
  const techBeta = mean(positions.map((p) => p.techBeta).filter(isNum)) ?? 1.2;
  const bondW = positions.filter((p) => p.assetClass === 'bond').reduce((s, p) => s + (p.ils || 0), 0) / total;
  const bondDur = rateSensitivity.duration ?? 7; // משך ממוצע לאג"ח ממשלתי בינוני
  const growthW = positions.filter((p) => p.assetClass === 'equity' && (p.pe > 30 || p.peNegative)).reduce((s, p) => s + (p.ils || 0), 0) / total;
  const mk = (id, label, pct, how) => ({ id, label, impactPct: round(pct, 4), impactIls: Math.round(pct * total), how });
  return [
    mk('mkt10', 'שוק −10%', -0.10 * b, `בטא תיק ${round(b, 2)} × −10%`),
    mk('mkt20', 'שוק −20%', -0.20 * b, `בטא תיק ${round(b, 2)} × −20%`),
    mk('tech25', 'טכנולוגיה −25%', -0.25 * techW * techBeta - 0.25 * 0.35 * (1 - techW) * b, `משקל טק ${round(techW * 100, 0)}% × בטא-טק ${round(techBeta, 2)} + זליגה 35% לשאר`),
    mk('ilsUp10', 'USD/ILS −10% (שקל מתחזק)', -0.10 * usdShare, `חשיפה דולרית ${round(usdShare * 100, 0)}% × −10%`),
    mk('ilsDown10', 'USD/ILS +10% (שקל נחלש)', 0.10 * usdShare, `חשיפה דולרית ${round(usdShare * 100, 0)}% × +10%`),
    mk('rates+1', 'ריבית +1% (זעזוע)', -bondDur * 0.01 * bondW - 0.08 * growthW, `אג"ח: משך ${bondDur} × 1% × ${round(bondW * 100, 0)}% ; מניות צמיחה יקרות (${round(growthW * 100, 0)}%) × −8% (אמפירי 2022)`),
    mk('rates-1', 'ריבית −1%', bondDur * 0.01 * bondW + 0.05 * growthW, 'תמונת ראי חלקית של זעזוע העלאה'),
  ].map((s) => ({ ...s, kind: 'MODEL ESTIMATE' }));
}
