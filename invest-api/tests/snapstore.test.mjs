import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DB } from '../lib/db.js';
import { getSnap, listSnaps, putSnapsBatch, shardOf, SNAP_SHARDS } from '../lib/snapstore.js';

test('snapstore: כתיבה מקובצת ל-16 shards, בלי דריסת ציון קיים, קריאה מאוחדת עם המסלול הפר-נייר', async () => {
  const db = new DB(null);
  const snaps = [...Array(120)].map((_, i) => ({ symbol: 'Z' + i, score: i, signal: 'HOLD', price: 10 + i }));
  const r = await putSnapsBatch(db, '2026-09-17', snaps);
  assert.equal(r.written, 120); assert.ok(r.shards.length <= SNAP_SHARDS && r.shards.length > 8);
  const keys = await db.list('snaps:2026-09-17:'); assert.ok(keys.length <= SNAP_SHARDS, 'לא יותר מ-16 מסמכים');
  const z5 = await getSnap(db, '2026-09-17', 'Z5'); assert.equal(z5.score, 5); assert.equal(z5.computedBy, 'github-actions'); assert.equal(z5.date, '2026-09-17');
  // ניסיון לדרוס ציון קיים → מדולג; "חסר" מוחלף
  await putSnapsBatch(db, '2026-09-17', [{ symbol: 'ZZ', missing: true, reason: 'x' }]);
  const r2 = await putSnapsBatch(db, '2026-09-17', [{ symbol: 'Z5', score: 99 }, { symbol: 'ZZ', score: 7 }]);
  assert.equal(r2.skipped, 1); assert.equal(r2.written, 1);
  assert.equal((await getSnap(db, '2026-09-17', 'Z5')).score, 5); assert.equal((await getSnap(db, '2026-09-17', 'ZZ')).score, 7);
  // overwrite: ריצה חוזרת של הסריקה מחליפה snapshot קיים (למשל אחרי שמקור הדוחות חזר לעבוד)
  const r3 = await putSnapsBatch(db, '2026-09-17', [{ symbol: 'Z5', score: 61 }], { overwrite: true });
  assert.equal(r3.written, 1); assert.equal(r3.skipped, 0); assert.equal((await getSnap(db, '2026-09-17', 'Z5')).score, 61);
  // המסלול הפר-נייר גובר ומאוחד ברשימה
  await db.put('snap:2026-09-17:AAPL', { symbol: 'AAPL', score: 70 });
  await db.put('snap:2026-09-17:Z5', { symbol: 'Z5', score: 55 });
  const all = await listSnaps(db, '2026-09-17');
  assert.equal(all.length, 122); assert.equal(all.find((s) => s.symbol === 'Z5').score, 55);
  assert.equal((await getSnap(db, '2026-09-17', 'Z5')).score, 55);
  assert.equal(await getSnap(db, '2026-09-17', 'NOPE'), null);
  assert.equal(shardOf('AAPL'), shardOf('aapl'));
});

test('POST /ingest/snapshots: סוד, shards, דירוג מחושב מחדש כשהיום סגור, התראות רק לרשימת המעקב', async () => {
  const { installMockFetch } = await import('./mock-providers.mjs'); installMockFetch();
  const worker = (await import('../worker.js')).default;
  const store = new Map();
  const env = { INVEST: { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }) }, APP_TOKEN: 'secret', CRON_SECRET: 's3', STOOQ_ENABLED: '1', AUTO_ANY_TIME: '1' };
  const post = (path, body) => worker.fetch(new Request('https://api.test' + path, { method: 'POST', headers: { 'CF-Connecting-IP': '9.9.9.9', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, { waitUntil(){} });
  const get = async (path) => (await worker.fetch(new Request('https://api.test' + path, { headers: { 'CF-Connecting-IP': '9.9.9.9' } }), env, { waitUntil(){} })).json();
  const day = new Date().toISOString().slice(0, 10);
  assert.equal((await post('/ingest/snapshots?secret=bad', { snapshots: [] })).status, 401);
  const snaps = [...Array(60)].map((_, i) => ({ symbol: 'Q' + i, type: 'stock', sector: 'Technology', price: 50 + i, score: 30 + i, signal: i > 50 ? 'BUY' : 'HOLD', components: { fundamental: 60, valuation: 60, growth: 60, quality: 60, technical: 60, momentum: 60, risk: 60 }, coverage: 0.9 }));
  const r = await (await post('/ingest/snapshots?secret=s3', { date: day, snapshots: snaps })).json();
  assert.equal(r.written, 60); assert.equal(r.rerank, false, 'אין דירוג עדיין → לא מחשבים');
  assert.equal((await get(`/snapshot/${day}/Q7`)).score, 37);
  // אחרי שהיום "נסגר" (דירוג קיים) — הזרמה נוספת עם finalize מרחיבה את הדירוג
  store.set(`rank:${day}`, JSON.stringify({ date: day, analyzed: 60, table: [], categories: { buySignals: [] } }));
  const r2 = await (await post(`/ingest/snapshots?secret=s3&finalize=1`, { date: day, snapshots: [{ symbol: 'Q99', type: 'stock', price: 1, score: 80, signal: 'BUY', components: {} }] })).json();
  assert.equal(r2.rerank, true);
  const rank = await get('/rank?date=' + day); assert.equal(rank.analyzed, 61); assert.equal(rank.mergedBy, 'ingest');
});

test('rankSnapshots: תיוג universe לפי חברי המדד וספירה', async () => {
  const { rankSnapshots } = await import('../engine/pipeline.js');
  const snaps = [{ symbol: 'AAA', score: 60, signal: 'HOLD', type: 'stock', components: {} }, { symbol: 'BBB', score: 55, signal: 'HOLD', type: 'stock', components: {} }, { symbol: 'SPY', score: 70, signal: 'HOLD', type: 'etf', components: {} }];
  const r = rankSnapshots(snaps, { sp500: new Set(['AAA']) });
  assert.deepEqual(r.universes, { sp500: 1, extended: 2 });
  assert.equal(r.table.find((x) => x.symbol === 'AAA').universe, 'sp500'); assert.equal(r.table.find((x) => x.symbol === 'SPY').universe, 'extended');
  assert.equal(rankSnapshots(snaps).universes, null); assert.equal(rankSnapshots(snaps).table[0].universe, null);
});
