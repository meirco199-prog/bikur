/* ============================================================
   parse.js — קריאת קבצים והפיכתם לשורות גולמיות
   ------------------------------------------------------------
   תומך ב-CSV, Excel (xlsx/xls) ו-PDF.
   כל הפירסור מתבצע בדפדפן. שום מסמך אינו נשלח לשירות חיצוני.
   ============================================================ */

import { parseDate, parseNumber, normalizeMerchant, round2 } from '../core/util.js';

/* ============================================================
   ספריות חיצוניות — נטענות רק כשצריך (עצלנות מכוונת)
   ============================================================ */

const CDN = {
  xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  pdfjs: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  pdfWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
};

const loaded = new Map();
function loadScript(src) {
  if (loaded.has(src)) return loaded.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('טעינת הספרייה נכשלה. נדרש חיבור לאינטרנט לייבוא מסוג זה.'));
    document.head.append(s);
  });
  loaded.set(src, p);
  return p;
}

/* ============================================================
   קידוד וטקסט
   ============================================================ */

/** דוחות בנק ישראליים מגיעים לא פעם ב-windows-1255 ולא ב-UTF-8 */
function decodeBuffer(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  // סימן שאלה הפוך / תווי החלפה מרובים = כנראה לא UTF-8
  const bad = (utf8.match(/�/g) || []).length;
  if (bad > 2) {
    try { return new TextDecoder('windows-1255').decode(bytes); } catch { /* לא נתמך */ }
  }
  return utf8;
}

/** פיצול CSV שמכבד מרכאות */
function splitCsvLine(line, delim) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim().replace(/^"|"$/g, ''));
}

function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 12).join('\n');
  const counts = { ',': 0, ';': 0, '\t': 0, '|': 0 };
  for (const ch of sample) if (ch in counts) counts[ch]++;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] || ',';
}

/* ============================================================
   קריאת קבצים לפי סוג → מטריצה של תאים
   ============================================================ */

export async function readFileToMatrix(file) {
  const name = (file.name || '').toLowerCase();
  const ext = name.split('.').pop();

  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') {
    const text = decodeBuffer(await file.arrayBuffer());
    const delim = ext === 'tsv' ? '\t' : detectDelimiter(text);
    const rows = text.split(/\r?\n/).filter((l) => l.trim() !== '').map((l) => splitCsvLine(l, delim));
    return { sections: [{ labels: null, rows }], kind: 'csv', sheets: null };
  }

  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
    await loadScript(CDN.xlsx);
    if (!window.XLSX) throw new Error('ספריית Excel לא נטענה.');
    const wb = window.XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true, raw: false });
    const sheets = wb.SheetNames;
    // בוחרים את הגיליון עם הכי הרבה שורות
    let best = null, bestLen = -1;
    for (const sn of sheets) {
      const m = window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: false, blankrows: false });
      if (m.length > bestLen) { bestLen = m.length; best = m; }
    }
    return { sections: [{ labels: null, rows: best || [] }], kind: 'xlsx', sheets };
  }

  if (ext === 'pdf') {
    const { sections, rawHead, rawAll } = await readPdfToMatrix(file);
    return { sections, kind: 'pdf', sheets: null, rawHead, rawAll };
  }

  throw new Error(`סוג הקובץ .${ext} אינו נתמך. ניתן להעלות CSV, Excel או PDF.`);
}

/**
 * PDF: מחלצים טקסט עם מיקומים ובונים ממנו טבלה אמיתית.
 * ------------------------------------------------------------
 * בדוח בנק בעברית כל העמודות מיושרות לימין — גם הטקסט וגם המספרים.
 * לכן הקצה הימני של כל תא (x + רוחב) הוא המדד היציב לזיהוי העמודה
 * שאליה הוא שייך, ולא נקודת ההתחלה או המרכז.
 *
 * בלי השיוך הזה סכום שמופיע בעמודת "זכות" נראה בדיוק כמו סכום
 * בעמודת "חובה", וכל ההכנסות נרשמות כהוצאות.
 */
async function readPdfToMatrix(file) {
  await loadScript(CDN.pdfjs);
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) throw new Error('ספריית ה-PDF לא נטענה.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;

  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  // דוח אשראי מכיל כמה מקטעים עם מבנה עמודות שונה — עסקאות בארץ,
  // רכישות בחו״ל, עסקאות בתשלומים. כל מקטע נקרא בנפרד; שימוש
  // בכותרת של מקטע אחד עבור מקטע אחר קורא את הסכום מהעמודה הלא נכונה.
  const sections = [];
  // השורות הגולמיות של העמוד הראשון, לפני שיוך לעמודות —
  // כותרת החשבון יושבת מחוץ לעמודות הטבלה ומתעוותת בשיוך.
  let rawHead = [];
  const rawAll = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = groupIntoLines(content.items);
    if (p === 1) rawHead = lines.slice(0, 30).map((l) => l.map((i) => i.str));
    for (const l of lines) rawAll.push(l.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim());
    for (const { labels, rows } of linesToSections(lines)) {
      // מקטעים עוקבים עם אותה כותרת (המשך מעמוד קודם) מצטרפים לאותו מקטע
      const last = sections[sections.length - 1];
      if (labels && last && last.labels && String(last.labels) === String(labels)) last.rows.push(...rows);
      else sections.push({ labels, rows });
    }
  }

  return { sections, rawHead, rawAll };
}

/** הפיכת שורות עמוד למקטעי טבלה: כותרת + שורות משויכות לעמודות */
export function linesToSections(lines) {
  const headers = findHeaderLines(lines);
  // אין כותרת בעמוד הזה — מוסרים את הטקסט כפי שהוא לזיהוי החופשי
  if (!headers.length) return [{ labels: null, rows: lines.map((l) => l.map((i) => i.str)) }];

  const out = [];
  for (let h = 0; h < headers.length; h++) {
    const header = headers[h];
    const columns = buildColumns(header);
    const tail = absorbHeaderTail(columns, lines, header.index);
    markNumericColumns(columns);
    const from = header.index + tail + 1;
    const to = headers[h + 1] ? headers[h + 1].index : lines.length;
    const rows = [];
    for (let i = from; i < to; i++) {
      const cells = assignToColumns(lines[i], columns);
      if (cells.some((c) => c !== '')) rows.push(cells);
    }
    out.push({ labels: columns.map((c) => c.label), rows });
  }
  return out;
}

/** קיבוץ פריטי טקסט לשורות לפי קו Y, עם הקצה הימני של כל פריט */
function groupIntoLines(items, tolerance = 3) {
  const buckets = new Map();
  for (const item of items) {
    const str = String(item.str || '').trim();
    if (!str) continue;
    const y = Math.round(item.transform[5] / tolerance) * tolerance;
    const x = item.transform[4];
    const width = Number(item.width) || estimateWidth(str);
    if (!buckets.has(y)) buckets.set(y, []);
    buckets.get(y).push({ x, width, right: x + width, str });
  }
  return [...buckets.entries()]
    .sort((a, b) => b[0] - a[0])                    // מלמעלה למטה
    .map(([, line]) => line.sort((a, b) => b.right - a.right)); // מימין לשמאל
}

function estimateWidth(str) {
  return String(str).length * 4.5;
}

/**
 * מיזוג מילים סמוכות לתא אחד.
 * ב-PDF כל מילה היא פריט טקסט נפרד, ולכן הכותרת "שם בית העסק"
 * מגיעה כשלוש מילים ואינה מזוהה, ו"סכום החיוב" נראה כמו "סכום"
 * סתם — מה שגורם לקריאת הסכום מהעמודה הלא נכונה.
 */
function mergeAdjacent(line) {
  const out = [];
  for (const item of line) {          // ממוינים מימין לשמאל
    const prev = out[out.length - 1];
    // רוחב תו ממוצע — רווח בין מילים באותו תא קטן ממנו, מרווח בין עמודות גדול
    const charW = item.str.length ? (item.right - item.x) / item.str.length : 4.5;
    if (prev && prev.x - item.right < charW * 1.4) {
      prev.str = `${prev.str} ${item.str}`;
      prev.x = item.x;                // התא מתרחב שמאלה
      continue;
    }
    out.push({ ...item });
  }
  return out;
}

/**
 * כל שורות הכותרת בעמוד. עמוד בדוח אשראי מכיל לא פעם שתי טבלאות
 * שונות — "רכישות בחו״ל" ו"עסקות שחויבו/זוכו בארץ" — ולכל אחת
 * מבנה עמודות משלה. כותרת אחת לכל העמוד קוראת את הטבלה השנייה עקום.
 */
function findHeaderLines(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const merged = mergeAdjacent(lines[i]);
    const found = new Set();
    for (const item of merged) {
      const field = matchHeader(item.str);
      if (field) found.add(field);
    }
    const hasDate = found.has('date') || found.has('billingDate');
    const hasAmount = found.has('amount') || found.has('billingAmount')
      || found.has('debit') || found.has('credit');
    if (hasDate && hasAmount && found.size >= 3) out.push({ line: lines[i], merged, index: i, score: found.size });
  }
  return out;
}

/** השורה עם הכי הרבה כותרות מזוהות, ובלבד שיש בה תאריך וסכום */
function findHeaderLine(lines) {
  const all = findHeaderLines(lines);
  if (!all.length) return null;
  return all.reduce((a, b) => (b.score > a.score ? b : a));
}

/**
 * כותרת של דוח אשראי נפרסת על שתיים-שלוש שורות:
 * "סכום / עסקה" מול "סכום / החיוב". בלי השורות הנוספות שתי העמודות
 * נראות זהות והסכום נקרא מהעמודה הלא נכונה.
 * מחזיר את מספר השורות שנבלעו, כדי לא לקרוא אותן כשורות תנועה.
 */
function absorbHeaderTail(columns, lines, headerIndex, maxLines = 2) {
  let taken = 0;
  for (let k = 1; k <= maxLines; k++) {
    const line = lines[headerIndex + k];
    if (!line) break;
    const text = line.map((i) => i.str).join(' ');
    // תאריך או סכום = כבר שורת נתונים
    if (/\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}/.test(text)) break;
    if (/\d[\d,]*\.\d{2}/.test(text)) break;
    if (/\d{2,}/.test(text)) break;
    let matched = 0;
    for (const item of mergeAdjacent(line)) {
      const idx = columnFor(item, columns);
      if (idx === -1) continue;
      columns[idx].label = `${columns[idx].label} ${item.str}`;
      matched++;
    }
    if (!matched) break;
    taken++;
  }
  return taken;
}

/**
 * עמודות מימין לשמאל, כשלכל עמודה טווח מלא ולא רק רוחב מילות הכותרת:
 * הגבול בין שתי עמודות הוא אמצע הרווח שביניהן. בלי זה שם באנגלית
 * שמיושר לשמאל בתוך עמודה רחבה נופל מחוץ לכל טווח ונזרק.
 */
function buildColumns(header) {
  const cells = header.merged || header;
  const cols = cells
    .map((item) => ({ label: item.str, right: item.right, x: item.x }))
    .sort((a, b) => b.right - a.right);
  const MARGIN = 200;
  for (let i = 0; i < cols.length; i++) {
    const left = cols[i + 1];
    cols[i].hi = i === 0 ? cols[i].right + MARGIN : (cols[i - 1].x + cols[i].right) / 2;
    cols[i].lo = left ? (cols[i].x + left.right) / 2 : cols[i].x - MARGIN;
  }
  return cols;
}

/**
 * שיוך כל תא לעמודה הקרובה ביותר לפי הקצה הימני.
 * תא שרחוק מכל העמודות (מספור עמודים, סימני עיצוב בשוליים) נזרק.
 */
function assignToColumns(line, columns) {
  const cells = columns.map(() => '');
  for (const item of line) {
    const idx = columnFor(item, columns);
    if (idx === -1) continue;
    cells[idx] = cells[idx] ? `${cells[idx]} ${item.str}` : item.str;
  }
  return cells;
}

/**
 * חפיפה אופקית עם טווח העמודה היא המדד האמין:
 * היא עובדת גם למספרים שמיושרים לימין וגם לשמות באנגלית
 * שמיושרים לשמאל. הקצה הימני משמש רק כגיבוי.
 */
function columnFor(item, columns) {
  // שם בית עסק באנגלית מיושר לשמאל וגולש אל תוך העמודה שמשמאלו.
  // עמודת סכום מיושרת לימין, ולכן טקסט שאינו נצמד לקצה הימני שלה
  // אינו יכול להיות שייך לה — הוא של עמודת השם.
  const isText = /[A-Za-z\u0590-\u05FF]{2,}/.test(item.str);
  let best = -1;
  let bestOverlap = 0;
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    if (isText && c.numeric && Math.abs(item.right - c.right) > 4) continue;
    const overlap = Math.min(item.right, c.hi) - Math.max(item.x, c.lo);
    if (overlap > bestOverlap) { bestOverlap = overlap; best = i; }
  }
  if (best !== -1) return best;
  // שם קצר באנגלית ("ANAIS") יושב בין הכותרות; מצרפים אותו לעמודת
  // הטקסט הקרובה ביותר במקום לזרוק אותו
  if (isText) {
    let bestGap = Infinity;
    for (let i = 0; i < columns.length; i++) {
      const c = columns[i];
      if (c.numeric) continue;
      const gap = Math.max(c.lo - item.right, item.x - c.hi, 0);
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    if (best !== -1 && bestGap <= 30) return best;
  }
  return nearestColumn(item.right, columns);
}

const NUMERIC_FIELDS = new Set(['amount', 'billingAmount', 'debit', 'credit', 'balance', 'originalAmount']);

/** סימון העמודות המספריות, אחרי שהכותרת הורכבה מכל שורותיה */
function markNumericColumns(columns) {
  for (const c of columns) c.numeric = NUMERIC_FIELDS.has(matchHeader(c.label));
}

function nearestColumn(right, columns) {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < columns.length; i++) {
    const d = Math.abs(columns[i].right - right);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  if (best === -1) return -1;
  // הסבלנות היא חצי מהמרווח לעמודה השכנה הקרובה ביותר
  const gaps = [];
  if (columns[best - 1]) gaps.push(Math.abs(columns[best - 1].right - columns[best].right));
  if (columns[best + 1]) gaps.push(Math.abs(columns[best + 1].right - columns[best].right));
  const tolerance = gaps.length ? Math.max(18, Math.min(...gaps) / 2) : 90;
  return bestDist <= tolerance ? best : -1;
}

/* ============================================================
   זיהוי שורת הכותרות ומיפוי עמודות
   ============================================================ */

const HEADER_PATTERNS = {
  date: [/תאריך\s*עסקה/, /תאריך\s*ה?עסקה/, /^תאריך$/, /תאריך\s*רכישה/, /תאריך\s*הפעולה/, /^date$/i, /transaction\s*date/i, /יום\s*עסקה/],
  billingDate: [/תאריך\s*חיוב/, /מועד\s*חיוב/, /תאריך\s*ערך/, /billing\s*date/i, /value\s*date/i],
  merchant: [/שם\s*בית\s*ה?עסק/, /בית\s*עסק/, /^ספק$/, /שם\s*ספק/, /מוטב/, /שם\s*המוטב/, /merchant/i, /payee/i, /vendor/i],
  description: [/תיאור\s*ה?פעולה/, /^תיאור$/, /^פעולה$/, /^פרטים$/, /פירוט/, /תנועה/, /^description$/i, /details/i, /narrative/i],
  // "סכום החיוב" הוא מה שנגבה בפועל החודש; "סכום עסקה" הוא הסכום המקורי.
  // בעסקה בתשלומים או במטבע חוץ השניים שונים, ולכן הם שדות נפרדים.
  billingAmount: [/סכום\s*ה?חיוב/, /סכום\s*לחיוב/, /סכום\s*לתשלום/, /charge\s*amount/i],
  amount: [/סכום\s*ה?עסקה/, /^סכום$/, /סכום\s*בש"?ח/, /סכום\s*₪/, /^amount$/i, /^sum$/i, /charge/i],
  debit: [/^חובה$/, /חיוב/, /^debit$/i, /משיכות/, /^בחובה$/],
  credit: [/^זכות$/, /^זיכוי$/, /^credit$/i, /הפקדות/, /^בזכות$/],
  balance: [/^יתרה/, /יתרה\s*בחשבון/, /^balance$/i, /^יתרה\s*בש"?ח$/],
  currency: [/^מטבע$/, /סוג\s*מטבע/, /^currency$/i],
  originalAmount: [/סכום\s*מקורי/, /סכום\s*במטבע/, /original\s*amount/i],
  card: [/4\s*ספרות/, /ספרות\s*אחרונות/, /מספר\s*כרטיס/, /^כרטיס$/, /card\s*number/i, /last\s*4/i],
  account: [/^חשבון$/, /מספר\s*חשבון/, /^account$/i],
  type: [/סוג\s*עסקה/, /סוג\s*ה?פעולה/, /^סוג$/, /אופן\s*ה?עסקה/, /transaction\s*type/i],
  installments: [/מספר\s*תשלומים/, /פירוט\s*תשלומים/, /^תשלומים$/, /תשלום\s*מספר/, /installments?/i],
  reference: [/אסמכתא/, /מספר\s*אסמכתא/, /^reference$/i, /^ref$/i, /מזהה/],
  category: [/^ענף$/, /קטגוריה/, /^category$/i],
};

function matchHeader(cell) {
  const s = String(cell || '').replace(/[\s‎‏]+/g, ' ').trim();
  if (!s) return null;
  for (const [field, pats] of Object.entries(HEADER_PATTERNS)) {
    for (const p of pats) if (p.test(s)) return field;
  }
  return null;
}

/**
 * מאתר את שורת הכותרות במטריצה: השורה עם הכי הרבה התאמות,
 * ובלבד שיש בה לפחות תאריך + (סכום או חובה/זכות).
 */
export function detectHeader(matrix, maxScan = 25) {
  let best = { index: -1, score: 0, map: {} };
  const limit = Math.min(matrix.length, maxScan);
  for (let r = 0; r < limit; r++) {
    const row = matrix[r] || [];
    const map = {};
    let score = 0;
    for (let c = 0; c < row.length; c++) {
      const field = matchHeader(row[c]);
      if (field && map[field] === undefined) { map[field] = c; score++; }
    }
    const hasDate = map.date !== undefined || map.billingDate !== undefined;
    const hasAmount = map.amount !== undefined || map.billingAmount !== undefined
      || map.debit !== undefined || map.credit !== undefined;
    if (hasDate && hasAmount && score > best.score) best = { index: r, score, map };
  }
  return best;
}

/* ============================================================
   המרת שורות למבנה אחיד
   ============================================================ */

const NOISE = [
  /^סה"?כ/, /^סך\s*הכל/, /^יתרת\s*פתיחה/, /^יתרת\s*סגירה/, /^total/i,
  /^ריכוז/, /^עמוד\s*\d/, /^המשך\s*בעמוד/, /^אין\s*תנועות/,
];

function isNoiseRow(cells) {
  const joined = cells.join(' ').trim();
  if (!joined) return true;
  return NOISE.some((p) => p.test(joined));
}

/** חילוץ 4 ספרות אחרונות מכל טקסט */
export function extractLast4(text) {
  const s = String(text || '');
  let m = s.match(/(?:\*{2,}|x{2,}|X{2,}|-)\s*(\d{4})\b/);
  if (m) return m[1];
  m = s.match(/\b(\d{4})\s*$/);
  if (m && !/\d{5,}/.test(s)) return m[1];
  m = s.match(/\b\d{8,}(\d{4})\b/);
  if (m) return m[1];
  return null;
}

/** חילוץ מידע תשלומים: "תשלום 2 מתוך 6" / "2/6" / "6 תשלומים" */
export function extractInstallments(text) {
  const s = String(text || '').replace(/\s+/g, ' ');
  let m = s.match(/תשלום\s*(\d{1,2})\s*(?:מ|מתוך|\/)\s*(\d{1,2})/);
  if (m) return { current: Number(m[1]), total: Number(m[2]) };
  m = s.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\s*תשלומים?/);
  if (m) return { current: Number(m[1]), total: Number(m[2]) };
  m = s.match(/^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/);
  if (m && Number(m[2]) > 1 && Number(m[2]) <= 60 && Number(m[1]) <= Number(m[2])) {
    return { current: Number(m[1]), total: Number(m[2]) };
  }
  m = s.match(/\bב-?\s*(\d{1,2})\s*תשלומים\b/);
  if (m) return { current: 1, total: Number(m[1]) };
  return null;
}

/**
 * המרת מטריצה לשורות גולמיות אחידות.
 * מחזיר { rows, mapping, headerIndex, warnings }
 */
export function matrixToRows(matrix, opts = {}) {
  const warnings = [];
  const header = detectHeader(matrix);

  if (header.index === -1) {
    const rows = looseParse(matrix);
    if (!rows.length) {
      throw new Error('לא זוהו עמודות תאריך וסכום בקובץ. ניתן לייצא מהבנק כ-CSV ולנסות שוב.');
    }
    warnings.push('לא זוהתה שורת כותרות ברורה — הנתונים חולצו בזיהוי חופשי. מומלץ לעבור על התוצאות.');
    return { rows, mapping: {}, headerIndex: -1, warnings };
  }

  const map = header.map;
  const out = [];
  const hintYear = opts.hintYear || new Date().getFullYear();

  // דוח כרטיס אשראי: יש בו שם בית עסק ועמודת חיוב, ואין חובה/זכות.
  // בדוח כזה סכום חיובי הוא הוצאה.
  const headerText = (matrix[header.index] || []).join(' ');
  const looksLikeCreditReport = map.debit === undefined && map.credit === undefined
    && map.merchant !== undefined && /חיוב/.test(headerText);
  const chargesArePositive = opts.sourceKind === 'credit' || looksLikeCreditReport;
  // כשיש גם "סכום עסקה" וגם "סכום החיוב" — הסכום שנגבה החודש הוא הקובע.
  const amountField = map.billingAmount !== undefined ? 'billingAmount' : 'amount';
  const originalField = map.billingAmount !== undefined && map.amount !== undefined ? 'amount' : 'originalAmount';

  for (let r = header.index + 1; r < matrix.length; r++) {
    const cells = (matrix[r] || []).map((c) => (c === null || c === undefined ? '' : String(c).trim()));
    if (isNoiseRow(cells)) continue;

    const pick = (f) => (map[f] !== undefined ? cells[map[f]] : '');

    const date = parseDate(pick('date'), hintYear) || parseDate(pick('billingDate'), hintYear);
    if (!date) continue;

    const billingDate = parseDate(pick('billingDate'), hintYear);

    let amount = null;
    let direction = null;

    if (map.debit !== undefined || map.credit !== undefined) {
      const deb = parseNumber(pick('debit'));
      const cred = parseNumber(pick('credit'));
      if (deb && Math.abs(deb) > 0) { amount = Math.abs(deb); direction = 'expense'; }
      else if (cred && Math.abs(cred) > 0) { amount = Math.abs(cred); direction = 'income'; }
    }
    if (amount === null && map[amountField] !== undefined) {
      const v = parseNumber(pick(amountField));
      if (v !== null) {
        amount = Math.abs(v);
        // בעמודת סכום יחידה הסימן לבדו אינו מספיק:
        // בדוח אשראי כל השורות הן חיובים והסכומים חיוביים,
        // ואילו בדף עו״ש סכום שלילי הוא חיוב.
        direction = chargesArePositive
          ? (v < 0 ? 'income' : 'expense')
          : (v < 0 ? 'expense' : 'income');
      }
    }
    if (amount === null || amount === 0) continue;

    // עמודת "סוג" יכולה להכריע כיוון בדוחות שבהם הסכום תמיד חיובי
    const typeText = pick('type');
    if (/זיכוי|החזר|ביטול/.test(typeText)) direction = 'income';
    else if (/חיוב|רכישה|משיכה/.test(typeText)) direction = 'expense';

    const merchantRaw = pick('merchant') || pick('description') || '';
    const descRaw = pick('description') || '';
    const joined = `${merchantRaw} ${descRaw} ${typeText} ${pick('installments')}`;

    out.push({
      rowIndex: r,
      date,
      billingDate,
      merchant: cleanMerchant(merchantRaw || descRaw),
      description: descRaw && descRaw !== merchantRaw ? descRaw : '',
      rawText: cells.join(' | '),
      amount: round2(amount),
      direction: direction || 'expense',
      currency: normalizeCurrency(pick('currency')),
      originalAmount: parseNumber(pick(originalField)) ?? parseNumber(pick('originalAmount')),
      cardLast4: extractLast4(pick('card')) || extractLast4(joined),
      accountRef: pick('account') || null,
      typeText,
      installment: extractInstallments(pick('installments') || joined),
      externalId: pick('reference') || null,
      sourceCategory: pick('category') || null,
      balanceAfter: parseNumber(pick('balance')),
    });
  }

  if (!out.length) warnings.push('זוהתה שורת כותרות אך לא נמצאו שורות תנועה תקינות.');
  return { rows: out, mapping: map, headerIndex: header.index, warnings };
}

/**
 * זיהוי חופשי לקבצים ללא כותרות (בעיקר PDF):
 * שורה שמכילה תאריך + סכום נחשבת תנועה.
 */
function looseParse(matrix) {
  const out = [];
  for (let r = 0; r < matrix.length; r++) {
    const cells = (matrix[r] || []).map((c) => String(c ?? '').trim()).filter(Boolean);
    if (!cells.length || isNoiseRow(cells)) continue;

    let date = null, dateIdx = -1;
    for (let i = 0; i < cells.length; i++) {
      const d = parseDate(cells[i]);
      if (d) { date = d; dateIdx = i; break; }
    }
    if (!date) continue;

    // הסכום: המספר האחרון בשורה שנראה כמו כסף
    let amount = null, amtIdx = -1;
    for (let i = cells.length - 1; i >= 0; i--) {
      if (i === dateIdx) continue;
      if (parseDate(cells[i]) && /\d{1,2}[./-]\d{1,2}/.test(cells[i])) continue;
      const v = parseNumber(cells[i]);
      if (v !== null && Math.abs(v) >= 0.5 && /[\d,]\.?\d*/.test(cells[i])) { amount = v; amtIdx = i; break; }
    }
    if (amount === null) continue;

    const textCells = cells.filter((_, i) => i !== dateIdx && i !== amtIdx && parseNumber(cells[i]) === null);
    const merchant = cleanMerchant(textCells.join(' ').trim());
    if (!merchant) continue;

    const joined = cells.join(' ');
    out.push({
      rowIndex: r,
      date,
      billingDate: null,
      merchant,
      description: '',
      rawText: joined,
      amount: round2(Math.abs(amount)),
      direction: amount < 0 || /זיכוי|החזר|ביטול/.test(joined) ? (amount < 0 ? 'expense' : 'income') : 'expense',
      currency: 'ILS',
      originalAmount: null,
      cardLast4: extractLast4(joined),
      accountRef: null,
      typeText: '',
      installment: extractInstallments(joined),
      externalId: null,
      sourceCategory: null,
      balanceAfter: null,
    });
  }
  return out;
}

function cleanMerchant(s) {
  return String(s || '')
    .replace(/[‎‏‪-‮]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^["'\-\s]+|["'\-\s]+$/g, '')
    .trim();
}

function normalizeCurrency(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'ILS';
  if (/₪|ש"?ח|שקל|ILS|NIS/i.test(s)) return 'ILS';
  if (/\$|USD|דולר/i.test(s)) return 'USD';
  if (/€|EUR|אירו/i.test(s)) return 'EUR';
  if (/£|GBP|שטרלינג/i.test(s)) return 'GBP';
  return s.slice(0, 3).toUpperCase();
}

/**
 * חילוץ פרטי החשבון מכותרת הדוח.
 * ------------------------------------------------------------
 * דוחות בנק פותחים בשורת כותרות ("בנק / סניף / חשבון / שם חשבון")
 * ומתחתיה השורה עם הערכים. נשמרות 4 הספרות האחרונות בלבד —
 * מספר החשבון המלא לא נשמר ולא עוזב את המכשיר.
 */
export function extractAccountInfo(matrix) {
  const LABELS = {
    bank: /^בנק$/,
    branch: /^סניף$/,
    account: /^(מספר\s*)?חשבון$/,
    owner: /^שם\s*חשבון$/,
  };
  for (let r = 0; r < Math.min(matrix.length, 30); r++) {
    const row = (matrix[r] || []).map((c) => String(c ?? '').trim());
    const map = {};
    row.forEach((cell, i) => {
      for (const [key, re] of Object.entries(LABELS)) {
        if (map[key] === undefined && re.test(cell)) map[key] = i;
      }
    });
    if (map.account === undefined || map.branch === undefined) continue;

    const values = (matrix[r + 1] || []).map((c) => String(c ?? '').trim());
    if (!values.length) continue;
    const digits = (i) => (i === undefined ? '' : String(values[i] || '').replace(/\D/g, ''));
    const account = digits(map.account);
    if (!account) continue;

    const institution = detectInstitution(matrix);
    return {
      institution,
      bank: digits(map.bank) || null,
      branch: digits(map.branch) || null,
      last4: account.slice(-4),
      owner: map.owner !== undefined ? String(values[map.owner] || '').trim() : '',
    };
  }
  return null;
}

/** שם הבנק מתוך כתובת האתר או הטקסט שבראש הדוח */
function detectInstitution(matrix) {
  const head = matrix.slice(0, 12).map((r) => (r || []).join(' ')).join(' ').toLowerCase();
  const known = [
    [/bankhapoalim|הפועלים/, 'בנק הפועלים'],
    [/leumi|לאומי/, 'בנק לאומי'],
    [/mizrahi|tefahot|מזרחי|טפחות/, 'מזרחי טפחות'],
    [/discount|דיסקונט/, 'בנק דיסקונט'],
    [/fibi|בינלאומי/, 'הבנק הבינלאומי'],
    [/otsar|אוצר\s*החייל/, 'אוצר החייל'],
    [/massad|מסד/, 'בנק מסד'],
    [/yahav|יהב/, 'בנק יהב'],
    [/pagi|פאג"?י/, 'פאג״י'],
    [/one\s*zero|וואן\s*זירו/, 'ONE ZERO'],
  ];
  for (const [re, name] of known) if (re.test(head)) return name;
  return '';
}

/** נקודת הכניסה הראשית: קובץ → שורות גולמיות */
export async function parseFile(file, opts = {}) {
  const { sections, kind, sheets, rawHead, rawAll } = await readFileToMatrix(file);

  const rows = [];
  const warnings = [];
  let mapping = {};
  let headerIndex = -1;
  let rawRowCount = 0;

  for (const section of sections) {
    const matrix = section.labels ? [section.labels, ...section.rows] : section.rows;
    rawRowCount += matrix.length;
    if (!matrix.length) continue;
    try {
      const res = matrixToRows(matrix, opts);
      rows.push(...res.rows);
      if (!Object.keys(mapping).length && Object.keys(res.mapping).length) {
        mapping = res.mapping;
        headerIndex = res.headerIndex;
      }
      for (const w of res.warnings) if (!warnings.includes(w)) warnings.push(w);
    } catch (err) {
      // מקטע אחד שנכשל (למשל עמוד הסברים) לא מפיל את כל הקובץ
      if (sections.length === 1) throw err;
    }
  }

  if (!rows.length) {
    throw new Error('לא זוהו תנועות בקובץ. ניתן לייצא מהבנק או מחברת האשראי כ-CSV ולנסות שוב.');
  }

  const stmtDate = statementDate(rawAll, rows);
  if (stmtDate) {
    // עסקה בתשלומים נושאת את תאריך הרכישה המקורי (לעיתים משנה קודמת),
    // אך התשלום החודשי שייך לחודש החיוב של הדוח.
    for (const row of rows) if (row.installment && !row.billingDate) row.billingDate = stmtDate;
    rows.push(...statementExtras(rawAll, stmtDate));
  }

  const accountInfo = extractAccountInfo(rawHead && rawHead.length ? rawHead : (sections[0]?.rows || []));
  return {
    accountInfo,
    fileName: file.name,
    fileType: kind,
    fileSize: file.size,
    sheets,
    rows,
    mapping,
    headerIndex,
    warnings,
    rawRowCount,
  };
}

/**
 * שורות שמופיעות בדוח האשראי מחוץ לטבלה אך נכללות בסכום החיוב:
 * דמי כרטיס והנחת מועדון. בלעדיהן סכום הייבוא לא מסתדר מול
 * החיוב המרוכז שמופיע בדף העו״ש.
 */
function statementExtras(rawAll, stmtDate) {
  const extras = [];

  // דמי כרטיס/הנפקה — הסכום מופיע לפני המילים "סה\"כ כולל מע\"מ"
  const feeAt = rawAll.findIndex((l) => /דמי\s*כרטיס/.test(l));
  if (feeAt !== -1) {
    let total = null;
    for (let i = feeAt + 1; i < Math.min(feeAt + 4, rawAll.length); i++) {
      const m = rawAll[i].match(/^(-?[\d,]+\.\d{2})\s*סה"?כ\s*כולל\s*מע"?מ/);
      if (m) { total = parseNumber(m[1]); break; }
    }
    // מעבר עמוד יכול להפריד בין הפירוט לשורת הסיכום — אז מחברים קרן ומע״מ
    if (total === null) {
      const base = parseNumber((rawAll[feeAt].match(/([\d,]+\.\d{2})/) || [])[1]);
      const next = rawAll[feeAt + 1] || '';
      const vat = /מע"?מ/.test(next) ? parseNumber((next.match(/^([\d,]+\.\d{2})/) || [])[1]) : 0;
      if (base) total = round2(base + (vat || 0));
    }
    if (total) extras.push(makeExtra(stmtDate, 'דמי כרטיס', Math.abs(total), 'expense', rawAll[feeAt]));
  }

  // הנחת מועדון — מקוזזת מסכום החיוב
  const seen = new Set();
  for (const line of rawAll) {
    const m = line.match(/סה"?כ\s*הנחה\s*([\d,]+\.\d{2})/);
    if (!m || seen.has(line)) continue;
    seen.add(line);
    const amount = parseNumber(m[1]);
    if (amount) extras.push(makeExtra(stmtDate, 'הנחת מועדון', Math.abs(amount), 'income', line));
  }
  return extras;
}

/** מועד החיוב של הדוח — "פרוט פעולותיך לתאריך: 10/08/26" */
function statementDate(rawAll, rows) {
  if (!rawAll || !rawAll.length) return null;
  const line = rawAll.find((l) => /פעולותיך\s*לתאריך/.test(l)) || '';
  const fromLine = parseDate((line.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/) || [])[1]);
  if (fromLine) return fromLine;
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  return dates[dates.length - 1] || null;
}

function makeExtra(date, merchant, amount, direction, rawText) {
  return {
    rowIndex: -1,
    date,
    billingDate: null,
    merchant,
    description: '',
    rawText,
    amount: round2(amount),
    direction,
    currency: 'ILS',
    originalAmount: null,
    cardLast4: null,
    accountRef: null,
    typeText: '',
    installment: null,
    externalId: null,
    sourceCategory: null,
    balanceAfter: null,
  };
}

export { normalizeMerchant };

/* עזרי חילוץ הטבלה — מיוצאים כדי שניתן יהיה לבדוק אותם ישירות */
export { groupIntoLines, findHeaderLine, buildColumns, assignToColumns, statementExtras, statementDate };
