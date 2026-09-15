// תקציב קריאות יומי לכל ספק — כדי לא לחרוג ממכסה חינמית ולהישבר באמצע היום.
export const DAILY_LIMITS = { alphavantage: 24, fmp: 230, finnhub: 5000, stooq: 2000, edgar: 3000, fred: 2000, boi: 200, eodhd: 18 };

export class Budget {
  constructor(db, limits = DAILY_LIMITS){ this.db = db; this.limits = limits; this.local = {}; }
  key(p){ return `budget:${p}:${new Date().toISOString().slice(0, 10)}`; }
  async used(p){ if (this.local[p] === undefined) this.local[p] = (await this.db.get(this.key(p))) || 0; return this.local[p]; }
  async canSpend(p, n = 1){ const lim = this.limits[p] ?? Infinity; return (await this.used(p)) + n <= lim; }
  async spend(p, n = 1){
    const u = (await this.used(p)) + n;
    this.local[p] = u;
    await this.db.put(this.key(p), u, { ttl: 48 * 3600 });
    return u;
  }
  async status(){
    const out = {};
    for (const p of Object.keys(this.limits)) out[p] = { used: await this.used(p), limit: this.limits[p] };
    return out;
  }
}
