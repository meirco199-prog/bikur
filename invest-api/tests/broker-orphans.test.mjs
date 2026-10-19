// פוזיציות יתומות בדמה של IBKR (באג 16/10–19/10/2026): הגשר שלח בפתיחה את פקודות הסוכן (IT/MTD/MRNA/CSGP), הסימולציה דחתה אותן
// בלילה "אין מחיר פתיחה" (הסדרה של מניה חדשה לא התקבלה בניסיון היחיד — lib/agent.js, שלב התמחור), ואף אחד לא סגר את הפוזיציות בדמה.
// כאן: (1) מכשיר שפקודה ממתינה תלויה בו מקבל ניסיונות חוזרים במקום דחייה מיידית; (2) פקודה שנשלחה לדמה ונדחתה בסימולציה מייצרת
// סגירה בדמה (kind=stop לגשר → נחתכת למה שמוחזק); (3) ביומן המילוי — המזהה שנשלח לברוקר (reconcile מתאים); (4) זיהוי וסגירה
// חד-פעמית של היתומות הקיימות, על תמונת המצב האמיתית של 19/10.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMockFetch } from './mock-providers.mjs';
import worker from '../worker.js';
import { AGENT_INSTRUMENTS, priceSymbolOf } from '../engine/instruments.js';
import { FILL_PRICE_RETRIES } from '../lib/agent.js';
import { clipExitToHeld } from '../engine/ibkr-map.js';

installMockFetch();
const mkEnv = (store) => ({ INVEST: { get: async (k, type) => (store.has(k) ? (type === 'text' ? store.get(k) : JSON.parse(store.get(k))) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix = '' } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) }, FINNHUB_KEY: 'x', APP_TOKEN: 'secret', CRON_SECRET: 'cron-s', BRIDGE_SECRET: 'bridge-s', RATE_LIMIT_OFF: '1' });
const mkCall = (env) => (path, { method = 'GET', body } = {}) => worker.fetch(new Request('https://api.test' + path, { method, headers: { 'CF-Connecting-IP': '9.9.9.9', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil(){} }).then(async (r) => ({ status: r.status, j: await r.json() }));
const get = (store, k) => (store.has(k) ? JSON.parse(store.get(k)) : null);
const put = (store, k, v) => store.set(k, JSON.stringify(v));

function tradingDays(n, endIso){ const out = []; const d = new Date(endIso + 'T00:00:00Z'); while (out.length < n){ if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); } return out; }
const S = '2026-10-15', F = '2026-10-16', F2 = '2026-10-19';
const DAYS = tradingDays(300, S);
const flat = (n) => DAYS.slice(0, n).map((d, i) => { const c = 100 * (1 + 0.01 * Math.sin(i / 9)); return [d, c, c * 1.004, c * 0.996, c, 2e6]; });
const bar = (d, c) => [d, c, c * 1.004, c * 0.996, c * 1.001, 2e6];
const addBar = (store, sym, d) => { const v = get(store, `px:${sym}`); const c = v.rows[v.rows.length - 1][4]; v.rows.push(bar(d, c)); v.fetchedAt = new Date().toISOString(); put(store, `px:${sym}`, v); };
function seed(store){
  const now = new Date().toISOString();
  for (const sym of new Set(AGENT_INSTRUMENTS.map(priceSymbolOf))) put(store, `px:${sym}`, { symbol: sym, currency: 'USD', source: 'seed', rows: flat(DAYS.length), fetchedAt: now });
  // מניות S&P מהיקום הלילי: ZZZ ו-YYY — מטמון "צעיר" שמגיע רק עד יום ההחלטה (בדיוק המצב של IT/MTD/MRNA/CSGP: אין בר של יום המילוי)
  for (const sym of ['ZZZ', 'YYY', 'WWW']) put(store, `px:${sym}`, { symbol: sym, currency: 'USD', source: 'seed', rows: flat(DAYS.length), fetchedAt: now });
  put(store, 'agent:stocks:universe', { day: S, items: [{ symbol: 'ZZZ', name: 'Zzz Inc', sector: 'Information Technology' }, { symbol: 'YYY', name: 'Yyy Inc', sector: 'Health Care' }, { symbol: 'WWW', name: 'Www Inc', sector: 'Health Care' }] });
  put(store, 'fx:USDILS', { rate: 3.1, fetchedAt: now });
}
const order = (symbol, side, qty, strategy = 'trend', day = S) => ({ symbol, class: 'stock', sector: 'tech', side, qty, price: 100, stop: side === 'buy' ? 92 : 108, strategy, score: 90, reason: 'בדיקה', clientOrderId: `agent:${day}:${strategy}:${symbol}:${side}:v1` });
// מצב שמור של הסוכן אחרי סגירת S, עם פקודה ממתינה למניה. הגשר כבר שלח אותה (agent:broker:sent) — כמו בפתיחה של 16/10
async function prepare(store, call, orders, sentIds){
  seed(store);
  const r = await call(`/agent/run?secret=cron-s&date=${S}&batch=12`, { method: 'POST' }); assert.equal(r.j.phase, 'done', JSON.stringify(r.j));
  put(store, 'agent:pending', { day: S, decidedAt: `${S}T21:00:00.000Z`, orders });
  put(store, 'agent:broker:sent', Object.fromEntries(sentIds.map((id) => [id, { orderId: '15483' + id.length, at: `${F}T13:31:22.000Z`, day: F, symbol: id.split(':')[3], side: id.split(':')[4], qty: 10 }])));
  for (const sym of new Set(AGENT_INSTRUMENTS.map(priceSymbolOf))) addBar(store, sym, F);
}

test('יתומות: מניה ממתינה בלי בר של יום המילוי — ניסיון חוזר (לא דחייה), ומילוי כשהבר מגיע; ביומן המזהה שנשלח לברוקר', async () => {
  const store = new Map(); const call = mkCall(mkEnv(store));
  await prepare(store, call, [order('ZZZ', 'buy', 10)], ['agent:2026-10-15:trend:ZZZ:buy:v1']);
  const r1 = await call(`/agent/run?secret=cron-s&date=${F}&batch=12`, { method: 'POST' });
  // לפני התיקון: phase=done, rejectedFills=1 ("אין מחיר פתיחה") — והדמה נשאר עם 10 ZZZ שאף אחד לא מנהל
  assert.equal(r1.j.phase, 'pricing', 'בלי בר של 16/10 ל-ZZZ אין מילוי סופי עדיין: ' + JSON.stringify(r1.j).slice(0, 300));
  assert.deepEqual(r1.j.retrying, ['ZZZ']);
  addBar(store, 'ZZZ', F);   // הספק מחזיר את הבר בניסיון הבא
  const r2 = await call(`/agent/run?secret=cron-s&date=${F}&batch=12`, { method: 'POST' });
  assert.equal(r2.j.phase, 'done', JSON.stringify(r2.j).slice(0, 300)); assert.equal(r2.j.rejectedFills, 0); assert.equal(r2.j.fills, 1);
  assert.ok(get(store, 'agent:state').positions.ZZZ, 'הסימולציה מחזיקה את מה שהדמה קנה');
  const f = get(store, 'agent:journal').find((j) => j.kind === 'fill' && j.symbol === 'ZZZ');
  assert.equal(f.clientOrderId, 'agent:2026-10-15:trend:ZZZ:buy:v1', 'המזהה של יום ההחלטה — זה שהגשר שלח (cOID)');
  // reconcile: המילוי בדמה מותאם למילוי בסימולציה (לפני התיקון: sim=0 וכל מילויי הדמה ב-extraBroker)
  const rep = await call('/agent/broker/fills?secret=bridge-s', { method: 'POST', body: { day: F, status: { authenticated: true, account: 'DUT1' }, sent: [], fills: [{ clientOrderId: 'agent:2026-10-15:trend:ZZZ:buy:v1', orderId: '1', symbol: 'ZZZ', filledQty: 10, avgPrice: 100.3, status: 'filled' }], positions: [{ symbol: 'ZZZ', secType: 'STK', qty: 10 }] } });
  assert.equal(rep.j.reconcile.filled, 1, JSON.stringify(rep.j));
  const b = await call('/agent/broker'); assert.deepEqual(b.j.reconcile.extraBroker, []); assert.deepEqual(b.j.orphans, [], 'הדמה והסימולציה מחזיקים אותו דבר');
});

test('יתומות: נכשל אחרי כל הניסיונות → נדחה, ופקודה שהגשר ביצע נסגרת בדמה בפתיחה הבאה (stop חתוך למוחזק); פקודה שלא נשלחה — לא', async () => {
  const store = new Map(); const call = mkCall(mkEnv(store));
  await prepare(store, call, [order('YYY', 'buy', 15), order('ZZZ', 'short', 186.2258, 'xmom'), order('WWW', 'buy', 4)], ['agent:2026-10-15:trend:YYY:buy:v1', 'agent:2026-10-15:xmom:ZZZ:short:v1']);
  let r;
  for (let i = 0; i <= FILL_PRICE_RETRIES + 1; i++){ r = await call(`/agent/run?secret=cron-s&date=${F}&batch=12`, { method: 'POST' }); if (r.j.phase === 'done') break; }
  assert.equal(r.j.phase, 'done', 'הניסיונות חסומים — הריצה לא נתקעת'); assert.equal(r.j.rejectedFills, 3);
  assert.deepEqual(r.j.brokerUnwinds.sort(), ['cover 186.2258 ZZZ', 'sell 15 YYY'], 'רק מה שנשלח לדמה נסגר בו');
  const J = get(store, 'agent:journal');
  assert.ok(J.some((j) => j.kind === 'reject' && j.symbol === 'YYY' && /אין מחיר פתיחה/.test(j.reasons.join())));
  const p = await call('/agent/broker/pending?secret=bridge-s'); assert.equal(p.status, 200);
  const ex = p.j.exits.filter((e) => e.orphan);
  assert.equal(ex.length, 2, JSON.stringify(p.j.exits));
  const y = ex.find((e) => e.symbol === 'YYY'), z = ex.find((e) => e.symbol === 'ZZZ');
  assert.equal(y.kind, 'stop', 'הגשר שכבר רץ מכיר stop ובודק מה מוחזק'); assert.equal(y.side, 'sell'); assert.equal(y.qty, 15); assert.equal(z.side, 'cover');
  assert.match(y.clientOrderId, /^agent:2026-10-16:exit:YYY:sell:/);
  // הגשר: סגירה נחתכת למה שהדמה מחזיק — לא פותחת פוזיציה הפוכה גם אם הדמה כבר לא מחזיק
  assert.deepEqual(clipExitToHeld(z, -186), { ok: true, qty: 186, reason: 'כמות נחתכה ל-186 (מוחזק בדמה)' });
  assert.equal(clipExitToHeld(y, 0).ok, false);
  const p2 = await call('/agent/broker/pending?secret=bridge-s'); assert.deepEqual(p2.j.exits.map((e) => e.clientOrderId), p.j.exits.map((e) => e.clientOrderId), 'מזהה קבוע — שליחה אחת');
});

// תמונת המצב האמיתית: /agent/broker של 19/10 14:47 UTC מול /agent/report (סימולציה בסגירת 16/10 + פקודות 16/10 שהגשר שלח ב-19/10)
const BROKER_1910 = [['IT', 32], ['APA', 149], ['APP', -16], ['SNDK', 4], ['XBI', 41], ['UVXY', 0], ['BNO', 98], ['CSGP', -370], ['MU', 4], ['MTD', 4], ['MGM', -241], ['MCK', 7], ['AKAM', -39], ['ALB', -62], ['LITE', 3], ['USO', 42], ['MRNA', 15]].map(([symbol, qty]) => ({ symbol, secType: 'STK', qty }));
BROKER_1910.push({ symbol: 'USO    NOV2026 147 C [USO   261120C00147000 100]', secType: 'OPT', qty: 1 });
const SIM_1016 = { USO: 42, BNO: 98, ALB: -62, XBI: 41, APP: -16, MU: 4, LITE: 3, SNDK: 2, 'CANE-20261120-C-12.5': 48, 'BNO-20261120-C-64': 4, 'USO-20261120-C-147.5': 1 };
const PEND_1016 = [order('APA', 'buy', 149.3194, 'trend', '2026-10-16'), order('MGM', 'short', 241.3726, 'trend', '2026-10-16'), order('MCK', 'buy', 7, 'trend', '2026-10-16'), order('CSGP', 'short', 184.3467, 'xmom', '2026-10-16')];
const SENT_IDS = ['agent:2026-10-14:trend:AKAM:short:v1', 'agent:2026-10-14:xmom:SNDK:buy:v1', 'agent:2026-10-15:trend:IT:buy:v1', 'agent:2026-10-15:trend:MTD:buy:v1', 'agent:2026-10-15:trend:MRNA:buy:v1', 'agent:2026-10-15:xmom:CSGP:short:v1', 'agent:2026-10-15:xmom:MU:buy:v1', 'agent:sync:2026-09-30:XBI:buy', ...PEND_1016.map((o) => o.clientOrderId)];
function seedSnapshot(store){
  put(store, 'agent:state', { lastDay: '2026-10-16', initialUsd: 66291.02, cashUsd: 39586, positions: Object.fromEntries(Object.entries(SIM_1016).map(([s, q]) => [s, { qty: q, avg: 100, lastMark: 100, strategy: 'xmom', class: 'stock' }])) });
  put(store, 'agent:pending', { day: '2026-10-16', decidedAt: 'x', orders: PEND_1016 });
  put(store, 'agent:journal', [{ id: 'ag_x1', kind: 'stop', day: '2026-10-16', symbol: 'UVXY', side: 'cover', qty: 260.4338, price: 18.7 }]);
  put(store, 'agent:broker:sent', Object.fromEntries([...SENT_IDS, 'agent:2026-10-16:exit:UVXY:cover:ag_x1'].map((id) => [id, { orderId: '1', at: '2026-10-19T13:31:22.000Z', day: '2026-10-19', symbol: id.split(':')[3], side: 'x' }])));
  put(store, 'agent:broker:latest', { day: '2026-10-19', updatedAt: '2026-10-19T14:47:08.053Z', authenticated: true, account: 'DUT167879' });
  put(store, 'agent:broker:2026-10-19', { day: '2026-10-19', positions: BROKER_1910, fills: [], errors: [], reconcile: null });
}

test('יתומות: זיהוי על תמונת המצב של 19/10 — IT 32, MTD 4, MRNA 15, CSGP 186 (מתוך 370), AKAM 39 שורט, וגם SNDK 2', async () => {
  const store = new Map(); const call = mkCall(mkEnv(store)); seedSnapshot(store);
  const b = await call('/agent/broker'); assert.equal(b.status, 200);
  const got = Object.fromEntries(b.j.orphans.map((o) => [o.symbol, `${o.side} ${o.qty}`]));
  assert.deepEqual(got, { IT: 'sell 32', MTD: 'sell 4', MRNA: 'sell 15', CSGP: 'cover 186', AKAM: 'cover 39', SNDK: 'sell 2' }, JSON.stringify(b.j.orphans));
  // פקודות 16/10 שנשלחו היום (APA 149.3194→149, MGM, MCK, CSGP 184) נחשבות "צפויות" עד שהסימולציה תמלא אותן הלילה; אופציות לא נבדקות
  assert.ok(!b.j.orphans.some((o) => ['APA', 'MGM', 'MCK', 'UVXY', 'USO', 'XBI'].includes(o.symbol)));
});

test('יתומות: סגירה חד-פעמית (POST /agent/broker/orphans, סוד ה-cron) → יציאות לגשר פעם אחת; inFlight לא נכלל; off מבטל', async () => {
  const store = new Map(); const call = mkCall(mkEnv(store)); seedSnapshot(store);
  assert.equal((await call('/agent/broker/orphans?secret=bridge-s', { method: 'POST' })).status, 401, 'הגשר לא יוצר פקודות בעצמו');
  // פקודה ממתינה ל-IT שעוד לא נשלחה (הסוכן החליט לקנות שוב) — IT בטיפול הזרימה הרגילה, לא נסגר עכשיו
  const pend = get(store, 'agent:pending'); pend.orders.push(order('IT', 'buy', 30, 'trend', '2026-10-16')); put(store, 'agent:pending', pend);
  const r = await call('/agent/broker/orphans?secret=cron-s&date=2026-10-19', { method: 'POST' }); assert.equal(r.status, 200, JSON.stringify(r.j));
  assert.deepEqual(r.j.orders.sort(), ['cover 186 CSGP', 'cover 39 AKAM', 'sell 15 MRNA', 'sell 2 SNDK', 'sell 4 MTD'].sort()); assert.deepEqual(r.j.skippedInFlight, ['IT']);
  const p = await call('/agent/broker/pending?secret=bridge-s');
  const orphanExits = p.j.exits.filter((e) => e.orphan);
  assert.equal(orphanExits.length, 5); assert.ok(orphanExits.every((e) => e.kind === 'stop' && e.sent === null && /^agent:orphan:2026-10-19:/.test(e.clientOrderId)));
  // הגשר שלח ודיווח → מסומן sent ולא נשלח שוב; מופיע בהשוואה
  const csgp = orphanExits.find((e) => e.symbol === 'CSGP');
  await call('/agent/broker/fills?secret=bridge-s', { method: 'POST', body: { day: '2026-10-20', status: { authenticated: true, account: 'DUT1' }, sent: [{ clientOrderId: csgp.clientOrderId, orderId: '9', symbol: 'CSGP', side: 'cover', qty: 186 }], fills: [{ clientOrderId: csgp.clientOrderId, orderId: '9', filledQty: 186, avgPrice: 31.5, status: 'filled' }], positions: [] } });
  const p2 = await call('/agent/broker/pending?secret=bridge-s'); assert.ok(p2.j.exits.find((e) => e.clientOrderId === csgp.clientOrderId).sent);
  assert.equal((await call('/agent/broker')).j.reconcile.summary.filled, 1);
  const off = await call('/agent/broker/orphans?secret=cron-s&off=1', { method: 'POST' }); assert.equal(off.j.off, true);
  assert.equal((await call('/agent/broker/pending?secret=bridge-s')).j.exits.filter((e) => e.orphan).length, 0);
});
