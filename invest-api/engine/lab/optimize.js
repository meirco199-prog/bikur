// אופטימיזציה ואימות (דרישה 9): רשת פרמטרים, אימון/אימות/מבחן, Walk-Forward, רגישות, Monte Carlo, מובהקות עם תיקון לריבוי ניסויים.
// העיקרון (AI_COUNCIL#31): לא בוחרים את מה שהרוויח הכי הרבה בעבר — בוחרים באימון, מאמתים באימות, ופותחים את תקופת המבחן פעם אחת.
import { simulate } from './simulate.js';
import { analyze, dailyReturns, seriesMetrics } from './metrics.js';
import { normalizeSpec } from './schema.js';
import { FeatureCache } from './features.js';
import { mean, std } from '../util.js';

const rnd = (x, d = 4) => (Number.isFinite(x) ? +x.toFixed(d) : null);
export const MAX_COMBOS = 5000;

// params: { topN: { path: 'signal.rank.top', values: [5,10,20] }, … } → [{topN:5,…}, …]
export function expandGrid(params){
  const names = Object.keys(params || {}); if (!names.length) return [{}];
  let combos = [{}];
  for (const n of names){ const vals = params[n].values || []; if (!vals.length) throw new Error(`פרמטר ${n}: אין ערכים`); const next = []; for (const c of combos) for (const v of vals) next.push({ ...c, [n]: v }); combos = next; if (combos.length > MAX_COMBOS) throw new Error(`יותר מ-${MAX_COMBOS} צירופים — צמצם את הרשת`); }
  return combos;
}
export function setPath(obj, path, value){ const parts = path.split('.'); let o = obj; for (let i = 0; i < parts.length - 1; i++){ if (o[parts[i]] === undefined || o[parts[i]] === null || typeof o[parts[i]] !== 'object') o[parts[i]] = /^\d+$/.test(parts[i + 1]) ? [] : {}; o = o[parts[i]]; } o[parts[parts.length - 1]] = value; return obj; }
export function getPath(obj, path){ return path.split('.').reduce((o, k) => (o === undefined || o === null ? undefined : o[k]), obj); }
export function applyParams(spec, combo, params){ const s = JSON.parse(JSON.stringify(spec)); for (const [n, v] of Object.entries(combo)){ const def = params[n]; if (!def) continue; for (const p of Array.isArray(def.path) ? def.path : [def.path]) setPath(s, p, v); } return s; }
const withRange = (spec, from, to) => ({ ...spec, period: { ...(spec.period || {}), from: from || spec.period?.from || null, to: to || spec.period?.to || null } });

// יעדים (מה למקסם). consistency = חלק השנים החיוביות; stability = Sharpe × עקביות − עונש על ירידה
export const OBJECTIVES = {
  cagr: { label: 'תשואה שנתית (CAGR; במצב מחקר — ממוצע על ההון הקבוע)', score: (a) => a.series?.cagr ?? a.series?.avgAnnual },
  sharpe: { label: 'תשואה ביחס לסיכון (Sharpe)', score: (a) => a.series?.sharpe },
  sortino: { label: 'Sortino', score: (a) => a.series?.sortino },
  calmar: { label: 'תשואה ביחס לירידה (Calmar)', score: (a) => a.series?.calmar },
  maxdd: { label: 'ירידה מקסימלית נמוכה', score: (a) => (a.series?.maxDD === null || a.series?.maxDD === undefined ? null : a.series.maxDD) },
  profit_factor: { label: 'Profit Factor', score: (a) => (a.trades?.profitFactor === Infinity ? 10 : a.trades?.profitFactor) },
  consistency: { label: 'עקביות לאורך שנים', score: (a) => { const ys = Object.values(a.periodic?.yearly || {}); return ys.length ? ys.filter((y) => y > 0).length / ys.length : null; } },
  stability: { label: 'יציבות (Sharpe × עקביות)', score: (a) => { const ys = Object.values(a.periodic?.yearly || {}); const c = ys.length ? ys.filter((y) => y > 0).length / ys.length : 0; return a.series?.sharpe === null ? null : a.series.sharpe * (0.5 + c / 2); } },
};
export const summarize = (a) => (!a || a.error ? null : { cagr: a.series.cagr ?? a.series.avgAnnual, additive: a.series.additive, totalReturn: a.series.totalReturn, sharpe: a.series.sharpe, sortino: a.series.sortino, calmar: a.series.calmar, maxDD: a.series.maxDD, annVol: a.series.annVol, trades: a.trades.count, winRate: a.trades.winRate, profitFactor: a.trades.profitFactor, expectancyPct: a.trades.expectancyPct, finalEquity: a.series.end, years: a.series.years, yearly: a.periodic?.yearly, limited: a.limited });

// הרצת רשת על טווח — מחזיר שורות ממוינות לפי היעד (הטוב ראשון)
export function runGrid(ds, spec, params, { objective = 'sharpe', from = null, to = null, onProgress = null, cache = null, minTrades = 20 } = {}){
  const combos = expandGrid(params), obj = OBJECTIVES[objective] || OBJECTIVES.sharpe, fc = cache || new FeatureCache(), rows = [];
  combos.forEach((combo, i) => {
    const s = withRange(applyParams(spec, combo, params), from, to);
    const r = simulate(ds, s, { cache: fc, keepSignals: false });
    const a = r.error ? null : analyze(r);
    const sc = a ? obj.score(a) : null;
    rows.push({ combo, score: a && a.trades.count >= minTrades && sc !== null && sc !== undefined && Number.isFinite(sc) ? rnd(sc) : null, summary: summarize(a), error: r.error || null, tooFewTrades: !!a && a.trades.count < minTrades, dailyReturns: a ? dailyReturns(r.equity, s.sizing?.unlimited ? r.capital : null) : null });
    if (onProgress) onProgress((i + 1) / combos.length, i + 1, combos.length);
  });
  rows.sort((x, y) => (y.score ?? -Infinity) - (x.score ?? -Infinity));
  return { rows, objective, combos: combos.length };
}

// חלוקה כרונולוגית: אימון → אימות → מבחן (ברירת מחדל 50/25/25)
export function splitPeriod(from, to, { train = 0.5, val = 0.25 } = {}){
  const a = new Date(from + 'T00:00:00Z'), b = new Date(to + 'T00:00:00Z'), span = b - a;
  const d1 = new Date(a.getTime() + span * train), d2 = new Date(a.getTime() + span * (train + val));
  const iso = (d) => d.toISOString().slice(0, 10), next = (d) => iso(new Date(d.getTime() + 86400000));
  return { train: { from, to: iso(d1) }, val: { from: next(d1), to: iso(d2) }, test: { from: next(d2), to } };
}

// האופטימיזציה המלאה
export function optimize(ds, specInput, { params, objective = 'sharpe', from = null, to = null, split = { train: 0.5, val: 0.25 }, topK = 5, onProgress = null, minTrades = 20, nTrialsForDsr = null } = {}){
  const spec = normalizeSpec(specInput);
  const f = from || spec.period.from || ds.isoAt(0), t = to || spec.period.to || ds.isoAt(ds.n - 1);
  const ranges = splitPeriod(f, t, split), fc = new FeatureCache();
  const total = expandGrid(params).length;
  const prog = (phase, frac) => onProgress && onProgress({ phase, frac });
  // 1. אימון: כל הרשת
  const train = runGrid(ds, spec, params, { objective, ...ranges.train, cache: fc, minTrades, onProgress: (p) => prog('train', p) });
  const valid = train.rows.filter((r) => r.score !== null);
  if (!valid.length) return { error: 'אף צירוף לא הניב מספיק עסקאות בתקופת האימון — הרחב את התקופה או שנה את הפרמטרים', ranges, train, spec };
  // 2. אימות: K הטובים מהאימון; הבחירה הסופית לפי האימות (לא לפי האימון)
  const cands = valid.slice(0, topK);
  const valRows = cands.map((c, i) => { const s = withRange(applyParams(spec, c.combo, params), ranges.val.from, ranges.val.to); const r = simulate(ds, s, { cache: fc, keepSignals: false }); const a = r.error ? null : analyze(r); const sc = a && a.trades.count >= Math.max(5, minTrades / 2) ? OBJECTIVES[objective].score(a) : null; prog('val', (i + 1) / cands.length); return { combo: c.combo, trainScore: c.score, score: Number.isFinite(sc) ? rnd(sc) : null, summary: summarize(a) }; });
  valRows.sort((x, y) => (y.score ?? -Infinity) - (x.score ?? -Infinity));
  const chosen = valRows[0];
  // 3. מבחן — נפתח פעם אחת, רק לצירוף הנבחר
  const testSpec = withRange(applyParams(spec, chosen.combo, params), ranges.test.from, ranges.test.to);
  const testRes = simulate(ds, testSpec, { cache: fc }); const testA = testRes.error ? null : analyze(testRes);
  const test = { combo: chosen.combo, score: testA ? rnd(OBJECTIVES[objective].score(testA)) : null, summary: summarize(testA), result: testRes };
  // 4. רגישות: שינוי פרמטר אחד סביב הנבחר (אימון+אימות יחד), והשוואה לחציון הרשת
  const sensitivity = {};
  for (const [name, def] of Object.entries(params)){
    sensitivity[name] = def.values.map((v) => { const combo = { ...chosen.combo, [name]: v }; const row = train.rows.find((r) => JSON.stringify(r.combo) === JSON.stringify(combo)); return { value: v, trainScore: row?.score ?? null, chosen: v === chosen.combo[name] }; });
  }
  const scores = valid.map((r) => r.score), median = scores.slice().sort((a, b) => a - b)[Math.floor(scores.length / 2)];
  // 5. מובהקות + ריבוי ניסויים על תוצאת המבחן
  const sig = testA ? significance(testRes, { nTrials: nTrialsForDsr || total, trialSharpes: valid.map((r) => r.summary?.sharpe).filter((x) => x !== null && x !== undefined) }) : null;
  // 6. אזהרות Overfitting
  const warnings = [];
  const tr = chosen.trainScore, va = chosen.score, te = test.score;
  if (va === null) warnings.push('לא היו מספיק עסקאות באימות — אי אפשר לאמת את הבחירה.');
  else if (tr > 0 && va < tr * 0.5) warnings.push('הציון באימות נמוך מחצי מהציון באימון — סימן להתאמת-יתר (Overfitting).');
  if (te !== null && tr > 0 && te <= 0) warnings.push('הצירוף הנבחר הפסיד/לא הרוויח בתקופת המבחן — ההצלחה בעבר לא החזיקה מחוץ למדגם.');
  if (sig && sig.pAdjusted !== null && sig.pAdjusted > 0.05) warnings.push(`אחרי תיקון לריבוי ניסויים (${total} צירופים) התוצאה אינה מובהקת (p=${sig.pAdjusted}).`);
  if (sig && sig.deflatedSharpe !== null && sig.deflatedSharpe < 0.95) warnings.push(`Deflated Sharpe Ratio = ${sig.deflatedSharpe} — ההסתברות שהשארפ אמיתי ולא תוצר של חיפוש בין ${total} צירופים נמוכה מ-95%.`);
  const isolated = Object.entries(sensitivity).some(([, rows]) => { const i = rows.findIndex((r) => r.chosen); const c = rows[i]?.trainScore; const nb = [rows[i - 1], rows[i + 1]].filter(Boolean).map((r) => r.trainScore).filter((x) => x !== null); return c !== null && nb.length && nb.every((x) => x < c * 0.5); });
  if (isolated) warnings.push('הפרמטר הנבחר הוא "פסגה בודדת": השכנים שלו ברשת חלשים בהרבה — יציבות נמוכה.');
  const valSharesPositive = valid.filter((r) => r.score > 0).length / valid.length;
  return { spec, objective, ranges, combos: total, train: { rows: train.rows.map(({ dailyReturns: _d, ...r }) => r), median: rnd(median), positiveShare: rnd(valSharesPositive) }, validation: valRows, chosen: chosen.combo, test, sensitivity, significance: sig, warnings, overfit: warnings.length > 0 };
}

// Walk-Forward: חלונות IS→OOS מתגלגלים; בחירה על IS בלבד; OOS משורשר = ההערכה ההוגנת
export function walkForward(ds, specInput, params, { objective = 'sharpe', from = null, to = null, isYears = 3, oosYears = 1, onProgress = null, minTrades = 20 } = {}){
  const spec = normalizeSpec(specInput), fc = new FeatureCache();
  const f = from || spec.period.from || ds.isoAt(0), t = to || spec.period.to || ds.isoAt(ds.n - 1);
  const y0 = +f.slice(0, 4), y1 = +t.slice(0, 4), windows = [];
  for (let y = y0 + isYears; y <= y1; y += oosYears){ const isFrom = `${y - isYears}-01-01`, isTo = `${y - 1}-12-31`, oosFrom = `${y}-01-01`, oosTo = `${Math.min(y1, y + oosYears - 1)}-12-31`; if (isFrom < f.slice(0, 4) + '-01-01' && y - isYears < y0) continue; windows.push({ isFrom: isFrom < f ? f : isFrom, isTo, oosFrom, oosTo: oosTo > t ? t : oosTo }); }
  if (!windows.length) return { error: `אין מספיק שנים ל-Walk-Forward (נדרש לפחות ${isYears + oosYears})`, spec };
  const out = [], stitched = []; let eq = spec.sizing.capital;
  windows.forEach((w, i) => {
    const g = runGrid(ds, spec, params, { objective, from: w.isFrom, to: w.isTo, cache: fc, minTrades });
    const best = g.rows.find((r) => r.score !== null); if (!best){ out.push({ ...w, chosen: null, note: 'אין מספיק עסקאות ב-IS' }); return; }
    const s = withRange(applyParams(spec, best.combo, params), w.oosFrom, w.oosTo); const r = simulate(ds, s, { cache: fc, keepSignals: false });
    const a = r.error ? null : analyze(r);
    if (a){ const base = r.equity[0][1]; for (const e of r.equity) stitched.push([e[0], +(eq * e[1] / base).toFixed(2)]); eq = stitched[stitched.length - 1][1]; }
    out.push({ ...w, chosen: best.combo, isScore: best.score, oos: summarize(a) });
    if (onProgress) onProgress((i + 1) / windows.length);
  });
  // יציבות: כמה פעמים הפרמטר הנבחר השתנה בין חלונות
  const chosenList = out.filter((w) => w.chosen).map((w) => JSON.stringify(w.chosen)); const changes = chosenList.filter((c, i) => i > 0 && c !== chosenList[i - 1]).length;
  const oosMetrics = stitched.length > 2 ? seriesMetrics(stitched) : null;
  const oosPositive = out.filter((w) => w.oos && w.oos.totalReturn > 0).length;
  return { spec, objective, windows: out, oosEquity: stitched, oosMetrics, stability: { changes, windows: chosenList.length, label: chosenList.length <= 1 ? '—' : changes <= chosenList.length / 3 ? 'יציב' : 'לא יציב (הפרמטר קופץ בין חלונות)' }, oosPositiveWindows: oosPositive, warning: oosMetrics && oosMetrics.cagr !== null && oosMetrics.cagr <= 0 ? 'תוצאת ה-OOS המשורשרת אינה חיובית — אין עדות ליתרון מחוץ למדגם' : null };
}

// Monte Carlo על רצף העסקאות (bootstrap עם החזרה). מגבלה: מניח עסקאות בלתי תלויות וללא חפיפה — מתעלם מתלות בזמן ומתקופות ריכוז.
// additive (מצב מחקר / סכום קבוע): כל עסקה מוסיפה pnl$ קבוע-נומינל במקום להכפיל את ההון; הירידה נמדדת בדולרים חלקי ההון
export function monteCarlo(trades, { capital = 50000, n = 1000, seed = 7, perTrade = null, additive = false } = {}){
  if (!trades?.length) return { error: 'אין עסקאות' };
  const pct = trades.map((t) => t.pnlPct), pnl = trades.map((t) => t.pnl), m = trades.length, rng = mulberry(seed);
  const fraction = perTrade || 1 / Math.max(1, mode(trades.map((t) => Math.round(1 / Math.max(1e-6, (t.shares * t.entryPrice) / capital))))); // חלק ההון לעסקה (קירוב)
  const finals = [], dds = [];
  for (let s = 0; s < n; s++){
    let eq = capital, peak = capital, dd = 0;
    for (let i = 0; i < m; i++){ const j = Math.floor(rng() * m); if (additive){ eq += pnl[j]; peak = Math.max(peak, eq); dd = Math.min(dd, (eq - peak) / capital); } else { eq *= 1 + pct[j] * fraction; peak = Math.max(peak, eq); dd = Math.min(dd, eq / peak - 1); } }
    finals.push(eq); dds.push(dd);
  }
  finals.sort((a, b) => a - b); dds.sort((a, b) => a - b);
  const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
  return { simulations: n, additive, fractionPerTrade: rnd(fraction, 3), finalEquity: { p5: rnd(q(finals, 0.05), 0), p25: rnd(q(finals, 0.25), 0), median: rnd(q(finals, 0.5), 0), p75: rnd(q(finals, 0.75), 0), p95: rnd(q(finals, 0.95), 0) }, maxDD: { p5: rnd(q(dds, 0.05)), median: rnd(q(dds, 0.5)), p95: rnd(q(dds, 0.95)) }, probLoss: rnd(finals.filter((x) => x < capital).length / n), probDD20: rnd(dds.filter((x) => x <= -0.2).length / n), limitations: ['מניח שהעסקאות בלתי תלויות זו בזו ושסדרן אקראי — בפועל הפסדים מתרכזים בתקופות (משברים).', 'מתעלם מחפיפה בין פוזיציות ומשינוי גודל עם ההון.', 'מדגים את טווח התוצאות האפשרי בהינתן אותה התפלגות עסקאות, לא את ההסתברות שהיתרון יימשך.'] };
}
const mode = (arr) => { const m = new Map(); let best = arr[0], c = 0; for (const x of arr){ const k = (m.get(x) || 0) + 1; m.set(x, k); if (k > c){ c = k; best = x; } } return best; };
export function mulberry(seed){ let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// פונקציות התפלגות נורמלית
export function normCdf(x){ const t = 1 / (1 + 0.2316419 * Math.abs(x)); const d = 0.3989423 * Math.exp(-x * x / 2); let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return x > 0 ? 1 - p : p; }
export function normInv(p){ if (p <= 0) return -Infinity; if (p >= 1) return Infinity; const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00], b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01], c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00], d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00]; const pl = 0.02425; let q, r; if (p < pl){ q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); } if (p <= 1 - pl){ q = p - 0.5; r = q * q; return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); } q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }

// מובהקות: t על תשואות יומיות, bootstrap, תיקון Bonferroni לריבוי ניסויים, Deflated Sharpe Ratio (Bailey & López de Prado 2014)
export function significance(result, { nTrials = 1, trialSharpes = null, bootstrap = 2000, seed = 11 } = {}){
  const r = dailyReturns(result.equity, result.spec?.sizing?.unlimited ? result.capital : null).filter((x) => Number.isFinite(x)); const T = r.length; if (T < 20) return { error: 'פחות מ-20 ימי מסחר — אין מובהקות' };
  const m = mean(r), sd = std(r); const t = sd > 0 ? m / (sd / Math.sqrt(T)) : 0; const p = 2 * (1 - normCdf(Math.abs(t)));
  const rng = mulberry(seed); let ge = 0; for (let s = 0; s < bootstrap; s++){ let acc = 0; for (let i = 0; i < T; i++) acc += r[Math.floor(rng() * T)] - m; if (acc / T >= m) ge++; } // H0: ממוצע 0 (מרכוז)
  const pBoot = Math.max(1 / bootstrap, ge / bootstrap);
  const pAdj = Math.min(1, p * Math.max(1, nTrials));
  // DSR
  const sr = sd > 0 ? m / sd : 0; const sk = skew(r), ku = kurt(r);
  let sr0 = 0, dsr = null;
  if (trialSharpes && trialSharpes.length > 1){ const daily = trialSharpes.map((x) => x / Math.sqrt(252)); const v = Math.pow(std(daily), 2); const N = trialSharpes.length; const em = 0.5772156649; sr0 = Math.sqrt(v) * ((1 - em) * normInv(1 - 1 / N) + em * normInv(1 - 1 / (N * Math.E))); }
  const denom = Math.sqrt(Math.max(1e-12, 1 - sk * sr + (ku - 1) / 4 * sr * sr));
  dsr = normCdf((sr - sr0) * Math.sqrt(T - 1) / denom);
  const psr = normCdf(sr * Math.sqrt(T - 1) / denom);
  return { days: T, meanDaily: rnd(m, 6), tStat: rnd(t, 3), pValue: rnd(p, 4), pBootstrap: rnd(pBoot, 4), nTrials, pAdjusted: rnd(pAdj, 4), sharpeAnnual: rnd(sr * Math.sqrt(252), 3), sharpeThresholdAnnual: rnd(sr0 * Math.sqrt(252), 3), probabilisticSharpe: rnd(psr, 3), deflatedSharpe: rnd(dsr, 3), skew: rnd(sk, 3), kurtosis: rnd(ku, 3), verdict: pAdj <= 0.05 && dsr >= 0.95 ? 'מובהק גם אחרי תיקון לריבוי ניסויים' : p <= 0.05 ? 'מובהק לבדו, אך לא אחרי תיקון למספר הניסויים' : 'לא מובהק' };
}
const skew = (r) => { const m = mean(r), s = std(r, false); if (!s) return 0; return mean(r.map((x) => ((x - m) / s) ** 3)); };
const kurt = (r) => { const m = mean(r), s = std(r, false); if (!s) return 3; return mean(r.map((x) => ((x - m) / s) ** 4)); };

// ביצועים בתקופות שוק שונות: לפי משטר הייחוס (מעל/מתחת SMA200) ותקופות משבר מוכרות שמכוסות בנתונים
export const CRISIS_PERIODS = [{ label: 'משבר 2008 (10/2007–3/2009)', from: '2007-10-09', to: '2009-03-09' }, { label: 'שוק שור 2009–2019', from: '2009-03-10', to: '2019-12-31' }, { label: 'קורונה (2–3/2020)', from: '2020-02-19', to: '2020-03-23' }, { label: 'התאוששות 2020–2021', from: '2020-03-24', to: '2021-12-31' }, { label: 'ריבית עולה 2022', from: '2022-01-03', to: '2022-12-30' }, { label: '2023 עד היום', from: '2023-01-03', to: '2099-12-31' }];
export function periodBreakdown(result, bench = null){
  const eq = result.equity; if (!eq?.length) return [];
  const base = result.spec?.sizing?.unlimited ? result.capital : null;
  return CRISIS_PERIODS.map((p) => { const seg = eq.filter((e) => e[0] >= p.from && e[0] <= p.to); if (seg.length < 10) return { ...p, missing: true }; const m = seriesMetrics(seg, { additiveBase: base }); const bs = bench ? bench.filter((e) => e[0] >= p.from && e[0] <= p.to) : null; const bm = bs && bs.length > 10 ? seriesMetrics(bs) : null; const trades = result.trades.filter((t) => t.entryDate >= seg[0][0] && t.entryDate <= seg[seg.length - 1][0]); return { ...p, from: seg[0][0], to: seg[seg.length - 1][0], totalReturn: m.totalReturn, cagr: m.cagr, maxDD: m.maxDD, sharpe: m.sharpe, trades: trades.length, winRate: trades.length ? rnd(trades.filter((t) => t.pnl > 0).length / trades.length) : null, bench: bm ? { totalReturn: bm.totalReturn, maxDD: bm.maxDD } : null }; });
}
