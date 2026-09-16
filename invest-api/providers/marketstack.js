// Marketstack — מחירי סוף יום ל-70+ בורסות כולל תל אביב (XTAE). חינם: 100 קריאות/חודש → רק לנכסי ת"א, היסטוריה של שנה.
import { getJSON, num } from '../lib/http.js';
export const marketstack = {
  id: 'marketstack', priority: 1, supports: ['prices'],
  available: (env) => !!env.MARKETSTACK_KEY,
  appliesTo: (symbol, asset) => /\.TA$/.test(symbol) || !!asset?.marketstack,
  async prices(symbol, { from } = {}, ctx){
    if (!(await ctx.budget.canSpend('marketstack'))) throw Object.assign(new Error('marketstack: תקציב נגמר'), { kind: 'quota' });
    await ctx.budget.spend('marketstack');
    const s = ctx.asset?.marketstack || symbol.replace(/\.TA$/, '.XTAE');
    const q = new URLSearchParams({ access_key: ctx.env.MARKETSTACK_KEY, symbols: s, limit: '1000', date_from: from || new Date(Date.now() - 370 * 86400000).toISOString().slice(0, 10) });
    const r = await getJSON('marketstack', `https://api.marketstack.com/v1/eod?${q}`);
    if (r.error) throw new Error('marketstack: ' + (r.error.message || r.error.code));
    const data = Array.isArray(r.data) ? r.data : [];
    if (!data.length) return { missing: true, reason: `Marketstack: אין נתונים ל-${s}` };
    // ת"א מצוטטת לעיתים באגורות — מזהים לפי סדר גודל ומנרמלים לש"ח
    const agorot = data[0].close > 5000 && /XTAE/.test(s);
    const f = (v) => (num(v) !== null ? (agorot ? v / 100 : v) : null);
    const rows = data.map((x) => [x.date.slice(0, 10), f(x.open), f(x.high), f(x.low), f(x.close), num(x.volume) ?? 0]).filter((x) => x[4] !== null).sort((a, b) => a[0].localeCompare(b[0]));
    return { rows, currency: ctx.asset?.currency || 'ILS', source: 'marketstack', asOf: rows[rows.length - 1][0], quality: 0.7, note: agorot ? 'הומר מאגורות לש"ח' : undefined };
  },
};
