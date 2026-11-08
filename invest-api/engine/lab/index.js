// נקודת כניסה אחת למעבדה (לייבוא ב-Web Worker / Node / Cloudflare Worker)
export * from './data.js';
export { FEATURES, FeatureCache, featureKey, featureLabel } from './features.js';
export { compile, describe, normalizeNode } from './rules.js';
export { normalizeSpec, explainSpec, ENTRY_TIMINGS, EXIT_TYPES, SIZING_MODES, COST_PRESETS } from './schema.js';
export { simulate, buildAssumptions } from './simulate.js';
export { createSignalEngine, scanAt, fmtFeature } from './signals.js';
export { analyze, seriesMetrics, tradeMetrics, breakdowns, periodicReturns, drawdownSeries, dailyReturns } from './metrics.js';
export { optimize, walkForward, monteCarlo, significance, periodBreakdown, expandGrid, applyParams, runGrid, OBJECTIVES, CRISIS_PERIODS, splitPeriod } from './optimize.js';
export { LIBRARY, CATEGORIES, byId } from './library.js';
export { parseFreeText, buildPrompt, parseModelJson } from './nlp.js';
