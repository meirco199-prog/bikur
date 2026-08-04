// רמי — עוזר אישי חינמי בטלגרם, רץ על Cloudflare Workers (חינם לצמיתות).
// תזכורות מגיעות כהתראת טלגרם אמיתית — גם כשכל האפליקציות סגורות.
// נפרס אוטומטית מ-GitHub (ראה .github/workflows/deploy-remi.yml) — אין צורך בהדבקות ידניות.
//
// דרוש (מגדירים פעם אחת, ראה README):
//   BOT_TOKEN         — הטוקן מ-BotFather (משתנה סודי)
//   SECRET            — מחרוזת סודית שאתה ממציא (לאבטחת ה-webhook)
//   DATA              — KV namespace binding
//   Cron trigger: * * * * *  (כל דקה, לבדיקת תזכורות)
//
// אופציונלי (משדרג יכולות):
//   CALENDAR_ICS      — הכתובת הסודית של יומן גוגל (קריאת פגישות)
//   CALENDAR_WEBHOOK  — כתובת Apps Script לכתיבה ליומן גוגל (קביעת פגישות אמיתית)
//   AI                — Workers AI binding (קוליות, ניסוח, תרגום, תמונות)
//   BRIEF_HOUR        — שעת סיכום הבוקר (ברירת מחדל 8, "off" לביטול)
//   SUMMARY_HOUR      — שעת סיכום הערב (ברירת מחדל 21, "off" לביטול)

const IL_TZ = 'Asia/Jerusalem';

// ===== זמן ישראל =====
// כל הלוגיקה עובדת ב"שעון קיר" ישראלי: Date מוזז כך שה-getters (getHours וכו')
// מחזירים שעה ישראלית גם כשהשרת רץ ב-UTC.
// חישוב הפרש שעון ישראל עם מטמון לפי יום — Intl יקר מאוד במעבד, ואסור לנו
// להריץ אותו עשרות פעמים בכל דקה (התוכנית החינמית מגבילה CPU לכל הרצה)
const ilOffCache = new Map();
function ilOffset(ms) {
  const day = Math.floor(ms / 86400000);
  let off = ilOffCache.get(day);
  if (off === undefined) {
    const raw = new Date(new Date(ms).toLocaleString('en-US', { timeZone: IL_TZ })).getTime() - ms;
    off = Math.round(raw / 900000) * 900000; // ההפרש תמיד כפולה של רבע שעה (2 או 3 שעות)
    if (ilOffCache.size > 200) ilOffCache.clear();
    ilOffCache.set(day, off);
  }
  return off;
}
function ilNow() {
  const t = Date.now();
  return new Date(t + ilOffset(t));
}
function ilWallMs(realDate) {
  const t = realDate.getTime();
  return t + ilOffset(t);
}
// המרה משעון קיר ישראלי חזרה לזמן אמיתי (בשביל יומן גוגל)
function ilToRealMs(shiftedMs) {
  const now = new Date();
  const offset = ilWallMs(now) - now.getTime();
  return shiftedMs - offset;
}
// המרת מספר לגימטריה: 11 → י"א, 786 → תשפ"ו
function gematria(n) {
  const VALS = [[400,'ת'],[300,'ש'],[200,'ר'],[100,'ק'],[90,'צ'],[80,'פ'],[70,'ע'],[60,'ס'],[50,'נ'],[40,'מ'],[30,'ל'],[20,'כ'],[10,'י'],[9,'ט'],[8,'ח'],[7,'ז'],[6,'ו'],[5,'ה'],[4,'ד'],[3,'ג'],[2,'ב'],[1,'א']];
  let s = '';
  while (n > 0) {
    if (n === 15) { s += 'טו'; break; } // ט"ו במקום י-ה
    if (n === 16) { s += 'טז'; break; } // ט"ז במקום י-ו
    for (const [v, l] of VALS) {
      if (n >= v) { s += l; n -= v; break; }
    }
  }
  if (s.length === 1) return s + '׳';
  return s.slice(0, -1) + '״' + s.slice(-1);
}

export function hebrewDate() {
  const parts = new Intl.DateTimeFormat('he-u-ca-hebrew', { timeZone: IL_TZ, day: 'numeric', month: 'long', year: 'numeric' }).formatToParts(new Date());
  const day = parseInt(parts.find(p => p.type === 'day')?.value || '1', 10);
  const month = parts.find(p => p.type === 'month')?.value || '';
  const year = parseInt(parts.find(p => p.type === 'year')?.value || '5786', 10);
  return `${gematria(day)} ב${month} ה${gematria(year % 1000)}`;
}

// ===== מפענח עברית =====

const DAY_WORDS = { 'ראשון':0,'שני':1,'שלישי':2,'רביעי':3,'חמישי':4,'שישי':5,'שבת':6 };
const DAY_NAMES = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const PERIOD_DEFAULT_HOUR = {
  'בבוקר':9,'בצהריים':12,'בצהרים':12,'אחר הצהריים':16,'אחרי הצהריים':16,
  'אחה"צ':16,'אחהצ':16,'בערב':19,'בלילה':21,
};

function cleanup(text) {
  return text
    .replace(/[‎‏‪-‮⁦-⁩﻿]/g, '') // תווי כיווניות בלתי-נראים
    .replace(/\s{2,}/g,' ')
    .replace(/^[\s,.:\-–"'״׳]+|[\s,.:\-–"'״׳]+$/g,'')
    .trim();
}

export function parseWhen(text, now) {
  let t = ' ' + text + ' ';
  let recurringDaily = false, recurringWeekly = null;
  let day = null, hour = null, minute = 0, periodHint = null, relative = null;

  // "כל יום ראשון" — תזכורת שבועית (לפני הבדיקה של "כל יום"!)
  const weeklyRe = new RegExp('\\sכל (?:יום )?(' + Object.keys(DAY_WORDS).join('|') + ')\\s');
  const wm = t.match(weeklyRe);
  if (wm) {
    recurringWeekly = DAY_WORDS[wm[1]];
    t = t.replace(weeklyRe, ' ');
  } else if (/\s(כל יום|בכל יום|כל בוקר)\s/.test(t)) {
    recurringDaily = true;
    if (/\sכל בוקר\s/.test(t)) periodHint = 'בבוקר';
    t = t.replace(/\s(כל יום|בכל יום|כל בוקר)\s/, ' ');
  }

  const relRe = /\s(?:בעוד|עוד)\s+(רבע שעה|חצי שעה|שעה וחצי|שעתיים|שעה|דקה|יומיים|(\d+)\s*(דקות|דקה|שעות|שעה|ימים|יום))\s/;
  const relM = t.match(relRe);
  if (relM) {
    const w = relM[1], n = relM[2] ? parseInt(relM[2],10) : null, unit = relM[3] || '';
    if (w === 'רבע שעה') relative = 15*60000;
    else if (w === 'חצי שעה') relative = 30*60000;
    else if (w === 'שעה וחצי') relative = 90*60000;
    else if (w === 'שעתיים') relative = 2*3600000;
    else if (w === 'שעה') relative = 3600000;
    else if (w === 'דקה') relative = 60000;
    else if (w === 'יומיים') relative = 2*86400000;
    else if (n !== null) {
      if (unit.startsWith('דק')) relative = n*60000;
      else if (unit.startsWith('שע')) relative = n*3600000;
      else relative = n*86400000;
    }
    t = t.replace(relRe, ' ');
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (/\s[לב]?מחרתיים\s/.test(t)) { day = new Date(today.getTime()+2*86400000); t = t.replace(/\s[לב]?מחרתיים\s/,' '); }
  else if (/\s[לב]?מחר\s/.test(t)) { day = new Date(today.getTime()+86400000); t = t.replace(/\s[לב]?מחר\s/,' '); }
  else if (/\sל?היום\s/.test(t)) { day = today; t = t.replace(/\sל?היום\s/,' '); }
  else if (/\sל?הערב\s/.test(t)) { day = today; periodHint = periodHint || 'בערב'; t = t.replace(/\sל?הערב\s/,' '); }
  else {
    const dayRe = new RegExp('\\s(?:[לב]?יום\\s+)(' + Object.keys(DAY_WORDS).join('|') + ')(?:\\s+(?:הקרוב|הבא))?\\s');
    const dm = t.match(dayRe);
    if (dm) {
      let diff = (DAY_WORDS[dm[1]] - now.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      day = new Date(today.getTime() + diff*86400000);
      t = t.replace(dayRe, ' ');
    }
  }

  const dateRe = /\s[לב]?-?(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s/;
  const dateM = t.match(dateRe);
  if (dateM && !day) {
    const d = parseInt(dateM[1],10), mo = parseInt(dateM[2],10)-1;
    let y = dateM[3] ? parseInt(dateM[3],10) : now.getFullYear();
    if (y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 0 && mo <= 11) {
      day = new Date(y, mo, d);
      if (!dateM[3] && day.getTime() < today.getTime()) day.setFullYear(y+1);
      t = t.replace(dateRe, ' ');
    }
  }

  for (const [word, h] of Object.entries(PERIOD_DEFAULT_HOUR)) {
    const re = new RegExp('\\s' + word.replace('"','"?') + '\\s');
    if (re.test(t)) { periodHint = periodHint || word; t = t.replace(re,' '); break; }
  }

  const timeRe = /\s(?:בשעה\s*|[בל]-?\s?)(\d{1,2})(?:[:.](\d{2}))?\s/;
  let tm = t.match(timeRe);
  if (!tm) {
    const bare = /\s(\d{1,2})[:.](\d{2})\s/;
    tm = t.match(bare);
    if (tm) t = t.replace(bare, ' ');
  } else t = t.replace(timeRe, ' ');
  if (tm) {
    hour = parseInt(tm[1],10);
    minute = tm[2] ? parseInt(tm[2],10) : 0;
    if (hour > 23 || minute > 59) { hour = null; minute = 0; }
  }

  if (hour !== null && periodHint) {
    if (PERIOD_DEFAULT_HOUR[periodHint] >= 12 && hour < 12) hour += 12;
  } else if (hour === null && periodHint) {
    hour = PERIOD_DEFAULT_HOUR[periodHint];
  }

  const rest = cleanup(t);
  let at = null;
  if (recurringWeekly !== null) {
    let diff = (recurringWeekly - now.getDay() + 7) % 7;
    at = new Date(today.getTime() + diff*86400000);
    at.setHours(hour !== null ? hour : 9, minute, 0, 0);
    if (at.getTime() <= now.getTime()) at = new Date(at.getTime() + 7*86400000);
  } else if (relative !== null) {
    at = new Date(now.getTime() + relative);
    if (hour !== null) at.setHours(hour, minute, 0, 0);
  } else if (day !== null) {
    at = new Date(day); at.setHours(hour !== null ? hour : 9, minute, 0, 0);
  } else if (hour !== null) {
    at = new Date(today); at.setHours(hour, minute, 0, 0);
    if (at.getTime() <= now.getTime()) at = new Date(at.getTime() + 86400000);
  } else if (recurringDaily) {
    at = new Date(today); at.setHours(9, 0, 0, 0);
    if (at.getTime() <= now.getTime()) at = new Date(at.getTime() + 86400000);
  }
  // explicitTime: יש שעה/פרק זמן מפורש — לא רק מילת יום כמו "היום"/"מחר"
  const explicitTime = hour !== null || relative !== null || recurringDaily || recurringWeekly !== null;
  return { at, recurringDaily, recurringWeekly, rest, explicitTime };
}

// מסיר מילות מילוי מכותרת אירוע/תזכורת ("קבע לי ביומן פגישה..." → "פגישה...")
function stripFiller(text) {
  return cleanup(text.replace(/^לי\s+/, '').replace(/\sביומן\s/g, ' ').replace(/^ביומן\s+/, ''));
}

// חילוץ שם מתוך "קוראים לי מאיר כהן תז 03..." — עוצר לפני מספרים/ת"ז
function extractName(s) {
  const words = s.split(/\s+/);
  const out = [];
  for (const w of words) {
    if (/\d/.test(w) || /^ת"?ז$/.test(w) || w === 'בן' || w === 'בת') break;
    out.push(w);
    if (out.length >= 3) break;
  }
  return out.join(' ');
}

export function parseCommand(raw, now) {
  const text = cleanup(raw);
  if (/^(עזרה|help|\/help|\/start|\?|פקודות|מה אתה יודע( לעשות)?|מה אפשר( לעשות)?)\??$/i.test(text)) return { cmd:'help' };

  // הודעת "תשמור את הפרטים שלי" — פרטים אישיים מלאים, גם רב-שורתית
  if (/(?:תשמור|שמור)\s+(?:את\s+)?הפרטים/.test(text) ||
      (/^(?:קוראים לי|שמי)\s/.test(text) && text.includes('\n'))) {
    return { cmd:'profile_dump', text };
  }

  // פרופיל אישי
  let m = text.match(/^(?:קוראים לי|תקרא לי|שמי)\s+([^\n]+)$/);
  if (m) return { cmd:'profile_name', name: extractName(cleanup(m[1])) || cleanup(m[1]) };
  m = text.match(/^אני בן\s+(\d+)/);
  if (m) return { cmd:'profile_age', age: parseInt(m[1],10) };
  m = text.match(/^(?:עליי|עלי|תדע עליי)[:\s]+(.+)$/s);
  if (m) return { cmd:'profile_fact', text: cleanup(m[1]) };
  if (/^(מי אני|פרופיל)\??$/.test(text)) return { cmd:'profile_show' };

  // תאריך (כולל עברי)
  if (/^(?:מה|איזה|תגיד(?: לי)?)?\s*(?:ה)?תאריך(?:\s+(?:היום|העברי|עברי))*\??$/.test(text) ||
      /^מה התאריך העברי של היום\??$/.test(text)) return { cmd:'date_info' };

  // תזכורת משימות יומית: "תזכורת משימות כל בוקר (ב-8)" / "תזכיר לי כל בוקר את המשימות הפתוחות"
  // חייב לבוא לפני זיהוי תזכורת רגילה — אחרת "תזכורת משימות..." הופכת לתזכורת-הד
  if (/משימות/.test(text) && /כל (?:בוקר|ערב|יום)/.test(text) &&
      /(תזכורת|תזכיר|שלח|תשלח|תן|תיתן|שיתן|הצג|תציג)/.test(text)) {
    if (/^(בטל|מחק|עצור|תפסיק)/.test(text)) return { cmd: 'tasks_digest_off' };
    const hm = (' ' + text + ' ').match(/\s(?:בשעה\s*|ב-?\s?)(\d{1,2})(?:[:.](\d{2}))?\s/);
    const hour = hm ? parseInt(hm[1], 10) : (/כל ערב/.test(text) ? 20 : 8);
    return { cmd: 'tasks_digest', hour, minute: hm && hm[2] ? parseInt(hm[2], 10) : 0 };
  }
  if (/^(?:בטל|מחק)\s+(?:את\s+)?תזכורת\s+ה?משימות$/.test(text)) return { cmd: 'tasks_digest_off' };

  // התראה לפני פגישות: "תזכורת פגישות 15 דקות" / "בטל תזכורת פגישות" (ברירת מחדל: 10 דק')
  m = text.match(/^תזכורת פגישות\s+(\d{1,3})(?:\s+דקות)?(?:\s+לפני)?$/);
  if (m) return { cmd: 'meeting_ping', minutes: parseInt(m[1], 10) };
  if (/^(?:בטל|כבה)\s+תזכורת\s+פגישות$/.test(text)) return { cmd: 'meeting_ping', minutes: 0 };

  // תזכורות
  m = text.match(/^(?:תזכיר לי|תזכירי לי|תזכורת[:\s])\s*(.+)$/s);
  if (m) {
    const { at, recurringDaily, recurringWeekly, rest } = parseWhen(m[1], now);
    if (!at) return { cmd:'reminder_missing_time', text: cleanup(m[1]) };
    return { cmd:'reminder_add', text: stripFiller(rest) || 'תזכורת', at, recurringDaily, recurringWeekly };
  }
  if (/^(תזכורות|רשימת תזכורות|מה התזכורות)\??$/.test(text)) return { cmd:'reminder_list' };
  m = text.match(/^(?:מחק|בטל|מחקי|בטלי)\s+תזכורת\s+(\d+)$/);
  if (m) return { cmd:'reminder_delete', index: parseInt(m[1],10) };
  m = text.match(/^(?:דחה|נודניק)(?:\s+(?:ב-?\s*)?(\d+))?$/);
  if (m) return { cmd:'snooze', minutes: m[1] ? parseInt(m[1],10) : 10 };

  // משימות
  m = text.match(/^(?:משימה|תוסיף משימה|הוסף משימה|הוסיפי משימה|תוסיפי משימה)[:\s]+(.+)$/s);
  if (m) return { cmd:'task_add', text: cleanup(m[1]) };
  if (/^(משימות|רשימה|רשימת משימות|מה המשימות|מה יש לי ברשימה)\??$/.test(text)) return { cmd:'task_list' };
  // ניסוחים חופשיים של בקשת משימות — "איזה משימות פתוחות יש לי" / "שלח לי משימות" —
  // תמיד רשימת המשימות, לא היומן ולא חיפוש מסמכים!
  if (/^(?:איזה|אילו|מה|שלח לי|תשלח לי|תן לי|הבא לי|הצג|תציג)?\s*(?:את\s+)?(?:ה)?משימות(?:\s+ה?פתוחות)?(?:\s+(?:יש לי|שלי|נשארו(?:\s+לי)?))?\??$/.test(text)) return { cmd:'task_list' };
  m = text.match(/^(?:סיימתי|בוצע|ביצעתי|עשיתי|✓|וי)\s+(?:משימה\s+)?(\d+)$/);
  if (m) return { cmd:'task_done', index: parseInt(m[1],10) };
  m = text.match(/^(?:מחק|מחקי)\s+משימה\s+(\d+)$/);
  if (m) return { cmd:'task_delete', index: parseInt(m[1],10) };
  if (/^(נקה משימות|מחק משימות שבוצעו)$/.test(text)) return { cmd:'task_clear_done' };

  // רשימת קניות
  m = text.match(/^(?:רשימת קניות|קניות|תוסיף לקניות|הוסף לקניות)[:\s]+(.+)$/s);
  if (m) {
    const items = m[1].split(/[,\n]+/).map(cleanup).filter(x => x.length > 0);
    if (items.length) return { cmd:'shop_add', items };
  }
  if (/^(קניות|רשימת קניות)\??$/.test(text)) return { cmd:'shop_list' };
  m = text.match(/^(?:קניתי|נקנה)\s+(\d+)$/);
  if (m) return { cmd:'shop_bought', index: parseInt(m[1],10) };
  if (/^(נקה קניות|מחק קניות)$/.test(text)) return { cmd:'shop_clear' };

  // זיכרונות
  m = text.match(/^(?:זכור|תזכור|שמור|זיכרון|רעיון|הערה)[:\s]+(.+)$/s);
  if (m) return { cmd:'note_add', text: cleanup(m[1]) };
  if (/^(זיכרונות|רשימת זיכרונות|הערות)\??$/.test(text)) return { cmd:'note_list' };
  m = text.match(/^(?:מחק|מחקי)\s+זיכרון\s+(\d+)$/);
  if (m) return { cmd:'note_delete', index: parseInt(m[1],10) };

  // בריאות — משקל
  m = text.match(/^משקל[:\s]+(\d+(?:[.,]\d+)?)$/);
  if (m) return { cmd:'weight_log', kg: parseFloat(m[1].replace(',', '.')) };
  if (/^(משקל|בריאות)\??$/.test(text)) return { cmd:'weight_show' };

  // ניסוח ותרגום (דורש AI)
  m = text.match(/^(?:נסח|תנסח|כתוב|תכתוב)(?:\s+לי)?[:\s]+(.+)$/s);
  if (m) return { cmd:'draft', text: cleanup(m[1]) };
  m = text.match(/^(?:תרגם|תרגמי|targem)(?:\s+לי)?(?:\s+ל(אנגלית|עברית|צרפתית|ספרדית|רוסית|ערבית))?[:\s]+(.+)$/s);
  if (m) return { cmd:'translate', lang: m[1] || 'עברית', text: cleanup(m[2]) };

  // מסמכים
  if (/^(מסמכים|רשימת מסמכים|הקבצים שלי)\??$/.test(text)) return { cmd:'doc_list' };
  m = text.match(/^(?:שלח|תשלח)(?:\s+לי)?\s+(?:מסמך\s+)?(\d+)$/) || text.match(/^מסמך\s+(\d+)$/);
  if (m) return { cmd:'doc_send', index: parseInt(m[1],10) };
  m = text.match(/^(?:מחק|מחקי)\s+מסמך\s+(\d+)$/);
  if (m) return { cmd:'doc_delete', index: parseInt(m[1],10) };
  m = text.match(/^(?:מחק|תמחק|מחקי|תמחקי)\s+(?:לי\s+)?(?:את\s+)?ה?(?:מסמך|תמונה|צילום|קובץ)\s+(?:של\s+)?(.+)$/);
  if (m) return { cmd:'doc_delete_name', query: cleanup(m[1]) };
  // חיפוש בג'ימייל (קריאה בלבד): "חפש (לי) במייל חשבונית ארנונה"
  m = text.match(/^(?:חפש|תחפש|מצא|תמצא)(?:\s+לי)?\s+ב(?:מייל(?:ים)?|ג'?ימייל|דוא"?ל)\s+(?:את\s+)?(.+)$/);
  if (m) return { cmd:'gmail_search', query: cleanup(m[1]) };
  // חיפוש בוואטסאפ — אין גישה מבחוץ (מוצפן) — עונים בכנות ומחפשים בארכיון של הבוט
  m = text.match(/^(?:חפש|תחפש|מצא|תמצא)(?:\s+לי)?\s+ב(?:וואטסאפ|ווטסאפ|וואצאפ|ואטסאפ)\s+(?:את\s+)?(.+)$/);
  if (m) return { cmd:'wa_search_info', query: cleanup(m[1]) };

  m = text.match(/^(?:איפה|שלח לי|תשלח לי|הבא לי)\s+(?:את\s+)?(.+)$/);
  if (m) return { cmd:'doc_find', query: cleanup(m[1]) };

  // חיפוש חופשי בכל מה ששמור
  m = text.match(/^(?:חפש|מצא|תמצא)\s+(.+)$/s);
  if (m) return { cmd:'search', query: cleanup(m[1]) };

  // יומן / אירועים
  m = text.match(/^(?:קבע|קבעי|תקבע|תקבעי|אירוע[:\s]|פגישה[:\s])\s*(.+)$/s);
  if (m) {
    const { at, rest } = parseWhen(m[1], now);
    if (!at) return { cmd:'event_missing_time', text: stripFiller(cleanup(m[1])) };
    // אם נשארו בטקסט עוד תאריך או שעה — כנראה כמה אירועים בהודעה אחת; המוח יפצל
    const more = /\s[ובל]{0,2}-?\d{1,2}[./]\d{1,2}(\s|$)/.test(' ' + rest + ' ') || /\d{1,2}:\d{2}/.test(rest);
    return { cmd:'event_add', text: stripFiller(rest) || 'אירוע', at, loose: more };
  }
  m = text.match(/^(?:מחק|בטל|מחקי|בטלי)\s+(?:אירוע|פגישה)\s+(\d+)$/);
  if (m) return { cmd:'event_delete', index: parseInt(m[1],10) };
  // ביטול יום שלם: "בטל את כל הפגישות ביום ראשון" / "של מחר" / "היום"
  m = text.match(/^(?:בטל|תבטל|מחק|תמחק)\s+(?:לי\s+)?(?:את\s+)?כל\s+הפגישות(?:\s+(.+))?$/);
  if (m) return { cmd:'events_clear_day', when: cleanup(m[1] || 'היום') };

  if (/^(מה יש לי היום|היום|סדר יום|יומן)\??$/.test(text)) return { cmd:'agenda', range:'today' };
  if (/^(מה יש לי מחר|מחר)\??$/.test(text)) return { cmd:'agenda', range:'tomorrow' };
  if (/^(מה יש לי השבוע|השבוע|מה יש לי)\??$/.test(text)) return { cmd:'agenda', range:'week' };

  if (/^(סיכום שבוע|סיכום שבועי|סטטיסטיקה)\??$/.test(text)) return { cmd:'week_summary' };
  if (/^(סיכום היום|מה עשינו היום|סיכום יומי)\??$/.test(text)) return { cmd:'day_summary' };
  m = text.match(/^(?:סיכום|ציר זמן)\s+(\d+)\s+(?:ימים|יום)(?:\s+אחרונים)?$/);
  if (m) return { cmd:'period_summary', days: parseInt(m[1],10) };
  if (/^ציר זמן\??$/.test(text)) return { cmd:'period_summary', days: 14 };

  // נתב כוונות: טקסט חופשי קצר שמכיל זמן — כנראה תזכורת ("מחר ב-16:00 תור לרופא").
  // שאלות הן לא תזכורת, והודעות ארוכות/רב-שורתיות הן לא תזכורת! (בלי \b — לא עובד בעברית)
  const isQuestion = /\?/.test(text) || /^(מה|מתי|איזה|אילו|כמה|האם|מי|איך|למה|איפה)(\s|$)/.test(text);
  const isShortLine = !text.includes('\n') && text.length <= 80;
  if (!isQuestion && isShortLine) {
    const w = parseWhen(text, now);
    if (w.at && w.explicitTime && w.rest && w.rest.length >= 2 && w.rest !== text) {
      return { cmd:'reminder_add', text: stripFiller(w.rest), at: w.at,
               recurringDaily: w.recurringDaily, recurringWeekly: w.recurringWeekly, auto: true };
    }
  }

  // ניסוחים חופשיים של שאלת יומן — ניחוש רך (loose): ה-AI מקבל עדיפות אם הוא מחובר
  if (isShortLine && (/ביומן|פגיש/.test(text) || /^(מה יש לי|מה קורה|מה מתוכנן|מה הלו"?ז)(\s|$)/.test(text))) {
    const range = /מחר/.test(text) ? 'tomorrow' : /שבוע/.test(text) ? 'week' : 'today';
    return { cmd:'agenda', range, loose: true };
  }

  // הודעה ארוכה או רב-שורתית שאינה פקודה — נשמור בזיכרון שלא תלך לאיבוד
  if (text.includes('\n') || text.length >= 60) {
    return { cmd:'note_add', text, auto: true };
  }

  return { cmd:'unknown', text };
}

// ===== קריאת יומן גוגל (כתובת iCal סודית — בלי OAuth) =====

function parseIcsDate(value, tzid) {
  let m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { ms: new Date(+m[1], +m[2]-1, +m[3]).getTime(), allDay: true };
  m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  if (m[7] === 'Z') {
    const real = new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]));
    return { ms: ilWallMs(real), allDay: false };
  }
  return { ms: new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]).getTime(), allDay: false };
}

const BYDAY_MAP = { SU:0, MO:1, TU:2, WE:3, TH:4, FR:5, SA:6 };

export function parseICS(ics, from, to) {
  const unfolded = ics.replace(/\r?\n[ \t]/g, '');
  const lines = unfolded.split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = { exdates: [] }; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const keyPart = line.slice(0, idx), value = line.slice(idx + 1);
    const [key, ...params] = keyPart.split(';');
    const tzid = (params.find(p => p.startsWith('TZID=')) || '').slice(5);
    if (key === 'DTSTART') cur.start = parseIcsDate(value, tzid);
    else if (key === 'SUMMARY') cur.summary = value.replace(/\\,/g, ',').replace(/\\n/g, ' ').replace(/\\;/g, ';');
    else if (key === 'LOCATION') cur.loc = value.replace(/\\,/g, ',').replace(/\\n/g, ' ').replace(/\\;/g, ';');
    else if (key === 'RRULE') cur.rrule = value;
    else if (key === 'EXDATE') value.split(',').forEach(v => { const d = parseIcsDate(v, tzid); if (d) cur.exdates.push(d.ms); });
    else if (key === 'STATUS') cur.status = value;
    else if (key === 'UID') cur.uid = value;
    else if (key === 'RECURRENCE-ID') { const d = parseIcsDate(value, tzid); if (d) cur.recurrenceId = d.ms; }
  }

  const movedByUid = new Map();
  for (const e of events) {
    if (e.recurrenceId && e.uid) {
      if (!movedByUid.has(e.uid)) movedByUid.set(e.uid, new Set());
      movedByUid.get(e.uid).add(e.recurrenceId);
    }
  }

  const out = [];
  for (const e of events) {
    if (!e.start || !e.summary || e.status === 'CANCELLED') continue;
    const title = e.summary;
    if (!e.rrule) {
      if (e.start.ms >= from && e.start.ms < to) out.push({ at: e.start.ms, text: title, allDay: e.start.allDay, loc: e.loc || '' });
      continue;
    }
    const rule = {};
    e.rrule.split(';').forEach(p => { const [k,v] = p.split('='); rule[k] = v; });
    const interval = parseInt(rule.INTERVAL || '1', 10);
    const until = rule.UNTIL ? parseIcsDate(rule.UNTIL, '')?.ms : null;
    const startDate = new Date(e.start.ms);
    const startDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()).getTime();
    const timeOfDay = e.start.ms - startDay;
    const byday = rule.BYDAY ? rule.BYDAY.split(',').map(d => BYDAY_MAP[d.slice(-2)]).filter(d => d !== undefined) : null;
    const moved = (e.uid && movedByUid.get(e.uid)) || new Set();

    for (let dayMs = Math.max(from - 86400000, startDay); dayMs < to; dayMs += 86400000) {
      const d = new Date(dayMs);
      const candidate = dayMs + timeOfDay;
      if (candidate < from || candidate >= to || candidate < e.start.ms) continue;
      if (until && candidate > until) continue;
      let match = false;
      const daysDiff = Math.round((dayMs - startDay) / 86400000);
      if (rule.FREQ === 'DAILY') match = daysDiff % interval === 0;
      else if (rule.FREQ === 'WEEKLY') {
        const weeksDiff = Math.floor(daysDiff / 7);
        const dayMatch = byday ? byday.includes(d.getDay()) : d.getDay() === startDate.getDay();
        match = dayMatch && (Math.floor((daysDiff - ((d.getDay() - startDate.getDay() + 7) % 7)) / 7) % interval === 0 || weeksDiff % interval === 0);
      } else if (rule.FREQ === 'MONTHLY') match = d.getDate() === startDate.getDate();
      else if (rule.FREQ === 'YEARLY') match = d.getDate() === startDate.getDate() && d.getMonth() === startDate.getMonth();
      if (!match) continue;
      if (e.exdates.some(x => Math.abs(x - candidate) < 1000)) continue;
      if ([...moved].some(x => Math.abs(x - candidate) < 1000)) continue;
      out.push({ at: candidate, text: title, allDay: e.start.allDay, loc: e.loc || '' });
    }
  }
  return out.sort((a,b) => a.at - b.at);
}

// מטמון ליומן גוגל — במקום להוריד ולפענח את כל הקובץ בכל דקה
let icsCache = { url: '', ts: 0, text: '' };
async function fetchCalendar(env, from, to) {
  if (!env || !env.CALENDAR_ICS) return [];
  try {
    const nowT = Date.now();
    if (icsCache.url !== env.CALENDAR_ICS || nowT - icsCache.ts > 5 * 60000) {
      const res = await fetch(env.CALENDAR_ICS);
      if (!res.ok) return [];
      icsCache = { url: env.CALENDAR_ICS, ts: nowT, text: await res.text() };
    }
    return parseICS(icsCache.text, from, to);
  } catch { return []; }
}

// מחיקה מיומן גוגל דרך הגשר (מוצא אירועים עם אותה כותרת סביב אותו מועד)
async function deleteFromGoogleCalendar(env, title, shiftedMs) {
  if (!env || !env.CALENDAR_WEBHOOK) return false;
  try {
    const res = await fetch(env.CALENDAR_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.SECRET, action: 'delete', title, startMs: ilToRealMs(shiftedMs) }),
      redirect: 'follow',
    });
    return res.ok && (await res.text()).includes('ok');
  } catch { return false; }
}

// כתיבה ליומן גוגל דרך גשר Apps Script (ראה README)
async function pushToGoogleCalendar(env, title, shiftedMs, location) {
  if (!env || !env.CALENDAR_WEBHOOK) return false;
  try {
    const res = await fetch(env.CALENDAR_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.SECRET, title, startMs: ilToRealMs(shiftedMs), durationMin: 60, location: location || '' }),
      redirect: 'follow',
    });
    return res.ok && (await res.text()).includes('ok');
  } catch { return false; }
}

// חיפוש בג'ימייל של הבעלים — קריאה בלבד, דרך אותו גשר Apps Script של היומן.
// מחזיר רשימת תוצאות (נושא, שולח, תאריך, קבצים מצורפים וקישור) או null בתקלה.
async function searchGmailViaBridge(env, query) {
  if (!env || !env.CALENDAR_WEBHOOK) return null;
  try {
    const res = await fetch(env.CALENDAR_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: env.SECRET, action: 'gmail_search', q: query }),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const j = JSON.parse(await res.text());
    return j && j.ok && Array.isArray(j.results) ? j.results : null;
  } catch { return null; }
}

// ===== המוח החכם: Claude API (אם חובר) עם נפילה ל-Workers AI החינמי =====
// שדרוג אופציונלי: מוסיפים Secret בשם ANTHROPIC_API_KEY — וכל ההבנה, הניסוח,
// התרגום וקריאת התמונות עוברים ל-Claude (עברית מצוינת). בלי המפתח — הכול
// ממשיך לעבוד על Workers AI החינמי. (קריאה ישירה ב-fetch — ב-Worker מודבק
// בדשבורד אין אפשרות להתקין SDK.)

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}

async function claudeCall(env, content, maxTokens = 3000) {
  if (!env?.ANTHROPIC_API_KEY) return null;
  const model = env.CLAUDE_MODEL || 'claude-opus-5';
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content }],
  };
  // effort מוריד עלות/השהיה; נתמך באופוס/סונט 5 אך לא בהאיקו
  if (/opus-5|sonnet-5|fable/.test(model)) body.output_config = { effort: 'low' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) { console.log('claude error:', res.status, await res.text()); return null; }
    const data = await res.json();
    if (data.stop_reason === 'refusal') return null;
    const block = (data.content || []).find(b => b.type === 'text');
    return block?.text?.trim() || null;
  } catch (e) {
    console.log('claude fetch failed:', e.message);
    return null;
  }
}

async function aiText(env, prompt) {
  const fromClaude = await claudeCall(env, prompt);
  if (fromClaude) return fromClaude;
  if (!env || !env.AI) return null;
  for (const model of ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct']) {
    try {
      const r = await env.AI.run(model, { prompt, max_tokens: 900 });
      if (r?.response) return r.response.trim();
    } catch {}
  }
  return null;
}

async function aiVision(env, imageBytes, instruction) {
  const prompt = instruction + '\nענה בעברית בלבד, בקצרה ולעניין.';
  // Claude קורא עברית מתמונות (כולל כתב יד) ברמה גבוהה בהרבה מהמודלים החינמיים
  const fromClaude = await claudeCall(env, [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: bytesToB64(imageBytes) } },
    { type: 'text', text: prompt },
  ]);
  if (fromClaude) return fromClaude;
  if (!env || !env.AI) return null;
  for (const model of ['@cf/meta/llama-3.2-11b-vision-instruct', '@cf/llava-hf/llava-1.5-7b-hf']) {
    try {
      const r = await env.AI.run(model, { prompt, image: [...imageBytes], max_tokens: 700 });
      const txt = r?.response || r?.description;
      if (txt) return txt.trim();
    } catch {}
  }
  return null;
}

// ===== ניסוח =====

function fmtTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
}
function fmtDate(ts, now) {
  const d = new Date(ts);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((that - today)/86400000);
  if (diff === 0) return `היום בשעה ${fmtTime(ts)}`;
  if (diff === 1) return `מחר בשעה ${fmtTime(ts)}`;
  if (diff > 1 && diff < 7) return `יום ${DAY_NAMES[d.getDay()]} בשעה ${fmtTime(ts)}`;
  return `${d.getDate()}/${d.getMonth()+1} בשעה ${fmtTime(ts)}`;
}
function fmtIcsEvent(e, now) {
  return e.allDay
    ? `${fmtDate(e.at, now).replace(/ בשעה.*$/, '')} (כל היום) — ${e.text}`
    : `${fmtDate(e.at, now)} — ${e.text}`;
}
function firstName(S) {
  return S.profile?.name ? S.profile.name.split(' ')[0] : null;
}
function greet(S) {
  const n = firstName(S);
  return n ? `${n}, ` : '';
}

function helpText(S) {
  const n = firstName(S);
  return `היי${n ? ' ' + n : ''}, אני רמי — העוזר האישי שלך 🤖
אפשר לדבר איתי בשפה חופשית לגמרי — אני מבין 🙂
ההתראות שלי מגיעות תמיד, גם כשהכול סגור.

⏰ תזכורות
• תזכיר לי מחר ב-9 להתקשר לדני / בעוד 20 דקות...
• כל יום ב-8... / כל יום ראשון ב-18:00...
• גם בלי "תזכיר לי": "מחר ב-16:00 תור לרופא"
• דחה 10 / תזכורות / מחק תזכורת 2

📅 יומן
• קבע פגישה עם דני ביום רביעי ב-14:00
• תעביר את הפגישה עם דני ליום חמישי ב-15:00
• בטל את הפגישה עם דני
• מה יש לי היום / מחר / השבוע / איזה פגישות יש לי?
• 🔔 התראה אוטומטית 10 דק' לפני כל פגישה ("תזכורת פגישות 15 דקות" לשינוי, "בטל תזכורת פגישות" לכיבוי)
(עם חיבור יומן גוגל — רואה וקובע ביומן האמיתי)

📋 משימות: משימה: X / משימות (עם כפתורי ✅ בוצעה / ❌ ביטול)
   "תזכורת משימות כל בוקר" — רשימת הפתוחות כל יום
🛒 קניות: קניות: חלב, לחם / קניות / קניתי 2
🧠 זיכרונות: זכור: X / זיכרונות / חפש X

📄 מסמכים — שלח תמונה/קובץ עם כיתוב "שמור: תז של יוסי"
ואחר כך: "איפה התז של יוסי" / מסמכים

⚖️ בריאות: משקל 82 / משקל (מציג מגמה)
✍️ נסח: הודעה לעובד על... / תרגם: Hello world
📷 שלח תמונה עם שאלה בכיתוב — אנסה לקרוא אותה
🎤 הודעות קוליות — מדבר אליי חופשי

📧 חפש במייל חשבונית ארנונה — חיפוש בג'ימייל שלך (קריאה בלבד)

📊 סיכום היום / סיכום שבוע / סיכום 30 ימים / ציר זמן
🗓️ מה התאריך העברי?
👤 קוראים לי מאיר / אני בן 35 / עליי: ... / מי אני
🌅 סיכום בוקר ב-8:00 וסיכום ערב ב-21:00 — אוטומטיים`;
}

// ===== אחסון ב-KV =====

const EMPTY = {
  tasks: [], reminders: [], events: [], shopping: [], notes: [], docs: [],
  history: [], profile: { name: null, age: null, facts: [] },
  health: { weight: [] }, meetingPingMin: null,
  stats: { fired: [] }, lastFired: null,
  nextId: 1, lastBriefDate: null, lastSummaryDate: null, ownerChatId: null,
};

async function loadStore(env) {
  const raw = await env.DATA.get('store');
  const s = raw ? JSON.parse(raw) : {};
  const merged = Object.assign(structuredClone(EMPTY), s);
  merged.profile = Object.assign({ name: null, age: null, facts: [] }, s.profile || {});
  merged.health = Object.assign({ weight: [] }, s.health || {});
  merged.stats = Object.assign({ fired: [] }, s.stats || {});
  return merged;
}
async function saveStore(env, s) {
  await env.DATA.put('store', JSON.stringify(s));
}

// מצב הקרון נשמר במפתח נפרד ('cron') שרק הקרון כותב אליו — כך שליחת תזכורת
// לעולם לא דורסת תזכורת חדשה שנוצרה באותו רגע דרך הודעה (KV הוא eventually-consistent).
const EMPTY_CRON = { fired: {}, pinged: {}, lastBriefDate: null, lastSummaryDate: null, lastFired: null, stats: { fired: [] } };

async function loadCron(env, S) {
  const raw = await env.DATA.get('cron');
  if (raw) {
    const c = JSON.parse(raw);
    return Object.assign(structuredClone(EMPTY_CRON), c, { stats: Object.assign({ fired: [] }, c.stats || {}) });
  }
  // הגירה חד-פעמית מהמבנה הישן שבו הכול ישב ב-store
  const c = structuredClone(EMPTY_CRON);
  if (S) {
    c.lastBriefDate = S.lastBriefDate ?? null;
    c.lastSummaryDate = S.lastSummaryDate ?? null;
    c.lastFired = S.lastFired ?? null;
    c.stats = Object.assign({ fired: [] }, S.stats || {});
  }
  return c;
}
async function saveCron(env, c) {
  await env.DATA.put('cron', JSON.stringify(c));
}

// המופע שהגיע זמנו ועדיין לא נשלח (לפי רישום ה-fired של הקרון)
function dueOccurrence(r, firedTs, nowMs) {
  const recurring = r.recurringDaily || (r.recurringWeekly !== null && r.recurringWeekly !== undefined);
  if (!recurring) return (!firedTs && r.at <= nowMs) ? r.at : null;
  if (nowMs < r.at) return null;
  const period = r.recurringDaily ? 86400000 : 7 * 86400000;
  const k = Math.floor((nowMs - r.at) / period);
  const candidate = r.at + k * period;
  return candidate > (firedTs || 0) ? candidate : null;
}

// המופע הבא בטווח [from, to) — לתצוגה ביומן ובסיכום הבוקר
function reminderTimeIn(r, from, to) {
  const recurring = r.recurringDaily || (r.recurringWeekly !== null && r.recurringWeekly !== undefined);
  if (!recurring) return (r.at >= from && r.at < to) ? r.at : null;
  const period = r.recurringDaily ? 86400000 : 7 * 86400000;
  let t = r.at;
  if (t < from) t = r.at + Math.ceil((from - r.at) / period) * period;
  return t < to ? t : null;
}

// ניקוי בצד ההודעות (הבעלים של store): תזכורות חד-פעמיות שכבר נשלחו + אירועים ישנים
function pruneStore(S, C, nowMs) {
  S.reminders = S.reminders.filter(r => {
    const recurring = r.recurringDaily || (r.recurringWeekly !== null && r.recurringWeekly !== undefined);
    return recurring || !C.fired[r.id];
  });
  const cutoff = nowMs - 7 * 86400000;
  S.events = S.events.filter(e => e.at >= cutoff);
}

// ===== לוגיקת העוזר =====

// מיזוג פגישות מהבוט ומיומן גוגל בלי כפילויות (אותה כותרת באותה דקה = אותה פגישה)
function mergeEvents(google, local) {
  const seen = new Set();
  const out = [];
  for (const e of [...google, ...local]) {
    const key = e.text.trim() + '|' + Math.round(e.at / 60000);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.sort((a, b) => a.at - b.at);
}

async function agendaText(S, range, now, env) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let from, to, title;
  if (range === 'today') { from = today.getTime(); to = from + 86400000; title = '📅 היום'; }
  else if (range === 'tomorrow') { from = today.getTime() + 86400000; to = from + 86400000; title = '📅 מחר'; }
  else { from = today.getTime(); to = from + 7*86400000; title = '📅 השבוע'; }

  const google = await fetchCalendar(env, from, to);
  const local = S.events.filter(e => e.at >= from && e.at < to).map(e => ({ at: e.at, text: e.text, loc: e.loc || '' }));
  const all = mergeEvents(google.map(g => ({ ...g, fromGoogle: true })), local);
  const rems = S.reminders.map(r => ({ r, occ: reminderTimeIn(r, from, to) })).filter(x => x.occ !== null).sort((a,b) => a.occ - b.occ);
  const tasks = S.tasks.filter(t => !t.done);

  let out = `${title}\n`;
  out += all.length === 0 ? '\nאין אירועים ביומן.'
    : '\n' + all.map((e,i) => `${i+1}. ${e.fromGoogle ? '📆 ' : ''}${fmtIcsEvent(e, now)}${e.loc ? `\n   📍 ${e.loc}` : ''}`).join('\n');
  if (rems.length) out += '\n\n⏰ תזכורות:\n' + rems.map(x => `• ${fmtDate(x.occ, now)} — ${x.r.text}`).join('\n');
  if (tasks.length) out += `\n\n📋 משימות פתוחות (${tasks.length}):\n` + tasks.map((t,i) => `${i+1}. ${t.text}`).join('\n');
  if (S.shopping.length) out += `\n\n🛒 בקניות: ${S.shopping.length} פריטים`;
  return out;
}

async function morningBrief(S, now, env) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = today.getTime(), to = from + 86400000;
  const google = await fetchCalendar(env, from, to);
  const local = S.events.filter(e => e.at >= from && e.at < to).map(e => ({ at: e.at, text: e.text, loc: e.loc || '' }));
  const all = mergeEvents(google, local);
  const rems = S.reminders.map(r => ({ r, occ: reminderTimeIn(r, from, to) })).filter(x => x.occ !== null).sort((a,b) => a.occ - b.occ);
  const tasks = S.tasks.filter(t => !t.done);
  if (!all.length && !rems.length && !tasks.length) return null;
  const n = firstName(S);
  let out = `🌅 בוקר טוב${n ? ' ' + n : ''}! יום ${DAY_NAMES[now.getDay()]}, ${hebrewDate()}:\n`;
  if (all.length) out += '\n' + all.map(e => `📅 ${e.allDay ? 'כל היום' : fmtTime(e.at)} — ${e.text}${e.loc ? ` (📍 ${e.loc})` : ''}`).join('\n');
  if (rems.length) out += '\n' + rems.map(x => `⏰ ${fmtTime(x.occ)} — ${x.r.text}`).join('\n');
  if (tasks.length) out += `\n\n📋 משימות פתוחות:\n` + tasks.map((t,i) => `${i+1}. ${t.text}`).join('\n');
  return out;
}

function daySummary(S, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const done = S.tasks.filter(t => t.doneAt && t.doneAt >= today);
  const notes = S.notes.filter(n => n.created >= today);
  const fired = (S.stats.fired || []).filter(ts => ts >= today).length;
  const weight = (S.health.weight || []).filter(w => w.ts >= today);
  if (!done.length && !notes.length && !fired && !weight.length) return null;
  const n = firstName(S);
  let out = `🌙 ${n ? n + ', ' : ''}סיכום היום:\n`;
  if (done.length) out += `\n✅ הושלמו (${done.length}):\n` + done.map(t => `• ${t.text}`).join('\n');
  if (notes.length) out += `\n\n🧠 נשמרו זיכרונות:\n` + notes.map(x => `• ${x.text}`).join('\n');
  if (fired) out += `\n\n⏰ ${fired} תזכורות נשלחו`;
  if (weight.length) out += `\n\n⚖️ נרשם משקל: ${weight[weight.length-1].kg} ק"ג`;
  const open = S.tasks.filter(t => !t.done).length;
  if (open) out += `\n\n📋 מחר מחכות ${open} משימות פתוחות. לילה טוב! 😴`;
  return out;
}

function periodSummary(S, days, now) {
  const from = now.getTime() - days * 86400000;
  const done = S.tasks.filter(t => t.doneAt && t.doneAt >= from);
  const notes = S.notes.filter(n => n.created >= from);
  const fired = (S.stats.fired || []).filter(ts => ts >= from).length;
  const weights = (S.health.weight || []).filter(w => w.ts >= from);
  let out = `🗓️ ציר זמן — ${days} הימים האחרונים:\n`;
  out += `\n✅ ${done.length} משימות הושלמו`;
  if (done.length) out += ':\n' + done.slice(-12).map(t => `• ${t.text}`).join('\n');
  if (notes.length) out += `\n\n🧠 ${notes.length} זיכרונות נשמרו:\n` + notes.slice(-10).map(x => `• ${x.text}`).join('\n');
  out += `\n\n⏰ ${fired} תזכורות נשלחו`;
  if (weights.length >= 2) {
    const diff = (weights[weights.length-1].kg - weights[0].kg).toFixed(1);
    out += `\n⚖️ משקל: ${weights[0].kg} → ${weights[weights.length-1].kg} ק"ג (${diff > 0 ? '+' : ''}${diff})`;
  }
  return out;
}

// חיפוש בכל הזיכרון. כשהתוצאה היא הודעה/מסמך מהעבר — התשובה "מתייגת" (עונה על)
// ההודעה המקורית בטלגרם, כדי שרואים בדיוק מאיפה זה הגיע.
function doSearch(S, q, now) {
  const hit = (t) => t.includes(q);
  const notes = S.notes.filter(n => hit(n.text));
  const tasks = S.tasks.filter(t => hit(t.text));
  const rems = S.reminders.filter(r => hit(r.text));
  const shop = S.shopping.filter(s => hit(s.text));
  const events = S.events.filter(e => hit(e.text));
  const docs = S.docs.filter(d => hit(d.name));
  // בלי ההודעה האחרונה — היא בקשת החיפוש הנוכחית עצמה
  const hist = (S.history || []).slice(0, -1).filter(h => !h.bot && hit(h.text)).slice(-5);
  if (!notes.length && !tasks.length && !rems.length && !shop.length && !events.length && !docs.length && !hist.length)
    return `לא מצאתי כלום על "${q}" 🔍`;
  let out = `🔍 מצאתי על "${q}":`;
  if (notes.length) out += '\n\n🧠 זיכרונות:\n' + notes.map(n => `• ${n.text}`).join('\n');
  if (tasks.length) out += '\n\n📋 משימות:\n' + tasks.map(t => `• ${t.text}${t.done ? ' ✅' : ''}`).join('\n');
  if (rems.length) out += '\n\n⏰ תזכורות:\n' + rems.map(r => `• ${fmtDate(r.at, now)} — ${r.text}`).join('\n');
  if (shop.length) out += '\n\n🛒 קניות:\n' + shop.map(s => `• ${s.text}`).join('\n');
  if (events.length) out += '\n\n📅 אירועים:\n' + events.map(e => `• ${fmtDate(e.at, now)} — ${e.text}`).join('\n');
  if (docs.length) out += '\n\n📄 מסמכים:\n' + docs.map(d => `• ${d.name} (כתוב "איפה ${d.name}" לשליפה)`).join('\n');
  if (hist.length) out += '\n\n💬 מהתכתבויות קודמות:\n' + hist.map(h => {
    const d = new Date(h.ts);
    return `• (${d.getDate()}/${d.getMonth()+1}) ${h.text}`;
  }).join('\n');
  // תיוג: עונים על ההודעה המקורית האחרונה שנמצאה (או על הודעת המסמך)
  const tag = [...hist].reverse().find(h => h.mid)?.mid || [...docs].reverse().find(d => d.mid)?.mid || null;
  // כפתורי מחיקה לזיכרונות שנמצאו — לזיכרונות קצרי-טווח שסיימו את תפקידם
  const noteBtns = notes.slice(0, 4).map(n => ([{
    text: `🗑️ מחק: ${n.text.slice(0, 30)}${n.text.length > 30 ? '…' : ''}`,
    callback_data: `n:del:${n.id}`,
  }]));
  if (tag || noteBtns.length) return { text: out, replyTo: tag || undefined, buttons: noteBtns.length ? noteBtns : undefined };
  return out;
}

// כמה מהמילים המשמעותיות של a מופיעות ב-b (עם קילוף אותיות שימוש: "בשלמה"→"שלמה")
function wordScore(a, b) {
  const strip = (w) => w.replace(/^(?:וש|וב|ול|וכ|ומ|וה|ש|ב|ל|כ|מ|ה|ו)/, '');
  const words = [...new Set(String(a || '').split(/[^\u0590-\u05FFa-zA-Z0-9]+/)
    .flatMap(w => [w, strip(w)]).filter(w => w.length >= 3))];
  const t = String(b || '');
  return words.filter(w => t.includes(w)).length;
}

// זיכרונות שמורים שקשורים לנושא ההודעה — כדי שהמוח יענה מהזיכרון
// ("מה מספר הפוליסה בשלמה?" → הזיכרון עם מספר הפוליסה נכנס להקשר של ה-AI)
function relevantNotes(S, text) {
  return (S.notes || [])
    .map(n => ({ n, score: wordScore(text, n.text) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || b.n.created - a.n.created)
    .slice(0, 8).map(x => x.n);
}

// תגובה (reply) עם "תמחק" על הודעה — מזהים מה שמור אצלנו שתואם להודעה המצוטטת ומוחקים.
// מסמך מזוהה לפי מזהה ההודעה המקורית; השאר לפי חפיפת מילים (הכי דומה מנצח, מינימום 2 מילים).
async function deleteQuoted(S, quoted, env) {
  const doc = quoted.mid ? (S.docs || []).find(d => d.mid === quoted.mid) : null;
  if (doc) {
    S.docs = S.docs.filter(d => d !== doc);
    return `🗑️ מחקתי את המסמך "${doc.name}" מהארכיון.`;
  }
  const cands = [
    ...(S.notes || []).map(x => ({ x, kind: 'note' })),
    ...(S.tasks || []).filter(x => !x.done).map(x => ({ x, kind: 'task' })),
    ...(S.events || []).map(x => ({ x, kind: 'event' })),
    ...(S.reminders || []).map(x => ({ x, kind: 'rem' })),
  ].map(c => ({ ...c, s: wordScore(c.x.text, quoted.text) }))
   .filter(c => c.s >= 2).sort((a, b) => b.s - a.s);
  const best = cands[0];
  if (!best) return null;
  if (best.kind === 'note') {
    S.notes = S.notes.filter(n => n !== best.x);
    return `🗑️ מחקתי את הזיכרון: "${best.x.text}"`;
  }
  if (best.kind === 'task') {
    S.tasks = S.tasks.filter(t => t !== best.x);
    return `🗑️ מחקתי את המשימה: "${best.x.text}"`;
  }
  if (best.kind === 'rem') {
    S.reminders = S.reminders.filter(r => r !== best.x);
    return `🗑️ מחקתי את התזכורת: "${best.x.text}"`;
  }
  S.events = S.events.filter(e => e !== best.x);
  const gone = await deleteFromGoogleCalendar(env, best.x.text, best.x.at);
  return `🗑️ ביטלתי את "${best.x.text}"` + (gone ? '\n📆 נמחק גם מיומן גוגל.' : '');
}

function findDocs(S, query) {
  const norm = (s) => s.replace(/["'״׳]/g, '').split(/\s+/).map(w => w.replace(/^ה/, '')).filter(w => w.length >= 2);
  const qWords = norm(query);
  return S.docs.filter(d => {
    const dWords = norm(d.name);
    return qWords.some(qw => dWords.some(dw => dw.includes(qw) || qw.includes(dw)));
  });
}

// ===== המוח: הבנת שפה חופשית עם Workers AI =====
// כשהחוקים הפשוטים לא בטוחים — מודל שפה מקבל את ההודעה, את הפרופיל ואת ההקשר,
// ומחזיר JSON עם הפעולה + תשובה חמה ומנומסת.

async function aiBrain(env, S, text, now, isVoice = false, replyCtx = null) {
  if (!env?.AI && !env?.ANTHROPIC_API_KEY) return null;
  const n = firstName(S) || 'חבר';
  const facts = [
    S.profile.name ? 'שם מלא: ' + S.profile.name : '',
    S.profile.age ? 'גיל: ' + S.profile.age : '',
    ...S.profile.facts.slice(-10),
  ].filter(Boolean).join(' | ');
  const hist = (S.history || []).slice(-9, -1)
    .map(h => (h.bot ? '- (אתה ענית): ' : '- (הוא כתב): ') + h.text.slice(0, 160)).join('\n');
  const memCtx = relevantNotes(S, text).map(x => '• ' + x.text.slice(0, 200)).join('\n');
  const upcoming = S.events.filter(e => e.at >= now.getTime() - 3600000).sort((a,b) => a.at - b.at).slice(0, 10)
    .map(e => {
      const d = new Date(e.at);
      return `(id=${e.id}) "${e.text}" — ${d.getDate()}/${d.getMonth()+1} ${fmtTime(e.at)}`;
    }).join('; ');
  // גם הפגישות מיומן גוגל עצמו — כדי שאפשר יהיה לבטל/להעביר גם אותן
  const gcal = await fetchCalendar(env, now.getTime() - 3600000, now.getTime() + 14 * 86400000);
  const gcalList = gcal.slice(0, 12).map(e => {
    const d = new Date(e.at);
    return `"${e.text}" — ${d.getDate()}/${d.getMonth()+1} ${fmtTime(e.at)}`;
  }).join('; ');
  const prompt = `אתה "רמי" — עוזר אישי חם ואנושי בטלגרם. כתוב עברית תקנית וטבעית בלבד. אל תפתח משפטים ב"בבקשה" — השתמש בה רק כשמגישים משהו. פנה אליו בשמו הפרטי (${n}) לפעמים, לא בכל משפט.
מה שאתה יודע עליו: ${facts || 'עוד כלום'}
עכשיו: יום ${DAY_NAMES[now.getDay()]}, ${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}, השעה ${fmtTime(now.getTime())}. התאריך העברי: ${hebrewDate()}.
הודעות אחרונות שלו (הקשר):
${hist || '(אין)'}
זיכרונות שמורים שאולי קשורים להודעה:
${memCtx || '(אין)'}
${replyCtx ? `ההודעה החדשה שלו נשלחה כתגובה (reply) על ההודעה הזו${replyCtx.fromBot === false ? ' (שהוא עצמו שלח בעבר)' : ' שאתה שלחת לו'}: "${String(replyCtx.text || '').slice(0, 300)}"
חשוב: ההודעה שלו מתייחסת להודעה המצוטטת! "תמחק"/"תשנה"/"תעביר" = על מה שכתוב שם. אם המצוטטת היא אישור פגישה — event_move/event_delete עם ה-title משם; אם היא זיכרון או תשובה מזיכרון — note_delete עם המילים המרכזיות משם.` : ''}
ההודעה החדשה שלו: "${text}"
${isVoice ? 'שים לב: ההודעה תומללה מהקלטה קולית וייתכנו שגיאות תמלול — תקן לפי ההיגיון (למשל "תיסה"="טיסה", "כבר לי"="קבע לי", מספרים משובשים כמו "ה-37" הם כנראה תאריך כמו 30/7).' : ''}
הפגישות הקרובות שהוא קבע דרכך: ${upcoming || '(אין)'}
פגישות מיומן גוגל שלו (בלי id): ${gcalList || '(אין)'}

החזר אך ורק JSON תקין אחד, בלי שום טקסט לפני או אחרי, במבנה:
{"action":"reminder|event|event_move|event_delete|task|tasks|shopping|note|note_delete|agenda|gmail|routine|document|document_delete|answer","title":"...","location":"...","items":["..."],"datetime":"YYYY-MM-DD HH:MM","event_id":0,"recurring":"none|daily|weekly","weekday":0,"range":"today|tomorrow|week","routine":[{"time":"HH:MM","title":"..."}],"events":[{"title":"...","datetime":"YYYY-MM-DD HH:MM","location":"..."}],"reply":"תשובה חמה בעברית"}

כללים:
- reminder = לבקש להזכיר משהו. חובה datetime עתידי. אם אמר רק יום בלי שעה — בחר שעה הגיונית.
- event = פגישה/טיסה/אירוע ליומן. חובה datetime. אם נתן טווח תאריכים — קח את תאריך ההתחלה וציין את הטווח ב-title.
- אם יש בהודעה כמה אירועים (תאריכים/שעות שונים) — action=event ומלא את המערך events עם כולם, כל אחד עם title נקי, datetime ו-location משלו. לעולם אל תדחס שני אירועים לאחד!
- דייק בתאריך! חשב לפי התאריך של היום שכתוב למעלה: "מחר"=יום אחד קדימה, "יום שני הקרוב"=יום השני הבא בלוח השנה, "ל-1/8"=האחד באוגוסט. אל תשים הכול על מחר.
- ה-title חייב להיות נקי ממילות זמן: בלי "מחר", בלי "ליום שני", בלי תאריכים — רק תוכן הפגישה עצמו (למשל "פגישה עם עירית נתיבות — תשלום דוחות").
- כתובת/רחוב/מקום/טלפון של פגישה — שים ב-location, לא ב-title! ("פגישה עם ישראל ברחוב המסגר 11 אופקים" → title="פגישה עם ישראל", location="רחוב המסגר 11, אופקים"). כל פגישה מקבלת אוטומטית התראה מהבוט 10 דקות לפני — אל תיצור תזכורת נפרדת לזה.
- task = משימה לביצוע. shopping = פריטי קניות ב-items. note = מידע/מחשבה שכדאי לשמור. פרטים אישיים (שם, ת\"ז, תאריך לידה, כתובת) הם תמיד note — לעולם לא reminder, גם אם יש בהם תאריך!
- event_move = לבקש להעביר/לדחות/להקדים פגישה קיימת. אם היא ברשימת "דרכך" — תן event_id + datetime חדש. אם היא רק ביומן גוגל — event_id=0, title = הכותרת המדויקת מרשימת היומן, datetime = המועד החדש. אל תיצור אירוע חדש.
- event_delete = לבטל/למחוק פגישה קיימת. אם ברשימת "דרכך" — event_id. אם רק ביומן גוגל — event_id=0 ו-title = הכותרת המדויקת מרשימת היומן.
- tasks = שואל על המשימות שלו ("איזה משימות פתוחות יש לי") — מציג את רשימת המשימות בלבד. משימות ≠ פגישות! אל תחזיר agenda על שאלת משימות.
- agenda = שואל מה יש לו ביומן/פגישות היום/השבוע — קבע range. לא לשאלות על משימות.
- routine = שולח לוז יומי חדש — כמה שורות של שעה+פעולה שיחזרו כל יום ("מעכשיו יהיה לוז חדש: 7:00 ... 21:00 ..."). מלא את routine עם כל השורות; שמור ב-title את מלוא התוכן של השורה (כולל ברכות). אל תשמור את זה כ-note!
- document = מבקש מסמך/קובץ מהארכיון ("שלח לי את התז") — title = שם המסמך. לעולם אל תטען ב-answer ששלחת או צירפת קובץ — אתה לא מסוגל לצרף; השתמש ב-document.
- document_delete = מבקש למחוק מסמך/תמונה/קובץ מהארכיון ("תמחק את התמונה של פרטי החברה") — title = שם המסמך. אתה כן יודע למחוק מסמכים — אל תסרב ואל תגיד שאי אפשר!
- note_delete = מבקש למחוק זיכרון שמור ("תמחק את הזיכרון של הפוליסה", או "תמחק" כתגובה על הודעה עם תוכן מהזיכרון) — title = המילים המרכזיות של הזיכרון (למשל מספר או שם ייחודי). אתה כן יודע למחוק זיכרונות!
- gmail = מבקש לחפש משהו במיילים, רק כשהוא מזכיר במפורש מייל/ג'ימייל ("חפש במייל את החשבונית של..."). שים ב-title את מילות החיפוש בלבד (בלי "חפש" ובלי "במייל").
- answer = שאלה כללית או שיחה — ענה בעצמך ב-reply (התאריך העברי והשעה כתובים למעלה — השתמש בהם).
- אם השאלה שלו נענית מתוך "זיכרונות שמורים" למעלה (למשל "מה מספר הפוליסה?" והמספר שמור בזיכרון) — action=answer, וכתוב ב-reply את המידע המלא מהזיכרון, כולל המספרים המדויקים. לעולם אל תחפש במייל מידע שכבר נמצא בזיכרונות!
- הודעה קצרה שהיא המשך שיחה ("כן", "לא", "ח.פ", "ומה עוד") — הבן מההקשר למעלה וענה (answer). לעולם אל תשמור note מהודעה כזו.
- אל תציע פעולות המשך שאינך יכול לבצע — תן את המידע המלא מיד בתשובה.
- reply חובה תמיד: משפט אישי חם, עם השם שלו.`;

  // קלוד קודם (אם חובר) — הבנת עברית ברמה הגבוהה ביותר
  const fromClaude = await claudeCall(env, prompt, 800);
  if (fromClaude) {
    try {
      const m = fromClaude.match(/\{[\s\S]*\}/);
      if (m) {
        const out = await applyAiAction(S, JSON.parse(m[0]), now, env, gcal);
        if (out) return out;
      }
    } catch {}
  }
  if (!env?.AI) return null;
  for (const model of ['@cf/meta/llama-3.3-70b-instruct-fp8-fast', '@cf/meta/llama-3.1-8b-instruct']) {
    try {
      const r = await env.AI.run(model, { prompt, max_tokens: 600, temperature: 0.15 });
      const m = (r?.response || '').match(/\{[\s\S]*\}/);
      if (!m) continue;
      const j = JSON.parse(m[0]);
      const out = await applyAiAction(S, j, now, env, gcal);
      if (out) return out;
    } catch {}
  }
  return null;
}

// התאמת פגישה מיומן גוגל לפי כותרת (מלאה/חלקית)
function findGcalEvent(gcal, title) {
  const t = cleanup(String(title || ''));
  if (!t) return null;
  return (gcal || []).find(e => e.text === t)
    || (gcal || []).find(e => e.text.includes(t) || t.includes(e.text));
}

async function applyAiAction(S, j, now, env, gcal = []) {
  const nid = () => S.nextId++;
  const reply = cleanup(String(j.reply || ''));
  const parseDt = (s) => {
    const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})/);
    return m ? new Date(+m[1], +m[2]-1, +m[3], +m[4], +m[5]) : null;
  };
  const title = cleanup(String(j.title || ''));
  const n = firstName(S);
  const hey = n ? ' ' + n : '';

  // לפעולות — ניסוח קבוע, נקי ואישי (עברית של ה-AI החינמי לפעמים צולעת);
  // תשובת ה-AI החופשית משמשת רק ל-action=answer.
  switch (j.action) {
    case 'reminder': {
      const at = parseDt(j.datetime);
      if (!at || !title || (j.recurring === 'none' && at.getTime() <= now.getTime())) return null;
      const weekly = j.recurring === 'weekly' ? (Number.isInteger(j.weekday) ? j.weekday : at.getDay()) : null;
      S.reminders.push({ id: nid(), text: title, at: at.getTime(),
        recurringDaily: j.recurring === 'daily', recurringWeekly: weekly });
      const when = j.recurring === 'daily' ? `כל יום בשעה ${fmtTime(at.getTime())}`
        : weekly !== null ? `כל יום ${DAY_NAMES[weekly]} בשעה ${fmtTime(at.getTime())}`
        : fmtDate(at.getTime(), now);
      return `סגור${hey}! ⏰ אזכיר לך ${when}:\n"${title}"`;
    }
    case 'event': {
      const list = (Array.isArray(j.events) && j.events.length)
        ? j.events : [{ title: j.title, datetime: j.datetime, location: j.location }];
      const made = [];
      let anySynced = false;
      for (const ev of list.slice(0, 8)) {
        const at = parseDt(ev.datetime);
        const t = cleanup(String(ev.title || ''));
        if (!at || !t) continue;
        const loc = cleanup(String(ev.location || ''));
        S.events.push({ id: nid(), text: t, at: at.getTime(), loc });
        if (await pushToGoogleCalendar(env, t, at.getTime(), loc)) anySynced = true;
        made.push(`📅 ${fmtDate(at.getTime(), now)} — "${t}"${loc ? `\n   📍 ${loc}` : ''}`);
      }
      if (!made.length) return null;
      return (made.length === 1 ? `קבעתי לך${hey}:` : `קבעתי לך${hey} ${made.length} אירועים:`) +
        '\n' + made.join('\n') +
        (anySynced ? '\n📆 נכנסו גם ליומן גוגל שלך!' : '') +
        '\n🔔 אזכיר לך 10 דקות לפני כל אחד.';
    }
    case 'task': {
      if (!title) return null;
      const t = { id: nid(), text: title, done: false, created: now.getTime() };
      S.tasks.push(t);
      return { text: `📋 הוספתי למשימות${hey}: "${title}"`,
        buttons: [[{ text: '✅ בוצע', callback_data: `t:done:${t.id}` },
                   { text: '❌ ביטול', callback_data: `t:del:${t.id}` }]] };
    }
    case 'shopping': {
      const items = (Array.isArray(j.items) ? j.items : [title]).map(x => cleanup(String(x))).filter(x => x.length > 0);
      if (!items.length) return null;
      for (const item of items) S.shopping.push({ id: nid(), text: item });
      return `🛒 הוספתי לקניות: ${items.join(', ')}`;
    }
    case 'note': {
      const content = title || reply;
      if (!content || content.length < 4) return null;
      const noteT = { id: nid(), text: content, created: now.getTime() };
      S.notes.push(noteT);
      return { text: `🧠 שמרתי${hey}. תמצא את זה עם "חפש" מתי שתרצה.`,
        buttons: [[{ text: '🗑️ מחק את הזיכרון הזה', callback_data: `n:del:${noteT.id}` }]] };
    }
    case 'event_move': {
      const at = parseDt(j.datetime);
      if (!at) return null;
      const ev = S.events.find(e => e.id === Number(j.event_id));
      if (ev) {
        const oldAt = ev.at;
        ev.at = at.getTime();
        if (title && title.length >= 2) ev.text = title;
        await deleteFromGoogleCalendar(env, ev.text, oldAt);
        const synced = await pushToGoogleCalendar(env, ev.text, ev.at, ev.loc);
        return `הזזתי${hey} 📅 את "${ev.text}" ל${fmtDate(ev.at, now)}` +
          (synced ? '\n📆 עודכן גם ביומן גוגל!' : '');
      }
      // פגישה שקיימת רק ביומן גוגל — מוחקים שם ויוצרים מחדש במועד החדש
      const g = findGcalEvent(gcal, title);
      if (!g) return null;
      await deleteFromGoogleCalendar(env, g.text, g.at);
      const synced = await pushToGoogleCalendar(env, g.text, at.getTime(), g.loc);
      S.events.push({ id: nid(), text: g.text, at: at.getTime(), loc: g.loc || '' });
      return `הזזתי${hey} 📅 את "${g.text}" ל${fmtDate(at.getTime(), now)}` +
        (synced ? '\n📆 עודכן גם ביומן גוגל!' : '\n⚠️ ביומן גוגל צריך גשר מעודכן — בדוק ב-/diag');
    }
    case 'event_delete': {
      const ev = S.events.find(e => e.id === Number(j.event_id));
      if (ev) {
        S.events = S.events.filter(x => x.id !== ev.id);
        const gone = await deleteFromGoogleCalendar(env, ev.text, ev.at);
        return `🗑️ ביטלתי${hey} את "${ev.text}" (${fmtDate(ev.at, now)})` +
          (gone ? '\n📆 נמחק גם מיומן גוגל.' : '');
      }
      // פגישה שקיימת רק ביומן גוגל — מוחקים דרך הגשר לפי הכותרת והמועד
      const g = findGcalEvent(gcal, title);
      if (!g) return null;
      const gone = await deleteFromGoogleCalendar(env, g.text, g.at);
      return gone
        ? `🗑️ ביטלתי${hey} את "${g.text}" (${fmtDate(g.at, now)})\n📆 נמחק מיומן גוגל.`
        : `לא הצלחתי למחוק את "${g.text}" מיומן גוגל 😕 בדוק שהגשר מעודכן (פתח /diag)`;
    }
    case 'tasks':
      return taskGroupMsg(S);
    case 'document': {
      if (!title) return null;
      const matches = findDocs(S, title);
      if (matches.length === 1) return { text: `📄 הנה "${matches[0].name}":`, doc: matches[0], replyTo: matches[0].mid };
      if (matches.length > 1) return 'מצאתי כמה מסמכים 📄:\n' + matches.map(d => `${S.docs.indexOf(d) + 1}. ${d.name}`).join('\n') + '\n\nשלח את המספר (למשל "2")';
      return `לא מצאתי מסמך בשם "${title}" 🤔 כתוב "מסמכים" לרשימה.`;
    }
    case 'note_delete': {
      if (!title) return null;
      const bestNote = (S.notes || [])
        .map(x => ({ x, s: wordScore(title, x.text) }))
        .filter(e => e.s >= 1).sort((a, b) => b.s - a.s)[0]?.x;
      if (!bestNote) return `לא מצאתי זיכרון שמתאים ל"${title}" 🤔 כתוב "זיכרונות" לרשימה.`;
      S.notes = S.notes.filter(x => x !== bestNote);
      return `🗑️ מחקתי${hey} את הזיכרון: "${bestNote.text}"`;
    }
    case 'document_delete': {
      if (!title) return null;
      const matches = findDocs(S, title);
      if (!matches.length) return `לא מצאתי מסמך בשם "${title}" 🤔 כתוב "מסמכים" לרשימה.`;
      if (matches.length > 1) return 'מצאתי כמה מסמכים 📄 — איזה למחוק?\n' +
        matches.map(d => `${S.docs.indexOf(d) + 1}. ${d.name}`).join('\n') + '\n\nכתוב "מחק מסמך <מספר>"';
      S.docs = S.docs.filter(x => x.id !== matches[0].id);
      return `🗑️ מחקתי${hey} את "${matches[0].name}" מהארכיון.`;
    }
    case 'gmail': {
      if (!title) return null;
      // רשת ביטחון: אם התשובה בכלל שמורה בזיכרונות — עונים משם, לא מהמייל
      const fromMemory = () => {
        const rel = relevantNotes(S, title);
        return rel.length ? '\n\n🧠 אבל מצאתי בזיכרונות שלי:\n' + rel.slice(0, 3).map(x => `• ${x.text}`).join('\n') : '';
      };
      if (!env?.CALENDAR_WEBHOOK) return 'חיפוש במיילים עובר דרך הגשר של גוגל 📧\nצריך לעדכן את הגשר לגרסה החדשה (calendar-bridge.gs) — ראה README.' + fromMemory();
      const results = await searchGmailViaBridge(env, title);
      if (results === null) return 'לא הצלחתי לחפש במייל 😕 ודא שהגשר של גוגל מעודכן לגרסה החדשה ופרוס מחדש.' + fromMemory();
      if (!results.length) return `לא מצאתי מיילים על "${title}" 🔍` + fromMemory();
      return `📧 מצאתי בג'ימייל על "${title}":\n\n` + results.map((r, i) =>
        `${i + 1}. ${r.subject || '(בלי נושא)'}\n   מאת ${r.from} · ${r.date}` +
        (r.files && r.files.length ? `\n   📎 ${r.files.join(', ')}` : '') +
        (r.link ? `\n   ${r.link}` : '')).join('\n\n');
    }
    case 'routine': {
      const items = (Array.isArray(j.routine) ? j.routine : [])
        .map(x => {
          const t = cleanup(String(x.title || ''));
          const m = String(x.time || '').match(/^(\d{1,2})(?::(\d{2}))?$/);
          return m && t ? { h: +m[1], min: m[2] ? +m[2] : 0, title: t } : null;
        })
        .filter(x => x && x.h >= 0 && x.h <= 23 && x.min <= 59)
        .sort((a, b) => a.h * 60 + a.min - (b.h * 60 + b.min));
      if (!items.length) return null;
      // הלוז החדש מחליף את התזכורות היומיות הקיימות (שבועיות וחד-פעמיות נשארות)
      S.reminders = S.reminders.filter(r => !r.recurringDaily);
      for (const it of items) {
        const at = new Date(now); at.setHours(it.h, it.min, 0, 0);
        if (at.getTime() <= now.getTime()) at.setTime(at.getTime() + 86400000);
        S.reminders.push({ id: nid(), text: it.title, at: at.getTime(),
          recurringDaily: true, recurringWeekly: null,
          tasksDigest: /משימות/.test(it.title) ? true : undefined });
      }
      // מכבים את סיכומי הבוקר/ערב המובנים — הלוז החדש מחליף אותם
      S.briefOff = true; S.summaryOff = true;
      return `🗓️ סידרתי${hey} את הלוז היומי החדש — כל יום:\n` +
        items.map(it => `• ${String(it.h).padStart(2, '0')}:${String(it.min).padStart(2, '0')} — ${it.title}`).join('\n') +
        '\n\n(הלוז הקודם הוחלף, וסיכומי הבוקר/ערב האוטומטיים כובו כדי שלא יהיו כפילויות. רוצה לשנות? פשוט שלח לוז חדש.)';
    }
    case 'agenda':
      return agendaText(S, ['today','tomorrow','week'].includes(j.range) ? j.range : 'today', now, env);
    case 'answer':
      return reply || null;
    default:
      return null;
  }
}

// רשימת פגישות בלבד — לצלצול "רשימת הפגישות של היום": בלי תזכורות, בלי משימות
async function eventsOnlyText(S, range, now, env) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = range === 'tomorrow' ? today.getTime() + 86400000 : today.getTime();
  const to = from + 86400000;
  const google = await fetchCalendar(env, from, to);
  const local = S.events.filter(e => e.at >= from && e.at < to).map(e => ({ at: e.at, text: e.text, loc: e.loc || '' }));
  const all = mergeEvents(google, local);
  const label = range === 'tomorrow' ? 'מחר' : 'היום';
  if (!all.length) return `📅 אין פגישות ${label} — יום פנוי 🙂`;
  return `📅 הפגישות של ${label}:\n` + all.map((e, i) =>
    `${i + 1}. ${e.allDay ? 'כל היום' : fmtTime(e.at)} — ${e.text}${e.loc ? `\n   📍 ${e.loc}` : ''}`).join('\n');
}

// תזכורת שהיא בעצם בקשת מידע — עונים עם התוכן החי בזמן הצלצול במקום להדהד אותה.
// "רשימת הפגישות של היום" → הפגישות עצמן; "המשימות" → המשימות; "תאריך עברי" → התאריך;
// אפשר גם לשלב ("תאריך עברי, פגישות היום ומשימות פתוחות").
async function smartReminderText(env, S, text, now) {
  const parts = [];
  const nm = firstName(S);
  if (/בוקר טוב|ברכת בוקר/.test(text)) {
    parts.push(`☀️ בוקר טוב${nm ? ' ' + nm : ''}! שיהיה לך יום נפלא 🙂`);
  }
  if (/תאריך/.test(text) && /עברי/.test(text)) {
    parts.push(`היום יום ${DAY_NAMES[now.getDay()]}, ${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()} — ובעברי: ${hebrewDate()} 🕎`);
  }
  if (/סיכום (?:ה?יום|יומי)/.test(text)) {
    parts.push(daySummary(S, now) || '🌙 יום רגוע עבר עלינו — בלי אירועים מיוחדים.');
  }
  if (/לילה טוב|ברכת לילה/.test(text)) {
    parts.push(`לילה טוב${nm ? ' ' + nm : ''}, שתישן מתוק 😴`);
  }
  // רק ניסוחים שהם בקשת-רשימה — לא תזכורת רגילה שמזכירה פגישה ("פגישה עם דני")
  const wantsAgenda = /רשימת ה?פגישות|ה?פגישות של היום|פגישות היום|מה הפגישות|סדר ה?יום|מה יש (?:לי )?ביומן|האירועים של היום/.test(text);
  if (wantsAgenda) {
    // רק הפגישות — בלי רשימת התזכורות ובלי המשימות
    parts.push(await eventsOnlyText(S, /מחר/.test(text) ? 'tomorrow' : 'today', now, env));
  }
  if (/רשימת ה?משימות|ה?משימות הפתוחות|מה המשימות|משימות פתוחות/.test(text)) {
    const open = S.tasks.filter(t => !t.done);
    parts.push(open.length
      ? '📋 המשימות הפתוחות שלך:\n' + open.map((t, i) => `${i+1}. ${t.text}`).join('\n')
      : '📋 אין משימות פתוחות — כל הכבוד! 🎉');
  }
  if (parts.length) return parts.join('\n\n');
  const questionLike = /\?/.test(text) || /^(מה|מתי|כמה|איזה|אילו|האם|מי|איך|למה|איפה)(\s|$)/.test(text);
  if (questionLike && (env?.AI || env?.ANTHROPIC_API_KEY)) {
    const ans = await aiText(env, `אתה עוזר אישי בעברית. היום יום ${DAY_NAMES[now.getDay()]}, ${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}, השעה ${fmtTime(now.getTime())}, התאריך העברי: ${hebrewDate()}. ענה בקצרה ובעברית טבעית על: ${text}`);
    if (ans) return ans;
  }
  return null;
}

// מקבל טקסט, מעדכן את S במקום ומחזיר תשובה (string או {text, doc}); המתקשר שומר ל-KV.
// רשימת משימות עם כפתורי בחירה מתחת להודעה: ✅ בוצעה / ❌ ביטול / ↩️ לא בוצעה.
// הפרדה מלאה מהיומן — כאן רק משימות, אף פעם לא פגישות.
// הודעת משימות אחת: לכל משימה — שורת כפתור עם השם שלה, ומתחתיה ✅ בוצע / ❌ ביטול.
// לחיצה על שם המשימה מציגה את הטקסט המלא; לחיצה על פעולה מרעננת את אותה הודעה.
function taskGroupMsg(S, header) {
  const open = S.tasks.filter(t => !t.done);
  if (!open.length) return { text: '📋 אין משימות פתוחות — כל הכבוד! 🎉' };
  const short = (x) => x.length > 38 ? x.slice(0, 37) + '…' : x;
  const buttons = [];
  open.forEach((t, i) => {
    buttons.push([{ text: `${i + 1}. ${short(t.text)}`, callback_data: `t:show:${t.id}` }]);
    buttons.push([
      { text: '✅ בוצע', callback_data: `t:done:${t.id}` },
      { text: '❌ ביטול', callback_data: `t:del:${t.id}` },
    ]);
  });
  return {
    text: (header || `📋 המשימות שלך (${open.length}):`) + '\n' +
      open.map((t, i) => `${i + 1}. ${t.text}`).join('\n'),
    buttons,
  };
}

export async function handleMessage(S, text, now, env, isVoice = false, replyCtx = null) {
  let c = parseCommand(text, now);

  // המשך-הקשר: מספר בודד מיד אחרי שהבוט הציג רשימת מסמכים = "שלח מסמך N"
  // (ואם הרשימה הייתה שאלת מחיקה — "מחק מסמך N")
  if (c.cmd === 'unknown' && /^\d{1,2}$/.test((c.text || '').trim())) {
    const lastBot = [...(S.history || [])].reverse().find(h => h.bot);
    if (lastBot && /מסמכ/.test(lastBot.text))
      c = { cmd: /למחוק/.test(lastBot.text) ? 'doc_delete' : 'doc_send', index: parseInt(c.text, 10) };
  }

  // תגובה (reply) על הודעה עם "תמחק"/"בטל" — מוחקים את מה שההודעה המצוטטת מדברת עליו
  if (replyCtx && /^(?:תמחק|מחק|בטל|תבטל)(?:\s+(?:את\s+)?(?:זה|אותו|אותה))?[.!]?$/.test(cleanup(text))) {
    const out = await deleteQuoted(S, replyCtx, env);
    if (out) return out;
  }

  // כשהחוקים לא בטוחים (או שזו הודעה קולית מתומללת) — המוח (AI) מקבל את ההגה
  const weak = c.cmd === 'unknown' || c.cmd === 'reminder_missing_time' || c.cmd === 'event_missing_time'
    || c.auto || c.loose || isVoice || !!replyCtx;
  if (weak && (env?.AI || env?.ANTHROPIC_API_KEY)) {
    const ai = await aiBrain(env, S, text, now, isVoice, replyCtx);
    if (ai) return ai;
  }
  const nid = () => S.nextId++;
  const openTasks = () => S.tasks.filter(t => !t.done);
  const sortedRems = () => S.reminders.slice().sort((a,b) => a.at - b.at);

  switch (c.cmd) {
    case 'help': return helpText(S);

    case 'profile_dump': {
      const lines = c.text.split('\n').map(cleanup).filter(l => l.length >= 2 && !/(?:תשמור|שמור)\s+(?:את\s+)?הפרטים/.test(l));
      for (const line of lines) {
        const nm = line.match(/^(?:קוראים לי|שמי)\s+(.+)$/);
        if (nm) {
          const name = extractName(cleanup(nm[1]));
          if (name) S.profile.name = name;
        }
        if (!S.profile.facts.includes(line)) S.profile.facts.push(line);
      }
      S.profile.facts = S.profile.facts.slice(-40);
      const n = firstName(S);
      return `נעים להכיר${n ? ', ' + n : ''}! 🤝 שמרתי את כל הפרטים:\n` +
        lines.map(l => `• ${l}`).join('\n') +
        '\n\nמעכשיו אני מכיר אותך. אפשר לבדוק עם "מי אני", ולהוסיף עוד בכל שלב עם "עליי: ..."';
    }

    case 'profile_name': {
      S.profile.name = c.name;
      return `נעים מאוד, ${c.name.split(' ')[0]}! 🤝 מעכשיו אני זוכר אותך.\nאפשר גם לספר לי: "אני בן 35", "עליי: אני עצמאי בתחום..."`;
    }
    case 'profile_age': {
      S.profile.age = c.age;
      return `רשמתי — בן ${c.age} ${greet(S) ? '🙂' : '🙂'}`;
    }
    case 'profile_fact': {
      S.profile.facts.push(c.text);
      return `👤 נרשם! אני כבר יודע עליך ${S.profile.facts.length + (S.profile.name ? 1 : 0) + (S.profile.age ? 1 : 0)} דברים.`;
    }
    case 'profile_show': {
      const p = S.profile;
      if (!p.name && !p.age && !p.facts.length) return 'עוד לא סיפרת לי על עצמך 🙂\nנסה: "קוראים לי מאיר", "אני בן 35", "עליי: ..."';
      let out = '👤 מה שאני יודע עליך:';
      if (p.name) out += `\n• שם: ${p.name}`;
      if (p.age) out += `\n• גיל: ${p.age}`;
      p.facts.forEach(f => out += `\n• ${f}`);
      return out;
    }

    case 'date_info': {
      return `📅 היום יום ${DAY_NAMES[now.getDay()]}, ${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}\n🕎 ובעברי: ${hebrewDate()}`;
    }

    case 'reminder_add': {
      if (!c.recurringDaily && (c.recurringWeekly === null || c.recurringWeekly === undefined)
          && c.at.getTime() <= now.getTime()) {
        return `רגע, השעה הזאת כבר עברה היום 🙂\nנסה למשל: "תזכיר לי מחר ב-${fmtTime(c.at.getTime())} ${c.text}"`;
      }
      c.at.setSeconds(0, 0); // עיגול לתחילת הדקה — כך התזכורת יוצאת בדיוק בדקה הנכונה
      S.reminders.push({ id: nid(), text: c.text, at: c.at.getTime(),
        recurringDaily: !!c.recurringDaily, recurringWeekly: c.recurringWeekly ?? null });
      let when;
      if (c.recurringWeekly !== null && c.recurringWeekly !== undefined) when = `כל יום ${DAY_NAMES[c.recurringWeekly]} בשעה ${fmtTime(c.at)}`;
      else if (c.recurringDaily) when = `כל יום בשעה ${fmtTime(c.at)}`;
      else when = fmtDate(c.at, now);
      return (c.auto ? '🧠 הבנתי לבד שזו תזכורת!\n' : '') + `⏰ סגור${greet(S) ? ' ' + firstName(S) : ''}! אזכיר לך ${when}:\n"${c.text}"`;
    }
    case 'reminder_missing_time':
      return `לא הצלחתי להבין מתי להזכיר לך 🤔\nנסה למשל: "תזכיר לי מחר ב-9 ${c.text}"`;
    case 'reminder_list': {
      const list = sortedRems();
      if (!list.length) return 'אין תזכורות פעילות 👌';
      return '⏰ התזכורות שלך:\n' + list.map((r,i) => {
        let when;
        if (r.recurringWeekly !== null && r.recurringWeekly !== undefined) when = `כל יום ${DAY_NAMES[r.recurringWeekly]} ב-${fmtTime(r.at)}`;
        else if (r.recurringDaily) when = `כל יום ב-${fmtTime(r.at)}`;
        else when = fmtDate(r.at, now);
        return `${i+1}. ${when} — ${r.text}`;
      }).join('\n');
    }
    case 'reminder_delete': {
      const r = sortedRems()[c.index - 1];
      if (!r) return 'לא מצאתי תזכורת עם המספר הזה. כתוב "תזכורות" לרשימה.';
      S.reminders = S.reminders.filter(x => x.id !== r.id);
      return `🗑️ מחקתי את התזכורת: "${r.text}"`;
    }
    case 'snooze': {
      if (!S.lastFired) return 'אין תזכורת אחרונה לדחות 🤷';
      const at = new Date(now.getTime() + c.minutes * 60000);
      S.reminders.push({ id: nid(), text: S.lastFired.text, at: at.getTime(), recurringDaily: false, recurringWeekly: null });
      return `😴 סבבה, אזכיר שוב בעוד ${c.minutes} דקות (${fmtTime(at.getTime())}):\n"${S.lastFired.text}"`;
    }

    case 'task_add': {
      const t = { id: nid(), text: c.text, done: false, created: now.getTime() };
      S.tasks.push(t);
      return { text: `📋 הוספתי: "${c.text}"\n(${openTasks().length} משימות פתוחות)`,
        buttons: [[{ text: '✅ בוצע', callback_data: `t:done:${t.id}` },
                   { text: '❌ ביטול', callback_data: `t:del:${t.id}` }]] };
    }
    case 'task_list': return taskGroupMsg(S);
    case 'tasks_digest': {
      S.reminders = S.reminders.filter(r => !r.tasksDigest);
      const at = new Date(now); at.setHours(c.hour, c.minute, 0, 0);
      if (at.getTime() <= now.getTime()) at.setTime(at.getTime() + 86400000);
      S.reminders.push({ id: nid(), text: 'המשימות הפתוחות שלך', at: at.getTime(),
        recurringDaily: true, recurringWeekly: null, tasksDigest: true });
      return `📋⏰ סגור${greet(S) ? ' ' + firstName(S) : ''}! כל יום בשעה ${fmtTime(at.getTime())} אשלח לך את המשימות הפתוחות עם כפתורי סימון.\nלביטול: "בטל תזכורת משימות"`;
    }
    case 'meeting_ping': {
      S.meetingPingMin = c.minutes;
      return c.minutes > 0
        ? `🔔 סגור! אזכיר לך ${c.minutes} דקות לפני כל פגישה (גם מיומן גוגל).`
        : '🔕 ביטלתי את ההתראות לפני פגישות. להחזרה: "תזכורת פגישות 10 דקות"';
    }
    case 'tasks_digest_off': {
      const had = S.reminders.some(r => r.tasksDigest);
      S.reminders = S.reminders.filter(r => !r.tasksDigest);
      return had ? '🗑️ ביטלתי את תזכורת המשימות היומית.' : 'אין תזכורת משימות פעילה 🙂';
    }
    case 'task_done': {
      const t = openTasks()[c.index - 1];
      if (!t) return 'לא מצאתי משימה עם המספר הזה. כתוב "משימות" לרשימה.';
      t.done = true; t.doneAt = now.getTime();
      const left = openTasks().length;
      return `✅ יפה${greet(S) ? ' ' + firstName(S) : ''}! "${t.text}" בוצעה.` + (left ? `\nנשארו ${left} משימות.` : '\nסיימת הכול! 🎉');
    }
    case 'task_delete': {
      const t = openTasks()[c.index - 1];
      if (!t) return 'לא מצאתי משימה עם המספר הזה.';
      S.tasks = S.tasks.filter(x => x.id !== t.id);
      return `🗑️ מחקתי את המשימה: "${t.text}"`;
    }
    case 'task_clear_done': {
      const n = S.tasks.filter(t => t.done).length;
      S.tasks = S.tasks.filter(t => !t.done);
      return n ? `🧹 ניקיתי ${n} משימות שבוצעו.` : 'אין משימות שבוצעו למחיקה.';
    }

    case 'shop_add': {
      for (const item of c.items) S.shopping.push({ id: nid(), text: item });
      return `🛒 הוספתי ${c.items.length === 1 ? 'לרשימת הקניות' : c.items.length + ' פריטים'}:\n` +
        S.shopping.map((s,i) => `${i+1}. ${s.text}`).join('\n');
    }
    case 'shop_list':
      return S.shopping.length
        ? '🛒 רשימת הקניות:\n' + S.shopping.map((s,i) => `${i+1}. ${s.text}`).join('\n') + '\n\nכשקנית: "קניתי 1"'
        : 'רשימת הקניות ריקה 👌\nלהוספה: "קניות: חלב, לחם"';
    case 'shop_bought': {
      const item = S.shopping[c.index - 1];
      if (!item) return 'לא מצאתי פריט עם המספר הזה. כתוב "קניות" לרשימה.';
      S.shopping = S.shopping.filter(x => x.id !== item.id);
      return `✅ "${item.text}" נקנה!` + (S.shopping.length ? `\nנשארו ${S.shopping.length} פריטים.` : '\nסיימת את כל הקניות! 🎉');
    }
    case 'shop_clear': {
      const n = S.shopping.length;
      S.shopping = [];
      return n ? `🧹 ניקיתי את רשימת הקניות (${n} פריטים).` : 'רשימת הקניות כבר ריקה.';
    }

    case 'note_add': {
      const noteT = { id: nid(), text: c.text, created: now.getTime() };
      S.notes.push(noteT);
      const delBtn = [[{ text: '🗑️ מחק את הזיכרון הזה', callback_data: `n:del:${noteT.id}` }]];
      if (c.auto) return { text: `🧠 לא זיהיתי פקודה, אז שמרתי את זה בזיכרון שלא ילך לאיבוד.\nלשליפה: "זיכרונות" או "חפש <מילה>"\n(אם התכוונת למשהו אחר — כתוב "עזרה")`, buttons: delBtn };
      return { text: `🧠 שמרתי בזיכרון:\n"${c.text}"\n\nלשליפה: "זיכרונות" או "חפש <מילה>"`, buttons: delBtn };
    }
    case 'note_list': {
      if (!S.notes.length) return 'הזיכרון ריק 🧠\nלשמירה: "זכור: ..."';
      const recent = S.notes.slice(-20).reverse();
      return `🧠 הזיכרונות שלך (${S.notes.length}):\n` + recent.map((n,i) => {
        const d = new Date(n.created);
        return `${i+1}. ${n.text}  (${d.getDate()}/${d.getMonth()+1})`;
      }).join('\n');
    }
    case 'note_delete': {
      const recent = S.notes.slice(-20).reverse();
      const n = recent[c.index - 1];
      if (!n) return 'לא מצאתי זיכרון עם המספר הזה. כתוב "זיכרונות" לרשימה.';
      S.notes = S.notes.filter(x => x.id !== n.id);
      return `🗑️ מחקתי את הזיכרון: "${n.text}"`;
    }

    case 'weight_log': {
      const prev = S.health.weight[S.health.weight.length - 1];
      S.health.weight.push({ ts: now.getTime(), kg: c.kg });
      S.health.weight = S.health.weight.slice(-100);
      let out = `⚖️ נרשם: ${c.kg} ק"ג`;
      if (prev) {
        const diff = (c.kg - prev.kg).toFixed(1);
        out += diff == 0 ? '\nיציב כמו סלע 💪' : `\n${diff > 0 ? '+' : ''}${diff} ק"ג מהמדידה הקודמת (${new Date(prev.ts).getDate()}/${new Date(prev.ts).getMonth()+1})`;
      }
      out += '\n\nטיפ: "תזכיר לי כל יום ראשון ב-8 להישקל" ואעקוב איתך 🙂';
      return out;
    }
    case 'weight_show': {
      const w = S.health.weight;
      if (!w.length) return 'עוד אין מדידות משקל ⚖️\nלרישום: "משקל 82"';
      const last = w.slice(-8);
      let out = '⚖️ מעקב משקל:\n' + last.map(x => {
        const d = new Date(x.ts);
        return `• ${d.getDate()}/${d.getMonth()+1} — ${x.kg} ק"ג`;
      }).join('\n');
      if (w.length >= 2) {
        const diff = (w[w.length-1].kg - w[0].kg).toFixed(1);
        out += `\n\nסה"כ מאז ההתחלה: ${diff > 0 ? '+' : ''}${diff} ק"ג`;
      }
      return out;
    }

    case 'draft': {
      const result = await aiText(env, `אתה עוזר ניסוח מקצועי בעברית. המשימה: ${c.text}\nכתוב רק את הטקסט המבוקש עצמו, בעברית רהוטה, מנומסת ומקצועית. בלי הקדמות ובלי הסברים.`);
      if (!result) return 'ניסוח דורש חיבור AI (חינם):\nב-Cloudflare: Settings → Bindings → Add → Workers AI → שם: AI ✍️';
      return `✍️ הנה נוסח מוצע:\n\n${result}\n\n(אפשר לבקש שינויים: "נסח: אותו דבר אבל יותר קצר")`;
    }
    case 'translate': {
      const result = await aiText(env, `תרגם את הטקסט הבא ל${c.lang}. כתוב רק את התרגום עצמו, בלי הסברים:\n\n${c.text}`);
      if (!result) return 'תרגום דורש חיבור AI (חינם):\nב-Cloudflare: Settings → Bindings → Add → Workers AI → שם: AI 🌍';
      return `🌍 תרגום ל${c.lang}:\n\n${result}`;
    }

    case 'gmail_search': {
      // רשת ביטחון: גם כשהמייל לא זמין — אם התשובה שמורה בזיכרונות, מציגים אותה
      const fromMemory = () => {
        const rel = relevantNotes(S, c.query);
        return rel.length ? '\n\n🧠 אבל מצאתי בזיכרונות שלי:\n' + rel.slice(0, 3).map(x => `• ${x.text}`).join('\n') : '';
      };
      if (!env?.CALENDAR_WEBHOOK) return 'חיפוש במיילים עובר דרך הגשר של גוגל 📧\nצריך לעדכן את הגשר לגרסה החדשה (calendar-bridge.gs) ולפרוס מחדש — ראה README.' + fromMemory();
      const results = await searchGmailViaBridge(env, c.query);
      if (results === null) return 'לא הצלחתי לחפש במייל 😕 ודא שהגשר של גוגל מעודכן לגרסה החדשה (calendar-bridge.gs) ופרוס מחדש.' + fromMemory();
      if (!results.length) return `לא מצאתי מיילים על "${c.query}" 🔍\nטיפ: נסה מילה אחת מדויקת, כמו שמחפשים בג'ימייל.` + fromMemory();
      return `📧 מצאתי בג'ימייל על "${c.query}":\n\n` + results.map((r, i) =>
        `${i + 1}. ${r.subject || '(בלי נושא)'}\n   מאת ${r.from} · ${r.date}` +
        (r.files && r.files.length ? `\n   📎 ${r.files.join(', ')}` : '') +
        (r.snippet ? `\n   "${r.snippet}"` : '') +
        (r.link ? `\n   ${r.link}` : '')).join('\n\n') +
        '\n\n(לחיצה על קישור פותחת את המייל בג\'ימייל)';
    }
    case 'wa_search_info': {
      // אין דרך לחפש בוואטסאפ מבחוץ — ההודעות מוצפנות ונמצאות רק בטלפון.
      const local = doSearch(S, c.query, now);
      const localText = typeof local === 'string' ? local : local.text;
      const out = `בוואטסאפ אני לא יכול לחפש 😕 ההודעות שם מוצפנות ושמורות רק בטלפון שלך — אף שירות חיצוני לא יכול לקרוא אותן.\n\n💡 מה כן עובד: כל מסמך חשוב שמגיע לך בוואטסאפ — שתף/העבר אליי עם כיתוב "שמור: <שם>", ומאותו רגע הוא בארכיון שלי לתמיד ("איפה <שם>").\n\nבינתיים חיפשתי אצלי:\n${localText}`;
      return typeof local === 'object' && local.replyTo ? { text: out, replyTo: local.replyTo } : out;
    }
    case 'doc_list': {
      if (!S.docs.length) return '📄 אין מסמכים שמורים.\nשלח תמונה או קובץ עם כיתוב "שמור: תז של יוסי" ואשמור אותו.';
      return `📄 המסמכים שלך (${S.docs.length}):\n` + S.docs.map((d,i) => {
        const dt = new Date(d.created);
        return `${i+1}. ${d.name}  (${dt.getDate()}/${dt.getMonth()+1})`;
      }).join('\n') + '\n\nלשליפה: "איפה <שם>" או "שלח מסמך 2"';
    }
    case 'doc_send': {
      const d = S.docs[c.index - 1];
      if (!d) return 'לא מצאתי מסמך עם המספר הזה. כתוב "מסמכים" לרשימה.';
      return { text: `📄 הנה "${d.name}":`, doc: d, replyTo: d.mid };
    }
    case 'doc_delete': {
      const d = S.docs[c.index - 1];
      if (!d) return 'לא מצאתי מסמך עם המספר הזה.';
      S.docs = S.docs.filter(x => x.id !== d.id);
      return `🗑️ מחקתי את "${d.name}" מהרשימה.`;
    }
    case 'doc_delete_name': {
      const matches = findDocs(S, c.query);
      if (!matches.length) return `לא מצאתי מסמך בשם "${c.query}" 🤔 כתוב "מסמכים" לרשימה.`;
      if (matches.length > 1) return 'מצאתי כמה מסמכים 📄 — איזה למחוק?\n' +
        matches.map(d => `${S.docs.indexOf(d) + 1}. ${d.name}`).join('\n') + '\n\nכתוב "מחק מסמך <מספר>"';
      S.docs = S.docs.filter(x => x.id !== matches[0].id);
      return `🗑️ מחקתי את "${matches[0].name}" מהארכיון.`;
    }
    case 'doc_find': {
      const matches = findDocs(S, c.query);
      if (matches.length === 1) return { text: `📄 הנה "${matches[0].name}":`, doc: matches[0], replyTo: matches[0].mid };
      if (matches.length > 1) {
        return `מצאתי כמה מסמכים 📄:\n` + matches.map((d) => {
          const idx = S.docs.indexOf(d) + 1;
          return `${idx}. ${d.name}`;
        }).join('\n') + '\n\nשלח את המספר (למשל "2")';
      }
      // אין מסמך כזה — ננסה חיפוש כללי
      return doSearch(S, c.query, now);
    }

    case 'search': return doSearch(S, c.query, now);

    case 'event_add': {
      // כתובת בתוך הטקסט ("... רחוב המסגר 11 אופקים") → לשדה המיקום, לא לכותרת
      let evTitle = c.text, evLoc = '';
      const lm = evTitle.match(/\s+ב?(רחוב|שד'|שדרות|כתובת:?)\s+(.+)$/);
      if (lm) {
        evLoc = cleanup((/^כתובת/.test(lm[1]) ? '' : lm[1] + ' ') + lm[2]);
        evTitle = cleanup(evTitle.slice(0, lm.index)) || evTitle;
      }
      S.events.push({ id: nid(), text: evTitle, at: c.at.getTime(), loc: evLoc });
      const synced = await pushToGoogleCalendar(env, evTitle, c.at.getTime(), evLoc);
      return `📅 קבעתי: "${evTitle}"\n${fmtDate(c.at, now)}` +
        (evLoc ? `\n📍 ${evLoc}` : '') +
        (synced ? '\n📆 נוסף גם ליומן גוגל שלך!' :
          (env?.CALENDAR_WEBHOOK ? '' : '\n(רשום אצלי; לקביעה ביומן גוגל האמיתי — ראה חיבור ב-README)')) +
        '\n🔔 אזכיר לך 10 דקות לפני.';
    }
    case 'event_missing_time':
      return `לא הצלחתי להבין מתי 🤔\nנסה למשל: "קבע ${c.text} ביום רביעי ב-14:00"`;
    case 'event_delete': {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const inWeek = S.events.filter(e => e.at >= today && e.at < today + 7*86400000).sort((a,b) => a.at - b.at);
      const e = inWeek[c.index - 1];
      if (!e) return 'לא מצאתי אירוע עם המספר הזה השבוע. (אירועים מיומן גוגל אפשר למחוק רק ביומן עצמו.)';
      S.events = S.events.filter(x => x.id !== e.id);
      return `🗑️ ביטלתי: "${e.text}"`;
    }

    case 'events_clear_day': {
      // "בטל את כל הפגישות ביום ראשון" — מוחק את כל היום, גם מיומן גוגל
      const w = parseWhen(' ' + c.when + ' ', now);
      const day = new Date(w.at ? w.at.getTime() : now.getTime());
      day.setHours(0, 0, 0, 0);
      const from = day.getTime(), to = from + 86400000;
      const local = S.events.filter(e => e.at >= from && e.at < to);
      const gcal = (await fetchCalendar(env, from, to)).filter(e => !e.allDay);
      const dayLabel = `${DAY_NAMES[day.getDay()]} ${day.getDate()}/${day.getMonth() + 1}`;
      if (!local.length && !gcal.length) return `אין פגישות ביום ${dayLabel} 👌`;
      S.events = S.events.filter(e => !(e.at >= from && e.at < to));
      const seen = new Set();
      const names = [];
      for (const e of [...local, ...gcal]) {
        const key = e.text + '|' + Math.round(e.at / 60000);
        if (seen.has(key)) continue;
        seen.add(key);
        await deleteFromGoogleCalendar(env, e.text, e.at);
        names.push(`• ${fmtTime(e.at)} — ${e.text}`);
      }
      return `🗑️ ביטלתי ${names.length === 1 ? 'פגישה אחת' : names.length + ' פגישות'} ביום ${dayLabel}:\n` +
        names.join('\n') + (env?.CALENDAR_WEBHOOK ? '\n📆 נמחקו גם מיומן גוגל.' : '');
    }

    case 'agenda': return agendaText(S, c.range, now, env);

    case 'day_summary': return daySummary(S, now) || 'עוד לא קרה כלום היום 🙂';
    case 'period_summary': return periodSummary(S, c.days, now);

    case 'week_summary': {
      const weekAgo = now.getTime() - 7*86400000;
      const done = S.tasks.filter(t => t.doneAt && t.doneAt >= weekAgo).length;
      const fired = (S.stats.fired || []).filter(ts => ts >= weekAgo).length;
      const notes = S.notes.filter(n => n.created >= weekAgo).length;
      const open = S.tasks.filter(t => !t.done).length;
      return `📊 סיכום השבוע האחרון:\n` +
        `✅ ${done} משימות הושלמו\n` +
        `⏰ ${fired} תזכורות נשלחו\n` +
        `🧠 ${notes} זיכרונות נשמרו\n` +
        `📋 ${open} משימות עדיין פתוחות` +
        (S.shopping.length ? `\n🛒 ${S.shopping.length} פריטים ברשימת הקניות` : '') +
        (done + fired + notes === 0 ? '\n\nשבוע רגוע 🙂' : (done >= 5 ? '\n\nשבוע פרודוקטיבי, כל הכבוד! 💪' : ''));
    }

    default:
      return `${greet(S)}לא בטוח שהבנתי 🤔 נסה לנסח קצת אחרת, או כתוב "עזרה" כדי לראות מה אני יודע לעשות.`;
  }
}

// ===== טלגרם =====

let lastTgError = '';
async function tgApi(env, method, body) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      lastTgError = `${method} → HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`;
      console.log('telegram failed:', lastTgError);
      return false;
    }
    return true;
  } catch (e) {
    lastTgError = `${method} → ${e.message}`;
    console.log('telegram failed:', lastTgError);
    return false;
  }
}
async function tgSend(env, chatId, text, buttons, replyTo) {
  const body = { chat_id: chatId, text };
  if (buttons && buttons.length) body.reply_markup = { inline_keyboard: buttons };
  if (replyTo) { body.reply_to_message_id = replyTo; body.allow_sending_without_reply = true; }
  return tgApi(env, 'sendMessage', body);
}
async function tgSendDoc(env, chatId, doc, caption, replyTo) {
  const extra = replyTo ? { reply_to_message_id: replyTo, allow_sending_without_reply: true } : {};
  if (doc.type === 'photo') return tgApi(env, 'sendPhoto', { chat_id: chatId, photo: doc.fileId, caption, ...extra });
  return tgApi(env, 'sendDocument', { chat_id: chatId, document: doc.fileId, caption, ...extra });
}

async function tgGetFileBytes(env, fileId) {
  const info = await (await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`)).json();
  if (!info.ok || !info.result) return null;
  const buf = await (await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${info.result.file_path}`)).arrayBuffer();
  return new Uint8Array(buf);
}

// תמלול הודעה קולית עם Workers AI (חינם)
async function transcribeVoice(env, fileId) {
  if (!env.AI) return { error: 'no_ai' };
  try {
    const bytes = await tgGetFileBytes(env, fileId);
    if (!bytes) return { error: 'file' };
    let b64 = '';
    for (let i = 0; i < bytes.length; i += 8192) b64 += String.fromCharCode(...bytes.subarray(i, i + 8192));
    b64 = btoa(b64);
    try {
      // initial_prompt מטה את הפענוח לאוצר המילים של עוזר אישי בעברית — משפר דיוק משמעותית
      const r = await env.AI.run('@cf/openai/whisper-large-v3-turbo', {
        audio: b64, language: 'he', task: 'transcribe',
        initial_prompt: 'הודעה קולית בעברית לעוזר אישי: תזכיר לי, קבע פגישה, ביומן, משימה, קניות, מחר, בשעה, תבטל, תעביר.',
      });
      if (r?.text) return { text: r.text.trim() };
    } catch {}
    const r2 = await env.AI.run('@cf/openai/whisper', { audio: [...bytes] });
    if (r2?.text) return { text: r2.text.trim() };
    return { error: 'transcribe' };
  } catch {
    return { error: 'transcribe' };
  }
}

// שכבת איכות לתמלול: קלוד מתקן שגיאות וויספר לפני שהבוט מנסה להבין.
// מחזיר את הטקסט המתוקן, או null אם אין קלוד / התיקון חשוד.
export async function aiFixTranscript(env, raw) {
  if (!env?.ANTHROPIC_API_KEY || !raw) return null;
  const out = await claudeCall(env,
    `זהו תמלול אוטומטי של הודעה קולית בעברית לעוזר אישי שמנהל תזכורות, פגישות ביומן, משימות וקניות. ייתכנו שגיאות תמלול.
תקן רק שגיאות ברורות: מילים חסרות היגיון בהקשר ("כבר לי"="קבע לי", "תיסה"="טיסה", "תזכיר לי מהר"="תזכיר לי מחר"), שעות ותאריכים משובשים. אל תוסיף ואל תשמיט תוכן, אל תשנה את הכוונה.
החזר את המשפט המתוקן בלבד — בלי הסברים, בלי מרכאות. אם התמלול תקין, החזר אותו כמו שהוא.

התמלול: ${raw}`, 300);
  const t = out ? cleanup(out.replace(/^התמלול[:\s]*/, '')) : '';
  // הגנה: תשובה ריקה/ארוכה מדי ביחס למקור — כנראה לא תיקון אלא פטפוט
  return t && t.length >= 2 && t.length <= raw.length * 2 + 40 ? t : null;
}

async function handleMedia(env, S, msg, chatId, now) {
  const isPhoto = !!msg.photo;
  const fileId = isPhoto ? msg.photo[msg.photo.length - 1].file_id : msg.document?.file_id;
  if (!fileId) return false;
  const caption = cleanup(msg.caption || '');

  // כוונת שמירה בכל ניסוח: "שמור: תז של יוסי" / "זה התז שלי, תשמור לי" / "תשמרי את זה"
  let saveName = null;
  const saveM = caption.match(/^(?:שמור|מסמך|תשמור)(?:\s+לי)?[:\s]+(.+)$/s);
  if (saveM) saveName = cleanup(saveM[1]);
  else if (/(?:^|[\s.,!])(?:שמור|תשמור|תשמרי|שמרי)(?:\s|$|[.,!])/.test(caption)) {
    saveName = cleanup(caption
      .replace(/(?:^|[\s.,!])(?:תשמור|שמור|תשמרי|שמרי)(?:\s+(?:לי|את זה|אותו|אותה))?/g, ' ')
      .replace(/^(?:את\s+זה[.\s]*|זה\s+)+/, '')
      .replace(/[.,!]+\s*$/, '')) || 'מסמך';
  }
  if (saveName) {
    const name = saveName;
    S.docs.push({ id: S.nextId++, name, fileId, type: isPhoto ? 'photo' : 'document', created: now.getTime(), mid: msg.message_id });
    await saveStore(env, S);
    await tgSend(env, chatId, `📄 שמרתי את "${name}"!\nלשליפה בעתיד: "איפה ${name}" או "מסמכים"`);
    return true;
  }

  // תמונה עם שאלה/הוראה בכיתוב — קריאה עם AI (עם קלוד: כולל כתב יד ומסמכים)
  if (isPhoto && (env.AI || env.ANTHROPIC_API_KEY)) {
    const bytes = await tgGetFileBytes(env, fileId);
    if (bytes) {
      const instruction = caption || 'תאר מה יש בתמונה. אם יש בה טקסט או רשימה — כתוב אותם.';
      const result = await aiVision(env, bytes, instruction);
      if (result) {
        // אם ביקשו רשימת קניות — נוסיף את הפריטים ישר לרשימה
        if (/קניות/.test(caption)) {
          const items = result.split(/[\n,•·-]+/).map(cleanup).filter(x => x.length >= 2 && x.length <= 40).slice(0, 20);
          if (items.length) {
            for (const item of items) S.shopping.push({ id: S.nextId++, text: item });
            await saveStore(env, S);
            await tgSend(env, chatId, `📷 חילצתי מהתמונה והוספתי לקניות:\n` + items.map((x,i) => `${i+1}. ${x}`).join('\n') + '\n\n(אם משהו יצא שגוי — "מחק קניות" ותקן ידנית 🙂)');
            return true;
          }
        }
        await tgSend(env, chatId, `📷 ${result}\n\n(קריאת תמונות בעברית היא יכולת ניסיונית — לא תמיד מדויקת)`);
        return true;
      }
    }
    await tgSend(env, chatId, 'לא הצלחתי לקרוא את התמונה 😕\nכדי לשמור אותה כמסמך: שלח שוב עם כיתוב "שמור: <שם>"');
    return true;
  }

  await tgSend(env, chatId, 'קיבלתי קובץ 📎 כדי שאשמור אותו: שלח שוב עם כיתוב "שמור: <שם>", למשל "שמור: תז של יוסי"');
  return true;
}

// לחיצה על כפתור ברשימת המשימות: ✅ בוצעה / ↩️ לא בוצעה / ❌ ביטול
async function handleCallback(env, q) {
  const chatId = q.message?.chat?.id;
  const S = await loadStore(env);
  if (!chatId || chatId !== S.ownerChatId) {
    await tgApi(env, 'answerCallbackQuery', { callback_query_id: q.id });
    return;
  }
  // מחיקת זיכרון מכפתור 🗑️
  const nm = String(q.data || '').match(/^n:del:(\d+)$/);
  if (nm) {
    const note = S.notes.find(x => x.id === Number(nm[1]));
    if (note) {
      S.notes = S.notes.filter(x => x.id !== note.id);
      await saveStore(env, S);
      await tgApi(env, 'answerCallbackQuery', { callback_query_id: q.id, text: `🗑️ נמחק: "${note.text.slice(0, 100)}"` });
      if (q.message?.message_id) {
        await tgApi(env, 'editMessageText', { chat_id: chatId, message_id: q.message.message_id,
          text: (q.message.text || '🧠') + `\n\n🗑️ הזיכרון "${note.text.slice(0, 40)}" נמחק.` });
      }
    } else {
      await tgApi(env, 'answerCallbackQuery', { callback_query_id: q.id, text: 'הזיכרון הזה כבר נמחק' });
    }
    return;
  }
  const m = String(q.data || '').match(/^t:(done|undo|del|show):(\d+)$/);
  let toast = '';
  if (m) {
    const t = S.tasks.find(x => x.id === Number(m[2]));
    if (!t) toast = 'המשימה הזאת כבר לא קיימת';
    else if (m[1] === 'show') toast = `📋 ${t.text}`;
    else if (m[1] === 'done') { t.done = true; t.doneAt = ilNow().getTime(); toast = `✅ "${t.text}" בוצעה`; }
    else if (m[1] === 'undo') { t.done = false; delete t.doneAt; toast = `↩️ "${t.text}" חזרה לפתוחות`; }
    else { S.tasks = S.tasks.filter(x => x.id !== t.id); toast = `❌ "${t.text}" בוטלה ונמחקה מהרשימה`; }
    if (m[1] !== 'show') await saveStore(env, S);
  }
  await tgApi(env, 'answerCallbackQuery', { callback_query_id: q.id, text: toast.slice(0, 190) });
  // מרעננים את אותה הודעה — הרשימה מתעדכנת במקום, בלי הודעות חדשות
  if (m && m[1] !== 'show' && q.message?.message_id) {
    const g = taskGroupMsg(S);
    await tgApi(env, 'editMessageText', { chat_id: chatId, message_id: q.message.message_id,
      text: g.text, reply_markup: { inline_keyboard: g.buttons || [] } });
  }
}

async function handleWebhook(env, update) {
  if (update.callback_query) return handleCallback(env, update.callback_query);
  const msg = update.message || update.edited_message;
  if (!msg?.chat?.id) return;
  const chatId = msg.chat.id;
  let text = msg.text;

  const S = await loadStore(env);
  // מיזוג מצב הקרון (סטטיסטיקות, תזכורת אחרונה) וניקוי תזכורות שכבר נשלחו
  const C = await loadCron(env, S);
  S.stats = C.stats;
  S.lastFired = C.lastFired;
  pruneStore(S, C, Date.now());

  // המשתמש הראשון ששולח /start הופך לבעלים; כל השאר נדחים.
  if (S.ownerChatId === null && text && /^\/start/.test(text)) {
    S.ownerChatId = chatId;
    await saveStore(env, S);
    await tgSend(env, chatId, helpText(S));
    return;
  }
  if (S.ownerChatId === null) {
    await tgSend(env, chatId, 'שלח /start כדי להתחיל 🙂');
    return;
  }
  if (chatId !== S.ownerChatId) {
    await tgSend(env, chatId, 'סליחה, אני עוזר אישי פרטי 🙂');
    return;
  }

  const now = ilNow();

  // "מקליד..." — שההתכתבות תרגיש חיה בזמן שהבוט חושב
  await tgApi(env, 'sendChatAction', { chat_id: chatId, action: 'typing' });

  // תמונות וקבצים
  if (msg.photo || msg.document) {
    await handleMedia(env, S, msg, chatId, now);
    return;
  }

  // הודעה קולית → תמלול → ממשיכים כרגיל
  let voicePrefix = '';
  if (!text && (msg.voice || msg.audio || msg.video_note)) {
    const fileId = (msg.voice || msg.audio || msg.video_note).file_id;
    const tr = await transcribeVoice(env, fileId);
    if (tr.error === 'no_ai') {
      await tgSend(env, chatId, 'כדי שאבין הודעות קוליות צריך לחבר את התמלול (חינם):\nב-Cloudflare: Settings → Bindings → Add → Workers AI → Variable name: AI 🎤');
      return;
    }
    if (tr.error || !tr.text) {
      await tgSend(env, chatId, 'לא הצלחתי לתמלל את ההקלטה 😕 נסה שוב או כתוב לי.');
      return;
    }
    text = tr.text;
    // תיקון שגיאות תמלול עם קלוד (אם חובר) — לפני שממשיכים להבין את הבקשה
    const fixed = await aiFixTranscript(env, text);
    if (fixed) text = fixed;
    voicePrefix = `🎤 שמעתי: "${text}"\n\n`;
  }
  if (!text) return;

  // יומן התכתבות — כדי שאפשר יהיה לחפש אחורה
  S.history = [...(S.history || []), { ts: now.getTime(), text, mid: msg.message_id }].slice(-500);

  // תגובה (reply) על הודעה קודמת — ההודעה המצוטטת היא הקשר חיוני להבנה
  const rt = msg.reply_to_message;
  const replyCtx = rt ? {
    mid: rt.message_id,
    text: rt.text || rt.caption || '',
    fromBot: !!(rt.from && rt.from.is_bot),
  } : null;

  const answer = await handleMessage(S, text, now, env, !!voicePrefix, replyCtx);
  // גם התשובה של הבוט נשמרת בהיסטוריה — כדי שהמוח יבין המשכי שיחה ("כן", "ח.פ")
  const answerText = typeof answer === 'string' ? answer : (answer && answer.text) || '';
  if (answerText) S.history = [...(S.history || []), { ts: now.getTime(), text: answerText.slice(0, 300), bot: true }].slice(-500);
  await saveStore(env, S);
  if (typeof answer === 'object' && answer.doc) {
    await tgSendDoc(env, chatId, answer.doc, answer.text, answer.replyTo);
  } else if (typeof answer === 'object' && answer.cards) {
    if (answer.text) await tgSend(env, chatId, voicePrefix + answer.text);
    for (const card of answer.cards) await tgSend(env, chatId, card.text, card.buttons);
  } else if (typeof answer === 'object') {
    await tgSend(env, chatId, voicePrefix + answer.text, answer.buttons, answer.replyTo);
  } else {
    await tgSend(env, chatId, voicePrefix + answer);
  }
}

// דופק ריצות של השעון — לזיהוי ריצות דלילות (נשמר בזיכרון האיזולט + ב-KV כל 10 דק')
const cronTicks = [];

// שריון בזיכרון מפני שליחה כפולה: אם האחסון החזיר לרגע גרסה ישנה של רישום
// "מה כבר נשלח", האיזולט זוכר בעצמו מה נשלח לאחרונה ולא שולח שוב
const sentGuard = new Map();
function guardHas(k) {
  const nowT = Date.now();
  for (const [key, ts] of sentGuard) if (nowT - ts > 15 * 60000) sentGuard.delete(key);
  return sentGuard.has(k);
}

async function runCron(env, opts = {}) {
  // הקרון קורא את ה-store אבל לעולם לא כותב אליו — כל המצב שלו במפתח 'cron' הנפרד.
  // opts.minLateMs: שעון הגיבוי מטפל רק במה שאיחר לפחות כך — כדי לא להתנגש
  // בשעון הראשי לפני שרישום "כבר נשלח" הספיק להסתנכרן בין השרתים.
  const minLate = opts.minLateMs || 0;
  const S = await loadStore(env);
  if (S.ownerChatId === null) return;
  const C = await loadCron(env, S);
  S.stats = C.stats; // לתצוגה בסיכומים

  const now = ilNow();
  const nowMs = now.getTime();
  let changed = false;

  // דופק חיים — כדי שמסך האבחון ידע אם השעון באמת רץ (נכתב לכל היותר פעם ברבע שעה)
  if (nowMs - (C.beat || 0) > 15 * 60000) { C.beat = nowMs; changed = true; }
  cronTicks.push(nowMs);
  if (cronTicks.length > 40) cronTicks.shift();
  if (now.getMinutes() % 10 === 0) { C.runs = [...(C.runs || []), nowMs].slice(-12); changed = true; }

  for (const r of S.reminders) {
   try {
    const due = dueOccurrence(r, C.fired[r.id], nowMs);
    if (due === null) continue;
    if (minLate && nowMs - due < minLate) continue; // טרייה — שייכת לשעון הראשי
    // תזכורת חוזרת שהתפספסה ביותר מ-3 שעות — מוותרים בשקט עד המופע הבא,
    // כדי שתזכורת בוקר לא תופיע פתאום אחר הצהריים (למשל אחרי שיהוק של האחסון)
    const isRecurring = r.recurringDaily || (r.recurringWeekly !== null && r.recurringWeekly !== undefined);
    if (isRecurring && nowMs - due > 3 * 3600000) {
      C.fired[r.id] = due;
      changed = true;
      continue;
    }
    // תזכורת המשימות היומית — שולחת את הרשימה החיה עם כפתורי הסימון
    const gk = 'r' + r.id + '|' + due;
    if (guardHas(gk)) { C.fired[r.id] = due; changed = true; continue; }
    if (r.tasksDigest) {
      const n0 = firstName(S);
      const openCount = S.tasks.filter(t => !t.done).length;
      let okD;
      if (openCount) {
        const msg = taskGroupMsg(S, `📋 ${n0 ? n0 + ', ' : ''}המשימות הפתוחות שלך (${openCount}):`);
        okD = await tgSend(env, S.ownerChatId, msg.text, msg.buttons);
      } else {
        okD = await tgSend(env, S.ownerChatId, `📋 ${n0 ? n0 + ', ' : ''}אין משימות פתוחות היום — כל הכבוד! 🎉`);
      }
      if (!okD) throw new Error(lastTgError || 'טלגרם לא אישר את השליחה');
      sentGuard.set(gk, Date.now());
      C.fired[r.id] = due;
      C.lastFired = { text: r.text };
      C.stats.fired = [...(C.stats.fired || []), nowMs].slice(-300);
      changed = true;
      continue;
    }
    let suffix = '';
    if (r.recurringDaily) suffix = '\n(תזכורת יומית — תחזור מחר)';
    else if (r.recurringWeekly !== null && r.recurringWeekly !== undefined) suffix = `\n(חוזרת כל יום ${DAY_NAMES[r.recurringWeekly]})`;
    else suffix = '\n(אפשר לכתוב "דחה 10" לנודניק)';
    const n = firstName(S);
    // תזכורת שהיא שאלה — שולחים את התשובה עצמה, לא הד של ההוראה
    const smart = await smartReminderText(env, S, r.text, now);
    const okR = await tgSend(env, S.ownerChatId, smart
      ? `⏰ ${n ? n + ', ' : ''}${smart}${r.recurringDaily || r.recurringWeekly != null ? suffix : ''}`
      : `⏰ ${n ? n + ', ' : ''}תזכורת: ${r.text}${suffix}`);
    if (!okR) throw new Error(lastTgError || 'טלגרם לא אישר את השליחה');
    sentGuard.set(gk, Date.now());
    C.fired[r.id] = due;
    C.lastFired = { text: r.text };
    C.stats.fired = [...(C.stats.fired || []), nowMs].slice(-300);
    changed = true;
   } catch (e) {
    console.log('reminder failed:', r.id, e.message);
    C.errors = [...(C.errors || []), { ts: nowMs, what: `תזכורת "${(r.text || '').slice(0, 25)}"`, msg: e.message }].slice(-8);
    changed = true;
   }
  }

  // 🔔 התראה אוטומטית לפני כל פגישה (ברירת מחדל: 10 דקות; "תזכורת פגישות 15 דקות" לשינוי)
  const pingMin = S.meetingPingMin === 0 ? 0 : (S.meetingPingMin || parseInt(env.MEETING_PING_MIN ?? '10', 10));
  if (pingMin > 0) try {
    // את היומן של גוגל בודקים רק כל 5 דקות (חלון ההתראה רחב מזה) — חוסך עבודה כל דקה
    const gEvents = (pingMin < 5 || now.getMinutes() % 5 === 0)
      ? await fetchCalendar(env, nowMs - 3600000, nowMs + 12 * 3600000) : [];
    const upcoming = [
      ...S.events.map(e => ({ at: e.at, text: e.text, loc: e.loc || '' })),
      ...gEvents.filter(e => !e.allDay),
    ];
    for (const e of upcoming) {
      if (!(e.at - pingMin * 60000 <= nowMs && nowMs < e.at)) continue;
      if (minLate && nowMs - (e.at - pingMin * 60000) < minLate) continue; // טרי — לשעון הראשי
      const key = e.text.trim() + '|' + Math.round(e.at / 60000);
      if (C.pinged[key]) continue;
      if (guardHas('p' + key)) { C.pinged[key] = nowMs; changed = true; continue; }
      sentGuard.set('p' + key, Date.now());
      C.pinged[key] = nowMs;
      const minsLeft = Math.max(1, Math.round((e.at - nowMs) / 60000));
      const n = firstName(S);
      await tgSend(env, S.ownerChatId,
        `🔔 ${n ? n + ', ' : ''}בעוד ${minsLeft} דקות (${fmtTime(e.at)}): ${e.text}` +
        (e.loc ? `\n📍 ${e.loc}` : ''));
      C.stats.fired = [...(C.stats.fired || []), nowMs].slice(-300);
      changed = true;
    }
    // ניקוי רישומים ישנים מהיממה שעברה
    for (const k of Object.keys(C.pinged)) {
      if (C.pinged[k] < nowMs - 86400000) { delete C.pinged[k]; changed = true; }
    }
  } catch (e) {
    console.log('meeting ping failed:', e.message);
    C.errors = [...(C.errors || []), { ts: nowMs, what: 'התראת פגישה', msg: e.message }].slice(-8);
    changed = true;
  }

  const briefHour = (S.briefOff || env.BRIEF_HOUR === 'off') ? null : parseInt(env.BRIEF_HOUR ?? '8', 10);
  const todayStr = now.toDateString();
  if (briefHour !== null && !Number.isNaN(briefHour) && now.getHours() === briefHour && C.lastBriefDate !== todayStr
      && (!minLate || now.getMinutes() >= 2)) {
    C.lastBriefDate = todayStr;
    changed = true;
    if (!guardHas('brief|' + todayStr)) {
      sentGuard.set('brief|' + todayStr, Date.now());
      const brief = await morningBrief(S, now, env);
      if (brief) await tgSend(env, S.ownerChatId, brief);
    }
  }

  const summaryHour = (S.summaryOff || env.SUMMARY_HOUR === 'off') ? null : parseInt(env.SUMMARY_HOUR ?? '21', 10);
  if (summaryHour !== null && !Number.isNaN(summaryHour) && now.getHours() === summaryHour && C.lastSummaryDate !== todayStr
      && (!minLate || now.getMinutes() >= 2)) {
    C.lastSummaryDate = todayStr;
    changed = true;
    if (!guardHas('sum|' + todayStr)) {
      sentGuard.set('sum|' + todayStr, Date.now());
      const sum = daySummary(S, now);
      if (sum) await tgSend(env, S.ownerChatId, sum);
    }
  }

  if (changed) {
    // ניקוי רישומי fired של תזכורות שכבר נמחקו מה-store
    const ids = new Set(S.reminders.map(r => String(r.id)));
    for (const id of Object.keys(C.fired)) if (!ids.has(id)) delete C.fired[id];
    await saveCron(env, C);
  }
}

// ===== נקודות כניסה של ה-Worker =====

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // חיבור ה-webhook — מבקרים פעם אחת בדפדפן: /setup?secret=<SECRET>
    if (url.pathname === '/setup') {
      if (url.searchParams.get('secret') !== env.SECRET) return new Response('סוד שגוי', { status: 403 });
      const hookUrl = `${url.origin}/webhook/${env.SECRET}`;
      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/setWebhook?url=${encodeURIComponent(hookUrl)}`);
      const body = await res.text();
      return new Response(`חיבור לטלגרם: ${body}\n\nעכשיו פתח את הבוט בטלגרם ושלח לו /start`, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    // מסך אבחון עצמי — פותחים בדפדפן: /diag?secret=<SECRET>
    if (url.pathname === '/diag') {
      if (url.searchParams.get('secret') !== env.SECRET) return new Response('סוד שגוי', { status: 403 });
      const lines = ['🔍 אבחון רמי', ''];
      // הרצה ידנית של השעון: /diag?secret=...&run=1 — שולח מיד כל תזכורת שממתינה
      if (url.searchParams.get('run') === '1') {
        try { await runCron(env); lines.push('▶️ הרצת שעון ידנית: הושלמה בלי שגיאה', ''); }
        catch (e) { lines.push('▶️ הרצת שעון ידנית קרסה: ' + e.message + '\n' + (e.stack || '').split('\n')[1], ''); }
      }
      try {
        const S = await loadStore(env);
        lines.push(`✅ אחסון (KV): מחובר — ${S.tasks.length} משימות, ${S.reminders.length} תזכורות, ${S.docs.length} מסמכים`);
        lines.push(S.ownerChatId ? `✅ בעלים רשום (${S.ownerChatId})` : '⚠️ עוד לא נשלח /start לבוט');
        // דופק השעון — אם הקרון לא רץ, שום תזכורת לא תישלח
        const cRaw = await env.DATA.get('cron');
        const beat = cRaw ? (JSON.parse(cRaw).beat || 0) : 0;
        const beatMin = beat ? Math.round((ilNow().getTime() - beat) / 60000) : null;
        if (!beat) lines.push('❌ השעון (Cron) עוד לא דיווח — אם זה נמשך רבע שעה: Settings → Trigger Events → ודא שיש Cron ‎* * * * *');
        else if (beatMin <= 20) lines.push(`✅ השעון פועל (רץ לפני ${beatMin} דק')`);
        else lines.push(`❌ השעון לא רץ כבר ${beatMin} דקות! תזכורות לא יישלחו — Settings → Trigger Events → הוסף Cron ‎* * * * *`);
        // רנטגן תזכורות: מה כל תזכורת "חושבת" ברגע זה
        const C2 = cRaw ? JSON.parse(cRaw) : { fired: {} };
        const nowI = ilNow();
        if (S.reminders.length) {
          lines.push('', `⏰ מצב תזכורות (${S.reminders.length}):`);
          for (const r of S.reminders.slice(0, 12)) {
            const due = dueOccurrence(r, (C2.fired || {})[r.id], nowI.getTime());
            const sched = r.recurringDaily ? `כל יום ב-${fmtTime(r.at)}`
              : (r.recurringWeekly !== null && r.recurringWeekly !== undefined) ? `כל יום ${DAY_NAMES[r.recurringWeekly]} ב-${fmtTime(r.at)}`
              : fmtDate(r.at, nowI);
            const lastF = (C2.fired || {})[r.id] ? `נשלחה לאחרונה: ${fmtDate((C2.fired || {})[r.id], nowI)}` : 'טרם נשלחה';
            lines.push(`${due !== null ? '❗ ממתינה לשליחה עכשיו!' : '✅'} "${(r.text || '').slice(0, 35)}" — ${sched} · ${lastF}`);
          }
        }
        // דופק ריצות — כמה באמת רץ השעון לאחרונה
        const ticksTxt = cronTicks.slice(-10).map(t => fmtTime(t)).join(', ');
        lines.push(`🫀 ריצות אחרונות (זיכרון): ${ticksTxt || '(אין בזיכרון הנוכחי)'}`);
        const runsTxt = (C2.runs || []).slice(-6).map(t => fmtTime(t)).join(', ');
        if (runsTxt) lines.push(`🫀 ריצות שנרשמו (דגימה כל 10 דק'): ${runsTxt}`);
        // רנטגן התראות פגישות: כל פגישה קרובה — האם ומתי נשלח הפעמון
        try {
          const pingM = S.meetingPingMin === 0 ? 0 : (S.meetingPingMin || parseInt(env.MEETING_PING_MIN ?? '10', 10));
          const nowMs2 = nowI.getTime();
          const gEv = (await fetchCalendar(env, nowMs2 - 6 * 3600000, nowMs2 + 12 * 3600000)).filter(e => !e.allDay);
          const localEv = S.events.filter(e => e.at >= nowMs2 - 6 * 3600000 && e.at < nowMs2 + 12 * 3600000)
            .map(e => ({ at: e.at, text: e.text, loc: e.loc || '' }));
          const evs = mergeEvents(gEv, localEv);
          lines.push('', `🔔 התראות פגישות (${pingM ? pingM + " דק' לפני" : 'כבויות!'}):`);
          if (!evs.length) lines.push('(אין פגישות בטווח 6 שעות אחורה / 12 קדימה)');
          for (const e of evs.slice(0, 8)) {
            const key = e.text.trim() + '|' + Math.round(e.at / 60000);
            const p = (C2.pinged || {})[key];
            const status = p ? `🔔 נשלחה ב-${fmtTime(p)}`
              : nowMs2 >= e.at ? '❗ עברה בלי התראה!'
              : `🕐 תישלח ב-${fmtTime(e.at - pingM * 60000)}`;
            lines.push(`• ${fmtTime(e.at)} "${(e.text || '').slice(0, 30)}" — ${status}`);
          }
        } catch (e) { lines.push('🔔 בדיקת התראות פגישות נכשלה: ' + e.message); }
        const errs = (C2.errors || []).slice(-5);
        if (errs.length) {
          lines.push('', '🐞 שגיאות אחרונות של השעון:');
          errs.forEach(x => lines.push(`• ${fmtDate(x.ts, nowI)} — ${x.what}: ${x.msg}`));
        } else {
          lines.push('', '🐞 יומן שגיאות: ריק (לא נרשמו כשלים מאז העדכון האחרון)');
        }
      } catch (e) {
        lines.push('❌ אחסון (KV): לא מחובר! בדוק Binding בשם DATA. ' + e.message);
      }
      lines.push(env.AI ? '✅ Workers AI מחובר (קוליות, ניסוח, תמונות)' : '⚠️ Workers AI לא מחובר — אין קוליות/ניסוח');
      if (!env.ANTHROPIC_API_KEY) lines.push('⚠️ Claude לא מחובר (אין ANTHROPIC_API_KEY) — ההבנה והתמלול על ה-AI החינמי בלבד');
      else {
        const t = await claudeCall(env, 'החזר בדיוק את המילה: תקין', 30);
        lines.push(t && t.includes('תקין')
          ? '✅ מוח Claude מחובר ועובד'
          : '❌ ANTHROPIC_API_KEY מוגדר אבל Claude לא עונה — בדוק את המפתח והקרדיט ב-platform.claude.com');
      }
      if (!env.CALENDAR_ICS) lines.push('⚠️ CALENDAR_ICS לא מוגדר — הבוט לא רואה את יומן גוגל');
      else {
        try {
          const res = await fetch(env.CALENDAR_ICS);
          if (!res.ok) lines.push(`❌ קריאת יומן גוגל נכשלה (HTTP ${res.status}) — בדוק את הכתובת הסודית`);
          else {
            const now = ilNow();
            const from = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
            const events = parseICS(await res.text(), from, from + 7 * 86400000);
            lines.push(`✅ יומן גוגל (קריאה): ${events.length} אירועים בשבוע הקרוב`);
          }
        } catch (e) { lines.push('❌ קריאת יומן גוגל נכשלה: ' + e.message); }
      }
      if (!env.CALENDAR_WEBHOOK) lines.push('⚠️ CALENDAR_WEBHOOK לא מוגדר — "קבע פגישה" לא ייכנס ליומן גוגל');
      else {
        try {
          const tomorrow = ilNow();
          tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(12, 0, 0, 0);
          const ok = await pushToGoogleCalendar(env, '✅ בדיקת חיבור מרמי — אפשר למחוק', tomorrow.getTime());
          let cleaned = false;
          if (ok) cleaned = await deleteFromGoogleCalendar(env, '✅ בדיקת חיבור מרמי — אפשר למחוק', tomorrow.getTime());
          lines.push(ok
            ? (cleaned ? '✅ כתיבה ומחיקה ביומן גוגל עובדות! (אירוע הבדיקה נוצר ונמחק מיד)'
                       : '✅ כתיבה ליומן עובדת, אבל המחיקה לא — נשאר אירוע בדיקה מחר ב-12:00, מחק ידנית ובדוק שהגשר מעודכן')
            : '❌ הגשר (Apps Script) לא ענה "ok" — בדוק: הסוד בקובץ זהה ל-SECRET, הפריסה עם גישה "כולם", והכתובת מסתיימת ב-/exec');
        } catch (e) { lines.push('❌ כתיבה ליומן נכשלה: ' + e.message); }
        // בדיקת חיפוש בג'ימייל דרך הגשר — מציגים את התשובה הגולמית כדי שאפשר יהיה לאבחן מרחוק
        try {
          const res = await fetch(env.CALENDAR_WEBHOOK, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: env.SECRET, action: 'gmail_search', q: 'בדיקה' }),
            redirect: 'follow',
          });
          const full = await res.text();
          let ok = false;
          try { ok = !!JSON.parse(full).ok; } catch {}
          const raw = full.replace(/\s+/g, ' ').slice(0, 200);
          if (ok) lines.push("✅ חיפוש בג'ימייל עובד!");
          else if (/[Aa]uthorization|הרשאה|נדרש אישור/.test(raw))
            lines.push("❌ חיפוש בג'ימייל: חסרה הרשאה! בעורך הסקריפט הרץ פעם אחת את הפונקציה authorize (הוראות בקובץ הגשר)");
          else
            lines.push("❌ חיפוש בג'ימייל לא עובד — כנראה מודבקת גרסה ישנה של קובץ הגשר. תשובת הגשר: " + raw);
        } catch (e) { lines.push("❌ חיפוש בג'ימייל נכשל: " + e.message); }
      }
      lines.push('', '🕎 תאריך עברי: ' + hebrewDate());
      return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }

    // שעון גיבוי חיצוני: GitHub (או כל שירות) מעיר את הבוט אם השעון של Cloudflare מדלג.
    // בטוח להריץ שוב ושוב — רישום ה-fired מונע שליחות כפולות.
    if (url.pathname === '/tick') {
      if (url.searchParams.get('secret') !== env.SECRET) return new Response('סוד שגוי', { status: 403 });
      try { await runCron(env, { minLateMs: 3 * 60000 }); return new Response('tick ok'); }
      catch (e) { return new Response('tick error: ' + e.message, { status: 500 }); }
    }

    if (url.pathname === `/webhook/${env.SECRET}` && request.method === 'POST') {
      const update = await request.json();
      await handleWebhook(env, update);
      return new Response('ok');
    }

    return new Response('רמי — עוזר אישי בטלגרם 🤖 (הכול תקין)', {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  },

  async scheduled(event, env) {
    await runCron(env);
  },
};
