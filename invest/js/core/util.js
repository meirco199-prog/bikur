// פורמט, DOM, עזרים לממשק. אין כאן חישובים פיננסיים — הם ב-invest-api/engine.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
export const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const nfIls = new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 0 });
const nfUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
export const fmt = {
  ils: (x) => (isNum(x) ? nfIls.format(x) : '—'),
  usd: (x) => (isNum(x) ? nfUsd.format(x) : '—'),
  money: (x, cur = 'USD') => (!isNum(x) ? '—' : cur === 'ILS' ? nfIls.format(x) : cur === 'USD' ? nfUsd.format(x) : `${x.toFixed(2)} ${cur}`),
  num: (x, d = 2) => (isNum(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : '—'),
  pct: (x, d = 1, sign = false) => (isNum(x) ? `${sign && x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%` : '—'),
  big: (x) => { if (!isNum(x)) return '—'; const a = Math.abs(x); const s = a >= 1e12 ? (x / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (x / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (x / 1e3).toFixed(0) + 'K' : x.toFixed(0); return s; },
  date: (d) => (d ? String(d).slice(0, 10) : '—'),
  dt: (d) => (d ? new Date(d).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '—'),
  ago: (d) => { if (!d) return '—'; const s = (Date.now() - Date.parse(d)) / 1000; if (s < 60) return 'עכשיו'; if (s < 3600) return `לפני ${Math.round(s / 60)} דק׳`; if (s < 86400) return `לפני ${Math.round(s / 3600)} שע׳`; return `לפני ${Math.round(s / 86400)} ימים`; },
  x: (x, d = 2) => (isNum(x) ? `x${x.toFixed(d)}` : '—'),
};
export const cls = (x) => (!isNum(x) ? '' : x > 0 ? 'pos' : x < 0 ? 'neg' : '');
export const sigClass = (label) => 'sig sig-' + String(label || 'NO SIGNAL').replace(' ', '_');
export const KIND_HE = { FACT: 'עובדה', MODEL: 'מודל', 'MODEL SIGNAL': 'סיגנל מודל', 'ANALYST OPINION': 'דעת אנליסטים', ESTIMATE: 'תחזית' };
export const REGIME_HE = { 'Risk On': 'תיאבון לסיכון', Neutral: 'ניטרלי', 'Risk Off': 'בריחה מסיכון', 'Bull Trend': 'מגמת עלייה', Correction: 'תיקון', 'Bear Trend': 'מגמת ירידה', 'לא ידוע': 'לא ידוע' };
export const nameOf = (a) => (a?.nameHe ? `${a.nameHe}` : a?.name || a?.symbol || '');
export const SIGNAL_HE = { 'STRONG BUY': 'קנייה חזקה', BUY: 'קנייה', WATCH: 'מעקב', HOLD: 'החזקה', REDUCE: 'הקטנה', SELL: 'מכירה', 'NO SIGNAL': 'אין סיגנל' };
export const COMP_HE = { fundamental: 'פונדמנטלי', valuation: 'הערכת שווי', growth: 'צמיחה', quality: 'איכות', technical: 'טכני', momentum: 'מומנטום', analyst: 'אנליסטים', sentiment: 'סנטימנט', macro: 'מאקרו', risk: 'סיכון' };
export const today = () => new Date().toISOString().slice(0, 10);
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export function toast(msg, kind = '', ms = null){
  const t = el(`<div class="toast ${kind}">${esc(msg)}</div>`);
  document.body.appendChild(t); setTimeout(() => t.remove(), ms || (kind === 'err' ? 6000 : 3500));
}
export function modal(html, { onClose } = {}){
  const bg = el(`<div class="modal-bg"><div class="modal">${html}</div></div>`);
  const close = () => { bg.remove(); onClose?.(); };
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  bg.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
  document.getElementById('overlay').appendChild(bg);
  return { el: bg, close };
}
// טבלה עם מיון
export function table(cols, rows, { onRow, sortKey = null, sortDir = -1, maxH = true } = {}){
  const wrap = el(`<div class="${maxH ? 'table-wrap' : ''}"><table><thead><tr></tr></thead><tbody></tbody></table></div>`);
  const tr = wrap.querySelector('thead tr'), tb = wrap.querySelector('tbody');
  let sk = sortKey, sd = sortDir;
  const render = () => {
    tr.innerHTML = cols.map((c) => `<th class="${c.num ? 'num ' : ''}${sk === c.key ? 'sorted ' + (sd > 0 ? 'asc' : '') : ''}" data-key="${c.key}">${esc(c.label)}</th>`).join('');
    const sorted = sk ? rows.slice().sort((a, b) => { const x = cols.find((c) => c.key === sk).sortVal ? cols.find((c) => c.key === sk).sortVal(a) : a[sk]; const y = cols.find((c) => c.key === sk).sortVal ? cols.find((c) => c.key === sk).sortVal(b) : b[sk]; if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return (x > y ? 1 : x < y ? -1 : 0) * sd; }) : rows;
    tb.innerHTML = sorted.map((r, i) => `<tr class="${onRow ? 'clickable' : ''}" data-i="${rows.indexOf(r)}">${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.render ? c.render(r) : esc(r[c.key] ?? '—')}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${cols.length}" class="muted">אין נתונים</td></tr>`;
  };
  tr.addEventListener('click', (e) => { const th = e.target.closest('th'); if (!th) return; const k = th.dataset.key; if (sk === k) sd = -sd; else { sk = k; sd = -1; } render(); });
  if (onRow) tb.addEventListener('click', (e) => { const r = e.target.closest('tr'); if (r && r.dataset.i !== undefined && !e.target.closest('a,button')) onRow(rows[+r.dataset.i]); });
  render();
  return wrap;
}
