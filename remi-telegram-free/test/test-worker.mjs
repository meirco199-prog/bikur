// בדיקת הבוט מקצה לקצה עם KV מדומה וטלגרם מדומה — מריצים: node test/test-worker.mjs
import worker, { parseICS, parseWhen, parseCommand, aiFixTranscript } from '../worker.js';

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

// שעון קיר ישראלי, כמו שהבוט מחשב — תזכורות חוזרות נבחנות מולו
const ilMs = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).getTime();

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
  daily.at = ilMs() - 60000;
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
  r.at = ilMs() - 60000;
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
    r.at = ilMs() - 60000;
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

console.log('העברה ומחיקה של פגישות (דרך המוח):');
{
  const prevFetch = globalThis.fetch;
  const bridgeCalls = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('bridge.example')) { bridgeCalls.push(JSON.parse(opts.body)); return new Response('ok:deleted=1', { status: 200 }); }
    if (u.includes('api.anthropic.com')) {
      const req = JSON.parse(opts.body);
      const p = typeof req.messages[0].content === 'string' ? req.messages[0].content : '';
      const msg = (p.match(/ההודעה החדשה שלו: "([^"]*)"/) || [])[1] || '';
      const S = JSON.parse(kv.get('store'));
      const dani = S.events.find(e => e.text.includes('יוסי הבדיקה'));
      let text = 'לא JSON';
      if (msg.includes('תעביר') && dani) text = JSON.stringify({ action: 'event_move', event_id: dani.id, datetime: '2026-07-30 15:00', reply: '' });
      else if (msg.includes('בטל את הפגישה') && dani) text = JSON.stringify({ action: 'event_delete', event_id: dani.id, reply: '' });
      return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }), { status: 200 });
    }
    return prevFetch(url, opts);
  };
  env.CALENDAR_WEBHOOK = 'https://bridge.example/exec';
  await send('קבע פגישה עם יוסי הבדיקה ביום שלישי ב-11:00');
  env.ANTHROPIC_API_KEY = 'sk-test';
  bridgeCalls.length = 0;

  const r1 = await send('תעביר את הפגישה עם יוסי הבדיקה ליום חמישי ב-15:00');
  check('העברת פגישה — תשובה נכונה', r1.text.includes('הזזתי') && r1.text.includes('יוסי הבדיקה'), r1.text);
  check('  הגשר קיבל מחיקה של הישנה + יצירה של החדשה',
    bridgeCalls.some(b => b.action === 'delete') && bridgeCalls.some(b => !b.action), JSON.stringify(bridgeCalls));
  const Sa = JSON.parse(kv.get('store'));
  check('  יש רק פגישה אחת כזו (לא כפולה)', Sa.events.filter(e => e.text.includes('יוסי הבדיקה')).length === 1);

  bridgeCalls.length = 0;
  const r2 = await send('בטל את הפגישה עם יוסי הבדיקה');
  check('ביטול פגישה — נמחקה מקומית', r2.text.includes('ביטלתי'), r2.text);
  const Sb = JSON.parse(kv.get('store'));
  check('  נעלמה מהרשימה', !Sb.events.some(e => e.text.includes('יוסי הבדיקה')));
  check('  הגשר קיבל בקשת מחיקה', bridgeCalls.some(b => b.action === 'delete'));

  delete env.ANTHROPIC_API_KEY;
  delete env.CALENDAR_WEBHOOK;
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

console.log('דיוק תאריכים (ל׳/ב׳ צמודות — הבאג של "הכול נופל על מחר"):');
{
  // שבת 25/7/2026 בצהריים — כמו ביום שהבאג דווח
  const now = new Date(2026, 6, 25, 12, 0, 0);
  const d = (c) => c.at instanceof Date ? c.at : new Date(c.at);

  let c = parseCommand('קבע לי פגישה למחר עם עירית נתיבות ב8 בבוקר', now);
  check('"למחר... ב8 בבוקר" → מחר 8:00', c.cmd === 'event_add' && d(c).getDate() === 26 && d(c).getHours() === 8, JSON.stringify(c));
  check('  הכותרת נקייה ממילות זמן', c.text.includes('עירית נתיבות') && !c.text.includes('מחר') && !/\b8\b/.test(c.text), c.text);

  c = parseCommand('קבע פגישה ל1/8 ל9 יום הולדת שלי', now);
  check('"ל1/8 ל9" → 1/8 בשעה 9:00', c.cmd === 'event_add' && d(c).getDate() === 1 && d(c).getMonth() === 7 && d(c).getHours() === 9, JSON.stringify(c));
  check('  הכותרת: רק תוכן הפגישה', c.text.includes('יום הולדת') && !c.text.includes('1/8'), c.text);

  c = parseCommand('קבע פגישה ליום שני הקרוב עם דיאנה ל9', now);
  check('"ליום שני הקרוב ל9" → יום שני 27/7 9:00', c.cmd === 'event_add' && d(c).getDate() === 27 && d(c).getDay() === 1 && d(c).getHours() === 9, JSON.stringify(c));
  check('  הכותרת בלי "ליום שני"', c.text.includes('דיאנה') && !c.text.includes('שני'), c.text);

  c = parseCommand('קבע פגישה ליום רביעי הבא עם דני ב14:00', now);
  check('"ליום רביעי הבא ב14:00" → יום רביעי 29/7 14:00', c.cmd === 'event_add' && d(c).getDate() === 29 && d(c).getDay() === 3 && d(c).getHours() === 14, JSON.stringify(c));
  check('  הכותרת בלי "רביעי"', c.text.includes('דני') && !c.text.includes('רביעי'), c.text);
}

console.log('משימות: הפרדה מהיומן, כפתורי בוצעה/ביטול, ותזכורת משימות יומית:');
{
  // הוספת משימה — מגיעה עם כפתורי בחירה
  let r = await send('משימה: לסגור לעינב ביטוחים לרכב');
  const btns = r.reply_markup?.inline_keyboard || [];
  check('הוספת משימה מציעה כפתורי ✅/❌', btns.flat().some(b => b.text.includes('✅')) && btns.flat().some(b => b.text.includes('❌')), JSON.stringify(r.reply_markup));

  // "שלח לי משימות" → רשימת משימות, לא חיפוש מסמכים
  r = await send('שלח לי את המשימות שלי');
  check('"שלח לי משימות" מחזיר משימות ולא חיפוש', !r.text.includes('מצאתי על'), r.text);

  // שאלה חופשית על משימות → רשימת משימות, לא פגישות מהיומן
  r = await send('איזה משימות פתוחות יש לי');
  check('שאלת משימות מחזירה משימות ולא יומן', r.text.includes('לסגור לעינב') && !r.text.includes('📅'), r.text);
  check('  לכל משימה פתוחה יש כפתורים', (r.reply_markup?.inline_keyboard || []).flat().some(b => /^t:done:\d+$/.test(b.callback_data)), JSON.stringify(r.reply_markup));

  // לחיצה על "✅ בוצעה" דרך callback_query
  let S = JSON.parse(kv.get('store'));
  const task = S.tasks.find(t => t.text.includes('לעינב'));
  const cb = async (data) => {
    const req = new Request(`https://remi.example.workers.dev/webhook/${env.SECRET}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query: { id: 'cb1', data, message: { message_id: 5, chat: { id: 111 } } } }),
    });
    await worker.fetch(req, env);
  };
  await cb(`t:done:${task.id}`);
  S = JSON.parse(kv.get('store'));
  check('כפתור "בוצעה" מסמן את המשימה', S.tasks.find(t => t.id === task.id)?.done === true);

  // "↩️ לא בוצעה" מחזיר אותה לפתוחות
  await cb(`t:undo:${task.id}`);
  S = JSON.parse(kv.get('store'));
  check('כפתור "לא בוצעה" מחזיר לפתוחות', S.tasks.find(t => t.id === task.id)?.done === false);

  // "❌ בטל" מוחק את המשימה
  await cb(`t:del:${task.id}`);
  S = JSON.parse(kv.get('store'));
  check('כפתור "בטל" מוחק את המשימה', !S.tasks.some(t => t.id === task.id));
}
{
  // תזכורת משימות יומית
  await send('משימה: להתקשר לרואה החשבון');
  let r = await send('תזכורת משימות כל בוקר ב-7');
  check('נקבעה תזכורת משימות יומית ב-7:00', r.text.includes('07:00') && r.text.includes('משימות'), r.text);
  let S = JSON.parse(kv.get('store'));
  const digest = S.reminders.find(x => x.tasksDigest);
  check('  נשמרה כתזכורת יומית מיוחדת', !!digest && digest.recurringDaily === true);

  // בזמן הצלצול — נשלחת רשימת המשימות הפתוחות עם כפתורים
  digest.at = ilMs() - 60000;
  kv.set('store', JSON.stringify(S));
  const before = sent.length;
  await worker.scheduled({}, env);
  const digestMsgs = sent.slice(before);
  const header = digestMsgs.find(m => m.text.includes('המשימות הפתוחות'));
  const card = digestMsgs.find(m => m.text.includes('רואה החשבון'));
  check('הקרון שלח את המשימות הפתוחות', !!header && !!card, JSON.stringify(digestMsgs));
  check('  עם כפתורי סימון', !!card && (card.reply_markup?.inline_keyboard || []).flat().some(b => b.text.includes('✅')));

  // ביטול התזכורת
  r = await send('בטל תזכורת משימות');
  S = JSON.parse(kv.get('store'));
  check('ביטול תזכורת המשימות', r.text.includes('ביטלתי') && !S.reminders.some(x => x.tasksDigest), r.text);
}

console.log('ביטול פגישה שקיימת רק ביומן גוגל (לא נקבעה דרך הבוט):');
{
  const prevFetch = globalThis.fetch;
  const bridgeCalls = [];
  const d = new Date(Date.now() + 86400000); // מחר
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T110000`;
  const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:g1@t\r\nDTSTART;TZID=Asia/Jerusalem:${stamp}\r\nSUMMARY:רופא שיניים דוקטור לוי\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('ics.example')) return new Response(ics, { status: 200 });
    if (u.includes('bridge.example')) { bridgeCalls.push(JSON.parse(opts.body)); return new Response('ok:deleted=1', { status: 200 }); }
    if (u.includes('api.anthropic.com')) {
      const p = JSON.parse(opts.body).messages[0].content;
      const msg = (p.match(/ההודעה החדשה שלו: "([^"]*)"/) || [])[1] || '';
      const hasGcal = p.includes('רופא שיניים דוקטור לוי');
      const text = msg.includes('בטל') && hasGcal
        ? JSON.stringify({ action: 'event_delete', event_id: 0, title: 'רופא שיניים דוקטור לוי', reply: '' })
        : JSON.stringify({ action: 'answer', reply: 'לא הבנתי' });
      return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }), { status: 200 });
    }
    return prevFetch(url, opts);
  };
  env.CALENDAR_ICS = 'https://ics.example/secret.ics';
  env.CALENDAR_WEBHOOK = 'https://bridge.example/exec';
  env.ANTHROPIC_API_KEY = 'sk-test';

  const r = await send('בטל את הפגישה אצל רופא השיניים');
  check('המוח רואה את פגישות היומן ומבטל', r.text.includes('ביטלתי') && r.text.includes('רופא שיניים'), r.text);
  check('  הגשר קיבל מחיקה עם הכותרת המדויקת מהיומן', bridgeCalls.some(b => b.action === 'delete' && b.title === 'רופא שיניים דוקטור לוי'), JSON.stringify(bridgeCalls));

  delete env.CALENDAR_ICS;
  delete env.CALENDAR_WEBHOOK;
  delete env.ANTHROPIC_API_KEY;
  globalThis.fetch = prevFetch;
}

console.log('חיפוש בג׳ימייל (קריאה בלבד) והסבר וואטסאפ:');
{
  const prevFetch = globalThis.fetch;
  const bridgeCalls = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('bridge.example')) {
      bridgeCalls.push(JSON.parse(opts.body));
      return new Response(JSON.stringify({ ok: true, results: [
        { subject: 'חשבונית מס 1234 — חברת החשמל', from: 'חברת החשמל', date: '20/7/2026',
          files: ['invoice-1234.pdf'], link: 'https://mail.google.com/mail/u/0/#all/abc123' },
      ] }), { status: 200 });
    }
    return prevFetch(url, opts);
  };
  env.CALENDAR_WEBHOOK = 'https://bridge.example/exec';

  let r = await send('חפש לי במייל חשבונית של חברת החשמל');
  check('חיפוש במייל — הגשר קיבל בקשת קריאה בלבד', bridgeCalls.some(b => b.action === 'gmail_search' && b.q.includes('חשבונית')), JSON.stringify(bridgeCalls));
  check('  התוצאה: נושא, קובץ מצורף וקישור', r.text.includes('חשבונית מס 1234') && r.text.includes('invoice-1234.pdf') && r.text.includes('mail.google.com'), r.text);

  // אין תוצאות
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('bridge.example')) return new Response(JSON.stringify({ ok: true, results: [] }), { status: 200 });
    return prevFetch(url, opts);
  };
  r = await send('חפש במייל משהו שלא קיים בכלל');
  check('אין תוצאות — הודעה ברורה', r.text.includes('לא מצאתי מיילים'), r.text);

  delete env.CALENDAR_WEBHOOK;
  globalThis.fetch = prevFetch;

  // בלי גשר — הסבר איך מחברים
  r = await send('חפש במייל חשבונית');
  check('בלי גשר — הסבר חיבור', r.text.includes('הגשר'), r.text);

  // וואטסאפ — הסבר כן + חיפוש מקומי במקום
  r = await send('חפש בוואטסאפ תעודת זהות');
  check('וואטסאפ — הסבר שאין גישה + חיפוש בארכיון', r.text.includes('מוצפנות') && r.text.includes('חיפשתי אצלי'), r.text);
}

console.log('זיכרון: תיוג ההודעה/המסמך המקורי בתשובה:');
{
  // הודעה עם message_id שנשמרת בהיסטוריה
  const req = new Request(`https://remi.example.workers.dev/webhook/${env.SECRET}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { text: 'זכור: הקוד של השער בבניין הוא 4433', message_id: 777, chat: { id: 111 } } }),
  });
  await worker.fetch(req, env);
  const r = await send('חפש השער בבניין');
  check('חיפוש בהיסטוריה מתייג את ההודעה המקורית', r.reply_to_message_id === 777, JSON.stringify(r));
}

console.log('תיקון תמלול קולי עם קלוד:');
{
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('api.anthropic.com')) {
      const p = JSON.parse(opts.body).messages[0].content;
      const raw = (p.match(/התמלול: ([\s\S]*)$/) || [])[1] || '';
      const text = raw.replace('כבר לי', 'קבע לי').replace('תיסה', 'טיסה');
      return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }), { status: 200 });
    }
    return prevFetch(url, opts);
  };
  env.ANTHROPIC_API_KEY = 'sk-test';
  const fixed = await aiFixTranscript(env, 'כבר לי תיסה לקפריסין מחר בתשע');
  check('תמלול משובש מתוקן ("כבר לי"→"קבע לי")', fixed === 'קבע לי טיסה לקפריסין מחר בתשע', String(fixed));
  delete env.ANTHROPIC_API_KEY;
  const none = await aiFixTranscript(env, 'טקסט כלשהו');
  check('בלי קלוד — אין תיקון (משתמשים בתמלול המקורי)', none === null);
  globalThis.fetch = prevFetch;
}

console.log('ביטול כל הפגישות של יום שלם:');
{
  const prevFetch = globalThis.fetch;
  const bridgeCalls = [];
  // יום ראשון הקרוב (לפי שעון ישראל בערך — מספיק טוב לבדיקה)
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7));
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T130000`;
  const ics = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:cd1@t\r\nDTSTART;TZID=Asia/Jerusalem:${stamp}\r\nSUMMARY:טיפול שיניים לביטול\r\nEND:VEVENT\r\nEND:VCALENDAR`;
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('ics.example')) return new Response(ics, { status: 200 });
    if (u.includes('bridge.example')) { bridgeCalls.push(JSON.parse(opts.body)); return new Response('ok:deleted=1', { status: 200 }); }
    return prevFetch(url, opts);
  };
  env.CALENDAR_ICS = 'https://ics.example/day-clear.ics';
  env.CALENDAR_WEBHOOK = 'https://bridge.example/exec';

  await send('קבע פגישה ליום ראשון ב-10 עם משקיע ראשון');
  await send('קבע פגישה ליום ראשון ב-16 עם משקיע שני');
  bridgeCalls.length = 0;

  const r = await send('בטל את כל הפגישות ביום ראשון');
  check('ביטול יום שלם — כל הפגישות ברשימה', r.text.includes('ביטלתי') && r.text.includes('משקיע ראשון') && r.text.includes('משקיע שני') && r.text.includes('טיפול שיניים'), r.text);
  check('  הגשר קיבל מחיקה לכל פגישה (כולל מיומן גוגל)', bridgeCalls.filter(b => b.action === 'delete').length >= 3, JSON.stringify(bridgeCalls));
  const S = JSON.parse(kv.get('store'));
  check('  נמחקו מהזיכרון המקומי', !S.events.some(e => e.text.includes('משקיע')));

  delete env.CALENDAR_ICS; // היומן המדומה תמיד מחזיר את האירוע — מנתקים כדי לבדוק יום ריק
  const r2 = await send('בטל את כל הפגישות ביום ראשון');
  check('יום ריק — תשובה נקייה', r2.text.includes('אין פגישות'), r2.text);

  delete env.CALENDAR_ICS;
  delete env.CALENDAR_WEBHOOK;
  globalThis.fetch = prevFetch;
}

console.log('תזכורת "רשימת הפגישות של היום" שולחת את הפגישות עצמן:');
{
  // שעון ישראל כמו שהבוט מחשב אותו — כדי שהאירוע ייפול על "היום" מבחינתו
  const ilNowMs = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).getTime();
  let S = JSON.parse(kv.get('store'));
  S.events.push({ id: 9901, text: 'פגישת בדיקה חשובה', at: ilNowMs + 30 * 60000 });
  S.reminders.push({ id: 9902, text: 'רשימת הפגישות של היום', at: ilMs() - 60000, recurringDaily: true, recurringWeekly: null });
  S.reminders.push({ id: 9903, text: 'פגישה עם דני החבר', at: Date.now() - 60000, recurringDaily: false, recurringWeekly: null });
  kv.set('store', JSON.stringify(S));

  const before = sent.length;
  await worker.scheduled({}, env);
  const fired = sent.slice(before);
  const agendaMsg = fired.find(m => m.text.includes('פגישת בדיקה חשובה'));
  check('התזכורת שלחה את הפגישות של היום (לא הד)', !!agendaMsg, JSON.stringify(fired.map(f => f.text)));
  check('  רק פגישות — בלי רשימת התזכורות ובלי משימות', !!agendaMsg && !agendaMsg.text.includes('תזכורות:') && !agendaMsg.text.includes('משימות פתוחות'), agendaMsg && agendaMsg.text);
  check('  בלי להדהד את נוסח התזכורת', !fired.some(m => m.text.includes('תזכורת: רשימת הפגישות')), JSON.stringify(fired.map(f => f.text)));
  check('  תזכורת רגילה שמזכירה פגישה נשארת הד', fired.some(m => m.text.includes('תזכורת: פגישה עם דני החבר')), JSON.stringify(fired.map(f => f.text)));
}

console.log('התראה לפני פגישות + מיקום ביומן:');
{
  // פגישה בעוד 7 דקות עם מיקום — הקרון שולח התראה
  const ilNowMs = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' })).getTime();
  let S = JSON.parse(kv.get('store'));
  S.events.push({ id: 9910, text: 'פגישה עם ישראל בוזגלו', at: ilNowMs + 7 * 60000, loc: 'רחוב המסגר 11, אופקים' });
  kv.set('store', JSON.stringify(S));

  let before = sent.length;
  await worker.scheduled({}, env);
  const ping = sent.slice(before).find(m => m.text.includes('🔔') && m.text.includes('ישראל בוזגלו'));
  check('התראה 10 דקות לפני פגישה', !!ping && /בעוד \d+ דקות/.test(ping.text), JSON.stringify(sent.slice(before).map(x => x.text)));
  check('  כולל את המיקום 📍', !!ping && ping.text.includes('רחוב המסגר 11'), ping && ping.text);

  before = sent.length;
  await worker.scheduled({}, env);
  check('  לא נשלחת פעמיים', !sent.slice(before).some(m => m.text.includes('🔔') && m.text.includes('ישראל בוזגלו')));

  // שינוי וכיבוי
  let r = await send('תזכורת פגישות 15 דקות');
  check('שינוי זמן ההתראה', r.text.includes('15 דקות'), r.text);
  r = await send('בטל תזכורת פגישות');
  check('כיבוי התראות פגישות', r.text.includes('🔕'), r.text);
  S = JSON.parse(kv.get('store'));
  check('  נשמר בהגדרות', S.meetingPingMin === 0);
  await send('תזכורת פגישות 10 דקות'); // החזרה לברירת מחדל להמשך הבדיקות
}
{
  // המוח מפריד כתובת מכותרת + סדר היום בלי כפילויות
  const prevFetch = globalThis.fetch;
  const bridgeCalls = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('bridge.example')) { bridgeCalls.push(JSON.parse(opts.body)); return new Response('ok', { status: 200 }); }
    if (u.includes('api.anthropic.com')) {
      const text = JSON.stringify({ action: 'event', title: 'פגישה עם ישראל בוזגלו',
        location: 'רחוב המסגר 11, אופקים', datetime: '2026-07-28 13:30', reply: '' });
      return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }), { status: 200 });
    }
    return prevFetch(url, opts);
  };
  env.CALENDAR_WEBHOOK = 'https://bridge.example/exec';
  env.ANTHROPIC_API_KEY = 'sk-test';

  const r = await send('קבע לי פגישה מחר ב13:30 עם ישראל בוזגלו רחוב המסגר 11 אופקים');
  check('כתובת נכנסת ל-📍 ולא לכותרת', r.text.includes('📍 רחוב המסגר 11') && r.text.includes('"פגישה עם ישראל בוזגלו"'), r.text);
  check('  הגשר קיבל location נפרד', bridgeCalls.some(b => (b.location || '').includes('רחוב המסגר 11') && b.title === 'פגישה עם ישראל בוזגלו'), JSON.stringify(bridgeCalls));
  check('  מבטיח התראה לפני', r.text.includes('🔔'), r.text);

  delete env.CALENDAR_WEBHOOK;
  delete env.ANTHROPIC_API_KEY;
  globalThis.fetch = prevFetch;
}

console.log('תזכורת חוזרת שפוספסה מזמן לא נשלחת באיחור מגוחך:');
{
  let S = JSON.parse(kv.get('store'));
  // תזכורת יומית שהמופע שלה היום היה לפני 6 שעות (כאילו "נשכחה")
  S.reminders.push({ id: 9950, text: 'תזכורת בוקר ישנה מאוד', at: ilMs() - 6 * 3600000, recurringDaily: true, recurringWeekly: null });
  kv.set('store', JSON.stringify(S));
  const before = sent.length;
  await worker.scheduled({}, env);
  check('לא נשלחה באיחור של 6 שעות', !sent.slice(before).some(m => m.text.includes('תזכורת בוקר ישנה')), JSON.stringify(sent.slice(before).map(x => x.text)));
  const C = JSON.parse(kv.get('cron'));
  check('  סומנה כ"טופלה" כדי לחכות למחר', !!C.fired[9950]);
}

console.log('שעון הגיבוי לא מכפיל תזכורות:');
{
  let S = JSON.parse(kv.get('store'));
  S.reminders.push({ id: 9960, text: 'בדיקת גיבוי טרייה', at: ilMs() - 60000, recurringDaily: false, recurringWeekly: null });
  S.reminders.push({ id: 9961, text: 'בדיקת גיבוי ותיקה', at: ilMs() - 3 * 60000, recurringDaily: false, recurringWeekly: null });
  kv.set('store', JSON.stringify(S));
  const before = sent.length;
  await worker.fetch(new Request(`https://remi.example.workers.dev/tick?secret=${env.SECRET}`), env);
  const out = sent.slice(before);
  check('שעון הגיבוי מדלג על תזכורת טרייה (של השעון הראשי)', !out.some(m => m.text.includes('גיבוי טרייה')), JSON.stringify(out.map(x => x.text)));
  check('  אבל תופס תזכורת שאיחרה מעל 2 דקות', out.some(m => m.text.includes('גיבוי ותיקה')), JSON.stringify(out.map(x => x.text)));
  const before2 = sent.length;
  await worker.scheduled({}, env);
  check('  השעון הראשי שולח את הטרייה כרגיל', sent.slice(before2).some(m => m.text.includes('גיבוי טרייה')));
}

console.log('לוז יומי חדש בהודעה אחת:');
{
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('api.anthropic.com')) {
      const p = JSON.parse(opts.body).messages[0].content;
      const msg = (p.match(/ההודעה החדשה שלו: "([^"]*)"/) || [])[1] || '';
      const text = msg.includes('לוז חדש')
        ? JSON.stringify({ action: 'routine', routine: [
            { time: '7:00', title: 'תאריך עברי ולועזי וברכת בוקר טוב' },
            { time: '9:00', title: 'משימות פתוחות' },
            { time: '22:00', title: 'סיכום יום וברכת לילה טוב' },
          ], reply: '' })
        : JSON.stringify({ action: 'answer', reply: 'בסדר' });
      return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }), { status: 200 });
    }
    return prevFetch(url, opts);
  };
  env.ANTHROPIC_API_KEY = 'sk-test';

  const r = await send('מעכשיו יהיה לוז חדש. 7:00 תאריך עברי וברכת בוקר 9:00 משימות פתוחות 22:00 סיכום יום וברכת לילה טוב');
  check('הלוז הוקם עם אישור מסודר', r.text.includes('סידרתי') && r.text.includes('07:00') && r.text.includes('22:00'), r.text);
  let S = JSON.parse(kv.get('store'));
  const dailies = S.reminders.filter(x => x.recurringDaily);
  check('  היומיות הישנות הוחלפו בשלוש החדשות', dailies.length === 3 && dailies.some(x => x.tasksDigest), JSON.stringify(dailies.map(d => d.text)));
  check('  השבועית נשארה', S.reminders.some(x => x.recurringWeekly === 0));
  check('  סיכומי הבוקר/ערב המובנים כובו', S.briefOff === true && S.summaryOff === true);

  // צלצול של שורת "סיכום יום וברכת לילה טוב" — תוכן חי, לא הד
  const night = S.reminders.find(x => x.text.includes('לילה טוב'));
  night.at = ilMs() - 60000;
  kv.set('store', JSON.stringify(S));
  const before = sent.length;
  await worker.scheduled({}, env);
  const msg = sent.slice(before).find(m => m.text.includes('לילה טוב'));
  check('  בלילה: ברכת לילה טוב אמיתית (לא הד)', !!msg && !msg.text.includes('תזכורת: סיכום'), msg && msg.text);

  delete env.ANTHROPIC_API_KEY;
  globalThis.fetch = prevFetch;
}

console.log('שריון מפני כפילות כשהאחסון מחזיר גרסה ישנה:');
{
  let S = JSON.parse(kv.get('store'));
  S.reminders.push({ id: 9970, text: 'בדיקת כפילות שריון', at: ilMs() - 60000, recurringDaily: false, recurringWeekly: null });
  kv.set('store', JSON.stringify(S));
  const staleCron = kv.get('cron'); // צילום מצב מלפני השליחה
  const before = sent.length;
  await worker.scheduled({}, env);
  check('נשלחה פעם אחת', sent.slice(before).filter(m => m.text.includes('כפילות שריון')).length === 1, JSON.stringify(sent.slice(before).map(x => x.text)));
  // "שיהוק" של האחסון: מחזירים את הגרסה הישנה שבה השליחה לא רשומה
  kv.set('cron', staleCron);
  const before2 = sent.length;
  await worker.scheduled({}, env);
  check('לא נשלחה שוב למרות האחסון הישן (הזיכרון המקומי תפס)', !sent.slice(before2).some(m => m.text.includes('כפילות שריון')), JSON.stringify(sent.slice(before2).map(x => x.text)));
}

console.log('המוח רואה גם את התשובות של עצמו (המשכי שיחה):');
{
  // התשובות של הבוט נרשמות בהיסטוריה
  await send('משימות');
  let S = JSON.parse(kv.get('store'));
  check('תשובת הבוט נשמרת בהיסטוריה', S.history.length >= 2 && S.history[S.history.length - 1].bot === true, JSON.stringify(S.history.slice(-2)));

  // וההקשר הזה מגיע למוח: "כן" אחרי הצעה — עונים, לא שומרים פתק
  const prevFetch = globalThis.fetch;
  let sawBotContext = false;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('api.anthropic.com')) {
      const p = JSON.parse(opts.body).messages[0].content;
      sawBotContext = p.includes('(אתה ענית)');
      return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text',
        text: JSON.stringify({ action: 'answer', reply: 'הח.פ הוא 517318267' }) }] }), { status: 200 });
    }
    return prevFetch(url, opts);
  };
  env.ANTHROPIC_API_KEY = 'sk-test';
  const r = await send('כן');
  check('"כן" מקבל תשובה מההקשר ולא נשמר כפתק', r.text.includes('517318267') && !r.text.includes('שמרתי'), r.text);
  check('  המוח קיבל את התשובות הקודמות של הבוט כהקשר', sawBotContext);
  delete env.ANTHROPIC_API_KEY;
  globalThis.fetch = prevFetch;
}

console.log(`\n${passed} עברו, ${failed} נכשלו`);
process.exit(failed ? 1 : 0);
