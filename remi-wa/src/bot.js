// לוגיקת העוזר: מפרש פקודה ומחזיר תשובה בעברית.
import { parseCommand } from './parser.js';
import * as store from './store.js';

const DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

export function fmtTime(ts) {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function fmtDate(ts, now = new Date()) {
  const d = new Date(ts);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((that - today) / 86400000);
  if (diffDays === 0) return `היום בשעה ${fmtTime(ts)}`;
  if (diffDays === 1) return `מחר בשעה ${fmtTime(ts)}`;
  if (diffDays > 1 && diffDays < 7) return `יום ${DAY_NAMES[d.getDay()]} בשעה ${fmtTime(ts)}`;
  return `${d.getDate()}/${d.getMonth() + 1} בשעה ${fmtTime(ts)}`;
}

export const HELP = `היי, אני רמי — העוזר האישי שלך 🤖

*⏰ תזכורות*
• תזכיר לי מחר ב-9 להתקשר לדני
• תזכיר לי בעוד 20 דקות להוריד את הכביסה
• תזכיר לי כל יום ב-8 לקחת כדור
• תזכורות — הצגת כל התזכורות
• מחק תזכורת 2

*📋 משימות*
• משימה: לשלם ארנונה
• משימות — הצגת הרשימה
• סיימתי 1 / מחק משימה 3
• נקה משימות — מחיקת מה שבוצע

*📅 יומן*
• קבע פגישה עם דני ביום רביעי ב-14:00
• מה יש לי היום / מחר / השבוע
• מחק פגישה 1

כל בוקר ב-8:00 אשלח לך סיכום יום 🌅
(אפשר לכתוב "עזרה" בכל שלב)`;

function agendaText(range, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let from, to, title;
  if (range === 'today') {
    from = today.getTime(); to = from + 86400000; title = '📅 היום';
  } else if (range === 'tomorrow') {
    from = today.getTime() + 86400000; to = from + 86400000; title = '📅 מחר';
  } else {
    from = today.getTime(); to = from + 7 * 86400000; title = '📅 השבוע';
  }

  const events = store.eventsBetween(from, to);
  const reminders = store.listReminders().filter(r => r.at >= from && r.at < to);
  const tasks = store.openTasks();

  let out = `*${title}*\n`;
  if (events.length === 0) out += '\nאין אירועים ביומן.';
  else out += '\n' + events.map((e, i) => `${i + 1}. ${fmtDate(e.at, now)} — ${e.text}`).join('\n');

  if (reminders.length > 0) {
    out += '\n\n*⏰ תזכורות:*\n' + reminders.map(r => `• ${fmtDate(r.at, now)} — ${r.text}`).join('\n');
  }
  if (tasks.length > 0) {
    out += `\n\n*📋 משימות פתוחות (${tasks.length}):*\n` + tasks.map((t, i) => `${i + 1}. ${t.text}`).join('\n');
  }
  return out;
}

export function morningBrief(now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = today.getTime(), to = from + 86400000;
  const events = store.eventsBetween(from, to);
  const reminders = store.listReminders().filter(r => r.at >= from && r.at < to);
  const tasks = store.openTasks();
  if (events.length === 0 && reminders.length === 0 && tasks.length === 0) return null;

  let out = `🌅 *בוקר טוב! הנה היום שלך:*\n`;
  if (events.length > 0) out += '\n' + events.map(e => `📅 ${fmtTime(e.at)} — ${e.text}`).join('\n');
  if (reminders.length > 0) out += '\n' + reminders.map(r => `⏰ ${fmtTime(r.at)} — ${r.text}`).join('\n');
  if (tasks.length > 0) out += `\n\n📋 משימות פתוחות:\n` + tasks.map((t, i) => `${i + 1}. ${t.text}`).join('\n');
  return out;
}

/** מקבל טקסט מהמשתמש ומחזיר תשובה (string). */
export function handleMessage(text, now = new Date()) {
  const c = parseCommand(text, now);

  switch (c.cmd) {
    case 'help':
      return HELP;

    case 'reminder_add': {
      store.addReminder(c.text, c.at, c.recurringDaily);
      const when = c.recurringDaily ? `כל יום בשעה ${fmtTime(c.at)}` : fmtDate(c.at, now);
      return `⏰ סגור! אזכיר לך ${when}:\n"${c.text}"`;
    }
    case 'reminder_missing_time':
      return `לא הצלחתי להבין מתי להזכיר לך 🤔\nנסה למשל: "תזכיר לי מחר ב-9 ${c.text}"`;
    case 'reminder_list': {
      const list = store.listReminders();
      if (list.length === 0) return 'אין תזכורות פעילות 👌';
      return '*⏰ התזכורות שלך:*\n' + list.map((r, i) =>
        `${i + 1}. ${r.recurringDaily ? `כל יום ב-${fmtTime(r.at)}` : fmtDate(r.at, now)} — ${r.text}`
      ).join('\n');
    }
    case 'reminder_delete': {
      const r = store.deleteReminder(c.index);
      return r ? `🗑️ מחקתי את התזכורת: "${r.text}"` : 'לא מצאתי תזכורת עם המספר הזה. כתוב "תזכורות" לרשימה.';
    }

    case 'task_add': {
      store.addTask(c.text);
      const n = store.openTasks().length;
      return `📋 הוספתי: "${c.text}"\n(${n} משימות פתוחות)`;
    }
    case 'task_list': {
      const open = store.openTasks();
      if (open.length === 0) return 'רשימת המשימות ריקה — כל הכבוד! 🎉';
      return '*📋 המשימות שלך:*\n' + open.map((t, i) => `${i + 1}. ${t.text}`).join('\n') +
        '\n\nלסימון ביצוע: "סיימתי 1"';
    }
    case 'task_done': {
      const t = store.completeTask(c.index);
      if (!t) return 'לא מצאתי משימה עם המספר הזה. כתוב "משימות" לרשימה.';
      const left = store.openTasks().length;
      return `✅ יפה! "${t.text}" בוצעה.` + (left ? `\nנשארו ${left} משימות.` : '\nסיימת הכול! 🎉');
    }
    case 'task_delete': {
      const t = store.deleteTask(c.index);
      return t ? `🗑️ מחקתי את המשימה: "${t.text}"` : 'לא מצאתי משימה עם המספר הזה.';
    }
    case 'task_clear_done': {
      const n = store.clearDoneTasks();
      return n ? `🧹 ניקיתי ${n} משימות שבוצעו.` : 'אין משימות שבוצעו למחיקה.';
    }

    case 'event_add': {
      store.addEvent(c.text, c.at);
      return `📅 קבעתי: "${c.text}"\n${fmtDate(c.at, now)}`;
    }
    case 'event_missing_time':
      return `לא הצלחתי להבין מתי 🤔\nנסה למשל: "קבע ${c.text} ביום רביעי ב-14:00"`;
    case 'event_delete': {
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const e = store.deleteEvent(c.index, today, today + 7 * 86400000);
      return e ? `🗑️ ביטלתי: "${e.text}"` : 'לא מצאתי אירוע עם המספר הזה השבוע. כתוב "השבוע" לרשימה.';
    }

    case 'agenda':
      return agendaText(c.range, now);

    default:
      return `לא הבנתי 🤔 אני עוזר של משימות, תזכורות ויומן.\nכתוב "עזרה" כדי לראות מה אני יודע לעשות.`;
  }
}
