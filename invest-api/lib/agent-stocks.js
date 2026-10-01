// מניות בודדות ליקום הסוכן (החלטת בעל הריפו 1/10/2026: "תוסיף" — AI_COUNCIL#21).
// הסוכן לא מתמחר 500 סדרות מ-Twelve Data (מכסה ~800/יום). במקום זה scripts/nightly-sp500.mjs, שכבר מושך כל לילה את מחירי
// כל חברות ה-S&P 500 ב-GitHub Actions, מריץ עליהן את אותו מנוע הזדמנויות (engine/opportunities.js) ושולח לכאן את המועמדים
// המובילים. הסוכן ממזג אותם עם מועמדי ה-ETF/קריפטו/מט"ח/חוזים, והשער (order-gate) מחליט כרגיל. מניה שנקנתה מתומחרת מאז
// מ-Twelve Data כמו כל מכשיר אחר (מילוי בפתיחה, עצירות, שערוך) — רק הסריקה עצמה מגיעה מבחוץ.
// מפתחות KV: agent:stocks:<day> (הסריקה של סשן day, 14 יום), agent:stocks:universe (רשימת המניות + סקטור, נדרסת כל לילה).
import { stockInstrument, stockSector, registerInstruments, instrumentOf } from '../engine/instruments.js';
import { STRATEGIES } from '../engine/opportunities.js';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const STOCK_CANDIDATES_MAX = 30;
const UNIVERSE_MAX = 700;

const cleanSym = (s) => (typeof s === 'string' && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s) ? s : null);

/** POST /agent/stocks (סוד ה-cron): { day, scanned, summary, candidates:[...], universe:[{symbol,name,sector}] } */
export async function recordStockScan(db, body = {}){
  const day = DAY_RE.test(String(body.day || '')) ? body.day : null;
  if (!day) throw new Error('day חסר או לא תקין');
  const universe = (Array.isArray(body.universe) ? body.universe : []).slice(0, UNIVERSE_MAX)
    .map((u) => ({ symbol: cleanSym(u?.symbol), name: String(u?.name || '').slice(0, 80) || null, sector: u?.sector ? String(u.sector).slice(0, 40) : null })).filter((u) => u.symbol);
  const candidates = (Array.isArray(body.candidates) ? body.candidates : []).slice(0, STOCK_CANDIDATES_MAX)
    .filter((c) => cleanSym(c?.symbol) && c.day === day && Number.isFinite(c.price) && Number.isFinite(c.stop) && Number.isFinite(c.score) && (c.side === 'long' || c.side === 'short') && Object.hasOwn(STRATEGIES, c.strategy) && !c.needsResearch)
    .map((c) => ({ ...c, class: 'stock', fromStockScan: true }));
  const rec = { day, receivedAt: new Date().toISOString(), scanned: Number(body.scanned) || 0, summary: body.summary || null, candidates };
  await db.put(`agent:stocks:${day}`, rec, { ttl: 14 * 86400 });
  if (universe.length) await db.put('agent:stocks:universe', { day, items: universe });
  return { ok: true, day, candidates: candidates.length, universe: universe.length };
}

/** רישום המניות לפני כל עבודה עם מצב הסוכן: יקום ה-S&P מהלילה + כל מניה שמוחזקת או ממתינה (גם אם יצאה מהמדד) */
export async function registerAgentStocks(db, { state = null, pending = null } = {}){
  const uni = (await db.get('agent:stocks:universe'))?.items || [];
  registerInstruments(uni.map((u) => stockInstrument(u.symbol, { name: u.name, sector: stockSector(u.sector) })));
  const st = state || (await db.get('agent:state'));
  const pd = pending || (await db.get('agent:pending'));
  const extra = [];
  for (const [sym, p] of Object.entries(st?.positions || {})) if (p?.class === 'stock' && !instrumentOf(sym)) extra.push(stockInstrument(sym, { sector: p.sector }));
  for (const o of pd?.orders || []) if (o?.class === 'stock' && !instrumentOf(o.symbol)) extra.push(stockInstrument(o.symbol, { sector: o.sector }));
  registerInstruments(extra);
  return uni.length + extra.length;
}

/** GET /agent/stocks?date= — הסריקה האחרונה (ציבורי) */
export async function stockScanReport(db, day = null){
  const d = DAY_RE.test(String(day || '')) ? day : (await db.get('agent:stocks:universe'))?.day || null;
  const rec = d ? await db.get(`agent:stocks:${d}`) : null;
  return rec || { missing: true, day: d, reason: 'אין סריקת מניות ליום הזה (רצה בלילה ב-nightly-sp500)' };
}
