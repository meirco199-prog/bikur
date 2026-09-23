// מנוע גילוי הזדמנויות רב-נכסי: סורק סדרות מחירים של כל המכשירים ומחזיר מועמדים עם כיוון (לונג/שורט), אסטרטגיה, ציון,
// ראיות מספריות, עצירה (ATR) ואופק. פונקציה טהורה — בלי רשת. לא "מה זז" אלא "מה זז, למה, ומתי היתרון נגמר":
// כל מועמד נושא invalidation (מה מבטל אותו) ו-worstCase (הפסד מקסימלי לפקודה; null = בלתי מוגבל → שורט/חוזה/ממונף).
import { closes, highs, lows, volumes, sma, rsi, atr, rollingMax, rollingMin, annualizedVol } from './indicators.js';
import { round, isNum, mean, std } from './util.js';

export const STRATEGIES = Object.freeze({
  trend: { label: 'מעקב מגמה (פריצה מעל/מתחת ל-55 ימים בכיוון הממוצעים)', horizonDays: 40, riskPct: 0.01, atrStop: 2.5 },
  xmom: { label: 'מומנטום חוצה-נכסים (12−1, דירוג בין המכשירים)', horizonDays: 30, riskPct: 0.01, atrStop: 3 },
  meanrev: { label: 'חזרה לממוצע (RSI קיצוני בכיוון המגמה הארוכה)', horizonDays: 10, riskPct: 0.0075, atrStop: 2 },
  volshock: { label: 'זעזוע מחיר/נפח (דורש מחקר לפני פקודה)', horizonDays: 5, riskPct: 0, atrStop: 2 },
});
const MIN_ROWS = 70;

function features(rows){
  const c = closes(rows), h = highs(rows), l = lows(rows), v = volumes(rows), n = c.length, i = n - 1;
  const s20 = sma(c, 20), s50 = sma(c, 50), s200 = sma(c, 200), r14 = rsi(c, 14), a14 = atr(rows, 14), hi55 = rollingMax(h, 55), lo55 = rollingMin(l, 55);
  const ret = (k) => (n > k && c[i - k] > 0 ? c[i] / c[i - k] - 1 : null);
  const rets = c.slice(1).map((x, j) => (c[j] > 0 ? x / c[j] - 1 : 0));
  const r5 = ret(5), win = rets.slice(-60, -5), mu = win.length > 20 ? mean(win) : 0, sd = win.length > 20 ? std(win) * Math.sqrt(5) : null;
  const z5 = isNum(r5) && sd ? (r5 - mu * 5) / sd : null;
  const vol20 = v.slice(-20).filter(isNum), volZ = vol20.length >= 10 && isNum(v[i]) && std(vol20) > 0 ? (v[i] - mean(vol20)) / std(vol20) : null;
  const prevHi55 = hi55[i - 1], prevLo55 = lo55[i - 1];
  return { close: c[i], sma20: s20[i], sma50: s50[i], sma200: s200[i], rsi: r14[i], atr: a14[i], hi55: prevHi55, lo55: prevLo55, ret5: r5, ret20: ret(20), ret60: ret(60), ret120: ret(120), mom121: n > 252 && c[i - 252] > 0 && c[i - 21] > 0 ? c[i - 21] / c[i - 252] - 1 : (n > 126 && c[i - 126] > 0 && c[i - 21] > 0 ? c[i - 21] / c[i - 126] - 1 : null), volAnn: annualizedVol(c.slice(-60)), z5, volZ, rows: n, day: rows[i][0] };
}
const score = (x, lo, hi) => Math.max(0, Math.min(100, ((x - lo) / (hi - lo)) * 100));

function candidate(inst, f, strategy, side, evidence, extra = {}){
  const S = STRATEGIES[strategy];
  const stopDist = isNum(f.atr) ? f.atr * S.atrStop : f.close * 0.05;
  const stop = side === 'long' ? f.close - stopDist : f.close + stopDist;
  const unbounded = side === 'short' || inst.class === 'future' || Math.abs(inst.leverage || 1) > 1;
  return { symbol: inst.symbol, name: inst.name, nameHe: inst.nameHe, class: inst.class, sector: inst.sector, strategy, side, day: f.day, price: round(f.close, 4), stop: round(stop, 4), stopPct: round(stopDist / f.close, 4), horizonDays: S.horizonDays, riskPct: S.riskPct, unboundedLoss: unbounded, shortable: inst.shortable, evidence, ...extra };
}

// series: [{ inst, rows }] — rows [date, open, high, low, close, volume] בסדר עולה, עד יום ההחלטה (בלי look-ahead)
export function scanOpportunities({ series = [], regime = null, day = null } = {}){
  const feats = [], skipped = [];
  for (const { inst, rows } of series){
    if (!rows || rows.length < MIN_ROWS){ skipped.push({ symbol: inst.symbol, reason: `רק ${rows?.length || 0} ימים (צריך ${MIN_ROWS})` }); continue; }
    const f = features(rows); if (!isNum(f.close) || !isNum(f.atr)) { skipped.push({ symbol: inst.symbol, reason: 'אין ATR/מחיר' }); continue; }
    if (day && f.day > day){ skipped.push({ symbol: inst.symbol, reason: `נתונים אחרי ${day}` }); continue; }
    feats.push({ inst, f });
  }
  const out = [];
  const bear = regime?.trend === 'Bear Trend' || regime?.risk === 'Risk Off';
  // 1. מגמה: פריצה בכיוון הממוצעים
  for (const { inst, f } of feats){
    if (!isNum(f.sma50) || !isNum(f.sma200)) continue;
    const up = f.close > f.sma50 && f.sma50 > f.sma200, down = f.close < f.sma50 && f.sma50 < f.sma200;
    if (up && isNum(f.hi55) && f.close > f.hi55) out.push(candidate(inst, f, 'trend', 'long', { breakout55: round(f.close / f.hi55 - 1, 4), aboveSma200: round(f.close / f.sma200 - 1, 4), ret60: f.ret60, volAnn: round(f.volAnn, 3), regime: regime?.summary || null }, { score: round(40 + score(f.ret60 ?? 0, 0, 0.25) * 0.4 + score(f.close / f.sma200 - 1, 0, 0.2) * 0.2, 1), invalidation: `סגירה מתחת ל-SMA50 (${round(f.sma50, 2)}) או לעצירה` }));
    if (down && isNum(f.lo55) && f.close < f.lo55 && inst.shortable) out.push(candidate(inst, f, 'trend', 'short', { breakdown55: round(f.close / f.lo55 - 1, 4), belowSma200: round(f.close / f.sma200 - 1, 4), ret60: f.ret60, volAnn: round(f.volAnn, 3), regime: regime?.summary || null }, { score: round(40 + score(-(f.ret60 ?? 0), 0, 0.25) * 0.4 + score(1 - f.close / f.sma200, 0, 0.2) * 0.2 + (bear ? 10 : 0), 1), invalidation: `סגירה מעל SMA50 (${round(f.sma50, 2)}) או לעצירה` }));
  }
  // 2. מומנטום חוצה-נכסים: דירוג 12−1 בין המכשירים הלא-ממונפים (ETF/קריפטו/מט"ח/חוזים על proxy שונה)
  const pool = feats.filter(({ inst, f }) => isNum(f.mom121) && Math.abs(inst.leverage || 1) === 1 && inst.class !== 'future').sort((a, b) => b.f.mom121 - a.f.mom121);
  const k = Math.max(2, Math.floor(pool.length * 0.1));
  pool.slice(0, k).forEach(({ inst, f }, rank) => { if (f.mom121 > 0.05 && f.close > f.sma200) out.push(candidate(inst, f, 'xmom', 'long', { mom121: round(f.mom121, 4), rank: rank + 1, of: pool.length, aboveSma200: round(f.close / f.sma200 - 1, 4), volAnn: round(f.volAnn, 3) }, { score: round(45 + score(f.mom121, 0.05, 0.6) * 0.45 - rank * 3, 1), invalidation: 'יציאה מהעשירון העליון של המומנטום או סגירה מתחת ל-SMA200' })); });
  pool.slice(-k).forEach(({ inst, f }, j) => { const rank = j + 1; if (f.mom121 < -0.05 && f.close < f.sma200 && inst.shortable) out.push(candidate(inst, f, 'xmom', 'short', { mom121: round(f.mom121, 4), rankFromBottom: k - j, of: pool.length, belowSma200: round(f.close / f.sma200 - 1, 4), volAnn: round(f.volAnn, 3) }, { score: round(40 + score(-f.mom121, 0.05, 0.5) * 0.45 - (k - rank) * 3, 1), invalidation: 'יציאה מהעשירון התחתון או סגירה מעל SMA200' })); });
  // 3. חזרה לממוצע: RSI קיצוני בכיוון המגמה הארוכה
  for (const { inst, f } of feats){
    if (!isNum(f.rsi) || !isNum(f.sma200) || Math.abs(inst.leverage || 1) > 1) continue;
    if (f.rsi < 25 && f.close > f.sma200) out.push(candidate(inst, f, 'meanrev', 'long', { rsi14: round(f.rsi, 1), aboveSma200: round(f.close / f.sma200 - 1, 4), ret5: f.ret5, z5: isNum(f.z5) ? round(f.z5, 2) : null }, { score: round(45 + score(25 - f.rsi, 0, 15) * 0.4 + (isNum(f.z5) ? score(-f.z5, 1, 3) * 0.15 : 0), 1), invalidation: 'RSI מעל 55, או סגירה מתחת ל-SMA200, או 10 ימים' }));
    if (f.rsi > 78 && f.close < f.sma200 && inst.shortable) out.push(candidate(inst, f, 'meanrev', 'short', { rsi14: round(f.rsi, 1), belowSma200: round(f.close / f.sma200 - 1, 4), ret5: f.ret5, z5: isNum(f.z5) ? round(f.z5, 2) : null }, { score: round(42 + score(f.rsi - 78, 0, 15) * 0.4 + (isNum(f.z5) ? score(f.z5, 1, 3) * 0.15 : 0), 1), invalidation: 'RSI מתחת ל-45, או סגירה מעל SMA200, או 10 ימים' }));
  }
  // 4. זעזוע: תנועה של 5 ימים ≥ 3 סטיות תקן (או נפח חריג) — מועמד למחקר, בלי פקודה אוטומטית
  for (const { inst, f } of feats){
    if ((isNum(f.z5) && Math.abs(f.z5) >= 3) || (isNum(f.volZ) && f.volZ >= 3)) out.push(candidate(inst, f, 'volshock', f.z5 > 0 ? 'long' : 'short', { z5: isNum(f.z5) ? round(f.z5, 2) : null, ret5: f.ret5, volZ: isNum(f.volZ) ? round(f.volZ, 2) : null }, { score: round(30 + Math.min(30, Math.abs(f.z5 || 0) * 8), 1), needsResearch: true, invalidation: 'ללא פקודה עד שמקור התנועה (אירוע/דוח/מאקרו) מאומת' }));
  }
  // דדופ: מועמד אחד לכל מכשיר (הציון הגבוה); כיוונים סותרים באותו מכשיר מבטלים זה את זה
  const bySym = new Map();
  for (const c of out){ const ex = bySym.get(c.symbol); if (!ex) bySym.set(c.symbol, c); else if (ex.side !== c.side && !ex.needsResearch && !c.needsResearch){ bySym.set(c.symbol, { ...(ex.score >= c.score ? ex : c), conflict: `${ex.strategy}:${ex.side} מול ${c.strategy}:${c.side}`, score: round(Math.max(ex.score, c.score) - 15, 1) }); } else if (c.score > ex.score && !c.needsResearch) bySym.set(c.symbol, c); }
  const candidates = [...bySym.values()].sort((a, b) => b.score - a.score);
  return { day: day || feats[0]?.f.day || null, scanned: feats.length, skipped, candidates, summary: { long: candidates.filter((c) => c.side === 'long' && !c.needsResearch).length, short: candidates.filter((c) => c.side === 'short' && !c.needsResearch).length, research: candidates.filter((c) => c.needsResearch).length, byStrategy: Object.fromEntries(Object.keys(STRATEGIES).map((s) => [s, candidates.filter((c) => c.strategy === s).length])) } };
}

// גודל פוזיציה לפי תקציב סיכון: כמות = (הון × riskPct) ÷ (מרחק העצירה × יחידות לחוזה). מוגבל גם על ידי שער הפקודות אחר כך
export function sizeByRisk({ equityUsd, riskPct, price, stop, units = 1, minNotionalUsd = 300, maxNotionalUsd = null }){
  const dist = Math.abs(price - stop); if (!(dist > 0) || !(equityUsd > 0)) return 0;
  let qty = (equityUsd * riskPct) / (dist * units);
  if (isNum(maxNotionalUsd) && maxNotionalUsd > 0) qty = Math.min(qty, maxNotionalUsd / (price * units)); // תקרת המדיניות לפקודה אחת
  if (units >= 1 && price * units > 50) qty = Math.floor(qty); else qty = round(qty, 4);
  if (qty * price * units < minNotionalUsd) return 0;
  return qty;
}
