// Web Push — השכבה היחידה שמביאה תזכורת גם כשהאפליקציה סגורה לגמרי.
// הלקוח נרשם מול שירות ה-push של הדפדפן, ושולח לשרת (english-push) את המנוי,
// את אזור הזמן, את שעת התזכורת ואת מצב הלימוד. השרת בודק כל 5 דקות מי צריך
// תזכורת ודוחף. הדחיפה עצמה ריקה מתוכן — ה-service worker מרכיב את הנוסח
// מהמצב שנשמר ב-IndexedDB, כך שההודעה תמיד מעודכנת למה שקורה במכשיר.
import { S } from "./store.js";

const KEY_CACHE = "english-push-key";     // מפתח ה-VAPID שאיתו נרשמנו בפועל

export function pushSupported(){
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function base(){ return String(S.settings.pushUrl || "").trim().replace(/\/+$/, ""); }

function bytesFromB64url(s){
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// רישום ל-push תלוי בשירות חיצוני (FCM וכו') שיכול להיתקע כשאין רשת טובה.
// בלי תקרת זמן, הפעלת התזכורת הייתה נתקעת והשכבות המקומיות לא היו נדלקות.
function withTimeout(promise, ms, tag){
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(tag || "timeout")), ms)),
  ]);
}

async function post(path, body){
  const r = await fetch(base() + path, {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body),
  });
  return r.json();
}

async function serverKey(){
  const r = await fetch(base() + "/key", {cache: "no-store"});
  const d = await r.json();
  if (!d.key) throw new Error("no_key");
  return d.key;
}

// המנוי הקיים, אם יש — בלי ליצור חדש
export async function currentSub(){
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// רישום (או חידוש) המנוי + שליחת המצב לשרת. מחזיר {ok, reason}
export async function ensurePush(state){
  if (!pushSupported()) return {ok: false, reason: "unsupported"};
  if (!base()) return {ok: false, reason: "no_server"};
  if (Notification.permission !== "granted") return {ok: false, reason: "permission"};
  try {
    const reg = await withTimeout(navigator.serviceWorker.ready, 10000, "sw_timeout");
    const key = await withTimeout(serverKey(), 10000, "server_timeout");
    let sub = await reg.pushManager.getSubscription();
    // אם השרת החליף מפתח — המנוי הישן כבר לא יתקבל, נרשמים מחדש
    if (sub && localStorage.getItem(KEY_CACHE) !== key){
      try { await sub.unsubscribe(); } catch {}
      sub = null;
    }
    if (!sub){
      sub = await withTimeout(
        reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: bytesFromB64url(key)}),
        15000, "subscribe_timeout");
    }
    localStorage.setItem(KEY_CACHE, key);
    await withTimeout(sendState(sub, state, true), 10000, "sync_timeout");
    return {ok: true, endpoint: sub.endpoint};
  } catch (e){
    return {ok: false, reason: e?.message || "failed"};
  }
}

// שולח את המצב לשרת. force=true עוקף את החסכון בבקשות.
let lastSent = "", lastSentAt = 0;
async function sendState(sub, state, force){
  const payload = {
    sub: sub.toJSON(),
    tz: new Date().getTimezoneOffset(),
    time: state.time,
    enabled: state.enabled,
    lastLesson: state.lastLesson,
    metGoal: state.metGoal,
    due: state.due,
    streak: state.streak,
  };
  const sig = JSON.stringify([payload.tz, payload.time, payload.enabled, payload.lastLesson, payload.metGoal, payload.due]);
  // שולחים כשמשהו השתנה, או לכל היותר פעם בשעה — כדי לא להציף את השרת
  if (!force && sig === lastSent && Date.now() - lastSentAt < 3600e3) return;
  lastSent = sig; lastSentAt = Date.now();
  await post("/subscribe", payload);
}

// עדכון שוטף — נקרא אחרי כל מסך/סיום אימון
export async function syncPush(state){
  if (!pushSupported() || !base() || Notification.permission !== "granted") return;
  try {
    const sub = await currentSub();
    if (!sub) return;
    await sendState(sub, state, false);
  } catch {}
}

export async function disablePush(){
  try {
    const sub = await currentSub();
    if (!sub) return;
    const endpoint = sub.endpoint;
    try { await sub.unsubscribe(); } catch {}
    lastSent = "";
    if (base()) await post("/unsubscribe", {endpoint});
  } catch {}
}

// בדיקה אמיתית של המסלול "אפליקציה סגורה": השרת דוחף עכשיו דרך הדפדפן
export async function testPush(){
  const sub = await currentSub();
  if (!sub) return {ok: false, reason: "no_sub"};
  try { return await post("/test", {endpoint: sub.endpoint}); }
  catch (e){ return {ok: false, reason: e?.message || "failed"}; }
}

// מה השרת יודע עלינו — לחלונית האבחון בפרופיל
export async function pushStatus(){
  const sub = await currentSub();
  if (!sub) return {found: false, subscribed: false};
  try {
    const r = await fetch(base() + "/status?endpoint=" + encodeURIComponent(sub.endpoint), {cache: "no-store"});
    return {...(await r.json()), subscribed: true};
  } catch { return {found: false, subscribed: true, error: true}; }
}
