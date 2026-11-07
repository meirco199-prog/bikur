// בוט עמית בחשבון הדמו של Bybit: החלטות (engine/amit-exec.js), חתימה, ודיווח ל-Worker (lib/amit-live.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { BOT, decide, levels, qtyFor, sign, closedKlines, dailyHalt, summarize, ilDay, pxDown, pxUp } from '../engine/amit-exec.js';
import { bands } from '../engine/amit-rules.js';
import { recordAmitBot, cleanBotReport, botLines, formatSummary, AMITBOT_KEY } from '../lib/amit-live.js';
import { DB } from '../lib/db.js';

const NOW = Date.parse('2026-11-07T08:00:30Z');
const flat = (n = 20, x = 76000) => Array.from({ length: n }, (_, i) => x + (i % 2 ? 20 : -20)); // סגירה אחרונה בתוך הרצועות

test('רק חשבון הדמו: הכתובת קבועה ל-api-demo, ואין כתובת של החשבון האמיתי לשליחת פקודות', () => {
  assert.equal(BOT.base, 'https://api-demo.bybit.com');
  assert.equal(BOT.dailyLossUsd, 1000); assert.equal(BOT.notional, 190000); assert.equal(BOT.slPct, 0.22);
});

test('חתימה: HMAC-SHA256 של timestamp+key+recvWindow+payload', () => {
  const exp = createHmac('sha256', 's').update('1700000000000k10000a=1').digest('hex');
  assert.equal(sign('s', 1700000000000, 'k', '10000', 'a=1'), exp);
});

test('כמות ומחירים: 190K$ מעוגל מטה ל-0.001 BTC; כניסה קנייה מעוגלת מטה, מכירה מעלה', () => {
  assert.equal(qtyFor(76000), '2.500');
  assert.equal(qtyFor(75999.9), '2.500');
  assert.equal(pxDown(75123.47), '75123.4'); assert.equal(pxUp(75123.41), '75123.5');
});

test('levels: רצועות מ-20 הסגירות האחרונות, סטופ 0.22% מהכניסה', () => {
  const c = flat(), L = levels(c), b = bands(c);
  assert.equal(L.zone, 'in');
  assert.ok(L.buy.price <= b.lo && b.lo - L.buy.price < 0.1);
  assert.ok(L.sell.price >= b.up && L.sell.price - b.up < 0.1);
  assert.ok(Math.abs(L.buy.sl - L.buy.price * (1 - 0.0022)) < 0.06);
  assert.ok(Math.abs(L.sell.sl - L.sell.price * (1 + 0.0022)) < 0.06);
  assert.equal(levels(c.slice(-19)), null);
});

test('decide שטוח + נר חדש בתוך הרצועות → שתי פקודות כניסה עם סטופ מצורף', () => {
  const a = decide({ pos: null, orders: [], closes: flat(), newBar: true, halt: null, nowMs: NOW, barT: 123 });
  assert.equal(a.length, 2);
  const [buy, sell] = a.map((x) => x.order);
  assert.equal(buy.side, 'Buy'); assert.equal(sell.side, 'Sell');
  for (const o of [buy, sell]){ assert.equal(o.orderType, 'Limit'); assert.ok(o.stopLoss); assert.equal(o.tpslMode, 'Full'); assert.equal(o.qty, qtyFor(Number(o.price))); assert.ok(Number(o.qty) * Number(o.price) <= 190000); assert.ok(o.orderLinkId.startsWith('amit-e-')); assert.ok(!o.reduceOnly); }
  assert.ok(Number(buy.stopLoss) < Number(buy.price) && Number(sell.stopLoss) > Number(sell.price));
});

test('decide שטוח: סגירה מחוץ לרצועות → אין כניסה (רק נגיעה טרייה); בלי נר חדש → לא נוגעים בפקודות הכניסה', () => {
  const out = [...flat(19), 76500];
  assert.equal(levels(out).zone, 'above');
  const old = [{ orderId: 'x', orderLinkId: 'amit-e-buy-1' }];
  assert.deepEqual(decide({ pos: null, orders: old, closes: out, newBar: true, nowMs: NOW, barT: 2 }), [{ type: 'cancel', orderId: 'x' }]);
  assert.deepEqual(decide({ pos: null, orders: old, closes: flat(), newBar: false, nowMs: NOW, barT: 2 }), []);
});

test('decide בעסקה: מבטל מיד את פקודת הכניסה הנגדית; בנר חדש — יעד reduce-only על הרצועה הנגדית', () => {
  const pos = { side: 'long', size: '2.500', entry: 75900, sinceMs: NOW - 5 * 60e3 };
  const orders = [{ orderId: 'e', orderLinkId: 'amit-e-sell-1' }, { orderId: 't', orderLinkId: 'amit-tp-1' }, { orderId: 'z', orderLinkId: 'manual' }];
  const mid = decide({ pos, orders, closes: flat(), newBar: false, nowMs: NOW, barT: 1 });
  assert.deepEqual(mid, [{ type: 'cancel', orderId: 'e' }], 'באמצע נר: רק ביטול הכניסה הנגדית; לא נוגעים בפקודות שאינן של הבוט');
  const a = decide({ pos, orders, closes: flat(), newBar: true, nowMs: NOW, barT: 2 });
  const tp = a.find((x) => x.type === 'place').order;
  assert.equal(tp.side, 'Sell'); assert.equal(tp.reduceOnly, true); assert.equal(tp.qty, '2.500'); assert.equal(tp.price, levels(flat()).sell.price.toFixed(1));
  assert.ok(a.some((x) => x.type === 'cancel' && x.orderId === 't'), 'יעד ישן מוחלף');
  const s = decide({ pos: { ...pos, side: 'short' }, orders: [], closes: flat(), newBar: true, nowMs: NOW, barT: 2 }).find((x) => x.type === 'place').order;
  assert.equal(s.side, 'Buy'); assert.equal(s.price, levels(flat()).buy.price.toFixed(1));
});

test('decide: 60 דקות בעסקה → סגירה בשוק', () => {
  const pos = { side: 'short', size: '2.500', entry: 76100, sinceMs: NOW - 60 * 60e3 };
  const a = decide({ pos, orders: [{ orderId: 't', orderLinkId: 'amit-tp-9' }], closes: flat(), newBar: false, nowMs: NOW, barT: 1 });
  assert.deepEqual(a.map((x) => x.type), ['cancel', 'close']);
});

test('decide: עצירה (מגבלה יומית / STOP) → ביטול הכול + סגירה, בלי פקודות חדשות', () => {
  const pos = { side: 'long', size: '1', entry: 1, sinceMs: NOW };
  for (const halt of ['daily', 'stop']){
    const a = decide({ pos, orders: [{ orderId: 'e', orderLinkId: 'amit-e-buy-1' }], closes: flat(), newBar: true, halt, nowMs: NOW, barT: 1 });
    assert.deepEqual(a.map((x) => x.type), ['cancelAll', 'close']);
  }
  assert.deepEqual(decide({ pos: null, orders: [], closes: flat(), newBar: true, halt: 'daily', nowMs: NOW, barT: 1 }), []);
});

test('dailyHalt: ממומש + פתוח ≤ −1,000$', () => {
  assert.equal(dailyHalt(-600, -399), false);
  assert.equal(dailyHalt(-600, -400), true);
  assert.equal(dailyHalt(-1200, 300), false);
  assert.equal(dailyHalt(undefined, -1000), true);
});

test('closedKlines: רק נרות סגורים, מהישן לחדש', () => {
  const t0 = Date.parse('2026-11-07T07:58:00Z');
  const j = { result: { list: [[String(t0 + 120e3), '1', '1', '1', '3'], [String(t0 + 60e3), '1', '1', '1', '2'], [String(t0), '1', '1', '1', '1']] } };
  assert.deepEqual(closedKlines(j, NOW).map((b) => b.c), [1, 2]);
  assert.throws(() => closedKlines({}, NOW));
});

test('summarize + recordAmitBot: דוח יומי, תקרת כתיבה של 20 דקות (חוץ משינוי עצירה), ושורות לסיכום הטלגרם', async () => {
  const day = ilDay(NOW);
  const trades = [{ t: NOW - 86400e3 * 2, pnl: 120 }, { t: NOW - 600e3, pnl: -80 }, { t: NOW - 300e3, pnl: 50 }];
  const rep = summarize(trades, { day, equity: 178000.123, pos: { side: 'long', size: '2.5', entry: 76000 }, halt: null });
  assert.deepEqual(rep.today, { n: 2, wins: 1, netUsd: -30 });
  assert.deepEqual(rep.total, { n: 3, wins: 2, netUsd: 90 });
  const db = new DB(null);
  assert.equal((await recordAmitBot(db, rep, { now: new Date(NOW) })).saved, true);
  assert.equal((await recordAmitBot(db, rep, { now: new Date(NOW + 5 * 60e3) })).throttled, true);
  assert.equal((await recordAmitBot(db, { ...rep, halt: 'daily' }, { now: new Date(NOW + 6 * 60e3) })).saved, true, 'שינוי מצב עצירה נשמר מיד');
  const stored = await db.get(AMITBOT_KEY);
  assert.equal(stored.halt, 'daily');
  const lines = botLines(stored, NOW + 7 * 60e3).join('\n');
  assert.match(lines, /חשבון הדמו של Bybit/); assert.match(lines, /היום: 2 עסקאות, 1 הצלחות, נטו -\$30/); assert.match(lines, /מגבלת הפסד יומית/);
  assert.match(botLines(stored, NOW + 5 * 3600e3).join('\n'), /אין דיווח מהבוט 5 שעות/);
  assert.throws(() => cleanBotReport({ v: 2 }), /לא תקין/);
  const s = { trades: [], agg: { n: 0, wins: 0, netUsd: 0, feesUsd: 0 }, pos: null };
  assert.match(formatSummary(s, day, null, stored, NOW), /בוט בחשבון הדמו של Bybit/);
});

test('POST /amit/bot בלי סוד = 401; עם סוד הגשר = נשמר; GET /amit מחזיר את הבוט', async () => {
  const { default: worker } = await import('../worker.js');
  const env = { BRIDGE_SECRET: 'b', CRON_SECRET: 'c', APP_TOKEN: 'tok' };
  const rep = summarize([], { day: ilDay(Date.now()), equity: 1 });
  const post = (q) => worker.fetch(new Request(`https://x/amit/bot${q}`, { method: 'POST', body: JSON.stringify(rep), headers: { 'Content-Type': 'application/json' } }), env, {});
  assert.equal((await post('')).status, 401);
  const r = await post('?secret=b');
  assert.equal(r.status, 200); assert.equal((await r.json()).saved, true);
});

test('הבוט עצמו מול Bybit מדומה: שטוח → 2 כניסות; כניסה → ביטול הנגדית + דיווח; STOP → ביטול הכול וסגירה', async () => {
  process.env.BYBIT_DEMO_API_KEY = 'k'; process.env.BYBIT_DEMO_API_SECRET = 's'; process.env.BRIDGE_SECRET = 'b';
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-')); process.env.BOT_STOP = path.join(dir, 'STOP'); process.env.BOT_STATE = path.join(dir, 's.json');
  const { tick } = await import('../scripts/bybit-amit-bot.mjs?t=' + Date.now());
  let pos = null, orders = [], calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url), body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ host: u.host, path: u.pathname, body });
    const ok = (result) => Response.json({ retCode: 0, retMsg: 'OK', result });
    if (u.pathname === '/v5/market/kline'){ const now = Date.now(), t0 = Math.floor(now / 60e3) * 60e3; return Response.json({ result: { list: Array.from({ length: 30 }, (_, i) => [String(t0 - i * 60e3), '1', '1', '1', String(76000 + (i % 2 ? 20 : -20))]) } }); }
    assert.equal(u.host === 'api-demo.bybit.com' || u.host === 'invest-api.meirco199.workers.dev', true, 'רק דמו או ה-Worker: ' + u.host);
    if (u.pathname === '/v5/position/list') return ok({ list: pos ? [pos] : [] });
    if (u.pathname === '/v5/order/realtime') return ok({ list: orders });
    if (u.pathname === '/v5/position/closed-pnl') return ok({ list: [] });
    if (u.pathname === '/v5/account/wallet-balance') return ok({ list: [{ totalEquity: '178000' }] });
    if (u.pathname === '/v5/order/create'){ orders.push({ orderId: 'o' + orders.length, orderLinkId: body.orderLinkId || 'mkt', side: body.side }); return ok({ orderId: 'x' }); }
    if (u.pathname === '/v5/order/cancel'){ orders = orders.filter((o) => o.orderId !== body.orderId); return ok({}); }
    if (u.pathname === '/v5/order/cancel-all'){ orders = []; return ok({}); }
    if (u.pathname === '/amit/bot') return Response.json({ ok: true });
    throw new Error('unexpected ' + u.pathname);
  };
  const realNow = Date.now; Date.now = () => Math.floor(realNow() / 60e3) * 60e3 + 5000;
  try {
    const state = { startedAt: new Date().toISOString(), trades: [], posSinceMs: null, lastBarT: 0, haltDay: null, lastReportMs: 0 }, mem = {};
    await tick(state, mem);
    const creates = calls.filter((c) => c.path === '/v5/order/create');
    assert.equal(creates.length, 2); assert.ok(creates.every((c) => c.body.stopLoss && c.body.category === 'linear' && c.body.symbol === 'BTCUSDT'));
    assert.ok(calls.some((c) => c.path === '/amit/bot'), 'דיווח ראשון בהפעלה');
    // הקנייה התמלאה → הפוזיציה קיימת; הבוט מבטל את פקודת המכירה מיד
    pos = { side: 'Buy', size: '2.501', avgPrice: '75960', unrealisedPnl: '-50' }; orders = orders.filter((o) => o.side === 'Sell'); calls = [];
    await tick(state, mem);
    assert.ok(calls.some((c) => c.path === '/v5/order/cancel'), 'ביטול הנגדית'); assert.ok(state.posSinceMs > 0);
    // STOP → ביטול הכול + סגירה בשוק reduce-only
    fs.writeFileSync(process.env.BOT_STOP, ''); orders.push({ orderId: 'tp', orderLinkId: 'amit-tp-1' }); calls = [];
    await tick(state, mem);
    const close = calls.find((c) => c.path === '/v5/order/create');
    assert.ok(calls.some((c) => c.path === '/v5/order/cancel-all'));
    assert.equal(close.body.orderType, 'Market'); assert.equal(close.body.reduceOnly, true); assert.equal(close.body.side, 'Sell'); assert.equal(close.body.qty, '2.501');
  } finally { globalThis.fetch = orig; Date.now = realNow; }
});
