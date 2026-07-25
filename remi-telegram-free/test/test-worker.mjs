// בדיקת הבוט מקצה לקצה עם KV מדומה וטלגרם מדומה — מריצים: node test/test-worker.mjs
import worker, { parseICS, parseWhen, parseCommand } from '../worker.js';

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
  const u = String(url);
  if (u.includes('api.telegram.org')) {
    if (/\/(sendMessage|sendPhoto|sendDocument)$/.test(u) && opts?.body) sent.push(JSON.parse(opts.body));
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

console.log('פיצ\'רים חדשים:');
{
  const r = await send('קניות: חלב, לחם, ביצים');
  check('רשימת קניות — 3 פריטים בבת אחת', r.text.includes('3 פריטים') && r.text.includes('ביצים'), r.text);
}
{
  const r = await send('קניתי 2');
  check('קניתי מוריד פריט', r.text.includes('לחם') && r.text.includes('נשארו 2'), r.text);
}
{
  const r = await send('זכור: רעיון למתנה לאמא — צמח');
  check('שמירת זיכרון', r.text.includes('שמרתי בזיכרון'), r.text);
}
{
  const r = await send('חפש מתנה');
  check('חיפוש מוצא זיכרון', r.text.includes('צמח'), r.text);
}
{
  const r = await send('זיכרונות');
  check('רשימת זיכרונות', r.text.includes('רעיון למתנה'), r.text);
}
{
  const r = await send('תזכיר לי כל יום ראשון ב-18:00 להוציא זבל');
  check('תזכורת שבועית', r.text.includes('כל יום ראשון'), r.text);
  const S = JSON.parse(kv.get('store'));
  const weekly = S.reminders.find(x => x.recurringWeekly === 0);
  check('  נשמרה עם היום הנכון', !!weekly && new Date(weekly.at).getDay() === 0);
}
{
  const r = await send('מחר ב-16:00 תור לרופא שיניים');
  check('נתב כוונות: טקסט חופשי עם זמן → תזכורת', r.text.includes('הבנתי לבד') && r.text.includes('תור לרופא'), r.text);
}
{
  const r = await send('סיכום שבוע');
  check('סיכום שבוע', r.text.includes('📊') && r.text.includes('משימות הושלמו'), r.text);
}

console.log('קרון (תזכורת שהגיע זמנה + דחייה):');
{
  const S = JSON.parse(kv.get('store'));
  const oneTime = S.reminders.find(x => x.text.includes('תנור'));
  oneTime.at = Date.now() - 60000;
  kv.set('store', JSON.stringify(S));

  const before = sent.length;
  await worker.scheduled({}, env);
  const fired = sent.slice(before);
  check('הקרון שלח את התזכורת', fired.some(m => m.text.includes('⏰ תזכורת: לבדוק תנור')), JSON.stringify(fired));

  const S2 = JSON.parse(kv.get('store'));
  check('תזכורת חד-פעמית נמחקה אחרי שנשלחה', !S2.reminders.some(x => x.text.includes('תנור')));
  check('נרשמה בסטטיסטיקה', (S2.stats.fired || []).length >= 1);
}
{
  const r = await send('דחה 15');
  check('דחיית התזכורת האחרונה', r.text.includes('15 דקות') && r.text.includes('תנור'), r.text);
}
{
  await send('תזכיר לי כל יום ב-6 לקחת כדור');
  const S = JSON.parse(kv.get('store'));
  const daily = S.reminders.find(x => x.recurringDaily);
  daily.at = Date.now() - 60000;
  kv.set('store', JSON.stringify(S));
  await worker.scheduled({}, env);
  const S2 = JSON.parse(kv.get('store'));
  const daily2 = S2.reminders.find(x => x.recurringDaily);
  check('תזכורת יומית קודמה למחר במקום להימחק', !!daily2 && daily2.at > Date.now());
}

console.log('יומן גוגל (ICS):');
{
  const now = new Date(2026, 6, 25, 7, 0); // שבת 25/7/2026
  const from = new Date(2026, 6, 25).getTime(), to = from + 86400000;
  const ics = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:one@test',
    'DTSTART;TZID=Asia/Jerusalem:20260725T103000',
    'SUMMARY:פגישה עם רואה חשבון',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:two@test',
    'DTSTART;TZID=Asia/Jerusalem:20260720T090000',
    'RRULE:FREQ=WEEKLY;BYDAY=SA',
    'SUMMARY:חוג שחייה',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:three@test',
    'DTSTART;VALUE=DATE:20260725',
    'SUMMARY:יום הולדת לסבתא',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:four@test',
    'DTSTART;TZID=Asia/Jerusalem:20260726T120000',
    'SUMMARY:לא היום — מחר',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const events = parseICS(ics, from, to);
  check('אירוע רגיל נמצא', events.some(e => e.text.includes('רואה חשבון') && new Date(e.at).getHours() === 10));
  check('אירוע שבועי (RRULE) הורחב לשבת', events.some(e => e.text.includes('שחייה')));
  check('אירוע יום-שלם נמצא', events.some(e => e.text.includes('סבתא') && e.allDay));
  check('אירוע של מחר לא מופיע היום', !events.some(e => e.text.includes('לא היום')));
}
{
  // אירוע UTC מומר לשעון ישראל
  const from = new Date(2026, 0, 15).getTime(), to = from + 86400000; // חורף: UTC+2
  const ics = 'BEGIN:VEVENT\r\nUID:u@t\r\nDTSTART:20260115T100000Z\r\nSUMMARY:שיחת זום\r\nEND:VEVENT';
  const events = parseICS(ics, from, to);
  check('שעת UTC מומרת לישראל (10Z→12:00)', events.length === 1 && new Date(events[0].at).getHours() === 12, JSON.stringify(events));
}

console.log('פיצ\'רים חדשים 2:');
{
  const r = await send('קוראים לי מאיר');
  check('פרופיל — שם', r.text.includes('נעים מאוד, מאיר'), r.text);
}
{
  const r = await send('מה התאריך העברי?');
  check('תאריך עברי', r.text.includes('ובעברי'), r.text);
}
{
  const r = await send('משקל 82.5');
  check('רישום משקל', r.text.includes('82.5'), r.text);
}
{
  await send('משקל 81.8');
  const r = await send('משקל');
  check('מעקב משקל עם מגמה', r.text.includes('81.8') && r.text.includes('82.5'), r.text);
}
{
  const r = await send('קבע לי ביומן פגישה עם עירית נתיבות מחר ב-8 בבוקר');
  check('קבע לי ביומן — הכותרת נקייה', r.text.includes('קבעתי') && !r.text.includes('"לי ') && !r.text.includes('ביומן פגישה'), r.text);
}
{
  const r = await send('תקבע לי פגישה עם דני מחרתיים ב-10');
  check('תקבע (עם ת) עובד', r.text.includes('קבעתי'), r.text);
}
{
  // מסמכים: שמירה דרך תמונה עם כיתוב ואז שליפה
  const req = new Request(`https://remi.example.workers.dev/webhook/${env.SECRET}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { chat: { id: 111 }, photo: [{ file_id: 'small' }, { file_id: 'BIG_FILE_ID' }], caption: 'שמור: תז של יוסי' } }),
  });
  await worker.fetch(req, env);
  const r = sent[sent.length - 1];
  check('שמירת מסמך מתמונה', r.text.includes('שמרתי') && r.text.includes('תז של יוסי'), r.text);
}
{
  const before = sent.length;
  await send('איפה התז של יוסי');
  const r = sent[sent.length - 1];
  check('שליפת מסמך לפי שם', r.photo === 'BIG_FILE_ID' && r.caption.includes('תז של יוסי'), JSON.stringify(r));
}
{
  const r = await send('מסמכים');
  check('רשימת מסמכים', r.text.includes('תז של יוסי'), r.text);
}
{
  // ניסוח עם AI מדומה
  env.AI = { run: async (model, input) => ({ response: 'שלום יוסי, בהמשך לשיחתנו...', text: 'תמלול' }) };
  const r = await send('נסח לי הודעה לעובד על סיום העסקה');
  check('ניסוח עם AI', r.text.includes('שלום יוסי'), r.text);
}
{
  const r = await send('חפש תנור');
  check('חיפוש בהיסטוריית התכתבות', r.text.includes('💬') || r.text.includes('תנור'), r.text);
}
{
  const r = await send('סיכום היום');
  check('סיכום יומי', r.text.includes('סיכום היום') || r.text.includes('עוד לא'), r.text);
}
{
  const r = await send('סיכום 30 ימים');
  check('ציר זמן לתקופה', r.text.includes('30 הימים'), r.text);
}

console.log('חוכמת כוונות:');
{
  const msg = 'קוראים לי מאיר כהן תז 037775483\nתאריך לידה 1.8.83\nאני אהיה בן 43 ב 1.8.26\nאבא ל3\nאדר בן 12\nאגם בת 10\nאור בן שנה וחצי\nבת זוגתי דיאנה.\nתשמור את הפרטים שלי';
  const r = await send(msg);
  check('פרטים אישיים רב-שורתיים → פרופיל (לא תזכורת!)', r.text.includes('נעים להכיר') && !r.text.includes('אזכיר'), r.text);
  check('  השם חולץ נקי', r.text.includes('מאיר'), r.text);
}
{
  const r = await send('מי אני');
  check('מי אני מציג את הפרטים', r.text.includes('דיאנה') && r.text.includes('מאיר כהן'), r.text);
}
{
  const r = await send('סתם מחשבה ארוכה שעוברת לי בראש על החיים ועל מה שהיה היום בעבודה עם הלקוחות');
  check('טקסט ארוך בלי פקודה → נשמר בזיכרון', r.text.includes('שמרתי את זה בזיכרון'), r.text);
}
{
  const r = await send('שורה ראשונה\nשורה שנייה עם תאריך 1.8.26');
  check('רב-שורתי עם תאריך → זיכרון ולא תזכורת', r.text.includes('בזיכרון') && !r.text.includes('אזכיר'), r.text);
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
