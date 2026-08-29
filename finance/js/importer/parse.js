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
    return { matrix: rows, kind: 'csv', sheets: null };
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
    return { matrix: best || [], kind: 'xlsx', sheets };
  }

  if (ext === 'pdf') {
    return { matrix: await readPdfToMatrix(file), kind: 'pdf', sheets: null };
  }

  throw new Error(`סוג הקובץ .${ext} אינו נתמך. ניתן להעלות CSV, Excel או PDF.`);
}

/**
 * PDF: מחלצים טקסט עם מיקומים ומקבצים לשורות לפי קו Y.
 * דוחות אשראי רבים בעברית מגיעים כטבלה — הקיבוץ הזה משחזר אותה סבירות.
 */
async function readPdfToMatrix(file) {
  await loadScript(CDN.pdfjs);
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib) throw new Error('ספריית ה-PDF לא נטענה.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = CDN.pdfWorker;

  const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const rows = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const lines = new Map();
    for (const item of content.items) {
      const str = String(item.str || '').trim();
      if (!str) continue;
      const y = Math.round(item.transform[5] / 3) * 3; // סבלנות של 3 יחידות
      const x = item.transform[4];
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push({ x, str });
    }
    const ordered = [...lines.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, items] of ordered) {
      // מימין לשמאל — מסמכים בעברית
      items.sort((a, b) => b.x - a.x);
      rows.push(items.map((i) => i.str));
    }
  }
  return rows;
}

/* ============================================================
   זיהוי שורת הכותרות ומיפוי עמודות
   ============================================================ */

const HEADER_PATTERNS = {
  date: [/תאריך\s*עסקה/, /תאריך\s*ה?עסקה/, /^תאריך$/, /תאריך\s*רכישה/, /תאריך\s*הפעולה/, /^date$/i, /transaction\s*date/i, /יום\s*עסקה/],
  billingDate: [/תאריך\s*חיוב/, /מועד\s*חיוב/, /תאריך\s*ערך/, /billing\s*date/i, /value\s*date/i],
  merchant: [/שם\s*בית\s*ה?עסק/, /בית\s*עסק/, /^ספק$/, /שם\s*ספק/, /מוטב/, /שם\s*המוטב/, /merchant/i, /payee/i, /vendor/i],
  description: [/תיאור\s*ה?פעולה/, /^תיאור$/, /^פרטים$/, /פירוט/, /תנועה/, /^description$/i, /details/i, /narrative/i],
  amount: [/סכום\s*חיוב/, /סכום\s*ה?עסקה/, /^סכום$/, /סכום\s*בש"?ח/, /סכום\s*₪/, /^amount$/i, /^sum$/i, /charge/i],
  debit: [/^חובה$/, /חיוב/, /^debit$/i, /משיכות/, /^בחובה$/],
  credit: [/^זכות$/, /^זיכוי$/, /^credit$/i, /הפקדות/, /^בזכות$/],
  balance: [/^יתרה$/, /יתרה\s*בחשבון/, /^balance$/i],
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
    const hasAmount = map.amount !== undefined || map.debit !== undefined || map.credit !== undefined;
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
    if (amount === null && map.amount !== undefined) {
      const v = parseNumber(pick('amount'));
      if (v !== null) {
        amount = Math.abs(v);
        direction = v < 0 ? 'expense' : 'income';
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
      originalAmount: parseNumber(pick('originalAmount')),
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

/** נקודת הכניסה הראשית: קובץ → שורות גולמיות */
export async function parseFile(file) {
  const { matrix, kind, sheets } = await readFileToMatrix(file);
  const { rows, mapping, headerIndex, warnings } = matrixToRows(matrix, {});
  return {
    fileName: file.name,
    fileType: kind,
    fileSize: file.size,
    sheets,
    rows,
    mapping,
    headerIndex,
    warnings,
    rawRowCount: matrix.length,
  };
}

export { normalizeMerchant };
