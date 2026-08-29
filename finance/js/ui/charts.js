/* ============================================================
   charts.js — גרפים ב-SVG טהור, ללא ספריות חיצוניות
   כל הגרפים רספונסיביים, מותאמים ל-RTL ולמצב כהה.
   ============================================================ */

import { moneyShort, money, monthLabelShort, monthLabel, el, clamp } from '../core/util.js';

const NS = 'http://www.w3.org/2000/svg';

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    n.setAttribute(k, v);
  }
  return n;
}

function tooltip() {
  let tip = document.getElementById('chart-tip');
  if (!tip) {
    tip = el('div', { id: 'chart-tip' });
    Object.assign(tip.style, {
      position: 'fixed', zIndex: 500, pointerEvents: 'none', opacity: '0',
      background: 'var(--bg-elev)', color: 'var(--text)',
      border: '1px solid var(--line)', borderRadius: '12px',
      padding: '9px 12px', fontSize: '13px', fontWeight: '600',
      boxShadow: 'var(--shadow-lg)', transition: 'opacity .12s', whiteSpace: 'nowrap',
      maxWidth: '260px',
    });
    document.body.append(tip);
  }
  return tip;
}

function showTip(evt, html) {
  const tip = tooltip();
  tip.innerHTML = html;
  tip.style.opacity = '1';
  const pad = 14;
  const r = tip.getBoundingClientRect();
  let x = evt.clientX - r.width / 2;
  let y = evt.clientY - r.height - pad;
  x = clamp(x, 8, window.innerWidth - r.width - 8);
  if (y < 8) y = evt.clientY + pad;
  tip.style.left = `${x}px`;
  tip.style.top = `${y}px`;
}
function hideTip() { tooltip().style.opacity = '0'; }

/* ============================================================
   גרף הכנסות מול הוצאות + קו יתרה
   data: [{ month, income, expense, balance }]
   ============================================================ */
export function incomeExpenseChart(data, opts = {}) {
  const { height = 260, showBalance = true } = opts;
  const wrap = el('div', { class: 'chart-wrap', style: { width: '100%', position: 'relative' } });
  if (!data.length) return emptyChart('אין נתונים להצגה');

  const W = 800, H = height;
  const padTop = 18, padBottom = 30, padSide = 46;
  const innerW = W - padSide * 2;
  const innerH = H - padTop - padBottom;

  const maxVal = Math.max(1, ...data.map((d) => Math.max(d.income, d.expense)));
  const niceMax = niceCeil(maxVal);
  const y = (v) => padTop + innerH - (v / niceMax) * innerH;

  const slot = innerW / data.length;
  const barW = Math.min(24, slot * 0.3);
  const gap = 5;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`, width: '100%', height,
    preserveAspectRatio: 'none', style: 'overflow: visible; display:block',
  });

  // קווי רשת
  for (let i = 0; i <= 4; i++) {
    const val = (niceMax / 4) * i;
    const yy = y(val);
    svg.append(svgEl('line', {
      x1: padSide, x2: W - padSide, y1: yy, y2: yy,
      stroke: 'var(--line)', 'stroke-width': 1, 'stroke-dasharray': i === 0 ? '' : '3 4',
    }));
    const t = svgEl('text', {
      x: W - padSide + 8, y: yy + 4, 'font-size': 11, fill: 'var(--text-3)', 'text-anchor': 'start',
    });
    t.textContent = moneyShort(val);
    svg.append(t);
  }

  const grad = svgEl('linearGradient', { id: 'balGrad', x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.append(svgEl('stop', { offset: '0%', 'stop-color': 'var(--brand-500)', 'stop-opacity': .22 }));
  grad.append(svgEl('stop', { offset: '100%', 'stop-color': 'var(--brand-500)', 'stop-opacity': 0 }));
  const defs = svgEl('defs'); defs.append(grad); svg.append(defs);

  data.forEach((d, i) => {
    const cx = padSide + slot * i + slot / 2;

    const bars = [
      { v: d.income, color: 'var(--pos)', off: -(barW + gap) / 2, label: 'הכנסות' },
      { v: d.expense, color: 'var(--neg)', off: (barW + gap) / 2, label: 'הוצאות' },
    ];
    for (const b of bars) {
      const h = Math.max(2, innerH - (y(b.v) - padTop));
      const rect = svgEl('rect', {
        x: cx + b.off - barW / 2, y: y(b.v), width: barW, height: h,
        rx: Math.min(5, barW / 2), fill: b.color, opacity: .92,
        style: 'transition: opacity .15s; cursor: pointer',
      });
      rect.addEventListener('mouseenter', (e) => {
        rect.setAttribute('opacity', '1');
        showTip(e, `<div style="margin-bottom:4px">${monthLabel(d.month)}</div>
          <div style="color:var(--pos)">הכנסות: ${money(d.income)}</div>
          <div style="color:var(--neg)">הוצאות: ${money(d.expense)}</div>
          <div style="color:var(--text-2)">יתרה: ${money(d.balance)}</div>`);
      });
      rect.addEventListener('mousemove', (e) => showTip(e, tooltip().innerHTML));
      rect.addEventListener('mouseleave', () => { rect.setAttribute('opacity', '.92'); hideTip(); });
      svg.append(rect);
    }

    const lbl = svgEl('text', {
      x: cx, y: H - 10, 'font-size': 11.5, fill: 'var(--text-3)', 'text-anchor': 'middle', 'font-weight': 600,
    });
    lbl.textContent = monthLabelShort(d.month);
    svg.append(lbl);
  });

  if (showBalance && data.length > 1) {
    const pts = data.map((d, i) => [padSide + slot * i + slot / 2, y(Math.max(0, d.balance))]);
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
    svg.append(svgEl('path', {
      d: path, fill: 'none', stroke: 'var(--brand-500)', 'stroke-width': 2.5,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round', opacity: .9,
    }));
    pts.forEach((p) => svg.append(svgEl('circle', { cx: p[0], cy: p[1], r: 3.5, fill: 'var(--bg-elev)', stroke: 'var(--brand-500)', 'stroke-width': 2 })));
  }

  wrap.append(svg);
  wrap.append(legend([
    { color: 'var(--pos)', label: 'הכנסות' },
    { color: 'var(--neg)', label: 'הוצאות' },
    showBalance && { color: 'var(--brand-500)', label: 'יתרה' },
  ].filter(Boolean)));
  return wrap;
}

/* ============================================================
   גרף טבעת — חלוקה לפי קטגוריות
   data: [{ label, value, color }]
   ============================================================ */
export function donutChart(data, opts = {}) {
  const { size = 200, thickness = 26, centerLabel = '', centerValue = '' } = opts;
  const total = data.reduce((s, d) => s + Math.abs(d.value), 0);
  if (!total) return emptyChart('אין הוצאות בחודש זה');

  const wrap = el('div', { style: { display: 'flex', alignItems: 'center', gap: '20px', flexWrap: 'wrap' } });
  const r = size / 2 - thickness / 2 - 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;

  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, style: 'flex:0 0 auto' });
  svg.append(svgEl('circle', { cx: c, cy: c, r, fill: 'none', stroke: 'var(--surface-3)', 'stroke-width': thickness }));

  let offset = 0;
  data.forEach((d) => {
    const frac = Math.abs(d.value) / total;
    const len = frac * circumference;
    const arc = svgEl('circle', {
      cx: c, cy: c, r, fill: 'none', stroke: d.color, 'stroke-width': thickness,
      'stroke-dasharray': `${len} ${circumference - len}`,
      'stroke-dashoffset': -offset,
      transform: `rotate(-90 ${c} ${c})`,
      style: 'transition: stroke-width .15s, opacity .15s; cursor: pointer',
    });
    arc.addEventListener('mouseenter', (e) => {
      arc.setAttribute('stroke-width', thickness + 5);
      showTip(e, `<div>${d.label}</div><div style="color:var(--text-2)">${money(d.value)} · ${(frac * 100).toFixed(1)}%</div>`);
    });
    arc.addEventListener('mousemove', (e) => showTip(e, tooltip().innerHTML));
    arc.addEventListener('mouseleave', () => { arc.setAttribute('stroke-width', thickness); hideTip(); });
    svg.append(arc);
    offset += len;
  });

  if (centerValue) {
    const t1 = svgEl('text', { x: c, y: c - 2, 'text-anchor': 'middle', 'font-size': 19, 'font-weight': 800, fill: 'var(--text)' });
    t1.textContent = centerValue;
    svg.append(t1);
    const t2 = svgEl('text', { x: c, y: c + 17, 'text-anchor': 'middle', 'font-size': 11.5, fill: 'var(--text-3)', 'font-weight': 600 });
    t2.textContent = centerLabel;
    svg.append(t2);
  }

  wrap.append(svg);

  const list = el('div', { style: { flex: '1 1 190px', minWidth: '180px', display: 'flex', flexDirection: 'column', gap: '7px' } });
  data.slice(0, 8).forEach((d) => {
    const frac = (Math.abs(d.value) / total) * 100;
    list.append(el('div', { class: 'row', style: { gap: '9px' } }, [
      el('span', { class: 'dot', style: { background: d.color } }),
      el('span', { class: 'grow truncate small', text: d.label }),
      el('span', { class: 'small num bold nowrap', text: money(d.value) }),
      el('span', { class: 'tiny muted-2 num nowrap', style: { minWidth: '38px', textAlign: 'end' }, text: `${frac.toFixed(0)}%` }),
    ]));
  });
  if (data.length > 8) {
    const rest = data.slice(8).reduce((s, d) => s + Math.abs(d.value), 0);
    list.append(el('div', { class: 'row tiny muted-2', style: { gap: '9px' } }, [
      el('span', { class: 'dot', style: { background: 'var(--text-3)' } }),
      el('span', { class: 'grow', text: `ועוד ${data.length - 8} קטגוריות` }),
      el('span', { class: 'num', text: money(rest) }),
    ]));
  }
  wrap.append(list);
  return wrap;
}

/* ============================================================
   עמודות אופקיות — טבלת קטגוריות
   data: [{ label, value, color, icon, share }]
   ============================================================ */
export function hBarList(data, opts = {}) {
  const { max = null, onClick = null, showShare = true } = opts;
  if (!data.length) return emptyChart('אין נתונים');
  const top = max || Math.max(...data.map((d) => Math.abs(d.value)));
  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '11px' } });

  data.forEach((d) => {
    const pctW = top > 0 ? (Math.abs(d.value) / top) * 100 : 0;
    const row = el('div', {
      style: { cursor: onClick ? 'pointer' : 'default' },
      onclick: onClick ? () => onClick(d) : null,
    }, [
      el('div', { class: 'row', style: { gap: '8px', marginBottom: '5px' } }, [
        d.icon ? el('span', { style: { fontSize: '14px' }, text: d.icon }) : null,
        el('span', { class: 'grow truncate small bold', text: d.label }),
        showShare && d.share !== undefined
          ? el('span', { class: 'tiny muted-2 num', text: `${Math.round(d.share)}%` }) : null,
        el('span', { class: 'small num bold nowrap', text: money(d.value) }),
      ]),
      el('div', { class: 'bar' }, [
        el('i', { style: { width: `${pctW}%`, background: d.color || 'var(--brand-500)' } }),
      ]),
    ]);
    wrap.append(row);
  });
  return wrap;
}

/* ============================================================
   גרף קו / שטח — מגמה
   data: [{ month, value }]
   ============================================================ */
export function trendChart(data, opts = {}) {
  const { height = 180, color = 'var(--brand-500)', fill = true, label = '' } = opts;
  if (data.length < 2) return emptyChart('נדרשים לפחות שני חודשים להצגת מגמה');

  const W = 800, H = height;
  const padTop = 16, padBottom = 26, padSide = 44;
  const innerW = W - padSide * 2, innerH = H - padTop - padBottom;

  const vals = data.map((d) => d.value);
  const rawMin = Math.min(...vals, 0);
  const rawMax = Math.max(...vals, 0);
  const span = rawMax - rawMin || 1;
  const min = rawMin - span * 0.08;
  const max = rawMax + span * 0.08;

  const x = (i) => padSide + (innerW / Math.max(1, data.length - 1)) * i;
  const y = (v) => padTop + innerH - ((v - min) / (max - min)) * innerH;

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height, preserveAspectRatio: 'none', style: 'overflow:visible;display:block' });

  for (let i = 0; i <= 3; i++) {
    const v = min + ((max - min) / 3) * i;
    svg.append(svgEl('line', { x1: padSide, x2: W - padSide, y1: y(v), y2: y(v), stroke: 'var(--line)', 'stroke-width': 1, 'stroke-dasharray': '3 4' }));
    const t = svgEl('text', { x: W - padSide + 8, y: y(v) + 4, 'font-size': 11, fill: 'var(--text-3)' });
    t.textContent = moneyShort(v);
    svg.append(t);
  }
  if (min < 0 && max > 0) {
    svg.append(svgEl('line', { x1: padSide, x2: W - padSide, y1: y(0), y2: y(0), stroke: 'var(--line-strong)', 'stroke-width': 1.5 }));
  }

  const pts = data.map((d, i) => [x(i), y(d.value)]);
  const linePath = smoothPath(pts);

  if (fill) {
    const gid = `grad_${Math.random().toString(36).slice(2, 8)}`;
    const defs = svgEl('defs');
    const g = svgEl('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    g.append(svgEl('stop', { offset: '0%', 'stop-color': color, 'stop-opacity': .28 }));
    g.append(svgEl('stop', { offset: '100%', 'stop-color': color, 'stop-opacity': 0 }));
    defs.append(g); svg.append(defs);
    svg.append(svgEl('path', {
      d: `${linePath} L${pts[pts.length - 1][0]},${padTop + innerH} L${pts[0][0]},${padTop + innerH} Z`,
      fill: `url(#${gid})`, stroke: 'none',
    }));
  }

  svg.append(svgEl('path', { d: linePath, fill: 'none', stroke: color, 'stroke-width': 2.6, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));

  data.forEach((d, i) => {
    const dot = svgEl('circle', { cx: pts[i][0], cy: pts[i][1], r: 4, fill: 'var(--bg-elev)', stroke: color, 'stroke-width': 2.2, style: 'cursor:pointer' });
    dot.addEventListener('mouseenter', (e) => {
      dot.setAttribute('r', 6);
      showTip(e, `<div>${monthLabel(d.month)}</div><div style="color:var(--text-2)">${label ? label + ': ' : ''}${money(d.value)}</div>`);
    });
    dot.addEventListener('mouseleave', () => { dot.setAttribute('r', 4); hideTip(); });
    svg.append(dot);

    if (data.length <= 14 || i % 2 === 0) {
      const t = svgEl('text', { x: pts[i][0], y: H - 8, 'font-size': 11, fill: 'var(--text-3)', 'text-anchor': 'middle', 'font-weight': 600 });
      t.textContent = monthLabelShort(d.month);
      svg.append(t);
    }
  });

  return el('div', { style: { width: '100%' } }, [svg]);
}

/* ============================================================
   מיני-גרף
   ============================================================ */
export function sparkline(values, opts = {}) {
  const { width = 90, height = 28, color = 'var(--brand-500)' } = opts;
  if (values.length < 2) return el('span');
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [
    (width / (values.length - 1)) * i,
    height - 2 - ((v - min) / span) * (height - 4),
  ]);
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, style: 'display:block' });
  svg.append(svgEl('path', { d: smoothPath(pts), fill: 'none', stroke: color, 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  const last = pts[pts.length - 1];
  svg.append(svgEl('circle', { cx: last[0], cy: last[1], r: 2.4, fill: color }));
  return svg;
}

/* ============================================================
   גרף השוואה — שתי עמודות זו מול זו
   ============================================================ */
export function compareBars(rows, opts = {}) {
  const { labelA = 'א', labelB = 'ב', height = 22 } = opts;
  const max = Math.max(1, ...rows.map((r) => Math.max(Math.abs(r.a), Math.abs(r.b))));
  const wrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '14px' } });
  rows.forEach((r) => {
    wrap.append(el('div', {}, [
      el('div', { class: 'row-between', style: { marginBottom: '6px' } }, [
        el('span', { class: 'small bold truncate', text: r.label }),
        el('span', { class: 'tiny num', style: { color: r.diff > 0 ? 'var(--neg)' : r.diff < 0 ? 'var(--pos)' : 'var(--text-3)' },
          text: r.diff === 0 ? '—' : `${r.diff > 0 ? '+' : ''}${money(r.diff)}` }),
      ]),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, [
        miniBar(r.a, max, 'var(--text-3)', labelA, height),
        miniBar(r.b, max, r.diff > 0 ? 'var(--neg)' : 'var(--pos)', labelB, height),
      ]),
    ]));
  });
  return wrap;
}

function miniBar(value, max, color, label, height) {
  const w = max > 0 ? (Math.abs(value) / max) * 100 : 0;
  return el('div', { class: 'row', style: { gap: '8px' } }, [
    el('span', { class: 'tiny muted-2', style: { minWidth: '54px' }, text: label }),
    el('div', { style: { flex: '1 1 auto', height: `${height}px`, background: 'var(--surface-3)', borderRadius: '6px', overflow: 'hidden', position: 'relative' } }, [
      el('div', { style: { width: `${w}%`, height: '100%', background: color, opacity: .85, borderRadius: '6px', transition: 'width .5s var(--ease)' } }),
    ]),
    el('span', { class: 'tiny num bold nowrap', style: { minWidth: '72px', textAlign: 'end' }, text: money(value) }),
  ]);
}

/* ============================================================
   עזרים
   ============================================================ */

function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    const cx = (x0 + x1) / 2;
    d += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return d;
}

function niceCeil(v) {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  let step;
  if (norm <= 1) step = 1;
  else if (norm <= 2) step = 2;
  else if (norm <= 2.5) step = 2.5;
  else if (norm <= 5) step = 5;
  else step = 10;
  return step * mag;
}

function legend(items) {
  return el('div', { class: 'row', style: { gap: '16px', justifyContent: 'center', marginTop: '10px', flexWrap: 'wrap' } },
    items.map((it) => el('span', { class: 'row tiny muted', style: { gap: '6px' } }, [
      el('span', { class: 'dot', style: { background: it.color, width: '8px', height: '8px' } }),
      it.label,
    ])));
}

function emptyChart(text) {
  return el('div', { class: 'empty', style: { padding: '32px 16px' } }, [
    el('div', { class: 'e-icon', text: '📊' }),
    el('div', { class: 'e-text', text }),
  ]);
}

export { showTip, hideTip };
