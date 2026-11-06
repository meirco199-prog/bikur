// מסלול "עמית" (דמה): סקאלפ ביטקוין על נרות דקה. המנוע (כניסה בחציית בולינגר, יעד/סטופ/זמן, עמלות), הריצה מה-cron
// (חימום בלי עסקאות לאחור, מכסת כתיבות KV, סיכום טלגרם יומי אחד), הדוח, ונתיב ההרצה הידנית. בלי רשת.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AMIT, bands, newAmit, warmAmit, processAmit, amitUnrealized } from '../engine/amit-rules.js';
import { runAmitLive, amitReport, fetchBars1m, formatSummary, ilParts, AMIT_KEY } from '../lib/amit-live.js';
import { DB } from '../lib/db.js';
import worker from '../worker.js';

const T0 = Date.parse('2026-11-06T10:00:00Z');
const iso = (i) => new Date(T0 + i * 60e3).toISOString().replace('.000Z', 'Z');
// 20 נרות שקטים סביב 100 (תנודה קטנה, כדי שלרצועה יהיה רוחב)
const calm = (n = 20, base = 100) => Array.from({ length: n }, (_, i) => { const c = base + (i % 2 ? 0.05 : -0.05); return [iso(i), c, c + 0.02, c - 0.02, c]; });
const bar = (i, o, h, l, c) => [iso(i), o, h, l, c];
const fresh = () => { const s = newAmit(); processAmit(s, calm()); return s; };

test('bands: ממוצע ± 2 סטיות תקן (אוכלוסייה)', () => {
  const b = bands([1, 2, 3, 4, 5]);
  assert.equal(b.mid, 3);
  assert.ok(Math.abs(b.up - (3 + 2 * Math.sqrt(2))) < 1e-12 && Math.abs(b.lo - (3 - 2 * Math.sqrt(2))) < 1e-12);
});

const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;
const band0 = () => bands(calm().map((x) => x[4])); // הרצועות אחרי 20 הנרות השקטים: 99.9–100.1

test('לונג בנגיעה ברצועה התחתונה (פקודה מוגבלת), יציאה בנגיעה ברצועה העליונה', () => {
  const s = fresh(), b = band0();
  assert.equal(s.pos, null); assert.equal(s.zone, 'in');
  assert.ok(near(b.lo, 99.9, 1e-9) && near(b.up, 100.1, 1e-9));
  const r1 = processAmit(s, [bar(20, 100, 100, 99.85, 99.95)]);
  assert.equal(r1.events[0].type, 'entry'); assert.equal(s.pos.side, 'long');
  assert.ok(near(s.pos.entry, b.lo, 1e-9), 'נכנסים במחיר הרצועה, לא בתחתית הנר');
  assert.ok(near(s.pos.sl, b.lo * (1 - 0.0022), 1e-9));
  const up1 = bands([...calm().map((x) => x[4]).slice(1), 99.95]).up;
  const r2 = processAmit(s, [bar(21, 99.95, 100.3, 99.9, 100.2)]);
  const t = r2.trades[0];
  assert.equal(t.why, 'יעד'); assert.equal(t.mins, 1); assert.ok(near(t.exit, up1));
  const qty = AMIT.notional / b.lo, gross = (up1 - b.lo) * qty, fees = AMIT.notional * 0.00014 + up1 * qty * 0.00014;
  assert.ok(near(t.gross_usd, gross) && near(t.fees_usd, fees) && near(t.net_usd, gross - fees));
  assert.equal(s.pos, null); assert.equal(s.agg.n, 1); assert.equal(s.agg.wins, 1);
});

test('סטופ נבדק ראשון (גם כשהנר נוגע גם ביעד), ויוצא בפקודה מיידית', () => {
  const s = fresh(), b = band0();
  processAmit(s, [bar(20, 100, 100, 99.85, 99.95)]);
  const r = processAmit(s, [bar(21, 99.95, 100.4, 99.5, 100)]);
  const t = r.trades[0], sl = b.lo * (1 - 0.0022), qty = AMIT.notional / b.lo;
  assert.equal(t.why, 'סטופ'); assert.ok(near(t.exit, sl));
  assert.ok(near(t.net_usd, (sl - b.lo) * qty - AMIT.notional * 0.00014 - sl * qty * 0.00035));
  assert.ok(t.net_usd < -505 && t.net_usd > -515, `סטופ על 190K$ ≈ −418 ועוד ~93 עמלות (${t.net_usd})`);
  assert.ok(s.agg.maxDdUsd > 0);
});

test('נר הכניסה שממשיך עד הסטופ → סטופ באותו נר; נר שנוגע בשתי הרצועות → אין כניסה', () => {
  const s = fresh();
  const r = processAmit(s, [bar(20, 100, 100, 99.4, 99.5)]);
  assert.deepEqual(r.events.map((e) => e.type), ['entry', 'exit']); assert.equal(r.trades[0].why, 'סטופ'); assert.equal(r.trades[0].mins, 0);
  const s2 = fresh();
  assert.equal(processAmit(s2, [bar(20, 100, 100.2, 99.8, 100)]).events.length, 0);
});

test('שורט ברצועה העליונה; נפתח מעל הרצועה → נכנסים במחיר הפתיחה; אין נגיעה חוזרת כשהנר הקודם נסגר מחוץ לרצועות', () => {
  const s = fresh(), b = band0();
  processAmit(s, [bar(20, 100.15, 100.16, 100.05, 100.08)]);
  assert.equal(s.pos.side, 'short'); assert.equal(s.pos.entry, 100.15); assert.ok(s.pos.sl > 100.15);
  const s2 = fresh();
  processAmit(s2, [bar(20, 100, 100, 99.4, 99.5)]); // נכנס ונעצר; הנר נסגר מתחת לרצועה
  assert.equal(s2.zone, 'below');
  assert.equal(processAmit(s2, [bar(21, 99.5, 99.6, 99.3, 99.45)]).events.length, 0, 'צריך קודם סגירה בתוך הרצועות');
  assert.ok(b.up > 100);
});

test('יציאה בזמן אחרי 60 דקות, בסגירת הנר', () => {
  const s = fresh();
  processAmit(s, [bar(20, 100, 100, 99.85, 99.88)]);
  assert.equal(s.pos.side, 'long');
  const drift = Array.from({ length: 60 }, (_, k) => { const c = 99.88 - 0.001 * (k + 1); return bar(21 + k, c, c, c, c); });
  const r = processAmit(s, drift);
  assert.equal(r.trades.length, 1);
  assert.equal(r.trades[0].why, 'זמן (60 דק׳)'); assert.equal(r.trades[0].mins, 60); assert.equal(r.trades[0].exit, 99.82);
  assert.equal(r.trades[0].close, iso(80));
});

test('לא מעבד שוב נר שכבר עובד; חימום לומד 20 סגירות בלי עסקאות', () => {
  const s = fresh();
  const bars = [bar(20, 100, 100, 99.85, 99.95), bar(21, 99.95, 100.02, 99.9, 100)];
  processAmit(s, bars);
  const snap = JSON.stringify(s);
  assert.equal(processAmit(s, bars).events.length, 0);
  assert.equal(JSON.stringify(s), snap);
  const w = warmAmit([...calm(40), bar(40, 100, 100, 98, 98)]);
  assert.equal(w.closes.length, 20); assert.equal(w.pos, null); assert.equal(w.trades.length, 0); assert.equal(w.last_t, iso(40));
});

test('amitUnrealized: עמלת כניסה מוגבלת + עמלת יציאה מיידית משוערת', () => {
  const pos = { side: 'long', entry: 100, qty: AMIT.notional / 100 };
  assert.ok(Math.abs(amitUnrealized(pos, 100) - -(AMIT.notional * (0.00014 + 0.00035))) < 1e-6);
  assert.equal(amitUnrealized(null, 100), null);
});

// מקור נרות דקה מדומה
function rows1m(endMs, n, fmt, shape = () => 0, amp = 0.0004){
  const out = [], last = Math.floor(endMs / 60e3) * 60e3;
  for (let i = n - 1; i >= 0; i--){
    const ms = last - i * 60e3, c = 75000 * (1 + amp * Math.sin(ms / 6e5) + shape(ms)), o = c * 0.9999, h = c * 1.0002, l = c * 0.9998;
    out.push(fmt === 'coinbase' ? [ms / 1000, l, h, o, c, 1] : [ms / 1000, String(o), String(h), String(l), String(c), '0', '1', 1]);
  }
  return fmt === 'coinbase' ? out.reverse() : out;
}
function mockFetch({ coinbase = true, kraken = true, calls = [], shape, amp } = {}, endMs){
  return async (url) => {
    url = String(url); calls.push(url);
    if (url.includes('coinbase')){ if (!coinbase) return new Response('x', { status: 403 }); assert.match(url, /BTC-USD\/candles\?granularity=60/); return Response.json(rows1m(endMs, 300, 'coinbase', shape, amp)); }
    if (url.includes('kraken')){ if (!kraken) return new Response('x', { status: 503 }); assert.match(url, /interval=1$/); return Response.json({ error: [], result: { XXBTZUSD: rows1m(endMs, 720, 'kraken', shape, amp), last: 1 } }); }
    throw new Error('unexpected ' + url);
  };
}
const NOW = Date.parse('2026-11-06T12:00:30Z'); // 14:00 בישראל

test('fetchBars1m: Coinbase, גיבוי Kraken, ונר הדקה הפתוח לא נכלל', async () => {
  const a = await fetchBars1m({ fetchFn: mockFetch({}, NOW), nowMs: NOW });
  assert.equal(a.feed, 'coinbase'); assert.equal(a.bars.length, 299); assert.equal(a.bars.at(-1)[0], '2026-11-06T11:59:00Z');
  const b = await fetchBars1m({ fetchFn: mockFetch({ coinbase: false }, NOW), nowMs: NOW });
  assert.equal(b.feed, 'kraken');
  const c = await fetchBars1m({ fetchFn: mockFetch({ coinbase: false, kraken: false }, NOW), nowMs: NOW });
  assert.equal(c.bars, null); assert.equal(c.errors.length, 2);
});

test('runAmitLive: חימום ושמירה; בלי נר חדש — בלי רשת; בלי אירוע — שומרים רק פעם בשעה; מקור נופל — לא נוגעים במצב', async () => {
  const db = new DB(null); let puts = 0; const put0 = db.put.bind(db); db.put = async (k, ...a) => { if (k === AMIT_KEY) puts++; return put0(k, ...a); };
  const ctx = { db, env: {} };
  const r1 = await runAmitLive(ctx, { fetchFn: mockFetch({ amp: 0 }, NOW), now: new Date(NOW) });
  assert.equal(r1.saved, true); assert.equal(puts, 1);
  const st = await db.get(AMIT_KEY);
  assert.equal(st.state.last_t, '2026-11-06T11:59:00Z'); assert.equal(st.state.trades.length, 0); assert.equal(st.source.feed, 'coinbase');
  const calls = [];
  assert.equal((await runAmitLive(ctx, { fetchFn: mockFetch({ calls, amp: 0 }, NOW), now: new Date(NOW + 20e3) })).skipped, 'no_new_bar');
  assert.equal(calls.length, 0);
  // שוק שטוח, 5 דקות אחרי: מעבדים אבל לא כותבים (אין אירוע, לא עברה שעה) — הריצה הבאה משחזרת מאותו מצב שמור
  const t5 = NOW + 5 * 60e3;
  const r3 = await runAmitLive(ctx, { fetchFn: mockFetch({ amp: 0 }, t5), now: new Date(t5) });
  assert.equal(r3.saved, false); assert.equal(puts, 1);
  const t61 = NOW + 61 * 60e3;
  const r4 = await runAmitLive(ctx, { fetchFn: mockFetch({ amp: 0 }, t61), now: new Date(t61) });
  assert.equal(r4.saved, true); assert.equal(puts, 2);
  const before = JSON.stringify(await db.get(AMIT_KEY));
  const r5 = await runAmitLive(ctx, { fetchFn: mockFetch({ coinbase: false, kraken: false, amp: 0 }, t61 + 300e3), now: new Date(t61 + 300e3) });
  assert.equal(r5.ok, false); assert.equal(JSON.stringify(await db.get(AMIT_KEY)), before);
});

test('runAmitLive: ירידה חדה → עסקה נשמרת מיד; התוצאה זהה גם בלי שמירות ביניים', async () => {
  // אחרי החימום: ב-12:20 המחיר צולל 0.5% לדקה אחת וחוזר — לונג, ואז יעד
  const drop = (ms) => (ms === Date.parse('2026-11-06T12:20:00Z') ? -0.005 : ms > Date.parse('2026-11-06T12:20:00Z') ? -0.0015 : 0);
  const db = new DB(null), ctx = { db, env: {} };
  await runAmitLive(ctx, { fetchFn: mockFetch({ shape: drop }, NOW), now: new Date(NOW) });
  const tA = Date.parse('2026-11-06T12:40:30Z');
  const r = await runAmitLive(ctx, { fetchFn: mockFetch({ shape: drop }, tA), now: new Date(tA) });
  assert.equal(r.saved, true); assert.ok(r.events >= 1);
  const s = (await db.get(AMIT_KEY)).state;
  assert.ok(s.trades.length >= 1 || s.pos, 'נפתחה עסקה');
  // אותו רצף בשתי ריצות (עם שמירה ביניים) = אותו מצב כמו בריצה אחת
  const db2 = new DB(null), ctx2 = { db: db2, env: {} };
  await runAmitLive(ctx2, { fetchFn: mockFetch({ shape: drop }, NOW), now: new Date(NOW) });
  const mid = Date.parse('2026-11-06T12:25:30Z');
  await runAmitLive(ctx2, { fetchFn: mockFetch({ shape: drop }, mid), now: new Date(mid), force: true });
  await runAmitLive(ctx2, { fetchFn: mockFetch({ shape: drop }, tA), now: new Date(tA), force: true });
  assert.equal(JSON.stringify((await db2.get(AMIT_KEY)).state), JSON.stringify(s));
});

test('סיכום טלגרם יומי אחד אחרי 21:00 בישראל', async () => {
  const db = new DB(null), sent = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { if (String(url).includes('api.telegram.org')){ sent.push(JSON.parse(opts.body).text); return new Response('{}'); } throw new Error('no net'); };
  try {
    const ctx = { db, env: { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' } };
    const e1 = Date.parse('2026-11-06T18:30:30Z'); // 20:30 בישראל
    await runAmitLive(ctx, { fetchFn: mockFetch({}, e1), now: new Date(e1) });
    assert.equal(sent.length, 0, 'החימום לא שולח');
    const e2 = Date.parse('2026-11-06T19:05:30Z'); // 21:05
    const r = await runAmitLive(ctx, { fetchFn: mockFetch({}, e2), now: new Date(e2) });
    assert.equal(r.telegram, 'ok'); assert.equal(sent.length, 1);
    assert.match(sent[0], /מסלול עמית — סיכום יום/); assert.match(sent[0], /בלי כסף אמיתי/);
    const e3 = Date.parse('2026-11-06T19:15:30Z');
    await runAmitLive(ctx, { fetchFn: mockFetch({}, e3), now: new Date(e3) });
    assert.equal(sent.length, 1, 'פעם אחת ביום');
  } finally { globalThis.fetch = orig; }
  assert.deepEqual(ilParts(Date.parse('2026-11-06T22:30:00Z')), { day: '2026-11-07', hour: 0 });
});

test('amitReport: ממתין; ואחרי עסקאות — סטטיסטיקה, אחוז הצלחה לאיזון, פוזיציה פתוחה', () => {
  const w = amitReport(null);
  assert.equal(w.waiting, true); assert.equal(w.equityUsd, AMIT.account); assert.equal(w.params.notionalUsd, 190000);
  const s = fresh();
  processAmit(s, [bar(20, 100, 100, 99.85, 99.95), bar(21, 99.95, 100.3, 99.9, 100.2)]); // יעד
  processAmit(s, [bar(22, 100.2, 100.2, 100.1, 100.15)]);
  const stored = { source: { feed: 'coinbase' }, meta: { gaps: 0 }, state: s };
  const r = amitReport(stored, { now: new Date(T0 + 23 * 60e3) });
  assert.equal(r.stats.trades, 1); assert.equal(r.stats.wins, 1); assert.equal(r.stats.breakevenWinRate, null);
  assert.ok(Math.abs(r.realizedUsd - s.agg.netUsd) < 1e-9);
  assert.equal(r.stale, false); assert.equal(r.trades[0].n, 1);
  assert.match(formatSummary(s, '2026-11-06'), /היום: 1 עסקאות, 1 הצלחות/);
});

test('POST /amit/run בלי אימות = 401; GET /amit = דוח ציבורי', async () => {
  const env = { CRON_SECRET: 'right', APP_TOKEN: 'tok' };
  const req = (path, method = 'GET') => worker.fetch(new Request('https://api.test' + path, { method, headers: { 'CF-Connecting-IP': '7.7.7.8' } }), env, {});
  assert.equal((await req('/amit/run', 'POST')).status, 401);
  assert.equal((await req('/amit/run?secret=wrong', 'POST')).status, 401);
  const g = await req('/amit');
  assert.equal(g.status, 200);
  const j = await g.json();
  assert.equal(j.track, 'amit'); assert.equal(j.paper, true);
});

test('מכסת כתיבות: עד 150 כתיבות של אירועים; השעתית ממשיכה; תקרה קשיחה של 180 לכל סוג כתיבה (גם force)', async () => {
  const db = new DB(null), ctx = { db, env: {} };
  const drop = (ms) => (ms === Date.parse('2026-11-06T12:20:00Z') ? -0.005 : ms > Date.parse('2026-11-06T12:20:00Z') ? -0.0015 : 0);
  await runAmitLive(ctx, { fetchFn: mockFetch({ shape: drop }, NOW), now: new Date(NOW) });
  const setMeta = async (m) => { const st = await db.get(AMIT_KEY); st.meta = { ...st.meta, ...m }; await db.put(AMIT_KEY, st); };
  // מכסת האירועים מלאה, השמירה האחרונה לפני 10 דקות: אירוע לא נשמר (ישוחזר מהמצב השמור בריצה הבאה)
  const tA = Date.parse('2026-11-06T12:40:30Z');
  await setMeta({ eventWrites: 150, writes: 150, savedAt: new Date(tA - 600e3).toISOString() });
  const r1 = await runAmitLive(ctx, { fetchFn: mockFetch({ shape: drop }, tA), now: new Date(tA) });
  assert.ok(r1.events >= 1); assert.equal(r1.saved, false); assert.equal(r1.capped, true);
  // אחרי שעה: השמירה השעתית עוקפת את מכסת האירועים — כולל העסקה מהריצה הקודמת
  const tB = tA + 3600e3;
  const r2 = await runAmitLive(ctx, { fetchFn: mockFetch({ shape: drop }, tB), now: new Date(tB) });
  assert.equal(r2.saved, true);
  const saved = await db.get(AMIT_KEY);
  assert.ok(saved.state.trades.length >= 1 || saved.state.pos, 'העסקה לא אבדה');
  // תקרה קשיחה: 180 כתיבות היום — לא כותבים גם בשעתית וגם ב-force
  await setMeta({ writes: 180, savedAt: new Date(tB - 2 * 3600e3).toISOString() });
  const tC = tB + 120e3;
  assert.equal((await runAmitLive(ctx, { fetchFn: mockFetch({ shape: drop }, tC), now: new Date(tC) })).saved, false);
  assert.equal((await runAmitLive(ctx, { fetchFn: mockFetch({ shape: drop }, tC), now: new Date(tC), force: true })).saved, false);
  assert.equal((await db.get(AMIT_KEY)).meta.writes, 180);
});

test('חור בנתונים (יותר מ-5 שעות בלי מצב שמור) נספר והדוח מסמן תוצאות חלקיות', async () => {
  const db = new DB(null), ctx = { db, env: {} };
  await runAmitLive(ctx, { fetchFn: mockFetch({ amp: 0 }, NOW), now: new Date(NOW) });
  const later = NOW + 8 * 3600e3;
  const r = await runAmitLive(ctx, { fetchFn: mockFetch({ amp: 0 }, later), now: new Date(later) });
  assert.equal(r.saved, true);
  const stored = await db.get(AMIT_KEY);
  assert.equal(stored.meta.gaps, 1);
  const rep = amitReport(stored, { now: new Date(later) });
  assert.equal(rep.partial, true); assert.equal(rep.gaps, 1);
});
