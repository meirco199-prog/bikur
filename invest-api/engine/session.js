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
