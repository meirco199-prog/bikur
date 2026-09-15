import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMockFetch, calls } from './mock-providers.mjs';
import worker, { cronStep } from '../worker.js';

installMockFetch();
const env = { INVEST: null, FINNHUB_KEY: 'x', FRED_KEY: 'x', APP_TOKEN: 'secret', CRON_BATCH: '200' };
// KV מדומה בזיכרון משותף לכל הבקשות
const store = new Map();
env.INVEST = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }) };
const req = (path, opts = {}) => worker.fetch(new Request('https://api.test' + path, { headers: { 'CF-Connecting-IP': '1.1.1.1', ...(opts.auth ? { Authorization: 'Bearer secret' } : {}), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, method: opts.method || (opts.body ? 'POST' : 'GET'), body: opts.body ? JSON.stringify(opts.body) : undefined }), env, { waitUntil(){} });
const get = async (path, opts) => { const r = await req(path, opts); const j = await r.json(); return { status: r.status, j }; };

test('/health מדווח ספקים, אימות ו-KV', async () => {
  const { status, j } = await get('/health');
  assert.equal(status, 200); assert.equal(j.ok, true); assert.equal(j.auth, 'token'); assert.equal(j.kv, 'bound');
  assert.ok(j.providers.find((p) => p.id === 'finnhub').available && !j.providers.find((p) => p.id === 'fmp').available);
});
test('/universe מחזיר את ה-universe עם סינון', async () => {
  const { j } = await get('/universe?country=IL');
  assert.ok(j.count >= 10 && j.items.every((a) => a.country === 'IL'));
});
test('/asset/AAPL — ניתוח מלא: ציון, סיגנל, מקורות, חותמות', async () => {
  const { status, j } = await get('/asset/AAPL');
  assert.equal(status, 200, JSON.stringify(j).slice(0, 200));
  assert.ok(!j.missing, j.reason);
  assert.ok(j.score.total >= 0 && j.score.total <= 100);
  assert.ok(['STRONG BUY', 'BUY', 'WATCH', 'HOLD', 'REDUCE', 'SELL', 'NO SIGNAL'].includes(j.signal.label));
  assert.equal(j.dataAsOf.prices.source, 'stooq');
  assert.equal(j.dataAsOf.facts.source, 'EDGAR');
  assert.ok(j.metrics && !j.metrics.missing && j.metrics.pe > 0);
  assert.ok(!j.fair.missing, j.fair.reason);
  assert.equal(j.priceSource.kind, 'quote');
  assert.ok(j.analyst.total === 24 && j.analyst.kind === 'ANALYST OPINION');
  assert.ok(j.sentiment.count >= 3, 'sentiment ' + JSON.stringify(j.sentiment));
  assert.ok(j.sentiment.clusters.some((c) => c.cluster.size >= 2), 'dedup של ידיעות כפולות');
  assert.ok(j.risk.beta !== undefined && j.risk.earningsInDays > 0);
  assert.equal(j.kinds.signal, 'MODEL SIGNAL');
});
test('/asset — סימבול לא תקין נדחה', async () => {
  const { status } = await get('/asset/../etc');
  assert.equal(status, 404);
  const r = await get('/asset/BAD$$');
  assert.equal(r.status, 400);
});
test('/asset/NODATA — אין מחירים → missing עם סיבה, לא מספר מומצא', async () => {
  const { j } = await get('/asset/NODATA');
  assert.equal(j.missing, true); assert.ok(/אין מחירים/.test(j.reason));
});
test('/regime מחזיר סיווג עם כללים ו-Fear&Greed', async () => {
  const { j } = await get('/regime');
  assert.ok(['Risk On', 'Neutral', 'Risk Off'].includes(j.risk)); assert.ok(j.rules.length > 10); assert.ok(j.fearGreed);
  assert.ok(j.dataAsOf.SPX && j.dataAsOf.VIXCLS.source === 'FRED');
});
test('כתיבה בלי טוקן נדחית; עם טוקן עובדת (watchlist)', async () => {
  const a = await get('/watchlist', { body: { symbol: 'NVDA' } });
  assert.equal(a.status, 401);
  const b = await get('/watchlist', { body: { symbol: 'NVDA', note: 'בדיקה' }, auth: true });
  assert.equal(b.status, 200); assert.ok(b.j.items.some((w) => w.symbol === 'NVDA'));
  const c = await get('/watchlist');
  assert.ok(c.j.items.some((w) => w.symbol === 'NVDA'));
});
test('settings: משקלים נשמרים ומוגבלים', async () => {
  const { j } = await get('/settings', { body: { portfolioSize: 250000, weights: { momentum: 99, valuation: 5 } }, auth: true });
  assert.equal(j.portfolioSize, 250000); assert.equal(j.weights.momentum, 50); assert.equal(j.weights.valuation, 5);
});
test('alerts: יצירת כלל, סוגים, לוג', async () => {
  const t = await get('/alerts/types'); assert.ok(t.j.rsi);
  const r = await get('/alerts/rules', { body: { symbol: 'AAPL', type: 'rsi', params: { op: '<', value: 99 }, channels: ['browser'] }, auth: true });
  assert.equal(r.status, 200); assert.ok(r.j.id);
  const bad = await get('/alerts/rules', { body: { symbol: 'AAPL', type: 'nope' }, auth: true }); assert.equal(bad.status, 400);
});
test('cron: מריץ את כל ה-universe, שומר snapshots בלתי-נדרסים, דירוג ותיקים', async () => {
  const ctx = { env, db: new (await import('../lib/db.js')).DB(env.INVEST), budget: new (await import('../lib/budget.js')).Budget(new (await import('../lib/db.js')).DB(env.INVEST)) };
  const r1 = await cronStep(ctx, { batch: 200 });
  assert.ok(r1.finalized, JSON.stringify(r1));
  const rank = await get('/rank');
  assert.ok(rank.j.table.length > 80, 'analyzed ' + rank.j.table?.length);
  assert.ok(rank.j.categories.bestOverall.length > 0 && rank.j.categories.bestEtf.length > 0);
  const reco = await get('/reco');
  assert.ok(reco.j.profiles.balanced.positions.length > 3, JSON.stringify(reco.j).slice(0, 300));
  assert.ok(Math.abs(reco.j.profiles.balanced.positions.reduce((s, p) => s + p.weight, 0) - 1) < 0.01);
  // אי-דריסה: הרצה חוזרת לא משנה snapshot
  const day = rank.j.date;
  const before = await get(`/snapshot/${day}/AAPL`);
  await cronStep(ctx, { batch: 200, force: true });
  const after = await get(`/snapshot/${day}/AAPL`);
  assert.deepEqual(before.j, after.j);
  const days = await get('/days'); assert.ok(days.j.includes(day));
  const wl = await get('/watchlist'); assert.ok(wl.j.items.find((w) => w.symbol === 'NVDA').snapshot?.score !== undefined);
  const alog = await get('/alerts/log'); assert.ok(Array.isArray(alog.j));
});
test('/asof/AAPL — נתונים עד תאריך בלבד + תשואות קדימה', async () => {
  const { status, j } = await get('/asof/AAPL?date=2024-01-02');
  assert.equal(status, 200, JSON.stringify(j).slice(0, 200));
  assert.ok(!j.missing, j.reason);
  assert.equal(j.technical.date <= '2024-01-02', true);
  assert.ok(j.analyst.missing, 'אנליסטים לא זמינים נקודתית');
  assert.ok(j.forward.m12 && typeof j.forward.m12.ret === 'number');
  assert.equal(j.priceSource.kind, 'close');
  // הדוח השנתי של 2023 הוגש רק בפברואר 2024 → לא ידוע ב-2024-01-02
  assert.ok(j.metrics.asOf < '2023-12-31', 'facts asOf ' + j.metrics.asOf);
  const bad = await get('/asof/AAPL?date=nope'); assert.equal(bad.status, 400);
});
test('paper trading: קנייה במחיר quote, מכירה, ביצועים', async () => {
  const b = await get('/paper/order', { body: { symbol: 'AAPL', side: 'buy', qty: 10, reason: 'בדיקה' }, auth: true });
  assert.equal(b.status, 200, JSON.stringify(b.j)); assert.ok(b.j.price > 0 && b.j.priceSource.source === 'finnhub'); assert.equal(b.j.result.signalAtEntry !== undefined, true);
  const p = await get('/paper'); assert.equal(p.j.open.length, 1); assert.equal(p.j.open[0].current, b.j.price);
  const s = await get('/paper/order', { body: { symbol: 'AAPL', side: 'sell', qty: 4, price: b.j.price + 10 }, auth: true });
  assert.equal(s.status, 200); assert.ok(Math.abs(s.j.result[0].pnl - 40) < 0.01);
  const p2 = await get('/paper'); assert.equal(p2.j.closedCount, 1); assert.equal(p2.j.open[0].qty, 6);
  const bad = await get('/paper/order', { body: { symbol: 'MSFT', side: 'sell', qty: 1, price: 5 }, auth: true }); assert.equal(bad.status, 400);
});
test('/ai/ask — ללא מפתח מחזיר הקשר גולמי; עם מפתח קורא ל-Anthropic', async () => {
  const a = await get('/ai/ask', { body: { question: 'מה קרה ל-AAPL היום?' } });
  assert.equal(a.j.provider, 'none'); assert.ok(a.j.context.assets.AAPL.score !== undefined);
  const env2 = { ...env, ANTHROPIC_API_KEY: 'k' };
  const r = await worker.fetch(new Request('https://api.test/ai/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '2.2.2.2' }, body: JSON.stringify({ question: 'מה הכי מעניין היום?' }) }), env2, { waitUntil(){} });
  const j = await r.json();
  assert.equal(j.provider, 'anthropic'); assert.ok(calls.some((u) => u.includes('api.anthropic.com')));
});
test('rate limit: מעל 240 בקשות בדקה → 429', async () => {
  let last;
  for (let i = 0; i < 245; i++) last = await worker.fetch(new Request('https://api.test/days', { headers: { 'CF-Connecting-IP': '9.9.9.9' } }), env, { waitUntil(){} });
  assert.equal(last.status, 429);
});
test('/prices ו-/bundle ו-/search', async () => {
  const p = await get('/prices/SPY?from=2025-01-01'); assert.ok(p.j.rows.length > 100 && p.j.rows[0][0] >= '2025-01-01' && p.j.source === 'stooq');
  const b = await get('/bundle/AAPL'); assert.ok(b.j.facts.series.Revenue.length > 5 && b.j.prices.rows.length > 1000);
  const s = await get('/search?q=app'); assert.ok(s.j.items.some((x) => x.symbol === 'AAPL'));
});
test('ספק שנופל → fallback או missing מסומן, לא קריסה', async () => {
  installMockFetch({ fail: ['finnhub.io/api/v1/quote'] });
  store.delete('quote:MSFT');
  const { j } = await get('/asset/MSFT');
  assert.ok(!j.missing); assert.equal(j.priceSource.kind, 'close');
  const h = await get('/health'); assert.ok(h.j.recentErrors.some((e) => /quote/.test(e.where)));
  installMockFetch();
});
test('POST /snapshots — מצב חישוב בדפדפן: append-only, מפעיל התראות, לא דורס', async () => {
  const day = '2026-01-05';
  const snaps = [{ symbol: 'AAPL', score: 80, signal: 'BUY', price: 100, rsi: 25, events: [], relVol: 3 }, { symbol: 'MSFT', score: 40, signal: 'HOLD', price: 50 }];
  const r = await get('/snapshots', { body: { date: day, snapshots: snaps, rank: { table: [], categories: {} }, regime: { rules: [], risk: 'Neutral', trend: 'Correction' } }, auth: true });
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.written, 2);
  const again = await get('/snapshots', { body: { date: day, snapshots: [{ symbol: 'AAPL', score: 1, signal: 'SELL', price: 1 }] }, auth: true });
  assert.equal(again.j.written, 0, 'לא נדרס');
  const s = await get(`/snapshot/${day}/AAPL`); assert.equal(s.j.score, 80); assert.equal(s.j.computedBy, 'browser');
  const days = await get('/days'); assert.ok(days.j.includes(day));
  const bad = await get('/snapshots', { body: { date: '2099-01-01', snapshots: [] }, auth: true }); assert.equal(bad.status, 400);
  const noauth = await get('/snapshots', { body: { snapshots: [] } }); assert.equal(noauth.status, 401);
});

test('quote שסוטה >25% מהסגירה האחרונה לא נכנס לחישוב (מסומן)', async () => {
  store.set('quote:GOOGL', JSON.stringify({ price: 5, change: 0, changePct: 0, asOf: new Date().toISOString(), source: 'finnhub', quality: 0.9, fetchedAt: new Date().toISOString() }));
  const { j } = await get('/asset/GOOGL');
  assert.equal(j.priceSource.kind, 'close'); assert.ok(/סוטה/.test(j.priceSource.note));
  assert.ok(j.price > 50);
});
