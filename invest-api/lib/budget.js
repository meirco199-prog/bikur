// תקציב קריאות יומי לכל ספק — כדי לא לחרוג ממכסה חינמית ולהישבר באמצע היום.
export const MINUTE_LIMITS = { twelvedata: 7, alphavantage: 4 };
export const DAILY_LIMITS = { alphavantage: 24, fmp: 230, finnhub: 5000, stooq: 2000, edgar: 3000, fred: 2000, boi: 200, eodhd: 18, twelvedata: 700, tiingo: 900 };

export class Budget {
  constructor(db, limits = DAILY_LIMITS){ this.db = db; this.limits = limits; this.local = {}; }
  key(p){ return `budget:${p}:${new Date().toISOString().slice(0, 10)}`; }
  async used(p){ if (this.local[p] === undefined) this.local[p] = (await this.db.get(this.key(p))) || 0; return this.local[p]; }
  minuteKey(p){ return `budget:m:${p}:${Math.floor(Date.now() / 60000)}`; }
  async canSpend(p, n = 1){
    const lim = this.limits[p] ?? Infinity;
    if ((await this.used(p)) + n > lim) return false;
    const ml = MINUTE_LIMITS[p];
    if (ml){ const m = (await this.db.get(this.minuteKey(p))) || 0; if (m + n > ml) return false; }
    return true;
  }
  async spend(p, n = 1){
    const u = (await this.used(p)) + n;
    this.local[p] = u;
    await this.db.put(this.key(p), u, { ttl: 48 * 3600 });
    if (MINUTE_LIMITS[p]){ const m = ((await this.db.get(this.minuteKey(p))) || 0) + n; await this.db.put(this.minuteKey(p), m, { ttl: 120 }); }
    return u;
  }
  async status(){
    const out = {};
    for (const p of Object.keys(this.limits)) out[p] = { used: await this.used(p), limit: this.limits[p] };
    return out;
  }
}
