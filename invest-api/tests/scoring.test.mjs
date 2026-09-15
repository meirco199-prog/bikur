import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore, DEFAULT_WEIGHTS, scoreAnalyst, weightsVersion } from '../engine/scoring.js';
import { deriveSignal, levels } from '../engine/signals.js';
import { technicalSnapshot } from '../engine/indicators.js';
import { computeMetrics } from '../engine/fundamentals.js';
import { fairValue } from '../engine/valuation.js';
import { classifyRegime } from '../engine/regime.js';
import { syntheticRows, syntheticFacts, macroSeries, tradingDates } from './helpers.mjs';

const facts = syntheticFacts({ growth: 0.15, margin: 0.2 });
const rows = syntheticRows({ n: 1500, start: '2019-01-02', price: 30, drift: 0.0008, vol: 0.012 });
const price = rows.at(-1)[4];
const t = technicalSnapshot(rows);
const m = computeMetrics(facts, { price });
const fv = fairValue({ metrics: m, rows, facts, price, macro: { dgs10: 4 } });
const dates = rows.map((r) => r[0]);
const regime = classifyRegime({ indices: { SPX: rows }, macro: { VIXCLS: macroSeries(1500, 16, 0, 1, dates), DGS10: macroSeries(1500, 4, 0, 2, dates), DGS2: macroSeries(1500, 3.5, 0, 3, dates), BAMLH0A0HYM2: macroSeries(1500, 3.5, 0, 4, dates) }, breadth: 0.7 });
const analyst = { strongBuy: 10, buy: 8, hold: 4, sell: 1, strongSell: 0, total: 23, price, targets: { median: price * 1.25, avg: price * 1.2 }, source: 'finnhub' };
const sentiment = { value: 65, reasons: ['5 ידיעות'], count: 5 };

test('computeScore: ציון 0–100, כיסוי מלא כשכל הרכיבים קיימים', () => {
  const s = computeScore({ metrics: m, technical: t, fair: fv, analyst, sentiment, regime, profile: { type: 'stock', sector: 'Technology', currency: 'USD' }, riskExtras: { currency: 'USD', baseCurrency: 'ILS' } });
  assert.ok(s.total >= 0 && s.total <= 100);
  assert.equal(s.coverage, 1);
  assert.equal(s.missing.length, 0);
  for (const c of Object.values(s.components)){ assert.ok(!c.missing); assert.ok(c.reasons.length > 0, c.label); assert.ok(c.value >= 0 && c.value <= 100); }
  assert.equal(s.weightsVersion, weightsVersion(DEFAULT_WEIGHTS));
});
test('computeScore: רכיבים חסרים מורידים כיסוי, המשקלים מנורמלים', () => {
  const s = computeScore({ technical: t, regime, profile: { type: 'etf' } });
  assert.ok(s.coverage < 1 && s.coverage > 0);
  assert.ok(s.missing.some((x) => x.component === 'fundamental'));
  assert.ok(s.total !== null);
});
test('משקלים מותאמים אישית משנים את הציון והגרסה', () => {
  const w = { ...DEFAULT_WEIGHTS, momentum: 40, valuation: 1 };
  const a = computeScore({ metrics: m, technical: t, fair: fv, analyst, sentiment, regime, profile: {} });
  const b = computeScore({ metrics: m, technical: t, fair: fv, analyst, sentiment, regime, profile: {} }, w);
  assert.notEqual(a.weightsVersion, b.weightsVersion);
});
test('scoreAnalyst: מדגם קטן מוקטן ×0.6', () => {
  const big = scoreAnalyst({ strongBuy: 10, buy: 5, hold: 2, sell: 0, strongSell: 0, total: 17, price: 100, targets: { median: 120 } });
  const small = scoreAnalyst({ strongBuy: 2, buy: 1, hold: 0, sell: 0, strongSell: 0, total: 3, price: 100, targets: { median: 120 } });
  assert.ok(small.value < big.value);
  assert.equal(big.kind, 'ANALYST OPINION');
});
test('deriveSignal: NO SIGNAL כשאין 200 ימים', () => {
  const short = syntheticRows({ n: 120 });
  const ts = technicalSnapshot(short);
  const s = computeScore({ technical: ts, regime });
  const sig = deriveSignal({ score: s, technical: ts, regime, price: short.at(-1)[4] });
  assert.equal(sig.label, 'NO SIGNAL');
});
test('deriveSignal: כיסוי נמוך → NO SIGNAL, כיסוי מלא → סיגנל עם רמות ו-WHY', () => {
  const low = computeScore({ technical: t }, { ...DEFAULT_WEIGHTS, technical: 5, momentum: 5, risk: 5 });
  assert.equal(deriveSignal({ score: low, technical: t, price }).label, 'NO SIGNAL');
  const s = computeScore({ metrics: m, technical: t, fair: fv, analyst, sentiment, regime, profile: { type: 'stock', currency: 'USD' } });
  const sig = deriveSignal({ score: s, technical: t, fair: fv, regime, profile: { type: 'stock' }, price });
  assert.ok(['STRONG BUY', 'BUY', 'WATCH', 'HOLD', 'REDUCE', 'SELL'].includes(sig.label), sig.label);
  assert.ok(sig.levels.entryZone[0] <= sig.levels.entryZone[1]);
  assert.ok(sig.levels.stop < price);
  assert.ok(sig.levels.targets[1] >= sig.levels.targets[0]);
  assert.ok(sig.why.length >= 1 && sig.top5.length === 5 && sig.risks.length >= 1 && sig.contradict.length >= 1);
  assert.equal(sig.kind, 'MODEL SIGNAL');
});
test('deriveSignal: ציון נמוך מאוד → SELL', () => {
  const bad = { ...computeScore({ metrics: m, technical: t, regime }), total: 20, confidence: 0.8, coverage: 0.9 };
  assert.equal(deriveSignal({ score: bad, technical: t, price }).label, 'SELL');
});
test('levels: R/R מחושב, invalidation מתחת למחיר', () => {
  const lv = levels({ technical: t, fair: fv, isEtf: false, price });
  assert.ok(lv.invalidation < price && lv.stop < price && lv.stop >= lv.invalidation);
  assert.ok(lv.rr === null || lv.rr > 0);
});
test('classifyRegime: מחזיר סיווג, כללים גלויים ו-Fear&Greed', () => {
  assert.ok(['Risk On', 'Neutral', 'Risk Off'].includes(regime.risk));
  assert.ok(['Bull Trend', 'Correction', 'Bear Trend'].includes(regime.trend));
  assert.ok(regime.rules.length > 10 && regime.rules.every((r) => 'passed' in r && r.desc));
  assert.ok(regime.fearGreed.value >= 0 && regime.fearGreed.value <= 100);
});
test('classifyRegime: שוק דובי מזוהה (ירידה של 30%)', () => {
  const bear = syntheticRows({ n: 600, drift: -0.002, vol: 0.012 });
  const r = classifyRegime({ indices: { SPX: bear }, macro: {} });
  assert.equal(r.trend, 'Bear Trend');
});
test('classifyRegime: As-Of משתמש רק בנתונים עד התאריך', () => {
  const r1 = classifyRegime({ indices: { SPX: rows }, macro: {}, date: '2021-06-30' });
  assert.equal(r1.inputs.spx.date <= '2021-06-30', true);
});
