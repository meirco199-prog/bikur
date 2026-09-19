// מודל צל (Signal Model v8) — פונקציות טהורות. מחשב כל לילה ציונים חלופיים במקביל למודל הישן, בלי לשלוח פקודות.
// המטרה: למדוד לפני שמחליפים. כל נתון שאין לו מקור = null/"לא זמין", לא 0.
// המודלים:
//   A = הישן: הציון והסיגנל שמפעילים את האוטומט היום (בסיס להשוואה).
//   B = יחסי-ענף בלי כפילויות: איחוד פונדמנטלי+איכות ל"רווחיות", טכני+מומנטום ל"מגמה"; כל גורם הופך לאחוזון בתוך הענף
//       (או בכל היקום אם הענף קטן); בלי מאקרו, סנטימנט ואנליסטים.
//   C = B + ריוויזיות תחזיות (כשקיימות) + שכבת מאקרו על *הפעולה* (לא על הציון): שוק דובי → אין קניות; Risk Off → רק קנייה חזקה.
import { isNum, mean, round, correlation } from './util.js';

export const SHADOW_VERSION = 2;
export const SHADOW_RULES = Object.freeze({ strongTopPct: 0.15, buyTopPct: 0.30, sellBottomPct: 0.20, minSector: 5, minUniverse: 20, dupeThreshold: 0.6, horizons: [1, 5, 20, 60], buckets: [80, 70, 60, 50], revisionCoverageMin: 0.75 });
export const FACTOR_LABELS = { value: 'תמחור', profitability: 'רווחיות', growth: 'צמיחה', trend: 'מגמה', risk: 'סיכון', revision: 'ריוויזיות', momentum: 'מומנטום', quality: 'איכות' };
export const SHADOW_MODELS = Object.freeze({
  A: { label: 'הישן', desc: 'הציון והסיגנל שמפעילים את האוטומט היום', weights: null },
  B: { label: 'יחסי-ענף', desc: 'אחוזונים בתוך הענף, בלי כפילויות, בלי מאקרו/סנטימנט/אנליסטים', weights: Object.freeze({ value: 25, profitability: 20, growth: 20, trend: 25, risk: 10 }) },
  C: { label: 'B + ריוויזיות + מאקרו', desc: 'כמו B, עם ריוויזיות תחזיות כשקיימות (15) ושכבת מאקרו על הפעולה', weights: Object.freeze({ value: 25, profitability: 20, growth: 20, trend: 25, risk: 10, revision: 15 }) },
  // D = ציון אגרסיבי: מומנטום, צמיחה, ריוויזיות, איכות, סיכון — בלי תמחור. הבסיס למסלול האגרסיבי; מושווה ל-C (ניסוי, לא משקלים סופיים)
  D: { label: 'אגרסיבי', desc: 'מומנטום 30, צמיחה 25, ריוויזיות 20, איכות 15, סיכון 10 — בלי תמחור; שכבת מאקרו על הפעולה', weights: Object.freeze({ momentum: 30, growth: 25, revision: 20, quality: 15, risk: 10 }) },
  DF: { label: 'אגרסיבי מסונן', desc: 'D עם ספי איכות מוחלטים: מומנטום ≥ 55, צמיחה ≥ 40, איכות ≥ 40, סיכון ≥ 30, כיסוי ≥ 85%; קנייה רק מציון 60 (חזקה 70). בלי הזדמנויות — מזומן', weights: Object.freeze({ momentum: 30, growth: 25, revision: 20, quality: 15, risk: 10 }) },
});
// DF = D מסונן: אותם משקלים כמו D, אבל כשירות דורשת ספי איכות מוחלטים (לא רק דירוג יחסי): מומנטום חיובי, צמיחה ואיכות מינימליות,
// סיכון סביר, וכיסוי נתונים. פעולה: הדירוג היחסי של D על הקבוצה המסוננת, ובנוסף סף ציון מוחלט (קנייה חזקה ≥ 70, קנייה ≥ 60).
// כשאין מספיק מניות שעוברות — אין קניות (מותר להחזיק מזומן). D עצמו לא משתנה; DF נצבר בנפרד.
export const DF_RULES = Object.freeze({ minMomentum: 55, minGrowth: 40, minQuality: 40, minRisk: 30, minCoverage: 0.85, minScoreBuy: 60, minScoreStrong: 70 });
export const MODEL_KEYS = ['A', 'B', 'C', 'D', 'DF'];
export const bucketOf = (score, edges = SHADOW_RULES.buckets) => { if (!isNum(score)) return null; for (const e of edges) if (score >= e) return `${e}+`; return `<${edges[edges.length - 1]}`; };
const LEGACY_COMPONENTS = ['fundamental', 'valuation', 'growth', 'quality', 'technical', 'momentum', 'analyst', 'sentiment', 'macro', 'risk'];

// אחוזון (0–100) של x בתוך a: מתחת + חצי מהשווים
export function pctRank(a, x){ const v = a.filter(isNum); if (!v.length || !isNum(x)) return null; let below = 0, eq = 0; for (const y of v){ if (y < x) below++; else if (y === x) eq++; } return round(((below + eq / 2) / v.length) * 100, 1); }
// מתאם ספירמן (דירוגים) — IC של ציון מול תשואה עתידית
export function spearman(a, b){
  const idx = a.map((_, i) => i).filter((i) => isNum(a[i]) && isNum(b[i]));
  if (idx.length < 5) return null;
  const rank = (arr) => { const order = idx.slice().sort((i, j) => arr[i] - arr[j]); const r = {}; for (let k = 0; k < order.length;){ let m = k; while (m + 1 < order.length && arr[order[m + 1]] === arr[order[k]]) m++; const avg = (k + m) / 2 + 1; for (let t = k; t <= m; t++) r[order[t]] = avg; k = m + 1; } return idx.map((i) => r[i]); };
  return round(correlation(rank(a), rank(b)), 3);
}
const avg2 = (x, y) => (isNum(x) && isNum(y) ? (x + y) / 2 : isNum(x) ? x : isNum(y) ? y : null);
const legacyAction = (signal) => (signal === 'STRONG BUY' ? 'STRONG BUY' : signal === 'BUY' ? 'BUY' : ['SELL', 'REDUCE'].includes(signal) ? 'SELL' : 'HOLD');

// גורמים גולמיים (0–100) מרכיבי המודל הישן, אחרי איחוד כפילויות
export function rawFactors(components = {}){
  const c = components;
  return { value: isNum(c.valuation) ? c.valuation : null, profitability: avg2(c.fundamental, c.quality), growth: isNum(c.growth) ? c.growth : null, trend: avg2(c.technical, c.momentum), risk: isNum(c.risk) ? c.risk : null, momentum: isNum(c.momentum) ? c.momentum : null, quality: isNum(c.quality) ? c.quality : null };
}

// פעולה לפי דירוג יחסי בתוך הרשימה (ציון גבוה = טוב); overlay: 'bear' → אין קניות, 'riskoff' → רק קנייה חזקה
export function rankActions(scores, { overlay = null, rules = SHADOW_RULES } = {}){
  const ok = scores.map((s, i) => ({ s, i })).filter((x) => isNum(x.s)).sort((a, b) => b.s - a.s);
  const n = ok.length; const out = scores.map(() => null);
  if (n < rules.minUniverse){ for (const x of ok) out[x.i] = 'HOLD'; return out; }
  ok.forEach((x, k) => {
    const top = k / n; const bottom = (n - 1 - k) / n;
    let a = top < rules.strongTopPct ? 'STRONG BUY' : top < rules.buyTopPct ? 'BUY' : bottom < rules.sellBottomPct ? 'SELL' : 'HOLD';
    if (overlay === 'bear' && (a === 'BUY' || a === 'STRONG BUY')) a = 'HOLD';
    if (overlay === 'riskoff' && a === 'BUY') a = 'HOLD';
    out[x.i] = a;
  });
  return out;
}

// התפלגות ציונים של מודל ביום נתון: כדי לראות אם "קנייה חזקה" נהיית נפוצה מדי או שהציונים זוחלים למעלה
export function scoreDistribution(scores, actions = []){
  const v = scores.filter(isNum).sort((a, b) => a - b);
  if (!v.length) return { n: 0 };
  const q = (p) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
  const buckets = {}; for (const x of v){ const b = bucketOf(x); buckets[b] = (buckets[b] || 0) + 1; }
  const n = actions.filter(Boolean).length || v.length;
  const share = (a) => round(actions.filter((x) => x === a).length / n, 3);
  return { n: v.length, mean: round(mean(v), 1), median: round(q(0.5), 1), p10: round(q(0.1), 1), p90: round(q(0.9), 1), buckets, strongBuyShare: share('STRONG BUY'), buyShare: share('BUY'), sellShare: share('SELL') };
}
export function overlayFor(regime){ if (!regime) return null; if (regime.trend === 'Bear Trend') return 'bear'; if (regime.risk === 'Risk Off') return 'riskoff'; return null; }

// מטריצת מתאמים בין רכיבי המודל הישן (לזיהוי כפילויות) + הציון
export function componentCorrelation(rows, keys = [...LEGACY_COMPONENTS, 'score']){
  const col = (k) => rows.map((r) => (k === 'score' ? r.score : r.components?.[k]));
  const cols = Object.fromEntries(keys.map((k) => [k, col(k)]));
  const matrix = keys.map((a) => keys.map((b) => { const xa = cols[a], xb = cols[b]; const idx = xa.map((_, i) => i).filter((i) => isNum(xa[i]) && isNum(xb[i])); return idx.length >= 10 ? round(correlation(idx.map((i) => xa[i]), idx.map((i) => xb[i])), 2) : null; }));
  const dupes = [];
  keys.forEach((a, i) => keys.forEach((b, j) => { if (j > i && a !== 'score' && b !== 'score' && isNum(matrix[i][j]) && Math.abs(matrix[i][j]) >= SHADOW_RULES.dupeThreshold) dupes.push({ a, b, r: matrix[i][j] }); }));
  return { keys, matrix, n: rows.length, dupes };
}

// חישוב יומי. table: שורות הדירוג (מהמודל הישן); revisions: {symbol → {available, epsRevision, reason}}; regime: {trend, risk}
export function computeShadow({ table = [], revisions = {}, regime = null, day = null, barDate = null } = {}){
  // יקום הייחוס: חברי S&P 500 (universe='sp500') כשיש ≥100 כאלה; אחרת כל המניות. קרנות/ישראליות/אחרות לא מזיזות אחוזונים של חברות המדד
  const allStocks = table.filter((r) => r.type === 'stock' && isNum(r.score));
  const sp = allStocks.filter((r) => r.universe === 'sp500');
  const stocks = sp.length >= 100 ? sp : allStocks;
  const universe = sp.length >= 100 ? 'sp500' : 'all';
  const raw = stocks.map((r) => rawFactors(r.components));
  const bySector = new Map();
  stocks.forEach((r, i) => { const s = r.sector || 'Unknown'; if (!bySector.has(s)) bySector.set(s, []); bySector.get(s).push(i); });
  const factorKeys = ['value', 'profitability', 'growth', 'trend', 'risk', 'momentum', 'quality'];
  const pct = stocks.map((r, i) => {
    const grp = bySector.get(r.sector || 'Unknown'); const useSector = grp.length >= SHADOW_RULES.minSector; const pool = useSector ? grp : stocks.map((_, k) => k);
    const o = { _relativeTo: useSector ? 'sector' : 'universe' };
    for (const f of factorKeys) o[f] = pctRank(pool.map((k) => raw[k][f]), raw[i][f]);
    return o;
  });
  // ריוויזיות: אחוזון בכל היקום בין אלה שזמינות; חסר = null (לא 0)
  const revVals = stocks.map((r) => (revisions[r.symbol]?.available ? revisions[r.symbol].epsRevision : null));
  const revAvail = revVals.filter(isNum);
  // D מלא רק כשיש ריוויזיה תקינה ל-≥75% מהמניות הכשירות (ולפחות 10); אחרת רכיב של 20% לחלק קטן מהיקום מעוות דירוג יחסי
  const eligibleDCount = pct.filter((p) => ['momentum', 'growth'].every((k) => isNum(p[k]))).length;
  const revCoverage = eligibleDCount ? round(revAvail.length / eligibleDCount, 3) : 0;
  const revOn = revAvail.length >= 10 && revCoverage >= SHADOW_RULES.revisionCoverageMin;
  const revPct = revVals.map((v) => (isNum(v) && revOn ? pctRank(revAvail, v) : null));
  const weighted = (p, w) => { let sw = 0, s = 0; for (const [k, wk] of Object.entries(w)){ if (isNum(p[k])){ sw += wk; s += wk * p[k]; } } return sw ? round(s / sw, 1) : null; };
  const eligible = pct.map((p) => ['value', 'profitability', 'growth', 'trend'].every((k) => isNum(p[k])));
  const scoreB = pct.map((p, i) => (eligible[i] ? weighted(p, SHADOW_MODELS.B.weights) : null));
  const scoreC = pct.map((p, i) => (eligible[i] ? weighted({ ...p, revision: revPct[i] }, SHADOW_MODELS.C.weights) : null));
  const eligibleD = pct.map((p) => ['momentum', 'growth'].every((k) => isNum(p[k])));
  const scoreD = pct.map((p, i) => (eligibleD[i] ? weighted({ ...p, revision: revPct[i] }, SHADOW_MODELS.D.weights) : null));
  const overlay = overlayFor(regime);
  const actA = stocks.map((r) => legacyAction(r.signal));
  const actB = rankActions(scoreB);
  const actC = rankActions(scoreC, { overlay });
  const actD = rankActions(scoreD, { overlay });
  // DF: כשירות מוחלטת על הגורמים הגולמיים (0–100) + כיסוי נתונים; הפעולה מהדירוג היחסי בתוך המסוננים, ואז סף ציון מוחלט
  // fail-closed: כיסוי נתונים חסר/לא מספרי לא עובר את הסף — DF דורש כיסוי ידוע ומספיק, לא "אין מידע אז נניח שזה בסדר"
  const eligibleDF = pct.map((p, i) => eligibleD[i] && raw[i].momentum >= DF_RULES.minMomentum && isNum(raw[i].growth) && raw[i].growth >= DF_RULES.minGrowth && isNum(raw[i].quality) && raw[i].quality >= DF_RULES.minQuality && isNum(raw[i].risk) && raw[i].risk >= DF_RULES.minRisk && isNum(stocks[i].coverage) && stocks[i].coverage >= DF_RULES.minCoverage);
  const scoreDF = scoreD.map((v, i) => (eligibleDF[i] ? v : null));
  const actDF = rankActions(scoreDF, { overlay }).map((a, i) => (a === 'STRONG BUY' && scoreDF[i] < DF_RULES.minScoreStrong ? (scoreDF[i] >= DF_RULES.minScoreBuy ? 'BUY' : 'HOLD') : a === 'BUY' && scoreDF[i] < DF_RULES.minScoreBuy ? 'HOLD' : a));
  const contribC = (i) => { const p = { ...pct[i], revision: revPct[i] }; const w = SHADOW_MODELS.C.weights; const sw = Object.entries(w).filter(([k]) => isNum(p[k])).reduce((s, [, v]) => s + v, 0); return Object.fromEntries(Object.entries(w).filter(([k]) => isNum(p[k])).map(([k, v]) => [k, round((v / sw) * p[k], 1)])); };
  const rows = stocks.map((r, i) => ({
    symbol: r.symbol, name: r.nameHe || r.name || r.symbol, sector: r.sector || null, price: r.price, open: isNum(r.open) ? r.open : null, currency: r.currency || 'USD',
    A: r.score, actA: actA[i], B: scoreB[i], actB: actB[i], C: scoreC[i], actC: actC[i], D: scoreD[i], actD: actD[i], DF: scoreDF[i], actDF: actDF[i], eligible: eligible[i], eligibleD: eligibleD[i], eligibleDF: eligibleDF[i], coverage: isNum(r.coverage) ? r.coverage : null,
    raw: raw[i], pct: pct[i], revision: isNum(revVals[i]) ? revVals[i] : null, revisionPct: revPct[i], revisionNote: revisions[r.symbol]?.available ? null : (revisions[r.symbol]?.reason || 'לא זמין'),
    contribC: eligible[i] ? contribC(i) : null, fwd: {},
  }));
  const count = (act) => ({ 'STRONG BUY': act.filter((a) => a === 'STRONG BUY').length, BUY: act.filter((a) => a === 'BUY').length, HOLD: act.filter((a) => a === 'HOLD').length, SELL: act.filter((a) => a === 'SELL').length });
  const agree = (x, y) => { const idx = rows.map((_, i) => i).filter((i) => x[i] && y[i]); return idx.length ? round(idx.filter((i) => x[i] === y[i]).length / idx.length, 3) : null; };
  const buys = (act) => new Set(rows.filter((_, i) => act[i] === 'BUY' || act[i] === 'STRONG BUY').map((r) => r.symbol));
  const overlap = (x, y) => { const a = buys(x), b = buys(y); const u = new Set([...a, ...b]); return u.size ? round([...a].filter((s) => b.has(s)).length / u.size, 3) : null; };
  const top = (key) => rows.filter((r) => isNum(r[key])).sort((a, b) => b[key] - a[key]).slice(0, 10).map((r) => r.symbol);
  const corr = componentCorrelation(stocks);
  const dist = { A: scoreDistribution(rows.map((r) => r.A), actA), B: scoreDistribution(scoreB, actB), C: scoreDistribution(scoreC, actC), D: scoreDistribution(scoreD, actD), DF: scoreDistribution(scoreDF, actDF) };
  return {
    version: SHADOW_VERSION, day, barDate, regime: regime ? { trend: regime.trend, risk: regime.risk } : null, overlay, n: rows.length, eligible: eligible.filter(Boolean).length,
    revisionsAvailable: revAvail.length, revisionsUsed: revOn, revisionCoverage: revCoverage, rules: SHADOW_RULES,
    // D בלי ריוויזיות (עד שנצברים 30 יום) הוא בפועל מודל אחר (המשקלים מנורמלים מחדש) — נרשם כ-D-preRevision ונצבר בנפרד; לא מערבבים תקופות
    universe, models: { A: { ...SHADOW_MODELS.A, actions: count(actA) }, B: { ...SHADOW_MODELS.B, actions: count(actB) }, C: { ...SHADOW_MODELS.C, actions: count(actC) }, D: { ...SHADOW_MODELS.D, actions: count(actD), variant: revOn ? 'D' : 'D-preRevision', revisionCoverage: revCoverage, effectiveWeights: revOn ? SHADOW_MODELS.D.weights : { momentum: 37.5, growth: 31.25, quality: 18.75, risk: 12.5 } } , DF: { ...SHADOW_MODELS.DF, actions: count(actDF), variant: revOn ? 'DF' : 'DF-preRevision', eligible: eligibleDF.filter(Boolean).length, rules: DF_RULES } },
    agreement: { AB: agree(actA, actB), AC: agree(actA, actC), BC: agree(actB, actC), CD: agree(actC, actD), AD: agree(actA, actD), buyOverlapAB: overlap(actA, actB), buyOverlapAC: overlap(actA, actC), buyOverlapCD: overlap(actC, actD), DDF: agree(actD, actDF), buyOverlapDDF: overlap(actD, actDF) },
    top: { A: top('A'), B: top('B'), C: top('C'), D: top('D'), DF: top('DF') }, dist, corr, rows, fwd: {},
  };
}

// מילוי תשואה עתידית לאופק h (ימי ניתוח) על מסמך ישן, לפי מחירי היום; spyNow/spyThen לתשואה עודפת
// כניסה היפותטית — המדד המרכזי: מחיר 09:40 ניו יורק ביום המסחר הבא (entry940: symbol → מחיר, מה-scripts/entry940.mjs), כי כך המערכת
// מבצעת בפועל. סטטיסטיקה משנית: פתיחת היום הבא (entryOpen). בלי שניהם — סגירת הסיגנל, מסומן. SPY נמדד מאותה נקודה (spyEntry940 / spyEntry).
export function fillForward(doc, h, priceNow, { spyNow = null, spyThen = null, day = null, entryOpen = null, spyEntry = null, entry940 = null, spyEntry940 = null } = {}){
  if (!doc || doc.fwd?.[h]) return { filled: 0, already: true };
  const pick = (a, b, c) => (isNum(a) && a > 0 ? [a, '0940'] : isNum(b) && b > 0 ? [b, 'next-open'] : [c, 'close']);
  const [spyBase, spyKind] = pick(spyEntry940, spyEntry, spyThen);
  const spy = isNum(spyNow) && isNum(spyBase) && spyBase > 0 ? round(spyNow / spyBase - 1, 4) : null;
  const spyOpen = isNum(spyNow) && isNum(spyEntry) && spyEntry > 0 ? round(spyNow / spyEntry - 1, 4) : null;
  let filled = 0; const kinds = { '0940': 0, 'next-open': 0, close: 0 };
  for (const r of doc.rows){
    const p = priceNow[r.symbol];
    const [entry, kind] = pick(entry940?.[r.symbol], entryOpen?.[r.symbol], r.price);
    if (isNum(p) && isNum(entry) && entry > 0){
      const ret = round(p / entry - 1, 4);
      const eo = entryOpen?.[r.symbol]; const retOpen = isNum(eo) && eo > 0 ? round(p / eo - 1, 4) : null;
      r.fwd[h] = { ret, excess: spy === null ? null : round(ret - spy, 4), entry: round(entry, 4), entryKind: kind, retOpen, excessOpen: retOpen === null || spyOpen === null ? null : round(retOpen - spyOpen, 4) };
      filled++; kinds[kind]++;
    }
  }
  doc.fwd[h] = { day, spy, spyOpen, spyEntryKind: spyKind, filled, kinds, atOpen: kinds['next-open'] + kinds['0940'] };
  return { filled, kinds, already: false };
}

const emptyStat = () => ({ n: 0, sum: 0, sumEx: 0, nEx: 0 });
const addStat = (st, ret, ex) => { st.n++; st.sum += ret; if (isNum(ex)){ st.nEx++; st.sumEx += ex; } };
// צבירה מצטברת של סטטיסטיקות (סכומים) — כדי שהדוח לא יקרא עשרות מסמכים בכל בקשה
export function accumulateStats(stats, doc, h){
  const S = stats || { version: SHADOW_VERSION, horizons: {}, days: {} };
  S.days[h] = S.days[h] || []; if (S.days[h].includes(doc.day)) return S; S.days[h].push(doc.day);
  const H = (S.horizons[h] = S.horizons[h] || {});
  for (const m of MODEL_KEYS){
    const key = m === 'D' ? (doc.models?.D?.variant || 'D') : m === 'DF' ? (doc.models?.DF?.variant || 'DF') : m; // D-preRevision נצבר בנפרד מ-D (וכך DF)
    if (m === 'DF' && !doc.models?.DF) continue; // מסמכים מלפני DF
    const M = (H[key] = H[key] || { buckets: {}, actions: {}, ic: { n: 0, sum: 0 }, byDay: [] });
    const sc = [], fw = [];
    M.kinds = M.kinds || {}; M.actionsOpen = M.actionsOpen || {};
    for (const r of doc.rows){ const f = r.fwd?.[h]; if (!f || !isNum(r[m])) continue; sc.push(r[m]); fw.push(f.ret); M.kinds[f.entryKind] = (M.kinds[f.entryKind] || 0) + 1; const b = bucketOf(r[m]); M.buckets[b] = M.buckets[b] || emptyStat(); addStat(M.buckets[b], f.ret, f.excess); const a = r['act' + m]; if (a){ M.actions[a] = M.actions[a] || emptyStat(); addStat(M.actions[a], f.ret, f.excess); if (isNum(f.retOpen)){ M.actionsOpen[a] = M.actionsOpen[a] || emptyStat(); addStat(M.actionsOpen[a], f.retOpen, f.excessOpen); } } }
    const ic = spearman(sc, fw); if (isNum(ic)){ M.ic.n++; M.ic.sum += ic; M.byDay.push([doc.day, ic]); M.byDay = M.byDay.slice(-120); }
  }
  return S;
}
// סיכום קריא מהצבירה: ממוצעים, מונוטוניות (האם ציון גבוה → תשואה גבוהה בסדר עולה), IC ממוצע
export function summarizeStats(stats){
  if (!stats) return null;
  const out = { horizons: {} };
  const order = [...SHADOW_RULES.buckets.map((e) => `${e}+`), `<${SHADOW_RULES.buckets[SHADOW_RULES.buckets.length - 1]}`];
  for (const [h, H] of Object.entries(stats.horizons || {})){
    out.horizons[h] = { days: (stats.days?.[h] || []).length, models: {} };
    for (const [m, M] of Object.entries(H)){
      const buckets = order.map((b) => ({ bucket: b, n: M.buckets[b]?.n || 0, mean: M.buckets[b]?.n ? round(M.buckets[b].sum / M.buckets[b].n, 4) : null, excess: M.buckets[b]?.nEx ? round(M.buckets[b].sumEx / M.buckets[b].nEx, 4) : null }));
      const means = buckets.filter((b) => b.n >= 5).map((b) => b.mean);
      const monotonic = means.length >= 3 ? means.every((v, i) => i === 0 || v <= means[i - 1]) : null; // מהגבוה לנמוך: כל קבוצה ≤ הקודמת
      const actions = Object.fromEntries(Object.entries(M.actions).map(([a, s]) => [a, { n: s.n, mean: round(s.sum / s.n, 4), excess: s.nEx ? round(s.sumEx / s.nEx, 4) : null }]));
      const actionsOpen = Object.fromEntries(Object.entries(M.actionsOpen || {}).map(([a, s]) => [a, { n: s.n, mean: round(s.sum / s.n, 4), excess: s.nEx ? round(s.sumEx / s.nEx, 4) : null }]));
      out.horizons[h].models[m] = { buckets, monotonic, ic: M.ic.n ? round(M.ic.sum / M.ic.n, 3) : null, icDays: M.ic.n, actions, actionsOpen, entryKinds: M.kinds || {}, n: buckets.reduce((s, b) => s + b.n, 0) };
    }
  }
  return out;
}
