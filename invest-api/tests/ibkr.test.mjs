// חיבור הסוכן לחשבון הדמה של IBKR (מצב מראה): מיפוי חוזים ופקודות, לקוח ה-Gateway עם fetch מדומה (כולל לולאת אישורים),
// מסלולי ה-Worker (pending/fills/report) והשוואת מילויי הסימולציה למילויי הברוקר. בלי רשת.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ibkrContractSpec, toIbkrOrder, ibkrQty, pickFrontMonth, reconcileFills, normalizeBrokerOrder, needsConfirm, clipExitToHeld } from '../engine/ibkr-map.js';
import { IbkrClient } from '../lib/ibkr-client.js';
import { brokerPending, recordBroker, brokerReport } from '../lib/agent-broker.js';
import { DB } from '../lib/db.js';
import worker from '../worker.js';

test('מיפוי IBKR: ETF/קריפטו/מט"ח/חוזים, כמויות שלמות, צדדים', () => {
  assert.deepEqual(ibkrContractSpec('SPY'), { secType: 'STK', symbol: 'SPY', exchange: 'SMART', currency: 'USD' });
  assert.equal(ibkrContractSpec('BTC-USD').secType, 'CRYPTO'); assert.equal(ibkrContractSpec('BTC-USD').symbol, 'BTC');
  const fx = ibkrContractSpec('USDJPY'); assert.equal(fx.secType, 'CASH'); assert.equal(fx.symbol, 'USD'); assert.equal(fx.currency, 'JPY');
  const f = ibkrContractSpec('ZN~'); assert.equal(f.secType, 'FUT'); assert.equal(f.symbol, 'ZN'); assert.equal(f.exchange, 'CBOT');
  assert.equal(ibkrContractSpec('NOPE'), null);
  assert.equal(ibkrQty({ class: 'etf' }, 260.4338), 260); assert.equal(ibkrQty({ class: 'crypto' }, 0.1234567), 0.123457); assert.equal(ibkrQty({ class: 'etf' }, 0.7), 0);
  const o = toIbkrOrder({ order: { symbol: 'UVXY', side: 'short', qty: 260.4338, clientOrderId: 'agent:2026-09-23:trend:UVXY:short:v1' }, conid: 123, acctId: 'DU1' });
  assert.equal(o.ok, true); assert.equal(o.order.side, 'SELL'); assert.equal(o.order.quantity, 260); assert.equal(o.order.orderType, 'MKT'); assert.equal(o.order.tif, 'DAY'); assert.equal(o.order.cOID, 'agent:2026-09-23:trend:UVXY:short:v1');
  assert.equal(toIbkrOrder({ order: { symbol: 'SPY', side: 'buy', qty: 0.4 }, conid: 1, acctId: 'DU1' }).ok, false, 'כמות שמתעגלת ל-0 נדחית');
  assert.equal(toIbkrOrder({ order: { symbol: 'SPY', side: 'buy', qty: 1 }, conid: null, acctId: 'DU1' }).ok, false);
  const front = pickFrontMonth([{ conid: 1, expirationDate: '20260918' }, { conid: 2, expirationDate: '20260930' }, { conid: 3, expirationDate: '20261218' }], '2026-09-27');
  assert.equal(front.conid, 3, 'חוזה שפג תוך פחות מ-5 ימים מדולג, וגם חוזה שכבר פג');
  assert.equal(needsConfirm([{ id: 'abc', message: ['warning'] }]), true); assert.equal(needsConfirm([{ order_id: '1', order_status: 'Submitted' }]), false);
  const n = normalizeBrokerOrder({ orderId: 55, order_ref: 'x', ticker: 'SPY', side: 'BUY', status: 'Filled', filledQuantity: 5, avgPrice: '512.3', totalSize: 5 });
  assert.equal(n.orderId, '55'); assert.equal(n.filledQty, 5); assert.equal(n.avgPrice, 512.3); assert.equal(n.status, 'filled');
});

test('לקוח IBKR: סטטוס, conid לחוזה קרוב, פקודה עם לולאת אישור, ביטול', async () => {
  const calls = [];
  const f = async (url, opts = {}) => {
    const u = String(url).replace('https://gw/v1/api', ''); calls.push([opts.method, u, opts.body ? JSON.parse(opts.body) : null]);
    const ok = (d) => new Response(JSON.stringify(d), { status: 200, headers: { 'content-type': 'application/json' } });
    if (u === '/iserver/auth/status') return ok({ authenticated: true, connected: true });
    if (u === '/iserver/accounts') return ok({ accounts: ['DU123'] });
    if (u.startsWith('/trsrv/futures')) return ok({ MES: [{ conid: 700, expirationDate: '20260918' }, { conid: 701, expirationDate: '20261218' }] });
    if (u === '/iserver/secdef/search') return ok([{ conid: 42, symbol: 'SPY', sections: [{ secType: 'STK' }] }]);
    if (u === '/iserver/account/DU123/orders') return ok([{ id: 'confirm-1', message: ['You are about to submit a market order'] }]);
    if (u === '/iserver/reply/confirm-1') return ok([{ order_id: '9001', order_status: 'Submitted' }]);
    if (u === '/portfolio/DU123/summary') return ok({ netliquidation: { amount: 1000092.95 }, totalcashvalue: { amount: 990000 } });
    if (u === '/portfolio/DU123/positions/0') return ok([{ conid: 42, contractDesc: 'SPY', position: 5, avgPrice: 512.3, mktPrice: 513, mktValue: 2565, unrealizedPnl: 3.5 }]);
    if (u === '/iserver/account/orders') return ok({ orders: [{ orderId: 9001, order_ref: 'agent:2026-09-26:trend:SPY:buy:v1', ticker: 'SPY', side: 'BUY', status: 'Filled', filledQuantity: 5, avgPrice: 512.3, totalSize: 5 }] });
    if (u === '/iserver/account/DU123/order/9001' && opts.method === 'DELETE') return ok({ msg: 'Request was submitted' });
    return new Response('not found', { status: 404 });
  };
  const ib = new IbkrClient({ base: 'https://gw/v1/api', fetch: f });
  assert.equal((await ib.authStatus()).authenticated, true);
  assert.deepEqual(await ib.accounts(), ['DU123']);
  assert.equal((await ib.resolveConid('MES', '2026-09-27')).conid, 701); assert.equal((await ib.resolveConid('SPY')).conid, 42);
  assert.equal((await ib.resolveConid('SPY')).conid, 42, 'מטמון conid'); assert.equal(calls.filter((c) => c[1] === '/iserver/secdef/search').length, 1);
  const r = await ib.placeOrder('DU123', { conid: 42, orderType: 'MKT', side: 'BUY', quantity: 5, tif: 'DAY', cOID: 'x' });
  assert.equal(r.orderId, '9001'); assert.equal(r.messages.length, 1); assert.ok(calls.some((c) => c[1] === '/iserver/reply/confirm-1' && c[2].confirmed === true));
  const s = await ib.summary('DU123'); assert.equal(s.netLiquidationUsd, 1000092.95);
  const p = await ib.positions('DU123'); assert.equal(p[0].qty, 5); assert.equal(p[0].symbol, 'SPY');
  const o = await ib.orders(); assert.equal(o.length, 1);
  await ib.cancel('DU123', '9001'); assert.ok(calls.some((c) => c[0] === 'DELETE'));
  await assert.rejects(() => ib.get('/nope'), /HTTP 404/);
});

test('השוואת מילויים: מלא/חלקי/חסר, החלקה, ופקודות עודפות בברוקר', () => {
  const sim = [{ clientOrderId: 'a', symbol: 'SPY', side: 'buy', qty: 5, price: 500 }, { clientOrderId: 'b', symbol: 'UVXY', side: 'short', qty: 260.4, price: 16 }, { clientOrderId: 'c', symbol: 'GLD', side: 'buy', qty: 2, price: 250 }];
  const br = [{ clientOrderId: 'a', filledQty: 5, avgPrice: 501, status: 'filled' }, { clientOrderId: 'b', filledQty: 100, avgPrice: 16.2, status: 'submitted' }, { clientOrderId: 'z', filledQty: 1, avgPrice: 1 }];
  const r = reconcileFills(sim, br);
  assert.equal(r.rows[0].status, 'filled'); assert.equal(r.rows[0].slipPct, 0.002, 'קנייה ב-501 מול 500 = החלקה 0.2% לרעתנו');
  assert.equal(r.rows[1].status, 'partial'); assert.equal(r.rows[1].slipPct, -0.0125, 'שורט ב-16.2 מול 16 = לטובתנו');
  assert.equal(r.rows[2].status, 'missing'); assert.deepEqual(r.extraBroker, ['z']);
  assert.equal(r.summary.filled, 1); assert.equal(r.summary.partial, 1); assert.equal(r.summary.missing, 1); assert.equal(r.summary.avgSlipPct, 0.002);
});

test('Worker: /agent/broker — pending לגשר, רישום מילויים והשוואה, דוח ציבורי, הרשאות', async () => {
  const store = new Map();
  const env = { INVEST: { get: async (k, type) => (store.has(k) ? (type === 'text' ? store.get(k) : JSON.parse(store.get(k))) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async () => ({ keys: [], list_complete: true }) }, APP_TOKEN: 'secret', CRON_SECRET: 'cron-s', BRIDGE_SECRET: 'bridge-s', RATE_LIMIT_OFF: '1' };
  const call = (path, { method = 'GET', body } = {}) => worker.fetch(new Request('https://api.test' + path, { method, headers: { 'CF-Connecting-IP': '9.9.9.9', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil(){} }).then(async (r) => ({ status: r.status, j: await r.json() }));
  const r0 = await call('/agent/broker'); assert.equal(r0.status, 200); assert.equal(r0.j.missing, true);
  assert.equal((await call('/agent/broker/pending')).status, 401, 'בלי סוד — אסור');
  assert.equal((await call('/agent/broker/pending?secret=wrong')).status, 401);
  store.set('agent:state', JSON.stringify({ lastDay: '2026-09-26', initialUsd: 66000, positions: {} }));
  store.set('agent:pending', JSON.stringify({ day: '2026-09-26', decidedAt: 'x', orders: [{ symbol: 'XBI', side: 'buy', qty: 41, price: 100, strategy: 'xmom', clientOrderId: 'agent:2026-09-26:xmom:XBI:buy:v1' }] }));
  store.set('agent:journal', JSON.stringify([{ id: 'ag_1', kind: 'stop', day: '2026-09-26', symbol: 'COPX', side: 'sell', qty: 72, price: 84.1, reason: 'עצירה' }, { id: 'ag_2', kind: 'fill', day: '2026-09-29', symbol: 'XBI', side: 'buy', qty: 41, price: 100.2, clientOrderId: 'agent:2026-09-26:xmom:XBI:buy:v1' }]));
  const p = await call('/agent/broker/pending?secret=bridge-s'); assert.equal(p.status, 200);
  assert.equal(p.j.mode, 'mirror'); assert.equal(p.j.orders.length, 1); assert.equal(p.j.orders[0].sent, null); assert.equal(p.j.exits.length, 1); assert.match(p.j.exits[0].clientOrderId, /^agent:2026-09-26:exit:COPX:sell:/); assert.equal(p.j.killSwitch, false);
  const rep = await call('/agent/broker/fills?secret=cron-s', { method: 'POST', body: { day: '2026-09-29', status: { authenticated: true, account: 'DU123' }, sent: [{ clientOrderId: 'agent:2026-09-26:xmom:XBI:buy:v1', orderId: '9001', symbol: 'XBI', side: 'buy', qty: 41 }], fills: [{ clientOrderId: 'agent:2026-09-26:xmom:XBI:buy:v1', orderId: '9001', filledQty: 41, avgPrice: 100.5, status: 'filled' }], account: { netLiquidationUsd: 1000000 }, positions: [{ symbol: 'XBI', qty: 41 }] } });
  assert.equal(rep.status, 200); assert.equal(rep.j.reconcile.filled, 1); assert.equal(rep.j.sent, 1);
  const p2 = await call('/agent/broker/pending?secret=bridge-s'); assert.equal(p2.j.orders[0].sent.orderId, '9001', 'אחרי הדיווח הפקודה מסומנת כנשלחה');
  const r1 = await call('/agent/broker'); assert.equal(r1.j.authenticated, true); assert.equal(r1.j.account, 'DU123'); assert.equal(r1.j.reconcile.summary.filled, 1); assert.equal(r1.j.reconcile.rows[0].slipPct, 0.003); assert.equal(r1.j.sizeRatio, 15.15); assert.equal(r1.j.positions.length, 1);
  const r2 = await call('/agent/broker/fills?secret=bridge-s', { method: 'POST', body: { day: '2026-09-29', status: { authenticated: false }, errors: ['gateway not authenticated'] } });
  assert.equal(r2.status, 200); const r3 = await call('/agent/broker'); assert.equal(r3.j.authenticated, false); assert.equal(r3.j.fills.length, 1, 'דיווח סטטוס לא מוחק מילויים קודמים'); assert.equal(r3.j.errors.length, 1);
  // ישירות (בלי Worker): DB בזיכרון
  const db = new DB(null); await db.put('agent:pending', { day: null, orders: [] }); const bp = await brokerPending(db); assert.equal(bp.orders.length, 0); assert.equal((await brokerReport(db)).missing, true);
  const rr = await recordBroker(db, { day: '2026-09-29', fills: [] }); assert.equal(rr.ok, true);
});

test('יציאה מול מה שהדמה מחזיק: אין פוזיציה → דילוג (לא פותחים שורט), פוזיציה קטנה → חיתוך, כניסה לא נבדקת', () => {
  const stopLong = { kind: 'stop', symbol: 'ARKK', side: 'sell', qty: 70 };
  assert.equal(clipExitToHeld(stopLong, 0).ok, false, 'הדמה לא מחזיק ARKK — מכירה הייתה פותחת שורט');
  assert.equal(clipExitToHeld(stopLong, -70).ok, false, 'שורט בדמה לא נסגר ב-sell');
  assert.deepEqual(clipExitToHeld(stopLong, 70), { ok: true, qty: 70, reason: undefined });
  assert.equal(clipExitToHeld(stopLong, 30).qty, 30, 'הדמה מחזיק פחות — חותכים לכמות המוחזקת');
  const coverShort = { kind: 'liquidation', symbol: 'UVXY', side: 'cover', qty: 260 };
  assert.equal(clipExitToHeld(coverShort, 0).ok, false); assert.equal(clipExitToHeld(coverShort, 100).ok, false, 'לונג בדמה לא נסגר ב-cover');
  assert.equal(clipExitToHeld(coverShort, -260).qty, 260); assert.equal(clipExitToHeld(coverShort, -100).qty, 100);
  assert.deepEqual(clipExitToHeld({ kind: 'entry', symbol: 'SMH', side: 'buy', qty: 10 }, 0), { ok: true, qty: 10 }, 'כניסה חדשה לא תלויה בפוזיציה');
});
