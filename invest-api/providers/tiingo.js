// Tiingo — מחירים יומיים מותאמים (adjusted) למניות/ETF בארה"ב. חינם: ~1000 קריאות/יום, 50/שעה.
import { getJSON, num } from '../lib/http.js';
export const tiingo = {
  id: 'tiingo', priority: 3, supports: ['prices'],
  available: (env) => !!env.TIINGO_KEY,
  appliesTo: (symbol) => !symbol.startsWith('^') && !/\.TA$/.test(symbol),
  async prices(symbol, { from } = {}, ctx){
    await ctx.budget.spend('tiingo');
    const s = symbol.replace('.', '-').toLowerCase();
    const q = new URLSearchParams({ startDate: from || '2000-01-01', token: ctx.env.TIINGO_KEY, format: 'json' });
    const arr = await getJSON('tiingo', `https://api.tiingo.com/tiingo/daily/${encodeURIComponent(s)}/prices?${q}`);
    if (!Array.isArray(arr) || !arr.length) return { missing: true, reason: 'Tiingo: אין נתונים' };
    const rows = arr.map((x) => [x.date.slice(0, 10), num(x.adjOpen ?? x.open), num(x.adjHigh ?? x.high), num(x.adjLow ?? x.low), num(x.adjClose ?? x.close), num(x.adjVolume ?? x.volume) ?? 0]).filter((x) => x[4] !== null);
    return { rows, currency: 'USD', source: 'tiingo', asOf: rows[rows.length - 1][0], quality: 0.85 };
  },
};
