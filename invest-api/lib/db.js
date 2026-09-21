// שכבת נתונים מעל Cloudflare KV. סכימת המפתחות ב-invest/docs/DATABASE_SCHEMA.md.
// חוזה: snapshots (snap:/rank:/regime:/reco:) נכתבים רק דרך putIfAbsent — לעולם לא נדרסים.
export let kvWriteLimitHit = null; // חותמת זמן אם KV דחה כתיבה (מכסה יומית)
export class DB {
  // secrets: ערכי סוד (מפתחות API, טוקנים) שלעולם לא נכתבים ללוג — ספקים מסוימים מחזירים את המפתח בתוך הודעת השגיאה
  constructor(kv, { secrets = [] } = {}){ this.kv = kv; this.mem = new Map(); this.secrets = [...new Set(secrets.filter((s) => typeof s === 'string' && s.length >= 8))]; }
  redact(msg){
    let m = String(msg ?? '');
    for (const s of this.secrets) m = m.split(s).join('***');
    return m.replace(/(api[ _-]?key(?: as|[:=])\s*)[A-Za-z0-9_\-]{8,}/gi, '$1***').replace(/([?&](?:apikey|api_key|token|api_token|secret)=)[^&\s]+/gi, '$1***');
  }
  async get(key, def = null){
    if (!this.kv) return this.mem.has(key) ? this.mem.get(key) : def;
    const v = await this.kv.get(key, 'json');
    return v === null || v === undefined ? def : v;
  }
  async put(key, value, { ttl } = {}){
    if (!this.kv){ this.mem.set(key, value); return; }
    const opts = ttl ? { expirationTtl: Math.max(60, ttl) } : undefined;
    try { await this.kv.put(key, JSON.stringify(value), opts); }
    catch (e) { if (/limit exceeded/i.test(e.message)) kvWriteLimitHit = new Date().toISOString(); throw e; }
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
      log.push({ ts: new Date().toISOString(), where, msg: this.redact(msg).slice(0, 300) });
      await this.put('log:err', log.slice(-200));
    } catch { /* לוג לא מפיל את הבקשה */ }
  }
  // השגיאות האחרונות, מוסתרות גם אם נכתבו לפני שהוגדרה ההסתרה (רשומות ישנות ב-KV)
  async recentErrors(n = 10){ return ((await this.get('log:err')) || []).slice(-n).map((e) => ({ ...e, msg: this.redact(e.msg) })); }
  async appendDay(key, item, max = 500){
    const arr = (await this.get(key)) || [];
    arr.push(item);
    await this.put(key, arr.slice(-max));
  }
}
