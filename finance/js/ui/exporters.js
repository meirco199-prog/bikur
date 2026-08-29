/* ============================================================
   exporters.js — ייצוא לאקסל, ל-PDF וגיבוי מלא
   ============================================================ */

import { downloadText, downloadBlob, fmtDate, monthLabel, money, todayISO, round2 } from '../core/util.js';
import { selectTx, totals, byCategory, monthsWithData, trendSeries } from '../domain/finance.js';
import { toast } from './components.js';
import { PAYMENT_METHODS, EXPENSE_TYPES } from '../core/schema.js';

/* ============================================================
   CSV — נפתח ישירות ב-Excel
   ============================================================ */

function csvCell(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  return lines.join('\r\n');
}

export function exportTransactionsCsv(transactions, state, fileName = null) {
  const catOf = (id) => state.categories.find((c) => c.id === id);
  const accOf = (id) => state.accounts.find((a) => a.id === id);

  const headers = [
    'תאריך', 'תאריך חיוב', 'חודש', 'שם התנועה', 'בית עסק', 'קטגוריה',
    'עסקי/פרטי', 'הכנסה/הוצאה', 'סכום', 'מטבע', 'סוג הוצאה', 'אמצעי תשלום',
    'חשבון', '4 ספרות', 'תשלום', 'מתוך', 'העברה פנימית', 'חיוב מרוכז', 'זיכוי',
    'חוזרת', 'מקור', 'רמת ביטחון', 'הערה',
  ];

  const rows = transactions.map((t) => [
    fmtDate(t.date),
    t.billingDate ? fmtDate(t.billingDate) : '',
    t.month,
    t.name,
    t.merchant,
    catOf(t.categoryId)?.name || '',
    t.space === 'business' ? 'עסקי' : 'פרטי',
    t.direction === 'income' ? 'הכנסה' : 'הוצאה',
    round2(t.amount),
    t.currency || 'ILS',
    EXPENSE_TYPES[t.expenseType]?.label || '',
    PAYMENT_METHODS[t.paymentMethod]?.label || '',
    accOf(t.accountId)?.name || '',
    t.cardLast4 || '',
    t.installment?.current || '',
    t.installment?.total || '',
    t.internalTransfer ? 'כן' : '',
    t.isSettlement ? 'כן' : '',
    t.isRefund ? 'כן' : '',
    t.recurring ? 'כן' : '',
    { manual: 'ידני', import: 'ייבוא', copy: 'שכפול', recurring: 'חוזרת' }[t.source] || t.source,
    t.confidence,
    t.note || '',
  ]);

  downloadText(toCsv(headers, rows), fileName || `תנועות_${todayISO()}.csv`, 'text/csv;charset=utf-8');
  toast(`יוצאו ${rows.length} תנועות לקובץ CSV`);
}

/** ייצוא סיכום חודשי — טבלת חודשים מול קטגוריות */
export function exportMonthlySummaryCsv(state, space = 'all') {
  const months = monthsWithData(state.transactions).sort();
  const cats = state.categories.filter((c) => !c.archived && (space === 'all' || c.space === space));
  const headers = ['קטגוריה', 'סוג', 'מרחב', ...months.map(monthLabel), 'סה״כ'];
  const rows = [];

  for (const c of cats) {
    const per = months.map((m) => {
      const txs = selectTx(state.transactions, { month: m, space: c.space, categoryId: c.id });
      const t = totals(txs);
      return c.kind === 'income' ? t.income : t.expense;
    });
    const sum = round2(per.reduce((a, b) => a + b, 0));
    if (sum === 0) continue;
    rows.push([c.name, c.kind === 'income' ? 'הכנסה' : 'הוצאה', c.space === 'business' ? 'עסקי' : 'פרטי', ...per, sum]);
  }

  const series = trendSeries(state.transactions, months, space);
  rows.push([]);
  rows.push(['סך הכנסות', '', '', ...series.map((s) => s.income), round2(series.reduce((a, b) => a + b.income, 0))]);
  rows.push(['סך הוצאות', '', '', ...series.map((s) => s.expense), round2(series.reduce((a, b) => a + b.expense, 0))]);
  rows.push(['יתרה', '', '', ...series.map((s) => s.balance), round2(series.reduce((a, b) => a + b.balance, 0))]);

  downloadText(toCsv(headers, rows), `סיכום_חודשי_${todayISO()}.csv`, 'text/csv;charset=utf-8');
  toast('הסיכום החודשי יוצא בהצלחה');
}

/* ============================================================
   PDF — דרך חלון הדפסה של הדפדפן
   ============================================================ */

export function exportMonthPdf(state, month, space) {
  const txs = selectTx(state.transactions, { month, space });
  const t = totals(txs);
  const cats = byCategory(txs, 'expense');
  const catOf = (id) => state.categories.find((c) => c.id === id);
  const spaceLabel = space === 'business' ? 'עסקי' : space === 'personal' ? 'פרטי' : 'סיכום כולל';

  const w = window.open('', '_blank');
  if (!w) { toast('הדפדפן חסם את חלון ההדפסה', { type: 'err' }); return; }

  const rowsHtml = txs
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((tx) => `<tr>
      <td>${fmtDate(tx.date)}</td>
      <td>${esc(tx.name || tx.merchant)}</td>
      <td>${esc(catOf(tx.categoryId)?.name || '')}</td>
      <td>${tx.space === 'business' ? 'עסקי' : 'פרטי'}</td>
      <td>${tx.direction === 'income' ? 'הכנסה' : 'הוצאה'}</td>
      <td class="n">${money(tx.amount)}</td>
    </tr>`).join('');

  const catsHtml = cats.rows.map((r) => `<tr>
      <td>${esc(catOf(r.categoryId)?.name || 'ללא קטגוריה')}</td>
      <td class="n">${money(r.amount)}</td>
      <td class="n">${r.share.toFixed(1)}%</td>
    </tr>`).join('');

  w.document.write(`<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8">
    <title>דוח ${spaceLabel} — ${monthLabel(month)}</title>
    <style>
      @page { size: A4; margin: 14mm; }
      body { font-family: 'Heebo', Arial, sans-serif; color: #12182e; font-size: 12px; }
      h1 { font-size: 22px; margin: 0 0 4px; }
      .sub { color: #666; margin-bottom: 18px; font-size: 13px; }
      .cards { display: flex; gap: 10px; margin-bottom: 22px; }
      .c { flex: 1; border: 1px solid #ddd; border-radius: 10px; padding: 11px 13px; }
      .c .l { font-size: 11px; color: #777; }
      .c .v { font-size: 18px; font-weight: 800; margin-top: 3px; }
      h2 { font-size: 15px; margin: 20px 0 8px; }
      table { width: 100%; border-collapse: collapse; }
      th { text-align: right; font-size: 11px; color: #666; border-bottom: 1.5px solid #ccc; padding: 6px 5px; }
      td { padding: 5px; border-bottom: 1px solid #eee; }
      td.n, th.n { text-align: left; font-variant-numeric: tabular-nums; }
      .foot { margin-top: 22px; color: #999; font-size: 10px; text-align: center; }
      tr { break-inside: avoid; }
    </style></head><body>
    <h1>דוח ${spaceLabel}</h1>
    <div class="sub">${monthLabel(month)} · הופק ב-${fmtDate(todayISO())}</div>
    <div class="cards">
      <div class="c"><div class="l">סך הכנסות</div><div class="v">${money(t.income)}</div></div>
      <div class="c"><div class="l">סך הוצאות</div><div class="v">${money(t.expense)}</div></div>
      <div class="c"><div class="l">${space === 'business' ? 'רווח' : 'יתרה'}</div><div class="v">${money(t.balance)}</div></div>
      <div class="c"><div class="l">${space === 'business' ? 'רווחיות' : 'שיעור חיסכון'}</div><div class="v">${t.rate === null ? '—' : t.rate.toFixed(1) + '%'}</div></div>
    </div>
    <h2>חלוקת הוצאות לפי קטגוריות</h2>
    <table><thead><tr><th>קטגוריה</th><th class="n">סכום</th><th class="n">אחוז</th></tr></thead><tbody>${catsHtml}</tbody></table>
    <h2>פירוט התנועות (${txs.length})</h2>
    <table><thead><tr><th>תאריך</th><th>תנועה</th><th>קטגוריה</th><th>מרחב</th><th>סוג</th><th class="n">סכום</th></tr></thead><tbody>${rowsHtml}</tbody></table>
    <div class="foot">הופק מתוך אפליקציית ניהול ההכנסות וההוצאות · הסכומים חושבו בקוד דטרמיניסטי</div>
    </body></html>`);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 400);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/* ============================================================
   גיבוי ושחזור
   ============================================================ */

export function exportBackup(state) {
  const payload = {
    app: 'bikur-finance',
    version: state.version || 1,
    exportedAt: new Date().toISOString(),
    data: state,
  };
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
    `גיבוי_פיננסי_${todayISO()}.json`);
  toast('הגיבוי הורד בהצלחה');
}

export async function readBackupFile(file) {
  const text = await file.text();
  const parsed = JSON.parse(text);
  const data = parsed?.data || parsed;
  if (!data || typeof data !== 'object' || !Array.isArray(data.transactions)) {
    throw new Error('הקובץ אינו קובץ גיבוי תקין של האפליקציה.');
  }
  return data;
}
