import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DB } from '../lib/db.js';
import { selectMechanical } from '../engine/mechanical.js';
import { estimateRevision, getEarnings } from '../lib/analysis.js';
import { isoDate, addDays } from '../engine/util.js';

const T = isoDate();

test('יקום מכני: S&P 500 → נזילות → מכסה ענפית פרופורציונלית → הגדולות בענף', () => {
  const members = [...Array(40)].map((_, i) => ({ symbol: 'S' + i, sector: i < 30 ? 'Technology' : 'Utilities' }));
  const liquidity = Object.fromEntries(members.map((m, i) => [m.symbol, { volume: i === 1 ? 10 : 2e6, marketCap: 1e9 * (40 - i) }]));
  const r = selectMechanical({ members, liquidity, cap: 12 });
  assert.equal(r.items.length, 12); assert.equal(r.liquid, 39, 'S1 נפל בנזילות');
  assert.equal(r.sectors.Utilities.selected, 3, 'ענף קטן מקבל את חלקו היחסי (עיגול למטה) — לא רק מגה-קאפ טכנולוגיה');
  assert.equal(r.sectors.Technology.selected, 9);
  assert.ok(!r.items.some((x) => x.symbol === 'S1'));
  assert.deepEqual(r.items.filter((x) => x.sector === 'Utilities').map((x) => x.symbol), ['S30', 'S31', 'S32'], 'בתוך הענף לפי שווי שוק');
  // בלי נתוני נזילות (screener נכשל): לא מסננים, מסמנים
  const r2 = selectMechanical({ members, liquidity: {}, cap: 12 });
  assert.equal(r2.liquidityKnown, false); assert.equal(r2.items.length, 12);
});

test('ריוויזיות: לא זמין עד שנצברים 30 יום; משווים לאותה שנת כספים; שנה שהתחלפה → epsFy2 הישן', async () => {
  const db = new DB(null);
  await db.put('esthist:AAA', [{ date: T, epsFy1: 5, epsFy2: 6, fy1Date: '2027-09-30', fy2Date: '2028-09-30' }]);
  let r = await estimateRevision(db, 'AAA');
  assert.equal(r.available, false); assert.match(r.reason, /היסטוריה של 0 ימים/); assert.equal(r.epsRevision, undefined, 'לא 0 ולא ערך מומצא');
  await db.put('esthist:AAA', [{ date: addDays(T, -35), epsFy1: 5, epsFy2: 6, fy1Date: '2027-09-30', fy2Date: '2028-09-30' }, { date: T, epsFy1: 5.5, epsFy2: 6.2, fy1Date: '2027-09-30', fy2Date: '2028-09-30' }]);
  r = await estimateRevision(db, 'AAA');
  assert.equal(r.available, true); assert.equal(r.epsRevision, 0.1); assert.equal(r.fy, '2027-09-30');
  // השנה התחלפה: FY1 היום (2028) היה FY2 לפני 35 יום → משווים ל-6, לא ל-5
  await db.put('esthist:AAA', [{ date: addDays(T, -35), epsFy1: 5, epsFy2: 6, fy1Date: '2027-09-30', fy2Date: '2028-09-30' }, { date: T, epsFy1: 6.3, epsFy2: 7, fy1Date: '2028-09-30', fy2Date: '2029-09-30' }]);
  r = await estimateRevision(db, 'AAA');
  assert.equal(r.available, true); assert.equal(r.epsRevision, 0.05);
  // אין אותה שנת כספים בכלל → לא זמין
  await db.put('esthist:AAA', [{ date: addDays(T, -35), epsFy1: 5, epsFy2: 6, fy1Date: '2026-09-30', fy2Date: '2027-09-30' }, { date: T, epsFy1: 6.3, epsFy2: 7, fy1Date: '2028-09-30', fy2Date: '2029-09-30' }]);
  r = await estimateRevision(db, 'AAA');
  assert.equal(r.available, false); assert.match(r.reason, /התחלפה/);
});

test('תאריך דוח: הלוח היומי גובר על המטמון הפרטני, ולוח טרי בלי החברה מבטל תאריך ישן בטווח', async () => {
  const db = new DB(null);
  const ctx = { db, env: {}, budget: { spend: async () => {} } };
  await db.put('earn:AAA', { next: addDays(T, 10), last: [{ date: '2026-06-01', surprisePct: 0.02 }], source: 'fmp', asOf: T, fetchedAt: new Date().toISOString() });
  await db.put('earn:BBB', { next: addDays(T, 12), last: [], source: 'fmp', asOf: T, fetchedAt: new Date().toISOString() });
  await db.put('earn:CCC', { next: addDays(T, 60), last: [], source: 'fmp', asOf: T, fetchedAt: new Date().toISOString() });
  await db.put('meta:earncal', { asOf: T, from: T, to: addDays(T, 21), byTicker: { AAA: { date: addDays(T, 11), time: 'amc' } } });
  const a = await getEarnings('AAA', ctx);
  assert.equal(a.next, addDays(T, 11)); assert.equal(a.source, 'fmp-calendar'); assert.equal(a.last.length, 1, 'הפתעות העבר נשמרות מהפרטני');
  const b = await getEarnings('BBB', ctx);
  assert.equal(b.next, null, 'הלוח לא מציג דוח בטווח → התאריך הישן בוטל'); assert.match(b.nextNote, /בוטל/);
  const c = await getEarnings('CCC', ctx);
  assert.equal(c.next, addDays(T, 60), 'תאריך מעבר לטווח הלוח נשאר');
  // לוח ישן (לפני 5 ימים) לא גובר
  await db.put('meta:earncal', { asOf: addDays(T, -5), from: addDays(T, -5), to: addDays(T, 16), byTicker: {} });
  assert.equal((await getEarnings('BBB', ctx)).next, addDays(T, 12));
});

test('POST /universe/refresh דורש אימות/סוד; בלי FMP_KEY מחזיר סיבה ולא נופל', async () => {
  const { installMockFetch } = await import('./mock-providers.mjs'); installMockFetch();
  const worker = (await import('../worker.js')).default;
  const store = new Map();
  const env = { INVEST: { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }) }, APP_TOKEN: 'secret', CRON_SECRET: 's3', STOOQ_ENABLED: '1' };
  const call = (path, h = {}) => worker.fetch(new Request('https://api.test' + path, { method: 'POST', headers: { 'CF-Connecting-IP': '9.9.9.9', ...h } }), env, { waitUntil(){} });
  assert.equal((await call('/universe/refresh')).status, 401);
  const r = await call('/universe/refresh?secret=s3'); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.universe.ok, false); assert.match(j.universe.reason, /FMP_KEY/); assert.equal(j.calendar.ok, false);
});
