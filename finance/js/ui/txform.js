/* ============================================================
   txform.js — טופס הוספה ועריכה של תנועה
   ============================================================ */

import {
  el, modal, field, input, textarea, select, switchField, segmented,
  categorySelect, toast, confirmDialog,
} from './components.js';
import { newTransaction, EXPENSE_TYPES, PAYMENT_METHODS, SPACES } from '../core/schema.js';
import { todayISO, monthKeyOf, round2, money, parseNumber, monthLabel } from '../core/util.js';
import { spreadInstallments } from '../domain/recurring.js';

/**
 * פתיחת טופס תנועה.
 * ctx: { store, state, space, month, refresh }
 * tx: תנועה קיימת לעריכה, או null להוספה
 */
export function openTxForm(ctx, tx = null, presets = {}) {
  const isEdit = !!tx;
  const state = ctx.store.state;

  const draft = isEdit ? { ...tx } : newTransaction({
    date: presets.date || (ctx.month === monthKeyOf(todayISO()) ? todayISO() : `${ctx.month}-01`),
    month: presets.month || ctx.month,
    space: presets.space || (ctx.space === 'all' ? 'personal' : ctx.space),
    direction: presets.direction || 'expense',
    ...presets,
  });

  /* ---------- שדות ---------- */
  const nameInput = input({ value: draft.name, placeholder: 'לדוגמה: קניות בסופר' });
  const amountInput = input({ class: 'input amount', value: draft.amount ? String(draft.amount) : '', placeholder: '0', inputmode: 'decimal' });
  const dateInput = input({ type: 'date', value: draft.date });
  const noteInput = textarea({ value: draft.note, placeholder: 'הערה חופשית (לא חובה)', rows: 2 });
  const merchantInput = input({ value: draft.merchant || '', placeholder: 'שם בית העסק כפי שמופיע בדוח' });

  const catWrap = el('div');
  const typeWrap = el('div');
  const accountWrap = el('div');
  const instWrap = el('div');

  const rebuildCategory = () => {
    catWrap.replaceChildren(categorySelect(state.categories, {
      value: draft.categoryId || '',
      space: draft.space,
      kind: draft.direction === 'income' ? 'income' : 'expense',
      placeholder: 'בחר קטגוריה',
      onchange: (e) => {
        draft.categoryId = e.target.value;
        const c = state.categories.find((x) => x.id === draft.categoryId);
        if (c?.defaultExpenseType && draft.direction === 'expense') {
          draft.expenseType = c.defaultExpenseType;
          rebuildType();
        }
      },
    }));
  };

  const rebuildType = () => {
    typeWrap.replaceChildren(
      draft.direction === 'income'
        ? el('div', { class: 'tiny muted-2', text: 'סוג הוצאה רלוונטי להוצאות בלבד' })
        : segmented(
            Object.values(EXPENSE_TYPES).map((t) => ({ value: t.id, label: t.label, icon: t.icon })),
            draft.expenseType,
            (v) => {
              draft.expenseType = v;
              if (v === 'fixed') draft.autoCopy = true;
              rebuildAutoCopy();
            },
          ),
    );
  };

  const rebuildAccount = () => {
    const list = state.accounts.filter((a) => !a.archived);
    accountWrap.replaceChildren(select(
      list.map((a) => ({ value: a.id, label: `${a.name}${a.last4 ? ` ••${a.last4}` : ''}` })),
      {
        value: draft.accountId || '',
        placeholder: 'ללא חשבון מסוים',
        onchange: (e) => {
          draft.accountId = e.target.value || null;
          const a = state.accounts.find((x) => x.id === draft.accountId);
          draft.cardLast4 = a?.type === 'credit' ? a.last4 : null;
        },
      },
    ));
  };

  const autoCopyWrap = el('div');
  const rebuildAutoCopy = () => {
    autoCopyWrap.replaceChildren(
      draft.expenseType === 'fixed' || draft.direction === 'income'
        ? switchField('העתק אוטומטית לחודש הבא', draft.autoCopy, (v) => { draft.autoCopy = v; })
        : el('span', { class: 'tiny muted-2', text: 'העתקה אוטומטית זמינה להוצאות קבועות' }),
    );
  };

  /* ---------- תשלומים ---------- */
  let installmentMode = !!draft.installment;
  const rebuildInstallments = () => {
    instWrap.replaceChildren();
    instWrap.append(switchField('עסקה בתשלומים', installmentMode, (v) => {
      installmentMode = v;
      if (!v) draft.installment = null;
      else draft.installment = draft.installment || { current: 1, total: 3, totalAmount: 0 };
      rebuildInstallments();
    }));
    if (!installmentMode) return;
    const cur = input({ type: 'number', min: 1, value: draft.installment.current, style: { width: '100%' } });
    const tot = input({ type: 'number', min: 1, value: draft.installment.total, style: { width: '100%' } });
    const note = el('div', { class: 'tiny muted-2' });
    const updateNote = () => {
      const per = parseNumber(amountInput.value) || 0;
      const t = Number(tot.value) || 1;
      note.textContent = `יירשם ${money(per)} בחודש. סך העסקה ${money(round2(per * t))} ב-${t} תשלומים.`;
    };
    cur.addEventListener('input', () => { draft.installment.current = Number(cur.value) || 1; updateNote(); });
    tot.addEventListener('input', () => { draft.installment.total = Number(tot.value) || 1; updateNote(); });
    amountInput.addEventListener('input', updateNote);
    updateNote();
    instWrap.append(el('div', { class: 'row mt-4', style: { gap: '12px' } }, [
      field('תשלום מספר', cur),
      field('מתוך', tot),
    ]));
    instWrap.append(note);
    if (!isEdit) {
      instWrap.append(el('label', { class: 'switch', style: { marginTop: '10px' } }, [
        (() => { const i = el('input', { type: 'checkbox', onchange: (e) => { draft._spread = e.target.checked; } }); return i; })(),
        el('span', { class: 'track' }),
        el('span', { class: 'switch-label', text: 'פרוס את יתרת התשלומים לחודשים הבאים' }),
      ]));
    }
  };

  /* ---------- דגלים מיוחדים ---------- */
  const flagsWrap = el('div', { class: 'col', style: { gap: '10px' } }, [
    switchField('חוזרת מדי חודש', draft.recurring, (v) => { draft.recurring = v; }),
    switchField('העברה פנימית (לא נספרת בהכנסות/הוצאות)', draft.internalTransfer, (v) => { draft.internalTransfer = v; }),
    switchField('זיכוי / החזר (מקוזז מההוצאות בקטגוריה)', draft.isRefund, (v) => { draft.isRefund = v; }),
  ]);

  rebuildCategory(); rebuildType(); rebuildAccount(); rebuildAutoCopy(); rebuildInstallments();

  /* ---------- מבנה הטופס ---------- */
  const dirSeg = segmented(
    [{ value: 'expense', label: 'הוצאה', icon: '↙' }, { value: 'income', label: 'הכנסה', icon: '↗' }],
    draft.direction,
    (v) => {
      draft.direction = v;
      draft.categoryId = null;
      if (v === 'income') draft.expenseType = null;
      else draft.expenseType = draft.expenseType || 'variable';
      rebuildCategory(); rebuildType(); rebuildAutoCopy();
    },
  );

  const spaceSeg = segmented(
    Object.values(SPACES).map((s) => ({ value: s.id, label: s.label, icon: s.icon })),
    draft.space,
    (v) => { draft.space = v; draft.categoryId = null; rebuildCategory(); },
  );

  const body = el('div', { class: 'form-grid' }, [
    field('סוג התנועה', dirSeg, { full: true }),
    field('עסקי או פרטי', spaceSeg, { full: true }),
    field('שם התנועה', nameInput, { full: true }),
    field('סכום (₪)', amountInput),
    field('תאריך', dateInput),
    field('קטגוריה', catWrap),
    field('אמצעי תשלום', select(
      Object.values(PAYMENT_METHODS).map((p) => ({ value: p.id, label: `${p.icon} ${p.label}` })),
      { value: draft.paymentMethod, onchange: (e) => { draft.paymentMethod = e.target.value; } },
    )),
    field('סוג הוצאה', typeWrap, { full: true }),
    field('חשבון / כרטיס', accountWrap),
    field('בית עסק (לזיהוי בייבוא)', merchantInput),
    field('', autoCopyWrap, { full: true }),
    field('תשלומים', instWrap, { full: true }),
    field('סימונים', flagsWrap, { full: true }),
    field('הערה', noteInput, { full: true }),
  ]);

  const footer = [];
  if (isEdit) {
    footer.push(el('button', {
      class: 'btn danger', text: 'מחיקה',
      onclick: async () => {
        const ok = await confirmDialog({
          title: 'מחיקת תנועה',
          message: `למחוק את "${tx.name}" בסך ${money(tx.amount)}? אפשר לבטל את המחיקה מיד אחרי.`,
          confirmText: 'מחק', danger: true,
        });
        if (!ok) return;
        ctx.store.remove('transactions', tx.id);
        m.close();
        ctx.refresh();
        toast('התנועה נמחקה', { type: 'ok', undo: () => { ctx.store.undo(); ctx.refresh(); } });
      },
    }));
  }
  footer.push(el('div', { class: 'spacer' }));
  footer.push(el('button', { class: 'btn ghost', text: 'ביטול', onclick: () => m.close() }));
  footer.push(el('button', { class: 'btn primary', text: isEdit ? 'שמירת שינויים' : 'הוספת תנועה', onclick: save }));

  const m = modal({
    title: isEdit ? 'עריכת תנועה' : 'תנועה חדשה',
    subtitle: isEdit ? `נוצרה ב-${new Date(tx.createdAt).toLocaleDateString('he-IL')} · מקור: ${sourceLabel(tx.source)}` : monthLabel(ctx.month),
    body, footer,
  });

  amountInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });

  function save() {
    const amount = parseNumber(amountInput.value);
    if (!amount || amount <= 0) { toast('יש להזין סכום גדול מאפס', { type: 'err' }); amountInput.focus(); return; }
    if (!nameInput.value.trim()) { toast('יש להזין שם לתנועה', { type: 'err' }); nameInput.focus(); return; }
    if (!draft.categoryId) { toast('יש לבחור קטגוריה', { type: 'err' }); return; }

    const date = dateInput.value || todayISO();
    const patch = {
      name: nameInput.value.trim(),
      merchant: merchantInput.value.trim() || nameInput.value.trim(),
      amount: round2(Math.abs(amount)),
      date,
      month: monthKeyOf(date),
      note: noteInput.value.trim(),
      direction: draft.direction,
      space: draft.space,
      categoryId: draft.categoryId,
      expenseType: draft.direction === 'income' ? null : draft.expenseType,
      paymentMethod: draft.paymentMethod,
      accountId: draft.accountId || null,
      cardLast4: draft.cardLast4 || null,
      recurring: draft.recurring,
      autoCopy: draft.autoCopy,
      internalTransfer: draft.internalTransfer,
      isRefund: draft.isRefund,
      installment: installmentMode ? { ...draft.installment, totalAmount: round2(Math.abs(amount) * (draft.installment.total || 1)) } : null,
    };

    if (isEdit) {
      ctx.store.update('transactions', tx.id, patch);
      toast('התנועה עודכנה');
    } else {
      const created = ctx.store.insert('transactions', newTransaction({ ...draft, ...patch }));
      let extra = 0;
      if (draft._spread && patch.installment && patch.installment.total > patch.installment.current) {
        const rest = spreadInstallments(created, {
          total: patch.installment.total,
          monthlyAmount: patch.amount,
          startMonth: created.month,
          startPayment: patch.installment.current,
        }).slice(1);
        if (rest.length) { ctx.store.bulkInsert('transactions', rest); extra = rest.length; }
      }
      toast(extra ? `נוספה תנועה ועוד ${extra} תשלומים עתידיים` : 'התנועה נוספה');
    }
    m.close();
    ctx.refresh();
  }

  return m;
}

function sourceLabel(s) {
  return { manual: 'הזנה ידנית', import: 'ייבוא קובץ', copy: 'שכפול חודש', recurring: 'תנועה חוזרת' }[s] || s;
}
