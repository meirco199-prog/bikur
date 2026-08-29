/* ============================================================
   categories.js — ניהול קטגוריות: הוספה, עריכה, סדר, צבע ואייקון
   ============================================================ */

import { el, money } from '../core/util.js';
import { newCategory, EXPENSE_TYPES, SPACES } from '../core/schema.js';
import { selectTx, byCategory } from '../domain/finance.js';
import { sectionCard, emptyState, toast, modal, field, input, segmented, iconPicker, colorPicker, confirmDialog, catIcon, buttonGroup, switchField, categorySelect } from '../ui/components.js';

let view = { space: 'personal', kind: 'expense', showArchived: false };

export default function renderCategories(ctx) {
  const state = ctx.store.state;
  if (ctx.space !== 'all') view.space = ctx.space;

  const cats = state.categories
    .filter((c) => c.space === view.space && c.kind === view.kind)
    .filter((c) => view.showArchived || !c.archived)
    .sort((a, b) => a.order - b.order);

  // שימוש בפועל — כדי להזהיר לפני מחיקה
  const usage = new Map();
  for (const tx of state.transactions) {
    usage.set(tx.categoryId, (usage.get(tx.categoryId) || 0) + 1);
  }
  const monthSpend = new Map(
    byCategory(selectTx(state.transactions, { month: ctx.month, space: view.space }), view.kind).rows
      .map((r) => [r.categoryId, r.amount]),
  );

  const node = el('div', { class: 'col', style: { gap: '16px' } });

  node.append(el('div', { class: 'card pad-sm' }, [
    el('div', { class: 'row wrap', style: { gap: '10px' } }, [
      buttonGroup([
        { value: 'personal', label: '🏠 פרטי' },
        { value: 'business', label: '🏢 עסקי' },
      ], view.space, (v) => { view.space = v; ctx.refresh(); }),
      buttonGroup([
        { value: 'expense', label: 'הוצאות' },
        { value: 'income', label: 'הכנסות' },
      ], view.kind, (v) => { view.kind = v; ctx.refresh(); }),
      el('div', { class: 'spacer' }),
      switchField('הצג מוסתרות', view.showArchived, (v) => { view.showArchived = v; ctx.refresh(); }),
      el('button', { class: 'btn sm primary', text: '＋ קטגוריה', onclick: () => openCategoryForm(ctx, null) }),
    ]),
  ]));

  node.append(sectionCard(`${cats.length} קטגוריות`, {
    sub: 'גררו כדי לשנות סדר · לחצו כדי לערוך',
    pad: false,
    body: cats.length
      ? buildList(ctx, cats, usage, monthSpend)
      : emptyState({ icon: '🏷️', title: 'אין קטגוריות', text: 'הוסיפו קטגוריה ראשונה כדי להתחיל.',
          action: el('button', { class: 'btn primary sm mt-4', text: '＋ קטגוריה', onclick: () => openCategoryForm(ctx, null) }) }),
  }));

  node.append(el('div', { class: 'row wrap', style: { gap: '8px' } }, [
    el('button', { class: 'btn sm ghost', text: '↕ איפוס סדר לפי א״ב', onclick: () => sortAlphabetically(ctx) }),
    el('button', { class: 'btn sm ghost', text: '🔀 מיזוג קטגוריות', onclick: () => openMergeDialog(ctx) }),
  ]));

  return { node, topbar: { title: 'קטגוריות', sub: `${view.space === 'business' ? 'עסקי' : 'פרטי'} · ${view.kind === 'expense' ? 'הוצאות' : 'הכנסות'}`, showMonth: false } };
}

/* ============================================================
   רשימה עם גרירה
   ============================================================ */
function buildList(ctx, cats, usage, monthSpend) {
  const list = el('div');
  let dragged = null;

  cats.forEach((c) => {
    const row = el('div', {
      class: 'list-row',
      draggable: 'true',
      style: { cursor: 'grab' },
      onclick: (e) => { if (!e.target.closest('button')) openCategoryForm(ctx, c); },
    }, [
      el('span', { class: 'muted-2', style: { cursor: 'grab', fontSize: '15px' }, text: '⠿' }),
      catIcon(c),
      el('div', { class: 'list-main' }, [
        el('div', { class: 'list-title' }, [
          c.name,
          c.archived ? el('span', { class: 'chip', style: { marginInlineStart: '7px' }, text: 'מוסתרת' }) : null,
          c.system ? el('span', { class: 'chip', style: { marginInlineStart: '7px' }, text: 'ברירת מחדל' }) : null,
        ]),
        el('div', { class: 'list-sub' }, [
          `${usage.get(c.id) || 0} תנועות`,
          c.kind === 'expense' && c.defaultExpenseType ? ` · ברירת מחדל: ${EXPENSE_TYPES[c.defaultExpenseType]?.label}` : '',
        ]),
      ]),
      monthSpend.get(c.id) ? el('span', { class: 'list-amount', text: money(monthSpend.get(c.id)) }) : el('span', { class: 'tiny muted-2', text: '—' }),
      el('button', { class: 'btn xs ghost', title: 'עריכה', text: '✎', onclick: (e) => { e.stopPropagation(); openCategoryForm(ctx, c); } }),
    ]);

    row.addEventListener('dragstart', () => { dragged = c; row.style.opacity = '.4'; });
    row.addEventListener('dragend', () => { row.style.opacity = '1'; dragged = null; });
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.style.borderTop = '2px solid var(--brand-500)'; });
    row.addEventListener('dragleave', () => { row.style.borderTop = ''; });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.style.borderTop = '';
      if (!dragged || dragged.id === c.id) return;
      reorder(ctx, cats, dragged, c);
    });

    list.append(row);
  });

  return list;
}

function reorder(ctx, cats, moved, target) {
  const list = cats.filter((c) => c.id !== moved.id);
  const idx = list.findIndex((c) => c.id === target.id);
  list.splice(idx, 0, moved);
  ctx.store.batch(() => {
    list.forEach((c, i) => ctx.store.update('categories', c.id, { order: i }, { audit: false }));
  });
  ctx.store.log('reorder', 'categories', null, `סדר הקטגוריות עודכן`);
  ctx.refresh();
}

function sortAlphabetically(ctx) {
  const cats = ctx.store.state.categories
    .filter((c) => c.space === view.space && c.kind === view.kind)
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
  ctx.store.batch(() => {
    cats.forEach((c, i) => ctx.store.update('categories', c.id, { order: i }, { audit: false }));
  });
  ctx.refresh();
  toast('הסדר עודכן לפי א״ב');
}

/* ============================================================
   טופס קטגוריה
   ============================================================ */
function openCategoryForm(ctx, cat) {
  const state = ctx.store.state;
  const isEdit = !!cat;
  const draft = cat ? { ...cat } : newCategory({
    space: view.space, kind: view.kind,
    order: Math.max(0, ...state.categories.filter((c) => c.space === view.space && c.kind === view.kind).map((c) => c.order)) + 1,
  });

  const nameInput = input({ value: draft.name, placeholder: 'שם הקטגוריה' });
  const preview = el('div', { class: 'row', style: { gap: '11px', padding: '11px', background: 'var(--surface-2)', borderRadius: 'var(--r-md)' } });
  const updatePreview = () => {
    preview.replaceChildren(
      catIcon({ icon: draft.icon, color: draft.color }, 'lg'),
      el('div', {}, [
        el('div', { class: 'bold', text: nameInput.value || 'תצוגה מקדימה' }),
        el('div', { class: 'tiny muted-2', text: `${draft.space === 'business' ? 'עסקי' : 'פרטי'} · ${draft.kind === 'income' ? 'הכנסה' : 'הוצאה'}` }),
      ]),
    );
  };
  nameInput.addEventListener('input', updatePreview);
  updatePreview();

  const typeWrap = el('div');
  const rebuildType = () => typeWrap.replaceChildren(
    draft.kind === 'income'
      ? el('span', { class: 'tiny muted-2', text: 'רלוונטי להוצאות בלבד' })
      : segmented(Object.values(EXPENSE_TYPES).map((t) => ({ value: t.id, label: t.label })),
          draft.defaultExpenseType || 'variable', (v) => { draft.defaultExpenseType = v; }),
  );
  rebuildType();

  const usageCount = state.transactions.filter((t) => t.categoryId === draft.id).length;

  const m = modal({
    title: isEdit ? 'עריכת קטגוריה' : 'קטגוריה חדשה',
    subtitle: isEdit ? `${usageCount} תנועות משויכות` : '',
    body: el('div', { class: 'col', style: { gap: '15px' } }, [
      preview,
      field('שם', nameInput),
      el('div', { class: 'form-grid' }, [
        field('מרחב', segmented(Object.values(SPACES).map((s) => ({ value: s.id, label: s.label, icon: s.icon })),
          draft.space, (v) => { draft.space = v; updatePreview(); })),
        field('סוג', segmented([{ value: 'expense', label: 'הוצאה' }, { value: 'income', label: 'הכנסה' }],
          draft.kind, (v) => { draft.kind = v; rebuildType(); updatePreview(); })),
      ]),
      field('סוג הוצאה כברירת מחדל', typeWrap),
      field('צבע', colorPicker(draft.color, (c) => { draft.color = c; updatePreview(); })),
      field('אייקון', iconPicker(draft.icon, (i) => { draft.icon = i; updatePreview(); })),
      isEdit ? field('', switchField('הסתרת הקטגוריה (התנועות הקיימות נשמרות)', draft.archived, (v) => { draft.archived = v; })) : null,
    ].filter(Boolean)),
    footer: [
      isEdit ? el('button', { class: 'btn danger', text: 'מחיקה', onclick: () => deleteCategory(ctx, cat, usageCount, m) }) : null,
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn ghost', text: 'ביטול', onclick: () => m.close() }),
      el('button', { class: 'btn primary', text: 'שמירה', onclick: () => {
        if (!nameInput.value.trim()) { toast('יש להזין שם', { type: 'err' }); return; }
        const patch = {
          name: nameInput.value.trim(), icon: draft.icon, color: draft.color,
          space: draft.space, kind: draft.kind,
          defaultExpenseType: draft.kind === 'income' ? null : (draft.defaultExpenseType || 'variable'),
          archived: !!draft.archived,
        };
        if (isEdit) ctx.store.update('categories', cat.id, patch);
        else ctx.store.insert('categories', newCategory({ ...draft, ...patch }));
        m.close(); ctx.refresh();
        toast('הקטגוריה נשמרה');
      } }),
    ].filter(Boolean),
  });
}

async function deleteCategory(ctx, cat, usageCount, m) {
  const state = ctx.store.state;
  if (usageCount > 0) {
    // מציעים העברה של התנועות לקטגוריה אחרת
    const sel = categorySelect(state.categories.filter((c) => c.id !== cat.id), {
      space: cat.space, kind: cat.kind, placeholder: 'בחר קטגוריה חלופית',
    });
    const m2 = modal({
      title: 'מחיקת קטגוריה בשימוש',
      subtitle: `${usageCount} תנועות משויכות לקטגוריה "${cat.name}"`,
      size: 'narrow',
      body: el('div', { class: 'col', style: { gap: '12px' } }, [
        el('p', { class: 'small muted', text: 'לאן להעביר את התנועות הקיימות? אפשר גם רק להסתיר את הקטגוריה במקום למחוק.' }),
        field('קטגוריה חלופית', sel),
      ]),
      footer: [
        el('button', { class: 'btn ghost', text: 'ביטול', onclick: () => m2.close() }),
        el('button', { class: 'btn', text: 'רק הסתרה', onclick: () => {
          ctx.store.update('categories', cat.id, { archived: true });
          m2.close(); m.close(); ctx.refresh(); toast('הקטגוריה הוסתרה');
        } }),
        el('button', { class: 'btn danger', text: 'העבר ומחק', onclick: () => {
          if (!sel.value) { toast('יש לבחור קטגוריה חלופית', { type: 'err' }); return; }
          const ids = state.transactions.filter((t) => t.categoryId === cat.id).map((t) => t.id);
          ctx.store.updateMany('transactions', ids, { categoryId: sel.value });
          ctx.store.remove('categories', cat.id);
          m2.close(); m.close(); ctx.refresh();
          toast(`${ids.length} תנועות הועברו והקטגוריה נמחקה`);
        } }),
      ],
    });
    return;
  }
  const ok = await confirmDialog({ title: 'מחיקת קטגוריה', message: `למחוק את "${cat.name}"?`, confirmText: 'מחק', danger: true });
  if (!ok) return;
  ctx.store.remove('categories', cat.id);
  m.close(); ctx.refresh();
  toast('הקטגוריה נמחקה', { undo: () => { ctx.store.undo(); ctx.refresh(); } });
}

/* ============================================================
   מיזוג קטגוריות
   ============================================================ */
function openMergeDialog(ctx) {
  const state = ctx.store.state;
  const from = categorySelect(state.categories, { space: view.space, kind: view.kind, placeholder: 'קטגוריה למיזוג' });
  const to = categorySelect(state.categories, { space: view.space, kind: view.kind, placeholder: 'לתוך קטגוריה' });
  const m = modal({
    title: 'מיזוג קטגוריות',
    subtitle: 'כל התנועות יעברו לקטגוריית היעד והקטגוריה המקורית תימחק',
    size: 'narrow',
    body: el('div', { class: 'col', style: { gap: '12px' } }, [field('מקור', from), field('יעד', to)]),
    footer: [
      el('button', { class: 'btn ghost', text: 'ביטול', onclick: () => m.close() }),
      el('button', { class: 'btn primary', text: 'מיזוג', onclick: () => {
        if (!from.value || !to.value || from.value === to.value) { toast('יש לבחור שתי קטגוריות שונות', { type: 'err' }); return; }
        const ids = state.transactions.filter((t) => t.categoryId === from.value).map((t) => t.id);
        ctx.store.updateMany('transactions', ids, { categoryId: to.value });
        ctx.store.state.budgets.filter((b) => b.categoryId === from.value).forEach((b) => ctx.store.remove('budgets', b.id, { undoable: false }));
        ctx.store.state.merchantRules.filter((r) => r.categoryId === from.value).forEach((r) => ctx.store.update('merchantRules', r.id, { categoryId: to.value }, { audit: false }));
        ctx.store.remove('categories', from.value, { undoable: false });
        m.close(); ctx.refresh();
        toast(`${ids.length} תנועות מוזגו`);
      } }),
    ],
  });
}
