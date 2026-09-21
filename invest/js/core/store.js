// הגדרות מקומיות (localStorage) + מטמון bundles (IndexedDB) לחישובים בדפדפן.
const KEY = 'invest.settings.v1';
const DEFAULTS = { apiUrl: 'https://invest-api.meirco199.workers.dev', token: '', computeMode: 'auto', theme: 'light', portfolioSize: 200000, notifications: false, lastAlertSeen: '' };
let cache = null;
export const settings = {
  get(){ if (!cache){ try { cache = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) || '{}')) }; } catch { cache = { ...DEFAULTS }; } } return cache; },
  set(patch){ cache = { ...this.get(), ...patch }; try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch {} return cache; },
};
// IndexedDB פשוט: store אחד של {key, value, savedAt}
function openDb(){
  return new Promise((res, rej) => {
    if (!('indexedDB' in globalThis)) return res(null);
    const r = indexedDB.open('invest-cache', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => res(null);
  });
}
let dbp;
export const idb = {
  async get(key){ const db = await (dbp ||= openDb()); if (!db) return null; return new Promise((res) => { const t = db.transaction('kv').objectStore('kv').get(key); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); }); },
  async set(key, value){ const db = await (dbp ||= openDb()); if (!db) return; return new Promise((res) => { const t = db.transaction('kv', 'readwrite').objectStore('kv').put({ value, savedAt: Date.now() }, key); t.onsuccess = () => res(); t.onerror = () => res(); }); },
  async clear(){ const db = await (dbp ||= openDb()); if (!db) return; return new Promise((res) => { const t = db.transaction('kv', 'readwrite').objectStore('kv').clear(); t.onsuccess = () => res(); t.onerror = () => res(); }); },
};
