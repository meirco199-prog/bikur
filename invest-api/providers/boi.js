// בנק ישראל — שער יציג. גיבוי: FRED DEXISUS.
import { getJSON, num } from '../lib/http.js';
export const boi = {
  id: 'boi', priority: 1, supports: ['fx'],
  available: () => true,
  async fx(pair = 'USDILS', _o, ctx){
    await ctx.budget.spend('boi');
    const cur = pair.slice(0, 3);
    const r = await getJSON('boi', 'https://boi.org.il/PublicApi/GetExchangeRates', { headers: { Accept: 'application/json' } });
    const row = (r.exchangeRates || []).find((x) => x.key === cur);
    if (!row) return { missing: true, reason: `BOI: אין שער ל-${cur}` };
    const rate = num(row.currentExchangeRate) / (num(row.unit) || 1);
    const asOf = (row.lastUpdate || '').slice(0, 10);
    return { pair, rate, change: num(row.currentChange) !== null ? row.currentChange / 100 : null, asOf, rows: [[asOf, rate]], source: 'BOI', quality: 1 };
  },
};
