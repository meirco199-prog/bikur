// מעבדה — נקודת הקצה POST /lab/parse ב-Worker: ללא AI → מפענח חוקים; עם Anthropic שמחזיר טקסט לא-JSON → נפילה גלויה למפענח; קלט קצר → 400.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMockFetch, calls } from './mock-providers.mjs';
import worker from '../worker.js';
installMockFetch();
const store = new Map();
const KV = { get: async (k, type) => (type === 'text' ? (store.has(k) ? store.get(k) : null) : (store.has(k) ? JSON.parse(store.get(k)) : null)), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
const env = { INVEST: KV, APP_TOKEN: 'secret' };
const post = async (body, e = env, ip = '7.7.7.7') => { const r = await worker.fetch(new Request('https://api.test/lab/parse', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify(body) }), e, { waitUntil(){} }); return { status: r.status, j: await r.json() }; };

test('/lab/parse ללא AI: מפענח החוקים מחזיר spec תקין + הסבר + סיבת נפילה גלויה', async () => {
  const { status, j } = await post({ text: 'קח את 10 המניות שירדו הכי הרבה אתמול, קנה בפתיחה, מכור בסוף אותו יום, השקע 50,000 דולר' });
  assert.equal(status, 200); assert.equal(j.parser, 'rules'); assert.equal(j.provider, 'rules');
  assert.equal(j.spec.signal.rank.top, 10); assert.equal(j.spec.entry.timing, 'next_open'); assert.equal(j.spec.sizing.capital, 50000); assert.equal(j.explanation.length, 7);
  assert.match(j.fallbackReason, /לא מוגדרת/);
});
test('/lab/parse עם Anthropic שמחזיר טקסט שאינו JSON → נפילה למפענח המקומי עם הסבר; הקריאה ל-API התבצעה', async () => {
  const { status, j } = await post({ text: 'Buy the 5 biggest gainers of the last 3 days at the open, sell after 2 days, $20,000' }, { ...env, ANTHROPIC_API_KEY: 'k' }, '7.7.7.8');
  assert.equal(status, 200); assert.ok(calls.some((u) => u.includes('api.anthropic.com')));
  assert.equal(j.parser, 'rules'); assert.equal(j.provider, 'anthropic'); assert.match(j.fallbackReason, /לא היה תקין/);
  assert.equal(j.spec.signal.rank.order, 'desc'); assert.equal(j.spec.signal.rank.params.days, 3);
});
test('/lab/parse: קלט קצר → 400 בעברית; GET → 404', async () => {
  const { status, j } = await post({ text: 'קנה' }); assert.equal(status, 400); assert.match(j.error, /תאר/);
  const r = await worker.fetch(new Request('https://api.test/lab/parse', { headers: { 'CF-Connecting-IP': '7.7.7.9' } }), env, { waitUntil(){} }); assert.equal(r.status, 404);
});
