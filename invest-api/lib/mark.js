// שערוך לפי סגירה מאומתת (AI_COUNCIL#17): כל נייר מוערך לפי שער הסגירה של יום המסחר האחרון שנסגר בניו יורק (S), לא לפי
// "המחיר שהיה בטבלת הדירוג" (שיכול להיות סגירה של יום קודם או ציטוט תוך-יומי). אם לנייר אין עדיין את השורה של S בסדרת
// המחירים — ציטוט שנמשך אחרי הסגירה נחשב סגירה; אחרת השער האחרון שיש, מסומן stale. הדוחות מציגים לכל נייר את תאריך השער,
// ושורת equity נכתבת כ"סופית" (final) רק כשכל הניירות מוערכים לפי S. שורות equity ממופתחות לפי יום הסשן, לא לפי יום העיבוד.
import { lastSessionClose, isNonTradingDay } from '../engine/session.js';
import { getPrices, assetMeta } from './analysis.js';
import { markToMarket } from '../engine/aggressive.js';
import { PaperBroker } from './broker.js';
import { isNum, round } from '../engine/util.js';

const defaultLoaders = (ctx) => ({
  prices: async (sym) => getPrices(sym, { ...ctx, asset: await assetMeta(ctx.db, sym) }).catch(() => null),
  quote: (sym) => ctx.db.get(`quote:${sym}`).catch(() => null),
});

// → { session: S, prices: { SYM: { price, asOf, source, stale, prevClose } }, stale, pricedAsOf (התאריך הישן ביותר), staleSymbols }
export async function resolveClosePrices(ctx, symbols, { session = null, now = new Date(), loaders = null } = {}){
  const L = loaders || defaultLoaders(ctx);
  const s = lastSessionClose(now); const S = session || s.date;
  const prices = {};
  for (const sym of new Set((symbols || []).filter(Boolean))){
    let px = null, qt = null;
    try { px = await L.prices(sym); } catch { px = null; }
    const rows = (px?.rows || []).filter((r) => isNum(r?.[4]) && r[4] > 0);
    const i = rows.findIndex((r) => r[0] === S);
    if (i >= 0){ prices[sym] = { price: rows[i][4], asOf: S, source: `${px.source || 'series'} (close)`, stale: false, prevClose: i > 0 ? rows[i - 1][4] : null }; continue; }
    const last = rows.length ? rows[rows.length - 1] : null;
    try { qt = await L.quote(sym); } catch { qt = null; }
    const qOk = qt && !qt.missing && isNum(qt.price) && qt.price > 0;
    // ציטוט שנמשך אחרי סגירת S (ורק כש-S הוא הסשן האחרון): זה שער הסגירה בפועל גם אם הסדרה טרם התעדכנה
    if (qOk && S === s.date && qt.fetchedAt && Date.parse(qt.fetchedAt) >= s.closeMs){
      prices[sym] = { price: qt.price, asOf: S, source: `${qt.source || 'quote'} (quote after close)`, stale: false, prevClose: last && last[0] < S ? last[4] : null }; continue;
    }
    if (last){ prices[sym] = { price: last[4], asOf: last[0], source: `${px.source || 'series'} (close)`, stale: last[0] < S, prevClose: rows.length > 1 ? rows[rows.length - 2][4] : null }; continue; }
    prices[sym] = qOk ? { price: qt.price, asOf: qt.asOf ? String(qt.asOf).slice(0, 10) : null, source: `${qt.source || 'quote'} (quote)`, stale: true, prevClose: null } : { price: null, asOf: null, source: null, stale: true, prevClose: null };
  }
  const asOfs = Object.values(prices).map((p) => p.asOf).filter(Boolean).sort();
  const staleSymbols = Object.entries(prices).filter(([, p]) => p.stale).map(([k]) => k);
  return { session: S, prices, stale: staleSymbols.length > 0, pricedAsOf: asOfs[0] || null, staleSymbols };
}

// עדכון שורה בעקומת שווי לפי יום; שורה סופית לא נדרסת בשורה זמנית. mi = אינדקס אובייקט ה-meta בשורה
const upsert = (eq, row, mi) => { const i = eq.findIndex((e) => e?.[0] === row[0]); if (i >= 0){ if (eq[i][mi]?.final && !row[mi].final) return false; eq[i] = row; return true; } eq.push(row); return true; };
const cleanRows = (eq) => (eq || []).filter((e) => e?.[0] && !isNonTradingDay(e[0]));

// כותב לחשבון התרגול ולמסלול האגרסיבי את שורת השווי של הסשן האחרון שנסגר (final רק כשכל השערים הם סגירות של אותו סשן).
// בטוח לקריאה חוזרת: בכל ריצה מתוזמנת; מחירים מהמטמון (getPrices מתרענן אחרי סגירה לפי pricesCoverLastSession)
export async function markToClose(ctx, { now = new Date(), loaders = null } = {}){
  const { db } = ctx;
  const fx = (await db.get('fx:USDILS'))?.rate || 3.7;
  const broker = new PaperBroker(db);
  const trades = await broker.trades(); const openSyms = [...new Set(trades.filter((x) => !x.exitDate).map((x) => x.symbol))];
  const aggr = await db.get('aggr:state'); const aggrSyms = Object.keys(aggr?.positions || {});
  const r = await resolveClosePrices(ctx, [...openSyms, ...aggrSyms, 'SPY'], { now, loaders });
  const S = r.session; const spy = r.prices.SPY?.price ?? null; const priceOf = (s) => r.prices[s]?.price ?? null;
  const staleOf = (syms) => syms.filter((s) => r.prices[s]?.stale !== false);
  const oldest = (syms) => syms.map((s) => r.prices[s]?.asOf).filter(Boolean).sort()[0] || S;
  const out = { session: S, spy, paper: null, aggr: null };
  const perf = await broker.performance(priceOf, fx);
  { const staleSyms = staleOf(openSyms); const meta = { final: !staleSyms.length, pricedAsOf: oldest(openSyms) };
    const eq = cleanRows(await db.get('paper:equity')); const written = upsert(eq, [S, perf.totalIls, spy, meta], 3);
    await db.put('paper:equity', eq.sort((a, b) => a[0].localeCompare(b[0])).slice(-2000));
    out.paper = { totalIls: perf.totalIls, ...meta, written, staleSymbols: staleSyms }; }
  if (aggr){ const mtm = markToMarket(aggr, priceOf, fx); const staleSyms = staleOf(aggrSyms); const meta = { final: !staleSyms.length, pricedAsOf: oldest(aggrSyms) };
    const eq = cleanRows(await db.get('aggr:equity')); const written = upsert(eq, [S, round(mtm.totalIls, 0), spy, aggr.variant ?? null, { ...mtm.exposure, positions: mtm.rows.length }, meta], 5);
    await db.put('aggr:equity', eq.sort((a, b) => a[0].localeCompare(b[0])).slice(-2000));
    out.aggr = { totalIls: round(mtm.totalIls, 0), ...meta, written, staleSymbols: staleSyms }; }
  return out;
}
