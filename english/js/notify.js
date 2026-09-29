// תזכורות לימוד. ארבע שכבות, מהחזקה לחלשה, כדי שתקבל תזכורת גם כשהאפליקציה סגורה:
//   1. Web Push משרת (english-push) — השכבה היחידה שבאמת עובדת כשהאפליקציה סגורה.
//      השרת יודע את השעה ואת אזור הזמן שלך, ודוחף התראה בזמן. עובד באנדרואיד,
//      בדסקטופ, וב-iPhone החל מ-iOS 16.4 בתנאי שהאפליקציה הותקנה למסך הבית.
//   2. Periodic Background Sync — מעיר PWA מותקן בכרום מדי פעם. גיבוי בלבד:
//      הדפדפן מחליט מתי (ולרוב לא בזמן), אז אי אפשר לסמוך עליו לתזכורת יומית.
//   3. setTimeout — מדויק לשעה, אבל עובד רק כל עוד האפליקציה פתוחה/ברקע.
//   4. תזכורת בתוך-האפליקציה — באנר כשנכנסים, עובד בכל מכשיר.
// מצב התזכורת ממורכז ב-IndexedDB כדי שה-service worker (שאין לו גישה ל-localStorage)
// יוכל לקרוא אותו כשהוא מתעורר ברקע.
import { S, save } from "./store.js";
import { srsCounts } from "./srs.js";
import { todayStr, daysBetween } from "./util.js";
import { ensurePush, syncPush, disablePush, pushSupported } from "./push.js";
import { TEACHERS } from "./avatar.js";

// תזכורת לשיעור החי: כמה דקות לפני המועד שנקבע
export const LESSON_LEAD_MIN = 10;

export function notifSupported(){ return "Notification" in window; }

// ---------- מראה של מצב התזכורת ל-IndexedDB (נקרא ע"י ה-SW) ----------
function withStore(mode, fn){
  return new Promise((res) => {
    try {
      const r = indexedDB.open("english-reminder", 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains("kv")) r.result.createObjectStore("kv"); };
      r.onsuccess = () => {
        const db = r.result;
        const tx = db.transaction("kv", mode);
        const store = tx.objectStore("kv");
        let out;
        try { out = fn(store); } catch { out = undefined; }
        tx.oncomplete = () => { db.close(); res(out); };
        tx.onerror = () => { try { db.close(); } catch {} res(undefined); };
      };
      r.onerror = () => res(undefined);
    } catch { res(undefined); }
  });
}

function idbGet(){
  return withStore("readonly", store => {
    const g = store.get("state");
    const box = {};
    g.onsuccess = () => { box.v = g.result; };
    return box;
  }).then(box => (box && box.v) || null);
}

function idbSet(state){
  return withStore("readwrite", store => { store.put(state, "state"); return true; });
}

// האם היעד היומי הושלם: או שהושלם האימון היומי, או שנצברו מספיק דקות לימוד
function goalMetDate(){
  const t = todayStr();
  const day = S.stats.days[t];
  const target = S.profile.minutesPerDay || 10;
  return day && (day.minutes || 0) >= target ? t : null;
}

// המצב שגם ה-SW וגם השרת מקבלים. שים לב: "למד היום" נמדד לפי האימון היומי /
// עמידה ביעד הדקות — לא לפי כל פעילות קטנה, אחרת פתיחה חטופה של האפליקציה
// הייתה מבטלת את התזכורת של אותו יום.
// השיעור החי שנקבע (יום/שעה) — אותו מבנה מגיע ל-SW ולשרת. null = לא נקבע.
export function lessonSchedule(){
  const sc = S.course?.schedule;
  if (!sc || sc.weekday == null || !/^\d{1,2}:\d{2}$/.test(sc.time || "")) return null;
  const t = TEACHERS.find(x => x.id === sc.teacherId) || TEACHERS[0];
  const next = S.course.next;
  return {weekday: sc.weekday, time: sc.time, title: `${t.name}${next ? ` · Lesson ${next.n} — ${next.title}` : ""}`};
}

// האם תזכורת לשיעור מגיעה עכשיו: היום הנכון, בחלון [LEAD דקות לפני, 30 אחרי], ולא הותרע להיום.
// אותה לוגיקה בדיוק חיה גם ב-sw.js (ל-push/periodicsync) — לשמור מסונכרן.
export function lessonDueNow(st, now = new Date()){
  const l = st?.lesson;
  if (!l || !st.enabled) return false;
  if (now.getDay() !== l.weekday) return false;
  if (st.lessonNotifiedOn === todayStr(now)) return false;
  const [h, m] = l.time.split(":").map(Number);
  const target = h * 60 + m, mins = now.getHours() * 60 + now.getMinutes();
  return mins >= target - LESSON_LEAD_MIN && mins <= target + 30;
}

export function reminderState(){
  return {
    enabled: !!S.settings.notifs,
    time: S.profile.reminderTime || "20:00",
    lesson: lessonSchedule(),
    lastLesson: S.lessonDate,
    metGoal: goalMetDate(),
    lastActive: S.game.lastActive,
    streak: S.game.streak,
    due: srsCounts().due,
    updated: todayStr(),
  };
}

// כותב את המצב הנוכחי, בלי לדרוס שדות שה-SW כתב (למשל notifiedOn)
export async function syncReminderState(){
  const prev = await idbGet();
  const next = {...(prev || {}), ...reminderState()};
  await idbSet(next);
  syncPush(next);
  return next;
}

// ---------- הפעלה: מבקש הרשאה + רושם את כל השכבות ----------
export async function enableNotifs(){
  if (!notifSupported()) return false;
  let perm = Notification.permission;
  if (perm !== "granted") perm = await Notification.requestPermission();
  S.settings.notifs = perm === "granted";
  save();
  if (S.settings.notifs){
    const state = await syncReminderState();
    // קודם השכבות המקומיות: הן לא תלויות ברשת, ואם הרישום לשרת נכשל
    // לפחות תהיה תזכורת כשהאפליקציה פתוחה — במקום שום דבר.
    scheduleDaily();
    scheduleLesson();
    registerPeriodicSync();
    // הרישום לשרת ממשיך ברקע גם אם הוא איטי — לא מקפיאים את הכפתור עליו
    const registering = ensurePush(state);
    await Promise.race([registering, new Promise(r => setTimeout(r, 6000))]);
  }
  return S.settings.notifs;
}

// מוודא שהמנוי ל-push עדיין חי (מנויים פגים מדי פעם, והדפדפן לא מודיע על כך).
// נקרא בכל פתיחה של האפליקציה — זול, ומונע מצב של "מופעל אבל לא מגיע כלום".
export async function refreshPush(){
  if (!S.settings.notifs || !notifSupported() || Notification.permission !== "granted") return;
  const state = await syncReminderState();
  await ensurePush(state);
}

export async function disableNotifs(){
  S.settings.notifs = false;
  save();
  clearTimeout(reminderTimer);
  clearTimeout(lessonTimer);
  await syncReminderState();
  await disablePush();
  try {
    const reg = await navigator.serviceWorker?.ready;
    await reg?.periodicSync?.unregister?.("study-reminder");
  } catch {}
}

// Periodic Background Sync — נתמך ב-PWA מותקן בכרום/אנדרואיד. גיבוי בלבד.
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

// ---------- שכבה 3: setTimeout לשעה המדויקת (רק כשהאפליקציה פתוחה/ברקע) ----------
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
    await remindIfDue();
    scheduleDaily();
  }, delay);
}

// ---------- תזכורת לשיעור החי שנקבע (יום+שעה): טיימר מקומי ל-LEAD דקות לפני ----------
let lessonTimer = null;
export function nextLessonReminderAt(now = new Date()){
  const l = lessonSchedule();
  if (!l) return null;
  const [h, m] = l.time.split(":").map(Number);
  const d = new Date(now); d.setHours(h, m - LESSON_LEAD_MIN, 0, 0);
  let delta = (l.weekday - d.getDay() + 7) % 7;
  if (delta === 0 && d <= now) delta = 7;
  d.setDate(d.getDate() + delta);
  return d;
}
export function scheduleLesson(){
  clearTimeout(lessonTimer);
  if (!notifSupported() || Notification.permission !== "granted" || !S.settings.notifs) return false;
  const at = nextLessonReminderAt();
  if (!at) return false;
  const delay = Math.min(at - new Date(), 2 ** 31 - 1);
  lessonTimer = setTimeout(async () => {
    await remindLessonIfDue();
    scheduleLesson();
  }, Math.max(0, delay));
  return true;
}
export async function remindLessonIfDue(){
  if (!S.settings.notifs || Notification.permission !== "granted") return false;
  const state = await syncReminderState();
  if (!lessonDueNow(state)) return false;
  const shown = await showLessonReminder(state.lesson);
  if (shown) await idbSet({...state, lessonNotifiedOn: todayStr()});
  return shown;
}
export async function showLessonReminder(lesson){
  const title = `השיעור שלך מתחיל ב-${lesson.time} 🎥`;
  const opts = {body: `${lesson.title} — היכנס, המורה מחכה`, icon: "icon-192.png", badge: "icon-192.png", tag: "lesson-reminder",
    dir: "rtl", lang: "he", data: {url: "./#/live"}};
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification){ await reg.showNotification(title, opts); return true; }
  } catch {}
  try { new Notification(title, opts); return true; } catch {}
  return false;
}
// מה יקרה בפועל עם התזכורת לשיעור — למסך התזמון (לא מבטיחים מה שלא יגיע)
export function lessonReminderStatus(){
  if (!lessonSchedule()) return {ok: false, reason: "no_schedule", text: "לא נקבע מועד"};
  if (!notifSupported()) return {ok: false, reason: "unsupported", text: "הדפדפן הזה לא תומך בהתראות — לא תגיע תזכורת"};
  if (!S.settings.notifs || Notification.permission !== "granted") return {ok: false, reason: "off", text: "ההתראות כבויות — לא תגיע תזכורת לשיעור"};
  return {ok: true, reason: pushSupported() ? "push" : "local",
    text: pushSupported() ? `תזכורת ${LESSON_LEAD_MIN} דקות לפני — גם כשהאפליקציה סגורה, אם המכשיר רשום לשרת ההתראות (מצב הרישום בפרופיל)`
      : `תזכורת ${LESSON_LEAD_MIN} דקות לפני — רק כשהאפליקציה פתוחה (אין Web Push בדפדפן הזה)`};
}

// בדיקה מרוכזת: האם מגיעה תזכורת עכשיו, ואם כן — להציג אותה פעם אחת ביום
export async function remindIfDue(){
  if (!S.settings.notifs || Notification.permission !== "granted") return false;
  // האפליקציה פתוחה מול העיניים — הבאנר בדף הבית עושה את העבודה, בלי התראת מערכת
  if (document.visibilityState === "visible") return false;
  const t = todayStr();
  if (S.lessonDate === t || goalMetDate() === t) return false;
  const state = await syncReminderState();
  if (state.notifiedOn === t) return false;
  const [h, m] = (S.profile.reminderTime || "20:00").split(":").map(Number);
  const now = new Date();
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return false;
  const shown = await showReminder();
  if (shown) await idbSet({...state, notifiedOn: t});
  return shown;
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

// התראת בדיקה מקומית — לכפתור "שלח לי התראת בדיקה"
export async function testReminder(){
  await syncReminderState();
  return showReminder();
}

// ---------- אבחון: למה אין תזכורת? ----------
export function installedAsApp(){
  return window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
}
export function isIOS(){
  return /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
// מה חוסם את התזכורת במכשיר הזה — או null אם הכול תקין
export function reminderBlocker(){
  if (!notifSupported()) return isIOS() && !installedAsApp()
    ? "ב-iPhone צריך קודם להוסיף את האפליקציה למסך הבית (שיתוף → הוסף למסך הבית), ורק אז אפשר להפעיל התראות."
    : "הדפדפן הזה לא תומך בהתראות.";
  if (Notification.permission === "denied") return "חסמת התראות לאתר הזה בדפדפן. צריך לאפשר אותן בהגדרות האתר בדפדפן.";
  if (isIOS() && !installedAsApp()) return "ב-iPhone התראות עובדות רק כשהאפליקציה מותקנת במסך הבית (שיתוף → הוסף למסך הבית).";
  if (!pushSupported()) return "הדפדפן לא תומך ב-Web Push — תזכורת תגיע רק כשהאפליקציה פתוחה.";
  return null;
}

// ---------- שכבה 4: תזכורת בתוך-האפליקציה (כל מכשיר) ----------
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
