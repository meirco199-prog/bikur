// אחסון מקומי של המעבדה: אסטרטגיות שמורות (localStorage, עם גרסאות) ותוצאות שמורות (IndexedDB). בלי שרת — הכול אצל המשתמש.
const KEY = 'invest.lab.strategies.v1', SET = 'invest.lab.settings.v1';
export const DEFAULT_BASE = 'https://raw.githubusercontent.com/meirco199-prog/bikur/lab-data/';
const DEFAULTS = { dataBase: DEFAULT_BASE, apiUrl: 'https://invest-api.meirco199.workers.dev', theme: null, lastRange: { from: null, to: null } };
let sc = null;
export const labSettings = {
  get(){ if (!sc){ try { sc = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(SET) || '{}') || {}) }; } catch { sc = { ...DEFAULTS }; } } return sc; },
  set(p){ sc = { ...this.get(), ...p }; try { localStorage.setItem(SET, JSON.stringify(sc)); } catch {} return sc; },
};
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
function readAll(){ try { return JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch { return []; } }
function writeAll(list){ try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { throw new Error('אין מקום באחסון המקומי: ' + e.message); } }
export const strategies = {
  list(){ return readAll().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')); },
  get(id){ return readAll().find((s) => s.id === id) || null; },
  // שמירה: אסטרטגיה חדשה או גרסה חדשה לקיימת (ההיסטוריה נשמרת ב-versions)
  save({ id = null, name, spec, params = {}, templateId = null, note = '' }){
    const list = readAll(), now = new Date().toISOString();
    let s = id ? list.find((x) => x.id === id) : null;
    if (!s){ s = { id: uid(), createdAt: now, versions: [] }; list.push(s); }
    else s.versions.push({ v: s.version || 1, spec: s.spec, params: s.params, savedAt: s.updatedAt, note: s.note });
    Object.assign(s, { name: name || spec.name || 'אסטרטגיה', spec: { ...spec, name: name || spec.name }, params, templateId, note, version: (s.version || 0) + 1, updatedAt: now });
    if (s.versions.length > 20) s.versions = s.versions.slice(-20);
    writeAll(list); return s;
  },
  duplicate(id){ const s = this.get(id); if (!s) return null; return this.save({ name: s.name + ' (עותק)', spec: { ...s.spec, name: s.name + ' (עותק)' }, params: s.params, templateId: s.templateId, note: 'שוכפל מ-' + s.name }); },
  remove(id){ writeAll(readAll().filter((s) => s.id !== id)); },
  restore(id, v){ const s = this.get(id); const ver = s?.versions.find((x) => x.v === v); if (!ver) return null; return this.save({ id, name: s.name, spec: ver.spec, params: ver.params, templateId: s.templateId, note: `שוחזר מגרסה ${v}` }); },
  exportAll(){ return JSON.stringify(readAll(), null, 1); },
  importAll(json){ const arr = JSON.parse(json); if (!Array.isArray(arr)) throw new Error('קובץ לא תקין'); const list = readAll(); for (const s of arr) if (s && s.spec){ const ex = list.find((x) => x.id === s.id); if (ex) Object.assign(ex, s); else list.push({ ...s, id: s.id || uid() }); } writeAll(list); return list.length; },
};
// IndexedDB לתוצאות (גדולות)
function openDb(){ return new Promise((res) => { if (!('indexedDB' in globalThis)) return res(null); const r = indexedDB.open('invest-lab', 1); r.onupgradeneeded = () => r.result.createObjectStore('results'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); }
let dbp;
export const results = {
  async save(entry){ const db = await (dbp ||= openDb()); if (!db) return null; const id = entry.id || uid(); const rec = { ...entry, id, savedAt: new Date().toISOString() }; await new Promise((res) => { const t = db.transaction('results', 'readwrite').objectStore('results').put(rec, id); t.onsuccess = res; t.onerror = res; }); return rec; },
  async get(id){ const db = await (dbp ||= openDb()); if (!db) return null; return new Promise((res) => { const t = db.transaction('results').objectStore('results').get(id); t.onsuccess = () => res(t.result || null); t.onerror = () => res(null); }); },
  async list(){ const db = await (dbp ||= openDb()); if (!db) return []; return new Promise((res) => { const out = []; const c = db.transaction('results').objectStore('results').openCursor(); c.onsuccess = (e) => { const cur = e.target.result; if (cur){ const v = cur.value; out.push({ id: v.id, name: v.name, savedAt: v.savedAt, summary: v.summary, from: v.from, to: v.to, kind: v.kind || 'backtest', strategyId: v.strategyId || null }); cur.continue(); } else res(out.sort((a, b) => b.savedAt.localeCompare(a.savedAt))); }; c.onerror = () => res(out); }); },
  async remove(id){ const db = await (dbp ||= openDb()); if (!db) return; await new Promise((res) => { const t = db.transaction('results', 'readwrite').objectStore('results').delete(id); t.onsuccess = res; t.onerror = res; }); },
};
