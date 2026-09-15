// לקוח API ל-Worker. מטמון קצר בזיכרון, טיפול בשגיאות, אימות לכתיבה. אין מפתחות ספקים בצד הלקוח.
import { settings, idb } from './store.js';

const mem = new Map();
export class ApiError extends Error { constructor(msg, status, data){ super(msg); this.status = status; this.data = data; } }

export async function api(path, { method = 'GET', body, ttl = 0, auth = false, timeout = 45000 } = {}){
  const s = settings.get();
  const url = s.apiUrl.replace(/\/$/, '') + path;
  const key = method + url;
  if (method === 'GET' && ttl){ const c = mem.get(key); if (c && Date.now() - c.t < ttl) return c.v; }
  const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try {
    res = await fetch(url, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...((auth || method !== 'GET') && s.token ? { Authorization: `Bearer ${s.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
  } catch (e) { clearTimeout(tm); throw new ApiError(e.name === 'AbortError' ? 'ה-API לא ענה בזמן' : 'אין חיבור ל-API (' + e.message + ')', 0); }
  clearTimeout(tm);
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; }
  if (!res.ok) throw new ApiError(data.error || `HTTP ${res.status}`, res.status, data);
  if (method === 'GET' && ttl) mem.set(key, { t: Date.now(), v: data });
  return data;
}
export const invalidate = (prefix = '') => { for (const k of [...mem.keys()]) if (k.includes(prefix)) mem.delete(k); };

// bundle (מחירים+דוחות+פרופיל) עם מטמון IndexedDB ליום — לחישובים בדפדפן
export async function getBundle(symbol, { maxAgeH = 20 } = {}){
  const key = `bundle:${symbol}`;
  const c = await idb.get(key);
  if (c && Date.now() - c.savedAt < maxAgeH * 3600e3) return c.value;
  const b = await api(`/bundle/${symbol}`);
  if (b.prices && !b.prices.missing) await idb.set(key, b);
  return b;
}
export async function health(){ try { return await api('/health', { ttl: 30000, timeout: 10000 }); } catch (e) { return { ok: false, error: e.message }; } }
