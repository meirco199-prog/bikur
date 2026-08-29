/* ============================================================
   pipeline.js — צינור הייבוא המלא
   ------------------------------------------------------------
   קובץ → שורות גולמיות → סיווג → זיהוי כפילויות והקשרים
   → שורות מוצעות למסך האישור.
   שום תנועה לא נכנסת לנתונים לפני אישור מפורש.
   ============================================================ */

import { parseFile, matrixToRows } from './parse.js';
import { classifyRow, buildHistoryIndex, learnFromDecision, findCategory } from './classify.js';
import { checkDuplicate, detectSettlement, detectInternalTransfer, detectRefund, summarizeBatch } from './dedupe.js';
import { newTransaction, newImportBatch, newMerchantRule } from '../core/schema.js';
import { uid, round2, monthKeyOf, normalizeMerchant } from '../core/util.js';

/**
 * עיבוד קובץ שהועלה.
 * options: { accountId, defaultSpace, sourceKind: 'bank'|'credit'|'wallet' }
 * מחזיר { batch, rows, warnings, summary }
 */
export async function processFile(file, state, options = {}) {
  const parsed = await parseFile(file);
  const staged = stageRows(parsed.rows, state, {
    ...options,
    fileName: parsed.fileName,
    fileType: parsed.fileType,
  });
  return { ...staged, warnings: [...parsed.warnings, ...staged.warnings], parsed };
}

/**
 * הפיכת שורות גולמיות לשורות מוצעות, כולל סיווג וזיהוי הקשרים.
 * פונקציה טהורה — לא כותבת לחנות.
 */
export function stageRows(rawRows, state, options = {}) {
  const {
    accountId = null, defaultSpace = 'personal', sourceKind = 'bank',
    fileName = '', fileType = '', source = 'file',
  } = options;

  const warnings = [];
  const account = state.accounts.find((a) => a.id === accountId) || null;
  const historyIndex = buildHistoryIndex(state.transactions);
  const existing = state.transactions;
  const batchSeen = new Map();

  const batch = newImportBatch({
    fileName, fileType, source, accountId,
    rowCount: rawRows.length,
    importedAt: Date.now(),
  });

  const rows = [];
  let minDate = null, maxDate = null;

  rawRows.forEach((raw, i) => {
    const row = { ...raw, sourceKind };

    /* --- 1. סיווג --- */
    const cls = classifyRow(row, {
      categories: state.categories,
      rules: state.merchantRules,
      historyIndex,
      account,
      defaultSpace: account?.space || defaultSpace,
    });

    /* --- 2. חיוב אשראי מרוכז --- */
    const settlement = sourceKind !== 'credit' ? detectSettlement(row, { accounts: state.accounts }) : null;

    /* --- 3. העברה פנימית --- */
    const transfer = settlement ? null : detectInternalTransfer(row, { accounts: state.accounts });

    /* --- 4. זיכוי --- */
    const refund = (settlement || transfer) ? null : detectRefund(row, { existing });

    /* --- 5. כפילות --- */
    const dup = checkDuplicate(row, { existing, batchSeen, accountId });
    const bkey = `${row.date}|${Math.abs(round2(row.amount)).toFixed(2)}|${normalizeMerchant(row.merchant || '')}`;
    if (!batchSeen.has(bkey)) batchSeen.set(bkey, i);

    /* --- 6. חודש שיוך: לפי תאריך החיוב אם קיים --- */
    const month = monthKeyOf(row.billingDate || row.date);
    if (!minDate || row.date < minDate) minDate = row.date;
    if (!maxDate || row.date > maxDate) maxDate = row.date;

    const direction = refund ? 'expense' : row.direction;
    const space = refund?.space || cls.space;
    let categoryId = refund?.categoryId || cls.categoryId;
    if (refund?.categoryId) {
      const c = state.categories.find((x) => x.id === refund.categoryId);
      if (!c || c.space !== space) categoryId = cls.categoryId;
    }

    rows.push({
      /* מזהה שורה במסך האישור */
      key: `${batch.id}_${i}`,
      index: i,

      /* נתוני מקור */
      date: row.date,
      billingDate: row.billingDate,
      month,
      merchant: row.merchant,
      description: row.description,
      rawText: row.rawText,
      amount: Math.abs(round2(row.amount)),
      currency: row.currency || 'ILS',
      originalAmount: row.originalAmount,
      cardLast4: row.cardLast4 || account?.last4 || null,
      externalId: row.externalId,
      installment: row.installment,
      typeText: row.typeText,

      /* סיווג */
      direction,
      space,
      categoryId,
      expenseType: cls.expenseType,
      confidence: settlement || transfer ? 96 : (refund ? Math.max(cls.confidence, 80) : cls.confidence),
      reason: settlement?.reason || transfer?.reason || refund?.reason || cls.reason,
      classSource: settlement ? 'settlement' : transfer ? 'transfer' : refund ? 'refund' : cls.source,
      needsReview: !(settlement || transfer) && cls.needsReview,
      needsSpaceReview: !(settlement || transfer) && cls.needsSpaceReview,

      /* דגלים */
      isSettlement: !!settlement,
      settlementFor: settlement?.settlementFor || null,
      internalTransfer: !!transfer,
      isRefund: !!refund,
      refundOfId: refund?.refundOfId || null,

      /* כפילות */
      duplicate: dup || null,

      /* מצב במסך האישור */
      selected: !dup,
      decided: false,

      accountId,
      paymentMethod: guessPaymentMethod(account, row),
      note: '',
    });
  });

  batch.periodFrom = minDate;
  batch.periodTo = maxDate;
  const summary = summarizeBatch(rows);
  batch.duplicateCount = summary.duplicates;
  batch.reviewCount = summary.review;

  if (!rows.length) warnings.push('לא נמצאו תנועות לייבוא בקובץ זה.');

  return { batch, rows, summary, warnings };
}

function guessPaymentMethod(account, row) {
  if (account?.type === 'credit') return 'credit';
  if (account?.type === 'cash') return 'cash';
  const t = `${row.merchant || ''} ${row.typeText || ''}`;
  if (/הוראת\s*קבע|הו"?ק/.test(t)) return 'standing';
  if (/העברה|זיכוי\s*בהעברה|משכורת/.test(t)) return 'transfer';
  if (/צ'?ק|שיק/.test(t)) return 'check';
  if (/מזומן/.test(t)) return 'cash';
  if (account?.type === 'checking') return 'transfer';
  return 'credit';
}

/**
 * המרת שורה מאושרת לתנועה לשמירה.
 */
export function rowToTransaction(row, batchId) {
  return newTransaction({
    date: row.date,
    billingDate: row.billingDate,
    month: row.month,
    name: row.merchant || row.description || 'תנועה מיובאת',
    merchant: row.merchant,
    description: row.description,
    amount: Math.abs(round2(row.amount)),
    currency: row.currency || 'ILS',
    originalAmount: row.originalAmount,
    direction: row.direction,
    space: row.space,
    categoryId: row.categoryId,
    expenseType: row.direction === 'income' ? null : (row.expenseType || 'variable'),
    paymentMethod: row.paymentMethod || 'credit',
    accountId: row.accountId,
    cardLast4: row.cardLast4,
    internalTransfer: !!row.internalTransfer,
    isSettlement: !!row.isSettlement,
    settlementFor: row.settlementFor || null,
    isRefund: !!row.isRefund,
    refundOfId: row.refundOfId || null,
    installment: row.installment ? { ...row.installment, totalAmount: round2(Math.abs(row.amount) * (row.installment.total || 1)) } : null,
    recurring: false,
    autoCopy: row.expenseType === 'fixed',
    note: row.note || '',
    externalId: row.externalId,
    source: 'import',
    importId: batchId,
    sourceFile: row.sourceFile || null,
    confidence: row.confidence,
    status: 'confirmed',
    needsSpaceReview: false,
  });
}

/**
 * אישור שורות: יצירת התנועות, לימוד חוקים מהחלטות המשתמש, ועדכון קבוצת הייבוא.
 * מחזיר { transactions, rules, batch }
 */
export function commitRows(rows, batch, state, { learn = true } = {}) {
  const transactions = [];
  const rules = [];
  const existingPatterns = new Set(state.merchantRules.map((r) => normalizeMerchant(r.pattern) + '|' + r.categoryId));

  for (const row of rows) {
    if (!row.selected) continue;
    if (row.duplicate && !row.forceImport) continue;
    transactions.push(rowToTransaction(row, batch.id));

    // לומדים רק מהחלטה מפורשת של המשתמש על שורה שלא זוהתה בביטחון
    if (learn && row.userDecided && row.categoryId) {
      const learned = learnFromDecision(row, {
        categoryId: row.categoryId,
        space: row.space,
        direction: row.direction,
        expenseType: row.expenseType,
      });
      if (learned) {
        const key = normalizeMerchant(learned.pattern) + '|' + learned.categoryId;
        if (!existingPatterns.has(key)) {
          existingPatterns.add(key);
          rules.push(newMerchantRule(learned));
        }
      }
    }
  }

  const summary = summarizeBatch(rows);
  const updatedBatch = {
    ...batch,
    rowCount: rows.length,
    approvedCount: transactions.length,
    reviewCount: rows.filter((r) => (r.needsReview || r.needsSpaceReview) && !r.selected).length,
    duplicateCount: summary.duplicates,
    skippedCount: rows.length - transactions.length,
    status: 'done',
  };

  return { transactions, rules, batch: updatedBatch };
}

/** ייבוא מטקסט CSV גולמי (משמש לבדיקות ולהדבקת נתונים ידנית) */
export function stageFromCsvText(text, state, options = {}) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const matrix = lines.map((l) => l.split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, '')));
  const { rows } = matrixToRows(matrix, {});
  return stageRows(rows, state, options);
}

export { uid, findCategory };
