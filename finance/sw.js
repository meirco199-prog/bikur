/* Service Worker — מטמון האפליקציה בלבד. נתוני המשתמש נשמרים ב-localStorage. */
const CACHE = 'bikur-finance-v1';

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

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // ספריות חיצוניות (Excel/PDF) — מהרשת, בלי מטמון
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  );
});
