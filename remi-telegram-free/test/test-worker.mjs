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

  const C = JSON.parse(kv.get('cron'));
  check('השליחה נרשמה במפתח הקרון הנפרד', Object.keys(C.fired).length >= 1);
  check('נרשמה בסטטיסטיקה', (C.stats.fired || []).length >= 1);

  // הרצה חוזרת של הקרון — לא שולחת שוב
  const before2 = sent.length;
  await worker.scheduled({}, env);
  check('אין שליחה כפולה בהרצת קרון נוספת', !sent.slice(before2).some(m => m.text.includes('תנור')));

  // הודעה כלשהי מהמשתמש מנקה את התזכורת שנשלחה מה-store
  await send('משימות');
  const S2 = JSON.parse(kv.get('store'));
  check('תזכורת חד-פעמית נוקתה אחרי שנשלחה', !S2.reminders.some(x => x.text.includes('תנור')));
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
  const before = sent.length;
  await worker.scheduled({}, env);
  check('תזכורת יומית נשלחה', sent.slice(before).some(m => m.text.includes('כדור')));
  // נשארת ב-store (חוזרת), ולא נשלחת שוב באותו יום
  const S2 = JSON.parse(kv.get('store'));
  check('תזכורת יומית נשארת קיימת', !!S2.reminders.find(x => x.recurringDaily));
  const before2 = sent.length;
  await worker.scheduled({}, env);
  check('יומית לא נשלחת פעמיים באותו יום', !sent.slice(before2).some(m => m.text.includes('⏰') && m.text.includes('כדור')));
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

console.log('מוח AI (הבנת שפה חופשית):');
{
  // מוק AI שמחזיר JSON כמו מודל אמיתי
  env.AI = { run: async (model, input) => {
    const p = input.prompt || '';
    if (p.includes('החזר אך ורק JSON')) {
      const msg = (p.match(/ההודעה החדשה שלו: "([^"]*)"/) || [])[1] || '';
      if (/קפריסי/.test(msg)) return { response: '{"action":"event","title":"טיסה לקפריסין (30/7–1/8)","datetime":"2026-07-30 12:00","recurring":"none","reply":"בשמחה מאיר! רשמתי לך את הטיסה, שתהיה חופשה נהדרת 🙏"}' };
      if (msg.includes('מה שלומך')) return { response: '{"action":"answer","reply":"הכול מצוין מאיר, תודה ששאלת! איך אפשר לעזור לך היום? 🙂"}' };
      return { response: 'לא JSON' };
    }
    return { response: 'שלום יוסי, בהמשך לשיחתנו...', text: 'תמלול' };
  }};
  const r = await send('תקבע לי ביומן בין ה-30 לשביעי לראשון לשמיני טיסה לקפריסין');
  check('בקשה מסובכת → AI קובע אירוע', r.text.includes('קפריסין') && r.text.includes('קבעתי'), r.text);
  const S = JSON.parse(kv.get('store'));
  check('  האירוע באמת נשמר', S.events.some(e => e.text.includes('קפריסין')));
}
{
  const r = await send('מה שלומך חבר');
  check('שיחה חופשית → תשובה אנושית בשם', r.text.includes('תודה ששאלת'), r.text);
}
{
  const r = await send('בלה בלה סתם קצר');
  check('כשה-AI לא מחזיר JSON — נופל בחן לתשובת ברירת מחדל', r.text.includes('עזרה'), r.text);
}

console.log('תזכורות חכמות (עונות במקום להדהד):');
{
  await send('תזכיר לי כל יום ב-7 מה התאריך העברי');
  const S = JSON.parse(kv.get('store'));
  const r = S.reminders.find(x => x.text.includes('תאריך'));
  check('נוצרה תזכורת יומית לתאריך', !!r && r.recurringDaily);
  r.at = Date.now() - 60000;
  kv.set('store', JSON.stringify(S));
  const before = sent.length;
  await worker.scheduled({}, env);
  const fired = sent.slice(before);
  check('בזמן הצלצול — עונה עם התאריך העברי עצמו', fired.some(m => m.text.includes('ובעברי') && m.text.includes('התשפ')), JSON.stringify(fired.map(f=>f.text)));
}
{
  // תזכורת-שאלה כללית — עוברת ל-AI לתשובה
  const oldRun = env.AI.run;
  env.AI.run = async (model, input) => {
    if ((input.prompt || '').includes('ענה בקצרה')) return { response: 'נשארו 51 ימים לראש השנה 🎉' };
    return oldRun(model, input);
  };
  await send('תזכיר לי בעוד דקה כמה ימים נשארו עד ראש השנה');
  const S = JSON.parse(kv.get('store'));
  const r = S.reminders.find(x => x.text.includes('ראש השנה'));
  check('נוצרה תזכורת-שאלה', !!r, JSON.stringify(S.reminders.map(x=>x.text)));
  if (r) {
    r.at = Date.now() - 60000;
    kv.set('store', JSON.stringify(S));
    const before = sent.length;
    await worker.scheduled({}, env);
    const fired = sent.slice(before);
    check('בזמן הצלצול — ה-AI עונה על השאלה', fired.some(m => m.text.includes('51 ימים')), JSON.stringify(fired.map(f=>f.text)));
  }
  env.AI.run = oldRun;
}

{
  const r = await send('כבר לי פגישה ביומן בין ה-30 ליולי עד הראשון לאוגוסט, טיסה לקפריסים');
  check('משפט משובש עם "ביומן" → AI קובע אירוע (לא שאלת יומן)', r.text.includes('קבעתי') && r.text.includes('קפריסי'), r.text);
}

console.log('מוח Claude API (אם חובר):');
{
  // מוק ל-api.anthropic.com
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('api.anthropic.com')) {
      const req = JSON.parse(opts.body);
      const userMsg = typeof req.messages[0].content === 'string' ? req.messages[0].content : '(image)';
      let text = 'תשובה חופשית מקלוד';
      if (userMsg.includes('החזר אך ורק JSON')) {
        text = '{"action":"answer","reply":"בטח מאיר, הטיסה שלך לקפריסין יוצאת ב-30/7 🙂"}';
      }
      return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }), { status: 200 });
    }
    return prevFetch(url, opts);
  };
  env.ANTHROPIC_API_KEY = 'sk-test';
  const r = await send('מתי הטיסה שלי לקפריסין בעצם?');
  check('קלוד עונה כשהמפתח מחובר', r.text.includes('בטח מאיר'), r.text);
  delete env.ANTHROPIC_API_KEY;
  globalThis.fetch = prevFetch;
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
