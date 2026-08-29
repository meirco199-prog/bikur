/* ============================================================
   months.js — ניהול חודשים: היסטוריה, פתיחת חודש ושכפול
   ============================================================ */

import { el, money, monthLabel, monthLabelShort, addMonths, currentMonthKey, monthRange, daysInMonth } from '../core/util.js';
import { monthsWithData, totalsByMonth, dataMonthRange } from '../domain/finance.js';
import { buildMonthCopy, summarizeCopy, missingRecurring } from '../domain/recurring.js';
import { sectionCard, toast, modal, field, switchField, segmented, confirmDialog, deltaChip, dataTable, catIcon } from '../ui/components.js';
import { exportMonthPdf, exportMonthlySummaryCsv } from '../ui/exporters.js';

export default function renderMonths(ctx) {
  const state = ctx.store.state;
  const txs = state.transactions;
  const space = ctx.space;

  const range = dataMonthRange(txs);
  const all = monthRange(range.from, addMonths(range.to, 2)).reverse();
  const map = totalsByMonth(txs, all, space);

  const node = el('div', { class: 'col', style: { gap: '18px' } });

  /* ---------- פעולות מהירות ---------- */
  const next = addMonths(ctx.month, 1);
  const nextTotals = map.get(next) || { count: 0 };
  node.append(el('div', { class: 'card pad-sm' }, [
    el('div', { class: 'row wrap', style: { gap: '10px' } }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'bold', text: `החודש הפעיל: ${monthLabel(ctx.month)}` }),
        el('div', { class: 'tiny muted-2', text: `${(map.get(ctx.month)?.count) || 0} תנועות · ${daysInMonth(ctx.month)} ימים` }),
      ]),
      el('button', { class: 'btn sm', onclick: () => openCopyDialog(ctx, ctx.month, next) },
        [`📄 שכפול ל${monthLabelShort(next)}`]),
      el('button', { class: 'btn sm', onclick: () => openCopyDialog(ctx, addMonths(ctx.month, -1), ctx.month) },
        [`📥 מילוי ${monthLabelShort(ctx.month)} מהחודש הקודם`]),
      el('button', { class: 'btn sm', onclick: () => exportMonthPdf(state, ctx.month, space) }, ['🖨 דוח PDF']),
      el('button', { class: 'btn sm ghost', onclick: () => exportMonthlySummaryCsv(state, space) }, ['⬇ סיכום שנתי']),
    ]),
  ]));

  /* ---------- תזכורת לתנועות חוזרות חסרות ---------- */
  const missing = missingRecurring(txs, ctx.month, space);
  if (missing.length) {
    node.append(el('div', { class: 'card pad-sm', style: { borderInlineStart: '3px solid var(--warn)' } }, [
      el('div', { class: 'row wrap', style: { gap: '10px' } }, [
        el('span', { style: { fontSize: '20px' }, text: '🔁' }),
        el('div', { class: 'grow' }, [
          el('div', { class: 'bold small', text: `${missing.length} תנועות קבועות מהחודש הקודם עדיין לא נרשמו ב${monthLabel(ctx.month)}` }),
          el('div', { class: 'tiny muted-2', text: missing.slice(0, 4).map((t) => t.name).join(' · ') + (missing.length > 4 ? ' ועוד…' : '') }),
        ]),
        el('button', { class: 'btn sm primary', text: 'השלמה אוטומטית', onclick: () => openCopyDialog(ctx, addMonths(ctx.month, -1), ctx.month, { onlyMissing: true }) }),
      ]),
    ]));
  }

  /* ---------- טבלת חודשים ---------- */
  const rows = all.map((m) => {
    const t = map.get(m) || { income: 0, expense: 0, balance: 0, count: 0, rate: null };
    const prev = map.get(addMonths(m, -1));
    return { month: m, ...t, prevExpense: prev?.expense ?? null, meta: state.months?.[m] || null };
  });

  node.append(sectionCard('היסטוריית חודשים', {
    sub: `${monthsWithData(txs).length} חודשים עם נתונים · ${space === 'all' ? 'עסקי ופרטי' : space === 'business' ? 'עסקי' : 'פרטי'}`,
    pad: false,
    body: dataTable([
      { label: 'חודש', render: (r) => el('div', { class: 'row', style: { gap: '8px' } }, [
        el('span', { class: 'bold small', text: monthLabel(r.month) }),
        r.month === currentMonthKey() ? el('span', { class: 'chip brand', text: 'נוכחי' }) : null,
        r.month === ctx.month ? el('span', { class: 'chip', text: 'נבחר' }) : null,
        r.meta?.closed ? el('span', { class: 'chip', title: 'חודש סגור', text: '🔒' }) : null,
      ]) },
      { label: 'תנועות', align: 'end', render: (r) => el('span', { class: 'num small muted', text: r.count || '—' }) },
      { label: 'הכנסות', align: 'end', render: (r) => el('span', { class: 'num', style: { color: 'var(--pos)' }, text: r.count ? money(r.income) : '—' }) },
      { label: 'הוצאות', align: 'end', render: (r) => el('span', { class: 'num', style: { color: 'var(--neg)' }, text: r.count ? money(r.expense) : '—' }) },
      { label: space === 'business' ? 'רווח' : 'יתרה', align: 'end', render: (r) => el('span', { class: 'num bold', style: { color: r.balance >= 0 ? 'var(--text)' : 'var(--neg)' }, text: r.count ? money(r.balance) : '—' }) },
      { label: 'מול קודם', align: 'end', render: (r) => (r.count && r.prevExpense ? deltaChip(pctSafe(r.expense, r.prevExpense), { invert: true }) : el('span', { class: 'muted-2', text: '—' })) },
      { label: '', align: 'end', render: (r) => el('div', { class: 'row', style: { gap: '4px', justifyContent: 'flex-end' } }, [
        el('button', { class: 'btn xs', text: 'פתיחה', onclick: (e) => { e.stopPropagation(); ctx.setMonth(r.month); ctx.go(space === 'all' ? 'all' : space); } }),
        el('button', { class: 'btn xs ghost', title: 'שכפול לחודש הבא', text: '⧉', onclick: (e) => { e.stopPropagation(); openCopyDialog(ctx, r.month, addMonths(r.month, 1)); } }),
        r.count ? el('button', { class: 'btn xs ghost', title: 'מחיקת כל תנועות החודש', text: '🗑', onclick: (e) => { e.stopPropagation(); clearMonth(ctx, r.month, space); } }) : null,
      ]) },
    ], rows, { onRowClick: (r) => ctx.setMonth(r.month) }),
  }));

  return {
    node,
    topbar: {
      title: 'ניהול חודשים',
      sub: monthLabel(ctx.month),
      actions: [el('button', { class: 'btn sm primary', onclick: () => openCopyDialog(ctx, ctx.month, next) }, ['⧉ שכפול חודש'])],
    },
  };
}

function pctSafe(cur, base) {
  if (!base) return null;
  return ((cur - base) / Math.abs(base)) * 100;
}

/* ============================================================
   דיאלוג שכפול חודש
   ============================================================ */
export function openCopyDialog(ctx, fromMonth, toMonth, opts = {}) {
  const state = ctx.store.state;
  let mode = opts.onlyMissing ? 'fixed' : 'fixed';
  let spaces = ctx.space === 'all' ? ['business', 'personal'] : [ctx.space];
  let includeIncome = true;
  let advance = true;

  const preview = el('div');
  const listWrap = el('div', { style: { maxHeight: '260px', overflowY: 'auto', marginTop: '12px' } });
  let rows = [];
  const chosen = new Set();

  const rebuild = () => {
    rows = buildMonthCopy(state.transactions, fromMonth, toMonth, { mode, spaces, includeIncome, advanceInstallments: advance });

    if (opts.onlyMissing) {
      const existing = new Set(state.transactions.filter((t) => t.month === toMonth)
        .map((t) => `${t.space}|${t.categoryId}|${String(t.name).trim().toLowerCase()}`));
      rows = rows.filter((r) => !existing.has(`${r.space}|${r.categoryId}|${String(r.name).trim().toLowerCase()}`));
    }

    chosen.clear();
    rows.forEach((r) => chosen.add(r.id));
    const s = summarizeCopy(rows);

    preview.replaceChildren(el('div', { class: 'row wrap', style: { gap: '8px' } }, [
      el('span', { class: 'chip brand', text: `${s.count} תנועות` }),
      el('span', { class: 'chip pos', text: `הכנסות ${money(s.income)}` }),
      el('span', { class: 'chip neg', text: `הוצאות ${money(s.expense)}` }),
      s.installments ? el('span', { class: 'chip warn', text: `${s.installments} תשלומים מתקדמים` }) : null,
    ]));

    listWrap.replaceChildren();
    if (!rows.length) {
      listWrap.append(el('div', { class: 'empty' }, [
        el('div', { class: 'e-icon', text: '🤷' }),
        el('div', { class: 'e-text', text: 'אין תנועות מתאימות לשכפול לפי ההגדרות שנבחרו.' }),
      ]));
      return;
    }
    rows.forEach((r) => {
      const c = state.categories.find((x) => x.id === r.categoryId);
      const cb = el('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked) chosen.add(r.id); else chosen.delete(r.id); } });
      cb.checked = true;
      listWrap.append(el('label', { class: 'list-row', style: { cursor: 'pointer' } }, [
        cb,
        catIcon(c, 'sm'),
        el('div', { class: 'list-main' }, [
          el('div', { class: 'list-title truncate', text: r.name }),
          el('div', { class: 'list-sub' }, [
            `${c?.name || ''} · ${r.space === 'business' ? 'עסקי' : 'פרטי'}`,
            r.installment ? ` · תשלום ${r.installment.current}/${r.installment.total}` : '',
          ]),
        ]),
        el('span', { class: 'list-amount', style: { color: r.direction === 'income' ? 'var(--pos)' : 'var(--neg)' }, text: money(r.amount) }),
      ]));
    });
  };

  const body = el('div', { class: 'col', style: { gap: '14px' } }, [
    el('div', { class: 'card pad-sm', style: { background: 'var(--surface-2)' } }, [
      el('div', { class: 'row-between' }, [
        el('div', {}, [el('div', { class: 'tiny muted-2', text: 'מקור' }), el('div', { class: 'bold', text: monthLabel(fromMonth) })]),
        el('span', { style: { fontSize: '20px' }, text: '←' }),
        el('div', { style: { textAlign: 'end' } }, [el('div', { class: 'tiny muted-2', text: 'יעד' }), el('div', { class: 'bold', text: monthLabel(toMonth) })]),
      ]),
    ]),
    field('מה לשכפל', segmented([
      { value: 'fixed', label: 'קבועות וחוזרות' },
      { value: 'recurring', label: 'רק מסומנות כחוזרות' },
      { value: 'all', label: 'הכול' },
    ], mode, (v) => { mode = v; rebuild(); })),
    ctx.space === 'all' ? field('מרחבים', segmented([
      { value: 'both', label: 'עסקי ופרטי' },
      { value: 'business', label: 'עסקי' },
      { value: 'personal', label: 'פרטי' },
    ], 'both', (v) => { spaces = v === 'both' ? ['business', 'personal'] : [v]; rebuild(); })) : null,
    el('div', { class: 'col', style: { gap: '8px' } }, [
      switchField('לשכפל גם הכנסות', includeIncome, (v) => { includeIncome = v; rebuild(); }),
      switchField('לקדם מספר תשלום בעסקאות בתשלומים', advance, (v) => { advance = v; rebuild(); }),
    ]),
    preview,
    listWrap,
  ]);

  rebuild();

  const m = modal({
    title: opts.onlyMissing ? 'השלמת תנועות קבועות' : 'שכפול חודש',
    subtitle: 'אפשר לבטל סימון של תנועות שלא רוצים להעתיק',
    body, size: 'wide',
    footer: [
      el('button', { class: 'btn ghost', text: 'ביטול', onclick: () => m.close() }),
      el('button', { class: 'btn primary', text: 'שכפול', onclick: () => {
        const selected = rows.filter((r) => chosen.has(r.id));
        if (!selected.length) { toast('לא נבחרו תנועות', { type: 'err' }); return; }
        ctx.store.bulkInsert('transactions', selected);
        ctx.store.setMonthMeta(toMonth, { copiedFrom: fromMonth });
        m.close();
        ctx.setMonth(toMonth);
        toast(`${selected.length} תנועות הועתקו ל${monthLabel(toMonth)}`, {
          undo: () => { ctx.store.removeMany('transactions', selected.map((r) => r.id), { undoable: false }); ctx.refresh(); },
        });
      } }),
    ],
  });
}

/* ============================================================
   מחיקת חודש
   ============================================================ */
async function clearMonth(ctx, month, space) {
  const ids = ctx.store.state.transactions
    .filter((t) => t.month === month && (space === 'all' || t.space === space))
    .map((t) => t.id);
  if (!ids.length) return;
  const ok = await confirmDialog({
    title: `מחיקת תנועות ${monthLabel(month)}`,
    message: `למחוק ${ids.length} תנועות מהחודש הזה? אפשר לבטל מיד לאחר מכן.`,
    confirmText: 'מחק הכול', danger: true,
  });
  if (!ok) return;
  ctx.store.removeMany('transactions', ids);
  toast(`${ids.length} תנועות נמחקו`, { undo: () => { ctx.store.undo(); ctx.refresh(); } });
  ctx.refresh();
}
