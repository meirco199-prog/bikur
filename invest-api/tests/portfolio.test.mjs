import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPortfolios, PROFILES, selectDiversified } from '../engine/portfolio.js';
import { assetRisk, portfolioRisk, scenarios, alignedReturns } from '../engine/risk.js';
import { clusterNews, sentimentScore, lexiconSentiment, detectEvents } from '../engine/news.js';
import { filterUniverse, SEED_UNIVERSE, findAsset } from '../engine/universe.js';
import { syntheticRows } from './helpers.mjs';

const mk = (symbol, opts, seed) => ({ symbol, name: symbol, score: 70, signal: 'BUY', type: 'stock', assetClass: 'equity', role: 'satellite', sector: 'Technology', country: 'US', currency: 'USD', vol: 0.3, ...opts, rows: syntheticRows({ n: 600, seed, vol: (opts.vol || 0.3) / 16 }) });
const cands = [
  mk('SPY', { type: 'etf', role: 'core', score: 68, sector: 'רב-ענפי' }, 1), mk('QQQ', { type: 'etf', role: 'core', score: 72 }, 2),
  mk('AGG', { type: 'etf', assetClass: 'bond', role: 'bond', score: 60, vol: 0.06 }, 3), mk('GLD', { type: 'etf', assetClass: 'gold', role: 'gold', score: 62, vol: 0.15 }, 4),
  mk('AAPL', { score: 80 }, 5), mk('MSFT', { score: 78 }, 6), mk('NVDA', { score: 85, vol: 0.5 }, 7), mk('JNJ', { score: 66, sector: 'Healthcare', vol: 0.18 }, 8),
  mk('XOM', { score: 64, sector: 'Energy' }, 9), mk('JPM', { score: 70, sector: 'Financial Services' }, 10), mk('TEVA', { score: 61, sector: 'Healthcare', country: 'IL' }, 11), mk('BAD', { score: 30, signal: 'SELL' }, 12),
];
const seriesMap = Object.fromEntries(cands.map((c) => [c.symbol, c.rows]));

test('buildPortfolios: 4 פרופילים, משקלים מסתכמים ל-1, סכומים בש"ח', () => {
  const p = buildPortfolios({ candidates: cands, seriesMap, sizeIls: 200000, usdils: 3.7 });
  assert.deepEqual(Object.keys(p.profiles), Object.keys(PROFILES));
  for (const prof of Object.values(p.profiles)){
    const sum = prof.positions.reduce((s, x) => s + x.weight, 0);
    assert.ok(Math.abs(sum - 1) < 0.01, `${prof.id} sum=${sum}`);
    const ils = prof.positions.reduce((s, x) => s + x.ils, 0);
    assert.ok(Math.abs(ils - 200000) < 500);
    assert.ok(prof.positions.every((x) => x.symbol === 'CASH' || (x.type === 'stock' ? x.weight <= prof.constraints.maxPosition + 1e-6 : x.weight <= prof.constraints.maxEtfPosition + 1e-6)), 'max position');
    assert.ok(!prof.positions.some((x) => x.symbol === 'BAD'), 'SELL לא נכנס');
    assert.ok(prof.exposure.currency.USD > 0 && prof.exposure.sector);
    assert.ok(!prof.risk.missing && prof.risk.volatility > 0);
  }
  assert.ok(p.profiles.conservative.risk.volatility < p.profiles.aggressive.risk.volatility);
});
test('selectDiversified מעניש קורלציה ומכבד מספר מקסימלי', () => {
  const a = alignedReturns(seriesMap, 252);
  const picked = selectDiversified(cands.filter((c) => c.role === 'satellite'), { max: 3, maxSector: 0.4, returnsMap: a.returns });
  assert.equal(picked.length, 3);
});
test('assetRisk ו-portfolioRisk מפיקים מדדים', () => {
  const r = assetRisk({ rows: seriesMap.AAPL, benchRows: seriesMap.SPY, earningsDate: '2099-01-01' });
  assert.ok(r.vol1y > 0 && typeof r.beta === 'number' && r.maxDrawdown1y <= 0 && r.liquidity);
  const pr = portfolioRisk({ weights: { AAPL: 0.5, JNJ: 0.5 }, seriesMap, meta: { AAPL: { sector: 'Technology', currency: 'USD', country: 'US' }, JNJ: { sector: 'Healthcare', currency: 'USD', country: 'US' } }, benchRows: seriesMap.SPY });
  assert.ok(pr.volatility > 0 && pr.correlation.AAPL.JNJ !== undefined && pr.effectiveN > 1);
});
test('scenarios: תרחישים עם הסבר, שקל מתחזק פוגע בחשיפה דולרית', () => {
  const s = scenarios({ positions: [{ symbol: 'AAPL', ils: 100000, currency: 'USD', assetClass: 'equity', sector: 'Technology' }, { symbol: 'CASH', ils: 100000, currency: 'ILS', assetClass: 'cash' }], risk: { beta: 1.1 }, sizeIls: 200000 });
  const ils = s.find((x) => x.id === 'ilsUp10');
  assert.ok(Math.abs(ils.impactPct - -0.05) < 1e-6);
  assert.ok(s.every((x) => x.how && x.kind === 'MODEL ESTIMATE'));
});
test('clusterNews: 20 עותקים של אותה ידיעה = אשכול אחד, מקור ראשוני מייצג', () => {
  const items = [];
  for (let i = 0; i < 20; i++) items.push({ title: 'Apple beats estimates as iPhone sales surge', url: `https://site${i}.com/a?utm_source=x`, publisher: i === 7 ? 'Reuters' : `Blog ${i}`, publishedAt: '2024-05-0' + (1 + (i % 3)) + 'T10:00:00Z' });
  items.push({ title: 'Apple faces lawsuit over App Store fees', url: 'https://news.com/b', publisher: 'Yahoo', publishedAt: '2024-05-02T10:00:00Z' });
  const c = clusterNews(items);
  assert.equal(c.length, 2);
  const big = c.find((x) => x.cluster.size === 20);
  assert.equal(big.publisher, 'Reuters'); assert.ok(big.primary);
  assert.ok(big.events.includes('earnings_beat')); assert.equal(big.sentiment.label, 'חיובי');
  const law = c.find((x) => x.events.includes('lawsuit'));
  assert.equal(law.sentiment.label, 'שלילי'); assert.equal(law.weight, 0.3);
});
test('sentimentScore: פחות מ-3 ידיעות → missing; אחרת ציון 0–100 עם סיבות', () => {
  const few = clusterNews([{ title: 'x', url: 'https://a.com/1', publisher: 'p', publishedAt: '2024-05-01T00:00:00Z' }]);
  assert.ok(sentimentScore(few, '2024-05-10').missing);
  const titles = ['Company raises full-year guidance on strong demand', 'Analyst upgrades company to Buy citing margins', 'Company wins record contract, shares jump', 'Company beats estimates and expands buyback'];
  const many = clusterNews(titles.map((title, i) => ({ title, url: `https://a.com/${i}`, publisher: 'Reuters', publishedAt: `2024-05-0${i + 1}T00:00:00Z` })));
  const s = sentimentScore(many, '2024-05-10');
  assert.ok(s.value > 50 && s.reasons.length >= 2);
  // As-Of: ידיעות אחרי התאריך לא נספרות
  assert.ok(sentimentScore(many, '2024-04-01').missing);
});
test('lexicon ו-events', () => {
  assert.ok(lexiconSentiment('Company cuts guidance, shares plunge') < 0);
  assert.ok(detectEvents('Analyst upgrades stock to Buy').some((e) => e.id === 'upgrade'));
});
test('universe: סינון ומציאה', () => {
  assert.ok(SEED_UNIVERSE.length > 80);
  assert.ok(filterUniverse(SEED_UNIVERSE, { country: 'IL' }).length >= 10);
  assert.equal(filterUniverse(SEED_UNIVERSE, { assetClass: 'bond' }).every((a) => a.type === 'etf'), true);
  assert.equal(findAsset('aapl').name, 'Apple');
  assert.equal(findAsset('SPX').id, 'SPX');
});
