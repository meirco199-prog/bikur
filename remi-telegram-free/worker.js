// רמי — עוזר אישי חינמי בטלגרם, רץ על Cloudflare Workers (חינם לצמיתות).
// תזכורות מגיעות כהתראת טלגרם אמיתית — גם כשכל האפליקציות סגורות.
//
// דרוש (מגדירים פעם אחת, ראה README):
//   BOT_TOKEN     — הטוקן מ-BotFather (משתנה סודי)
//   SECRET        — מחרוזת סודית שאתה ממציא (לאבטחת ה-webhook)
//   DATA          — KV namespace binding
//   Cron trigger: * * * * *  (כל דקה, לבדיקת תזכורות)
//
// אופציונלי (משדרג יכולות):
//   CALENDAR_ICS  — הכתובת הסודית של יומן גוגל בפורמט iCal (קריאת פגישות)
//   AI            — Workers AI binding (תמלול הודעות קוליות בחינם)

const IL_TZ = 'Asia/Jerusalem';
const BRIEF_HOUR_DEFAULT = 8;

// ===== זמן ישראל =====
// כל הלוגיקה עובדת ב"שעון קיר" ישראלי: Date מוזז כך שה-getters (getHours וכו')
// מחזירים שעה ישראלית גם כשהשרת רץ ב-UTC.
function ilNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: IL_TZ }));
}
function ilWallMs(realDate) {
  return new Date(realDate.toLocaleString('en-US', { timeZone: IL_TZ })).getTime();
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
  if (/\sמחרתיים\s/.test(t)) { day = new Date(today.getTime()+2*86400000); t = t.replace(/\sמחרתיים\s/,' '); }
  else if (/\sמחר\s/.test(t)) { day = new Date(today.getTime()+86400000); t = t.replace(/\sמחר\s/,' '); }
  else if (/\sהיום\s/.test(t)) { day = today; t = t.replace(/\sהיום\s/,' '); }
  else if (/\sהערב\s/.test(t)) { day = today; periodHint = periodHint || 'בערב'; t = t.replace(/\sהערב\s/,' '); }
  else {
    const dayRe = new RegExp('\\s(?:ב?יום\\s+)(' + Object.keys(DAY_WORDS).join('|') + ')\\s');
    const dm = t.match(dayRe);
    if (dm) {
      let diff = (DAY_WORDS[dm[1]] - now.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      day = new Date(today.getTime() + diff*86400000);
      t = t.replace(dayRe, ' ');
    }
  }

  const dateRe = /\s(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\s/;
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

  const timeRe = /\s(?:בשעה\s*|ב-?\s?)(\d{1,2})(?:[:.](\d{2}))?\s/;
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
  return { at, recurringDaily, recurringWeekly, rest };
}

export function parseCommand(raw, now) {
  const text = cleanup(raw);
  if (/^(עזרה|help|\/help|\/start|\?|פקודות|מה אתה יודע( לעשות)?|מה אפשר( לעשות)?)\??$/i.test(text)) return { cmd:'help' };

  // תזכורות
  let m = text.match(/^(?:תזכיר לי|תזכירי לי|תזכורת[:\s])\s*(.+)$/s);
  if (m) {
    const { at, recurringDaily, recurringWeekly, rest } = parseWhen(m[1], now);
    if (!at) return { cmd:'reminder_missing_time', text: cleanup(m[1]) };
    return { cmd:'reminder_add', text: rest || 'תזכורת', at, recurringDaily, recurringWeekly };
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

  // זיכרונות (המעיין 🙂)
  m = text.match(/^(?:זכור|תזכור|שמור|זיכרון|רעיון|הערה)[:\s]+(.+)$/s);
  if (m) return { cmd:'note_add', text: cleanup(m[1]) };
  if (/^(זיכרונות|רשימת זיכרונות|הערות)\??$/.test(text)) return { cmd:'note_list' };
  m = text.match(/^(?:מחק|מחקי)\s+זיכרון\s+(\d+)$/);
  if (m) return { cmd:'note_delete', index: parseInt(m[1],10) };

  // חיפוש חופשי בכל מה ששמור
  m = text.match(/^(?:חפש|מצא|תמצא)\s+(.+)$/s);
  if (m) return { cmd:'search', query: cleanup(m[1]) };

  // יומן / אירועים
  m = text.match(/^(?:קבע|קבעי|אירוע[:\s]|פגישה[:\s])\s*(.+)$/s);
  if (m) {
    const { at, rest } = parseWhen(m[1], now);
    if (!at) return { cmd:'event_missing_time', text: cleanup(m[1]) };
    return { cmd:'event_add', text: rest || 'אירוע', at };
  }
  m = text.match(/^(?:מחק|בטל|מחקי|בטלי)\s+(?:אירוע|פגישה)\s+(\d+)$/);
  if (m) return { cmd:'event_delete', index: parseInt(m[1],10) };

  if (/^(מה יש לי היום|היום|סדר יום|יומן)\??$/.test(text)) return { cmd:'agenda', range:'today' };
  if (/^(מה יש לי מחר|מחר)\??$/.test(text)) return { cmd:'agenda', range:'tomorrow' };
  if (/^(מה יש לי השבוע|השבוע|מה יש לי)\??$/.test(text)) return { cmd:'agenda', range:'week' };

  if (/^(סיכום שבוע|סיכום שבועי|סטטיסטיקה)\??$/.test(text)) return { cmd:'week_summary' };

  // נתב כוונות: טקסט חופשי שמכיל זמן — כנראה תזכורת ("מחר ב-16:00 תור לרופא")
  const w = parseWhen(text, now);
  if (w.at && w.rest && w.rest.length >= 2 && w.rest !== text) {
    return { cmd:'reminder_add', text: w.rest, at: w.at,
             recurringDaily: w.recurringDaily, recurringWeekly: w.recurringWeekly, auto: true };
  }

  return { cmd:'unknown', text };
}

// ===== קריאת יומן גוגל (כתובת iCal סודית — בלי OAuth) =====

function parseIcsDate(value, tzid) {
  // 20260725 (יום שלם) / 20260725T093000Z (UTC) / 20260725T093000 (מקומי)
  let m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return { ms: new Date(+m[1], +m[2]-1, +m[3]).getTime(), allDay: true };
  m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return null;
  if (m[7] === 'Z') {
    const real = new Date(Date.UTC(+m[1], +m[2]-1, +m[3], +m[4], +m[5], +m[6]));
    return { ms: ilWallMs(real), allDay: false };
  }
  // עם TZID או בלי — מניחים שעון קיר ישראלי (נכון ליומנים ישראליים)
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
    else if (key === 'RRULE') cur.rrule = value;
    else if (key === 'EXDATE') value.split(',').forEach(v => { const d = parseIcsDate(v, tzid); if (d) cur.exdates.push(d.ms); });
    else if (key === 'STATUS') cur.status = value;
    else if (key === 'UID') cur.uid = value;
    else if (key === 'RECURRENCE-ID') { const d = parseIcsDate(value, tzid); if (d) cur.recurrenceId = d.ms; }
  }

  // מופעים שהוזזו ידנית (RECURRENCE-ID) דוחקים את המופע המקורי מהחזרתיות
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
      if (e.start.ms >= from && e.start.ms < to) out.push({ at: e.start.ms, text: title, allDay: e.start.allDay });
      continue;
    }
    // הרחבת חזרתיות בסיסית: DAILY / WEEKLY / MONTHLY / YEARLY
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
      out.push({ at: candidate, text: title, allDay: e.start.allDay });
    }
  }
  return out.sort((a,b) => a.at - b.at);
}

async function fetchCalendar(env, from, to) {
  if (!env || !env.CALENDAR_ICS) return [];
  try {
    const res = await fetch(env.CALENDAR_ICS);
    if (!res.ok) return [];
    return parseICS(await res.text(), from, to);
  } catch { return []; }
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

const HELP = `היי, אני רמי — העוזר האישי שלך 🤖
ההתראות שלי מגיעות תמיד, גם כשהכול סגור.

⏰ תזכורות
• תזכיר לי מחר ב-9 להתקשר לדני
• תזכיר לי בעוד 20 דקות להוריד כביסה
• תזכיר לי כל יום ב-8 לקחת כדור
• תזכיר לי כל יום ראשון ב-18:00 להוציא זבל
• אפשר גם בלי "תזכיר לי": "מחר ב-16:00 תור לרופא"
• דחה 10 — דוחה את התזכורת האחרונה ב-10 דקות
• תזכורות / מחק תזכורת 2

📋 משימות
• משימה: לשלם ארנונה
• משימות / סיימתי 1 / מחק משימה 3

🛒 רשימת קניות
• קניות: חלב, לחם, ביצים (אפשר כמה בבת אחת!)
• קניות / קניתי 2 / נקה קניות

🧠 זיכרונות
• זכור: רעיון למתנה לאמא — צמח
• זיכרונות / מחק זיכרון 1
• חפש מתנה — מחפש בכל מה ששמור

📅 יומן
• קבע פגישה עם דני ביום רביעי ב-14:00
• מה יש לי היום / מחר / השבוע (כולל יומן גוגל אם חובר)

📊 סיכום שבוע — מה הספקת השבוע
🎤 אפשר גם לשלוח הודעה קולית (אם חובר התמלול)
🌅 כל בוקר ב-8:00 — סיכום היום שלך`;

// ===== אחסון ב-KV =====

const EMPTY = {
  tasks: [], reminders: [], events: [], shopping: [], notes: [],
  stats: { fired: [] }, lastFired: null,
  nextId: 1, lastBriefDate: null, ownerChatId: null,
};

async function loadStore(env) {
  const raw = await env.DATA.get('store');
  const s = raw ? JSON.parse(raw) : {};
  return Object.assign(structuredClone(EMPTY), s);
}
async function saveStore(env, s) {
  await env.DATA.put('store', JSON.stringify(s));
}

// ===== לוגיקת העוזר =====

async function agendaText(S, range, now, env) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let from, to, title;
  if (range === 'today') { from = today.getTime(); to = from + 86400000; title = '📅 היום'; }
  else if (range === 'tomorrow') { from = today.getTime() + 86400000; to = from + 86400000; title = '📅 מחר'; }
  else { from = today.getTime(); to = from + 7*86400000; title = '📅 השבוע'; }

  const google = await fetchCalendar(env, from, to);
  const local = S.events.filter(e => e.at >= from && e.at < to).map(e => ({ at: e.at, text: e.text }));
  const all = [...google.map(g => ({ ...g, fromGoogle: true })), ...local].sort((a,b) => a.at - b.at);
  const rems = S.reminders.filter(r => r.at >= from && r.at < to).sort((a,b) => a.at - b.at);
  const tasks = S.tasks.filter(t => !t.done);

  let out = `${title}\n`;
  out += all.length === 0 ? '\nאין אירועים ביומן.'
    : '\n' + all.map((e,i) => `${i+1}. ${e.fromGoogle ? '📆 ' : ''}${fmtIcsEvent(e, now)}`).join('\n');
  if (rems.length) out += '\n\n⏰ תזכורות:\n' + rems.map(r => `• ${fmtDate(r.at, now)} — ${r.text}`).join('\n');
  if (tasks.length) out += `\n\n📋 משימות פתוחות (${tasks.length}):\n` + tasks.map((t,i) => `${i+1}. ${t.text}`).join('\n');
  if (S.shopping.length) out += `\n\n🛒 בקניות: ${S.shopping.length} פריטים`;
  return out;
}

async function morningBrief(S, now, env) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = today.getTime(), to = from + 86400000;
  const google = await fetchCalendar(env, from, to);
  const local = S.events.filter(e => e.at >= from && e.at < to).map(e => ({ at: e.at, text: e.text }));
  const all = [...google, ...local].sort((a,b) => a.at - b.at);
  const rems = S.reminders.filter(r => r.at >= from && r.at < to).sort((a,b) => a.at - b.at);
  const tasks = S.tasks.filter(t => !t.done);
  if (!all.length && !rems.length && !tasks.length) return null;
  let out = `🌅 בוקר טוב! הנה היום שלך, יום ${DAY_NAMES[now.getDay()]}:\n`;
  if (all.length) out += '\n' + all.map(e => `📅 ${e.allDay ? 'כל היום' : fmtTime(e.at)} — ${e.text}`).join('\n');
  if (rems.length) out += '\n' + rems.map(r => `⏰ ${fmtTime(r.at)} — ${r.text}`).join('\n');
  if (tasks.length) out += `\n\n📋 משימות פתוחות:\n` + tasks.map((t,i) => `${i+1}. ${t.text}`).join('\n');
  return out;
}

// מקבל טקסט, מעדכן את S במקום ומחזיר תשובה; המתקשר שומר ל-KV.
export async function handleMessage(S, text, now, env) {
  const c = parseCommand(text, now);
  const nid = () => S.nextId++;
  const openTasks = () => S.tasks.filter(t => !t.done);
  const sortedRems = () => S.reminders.slice().sort((a,b) => a.at - b.at);

  switch (c.cmd) {
    case 'help': return HELP;

    case 'reminder_add': {
      S.reminders.push({ id: nid(), text: c.text, at: c.at.getTime(),
        recurringDaily: !!c.recurringDaily, recurringWeekly: c.recurringWeekly ?? null });
      let when;
      if (c.recurringWeekly !== null && c.recurringWeekly !== undefined) when = `כל יום ${DAY_NAMES[c.recurringWeekly]} בשעה ${fmtTime(c.at)}`;
      else if (c.recurringDaily) when = `כל יום בשעה ${fmtTime(c.at)}`;
      else when = fmtDate(c.at, now);
      return (c.auto ? '🧠 הבנתי לבד שזו תזכורת!\n' : '') + `⏰ סגור! אזכיר לך ${when}:\n"${c.text}"`;
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
      S.tasks.push({ id: nid(), text: c.text, done: false, created: now.getTime() });
      return `📋 הוספתי: "${c.text}"\n(${openTasks().length} משימות פתוחות)`;
    }
    case 'task_list': {
      const open = openTasks();
      if (!open.length) return 'רשימת המשימות ריקה — כל הכבוד! 🎉';
      return '📋 המשימות שלך:\n' + open.map((t,i) => `${i+1}. ${t.text}`).join('\n') + '\n\nלסימון ביצוע: "סיימתי 1"';
    }
    case 'task_done': {
      const t = openTasks()[c.index - 1];
      if (!t) return 'לא מצאתי משימה עם המספר הזה. כתוב "משימות" לרשימה.';
      t.done = true; t.doneAt = now.getTime();
      const left = openTasks().length;
      return `✅ יפה! "${t.text}" בוצעה.` + (left ? `\nנשארו ${left} משימות.` : '\nסיימת הכול! 🎉');
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
      S.notes.push({ id: nid(), text: c.text, created: now.getTime() });
      return `🧠 שמרתי בזיכרון:\n"${c.text}"\n\nלשליפה: "זיכרונות" או "חפש <מילה>"`;
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

    case 'search': {
      const q = c.query;
      const hit = (t) => t.includes(q);
      const notes = S.notes.filter(n => hit(n.text));
      const tasks = S.tasks.filter(t => hit(t.text));
      const rems = S.reminders.filter(r => hit(r.text));
      const shop = S.shopping.filter(s => hit(s.text));
      const events = S.events.filter(e => hit(e.text));
      if (!notes.length && !tasks.length && !rems.length && !shop.length && !events.length)
        return `לא מצאתי כלום על "${q}" 🔍`;
      let out = `🔍 מצאתי על "${q}":`;
      if (notes.length) out += '\n\n🧠 זיכרונות:\n' + notes.map(n => `• ${n.text}`).join('\n');
      if (tasks.length) out += '\n\n📋 משימות:\n' + tasks.map(t => `• ${t.text}${t.done ? ' ✅' : ''}`).join('\n');
      if (rems.length) out += '\n\n⏰ תזכורות:\n' + rems.map(r => `• ${fmtDate(r.at, now)} — ${r.text}`).join('\n');
      if (shop.length) out += '\n\n🛒 קניות:\n' + shop.map(s => `• ${s.text}`).join('\n');
      if (events.length) out += '\n\n📅 אירועים:\n' + events.map(e => `• ${fmtDate(e.at, now)} — ${e.text}`).join('\n');
      return out;
    }

    case 'event_add': {
      S.events.push({ id: nid(), text: c.text, at: c.at.getTime() });
      return `📅 קבעתי: "${c.text}"\n${fmtDate(c.at, now)}`;
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

    case 'agenda': return agendaText(S, c.range, now, env);

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
      return `לא הבנתי 🤔 אני עוזר של תזכורות, משימות, קניות, זיכרונות ויומן.\nכתוב "עזרה" כדי לראות מה אני יודע לעשות.`;
  }
}

// ===== טלגרם =====

async function tgSend(env, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) console.log('sendMessage failed:', await res.text());
  return res.ok;
}

// תמלול הודעה קולית עם Workers AI (חינם) — אם ה-binding מוגדר
async function transcribeVoice(env, fileId) {
  if (!env.AI) return { error: 'no_ai' };
  try {
    const info = await (await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${fileId}`)).json();
    if (!info.ok) return { error: 'file' };
    const buf = await (await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${info.result.file_path}`)).arrayBuffer();
    const bytes = new Uint8Array(buf);
    let b64 = '';
    for (let i = 0; i < bytes.length; i += 8192) b64 += String.fromCharCode(...bytes.subarray(i, i + 8192));
    b64 = btoa(b64);
    try {
      const r = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: b64, language: 'he' });
      if (r?.text) return { text: r.text.trim() };
    } catch {}
    const r2 = await env.AI.run('@cf/openai/whisper', { audio: [...bytes] });
    if (r2?.text) return { text: r2.text.trim() };
    return { error: 'transcribe' };
  } catch {
    return { error: 'transcribe' };
  }
}

async function handleWebhook(env, update) {
  const msg = update.message || update.edited_message;
  if (!msg?.chat?.id) return;
  const chatId = msg.chat.id;
  let text = msg.text;

  const S = await loadStore(env);

  // המשתמש הראשון ששולח /start הופך לבעלים; כל השאר נדחים.
  if (S.ownerChatId === null && text && /^\/start/.test(text)) {
    S.ownerChatId = chatId;
    await saveStore(env, S);
    await tgSend(env, chatId, HELP);
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

  // הודעה קולית → תמלול → ממשיכים כרגיל
  let voicePrefix = '';
  if (!text && (msg.voice || msg.audio || msg.video_note)) {
    const fileId = (msg.voice || msg.audio || msg.video_note).file_id;
    const tr = await transcribeVoice(env, fileId);
    if (tr.error === 'no_ai') {
      await tgSend(env, chatId, 'כדי שאבין הודעות קוליות צריך לחבר את התמלול (חינם):\nב-Cloudflare: Settings → Bindings → Add → Workers AI → Variable name: AI → Deploy 🎤');
      return;
    }
    if (tr.error || !tr.text) {
      await tgSend(env, chatId, 'לא הצלחתי לתמלל את ההקלטה 😕 נסה שוב או כתוב לי.');
      return;
    }
    text = tr.text;
    voicePrefix = `🎤 שמעתי: "${text}"\n\n`;
  }
  if (!text) return;

  const answer = await handleMessage(S, text, ilNow(), env);
  await saveStore(env, S);
  await tgSend(env, chatId, voicePrefix + answer);
}

async function runCron(env) {
  const S = await loadStore(env);
  if (S.ownerChatId === null) return;

  const now = ilNow();
  const nowMs = now.getTime();
  let changed = false;

  for (const r of S.reminders.slice()) {
    if (r.at <= nowMs) {
      let suffix = '';
      if (r.recurringDaily) suffix = '\n(תזכורת יומית — תחזור מחר)';
      else if (r.recurringWeekly !== null && r.recurringWeekly !== undefined) suffix = `\n(חוזרת כל יום ${DAY_NAMES[r.recurringWeekly]})`;
      else suffix = '\n(אפשר לכתוב "דחה 10" לנודניק)';
      await tgSend(env, S.ownerChatId, `⏰ תזכורת: ${r.text}${suffix}`);
      S.lastFired = { text: r.text };
      S.stats.fired = [...(S.stats.fired || []), nowMs].slice(-200);
      if (r.recurringDaily) { while (r.at <= nowMs) r.at += 86400000; }
      else if (r.recurringWeekly !== null && r.recurringWeekly !== undefined) { while (r.at <= nowMs) r.at += 7*86400000; }
      else S.reminders = S.reminders.filter(x => x.id !== r.id);
      changed = true;
    }
  }

  const briefHour = parseInt(env.BRIEF_HOUR ?? BRIEF_HOUR_DEFAULT, 10);
  const todayStr = now.toDateString();
  if (!Number.isNaN(briefHour) && now.getHours() === briefHour && S.lastBriefDate !== todayStr) {
    S.lastBriefDate = todayStr;
    changed = true;
    const brief = await morningBrief(S, now, env);
    if (brief) await tgSend(env, S.ownerChatId, brief);
  }

  // ניקוי אירועים ישנים משבוע שעבר
  const cutoff = nowMs - 7*86400000;
  const before = S.events.length;
  S.events = S.events.filter(e => e.at >= cutoff);
  if (S.events.length !== before) changed = true;

  if (changed) await saveStore(env, S);
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
