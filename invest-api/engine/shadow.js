// מודל צל (Signal Model v8) — פונקציות טהורות. מחשב כל לילה ציונים חלופיים במקביל למודל הישן, בלי לשלוח פקודות.
// המטרה: למדוד לפני שמחליפים. כל נתון שאין לו מקור = null/"לא זמין", לא 0.
// המודלים:
//   A = הישן: הציון והסיגנל שמפעילים את האוטומט היום (בסיס להשוואה).
//   B = יחסי-ענף בלי כפילויות: איחוד פונדמנטלי+איכות ל"רווחיות", טכני+מומנטום ל"מגמה"; כל גורם הופך לאחוזון בתוך הענף
//       (או בכל היקום אם הענף קטן); בלי מאקרו, סנטימנט ואנליסטים.
//   C = B + ריוויזיות תחזיות (כשקיימות) + שכבת מאקרו על *הפעולה* (לא על הציון): שוק דובי → אין קניות; Risk Off → רק קנייה חזקה.
import { isNum, mean, round, correlation } from './util.js';

export const SHADOW_VERSION = 1;
export const SHADOW_RULES = Object.freeze({ strongTopPct: 0.15, buyTopPct: 0.30, sellBottomPct: 0.20, minSector: 5, minUniverse: 20, dupeThreshold: 0.6, horizons: [1, 5, 20], buckets: [80, 70, 60, 50] });
export const FACTOR_LABELS = { value: 'תמחור', profitability: 'רווחיות', growth: 'צמיחה', trend: 'מגמה', risk: 'סיכון', revision: 'ריוויזיות' };
export const SHADOW_MODELS = Object.freeze({
  A: { label: 'הישן', desc: 'הציון והסיגנל שמפעילים את האוטומט היום', weights: null },
  B: { label: 'יחסי-ענף', desc: 'אחוזונים בתוך הענף, בלי כפילויות, בלי מאקרו/סנטימנט/אנליסטים', weights: Object.freeze({ value: 25, profitability: 20, growth: 20, trend: 25, risk: 10 }) },
  C: { label: 'B + ריוויזיות + מאקרו', desc: 'כמו B, עם ריוויזיות תחזיות כשקיימות (15) ושכבת מאקרו על הפעולה', weights: Object.freeze({ value: 25, profitability: 20, growth: 20, trend: 25, risk: 10, revision: 15 }) },
});
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
  return { value: isNum(c.valuation) ? c.valuation : null, profitability: avg2(c.fundamental, c.quality), growth: isNum(c.growth) ? c.growth : null, trend: avg2(c.technical, c.momentum), risk: isNum(c.risk) ? c.risk : null };
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
  const stocks = table.filter((r) => r.type === 'stock' && isNum(r.score));
  const raw = stocks.map((r) => rawFactors(r.components));
  const bySector = new Map();
  stocks.forEach((r, i) => { const s = r.sector || 'Unknown'; if (!bySector.has(s)) bySector.set(s, []); bySector.get(s).push(i); });
  const factorKeys = ['value', 'profitability', 'growth', 'trend', 'risk'];
  const pct = stocks.map((r, i) => {
    const grp = bySector.get(r.sector || 'Unknown'); const useSector = grp.length >= SHADOW_RULES.minSector; const pool = useSector ? grp : stocks.map((_, k) => k);
    const o = { _relativeTo: useSector ? 'sector' : 'universe' };
    for (const f of factorKeys) o[f] = pctRank(pool.map((k) => raw[k][f]), raw[i][f]);
    return o;
  });
  // ריוויזיות: אחוזון בכל היקום בין אלה שזמינות; חסר = null (לא 0)
  const revVals = stocks.map((r) => (revisions[r.symbol]?.available ? revisions[r.symbol].epsRevision : null));
  const revAvail = revVals.filter(isNum);
  const revPct = revVals.map((v) => (isNum(v) && revAvail.length >= 10 ? pctRank(revAvail, v) : null));
  const weighted = (p, w) => { let sw = 0, s = 0; for (const [k, wk] of Object.entries(w)){ if (isNum(p[k])){ sw += wk; s += wk * p[k]; } } return sw ? round(s / sw, 1) : null; };
  const eligible = pct.map((p) => ['value', 'profitability', 'growth', 'trend'].every((k) => isNum(p[k])));
  const scoreB = pct.map((p, i) => (eligible[i] ? weighted(p, SHADOW_MODELS.B.weights) : null));
  const scoreC = pct.map((p, i) => (eligible[i] ? weighted({ ...p, revision: revPct[i] }, SHADOW_MODELS.C.weights) : null));
  const overlay = overlayFor(regime);
  const actA = stocks.map((r) => legacyAction(r.signal));
  const actB = rankActions(scoreB);
  const actC = rankActions(scoreC, { overlay });
  const contribC = (i) => { const p = { ...pct[i], revision: revPct[i] }; const w = SHADOW_MODELS.C.weights; const sw = Object.entries(w).filter(([k]) => isNum(p[k])).reduce((s, [, v]) => s + v, 0); return Object.fromEntries(Object.entries(w).filter(([k]) => isNum(p[k])).map(([k, v]) => [k, round((v / sw) * p[k], 1)])); };
  const rows = stocks.map((r, i) => ({
    symbol: r.symbol, name: r.nameHe || r.name || r.symbol, sector: r.sector || null, price: r.price, currency: r.currency || 'USD',
    A: r.score, actA: actA[i], B: scoreB[i], actB: actB[i], C: scoreC[i], actC: actC[i], eligible: eligible[i],
    raw: raw[i], pct: pct[i], revision: isNum(revVals[i]) ? revVals[i] : null, revisionPct: revPct[i], revisionNote: revisions[r.symbol]?.available ? null : (revisions[r.symbol]?.reason || 'לא זמין'),
    contribC: eligible[i] ? contribC(i) : null, fwd: {},
  }));
  const count = (act) => ({ 'STRONG BUY': act.filter((a) => a === 'STRONG BUY').length, BUY: act.filter((a) => a === 'BUY').length, HOLD: act.filter((a) => a === 'HOLD').length, SELL: act.filter((a) => a === 'SELL').length });
  const agree = (x, y) => { const idx = rows.map((_, i) => i).filter((i) => x[i] && y[i]); return idx.length ? round(idx.filter((i) => x[i] === y[i]).length / idx.length, 3) : null; };
  const buys = (act) => new Set(rows.filter((_, i) => act[i] === 'BUY' || act[i] === 'STRONG BUY').map((r) => r.symbol));
  const overlap = (x, y) => { const a = buys(x), b = buys(y); const u = new Set([...a, ...b]); return u.size ? round([...a].filter((s) => b.has(s)).length / u.size, 3) : null; };
  const top = (key) => rows.filter((r) => isNum(r[key])).sort((a, b) => b[key] - a[key]).slice(0, 10).map((r) => r.symbol);
  const corr = componentCorrelation(stocks);
  return {
    version: SHADOW_VERSION, day, barDate, regime: regime ? { trend: regime.trend, risk: regime.risk } : null, overlay, n: rows.length, eligible: eligible.filter(Boolean).length,
    revisionsAvailable: revAvail.length, revisionsUsed: revAvail.length >= 10, rules: SHADOW_RULES,
    models: { A: { ...SHADOW_MODELS.A, actions: count(actA) }, B: { ...SHADOW_MODELS.B, actions: count(actB) }, C: { ...SHADOW_MODELS.C, actions: count(actC) } },
    agreement: { AB: agree(actA, actB), AC: agree(actA, actC), BC: agree(actB, actC), buyOverlapAB: overlap(actA, actB), buyOverlapAC: overlap(actA, actC) },
    top: { A: top('A'), B: top('B'), C: top('C') }, corr, rows, fwd: {},
  };
}

// מילוי תשואה עתידית לאופק h (ימי ניתוח) על מסמך ישן, לפי מחירי היום; spyNow/spyThen לתשואה עודפת
export function fillForward(doc, h, priceNow, { spyNow = null, spyThen = null, day = null } = {}){
  if (!doc || doc.fwd?.[h]) return { filled: 0, already: true };
  const spy = isNum(spyNow) && isNum(spyThen) && spyThen > 0 ? round(spyNow / spyThen - 1, 4) : null;
  let filled = 0;
  for (const r of doc.rows){ const p = priceNow[r.symbol]; if (isNum(p) && isNum(r.price) && r.price > 0){ const ret = round(p / r.price - 1, 4); r.fwd[h] = { ret, excess: spy === null ? null : round(ret - spy, 4) }; filled++; } }
  doc.fwd[h] = { day, spy, filled };
  return { filled, already: false };
}

export const bucketOf = (score, edges = SHADOW_RULES.buckets) => { if (!isNum(score)) return null; for (const e of edges) if (score >= e) return `${e}+`; return `<${edges[edges.length - 1]}`; };
const emptyStat = () => ({ n: 0, sum: 0, sumEx: 0, nEx: 0 });
const addStat = (st, ret, ex) => { st.n++; st.sum += ret; if (isNum(ex)){ st.nEx++; st.sumEx += ex; } };
// צבירה מצטברת של סטטיסטיקות (סכומים) — כדי שהדוח לא יקרא עשרות מסמכים בכל בקשה
export function accumulateStats(stats, doc, h){
  const S = stats || { version: SHADOW_VERSION, horizons: {}, days: {} };
  S.days[h] = S.days[h] || []; if (S.days[h].includes(doc.day)) return S; S.days[h].push(doc.day);
  const H = (S.horizons[h] = S.horizons[h] || {});
  for (const m of ['A', 'B', 'C']){
    const M = (H[m] = H[m] || { buckets: {}, actions: {}, ic: { n: 0, sum: 0 }, byDay: [] });
    const sc = [], fw = [];
    for (const r of doc.rows){ const f = r.fwd?.[h]; if (!f || !isNum(r[m])) continue; sc.push(r[m]); fw.push(f.ret); const b = bucketOf(r[m]); M.buckets[b] = M.buckets[b] || emptyStat(); addStat(M.buckets[b], f.ret, f.excess); const a = r['act' + m]; if (a){ M.actions[a] = M.actions[a] || emptyStat(); addStat(M.actions[a], f.ret, f.excess); } }
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
      out.horizons[h].models[m] = { buckets, monotonic, ic: M.ic.n ? round(M.ic.sum / M.ic.n, 3) : null, icDays: M.ic.n, actions, n: buckets.reduce((s, b) => s + b.n, 0) };
    }
  }
  return out;
}
