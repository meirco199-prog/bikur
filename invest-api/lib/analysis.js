// אורקסטרציה: איסוף נתונים לנכס → engine → snapshot. רץ ב-Worker (cron / on-demand).
// כל בלוק נתונים נושא source/asOf/quality; חסר = missing. אין השלמות שקטות.
import { cached, TTL } from './cache.js';
import { pricesCoverLastSession } from '../engine/session.js';
import { DB } from './db.js';
import { fetchWithFallback } from '../providers/registry.js';
import { edgar } from '../providers/edgar.js';
import { alphavantage } from '../providers/alphavantage.js';
import { SEED_UNIVERSE, TASE_UNIVERSE, INDICES, MACRO_SERIES, findAsset, BENCHMARK_FOR } from '../engine/universe.js';
import { classifyRegime } from '../engine/regime.js';
import { clusterNews } from '../engine/news.js';
import { buildPortfolios } from '../engine/portfolio.js';
import { isoDate, isNum, round, addDays } from '../engine/util.js';
import { analyzeBundle, toSnapshot, rankSnapshots } from '../engine/pipeline.js';
export { analyzeBundle, toSnapshot, rankSnapshots };

export const SYM_RE = /^[A-Z0-9.^\-]{1,12}$/;
export const today = () => isoDate();
const ANALYSIS_BARS = 1500; // ~6 שנים — מספיק ל-SMA200, מומנטום, P/E היסטורי 5 שנים; חוסך CPU

// ---------- universe ----------
export async function getUniverse(db, env = null){
  const extra = (await db.get('meta:universe')) || [];
  const map = new Map(SEED_UNIVERSE.map((a) => [a.symbol, { ...a, origin: 'seed' }]));
  if (!env || env.MARKETSTACK_KEY || env.EODHD_KEY) for (const a of TASE_UNIVERSE) map.set(a.symbol, { ...a, origin: 'seed' });
  for (const a of extra) if (a?.symbol && !map.has(a.symbol)) map.set(a.symbol, a);
  return [...map.values()];
}
export async function addToUniverse(db, entries){
  const extra = (await db.get('meta:universe')) || [];
  const have = new Set([...SEED_UNIVERSE.map((a) => a.symbol), ...extra.map((a) => a.symbol)]);
  let added = 0;
  for (const e of entries){ if (!e?.symbol || have.has(e.symbol)) continue; extra.push({ ...e, addedAt: today() }); have.add(e.symbol); added++; }
  if (added) await db.put('meta:universe', extra.slice(-1500));
  return added;
}
export async function assetMeta(db, symbol){
  const s = symbol.toUpperCase();
  const seed = findAsset(s);
  if (seed) return seed;
  const extra = (await db.get('meta:universe')) || [];
  const e = extra.find((a) => a.symbol === s);
  if (e) return e;
  return { symbol: s, name: s, type: 'stock', assetClass: 'equity', role: 'satellite', country: /\.TA$/.test(s) ? 'IL' : 'US', currency: /\.TA$/.test(s) ? 'ILS' : 'USD', origin: 'adhoc' };
}

// ---------- נתוני שוק (עם מטמון) ----------
// המטמון (20 שעות) פוקע גם כשהסדרה לא כוללת עדיין את הסגירה האחרונה בניו יורק (נכסים בדולר) — אחרת הניתוח הלילי ותמחור התיק
// עלולים לעבוד על הסגירה של שלשום. אם הספק טרם פרסם את הסגירה, מנסים שוב לכל היותר כל 30 דקות.
const PRICES_RETRY_SEC = 30 * 60;
export async function getPrices(symbol, ctx){
  const key = `px:${symbol}`;
  const usd = (ctx.asset?.currency || 'USD') !== 'ILS';
  return cached(ctx.db, key, TTL.prices, async (ex) => {
    const from = ex?.rows?.length ? ex.rows[ex.rows.length - 1][0].slice(0, 4) + '-01-01' : undefined; // רענון: מהשנה האחרונה
    const r = await fetchWithFallback('prices', symbol, { from }, ctx);
    return r;
  }, { merge: (old, fresh) => ({ ...fresh, rows: DB.mergeRows(old.rows, fresh.rows) }), staleIf: (ex, age) => usd && age > PRICES_RETRY_SEC && !pricesCoverLastSession(ex.rows, ex.fetchedAt) });
}
export const getQuote = (symbol, ctx) => cached(ctx.db, `quote:${symbol}`, TTL.quote, () => fetchWithFallback('quote', symbol, {}, ctx));
export const getProfile = (symbol, ctx) => cached(ctx.db, `profile:${symbol}`, TTL.profile, async () => {
  const r = await fetchWithFallback('profile', symbol, {}, ctx);
  if (r?._overview){ // Alpha Vantage: OVERVIEW מכיל גם יחסים וגם אנליסטים — נשמור אותם בלי קריאה נוספת
    const o = r._overview; delete r._overview;
    await ctx.db.put(`ratios:${symbol}`, { ...alphavantage.ratiosFromOverview(o), fetchedAt: new Date().toISOString() });
    const an = alphavantage.analystFromOverview(o); if (!an.missing) await ctx.db.put(`analyst:av:${symbol}`, { ...an, fetchedAt: new Date().toISOString() });
  }
  return r;
});
export const getFacts = (symbol, ctx) => cached(ctx.db, `facts:${symbol}`, TTL.facts, async () => {
  const e = await fetchWithFallback('facts', symbol, {}, ctx, { only: ['edgar'] });
  if (!e.missing) return e;
  return fetchWithFallback('facts', symbol, {}, ctx, { only: ['fmp'] });
});
export const getRatios = (symbol, ctx) => cached(ctx.db, `ratios:${symbol}`, TTL.ratios, () => fetchWithFallback('ratios', symbol, {}, ctx));
// תחזיות אנליסטים + היסטוריה שבועית (esthist) כדי למדוד כיוון וגודל של שינויי תחזיות (revisions), לא רק "קנייה/החזקה".
// כל נקודה נושאת את תאריך שנת הכספים (fy1Date) כדי שההשוואה תהיה לאותה תקופה חשבונאית.
export async function getEstimates(symbol, ctx){
  const est = await cached(ctx.db, `est:${symbol}`, TTL.est, () => fetchWithFallback('estimates', symbol, {}, ctx));
  try {
    if (est && !est.missing && (est.eps?.fy1 !== null && est.eps?.fy1 !== undefined)){
      const key = `esthist:${symbol}`; const hist = (await ctx.db.get(key)) || [];
      const last = hist[hist.length - 1]; const t = today();
      if (!last || (Date.parse(t) - Date.parse(last.date)) / 86400000 >= 6){ hist.push({ date: t, epsFy1: est.eps.fy1, epsFy2: est.eps.fy2 ?? null, fy1Date: est.eps.fy1Date || null, fy2Date: est.eps.fy2Date || null, revFy1: est.revenue?.fy1 ?? null, analysts: est.analysts ?? null }); await ctx.db.put(key, hist.slice(-26)); }
    }
  } catch {}
  return est;
}
// שינוי תחזית ל-30 יום, לאותה שנת כספים: (EPS FY היום − EPS אותה FY לפני ≥30 יום) / |ישן|.
// לא ממציאים: בלי היסטוריה מספיקה → available:false עם סיבה (לא 0). שנה שהתחלפה (FY1 של היום היה FY2 אז) → משווים ל-epsFy2 הישן.
export async function estimateRevision(db, symbol, days = 30){
  const hist = (await db.get(`esthist:${symbol}`)) || [];
  const now = hist[hist.length - 1];
  if (!now) return { available: false, reason: 'אין היסטוריית תחזיות עדיין' };
  const span = hist.length ? Math.round((Date.parse(now.date) - Date.parse(hist[0].date)) / 86400000) : 0;
  if (span < days) return { available: false, reason: `היסטוריה של ${span} ימים בלבד (נדרשים ${days})`, historyDays: span, points: hist.length };
  if (!now.fy1Date) return { available: false, reason: 'נקודה נוכחית בלי שנת כספים' };
  const cutoff = Date.parse(now.date) - days * 86400000;
  const past = [...hist].reverse().find((h) => Date.parse(h.date) <= cutoff);
  if (!past) return { available: false, reason: 'אין נקודה ישנה מספיק' };
  let old = null;
  if (past.fy1Date === now.fy1Date) old = past.epsFy1;
  else if (past.fy2Date === now.fy1Date) old = past.epsFy2;
  if (!isNum(old) || !old) return { available: false, reason: 'אין תחזית לאותה שנת כספים בנקודה הישנה (השנה התחלפה)', fy: now.fy1Date };
  return { available: true, days: Math.round((Date.parse(now.date) - Date.parse(past.date)) / 86400000), epsRevision: round((now.epsFy1 - old) / Math.abs(old), 4), fy: now.fy1Date, from: past.date, to: now.date, points: hist.length };
}
export const getEtf = (symbol, ctx) => cached(ctx.db, `etf:${symbol}`, TTL.etf, () => fetchWithFallback('etf', symbol, {}, ctx));
export const getInsider = (symbol, ctx) => cached(ctx.db, `insider:${symbol}`, TTL.insider, () => fetchWithFallback('insider', symbol, {}, ctx));
// תאריך דוח: קודם מלוח הדוחות היומי (meta:earncal, קריאה אחת ליום לכל השוק, טווח 21 יום), ואז פרטני (שבועי) לתאריכים רחוקים ולהפתעות עבר.
// לוח טרי בלי החברה = אין דוח בטווח הלוח, גם אם המטמון הפרטני חשב אחרת (תאריכים זזים).
export async function getEarnings(symbol, ctx){
  const base = await cached(ctx.db, `earn:${symbol}`, TTL.earn, () => fetchWithFallback('earnings', symbol, {}, ctx));
  const cal = await ctx.db.get('meta:earncal');
  const fresh = cal?.asOf && (Date.parse(today()) - Date.parse(cal.asOf)) / 86400000 <= 2 && cal.byTicker;
  if (!fresh) return base;
  const hit = cal.byTicker[symbol];
  const b = base && !base.missing ? base : { last: [] };
  if (hit) return { ...b, next: hit.date, nextTime: hit.time || null, source: 'fmp-calendar', asOf: cal.asOf, missing: false };
  if (cal.complete && b.next && b.next >= cal.from && b.next <= cal.to) return { ...b, next: null, nextNote: `הלוח היומי (${cal.asOf}) לא מציג דוח עד ${cal.to} — התאריך ${b.next} מהמטמון בוטל` };
  return base;
}
export async function refreshEarningsCalendar(ctx){
  if (!ctx.env.FMP_KEY) return null;
  const { fmp } = await import('../providers/fmp.js');
  const from = today(), to = addDays(from, 21);
  const r = await fmp.earningsCalendar({ from, to }, ctx);
  await ctx.db.put('meta:earncal', r);
  return r;
}
// יקום מכני: חברי S&P 500 (FMP) → נזילות (screener) → מכסה ענפית (engine/mechanical.js). נופל לרשימת "הגדולות" אם ה-endpoint לא זמין.
export async function refreshMechanicalUniverse(ctx, { cap = null, reset = false, maxAdd = null } = {}){
  const { db, env } = ctx;
  const { fmp } = await import('../providers/fmp.js');
  const { fetchSp500Members } = await import('../providers/sp500.js');
  const { selectMechanical, MECHANICAL_RULE } = await import('../engine/mechanical.js');
  const m = await fetchSp500Members(ctx, { fmp });
  const notes = [...m.notes];
  const members = m.items;
  // גודל/נזילות: screener של FMP (בתשלום ברוב התוכניות) → משקל ב-SPY (etf/holdings) → בלי נתוני גודל (דגימה מרובדת)
  let screener = [];
  if (env.FMP_KEY){
    for (const limit of [1000, 100]){
      const r = await fetchWithFallback('screener', '', { minMarketCap: limit === 1000 ? 2e9 : 2e10, minVolume: MECHANICAL_RULE.minVolume, limit, country: 'US', isEtf: false }, ctx);
      if (r.items?.length){ screener = r.items; break; }
      notes.push(`screener(limit ${limit}): ${r.reason || 'ריק'}`);
      if (/paid plan|unauthorized/i.test(r.reason || '')) break;
    }
  } else notes.push('screener: אין FMP_KEY');
  const liquidity = Object.fromEntries(screener.map((x) => [x.symbol, { volume: x.volume, marketCap: x.marketCap, sector: x.sector, name: x.name }]));
  if (!screener.length && env.FMP_KEY){
    try { const h = await fmp.etfHoldingsFull('SPY', ctx); let n = 0; for (const x of h) if (isNum(x.weight) && x.weight > 0){ liquidity[x.symbol] = { volume: null, marketCap: x.weight * 1e12, name: x.name }; n++; } notes.push(`spy holdings: ${n} משקלים כגודל`); } catch (e) { notes.push(`spy holdings: ${e.message.slice(0, 120)}`); }
  }
  for (const x of members) if (!liquidity[x.symbol] && isNum(x.weight)) liquidity[x.symbol] = { volume: null, marketCap: x.weight * 1e12, sector: x.sector, name: x.name };
  let sel, source;
  if (members.length){ sel = selectMechanical({ members, liquidity, cap: cap || +env.UNIVERSE_CAP || MECHANICAL_RULE.cap }); source = m.source; }
  else if (screener.length){
    const items = screener.filter((x) => (x.marketCap || 0) >= 2e10).sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 120);
    sel = { items: items.map((x) => ({ symbol: x.symbol, name: x.name, sector: x.sector, marketCap: x.marketCap, volume: x.volume })), members: 0, liquid: items.length, liquidityKnown: true, sizeKnown: true, sectors: {}, rule: 'גיבוי: US, שווי שוק ≥ $20B, מחזור ≥ 500k, 120 הגדולות (רשימת ה-S&P 500 לא זמינה)' };
    source = 'screener-top';
  } else return { ok: false, reason: 'אין מקור לחברי המדד וגם לא screener', notes };
  const items = sel.items.filter((x) => /^[A-Z][A-Z0-9.\-]{0,6}$/.test(x.symbol));
  if (!items.length) return { ok: false, reason: 'לא נבחרו חברות', notes };
  // הרכב היסטורי (לבדיקות עבר) — נבדק פעם בשבוע בלבד (תקציב FMP); התוצאה נשמרת
  const prevMeta = (await db.get('meta:mechanical')) || {};
  let probe = prevMeta.historicalConstituents || null;
  if (env.FMP_KEY && (!probe || new Date().getUTCDay() === 1)) try { const h = await fmp.sp500Historical(ctx); probe = { ok: true, count: h.count, first: h.first, last: h.last, checkedAt: today() }; } catch (e) { probe = { ok: false, error: e.message.slice(0, 160), checkedAt: today() }; }
  // הוספה ליקום בקצב מוגבל (מכסת KV: כל נייר חדש = ~8 כתיבות מטמון בלילה הראשון); השאר ממתין לריצות הבאות (יומי)
  const keep = new Set([...((await db.get('user:watchlist')) || []).map((w) => w.symbol), ...((await db.get('paper:trades')) || []).filter((t) => !t.exitDate).map((t) => t.symbol)]);
  let extra = (await db.get('meta:universe')) || [];
  const chosen = new Set(items.map((x) => x.symbol));
  const kept = extra.filter((a) => a.origin !== 'mechanical' || (!reset && chosen.has(a.symbol)) || keep.has(a.symbol));
  const removed = extra.length - kept.length;
  if (removed) await db.put('meta:universe', kept);
  const have = new Set([...SEED_UNIVERSE.map((a) => a.symbol), ...kept.map((a) => a.symbol)]);
  const perRun = maxAdd ?? (+env.UNIVERSE_ADD_PER_RUN || MECHANICAL_RULE.maxAddPerRun);
  const missing = items.filter((x) => !have.has(x.symbol));
  const batch = missing.slice(0, perRun);
  const added = await addToUniverse(db, batch.map((x) => ({ symbol: x.symbol, name: x.name, type: 'stock', assetClass: 'equity', role: 'satellite', sector: x.sector, country: 'US', currency: 'USD', origin: 'mechanical', stooq: x.symbol.toLowerCase().replace('.', '-') + '.us' })));
  const pending = missing.slice(perRun).map((x) => x.symbol);
  const meta = { asOf: today(), source, rule: sel.rule, members: sel.members, liquid: sel.liquid, liquidityKnown: sel.liquidityKnown, sizeKnown: sel.sizeKnown, sectors: sel.sectors, symbols: items.map((x) => x.symbol), inUniverse: items.length - pending.length, pending, historicalConstituents: probe, notes };
  await db.put('meta:mechanical', meta);
  return { ok: true, source, selected: items.length, added, removed, pending: pending.length, sizeKnown: sel.sizeKnown, liquidityKnown: sel.liquidityKnown, members: sel.members, historicalConstituents: probe, notes };
}
export const getMacroSeries = (id, ctx) => cached(ctx.db, `macro:${id}`, TTL.macro, async (ex) => fetchWithFallback('macro', id, { from: ex?.rows?.length ? ex.rows[ex.rows.length - 1][0].slice(0, 4) + '-01-01' : '2000-01-01' }, ctx), { merge: (o, f) => ({ ...f, rows: DB.mergeRows(o.rows, f.rows) }) });
export const getFx = (ctx) => cached(ctx.db, 'fx:USDILS', TTL.fx, async () => {
  // מקור: בנק ישראל (שער יציג). אין גיבוי ב-FRED — הסדרה DEXISUS לא קיימת (H.10 לא כולל שקל) והחזירה 400 בכל קריאה;
  // כשבנק ישראל לא זמין, cached() משאיר את הערך האחרון שנשמר
  const b = await fetchWithFallback('fx', 'USDILS', {}, ctx);
  if (!b.missing) return b;
  return { missing: true, reason: 'אין שער USD/ILS (בנק ישראל לא זמין)' };
}, { merge: (o, f) => ({ ...f, rows: DB.mergeRows(o.rows || [], f.rows || []) }) });

export async function getAnalyst(symbol, ctx){
  return cached(ctx.db, `analyst:${symbol}`, TTL.analyst, async () => {
    const [rec, tg] = await Promise.all([fetchWithFallback('analyst', symbol, {}, ctx), fetchWithFallback('targets', symbol, {}, ctx)]);
    const av = await ctx.db.get(`analyst:av:${symbol}`);
    const base = !rec.missing ? rec : av && !av.missing ? av : null;
    if (!base) return { missing: true, reason: rec.reason };
    const targets = !tg.missing ? tg : base.targets || null;
    const out = { ...base, targets, sources: [base.source, tg.source].filter(Boolean) };
    // היסטוריה חודשית — לא נדרסת
    await ctx.db.putIfAbsent(`hist:analyst:${symbol}:${today().slice(0, 7)}`, { ...out, savedAt: today() });
    return out;
  });
}
export async function getNews(symbol, ctx){
  return cached(ctx.db, `news:${symbol}`, TTL.news, async (ex) => {
    const [a, b, c] = await Promise.all([fetchWithFallback('news', symbol, {}, ctx, { only: ['finnhub'] }), fetchWithFallback('news', symbol, {}, ctx, { only: ['alphavantage'] }), fetchWithFallback('filings', symbol, {}, ctx)]);
    const items = [...(a.items || []), ...(b.items || []), ...(c.items || [])];
    if (!items.length && !ex) return { missing: true, reason: [a.reason, b.reason, c.reason].filter(Boolean).join(' | ') };
    const prev = ex?.raw || [];
    const cutoff = isoDate(new Date(Date.now() - 90 * 86400000));
    const merged = new Map(prev.filter((x) => (x.publishedAt || '') >= cutoff).map((x) => [x.id, x]));
    for (const it of items) if (it.id) merged.set(it.id, it);
    const raw = [...merged.values()].sort((x, y) => (y.publishedAt || '').localeCompare(x.publishedAt || '')).slice(0, 200);
    const clusters = clusterNews(raw).slice(0, 60);
    return { raw, clusters, sources: [a.source, b.source, c.source].filter(Boolean), asOf: new Date().toISOString(), quality: Math.max(a.quality || 0, b.quality || 0, c.quality || 0) };
  });
}

// ---------- מאקרו ומשטר ----------
export async function loadMacro(ctx){
  const out = {};
  for (const s of MACRO_SERIES){ const r = await getMacroSeries(s.id, ctx); if (r && !r.missing) out[s.id] = r; }
  const fx = await getFx(ctx);
  if (fx && !fx.missing) out.USDILS = fx;
  return out;
}
export async function loadIndices(ctx){
  const out = {};
  for (const ix of INDICES){
    if (ix.eodhd && !ctx.env.EODHD_KEY) continue;
    let r = await getPrices(ix.symbol, { ...ctx, asset: ix });
    if ((!r || r.missing) && ix.proxy){ const p = await ctx.db.get(`px:${ix.proxy}`); if (p?.rows?.length) r = { ...p, proxyOf: ix.symbol, note: `מדד לא זמין אצל הספק — משתמש ב-ETF ${ix.proxy} כמייצג` }; }
    if (r && !r.missing) out[ix.id] = r;
  }
  return out;
}
export async function computeRegime(ctx, { date = null, breadth = null } = {}){
  const [macro, indices] = await Promise.all([loadMacro(ctx), loadIndices(ctx)]);
  const m = {}; for (const [k, v] of Object.entries(macro)) m[k] = v.rows;
  const ix = {}; for (const [k, v] of Object.entries(indices)) ix[k] = v.rows;
  const r = classifyRegime({ indices: ix, macro: m, breadth, date });
  r.dataAsOf = Object.fromEntries([...Object.entries(macro), ...Object.entries(indices)].map(([k, v]) => [k, { asOf: v.asOf, source: v.source, stale: !!v.stale }]));
  r.missingInputs = [...MACRO_SERIES.filter((s) => !macro[s.id]).map((s) => s.title), ...INDICES.filter((i) => !indices[i.id]).map((i) => i.name)];
  return r;
}

// ---------- ניתוח נכס ----------
// cron=true: בלי quote (סגירה מספיקה) ובלי חדשות אלא לרשימת המעקב — חוסך כ-230 כתיבות KV ביום
export async function loadBundle(symbol, ctx, { light = false, cron = false, watched = false } = {}){
  const asset = await assetMeta(ctx.db, symbol);
  const c = { ...ctx, asset };
  const isEtf = asset.type === 'etf' || asset.type === 'index' || asset.type === 'fund';
  const prices = await getPrices(symbol, c);
  if (light) return { asset, prices };
  const skip = Promise.resolve({ missing: true, reason: 'לא נמשך בעיבוד היומי' });
  const [quote, profile, facts, ratios, est, analyst, news, insider, etf, earn] = await Promise.all([
    cron ? skip : getQuote(symbol, c), getProfile(symbol, c),
    isEtf ? Promise.resolve({ missing: true, reason: 'ETF' }) : getFacts(symbol, c),
    isEtf ? Promise.resolve({ missing: true, reason: 'ETF' }) : getRatios(symbol, c),
    isEtf ? Promise.resolve({ missing: true, reason: 'ETF' }) : getEstimates(symbol, c),
    isEtf ? Promise.resolve({ missing: true, reason: 'ETF' }) : getAnalyst(symbol, c),
    cron && !watched ? ctx.db.get(`news:${symbol}`).then((n) => n || { missing: true, reason: 'חדשות נמשכות לרשימת המעקב ובצפייה בנכס' }) : getNews(symbol, c),
    isEtf ? Promise.resolve({ missing: true, reason: 'ETF' }) : getInsider(symbol, c),
    isEtf ? getEtf(symbol, c) : Promise.resolve({ missing: true, reason: 'לא ETF' }),
    isEtf ? Promise.resolve({ missing: true, reason: 'ETF' }) : getEarnings(symbol, c),
  ]);
  return { asset: { ...asset, ...(profile && !profile.missing ? { name: profile.name || asset.name, sector: asset.sector || profile.sector, industry: profile.industry, country: asset.country || profile.country, currency: asset.currency || profile.currency, marketCap: profile.marketCap, beta: profile.beta, description: profile.description } : {}) }, prices, quote, profile, facts, ratios, est, analyst, news, insider, etf, earn };
}

export async function peersFor(ctx, asset, date){
  // עמיתים = נכסים באותו ענף ב-universe עם P/E ידוע ב-snapshot האחרון
  const ranks = await ctx.db.get(`rank:${date || (await latestRankDay(ctx.db))}`);
  if (!ranks?.table) return [];
  return ranks.table.filter((r) => r.symbol !== asset.symbol && r.sector === asset.sector && isNum(r.pe) && r.pe > 0).map((r) => ({ symbol: r.symbol, pe: r.pe }));
}
export async function latestRankDay(db){ const days = (await db.get('idx:snapdays')) || []; return days[days.length - 1] || null; }

export async function analyzeSymbol(symbol, ctx, opts = {}){
  const b = await loadBundle(symbol, ctx, { cron: !!opts.cron, watched: !!opts.watched });
  const regime = opts.regime || (await ctx.db.get(`regime:${today()}`)) || (await computeRegime(ctx));
  const bench = await getPrices(BENCHMARK_FOR(b.asset) === 'AGG' ? 'AGG' : 'SPY', { ...ctx, asset: findAsset('SPY') });
  const qqq = b.asset.sector === 'Technology' ? await ctx.db.get('px:QQQ') : null;
  const peers = opts.peers || (await peersFor(ctx, b.asset));
  const settings = (await ctx.db.get('user:settings')) || {};
  const dgs = await ctx.db.get('macro:DGS10');
  const a = analyzeBundle(b, { ...opts, regime, benchRows: bench?.rows, techRows: qqq?.rows, weights: settings.weights, peers, dgs10Rows: dgs?.rows });
  a.bundle = { newsClusters: b.news?.clusters || [], profile: b.profile, etf: b.etf, earn: b.earn };
  return a;
}

export async function buildRecommendations(ctx, rank, { sizeIls = 200000, seriesMap = null } = {}){
  const settings = (await ctx.db.get('user:settings')) || {};
  const size = settings.portfolioSize || sizeIls;
  const fx = await ctx.db.get('fx:USDILS');
  const cands = rank.table.filter((s) => s.signal !== 'NO SIGNAL').map((s) => ({ symbol: s.symbol, name: s.name, score: s.score, signal: s.signal, type: s.type, assetClass: s.assetClass || 'equity', role: s.role || (s.type === 'etf' ? 'core' : 'satellite'), sector: s.sector, country: s.country, currency: s.currency, vol: s.vol1y, maxDD: s.maxDD1y, beta: s.beta, pe: s.pe, techBeta: s.techBeta, avoid: rank.categories.avoid.includes(s.symbol), why: s.components }));
  const sm = seriesMap || {};
  if (!seriesMap){
    // עד 45 סדרות (ליבה + לוויינים בציון גבוה) — כדי לחסוך CPU/קריאות
    const pick = [...cands.filter((c) => c.role !== 'satellite'), ...cands.filter((c) => c.role === 'satellite').sort((a, b) => b.score - a.score).slice(0, 25)];
    for (const c of pick){ const px = await ctx.db.get(`px:${c.symbol}`); if (px?.rows) sm[c.symbol] = px.rows.slice(-300); }
  }
  const spy = await ctx.db.get('px:SPY');
  const r = buildPortfolios({ candidates: cands.filter((c) => sm[c.symbol]), seriesMap: sm, sizeIls: size, usdils: fx?.rate || null, benchRows: spy?.rows?.slice(-300) });
  r.date = rank.date; r.fxAsOf = fx?.asOf || null; r.fxSource = fx?.source || null;
  return r;
}
