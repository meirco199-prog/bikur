/* ============================================================
   Service Worker — מטמון האפליקציה בלבד.
   נתוני המשתמש נשמרים ב-localStorage ואינם עוברים כאן.
   ------------------------------------------------------------
   מנגנון העדכון:
   שינוי ה-VERSION מייצר מטמון חדש, מוחק את הישן, ומודיע לדף
   שיש גרסה חדשה — כך שאין צורך להתקין את האפליקציה מחדש.
   ============================================================ */

const VERSION = '2026.08.29.4';
const CACHE = `bikur-finance-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/components.css',
  './css/layout.css',
  './js/app.js',
  './js/core/util.js',
  './js/core/schema.js',
  './js/core/store.js',
  './js/core/seed.js',
  './js/domain/finance.js',
  './js/domain/insights.js',
  './js/domain/recurring.js',
  './js/importer/parse.js',
  './js/importer/classify.js',
  './js/importer/dedupe.js',
  './js/importer/pipeline.js',
  './js/ui/components.js',
  './js/ui/charts.js',
  './js/ui/nav.js',
  './js/ui/txform.js',
  './js/ui/exporters.js',
  './js/screens/gate.js',
  './js/screens/dashboard.js',
  './js/screens/months.js',
  './js/screens/transactions.js',
  './js/screens/import.js',
  './js/screens/compare.js',
  './js/screens/budgets.js',
  './js/screens/insights.js',
  './js/screens/forecast.js',
  './js/screens/categories.js',
  './js/screens/accounts.js',
  './js/screens/settings.js',
];

/* ---------- התקנה: הגרסה החדשה נכנסת לתוקף מיד ---------- */
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // קובץ בודד שנכשל לא יפיל את כל ההתקנה
      .then((c) => Promise.allSettled(ASSETS.map((a) => c.add(a))))
      .then(() => self.skipWaiting()),
  );
});

/* ---------- הפעלה: ניקוי מטמונים ישנים ותפיסת הלשוניות ---------- */
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/* ---------- שליפה: קודם רשת, מטמון כגיבוי ---------- */
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // ספריות חיצוניות (Excel/PDF, גופנים) — ישירות מהרשת
  if (url.origin !== location.origin) return;

  e.respondWith(
    // no-cache מאלץ אימות מול השרת בכל בקשה, ולכן קוד חדש שנפרס
    // מגיע מיד ולא ממטמון ה-HTTP של הדפדפן. אם הדפדפן לא מאפשר
    // לשנות את מצב המטמון לבקשה מסוימת — נופלים לבקשה רגילה.
    fromNetwork(e.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((cached) => {
        if (cached) return cached;
        // רק לניווט מחזירים את שלד האפליקציה; בקשת JS שתקבל HTML תישבר
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })),
  );
});

function fromNetwork(request) {
  try {
    return fetch(request, { cache: 'no-cache' });
  } catch (err) {
    return fetch(request);
  }
}

/* ---------- תקשורת עם הדף ---------- */
self.addEventListener('message', (e) => {
  if (e.data === 'GET_VERSION' || e.data?.type === 'GET_VERSION') {
    e.ports?.[0]?.postMessage(VERSION);
  }
  if (e.data === 'SKIP_WAITING' || e.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
