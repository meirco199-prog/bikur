// Twelve Data — מחירים יומיים (עד 5000 ברים) ו-quote. חינם: 800 קרדיטים/יום, 8/דקה. ארה"ב מלא, מדדים חלקית.
import { getJSON, num } from '../lib/http.js';
async function call(ctx, path, params){
  await ctx.budget.spend('twelvedata');
  const q = new URLSearchParams({ ...params, apikey: ctx.env.TWELVEDATA_KEY });
  const r = await getJSON('twelvedata', `https://api.twelvedata.com/${path}?${q}`);
  if (r.status === 'error' || r.code) throw Object.assign(new Error('twelvedata: ' + (r.message || r.code)), { kind: r.code === 429 ? 'quota' : 'error' });
  return r;
}
const symFor = (symbol, asset) => asset?.twelvedata || symbol; // Twelve Data משתמש בנקודה (BRK.B); מדדים רק אם מופה במפורש
export const twelvedata = {
  id: 'twelvedata', priority: 2, supports: ['prices', 'quote'],
  available: (env) => !!env.TWELVEDATA_KEY,
  appliesTo: (symbol, asset) => (!symbol.startsWith('^') && !/\.TA$/.test(symbol)) || !!asset?.twelvedata, // מדדים לא מכוסים בתוכנית החינמית — ETF מייצג במקומם
  async prices(symbol, { from } = {}, ctx){
    const r = await call(ctx, 'time_series', { symbol: symFor(symbol, ctx.asset), interval: '1day', outputsize: from && from > '2020' ? '400' : '5000', order: 'ASC', ...(from ? { start_date: from } : {}) });
    const vals = r.values || [];
    if (!vals.length) return { missing: true, reason: 'Twelve Data: אין ערכים' };
    const rows = vals.map((v) => [v.datetime.slice(0, 10), num(v.open), num(v.high), num(v.low), num(v.close), num(v.volume) ?? 0]).filter((x) => x[4] !== null).sort((a, b) => a[0].localeCompare(b[0]));
    return { rows, currency: r.meta?.currency || ctx.asset?.currency || 'USD', source: 'twelvedata', asOf: rows[rows.length - 1][0], quality: 0.8 };
  },
  async quote(symbol, _o, ctx){
    const q = await call(ctx, 'quote', { symbol: symFor(symbol, ctx.asset) });
    if (num(q.close) === null) return { missing: true, reason: 'Twelve Data: אין quote' };
    return { price: num(q.close), change: num(q.change), changePct: num(q.percent_change) !== null ? q.percent_change / 100 : null, high: num(q.high), low: num(q.low), open: num(q.open), prevClose: num(q.previous_close), asOf: q.datetime ? new Date(q.datetime).toISOString() : null, isMarketOpen: typeof q.is_market_open === 'boolean' ? q.is_market_open : null, source: 'twelvedata', quality: 0.85 };
  },
};
