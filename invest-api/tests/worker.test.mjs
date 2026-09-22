import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMockFetch, calls, githubPosts } from './mock-providers.mjs';
import worker, { cronStep } from '../worker.js';

installMockFetch();
const env = { INVEST: null, FINNHUB_KEY: 'x', FRED_KEY: 'x', APP_TOKEN: 'secret', AUTO_ANY_TIME: '1', CRON_BATCH: '200', STOOQ_ENABLED: '1', COUNCIL_SECRET: 'council-shared-secret-1234', GH_COUNCIL_TOKEN: 'ghp_TESTTOKEN000000000001' };
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
test('paper trading כחשבון אמיתי: מזומן, עמלה, חסימת קנייה מעבר ליתרה, איחוד פוזיציות, מכירה, איפוס', async () => {
  const r0 = await get('/paper/reset', { body: { initialIls: 200000 }, auth: true }); assert.equal(r0.status, 200); assert.equal(r0.j.account.cashIls, 200000);
  const b = await get('/paper/order', { body: { symbol: 'AAPL', side: 'buy', qty: 10, reason: 'בדיקה' }, auth: true });
  assert.equal(b.status, 200, JSON.stringify(b.j)); assert.ok(b.j.price > 0 && b.j.priceSource.source === 'finnhub');
  const cost = b.j.result.trade.costIls; assert.ok(cost > 10 * b.j.price * 3 && b.j.result.trade.feeIls >= 3.7, 'עלות כוללת עמלה');
  const b2 = await get('/paper/order', { body: { symbol: 'AAPL', side: 'buy', qty: 5 }, auth: true }); assert.equal(b2.status, 200);
  const p = await get('/paper');
  assert.equal(p.j.positions.length, 1); assert.equal(p.j.positions[0].qty, 15); assert.ok(Math.abs(p.j.cashIls - (200000 - cost - b2.j.result.trade.costIls)) < 0.01);
  assert.ok(Math.abs(p.j.totalIls - (p.j.cashIls + p.j.valueIls)) < 0.01);
  // תאריך השער ושינוי יומי מול הסגירה הקודמת (מסדרת המחירים)
  assert.match(p.j.positions[0].priceAsOf || '', /^\d{4}-\d{2}-\d{2}$/); assert.ok(typeof p.j.positions[0].dayChangePct === 'number'); assert.ok(typeof p.j.dayPnlIls === 'number'); assert.equal(p.j.asOf, p.j.positions[0].priceAsOf);
  const big = await get('/paper/order', { body: { symbol: 'MSFT', side: 'buy', qty: 100000 }, auth: true }); assert.equal(big.status, 400); assert.ok(/אין מספיק מזומן/.test(big.j.error));
  const tooMany = await get('/paper/order', { body: { symbol: 'AAPL', side: 'sell', qty: 50, price: 100 }, auth: true }); assert.equal(tooMany.status, 400);
  const s = await get('/paper/order', { body: { symbol: 'AAPL', side: 'sell', qty: 4, price: b.j.price + 10 }, auth: true });
  assert.equal(s.status, 200); assert.ok(s.j.result.proceedsIls > 0);
  const p2 = await get('/paper'); assert.equal(p2.j.positions[0].qty, 11); assert.equal(p2.j.closedCount, 1); assert.ok(p2.j.realizedIls > 0);
  const frac = await get('/paper/order', { body: { symbol: 'AAPL', side: 'buy', qty: 1.5 }, auth: true }); assert.equal(frac.status, 400);
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
test('אימות לפי sha256 (APP_TOKEN_SHA256) בלי APP_TOKEN; מפתחות ספקים דרך /keys; cron עם CRON_SECRET', async () => {
  const { sha256Hex } = await import('../lib/keys.js');
  const env3 = { ...env, APP_TOKEN: undefined, APP_TOKEN_SHA256: await sha256Hex('mytok'), CRON_SECRET: 'tick1', FINNHUB_KEY: undefined };
  const call = (path, opts = {}) => worker.fetch(new Request('https://api.test' + path, { method: opts.body ? 'POST' : 'GET', headers: { 'CF-Connecting-IP': '3.3.3.3', ...(opts.tok ? { Authorization: 'Bearer ' + opts.tok } : {}), ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }), env3, { waitUntil(){} }).then(async (r) => ({ status: r.status, j: await r.json() }));
  assert.equal((await call('/keys')).status, 401);
  assert.equal((await call('/keys', { tok: 'wrong' })).status, 401);
  const ok = await call('/keys', { tok: 'mytok' }); assert.equal(ok.status, 200); assert.ok(ok.j.find((k) => k.name === 'FINNHUB_KEY' && !k.set));
  const set = await call('/keys', { tok: 'mytok', body: { name: 'FINNHUB_KEY', value: 'abcdef123456' } }); assert.equal(set.status, 200);
  const k = set.j.keys.find((x) => x.name === 'FINNHUB_KEY'); assert.ok(k.set && k.source === 'app' && k.masked === 'abc…456' && !JSON.stringify(set.j).includes('abcdef123456'));
  const h = await call('/health'); assert.equal(h.j.auth, 'token'); assert.ok(h.j.providers.find((p) => p.id === 'finnhub').available, 'מפתח מ-KV מפעיל ספק');
  assert.equal((await call('/keys', { tok: 'mytok', body: { name: 'HACK', value: 'x' } })).status, 400);
  assert.equal((await call('/cron/run?batch=1&secret=wrong', { body: {} })).status, 401);
  const c = await call('/cron/run?batch=1&secret=tick1', { body: {} }); assert.equal(c.status, 200); assert.ok('processed' in c.j);
  await call('/keys', { tok: 'mytok', body: { name: 'FINNHUB_KEY', value: '' } });
});
test('cron עמיד למקביליות: שני מריצים במקביל מסיימים בלי דריסה', async () => {
  const { DB } = await import('../lib/db.js'); const { Budget } = await import('../lib/budget.js');
  const mk = () => { const db = new DB(env.INVEST); return { env, db, budget: new Budget(db) }; };
  for (const k of [...store.keys()]) if (/^(snap|rank|reco|regime|cron):/.test(k)) store.delete(k);
  let fin = false;
  for (let i = 0; i < 60 && !fin; i++){ const res = await Promise.all([cronStep(mk(), { batch: 3 }), cronStep(mk(), { batch: 3 })]); fin = res.some((r) => r.finalized); }
  assert.ok(fin);
  const rank = await get('/rank'); assert.ok(rank.j.table.length >= 100, 'analyzed ' + rank.j.table.length);
  const keys = [...store.keys()].filter((k) => k.startsWith('rank:')); assert.equal(keys.length, 1);
});
test('POST /ingest/prices — הזרמת CSV מ-GitHub Actions, מיזוג ולא דריסה', async () => {
  const env4 = { ...env, CRON_SECRET: 'tick1' };
  const call = (path, body) => worker.fetch(new Request('https://api.test' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '4.4.4.4' }, body: JSON.stringify(body) }), env4, { waitUntil(){} }).then(async (r) => ({ status: r.status, j: await r.json() }));
  assert.equal((await call('/ingest/prices?secret=bad', { symbol: 'ZZZ', csv: 'Date,Open,High,Low,Close,Volume\n2026-01-02,1,2,0.5,1.5,100' })).status, 401);
  const r = await call('/ingest/prices?secret=tick1', { items: [{ symbol: 'ZZZ', csv: 'Date,Open,High,Low,Close,Volume\n2026-01-02,1,2,0.5,1.5,100\n2026-01-05,1.5,2,1,1.8,200' }] });
  assert.equal(r.status, 200); assert.equal(r.j.items[0].rows, 2);
  const r2 = await call('/ingest/prices?secret=tick1', { symbol: 'ZZZ', rows: [['2026-01-06', 1.8, 2, 1.7, 1.9, 50]] });
  assert.equal(r2.j.items[0].rows, 3);
  const p = await get('/prices/ZZZ'); assert.equal(p.j.rows.length, 3); assert.equal(p.j.source, 'stooq-via-github');
});
test('POST /ingest/snapshots finalize — יוצר rank חדש כשאין קיים (לא רק מעדכן קיים)', async () => {
  // רגרסיה: אם ה-cron המתוזמן פספס ימים, אין עדיין rank:day כשה-GitHub Action מריץ finalize=1 בפעם הראשונה
  const env5 = { ...env, CRON_SECRET: 'tick2' };
  const call = (path, body) => worker.fetch(new Request('https://api.test' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '5.5.5.5' }, body: JSON.stringify(body) }), env5, { waitUntil(){} }).then(async (r) => ({ status: r.status, j: await r.json() }));
  const day = '2020-01-05';
  for (const k of [...store.keys()]) if (k.startsWith(`snap:${day}:`) || k.startsWith(`snaps:${day}:`) || k.startsWith(`rank:${day}`) || k.startsWith(`reco:${day}`)) store.delete(k);
  assert.equal(store.has(`rank:${day}`), false, 'אין rank קיים ליום הזה לפני הבדיקה');
  const snaps = Array.from({ length: 5 }, (_, i) => ({ symbol: 'SYM' + i, score: 50 + i, missing: false, signal: 'HOLD', type: 'stock' }));
  const r = await call('/ingest/snapshots?secret=tick2&finalize=1', { date: day, snapshots: snaps });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.rerank, true, 'rerank צריך להיות true גם כשלא היה rank קודם');
  const rank = store.get(`rank:${day}`);
  assert.ok(rank, 'rank:day היה צריך להיווצר גם בלי rank קודם');
  assert.equal(JSON.parse(rank).analyzed, 5);
});
test('POST /ingest/snapshots finalize — דירוג עם ניתוח חלקי מוחלף אחרי סריקה מלאה', async () => {
  const env5 = { ...env, CRON_SECRET: 'tick2' };
  const call = (path, body) => worker.fetch(new Request('https://api.test' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '5.5.5.6' }, body: JSON.stringify(body) }), env5, { waitUntil(){} }).then(async (r) => ({ status: r.status, j: await r.json() }));
  const day = '2020-01-06';
  for (const k of [...store.keys()]) if (k.startsWith(`snap:${day}:`) || k.startsWith(`snaps:${day}:`) || k.startsWith(`rank:${day}`) || k.startsWith(`reco:${day}`)) store.delete(k);
  store.set(`rank:${day}`, JSON.stringify({ date: day, analyzed: 2, table: [], categories: {} }));
  const snaps = Array.from({ length: 8 }, (_, i) => ({ symbol: 'FUL' + i, score: 40 + i, missing: false, signal: 'HOLD', type: 'stock' }));
  const r = await call('/ingest/snapshots?secret=tick2&finalize=1', { date: day, snapshots: snaps });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.rerank, true);
  assert.equal(JSON.parse(store.get(`rank:${day}`)).analyzed, 8, 'דירוג חלקי (2) הוחלף בסריקה המלאה (8)');
});
test('snapshot חסר (תקלת נתונים) מתמלא מחדש; ציון אמיתי לא נדרס; דירוג ריק מוחלף', async () => {
  const { DB } = await import('../lib/db.js'); const { Budget } = await import('../lib/budget.js');
  const mk = () => { const db = new DB(env.INVEST); return { env, db, budget: new Budget(db) }; };
  const day = new Date().toISOString().slice(0, 10);
  for (const k of [...store.keys()]) if (/^(snap|rank|reco|cron):/.test(k)) store.delete(k);
  store.set(`snap:${day}:AAPL`, JSON.stringify({ symbol: 'AAPL', date: day, missing: true, reason: 'אין מחירים' }));
  store.set(`snap:${day}:MSFT`, JSON.stringify({ symbol: 'MSFT', date: day, score: 12, signal: 'SELL', price: 1 }));
  store.set(`rank:${day}`, JSON.stringify({ date: day, analyzed: 0, table: [], categories: {} }));
  let fin = false; for (let i = 0; i < 80 && !fin; i++) fin = (await cronStep(mk(), { batch: 6, force: true })).finalized;
  assert.ok(fin);
  const a = JSON.parse(store.get(`snap:${day}:AAPL`)); assert.ok(!a.missing && a.score > 0, 'חסר מולא מחדש');
  const m = JSON.parse(store.get(`snap:${day}:MSFT`)); assert.equal(m.score, 12, 'ציון אמיתי נשמר');
  const r = JSON.parse(store.get(`rank:${day}`)); assert.ok(r.analyzed > 100, 'דירוג ריק הוחלף');
});
test('POST /paper/rebase — רווח "מההתחלה" כולל רק את מה שהאוטומט עשה; רישומים ידניים הופכים להתאמה, בלי למחוק כלום', async () => {
  await get('/paper/reset', { body: { initialIls: 200000 }, auth: true });
  const m = await get('/paper/order', { body: { symbol: 'AAPL', side: 'buy', qty: 10, reason: 'סיגנל BUY' }, auth: true }); assert.equal(m.status, 200);
  const a = await get('/paper/order', { body: { symbol: 'MSFT', side: 'buy', qty: 3, reason: 'אוטומט: בדיקה' }, auth: true }); assert.equal(a.status, 200);
  // מכירה ידנית בהפסד — כמו המכירות של 17/9 בחשבון האמיתי
  const s = await get('/paper/order', { body: { symbol: 'AAPL', side: 'sell', qty: 6, price: Math.round(m.j.price * 0.9 * 100) / 100 }, auth: true }); assert.equal(s.status, 200);
  const p0 = await get('/paper'); assert.equal(p0.j.baseIls, 200000); assert.equal(p0.j.adjustmentsIls, 0); assert.ok(p0.j.pnlIls < -100, 'ההפסד הידני מופיע לפני ההתאמה');
  const bd = await get('/paper/breakdown');
  const noAuth = await req('/paper/rebase', { method: 'POST' }); assert.equal(noAuth.status, 401);
  const r = await get('/paper/rebase', { method: 'POST', auth: true }); assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.ok(r.j.adjustIls < 0); assert.equal(r.j.manualNetIls, bd.j.bySource.manual.netIls);
  const p1 = await get('/paper');
  assert.equal(p1.j.baseIls, Math.round((200000 + r.j.adjustIls) * 100) / 100);
  assert.ok(Math.abs(p1.j.pnlIls - bd.j.bySource.autopilot.netIls) < 1, `pnl ${p1.j.pnlIls} vs autopilot ${bd.j.bySource.autopilot.netIls}`);
  assert.equal(p1.j.positions.length, 2, 'הפוזיציות לא נמחקו'); assert.equal(p1.j.closedCount, 1, 'העסקאות הסגורות לא נמחקו'); assert.equal(p1.j.account.initialIls, 200000);
  assert.equal(p1.j.account.adjustments.length, 1); assert.ok(/ידניים/.test(p1.j.account.adjustments[0].reason));
  const again = await get('/paper/rebase', { method: 'POST', auth: true }); assert.equal(again.status, 400, 'בלי force — לא מבצעים פעמיים');
  const forced = await get('/paper/rebase?force=1', { method: 'POST', auth: true }); assert.equal(forced.status, 200); assert.equal(forced.j.adjustIls, 0, 'הבסיס כבר תואם — אין התאמה נוספת');
  await get('/paper/reset', { body: { initialIls: 200000 }, auth: true });
  const p2 = await get('/paper'); assert.equal(p2.j.baseIls, 200000); assert.equal((p2.j.account.adjustments || []).length, 0, 'איפוס מלא מנקה גם התאמות');
});
test('POST /paper/autopilot-only — החשבון משקף רק את האוטומט: רישומים ידניים (פתוחים וסגורים) מוסרים לארכיון, המזומן והעמלות חוזרים', async () => {
  await get('/paper/reset', { body: { initialIls: 200000 }, auth: true });
  const m = await get('/paper/order', { body: { symbol: 'AAPL', side: 'buy', qty: 10, reason: 'סיגנל BUY' }, auth: true }); assert.equal(m.status, 200);
  const a = await get('/paper/order', { body: { symbol: 'MSFT', side: 'buy', qty: 3, reason: 'אוטומט: בדיקה' }, auth: true }); assert.equal(a.status, 200);
  const s = await get('/paper/order', { body: { symbol: 'AAPL', side: 'sell', qty: 6, price: Math.round(m.j.price * 0.9 * 100) / 100 }, auth: true }); assert.equal(s.status, 200);
  await get('/paper/rebase', { method: 'POST', auth: true });
  const p0 = await get('/paper'); assert.equal(p0.j.positions.length, 2); assert.equal(p0.j.closedCount, 1); assert.equal(p0.j.account.adjustments.length, 1);
  const noAuth = await req('/paper/autopilot-only', { method: 'POST' }); assert.equal(noAuth.status, 401);
  const r = await get('/paper/autopilot-only', { method: 'POST', auth: true }); assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.equal(r.j.removed, 2, 'רישום פתוח + רישום סגור של AAPL');
  const p1 = await get('/paper');
  assert.deepEqual(p1.j.positions.map((p) => p.symbol), ['MSFT']); assert.equal(p1.j.closedCount, 0); assert.equal(p1.j.realizedIls, 0);
  assert.equal(p1.j.baseIls, 200000); assert.equal((p1.j.account.adjustments || []).length, 0);
  // מזומן = ההתחלתי פחות עלות הקנייה של האוטומט בלבד; עמלות = עמלת האוטומט בלבד
  assert.equal(p1.j.cashIls, Math.round((200000 - a.j.result.trade.costIls) * 100) / 100);
  assert.equal(p1.j.commissionsIls, a.j.result.trade.feeIls);
  assert.equal(p1.j.equity.length, 0, 'עקומת השווי מתחילה מחדש');
  const bd1 = await get('/paper/breakdown'); assert.equal(bd1.j.reconciliation.diffIls, 0, 'התאמה חשבונאית עד האגורה: ההתחלתי + נטו העסקאות = השווי בפועל'); assert.equal(bd1.j.bySource.manual.trades, 0);
  const keys = [...store.keys()].filter((k) => k.startsWith('paper:archive:manual:')); assert.equal(keys.length, 1); assert.equal(JSON.parse(store.get(keys[0])).trades.length, 2);
  const again = await get('/paper/autopilot-only', { method: 'POST', auth: true }); assert.equal(again.j.removed, 0, 'אידמפוטנטי'); assert.equal(again.j.cashReturnedIls, 0);
  await get('/paper/reset', { body: { initialIls: 200000 }, auth: true });
});
test('POST /paper/autopilot-only — רישום ידני ישן שנסגר בלי exitFeeIls: עמלת היציאה משוחזרת, וגם בארכיון שכבר הוסר (פעם אחת)', async () => {
  await get('/paper/reset', { body: { initialIls: 200000 }, auth: true });
  const m = await get('/paper/order', { body: { symbol: 'AAPL', side: 'buy', qty: 10, reason: 'סיגנל BUY' }, auth: true });
  const a = await get('/paper/order', { body: { symbol: 'MSFT', side: 'buy', qty: 3, reason: 'אוטומט: בדיקה' }, auth: true });
  await get('/paper/order', { body: { symbol: 'AAPL', side: 'sell', qty: 10, price: Math.round(m.j.price * 0.9 * 100) / 100 }, auth: true });
  // מדמים רישום ישן: מוחקים את exitFeeIls מהרישום הסגור
  const tr = JSON.parse(store.get('paper:trades')); for (const x of tr) if (x.exitDate) delete x.exitFeeIls; store.set('paper:trades', JSON.stringify(tr));
  const r = await get('/paper/autopilot-only', { method: 'POST', auth: true }); assert.equal(r.j.removed, 1, 'מכירה של כל הלוט — רישום סגור אחד');
  const p1 = await get('/paper');
  assert.equal(p1.j.cashIls, Math.round((200000 - a.j.result.trade.costIls) * 100) / 100, 'המזומן חזר במלואו כולל עמלת היציאה המשוחזרת');
  assert.equal(p1.j.commissionsIls, a.j.result.trade.feeIls);
  // ארכיון שהוסר בגרסה קודמת בלי החזר עמלת יציאה — מושלם בקריאה הבאה, ורק פעם אחת
  const key = [...store.keys()].filter((k) => k.startsWith('paper:archive:manual:')).sort().pop(); /* הארכיון האחרון (בדיקות קודמות השאירו ארכיונים משלהן) */ const arc = JSON.parse(store.get(key)); delete arc.exitFeesReconciled; delete arc.exitFeesReconciledIls;
  store.set(key, JSON.stringify(arc));
  const cashBefore = p1.j.cashIls;
  const r2 = await get('/paper/autopilot-only', { method: 'POST', auth: true }); assert.equal(r2.j.removed, 0); assert.ok(r2.j.exitFeesReconciledIls > 0, JSON.stringify(r2.j));
  const p2 = await get('/paper'); assert.equal(p2.j.cashIls, Math.round((cashBefore + r2.j.exitFeesReconciledIls) * 100) / 100);
  const r3 = await get('/paper/autopilot-only', { method: 'POST', auth: true }); assert.equal(r3.j.cashReturnedIls, 0, 'לא מוחזר פעמיים');
  await get('/paper/reset', { body: { initialIls: 200000 }, auth: true });
});
test('ערוץ ה-Council: POST /council/comment מפרסם ב-Issue #25 עם PAT, נעול לסוד ולמכסה יומית, לא חושף סודות', async () => {
  const post = (text, key = 'council-shared-secret-1234', extra = {}) => worker.fetch(new Request('https://api.test/council/comment', { method: 'POST', headers: { 'CF-Connecting-IP': '1.1.1.1', 'Content-Type': 'application/json', ...(key ? { Authorization: 'Bearer ' + key } : {}) }, body: JSON.stringify({ text, ...extra }) }), env, { waitUntil(){} });
  assert.equal((await post('שלום', null)).status, 401);
  assert.equal((await post('שלום', 'wrong-secret-0000000000')).status, 401);
  assert.equal((await post('', 'council-shared-secret-1234')).status, 400);
  const n0 = githubPosts.length;
  const r = await post('בדקתי את ה-shadow: n=500 ✅. מפתח בדיקה: ghp_TESTTOKEN000000000001'); const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j)); assert.ok(j.url); assert.equal(j.usedToday, 1);
  assert.equal(githubPosts.length, n0 + 1); const gp = githubPosts[githubPosts.length - 1];
  assert.ok(gp.url.endsWith('/repos/meirco199-prog/bikur/issues/25/comments'), gp.url); assert.equal(gp.auth, 'Bearer ghp_TESTTOKEN000000000001');
  assert.match(gp.body, /^\*\*ChatGPT\*\*/); assert.ok(gp.body.includes('n=500')); assert.ok(!gp.body.includes('ghp_TESTTOKEN000000000001'), 'ערך סוד בטקסט מוסתר לפני הפרסום');
  const st = await worker.fetch(new Request('https://api.test/council/status', { headers: { 'CF-Connecting-IP': '1.1.1.1', Authorization: 'Bearer council-shared-secret-1234' } }), env, { waitUntil(){} }); const sj = await st.json(); assert.equal(sj.usedToday, 1); assert.equal(sj.issue, 25);
  // מכסה יומית
  const today = new Date().toISOString().slice(0, 10); store.set(`council:quota:${today}`, JSON.stringify(20));
  assert.equal((await post('עוד אחת')).status, 429);
  store.set(`council:quota:${today}`, JSON.stringify(0));
  // GitHub דוחה (PAT בלי הרשאה) → 502 עם הודעה, בלי לספור במכסה
  const bad = await worker.fetch(new Request('https://api.test/council/comment', { method: 'POST', headers: { 'CF-Connecting-IP': '1.1.1.1', 'Content-Type': 'application/json', Authorization: 'Bearer council-shared-secret-1234' }, body: JSON.stringify({ text: 'x' }) }), { ...env, GH_COUNCIL_TOKEN: 'ghp_badtoken0000000000' }, { waitUntil(){} });
  assert.equal(bad.status, 502); assert.match((await bad.json()).error, /GitHub דחה/);
  // לא מוגדר → 503 ברור
  const off = await worker.fetch(new Request('https://api.test/council/comment', { method: 'POST', headers: { 'CF-Connecting-IP': '1.1.1.1', 'Content-Type': 'application/json', Authorization: 'Bearer council-shared-secret-1234' }, body: JSON.stringify({ text: 'x' }) }), { ...env, COUNCIL_SECRET: undefined }, { waitUntil(){} });
  assert.equal(off.status, 503);
});
test('DELETE /paper/trade מוחק רישום פתוח בלבד ומחזיר מזומן', async () => {
  const before = (await get('/paper')).j.cashIls;
  const b = await get('/paper/order', { body: { symbol: 'GOOGL', side: 'buy', qty: 2, price: 100 }, auth: true }); const id = b.j.result.trade.id;
  assert.equal((await get('/paper/trade?id=' + id, { method: 'DELETE' })).status, 401);
  const d = await get('/paper/trade?id=' + id, { method: 'DELETE', auth: true }); assert.equal(d.status, 200);
  const p = await get('/paper'); assert.ok(!p.j.open.some((t) => t.id === id)); assert.ok(Math.abs(p.j.cashIls - before) < 0.01, 'המזומן הוחזר');
  assert.equal((await get('/paper/trade?id=nope', { method: 'DELETE', auth: true })).status, 400);
});

test('אוטומט: /auto/status, /auto/run (dry ואמיתי), פעם ביום, כיבוי בהגדרות', async () => {
  await get('/paper/reset', { body: { initialIls: 200000 }, auth: true });
  const st = await get('/auto/status'); assert.equal(st.status, 200); assert.equal(st.j.enabled, true); assert.ok(st.j.rules.riskBudget > 0 && st.j.rules.stopMin > 0);
  assert.equal((await get('/auto/run', { method: 'POST' })).status, 401);
  const dry = await get('/auto/run?dry=1', { method: 'POST', auth: true }); assert.equal(dry.status, 200, JSON.stringify(dry.j).slice(0, 300));
  assert.equal(dry.j.ran, true); assert.ok(Array.isArray(dry.j.orders)); assert.equal(dry.j.executed, false);
  const p0 = await get('/paper');
  const run = await get('/auto/run', { method: 'POST', auth: true }); assert.equal(run.status, 200); assert.equal(run.j.executed, true);
  const p1 = await get('/paper');
  const buys = run.j.orders.filter((o) => o.side === 'buy' && o.ok);
  if (buys.length){ assert.ok(p1.j.cashIls < p0.j.cashIls, 'המזומן ירד אחרי קניות'); assert.ok(p1.j.positions.some((x) => x.symbol === buys[0].symbol)); assert.ok(p1.j.open.every((t) => !t.reason.startsWith('אוטומט') || t.reason.length > 10)); }
  for (const o of run.j.orders) assert.ok(o.reason && o.name, 'לכל פקודה יש הסבר ושם');
  const again = await get('/auto/run', { method: 'POST', auth: true }); assert.equal(again.j.ran, false); assert.match(again.j.reason, /כבר רץ/);
  const st2 = await get('/auto/status'); assert.equal(st2.j.journal.length, 1); assert.equal(st2.j.last.day, run.j.day);
  await get('/settings', { body: { autopilot: false, riskProfile: 'growth' }, auth: true });
  const off = await get('/auto/run?force=1', { method: 'POST', auth: true }); assert.equal(off.j.ran, true, 'force מריץ גם כשכבוי');
  const st3 = await get('/auto/status'); assert.equal(st3.j.enabled, false); assert.equal(st3.j.profile, 'growth');
  const off2 = await get('/auto/run', { method: 'POST', auth: true }); assert.equal(off2.j.ran, false); assert.match(off2.j.reason, /כבוי/);
  await get('/settings', { body: { autopilot: true, riskProfile: 'balanced' }, auth: true });
});

test('אוטומט: חשבון ירושה עם מזומן שלילי מאופס פעם אחת ונרשם ביומן; הסוד של ה-cron לא מאפשר force', async () => {
  await get('/paper/reset', { body: { initialIls: 200000 }, auth: true });
  await env.INVEST.put('paper:account', JSON.stringify({ initialIls: 200000, cashIls: -9748, createdAt: '2026-09-16T00:00:00Z', commissionsIls: 0 }));
  await env.INVEST.put('paper:trades', JSON.stringify([{ id: 'pt_old', symbol: 'MA', side: 'buy', qty: 100, price: 573, currency: 'USD', fx: 3.66, costIls: 209748, date: '2026-09-15T00:00:00Z' }]));
  const r = await get('/auto/run?force=1', { method: 'POST', auth: true }); assert.equal(r.status, 200); assert.equal(r.j.ran, true);
  assert.ok(r.j.notes.some((n) => /אופס/.test(n)), JSON.stringify(r.j.notes));
  const p = await get('/paper'); assert.ok(p.j.cashIls >= 0); assert.ok(!p.j.positions.some((x) => x.symbol === 'MA'));
  const r2 = await get('/auto/run?force=1&secret=nope', { method: 'POST' }); assert.equal(r2.status, 401);
});

test('אוטומט: ביצוע רק בשעות המסחר בניו יורק — מחוץ לחלון נדחה בלי לרשום ביומן', async () => {
  const { inTradingWindow, nyClock } = await import('../lib/autopilot.js');
  assert.equal(inTradingWindow(new Date('2026-09-17T13:00:00Z')), false, '09:00 ET לפני הפתיחה');
  assert.equal(inTradingWindow(new Date('2026-09-17T14:00:00Z')), true, '10:00 EDT בתוך החלון');
  assert.equal(inTradingWindow(new Date('2026-09-19T15:00:00Z')), false, 'שבת');
  assert.equal(inTradingWindow(new Date('2026-12-15T14:30:00Z')), false, '09:30 EST (חורף) לפני 09:40');
  assert.equal(inTradingWindow(new Date('2026-12-15T15:00:00Z')), true, '10:00 EST בתוך החלון');
  assert.match(nyClock(new Date('2026-09-17T14:00:00Z')).text, /Thu 10:00 ET/);
  const gated = { ...env, AUTO_ANY_TIME: '0' };
  const r = await worker.fetch(new Request('https://api.test/auto/run', { method: 'POST', headers: { 'CF-Connecting-IP': '1.1.1.1', Authorization: 'Bearer secret' } }), gated, { waitUntil(){} });
  const j = await r.json();
  if (!inTradingWindow()) { assert.equal(j.ran, false); assert.ok(j.deferred || /כבר רץ היום/.test(j.reason), JSON.stringify(j).slice(0, 200)); } // כבר רץ היום = בדיקות קודמות באותו KV
});
