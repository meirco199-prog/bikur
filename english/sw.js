/* English — service worker: קאשינג לעבודה ללא אינטרנט */
var CACHE = "english-v1";
var ASSETS = [
  "./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png",
  "css/main.css",
  "js/app.js", "js/util.js", "js/store.js", "js/srs.js", "js/gamify.js", "js/speech.js",
  "js/ai.js", "js/notify.js", "js/lesson.js",
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
