// תזכורות: התראות מקומיות (Notification API) בזמן שהאפליקציה פתוחה ברקע,
// ותזכורות חכמות בתוך האפליקציה לפי פעילות. (Push אמיתי מהשרת דורש backend מנוהל —
// כאן הכול מקומי ופרטי.)
import { S, save } from "./store.js";
import { srsCounts } from "./srs.js";
import { todayStr, daysBetween } from "./util.js";

export function notifSupported(){ return "Notification" in window; }

export async function enableNotifs(){
  if (!notifSupported()) return false;
  const perm = await Notification.requestPermission();
  S.settings.notifs = perm === "granted";
  save();
  if (S.settings.notifs) scheduleDaily();
  return S.settings.notifs;
}

let reminderTimer = null;

// מתזמן את התראת התזכורת הבאה לשעה שבחר המשתמש (פועל כשהאפליקציה פתוחה/ברקע)
export function scheduleDaily(){
  if (!notifSupported() || Notification.permission !== "granted" || !S.settings.notifs) return;
  clearTimeout(reminderTimer);
  const [h, m] = (S.profile.reminderTime || "20:00").split(":").map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  reminderTimer = setTimeout(() => {
    fireReminder();
    scheduleDaily();
  }, target - now);
}

function fireReminder(){
  const due = srsCounts().due;
  const streak = S.game.streak;
  let body = "הגיע הזמן לאימון האנגלית היומי שלך 🎯";
  if (due > 0) body = `${due} מילים מחכות לחזרה. ${S.profile.minutesPerDay} דקות וסיימת!`;
  else if (streak >= 3) body = `שמור על רצף של ${streak} ימים — נשאר רק האימון של היום 🔥`;
  try {
    new Notification("English — הזמן שלך ללמוד", {body, icon: "icon-192.png", tag: "daily-reminder"});
  } catch { /* בחלק מהדפדפנים בנייד נדרש service worker */ }
}

// הודעת "ברוך שובך" חכמה לפי ימי היעדרות — מוצגת בתוך האפליקציה
export function comebackMessage(){
  const last = S.game.lastActive;
  if (!last) return null;
  const gap = daysBetween(last, todayStr());
  if (gap >= 7) return {level: "big", text: "עבר שבוע! הכנתי לך אימון חזרה קצר במיוחד — 3 דקות ואתה בחזרה בעניינים.", quick: true};
  if (gap >= 3) return {level: "mid", text: "נמשיך מאיפה שעצרת? כמה דקות היום יחזירו אותך למסלול."};
  if (gap >= 1 && srsCounts().due > 0) return {level: "soft", text: `${srsCounts().due} מילים מחכות לך לחזרה מהפעם הקודמת.`};
  return null;
}
