// Web Worker של המעבדה: טוען את מערך הנתונים מענף lab-data (עם מטמון Cache API), מחזיק אותו בזיכרון, ומריץ את המנוע המשותף
// (invest-api/engine/lab) — simulate / optimize / walk-forward / scan. ה-UI רק מצייר. ביטול = terminate של ה-Worker מהצד הראשי.
import { buildDataset, mergeCompact, isoOf, dayNum } from '../../../invest-api/engine/lab/data.js';
import { simulate } from '../../../invest-api/engine/lab/simulate.js';
import { analyze } from '../../../invest-api/engine/lab/metrics.js';
import { optimize, walkForward, monteCarlo, significance, periodBreakdown } from '../../../invest-api/engine/lab/optimize.js';
import { scanAt } from '../../../invest-api/engine/lab/signals.js';
import { normalizeSpec } from '../../../invest-api/engine/lab/schema.js';
import { FeatureCache } from '../../../invest-api/engine/lab/features.js';

const state = { base: null, manifest: null, universes: {}, shards: new Map(), ds: null, dsKey: null, fc: new FeatureCache() };
const post = (id, type, data) => self.postMessage({ id, type, ...data });
let cacheP = null;
async function cacheOpen(){ if (cacheP === null) cacheP = ('caches' in self ? caches.open('invest-lab-data-v1').catch(() => null) : Promise.resolve(null)); return cacheP; }
async function fetchJson(path, { cacheable = true } = {}){
  const url = state.base + path + (cacheable ? '' : `?t=${Date.now()}`);
  const c = cacheable ? await cacheOpen() : null;
  if (c){ const hit = await c.match(url); if (hit){ const j = await hit.json(); if (!state.manifest || !j || j._builtAt === undefined || j._builtAt === state.manifest.builtAt) return j; } }
  let r; for (let k = 0; k < 4; k++){ r = await fetch(url, { cache: cacheable ? 'default' : 'no-store' }); if (r.status === 429 || r.status >= 500){ await new Promise((res) => setTimeout(res, 1500 * (k + 1))); continue; } break; }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status} עבור ${path}`);
  const j = await r.json();
  if (c && state.manifest && path.startsWith('bars/')){ try { await c.put(url, new Response(JSON.stringify({ ...j, _builtAt: state.manifest.builtAt }), { headers: { 'Content-Type': 'application/json' } })); } catch {} }
  return j;
}
async function loadManifest(base, force = false){
  if (state.base !== base || force){ state.base = base.endsWith('/') ? base : base + '/'; state.manifest = null; state.universes = {}; state.shards.clear(); state.ds = null; state.dsKey = null; state.fc = new FeatureCache(); }
  if (!state.manifest){
    const m = await fetchJson('manifest.json', { cacheable: false }); if (!m) throw new Error('manifest.json לא נמצא — מערך הנתונים עדיין לא נבנה (הרץ את ה-workflow "Invest lab data") או שהכתובת שגויה');
    state.manifest = m;
    for (const id of Object.keys(m.universes || {})){ const u = await fetchJson(`universe/${id}.json`, { cacheable: false }); if (u) state.universes[id] = u; }
    // ניקוי מטמון ישן של shards מגרסה קודמת של הנתונים
    const c = await cacheOpen(); if (c){ for (const req of await c.keys()){ try { const r = await c.match(req); const j = await r.json(); if (j && j._builtAt && j._builtAt !== m.builtAt) await c.delete(req); } catch {} } }
  }
  return state.manifest;
}
const decadeOf = (y) => Math.floor(y / 10) * 10;
// איזה סימבולים ועשורים דרושים לבדיקה
function plan(spec, from, to){
  const m = state.manifest, syms = new Set(spec.benchmarks || []); if (spec.period?.regimeSymbol) syms.add(spec.period.regimeSymbol);
  const fromDay = dayNum(from), toDay = dayNum(to);
  if (spec.universe.type === 'list') spec.universe.symbols.forEach((s) => syms.add(s));
  else { const u = state.universes[spec.universe.index]; if (u) for (const [s, iv] of Object.entries(u.members)) if (u.pointInTime === false || iv.some(([a, b]) => a <= toDay && (b === null || b >= fromDay - 400))) syms.add(s); }
  const y0 = +from.slice(0, 4) - 2, y1 = +to.slice(0, 4);
  const files = [];
  for (const s of syms){ const ms = m.symbols[s]; if (!ms) continue; for (const d of ms.decades) if (d + 9 >= y0 && d <= y1) files.push({ s, d, key: `${s}.${d}` }); }
  return { symbols: [...syms].filter((s) => m.symbols[s]), files, missing: [...syms].filter((s) => !m.symbols[s]) };
}
async function ensureDataset(spec, id){
  const m = state.manifest; if (!m) throw new Error('טען קודם את מערך הנתונים');
  const from = spec.period.from || m.from, to = spec.period.to || new Date().toISOString().slice(0, 10);
  const p = plan(spec, from, to);
  const key = JSON.stringify([from, to, spec.universe.type, spec.universe.index, p.symbols.length, (spec.benchmarks || []).join()]);
  if (state.ds && state.dsKey === key) return { ds: state.ds, loaded: 0, from, to, missing: p.missing };
  const need = p.files.filter((f) => !state.shards.has(f.key));
  let done = 0; const t0 = Date.now(); let throttled = 0;
  post(id, 'progress', { value: 0, label: `טוען נתונים: ${need.length} קבצים ל-${p.symbols.length} ניירות`, detail: '' });
  const queue = need.slice();
  const worker = async () => { for (let f; (f = queue.shift());){ try { const j = await fetchJson(`bars/${f.s}.${f.d}.json`); state.shards.set(f.key, j || null); } catch (e) { throttled++; state.shards.set(f.key, null); } done++; if (done % 20 === 0 || done === need.length) post(id, 'progress', { value: done / Math.max(1, need.length) * 0.9, label: `טוען נתונים ${done}/${need.length}`, detail: `${((Date.now() - t0) / 1000).toFixed(0)} שניות${throttled ? ` · ${throttled} שגיאות הורדה` : ''}` }); } };
  await Promise.all(Array.from({ length: 12 }, worker));
  post(id, 'progress', { value: 0.92, label: 'בונה מערך נתונים…', detail: '' });
  const series = [];
  for (const s of p.symbols){ const parts = m.symbols[s].decades.filter((d) => p.files.some((f) => f.s === s && f.d === d)).map((d) => state.shards.get(`${s}.${d}`)).filter(Boolean); const c = mergeCompact(parts); if (c && c.d.length) series.push(c); }
  const universes = {}; for (const [k, u] of Object.entries(state.universes)) universes[k] = u;
  state.ds = buildDataset({ manifest: m, series, universes, universe: universes[spec.universe.index] || Object.values(universes)[0] || null, sectors: m.sectors, from, to, calendarFrom: series.some((x) => x.s === 'SPY') ? 'SPY' : null });
  state.dsKey = key; state.fc = new FeatureCache();
  return { ds: state.ds, loaded: need.length, from, to, missing: p.missing };
}
const strip = (res) => ({ ...res, signals: res.signals.slice(-400) });
const tasks = {
  async manifest({ base, force }){ const m = await loadManifest(base, force); let coverage = null, results = null; try { coverage = await fetchJson('coverage.json', { cacheable: false }); } catch {} try { results = await fetchJson('results/index.json', { cacheable: false }); } catch {} return { manifest: { ...m, symbols: undefined, sectors: undefined, symbolCount: Object.keys(m.symbols).length, symbolsSample: Object.keys(m.symbols).slice(0, 12), sectors: [...new Set(Object.values(m.sectors || {}))].filter(Boolean).sort(), symbolList: Object.entries(m.symbols).map(([s, v]) => ({ s, from: v.from, to: v.to, n: v.n, name: v.name, sector: v.sector, delisted: v.delisted })) }, universes: Object.fromEntries(Object.entries(state.universes).map(([k, u]) => [k, { id: k, pointInTime: u.pointInTime !== false, source: u.source, from: u.from ? isoOf(u.from) : null, to: u.to ? isoOf(u.to) : null, members: Object.keys(u.members).length, notes: u.notes || [] }])), coverage, results }; },
  async result({ base, file }){ await loadManifest(base); return await fetchJson(`results/${file}`, { cacheable: false }); },
  async run({ base, spec: specIn, extras = true }, id){
    await loadManifest(base); const spec = normalizeSpec(specIn);
    const { ds, missing } = await ensureDataset(spec, id);
    post(id, 'progress', { value: 0.93, label: 'מריץ סימולציה…', detail: `${ds.series.size} ניירות · ${ds.n} ימי מסחר` });
    const res = simulate(ds, spec, { cache: state.fc, onProgress: (p) => post(id, 'progress', { value: 0.93 + p * 0.06, label: 'מריץ סימולציה…', detail: `${Math.round(p * 100)}%` }) });
    if (res.error) return { error: res.error, blocked: !!res.blocked, coverage: res.coverage || null };
    const analysis = analyze(res);
    const out = { spec, result: strip(res), analysis, missingSymbols: missing };
    if (extras){ out.periods = periodBreakdown(res, res.benchmarks?.SPY || null); out.significance = significance(res); out.mc = monteCarlo(res.trades, { capital: res.capital }); }
    return out;
  },
  async optimize({ base, spec: specIn, params, objective, split, topK }, id){
    await loadManifest(base); const spec = normalizeSpec(specIn);
    const { ds } = await ensureDataset(spec, id);
    const o = optimize(ds, spec, { params, objective, split, topK, onProgress: ({ phase, frac }) => post(id, 'progress', { value: 0.93 + frac * 0.06, label: `אופטימיזציה — ${{ train: 'אימון', val: 'אימות' }[phase] || phase}`, detail: `${Math.round(frac * 100)}%` }) });
    if (o.test?.result) o.test.result = strip(o.test.result);
    return o;
  },
  async walk({ base, spec: specIn, params, objective, isYears, oosYears }, id){
    await loadManifest(base); const spec = normalizeSpec(specIn);
    const { ds } = await ensureDataset(spec, id);
    return walkForward(ds, spec, params, { objective, isYears, oosYears, onProgress: (p) => post(id, 'progress', { value: 0.93 + p * 0.06, label: 'Walk-Forward…', detail: `${Math.round(p * 100)}%` }) });
  },
  async scan({ base, spec: specIn, date }, id){
    await loadManifest(base); const spec = normalizeSpec(specIn);
    const { ds } = await ensureDataset(spec, id);
    return scanAt(ds, spec, date, { fc: state.fc });
  },
  async series({ base, symbol, from, to }){ await loadManifest(base); const m = state.manifest.symbols[symbol]; if (!m) return null; const y0 = +from.slice(0, 4), y1 = +to.slice(0, 4); const parts = []; for (const d of m.decades){ if (d + 9 < y0 || d > y1) continue; if (!state.shards.has(`${symbol}.${d}`)) state.shards.set(`${symbol}.${d}`, await fetchJson(`bars/${symbol}.${d}.json`)); parts.push(state.shards.get(`${symbol}.${d}`)); } const c = mergeCompact(parts.filter(Boolean)); if (!c) return null; const a = dayNum(from) - 1, b = dayNum(to) + 1; const idx = c.d.map((d, i) => (d >= a && d <= b ? i : -1)).filter((i) => i >= 0); return { s: symbol, dates: idx.map((i) => isoOf(c.d[i])), o: idx.map((i) => c.o[i]), h: idx.map((i) => c.h[i]), l: idx.map((i) => c.l[i]), c: idx.map((i) => c.c[i]), v: idx.map((i) => c.v[i]), meta: c.meta }; },
};
self.onmessage = async (e) => {
  const { id, type, payload } = e.data;
  try { const fn = tasks[type]; if (!fn) throw new Error('משימה לא מוכרת: ' + type); const result = await fn(payload || {}, id); post(id, 'result', { result }); }
  catch (err) { post(id, 'error', { error: err?.message || String(err) }); }
};
