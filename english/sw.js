/* English — service worker: קאשינג לעבודה ללא אינטרנט */
var CACHE = "english-v4";
var ASSETS = [
  "./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png",
  "css/main.css",
  "js/app.js", "js/util.js", "js/store.js", "js/srs.js", "js/gamify.js", "js/speech.js",
  "js/ai.js", "js/notify.js", "js/push.js", "js/lesson.js",
  "js/data/words.js", "js/data/grammar.js", "js/data/scenarios.js", "js/data/reading.js", "js/data/test.js",
  "js/screens/onboarding.js", "js/screens/placement.js", "js/screens/home.js", "js/screens/learn.js",
  "js/screens/speak.js", "js/screens/words.js", "js/screens/teacher.js", "js/screens/profile.js"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

// ---------- תזכורות רקע ----------
// קוראים את מצב התזכורת ש-notify.js כתב ל-IndexedDB, ומחליטים אם להתריע.
function idbGetState() {
  return new Promise(function (res) {
    try {
      var r = indexedDB.open("english-reminder", 1);
      r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains("kv")) r.result.createObjectStore("kv"); };
      r.onsuccess = function () {
        var db = r.result;
        var tx = db.transaction("kv", "readonly");
        var g = tx.objectStore("kv").get("state");
        g.onsuccess = function () { db.close(); res(g.result || null); };
        g.onerror = function () { res(null); };
      };
      r.onerror = function () { res(null); };
    } catch (e) { res(null); }
  });
}
function idbPut(key, val) {
  return new Promise(function (res) {
    var r = indexedDB.open("english-reminder", 1);
    r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains("kv")) r.result.createObjectStore("kv"); };
    r.onsuccess = function () { var db = r.result; var tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(val, key); tx.oncomplete = function () { db.close(); res(); }; };
    r.onerror = function () { res(); };
  });
}
function todayISO() {
  var d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// "כבר למד היום" = השלים את האימון היומי או עמד ביעד הדקות.
// בכוונה לא לפי כל פעילות קטנה (lastActive) — אחרת פתיחה חטופה של האפליקציה
// באמצע היום הייתה מבטלת את התזכורת של אותו ערב.
function studiedOn(st, today) {
  return !!st && (st.lastLesson === today || st.metGoal === today);
}

function reminderBody(st) {
  if (st && st.due > 0) return st.due + " מילים מחכות לחזרה — כמה דקות וסיימת!";
  if (st && st.streak >= 3) return "אל תשבור את הרצף! נשאר רק האימון של היום 🔥 (" + st.streak + " ימים)";
  return "כמה דקות אנגלית עכשיו ותסמן את היום ✓";
}

async function showReminder(st, today) {
  await self.registration.showNotification("הזמן שלך ללמוד אנגלית", {
    body: reminderBody(st), icon: "icon-192.png", badge: "icon-192.png", tag: "study-reminder",
    dir: "rtl", lang: "he", data: { url: "./#/home" }
  });
  if (st) { st.notifiedOn = today; await idbPut("state", st); }
}

// מחליט אם להציג תזכורת עכשיו: מופעל, עבר זמן התזכורת, לא למד היום, לא הותרע כבר היום
async function maybeRemind() {
  var st = await idbGetState();
  if (!st || !st.enabled) return;
  var today = todayISO();
  if (studiedOn(st, today)) return;
  if (st.notifiedOn === today) return;                            // כבר הותרע היום
  var now = new Date();
  var mins = now.getHours() * 60 + now.getMinutes();
  var parts = (st.time || "20:00").split(":");
  var target = (parseInt(parts[0], 10) || 20) * 60 + (parseInt(parts[1], 10) || 0);
  if (mins < target || mins > 23 * 60 + 30) return;               // רק בין שעת התזכורת ל-23:30
  await showReminder(st, today);
}

self.addEventListener("periodicsync", function (e) {
  if (e.tag === "study-reminder") e.waitUntil(maybeRemind());
});

// Web Push מהשרת (english-push) — זה מה שמעיר את האפליקציה כשהיא סגורה.
// הדחיפה מגיעה ריקה: השרת רק אומר "הגיע הזמן", והנוסח נבנה כאן מהמצב המקומי
// כדי שיהיה מדויק (כמה מילים לחזרה, מה הרצף) גם אם השרת לא התעדכן.
self.addEventListener("push", function (e) {
  e.waitUntil((async function () {
    var data = null;
    try { data = e.data ? e.data.json() : null; } catch (err) {}
    var st = await idbGetState();
    var today = todayISO();
    // אם המכשיר כבר יודע שלמדנו היום — לא מציקים, גם אם השרת חשב אחרת
    if (studiedOn(st, today)) return;
    if (data && data.title) {
      await self.registration.showNotification(data.title, {
        body: data.body || reminderBody(st), icon: "icon-192.png", badge: "icon-192.png",
        tag: "study-reminder", dir: "rtl", lang: "he", data: { url: data.url || "./#/home" }
      });
      if (st) { st.notifiedOn = today; await idbPut("state", st); }
      return;
    }
    await showReminder(st, today);
  })());
});

// לחיצה על ההתראה — פותחת/ממקדת את האפליקציה בדף הבית
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || "./#/home";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(location.origin) === 0 && "focus" in list[i]) { list[i].focus(); return; }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});

// network-first עם נפילה לקאש — כך עדכונים מגיעים מהר אבל אופליין עובד
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // בקשות ל-AI worker לא נוגעות בקאש
  e.respondWith(
    fetch(e.request)
      .then(function (resp) {
        var copy = resp.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
        return resp;
      })
      .catch(function () { return caches.match(e.request, { ignoreSearch: true }); })
  );
});
