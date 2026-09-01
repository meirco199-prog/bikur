/* ============================================================
   dedupe.js — זיהוי כפילויות, חיובים מרוכזים, העברות וזיכויים
   ------------------------------------------------------------
   כל הבדיקות דטרמיניסטיות ומבוססות השוואת שדות בלבד.
   ============================================================ */

import { normalizeMerchant, similarity, round2, monthKeyOf } from '../core/util.js';

/* ============================================================
   כפילויות
   ============================================================ */

const DUP_LEVELS = {
  exact:    { level: 'exact',    label: 'כפילות ודאית',  score: 99 },
  likely:   { level: 'likely',   label: 'כפילות סבירה',  score: 85 },
  possible: { level: 'possible', label: 'ייתכן שכבר קיים', score: 62 },
  repeat:   { level: 'repeat',   label: 'מופיע פעמיים בקובץ', score: 40 },
};

/** הפרש ימים בין שני תאריכי ISO */
function daysBetween(a, b) {
  const da = new Date(`${a}T00:00:00`);
  const db = new Date(`${b}T00:00:00`);
  return Math.abs(Math.round((da - db) / 86400000));
}

/** מפתח זיהוי חזק לתנועה */
export function strongKey(tx) {
  return [
    tx.date,
    Math.abs(round2(tx.amount)).toFixed(2),
    normalizeMerchant(tx.merchant || tx.name),
    tx.accountId || '-',
  ].join('|');
}

/**
 * בדיקת כפילות של שורה מול תנועות קיימות ומול השורות שכבר עובדו באותו קובץ.
 * מחזיר null אם אין חשד.
 */
export function checkDuplicate(row, ctx) {
  const { existing = [], batchSeen = new Map(), accountId = null } = ctx;
  const amount = Math.abs(round2(row.amount));
  const rowMerchant = normalizeMerchant(row.merchant || row.name);

  /* --- 1. מזהה חיצוני זהה באותו חשבון --- */
  if (row.externalId) {
    const hit = existing.find((t) =>
      t.externalId && String(t.externalId) === String(row.externalId) &&
      (!accountId || !t.accountId || t.accountId === accountId));
    if (hit) return { ...DUP_LEVELS.exact, txId: hit.id, reason: `מזהה חיצוני זהה (${row.externalId})` };
  }

  /* --- 2. שורה זהה פעמיים באותו קובץ --- */
  // דוח אחד מפרט את מה שקרה בפועל: שתי קניות זהות באותו יום הן שתי
  // עסקאות אמיתיות, לא כפילות. מסמנים לתשומת לב בלבד ולא מבטלים סימון —
  // ייבוא חוזר של אותו קובץ נתפס ממילא מול התנועות הקיימות.
  const bkey = `${row.date}|${amount.toFixed(2)}|${rowMerchant}`;
  const prev = batchSeen.get(bkey);
  if (prev !== undefined) {
    const prevIndex = typeof prev === 'object' ? prev.index : prev;
    const prevRef = typeof prev === 'object' ? prev.externalId : null;
    // אסמכתא זהה = בוודאות אותה תנועה שנרשמה פעמיים.
    // בלי אסמכתא אין ראיה לכפילות, ולרוב אלה שתי עסקאות אמיתיות.
    const sameRef = row.externalId && prevRef && String(row.externalId) === String(prevRef);
    return {
      ...(sameRef ? DUP_LEVELS.exact : DUP_LEVELS.repeat),
      txId: null,
      batchIndex: prevIndex,
      reason: sameRef
        ? `אותה אסמכתא (${row.externalId}) מופיעה פעמיים בקובץ`
        : 'שורה זהה מופיעה פעמיים באותו קובץ',
    };
  }

  /* --- 3. תאריך + סכום + בית עסק + חשבון --- */
  // בעסקת תשלומים כל החיובים החודשיים נושאים את תאריך הרכישה המקורי
  // ואת אותו סכום; מה שמבדיל ביניהם הוא חודש החיוב.
  const rowMonth = monthKeyOf(row.billingDate || row.date);
  for (const t of existing) {
    if (Math.abs(round2(t.amount)) !== amount) continue;
    if (t.date !== row.date) continue;
    if (t.month && rowMonth && t.month !== rowMonth) continue;
    if (accountId && t.accountId && t.accountId !== accountId) continue;
    const sim = similarity(t.merchant || t.name, row.merchant);
    if (sim >= 0.92) {
      return { ...DUP_LEVELS.exact, txId: t.id, reason: 'אותו תאריך, סכום ובית עסק' };
    }
    if (sim >= 0.6) {
      return { ...DUP_LEVELS.likely, txId: t.id, reason: 'אותו תאריך וסכום, תיאור דומה' };
    }
  }

  /* --- 4. סכום זהה בטווח 3 ימים עם בית עסק דומה --- */
  for (const t of existing) {
    if (Math.abs(round2(t.amount)) !== amount) continue;
    const dd = daysBetween(t.date, row.date);
    if (dd === 0 || dd > 3) continue;
    const sim = similarity(t.merchant || t.name, row.merchant);
    if (sim >= 0.8) {
      return { ...DUP_LEVELS.likely, txId: t.id, reason: `סכום זהה בהפרש ${dd} ימים, בית עסק דומה` };
    }
  }

  /* --- 5. אותו חודש, אותו סכום ובית עסק זהה --- */
  for (const t of existing) {
    if (t.month !== rowMonth) continue;
    if (Math.abs(round2(t.amount)) !== amount) continue;
    if (normalizeMerchant(t.merchant || t.name) !== rowMerchant || !rowMerchant) continue;
    return { ...DUP_LEVELS.possible, txId: t.id, reason: 'אותו סכום ובית עסק באותו חודש' };
  }

  return null;
}

/* ============================================================
   חיובי אשראי מרוכזים
   ============================================================ */

const CARD_ISSUERS = [
  'ישראכרט', 'ישרא כרט', 'isracard', 'כאל', 'cal ', 'כרטיסי אשראי לישראל',
  'לאומי קארד', 'max ', 'מקס איט', 'מקס פיננסים', 'american express', 'אמריקן אקספרס',
  'דיינרס', 'diners', 'premium express', 'ויזה כאל', 'ישראכרט מימון',
];
const SETTLEMENT_HINTS = [/חיוב\s*כרטיס/, /ריכוז\s*חיובים/, /פרעון\s*כרטיס/, /חיוב\s*אשראי/, /כרטיסי?\s*אשראי/];

/**
 * זיהוי חיוב אשראי מרוכז בדף עו"ש.
 * חיוב כזה אינו נספר כהוצאה נוספת כאשר עסקאות אותו כרטיס יובאו בפועל
 * (ראו settlementsToExclude ב-domain/finance.js).
 */
export function detectSettlement(row, ctx = {}) {
  const { accounts = [], minAmount = 400 } = ctx;
  if (row.direction !== 'expense') return null;
  const text = `${row.merchant || ''} ${row.description || ''} ${row.typeText || ''}`;
  const norm = normalizeMerchant(text);

  const issuer = CARD_ISSUERS.find((n) => norm.includes(normalizeMerchant(n)));
  const hinted = SETTLEMENT_HINTS.some((r) => r.test(text));
  if (!issuer && !hinted) return null;
  if (Math.abs(row.amount) < minAmount && !hinted) return null;

  // ניסיון לקשר לכרטיס לפי 4 ספרות, אחרת לפי מנפיק
  let card = null;
  if (row.cardLast4) card = accounts.find((a) => a.type === 'credit' && a.last4 === row.cardLast4) || null;
  if (!card && issuer) {
    card = accounts.find((a) => a.type === 'credit' && normalizeMerchant(`${a.name} ${a.institution}`).includes(normalizeMerchant(issuer))) || null;
  }

  return {
    isSettlement: true,
    settlementFor: card?.id || null,
    issuer: issuer || 'חברת אשראי',
    reason: card
      ? `חיוב מרוכז של ${card.name} — ייספר כהוצאה עד שיובא פירוט העסקאות של הכרטיס`
      : 'חיוב כרטיס אשראי מרוכז — ייספר כהוצאה עד שיובא פירוט העסקאות של הכרטיס',
  };
}

/**
 * קישור חיוב מרוכז לעסקאות שמרכיבות אותו.
 * מחזיר את העסקאות בחודש החיוב של אותו כרטיס וסכומן.
 */
export function linkSettlement(settlementTx, transactions) {
  if (!settlementTx.settlementFor) return { transactions: [], total: 0, diff: null };
  const month = settlementTx.month;
  const rows = transactions.filter((t) =>
    t.accountId === settlementTx.settlementFor &&
    t.month === month &&
    !t.isSettlement &&
    t.direction === 'expense');
  const total = round2(rows.reduce((s, t) => s + Math.abs(t.amount), 0));
  return {
    transactions: rows,
    total,
    diff: round2(Math.abs(settlementTx.amount) - total),
  };
}

/* ============================================================
   העברות פנימיות
   ============================================================ */

const TRANSFER_HINTS = [
  /העברה\s*עצמית/, /העברה\s*בין\s*חשבונות/, /העברה\s*לחשבון/, /העברה\s*מחשבון/,
  /משיכה\s*לחשבון/, /הפקדה\s*מחשבון/, /העברה\s*פנימית/, /transfer/i,
  /לחשבון\s*עסקי/, /מחשבון\s*עסקי/, /לחשבון\s*פרטי/, /מחשבון\s*פרטי/,
  /העברה\s*לחסכון/, /הפקדה\s*לחסכון/, /ניוד/,
];

/** זיהוי העברה פנימית לפי טקסט או לפי חשבון יעד מזוהה */
export function detectInternalTransfer(row, ctx = {}) {
  const { accounts = [] } = ctx;
  const text = `${row.merchant || ''} ${row.description || ''} ${row.typeText || ''}`;
  if (!TRANSFER_HINTS.some((r) => r.test(text))) return null;

  const norm = normalizeMerchant(text);
  const target = accounts.find((a) => {
    const n = normalizeMerchant(a.name);
    return n.length > 2 && norm.includes(n);
  }) || (row.cardLast4 ? accounts.find((a) => a.last4 === row.cardLast4) : null);

  return {
    internalTransfer: true,
    counterAccountId: target?.id || null,
    reason: target ? `העברה פנימית אל/מ־${target.name}` : 'זוהתה כהעברה פנימית בין חשבונות',
  };
}

/**
 * זיהוי זוגות העברה בתוך אותה קבוצת שורות:
 * אותו סכום, כיוונים הפוכים, בטווח 2 ימים.
 */
export function findTransferPairs(rows) {
  const pairs = [];
  const used = new Set();
  for (let i = 0; i < rows.length; i++) {
    if (used.has(i)) continue;
    const a = rows[i];
    for (let j = i + 1; j < rows.length; j++) {
      if (used.has(j)) continue;
      const b = rows[j];
      if (a.direction === b.direction) continue;
      if (Math.abs(round2(a.amount)) !== Math.abs(round2(b.amount))) continue;
      if (daysBetween(a.date, b.date) > 2) continue;
      if (a.accountId && b.accountId && a.accountId === b.accountId) continue;
      pairs.push({ a: i, b: j, amount: Math.abs(a.amount) });
      used.add(i); used.add(j);
      break;
    }
  }
  return pairs;
}

/* ============================================================
   זיכויים והחזרים
   ============================================================ */

const REFUND_HINTS = [
  /זיכוי/, /החזר/, /ביטול\s*עסקה/, /ביטול\s*חיוב/, /refund/i, /credit\s*note/i, /reversal/i,
];

/**
 * זיהוי זיכוי וקישורו לעסקה המקורית.
 * זיכוי נשמר ככיוון "הוצאה" עם דגל isRefund, כך שהוא מקטין
 * את ההוצאה בקטגוריה במקום להיספר כהכנסה.
 */
export function detectRefund(row, ctx = {}) {
  const { existing = [], windowDays = 120 } = ctx;
  const text = `${row.merchant || ''} ${row.description || ''} ${row.typeText || ''}`;
  const hinted = REFUND_HINTS.some((r) => r.test(text));

  // זיכוי בדוח אשראי מגיע ככיוון הכנסה
  const looksLikeCredit = row.direction === 'income' && row.sourceKind === 'credit';
  if (!hinted && !looksLikeCredit) return null;

  const amount = Math.abs(round2(row.amount));
  const merchant = normalizeMerchant(row.merchant);

  let original = null;
  let bestScore = 0;
  for (const t of existing) {
    if (t.direction !== 'expense' || t.isRefund) continue;
    if (Math.abs(round2(t.amount)) !== amount) continue;
    if (t.date > row.date) continue;
    if (daysBetween(t.date, row.date) > windowDays) continue;
    const sim = similarity(t.merchant || t.name, row.merchant) || (merchant ? 0 : 0.5);
    if (sim > bestScore) { bestScore = sim; original = t; }
  }
  if (original && bestScore < 0.55) original = null;

  // "זיכוי מלאומי" בדף עו״ש הוא העברה נכנסת מבנק אחר, לא החזר על קנייה.
  // בלי התנאי הזה הכנסות הופכות להוצאות שליליות והמספרים מתעוותים.
  // זיכוי אמיתי מזוהה רק כשנמצאה העסקה המקורית, או כשהשורה הגיעה
  // מפירוט כרטיס אשראי — שם זיכוי הוא תמיד ביטול עסקה.
  if (!original && row.sourceKind !== 'credit') return null;

  return {
    isRefund: true,
    direction: 'expense',
    refundOfId: original?.id || null,
    categoryId: original?.categoryId || null,
    space: original?.space || null,
    reason: original
      ? `זיכוי שקושר לעסקה מ-${original.date} (${original.merchant || original.name})`
      : 'זוהה כזיכוי — יקוזז מההוצאות בקטגוריה',
  };
}

/* ============================================================
   סיכום קבוצת ייבוא
   ============================================================ */

export function summarizeBatch(rows) {
  const s = {
    total: rows.length,
    ready: 0, review: 0, duplicates: 0,
    settlements: 0, transfers: 0, refunds: 0, installments: 0,
    income: 0, expense: 0,
  };
  for (const r of rows) {
    if (r.duplicate) s.duplicates++;
    else if (r.needsReview || r.needsSpaceReview) s.review++;
    else s.ready++;
    if (r.isSettlement) s.settlements++;
    if (r.internalTransfer) s.transfers++;
    if (r.isRefund) s.refunds++;
    if (r.installment) s.installments++;
    if (!r.duplicate && !r.isSettlement && !r.internalTransfer) {
      if (r.direction === 'income') s.income = round2(s.income + Math.abs(r.amount));
      else s.expense = round2(s.expense + (r.isRefund ? -Math.abs(r.amount) : Math.abs(r.amount)));
    }
  }
  return s;
}
