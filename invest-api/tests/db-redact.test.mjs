// לוג השגיאות לא מכיל סודות: ספקים (למשל Alpha Vantage) מחזירים את מפתח ה-API בתוך הודעת השגיאה, והלוג מוצג ב-/health
// ובלוגים ציבוריים של GitHub Actions
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DB } from '../lib/db.js';
import worker from '../worker.js';

test('DB.logError מסתיר ערכי סוד ותבניות "API key as …" / ?apikey=…', async () => {
  const db = new DB(null, { secrets: ['ZZTESTKEY1234567', 'short'] });
  await db.logError('alphavantage.news(AAPL)', 'We have detected your API key as ZZTESTKEY1234567 and our standard API rate limit is 25 requests per day');
  await db.logError('x', 'HTTP 401 https://api.example.com/q?symbol=AAPL&apikey=ANOTHERKEY9876&x=1');
  await db.logError('y', 'api key: QWERTYUIOP12345 rejected');
  const log = await db.get('log:err');
  assert.equal(log.length, 3);
  for (const e of log){ assert.ok(!/ZZTESTKEY1234567|ANOTHERKEY9876|QWERTYUIOP12345/.test(e.msg), e.msg); }
  assert.match(log[0].msg, /API key as \*\*\*/); assert.match(log[1].msg, /apikey=\*\*\*&x=1/);
  // רשומות ישנות שנכתבו לפני ההסתרה — מוסתרות בקריאה
  const raw = await db.get('log:err'); raw.push({ ts: 'old', where: 'z', msg: 'legacy ZZTESTKEY1234567' }); await db.put('log:err', raw);
  const recent = await db.recentErrors(10); assert.ok(recent.every((e) => !e.msg.includes('ZZTESTKEY1234567')));
});

test('/health לא חושף מפתח שהופיע בהודעת שגיאה של ספק', async () => {
  const store = new Map();
  const kv = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async () => ({ keys: [], list_complete: true }) };
  const env = { INVEST: kv, ALPHAVANTAGE_KEY: 'AVKEY00000000001', APP_TOKEN: 'secret' };
  // רשומה "ישנה" ישירות ב-KV, כאילו נכתבה לפני התיקון
  store.set('log:err', JSON.stringify([{ ts: 'old', where: 'alphavantage.news(AAPL)', msg: 'We have detected your API key as AVKEY00000000001 and our standard API rate limit is 25 requests per day' }]));
  const r = await worker.fetch(new Request('https://api.test/health', { headers: { 'CF-Connecting-IP': '1.1.1.1' } }), env, { waitUntil(){} });
  const j = await r.json();
  assert.equal(j.recentErrors.length, 1);
  assert.ok(!JSON.stringify(j).includes('AVKEY00000000001'), 'המפתח דלף ל-/health');
});
