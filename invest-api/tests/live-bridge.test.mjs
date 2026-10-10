// הגשר לחשבון האמיתי: מגבלות נעולות, הפעלה רק עם שלוש הוכחות, שער חי, התאמת גודל, וסבב מלא מול Gateway מדומה. בלי רשת.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LIVE_LIMITS, liveHash, checkArming, assertLiveAccount, scaleQty, liveLimitPrice, gateLiveOrder, stopOuts, liveOrderBody } from '../engine/live-limits.js';
import { liveTick, inLiveWindow } from '../scripts/ibkr-live-bridge.mjs';
import { recordLive, liveReport } from '../lib/agent-live.js';
import { isPaperAccount } from '../scripts/paper-guard.mjs';
import worker from '../worker.js';

const L = LIVE_LIMITS;
const NOW = new Date('2026-10-12T15:00:00Z');   // שני 11:00 ניו יורק
const okEnv = (o = {}) => ({ LIVE_ACCOUNT: 'U1234567', LIVE_APPROVAL: liveHash(), LIVE_ARMED_UNTIL: '2026-11-01T00:00:00Z', ...o });

test('המגבלות נעולות: ערכים, הקפאה, ETF/long/מזומן בלבד', () => {
  assert.deepStrictEqual({ ...L, allowedClasses: [...L.allowedClasses] }, { version: 1, mode: 'live', allowedClasses: ['etf'], longOnly: true, cashOnly: true, approvedCapitalUsd: 250, minEquityUsd: 50, maxOrderUsd: 60, maxPositionShare: 0.6, maxOpenPositions: 3, maxOrdersPerDay: 4, maxDailyLossPct: 0.08, maxDrawdownPct: 0.25, positionStopPct: 0.15, maxSlippagePct: 0.004, maxSpreadPct: 0.02, maxArmDays: 45 });
  assert.ok(Object.isFrozen(L) && Object.isFrozen(L.allowedClasses));
  assert.match(liveHash(), /^[0-9a-f]{8}-\d+$/);
  assert.notEqual(liveHash(), liveHash({ ...L, maxOrderUsd: 61 }), 'שינוי מגבלה משנה את ה-hash');
});

test('הפעלה: צריך חשבון אמיתי + hash תואם + תאריך תקף וקרוב; כל חסר = כבוי', () => {
  assert.equal(checkArming({ env: okEnv(), now: NOW }).armed, true);
  assert.equal(checkArming({ env: {}, now: NOW }).armed, false);
  assert.equal(checkArming({ env: okEnv({ LIVE_ACCOUNT: 'DUT167879' }), now: NOW }).armed, false, 'חשבון דמה לא נחשב');
  assert.equal(checkArming({ env: okEnv({ LIVE_APPROVAL: 'deadbeef-1' }), now: NOW }).armed, false);
  assert.equal(checkArming({ env: okEnv({ LIVE_ARMED_UNTIL: '2026-10-01T00:00:00Z' }), now: NOW }).armed, false, 'פג');
  assert.equal(checkArming({ env: okEnv({ LIVE_ARMED_UNTIL: '2030-01-01T00:00:00Z' }), now: NOW }).armed, false, 'רחוק מדי');
  assert.equal(checkArming({ env: okEnv(), now: NOW, limits: { ...L, maxOrderUsd: 999 } }).armed, false, 'מגבלות שונו אחרי האישור');
  assert.throws(() => assertLiveAccount('DUT167879', 'DUT167879'), /LIVE_ACCOUNT/);
  assert.throws(() => assertLiveAccount('U7654321', 'U1234567'), /לא תואם/);
  assert.equal(assertLiveAccount('U1234567', 'u1234567'), 'U1234567');
  assert.equal(isPaperAccount('U1234567'), false, 'גשר הדמה ממשיך לסרב לחשבון אמיתי');
});

test('התאמת גודל: משקל הסימולציה × הון חי מאושר, כמות שלמה, 0 כשקטן מדי', () => {
  // סימולציה 66,000$, פקודה 7,920$ (12%) → ב-163$ = 19.6$; TQQQ ב-82$ → 0; ETF ב-20$ → 1
  assert.equal(scaleQty({ simQty: 96, simPrice: 82.5, simEquityUsd: 66000, liveBaseUsd: 163, livePrice: 82.5 }), 0);
  assert.equal(scaleQty({ simQty: 396, simPrice: 20, simEquityUsd: 66000, liveBaseUsd: 163, livePrice: 20 }), 1);
  assert.equal(scaleQty({ simQty: 1, simPrice: 0, simEquityUsd: 1, liveBaseUsd: 1, livePrice: 1 }), 0);
});

test('LMT: ask+0.4% לקנייה, bid−0.4% למכירה; מושהה/רחב/ריק לא נשלח', () => {
  assert.deepEqual(liveLimitPrice({ side: 'buy', bid: 49.9, ask: 50, availability: 'RpB' }), { ok: true, price: 50.2 });
  assert.deepEqual(liveLimitPrice({ side: 'sell', bid: 49.9, ask: 50, availability: 'RpB' }), { ok: true, price: 49.7 });
  assert.match(liveLimitPrice({ side: 'buy', bid: 49.9, ask: 50, availability: 'DPB' }).reason, /לא בזמן אמת/);
  assert.match(liveLimitPrice({ side: 'buy', bid: 49.9, ask: 50 }).reason, /לא בזמן אמת/);
  assert.match(liveLimitPrice({ side: 'buy', bid: 40, ask: 50, availability: 'R' }).reason, /spread/);
  assert.equal(liveLimitPrice({ side: 'buy', bid: null, ask: null, availability: 'R' }).retry, true);
});

const acct0 = { equityUsd: 160, cashUsd: 160, dayStartEquityUsd: 160, hwmUsd: 160 };
const gate = (o, a = {}, positions = [], state = {}) => gateLiveOrder({ order: { symbol: 'QQQ', side: 'buy', qty: 1, price: 50, ...o }, account: { ...acct0, ...a }, positions, state });

test('שער חי: קנייה תקינה עוברת; כל חריגה נחסמת עם סיבה', () => {
  assert.equal(gate({}).allowed, true, JSON.stringify(gate({}).reasons));
  assert.equal(gate({ qty: 2, price: 50 }).allowed, false, 'פקודה 100$ > 60$');
  assert.equal(gate({ qty: 1, price: 50 }, { cashUsd: 30 }).allowed, false, 'בלי margin');
  assert.equal(gate({ symbol: 'NVDA' }).allowed, false, 'מניה בודדת/לא ETF');
  assert.equal(gate({ symbol: 'MES' }).allowed, false, 'חוזה עתידי');
  assert.equal(gate({ symbol: 'USO-20261120-C-147' }).allowed, false, 'אופציה');
  assert.equal(gate({ side: 'short' }).allowed, false, 'שורט');
  assert.equal(gate({ side: 'cover' }).allowed, false);
  assert.equal(gate({ qty: 1.5 }).allowed, false, 'כמות לא שלמה');
  assert.equal(gate({}, { equityUsd: 40, cashUsd: 40 }).allowed, false, 'מתחת למינימום הון');
  assert.equal(gate({}, { equityUsd: 145 }).allowed, false, 'הפסד יומי 9.4%');
  assert.equal(gate({}, { hwmUsd: 230 }).allowed, false, 'ירידה מהשיא 30%');
  assert.equal(gate({}, {}, [], { opensToday: 4 }).allowed, false, 'מכסת פתיחות');
  assert.equal(gate({}, {}, [{ symbol: 'QQQ', qty: 1, valueUsd: 90 }]).allowed, false, 'פוזיציה > 60% מההון');
  const three = ['SPY', 'GLD', 'TLT'].map((s) => ({ symbol: s, qty: 1, valueUsd: 20 }));
  assert.equal(gate({}, {}, three).allowed, false, 'כבר 3 פוזיציות');
  assert.equal(gateLiveOrder({ order: { symbol: 'QQQ', side: 'buy', qty: 1, price: 50 }, account: acct0, killed: true }).allowed, false);
  // הון מעל המאושר לא מגדיל פוזיציות: 10,000$ בחשבון, בסיס 250$ → פוזיציה 160$ = 64% > 60%
  assert.equal(gate({ qty: 1, price: 50 }, { equityUsd: 10000, cashUsd: 10000, dayStartEquityUsd: 10000, hwmUsd: 10000 }, [{ symbol: 'QQQ', qty: 2, valueUsd: 110 }]).allowed, false);
});

test('שער חי: מכירה רק מול מה שמוחזק, ולא נחסמת בעצירות; עצירת הפסד מקומית', () => {
  const held = [{ symbol: 'QQQ', qty: 2, valueUsd: 100 }];
  assert.equal(gate({ side: 'sell', qty: 2 }, { equityUsd: 100, hwmUsd: 300, dayStartEquityUsd: 300 }, held).allowed, true, 'סגירה מותרת גם בעצירת הפסד');
  assert.equal(gate({ side: 'sell', qty: 3 }, {}, held).allowed, false, 'יותר ממה שמוחזק');
  assert.equal(gate({ side: 'sell', qty: 1 }, {}, []).allowed, false, 'אין שורט');
  assert.deepEqual(stopOuts([{ symbol: 'QQQ', qty: 2, avgPrice: 100, marketPrice: 84 }, { symbol: 'SPY', qty: 1, avgPrice: 100, marketPrice: 90 }]).map((s) => s.symbol), ['QQQ']);
  assert.deepEqual(liveOrderBody({ acctId: 'U1', conid: 11, side: 'buy', qty: 2, price: 50.123, cOID: 'x' }), { acctId: 'U1', conid: 11, secType: '11:STK', orderType: 'LMT', price: 50.12, side: 'BUY', quantity: 2, tif: 'DAY', cOID: 'x', outsideRTH: false });
});

test('חלון השליחה: ימי חול 09:35–15:45 ניו יורק', () => {
  assert.equal(inLiveWindow(new Date('2026-10-12T15:00:00Z')), true);
  assert.equal(inLiveWindow(new Date('2026-10-12T13:31:00Z')), false, '09:31 — מוקדם');
  assert.equal(inLiveWindow(new Date('2026-10-10T15:00:00Z')), false, 'שבת');
});

// Gateway מדומה
function fakeIb({ auth = true, acct = 'U1234567', equity = 160, cash = 160, positions = [], bid = 19.9, ask = 20, availability = 'RpB' } = {}){
  const placed = [];
  return { placed,
    tickle: async () => ({}), authStatus: async () => ({ authenticated: auth }), accounts: async () => [acct],
    summary: async () => ({ netLiquidationUsd: equity, cashUsd: cash }), positions: async () => positions,
    resolveConid: async (s) => ({ conid: 100 + s.length }), quote: async () => ({ bid, ask, last: ask, availability }),
    placeOrder: async (a, body) => { placed.push(body); return { orderId: String(9000 + placed.length), status: 'Submitted' }; },
    orders: async () => [], cancelAll: async () => [], };
}
const pend = (o = {}) => ({ killSwitch: false, simEquityUsd: 66000, day: '2026-10-09', orders: [{ clientOrderId: 'agent:2026-10-09:xmom:XLE:buy:v1', symbol: 'XLE', side: 'buy', qty: 396, price: 20, strategy: 'xmom' }], exits: [], ...o });
const harness = (ib, p, env = okEnv(), extra = {}) => { const reports = []; const worker = async (path, opts = {}) => (path === '/agent/live/report' ? (reports.push(opts.body), { ok: true }) : p); return { reports, run: (state = {}) => liveTick({ ib, state, worker, env, now: NOW, ...extra }).then((rep) => ({ rep, state })) }; };

test('סבב: כבוי (בלי הפעלה) → קורא ומדווח בלבד, אפס פקודות; בלי LIVE_ACCOUNT לא נוגע בחשבון בכלל', async () => {
  const ib = fakeIb(); const h = harness(ib, pend(), okEnv({ LIVE_APPROVAL: undefined }));
  const { rep } = await h.run();
  assert.equal(ib.placed.length, 0); assert.equal(rep.armed, false); assert.equal(rep.mode, 'disarmed'); assert.equal(rep.summary.equityUsd, 160); assert.equal(h.reports.length, 1);
  const ib2 = fakeIb(); let touched = false; ib2.summary = async () => { touched = true; return {}; };
  const none = await harness(ib2, pend(), {}).run();
  assert.equal(touched, false); assert.equal(none.rep.mode, 'unconfigured'); assert.equal(ib2.placed.length, 0);
});

test('סבב: מופעל → קנייה מותאמת לגודל (1 יחידה), LMT, idempotent בסבב חוזר', async () => {
  const ib = fakeIb(); const h = harness(ib, pend());
  const { rep, state } = await h.run();
  assert.equal(ib.placed.length, 1); assert.deepEqual({ side: ib.placed[0].side, q: ib.placed[0].quantity, t: ib.placed[0].orderType, p: ib.placed[0].price }, { side: 'BUY', q: 1, t: 'LMT', p: 20.08 });
  assert.equal(rep.mode, 'armed'); assert.equal(rep.sent.length, 1); assert.equal(state.opensToday, 1);
  await h.run(state); assert.equal(ib.placed.length, 1, 'אותה פקודה לא נשלחת פעמיים');
});

test('סבב: חשבון שאינו המאושר/דמה → זורק לפני כל פקודה', async () => {
  const ib = fakeIb({ acct: 'DUT167879' });
  await assert.rejects(() => harness(ib, pend()).run(), /LIVE_ACCOUNT|לא תואם/);
  assert.equal(ib.placed.length, 0);
});

test('סבב: kill switch, מחוץ לחלון, ציטוט מושהה, שורט/לא-ETF — אין פקודות', async () => {
  let ib = fakeIb(); await harness(ib, pend({ killSwitch: true })).run(); assert.equal(ib.placed.length, 0);
  ib = fakeIb(); await harness(ib, pend(), okEnv(), { killFile: () => true }).run(); assert.equal(ib.placed.length, 0);
  ib = fakeIb(); const r = await liveTick({ ib, state: {}, worker: async (p) => (p === '/agent/live/report' ? {} : pend()), env: okEnv(), now: new Date('2026-10-12T21:00:00Z') }); assert.equal(ib.placed.length, 0); assert.equal(r.mode, 'armed-outside-window');
  ib = fakeIb({ availability: 'DPB' }); const d = await harness(ib, pend()).run(); assert.equal(ib.placed.length, 0); assert.ok(d.rep.errors.some((e) => /לא בזמן אמת/.test(e)));
  ib = fakeIb(); const s = await harness(ib, pend({ orders: [{ clientOrderId: 'a', symbol: 'MES', side: 'short', qty: 1, price: 5000 }, { clientOrderId: 'b', symbol: 'NVDA', side: 'buy', qty: 1, price: 100 }, { clientOrderId: 'c', symbol: 'SPY', side: 'cover', qty: 1, price: 500 }] })).run();
  assert.equal(ib.placed.length, 0); assert.equal(s.rep.skipped.length, 3);
});

test('דיווח: כבוי לא מציף את ה-KV (אחת ל-10 דק\'), אבל שינוי/פקודה מדווחים מיד', async () => {
  const ib = fakeIb(); const h = harness(ib, pend(), okEnv({ LIVE_APPROVAL: undefined })); const state = {};
  await h.run(state); await h.run(state); await h.run(state);
  assert.equal(h.reports.length, 1, 'שלושה סבבים זהים → דיווח אחד');
  const later = await liveTick({ ib, state, worker: async (p, o) => (p === '/agent/live/report' ? (h.reports.push(o.body), {}) : pend()), env: okEnv({ LIVE_APPROVAL: undefined }), now: new Date(NOW.getTime() + 11 * 60000) });
  assert.equal(h.reports.length, 2, 'אחרי 10 דקות — דיווח');
  const armed = harness(fakeIb(), pend()); await armed.run({}); assert.equal(armed.reports.length, 1); assert.equal(armed.reports[0].sent.length, 1, 'פקודה מדווחת מיד');
  assert.equal(later.mode, 'disarmed');
});

test('kill: מבטל רק פקודות שהגשר שלח, גם כשלא מופעל; פקודה ידנית של הבעלים לא נוגעים בה', async () => {
  const ib = fakeIb(); const cancelled = [];
  ib.orders = async () => [{ orderId: 1, order_ref: 'live:mine', status: 'Submitted' }, { orderId: 2, order_ref: null, status: 'Submitted' }, { orderId: 3, order_ref: 'live:old', status: 'Filled' }];
  ib.cancel = async (a, id) => { cancelled.push(String(id)); };
  const state = { sent: { 'live:mine': {}, 'live:old': {} } };
  await harness(ib, pend({ killSwitch: true }), okEnv({ LIVE_APPROVAL: undefined })).run(state);
  assert.deepEqual(cancelled, ['1']);
});

test('סבב: עצירת הפסד מקומית ויציאת סימולציה מוכרות את כל מה שמוחזק', async () => {
  const pos = [{ conid: 103, symbol: 'XLE', qty: 3, avgPrice: 25, marketPrice: 20, marketValueUsd: 60, unrealizedUsd: -15 }];   // −20% → עצירת גשר
  const ib = fakeIb({ positions: pos }); const { rep } = await harness(ib, pend({ orders: [] })).run();
  assert.equal(ib.placed.length, 1); assert.deepEqual({ s: ib.placed[0].side, q: ib.placed[0].quantity, p: ib.placed[0].price }, { s: 'SELL', q: 3, p: 19.82 }); assert.equal(rep.sent.length, 1); assert.equal(rep.positions.length, 0, 'אחרי המכירה הפוזיציה לא מדווחת כפתוחה');
  const ib2 = fakeIb({ positions: [{ conid: 103, symbol: 'XLE', qty: 2, avgPrice: 20, marketPrice: 20, marketValueUsd: 40, unrealizedUsd: 0 }] });
  await harness(ib2, pend({ orders: [], exits: [{ clientOrderId: 'agent:x:exit', symbol: 'XLE', side: 'sell', qty: 400, kind: 'stop' }] })).run();
  assert.equal(ib2.placed.length, 1); assert.equal(ib2.placed[0].quantity, 2);
});

test('Worker: /agent/live/report פרטי (401 בלי סוד), POST/GET עם סוד, שדות מנוקים', async () => {
  const store = new Map();
  const env = { INVEST: { get: async (k, type) => (store.has(k) ? (type === 'text' ? store.get(k) : JSON.parse(store.get(k))) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async () => ({ keys: [], list_complete: true }) }, APP_TOKEN: 'secret', CRON_SECRET: 'cron-s', BRIDGE_SECRET: 'bridge-s', RATE_LIMIT_OFF: '1' };
  const call = (path, { method = 'GET', body } = {}) => worker.fetch(new Request('https://api.test' + path, { method, headers: { 'CF-Connecting-IP': '9.9.9.9', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil(){} }).then(async (r) => ({ status: r.status, j: await r.json() }));
  assert.equal((await call('/agent/live/report')).status, 401, 'אין GET ציבורי');
  assert.equal((await call('/agent/live/report', { method: 'POST', body: {} })).status, 401);
  const p = await call('/agent/live/report?secret=bridge-s', { method: 'POST', body: { day: '2026-10-12', authenticated: true, armed: false, mode: 'disarmed', account: 'U…567', summary: { equityUsd: 160, cashUsd: 160, secret: 'x' }, positions: [], errors: ['a'.repeat(500)], evil: '<script>' } });
  assert.equal(p.status, 200); assert.equal(p.j.armed, false);
  const g = await call('/agent/live/report?secret=cron-s'); assert.equal(g.status, 200); assert.equal(g.j.record.summary.equityUsd, 160); assert.equal(g.j.record.summary.secret, undefined); assert.equal(g.j.record.errors[0].length, 200); assert.equal(g.j.record.evil, undefined);
  assert.equal((await call('/agent/live/report', { method: 'POST', body: {} })).status, 401);
});

test('קוד: גשר הדמה לא הוקל, ולגשר החי אין עקיפה בקוד; ברירת המחדל כבויה', () => {
  const paper = readFileSync(new URL('../scripts/ibkr-bridge.mjs', import.meta.url), 'utf8');
  const live = readFileSync(new URL('../scripts/ibkr-live-bridge.mjs', import.meta.url), 'utf8');
  const lim = readFileSync(new URL('../engine/live-limits.js', import.meta.url), 'utf8');
  assert.ok(/assertPaperAccount\(acct\)/.test(paper) && !/live-limits/.test(paper), 'גשר הדמה נשאר דמה בלבד');
  assert.ok(!/process\.env/.test(lim), 'המגבלות לא קוראות סביבה');
  assert.ok(!/ALLOW_|FORCE_|BYPASS|SKIP_(GUARD|LIMITS)/i.test(live), 'אין דגל עקיפה');
  assert.ok(live.indexOf('assertLiveAccount(acct') < live.indexOf("worker('/agent/broker/pending')"), 'בדיקת החשבון לפני משיכת פקודות');
  assert.ok(live.indexOf('gateLiveOrder(') < live.indexOf('ib.placeOrder('), 'כל פקודה עוברת בשער לפני שליחה');
});

test('recordLive/liveReport: ללא דיווח → missing', async () => {
  const m = new Map(); const db = { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } };
  assert.equal((await liveReport(db)).missing, true);
  await recordLive(db, { day: '2026-10-12', authenticated: true, mode: 'armed', armed: true, sent: [{ id: 'live:a', symbol: 'XLE', side: 'buy', qty: 1 }] });
  await recordLive(db, { day: '2026-10-12', authenticated: true, mode: 'armed', armed: true, sent: [{ id: 'live:b', symbol: 'GLD', side: 'buy', qty: 1 }] });
  assert.equal((await liveReport(db)).record.sent.length, 2, 'ממזגים דיווחים של אותו יום');
});
