// תקציב קריאות לספקים. KV חינמי = 1,000 כתיבות/יום — לכן כל המונים במפתח אחד ליום, נצברים בזיכרון ונכתבים פעם אחת (flush).
export const MINUTE_LIMITS = { twelvedata: 7, alphavantage: 4 };
export const DAILY_LIMITS = { alphavantage: 24, fmp: 230, finnhub: 5000, stooq: 2000, edgar: 3000, fred: 2000, boi: 200, eodhd: 18, twelvedata: 700, tiingo: 900, marketstack: 3 };
const MINUTE = new Map(); // per-isolate (מספיק: ה-tick ממתין 6 שניות בין קריאות, ה-cron רץ כל 10 דקות)

export class Budget {
  constructor(db, limits = DAILY_LIMITS){ this.db = db; this.limits = limits; this.loaded = null; this.dirty = false; }
  key(){ return `budget:${new Date().toISOString().slice(0, 10)}`; }
  async load(){ if (!this.loaded) this.loaded = (await this.db.get(this.key())) || {}; return this.loaded; }
  async used(p){ return (await this.load())[p] || 0; }
  async canSpend(p, n = 1){
    if ((await this.used(p)) + n > (this.limits[p] ?? Infinity)) return false;
    const ml = MINUTE_LIMITS[p];
    if (ml){ const k = `${p}:${Math.floor(Date.now() / 60000)}`; if ((MINUTE.get(k) || 0) + n > ml) return false; }
    return true;
  }
  async spend(p, n = 1){
    const b = await this.load(); b[p] = (b[p] || 0) + n; this.dirty = true;
    if (MINUTE_LIMITS[p]){ const k = `${p}:${Math.floor(Date.now() / 60000)}`; MINUTE.set(k, (MINUTE.get(k) || 0) + n); if (MINUTE.size > 200) MINUTE.clear(); }
    return b[p];
  }
  // endpoint שהתוכנית לא כוללת (402/401/403): לא לשרוף עליו קריאה לכל נייר בכל לילה — חסימה ליום (נשמרת עם התקציב)
  async block(p, cap){ const b = await this.load(); b._blocked = b._blocked || {}; b._blocked[`${p}:${cap}`] = new Date().toISOString(); this.dirty = true; }
  async blocked(p, cap){ const b = await this.load(); return !!b._blocked?.[`${p}:${cap}`]; }
  async flush(){ if (!this.dirty) return; this.dirty = false; await this.db.put(this.key(), this.loaded, { ttl: 48 * 3600 }); }
  async status(){ const b = await this.load(); const out = {}; for (const p of Object.keys(this.limits)) out[p] = { used: b[p] || 0, limit: this.limits[p] }; return out; }
}
