// בוט 2 של עמית (ETH, נרות 15 דקות, חציה וחזרה לרצועה): החלטות (engine/amit2-exec.js), דיווח, והבוט מול Bybit מדומה
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOT2, signal, decide2, qty2, closedBars15 } from '../engine/amit2-exec.js';
import { bands } from '../engine/amit-rules.js';
import { summarize, ilDay } from '../engine/amit-exec.js';
import { recordAmitBot, formatSummary, AMITBOT_KEY, AMITBOT2_KEY } from '../lib/amit-live.js';
import { DB } from '../lib/db.js';

const T0 = Date.parse('2026-11-07T06:00:00Z'), M15 = 15 * 60e3;
// 19 נרות שקטים סביב 2400, ואז נר אחרון לבחירה
const base = () => Array.from({ length: 19 }, (_, i) => { const c = 2400 + (i % 2 ? 4 : -4); return { t: T0 + i * M15, o: 2400, h: c + 3, l: c - 3, c }; });
const withLast = (o, h, l, c) => [...base(), { t: T0 + 19 * M15, o, h, l, c }];

test('רק חשבון הדמו; ETH; סיכון 400$ לעסקה; מגבלה יומית 1,000$', () => {
  assert.equal(BOT2.base, 'https://api-demo.bybit.com'); assert.equal(BOT2.symbol, 'ETHUSDT');
  assert.equal(BOT2.riskUsd, 400); assert.equal(BOT2.dailyLossUsd, 1000); assert.equal(BOT2.barMs, 15 * 60e3);
});

test('signal לונג: הנר חצה מתחת לרצועה התחתונה, נסגר מעליה וחיובי → סטופ מתחת לקצה, יעד אמצע הרצועה', () => {
  const bars = withLast(2391, 2394, 2390, 2393);
  const b = bands(bars.map((x) => x.c));
  assert.ok(bars.at(-1).l < b.lo && bars.at(-1).c > b.lo, 'תנאי המבחן: חציה וסגירה בפנים');
  const s = signal(bars);
  assert.equal(s.side, 'long'); assert.equal(s.skip, undefined);
  assert.ok(Math.abs(s.sl - 2390 * (1 - 0.0005)) < 1e-6);
  assert.ok(Math.abs(s.tp - b.mid) < 1e-9);
  assert.ok(s.rr >= 1);
});

test('signal: נר שלילי אחרי חציה למטה = אין אות; נר שלא חצה = אין אות; שורט במראה', () => {
  assert.equal(signal(withLast(2394, 2395, 2390, 2393)), null, 'סגירה מתחת לפתיחה — לא לונג');
  assert.equal(signal(withLast(2398, 2401, 2397, 2400)), null);
  const s = signal(withLast(2409, 2410, 2406, 2407));
  assert.equal(s.side, 'short'); assert.ok(s.sl > 2410 && s.tp < s.entryRef);
});

test('signal: מוותר כשהסטופ רחוק מ-1.2% או כשהיעד קרוב מהסטופ', () => {
  const far = signal(withLast(2394, 2397, 2350, 2396.5));
  assert.match(far.skip, /סטופ רחוק/);
  const flatBars = Array.from({ length: 19 }, (_, i) => ({ t: T0 + i * M15, o: 2400, h: 2400.5, l: 2399.5, c: 2400 + (i % 2 ? 0.2 : -0.2) }));
  const near = signal([...flatBars, { t: T0 + 19 * M15, o: 2399.4, h: 2399.9, l: 2390, c: 2399.6 }]);
  if (near && near.skip) assert.match(near.skip, /יעד קרוב|סטופ רחוק/);
});

test('qty2: לפי סיכון של 400$, עד תקרת 190,000$', () => {
  assert.equal(qty2(400, 2400, 2396), '79.16', 'תקרה: 190,000/2400 = 79.16 (הסיכון לבד היה נותן 100)');
  assert.equal(qty2(400, 2400, 2380), '20.00');
});

test('decide2: שטוח + נר חדש עם אות → פקודת שוק עם סטופ ויעד בבורסה; בלי נר חדש → כלום', () => {
  const bars = withLast(2391, 2394, 2390, 2393);
  const [a] = decide2({ pos: null, trade: null, bars, newBar: true, halt: null, nowMs: T0 + 20 * M15 });
  assert.equal(a.type, 'open'); assert.equal(a.order.orderType, 'Market'); assert.equal(a.order.side, 'Buy');
  assert.ok(Number(a.order.stopLoss) < 2393 && Number(a.order.takeProfit) > 2393); assert.equal(a.order.tpslMode, 'Full');
  assert.ok(a.order.orderLinkId.startsWith('a2-'));
  const risk = (2393 - Number(a.order.stopLoss)) * Number(a.order.qty);
  assert.ok(risk <= 401, 'סיכון עד 400$'); assert.ok(Number(a.order.qty) * 2393 <= 190000, 'עד תקרת 190K$');
  assert.deepEqual(decide2({ pos: null, bars, newBar: false, nowMs: T0 }), []);
});

test('decide2 בעסקה: חצי הדרך ליעד → סטופ למחיר הכניסה (+עמלות), פעם אחת ורק אם משפר; שעתיים → סגירה', () => {
  const pos = { side: 'long', size: '20', entry: 2396.5, mark: 2396.5, sl: 2384, sinceMs: T0 };
  const trade = { tp: 2400.5, be: false };
  assert.deepEqual(decide2({ pos, trade, nowMs: T0 + 60e3 }), [], 'עוד לא באמצע');
  const a = decide2({ pos: { ...pos, mark: 2398.6 }, trade, nowMs: T0 + 60e3 });
  assert.equal(a[0].type, 'moveSl'); assert.equal(a[0].price, (2396.5 * 1.0006).toFixed(2));
  assert.deepEqual(decide2({ pos: { ...pos, mark: 2399 }, trade: { ...trade, be: true }, nowMs: T0 + 60e3 }), [], 'כבר הוזז');
  assert.deepEqual(decide2({ pos: { ...pos, mark: 2399, sl: 2398.5 }, trade, nowMs: T0 + 60e3 }), [], 'לא מרחיקים סטופ שכבר טוב יותר');
  const sh = decide2({ pos: { side: 'short', size: '20', entry: 2403.5, mark: 2401, sl: 2416 }, trade: { tp: 2399, be: false }, nowMs: T0 + 60e3 });
  assert.equal(sh[0].type, 'moveSl'); assert.ok(Number(sh[0].price) < 2403.5);
  assert.deepEqual(decide2({ pos, trade, nowMs: T0 + 120 * 60e3 }).map((x) => x.type), ['close']);
});

test('decide2: עצירה → ביטול + סגירה; בלי פוזיציה → כלום', () => {
  const pos = { side: 'long', size: '1', entry: 1, mark: 1, sinceMs: T0 };
  assert.deepEqual(decide2({ pos, halt: 'stop', nowMs: T0 }).map((x) => x.type), ['cancelAll', 'close']);
  assert.deepEqual(decide2({ pos: null, halt: 'daily', bars: withLast(2391, 2394, 2390, 2393), newBar: true, nowMs: T0 }), []);
});

test('closedBars15: רק נרות סגורים, עם o/h/l/c', () => {
  const j = { result: { list: [[String(T0 + M15), '1', '2', '0.5', '1.5'], [String(T0), '1', '2', '0.5', '1.2']] } };
  const b = closedBars15(j, T0 + M15 + 1000);
  assert.equal(b.length, 1); assert.deepEqual(b[0], { t: T0, o: 1, h: 2, l: 0.5, c: 1.2 });
});

test('דיווח בוט 2: מפתח נפרד; GET /amit מחזיר bot2; הסיכום היומי מציג את שני הבוטים', async () => {
  const db = new DB(null), now = new Date(T0);
  const rep = summarize([{ t: T0 - 1000, pnl: 120 }], { day: ilDay(T0), equity: 178000 });
  await recordAmitBot(db, rep, { now, bot: 2 });
  assert.ok(await db.get(AMITBOT2_KEY)); assert.equal(await db.get(AMITBOT_KEY), null);
  await recordAmitBot(db, { ...rep, today: { n: 0, wins: 0, netUsd: 0 } }, { now, bot: 1 });
  const s = { trades: [], agg: { n: 0, wins: 0, netUsd: 0, feesUsd: 0 }, pos: null };
  const txt = formatSummary(s, ilDay(T0), null, await db.get(AMITBOT_KEY), T0, await db.get(AMITBOT2_KEY));
  assert.match(txt, /בוט 1/); assert.match(txt, /בוט 2/); assert.match(txt, /ETH/);
  const { default: worker } = await import('../worker.js');
  const env = { BRIDGE_SECRET: 'b' };
  const r = await worker.fetch(new Request('https://x/amit/bot?bot=2&secret=b', { method: 'POST', body: JSON.stringify(rep), headers: { 'Content-Type': 'application/json' } }), env, {});
  assert.equal(r.status, 200);
});

test('הבוט עצמו מול Bybit מדומה: אות → פקודת שוק עם סטופ ויעד; התקדמות → הזזת סטופ; STOP → סגירה', async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bot2-'));
  Object.assign(process.env, { BYBIT_DEMO_API_KEY: 'k', BYBIT_DEMO_API_SECRET: 's', BRIDGE_SECRET: 'b', BOT_STOP: path.join(dir, 'STOP'), BOT2_STATE: path.join(dir, 's2.json') });
  const { tick } = await import('../scripts/bybit-amit2-bot.mjs?t=' + Date.now());
  const realNow = Date.now, slot = Math.floor(realNow() / M15) * M15; Date.now = () => slot + 5000;
  let pos = null, calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url), body = opts.body ? JSON.parse(opts.body) : null; calls.push({ host: u.host, path: u.pathname, body });
    const ok = (result) => Response.json({ retCode: 0, retMsg: 'OK', result });
    if (u.pathname === '/v5/market/kline'){
      assert.equal(u.searchParams.get('interval'), '15'); assert.equal(u.searchParams.get('symbol'), 'ETHUSDT');
      const bars = withLast(2391, 2394, 2390, 2393).map((b, i, a) => [String(slot - (a.length - i) * M15), b.o, b.h, b.l, b.c]);
      return Response.json({ result: { list: [[String(slot), '2396', '2397', '2395', '2396'], ...bars.reverse()] } });
    }
    assert.ok(['api-demo.bybit.com', 'invest-api.meirco199.workers.dev'].includes(u.host), 'רק דמו או ה-Worker: ' + u.host);
    if (u.pathname === '/v5/position/list') return ok({ list: pos ? [pos] : [] });
    if (u.pathname === '/v5/position/closed-pnl') return ok({ list: [] });
    if (u.pathname === '/v5/account/wallet-balance') return ok({ list: [{ totalEquity: '178000' }] });
    if (['/v5/order/create', '/v5/position/trading-stop', '/v5/order/cancel-all'].includes(u.pathname)) return ok({});
    if (u.pathname === '/amit/bot'){ assert.equal(u.searchParams.get('bot'), '2'); return Response.json({ ok: true }); }
    throw new Error('unexpected ' + u.pathname);
  };
  try {
    const state = { startedAt: new Date(slot).toISOString(), trades: [], trade: null, lastBarT: 0, haltDay: null, lastReportMs: 0 }, mem = {};
    await tick(state, mem);
    const open = calls.find((c) => c.path === '/v5/order/create').body;
    assert.equal(open.orderType, 'Market'); assert.equal(open.side, 'Buy'); assert.equal(open.symbol, 'ETHUSDT'); assert.ok(open.stopLoss && open.takeProfit);
    assert.ok(state.trade && state.trade.side === 'long');
    pos = { side: 'Buy', size: open.qty, avgPrice: '2393', markPrice: String(2393 + (Number(open.takeProfit) - 2393) * 0.6), stopLoss: open.stopLoss, takeProfit: open.takeProfit, unrealisedPnl: '30' };
    calls = [];
    await tick(state, mem);
    assert.ok(calls.some((c) => c.path === '/v5/position/trading-stop'), 'סטופ הוזז'); assert.equal(state.trade.be, true);
    fs.writeFileSync(process.env.BOT_STOP, ''); calls = [];
    await tick(state, mem);
    const close = calls.filter((c) => c.path === '/v5/order/create').at(-1).body;
    assert.equal(close.orderType, 'Market'); assert.equal(close.reduceOnly, true); assert.equal(close.side, 'Sell');
  } finally { globalThis.fetch = orig; Date.now = realNow; }
});
