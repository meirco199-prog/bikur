// מאפיינים (features) לכל סדרה — כולם אחוריים (causal): הערך ביום i תלוי רק בנרות ≤ i. NaN = אין מספיק היסטוריה/חסר.
// תשואות ואינדיקטורים מחושבים על הסגירה המתואמת (a) כדי לחצות פיצולים ודיבידנדים נכון; מסנני מחיר/מחזור על המחיר הגולמי (c, v).
// כל מאפיין: { params: ברירות מחדל, label: תיאור בעברית (לתצוגה "מה בדיוק ייבדק"), compute(series, params) → Float64Array }.
import { Series } from './data.js';

const NaNArr = (n) => new Float64Array(n).fill(NaN);
const ok = (x) => x === x; // לא NaN

export function rollingSum(a, n){ const out = NaNArr(a.length); let s = 0, bad = 0; for (let i = 0; i < a.length; i++){ if (ok(a[i])) s += a[i]; else bad++; if (i >= n){ if (ok(a[i - n])) s -= a[i - n]; else bad--; } if (i >= n - 1 && bad === 0) out[i] = s; } return out; }
export function rollingMean(a, n){ const s = rollingSum(a, n); for (let i = 0; i < s.length; i++) s[i] /= n; return s; }
export function rollingStd(a, n){ const out = NaNArr(a.length); for (let i = n - 1; i < a.length; i++){ let m = 0, c = 0; for (let j = i - n + 1; j <= i; j++){ if (!ok(a[j])){ c = -1; break; } m += a[j]; c++; } if (c !== n) continue; m /= n; let v = 0; for (let j = i - n + 1; j <= i; j++) v += (a[j] - m) ** 2; out[i] = Math.sqrt(v / (n - 1)); } return out; }
export function rollingMax(a, n){ const out = NaNArr(a.length), dq = []; for (let i = 0; i < a.length; i++){ while (dq.length && dq[0] <= i - n) dq.shift(); if (ok(a[i])){ while (dq.length && a[dq[dq.length - 1]] <= a[i]) dq.pop(); dq.push(i); } if (i >= n - 1 && dq.length) out[i] = a[dq[0]]; } return out; }
export function rollingMin(a, n){ const out = NaNArr(a.length), dq = []; for (let i = 0; i < a.length; i++){ while (dq.length && dq[0] <= i - n) dq.shift(); if (ok(a[i])){ while (dq.length && a[dq[dq.length - 1]] >= a[i]) dq.pop(); dq.push(i); } if (i >= n - 1 && dq.length) out[i] = a[dq[0]]; } return out; }
export function ema(a, n){ const out = NaNArr(a.length), k = 2 / (n + 1); let prev = NaN, seen = 0, seed = 0; for (let i = 0; i < a.length; i++){ if (!ok(a[i])) continue; if (seen < n){ seed += a[i]; seen++; if (seen === n){ prev = seed / n; out[i] = prev; } continue; } prev = a[i] * k + prev * (1 - k); out[i] = prev; } return out; }
export function wilder(a, n){ const out = NaNArr(a.length); let prev = NaN, seen = 0, seed = 0; for (let i = 0; i < a.length; i++){ if (!ok(a[i])) continue; if (seen < n){ seed += a[i]; seen++; if (seen === n){ prev = seed / n; out[i] = prev; } continue; } prev = (prev * (n - 1) + a[i]) / n; out[i] = prev; } return out; }
export function rsi(a, n = 14){ const g = NaNArr(a.length), l = NaNArr(a.length); for (let i = 1; i < a.length; i++){ if (!ok(a[i]) || !ok(a[i - 1])) continue; const d = a[i] - a[i - 1]; g[i] = Math.max(d, 0); l[i] = Math.max(-d, 0); } const ag = wilder(g, n), al = wilder(l, n), out = NaNArr(a.length); for (let i = 0; i < a.length; i++){ if (!ok(ag[i])) continue; out[i] = al[i] === 0 ? 100 : 100 - 100 / (1 + ag[i] / al[i]); } return out; }
export function trueRange(h, l, c){ const out = NaNArr(c.length); for (let i = 0; i < c.length; i++){ if (!ok(h[i]) || !ok(l[i])) continue; out[i] = i > 0 && ok(c[i - 1]) ? Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])) : h[i] - l[i]; } return out; }
export function adx(h, l, c, n = 14){
  const tr = trueRange(h, l, c), pdm = NaNArr(c.length), ndm = NaNArr(c.length);
  for (let i = 1; i < c.length; i++){ const up = h[i] - h[i - 1], dn = l[i - 1] - l[i]; pdm[i] = up > dn && up > 0 ? up : 0; ndm[i] = dn > up && dn > 0 ? dn : 0; }
  const atr_ = wilder(tr, n), pd = wilder(pdm, n), nd = wilder(ndm, n), dx = NaNArr(c.length);
  for (let i = 0; i < c.length; i++){ if (!ok(atr_[i]) || atr_[i] === 0) continue; const p = 100 * pd[i] / atr_[i], q = 100 * nd[i] / atr_[i]; dx[i] = p + q === 0 ? 0 : 100 * Math.abs(p - q) / (p + q); }
  return wilder(dx, n);
}

// רישום המאפיינים. label מקבל params ומחזיר תיאור בעברית.
export const FEATURES = {
  close: { params: {}, label: () => 'מחיר סגירה (גולמי)', compute: (s) => s.c },
  open: { params: {}, label: () => 'מחיר פתיחה (גולמי)', compute: (s) => s.o },
  volume: { params: {}, label: () => 'מחזור (מניות)', compute: (s) => s.v },
  dollar_vol: { params: { n: 20 }, label: (p) => `מחזור דולרי ממוצע ${p.n} ימים`, compute: (s, p) => { const dv = new Float64Array(s.n); for (let i = 0; i < s.n; i++) dv[i] = s.c[i] * (s.v[i] || 0); return rollingMean(dv, p.n); } },
  bars: { params: {}, label: () => 'מספר נרות היסטוריים זמינים', compute: (s) => Float64Array.from({ length: s.n }, (_, i) => i + 1) },
  ret: { params: { days: 1 }, label: (p) => `תשואה ${p.days} ימי מסחר (סגירה לסגירה)`, compute: (s, p) => { const out = NaNArr(s.n); for (let i = p.days; i < s.n; i++) if (s.a[i - p.days] > 0) out[i] = s.a[i] / s.a[i - p.days] - 1; return out; } },
  gap: { params: {}, label: () => 'פער פתיחה מול סגירה קודמת', compute: (s) => { const out = NaNArr(s.n); for (let i = 1; i < s.n; i++) if (s.c[i - 1] > 0) out[i] = s.o[i] * s.factor(i) / (s.c[i - 1] * s.factor(i - 1)) - 1; return out; } },
  intraday: { params: {}, label: () => 'שינוי תוך-יומי (סגירה מול פתיחה)', compute: (s) => { const out = NaNArr(s.n); for (let i = 0; i < s.n; i++) if (s.o[i] > 0) out[i] = s.c[i] / s.o[i] - 1; return out; } },
  streak: { params: {}, label: () => 'רצף ימים (חיובי = ימי עלייה רצופים, שלילי = ירידה)', compute: (s) => { const out = NaNArr(s.n); let st = 0; for (let i = 1; i < s.n; i++){ const d = s.a[i] - s.a[i - 1]; st = d > 0 ? (st > 0 ? st + 1 : 1) : d < 0 ? (st < 0 ? st - 1 : -1) : 0; out[i] = st; } return out; } },
  rsi: { params: { n: 14 }, label: (p) => `RSI ${p.n}`, compute: (s, p) => rsi(s.a, p.n) },
  sma: { params: { n: 50 }, label: (p) => `ממוצע נע ${p.n} (מתואם)`, compute: (s, p) => rollingMean(s.a, p.n) },
  ema: { params: { n: 20 }, label: (p) => `ממוצע נע מעריכי ${p.n}`, compute: (s, p) => ema(s.a, p.n) },
  price_vs_sma: { params: { n: 50 }, label: (p) => `מרחק המחיר מממוצע ${p.n} (אחוז)`, compute: (s, p) => { const m = rollingMean(s.a, p.n), out = NaNArr(s.n); for (let i = 0; i < s.n; i++) if (m[i] > 0) out[i] = s.a[i] / m[i] - 1; return out; } },
  sma_ratio: { params: { fast: 50, slow: 200 }, label: (p) => `ממוצע ${p.fast} מול ממוצע ${p.slow} (אחוז)`, compute: (s, p) => { const f = rollingMean(s.a, p.fast), g = rollingMean(s.a, p.slow), out = NaNArr(s.n); for (let i = 0; i < s.n; i++) if (g[i] > 0 && ok(f[i])) out[i] = f[i] / g[i] - 1; return out; } },
  macd_hist: { params: { fast: 12, slow: 26, signal: 9 }, label: (p) => `היסטוגרמת MACD (${p.fast},${p.slow},${p.signal}) באחוזים מהמחיר`, compute: (s, p) => { const f = ema(s.a, p.fast), g = ema(s.a, p.slow), line = NaNArr(s.n); for (let i = 0; i < s.n; i++) if (ok(f[i]) && ok(g[i])) line[i] = f[i] - g[i]; const sig = ema(line, p.signal), out = NaNArr(s.n); for (let i = 0; i < s.n; i++) if (ok(sig[i]) && s.a[i] > 0) out[i] = (line[i] - sig[i]) / s.a[i]; return out; } },
  bb_pctb: { params: { n: 20, k: 2 }, label: (p) => `%B בולינגר (${p.n}, ${p.k})`, compute: (s, p) => { const m = rollingMean(s.a, p.n), sd = rollingStd(s.a, p.n), out = NaNArr(s.n); for (let i = 0; i < s.n; i++) if (ok(sd[i]) && sd[i] > 0) out[i] = (s.a[i] - (m[i] - p.k * sd[i])) / (2 * p.k * sd[i]); return out; } },
  bb_width: { params: { n: 20, k: 2 }, label: (p) => `רוחב רצועות בולינגר (${p.n}, ${p.k}) באחוזים`, compute: (s, p) => { const m = rollingMean(s.a, p.n), sd = rollingStd(s.a, p.n), out = NaNArr(s.n); for (let i = 0; i < s.n; i++) if (ok(sd[i]) && m[i] > 0) out[i] = 2 * p.k * sd[i] / m[i]; return out; } },
  atr_pct: { params: { n: 14 }, label: (p) => `ATR ${p.n} באחוזים מהמחיר`, compute: (s, p) => { const { h, l } = s.adjOHL(), w = wilder(trueRange(h, l, s.a), p.n), out = NaNArr(s.n); for (let i = 0; i < s.n; i++) if (ok(w[i]) && s.a[i] > 0) out[i] = w[i] / s.a[i]; return out; } },
  adx: { params: { n: 14 }, label: (p) => `ADX ${p.n}`, compute: (s, p) => { const { h, l } = s.adjOHL(); return adx(h, l, s.a, p.n); } },
  vwap_dev: { params: { n: 20 }, label: (p) => `מרחק מ-VWAP ${p.n} ימים (אחוז)`, compute: (s, p) => { const pv = new Float64Array(s.n), vv = new Float64Array(s.n); for (let i = 0; i < s.n; i++){ const typ = (s.adjOHL().h[i] + s.adjOHL().l[i] + s.a[i]) / 3; pv[i] = typ * (s.v[i] || 0); vv[i] = s.v[i] || 0; } const a = rollingSum(pv, p.n), b = rollingSum(vv, p.n), out = NaNArr(s.n); for (let i = 0; i < s.n; i++) if (b[i] > 0) out[i] = s.a[i] / (a[i] / b[i]) - 1; return out; } },
  vol: { params: { n: 20 }, label: (p) => `תנודתיות שנתית ${p.n} ימים`, compute: (s, p) => { const r = NaNArr(s.n); for (let i = 1; i < s.n; i++) if (s.a[i - 1] > 0) r[i] = Math.log(s.a[i] / s.a[i - 1]); const sd = rollingStd(r, p.n); for (let i = 0; i < s.n; i++) sd[i] *= Math.sqrt(252); return sd; } },
  rel_vol: { params: { n: 20 }, label: (p) => `מחזור היום ביחס לממוצע ${p.n} ימים (לפני היום)`, compute: (s, p) => { const m = rollingMean(s.v, p.n), out = NaNArr(s.n); for (let i = 1; i < s.n; i++) if (m[i - 1] > 0) out[i] = s.v[i] / m[i - 1]; return out; } },
  dist_high: { params: { n: 252 }, label: (p) => `מרחק מהשיא של ${p.n} ימים (אחוז, שלילי = מתחת)`, compute: (s, p) => { const m = rollingMax(s.adjOHL().h, p.n), out = NaNArr(s.n); for (let i = 0; i < s.n; i++) if (m[i] > 0) out[i] = s.a[i] / m[i] - 1; return out; } },
  dist_low: { params: { n: 252 }, label: (p) => `מרחק מהשפל של ${p.n} ימים (אחוז)`, compute: (s, p) => { const m = rollingMin(s.adjOHL().l, p.n), out = NaNArr(s.n); for (let i = 0; i < s.n; i++) if (m[i] > 0) out[i] = s.a[i] / m[i] - 1; return out; } },
  new_high: { params: { n: 252 }, label: (p) => `סגירה מעל השיא של ${p.n} הימים הקודמים (1/0)`, compute: (s, p) => { const m = rollingMax(s.a, p.n), out = NaNArr(s.n); for (let i = 1; i < s.n; i++) if (ok(m[i - 1])) out[i] = s.a[i] > m[i - 1] ? 1 : 0; return out; } },
  new_low: { params: { n: 252 }, label: (p) => `סגירה מתחת לשפל של ${p.n} הימים הקודמים (1/0)`, compute: (s, p) => { const m = rollingMin(s.a, p.n), out = NaNArr(s.n); for (let i = 1; i < s.n; i++) if (ok(m[i - 1])) out[i] = s.a[i] < m[i - 1] ? 1 : 0; return out; } },
  drawdown: { params: { n: 252 }, label: (p) => `ירידה מהשיא של ${p.n} ימים (סגירות)`, compute: (s, p) => { const m = rollingMax(s.a, p.n), out = NaNArr(s.n); for (let i = 0; i < s.n; i++) if (m[i] > 0) out[i] = s.a[i] / m[i] - 1; return out; } },
  pullback: { params: { n: 20, from: 60 }, label: (p) => `תיקון: עלייה ב-${p.from} ימים לפני ${p.n} הימים האחרונים פחות הירידה ב-${p.n} האחרונים`, compute: (s, p) => { const out = NaNArr(s.n); for (let i = p.n + p.from; i < s.n; i++){ const up = s.a[i - p.n] / s.a[i - p.n - p.from] - 1, dn = s.a[i] / s.a[i - p.n] - 1; out[i] = up > 0 && dn < 0 ? up + dn : NaN; } return out; } },
  weekday: { params: {}, label: () => 'יום בשבוע (0=ראשון … 5=שישי)', compute: (s) => Float64Array.from(s.day, (d) => new Date(d * 86400000).getUTCDay()) },
  month: { params: {}, label: () => 'חודש (1–12)', compute: (s) => Float64Array.from(s.day, (d) => new Date(d * 86400000).getUTCMonth() + 1) },
  // פונדמנטלס — רק אם ל-Series יש meta.fund (point-in-time לפי תאריך הגשה). בלי נתונים → NaN (אין המצאות; התנאי לא מתקיים ומסומן "נתון חסר")
  market_cap: { params: {}, label: () => 'שווי שוק (point-in-time; דורש נתוני מניות בפועל לפי תאריך הגשה)', compute: (s) => fundamental(s, 'shares', (v, i) => v * s.c[i]), fundamental: true },
  pe: { params: {}, label: () => 'מכפיל רווח (point-in-time; EPS 12 חודשים לפי תאריך הגשה)', compute: (s) => fundamental(s, 'eps_ttm', (v, i) => (v > 0 ? s.c[i] / v : NaN)), fundamental: true },
  ps: { params: {}, label: () => 'מכפיל מכירות (point-in-time)', compute: (s) => fundamental(s, 'rev_ttm_ps', (v, i) => (v > 0 ? s.c[i] / v : NaN)), fundamental: true },
  rev_growth: { params: {}, label: () => 'צמיחת הכנסות שנתית (point-in-time)', compute: (s) => fundamental(s, 'rev_growth', (v) => v), fundamental: true },
};
// נתון פונדמנטלי point-in-time: s.meta.fund[key] = [[filedDay, value], …] — לכל יום i הערך האחרון שהוגש ≤ יום i
function fundamental(s, key, map){ const out = NaNArr(s.n), f = s.meta?.fund?.[key]; if (!f || !f.length) return out; let j = 0, cur = NaN; for (let i = 0; i < s.n; i++){ while (j < f.length && f[j][0] <= s.day[i]){ cur = f[j][1]; j++; } if (ok(cur)) out[i] = map(cur, i); } return out; }

// מפתח קנוני למאפיין+פרמטרים (לקאש ולהצגה)
export function featureKey(name, params = {}){ const def = FEATURES[name]; if (!def) throw new Error(`מאפיין לא מוכר: ${name}`); const p = { ...def.params, ...params }; const ks = Object.keys(def.params); return ks.length ? `${name}(${ks.map((k) => p[k]).join(',')})` : name; }
export function featureLabel(name, params = {}){ const def = FEATURES[name]; if (!def) return name; return def.label({ ...def.params, ...params }); }
export function featureParams(name, params = {}){ const def = FEATURES[name]; if (!def) throw new Error(`מאפיין לא מוכר: ${name}`); const p = { ...def.params }; for (const k of Object.keys(def.params)){ if (params[k] !== undefined){ const v = +params[k]; if (!Number.isFinite(v) || v <= 0) throw new Error(`פרמטר ${k} של ${name} חייב להיות מספר חיובי`); p[k] = v; } } return p; }

// קאש מאפיינים לכל סדרה: get(series, name, params) → Float64Array
export class FeatureCache {
  constructor(){ this.map = new Map(); }
  get(series, name, params = {}){
    const key = featureKey(name, params); let per = this.map.get(series.sym); if (!per){ per = new Map(); this.map.set(series.sym, per); }
    let arr = per.get(key); if (!arr){ arr = FEATURES[name].compute(series, featureParams(name, params)); per.set(key, arr); }
    return arr;
  }
  clear(){ this.map.clear(); }
}
export { Series };
