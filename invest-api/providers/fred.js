// FRED — מאקרו רשמי (Fed St. Louis). מפתח חינמי.
import { getJSON, num } from '../lib/http.js';
export const fred = {
  id: 'fred', priority: 1, supports: ['macro'],
  available: (env) => !!env.FRED_KEY,
  async macro(seriesId, { from } = {}, ctx){
    await ctx.budget.spend('fred');
    const q = new URLSearchParams({ series_id: seriesId, api_key: ctx.env.FRED_KEY, file_type: 'json', observation_start: from || '2000-01-01' });
    const r = await getJSON('fred', `https://api.stlouisfed.org/fred/series/observations?${q}`);
    const rows = (r.observations || []).map((o) => [o.date, num(o.value)]).filter((x) => x[1] !== null);
    if (!rows.length) return { missing: true, reason: `FRED: אין תצפיות ל-${seriesId}` };
    return { series: seriesId, rows, source: 'FRED', asOf: rows[rows.length - 1][0], quality: 1 };
  },
};
