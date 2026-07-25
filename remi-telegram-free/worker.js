// רמי — עוזר אישי חינמי בטלגרם, רץ על Cloudflare Workers (חינם לצמיתות).
// תזכורות מגיעות כהתראת טלגרם אמיתית — גם כשכל האפליקציות סגורות.
//
// דרוש (מגדירים פעם אחת, ראה README):
//   BOT_TOKEN  — הטוקן מ-BotFather (משתנה סודי)
//   SECRET     — מחרוזת סודית שאתה ממציא (לאבטחת ה-webhook)
//   DATA       — KV namespace binding
//   Cron trigger: * * * * *  (כל דקה, לבדיקת תזכורות)

const IL_TZ = 'Asia/Jerusalem';
const BRIEF_HOUR_DEFAULT = 8;

// ===== זמן ישראל =====
// כל הלוגיקה עובדת ב"שעון קיר" ישראלי: Date מוזז כך שה-getters (getHours וכו')
// מחזירים שעה ישראלית גם כשהשרת רץ ב-UTC.
function ilNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: IL_TZ }));
}

// ===== מפענח עברית (זהה לגרסת הוואטסאפ, נבדק ב-29 בדיקות) =====

const DAY_WORDS = { 'ראשון':0,'שני':1,'שלישי':2,'רביעי':3,'חמישי':4,'שישי':5,'שבת':6 };
const DAY_NAMES = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת'];
const PERIOD_DEFAULT_HOUR = {
  'בבוקר':9,'בצהריים':12,'בצהרים':12,'אחר הצהריים':16,'אחרי הצהריים':16,
  'אחה"צ':16,'אחהצ':16,'בערב':19,'בלילה':21,
};

function cleanup(text) {
  return text
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '') // תווי כיווניות בלתי-נראים שהמקלדת מוסיפה
    .replace(/\s{2,}/g,' ')
    .replace(/^[\s,.:\-–"'״׳]+|[\s,.:\-–"'״׳]+$/g,'')
    .trim();
}

export function parseWhen(text, now) {
  let t = ' ' + text + ' ';
  let recurringDaily = false;
  let day = null, hour = null, minute = 0, periodHint = null, relative = null;

  if (/\s(כל יום|בכל יום|כל בוקר)\s/.test(t)) {
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
  if (relative !== null) {
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
  return { at, recurringDaily, rest };
}

export function parseCommand(raw, now) {
  const text = cleanup(raw);
  if (/^(עזרה|help|\/help|\/start|\?|פקודות|מה אתה יודע( לעשות)?|מה אפשר( לעשות)?)\??$/i.test(text)) return { cmd:'help' };

  let m = text.match(/^(?:תזכיר לי|תזכירי לי|תזכורת[:\s])\s*(.+)$/s);
  if (m) {
    const { at, recurringDaily, rest } = parseWhen(m[1], now);
    if (!at) return { cmd:'reminder_missing_time', text: cleanup(m[1]) };
    return { cmd:'reminder_add', text: rest || 'תזכורת', at, recurringDaily };
  }
  if (/^(תזכורות|רשימת תזכורות|מה התזכורות)\??$/.test(text)) return { cmd:'reminder_list' };
  m = text.match(/^(?:מחק|בטל|מחקי|בטלי)\s+תזכורת\s+(\d+)$/);
  if (m) return { cmd:'reminder_delete', index: parseInt(m[1],10) };

  m = text.match(/^(?:משימה|תוסיף משימה|הוסף משימה|הוסיפי משימה|תוסיפי משימה)[:\s]+(.+)$/s);
  if (m) return { cmd:'task_add', text: cleanup(m[1]) };
  if (/^(משימות|רשימה|רשימת משימות|מה המשימות|מה יש לי ברשימה)\??$/.test(text)) return { cmd:'task_list' };
  m = text.match(/^(?:סיימתי|בוצע|ביצעתי|עשיתי|✓|וי)\s+(?:משימה\s+)?(\d+)$/);
  if (m) return { cmd:'task_done', index: parseInt(m[1],10) };
  m = text.match(/^(?:מחק|מחקי)\s+משימה\s+(\d+)$/);
  if (m) return { cmd:'task_delete', index: parseInt(m[1],10) };
  if (/^(נקה משימות|מחק משימות שבוצעו)$/.test(text)) return { cmd:'task_clear_done' };

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

  return { cmd:'unknown', text };
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

const HELP = `היי, אני רמי — העוזר האישי שלך 🤖
התזכורות שלי מגיעות כהתראת טלגרם — גם כשהכול סגור.

⏰ תזכורות
• תזכיר לי מחר ב-9 להתקשר לדני
• תזכיר לי בעוד 20 דקות להוריד כביסה
• תזכיר לי כל יום ב-8 לקחת כדור
• תזכורות / מחק תזכורת 2

📋 משימות
• משימה: לשלם ארנונה
• משימות / סיימתי 1 / מחק משימה 3

📅 יומן
• קבע פגישה עם דני ביום רביעי ב-14:00
• מה יש לי היום / מחר / השבוע

🌅 כל בוקר ב-8:00 אשלח סיכום יום.`;

// ===== אחסון ב-KV =====

const EMPTY = { tasks: [], reminders: [], events: [], nextId: 1, lastBriefDate: null, ownerChatId: null };

async function loadStore(env) {
  const raw = await env.DATA.get('store');
  return raw ? Object.assign({ ...EMPTY }, JSON.parse(raw)) : { ...EMPTY };
}
async function saveStore(env, s) {
  await env.DATA.put('store', JSON.stringify(s));
}

// ===== לוגיקת העוזר =====

function agendaText(S, range, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let from, to, title;
  if (range === 'today') { from = today.getTime(); to = from + 86400000; title = '📅 היום'; }
  else if (range === 'tomorrow') { from = today.getTime() + 86400000; to = from + 86400000; title = '📅 מחר'; }
  else { from = today.getTime(); to = from + 7*86400000; title = '📅 השבוע'; }

  const events = S.events.filter(e => e.at >= from && e.at < to).sort((a,b) => a.at - b.at);
  const rems = S.reminders.filter(r => r.at >= from && r.at < to).sort((a,b) => a.at - b.at);
  const tasks = S.tasks.filter(t => !t.done);

  let out = `${title}\n`;
  out += events.length === 0 ? '\nאין אירועים ביומן.'
    : '\n' + events.map((e,i) => `${i+1}. ${fmtDate(e.at, now)} — ${e.text}`).join('\n');
  if (rems.length) out += '\n\n⏰ תזכורות:\n' + rems.map(r => `• ${fmtDate(r.at, now)} — ${r.text}`).join('\n');
  if (tasks.length) out += `\n\n📋 משימות פתוחות (${tasks.length}):\n` + tasks.map((t,i) => `${i+1}. ${t.text}`).join('\n');
  return out;
}

function morningBrief(S, now) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = today.getTime(), to = from + 86400000;
  const events = S.events.filter(e => e.at >= from && e.at < to).sort((a,b) => a.at - b.at);
  const rems = S.reminders.filter(r => r.at >= from && r.at < to).sort((a,b) => a.at - b.at);
  const tasks = S.tasks.filter(t => !t.done);
  if (!events.length && !rems.length && !tasks.length) return null;
  let out = `🌅 בוקר טוב! הנה היום שלך:\n`;
  if (events.length) out += '\n' + events.map(e => `📅 ${fmtTime(e.at)} — ${e.text}`).join('\n');
  if (rems.length) out += '\n' + rems.map(r => `⏰ ${fmtTime(r.at)} — ${r.text}`).join('\n');
  if (tasks.length) out += `\n\n📋 משימות פתוחות:\n` + tasks.map((t,i) => `${i+1}. ${t.text}`).join('\n');
  return out;
}

// מחזיר תשובה ומעדכן את S במקום; המתקשר שומר ל-KV.
export function handleMessage(S, text, now) {
  const c = parseCommand(text, now);
  const nid = () => S.nextId++;
  const openTasks = () => S.tasks.filter(t => !t.done);
  const sortedRems = () => S.reminders.slice().sort((a,b) => a.at - b.at);

  switch (c.cmd) {
    case 'help': return HELP;

    case 'reminder_add': {
      S.reminders.push({ id: nid(), text: c.text, at: c.at.getTime(), recurringDaily: c.recurringDaily });
      const when = c.recurringDaily ? `כל יום בשעה ${fmtTime(c.at)}` : fmtDate(c.at, now);
      return `⏰ סגור! אזכיר לך ${when}:\n"${c.text}"\n\nההתראה תגיע לכאן גם אם הטלגרם סגור 👌`;
    }
    case 'reminder_missing_time':
      return `לא הצלחתי להבין מתי להזכיר לך 🤔\nנסה למשל: "תזכיר לי מחר ב-9 ${c.text}"`;
    case 'reminder_list': {
      const list = sortedRems();
      if (!list.length) return 'אין תזכורות פעילות 👌';
      return '⏰ התזכורות שלך:\n' + list.map((r,i) =>
        `${i+1}. ${r.recurringDaily ? `כל יום ב-${fmtTime(r.at)}` : fmtDate(r.at, now)} — ${r.text}`).join('\n');
    }
    case 'reminder_delete': {
      const r = sortedRems()[c.index - 1];
      if (!r) return 'לא מצאתי תזכורת עם המספר הזה. כתוב "תזכורות" לרשימה.';
      S.reminders = S.reminders.filter(x => x.id !== r.id);
      return `🗑️ מחקתי את התזכורת: "${r.text}"`;
    }

    case 'task_add': {
      S.tasks.push({ id: nid(), text: c.text, done: false });
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
      t.done = true;
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
      if (!e) return 'לא מצאתי אירוע עם המספר הזה השבוע. כתוב "השבוע" לרשימה.';
      S.events = S.events.filter(x => x.id !== e.id);
      return `🗑️ ביטלתי: "${e.text}"`;
    }

    case 'agenda': return agendaText(S, c.range, now);

    default:
      return `לא הבנתי 🤔 אני עוזר של משימות, תזכורות ויומן.\nכתוב "עזרה" כדי לראות מה אני יודע לעשות.`;
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

async function handleWebhook(env, update) {
  const msg = update.message || update.edited_message;
  const text = msg?.text;
  const chatId = msg?.chat?.id;
  if (!text || !chatId) return;

  const S = await loadStore(env);

  // המשתמש הראשון ששולח /start הופך לבעלים; כל השאר נדחים.
  if (S.ownerChatId === null && /^\/start/.test(text)) {
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

  const answer = handleMessage(S, text, ilNow());
  await saveStore(env, S);
  await tgSend(env, chatId, answer);
}

async function runCron(env) {
  const S = await loadStore(env);
  if (S.ownerChatId === null) return;

  const now = ilNow();
  const nowMs = now.getTime();
  let changed = false;

  for (const r of S.reminders.slice()) {
    if (r.at <= nowMs) {
      await tgSend(env, S.ownerChatId, `⏰ תזכורת: ${r.text}` + (r.recurringDaily ? '\n(תזכורת יומית — תחזור מחר)' : ''));
      if (r.recurringDaily) { while (r.at <= nowMs) r.at += 86400000; }
      else S.reminders = S.reminders.filter(x => x.id !== r.id);
      changed = true;
    }
  }

  const briefHour = parseInt(env.BRIEF_HOUR ?? BRIEF_HOUR_DEFAULT, 10);
  const todayStr = now.toDateString();
  if (!Number.isNaN(briefHour) && now.getHours() === briefHour && S.lastBriefDate !== todayStr) {
    S.lastBriefDate = todayStr;
    changed = true;
    const brief = morningBrief(S, now);
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
