// יום המסחר האחרון שנסגר בניו יורק (ב'–ו', 16:00 ET; חגים לא נלקחים בחשבון — ביום חג הסדרה תתרענן פעם אחת לשווא, לא מזיק).
// משמש לקבוע אם סדרת מחירים במטמון עדיין מכסה את הסגירה האחרונה: מטמון עם TTL בלבד יכול להיות "טרי" (20 שעות) ועדיין לא לכלול את הסגירה של אתמול.
const PARTS = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
export function nyParts(now = new Date()){
  const p = PARTS.formatToParts(now); const g = (t) => p.find((x) => x.type === t)?.value;
  return { weekday: g('weekday'), y: +g('year'), m: +g('month'), d: +g('day'), h: +g('hour') % 24, mi: +g('minute') };
}
// { date: 'YYYY-MM-DD' של הסשן שנסגר לאחרונה, closeMs: זמן הסגירה שלו (epoch ms) }
export function lastSessionClose(now = new Date()){
  const p = nyParts(now);
  const offsetMs = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi) - Math.floor(now.getTime() / 60000) * 60000; // ET לעומת UTC ברגע זה
  let day = new Date(Date.UTC(p.y, p.m - 1, p.d));
  const closedToday = WEEKDAYS.includes(p.weekday) && p.h * 60 + p.mi >= 16 * 60;
  if (!closedToday){ do { day = new Date(day.getTime() - 86400000); } while (!WEEKDAYS.includes(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day.getUTCDay()])); }
  const date = day.toISOString().slice(0, 10);
  const closeMs = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 16, 0) - offsetMs;
  return { date, closeMs };
}
// האם סדרת מחירים (שורות [date,...]) שנמשכה ב-fetchedAt כבר מכסה את הסגירה האחרונה. minAgeSec: לא לנסות שוב כל רגע אם הספק טרם פרסם את הסגירה
export function pricesCoverLastSession(rows, fetchedAt, now = new Date()){
  const last = rows?.length ? rows[rows.length - 1][0] : null;
  const s = lastSessionClose(now);
  return !!last && last >= s.date;
}

// חותמת זמן UTC של שעה בניו יורק ביום נתון (למשל 09:40 ET של יום המסחר) — לרישום מילויים של תיקי צל בזמן הסשן ולא בזמן העיבוד
export function nyTimeIso(day, h = 9, mi = 40){
  const [y, m, d] = day.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, h + 4, mi); // הנחת קיץ (UTC−4), מתוקן לפי ההיסט בפועל באותו יום
  const p = nyParts(new Date(guess));
  const diffMin = (p.h * 60 + p.mi) - (h * 60 + mi) + (p.d - d) * 1440;
  guess -= diffMin * 60000;
  return new Date(guess).toISOString();
}

// חגי בורסה מלאים בניו יורק (NYSE, סגירה מלאה — לא ימים מקוצרים) — רשימה קבועה שדורשת עדכון שנתי, בדיוק כמו
// SPY_SECTOR_WEIGHTS ב-engine/aggressive.js (קירוב מתועד, לא מקור חי). מקור: https://www.nyse.com/markets/hours-calendars
// יום שלא ברשימה ולא סוף שבוע מתייחס כיום מסחר רגיל — כלומר חג שלא עודכן כאן פשוט לא ייהנה מהחריגה למטה (fail-closed).
export const NYSE_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
]);
export const isNonTradingDay = (iso) => { const wd = new Date(iso + 'T00:00:00Z').getUTCDay(); return wd === 0 || wd === 6 || NYSE_HOLIDAYS.has(iso); };
// יום המסחר הבא בפועל אחרי day (לא כולל day עצמו) — מתקדם יום-יום ומדלג על סופי שבוע וחגים מהרשימה למעלה.
// עצירת בטיחות ב-10 ימים: אין רצף כזה של ימי לא-מסחר בלוח החגים הזה; מגן מפני לולאה אינסופית אם מישהו יזין תאריך שגוי.
export function nextTradingDay(day){
  let d = new Date(day + 'T00:00:00Z');
  for (let i = 0; i < 10; i++){
    d = new Date(d.getTime() + 86400000);
    const iso = d.toISOString().slice(0, 10);
    if (!isNonTradingDay(iso)) return iso;
  }
  return null;
}

// האם fillDay הוא יום המילוי היחיד שקביל לפקודות שהוחלט עליהן ב-signalDay? ביום מסחר רגיל זה חייב להיות אותו
// יום בדיוק: הסריקה הלילית (nightly-sp500.mjs) מתייגת לפי today() גולמי (UTC) שרץ אחרי חצות UTC — כך ש-signalDay
// כבר "היום הבא" מבחינת השעון, ותואם בדיוק ליום המילוי ב-09:40 ניו יורק של אותו יום. אין כאן שום סלחנות בין
// שני ימי מסחר (זה בדיוק המקרה שאמור עדיין להיחסם כ-stale — למשל pending תקוע מאתמול).
// חריגה אחת ויחידה מותרת: signalDay עצמו נופל ביום שאין בו מסחר (סוף שבוע, או חג מהרשימה למעלה) — הסריקה
// שרצה אחרי סגירת יום המסחר הקודם מתויגת בטעות לפי היום הזה, בזמן שמחיר 09:40 האמיתי (entry940) קיים רק ביום
// המסחר הבא. אז, ורק אז, מתקבל fillDay — אבל **ורק אם הוא בדיוק יום המסחר הבא**, לא כל יום מסחר בטווח קדימה:
// פקודה משבת חייבת להתמלא בשני (אם שני הוא יום מסחר רגיל), לא ביום שלישי — אחרת ה-preflight היה "סולח" גם
// למילוי מאוחר מדי, שמחליש את מהימנות המדידה בדיוק כמו מילוי מוקדם מדי.
export function isExpectedFillDay(signalDay, fillDay){
  if (fillDay === signalDay) return true;
  if (!isNonTradingDay(signalDay)) return false;
  return fillDay === nextTradingDay(signalDay);
}

// האם ההחלטה (decidedAt, חותמת ISO של הרגע שבו runTracksDecide רץ בפועל) נוצרה *לפני* 09:40 ניו יורק של יום
// המילוי? המחיר של entry940 הוא הרגע שבו הסימולציה "מבצעת" — אם ההחלטה עצמה נוצרה אחרי אותו רגע (למשל הרצה
// ידנית/חוזרת שקרתה מאוחר ביום, אחרי שמחיר ה-09:40 כבר היה ציטוט ציבורי ידוע), מילוי בדיעבד באותו מחיר הוא
// look-ahead: ה"החלטה" הייתה יכולה כבר להכיר את המחיר שאיתו היא "מבוצעת". בלי הבדיקה הזו ריצה ידנית מאוחרת
// יכולה למלא הזמנות במחיר שכבר לא באמת "עתידי" ביחס לרגע ההחלטה, ולפגוע באמינות המדידה בדיוק כמו מילוי מוקדם מדי.
export function decidedBeforeFillWindow(decidedAt, fillDay, h = 9, mi = 40){
  if (!decidedAt) return true; // אין חותמת (למשל pending ישן מלפני התיקון) — לא חוסמים למפרע
  const decidedMs = Date.parse(decidedAt); const windowMs = Date.parse(nyTimeIso(fillDay, h, mi));
  if (!Number.isFinite(decidedMs) || !Number.isFinite(windowMs)) return true;
  return decidedMs < windowMs;
}
