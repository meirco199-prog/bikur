/* ============================================================
   components.js — רכיבי ממשק לשימוש חוזר
   ============================================================ */

import { el, clear, clamp } from '../core/util.js';
import { CATEGORY_COLORS, CATEGORY_ICONS } from '../core/schema.js';

/* ============================================================
   הודעות צפות
   ============================================================ */
let toastHost = null;
function host() {
  if (!toastHost) {
    toastHost = document.getElementById('toasts') || el('div', { id: 'toasts' });
    if (!toastHost.parentNode) document.body.append(toastHost);
  }
  return toastHost;
}

export function toast(message, { type = 'ok', ms = 3600, undo = null } = {}) {
  const icons = { ok: '✓', err: '⚠️', info: 'ℹ️' };
  const node = el('div', { class: `toast ${type}` }, [
    el('span', { class: 't-icon', text: icons[type] || '•' }),
    el('span', { class: 'grow', text: message }),
    undo ? el('button', { class: 'undo', text: 'ביטול', onclick: () => { undo(); close(); } }) : null,
  ]);
  host().append(node);
  const close = () => {
    node.style.opacity = '0';
    node.style.transform = 'translateY(8px)';
    setTimeout(() => node.remove(), 200);
  };
  const timer = setTimeout(close, ms);
  node.addEventListener('click', (e) => { if (e.target.tagName !== 'BUTTON') { clearTimeout(timer); close(); } });
  return close;
}

/* ============================================================
   מודל
   ============================================================ */
export function modal({ title, subtitle = '', body, footer = [], size = '', onClose = null, closeOnBackdrop = true }) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const box = el('div', { class: `modal ${size}` });

  const close = () => {
    backdrop.style.opacity = '0';
    setTimeout(() => backdrop.remove(), 160);
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);

  box.append(el('div', { class: 'modal-head' }, [
    el('div', {}, [
      el('h2', { style: { fontSize: '19px' }, text: title }),
      subtitle ? el('div', { class: 'card-sub', text: subtitle }) : null,
    ]),
    el('button', { class: 'modal-close', text: '✕', title: 'סגירה', onclick: close }),
  ]));

  const bodyNode = el('div', { class: 'modal-body' });
  if (body) bodyNode.append(body);
  box.append(bodyNode);

  if (footer && footer.length) box.append(el('div', { class: 'modal-foot' }, footer));

  backdrop.append(box);
  backdrop.addEventListener('click', (e) => { if (closeOnBackdrop && e.target === backdrop) close(); });
  document.body.append(backdrop);

  setTimeout(() => box.querySelector('input, select, textarea, button:not(.modal-close)')?.focus(), 60);
  return { close, body: bodyNode, box, backdrop };
}

export function confirmDialog({ title, message, confirmText = 'אישור', cancelText = 'ביטול', danger = false }) {
  return new Promise((resolve) => {
    // settle מבטיח שהתשובה הראשונה היא הקובעת: m.close() מפעיל את onClose,
    // ובלעדיו כל אישור היה נדרס מיד על ידי ברירת המחדל.
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    const m = modal({
      title,
      size: 'narrow',
      body: el('p', { class: 'muted', style: { lineHeight: '1.6' }, text: message }),
      footer: [
        el('button', { class: 'btn ghost', text: cancelText, onclick: () => { settle(false); m.close(); } }),
        el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, text: confirmText, onclick: () => { settle(true); m.close(); } }),
      ],
      onClose: () => settle(false),
    });
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', type = 'text' }) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    const input = el('input', { class: 'input', type, value, placeholder });
    const m = modal({
      title,
      size: 'narrow',
      body: el('div', { class: 'field' }, [el('label', { text: label }), input]),
      footer: [
        el('button', { class: 'btn ghost', text: 'ביטול', onclick: () => { settle(null); m.close(); } }),
        el('button', { class: 'btn primary', text: 'שמירה', onclick: () => { settle(input.value); m.close(); } }),
      ],
      onClose: () => settle(null),
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { settle(input.value); m.close(); } });
  });
}

/* ============================================================
   כרטיסי מידע
   ============================================================ */

export function statCard({ label, value, sub = '', delta = null, deltaLabel = '', tone = '', icon = null, onClick = null }) {
  return el('div', {
    class: `stat ${tone ? 'is-' + tone : ''}`,
    style: onClick ? { cursor: 'pointer' } : null,
    onclick: onClick,
  }, [
    el('div', { class: 'row-between' }, [
      el('span', { class: 'stat-label', text: label }),
      icon ? el('span', { style: { fontSize: '15px', opacity: .6 }, text: icon }) : null,
    ]),
    el('div', { class: 'stat-value num', text: value }),
    (delta !== null && delta !== undefined) || sub
      ? el('div', { class: 'stat-foot' }, [
          delta !== null && delta !== undefined ? deltaChip(delta, { invert: tone === 'neg' }) : null,
          deltaLabel ? el('span', { text: deltaLabel }) : null,
          sub ? el('span', { text: sub }) : null,
        ])
      : null,
  ]);
}

/** תגית שינוי באחוזים. invert=true — עלייה היא דבר רע (הוצאות) */
export function deltaChip(value, { invert = false, suffix = '' } = {}) {
  if (value === null || value === undefined || !isFinite(value)) {
    return el('span', { class: 'delta flat', text: '—' });
  }
  const v = Number(value);
  const good = invert ? v < 0 : v > 0;
  const cls = Math.abs(v) < 0.05 ? 'flat' : good ? 'up' : 'down';
  const arrow = Math.abs(v) < 0.05 ? '' : v > 0 ? '▲' : '▼';
  return el('span', { class: `delta ${cls}` }, [
    arrow ? el('span', { style: { fontSize: '9px' }, text: arrow }) : null,
    `${Math.abs(v).toFixed(1).replace(/\.0$/, '')}%${suffix}`,
  ]);
}

export function sectionCard(title, { sub = '', actions = [], body = null, pad = true, id = null } = {}) {
  return el('div', { class: `card ${pad ? '' : 'pad-0'}`, id }, [
    (title || actions.length)
      ? el('div', { class: 'card-head', style: pad ? null : { padding: '18px 20px 0' } }, [
          el('div', {}, [
            title ? el('div', { class: 'card-title', text: title }) : null,
            sub ? el('div', { class: 'card-sub', text: sub }) : null,
          ]),
          actions.length ? el('div', { class: 'row', style: { gap: '6px' } }, actions) : null,
        ])
      : null,
    body,
  ]);
}

export function emptyState({ icon = '📭', title = '', text = '', action = null }) {
  return el('div', { class: 'empty' }, [
    el('div', { class: 'e-icon', text: icon }),
    title ? el('div', { class: 'e-title', text: title }) : null,
    text ? el('div', { class: 'e-text', text }) : null,
    action,
  ]);
}

export function insightCard(ins) {
  return el('div', { class: `insight ${ins.tone}` }, [
    el('div', { class: 'i-icon', text: ins.icon }),
    el('div', { class: 'grow' }, [
      el('div', { class: 'i-title', text: ins.title }),
      el('div', { class: 'i-text', text: ins.text }),
    ]),
  ]);
}

/* ============================================================
   שדות טופס
   ============================================================ */

export function field(label, control, { hint = '', full = false } = {}) {
  return el('div', { class: `field ${full ? 'full' : ''}` }, [
    label ? el('label', { text: label }) : null,
    control,
    hint ? el('span', { class: 'tiny muted-2', text: hint }) : null,
  ]);
}

export function input(attrs = {}) { return el('input', { class: 'input', ...attrs }); }
export function textarea(attrs = {}) { return el('textarea', { class: 'textarea', ...attrs }); }

export function select(options, { value = '', placeholder = null, ...attrs } = {}) {
  const s = el('select', { class: 'select', ...attrs });
  if (placeholder !== null) s.append(el('option', { value: '', text: placeholder }));
  for (const o of options) {
    const opt = el('option', { value: o.value, text: o.label });
    if (String(o.value) === String(value)) opt.selected = true;
    if (o.disabled) opt.disabled = true;
    s.append(opt);
  }
  s.value = value ?? '';
  return s;
}

export function switchField(labelText, checked, onChange) {
  const inp = el('input', { type: 'checkbox', onchange: (e) => onChange(e.target.checked) });
  inp.checked = !!checked;
  return el('label', { class: 'switch' }, [
    inp,
    el('span', { class: 'track' }),
    el('span', { class: 'switch-label', text: labelText }),
  ]);
}

export function segmented(options, value, onChange) {
  const wrap = el('div', { class: 'seg' });
  options.forEach((o) => {
    const b = el('button', {
      class: `seg-opt ${String(o.value) === String(value) ? 'active' : ''}`,
      type: 'button',
      onclick: () => {
        wrap.querySelectorAll('.seg-opt').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        onChange(o.value);
      },
    }, [o.icon ? el('span', { text: o.icon + ' ' }) : null, o.label]);
    wrap.append(b);
  });
  return wrap;
}

export function buttonGroup(options, value, onChange) {
  const wrap = el('div', { class: 'btn-group' });
  options.forEach((o) => {
    const b = el('button', {
      class: String(o.value) === String(value) ? 'active' : '',
      type: 'button',
      onclick: () => {
        wrap.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        onChange(o.value);
      },
      text: o.label,
    });
    wrap.append(b);
  });
  return wrap;
}

/* ============================================================
   בוררי קטגוריה / אייקון / צבע
   ============================================================ */

export function categorySelect(categories, { value = '', space = null, kind = null, placeholder = 'בחר קטגוריה', ...attrs } = {}) {
  const list = categories
    .filter((c) => !c.archived)
    .filter((c) => (space ? c.space === space : true))
    .filter((c) => (kind ? c.kind === kind : true))
    .sort((a, b) => a.order - b.order);
  return select(list.map((c) => ({ value: c.id, label: `${c.icon} ${c.name}` })), { value, placeholder, ...attrs });
}

export function iconPicker(current, onPick) {
  const wrap = el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(38px,1fr))', gap: '6px', maxHeight: '164px', overflowY: 'auto', padding: '4px' } });
  CATEGORY_ICONS.forEach((ic) => {
    const b = el('button', {
      type: 'button',
      class: 'cat-icon',
      style: { border: ic === current ? '2px solid var(--brand-500)' : '1px solid var(--line)', cursor: 'pointer' },
      text: ic,
      onclick: () => {
        wrap.querySelectorAll('button').forEach((x) => { x.style.border = '1px solid var(--line)'; });
        b.style.border = '2px solid var(--brand-500)';
        onPick(ic);
      },
    });
    wrap.append(b);
  });
  return wrap;
}

export function colorPicker(current, onPick) {
  const wrap = el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px' } });
  CATEGORY_COLORS.forEach((c) => {
    const b = el('button', {
      type: 'button',
      style: {
        width: '28px', height: '28px', borderRadius: '9px', background: c, cursor: 'pointer',
        border: c === current ? '3px solid var(--text)' : '1px solid var(--line)',
      },
      title: c,
      onclick: () => {
        wrap.querySelectorAll('button').forEach((x) => { x.style.border = '1px solid var(--line)'; });
        b.style.border = '3px solid var(--text)';
        onPick(c);
      },
    });
    wrap.append(b);
  });
  return wrap;
}

/* ============================================================
   תגיות ותצוגות קטנות
   ============================================================ */

export function categoryChip(category, { size = '' } = {}) {
  if (!category) return el('span', { class: 'chip', text: 'ללא קטגוריה' });
  return el('span', { class: 'chip', style: { background: hexAlpha(category.color, .13), color: category.color } }, [
    el('span', { text: category.icon }),
    category.name,
  ]);
}

export function catIcon(category, size = '') {
  return el('span', {
    class: `cat-icon ${size}`,
    style: { background: hexAlpha(category?.color || '#7b839c', .14), color: category?.color || 'var(--text-2)' },
    text: category?.icon || '📦',
  });
}

export function spaceChip(space) {
  const map = { business: { l: 'עסקי', c: 'brand', i: '🏢' }, personal: { l: 'פרטי', c: 'pos', i: '🏠' } };
  const s = map[space] || { l: space, c: '', i: '' };
  return el('span', { class: `chip ${s.c}` }, [el('span', { text: s.i }), s.l]);
}

export function confidenceBadge(c) {
  const cls = c >= 90 ? 'hi' : c >= 70 ? 'mid' : 'lo';
  const label = c >= 90 ? 'בטוח' : c >= 70 ? 'כנראה נכון' : 'דורש בדיקה';
  return el('span', { class: `conf ${cls}`, title: label }, [
    el('span', { class: 'conf-bar' }, [el('i', { style: { width: `${clamp(c, 3, 100)}%` } })]),
    `${Math.round(c)}%`,
  ]);
}

export function progressBar(usedPct, { over = false } = {}) {
  const cls = over ? 'over' : usedPct >= 85 ? 'warn' : 'ok';
  return el('div', { class: `bar ${cls}` }, [
    el('i', { style: { width: `${clamp(usedPct || 0, 0, 100)}%` } }),
  ]);
}

/** המרת צבע hex לשקיפות */
export function hexAlpha(hex, alpha) {
  const h = String(hex || '#7b839c').replace('#', '');
  if (h.length !== 6) return `rgba(123,131,156,${alpha})`;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ============================================================
   טבלה
   ============================================================ */

export function dataTable(columns, rows, { onRowClick = null, empty = null, rowClass = null } = {}) {
  if (!rows.length && empty) return empty;
  const table = el('table', { class: 'tbl' });
  const thead = el('thead');
  thead.append(el('tr', {}, columns.map((c) => el('th', { class: c.align === 'end' ? 'num' : '', style: c.width ? { width: c.width } : null, text: c.label }))));
  table.append(thead);

  const tbody = el('tbody');
  rows.forEach((row) => {
    const tr = el('tr', {
      class: rowClass ? rowClass(row) : '',
      style: onRowClick ? { cursor: 'pointer' } : null,
      onclick: onRowClick ? (e) => { if (!e.target.closest('button, input, select, a')) onRowClick(row); } : null,
    });
    columns.forEach((c) => {
      const content = c.render ? c.render(row) : row[c.key];
      const td = el('td', { class: c.align === 'end' ? 'num' : '' });
      if (content instanceof Node) td.append(content);
      else td.textContent = content ?? '';
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(tbody);
  return el('div', { class: 'table-wrap' }, [table]);
}

/* ============================================================
   כותרת עמוד
   ============================================================ */
export function pageHead(title, { sub = '', actions = [] } = {}) {
  return el('div', { class: 'page-head' }, [
    el('div', {}, [
      el('h1', { text: title }),
      sub ? el('div', { class: 'ph-sub', text: sub }) : null,
    ]),
    actions.length ? el('div', { class: 'row wrap', style: { gap: '8px' } }, actions) : null,
  ]);
}

export { el, clear };
