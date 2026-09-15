// Web Worker: מריץ את ה-engine המשותף (invest-api/engine) בדפדפן — backtest, walk-forward, As-Of, ניתוח universe.
import { simulate, walkForward, multiPeriod, forwardReturns, STRATEGIES } from '../../invest-api/engine/backtest.js';
import { analyzeBundle, toSnapshot, rankSnapshots } from '../../invest-api/engine/pipeline.js';
import { classifyRegime } from '../../invest-api/engine/regime.js';
import { buildPortfolios } from '../../invest-api/engine/portfolio.js';
import { indicatorSeries } from '../../invest-api/engine/indicators.js';
import { scenarios, portfolioRisk } from '../../invest-api/engine/risk.js';

const tasks = {
  backtest: ({ rows, strategy, params, costs, start, end, facts, profile, weights, rf }) => {
    const ctx = { facts: facts || null, profile, weights, rf };
    const r = simulate({ rows, strategy, params, costs, start, end, ctx });
    const periods = multiPeriod({ rows, strategy, params, costs, ctx });
    const wf = strategy === 'buyhold' ? null : walkForward({ rows, strategy, costs, ctx });
    return { result: r, periods, walkForward: wf, strategies: STRATEGIES };
  },
  indicators: ({ rows }) => indicatorSeries(rows),
  analyzeOne: ({ bundle, regime, benchRows, techRows, dgs10Rows, weights }) => { const a = analyzeBundle(bundle, { regime, benchRows, techRows, dgs10Rows, weights }); return { ...a, snapshot: toSnapshot(a), computedBy: 'browser' }; },
  asof: ({ bundles, date, regime, benchRows, dgs10Rows, weights, sizeIls, usdils }, post) => {
    const analyses = [], snaps = [];
    bundles.forEach((b, i) => {
      const a = analyzeBundle(b, { asOfDate: date, regime, benchRows, dgs10Rows, weights });
      const fwd = b.prices?.rows ? forwardReturns(b.prices.rows, date) : null;
      analyses.push({ symbol: b.asset.symbol, analysis: a.missing ? a : { score: a.score, signal: a.signal, price: a.price, technical: { trend: a.technical.trend, rsi: a.technical.rsi }, metrics: a.metrics && { pe: a.metrics.pe, asOf: a.metrics.asOf } }, forward: fwd });
      snaps.push(toSnapshot(a));
      post((i + 1) / bundles.length);
    });
    const rank = rankSnapshots(snaps);
    const seriesMap = Object.fromEntries(bundles.filter((b) => b.prices?.rows).map((b) => [b.asset.symbol, b.prices.rows.filter((r) => r[0] <= date).slice(-300)]));
    const cands = rank.table.filter((s) => s.signal !== 'NO SIGNAL').map((s) => ({ symbol: s.symbol, name: s.name, score: s.score, signal: s.signal, type: s.type, assetClass: s.assetClass || 'equity', role: s.role || (s.type === 'etf' ? 'core' : 'satellite'), sector: s.sector, country: s.country, currency: s.currency, vol: s.vol1y, maxDD: s.maxDD1y, beta: s.beta, pe: s.pe, techBeta: s.techBeta, avoid: rank.categories.avoid.includes(s.symbol) }));
    const reco = buildPortfolios({ candidates: cands, seriesMap, sizeIls: sizeIls || 200000, usdils, benchRows: benchRows?.filter((r) => r[0] <= date).slice(-300) });
    // תשואת התיקים בפועל אחרי התאריך
    for (const p of Object.values(reco.profiles)){
      p.forward = {};
      for (const h of ['m1', 'm3', 'm6', 'm12']){ let tot = 0, cov = 0; for (const pos of p.positions){ const f = analyses.find((a) => a.symbol === pos.symbol)?.forward?.[h]; if (f){ tot += pos.weight * f.ret; cov += pos.weight; } } p.forward[h] = cov > 0.3 ? { ret: tot, coverage: cov } : null; }
    }
    const bench = benchRows ? forwardReturns(benchRows, date) : null;
    return { analyses, rank, reco, snaps, benchForward: bench };
  },
  analyzeAll: ({ bundles, regime, benchRows, techRows, dgs10Rows, weights, sizeIls, usdils }, post) => {
    const snaps = [];
    bundles.forEach((b, i) => { snaps.push(toSnapshot(analyzeBundle(b, { regime, benchRows, techRows, dgs10Rows, weights }))); post((i + 1) / bundles.length); });
    const rank = rankSnapshots(snaps);
    const seriesMap = Object.fromEntries(bundles.filter((b) => b.prices?.rows).map((b) => [b.asset.symbol, b.prices.rows.slice(-300)]));
    const cands = rank.table.filter((s) => s.signal !== 'NO SIGNAL').map((s) => ({ symbol: s.symbol, name: s.name, score: s.score, signal: s.signal, type: s.type, assetClass: s.assetClass || 'equity', role: s.role || (s.type === 'etf' ? 'core' : 'satellite'), sector: s.sector, country: s.country, currency: s.currency, vol: s.vol1y, maxDD: s.maxDD1y, beta: s.beta, pe: s.pe, techBeta: s.techBeta, avoid: rank.categories.avoid.includes(s.symbol) }));
    const reco = buildPortfolios({ candidates: cands, seriesMap, sizeIls: sizeIls || 200000, usdils, benchRows: benchRows?.slice(-300) });
    return { snaps, rank, reco };
  },
  regime: ({ indices, macro, breadth, date }) => classifyRegime({ indices, macro, breadth, date }),
  portfolioRisk: ({ weights, seriesMap, meta, benchRows, positions, sizeIls }) => { const r = portfolioRisk({ weights, seriesMap, meta, benchRows }); return { risk: r, scenarios: scenarios({ positions, risk: r, sizeIls }) }; },
};
self.onmessage = (e) => {
  const { id, task, payload } = e.data;
  try { const post = (p) => self.postMessage({ id, progress: p }); const result = tasks[task](payload, post); self.postMessage({ id, result }); }
  catch (err) { self.postMessage({ id, error: err.message || String(err) }); }
};
