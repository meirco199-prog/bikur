// שכבת נתונים מעל Cloudflare KV. סכימת המפתחות ב-invest/docs/DATABASE_SCHEMA.md.
// חוזה: snapshots (snap:/rank:/regime:/reco:) נכתבים רק דרך putIfAbsent — לעולם לא נדרסים.
export class DB {
  constructor(kv){ this.kv = kv; this.mem = new Map(); }
  async get(key, def = null){
    if (!this.kv) return this.mem.has(key) ? this.mem.get(key) : def;
    const v = await this.kv.get(key, 'json');
    return v === null || v === undefined ? def : v;
  }
  async put(key, value, { ttl } = {}){
    if (!this.kv){ this.mem.set(key, value); return; }
    const opts = ttl ? { expirationTtl: Math.max(60, ttl) } : undefined;
    await this.kv.put(key, JSON.stringify(value), opts);
  }
  async delete(key){ if (!this.kv){ this.mem.delete(key); return; } await this.kv.delete(key); }
  async putIfAbsent(key, value){
    const ex = await this.get(key);
    if (ex !== null) return false;
    await this.put(key, value);
    return true;
  }
  async list(prefix, limit = 1000){
    if (!this.kv) return [...this.mem.keys()].filter((k) => k.startsWith(prefix)).sort().slice(0, limit);
    const keys = [];
    let cursor;
    do {
      const r = await this.kv.list({ prefix, cursor, limit: Math.min(1000, limit - keys.length) });
      keys.push(...r.keys.map((k) => k.name));
      cursor = r.list_complete ? null : r.cursor;
    } while (cursor && keys.length < limit);
    return keys;
  }
  // מיזוג שורות עם תאריך בעמודה 0: חדש גובר, ישן לא נמחק
  static mergeRows(oldRows = [], newRows = []){
    const m = new Map(oldRows.map((r) => [r[0], r]));
    for (const r of newRows) m.set(r[0], r);
    return [...m.values()].sort((a, b) => a[0].localeCompare(b[0]));
  }
  async logError(where, msg){
    try {
      const log = (await this.get('log:err')) || [];
      log.push({ ts: new Date().toISOString(), where, msg: String(msg).slice(0, 300) });
      await this.put('log:err', log.slice(-200));
    } catch { /* לוג לא מפיל את הבקשה */ }
  }
  async appendDay(key, item, max = 500){
    const arr = (await this.get(key)) || [];
    arr.push(item);
    await this.put(key, arr.slice(-max));
  }
}
