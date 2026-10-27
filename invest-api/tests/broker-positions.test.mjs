// קריאת פוזיציות שנכשלה בגשר (למשל 503 מה-Gateway) לא מוחקת את תמונת הדמה (Issue #25, ממצא ChatGPT 27/10/2026):
// לפני התיקון הגשר שלח positions=[] ו-recordBroker החליף את הרשימה הקודמת ב-[] עם updatedAt טרי — הדוח הראה 0 פוזיציות ו-0 יתומות.
// עכשיו: כישלון → התמונה האחרונה נשמרת (positionsAt המקורי, positionsVerified=false) ויתומות לא מחושבות; רשימה ריקה אמיתית → 0 פוזיציות.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMockFetch } from './mock-providers.mjs';
import worker from '../worker.js';

installMockFetch();
const mkEnv = (store) => ({ INVEST: { get: async (k, type) => (store.has(k) ? (type === 'text' ? store.get(k) : JSON.parse(store.get(k))) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix = '' } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) }, FINNHUB_KEY: 'x', APP_TOKEN: 'secret', CRON_SECRET: 'cron-s', BRIDGE_SECRET: 'bridge-s', RATE_LIMIT_OFF: '1' });
const mkCall = (env) => (path, { method = 'GET', body } = {}) => worker.fetch(new Request('https://api.test' + path, { method, headers: { 'CF-Connecting-IP': '9.9.9.9', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil(){} }).then(async (r) => ({ status: r.status, j: await r.json() }));
const D1 = '2026-10-26', D2 = '2026-10-27';
const ok = { authenticated: true, account: 'DUT1' };
const POS = [{ symbol: 'ZZZ', secType: 'STK', qty: 10, unrealizedUsd: 12 }, { symbol: 'APA', secType: 'STK', qty: 149, unrealizedUsd: 450 }];
const fills = (call, day, extra) => call('/agent/broker/fills?secret=bridge-s', { method: 'POST', body: { day, status: ok, sent: [], fills: [], account: { netLiquidationUsd: 64000, cashUsd: 20000 }, errors: [], ...extra } });
const ERR503 = 'positions: IBKR GET /portfolio/DUT1/positions/0 → HTTP 503: Service Unavailable';

async function good(call){
  // ZZZ נשלח על ידי הסוכן והסימולציה לא מחזיקה אותו → יתומה; כך רואים שהיתומות מחושבות על תמונה מאומתת
  const r = await fills(call, D1, { sent: [{ clientOrderId: `agent:${D1}:trend:ZZZ:buy:v1`, orderId: '1', at: `${D1}T13:31:00.000Z`, symbol: 'ZZZ', side: 'buy', qty: 10 }], positions: POS });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const b = (await call('/agent/broker')).j;
  assert.equal(b.positions.length, 2); assert.equal(b.positionsVerified, true); assert.deepEqual(b.orphans.map((o) => o.symbol), ['ZZZ']);
  return b;
}

test('503 בקריאת הפוזיציות (גשר מעודכן: positions=null) → התמונה האחרונה נשמרת, מסומנת לא מאומתת, ויתומות לא מחושבות', async () => {
  const store = new Map(); const call = mkCall(mkEnv(store));
  const b1 = await good(call);
  await fills(call, D1, { positions: null, errors: [ERR503] });
  const b = (await call('/agent/broker')).j;
  assert.equal(b.positions.length, 2, 'לא "0 פוזיציות" בגלל 503');
  assert.equal(b.positionsVerified, false);
  assert.equal(b.positionsAt, b1.positionsAt, 'חותמת הזמן של הפוזיציות היא של הקריאה המוצלחת, לא של הדיווח הכושל');
  assert.equal(b.orphans, null, 'לא מציגים "0 יתומות" על תמונה לא מאומתת'); assert.ok(b.orphansSkipped);
  assert.ok(b.errors.some((e) => /^positions:/.test(e)));
  const r = await call('/agent/broker/orphans?secret=cron-s', { method: 'POST' });
  assert.equal(r.j.ok, false, 'אין סגירת יתומות על תמונה לא מאומתת: ' + JSON.stringify(r.j));
  assert.equal(store.has('agent:broker:cleanup'), false);
  // הקריאה הבאה מצליחה → מאומת שוב
  await fills(call, D1, { positions: POS });
  const b3 = (await call('/agent/broker')).j;
  assert.equal(b3.positionsVerified, true); assert.deepEqual(b3.orphans.map((o) => o.symbol), ['ZZZ']);
});

test('גשר ישן ששולח [] יחד עם שגיאת "positions:" — מטופל כקריאה שנכשלה', async () => {
  const store = new Map(); const call = mkCall(mkEnv(store));
  await good(call);
  await fills(call, D1, { positions: [], errors: [ERR503] });
  const b = (await call('/agent/broker')).j;
  assert.equal(b.positions.length, 2); assert.equal(b.positionsVerified, false); assert.equal(b.orphans, null);
});

test('יום חדש שהקריאה הראשונה בו נכשלה → התמונה האחרונה מהיום הקודם (לא רשימה ריקה)', async () => {
  const store = new Map(); const call = mkCall(mkEnv(store));
  const b1 = await good(call);
  await fills(call, D2, { positions: null, errors: [ERR503] });
  const b = (await call('/agent/broker')).j;
  assert.equal(b.day, D2); assert.equal(b.positions.length, 2); assert.equal(b.positionsVerified, false); assert.equal(b.positionsAt, b1.positionsAt);
});

test('רשימה ריקה אמיתית (קריאה מוצלחת) → 0 פוזיציות, מאומת, 0 יתומות', async () => {
  const store = new Map(); const call = mkCall(mkEnv(store));
  await good(call);
  await fills(call, D1, { positions: [] });
  const b = (await call('/agent/broker')).j;
  assert.equal(b.positions.length, 0); assert.equal(b.positionsVerified, true); assert.deepEqual(b.orphans, []);
});

test('דיווח בלי ניסיון לקרוא פוזיציות (Gateway לא מחובר) לא משנה את מצב האימות', async () => {
  const store = new Map(); const call = mkCall(mkEnv(store));
  await good(call);
  await call('/agent/broker/fills?secret=bridge-s', { method: 'POST', body: { day: D1, status: { authenticated: false }, errors: ['gateway not authenticated'] } });
  const b = (await call('/agent/broker')).j;
  assert.equal(b.positions.length, 2); assert.equal(b.positionsVerified, true); assert.deepEqual(b.orphans.map((o) => o.symbol), ['ZZZ']);
});
