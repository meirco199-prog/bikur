// גשר יומן גוגל לרמי — Google Apps Script
// מאפשר לבוט לקבוע פגישות אמיתיות ביומן גוגל שלך, בחינם.
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

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) {
      return ContentService.createTextOutput('forbidden');
    }
    const start = new Date(data.startMs);
    const end = new Date(data.startMs + (data.durationMin || 60) * 60000);
    CalendarApp.getDefaultCalendar().createEvent(data.title, start, end);
    return ContentService.createTextOutput('ok');
  } catch (err) {
    return ContentService.createTextOutput('error: ' + err);
  }
}
