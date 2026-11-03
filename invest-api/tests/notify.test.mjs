// ערוץ ישיר מ-Claude לטלגרם (Issue #196): POST /notify (אימות, ולידציה, not_configured, שליחה, dedupe),
// sendTelegram המשותף להתראות (התנהגות ההתראות לא השתנתה), והסקריפט של ה-workflow (סינון תגובות, חילוץ טקסט).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { sendTelegram, send as sendAlert, telegramVia, REMI_MAX } from '../lib/alerts.js';
import { cleanText, NOTIFY_MAX, NOTIFY_PREFIX, NOTIFY_DEDUPE_TTL } from '../lib/notify.js';
import { MARKER, isTrustedNotifyComment, extractText, postNotify } from '../scripts/notify-meir.mjs';

function mkEnv(extra = {}){
  const store = new Map(), ttls = new Map(); let puts = 0;
  return { store, ttls, puts: () => puts, env: { INVEST: { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v, o) => { puts++; store.set(k, v); ttls.set(k, o?.expirationTtl); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }) }, APP_TOKEN: 'secret', CRON_SECRET: 's3', ...extra } };
}
const TG = { TELEGRAM_BOT_TOKEN: 'bot-token-123456', TELEGRAM_CHAT_ID: '4242' };
const req = (env, path, body, method = 'POST') => worker.fetch(new Request('https://api.test' + path, { method, headers: { 'CF-Connecting-IP': '8.8.4.4', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), env, {});
async function withFetch(handler, fn){
  const orig = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, opts) => { calls.push({ url: String(url), opts }); return handler(String(url), opts); };
  try { return await fn(calls); } finally { globalThis.fetch = orig; }
}
const okTg = () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });

test('POST /notify: בלי סוד / סוד שגוי → 401, GET → 405', async () => {
  const { env } = mkEnv(TG);
  assert.equal((await req(env, '/notify', { text: 'x' })).status, 401);
  assert.equal((await req(env, '/notify?secret=wrong', { text: 'x' })).status, 401);
  assert.equal((await req(env, '/notify', undefined, 'GET')).status, 405);
});

test('POST /notify: גוף לא תקין → 400 (בלי שליחה)', async () => {
  const { env } = mkEnv(TG);
  await withFetch(okTg, async (calls) => {
    for (const b of [{}, { text: 5 }, { text: '' }, { text: '  \u0001\u0002  ' }, { text: 'a'.repeat(NOTIFY_MAX + 1) }, 'not json']){
      const r = await req(env, '/notify?secret=s3', b);
      assert.equal(r.status, 400, JSON.stringify(b).slice(0, 40));
    }
    assert.equal(calls.length, 0);
  });
});

test('POST /notify: טלגרם לא מוגדר → not_configured, בלי fetch ובלי כתיבה ל-KV', async () => {
  const { env, puts } = mkEnv();
  await withFetch(okTg, async (calls) => {
    const r = await req(env, '/notify?secret=s3', { text: 'בדיקה' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: false, telegram: 'not_configured' });
    assert.equal(calls.length, 0);
    assert.equal(puts(), 0);
  });
});

test('POST /notify: שליחה מוצלחת — טקסט מנוקה, chat id נכון, אותו טקסט בתוך 10 דקות נשלח פעם אחת', async () => {
  const { env, store, ttls } = mkEnv(TG);
  await withFetch(okTg, async (calls) => {
    const r1 = await (await req(env, '/notify?secret=s3', { text: '  שלום\r\nמאיר\u0007  ' })).json();
    assert.deepEqual(r1, { ok: true, telegram: 'ok' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.telegram.org/botbot-token-123456/sendMessage');
    const sent = JSON.parse(calls[0].opts.body);
    assert.equal(sent.chat_id, '4242');
    assert.equal(sent.text, NOTIFY_PREFIX + 'שלום\nמאיר');
    const key = [...store.keys()].find((k) => k.startsWith('notify:dedupe:'));
    assert.ok(key); assert.equal(ttls.get(key), NOTIFY_DEDUPE_TTL);
    const r2 = await (await req(env, '/notify?secret=s3', { text: 'שלום\nמאיר' })).json();
    assert.equal(r2.telegram, 'skipped_duplicate'); assert.equal(r2.duplicate, true);
    assert.equal(calls.length, 1, 'כפילות לא נשלחת');
    const r3 = await (await req(env, '/notify?secret=s3', { text: 'הודעה אחרת' })).json();
    assert.equal(r3.telegram, 'ok'); assert.equal(calls.length, 2);
  });
});

test('POST /notify: שגיאת טלגרם → error <status>, לא נרשם dedupe (ניסיון חוזר מותר); טוקן האפליקציה מתקבל', async () => {
  const { env, store } = mkEnv(TG);
  await withFetch(() => new Response('{}', { status: 403 }), async (calls) => {
    const r = await worker.fetch(new Request('https://api.test/notify', { method: 'POST', headers: { 'CF-Connecting-IP': '8.8.4.5', 'Content-Type': 'application/json', Authorization: 'Bearer secret' }, body: JSON.stringify({ text: 'x' }) }), env, {});
    assert.deepEqual(await r.json(), { ok: false, telegram: 'error 403' });
    assert.equal([...store.keys()].filter((k) => k.startsWith('notify:dedupe:')).length, 0);
    await req(env, '/notify?secret=s3', { text: 'x' });
    assert.equal(calls.length, 2);
  });
});

test('sendTelegram: הטוקן לא דולף בהודעת שגיאה; ההתראות שומרות על אותה התנהגות', async () => {
  assert.equal(await sendTelegram({}, 'x'), 'not_configured');
  await withFetch(() => { throw new Error('connect failed https://api.telegram.org/botbot-token-123456/sendMessage'); }, async () => {
    const r = await sendTelegram(TG, 'x');
    assert.match(r, /^error /); assert.ok(!r.includes(TG.TELEGRAM_BOT_TOKEN));
  });
  const alert = { ts: '2026-11-03T06:00:00.000Z', symbol: 'TEST', type: 'test', label: 'בדיקה', what: 'w', why: 'y', changed: 'c' };
  assert.deepEqual(await sendAlert({ env: {} }, alert, ['telegram']), { browser: 'stored', telegram: 'לא מוגדר (TELEGRAM_BOT_TOKEN/CHAT_ID)' });
  await withFetch(okTg, async (calls) => {
    assert.deepEqual(await sendAlert({ env: TG }, alert, ['browser', 'telegram']), { browser: 'stored', telegram: 'ok' });
    assert.ok(JSON.parse(calls[0].opts.body).text.startsWith('🔔 בדיקה — TEST'));
  });
  assert.equal(cleanText('a\u0000b\tc\u009f'), 'ab\tc');
});

test('notify-meir.mjs: רק תגובה של בעל הריפו עם הסמן בתחילתה', () => {
  const c = (body, extra = {}) => ({ body, user: { login: 'meirco199-prog', type: 'User' }, author_association: 'OWNER', ...extra });
  assert.equal(isTrustedNotifyComment(c(`${MARKER}\nשלום`), 'meirco199-prog'), true);
  assert.equal(isTrustedNotifyComment(c(`שלום ${MARKER}`), 'meirco199-prog'), false, 'הסמן חייב להיות בהתחלה');
  assert.equal(isTrustedNotifyComment(c(`${MARKER}\nx`, { user: { login: 'someone' } }), 'meirco199-prog'), false);
  assert.equal(isTrustedNotifyComment(c(`${MARKER}\nx`, { author_association: 'CONTRIBUTOR' }), 'meirco199-prog'), false);
  assert.equal(isTrustedNotifyComment(c(`${MARKER}\nx`, { user: { login: 'meirco199-prog', type: 'Bot' } }), 'meirco199-prog'), false);
  assert.equal(isTrustedNotifyComment(c(`${MARKER}\nx`), ''), false);
  assert.equal(isTrustedNotifyComment(null, 'meirco199-prog'), false);
});

test('notify-meir.mjs: חילוץ הטקסט — בלי הסמן ובלי חתימת Claude Code', () => {
  assert.equal(extractText(`${MARKER}\nבדיקה: ערוץ ההתראות הישיר מ-Claude לטלגרם עובד.\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_\n`), 'בדיקה: ערוץ ההתראות הישיר מ-Claude לטלגרם עובד.');
  assert.equal(extractText(`${MARKER}\r\nשורה 1\r\n\r\n---\r\nשורה 2`), 'שורה 1\n\n---\nשורה 2', 'קו מפריד באמצע ההודעה נשאר');
  assert.equal(extractText(`${MARKER} טקסט באותה שורה`), 'טקסט באותה שורה');
  assert.equal(extractText(`${MARKER}\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_`), '');
});

test('notify-meir.mjs: postNotify שולח {text} עם הסוד ומחזיר את תשובת ה-Worker', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return new Response(JSON.stringify({ ok: true, telegram: 'ok' }), { status: 200 }); };
  const r = await postNotify({ workerUrl: 'https://w.test/', secret: 'a b', text: 'שלום', fetchImpl });
  assert.deepEqual(r, { ok: true, telegram: 'ok' });
  assert.equal(calls[0].url, 'https://w.test/notify?secret=a%20b');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { text: 'שלום' });
  await assert.rejects(postNotify({ workerUrl: 'https://w.test', secret: 's', text: 'x', fetchImpl: async () => new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }) }), /notify 401: unauthorized/);
});

// מסלול העוזר האישי: בלי TELEGRAM_* אבל עם service binding בשם REMI → POST https://remi-internal/notify
function mkRemi(handler = () => new Response(JSON.stringify({ ok: true }), { status: 200 })){
  const calls = [];
  return { calls, REMI: { fetch: async (url, opts) => { calls.push({ url: String(url), opts }); return handler(String(url), opts); } } };
}

test('sendTelegram: בלי TELEGRAM_* ועם REMI — נשלח דרך רמי (plain, בלי fetch ציבורי); TELEGRAM_* גובר', async () => {
  const remi = mkRemi();
  await withFetch(okTg, async (calls) => {
    assert.equal(telegramVia({ REMI: remi.REMI }), 'remi');
    assert.equal(await sendTelegram({ REMI: remi.REMI }, 'שלום'), 'ok');
    assert.equal(remi.calls.length, 1);
    assert.equal(remi.calls[0].url, 'https://remi-internal/notify');
    assert.equal(remi.calls[0].opts.method, 'POST');
    assert.deepEqual(JSON.parse(remi.calls[0].opts.body), { text: 'שלום', plain: true });
    await sendTelegram({ REMI: remi.REMI }, 'x'.repeat(REMI_MAX + 50));
    assert.equal(JSON.parse(remi.calls[1].opts.body).text.length, REMI_MAX, 'נחתך לתקרה של רמי');
    assert.equal(calls.length, 0, 'אין קריאה ישירה ל-api.telegram.org');
    assert.equal(telegramVia({ ...TG, REMI: remi.REMI }), 'direct');
    assert.equal(await sendTelegram({ ...TG, REMI: remi.REMI }, 'y'), 'ok');
    assert.equal(calls.length, 1); assert.equal(remi.calls.length, 2, 'TELEGRAM_* מוגדרים → רמי לא נקרא');
  });
  assert.equal(telegramVia({ REMI: {} }), null, 'binding בלי fetch לא נחשב');
});

test('sendTelegram דרך רמי: no_owner / שגיאת רשת → error …', async () => {
  const noOwner = mkRemi(() => new Response(JSON.stringify({ error: 'no_owner' }), { status: 503 }));
  assert.equal(await sendTelegram({ REMI: noOwner.REMI }, 'x'), 'error 503 no_owner');
  const broken = mkRemi(() => { throw new Error('service unavailable'); });
  assert.equal(await sendTelegram({ REMI: broken.REMI }, 'x'), 'error remi: service unavailable');
});

test('POST /notify ו-/health דרך רמי: telegram ok, כותרת אחת בלבד, health מדווח telegramVia=remi; ההתראות עוברות דרך רמי', async () => {
  const remi = mkRemi();
  const { env } = mkEnv({ REMI: remi.REMI });
  const r = await (await req(env, '/notify?secret=s3', { text: 'בדיקה: ערוץ ההתראות הישיר מ-Claude לטלגרם עובד ✅' })).json();
  assert.deepEqual(r, { ok: true, telegram: 'ok' });
  assert.deepEqual(JSON.parse(remi.calls[0].opts.body), { text: NOTIFY_PREFIX + 'בדיקה: ערוץ ההתראות הישיר מ-Claude לטלגרם עובד ✅', plain: true });
  const h = await (await req(env, '/health', undefined, 'GET')).json();
  assert.equal(h.alerts.telegram, true); assert.equal(h.alerts.telegramVia, 'remi');
  const h0 = await (await req(mkEnv().env, '/health', undefined, 'GET')).json();
  assert.equal(h0.alerts.telegram, false); assert.equal(h0.alerts.telegramVia, null);
  const alert = { ts: '2026-11-03T06:00:00.000Z', symbol: 'TEST', type: 'test', label: 'בדיקה', what: 'w', why: 'y', changed: 'c' };
  assert.deepEqual(await sendAlert({ env: { REMI: remi.REMI } }, alert, ['telegram']), { browser: 'stored', telegram: 'ok' });
  assert.ok(JSON.parse(remi.calls[1].opts.body).text.startsWith('🔔 בדיקה — TEST'));
});
