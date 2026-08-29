/* ============================================================
   accounts.js — ניהול חשבונות וכרטיסים
   ------------------------------------------------------------
   מוצגות 4 ספרות אחרונות בלבד. מספר חשבון מלא אינו נשמר.
   ============================================================ */

import { el, money } from '../core/util.js';
import { newAccount, ACCOUNT_TYPES, SPACES, CATEGORY_COLORS } from '../core/schema.js';
import { accountFlow } from '../domain/finance.js';
import {
  sectionCard, emptyState, toast, modal, field, input, select, segmented,
  colorPicker, confirmDialog, switchField, spaceChip, hexAlpha, dataTable,
} from '../ui/components.js';

export default function renderAccounts(ctx) {
  const state = ctx.store.state;
  const accounts = state.accounts.filter((a) => !a.archived);
  const archived = state.accounts.filter((a) => a.archived);

  const node = el('div', { class: 'col', style: { gap: '18px' } });

  node.append(el('div', { class: 'card pad-sm', style: { borderInlineStart: '3px solid var(--info)' } }, [
    el('div', { class: 'row', style: { gap: '10px' } }, [
      el('span', { style: { fontSize: '19px' }, text: '🔐' }),
      el('div', { class: 'small muted', style: { lineHeight: '1.6' },
        text: 'מטעמי אבטחה נשמרות 4 הספרות האחרונות בלבד. מספר חשבון או כרטיס מלא אינו נשמר באפליקציה ואינו נדרש לשום פעולה.' }),
    ]),
  ]));

  const grouped = [
    ['🏠 חשבונות פרטיים', accounts.filter((a) => a.space === 'personal')],
    ['🏢 חשבונות עסקיים', accounts.filter((a) => a.space === 'business')],
  ];

  for (const [title, list] of grouped) {
    if (!list.length) continue;
    node.append(sectionCard(title, {
      sub: `${list.length} מקורות`,
      body: el('div', { class: 'grid g-3' }, list.map((a) => accountCard(ctx, a))),
    }));
  }

  if (!accounts.length) {
    node.append(sectionCard('', { body: emptyState({
      icon: '💳', title: 'לא הוגדרו חשבונות',
      text: 'הגדרת חשבונות וכרטיסים משפרת את דיוק הייבוא ומאפשרת לקשר חיובים מרוכזים לעסקאות.',
      action: el('button', { class: 'btn primary sm mt-4', text: '＋ חשבון', onclick: () => openAccountForm(ctx, null) }),
    }) }));
  }

  if (archived.length) {
    node.append(sectionCard('חשבונות מוסתרים', {
      sub: `${archived.length} חשבונות`,
      pad: false,
      body: dataTable([
        { label: 'שם', render: (a) => el('span', { class: 'small', text: a.name }) },
        { label: 'סוג', render: (a) => el('span', { class: 'tiny muted', text: ACCOUNT_TYPES[a.type]?.label }) },
        { label: '', align: 'end', render: (a) => el('button', { class: 'btn xs', text: 'שחזור',
          onclick: () => { ctx.store.update('accounts', a.id, { archived: false }); ctx.refresh(); toast('החשבון שוחזר'); } }) },
      ], archived),
    }));
  }

  return {
    node,
    topbar: {
      title: 'חשבונות וכרטיסים', sub: `${accounts.length} מקורות פעילים`, showMonth: false,
      actions: [el('button', { class: 'btn sm primary', text: '＋ חשבון', onclick: () => openAccountForm(ctx, null) })],
    },
  };
}

function accountCard(ctx, a) {
  const state = ctx.store.state;
  const flow = accountFlow(state.transactions, a.id, ctx.month);
  const txCount = state.transactions.filter((t) => t.accountId === a.id).length;
  const type = ACCOUNT_TYPES[a.type] || { label: a.type, icon: '•' };

  return el('div', {
    class: 'card hoverable', style: { cursor: 'pointer', borderTop: `3px solid ${a.color}` },
    onclick: () => openAccountForm(ctx, a),
  }, [
    el('div', { class: 'row', style: { gap: '11px', marginBottom: '12px' } }, [
      el('div', { class: 'cat-icon lg', style: { background: hexAlpha(a.color, .15), color: a.color }, text: type.icon }),
      el('div', { class: 'grow', style: { minWidth: 0 } }, [
        el('div', { class: 'bold truncate', text: a.name }),
        el('div', { class: 'tiny muted-2' }, [
          type.label,
          a.last4 ? ` · •••• ${a.last4}` : '',
        ]),
      ]),
      spaceChip(a.space),
    ]),
    el('div', { class: 'col', style: { gap: '6px' } }, [
      row('נכנס החודש', money(flow.inflow), 'var(--pos)'),
      row('יצא החודש', money(flow.outflow), 'var(--neg)'),
      row('תנועה נטו', money(flow.net), flow.net >= 0 ? 'var(--text)' : 'var(--neg)', true),
    ]),
    el('div', { class: 'row-between mt-4' }, [
      el('span', { class: 'tiny muted-2', text: `${txCount} תנועות בסך הכול` }),
      el('button', { class: 'btn xs ghost', text: 'צפייה בתנועות',
        onclick: (e) => { e.stopPropagation(); ctx.go('transactions', { accountId: a.id }); } }),
    ]),
  ]);
}

function row(label, value, color, strong = false) {
  return el('div', { class: 'row-between' }, [
    el('span', { class: 'tiny muted', text: label }),
    el('span', { class: `num ${strong ? 'bold' : ''}`, style: { color, fontSize: strong ? '15px' : '13px' }, text: value }),
  ]);
}

/* ============================================================
   טופס חשבון
   ============================================================ */
function openAccountForm(ctx, account) {
  const state = ctx.store.state;
  const isEdit = !!account;
  const draft = account ? { ...account } : newAccount({
    space: ctx.space === 'all' ? 'personal' : ctx.space,
    color: CATEGORY_COLORS[state.accounts.length % CATEGORY_COLORS.length],
  });

  const nameInput = input({ value: draft.name, placeholder: 'לדוגמה: עו״ש פרטי' });
  const instInput = input({ value: draft.institution, placeholder: 'שם הבנק או חברת האשראי' });
  const last4Input = input({
    value: draft.last4, placeholder: '1234', maxlength: 4, inputmode: 'numeric',
    oninput: (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4); },
  });
  const billingInput = input({ type: 'number', min: 1, max: 28, value: draft.billingDay || '', placeholder: 'יום החיוב בחודש' });

  const billingWrap = el('div');
  const rebuildBilling = () => billingWrap.replaceChildren(
    draft.type === 'credit'
      ? billingInput
      : el('span', { class: 'tiny muted-2', text: 'רלוונטי לכרטיסי אשראי בלבד' }),
  );
  rebuildBilling();

  const txCount = state.transactions.filter((t) => t.accountId === draft.id).length;

  const m = modal({
    title: isEdit ? 'עריכת חשבון' : 'חשבון או כרטיס חדש',
    subtitle: isEdit ? `${txCount} תנועות משויכות` : '',
    body: el('div', { class: 'col', style: { gap: '15px' } }, [
      field('שם התצוגה', nameInput),
      el('div', { class: 'form-grid' }, [
        field('סוג', select(Object.values(ACCOUNT_TYPES).map((t) => ({ value: t.id, label: `${t.icon} ${t.label}` })), {
          value: draft.type, onchange: (e) => { draft.type = e.target.value; rebuildBilling(); },
        })),
        field('מרחב', segmented(Object.values(SPACES).map((s) => ({ value: s.id, label: s.label, icon: s.icon })),
          draft.space, (v) => { draft.space = v; })),
        field('מוסד', instInput),
        field('4 ספרות אחרונות', last4Input, { hint: 'רק 4 ספרות — לא מספר מלא' }),
        field('יום חיוב', billingWrap),
        field('צבע', colorPicker(draft.color, (c) => { draft.color = c; })),
      ]),
      isEdit ? switchField('הסתרת החשבון', draft.archived, (v) => { draft.archived = v; }) : null,
    ].filter(Boolean)),
    footer: [
      isEdit ? el('button', { class: 'btn danger', text: 'מחיקה', onclick: async () => {
        if (txCount > 0) {
          const ok = await confirmDialog({
            title: 'מחיקת חשבון בשימוש',
            message: `${txCount} תנועות משויכות לחשבון זה. המחיקה תנתק אותן מהחשבון אך לא תמחק אותן. להמשיך?`,
            confirmText: 'מחק חשבון', danger: true,
          });
          if (!ok) return;
          const ids = state.transactions.filter((t) => t.accountId === account.id).map((t) => t.id);
          ctx.store.updateMany('transactions', ids, { accountId: null }, { audit: false });
        }
        ctx.store.remove('accounts', account.id);
        m.close(); ctx.refresh();
        toast('החשבון נמחק', { undo: () => { ctx.store.undo(); ctx.refresh(); } });
      } }) : null,
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn ghost', text: 'ביטול', onclick: () => m.close() }),
      el('button', { class: 'btn primary', text: 'שמירה', onclick: () => {
        if (!nameInput.value.trim()) { toast('יש להזין שם', { type: 'err' }); return; }
        const patch = {
          name: nameInput.value.trim(),
          institution: instInput.value.trim(),
          last4: last4Input.value.replace(/\D/g, '').slice(0, 4),
          type: draft.type, space: draft.space, color: draft.color,
          billingDay: draft.type === 'credit' && billingInput.value ? Number(billingInput.value) : null,
          archived: !!draft.archived,
        };
        if (isEdit) ctx.store.update('accounts', account.id, patch);
        else ctx.store.insert('accounts', newAccount({ ...draft, ...patch }));
        m.close(); ctx.refresh();
        toast('החשבון נשמר');
      } }),
    ].filter(Boolean),
  });
}
