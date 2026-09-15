// אינדיקטורים טכניים. קלט: rows = [[date,o,h,l,c,v], ...] ממוין עולה.
// כל פונקציה מחזירה מערך באורך rows (null במקומות ללא ערך) או ערך בודד.
import { isNum, mean, std, round, clamp } from './util.js';

export const closes = (rows) => rows.map((r) => r[4]);
export const highs = (rows) => rows.map((r) => r[2]);
export const lows = (rows) => rows.map((r) => r[3]);
export const volumes = (rows) => rows.map((r) => r[5]);

export function sma(values, n){
  const out = new Array(values.length).fill(null);
  let sum = 0, cnt = 0;
  for (let i = 0; i < values.length; i++){
    const v = values[i];
    if (isNum(v)){ sum += v; cnt++; }
    if (i >= n){
      const old = values[i - n];
      if (isNum(old)){ sum -= old; cnt--; }
    }
    if (i >= n - 1 && cnt === n) out[i] = sum / n;
  }
  return out;
}

export function ema(values, n){
  const out = new Array(values.length).fill(null);
  const k = 2 / (n + 1);
  let prev = null, seed = [], started = false;
  for (let i = 0; i < values.length; i++){
    const v = values[i];
    if (!isNum(v)){ out[i] = prev; continue; }
    if (!started){
      seed.push(v);
      if (seed.length === n){ prev = mean(seed); out[i] = prev; started = true; }
      continue;
    }
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

// RSI לפי Wilder (ממוצע נע מוחלק)
export function rsi(values, n = 14){
  const out = new Array(values.length).fill(null);
  let gain = 0, loss = 0;
  for (let i = 1; i < values.length; i++){
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0, l = d < 0 ? -d : 0;
    if (i <= n){
      gain += g; loss += l;
      if (i === n){
        gain /= n; loss /= n;
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
      }
      continue;
    }
    gain = (gain * (n - 1) + g) / n;
    loss = (loss * (n - 1) + l) / n;
    out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
  }
  return out;
}

export function macd(values, fast = 12, slow = 26, signal = 9){
  const ef = ema(values, fast), es = ema(values, slow);
  const line = values.map((_, i) => (isNum(ef[i]) && isNum(es[i]) ? ef[i] - es[i] : null));
  // signal EMA מחושב רק על הערכים הקיימים
  const firstIdx = line.findIndex(isNum);
  const sig = new Array(values.length).fill(null);
  if (firstIdx >= 0){
    const e = ema(line.slice(firstIdx), signal);
    for (let i = 0; i < e.length; i++) sig[firstIdx + i] = e[i];
  }
  const hist = line.map((v, i) => (isNum(v) && isNum(sig[i]) ? v - sig[i] : null));
  return { line, signal: sig, hist };
}

export function bollinger(values, n = 20, k = 2){
  const mid = sma(values, n);
  const upper = new Array(values.length).fill(null), lower = upper.slice(), pctB = upper.slice(), width = upper.slice();
  let sum = 0, sumSq = 0;
  for (let i = 0; i < values.length; i++){
    const v = values[i];
    if (isNum(v)){ sum += v; sumSq += v * v; }
    if (i >= n){ const o = values[i - n]; if (isNum(o)){ sum -= o; sumSq -= o * o; } }
    if (i < n - 1) continue;
    const m = sum / n, sd = Math.sqrt(Math.max(0, sumSq / n - m * m));
    if (!isNum(mid[i]) || !isNum(sd)) continue;
    upper[i] = mid[i] + k * sd; lower[i] = mid[i] - k * sd;
    width[i] = mid[i] ? (upper[i] - lower[i]) / mid[i] : null;
    pctB[i] = upper[i] !== lower[i] ? (values[i] - lower[i]) / (upper[i] - lower[i]) : 0.5;
  }
  return { mid, upper, lower, pctB, width };
}

export function trueRange(rows){
  return rows.map((r, i) => {
    if (i === 0) return r[2] - r[3];
    const pc = rows[i - 1][4];
    return Math.max(r[2] - r[3], Math.abs(r[2] - pc), Math.abs(r[3] - pc));
  });
}

export function atr(rows, n = 14){
  const tr = trueRange(rows);
  const out = new Array(rows.length).fill(null);
  let prev = null;
  for (let i = 0; i < tr.length; i++){
    if (i < n - 1) continue;
    if (i === n - 1){ prev = mean(tr.slice(0, n)); out[i] = prev; continue; }
    prev = (prev * (n - 1) + tr[i]) / n;
    out[i] = prev;
  }
  return out;
}

// חלון מקסימום/מינימום ב-O(n) (monotonic deque)
function rolling(values, n, cmp){
  const out = new Array(values.length).fill(null), dq = [];
  for (let i = 0; i < values.length; i++){
    while (dq.length && dq[0] <= i - n) dq.shift();
    while (dq.length && cmp(values[i], values[dq[dq.length - 1]])) dq.pop();
    dq.push(i);
    if (i >= n - 1) out[i] = values[dq[0]];
  }
  return out;
}
export function rollingMax(values, n){ return rolling(values, n, (a, b) => a >= b); }
export function rollingMin(values, n){ return rolling(values, n, (a, b) => a <= b); }

// תשואות יומיות לוגריתמיות/פשוטות
export function returns(values, log = false){
  const out = [];
  for (let i = 1; i < values.length; i++){
    if (!isNum(values[i]) || !isNum(values[i - 1]) || values[i - 1] === 0){ out.push(null); continue; }
    out.push(log ? Math.log(values[i] / values[i - 1]) : values[i] / values[i - 1] - 1);
  }
  return out;
}

export function annualizedVol(values, n = 252){
  const r = returns(values.slice(-(n + 1)));
  const s = std(r);
  return isNum(s) ? s * Math.sqrt(252) : null;
}

// Drawdown: מערך של ירידה מהשיא (שלילי), ומקסימום
export function drawdowns(values){
  let peak = -Infinity;
  const dd = values.map((v) => {
    if (!isNum(v)) return null;
    peak = Math.max(peak, v);
    return peak > 0 ? v / peak - 1 : 0;
  });
  let maxDD = 0, maxIdx = -1;
  dd.forEach((d, i) => { if (isNum(d) && d < maxDD){ maxDD = d; maxIdx = i; } });
  return { series: dd, maxDrawdown: maxDD, maxIdx };
}

// תמיכה/התנגדות פשוטות: נקודות pivot (שפל/שיא מקומי בחלון) ב-N ימים אחרונים, מקובצות
export function supportResistance(rows, lookback = 120, pivot = 5){
  const sub = rows.slice(-lookback);
  const sup = [], res = [];
  for (let i = pivot; i < sub.length - pivot; i++){
    const lo = sub[i][3], hi = sub[i][2];
    let isLow = true, isHigh = true;
    for (let j = i - pivot; j <= i + pivot; j++){
      if (j === i) continue;
      if (sub[j][3] <= lo) isLow = false;
      if (sub[j][2] >= hi) isHigh = false;
    }
    if (isLow) sup.push(lo);
    if (isHigh) res.push(hi);
  }
  const last = sub.length ? sub[sub.length - 1][4] : null;
  const cluster = (arr) => {
    const s = arr.slice().sort((a, b) => a - b);
    const out = [];
    for (const v of s){
      const c = out[out.length - 1];
      if (c && Math.abs(v - c.level) / c.level < 0.015){ c.level = (c.level * c.n + v) / (c.n + 1); c.n++; }
      else out.push({ level: v, n: 1 });
    }
    return out;
  };
  const supports = cluster(sup).filter((c) => isNum(last) && c.level < last).sort((a, b) => b.level - a.level);
  const resistances = cluster(res).filter((c) => isNum(last) && c.level > last).sort((a, b) => a.level - b.level);
  return {
    supports: supports.slice(0, 3).map((c) => ({ level: round(c.level, 2), touches: c.n })),
    resistances: resistances.slice(0, 3).map((c) => ({ level: round(c.level, 2), touches: c.n })),
  };
}

function crossWithin(a, b, i, days){
  // האם a חצה את b (מלמטה למעלה) ב-days הימים האחרונים עד i
  for (let k = Math.max(1, i - days + 1); k <= i; k++){
    if (isNum(a[k]) && isNum(b[k]) && isNum(a[k - 1]) && isNum(b[k - 1]) && a[k - 1] <= b[k - 1] && a[k] > b[k]) return k;
  }
  return -1;
}

// חבילת ניתוח טכני מלאה על הבר האחרון (ללא look-ahead: משתמש רק ב-rows שנמסרו)
export function technicalSnapshot(rows){
  if (!rows || rows.length < 30) return { missing: true, reason: 'פחות מ-30 ימי מסחר' };
  const c = closes(rows), v = volumes(rows);
  const i = rows.length - 1;
  const price = c[i];
  const s20 = sma(c, 20), s50 = sma(c, 50), s100 = sma(c, 100), s200 = sma(c, 200);
  const e20 = ema(c, 20), e50 = ema(c, 50);
  const r = rsi(c, 14);
  const m = macd(c);
  const bb = bollinger(c, 20, 2);
  const a = atr(rows, 14);
  const hi52 = rollingMax(highs(rows), Math.min(252, rows.length))[i];
  const lo52 = rollingMin(lows(rows), Math.min(252, rows.length))[i];
  const vol20 = sma(v, 20)[i];
  const relVol = isNum(vol20) && vol20 > 0 ? v[i] / vol20 : null;
  const sr = supportResistance(rows);
  const dd = drawdowns(c.slice(-252));
  const ret = (n) => (i - n >= 0 && isNum(c[i - n]) && c[i - n] ? price / c[i - n] - 1 : null);
  const mom = { r1m: ret(21), r3m: ret(63), r6m: ret(126), r12m: ret(252), r12_1: (i - 252 >= 0 && isNum(c[i - 21]) && isNum(c[i - 252]) && c[i - 252] ? c[i - 21] / c[i - 252] - 1 : null) };
  const vol1y = annualizedVol(c, 252), vol6m = annualizedVol(c, 126);
  const dailyChange = i > 0 && c[i - 1] ? price / c[i - 1] - 1 : null;

  // מגמה
  let trendScore = 0;
  if (isNum(s50[i]) && price > s50[i]) trendScore += 25;
  if (isNum(s100[i]) && price > s100[i]) trendScore += 25;
  if (isNum(s200[i]) && price > s200[i]) trendScore += 25;
  if (isNum(s50[i]) && isNum(s200[i]) && s50[i] > s200[i]) trendScore += 25;
  const trend = !isNum(s200[i]) ? 'לא ידוע' : trendScore >= 75 ? 'עולה' : trendScore >= 50 ? 'עולה-חלש' : trendScore >= 25 ? 'יורד-חלש' : 'יורד';

  // אירועים
  const events = [];
  const gc = crossWithin(s50, s200, i, 10);
  const dc = crossWithin(s200, s50, i, 10);
  if (gc >= 0) events.push({ id: 'golden_cross', label: 'Golden Cross', date: rows[gc][0], tone: 'pos' });
  if (dc >= 0) events.push({ id: 'death_cross', label: 'Death Cross', date: rows[dc][0], tone: 'neg' });
  if (isNum(r[i]) && r[i] > 70) events.push({ id: 'overbought', label: `Overbought (RSI ${round(r[i], 0)})`, tone: 'neg' });
  if (isNum(r[i]) && r[i] < 30) events.push({ id: 'oversold', label: `Oversold (RSI ${round(r[i], 0)})`, tone: 'mixed' });
  if (isNum(relVol) && relVol > 2 && isNum(dailyChange) && Math.abs(dailyChange) > 0.02) events.push({ id: 'volume_breakout', label: `Volume breakout (x${round(relVol, 1)})`, tone: dailyChange > 0 ? 'pos' : 'neg' });
  const res20 = rollingMax(highs(rows.slice(0, i)), 20)[i - 1];
  const sup20 = rollingMin(lows(rows.slice(0, i)), 20)[i - 1];
  const breakout = isNum(res20) && price > res20 && isNum(relVol) && relVol > 1.5;
  const breakdown = isNum(sup20) && price < sup20 && isNum(relVol) && relVol > 1.5;
  if (breakout) events.push({ id: 'breakout', label: 'פריצה מעל התנגדות 20 ימים במחזור גבוה', tone: 'pos' });
  if (breakdown) events.push({ id: 'breakdown', label: 'שבירת תמיכה 20 ימים במחזור גבוה', tone: 'neg' });
  const h = m.hist;
  if (i >= 5 && isNum(h[i]) && isNum(h[i - 5])){
    const slope = h[i] - h[i - 5];
    const priceCross50 = crossWithin(c, s50, i, 5) >= 0 || crossWithin(s50, c, i, 5) >= 0;
    if (priceCross50 && Math.sign(h[i]) !== Math.sign(h[i - 5]) && h[i] !== 0) events.push({ id: 'trend_reversal', label: 'היפוך מגמה אפשרי (חיתוך SMA50 + MACD)', tone: h[i] > 0 ? 'pos' : 'neg' });
    if (h[i] > 0 && slope > 0) events.push({ id: 'momentum_accel', label: 'מומנטום מתחזק', tone: 'pos' });
    if (h[i] > 0 && slope < 0) events.push({ id: 'momentum_decel', label: 'מומנטום נחלש', tone: 'neg' });
  }

  return {
    date: rows[i][0], price, dailyChange,
    sma: { s20: s20[i], s50: s50[i], s100: s100[i], s200: s200[i] },
    ema: { e20: e20[i], e50: e50[i] },
    rsi: r[i], macd: { line: m.line[i], signal: m.signal[i], hist: h[i] },
    bb: { upper: bb.upper[i], mid: bb.mid[i], lower: bb.lower[i], pctB: bb.pctB[i], width: bb.width[i] },
    atr: a[i], atrPct: isNum(a[i]) && price ? a[i] / price : null,
    volume: v[i], avgVolume20: vol20, relVol,
    high52: hi52, low52: lo52,
    distFromHigh52: isNum(hi52) && hi52 ? price / hi52 - 1 : null,
    distFromLow52: isNum(lo52) && lo52 ? price / lo52 - 1 : null,
    supports: sr.supports, resistances: sr.resistances,
    trend, trendScore, momentum: mom, vol1y, vol6m,
    maxDrawdown1y: dd.maxDrawdown, currentDrawdown: dd.series[dd.series.length - 1],
    breakout, breakdown, events,
    bars: rows.length,
  };
}

// סדרות מלאות לגרפים
export function indicatorSeries(rows){
  const c = closes(rows);
  return {
    dates: rows.map((r) => r[0]),
    close: c,
    sma20: sma(c, 20), sma50: sma(c, 50), sma200: sma(c, 200),
    rsi: rsi(c, 14), macd: macd(c), bb: bollinger(c, 20, 2),
    volume: volumes(rows),
  };
}
