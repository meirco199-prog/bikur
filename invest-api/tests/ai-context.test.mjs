import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContext } from '../lib/ai.js';

const mem = () => { const store = new Map(); return { store, db: { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { store.set(k, JSON.stringify(v)); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }) } }; };

test('עוזר מחקר: "מה השתנה מאז אתמול" מקבל בלוק השוואה — שדרוגי סיגנל, תזוזות ציון/מחיר, אוטומט, תיק צל', async () => {
  const { db } = mem();
  await db.put('idx:snapdays', ['2026-09-17', '2026-09-18']);
  await db.put('rank:2026-09-17', { date: '2026-09-17', table: [
    { symbol: 'AAA', name: 'A', type: 'stock', score: 60, signal: 'HOLD', price: 10, dailyChange: 0.01 },
    { symbol: 'BBB', name: 'B', type: 'stock', score: 80, signal: 'STRONG BUY', price: 20, dailyChange: 0 },
  ], categories: { bestOverall: ['BBB'] } });
  await db.put('rank:2026-09-18', { date: '2026-09-18', table: [
    { symbol: 'AAA', name: 'A', type: 'stock', score: 72, signal: 'BUY', price: 11, dailyChange: 0.1 },
    { symbol: 'BBB', name: 'B', type: 'stock', score: 55, signal: 'HOLD', price: 19, dailyChange: -0.05 },
    { symbol: 'CCC', name: 'C', type: 'stock', score: 50, signal: 'HOLD', price: 5, dailyChange: 0.02 },
  ], categories: { bestOverall: ['AAA'] } });
  await db.put('regime:2026-09-17', { summary: 'Bull · Risk On' }); await db.put('regime:2026-09-18', { summary: 'Bull · Risk Off' });
  await db.put('auto:journal', [{ day: '2026-09-18', orders: [{ side: 'buy', qty: 3, symbol: 'AAA', ok: true, reason: 'BUY' }], notes: ['x'] }]);
  await db.put('paper:trades', [{ symbol: 'AAA', qty: 3, price: 11, date: '2026-09-18T14:00:00Z' }]);
  await db.put('aggr:state', { positions: {}, lastDay: '2026-09-18', pending: { orders: [{ side: 'buy', qty: 17, symbol: 'SPY', filled: false, reason: 'ליבה' }] } });
  const ctx = await buildContext(db, 'מה השתנה מאז אתמול?');
  const c = ctx.changesSinceYesterday;
  assert.ok(c, 'חסר בלוק השוואה');
  assert.equal(c.from, '2026-09-17'); assert.equal(c.to, '2026-09-18'); assert.equal(c.comparedSymbols, 2); assert.equal(c.newInRanking, 1);
  assert.deepEqual(c.signalUpgrades.map((r) => r.symbol), ['AAA']); assert.deepEqual(c.signalDowngrades.map((r) => r.symbol), ['BBB']);
  assert.equal(c.biggestScoreMoves[0].symbol, 'BBB'); assert.equal(c.biggestScoreMoves[0].delta, -25);
  assert.equal(c.biggestPriceMoves.up[0].symbol, 'AAA'); assert.equal(c.biggestPriceMoves.up[0].changePct, 10);
  assert.equal(c.regime.changed, true);
  assert.equal(c.autopilotRuns.length, 1); assert.match(c.autopilotRuns[0].orders[0], /buy 3 AAA/);
  assert.equal(c.paperTrades.length, 1);
  assert.match(c.aggressiveShadow.pendingOrders[0], /SPY/);
  // שאלה אחרת — בלי הבלוק (חוסך הקשר)
  assert.equal((await buildContext(db, 'מה הסיכון בתיק שלי?')).changesSinceYesterday, undefined);
});
