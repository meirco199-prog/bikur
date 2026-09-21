// AI_COUNCIL#13: 401/403 על סימבול אחד לא חוסם את ה-endpoint לכל היקום; 402 כן. Finnhub לא נקרא בכלל על .TA.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DB } from '../lib/db.js';
import { Budget } from '../lib/budget.js';
import { fetchWithFallback, providersFor } from '../providers/registry.js';
import { alphavantage } from '../providers/alphavantage.js';

const env = { FINNHUB_KEY: 'k', ALPHAVANTAGE_KEY: 'k' };
const mk = () => { const db = new DB(null); return { env, db, budget: new Budget(db) }; };
const rec = [{ period: '2026-09-01', strongBuy: 1, buy: 2, hold: 3, sell: 0, strongSell: 0 }];
const withFetch = async (handler, fn) => { const orig = globalThis.fetch; globalThis.fetch = handler; try { return await fn(); } finally { globalThis.fetch = orig; } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('registry: 403 (auth) על סימבול אחד חוסם רק אותו — הסימבול הבא עדיין נקרא', async () => {
  const ctx = mk(); const asked = [];
  await withFetch(async (url) => { const s = new URL(url).searchParams.get('symbol'); asked.push(s); return s === 'XBAD' ? new Response('forbidden', { status: 403 }) : json(rec); }, async () => {
    const bad = await fetchWithFallback('analyst', 'XBAD', {}, ctx, { only: ['finnhub'] });
    assert.ok(bad.missing); assert.equal(bad.tried[0].kind, 'auth');
    const good = await fetchWithFallback('analyst', 'GOOD', {}, ctx, { only: ['finnhub'] });
    assert.ok(!good.missing, JSON.stringify(good)); assert.equal(good.provider, 'finnhub');
    const again = await fetchWithFallback('analyst', 'XBAD', {}, ctx, { only: ['finnhub'] });
    assert.match(again.reason, /נבדק היום/, 'הסימבול שנכשל לא נקרא שוב');
  });
  assert.deepEqual(asked, ['XBAD', 'GOOD'], 'שתי קריאות בלבד: הכושלת לא חזרה על עצמה, התקינה לא נחסמה');
  assert.equal(await ctx.budget.blocked('finnhub', 'analyst'), false, 'אין חסימה גלובלית');
  assert.equal(await ctx.budget.blocked('finnhub', 'analyst', 'XBAD'), true);
});

test('registry: 402 (paid) חוסם את ה-endpoint לכל נייר, כמו קודם', async () => {
  const ctx = mk(); const asked = [];
  await withFetch(async (url) => { asked.push(new URL(url).searchParams.get('symbol')); return new Response('pay', { status: 402 }); }, async () => {
    const a = await fetchWithFallback('analyst', 'PAID', {}, ctx, { only: ['finnhub'] }); assert.equal(a.tried[0].kind, 'paid');
    const b = await fetchWithFallback('analyst', 'OTHER', {}, ctx, { only: ['finnhub'] }); assert.match(b.reason, /נבדק היום/);
  });
  assert.deepEqual(asked, ['PAID'], 'הנייר השני לא נקרא בכלל');
  assert.equal(await ctx.budget.blocked('finnhub', 'analyst'), true);
});

test('budget: חסימה פר-נייר נשמרת עם התקציב ולא זולגת לניירות/יכולות אחרים', async () => {
  const db = new DB(null); const b = new Budget(db);
  await b.block('finnhub', 'analyst', 'TEVA.TA'); await b.flush();
  const b2 = new Budget(db);
  assert.equal(await b2.blocked('finnhub', 'analyst', 'TEVA.TA'), true);
  assert.equal(await b2.blocked('finnhub', 'analyst', 'AAPL'), false);
  assert.equal(await b2.blocked('finnhub', 'analyst'), false);
  assert.equal(await b2.blocked('finnhub', 'profile', 'TEVA.TA'), false);
});

test('finnhub: לא מוצע בכלל ל-.TA ולמדדים (^), כן ל-BRK.B', () => {
  const ids = (sym) => providersFor('analyst', env, sym).map((p) => p.id);
  assert.ok(!ids('TEVA.TA').includes('finnhub'));
  assert.ok(!ids('^SPX').includes('finnhub'));
  assert.ok(ids('BRK.B').includes('finnhub'), 'נקודה בסימבול אמריקאי לא נחשבת בורסה זרה');
  assert.ok(ids('AAPL').includes('finnhub'));
});

test('alphavantage: מחירים מבקשים compact (full הוא premium בתוכנית החינמית)', async () => {
  const ctx = mk(); let seen = null;
  const r = await withFetch(async (url) => { seen = new URL(url); return json({ 'Time Series (Daily)': { '2026-09-18': { '1. open': '1', '2. high': '2', '3. low': '0.5', '4. close': '1.5', '5. volume': '100' } } }); },
    () => alphavantage.prices('AAPL', { from: '2015-01-01' }, ctx));
  assert.equal(seen.searchParams.get('outputsize'), 'compact', 'גם עם from ישן — full נכשל תמיד בחינם');
  assert.equal(r.rows.length, 1); assert.equal(r.source, 'alphavantage');
});
