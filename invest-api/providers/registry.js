// שכבת ההפשטה: בוחר ספק לפי יכולת, זמינות מפתח, תקציב ועדיפות; נופל לספק הבא בשגיאה.
// כל תשובה נושאת source/asOf/quality; כישלון כולל → {missing:true, reason, tried:[...]}.
import { stooq } from './stooq.js';
import { finnhub } from './finnhub.js';
import { fmp } from './fmp.js';
import { alphavantage } from './alphavantage.js';
import { fred } from './fred.js';
import { edgar } from './edgar.js';
import { boi } from './boi.js';
import { eodhd } from './eodhd.js';

export const PROVIDERS = [eodhd, stooq, finnhub, fmp, alphavantage, fred, edgar, boi];

export function providersFor(cap, env, symbol, asset){
  return PROVIDERS.filter((p) => p.supports.includes(cap) && p.available(env) && (!p.appliesTo || p.appliesTo(symbol, asset))).sort((a, b) => a.priority - b.priority);
}

// ctx = { env, db, budget, asset }
export async function fetchWithFallback(cap, symbol, opts, ctx, { only } = {}){
  const list = providersFor(cap, ctx.env, symbol, ctx.asset).filter((p) => !only || only.includes(p.id));
  const tried = [];
  if (!list.length) return { missing: true, reason: `אין ספק זמין ל-${cap} (חסר מפתח?)`, tried };
  for (const p of list){
    try {
      if (!(await ctx.budget.canSpend(p.id))){ tried.push({ provider: p.id, error: 'תקציב יומי נגמר' }); continue; }
      const r = await p[cap](symbol, opts || {}, ctx);
      if (r && !r.missing) return { ...r, provider: p.id, tried };
      tried.push({ provider: p.id, error: r?.reason || 'missing' });
    } catch (e) {
      tried.push({ provider: p.id, error: e.message, kind: e.kind });
      await ctx.db.logError(`${p.id}.${cap}(${symbol})`, e.message);
    }
  }
  return { missing: true, reason: tried.map((t) => `${t.provider}: ${t.error}`).join(' | ') || 'no provider', tried };
}

export function providerStatus(env){
  return PROVIDERS.map((p) => ({ id: p.id, available: p.available(env), supports: p.supports, key: p.id === 'stooq' || p.id === 'edgar' || p.id === 'boi' ? 'לא נדרש' : p.available(env) ? 'מוגדר' : 'חסר' }));
}
