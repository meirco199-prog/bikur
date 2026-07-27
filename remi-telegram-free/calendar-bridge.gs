// גשר גוגל לרמי — Google Apps Script
// מאפשר לבוט לקבוע/למחוק פגישות ביומן גוגל שלך, ולחפש במיילים שלך (קריאה בלבד —
// הבוט אף פעם לא שולח ולא מוחק מיילים).
// שים לב: אחרי הדבקת גרסה חדשה חובה להריץ פעם אחת את הפונקציה authorize מהעורך
// (ראה למטה) — אחרת גוגל לא מבקש את הרשאת הג'ימייל וחיפוש המייל ייכשל.
//
// התקנה (5 דקות):
// 1. פתח https://script.google.com → New project
// 2. מחק את הקוד שיש שם והדבק את כל הקובץ הזה
// 3. בשורה למטה החלף את הסוד באותו SECRET שהגדרת ב-Cloudflare
// 4. Deploy → New deployment → סוג: Web app
//    - Execute as: Me
//    - Who has access: Anyone
//    → Deploy (יבקש אישור הרשאות ליומן — אשר)
// 5. העתק את כתובת ה-Web app (מסתיימת ב-/exec)
// 6. ב-Cloudflare: remi → Settings → Variables and Secrets → Add:
//    Name: CALENDAR_WEBHOOK (סוג Secret) → Value: הכתובת שהעתקת
//
// מעכשיו "קבע פגישה עם דני מחר ב-14:00" ייכנס ליומן גוגל האמיתי! 📆

const SECRET = 'remi-meir-2026'; // ← החלף לסוד שלך (אותו אחד מ-Cloudflare)

// ⭐ חשוב! אחרי הדבקת הקובץ: בחר למעלה בתפריט הפונקציות את authorize ולחץ "הפעלה" (▶).
// גוגל יפתח חלון הרשאות — אשר (אם מופיעה אזהרה "Google לא אימתה את האפליקציה":
// לחץ "מתקדם" ואז "עבור אל הפרויקט (לא בטוח)" — זה הסקריפט הפרטי שלך, זה בסדר).
// בלי ההרצה החד-פעמית הזו גוגל לא מבקש הרשאות, וחיפוש המייל ייכשל.
function authorize() {
  CalendarApp.getDefaultCalendar().getName();
  GmailApp.search('test', 0, 1);
  Logger.log('כל ההרשאות אושרו ✅ אפשר לסגור ולחזור לבוט');
}

// בדיקה בדפדפן: פתיחת כתובת ה-exec מציגה "הגשר של רמי חי"
function doGet() {
  return ContentService.createTextOutput('הגשר של רמי חי 🙂 (' + new Date() + ')');
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) {
      return ContentService.createTextOutput('forbidden');
    }

    // מחיקת אירוע: מחפש אירועים עם כותרת תואמת (גם חלקית) בחלון של ±12 שעות סביב המועד
    if (data.action === 'delete') {
      const from = new Date(data.startMs - 12 * 3600000);
      const to = new Date(data.startMs + 12 * 3600000);
      const events = CalendarApp.getDefaultCalendar().getEvents(from, to);
      const want = String(data.title || '').trim();
      let deleted = 0;
      for (let i = 0; i < events.length; i++) {
        const t = events[i].getTitle().trim();
        if (t === want || (want.length >= 3 && t.indexOf(want) !== -1) || (t.length >= 3 && want.indexOf(t) !== -1)) {
          events[i].deleteEvent();
          deleted++;
        }
      }
      return ContentService.createTextOutput('ok:deleted=' + deleted);
    }

    // חיפוש במיילים — קריאה בלבד. מחזיר עד 5 תוצאות: נושא, שולח, תאריך,
    // שמות קבצים מצורפים וקישור שפותח את המייל בג'ימייל.
    if (data.action === 'gmail_search') {
      var threads = GmailApp.search(data.q, 0, 5);
      var results = [];
      for (var i = 0; i < threads.length; i++) {
        var msgs = threads[i].getMessages();
        var last = msgs[msgs.length - 1];
        var files = [];
        var atts = last.getAttachments();
        for (var a = 0; a < atts.length; a++) files.push(atts[a].getName());
        results.push({
          subject: threads[i].getFirstMessageSubject(),
          from: last.getFrom().replace(/<[^>]*>/, '').trim(),
          date: Utilities.formatDate(last.getDate(), 'Asia/Jerusalem', 'd/M/yyyy'),
          files: files,
          link: threads[i].getPermalink(),
        });
      }
      return ContentService.createTextOutput(JSON.stringify({ ok: true, results: results }));
    }

    // ברירת מחדל: יצירת אירוע (עם כתובת בשדה המיקום, אם נשלחה)
    const start = new Date(data.startMs);
    const end = new Date(data.startMs + (data.durationMin || 60) * 60000);
    CalendarApp.getDefaultCalendar().createEvent(data.title, start, end, { location: data.location || '' });
    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err);
  }
}
