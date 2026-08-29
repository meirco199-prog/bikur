/* ============================================================
   store.js — שכבת הנתונים
   ------------------------------------------------------------
   כל הגישה לנתונים עוברת דרך כאן. המחלקה LocalAdapter היא המימוש
   הנוכחי (localStorage). כדי לעבור ל-Supabase יש לממש מתאם עם אותו
   ממשק (load / persist / insert / update / remove / bulk) ולהחליף
   שורה אחת ב-createStore. שאר האפליקציה לא משתנה.
   ============================================================ */

import { uid, deepClone } from './util.js';
import { emptyState, SCHEMA_VERSION } from './schema.js';

const STORAGE_KEY = 'bikur.finance.v1';
const UNDO_LIMIT = 25;
const AUDIT_LIMIT = 500;

/* ============================================================
   מתאם אחסון מקומי
   ============================================================ */
export class LocalAdapter {
  constructor(key = STORAGE_KEY) { this.key = key; this.name = 'local'; }

  async load() {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return migrate(parsed);
    } catch (err) {
      console.error('[store] קריאת הנתונים נכשלה', err);
      return null;
    }
  }

  async persist(state) {
    try {
      localStorage.setItem(this.key, JSON.stringify(state));
      return true;
    } catch (err) {
      console.error('[store] שמירת הנתונים נכשלה', err);
      if (err?.name === 'QuotaExceededError') {
        throw new Error('אין מספיק מקום אחסון בדפדפן. מומלץ לייצא גיבוי ולמחוק ייבוא ישן.');
      }
      throw err;
    }
  }

  async clear() { localStorage.removeItem(this.key); }
}

/* ============================================================
   שלד מתאם Supabase — מוכן להשלמה, אינו בשימוש כרגע
   ------------------------------------------------------------
   הממשק זהה, כך שהמעבר הוא החלפת שורה אחת ב-createStore().
   כל טבלה ממופה 1:1 לאוסף המקומי (ראו supabase-schema.sql).
   ============================================================ */
export class SupabaseAdapter {
  constructor({ client, userId }) {
    this.client = client;
    this.userId = userId;
    this.name = 'supabase';
  }
  async load() {
    const tables = ['categories', 'accounts', 'transactions', 'budgets', 'merchant_rules', 'imports', 'months'];
    const state = emptyState();
    for (const t of tables) {
      const { data, error } = await this.client.from(t).select('*').eq('user_id', this.userId);
      if (error) throw error;
      state[camel(t)] = data || [];
    }
    const { data: s } = await this.client.from('settings').select('*').eq('user_id', this.userId).maybeSingle();
    if (s) state.settings = { ...state.settings, ...s.data };
    return state;
  }
  async persist() { /* ב-Supabase השמירה נעשית פר-פעולה ולא על כל המצב */ }
  async insert(collection, row) {
    const { error } = await this.client.from(snake(collection)).insert({ ...row, user_id: this.userId });
    if (error) throw error;
  }
  async update(collection, id, patch) {
    const { error } = await this.client.from(snake(collection)).update(patch).eq('id', id).eq('user_id', this.userId);
    if (error) throw error;
  }
  async remove(collection, id) {
    const { error } = await this.client.from(snake(collection)).delete().eq('id', id).eq('user_id', this.userId);
    if (error) throw error;
  }
  async bulk(collection, rows) {
    const withUser = rows.map((r) => ({ ...r, user_id: this.userId }));
    const { error } = await this.client.from(snake(collection)).insert(withUser);
    if (error) throw error;
  }
}

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const snake = (s) => s.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

/* ============================================================
   מיגרציות
   ============================================================ */
function migrate(state) {
  if (!state || typeof state !== 'object') return null;
  const base = emptyState();
  const merged = { ...base, ...state, settings: { ...base.settings, ...(state.settings || {}) } };
  merged.months = merged.months || {};
  for (const key of ['categories', 'accounts', 'transactions', 'budgets', 'merchantRules', 'imports', 'audit']) {
    if (!Array.isArray(merged[key])) merged[key] = [];
  }
  merged.version = SCHEMA_VERSION;
  return merged;
}

/* ============================================================
   החנות
   ============================================================ */
class Store {
  constructor(adapter) {
    this.adapter = adapter;
    this.state = emptyState();
    this.listeners = new Map();
    this.undoStack = [];
    this.ready = false;
    this._saveTimer = null;
    this._muted = 0;
  }

  /* ---------- אירועים ---------- */
  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, new Set());
    this.listeners.get(evt).add(fn);
    return () => this.listeners.get(evt)?.delete(fn);
  }
  emit(evt, payload) {
    if (this._muted) return;
    this.listeners.get(evt)?.forEach((fn) => {
      try { fn(payload); } catch (err) { console.error(`[store] מאזין ${evt} נכשל`, err); }
    });
    if (evt !== '*') this.emit('*', { type: evt, payload });
  }
  /** ביצוע פעולות מרובות ללא רינדור ביניים */
  batch(fn) {
    this._muted++;
    try { return fn(); } finally { this._muted--; }
  }

  /* ---------- מחזור חיים ---------- */
  async init() {
    const loaded = await this.adapter.load();
    if (loaded) this.state = loaded;
    this.ready = true;
    this.emit('ready', this.state);
    return this.state;
  }

  /** שמירה מושהית — מונעת כתיבה על כל הקשה */
  save(immediate = false) {
    clearTimeout(this._saveTimer);
    if (immediate) return this.adapter.persist(this.state);
    return new Promise((resolve, reject) => {
      this._saveTimer = setTimeout(() => {
        this.adapter.persist(this.state).then(resolve).catch(reject);
      }, 220);
    });
  }

  replaceState(next) {
    this.state = migrate(next) || emptyState();
    this.save(true);
    this.emit('reset', this.state);
    this.emit('change', { collection: '*' });
  }

  async wipe() {
    this.state = emptyState();
    await this.adapter.clear?.();
    await this.save(true);
    this.emit('reset', this.state);
    this.emit('change', { collection: '*' });
  }

  /* ---------- קריאה ---------- */
  all(collection) { return this.state[collection] || []; }
  get(collection, id) { return (this.state[collection] || []).find((r) => r.id === id) || null; }
  find(collection, fn) { return (this.state[collection] || []).filter(fn); }

  /* ---------- כתיבה ---------- */
  insert(collection, row, { audit = true } = {}) {
    if (!this.state[collection]) this.state[collection] = [];
    this.state[collection].push(row);
    this.adapter.insert?.(collection, row);
    if (audit) this.log('create', collection, row.id, row.name || row.id);
    this.save();
    this.emit('change', { collection, action: 'insert', row });
    return row;
  }

  bulkInsert(collection, rows, { audit = true } = {}) {
    if (!rows.length) return [];
    if (!this.state[collection]) this.state[collection] = [];
    this.state[collection].push(...rows);
    this.adapter.bulk?.(collection, rows);
    if (audit) this.log('create-bulk', collection, null, `${rows.length} רשומות`);
    this.save();
    this.emit('change', { collection, action: 'bulk', rows });
    return rows;
  }

  update(collection, id, patch, { audit = true } = {}) {
    const list = this.state[collection] || [];
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const before = list[idx];
    const next = { ...before, ...patch, updatedAt: Date.now() };
    list[idx] = next;
    this.adapter.update?.(collection, id, patch);
    if (audit) this.log('update', collection, id, describeChange(before, patch));
    this.save();
    this.emit('change', { collection, action: 'update', row: next, before });
    return next;
  }

  updateMany(collection, ids, patch, { audit = true } = {}) {
    const set = new Set(ids);
    const list = this.state[collection] || [];
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      if (set.has(list[i].id)) { list[i] = { ...list[i], ...patch, updatedAt: Date.now() }; n++; }
    }
    if (audit && n) this.log('update-bulk', collection, null, `${n} רשומות`);
    this.save();
    this.emit('change', { collection, action: 'update-many', ids });
    return n;
  }

  /** מחיקה עם אפשרות ביטול */
  remove(collection, id, { audit = true, undoable = true } = {}) {
    const list = this.state[collection] || [];
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    const [row] = list.splice(idx, 1);
    this.adapter.remove?.(collection, id);
    if (undoable) this.pushUndo({ type: 'insert', collection, rows: [deepClone(row)], index: idx });
    if (audit) this.log('delete', collection, id, row.name || row.merchant || id);
    this.save();
    this.emit('change', { collection, action: 'remove', row });
    return row;
  }

  removeMany(collection, ids, { audit = true, undoable = true } = {}) {
    const set = new Set(ids);
    const list = this.state[collection] || [];
    const removed = list.filter((r) => set.has(r.id)).map(deepClone);
    this.state[collection] = list.filter((r) => !set.has(r.id));
    removed.forEach((r) => this.adapter.remove?.(collection, r.id));
    if (undoable && removed.length) this.pushUndo({ type: 'insert', collection, rows: removed });
    if (audit && removed.length) this.log('delete-bulk', collection, null, `${removed.length} רשומות`);
    this.save();
    this.emit('change', { collection, action: 'remove-many', ids });
    return removed.length;
  }

  /* ---------- ביטול פעולה ---------- */
  pushUndo(entry) {
    this.undoStack.push({ ...entry, at: Date.now() });
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
    this.emit('undo-available', this.undoStack.length);
  }

  canUndo() { return this.undoStack.length > 0; }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    if (entry.type === 'insert') {
      if (!this.state[entry.collection]) this.state[entry.collection] = [];
      if (typeof entry.index === 'number' && entry.rows.length === 1) {
        this.state[entry.collection].splice(entry.index, 0, entry.rows[0]);
      } else {
        this.state[entry.collection].push(...entry.rows);
      }
      entry.rows.forEach((r) => this.adapter.insert?.(entry.collection, r));
    } else if (entry.type === 'remove') {
      const set = new Set(entry.rows.map((r) => r.id));
      this.state[entry.collection] = (this.state[entry.collection] || []).filter((r) => !set.has(r.id));
    } else if (entry.type === 'restore') {
      const list = this.state[entry.collection] || [];
      for (const row of entry.rows) {
        const idx = list.findIndex((r) => r.id === row.id);
        if (idx > -1) list[idx] = row;
      }
    }
    this.log('undo', entry.collection, null, `שוחזרו ${entry.rows.length} רשומות`);
    this.save();
    this.emit('change', { collection: entry.collection, action: 'undo' });
    return true;
  }

  /* ---------- הגדרות ---------- */
  setting(key, fallback = null) {
    const v = this.state.settings?.[key];
    return v === undefined ? fallback : v;
  }
  setSetting(key, value) {
    this.state.settings = { ...this.state.settings, [key]: value };
    this.save();
    this.emit('settings', this.state.settings);
    this.emit('change', { collection: 'settings', key });
  }

  /* ---------- מטא-דאטה של חודשים ---------- */
  monthMeta(key) { return this.state.months?.[key] || null; }
  setMonthMeta(key, patch) {
    this.state.months = this.state.months || {};
    this.state.months[key] = { ...(this.state.months[key] || { key }), ...patch };
    this.save();
    this.emit('change', { collection: 'months', key });
  }

  /* ---------- יומן ביקורת ---------- */
  log(action, entity, entityId, details = '') {
    if (!Array.isArray(this.state.audit)) this.state.audit = [];
    this.state.audit.unshift({ id: uid('log'), ts: Date.now(), action, entity, entityId, details });
    if (this.state.audit.length > AUDIT_LIMIT) this.state.audit.length = AUDIT_LIMIT;
  }
}

function describeChange(before, patch) {
  const keys = Object.keys(patch).filter((k) => k !== 'updatedAt' && before[k] !== patch[k]);
  if (!keys.length) return 'ללא שינוי';
  return keys.slice(0, 4).join(', ');
}

/** נקודת ההחלפה היחידה בין localStorage ל-Supabase */
export function createStore(adapter = new LocalAdapter()) {
  return new Store(adapter);
}

export const store = createStore();
export default store;
