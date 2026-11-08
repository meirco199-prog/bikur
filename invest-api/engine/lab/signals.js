// מנוע האותות של המעבדה: כשירות סטטית ליום (חברות במדד point-in-time + מסננים), הקשר רוחבי (דירוגים/אחוזונים), חישוב האותות
// בסיום יום k מנתונים ≤ k בלבד. משותף לסימולטור (simulate.js) ולסורק ההיסטורי (scanAt) — אותו קוד, אותן תוצאות.
import { FeatureCache, FEATURES, featureKey, featureLabel } from './features.js';
import { compile } from './rules.js';
import { normalizeSpec } from './schema.js';
import { isoOf } from './data.js';

const keyCache = new Map();
export function parseKey(key){ let p = keyCache.get(key); if (!p){ const m = key.match(/^(\w+)(?:\((.*)\))?$/); const name = m[1]; const ks = Object.keys(FEATURES[name].params); const ps = {}; if (m[2]) m[2].split(',').forEach((v, i) => { ps[ks[i]] = +v; }); p = [name, ps]; keyCache.set(key, p); } return p; }
const PCT = new Set(['ret', 'gap', 'intraday', 'price_vs_sma', 'sma_ratio', 'dist_high', 'dist_low', 'drawdown', 'vol', 'atr_pct', 'vwap_dev', 'bb_width', 'pullback', 'macd_hist', 'rev_growth']);
export const fmtFeature = (f, v) => (v === null || v === undefined || v !== v ? '—' : PCT.has(f) ? `${(v * 100).toFixed(2)}%` : f === 'dollar_vol' ? `${(v / 1e6).toFixed(1)}M$` : f === 'market_cap' ? `${(v / 1e9).toFixed(1)}B$` : Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2));

export function createSignalEngine(ds, spec, fc = new FeatureCache(), pre = {}){
  const Z = spec.sizing, long = spec.signal.direction === 'long';
  const uni = pre.uni !== undefined ? pre.uni : (spec.universe.type === 'index' ? ds.universeById(spec.universe.index) : null);
  const cond = pre.cond !== undefined ? pre.cond : (spec.signal.conditions ? compile(spec.signal.conditions) : null);
  const rank = pre.rank !== undefined ? pre.rank : (spec.signal.rank ? { ...spec.signal.rank, key: featureKey(spec.signal.rank.feature, spec.signal.rank.params) } : null);
  const oppExit = pre.oppExit !== undefined ? pre.oppExit : spec.exit.rules.find((r) => r.type === 'opposite_signal');
  const volKey = featureKey('vol', { n: Z.volLookback }), capKey = 'market_cap';
  const F = spec.universe.filters, listSet = spec.universe.type === 'list' ? new Set(spec.universe.symbols) : null, excl = new Set(spec.universe.exclude), secIn = F.sectors.length ? new Set(F.sectors) : null, secOut = new Set(F.excludeSectors);
  const warnings = new Set(); let missing = 0; const opposite = new Set();

  function makeCtx(k, eligible){
    const vals = new Map(), sorted = new Map();
    const arr = (key) => { let m = vals.get(key); if (!m){ m = new Map(); vals.set(key, m); } return m; };
    const val = (sym, key) => { const m = arr(key); if (m.has(sym)) return m.get(sym); const i = ds.rowIndex(sym, k); let v = NaN; if (i >= 0){ const [name, ps] = parseKey(key); v = fc.get(ds.series.get(sym), name, ps)[i]; if (v === undefined) v = NaN; } m.set(sym, v); return v; };
    const prev = (sym, key) => { const i = ds.rowIndex(sym, k); if (i <= 0) return NaN; const [name, ps] = parseKey(key); const v = fc.get(ds.series.get(sym), name, ps)[i - 1]; return v === undefined ? NaN : v; };
    const sortedFor = (key) => { let s = sorted.get(key); if (!s){ const xs = []; for (const sym of eligible){ const v = val(sym, key); if (v === v) xs.push(v); } xs.sort((a, b) => a - b); s = xs; sorted.set(key, s); } return s; };
    const lowerBound = (xs, v) => { let lo = 0, hi = xs.length; while (lo < hi){ const m = (lo + hi) >> 1; if (xs[m] < v) lo = m + 1; else hi = m; } return lo; };
    const upperBound = (xs, v) => { let lo = 0, hi = xs.length; while (lo < hi){ const m = (lo + hi) >> 1; if (xs[m] <= v) lo = m + 1; else hi = m; } return lo; };
    return { k, missing: 0, val, prev, attr: (sym, field) => (field === 'sector' ? ds.sectorOf(sym) : field === 'symbol' ? sym : ds.series.get(sym)?.meta?.[field] ?? null),
      xsPct: (sym, key) => { const v = val(sym, key); if (v !== v) return NaN; const xs = sortedFor(key); if (xs.length < 2) return 50; return lowerBound(xs, v) / (xs.length - 1) * 100; },
      xsRank: (sym, key, desc) => { const v = val(sym, key); if (v !== v) return NaN; const xs = sortedFor(key); return desc ? xs.length - upperBound(xs, v) + 1 : lowerBound(xs, v) + 1; } };
  }
  // כשירות סטטית ליום k (חברות במדד point-in-time + מסנני מחיר/מחזור/היסטוריה/סקטור)
  function eligibleAt(k){
    const out = [];
    const cands = listSet ? [...listSet].filter((s) => ds.series.has(s)) : (uni ? ds.membersAt(k, uni) : ds.symbols);
    for (const sym of cands){
      if (excl.has(sym) || (spec.benchmarks.includes(sym) && !listSet)) continue;
      const i = ds.rowIndex(sym, k); if (i < 0) continue;
      const s = ds.series.get(sym); if (i + 1 < F.minBars) continue;
      const c = s.c[i]; if (!(c >= F.minPrice) || (F.maxPrice && c > F.maxPrice)) continue;
      if (F.minDollarVol > 0){ const dv = fc.get(s, 'dollar_vol', { n: 20 })[i]; if (!(dv >= F.minDollarVol)) continue; }
      if (secIn || secOut.size){ const sec = ds.sectorOf(sym); if (secIn && !secIn.has(sec)) continue; if (secOut.has(sec)) continue; }
      out.push(sym);
    }
    return out;
  }
  // אותות בסיום יום k → { picks:[{sym,value,rank,weight}], eligible, passed, ctx }
  function signalsAt(k){
    const eligible = eligibleAt(k), ctx = makeCtx(k, eligible);
    const passed = cond ? eligible.filter((s) => cond.test(ctx, s)) : eligible;
    missing += ctx.missing;
    let picks;
    opposite.clear();
    if (rank){
      const scored = []; for (const s of passed){ const v = ctx.val(s, rank.key); if (v === v) scored.push({ sym: s, value: v }); }
      scored.sort((a, b) => (rank.order === 'asc' ? a.value - b.value : b.value - a.value));
      picks = scored.slice(0, rank.top).map((x, i) => ({ ...x, rank: i + 1 }));
      if (oppExit) for (const x of scored.slice(-rank.top)) opposite.add(x.sym);
    } else {
      picks = passed.map((s) => ({ sym: s, value: null, rank: null }));
      if (Z.maxPositions && picks.length > Z.maxPositions) picks = picks.slice(0, Z.maxPositions);
      if (oppExit) for (const s of eligible) if (!cond.test(ctx, s)) opposite.add(s);
    }
    if (picks.length){
      if (Z.mode === 'inverse_vol' || Z.mode === 'rank' || Z.mode === 'market_cap'){
        const w = picks.map((p, i) => { if (Z.mode === 'rank') return picks.length - i; const v = ctx.val(p.sym, Z.mode === 'inverse_vol' ? volKey : capKey); if (Z.mode === 'inverse_vol') return v > 0 ? 1 / v : NaN; return v > 0 ? v : NaN; });
        if (w.some((x) => x !== x)) warnings.add(Z.mode === 'market_cap' ? 'אין נתוני שווי שוק point-in-time לחלק מהמניות — נעשה שימוש בחלוקה שווה עבורן' : 'אין מספיק היסטוריה לתנודתיות בחלק מהמניות — חלוקה שווה עבורן');
        const clean = w.map((x) => (x === x ? x : null)), good = clean.filter((x) => x !== null), avg = good.length ? good.reduce((a, b) => a + b, 0) / good.length : 1;
        const ww = clean.map((x) => (x === null ? avg : x)), sum = ww.reduce((a, b) => a + b, 0);
        picks.forEach((p, i) => { p.weight = sum > 0 ? ww[i] / sum * picks.length : 1; });
      } else picks.forEach((p) => { p.weight = 1; });
    }
    return { picks, eligible: eligible.length, passed: passed.length, ctx, eligibleList: eligible, passedList: passed };
  }
  return { uni, cond, rank, listSet, makeCtx, eligibleAt, signalsAt, opposite, warnings: [...warnings], get warningsLive(){ return [...warnings]; }, missing: () => missing };
}

// סורק היסטורי (דרישה: "סורק מניות היסטורי"): מה היו האותות בסיום יום נתון, עם ערכי המאפיינים לכל מועמדת
export function scanAt(ds, specInput, dateIso, { fc = new FeatureCache(), limit = 200 } = {}){
  const spec = normalizeSpec(specInput);
  const day = Math.round(Date.UTC(+dateIso.slice(0, 4), +dateIso.slice(5, 7) - 1, +dateIso.slice(8, 10)) / 86400000);
  const k = ds.kOnOrBefore(day); if (k < 0 || k >= ds.n) return { error: 'התאריך מחוץ לטווח הנתונים' };
  const eng = createSignalEngine(ds, spec, fc);
  if (spec.universe.type === 'index' && !eng.uni && Object.keys(ds.universes).length) return { error: `אין הרכב היסטורי של "${spec.universe.index}" בנתונים`, blocked: true };
  const sig = eng.signalsAt(k);
  const feats = new Map(); if (eng.cond) for (const [key, f] of eng.cond.features) feats.set(key, f); if (eng.rank) feats.set(eng.rank.key, { name: eng.rank.feature, params: eng.rank.params });
  const cols = [...feats.entries()].map(([key, f]) => ({ key, label: featureLabel(f.name, f.params), name: f.name }));
  const row = (sym, extra = {}) => { const bar = ds.bar(sym, k); return { symbol: sym, name: ds.series.get(sym)?.meta?.name || null, sector: ds.sectorOf(sym), close: bar ? bar.c : null, values: Object.fromEntries(cols.map((c) => [c.key, sig.ctx.val(sym, c.key)])), ...extra }; };
  const pickSet = new Set(sig.picks.map((p) => p.sym));
  const picks = sig.picks.map((p) => row(p.sym, { rank: p.rank, rankValue: p.value, weight: p.weight }));
  const passedNotPicked = sig.passedList.filter((s) => !pickSet.has(s)).slice(0, limit).map((s) => row(s));
  // מה קרה אחר כך (לבדיקה ידנית): פתיחה למחרת וסגירה למחרת
  const next = k + 1 < ds.n ? k + 1 : null;
  for (const p of picks){ const b = next !== null ? ds.bar(p.symbol, next) : null; p.nextOpen = b ? b.o : null; p.nextClose = b ? b.c : null; p.nextDate = next !== null ? ds.isoAt(next) : null; }
  return { date: ds.isoAt(k), requested: dateIso, eligible: sig.eligible, passed: sig.passed, columns: cols, picks, passedNotPicked, missingFeatureHits: eng.missing(), universe: eng.uni ? { id: eng.uni.id || spec.universe.index, pointInTime: eng.uni.pointInTime !== false } : null, spec };
}
