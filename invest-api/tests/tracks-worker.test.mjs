// בדיקות ניתוב HTTP: /tracks/*, /paper/breakdown, ו-POST /ingest/entry שמפעיל מילוי מסלולים אוטומטית.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMockFetch } from './mock-providers.mjs';
import worker from '../worker.js';
import { TRACK_IDS } from '../engine/tracks.js';

installMockFetch();

function mkEnv(){
  const store = new Map();
  return { store, env: { INVEST: { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }) }, APP_TOKEN: 'secret', CRON_SECRET: 's3', AUTO_ANY_TIME: '1' } };
}
const secs = ['Tech', 'Health', 'Fin', 'Energy', 'Industrials'];
function seedRank(store, day, n = 30){
  const table = [{ symbol: 'SPY', type: 'etf', assetClass: 'equity', role: 'core', price: 500, currency: 'USD', sector: 'רב-ענפי', universe: 'sp500' }, { symbol: 'VTI', type: 'etf', assetClass: 'equity', role: 'core', price: 250, currency: 'USD', sector: 'רב-ענפי' }, { symbol: 'BND', type: 'etf', assetClass: 'bond', role: 'core', price: 70, currency: 'USD', sector: 'אג"ח' }, { symbol: 'GLD', type: 'etf', assetClass: 'gold', role: 'core', price: 190, currency: 'USD', sector: 'סחורות' }];
  for (let i = 0; i < n; i++){
    const strong = i >= n - 8, buy = !strong && i >= n - 16;
    table.push({ symbol: 'ST' + i, type: 'stock', sector: secs[i % secs.length], price: 50 + i, currency: 'USD', coverage: 0.95, universe: 'sp500', score: 60 + i, signal: strong ? 'STRONG BUY' : buy ? 'BUY' : 'HOLD', vol1y: 0.3, nextEarnings: null, components: { fundamental: 70, valuation: 60, growth: 65, quality: 70, technical: 65, momentum: 65, risk: 70 } });
  }
  store.set(`rank:${day}`, JSON.stringify({ date: day, barDate: day, table }));
  store.set(`regime:${day}`, JSON.stringify({ trend: 'Bull Trend', risk: 'Risk On', summary: 'Bull · Risk On' }));
  store.set('fx:USDILS', JSON.stringify({ rate: 3.7 }));
  const shadowRows = table.filter((r) => r.type === 'stock').map((r, i) => { const strong = r.signal === 'STRONG BUY', buy = r.signal === 'BUY'; return { symbol: r.symbol, name: r.symbol, sector: r.sector, price: r.price, open: r.price * 0.995, currency: 'USD', A: r.score, actA: r.signal, D: 40 + i, actD: strong ? 'STRONG BUY' : buy ? 'BUY' : 'HOLD', DF: 40 + i, actDF: strong ? 'STRONG BUY' : buy ? 'BUY' : 'HOLD', eligible: true, eligibleD: true, eligibleDF: true, coverage: 0.95, raw: { momentum: 60 + i, growth: 50, quality: 50, risk: 50 }, pct: { momentum: 60, growth: 50, quality: 50, risk: 50 }, fwd: {} }; });
  store.set(`shadow:${day}`, JSON.stringify({ day, rows: shadowRows, models: { DF: { variant: 'DF-preRevision' } } }));
  store.set('idx:snapdays', JSON.stringify([day]));
  return table;
}

test('POST /tracks/run מחליט ומבצע (09:40 עדיין לא הגיע → decide בלבד); דורש סוד', async () => {
  const { store, env } = mkEnv();
  const day = '2026-09-17'; seedRank(store, day);
  const req = (path, opts = {}) => worker.fetch(new Request('https://api.test' + path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: { 'CF-Connecting-IP': '5.5.5.5', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }), env, { waitUntil(){} });
  const bad = await req('/tracks/run', { method: 'POST' });
  assert.equal(bad.status, 401);
  const r = await (await req(`/tracks/run?secret=s3&date=${day}`, { method: 'POST' })).json();
  assert.equal(r.decide.ran, true);
  assert.ok(r.decide.tracks.regB.orders > 0);
  assert.ok(r.decide.tracks.aggrB);
  // אין מחיר 09:40 עדיין — המילוי נחסם ולא מבוצע בשקט
  assert.ok(r.fill.tracks.regB.blocked?.includes('stale-price'));
});

test('POST /ingest/entry מפעיל מילוי מסלולים אוטומטית; GET /tracks/compare ו-/tracks/{id} מחזירים דוח', async () => {
  const { store, env } = mkEnv();
  const day = '2026-09-17'; const table = seedRank(store, day);
  const req = (path, opts = {}) => worker.fetch(new Request('https://api.test' + path, { method: opts.method || (opts.body ? 'POST' : 'GET'), headers: { 'CF-Connecting-IP': '5.5.5.5', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }), env, { waitUntil(){} });
  await req(`/tracks/run?secret=s3&date=${day}`, { method: 'POST' });
  const prices = Object.fromEntries(table.map((r) => [r.symbol, r.price * 1.002]));
  const ing = await (await req(`/ingest/entry?secret=s3`, { method: 'POST', body: { day, prices, at: '09:40 ET', source: 'test' } })).json();
  assert.ok(ing.tracks, 'תשובת ה-ingest כוללת סיכום מילוי מסלולים');
  assert.ok(ing.tracks.tracks.regB.filled > 0, JSON.stringify(ing.tracks));
  assert.ok(ing.tracks.tracks.aggrB.filled > 0);

  const cmp = await (await req('/tracks/compare')).json();
  const ids = cmp.items.map((i) => i.id).sort();
  assert.ok(TRACK_IDS.every((id) => ids.includes(id)));
  assert.ok(ids.includes('paper')); // חשבון התרגול תמיד מופיע כקבוצת ביקורת
  assert.ok(cmp.benchmarks.spy && cmp.benchmarks.spy95);

  const regB = await (await req('/tracks/regB')).json();
  assert.equal(regB.id, 'regB'); assert.ok(regB.totalIls > 0); assert.ok(regB.exposure);

  const aggrB = await (await req('/tracks/aggrB')).json();
  assert.equal(aggrB.kind, 'aggressive'); assert.ok(aggrB.exposure.equityShare <= 0.96);

  assert.equal((await req('/tracks/nosuch')).status, 404);
});

test('GET /paper/breakdown: מבנה תקין גם בלי עסקאות (חשבון ריק)', async () => {
  const { store, env } = mkEnv();
  const day = '2026-09-17'; seedRank(store, day);
  const req = (path) => worker.fetch(new Request('https://api.test' + path, { headers: { 'CF-Connecting-IP': '5.5.5.5' } }), env, { waitUntil(){} });
  const r = await (await req('/paper/breakdown')).json();
  assert.ok(r.totals); assert.equal(r.totals.realizedIls, 0); assert.equal(r.totals.unrealizedIls, 0);
  assert.ok(r.allocation); assert.ok(Array.isArray(r.bySymbol)); assert.equal(r.bySymbol.length, 0);
  assert.ok(r.strategy); assert.ok(r.reconciliation);
  assert.ok(Math.abs(r.reconciliation.diffIls) < 1);
});
