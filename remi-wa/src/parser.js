// פענוח עברית: זמנים, תאריכים ופקודות — בלי שום API חיצוני.

const DAY_WORDS = {
  'ראשון': 0, 'שני': 1, 'שלישי': 2, 'רביעי': 3,
  'חמישי': 4, 'שישי': 5, 'שבת': 6,
};

const PERIOD_DEFAULT_HOUR = {
  'בבוקר': 9,
  'בצהריים': 12,
  'בצהרים': 12,
  'אחר הצהריים': 16,
  'אחרי הצהריים': 16,
  'אחה"צ': 16,
  'אחהצ': 16,
  'בערב': 19,
  'בלילה': 21,
};

function cleanup(text) {
  return text
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,.:\-–]+|[\s,.:\-–]+$/g, '')
    .trim();
}

/**
 * מחלץ מהטקסט מועד (תאריך + שעה) בעברית חופשית.
 * מחזיר { at: Date | null, recurringDaily: boolean, rest: string }
 * rest = הטקסט אחרי הסרת ביטויי הזמן (כותרת התזכורת/האירוע).
 */
export function parseWhen(text, now = new Date()) {
  let t = ' ' + text + ' ';
  let recurringDaily = false;
  let day = null;          // Date עם תאריך היעד (בלי שעה)
  let hour = null, minute = 0;
  let periodHint = null;   // בערב / בבוקר וכו'
  let relative = null;     // מילישניות מעכשיו

  // "כל יום" — תזכורת יומית
  if (/\s(כל יום|בכל יום|כל בוקר)\s/.test(t)) {
    recurringDaily = true;
    if (/\sכל בוקר\s/.test(t)) periodHint = 'בבוקר';
    t = t.replace(/\s(כל יום|בכל יום|כל בוקר)\s/, ' ');
  }

  // ביטויים יחסיים: "בעוד 10 דקות", "עוד שעה", "בעוד חצי שעה", "שעתיים"
  const relRe = /\s(?:בעוד|עוד)\s+(רבע שעה|חצי שעה|שעה וחצי|שעתיים|שעה|דקה|יומיים|(\d+)\s*(דקות|דקה|שעות|שעה|ימים|יום))\s/;
  const relM = t.match(relRe);
  if (relM) {
    const word = relM[1];
    const n = relM[2] ? parseInt(relM[2], 10) : null;
    const unit = relM[3] || '';
    if (word === 'רבע שעה') relative = 15 * 60000;
    else if (word === 'חצי שעה') relative = 30 * 60000;
    else if (word === 'שעה וחצי') relative = 90 * 60000;
    else if (word === 'שעתיים') relative = 2 * 3600000;
    else if (word === 'שעה') relative = 3600000;
    else if (word === 'דקה') relative = 60000;
    else if (word === 'יומיים') relative = 2 * 86400000;
    else if (n !== null) {
      if (unit.startsWith('דק')) relative = n * 60000;
      else if (unit.startsWith('שע')) relative = n * 3600000;
      else relative = n * 86400000;
    }
    t = t.replace(relRe, ' ');
  }

  // מילות יום: היום / מחר / מחרתיים / ביום שלישי / יום שלישי
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (/\sמחרתיים\s/.test(t)) {
    day = new Date(today.getTime() + 2 * 86400000);
    t = t.replace(/\sמחרתיים\s/, ' ');
  } else if (/\sמחר\s/.test(t)) {
    day = new Date(today.getTime() + 86400000);
    t = t.replace(/\sמחר\s/, ' ');
  } else if (/\sהיום\s/.test(t)) {
    day = today;
    t = t.replace(/\sהיום\s/, ' ');
  } else if (/\sהערב\s/.test(t)) {
    day = today;
    periodHint = periodHint || 'בערב';
    t = t.replace(/\sהערב\s/, ' ');
  } else {
    const dayRe = new RegExp('\\s(?:ב?יום\\s+)(' + Object.keys(DAY_WORDS).join('|') + ')\\s');
    const dm = t.match(dayRe);
    if (dm) {
      const target = DAY_WORDS[dm[1]];
      let diff = (target - now.getDay() + 7) % 7;
      if (diff === 0) diff = 7; // "ביום שלישי" כשהיום שלישי => השבוע הבא
      day = new Date(today.getTime() + diff * 86400000);
      t = t.replace(dayRe, ' ');
    }
  }

  // תאריך מפורש: 25/7 או 25.7 או 25/7/2026
  const dateRe = /\s(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s/;
  const dateM = t.match(dateRe);
  if (dateM && !day) {
    const d = parseInt(dateM[1], 10);
    const mo = parseInt(dateM[2], 10) - 1;
    let y = dateM[3] ? parseInt(dateM[3], 10) : now.getFullYear();
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 0 && mo <= 11) {
      day = new Date(y, mo, d);
      if (!dateM[3] && day.getTime() < today.getTime()) day.setFullYear(y + 1);
      t = t.replace(dateRe, ' ');
    }
  }

  // מילות תקופה: בערב / בבוקר / בצהריים...
  for (const [word, h] of Object.entries(PERIOD_DEFAULT_HOUR)) {
    const re = new RegExp('\\s' + word.replace('"', '"?') + '\\s');
    if (re.test(t)) {
      periodHint = periodHint || word;
      t = t.replace(re, ' ');
      break;
    }
  }

  // שעה: "בשעה 14:30", "ב-9", "ב9:30", "14:30"
  const timeRe = /\s(?:בשעה\s*|ב-?\s?)(\d{1,2})(?:[:.](\d{2}))?\s/;
  let tm = t.match(timeRe);
  if (!tm) {
    const bareTimeRe = /\s(\d{1,2})[:.](\d{2})\s/;
    tm = t.match(bareTimeRe);
    if (tm) t = t.replace(bareTimeRe, ' ');
  } else {
    t = t.replace(timeRe, ' ');
  }
  if (tm) {
    hour = parseInt(tm[1], 10);
    minute = tm[2] ? parseInt(tm[2], 10) : 0;
    if (hour > 23 || minute > 59) { hour = null; minute = 0; }
  }

  // שילוב תקופה עם שעה: "ב-7 בערב" => 19:00
  if (hour !== null && periodHint) {
    const base = PERIOD_DEFAULT_HOUR[periodHint];
    if (base >= 12 && hour < 12) hour += 12;
  } else if (hour === null && periodHint) {
    hour = PERIOD_DEFAULT_HOUR[periodHint];
  }

  const rest = cleanup(t);

  // חישוב המועד הסופי
  let at = null;
  if (relative !== null) {
    at = new Date(now.getTime() + relative);
    if (hour !== null) at.setHours(hour, minute, 0, 0);
  } else if (day !== null) {
    at = new Date(day);
    at.setHours(hour !== null ? hour : 9, minute, 0, 0);
  } else if (hour !== null) {
    at = new Date(today);
    at.setHours(hour, minute, 0, 0);
    if (at.getTime() <= now.getTime()) at = new Date(at.getTime() + 86400000);
  } else if (recurringDaily) {
    at = new Date(today);
    at.setHours(9, 0, 0, 0);
    if (at.getTime() <= now.getTime()) at = new Date(at.getTime() + 86400000);
  }

  return { at, recurringDaily, rest };
}

/**
 * מזהה את סוג הפקודה מהודעת המשתמש.
 * מחזיר { cmd, ...fields }
 */
export function parseCommand(raw, now = new Date()) {
  const text = cleanup(raw);

  if (/^(עזרה|help|\?|פקודות)$/i.test(text)) return { cmd: 'help' };

  // תזכורות
  let m = text.match(/^(?:תזכיר לי|תזכירי לי|תזכורת[:\s])\s*(.+)$/s);
  if (m) {
    const { at, recurringDaily, rest } = parseWhen(m[1], now);
    if (!at) return { cmd: 'reminder_missing_time', text: cleanup(m[1]) };
    return { cmd: 'reminder_add', text: rest || 'תזכורת', at, recurringDaily };
  }
  if (/^(תזכורות|רשימת תזכורות|מה התזכורות)\??$/.test(text)) return { cmd: 'reminder_list' };
  m = text.match(/^(?:מחק|בטל|מחקי|בטלי)\s+תזכורת\s+(\d+)$/);
  if (m) return { cmd: 'reminder_delete', index: parseInt(m[1], 10) };

  // משימות
  m = text.match(/^(?:משימה|תוסיף משימה|הוסף משימה|הוסיפי משימה|תוסיפי משימה)[:\s]+(.+)$/s);
  if (m) return { cmd: 'task_add', text: cleanup(m[1]) };
  if (/^(משימות|רשימה|רשימת משימות|מה המשימות|מה יש לי ברשימה)\??$/.test(text)) return { cmd: 'task_list' };
  m = text.match(/^(?:סיימתי|בוצע|ביצעתי|עשיתי|✓|וי)\s+(?:משימה\s+)?(\d+)$/);
  if (m) return { cmd: 'task_done', index: parseInt(m[1], 10) };
  m = text.match(/^(?:מחק|מחקי)\s+משימה\s+(\d+)$/);
  if (m) return { cmd: 'task_delete', index: parseInt(m[1], 10) };
  if (/^(נקה משימות|מחק משימות שבוצעו)$/.test(text)) return { cmd: 'task_clear_done' };

  // יומן / אירועים
  m = text.match(/^(?:קבע|קבעי|אירוע[:\s]|פגישה[:\s])\s*(.+)$/s);
  if (m) {
    const { at, rest } = parseWhen(m[1], now);
    if (!at) return { cmd: 'event_missing_time', text: cleanup(m[1]) };
    return { cmd: 'event_add', text: rest || 'אירוע', at };
  }
  m = text.match(/^(?:מחק|בטל|מחקי|בטלי)\s+(?:אירוע|פגישה)\s+(\d+)$/);
  if (m) return { cmd: 'event_delete', index: parseInt(m[1], 10) };

  if (/^(מה יש לי היום|היום|סדר יום|יומן)\??$/.test(text)) return { cmd: 'agenda', range: 'today' };
  if (/^(מה יש לי מחר|מחר)\??$/.test(text)) return { cmd: 'agenda', range: 'tomorrow' };
  if (/^(מה יש לי השבוע|השבוע|מה יש לי)\??$/.test(text)) return { cmd: 'agenda', range: 'week' };

  return { cmd: 'unknown', text };
}
