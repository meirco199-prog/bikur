// מחזור יומי מלא של הסוכן דרך ה-Worker, עם KV מדומה ומחירים שנזרעו במטמון (בלי רשת): ריצה ראשונה → החלטות; ריצה שנייה → מילוי
// בפתיחת היום הבא, שערוך, עצירות; דוח ציבורי; kill switch; אין look-ahead (החלטה בסגירת S, מילוי בפתיחת S+1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMockFetch } from './mock-providers.mjs';
import worker from '../worker.js';
import { AGENT_INSTRUMENTS, priceSymbolOf, instrumentOf } from '../engine/instruments.js';
import { agentPrices } from '../lib/agent.js';
import { lastSessionClose } from '../engine/session.js';
import { DB } from '../lib/db.js';
import { Budget } from '../lib/budget.js';

installMockFetch();
const store = new Map();
const env = { INVEST: { get: async (k, type) => (type === 'text' ? (store.has(k) ? store.get(k) : null) : (store.has(k) ? JSON.parse(store.get(k)) : null)), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix = '' } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) }, FINNHUB_KEY: 'x', APP_TOKEN: 'secret', CRON_SECRET: 'cron-secret-for-tests', RATE_LIMIT_OFF: '1' };
const call = (path, { method = 'GET', body, auth } = {}) => worker.fetch(new Request('https://api.test' + path, { method, headers: { 'CF-Connecting-IP': '9.9.9.9', 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer secret' } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil(){} }).then(async (r) => ({ status: r.status, j: await r.json() }));

// ימי מסחר: 300 ימי חול רצופים שמסתיימים ב-2026-09-22 (יום ג'), ועוד יום אחד (23/9) לסשן הבא
function tradingDays(n, endIso){ const out = []; const d = new Date(endIso + 'T00:00:00Z'); while (out.length < n){ if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); } return out; }
const DAYS = tradingDays(300, '2026-09-22'); const NEXT = '2026-09-23';
const mk = (f) => DAYS.map((d, i) => { const c = f(i); return [d, c * 0.999, c * 1.006, c * 0.994, c, 2e6]; });
const seedPrices = () => {
  const now = new Date().toISOString();
  for (const sym of new Set(AGENT_INSTRUMENTS.map(priceSymbolOf))){
    const h = [...sym].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 7;
    const f = sym === 'GLD' ? (i) => 250 * Math.exp(0.0016 * i) * (1 + 0.006 * Math.sin(i / 6)) // מגמה חזקה → לונג
      : sym === 'UNG' ? (i) => 30 * Math.exp(-0.0018 * i) * (1 + 0.006 * Math.sin(i / 6))       // ירידה → שורט
      : sym === 'SPY' ? (i) => 500 * (1 + 0.0003 * i)
      : (i) => 100 * (1 + 0.015 * Math.sin(i / (8 + h)));                                       // שטוח
    store.set(`px:${sym}`, JSON.stringify({ symbol: sym, currency: 'USD', source: 'seed', rows: mk(f), fetchedAt: now }));
  }
  store.set('fx:USDILS', JSON.stringify({ rate: 3.7, fetchedAt: now }));
};

test('סוכן: דוח לפני ריצה ראשונה, מדיניות ציבורית, ריצה דורשת סוד/טוקן', async () => {
  const r0 = await call('/agent/report'); assert.equal(r0.status, 200); assert.equal(r0.j.missing, true); assert.equal(r0.j.policy.mode, 'simulation'); assert.equal(r0.j.universe.count, AGENT_INSTRUMENTS.length);
  const pol = await call('/agent/policy'); assert.equal(pol.j.policy.shorting, true); assert.ok(pol.j.hash);
  assert.equal((await call('/agent/run', { method: 'POST' })).status, 401);
});

test('סוכן: יום 1 — תמחור, סריקה, פקודות למחר (לונג GLD, שורט UNG) בלי מילוי; יום 2 — מילוי בפתיחה, שערוך, דוח', async () => {
  seedPrices();
  const r1 = await call('/agent/run?secret=cron-secret-for-tests&date=2026-09-22&batch=12', { method: 'POST' });
  assert.equal(r1.status, 200, JSON.stringify(r1.j)); assert.equal(r1.j.phase, 'done', JSON.stringify(r1.j));
  assert.equal(r1.j.positions, 0, 'ביום ההחלטה אין מילוי'); assert.equal(r1.j.fills, 0);
  assert.ok(r1.j.scanned >= 40, 'נסרקו ' + r1.j.scanned);
  const ords = r1.j.ordersForTomorrow; const dbg = JSON.parse(store.get('agent:opps:2026-09-22')); assert.ok(ords.some((o) => /buy .* GLD/.test(o)), JSON.stringify({ ords, cands: dbg.candidates.slice(0, 6).map((c) => [c.symbol, c.strategy, c.side, c.score]), gate: dbg.gateLog.slice(0, 6), halt: dbg.halt })); assert.ok(ords.some((o) => /short .* UNG/.test(o)), JSON.stringify(ords));
  assert.ok(Math.abs(r1.j.equityUsd - 200000 / 3.7) < 1, 'הון התחלתי 200,000 ₪ בדולר');
  const again = await call('/agent/run?secret=cron-secret-for-tests&date=2026-09-22', { method: 'POST' }); assert.equal(again.j.phase, 'skipped');
  // יום 2: מוסיפים בר ל-23/9 (פתיחה = סגירה אתמול +0.2%)
  for (const sym of new Set(AGENT_INSTRUMENTS.map(priceSymbolOf))){ const v = JSON.parse(store.get(`px:${sym}`)); const last = v.rows[v.rows.length - 1]; const o = last[4] * 1.002; v.rows.push([NEXT, o, o * 1.004, o * 0.996, o * 1.001, 2e6]); store.set(`px:${sym}`, JSON.stringify(v)); }
  const r2 = await call('/agent/run?secret=cron-secret-for-tests&date=2026-09-23&batch=12', { method: 'POST' });
  assert.equal(r2.j.phase, 'done', JSON.stringify(r2.j)); assert.ok(r2.j.fills >= 2, 'מילויים: ' + r2.j.fills); assert.ok(r2.j.positions >= 2);
  const rep = await call('/agent/report'); const R = rep.j;
  assert.equal(R.day, NEXT); assert.ok(R.positions.find((p) => p.symbol === 'GLD' && p.side === 'long')); const ung = R.positions.find((p) => p.symbol === 'UNG'); assert.ok(ung && ung.side === 'short' && ung.qty < 0);
  assert.ok(R.leverage > 0 && R.leverage <= 3, 'מינוף ' + R.leverage); assert.ok(R.excessLiquidityUsd > 0); assert.equal(R.equity.length, 2);
  assert.ok(R.journal.some((j) => j.kind === 'fill' && j.symbol === 'GLD' && j.decidedDay === '2026-09-22'), 'המילוי מתועד עם יום ההחלטה');
  const f = R.journal.find((j) => j.kind === 'fill' && j.symbol === 'GLD'); const gldRows = JSON.parse(store.get('px:GLD')).rows; const open23 = gldRows[gldRows.length - 1][1];
  assert.ok(Math.abs(f.price / open23 - 1) < 0.001, `מילוי בפתיחת 23/9 (${open23}) עם slippage, לא בסגירת 22/9: ${f.price}`);
  assert.ok(R.opportunities && R.opportunities.candidates.length > 0); assert.ok(Array.isArray(R.opportunities.gateLog));
  assert.ok(R.positions.every((p) => p.stop !== null), 'לכל פוזיציה יש עצירה');
  const opps = await call('/agent/opportunities'); assert.equal(opps.j.day, NEXT);
});

test('סוכן: kill switch עוצר פקודות חדשות (גם סגירות), מופיע בדוח, וניתן לביטול', async () => {
  const k = await call('/agent/kill', { method: 'POST', body: { reason: 'בדיקה' }, auth: true }); assert.equal(k.j.killSwitch, true);
  assert.equal((await call('/agent/policy')).j.kill.reason, 'בדיקה');
  for (const sym of new Set(AGENT_INSTRUMENTS.map(priceSymbolOf))){ const v = JSON.parse(store.get(`px:${sym}`)); const last = v.rows[v.rows.length - 1]; v.rows.push(['2026-09-24', last[4], last[4] * 1.003, last[4] * 0.997, last[4] * 1.001, 2e6]); store.set(`px:${sym}`, JSON.stringify(v)); }
  store.set('agent:pending', JSON.stringify({ day: '2026-09-23', decidedAt: new Date().toISOString(), orders: [{ symbol: 'SPY', side: 'buy', qty: 5, price: 545, stop: 520, strategy: 'trend', score: 60, reason: 'בדיקה' }] })); // פקודה ממתינה שאמורה להידחות בשער בגלל ה-kill switch
  const r3 = await call('/agent/run?secret=cron-secret-for-tests&date=2026-09-24&batch=12', { method: 'POST' });
  assert.equal(r3.j.killSwitch, true, JSON.stringify(r3.j).slice(0, 600)); assert.equal(r3.j.ordersForTomorrow.length, 0, 'אין פקודות חדשות'); assert.equal(r3.j.fills, 0, 'הפקודות שהיו ממתינות נדחו בשער');
  const rep = await call('/agent/report'); assert.equal(rep.j.policy.killSwitch, true); assert.ok(rep.j.journal.some((j) => j.kind === 'reject' && /kill switch/.test(j.reasons.join())));
  const off = await call('/agent/kill?on=0', { method: 'POST', auth: true }); assert.equal(off.j.killSwitch, false);
  assert.equal((await call('/agent/report')).j.policy.killSwitch, false);
});

// USO/BNO 23/9: מישהו אחר במערכת רענן את px:USO לפני הסגירה → המטמון "טרי" (20 שעות) בלי הסגירה של אתמול → הסוכן נחסם בשער ליום שלם.
// עכשיו: סדרה שלא מכסה את הסשן האחרון פוקעת אחרי 30 דקות (כמו getPrices); מטמון צעיר מ-30 דקות לא נמשך שוב (מכסת הספק)
test('סוכן: מטמון מחירים בלי הסגירה האחרונה מתרענן אחרי 30 דקות, לא לפני', async () => {
  const db = new DB(null); const ctx = { db, env: { STOOQ_ENABLED: '1' }, budget: new Budget(db) };
  const last = lastSessionClose().date;
  const stale = tradingDays(60, last).slice(0, -2).map((d, i) => [d, 100 + i, 101 + i, 99 + i, 100.5 + i, 1e6]); // נגמרת שני סשנים לפני הסגירה האחרונה
  await db.put('px:USO', { symbol: 'USO', currency: 'USD', source: 'seed', rows: stale, fetchedAt: new Date(Date.now() - 5 * 60000).toISOString() });
  const young = await agentPrices(instrumentOf('USO'), ctx);
  assert.equal(young.rows[young.rows.length - 1][0], stale[stale.length - 1][0], 'מטמון בן 5 דקות לא נמשך שוב');
  await db.put('px:USO', { ...(await db.get('px:USO')), fetchedAt: new Date(Date.now() - 2 * 3600000).toISOString() });
  const fresh = await agentPrices(instrumentOf('USO'), ctx);
  assert.ok(fresh.rows[fresh.rows.length - 1][0] >= last, `אחרי שעתיים הסדרה נמשכה שוב ומכסה את ${last}: ${fresh.rows[fresh.rows.length - 1][0]}`);
  assert.ok(fresh.rows.length > stale.length, 'השורות הישנות נשמרו (merge) ונוספו חדשות');
});
