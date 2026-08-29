/* ============================================================
   recurring.js — שכפול חודשים, הוצאות קבועות ותשלומים
   ============================================================ */

import { newTransaction } from '../core/schema.js';
import { addMonths, daysInMonth, round2, uid } from '../core/util.js';

/**
 * בניית תנועות לחודש היעד על בסיס חודש המקור.
 * מחזירה מערך תנועות חדשות — לא כותבת לחנות.
 *
 * options:
 *  - mode: 'all' | 'fixed' | 'recurring'
 *  - spaces: מערך מרחבים לשכפול
 *  - advanceInstallments: קידום מספר התשלום ודילוג על עסקאות שהסתיימו
 *  - includeIncome: האם לשכפל גם הכנסות
 */
export function buildMonthCopy(transactions, fromMonth, toMonth, options = {}) {
  const {
    mode = 'fixed',
    spaces = ['business', 'personal'],
    advanceInstallments = true,
    includeIncome = true,
    skipOneOff = true,
  } = options;

  const spaceSet = new Set(spaces);
  const targetDays = daysInMonth(toMonth);
  const rows = [];

  for (const tx of transactions) {
    if (tx.month !== fromMonth) continue;
    if (!spaceSet.has(tx.space)) continue;
    if (tx.status === 'pending') continue;
    if (tx.isSettlement) continue;
    if (tx.direction === 'income' && !includeIncome) continue;

    if (mode === 'fixed') {
      const keep = tx.direction === 'income'
        ? (tx.recurring || tx.autoCopy)
        : (tx.expenseType === 'fixed' || tx.recurring || tx.autoCopy);
      if (!keep) continue;
    } else if (mode === 'recurring') {
      if (!tx.recurring && !tx.autoCopy) continue;
    }
    if (skipOneOff && tx.expenseType === 'oneoff' && mode !== 'all') continue;

    // עסקאות בתשלומים: קידום התשלום, ודילוג כשהסתיימו
    let installment = null;
    if (tx.installment) {
      const next = Number(tx.installment.current) + 1;
      if (advanceInstallments) {
        if (next > Number(tx.installment.total)) continue; // התשלומים הסתיימו
        installment = { ...tx.installment, current: next };
      } else {
        installment = { ...tx.installment };
      }
    }

    const day = Math.min(Number(String(tx.date).slice(8, 10)) || 1, targetDays);
    const date = `${toMonth}-${String(day).padStart(2, '0')}`;

    rows.push(newTransaction({
      ...tx,
      id: uid('tx'),
      date,
      billingDate: tx.billingDate ? `${toMonth}-${String(Math.min(Number(tx.billingDate.slice(8, 10)) || 1, targetDays)).padStart(2, '0')}` : null,
      month: toMonth,
      installment,
      source: 'copy',
      importId: null,
      sourceFile: null,
      externalId: null,
      confidence: 100,
      status: 'confirmed',
      needsSpaceReview: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
  }

  return rows;
}

/** סיכום תצוגה מקדימה לשכפול חודש */
export function summarizeCopy(rows) {
  let income = 0, expense = 0;
  for (const r of rows) {
    if (r.direction === 'income') income += Math.abs(r.amount);
    else expense += Math.abs(r.amount);
  }
  return {
    count: rows.length,
    income: round2(income),
    expense: round2(expense),
    balance: round2(income - expense),
    installments: rows.filter((r) => r.installment).length,
  };
}

/**
 * זיהוי תנועות חוזרות שטרם הועתקו לחודש היעד.
 * משמש להצעה אוטומטית בפתיחת חודש חדש.
 */
export function missingRecurring(transactions, targetMonth, space = 'all') {
  const prev = addMonths(targetMonth, -1);
  const existing = new Set(
    transactions.filter((t) => t.month === targetMonth)
      .map((t) => recurrenceKey(t)),
  );
  const candidates = transactions.filter((t) => {
    if (t.month !== prev) return false;
    if (space !== 'all' && t.space !== space) return false;
    if (t.isSettlement || t.status === 'pending') return false;
    if (!(t.recurring || t.autoCopy || t.expenseType === 'fixed')) return false;
    if (t.installment && Number(t.installment.current) >= Number(t.installment.total)) return false;
    return true;
  });
  return candidates.filter((t) => !existing.has(recurrenceKey(t)));
}

/** מפתח זיהוי תנועה חוזרת — שם + קטגוריה + מרחב */
export function recurrenceKey(tx) {
  return [
    tx.space,
    tx.categoryId || '-',
    String(tx.name || tx.merchant || '').trim().toLowerCase(),
  ].join('|');
}

/**
 * פריסת עסקה בתשלומים ליתרת החודשים — מחזירה תנועות עתידיות.
 * משמש כשהמשתמש מזין עסקה בתשלומים ידנית ומבקש לפרוס אותה.
 */
export function spreadInstallments(tx, { total, monthlyAmount, startMonth, startPayment = 1 }) {
  const rows = [];
  for (let p = startPayment; p <= total; p++) {
    const month = addMonths(startMonth, p - startPayment);
    const day = Math.min(Number(String(tx.date).slice(8, 10)) || 1, daysInMonth(month));
    rows.push(newTransaction({
      ...tx,
      id: uid('tx'),
      date: `${month}-${String(day).padStart(2, '0')}`,
      month,
      amount: round2(monthlyAmount),
      installment: { current: p, total, totalAmount: round2(monthlyAmount * total) },
      source: 'recurring',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }));
  }
  return rows;
}
