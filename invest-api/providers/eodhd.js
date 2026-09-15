// EODHD — כיסוי בורסת ת"א (.TA) ומדדים (TA35.INDX). בתשלום; פעיל רק עם EODHD_KEY.
import { getJSON, num } from '../lib/http.js';
export const eodhd = {
  id: 'eodhd', priority: 0, supports: ['prices'],
  available: (env) => !!env.EODHD_KEY,
  appliesTo: (symbol, asset) => /\.TA$/i.test(symbol) || !!asset?.eodhd,
  async prices(symbol, { from } = {}, ctx){
    if (!(await ctx.budget.canSpend('eodhd'))) throw Object.assign(new Error('eodhd: תקציב יומי נגמר'), { kind: 'quota' });
    await ctx.budget.spend('eodhd');
    const s = ctx?.asset?.eodhd || symbol;
    const q = new URLSearchParams({ api_token: ctx.env.EODHD_KEY, fmt: 'json', from: from || '2000-01-01' });
    const arr = await getJSON('eodhd', `https://eodhd.com/api/eod/${encodeURIComponent(s)}?${q}`);
    if (!Array.isArray(arr) || !arr.length) return { missing: true, reason: 'EODHD: אין נתונים' };
    const rows = arr.map((x) => [x.date, num(x.open), num(x.high), num(x.low), num(x.adjusted_close ?? x.close), num(x.volume) ?? 0]).filter((x) => x[4] !== null);
    return { rows, currency: ctx?.asset?.currency || 'ILS', source: 'eodhd', asOf: rows[rows.length - 1][0], quality: 0.8 };
  },
};
