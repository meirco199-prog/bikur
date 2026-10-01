// מניות S&P 500 ביקום הסוכן (החלטת בעל הריפו 1/10: "תוסיף"): רישום דינמי, POST/GET /agent/stocks (הרשאות, אימות יום),
// סריקה לילית טהורה (buildStockScan), מיזוג המועמדים בהחלטה של הסוכן רק כשהסריקה מאותו סשן, מילוי למחרת ותמחור המניה, והגשר.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMockFetch } from './mock-providers.mjs';
import worker from '../worker.js';
import { AGENT_INSTRUMENTS, priceSymbolOf, instrumentOf, stockInstrument, stockSector, registerInstruments, dynamicInstruments } from '../engine/instruments.js';
import { toIbkrOrder } from '../engine/ibkr-map.js';
import { buildStockScan } from '../scripts/nightly-sp500.mjs';

installMockFetch();
const store = new Map();
const env = { INVEST: { get: async (k, type) => (type === 'text' ? (store.has(k) ? store.get(k) : null) : (store.has(k) ? JSON.parse(store.get(k)) : null)), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix = '' } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) }, FINNHUB_KEY: 'x', APP_TOKEN: 'secret', CRON_SECRET: 'cron-secret-for-tests', BRIDGE_SECRET: 'bridge-secret-for-tests', RATE_LIMIT_OFF: '1' };
const call = (path, { method = 'GET', body } = {}) => worker.fetch(new Request('https://api.test' + path, { method, headers: { 'CF-Connecting-IP': '9.9.9.8', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil(){} }).then(async (r) => ({ status: r.status, j: await r.json() }));
const S = '?secret=cron-secret-for-tests';

function tradingDays(n, endIso){ const out = []; const d = new Date(endIso + 'T00:00:00Z'); while (out.length < n){ if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); } return out; }
const DAYS = tradingDays(300, '2026-09-22'); const DAY = '2026-09-22'; const NEXT = '2026-09-23';
const mk = (f) => DAYS.map((d, i) => { const c = f(i); return [d, c * 0.999, c * 1.006, c * 0.994, c, 2e6]; });
const flat = (h) => (i) => 100 * (1 + 0.015 * Math.sin(i / (8 + h)));
// יקום מניות קטן: NVDA במגמת עלייה חזקה, INTC בירידה, השאר שטוחות
const STOCK_ROWS = { NVDA: mk((i) => 120 * Math.exp(0.0018 * i) * (1 + 0.006 * Math.sin(i / 6))), INTC: mk((i) => 40 * Math.exp(-0.0018 * i) * (1 + 0.006 * Math.sin(i / 6))), KO: mk(flat(2)), PG: mk(flat(4)), XOM: mk(flat(5)) };
const ITEMS = [{ symbol: 'NVDA', name: 'NVIDIA', sector: 'Information Technology' }, { symbol: 'INTC', name: 'Intel', sector: 'Information Technology' }, { symbol: 'KO', name: 'Coca-Cola', sector: 'Consumer Staples' }, { symbol: 'PG', name: 'Procter & Gamble', sector: 'Consumer Staples' }, { symbol: 'XOM', name: 'Exxon', sector: 'Energy' }];

test('מכשירים: מניה דינמית נרשמת, לא דורסת את היקום הקבוע, וממופה ל-IBKR כ-STK', () => {
  assert.equal(stockSector('Information Technology'), 'tech'); assert.equal(stockSector('Health Care'), 'health'); assert.equal(stockSector(null), 'stocks');
  const nv = stockInstrument('NVDA', { name: 'NVIDIA', sector: 'tech' });
  assert.equal(nv.class, 'stock'); assert.equal(nv.leverage, 1); assert.equal(nv.units, 1); assert.equal(nv.dynamic, true); assert.equal(nv.shortable, true);
  const spyBefore = instrumentOf('SPY');
  registerInstruments([nv, stockInstrument('SPY', { name: 'fake' })]);
  assert.equal(instrumentOf('SPY'), spyBefore, 'סימבול מהיקום הקבוע לא נדרס');
  assert.equal(instrumentOf('NVDA').name, 'NVIDIA'); assert.ok(dynamicInstruments().some((i) => i.symbol === 'NVDA')); assert.ok(!dynamicInstruments().some((i) => i.symbol === 'SPY'));
  const o = toIbkrOrder({ order: { symbol: 'NVDA', side: 'buy', qty: 7, clientOrderId: 'agent:x' }, conid: 4815747, acctId: 'DU1' });
  assert.equal(o.ok, true, JSON.stringify(o)); assert.equal(o.order.side, 'BUY'); assert.equal(o.order.quantity, 7);
});

test('סריקה לילית (buildStockScan): רק נתונים עד הסשן, רק מועמדים של אותו יום, בלי מחקר; יקום עם סקטורים', () => {
  const withToday = { ...STOCK_ROWS, NVDA: [...STOCK_ROWS.NVDA, [NEXT, 1, 1, 1, 1, 1]] }; // בר תוך-יומי של מחר לא נכנס
  const scan = buildStockScan({ rowsBySym: withToday, items: ITEMS, day: DAY });
  assert.equal(scan.day, DAY); assert.equal(scan.scanned, 5); assert.equal(scan.universe.length, 5);
  assert.ok(scan.candidates.length > 0, JSON.stringify(scan.summary));
  assert.ok(scan.candidates.every((c) => c.day === DAY && !c.needsResearch && !c.conflict && c.class === 'stock'));
  const nv = scan.candidates.find((c) => c.symbol === 'NVDA' && c.side === 'long'); assert.ok(nv, JSON.stringify(scan.candidates.map((c) => [c.symbol, c.strategy, c.side])));
  assert.equal(nv.sector, 'tech'); assert.ok(Math.abs(nv.price - STOCK_ROWS.NVDA[STOCK_ROWS.NVDA.length - 1][4]) < 0.01, 'מחיר הסגירה של הסשן, לא של הבר הבא');
  assert.ok(buildStockScan({ rowsBySym: STOCK_ROWS, items: ITEMS, day: DAY, top: 1 }).candidates.length <= 1);
});

test('Worker: /agent/stocks — POST רק בסוד ה-cron, יום חובה, מועמדים מיום אחר/מחקר נזרקים; GET ציבורי', async () => {
  assert.equal((await call('/agent/stocks', { method: 'POST', body: { day: DAY } })).status, 401);
  assert.equal((await call('/agent/stocks?secret=bridge-secret-for-tests', { method: 'POST', body: { day: DAY } })).status, 401, 'סוד הגשר לא מספיק');
  assert.equal((await call('/agent/stocks' + S, { method: 'POST', body: { day: 'x' } })).status, 400);
  const good = { symbol: 'AAA', day: DAY, side: 'long', strategy: 'trend', price: 10, stop: 9, score: 70 };
  const r = await call('/agent/stocks' + S, { method: 'POST', body: { day: DAY, scanned: 3, candidates: [good, { ...good, symbol: 'BBB', day: '2026-09-21' }, { ...good, symbol: 'CCC', needsResearch: true }, { ...good, symbol: 'bad sym' }, { ...good, symbol: 'DDD', price: 'x' }], universe: [{ symbol: 'AAA', name: 'A', sector: 'Energy' }, { symbol: '???' }] } });
  assert.equal(r.status, 200, JSON.stringify(r.j)); assert.equal(r.j.candidates, 1); assert.equal(r.j.universe, 1);
  const g = await call(`/agent/stocks?date=${DAY}`); assert.equal(g.j.day, DAY); assert.deepEqual(g.j.candidates.map((c) => c.symbol), ['AAA']); assert.equal(g.j.candidates[0].fromStockScan, true);
  assert.equal((await call('/agent/stocks?date=2026-01-02')).j.missing, true);
  store.clear();
});

const seedStatic = () => {
  const now = new Date().toISOString();
  for (const sym of new Set(AGENT_INSTRUMENTS.map(priceSymbolOf))){ const h = [...sym].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 7; store.set(`px:${sym}`, JSON.stringify({ symbol: sym, currency: 'USD', source: 'seed', rows: mk(sym === 'SPY' ? (i) => 500 * (1 + 0.0003 * i) : flat(h)), fetchedAt: now })); }
  store.set('fx:USDILS', JSON.stringify({ rate: 3.7, fetchedAt: now }));
};
const addBar = (sym, day) => { const v = JSON.parse(store.get(`px:${sym}`)); const last = v.rows[v.rows.length - 1]; const o = last[4] * 1.002; v.rows.push([day, o, o * 1.004, o * 0.996, o * 1.001, 2e6]); store.set(`px:${sym}`, JSON.stringify(v)); };

test('סוכן: סריקת מניות מסשן אחר לא נכנסת להחלטה', async () => {
  store.clear(); seedStatic();
  const scan = buildStockScan({ rowsBySym: STOCK_ROWS, items: ITEMS, day: DAY });
  // הסריקה שמורה תחת היום של ההחלטה, אבל המועמדים מסשן קודם (תרחיש: מפתח שנכתב ידנית/באג) → מסוננים
  store.set(`agent:stocks:${DAY}`, JSON.stringify({ day: DAY, scanned: 5, candidates: scan.candidates.map((c) => ({ ...c, day: '2026-09-21', fromStockScan: true })) }));
  store.set('agent:stocks:universe', JSON.stringify({ day: DAY, items: ITEMS }));
  const r = await call(`/agent/run${S}&date=${DAY}&batch=12`, { method: 'POST' });
  assert.equal(r.j.phase, 'done', JSON.stringify(r.j)); assert.equal(r.j.stocks.candidates, 0);
  assert.ok(!r.j.ordersForTomorrow.some((o) => /NVDA|INTC/.test(o)), JSON.stringify(r.j.ordersForTomorrow));
  store.clear();
});

test('סוכן: מועמד מניה מהסריקה הלילית → פקודה למחר (class=stock), מילוי בפתיחה עם תמחור המניה, דוח וגשר', async () => {
  store.clear(); seedStatic();
  const scan = buildStockScan({ rowsBySym: STOCK_ROWS, items: ITEMS, day: DAY });
  const post = await call('/agent/stocks' + S, { method: 'POST', body: scan }); assert.equal(post.status, 200, JSON.stringify(post.j)); assert.ok(post.j.candidates > 0);
  const r1 = await call(`/agent/run${S}&date=${DAY}&batch=12`, { method: 'POST' });
  assert.equal(r1.j.phase, 'done', JSON.stringify(r1.j)); assert.ok(r1.j.stocks.candidates > 0 && r1.j.stocks.scanDay === DAY, JSON.stringify(r1.j.stocks));
  const opps = JSON.parse(store.get(`agent:opps:${DAY}`));
  assert.ok(r1.j.ordersForTomorrow.some((o) => /buy .* NVDA/.test(o)), JSON.stringify({ ords: r1.j.ordersForTomorrow, gate: opps.gateLog.filter((g) => /NVDA|INTC/.test(g.symbol)) }));
  const pend = JSON.parse(store.get('agent:pending')); const nvOrd = pend.orders.find((o) => o.symbol === 'NVDA');
  assert.equal(nvOrd.class, 'stock'); assert.equal(nvOrd.sector, 'tech'); assert.match(nvOrd.reason, /S&P 500/);
  assert.ok(opps.candidates.some((c) => c.symbol === 'NVDA'), 'המועמד מופיע בדוח ההזדמנויות'); assert.equal(opps.summary.stocks.candidates, r1.j.stocks.candidates);
  // הגשר: הפקודה יוצאת עם inst.class=stock (הגשר רושם אותה אצלו ושולח STK)
  const bp = await call('/agent/broker/pending?secret=bridge-secret-for-tests'); const bo = bp.j.orders.find((o) => o.symbol === 'NVDA');
  assert.equal(bo.inst.class, 'stock'); assert.equal(bo.inst.units, 1);
  // יום 2: המניה מתומחרת (px:NVDA בבסיס — במציאות Twelve Data) כי היא ממתינה למילוי; מילוי בפתיחת 23/9
  store.set('px:NVDA', JSON.stringify({ symbol: 'NVDA', currency: 'USD', source: 'seed', rows: STOCK_ROWS.NVDA, fetchedAt: new Date().toISOString() }));
  for (const sym of new Set(AGENT_INSTRUMENTS.map(priceSymbolOf))) addBar(sym, NEXT);
  addBar('NVDA', NEXT);
  const r2 = await call(`/agent/run${S}&date=${NEXT}&batch=12`, { method: 'POST' });
  assert.equal(r2.j.phase, 'done', JSON.stringify(r2.j)); assert.equal(r2.j.stocks.candidates, 0, 'אין סריקת מניות ל-23/9 → אין מועמדי מניות חדשים');
  const rep = (await call('/agent/report')).j;
  const pos = rep.positions.find((p) => p.symbol === 'NVDA'); assert.ok(pos && pos.side === 'long' && pos.qty > 0, JSON.stringify(rep.positions.map((p) => p.symbol)));
  const f = rep.journal.find((j) => j.kind === 'fill' && j.symbol === 'NVDA'); const open23 = JSON.parse(store.get('px:NVDA')).rows.at(-1)[1];
  assert.ok(Math.abs(f.price / open23 - 1) < 0.001, `מילוי בפתיחת 23/9: ${f.price} מול ${open23}`);
  assert.ok(rep.universe.stocks >= 5, 'הדוח מציג את גודל יקום המניות');
});
