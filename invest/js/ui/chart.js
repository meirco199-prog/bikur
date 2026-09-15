// גרפים SVG אינטראקטיביים ללא ספריות: קו/שטח, נרות, פאנלים (RSI/MACD), עמודות, דונאט, השוואת עקומות.
import { el, esc, fmt, isNum } from '../core/util.js';

const NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, v); return e; };
const COLORS = ['#4f8cff', '#2fbf71', '#f5a524', '#a78bfa', '#e5484d', '#38bdf8', '#f472b6', '#84cc16'];
export const chartColors = COLORS;

function scale(domain, range){ const [d0, d1] = domain, [r0, r1] = range; const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0); return (x) => r0 + (x - d0) * k; }
function niceTicks(lo, hi, n = 5){ if (!isFinite(lo) || !isFinite(hi) || lo === hi) return [lo]; const span = hi - lo; const step0 = span / n; const mag = Math.pow(10, Math.floor(Math.log10(step0))); const norm = step0 / mag; const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag; const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10)); return out; }
const fmtV = (v) => (Math.abs(v) >= 1e6 ? fmt.big(v) : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

/**
 * lineChart({ dates, series:[{name, values, color, area?, dashed?, axis:'left'|'right'? }], height, bands:[{from,to,color}], markers:[{i, label, color}], hlines:[{y,label,color}], yFmt, logScale })
 */
export function lineChart(opts){
  const { dates, series, height = 260, yFmt = fmtV, hlines = [], markers = [], bands = [], yDomain = null, logScale = false, xTicks = 6 } = opts;
  const box = el('<div class="chart-box"></div>');
  const W = 800, H = height, pad = { l: 8, r: 54, t: 10, b: 24 };
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', preserveAspectRatio: 'none' });
  svg.style.height = H + 'px';
  const n = dates.length;
  if (!n){ box.innerHTML = '<div class="empty">אין נתונים לגרף</div>'; return box; }
  const all = series.flatMap((s) => s.values.filter(isNum)).concat(hlines.map((h) => h.y).filter(isNum));
  let lo = yDomain ? yDomain[0] : Math.min(...all), hi = yDomain ? yDomain[1] : Math.max(...all);
  if (lo === hi){ lo -= 1; hi += 1; }
  const padY = (hi - lo) * 0.05; if (!yDomain){ lo -= padY; hi += padY; }
  const ty = logScale && lo > 0 ? (v) => Math.log(v) : (v) => v;
  const x = scale([0, n - 1], [pad.l, W - pad.r]);
  const y = scale([ty(lo), ty(hi)], [H - pad.b, pad.t]);
  // רקעים
  for (const b of bands){ const r = svgEl('rect', { x: x(b.from), y: pad.t, width: Math.max(1, x(b.to) - x(b.from)), height: H - pad.t - pad.b, fill: b.color, opacity: .12 }); svg.appendChild(r); }
  // גריד + ציר Y
  const g = svgEl('g', { class: 'grid' });
  for (const t of niceTicks(lo, hi, 5)){ const yy = y(ty(t)); g.appendChild(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy })); const tx = svgEl('text', { x: W - pad.r + 6, y: yy + 4 }); tx.textContent = yFmt(t); g.appendChild(tx); }
  svg.appendChild(g);
  // ציר X
  const step = Math.max(1, Math.floor(n / xTicks));
  for (let i = 0; i < n; i += step){ const tx = svgEl('text', { x: x(i), y: H - 6, 'text-anchor': 'middle' }); tx.textContent = dates[i].slice(0, n > 400 ? 7 : 10); svg.appendChild(tx); }
  // סדרות
  series.forEach((s, si) => {
    const color = s.color || COLORS[si % COLORS.length];
    let d = '', started = false, areaD = '';
    for (let i = 0; i < n; i++){ const v = s.values[i]; if (!isNum(v) || (logScale && v <= 0)){ started = false; continue; } const px = x(i), py = y(ty(v)); d += (started ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1); started = true; }
    if (s.area){ const first = s.values.findIndex(isNum), last = s.values.length - 1 - s.values.slice().reverse().findIndex(isNum); areaD = d + `L${x(last).toFixed(1)} ${H - pad.b}L${x(first).toFixed(1)} ${H - pad.b}Z`; svg.appendChild(svgEl('path', { d: areaD, fill: color, opacity: .12 })); }
    svg.appendChild(svgEl('path', { d, fill: 'none', stroke: color, 'stroke-width': s.width || 1.6, 'stroke-dasharray': s.dashed ? '4 3' : null, 'vector-effect': 'non-scaling-stroke' }));
  });
  for (const h of hlines){ if (!isNum(h.y)) continue; const yy = y(ty(h.y)); svg.appendChild(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, stroke: h.color || '#f5a524', 'stroke-dasharray': '5 4', 'vector-effect': 'non-scaling-stroke' })); const t = svgEl('text', { x: pad.l + 4, y: yy - 3, fill: h.color || '#f5a524' }); t.textContent = h.label || ''; t.style.fill = h.color || '#f5a524'; svg.appendChild(t); }
  for (const m of markers){ if (m.i < 0 || m.i >= n) continue; const px = x(m.i); svg.appendChild(svgEl('line', { x1: px, x2: px, y1: pad.t, y2: H - pad.b, stroke: m.color || '#a78bfa', 'stroke-dasharray': '2 3', 'vector-effect': 'non-scaling-stroke' })); const t = svgEl('text', { x: px + 3, y: pad.t + 10 }); t.textContent = m.label || ''; t.style.fill = m.color || '#a78bfa'; svg.appendChild(t); }
  // crosshair + tooltip
  const cross = svgEl('line', { class: 'crosshair', y1: pad.t, y2: H - pad.b, x1: -10, x2: -10, 'vector-effect': 'non-scaling-stroke' }); svg.appendChild(cross);
  const tip = el('<div class="chart-tip hidden"></div>');
  box.append(svg, tip);
  const legend = el(`<div class="legend">${series.map((s, i) => `<span><i style="background:${s.color || COLORS[i % COLORS.length]}"></i>${esc(s.name)}</span>`).join('')}</div>`);
  if (series.length > 1 || series[0]?.name) box.appendChild(legend);
  svg.addEventListener('mousemove', (e) => {
    const r = svg.getBoundingClientRect(); const rel = (e.clientX - r.left) / r.width * W;
    const i = Math.round(Math.max(0, Math.min(n - 1, (rel - pad.l) / (W - pad.r - pad.l) * (n - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
    tip.classList.remove('hidden');
    tip.innerHTML = `<b>${esc(dates[i])}</b><br>` + series.map((s, si) => `<span style="color:${s.color || COLORS[si % COLORS.length]}">${esc(s.name)}</span>: ${isNum(s.values[i]) ? (s.fmt || yFmt)(s.values[i]) : '—'}`).join('<br>');
    const left = (e.clientX - r.left); tip.style.left = Math.min(left + 12, r.width - 170) + 'px'; tip.style.top = Math.max(0, e.clientY - r.top - 40) + 'px';
    box.dispatchEvent(new CustomEvent('hover', { detail: { i } }));
  });
  svg.addEventListener('mouseleave', () => { tip.classList.add('hidden'); cross.setAttribute('x1', -10); cross.setAttribute('x2', -10); });
  return box;
}

export function barChart({ labels, values, height = 160, color, colors = null, yFmt = fmtV, horizontal = false }){
  const W = 800, H = height, pad = { l: 8, r: 50, t: 8, b: 26 };
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', preserveAspectRatio: 'none' }); svg.style.height = H + 'px';
  const n = values.length; if (!n) return el('<div class="empty">אין נתונים</div>');
  const lo = Math.min(0, ...values.filter(isNum)), hi = Math.max(0, ...values.filter(isNum));
  const y = scale([lo, hi || 1], [H - pad.b, pad.t]);
  const bw = (W - pad.l - pad.r) / n;
  for (const t of niceTicks(lo, hi || 1, 4)){ const yy = y(t); svg.appendChild(svgEl('line', { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, stroke: 'var(--line)' })); const tx = svgEl('text', { x: W - pad.r + 6, y: yy + 4 }); tx.textContent = yFmt(t); svg.appendChild(tx); }
  values.forEach((v, i) => { if (!isNum(v)) return; const c = colors ? colors[i] : color || (v >= 0 ? '#2fbf71' : '#e5484d'); svg.appendChild(svgEl('rect', { x: pad.l + i * bw + bw * 0.15, y: Math.min(y(v), y(0)), width: bw * 0.7, height: Math.max(1, Math.abs(y(v) - y(0))), fill: c, rx: 2 })); const t = svgEl('text', { x: pad.l + i * bw + bw / 2, y: H - 8, 'text-anchor': 'middle' }); t.textContent = String(labels[i]).slice(0, n > 12 ? 4 : 12); svg.appendChild(t); });
  const box = el('<div class="chart-box"></div>'); box.appendChild(svg);
  const tip = el('<div class="chart-tip hidden"></div>'); box.appendChild(tip);
  svg.addEventListener('mousemove', (e) => { const r = svg.getBoundingClientRect(); const i = Math.floor(((e.clientX - r.left) / r.width * W - pad.l) / bw); if (i < 0 || i >= n) return tip.classList.add('hidden'); tip.classList.remove('hidden'); tip.innerHTML = `<b>${esc(labels[i])}</b>: ${isNum(values[i]) ? yFmt(values[i]) : '—'}`; tip.style.left = (e.clientX - r.left + 10) + 'px'; tip.style.top = (e.clientY - r.top - 30) + 'px'; });
  svg.addEventListener('mouseleave', () => tip.classList.add('hidden'));
  return box;
}

export function donut({ items, size = 140 }){ // items: [{label, value, color?}]
  const total = items.reduce((s, x) => s + (x.value || 0), 0) || 1;
  const r = size / 2 - 8, cx = size / 2, cy = size / 2;
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size });
  let a0 = -Math.PI / 2;
  items.forEach((it, i) => {
    const a1 = a0 + (it.value / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const d = `M${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} L${cx + r * 0.55 * Math.cos(a1)} ${cy + r * 0.55 * Math.sin(a1)} A${r * 0.55} ${r * 0.55} 0 ${large} 0 ${cx + r * 0.55 * Math.cos(a0)} ${cy + r * 0.55 * Math.sin(a0)}Z`;
    const p = svgEl('path', { d, fill: it.color || COLORS[i % COLORS.length] }); p.appendChild(svgEl('title')).textContent = `${it.label}: ${fmt.pct(it.value / total, 1)}`; svg.appendChild(p);
    a0 = a1;
  });
  const box = el('<div class="donut"></div>'); box.appendChild(svg);
  box.appendChild(el(`<div class="legend" style="flex-direction:column;gap:.2rem">${items.map((it, i) => `<span><i style="background:${it.color || COLORS[i % COLORS.length]};width:10px;height:10px;border-radius:2px"></i>${esc(it.label)} <b class="num">${fmt.pct(it.value / total, 1)}</b></span>`).join('')}</div>`));
  return box;
}

// גרף מחיר מלא: מחיר+SMA+Bollinger, מחזור, RSI, MACD — עם רמות (entry/stop/target)
export function priceChart({ dates, close, sma20, sma50, sma200, bb, volume, rsi, macd, levels = null, range = 252 }){
  const from = Math.max(0, dates.length - range);
  const sl = (a) => (a ? a.slice(from) : null);
  const d = dates.slice(from);
  const wrap = el('<div class="stack"></div>');
  const hl = [];
  if (levels){ hl.push({ y: levels.stop, label: `Stop ${levels.stop}`, color: '#e5484d' }, { y: levels.invalidation, label: `ביטול ${levels.invalidation}`, color: '#f5a524' }, { y: levels.targets?.[0], label: `יעד ${levels.targets?.[0]}`, color: '#2fbf71' }, { y: levels.targets?.[1], label: `${levels.targets?.[1]}`, color: '#2fbf71' }); }
  const bands = levels?.entryZone ? [] : [];
  const main = lineChart({ dates: d, height: 300, series: [{ name: 'מחיר', values: sl(close), color: '#4f8cff', width: 1.8 }, sma20 && { name: 'SMA20', values: sl(sma20), color: '#f5a524', width: 1 }, sma50 && { name: 'SMA50', values: sl(sma50), color: '#2fbf71', width: 1 }, sma200 && { name: 'SMA200', values: sl(sma200), color: '#e5484d', width: 1.2 }, bb && { name: 'BB עליון', values: sl(bb.upper), color: '#a78bfa', dashed: true, width: .8 }, bb && { name: 'BB תחתון', values: sl(bb.lower), color: '#a78bfa', dashed: true, width: .8 }].filter(Boolean), hlines: hl, bands });
  wrap.appendChild(main);
  if (levels?.entryZone){ wrap.appendChild(el(`<div class="muted">אזור כניסה: <b class="num">${levels.entryZone[0]}–${levels.entryZone[1]}</b> · ביטול: <b class="num">${levels.invalidation}</b> · stop: <b class="num">${levels.stop}</b> · יעד: <b class="num">${levels.targets?.[0]}–${levels.targets?.[1]}</b></div>`)); }
  if (volume) wrap.appendChild(barChart({ labels: d, values: sl(volume), height: 90, color: '#64748b', yFmt: fmt.big }));
  if (rsi) wrap.appendChild(lineChart({ dates: d, height: 110, series: [{ name: 'RSI 14', values: sl(rsi), color: '#a78bfa' }], hlines: [{ y: 70, label: '70', color: '#e5484d' }, { y: 30, label: '30', color: '#2fbf71' }], yDomain: [0, 100] }));
  if (macd) wrap.appendChild(lineChart({ dates: d, height: 110, series: [{ name: 'MACD', values: sl(macd.line), color: '#4f8cff' }, { name: 'Signal', values: sl(macd.signal), color: '#f5a524' }, { name: 'Hist', values: sl(macd.hist), color: '#2fbf71', area: true, width: .8 }], hlines: [{ y: 0, label: '', color: '#64748b' }] }));
  return wrap;
}
