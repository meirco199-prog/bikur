/* ============================================================
   util.js — עזרים כלליים: DOM, פורמט, תאריכים, מזהים
   כל החישובים הכספיים נמצאים ב-domain/finance.js (קוד דטרמיניסטי בלבד)
   ============================================================ */

/* ---------------- DOM ---------------- */

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  const kids = Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/* ---------------- מזהים ---------------- */

export function uid(prefix = 'id') {
  const rnd = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36))
    .replace(/-/g, '').slice(0, 16);
  return `${prefix}_${rnd}`;
}

/* ---------------- פורמט מספרים ---------------- */

const nfILS = new Intl.NumberFormat('he-IL', {
  style: 'currency', currency: 'ILS', minimumFractionDigits: 0, maximumFractionDigits: 0,
});
const nfILS2 = new Intl.NumberFormat('he-IL', {
  style: 'currency', currency: 'ILS', minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const nfPlain = new Intl.NumberFormat('he-IL', { maximumFractionDigits: 0 });
const nfPlain2 = new Intl.NumberFormat('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ברירת המחדל להצגת אגורות — נקבעת מההגדרות בעליית האפליקציה */
let showCentsDefault = false;
export function setMoneyPrecision(showCents) { showCentsDefault = !!showCents; }

/** סכום בשקלים. cents לא מוגדר => לפי ההגדרה של המשתמש. */
export function money(n, cents) {
  const v = Number(n) || 0;
  const c = cents === undefined ? showCentsDefault : cents;
  return (c ? nfILS2 : nfILS).format(v);
}

/** סכום ללא סימן מטבע */
export function num(n, cents) {
  const v = Number(n) || 0;
  const c = cents === undefined ? showCentsDefault : cents;
  return (c ? nfPlain2 : nfPlain).format(v);
}

/** סכום מקוצר לגרפים: 12.5K / 1.2M */
export function moneyShort(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return `${sign}${Math.round(a)}`;
}

/** אחוז מעוצב עם סימן */
export function pct(n, digits = 1) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  const v = Number(n);
  const s = v > 0 ? '+' : '';
  return `${s}${v.toFixed(digits).replace(/\.0$/, '')}%`;
}

export function pctPlain(n, digits = 1) {
  if (n === null || n === undefined || !isFinite(n)) return '—';
  return `${Number(n).toFixed(digits).replace(/\.0$/, '')}%`;
}

/** פירסור מספר מטקסט (תומך בפסיקים, ₪, סוגריים לשלילי, מינוס אחרי) */
export function parseNumber(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/-\s*$/.test(s)) { neg = true; s = s.replace(/-\s*$/, ''); }
  s = s.replace(/[₪$€£]/g, '').replace(/[‎‏‪-‮]/g, '').replace(/\s|,/g, '').trim();
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const v = parseFloat(s);
  if (!isFinite(v)) return null;
  return neg ? -v : v;
}

/** עיגול לשתי ספרות — למניעת שגיאות float בסכומים */
export function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

/* ---------------- תאריכים וחודשים ---------------- */

export const MONTH_NAMES = [
  'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני',
  'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר',
];
export const MONTH_SHORT = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];

/** YYYY-MM של היום */
export function currentMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** YYYY-MM-DD מקומי (לא UTC) */
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function monthKeyOf(isoDate) {
  return String(isoDate || '').slice(0, 7);
}

/** "אוגוסט 2026" */
export function monthLabel(key) {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "אוג׳ 26" */
export function monthLabelShort(key) {
  if (!key) return '';
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}`;
}

export function addMonths(key, delta) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return currentMonthKey(d);
}

/** רשימת חודשים מ-from עד to (כולל) */
export function monthRange(from, to) {
  const out = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 600) { out.push(cur); cur = addMonths(cur, 1); }
  return out;
}

/** N החודשים שקדמו ל-key (לא כולל key), מהישן לחדש */
export function previousMonths(key, n) {
  const out = [];
  for (let i = n; i >= 1; i--) out.push(addMonths(key, -i));
  return out;
}

export function monthDiff(a, b) {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function daysInMonth(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** "12.08.2026" */
export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  if (!y || !m || !d) return iso;
  return `${d}.${m}.${y}`;
}

/** "12 באוג׳" */
export function fmtDateShort(iso) {
  if (!iso) return '';
  const [, m, d] = String(iso).slice(0, 10).split('-');
  if (!m || !d) return iso;
  return `${Number(d)} ב${MONTH_SHORT[Number(m) - 1]}׳`;
}

export function fmtDateTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  if (isNaN(d)) return '';
  return `${fmtDate(todayISO(d))} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * ניסיון לפרסר תאריך מכל פורמט שמופיע בדוחות בנק ישראליים.
 * מחזיר YYYY-MM-DD או null.
 */
export function parseDate(raw, hintYear) {
  if (raw === null || raw === undefined || raw === '') return null;

  // מספר סידורי של Excel
  if (typeof raw === 'number' && raw > 20000 && raw < 60000) {
    const ms = Math.round((raw - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d)) return todayISO(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  if (raw instanceof Date && !isNaN(raw)) return todayISO(raw);

  const s = String(raw).trim().replace(/[‎‏]/g, '');
  if (!s) return null;

  // ISO
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return isoParts(m[1], m[2], m[3]);

  // DD/MM/YYYY או DD.MM.YY
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let y = m[3];
    if (y.length === 2) y = String(2000 + Number(y));
    return isoParts(y, m[2], m[1]);
  }

  // DD/MM בלבד — משלימים שנה מהקשר
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})$/);
  if (m && hintYear) return isoParts(String(hintYear), m[2], m[1]);

  const d = new Date(s);
  if (!isNaN(d)) return todayISO(d);
  return null;
}

function isoParts(y, m, d) {
  const yy = Number(y), mm = Number(m), dd = Number(d);
  if (!yy || mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  return `${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

/* ---------------- טקסט ---------------- */

/** נרמול שם בית עסק להשוואה: הסרת ניקוד, רווחים כפולים, סימנים, מספרי סניף */
export function normalizeMerchant(s) {
  return String(s || '')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[‎‏‪-‮]/g, '')
    .toLowerCase()
    .replace(/["'`׳״.,\-_/\\|()[\]{}*#]/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeKey(s) {
  return normalizeMerchant(s).replace(/\s/g, '');
}

/** מרחק לוינשטיין — לזיהוי כפילויות עם תיאור מעט שונה */
export function levenshtein(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** דמיון 0..1 בין שתי מחרוזות */
export function similarity(a, b) {
  const na = normalizeMerchant(a), nb = normalizeMerchant(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const dist = levenshtein(na, nb);
  return Math.max(0, 1 - dist / Math.max(na.length, nb.length));
}

/* ---------------- שונות ---------------- */

export function debounce(fn, ms = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function groupBy(arr, keyFn) {
  const map = new Map();
  for (const item of arr) {
    const k = keyFn(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}

export function sum(arr, fn = (x) => x) {
  let t = 0;
  for (const x of arr) t += Number(fn(x)) || 0;
  return round2(t);
}

export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

export function deepClone(obj) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(obj); } catch { /* נופל לגיבוי */ }
  }
  return JSON.parse(JSON.stringify(obj));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(text, filename, mime = 'text/plain;charset=utf-8') {
  downloadBlob(new Blob(['﻿' + text], { type: mime }), filename);
}
