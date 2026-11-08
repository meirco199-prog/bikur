// עץ תנאים (AND/OR/NOT מקוננים) על מאפיינים — "בונה האסטרטגיות בלי קוד" (דרישה 3).
// צומת: { all:[…] } | { any:[…] } | { not: צומת } | עלה.
// עלה: { feature, params?, op, value } — value: מספר | [a,b] ל-between | { feature, params?, mult? } להשוואה למאפיין אחר (למשל מחזור > 2× ממוצע)
//       או { field:'sector'|'symbol'|'exchange', op:'in'|'not_in', value:[…] } לתכונות סטטיות.
// אופרטורים: < <= > >= == != between cross_above cross_below (מול ערך/מאפיין, לפי היום הקודם) · top_pct bottom_pct top_n bottom_n (רוחבי — בתוך היקום של אותו יום).
// NaN (אין מספיק היסטוריה / נתון חסר) → התנאי לא מתקיים, ונספר ב-ctx.missing כדי שהדוח יציג "נתונים חסרים" ולא ימציא.
import { FEATURES, featureKey, featureLabel, featureParams } from './features.js';

const OPS = new Set(['<', '<=', '>', '>=', '==', '!=', 'between', 'cross_above', 'cross_below', 'top_pct', 'bottom_pct', 'top_n', 'bottom_n', 'in', 'not_in']);
const XS = new Set(['top_pct', 'bottom_pct', 'top_n', 'bottom_n']);
const FIELDS = new Set(['sector', 'symbol', 'exchange', 'country']);

// אימות מבני + נרמול (זורק שגיאה בעברית)
export function normalizeNode(node, path = 'conditions'){
  if (!node || typeof node !== 'object') throw new Error(`${path}: תנאי חסר`);
  if (Array.isArray(node)) return { all: node.map((n, i) => normalizeNode(n, `${path}[${i}]`)) };
  if (node.all) return { all: node.all.map((n, i) => normalizeNode(n, `${path}.all[${i}]`)) };
  if (node.any) return { any: node.any.map((n, i) => normalizeNode(n, `${path}.any[${i}]`)) };
  if (node.not) return { not: normalizeNode(node.not, `${path}.not`) };
  if (!OPS.has(node.op)) throw new Error(`${path}: אופרטור לא מוכר "${node.op}"`);
  if (node.field){
    if (!FIELDS.has(node.field)) throw new Error(`${path}: שדה לא מוכר "${node.field}"`);
    if (!['in', 'not_in'].includes(node.op) || !Array.isArray(node.value)) throw new Error(`${path}: שדה ${node.field} דורש op in/not_in ורשימה`);
    return { field: node.field, op: node.op, value: node.value.map(String) };
  }
  if (!FEATURES[node.feature]) throw new Error(`${path}: מאפיין לא מוכר "${node.feature}"`);
  const out = { feature: node.feature, params: featureParams(node.feature, node.params || {}), op: node.op };
  if (node.op === 'between'){ if (!Array.isArray(node.value) || node.value.length !== 2 || node.value.some((x) => !Number.isFinite(+x))) throw new Error(`${path}: between דורש [מינימום, מקסימום]`); out.value = [+node.value[0], +node.value[1]].sort((a, b) => a - b); }
  else if (XS.has(node.op)){ const v = +node.value; if (!Number.isFinite(v) || v <= 0) throw new Error(`${path}: ${node.op} דורש מספר חיובי`); if (node.op.endsWith('pct') && v > 100) throw new Error(`${path}: אחוז עד 100`); out.value = v; }
  else if (['in', 'not_in'].includes(node.op)){ if (!Array.isArray(node.value)) throw new Error(`${path}: in דורש רשימה`); out.value = node.value.map(Number); }
  else if (node.value && typeof node.value === 'object'){ if (!FEATURES[node.value.feature]) throw new Error(`${path}: מאפיין להשוואה לא מוכר "${node.value.feature}"`); out.value = { feature: node.value.feature, params: featureParams(node.value.feature, node.value.params || {}), mult: node.value.mult !== undefined ? +node.value.mult : 1, add: node.value.add !== undefined ? +node.value.add : 0 }; }
  else { const v = +node.value; if (!Number.isFinite(v)) throw new Error(`${path}: ערך להשוואה חסר`); out.value = v; }
  return out;
}

// רשימת המאפיינים שהעץ צורך (כולל לצד ימין)
export function collectFeatures(node, out = new Map()){
  if (!node) return out;
  if (node.all) node.all.forEach((n) => collectFeatures(n, out)); else if (node.any) node.any.forEach((n) => collectFeatures(n, out)); else if (node.not) collectFeatures(node.not, out);
  else if (node.feature){ out.set(featureKey(node.feature, node.params), { name: node.feature, params: node.params }); if (node.value && typeof node.value === 'object' && node.value.feature) out.set(featureKey(node.value.feature, node.value.params), { name: node.value.feature, params: node.value.params }); }
  return out;
}

// הידור: מחזיר פונקציה test(ctx, sym) → true/false. ctx: { val(sym,key), prev(sym,key), xsPct(sym,key), xsRank(sym,key,desc), attr(sym,field), missing }
export function compile(node){
  const n = normalizeNode(node);
  const build = (nd) => {
    if (nd.all){ const fs = nd.all.map(build); return (ctx, s) => { for (const f of fs) if (!f(ctx, s)) return false; return true; }; }
    if (nd.any){ const fs = nd.any.map(build); return (ctx, s) => { for (const f of fs) if (f(ctx, s)) return true; return false; }; }
    if (nd.not){ const f = build(nd.not); return (ctx, s) => !f(ctx, s); }
    if (nd.field){ const set = new Set(nd.value); const inOp = nd.op === 'in'; return (ctx, s) => { const a = ctx.attr(s, nd.field); const has = a !== null && a !== undefined && set.has(String(a)); return inOp ? has : !has; }; }
    const key = featureKey(nd.feature, nd.params);
    const rhs = typeof nd.value === 'object' && !Array.isArray(nd.value) ? (() => { const k2 = featureKey(nd.value.feature, nd.value.params), m = nd.value.mult, a = nd.value.add; return (ctx, s, prev) => { const v = prev ? ctx.prev(s, k2) : ctx.val(s, k2); return v === v ? v * m + a : NaN; }; })() : null;
    const miss = (ctx) => { ctx.missing++; return false; };
    switch (nd.op){
      case 'between': return (ctx, s) => { const v = ctx.val(s, key); if (v !== v) return miss(ctx); return v >= nd.value[0] && v <= nd.value[1]; };
      case 'in': { const set = new Set(nd.value); return (ctx, s) => { const v = ctx.val(s, key); if (v !== v) return miss(ctx); return set.has(v); }; }
      case 'not_in': { const set = new Set(nd.value); return (ctx, s) => { const v = ctx.val(s, key); if (v !== v) return miss(ctx); return !set.has(v); }; }
      case 'top_pct': return (ctx, s) => { const p = ctx.xsPct(s, key); if (p !== p) return miss(ctx); return p >= 100 - nd.value; };
      case 'bottom_pct': return (ctx, s) => { const p = ctx.xsPct(s, key); if (p !== p) return miss(ctx); return p <= nd.value; };
      case 'top_n': return (ctx, s) => { const r = ctx.xsRank(s, key, true); if (r !== r) return miss(ctx); return r <= nd.value; };
      case 'bottom_n': return (ctx, s) => { const r = ctx.xsRank(s, key, false); if (r !== r) return miss(ctx); return r <= nd.value; };
      case 'cross_above': case 'cross_below': {
        const up = nd.op === 'cross_above';
        return (ctx, s) => { const v = ctx.val(s, key), pv = ctx.prev(s, key), t = rhs ? rhs(ctx, s, false) : nd.value, pt = rhs ? rhs(ctx, s, true) : nd.value; if (v !== v || pv !== pv || t !== t || pt !== pt) return miss(ctx); return up ? pv <= pt && v > t : pv >= pt && v < t; };
      }
      default: {
        const cmp = { '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b, '==': (a, b) => Math.abs(a - b) < 1e-12, '!=': (a, b) => Math.abs(a - b) >= 1e-12 }[nd.op];
        return (ctx, s) => { const v = ctx.val(s, key); const t = rhs ? rhs(ctx, s, false) : nd.value; if (v !== v || t !== t) return miss(ctx); return cmp(v, t); };
      }
    }
  };
  return { test: build(n), node: n, features: collectFeatures(n) };
}

// תיאור בעברית של עץ התנאים — מוצג למשתמש לפני ההרצה ("אילו תנאים יופעלו", דרישה 12)
const OP_HE = { '<': 'קטן מ-', '<=': 'קטן או שווה ל-', '>': 'גדול מ-', '>=': 'גדול או שווה ל-', '==': 'שווה ל-', '!=': 'שונה מ-' };
const PCT_FEATURES = new Set(['ret', 'gap', 'intraday', 'price_vs_sma', 'sma_ratio', 'macd_hist', 'bb_width', 'atr_pct', 'vwap_dev', 'vol', 'dist_high', 'dist_low', 'drawdown', 'pullback', 'rev_growth']);
const neg = (s) => s.replace(/^-/, '−');
export const fmtVal = (feature, v) => neg(PCT_FEATURES.has(feature) ? `${(v * 100).toFixed(Math.abs(v) < 0.01 ? 2 : 1)}%` : feature === 'dollar_vol' ? `${(v / 1e6).toFixed(0)}M$` : feature === 'market_cap' ? `${(v / 1e9).toFixed(1)}B$` : Number.isInteger(v) ? String(v) : v.toFixed(2));
export function describe(node, depth = 0){
  const n = normalizeNode(node), pad = '  '.repeat(depth);
  if (n.all) return n.all.length === 1 ? describe(n.all[0], depth) : `${pad}כל התנאים הבאים (AND):\n` + n.all.map((x) => describe(x, depth + 1)).join('\n');
  if (n.any) return `${pad}לפחות אחד מהתנאים (OR):\n` + n.any.map((x) => describe(x, depth + 1)).join('\n');
  if (n.not) return `${pad}לא (NOT):\n` + describe(n.not, depth + 1);
  if (n.field) return `${pad}• ${{ sector: 'סקטור', symbol: 'סימבול', exchange: 'בורסה', country: 'מדינה' }[n.field]} ${n.op === 'in' ? 'מתוך' : 'לא מתוך'}: ${n.value.join(', ')}`;
  const L = featureLabel(n.feature, n.params);
  if (n.op === 'between') return `${pad}• ${L} בין ${fmtVal(n.feature, n.value[0])} ל-${fmtVal(n.feature, n.value[1])}`;
  if (n.op === 'top_pct') return `${pad}• ${L} ב-${n.value}% העליונים של היקום באותו יום`;
  if (n.op === 'bottom_pct') return `${pad}• ${L} ב-${n.value}% התחתונים של היקום באותו יום`;
  if (n.op === 'top_n') return `${pad}• ${L} בין ${n.value} הגבוהים ביקום באותו יום`;
  if (n.op === 'bottom_n') return `${pad}• ${L} בין ${n.value} הנמוכים ביקום באותו יום`;
  if (n.op === 'in') return `${pad}• ${L} מתוך: ${n.value.join(', ')}`;
  if (n.op === 'not_in') return `${pad}• ${L} לא מתוך: ${n.value.join(', ')}`;
  const rhs = typeof n.value === 'object' ? `${n.value.mult !== 1 ? `${n.value.mult}× ` : ''}${featureLabel(n.value.feature, n.value.params)}${n.value.add ? ` + ${n.value.add}` : ''}` : fmtVal(n.feature, n.value);
  if (n.op === 'cross_above') return `${pad}• ${L} חוצה כלפי מעלה את ${rhs}`;
  if (n.op === 'cross_below') return `${pad}• ${L} חוצה כלפי מטה את ${rhs}`;
  return `${pad}• ${L} ${OP_HE[n.op]}${rhs}`;
}
