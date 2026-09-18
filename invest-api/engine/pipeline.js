// צינור הניתוח — פונקציה טהורה: bundle (נתונים) + הקשר → ניתוח מלא + snapshot. ללא רשת/KV.
// רץ זהה ב-Worker (cron / on-demand) ובדפדפן (מצב חישוב מקומי, As-Of, backtest).
import { technicalSnapshot } from './indicators.js';
import { asOf as factsAsOf, computeMetrics, peHistory } from './fundamentals.js';
import { fairValue } from './valuation.js';
import { computeScore, DEFAULT_WEIGHTS } from './scoring.js';
import { deriveSignal } from './signals.js';
import { sentimentScore } from './news.js';
import { assetRisk } from './risk.js';
import { rowsUntil, isoDate, daysBetween, isNum, round } from './util.js';

export const ANALYSIS_BARS = 1500; // ~6 שנים — מספיק ל-SMA200, מומנטום, P/E היסטורי 5 שנים; חוסך CPU
const today = () => isoDate();

export function analyzeBundle(b, { asOfDate = null, regime = null, benchRows = null, techRows = null, weights = null, peers = [], dgs10Rows = null } = {}){
  const asset = b.asset;
  const isEtf = asset.type === 'etf' || asset.type === 'index' || asset.type === 'fund';
  if (!b.prices || b.prices.missing) return { symbol: asset.symbol, missing: true, reason: 'אין מחירים: ' + (b.prices?.reason || ''), asset };
  const allRows = asOfDate ? rowsUntil(b.prices.rows, asOfDate) : b.prices.rows;
  const rows = allRows.slice(-ANALYSIS_BARS);
  if (rows.length < 30) return { symbol: asset.symbol, missing: true, reason: 'פחות מ-30 ימי מסחר עד התאריך', asset };
  const date = asOfDate || rows[rows.length - 1][0];
  const technical = technicalSnapshot(rows);
  // מחיר: quote חי (רק במצב חי) אחרת סגירה אחרונה
  // quote חי רק אם עקבי עם הסגירה האחרונה (סטייה >25% = ספליט/נתון שגוי → לא משתמשים בו בשקט, מסמנים)
  let liveQuote = !asOfDate && b.quote && !b.quote.missing && !b.quote.stale ? b.quote : null;
  let quoteNote = null;
  if (liveQuote && isNum(technical.price) && technical.price > 0 && Math.abs(liveQuote.price / technical.price - 1) > 0.25){ quoteNote = `quote ${liveQuote.price} (${liveQuote.source}) סוטה >25% מהסגירה ${technical.price} — לא בשימוש`; liveQuote = null; }
  const price = liveQuote ? liveQuote.price : technical.price;
  const lastOpen = rows[rows.length - 1][1]; // פתיחת הבר האחרון — משמש כמחיר כניסה היפותטי ("פתיחה של מחר" מנקודת המבט של הסיגנל של אתמול)
  const priceSource = liveQuote ? { source: liveQuote.source, asOf: liveQuote.asOf, kind: 'quote' } : { source: b.prices.source, asOf: rows[rows.length - 1][0], kind: 'close', note: quoteNote };
  const facts = b.facts && !b.facts.missing ? factsAsOf(b.facts, asOfDate) : null;
  const metrics = !isEtf && facts ? computeMetrics(facts, { price, sharesOut: asOfDate ? null : b.profile?.sharesOut, ratios: asOfDate ? null : (b.ratios && !b.ratios.missing ? b.ratios : null), marketCap: asOfDate ? null : b.profile?.marketCap }) : (b.ratios && !b.ratios.missing && !asOfDate ? { ...b.ratios, derived: false, fields: {}, missing: false } : null);
  if (metrics && !metrics.missing && !metrics.source) metrics.source = b.ratios?.source;
  const dgs10 = dgs10Rows?.length ? (asOfDate ? rowsUntil(dgs10Rows, asOfDate) : dgs10Rows).slice(-1)[0]?.[1] : null;
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
    symbol: asset.symbol, date: asOfDate || today(), barDate: date, asOfDate, asset: { ...asset, beta: risk?.beta ?? asset.beta }, price, open: isNum(lastOpen) ? lastOpen : null, priceSource,
    dailyChange: liveQuote ? liveQuote.changePct : technical.dailyChange,
    technical, metrics, fair, score, signal, risk, sentiment: sentiment.missing ? sentiment : { ...sentiment, clusters: clusters.slice(0, 15) },
    analyst, estimates, earnings: asOfDate ? null : b.earn, insider: asOfDate ? null : (b.insider?.items || []).slice(0, 15), etf: b.etf && !b.etf.missing ? b.etf : null,
    dataAsOf: { prices: { asOf: b.prices.asOf, source: b.prices.source, stale: !!b.prices.stale, quality: b.prices.quality }, facts: b.facts && !b.facts.missing ? { asOf: b.facts.asOf, source: b.facts.source, stale: !!b.facts.stale, quality: b.facts.quality } : { missing: true, reason: b.facts?.reason }, news: b.news && !b.news.missing ? { asOf: b.news.asOf, sources: b.news.sources } : { missing: true, reason: b.news?.reason }, analyst: b.analyst && !b.analyst.missing ? { asOf: b.analyst.asOf, source: b.analyst.source } : { missing: true, reason: b.analyst?.reason }, ratios: b.ratios && !b.ratios.missing ? { asOf: b.ratios.asOf, source: b.ratios.source } : null, quote: liveQuote ? { asOf: liveQuote.asOf, source: liveQuote.source } : null },
    kinds: { price: 'FACT', metrics: 'FACT (דוחות) / derived', fair: 'MODEL', score: 'MODEL', signal: 'MODEL SIGNAL', analyst: 'ANALYST OPINION', estimates: 'ESTIMATE', sentiment: 'MODEL (lexicon/provider)' },
    weightsVersion: score.weightsVersion,
  };
}


// snapshot קומפקטי (ל-DB ולטבלאות)
export function toSnapshot(a){
  if (a.missing) return { symbol: a.symbol, date: today(), missing: true, reason: a.reason };
  const c = a.score.components;
  const cv = (k) => (c[k] && !c[k].missing ? c[k].value : null);
  return {
    symbol: a.symbol, date: a.date, barDate: a.barDate, name: a.asset.name, nameHe: a.asset.nameHe || null, type: a.asset.type, sector: a.asset.sector, country: a.asset.country, currency: a.asset.currency, assetClass: a.asset.assetClass, role: a.asset.role,
    price: a.price, open: a.open ?? null, dailyChange: a.dailyChange, score: a.score.total, coverage: a.score.coverage, confidence: a.score.confidence, confidenceLabel: a.score.confidenceLabel,
    components: Object.fromEntries(Object.keys(c).map((k) => [k, cv(k)])), componentReasons: Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.missing ? { missing: v.reason } : { reasons: v.reasons, subs: v.subs?.map((s) => ({ label: s.label, value: s.value })) }])),
    signal: a.signal.label, signalDetail: { levels: a.signal.levels, horizon: a.signal.horizon, why: a.signal.why, top5: a.signal.top5, risks: a.signal.risks, changeIf: a.signal.changeIf, contradict: a.signal.contradict, entryNote: a.signal.entryNote, noSignalReason: a.signal.noSignalReason },
    trend: a.technical.trend, rsi: round(a.technical.rsi, 1), events: a.technical.events.map((e) => e.id), momentum12m: round(a.technical.momentum.r12m, 4), distFromHigh52: round(a.technical.distFromHigh52, 4),
    pe: isNum(a.metrics?.pe) ? round(a.metrics.pe, 1) : null, fairLow: a.fair?.low ?? null, fairHigh: a.fair?.high ?? null, mos: a.fair?.marginOfSafety ?? null,
    analystUpside: a.analyst && !a.analyst.missing && a.analyst.targets?.median && a.price ? round(a.analyst.targets.median / a.price - 1, 4) : (a.analyst?.targets?.avg && a.price ? round(a.analyst.targets.avg / a.price - 1, 4) : null),
    analystN: a.analyst?.total ?? null, vol1y: a.risk?.vol1y ?? null, maxDD1y: a.risk?.maxDrawdown1y ?? null, beta: a.risk?.beta ?? null, riskLevel: a.risk?.volLevel, techBeta: a.risk?.techBeta ?? null,
    lastNews: a.sentiment?.clusters?.[0] ? { title: a.sentiment.clusters[0].title, url: a.sentiment.clusters[0].url, publishedAt: a.sentiment.clusters[0].publishedAt, publisher: a.sentiment.clusters[0].publisher } : null,
    nextEarnings: a.earnings?.next || null, relVol: round(a.technical.relVol, 2), analystTrendDelta: a.analyst?.trendDelta ?? null,
    materialNews: (a.sentiment?.clusters || []).filter((c) => c.material).slice(0, 3).map((c) => ({ title: c.title, url: c.url, publisher: c.publisher, publishedAt: c.publishedAt, events: c.events, sentiment: c.sentiment?.label })),
    dataAsOf: a.dataAsOf, weightsVersion: a.weightsVersion, missingComponents: a.score.missing, peNegative: a.metrics?.peNegative || false,
  };
}

// ---------- דירוג ותיקים ----------
// sp500: קבוצת חברי המדד (Set) — כל שורה מתויגת universe: 'sp500' | 'extended', כדי שדירוג יחסי ייעשה מול יקום יציב ולא מול תערובת של קרנות/ישראליות
export function rankSnapshots(snaps, { sp500 = null } = {}){
  const ok = snaps.filter((s) => !s.missing && s.score !== null);
  const uni = (s) => (sp500 ? (sp500.has(s.symbol) ? 'sp500' : 'extended') : null);
  const by = (f) => ok.slice().sort((a, b) => f(b) - f(a));
  const comp = (k) => (s) => s.components?.[k] ?? -1;
  const sig = (s) => ['STRONG BUY', 'BUY'].includes(s.signal);
  const top = (arr, n = 8) => arr.slice(0, n).map((s) => s.symbol);
  return {
    date: ok[0]?.date || today(), barDate: ok.map((s) => s.barDate).filter(Boolean).sort().slice(-1)[0] || null, universeSize: snaps.length, analyzed: ok.length,
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
    universes: sp500 ? { sp500: ok.filter((s) => uni(s) === 'sp500').length, extended: ok.filter((s) => uni(s) === 'extended').length } : null,
    table: ok.map((s) => ({ symbol: s.symbol, universe: uni(s), barDate: s.barDate || null, coverage: s.coverage ?? null, missingComponents: s.missingComponents || [], name: s.name, nameHe: s.nameHe || null, type: s.type, sector: s.sector, country: s.country, currency: s.currency, assetClass: s.assetClass, role: s.role, price: s.price, open: s.open ?? null, dailyChange: s.dailyChange, score: s.score, signal: s.signal, confidence: s.confidence, trend: s.trend, rsi: s.rsi, analystUpside: s.analystUpside, mos: s.mos, pe: s.pe, vol1y: s.vol1y, maxDD1y: s.maxDD1y, beta: s.beta, riskLevel: s.riskLevel, techBeta: s.techBeta, components: s.components, nextEarnings: s.nextEarnings, momentum12m: s.momentum12m, events: s.events, lastNews: s.lastNews, dataAsOf: s.dataAsOf?.prices })),
  };
}

