// תזכורות לימוד. שלוש שכבות, מהחזקה לחלשה, כדי שתקבל תזכורת גם כשהאפליקציה סגורה:
//   1. Periodic Background Sync — מעיר PWA מותקן (אנדרואיד/כרום) ~פעם ביום גם כשסגור,
//      וה-service worker מציג התראה. זו הדרך היחידה להתראה "כשהאפליקציה סגורה" בלי שרת.
//   2. setTimeout — מדויק לשעה, אבל עובד רק כל עוד האפליקציה פתוחה/ברקע.
//   3. תזכורת בתוך-האפליקציה — באנר כשנכנסים, עובד בכל מכשיר (כולל iPhone).
// מצב התזכורת ממורכז ב-IndexedDB כדי שה-service worker (שאין לו גישה ל-localStorage)
// יוכל לקרוא אותו כשהוא מתעורר ברקע.
import { S, save } from "./store.js";
import { srsCounts } from "./srs.js";
import { todayStr, daysBetween } from "./util.js";

export function notifSupported(){ return "Notification" in window; }

// ---------- מראה של מצב התזכורת ל-IndexedDB (נקרא ע"י ה-SW) ----------
function idbSet(state){
  return new Promise((res) => {
    try {
      const r = indexedDB.open("english-reminder", 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("kv")) r.result.createObjectStore("kv"); };
      r.onsuccess = () => {
        const db = r.result;
        const tx = db.transaction("kv", "readwrite");
        tx.objectStore("kv").put(state, "state");
        tx.oncomplete = () => { db.close(); res(true); };
        tx.onerror = () => res(false);
      };
      r.onerror = () => res(false);
    } catch { res(false); }
  });
}

// כותב את המצב הנוכחי (שעה, האם למד היום, כמה מילים לחזרה) כדי שה-SW יחליט נכון
export function syncReminderState(){
  const due = srsCounts().due;
  return idbSet({
    enabled: !!S.settings.notifs,
    time: S.profile.reminderTime || "20:00",
    lastStudy: S.game.lastActive,       // תאריך פעילות אחרון
    lastLesson: S.lessonDate,
    streak: S.game.streak,
    due,
    updated: todayStr(),
  });
}

// ---------- הפעלה: מבקש הרשאה + רושם רקע ----------
export async function enableNotifs(){
  if (!notifSupported()) return false;
  let perm = Notification.permission;
  if (perm !== "granted") perm = await Notification.requestPermission();
  S.settings.notifs = perm === "granted";
  save();
  if (S.settings.notifs){
    await syncReminderState();
    await registerPeriodicSync();
    scheduleDaily();
  }
  return S.settings.notifs;
}

export function disableNotifs(){
  S.settings.notifs = false;
  save();
  clearTimeout(reminderTimer);
  syncReminderState();
  navigator.serviceWorker?.ready?.then(reg => reg.periodicSync?.unregister?.("study-reminder")).catch(() => {});
}

// Periodic Background Sync — נתמך ב-PWA מותקן בכרום/אנדרואיד. מעיר את ה-SW גם כשסגור.
async function registerPeriodicSync(){
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (!reg || !("periodicSync" in reg)) return false;
    const status = await navigator.permissions?.query({name: "periodic-background-sync"}).catch(() => null);
    if (status && status.state === "denied") return false;
    await reg.periodicSync.register("study-reminder", {minInterval: 3 * 60 * 60 * 1000}); // ~כל 3 שעות (הדפדפן מווסת)
    return true;
  } catch { return false; }
}

// ---------- שכבה 2: setTimeout לשעה המדויקת (רק כשהאפליקציה פתוחה/ברקע) ----------
let reminderTimer = null;
export function scheduleDaily(){
  if (!notifSupported() || Notification.permission !== "granted" || !S.settings.notifs) return;
  clearTimeout(reminderTimer);
  const [h, m] = (S.profile.reminderTime || "20:00").split(":").map(Number);
  const now = new Date();
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  const delay = Math.min(target - now, 2 ** 31 - 1); // תקרת setTimeout
  reminderTimer = setTimeout(async () => {
    if (S.lessonDate !== todayStr()) await showReminder();
    scheduleDaily();
  }, delay);
}

// מציג התראה דרך ה-service worker (עובד באנדרואיד ומרקע), עם נפילה ל-Notification רגיל
export async function showReminder(){
  const due = srsCounts().due;
  const streak = S.game.streak;
  let body = "כמה דקות אנגלית עכשיו ותסמן את היום ✓";
  if (due > 0) body = `${due} מילים מחכות לחזרה — ${S.profile.minutesPerDay} דקות וסיימת!`;
  else if (streak >= 3) body = `אל תשבור את הרצף! נשאר רק האימון של היום 🔥 (${streak} ימים)`;
  const title = "הזמן שלך ללמוד אנגלית";
  const opts = {body, icon: "icon-192.png", badge: "icon-192.png", tag: "study-reminder",
    dir: "rtl", lang: "he", data: {url: "./#/home"}};
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification){ await reg.showNotification(title, opts); return true; }
  } catch {}
  try { new Notification(title, opts); return true; } catch {}
  return false;
}

// שולח בקשה לבדיקת תזכורת מיד — לכפתור "שלח לי התראת בדיקה"
export async function testReminder(){
  await syncReminderState();
  return showReminder();
}

// ---------- שכבה 3: תזכורת בתוך-האפליקציה (כל מכשיר, גם iPhone) ----------
// מוצג בראש מסך הבית כשנכנסים: או "פספסת ימים", או "עוד לא למדת היום".
export function comebackMessage(){
  const last = S.game.lastActive;
  const studiedToday = S.lessonDate === todayStr();
  if (last){
    const gap = daysBetween(last, todayStr());
    if (gap >= 7) return {level: "big", text: "עבר שבוע! הכנתי לך אימון חזרה קצר במיוחד — 3 דקות ואתה בחזרה בעניינים.", quick: true};
    if (gap >= 3) return {level: "mid", text: "נמשיך מאיפה שעצרת? כמה דקות היום יחזירו אותך למסלול."};
  }
  // אותו יום: אם עברה שעת התזכורת ועדיין לא למד — תזכורת עדינה בתוך האפליקציה
  if (!studiedToday){
    const [h, m] = (S.profile.reminderTime || "20:00").split(":").map(Number);
    const now = new Date();
    const past = now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
    const due = srsCounts().due;
    if (past && due > 0) return {level: "soft", text: `הגיע הזמן לתזכורת שלך — ${due} מילים מחכות לחזרה.`, quick: true};
    if (past) return {level: "soft", text: "הגיע הזמן לתזכורת הלימוד היומית שלך 🎯", quick: true};
    if (due > 0) return {level: "soft", text: `${due} מילים מחכות לך לחזרה מהפעם הקודמת.`};
  }
  return null;
}
