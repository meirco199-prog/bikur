// משותף לסימולציות "המניות שירדו הכי הרבה" (research-losers.mjs, research-losers-grid.mjs): הורדה, יקום S&P 1500, עמלות IBKR.
export const UA = { 'User-Agent': 'Mozilla/5.0 (research backtest)', Accept: '*/*' };
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (...a) => console.error(...a);
export async function get(url, tries = 4){ for (let k = 0; k < tries; k++){ try { const r = await fetch(url, { headers: UA }); if (r.status === 429){ await sleep(3000 * (k + 1)); continue; } if (!r.ok) return null; return await r.text(); } catch { await sleep(1000 * (k + 1)); } } return null; }

export async function universe(){
  const pages = ['List_of_S%26P_500_companies', 'List_of_S%26P_400_companies', 'List_of_S%26P_600_companies'], set = new Set();
  for (const p of pages){
    const h = await get(`https://en.wikipedia.org/wiki/${p}`); if (!h) { log('wiki fail', p); continue; }
    let n = 0;
    // תא ראשון בשורה עם קישור לבורסה (nyse/nasdaq) או טקסט טיקר
    for (const m of h.matchAll(/<td[^>]*>\s*<a[^>]*href="https?:\/\/(?:www\.)?(?:nyse|nasdaq)\.com[^"]*"[^>]*>([A-Z][A-Z0-9.\-]{0,6})<\/a>/g)){ set.add(m[1].replace('.', '-')); n += 1; }
    if (!n) for (const m of h.matchAll(/<tr>\s*<td[^>]*>\s*(?:<a[^>]*>)?([A-Z][A-Z0-9.\-]{0,6})(?:<\/a>)?\s*\n?<\/td>/g)){ set.add(m[1].replace('.', '-')); n += 1; }
    log(`${p}: ${n}`);
  }
  if (set.size < 400){ // גיבוי: רשימת S&P 500 מ-datasets ב-GitHub
    const csv = await get('https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv');
    for (const line of (csv || '').split('\n').slice(1)){ const t = line.split(',')[0]?.trim(); if (/^[A-Z][A-Z0-9.\-]{0,6}$/.test(t)) set.add(t.replace('.', '-')); }
    log(`after csv fallback: ${set.size}`);
  }
  if (set.size < 300) throw new Error(`יקום קטן מדי (${set.size}) — לא מריצים סימולציה על נתונים חסרים`);
  return [...set];
}
export const comm = (sh, px) => Math.min(Math.max(1, 0.005 * sh), 0.01 * sh * px);
export const sellFees = (sh, px) => 0.0000278 * sh * px + Math.min(0.000166 * sh, 8.3);
