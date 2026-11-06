// דמה קריפטו בזמן אמת: המנוע ב-JS זהה ל-paper.py (fixture שנוצר בפייתון), מקורות הנרות (Coinbase → Kraken), ריצה מה-cron,
// התראות טלגרם, ומקור אמת יחיד (תגובה ישנה ב-Issue #189 לא דורסת את המנוע ב-Worker). בלי רשת.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runPaper, processCoin, sideLevels, CAT, BAR_MS } from '../engine/sinay-rules.js';
import { closedBars, parseCoinbase, parseKraken, fetchBars, dueToRun, runSinayLive, formatEvent, formatMessage, sinayDayLines } from '../lib/sinay-live.js';
import { ingestSinay, sinayReport, validateState, SINAY_KEY } from '../lib/sinay.js';
import { DB } from '../lib/db.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures-sinay-parity.json', import.meta.url)));

test('המנוע ב-JS נותן מצב זהה בתו לזה של paper.py (6 ריצות רצופות, כולל עסקאות סטופ ויעד)', () => {
  let st = null;
  for (const k of fixture.cuts){
    const by = {};
    for (const [s, rows] of Object.entries(fixture.bars)) by[s] = rows.slice(0, k - 1); // paper.py מפיל את הנר האחרון (לא נסגר)
    st = runPaper(st, by).state;
  }
  assert.equal(JSON.stringify(st), JSON.stringify(fixture.expected));
  assert.ok(fixture.expected.trades.length >= 4);
  assert.ok(fixture.expected.trades.some((t) => t.why === 'סטופ'), 'ה-fixture כולל גם הפסד');
});

test('אירועים: דשדוש → כניסה → מילויים → יציאה, ועסקה אחת לכל יציאה', () => {
  let st = null; const events = [];
  for (const k of fixture.cuts){
    const by = {}; for (const [s, rows] of Object.entries(fixture.bars)) by[s] = rows.slice(0, k - 1);
    const r = runPaper(st, by); st = r.state; events.push(...r.events);
  }
  const exits = events.filter((e) => e.type === 'exit');
  assert.equal(exits.length, st.trades.length);
  assert.ok(events.some((e) => e.type === 'setup') && events.some((e) => e.type === 'entry'));
  for (const e of events.filter((x) => x.type === 'entry')) assert.equal(e.third, 1);
  const setup = events.find((e) => e.type === 'setup');
  const S = sideLevels(setup.sym, setup.hi, 1);
  assert.deepEqual(setup.short.lv, S.lv);
  assert.ok(setup.short.lv[0] > setup.hi && setup.long.lv[0] < setup.lo && setup.short.stop > setup.short.lv[2] && setup.long.stop < setup.long.lv[2]);
});

test('processCoin: לא מעבד שוב נר שכבר עובד', () => {
  const st = { version: 1, start: null, trades: [], coins: {} };
  const bars = fixture.bars.BTC.slice(0, 300);
  runPaper(st, { BTC: bars.slice(0, 150) });
  runPaper(st, { BTC: bars });
  const snap = JSON.stringify(st);
  const r = processCoin('BTC', st, bars);
  assert.equal(r.events.length, 0);
  assert.equal(JSON.stringify(st), snap);
});

const NOW = Date.parse('2026-11-05T12:07:00Z');
test('closedBars: רק נרות סגורים, ממוינים, בלי כפילויות ובלי OHLC שבור', () => {
  const t = (iso) => Date.parse(iso) / 1000;
  const rows = [
    [t('2026-11-05T11:45:00Z'), 10, 11, 9, 10.5],   // נסגר ב-12:00 ✓
    [t('2026-11-05T12:00:00Z'), 10, 11, 9, 10.5],   // נסגר ב-12:15 — עוד פתוח ✗
    [t('2026-11-05T11:30:00Z'), 10, 11, 9, 10.5],
    [t('2026-11-05T11:30:00Z'), 10, 11, 9, 10.5],   // כפילות ✗
    [t('2026-11-05T11:15:00Z'), 10, 9, 11, 10],     // high < low ✗
    [t('2026-11-05T11:00:00Z'), 10, 11, 9, NaN],    // ✗
  ];
  const out = closedBars(rows, NOW);
  assert.deepEqual(out.map((b) => b[0]), ['2026-11-05T11:30:00Z', '2026-11-05T11:45:00Z']);
});

test('parseCoinbase / parseKraken → [sec, o, h, l, c]', () => {
  assert.deepEqual(parseCoinbase([[1700000000, 9, 11, 10, 10.5, 123]]), [[1700000000, 10, 11, 9, 10.5]]);
  assert.deepEqual(parseKraken({ error: [], result: { XXBTZUSD: [[1700000000, '10', '11', '9', '10.5', '10.2', '5', 7]], last: 1 } }), [[1700000000, 10, 11, 9, 10.5]]);
  assert.throws(() => parseKraken({ error: ['EGeneral:Too many requests'] }), /kraken/);
  assert.throws(() => parseCoinbase({ message: 'NotFound' }), /coinbase/);
});

// מקור נרות מדומה: כל המטבעות, נר כל 15 דקות עד NOW, מחיר סביב base
function feedRows(endMs, n, base, fmt){
  const rows = [];
  const last = Math.floor(endMs / BAR_MS) * BAR_MS; // הנר הפתוח הנוכחי
  for (let i = n - 1; i >= 0; i--){
    const ms = last - i * BAR_MS, w = Math.sin(ms / 3.6e6) * 0.002;
    const o = base * (1 + w), c = base * (1 + w * 0.9), h = Math.max(o, c) * 1.0005, l = Math.min(o, c) * 0.9995;
    rows.push(fmt === 'coinbase' ? [ms / 1000, l, h, o, c, 1] : [ms / 1000, String(o), String(h), String(l), String(c), '0', '1', 1]);
  }
  return fmt === 'coinbase' ? rows.reverse() : rows;
}
const BASE = { BTC: 80000, ETH: 2400, LTC: 56, BCH: 280 };
function mockFetch({ coinbase = true, kraken = true, calls = [] } = {}, endMs = NOW){
  return async (url) => {
    url = String(url); calls.push(url);
    if (url.includes('coinbase')){
      if (!coinbase) return new Response('blocked', { status: 403 });
      const sym = url.match(/products\/(\w+)-USD/)[1];
      return Response.json(feedRows(endMs, 300, BASE[sym], 'coinbase'));
    }
    if (url.includes('kraken')){
      if (!kraken) return new Response('down', { status: 503 });
      const pair = url.match(/pair=(\w+)/)[1], sym = { XBTUSD: 'BTC', ETHUSD: 'ETH', LTCUSD: 'LTC', BCHUSD: 'BCH' }[pair];
      return Response.json({ error: [], result: { [pair]: feedRows(endMs, 720, BASE[sym], 'kraken'), last: 1 } });
    }
    throw new Error('unexpected ' + url);
  };
}

test('fetchBars: Coinbase, ובחסימה — גיבוי Kraken; שניהם נופלים → bars=null עם שגיאות', async () => {
  const a = await fetchBars({ fetchFn: mockFetch(), nowMs: NOW });
  assert.equal(a.feed, 'coinbase'); assert.equal(a.bars.BTC.length, 299, 'הנר הפתוח לא נכלל');
  assert.equal(a.bars.BTC.at(-1)[0], '2026-11-05T11:45:00Z');
  const b = await fetchBars({ fetchFn: mockFetch({ coinbase: false }), nowMs: NOW });
  assert.equal(b.feed, 'kraken'); assert.match(b.errors[0], /coinbase: HTTP 403/);
  const c = await fetchBars({ fetchFn: mockFetch({ coinbase: false, kraken: false }), nowMs: NOW });
  assert.equal(c.bars, null); assert.equal(c.errors.length, 2);
});

test('dueToRun: רץ רק אחרי שנסגר נר חדש', () => {
  const st = { coins: Object.fromEntries(Object.keys(CAT).map((s) => [s, { last_t: '2026-11-05T11:30:00Z' }])) };
  assert.equal(dueToRun(st, Date.parse('2026-11-05T11:59:00Z')), false);
  assert.equal(dueToRun(st, Date.parse('2026-11-05T12:00:00Z')), true);
  assert.equal(dueToRun(null, NOW), true);
});

function tgEnv(sent){
  return { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1', sent };
}
async function withTelegram(fn){
  const orig = globalThis.fetch, sent = [];
  globalThis.fetch = async (url, opts) => { if (String(url).includes('api.telegram.org')){ sent.push(JSON.parse(opts.body).text); return new Response('{}', { status: 200 }); } throw new Error('no net ' + url); };
  try { return await fn(sent); } finally { globalThis.fetch = orig; }
}

test('runSinayLive: חימום מאפס → שמירה ב-KV עם engine=worker; ריצה חוזרת בלי נר חדש לא קוראת לרשת ולא כותבת', async () => {
  const db = new DB(null); let puts = 0; const put0 = db.put.bind(db); db.put = async (...a) => { puts++; return put0(...a); };
  const ctx = { db, env: {} };
  const r1 = await runSinayLive(ctx, { fetchFn: mockFetch(), now: new Date(NOW) });
  assert.equal(r1.ok, true); assert.equal(r1.changed, true); assert.equal(r1.feed, 'coinbase');
  const st = await db.get(SINAY_KEY);
  assert.equal(st.source.engine, 'worker'); assert.equal(st.source.feed, 'coinbase');
  assert.deepEqual(Object.keys(st.state.coins), ['BTC', 'ETH', 'LTC', 'BCH']);
  assert.doesNotThrow(() => validateState(st.state));
  const calls = [];
  const r2 = await runSinayLive(ctx, { fetchFn: mockFetch({ calls }), now: new Date(NOW + 60e3) });
  assert.equal(r2.skipped, 'no_new_bar'); assert.equal(calls.length, 0); assert.equal(puts, 1);
  // נר חדש נסגר (12:00–12:15) → ריצה, עיבוד, כתיבה
  const later = Date.parse('2026-11-05T12:16:00Z');
  const r3 = await runSinayLive(ctx, { fetchFn: mockFetch({}, later), now: new Date(later) });
  assert.equal(r3.changed, true); assert.equal(puts, 2);
  assert.equal((await db.get(SINAY_KEY)).state.coins.BTC.last_t, '2026-11-05T12:00:00Z');
});

test('runSinayLive: שני המקורות נופלים → לא נוגעים במצב; השגיאה נרשמת פעם בשעה לכל היותר', async () => {
  const db = new DB(null);
  const ctx = { db, env: {} };
  const r = await runSinayLive(ctx, { fetchFn: mockFetch({ coinbase: false, kraken: false }), now: new Date(NOW) });
  assert.equal(r.ok, false);
  assert.equal(await db.get(SINAY_KEY), null);
  assert.ok(await db.get('sinay:feederr'));
  const errs1 = (await db.get('log:err')).length;
  await runSinayLive(ctx, { fetchFn: mockFetch({ coinbase: false, kraken: false }), now: new Date(NOW + 300e3) });
  assert.equal((await db.get('log:err')).length, errs1, 'לא נרשמה שגיאה כפולה');
});

test('runSinayLive: אירוע מסחר → המצב נשמר, ובלי הודעת טלגרם (רק בסיכום היומי)', async () => {
  // מצב שבו BTC בדשדוש פעיל, והנר הבא נוגע ברמת השורט הראשונה
  const db = new DB(null);
  const st = { version: 1, start: '2026-11-04T00:00:00Z', trades: [], coins: {} };
  const first = await fetchBars({ fetchFn: mockFetch(), nowMs: NOW });
  runPaper(st, first.bars);
  const S = sideLevels('BTC', 80100, 1);
  st.coins.BTC.setup = { hi: 80100, lo: 79900, age: 3 };
  await db.put(SINAY_KEY, { hash: 'x', receivedAt: 'x', source: { engine: 'worker' }, state: st });
  const later = Date.parse('2026-11-05T12:16:00Z');
  const spike = async (url) => {
    const r = await mockFetch({}, later)(url);
    if (!String(url).includes('BTC-USD')) return r;
    const rows = await r.json(); // מהחדש לישן; rows[1] = הנר 12:00 (שנסגר)
    rows[1] = [rows[1][0], rows[1][1], S.lv[0] * 1.0001, rows[1][3], rows[1][4], 1];
    return Response.json(rows);
  };
  await withTelegram(async (sent) => {
    const r = await runSinayLive({ db, env: tgEnv() }, { fetchFn: spike, now: new Date(later) });
    assert.equal(r.changed, true); assert.ok(r.events >= 1); assert.equal(r.telegram, undefined);
    assert.equal(sent.length, 0, 'אין הודעה על כל אירוע');
    const saved = await db.get(SINAY_KEY);
    assert.equal(saved.state.coins.BTC.pos.side, 'short');
    assert.equal(saved.state.coins.BTC.pos.fills.length, 1);
  });
});

test('ingestSinay: אחרי שהמנוע עבר ל-Worker, תגובה מ-Issue #189 לא דורסת את המצב', async () => {
  const db = new DB(null);
  await runSinayLive({ db, env: {} }, { fetchFn: mockFetch(), now: new Date(NOW) });
  const before = JSON.stringify(await db.get(SINAY_KEY));
  const old = { version: 1, start: '2026-11-01T18:30:00Z', trades: [], coins: { BTC: { last_t: '2026-11-01T18:30:00Z', hist: [[2, 1]], ema: 1.5, setup: null, pos: null } } };
  const r = await ingestSinay(db, { state: old });
  assert.equal(r.ignored, true); assert.equal(r.changed, false);
  assert.equal(JSON.stringify(await db.get(SINAY_KEY)), before);
});

test('sinayReport: מנוע חי — engine/feed, סף "לא עודכן" של שעה ורבע, מצב לכל מטבע ורמות מלאות לדשדוש', async () => {
  const db = new DB(null);
  await runSinayLive({ db, env: {} }, { fetchFn: mockFetch(), now: new Date(NOW) });
  const stored = await db.get(SINAY_KEY);
  stored.state.coins.ETH.setup = { hi: 2410, lo: 2390, age: 10 };
  const r = sinayReport(stored, { now: new Date(NOW) });
  assert.equal(r.engine, 'worker'); assert.equal(r.feed, 'coinbase'); assert.equal(r.stale, false);
  assert.equal(sinayReport(stored, { now: new Date(NOW + 2 * 3600e3) }).stale, true);
  assert.equal(r.perCoin.BTC.status, 'waiting'); assert.equal(r.perCoin.ETH.status, 'setup');
  assert.ok(r.perCoin.BTC.range12h > 0 && r.perCoin.BTC.rangeNeeded === 0.012);
  const s = r.setups.find((x) => x.sym === 'ETH');
  assert.equal(s.shortLevels.length, 3); assert.ok(s.shortStop > s.shortLevels[2] && s.longStop < s.longLevels[2]);
  assert.equal(s.barsLeft, 87);
});

test('formatEvent: יציאה כוללת אחוז, דולרים על 50K$ ומצטבר', () => {
  const tr = { n: 1, sym: 'BTC', side: 'long', open: '2026-11-05T10:00:00Z', close: '2026-11-05T11:00:00Z', fills: 2, avg: 80000, exit: 80500, why: 'יעד EMA50', net_pct: 0.4, usd: 40 };
  const txt = formatEvent({ type: 'exit', sym: 'BTC', t: tr.close, trade: tr }, { state: { trades: [tr] }, nowMs: Date.parse(tr.close) });
  assert.match(txt, /✅ BTC: יציאה מלונג \(יעד EMA50\) ב-80,500/);
  assert.match(txt, /\+\$200 על 50K\$/);
  assert.match(txt, /מצטבר: 1 עסקאות, 1 הצלחות/);
  assert.equal(formatMessage([], {}), null);
});

test('sinayDayLines: שורות לסיכום היומי — היום, מצטבר ופוזיציות פתוחות', () => {
  const tr = (close, net_pct) => ({ sym: 'BTC', side: 'long', close, net_pct });
  const st = { trades: [tr('2026-11-05T10:00:00Z', 0.4), tr('2026-11-06T10:00:00Z', -0.2)], coins: { ETH: { pos: { side: 'short', fills: [1, 2] } }, BTC: { pos: null } } };
  const lines = sinayDayLines(st, (iso) => iso.startsWith('2026-11-06')).join('\n');
  assert.match(lines, /היום: 1 עסקאות, 0 הצלחות, נטו -\$100/);
  assert.match(lines, /מצטבר: 2 עסקאות, 1 הצלחות, נטו \+\$100/);
  assert.match(lines, /פתוח עכשיו: ETH שורט \(2\/3\)/);
  assert.deepEqual(sinayDayLines(null, () => true), []);
});
