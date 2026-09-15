// אורקסטרציה: איסוף נתונים לנכס → engine → snapshot. רץ ב-Worker (cron / on-demand).
// כל בלוק נתונים נושא source/asOf/quality; חסר = missing. אין השלמות שקטות.
import { cached, TTL } from './cache.js';
import { DB } from './db.js';
import { fetchWithFallback } from '../providers/registry.js';
import { edgar } from '../providers/edgar.js';
import { alphavantage } from '../providers/alphavantage.js';
import { SEED_UNIVERSE, INDICES, MACRO_SERIES, findAsset, BENCHMARK_FOR } from '../engine/universe.js';
import { technicalSnapshot } from '../engine/indicators.js';
import { asOf as factsAsOf, computeMetrics, peHistory } from '../engine/fundamentals.js';
import { fairValue } from '../engine/valuation.js';
import { computeScore, DEFAULT_WEIGHTS } from '../engine/scoring.js';
import { deriveSignal } from '../engine/signals.js';
import { classifyRegime } from '../engine/regime.js';
import { clusterNews, sentimentScore } from '../engine/news.js';
import { assetRisk } from '../engine/risk.js';
import { buildPortfolios } from '../engine/portfolio.js';
import { rowsUntil, isoDate, daysBetween, isNum, round } from '../engine/util.js';

export const SYM_RE = /^[A-Z0-9.^\-]{1,12}$/;
export const today = () => isoDate();
const ANALYSIS_BARS = 1500; // ~6 שנים — מספיק ל-SMA200, מומנטום, P/E היסטורי 5 שנים; חוסך CPU

// ---------- universe ----------
export async function getUniverse(db){
  const extra = (await db.get('meta:universe')) || [];
  const map = new Map(SEED_UNIVERSE.map((a) => [a.symbol, { ...a, origin: 'seed' }]));
  for (const a of extra) if (a?.symbol && !map.has(a.symbol)) map.set(a.symbol, a);
  return [...map.values()];
}
export async function addToUniverse(db, entries){
  const extra = (await db.get('meta:universe')) || [];
  const have = new Set([...SEED_UNIVERSE.map((a) => a.symbol), ...extra.map((a) => a.symbol)]);
  let added = 0;
  for (const e of entries){ if (!e?.symbol || have.has(e.symbol)) continue; extra.push({ ...e, addedAt: today() }); have.add(e.symbol); added++; }
  if (added) await db.put('meta:universe', extra.slice(-400));
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
export async function getPrices(symbol, ctx){
  const key = `px:${symbol}`;
  return cached(ctx.db, key, TTL.prices, async (ex) => {
    const from = ex?.rows?.length ? ex.rows[ex.rows.length - 1][0].slice(0, 4) + '-01-01' : undefined; // רענון: מהשנה האחרונה
    const r = await fetchWithFallback('prices', symbol, { from }, ctx);
    return r;
  }, { merge: (old, fresh) => ({ ...fresh, rows: DB.mergeRows(old.rows, fresh.rows) }) });
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
export const getEstimates = (symbol, ctx) => cached(ctx.db, `est:${symbol}`, TTL.est, () => fetchWithFallback('estimates', symbol, {}, ctx));
export const getEtf = (symbol, ctx) => cached(ctx.db, `etf:${symbol}`, TTL.etf, () => fetchWithFallback('etf', symbol, {}, ctx));
export const getInsider = (symbol, ctx) => cached(ctx.db, `insider:${symbol}`, TTL.insider, () => fetchWithFallback('insider', symbol, {}, ctx));
export const getEarnings = (symbol, ctx) => cached(ctx.db, `earn:${symbol}`, TTL.earn, () => fetchWithFallback('earnings', symbol, {}, ctx));
export const getMacroSeries = (id, ctx) => cached(ctx.db, `macro:${id}`, TTL.macro, async (ex) => fetchWithFallback('macro', id, { from: ex?.rows?.length ? ex.rows[ex.rows.length - 1][0].slice(0, 4) + '-01-01' : '2000-01-01' }, ctx), { merge: (o, f) => ({ ...f, rows: DB.mergeRows(o.rows, f.rows) }) });
export const getFx = (ctx) => cached(ctx.db, 'fx:USDILS', TTL.fx, async () => {
  const b = await fetchWithFallback('fx', 'USDILS', {}, ctx);
  if (!b.missing) return b;
  const f = await getMacroSeries('DEXISUS', ctx);
  if (f?.rows?.length) return { pair: 'USDILS', rate: f.rows[f.rows.length - 1][1], asOf: f.asOf, rows: f.rows, source: 'FRED', quality: 1 };
  return { missing: true, reason: 'אין שער USD/ILS' };
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
    const r = await getPrices(ix.symbol, { ...ctx, asset: ix });
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
export async function loadBundle(symbol, ctx, { light = false } = {}){
  const asset = await assetMeta(ctx.db, symbol);
  const c = { ...ctx, asset };
  const isEtf = asset.type === 'etf' || asset.type === 'index' || asset.type === 'fund';
  const prices = await getPrices(symbol, c);
  if (light) return { asset, prices };
  const [quote, profile, facts, ratios, est, analyst, news, insider, etf, earn] = await Promise.all([
    getQuote(symbol, c), getProfile(symbol, c),
    isEtf ? Promise.resolve({ missing: true, reason: 'ETF' }) : getFacts(symbol, c),
    isEtf ? Promise.resolve({ missing: true, reason: 'ETF' }) : getRatios(symbol, c),
    isEtf ? Promise.resolve({ missing: true, reason: 'ETF' }) : getEstimates(symbol, c),
    isEtf ? Promise.resolve({ missing: true, reason: 'ETF' }) : getAnalyst(symbol, c),
    getNews(symbol, c),
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

export async function analyzeBundle(b, ctx, { asOfDate = null, regime = null, benchRows = null, techRows = null, weights = null, peers = [] } = {}){
  const asset = b.asset;
  const isEtf = asset.type === 'etf' || asset.type === 'index' || asset.type === 'fund';
  if (!b.prices || b.prices.missing) return { symbol: asset.symbol, missing: true, reason: 'אין מחירים: ' + (b.prices?.reason || ''), asset };
  const allRows = asOfDate ? rowsUntil(b.prices.rows, asOfDate) : b.prices.rows;
  const rows = allRows.slice(-ANALYSIS_BARS);
  if (rows.length < 30) return { symbol: asset.symbol, missing: true, reason: 'פחות מ-30 ימי מסחר עד התאריך', asset };
  const date = asOfDate || rows[rows.length - 1][0];
  const technical = technicalSnapshot(rows);
  // מחיר: quote חי (רק במצב חי) אחרת סגירה אחרונה
  const liveQuote = !asOfDate && b.quote && !b.quote.missing && !b.quote.stale ? b.quote : null;
  const price = liveQuote ? liveQuote.price : technical.price;
  const priceSource = liveQuote ? { source: liveQuote.source, asOf: liveQuote.asOf, kind: 'quote' } : { source: b.prices.source, asOf: rows[rows.length - 1][0], kind: 'close' };
  const facts = b.facts && !b.facts.missing ? factsAsOf(b.facts, asOfDate) : null;
  const metrics = !isEtf && facts ? computeMetrics(facts, { price, sharesOut: asOfDate ? null : b.profile?.sharesOut, ratios: asOfDate ? null : (b.ratios && !b.ratios.missing ? b.ratios : null), marketCap: asOfDate ? null : b.profile?.marketCap }) : (b.ratios && !b.ratios.missing && !asOfDate ? { ...b.ratios, derived: false, fields: {}, missing: false } : null);
  if (metrics && !metrics.missing && !metrics.source) metrics.source = b.ratios?.source;
  const macroDgs = await ctx.db.get('macro:DGS10');
  const dgs10 = macroDgs?.rows ? (asOfDate ? rowsUntil(macroDgs.rows, asOfDate) : macroDgs.rows).slice(-1)[0]?.[1] : null;
  const fair = !isEtf && metrics && !metrics.missing ? fairValue({ metrics, rows, facts, peers, macro: { dgs10 }, price }) : { missing: true, reason: isEtf ? 'ETF — אין הערכת שווי חברה' : 'אין פונדמנטלס' };
  const peHist = facts ? peHistory(facts, rows.slice(-252 * 5)).map((x) => x[1]).filter((v) => v > 0 && v < 200) : null;
  const clusters = b.news && !b.news.missing ? (b.news.clusters || []).filter((n) => !asOfDate || (n.publishedAt || '').slice(0, 10) <= asOfDate) : [];
  const sentiment = sentimentScore(clusters, asOfDate || today());
  const analyst = !asOfDate && b.analyst && !b.analyst.missing ? { ...b.analyst, price } : (asOfDate ? { missing: true, reason: 'אין היסטוריית קונצנזוס נקודתית (As-Of)' } : b.analyst);
  const estimates = !asOfDate && b.est && !b.est.missing ? b.est : null;
  const earningsInDays = !asOfDate && b.earn?.next ? daysBetween(date, b.earn.next) : null;
  const risk = assetRisk({ rows: allRows.slice(-800), benchRows, techRows, earningsDate: asOfDate ? null : b.earn?.next, asOfDate: date, currency: asset.currency || 'USD', baseCurrency: 'ILS' });
  const quality = { fundamental: b.facts?.quality ?? 0, valuation: b.facts?.quality ?? 0, growth: b.facts?.quality ?? 0, quality: b.facts?.quality ?? 0, technical: b.prices.quality ?? 0.6, momentum: b.prices.quality ?? 0.6, analyst: b.analyst?.quality ?? 0, sentiment: b.news?.quality ?? 0, macro: regime ? 0.9 : 0, risk: b.prices.quality ?? 0.6 };
  if (b.prices.stale) { quality.technical *= 0.5; quality.momentum *= 0.5; quality.risk *= 0.5; }
  const w = weights || DEFAULT_WEIGHTS;
  const profile = { type: asset.type, sector: asset.sector, name: asset.name, symbol: asset.symbol, currency: asset.currency, assetClass: asset.assetClass, beta: risk?.beta ?? asset.beta, expense: b.etf?.expense, aum: b.etf?.aum };
  const score = computeScore({ metrics, technical, fair, peHist, peers, estimates, analyst, sentiment, regime, profile, quality, riskExtras: { earningsInDays, currency: asset.currency || 'USD', baseCurrency: 'ILS', avgDollarVolume: risk?.avgDollarVolume20, beta: risk?.beta, gapRate: risk?.gapRate } }, w);
  const signal = deriveSignal({ score, technical, fair, regime, profile, price, earningsInDays });
  return {
    symbol: asset.symbol, date: asOfDate || today(), barDate: date, asOfDate, asset: { ...asset, beta: risk?.beta ?? asset.beta }, price, priceSource,
    dailyChange: liveQuote ? liveQuote.changePct : technical.dailyChange,
    technical, metrics, fair, score, signal, risk, sentiment: sentiment.missing ? sentiment : { ...sentiment, clusters: clusters.slice(0, 15) },
    analyst, estimates, earnings: asOfDate ? null : b.earn, insider: asOfDate ? null : (b.insider?.items || []).slice(0, 15), etf: b.etf && !b.etf.missing ? b.etf : null,
    dataAsOf: { prices: { asOf: b.prices.asOf, source: b.prices.source, stale: !!b.prices.stale, quality: b.prices.quality }, facts: b.facts && !b.facts.missing ? { asOf: b.facts.asOf, source: b.facts.source, stale: !!b.facts.stale, quality: b.facts.quality } : { missing: true, reason: b.facts?.reason }, news: b.news && !b.news.missing ? { asOf: b.news.asOf, sources: b.news.sources } : { missing: true, reason: b.news?.reason }, analyst: b.analyst && !b.analyst.missing ? { asOf: b.analyst.asOf, source: b.analyst.source } : { missing: true, reason: b.analyst?.reason }, ratios: b.ratios && !b.ratios.missing ? { asOf: b.ratios.asOf, source: b.ratios.source } : null, quote: liveQuote ? { asOf: liveQuote.asOf, source: liveQuote.source } : null },
    kinds: { price: 'FACT', metrics: 'FACT (דוחות) / derived', fair: 'MODEL', score: 'MODEL', signal: 'MODEL SIGNAL', analyst: 'ANALYST OPINION', estimates: 'ESTIMATE', sentiment: 'MODEL (lexicon/provider)' },
    weightsVersion: score.weightsVersion,
  };
}

export async function analyzeSymbol(symbol, ctx, opts = {}){
  const b = await loadBundle(symbol, ctx);
  const regime = opts.regime || (await ctx.db.get(`regime:${today()}`)) || (await computeRegime(ctx));
  const bench = await getPrices(BENCHMARK_FOR(b.asset) === 'AGG' ? 'AGG' : 'SPY', { ...ctx, asset: findAsset('SPY') });
  const qqq = b.asset.sector === 'Technology' ? await ctx.db.get('px:QQQ') : null;
  const peers = opts.peers || (await peersFor(ctx, b.asset));
  const settings = (await ctx.db.get('user:settings')) || {};
  const a = await analyzeBundle(b, ctx, { ...opts, regime, benchRows: bench?.rows, techRows: qqq?.rows, weights: settings.weights, peers });
  a.bundle = { newsClusters: b.news?.clusters || [], profile: b.profile, etf: b.etf, earn: b.earn };
  return a;
}

// snapshot קומפקטי (ל-DB ולטבלאות)
export function toSnapshot(a){
  if (a.missing) return { symbol: a.symbol, date: today(), missing: true, reason: a.reason };
  const c = a.score.components;
  const cv = (k) => (c[k] && !c[k].missing ? c[k].value : null);
  return {
    symbol: a.symbol, date: a.date, barDate: a.barDate, name: a.asset.name, type: a.asset.type, sector: a.asset.sector, country: a.asset.country, currency: a.asset.currency, assetClass: a.asset.assetClass, role: a.asset.role,
    price: a.price, dailyChange: a.dailyChange, score: a.score.total, coverage: a.score.coverage, confidence: a.score.confidence, confidenceLabel: a.score.confidenceLabel,
    components: Object.fromEntries(Object.keys(c).map((k) => [k, cv(k)])), componentReasons: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.missing ? { missing: v.reason } : { reasons: v.reasons, subs: v.subs?.map((s) => ({ label: s.label, value: s.value })) }])),
    signal: a.signal.label, signalDetail: { levels: a.signal.levels, horizon: a.signal.horizon, why: a.signal.why, top5: a.signal.top5, risks: a.signal.risks, changeIf: a.signal.changeIf, contradict: a.signal.contradict, entryNote: a.signal.entryNote, noSignalReason: a.signal.noSignalReason },
    trend: a.technical.trend, rsi: round(a.technical.rsi, 1), events: a.technical.events.map((e) => e.id), momentum12m: round(a.technical.momentum.r12m, 4), distFromHigh52: round(a.technical.distFromHigh52, 4),
    pe: isNum(a.metrics?.pe) ? round(a.metrics.pe, 1) : null, fairLow: a.fair?.low ?? null, fairHigh: a.fair?.high ?? null, mos: a.fair?.marginOfSafety ?? null,
    analystUpside: a.analyst && !a.analyst.missing && a.analyst.targets?.median && a.price ? round(a.analyst.targets.median / a.price - 1, 4) : (a.analyst?.targets?.avg && a.price ? round(a.analyst.targets.avg / a.price - 1, 4) : null),
    analystN: a.analyst?.total ?? null, vol1y: a.risk?.vol1y ?? null, maxDD1y: a.risk?.maxDrawdown1y ?? null, beta: a.risk?.beta ?? null, riskLevel: a.risk?.volLevel, techBeta: a.risk?.techBeta ?? null,
    lastNews: a.sentiment?.clusters?.[0] ? { title: a.sentiment.clusters[0].title, url: a.sentiment.clusters[0].url, publishedAt: a.sentiment.clusters[0].publishedAt, publisher: a.sentiment.clusters[0].publisher } : null,
    nextEarnings: a.earnings?.next || null, dataAsOf: a.dataAsOf, weightsVersion: a.weightsVersion, missingComponents: a.score.missing, peNegative: a.metrics?.peNegative || false,
  };
}

// ---------- דירוג ותיקים ----------
export function rankSnapshots(snaps){
  const ok = snaps.filter((s) => !s.missing && s.score !== null);
  const by = (f) => ok.slice().sort((a, b) => f(b) - f(a));
  const comp = (k) => (s) => s.components?.[k] ?? -1;
  const sig = (s) => ['STRONG BUY', 'BUY'].includes(s.signal);
  const top = (arr, n = 8) => arr.slice(0, n).map((s) => s.symbol);
  return {
    date: ok[0]?.date || today(), universeSize: snaps.length, analyzed: ok.length,
    categories: {
      bestOverall: top(by((s) => s.score).filter((s) => s.signal !== 'NO SIGNAL')),
      bestValue: top(by((s) => comp('valuation')(s) + (s.mos || 0) * 50).filter((s) => s.type === 'stock' && comp('valuation')(s) >= 60)),
      bestGrowth: top(by((s) => comp('growth')(s)).filter((s) => s.type === 'stock' && comp('growth')(s) >= 60)),
      bestMomentum: top(by((s) => comp('momentum')(s)).filter((s) => comp('momentum')(s) >= 65)),
      bestEtf: top(by((s) => s.score).filter((s) => s.type === 'etf')),
      lowestRisk: top(by((s) => comp('risk')(s)).filter((s) => s.score >= 55)),
      breakout: top(ok.filter((s) => s.events?.includes('breakout') || s.events?.includes('golden_cross')).sort((a, b) => b.score - a.score)),
      oversold: top(ok.filter((s) => s.events?.includes('oversold') && (s.components?.fundamental ?? 0) >= 55).sort((a, b) => b.score - a.score)),
      buySignals: ok.filter(sig).sort((a, b) => b.score - a.score).map((s) => s.symbol),
      sellSignals: ok.filter((s) => ['SELL', 'REDUCE'].includes(s.signal)).sort((a, b) => a.score - b.score).map((s) => s.symbol),
      avoid: top(ok.filter((s) => s.signal === 'SELL' || (s.components?.risk ?? 100) < 25 || s.score < 35).sort((a, b) => a.score - b.score), 10),
    },
    breadth: ok.length ? round(ok.filter((s) => ['עולה', 'עולה-חלש'].includes(s.trend)).length / ok.length, 3) : null,
    table: ok.map((s) => ({ symbol: s.symbol, name: s.name, type: s.type, sector: s.sector, country: s.country, currency: s.currency, assetClass: s.assetClass, role: s.role, price: s.price, dailyChange: s.dailyChange, score: s.score, signal: s.signal, confidence: s.confidence, trend: s.trend, rsi: s.rsi, analystUpside: s.analystUpside, mos: s.mos, pe: s.pe, vol1y: s.vol1y, maxDD1y: s.maxDD1y, beta: s.beta, riskLevel: s.riskLevel, techBeta: s.techBeta, components: s.components, nextEarnings: s.nextEarnings, momentum12m: s.momentum12m, events: s.events, lastNews: s.lastNews, dataAsOf: s.dataAsOf?.prices })),
  };
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
