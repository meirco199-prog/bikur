// בדיקת הבוט מקצה לקצה עם KV מדומה וטלגרם מדומה — מריצים: node test/test-worker.mjs
import worker from '../worker.js';

let passed = 0, failed = 0;
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
}

// KV מדומה
const kv = new Map();
const env = {
  BOT_TOKEN: 'TEST_TOKEN',
  SECRET: 's3cret',
  DATA: {
    get: async k => kv.get(k) ?? null,
    put: async (k, v) => { kv.set(k, v); },
  },
};

// טלגרם מדומה — תופס את כל ההודעות שהבוט שולח
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.telegram.org')) {
    if (String(url).includes('/sendMessage')) sent.push(JSON.parse(opts.body));
    return new Response('{"ok":true}', { status: 200 });
  }
  return realFetch(url, opts);
};

async function send(text, chatId = 111) {
  const req = new Request(`https://remi.example.workers.dev/webhook/${env.SECRET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { text, chat: { id: chatId } } }),
  });
  await worker.fetch(req, env);
  return sent[sent.length - 1];
}

console.log('זרימת שיחה:');
{
  const r = await send('/start');
  check('/start הופך לבעלים ומחזיר עזרה', r.chat_id === 111 && r.text.includes('רמי'));
}
{
  const r = await send('שלום', 999);
  check('משתמש זר נדחה', r.chat_id === 999 && r.text.includes('פרטי'));
}
{
  const r = await send('תזכיר לי בעוד דקה לבדוק תנור');
  check('קביעת תזכורת', r.text.includes('אזכיר לך'), r.text);
}
{
  const r = await send('משימה: לשלם ארנונה');
  check('הוספת משימה', r.text.includes('הוספתי'));
}
{
  const r = await send('משימות');
  check('רשימת משימות', r.text.includes('לשלם ארנונה'));
}
{
  const r = await send('סיימתי 1');
  check('סימון ביצוע', r.text.includes('✅'), r.text);
}
{
  const r = await send('קבע פגישה עם דני מחר ב-14:00');
  check('קביעת אירוע', r.text.includes('קבעתי'));
}
{
  const r = await send('מה יש לי מחר');
  check('סדר יום מחר כולל הפגישה', r.text.includes('דני'), r.text);
}

console.log('קרון (תזכורת שהגיע זמנה):');
{
  // מזיזים את התזכורת לעבר כדי שהקרון יתפוס אותה
  const S = JSON.parse(kv.get('store'));
  check('יש תזכורת אחת בהמתנה', S.reminders.length === 1);
  S.reminders[0].at = Date.now() - 60000;
  kv.set('store', JSON.stringify(S));

  const before = sent.length;
  await worker.scheduled({}, env);
  const fired = sent.slice(before);
  check('הקרון שלח את התזכורת', fired.some(m => m.text.includes('⏰ תזכורת: לבדוק תנור')), JSON.stringify(fired));

  const S2 = JSON.parse(kv.get('store'));
  check('תזכורת חד-פעמית נמחקה אחרי שנשלחה', S2.reminders.length === 0);
}
{
  await send('תזכיר לי כל יום ב-6 לקחת כדור');
  const S = JSON.parse(kv.get('store'));
  S.reminders[0].at = Date.now() - 60000;
  kv.set('store', JSON.stringify(S));
  await worker.scheduled({}, env);
  const S2 = JSON.parse(kv.get('store'));
  check('תזכורת יומית קודמה למחר במקום להימחק', S2.reminders.length === 1 && S2.reminders[0].at > Date.now());
}

console.log('setup:');
{
  const req = new Request(`https://remi.example.workers.dev/setup?secret=s3cret`);
  const res = await worker.fetch(req, env);
  const body = await res.text();
  check('חיבור webhook מחזיר הנחיה ל-/start', body.includes('/start'));
}
{
  const req = new Request(`https://remi.example.workers.dev/setup?secret=wrong`);
  const res = await worker.fetch(req, env);
  check('סוד שגוי נחסם', res.status === 403);
}

console.log(`\n${passed} עברו, ${failed} נכשלו`);
process.exit(failed ? 1 : 0);
