/* ============================================================
   transactions.js — רשימת תנועות, חיפוש, סינון ופעולות מרובות
   ============================================================ */

import { el, money, fmtDate, monthLabel, debounce, uid } from '../core/util.js';
import { selectTx, totals, monthsWithData } from '../domain/finance.js';
import { PAYMENT_METHODS, EXPENSE_TYPES } from '../core/schema.js';
import { sectionCard, emptyState, catIcon, spaceChip, toast, select, input, confirmDialog, modal, field, dataTable, promptDialog } from '../ui/components.js';
import { exportTransactionsCsv } from '../ui/exporters.js';

/* מצב הסינון נשמר בין רינדורים */
let filters = {
  text: '', space: '', direction: '', categoryId: '', accountId: '',
  paymentMethod: '', expenseType: '', flag: '', month: '', amountMin: '', amountMax: '',
  sort: 'date-desc',
};
let selection = new Set();

export default function renderTransactions(ctx) {
  const state = ctx.store.state;

  // פרמטרים שהגיעו ממסך אחר
  if (ctx.params?.categoryId) { filters.categoryId = ctx.params.categoryId; ctx.params.categoryId = null; }
  if (ctx.params?.flag) { filters.flag = ctx.params.flag; ctx.params.flag = null; }
  if (ctx.params?.accountId) { filters.accountId = ctx.params.accountId; ctx.params.accountId = null; }

  const scopeSpace = filters.space || (ctx.space === 'all' ? 'all' : ctx.space);
  const scopeMonth = filters.month === 'all' ? null : (filters.month || ctx.month);

  const rows = sortRows(selectTx(state.transactions, {
    space: scopeSpace,
    month: scopeMonth,
    direction: filters.direction || null,
    categoryId: filters.categoryId || null,
    accountId: filters.accountId || null,
    paymentMethod: filters.paymentMethod || null,
    expenseType: filters.expenseType || null,
    flag: filters.flag || null,
    text: filters.text,
    amountMin: filters.amountMin || null,
    amountMax: filters.amountMax || null,
  }), filters.sort);

  const t = totals(rows);
  const node = el('div', { class: 'col', style: { gap: '16px' } });

  /* ---------- סרגל חיפוש וסינון ---------- */
  node.append(buildFilterBar(ctx, state, rows));

  /* ---------- סיכום התוצאות ---------- */
  node.append(el('div', { class: 'row wrap', style: { gap: '10px' } }, [
    el('span', { class: 'chip brand', text: `${rows.length} תנועות` }),
    el('span', { class: 'chip pos', text: `הכנסות ${money(t.income)}` }),
    el('span', { class: 'chip neg', text: `הוצאות ${money(t.expense)}` }),
    el('span', { class: `chip ${t.balance >= 0 ? 'pos' : 'neg'}`, text: `יתרה ${money(t.balance)}` }),
    rows.some((r) => r.internalTransfer || r.isSettlement)
      ? el('span', { class: 'chip', title: 'העברות פנימיות וחיובי אשראי מרוכזים אינם נספרים בסיכומים',
          text: `${rows.filter((r) => r.internalTransfer || r.isSettlement).length} לא נספרות` })
      : null,
  ]));

  /* ---------- פעולות על בחירה ---------- */
  const bulkBar = el('div', { class: 'card pad-sm', style: { display: selection.size ? 'block' : 'none' } });
  node.append(bulkBar);
  const refreshBulk = () => {
    bulkBar.style.display = selection.size ? 'block' : 'none';
    bulkBar.replaceChildren(el('div', { class: 'row wrap', style: { gap: '8px' } }, [
      el('span', { class: 'bold small', text: `נבחרו ${selection.size} תנועות` }),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn sm', text: 'העברה לעסקי', onclick: () => bulkPatch(ctx, { space: 'business' }) }),
      el('button', { class: 'btn sm', text: 'העברה לפרטי', onclick: () => bulkPatch(ctx, { space: 'personal' }) }),
      el('button', { class: 'btn sm', text: 'שינוי קטגוריה', onclick: () => bulkCategory(ctx) }),
      el('button', { class: 'btn sm', text: 'סימון כהעברה פנימית', onclick: () => bulkPatch(ctx, { internalTransfer: true }) }),
      el('button', { class: 'btn sm danger', text: 'מחיקה', onclick: () => bulkDelete(ctx) }),
      el('button', { class: 'btn sm ghost', text: 'ניקוי בחירה', onclick: () => { selection.clear(); ctx.refresh(); } }),
    ]));
  };
  refreshBulk();

  /* ---------- הטבלה ---------- */
  node.append(sectionCard('', {
    pad: false,
    body: rows.length ? buildTable(ctx, rows, refreshBulk) : emptyState({
      icon: '🔍',
      title: 'לא נמצאו תנועות',
      text: 'אפשר לשנות את הסינון, להוסיף תנועה חדשה או לייבא דוח.',
      action: el('div', { class: 'row', style: { gap: '8px', marginTop: '12px' } }, [
        el('button', { class: 'btn primary sm', text: '＋ תנועה חדשה', onclick: () => ctx.addTransaction() }),
        el('button', { class: 'btn sm', text: 'ניקוי סינון', onclick: () => { resetFilters(); ctx.refresh(); } }),
      ]),
    }),
  }));

  return {
    node,
    topbar: {
      title: 'תנועות',
      sub: scopeMonth ? monthLabel(scopeMonth) : 'כל החודשים',
      actions: [
        el('button', { class: 'btn sm', title: 'ייצוא לאקסל', onclick: () => exportTransactionsCsv(rows, state) }, ['⬇ ייצוא']),
        el('button', { class: 'btn sm primary', onclick: () => ctx.addTransaction() }, ['＋ תנועה']),
      ],
    },
  };
}

/* ============================================================
   סרגל סינון
   ============================================================ */
function buildFilterBar(ctx, state, rows) {
  const card = el('div', { class: 'card pad-sm' });

  const searchInput = input({
    value: filters.text, placeholder: 'חיפוש לפי שם, בית עסק, הערה או 4 ספרות…',
    oninput: debounce((e) => { filters.text = e.target.value; ctx.refresh(); }, 280),
  });

  const catOptions = state.categories
    .filter((c) => !c.archived)
    .filter((c) => !filters.space || c.space === filters.space)
    .sort((a, b) => a.space.localeCompare(b.space) || a.order - b.order)
    .map((c) => ({ value: c.id, label: `${c.icon} ${c.name} (${c.space === 'business' ? 'עסקי' : 'פרטי'})` }));

  const months = monthsWithData(state.transactions);

  const row1 = el('div', { class: 'row wrap', style: { gap: '8px' } }, [
    el('div', { style: { flex: '2 1 260px' } }, [searchInput]),
    select([{ value: 'all', label: 'כל החודשים' }, ...months.map((m) => ({ value: m, label: monthLabel(m) }))],
      { value: filters.month || ctx.month, style: 'flex:1 1 130px', onchange: (e) => { filters.month = e.target.value; ctx.refresh(); } }),
    select([{ value: 'business', label: '🏢 עסקי' }, { value: 'personal', label: '🏠 פרטי' }],
      { value: filters.space, placeholder: 'עסקי ופרטי', style: 'flex:1 1 110px', onchange: (e) => { filters.space = e.target.value; filters.categoryId = ''; ctx.refresh(); } }),
    select([{ value: 'income', label: '↗ הכנסות' }, { value: 'expense', label: '↙ הוצאות' }],
      { value: filters.direction, placeholder: 'הכנסות והוצאות', style: 'flex:1 1 120px', onchange: (e) => { filters.direction = e.target.value; ctx.refresh(); } }),
  ]);

  const row2 = el('div', { class: 'row wrap mt-4', style: { gap: '8px' } }, [
    select(catOptions, { value: filters.categoryId, placeholder: 'כל הקטגוריות', style: 'flex:1 1 170px', onchange: (e) => { filters.categoryId = e.target.value; ctx.refresh(); } }),
    select(state.accounts.filter((a) => !a.archived).map((a) => ({ value: a.id, label: `${a.name}${a.last4 ? ` ••${a.last4}` : ''}` })),
      { value: filters.accountId, placeholder: 'כל החשבונות', style: 'flex:1 1 150px', onchange: (e) => { filters.accountId = e.target.value; ctx.refresh(); } }),
    select(Object.values(PAYMENT_METHODS).map((p) => ({ value: p.id, label: `${p.icon} ${p.label}` })),
      { value: filters.paymentMethod, placeholder: 'כל אמצעי התשלום', style: 'flex:1 1 150px', onchange: (e) => { filters.paymentMethod = e.target.value; ctx.refresh(); } }),
    select(Object.values(EXPENSE_TYPES).map((p) => ({ value: p.id, label: p.label })),
      { value: filters.expenseType, placeholder: 'כל סוגי ההוצאה', style: 'flex:1 1 130px', onchange: (e) => { filters.expenseType = e.target.value; ctx.refresh(); } }),
    select([
      { value: 'recurring', label: '🔁 חוזרות' },
      { value: 'installment', label: '💳 בתשלומים' },
      { value: 'transfer', label: '↔ העברות פנימיות' },
      { value: 'settlement', label: '🧾 חיובי אשראי מרוכזים' },
      { value: 'refund', label: '↩ זיכויים' },
    ], { value: filters.flag, placeholder: 'כל הסוגים', style: 'flex:1 1 150px', onchange: (e) => { filters.flag = e.target.value; ctx.refresh(); } }),
    input({ type: 'number', value: filters.amountMin, placeholder: 'סכום מ־', style: 'flex:0 1 100px',
      onchange: (e) => { filters.amountMin = e.target.value; ctx.refresh(); } }),
    input({ type: 'number', value: filters.amountMax, placeholder: 'עד', style: 'flex:0 1 100px',
      onchange: (e) => { filters.amountMax = e.target.value; ctx.refresh(); } }),
    select([
      { value: 'date-desc', label: 'תאריך — חדש לישן' },
      { value: 'date-asc', label: 'תאריך — ישן לחדש' },
      { value: 'amount-desc', label: 'סכום — גבוה לנמוך' },
      { value: 'amount-asc', label: 'סכום — נמוך לגבוה' },
      { value: 'name', label: 'שם' },
    ], { value: filters.sort, style: 'flex:1 1 150px', onchange: (e) => { filters.sort = e.target.value; ctx.refresh(); } }),
  ]);

  const active = countActiveFilters();
  const row3 = el('div', { class: 'row wrap mt-4', style: { gap: '8px' } }, [
    active ? el('button', { class: 'btn xs ghost', text: `✕ ניקוי ${active} סינונים`, onclick: () => { resetFilters(); ctx.refresh(); } }) : null,
    el('button', { class: 'btn xs ghost', text: '💾 שמירת הסינון', onclick: () => saveFilter(ctx) }),
    ...(state.settings.savedFilters || []).map((f) => el('span', { class: 'chip clickable', onclick: () => { filters = { ...filters, ...f.filters }; ctx.refresh(); } }, [
      f.name,
      el('span', { class: 'x', text: '✕', onclick: (e) => { e.stopPropagation(); removeFilter(ctx, f.id); } }),
    ])),
  ]);

  card.append(row1, row2, row3);
  return card;
}

function countActiveFilters() {
  let n = 0;
  for (const [k, v] of Object.entries(filters)) {
    if (k === 'sort' || k === 'month') continue;
    if (v) n++;
  }
  return n;
}

function resetFilters() {
  filters = { text: '', space: '', direction: '', categoryId: '', accountId: '', paymentMethod: '', expenseType: '', flag: '', month: '', amountMin: '', amountMax: '', sort: 'date-desc' };
  selection.clear();
}

async function saveFilter(ctx) {
  const name = await promptDialog({ title: 'שמירת סינון', label: 'שם הסינון', placeholder: 'לדוגמה: הוצאות רכב עסקיות' });
  if (!name) return;
  const list = [...(ctx.store.state.settings.savedFilters || []), { id: uid('flt'), name, filters: { ...filters } }];
  ctx.store.setSetting('savedFilters', list);
  toast('הסינון נשמר');
  ctx.refresh();
}

function removeFilter(ctx, id) {
  const list = (ctx.store.state.settings.savedFilters || []).filter((f) => f.id !== id);
  ctx.store.setSetting('savedFilters', list);
  ctx.refresh();
}

/* ============================================================
   הטבלה
   ============================================================ */
function buildTable(ctx, rows, refreshBulk) {
  const state = ctx.store.state;
  const catOf = (id) => state.categories.find((c) => c.id === id);
  const accOf = (id) => state.accounts.find((a) => a.id === id);

  const allChecked = rows.length > 0 && rows.every((r) => selection.has(r.id));
  const headCheck = el('input', { type: 'checkbox', onchange: (e) => {
    if (e.target.checked) rows.forEach((r) => selection.add(r.id));
    else rows.forEach((r) => selection.delete(r.id));
    ctx.refresh();
  } });
  headCheck.checked = allChecked;

  const columns = [
    { label: '', width: '34px', render: (tx) => {
      const c = el('input', { type: 'checkbox', onchange: () => {
        if (selection.has(tx.id)) selection.delete(tx.id); else selection.add(tx.id);
        refreshBulk();
      } });
      c.checked = selection.has(tx.id);
      return c;
    } },
    { label: 'תאריך', width: '96px', render: (tx) => el('span', { class: 'num small nowrap', text: fmtDate(tx.date) }) },
    { label: 'תנועה', render: (tx) => {
      const c = catOf(tx.categoryId);
      return el('div', { class: 'row', style: { gap: '9px' } }, [
        catIcon(c, 'sm'),
        el('div', { style: { minWidth: 0 } }, [
          el('div', { class: 'small bold truncate', text: tx.name || tx.merchant || '—' }),
          el('div', { class: 'tiny muted-2 truncate' }, [
            c?.name || 'ללא קטגוריה',
            tx.installment ? ` · תשלום ${tx.installment.current}/${tx.installment.total}` : '',
            tx.note ? ` · ${tx.note}` : '',
          ]),
        ]),
      ]);
    } },
    { label: 'מרחב', width: '86px', render: (tx) => spaceChip(tx.space) },
    { label: 'סוג', width: '92px', render: (tx) => {
      const chips = [];
      if (tx.internalTransfer) chips.push(el('span', { class: 'chip', title: 'לא נספרת בחישובים', text: '↔ העברה' }));
      else if (tx.isSettlement) chips.push(el('span', { class: 'chip', title: 'חיוב אשראי מרוכז — לא נספר', text: '🧾 מרוכז' }));
      else if (tx.isRefund) chips.push(el('span', { class: 'chip pos', text: '↩ זיכוי' }));
      else if (tx.direction === 'expense') chips.push(el('span', { class: 'chip', text: EXPENSE_TYPES[tx.expenseType]?.label || '—' }));
      else chips.push(el('span', { class: 'chip pos', text: 'הכנסה' }));
      return el('div', { class: 'row', style: { gap: '4px' } }, chips);
    } },
    { label: 'אמצעי', width: '120px', render: (tx) => {
      const a = accOf(tx.accountId);
      return el('div', {}, [
        el('div', { class: 'tiny', text: PAYMENT_METHODS[tx.paymentMethod]?.label || '—' }),
        a ? el('div', { class: 'tiny muted-2 truncate', text: `${a.name}${tx.cardLast4 ? ` ••${tx.cardLast4}` : ''}` }) : null,
      ]);
    } },
    { label: 'סכום', align: 'end', width: '112px', render: (tx) => {
      const excluded = tx.internalTransfer || tx.isSettlement;
      const color = excluded ? 'var(--text-3)' : tx.isRefund ? 'var(--pos)' : tx.direction === 'income' ? 'var(--pos)' : 'var(--neg)';
      const sign = tx.isRefund ? '−' : tx.direction === 'income' ? '+' : '−';
      return el('span', { class: 'bold num nowrap', style: { color, textDecoration: excluded ? 'line-through' : null },
        text: `${sign}${money(tx.amount).replace('-', '')}` });
    } },
    { label: '', width: '40px', render: (tx) => el('button', {
      class: 'btn xs ghost', title: 'עריכה', text: '✎',
      onclick: () => ctx.editTransaction(tx),
    }) },
  ];

  const wrap = dataTable(columns, rows, {
    onRowClick: (tx) => ctx.editTransaction(tx),
    rowClass: (tx) => (selection.has(tx.id) ? 'selected' : ''),
  });
  wrap.querySelector('thead th')?.replaceChildren(headCheck);
  return wrap;
}

function sortRows(rows, sort) {
  const arr = rows.slice();
  switch (sort) {
    case 'date-asc': return arr.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt);
    case 'amount-desc': return arr.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
    case 'amount-asc': return arr.sort((a, b) => Math.abs(a.amount) - Math.abs(b.amount));
    case 'name': return arr.sort((a, b) => String(a.name).localeCompare(String(b.name), 'he'));
    default: return arr.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  }
}

/* ============================================================
   פעולות מרובות
   ============================================================ */
function bulkPatch(ctx, patch) {
  const ids = [...selection];
  if (!ids.length) return;
  // מעבר בין מרחבים מחייב התאמת קטגוריה
  if (patch.space) {
    const state = ctx.store.state;
    for (const id of ids) {
      const tx = state.transactions.find((t) => t.id === id);
      if (!tx) continue;
      const cur = state.categories.find((c) => c.id === tx.categoryId);
      let nextCat = tx.categoryId;
      if (!cur || cur.space !== patch.space) {
        const kind = tx.direction === 'income' ? 'income' : 'expense';
        const match = state.categories.find((c) => c.space === patch.space && c.kind === kind && c.name === cur?.name)
          || state.categories.find((c) => c.space === patch.space && c.kind === kind && (c.name === 'אחר' || c.name === 'הוצאות אחרות' || c.name === 'הכנסות אחרות'));
        nextCat = match?.id || tx.categoryId;
      }
      ctx.store.update('transactions', id, { ...patch, categoryId: nextCat }, { audit: false });
    }
    ctx.store.log('update-bulk', 'transactions', null, `${ids.length} תנועות → ${patch.space === 'business' ? 'עסקי' : 'פרטי'}`);
  } else {
    ctx.store.updateMany('transactions', ids, patch);
  }
  selection.clear();
  toast(`${ids.length} תנועות עודכנו`);
  ctx.refresh();
}

function bulkCategory(ctx) {
  const state = ctx.store.state;
  const ids = [...selection];
  const sel = select(
    state.categories.filter((c) => !c.archived).sort((a, b) => a.space.localeCompare(b.space) || a.order - b.order)
      .map((c) => ({ value: c.id, label: `${c.icon} ${c.name} (${c.space === 'business' ? 'עסקי' : 'פרטי'})` })),
    { placeholder: 'בחר קטגוריה' },
  );
  const m = modal({
    title: 'שינוי קטגוריה',
    subtitle: `${ids.length} תנועות נבחרו`,
    size: 'narrow',
    body: field('קטגוריה חדשה', sel),
    footer: [
      el('button', { class: 'btn ghost', text: 'ביטול', onclick: () => m.close() }),
      el('button', { class: 'btn primary', text: 'עדכון', onclick: () => {
        const catId = sel.value;
        if (!catId) return;
        const cat = state.categories.find((c) => c.id === catId);
        ctx.store.updateMany('transactions', ids, { categoryId: catId, space: cat.space });
        selection.clear();
        m.close();
        toast(`${ids.length} תנועות עודכנו לקטגוריה ${cat.name}`);
        ctx.refresh();
      } }),
    ],
  });
}

async function bulkDelete(ctx) {
  const ids = [...selection];
  const ok = await confirmDialog({
    title: 'מחיקת תנועות',
    message: `למחוק ${ids.length} תנועות? אפשר לבטל את הפעולה מיד לאחר מכן.`,
    confirmText: 'מחק', danger: true,
  });
  if (!ok) return;
  ctx.store.removeMany('transactions', ids);
  selection.clear();
  toast(`${ids.length} תנועות נמחקו`, { undo: () => { ctx.store.undo(); ctx.refresh(); } });
  ctx.refresh();
}
