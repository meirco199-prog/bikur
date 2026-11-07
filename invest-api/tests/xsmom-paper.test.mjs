// מעקב Paper למומנטום בין מטבעות: בחירה (מסנן BTC/ממוצע 200, 3 החזקים, רק חיוביים), שערוך יומי, החלפה רק בסגירת יום ראשון,
// עלויות, אימות הדוח ב-Worker ושורות בסיכום היומי
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XS, picks, step } from '../engine/xsmom-paper.js';
import { cleanPaper, paperLines, XSPAPER_KEY } from '../lib/xsmom-paper.js';
import { formatSummary } from '../lib/amit-live.js';

const DAY = 86400e3, D0 = Date.parse('2026-01-04T00:00:00Z'); // יום ראשון
// 260 ימים: BTC עולה (מעל ממוצע 200), A/B/C עולים בקצבים שונים, D יורד
const series = (n, f) => Array.from({ length: n }, (_, i) => ({ t: D0 + i * DAY, c: f(i) }));
const mk = (n = 260, btc = (i) => 100 * 1.002 ** i) => ({ BTC: series(n, btc), ETH: series(n, (i) => 50 * 1.001 ** i), SOL: series(n, (i) => 10 * 1.004 ** i), ADA: series(n, (i) => 1 * 1.003 ** i), DOGE: series(n, (i) => 1 * 0.995 ** i) });

test('picks: 3 החזקים לפי 14 יום, רק תשואה חיובית; BTC מתחת לממוצע 200 → מזומן', () => {
  const c = mk(), d = D0 + 259 * DAY, p = picks(c, d);
  assert.equal(p.filterOn, false); assert.deepEqual(p.chosen.map((x) => x.coin), ['SOL', 'ADA', 'BTC']);
  assert.ok(p.chosen.every((x) => x.ret > 0));
  const down = mk(260, (i) => (i < 240 ? 100 : 60)), p2 = picks(down, d);
  assert.equal(p2.filterOn, true); assert.equal(p2.chosen.length, 0);
});

test('step: התחלה = היום הסגור האחרון בלבד (בלי שחזור עבר), הקצאה מיד, עלות כניסה', () => {
  const c = mk(), { state, events, processed } = step(null, c);
  assert.equal(processed, 1); assert.equal(events.length, 1); assert.equal(state.startDay, new Date(D0 + 259 * DAY).toISOString().slice(0, 10));
  assert.deepEqual(Object.keys(state.weights).sort(), ['ADA', 'BTC', 'SOL']);
  const cost = (1 / 3) * (XS.spotBps + 5) / 1e4 * 2 + (1 / 3) * (XS.spotBps + 2) / 1e4; // SOL+ADA החלקה 5, BTC 2
  assert.ok(Math.abs(state.equity - XS.startUsd * (1 - cost)) < 0.01);
});

test('step: שערוך יומי לפי המשקלות; החלפה רק בסגירת יום ראשון (UTC)', () => {
  const c = mk(262), first = step(null, { ...Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.slice(0, 260)])) });
  // D0 = ראשון, יום 259 = ראשון (ההתחלה); ימים 260–261 = שני–שלישי: שערוך בלבד, בלי החלפה
  const { state, events } = step(first.state, c);
  assert.equal(events.length, 0, 'שני ושלישי — אין החלפה');
  const w = first.state.weights, r = Object.entries(w).reduce((s, [k, x]) => s + x * (c[k][261].c / c[k][259].c - 1), 0);
  assert.ok(Math.abs(state.equity - first.state.equity * (1 + r)) / state.equity < 1e-3);
  const c2 = mk(267), { events: e2 } = step(state, c2); // עד יום 266 = ראשון
  assert.equal(e2.length, 1); assert.equal(new Date(Date.parse(e2[0].day)).getUTCDay(), 0);
});

test('cleanPaper / paperLines / formatSummary: אימות, שורות בסיכום היומי, בוט שנעצר ידנית בלי אזהרת "לא רץ"', () => {
  const { state } = step(null, mk());
  assert.throws(() => cleanPaper({ ...state, id: 'x' }), /לא תקין/);
  const rep = { ...cleanPaper(state), receivedAt: new Date().toISOString() };
  const lines = paperLines(rep).join('\n');
  assert.match(lines, /מעקב Paper/); assert.match(lines, /מחזיק: SOL, ADA, BTC/);
  const s = { trades: [], agg: { n: 0, wins: 0, netUsd: 0, feesUsd: 0 }, pos: null };
  const bot1 = { today: { n: 0, wins: 0, netUsd: 0 }, total: { n: 4, wins: 2, netUsd: -240 }, halt: 'stop', receivedAt: new Date(Date.now() - 30 * 3600e3).toISOString() };
  const txt = formatSummary(s, '2026-11-08', null, bot1, Date.now(), null, rep);
  assert.match(txt, /מעקב Paper/); assert.doesNotMatch(txt, /כנראה לא רץ/); assert.match(txt, /עצור ידנית/);
});

test('POST /xsmom: בלי סוד = 401; עם סוד ה-cron = נשמר; GET /xsmom מחזיר את המצב', async () => {
  const { state } = step(null, mk());
  const { default: worker } = await import('../worker.js');
  const store = new Map(), kv = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async () => ({ keys: [] }) };
  const env = { CRON_SECRET: 'c', INVEST: kv, APP_TOKEN: 't' };
  const post = (q) => worker.fetch(new Request(`https://x/xsmom${q}`, { method: 'POST', body: JSON.stringify(state), headers: { 'Content-Type': 'application/json' } }), env, {});
  assert.equal((await post('')).status, 401);
  assert.equal((await post('?secret=c')).status, 200);
  const g = await (await worker.fetch(new Request('https://x/xsmom'), env, {})).json();
  assert.equal(g.id, 'XS14-top3-f200'); assert.ok(store.has(XSPAPER_KEY) || g.equity > 0);
});
