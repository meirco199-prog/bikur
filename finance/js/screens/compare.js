/* ============================================================
   compare.js — השוואה בין שני חודשים
   ============================================================ */

import { el, money, monthLabel, addMonths } from '../core/util.js';
import { compareMonths, monthsWithData } from '../domain/finance.js';
import { sectionCard, emptyState, deltaChip, select, field, catIcon, dataTable } from '../ui/components.js';
import { compareBars } from '../ui/charts.js';

let picked = { a: null, b: null };

export default function renderCompare(ctx) {
  const state = ctx.store.state;
  const months = monthsWithData(state.transactions);
  const space = ctx.space;

  if (months.length < 2) {
    return {
      node: sectionCard('', { body: emptyState({
        icon: '⚖️', title: 'נדרשים לפחות שני חודשים',
        text: 'אחרי שיהיו נתונים בשני חודשים לפחות תוכלו להשוות ביניהם.',
      }) }),
      topbar: { title: 'השוואת חודשים', showMonth: false },
    };
  }

  const b = picked.b && months.includes(picked.b) ? picked.b : (months.includes(ctx.month) ? ctx.month : months[0]);
  const a = picked.a && months.includes(picked.a) && picked.a !== b ? picked.a : (months.find((m) => m < b) || months[1] || months[0]);
  picked = { a, b };

  const cmp = compareMonths(state.transactions, a, b, space);
  const catOf = (id) => state.categories.find((c) => c.id === id);
  const isBiz = space === 'business';

  const node = el('div', { class: 'col', style: { gap: '18px' } });

  /* ---------- בוררי חודשים ---------- */
  node.append(el('div', { class: 'card pad-sm' }, [
    el('div', { class: 'row wrap', style: { gap: '12px', alignItems: 'flex-end' } }, [
      el('div', { style: { flex: '1 1 180px' } }, [
        field('חודש בסיס', select(months.map((m) => ({ value: m, label: monthLabel(m) })), {
          value: a, onchange: (e) => { picked.a = e.target.value; ctx.refresh(); },
        })),
      ]),
      el('span', { style: { fontSize: '20px', paddingBottom: '8px' }, text: '↔' }),
      el('div', { style: { flex: '1 1 180px' } }, [
        field('חודש להשוואה', select(months.map((m) => ({ value: m, label: monthLabel(m) })), {
          value: b, onchange: (e) => { picked.b = e.target.value; ctx.refresh(); },
        })),
      ]),
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn sm ghost', text: '⇄ החלפה', onclick: () => { picked = { a: b, b: a }; ctx.refresh(); } }),
      el('button', { class: 'btn sm ghost', text: 'חודש מול קודמו', onclick: () => { picked = { a: addMonths(ctx.month, -1), b: ctx.month }; ctx.refresh(); } }),
    ]),
  ]));

  /* ---------- סיכומים ---------- */
  const rows = [
    { key: 'income', label: 'הכנסות', invert: false },
    { key: 'expense', label: 'הוצאות', invert: true },
    { key: 'balance', label: isBiz ? 'רווח' : 'יתרה', invert: false },
  ];

  node.append(el('div', { class: 'grid g-3' }, rows.map((r) => {
    const d = cmp.totals[r.key];
    return el('div', { class: 'card' }, [
      el('div', { class: 'stat-label mb-3', text: r.label }),
      el('div', { class: 'row', style: { gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' } }, [
        el('span', { class: 'num muted', style: { fontSize: '17px' }, text: money(d.a) }),
        el('span', { class: 'muted-2', text: '→' }),
        el('span', { class: 'num bold', style: { fontSize: '24px' }, text: money(d.b) }),
      ]),
      el('div', { class: 'row mt-4', style: { gap: '8px' } }, [
        deltaChip(d.change, { invert: r.invert }),
        el('span', { class: 'tiny muted-2 num', text: `${d.diff >= 0 ? '+' : ''}${money(d.diff)}` }),
      ]),
    ]);
  })));

  /* ---------- השוואה לפי קטגוריות ---------- */
  const barRows = cmp.categories.filter((c) => Math.abs(c.diff) > 0).slice(0, 12).map((c) => ({
    label: catOf(c.categoryId)?.name || 'ללא קטגוריה',
    a: c.a, b: c.b, diff: c.diff,
  }));

  node.append(sectionCard('השוואה לפי קטגוריות', {
    sub: `${monthLabel(a)} מול ${monthLabel(b)} · 12 השינויים הגדולים`,
    body: barRows.length
      ? compareBars(barRows, { labelA: monthLabel(a).split(' ')[0], labelB: monthLabel(b).split(' ')[0] })
      : emptyState({ icon: '🟰', text: 'אין הבדלים בקטגוריות בין החודשים.' }),
  }));

  /* ---------- עליות, ירידות, חדשות, נעלמו ---------- */
  node.append(el('div', { class: 'grid g-2' }, [
    changeList('עליות חריגות', cmp.increases.slice(0, 8), catOf, 'neg', '📈'),
    changeList('ירידות', cmp.decreases.slice(0, 8), catOf, 'pos', '📉'),
  ]));

  node.append(el('div', { class: 'grid g-2' }, [
    changeList('הוצאות חדשות', cmp.added.slice(0, 8), catOf, 'warn', '🆕', true),
    changeList('הוצאות שנעלמו', cmp.removed.slice(0, 8), catOf, 'info', '👋', true),
  ]));

  /* ---------- טבלה מלאה ---------- */
  node.append(sectionCard('טבלת השוואה מלאה', {
    pad: false,
    body: dataTable([
      { label: 'קטגוריה', render: (c) => {
        const cat = catOf(c.categoryId);
        return el('div', { class: 'row', style: { gap: '8px' } }, [catIcon(cat, 'sm'), el('span', { class: 'small', text: cat?.name || 'ללא קטגוריה' })]);
      } },
      { label: monthLabel(a), align: 'end', render: (c) => el('span', { class: 'num small muted', text: money(c.a) }) },
      { label: monthLabel(b), align: 'end', render: (c) => el('span', { class: 'num small bold', text: money(c.b) }) },
      { label: 'הפרש', align: 'end', render: (c) => el('span', { class: 'num small', style: { color: c.diff > 0 ? 'var(--neg)' : c.diff < 0 ? 'var(--pos)' : 'var(--text-3)' }, text: `${c.diff > 0 ? '+' : ''}${money(c.diff)}` }) },
      { label: 'שינוי', align: 'end', width: '96px', render: (c) => (c.isNew ? el('span', { class: 'chip warn', text: 'חדש' }) : c.vanished ? el('span', { class: 'chip info', text: 'נעלם' }) : deltaChip(c.change, { invert: true })) },
    ], cmp.categories, {
      onRowClick: (c) => ctx.go('transactions', { categoryId: c.categoryId }),
      empty: emptyState({ icon: '📊', text: 'אין נתוני קטגוריות להשוואה.' }),
    }),
  }));

  return { node, topbar: { title: 'השוואת חודשים', sub: `${monthLabel(a)} ↔ ${monthLabel(b)}`, showMonth: false } };
}

function changeList(title, items, catOf, tone, icon, simple = false) {
  return sectionCard(title, {
    sub: `${items.length} קטגוריות`,
    body: items.length
      ? el('div', { class: 'col', style: { gap: '9px' } }, items.map((c) => {
          const cat = catOf(c.categoryId);
          return el('div', { class: 'row', style: { gap: '9px' } }, [
            catIcon(cat, 'sm'),
            el('span', { class: 'grow small truncate', text: cat?.name || 'ללא קטגוריה' }),
            el('span', { class: 'small num bold', text: money(simple ? (c.isNew ? c.b : c.a) : c.b) }),
            simple ? null : deltaChip(c.change, { invert: true }),
          ]);
        }))
      : emptyState({ icon, text: 'אין פריטים בקטגוריה זו.' }),
  });
}
