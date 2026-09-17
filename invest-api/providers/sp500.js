// חברות S&P 500 — שרשרת מקורות: ויקיפדיה (חינם, כולל ענף GICS) → FMP sp500-constituent (תוכנית בתשלום) → החזקות SPY (FMP).
// כל מקור מחזיר {items:[{symbol,name,sector,weight?}], source}. אין המצאות: מקור שנכשל = הערה, לא רשימה ריקה בשקט.
import { getText } from '../lib/http.js';

const WIKI_URL = 'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies';
const UA = 'bikur-invest/1.0 (https://github.com/meirco199-prog/bikur; research tool)';
const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#160;|&nbsp;/g, ' ').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const SYM = /^[A-Z][A-Z0-9.\-]{0,6}$/;

export function parseWikipediaSp500(html){
  const start = html.indexOf('id="constituents"');
  if (start < 0) throw new Error('wikipedia: טבלת constituents לא נמצאה');
  const end = html.indexOf('</table>', start);
  const table = html.slice(start, end);
  const items = [];
  for (const tr of table.split(/<tr[\s>]/).slice(1)){
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
    if (cells.length < 3) continue;
    const symbol = cells[0].replace(/\s.*$/, '');
    if (!SYM.test(symbol)) continue;
    items.push({ symbol, name: cells[1], sector: cells[2] || null, subSector: cells[3] || null });
  }
  if (items.length < 400) throw new Error(`wikipedia: רק ${items.length} שורות — מבנה הדף השתנה?`);
  return items;
}

export async function fetchSp500Members(ctx, { fmp = null } = {}){
  const notes = [];
  try {
    const html = await getText('wikipedia', WIKI_URL, { headers: { 'User-Agent': UA, Accept: 'text/html' } }, 15000);
    return { items: parseWikipediaSp500(html), source: 'wikipedia', notes };
  } catch (e) { notes.push(`wikipedia: ${e.message.slice(0, 120)}`); }
  if (fmp && ctx.env.FMP_KEY){
    try { const r = await fmp.sp500(ctx); return { items: r.items, source: 'fmp', notes }; } catch (e) { notes.push(`fmp sp500: ${e.message.slice(0, 120)}`); }
    try {
      const h = await fmp.etfHoldingsFull('SPY', ctx);
      if (h.length >= 400) return { items: h.map((x) => ({ symbol: x.symbol, name: x.name, sector: null, weight: x.weight })), source: 'spy-holdings', notes };
      notes.push(`spy holdings: רק ${h.length}`);
    } catch (e) { notes.push(`spy holdings: ${e.message.slice(0, 120)}`); }
  }
  return { items: [], source: null, notes };
}
