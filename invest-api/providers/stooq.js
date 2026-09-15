// Stooq — מחירים יומיים חינמיים (CSV), ללא מפתח. ארה"ב/אירופה/מדדים. אין ת"א.
import { getText, parseCSV, num } from '../lib/http.js';

export const stooq = {
  id: 'stooq', priority: 1, supports: ['prices'],
  available: () => true,
  async prices(symbol, { from } = {}, ctx){
    const s = ctx?.asset?.stooq || (symbol.startsWith('^') ? symbol.toLowerCase() : symbol.toLowerCase().replace('.', '-') + '.us');
    await ctx.budget.spend('stooq');
    const text = await getText('stooq', `https://stooq.com/q/d/l/?s=${encodeURIComponent(s)}&i=d`);
    if (/no data|exceeded/i.test(text) || text.length < 40) return { missing: true, reason: `Stooq: אין נתונים ל-${s} (תשובה: ${text.replace(/\s+/g, ' ').slice(0, 80) || 'ריק'})` };
    const rows = parseCSV(text).map((r) => [r.Date, num(r.Open), num(r.High), num(r.Low), num(r.Close), num(r.Volume) ?? 0]).filter((r) => r[0] && r[4] !== null && (!from || r[0] >= from));
    if (!rows.length) return { missing: true, reason: `Stooq: CSV ריק (תשובה: ${text.replace(/\s+/g, ' ').slice(0, 80)})` };
    rows.sort((a, b) => a[0].localeCompare(b[0]));
    return { rows, currency: ctx?.asset?.currency || 'USD', source: 'stooq', asOf: rows[rows.length - 1][0], quality: 0.6 };
  },
};
