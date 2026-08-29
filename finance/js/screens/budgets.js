/* ============================================================
   budgets.js — ניהול תקציבים ומעקב חריגות
   ============================================================ */

import { el, money, monthLabel, round2, parseNumber } from '../core/util.js';
import { budgetStatus, byCategory, selectTx } from '../domain/finance.js';
import { newBudget } from '../core/schema.js';
import { sectionCard, emptyState, toast, modal, field, input, progressBar, catIcon, confirmDialog, categorySelect, switchField, statCard } from '../ui/components.js';

export default function renderBudgets(ctx) {
  const state = ctx.store.state;
  const { month, space } = ctx;
  const rows = budgetStatus(state.transactions, state.budgets, month, space);
  const catOf = (id) => state.categories.find((c) => c.id === id);

  const node = el('div', { class: 'col', style: { gap: '18px' } });

  const totalBudget = round2(rows.reduce((s, r) => s + r.amount, 0));
  const totalUsed = round2(rows.reduce((s, r) => s + r.used, 0));
  const overCount = rows.filter((r) => r.over).length;

  if (rows.length) {
    node.append(el('div', { class: 'grid g-4' }, [
      statCard({ label: 'סך התקציב', value: money(totalBudget), icon: '🎯' }),
      statCard({ label: 'בוצע', value: money(totalUsed), icon: '💸', tone: totalUsed > totalBudget ? 'neg' : 'pos' }),
      statCard({ label: 'נותר', value: money(round2(totalBudget - totalUsed)), icon: '💰',
        tone: totalBudget - totalUsed >= 0 ? 'pos' : 'neg' }),
      statCard({ label: 'חריגות', value: String(overCount), icon: '⚠️', tone: overCount ? 'neg' : 'pos',
        sub: `מתוך ${rows.length} תקציבים` }),
    ]));
  }

  node.append(sectionCard('תקציבים לפי קטגוריה', {
    sub: `${monthLabel(month)} · ${space === 'business' ? 'עסקי' : space === 'personal' ? 'פרטי' : 'עסקי ופרטי'}`,
    actions: [
      el('button', { class: 'btn sm ghost', text: '✨ הצעה אוטומטית', onclick: () => suggestBudgets(ctx) }),
      el('button', { class: 'btn sm primary', text: '＋ תקציב', onclick: () => openBudgetForm(ctx, null) }),
    ],
    body: rows.length
      ? el('div', { class: 'col', style: { gap: '18px' } }, rows.map((r) => {
          const c = catOf(r.categoryId);
          const remaining = round2(r.amount - r.used);
          return el('div', { class: 'card pad-sm hoverable', style: { cursor: 'pointer' },
            onclick: () => openBudgetForm(ctx, r) }, [
            el('div', { class: 'row', style: { gap: '11px', marginBottom: '9px' } }, [
              catIcon(c),
              el('div', { class: 'grow', style: { minWidth: 0 } }, [
                el('div', { class: 'bold truncate', text: c?.name || 'קטגוריה' }),
                el('div', { class: 'tiny muted-2' }, [
                  `${money(r.used)} מתוך ${money(r.amount)}`,
                  r.isMonthSpecific ? ' · תקציב ייעודי לחודש זה' : '',
                ]),
              ]),
              el('div', { style: { textAlign: 'end' } }, [
                el('div', { class: `bold num`, style: { color: r.over ? 'var(--neg)' : r.usedPct >= 85 ? 'var(--warn)' : 'var(--pos)', fontSize: '19px' },
                  text: `${Math.round(r.usedPct || 0)}%` }),
                el('div', { class: 'tiny muted-2 num', text: remaining >= 0 ? `נותרו ${money(remaining)}` : `חריגה ${money(-remaining)}` }),
              ]),
            ]),
            progressBar(r.usedPct, { over: r.over }),
            r.over ? el('div', { class: 'chip neg', style: { marginTop: '9px' },
              text: `⚠ חריגה של ${money(r.used - r.amount)} מהתקציב` }) : null,
          ]);
        }))
      : emptyState({
          icon: '🎯', title: 'לא הוגדרו תקציבים',
          text: 'הגדרת תקציב לקטגוריה תאפשר מעקב חודשי, פס התקדמות והתראה על חריגה.',
          action: el('div', { class: 'row', style: { gap: '8px', marginTop: '12px' } }, [
            el('button', { class: 'btn primary sm', text: '＋ תקציב ראשון', onclick: () => openBudgetForm(ctx, null) }),
            el('button', { class: 'btn sm', text: '✨ הצעה לפי ההיסטוריה', onclick: () => suggestBudgets(ctx) }),
          ]),
        }),
  }));

  /* ---------- קטגוריות ללא תקציב ---------- */
  const covered = new Set(rows.map((r) => r.categoryId));
  const spend = byCategory(selectTx(state.transactions, { month, space }), 'expense').rows
    .filter((r) => !covered.has(r.categoryId) && r.amount > 0)
    .slice(0, 8);

  if (spend.length) {
    node.append(sectionCard('קטגוריות ללא תקציב', {
      sub: 'קטגוריות שבהן הוצאתם החודש ואין להן תקציב מוגדר',
      body: el('div', { class: 'col', style: { gap: '2px' } }, spend.map((r) => {
        const c = catOf(r.categoryId);
        return el('div', { class: 'list-row', style: { paddingInline: 0 } }, [
          catIcon(c, 'sm'),
          el('div', { class: 'list-main' }, [
            el('div', { class: 'list-title', text: c?.name || 'ללא קטגוריה' }),
            el('div', { class: 'list-sub', text: `${r.count} תנועות · ${r.share.toFixed(0)}% מההוצאות` }),
          ]),
          el('span', { class: 'list-amount', text: money(r.amount) }),
          el('button', { class: 'btn xs', text: '＋ תקציב', onclick: () => openBudgetForm(ctx, null, r.categoryId) }),
        ]);
      })),
    }));
  }

  return { node, topbar: { title: 'תקציבים', sub: monthLabel(month),
    actions: [el('button', { class: 'btn sm primary', text: '＋ תקציב', onclick: () => openBudgetForm(ctx, null) })] } };
}

/* ============================================================
   טופס תקציב
   ============================================================ */
function openBudgetForm(ctx, existing, presetCategoryId = null) {
  const state = ctx.store.state;
  const budget = existing ? state.budgets.find((b) => b.id === existing.budgetId) : null;
  const draft = budget ? { ...budget } : newBudget({
    space: ctx.space === 'all' ? 'personal' : ctx.space,
    categoryId: presetCategoryId,
  });

  const amountInput = input({ class: 'input amount', value: draft.amount || '', inputmode: 'decimal', placeholder: '0' });
  let monthSpecific = !!draft.month;

  const catSel = categorySelect(state.categories, {
    value: draft.categoryId || '', space: draft.space, kind: 'expense',
    placeholder: 'בחר קטגוריה',
    onchange: (e) => { draft.categoryId = e.target.value; },
  });

  // הצעה לפי ממוצע 3 חודשים
  let suggestion = 0;
  if (draft.categoryId) {
    suggestion = averageForCategory(state, draft.categoryId, ctx.month, 3);
  }

  const m = modal({
    title: budget ? 'עריכת תקציב' : 'תקציב חדש',
    size: 'narrow',
    body: el('div', { class: 'col', style: { gap: '14px' } }, [
      field('קטגוריה', catSel),
      field('סכום התקציב (₪)', amountInput,
        { hint: suggestion ? `ממוצע 3 החודשים האחרונים בקטגוריה זו: ${money(suggestion)}` : '' }),
      suggestion ? el('button', { class: 'btn xs ghost', text: `השתמש בממוצע (${money(suggestion)})`,
        onclick: () => { amountInput.value = String(Math.round(suggestion)); } }) : null,
      switchField(`תקציב ייעודי ל${monthLabel(ctx.month)} בלבד`, monthSpecific, (v) => { monthSpecific = v; }),
      el('div', { class: 'tiny muted-2', text: 'תקציב רגיל חל על כל החודשים. תקציב ייעודי גובר עליו בחודש שנבחר בלבד.' }),
    ]),
    footer: [
      budget ? el('button', { class: 'btn danger', text: 'מחיקה', onclick: async () => {
        const ok = await confirmDialog({ title: 'מחיקת תקציב', message: 'למחוק את התקציב הזה?', confirmText: 'מחק', danger: true });
        if (!ok) return;
        ctx.store.remove('budgets', budget.id);
        m.close(); ctx.refresh();
        toast('התקציב נמחק', { undo: () => { ctx.store.undo(); ctx.refresh(); } });
      } }) : null,
      el('div', { class: 'spacer' }),
      el('button', { class: 'btn ghost', text: 'ביטול', onclick: () => m.close() }),
      el('button', { class: 'btn primary', text: 'שמירה', onclick: () => {
        const amount = parseNumber(amountInput.value);
        if (!draft.categoryId) { toast('יש לבחור קטגוריה', { type: 'err' }); return; }
        if (!amount || amount <= 0) { toast('יש להזין סכום תקציב', { type: 'err' }); return; }
        const cat = state.categories.find((c) => c.id === draft.categoryId);
        const patch = { categoryId: draft.categoryId, amount: round2(amount), space: cat.space, month: monthSpecific ? ctx.month : null };
        if (budget) ctx.store.update('budgets', budget.id, patch);
        else ctx.store.insert('budgets', newBudget(patch));
        m.close(); ctx.refresh();
        toast('התקציב נשמר');
      } }),
    ].filter(Boolean),
  });

  catSel.addEventListener('change', () => {
    suggestion = averageForCategory(state, catSel.value, ctx.month, 3);
    if (!amountInput.value && suggestion) amountInput.value = String(Math.round(suggestion));
  });
}

function averageForCategory(state, categoryId, month, n) {
  const cat = state.categories.find((c) => c.id === categoryId);
  if (!cat) return 0;
  const months = [];
  for (let i = n; i >= 1; i--) {
    const [y, mm] = month.split('-').map(Number);
    const d = new Date(y, mm - 1 - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const vals = months.map((m) => {
    const txs = selectTx(state.transactions, { month: m, categoryId, space: cat.space });
    return byCategory(txs, 'expense').total;
  }).filter((v) => v > 0);
  if (!vals.length) return 0;
  return round2(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/* ============================================================
   הצעת תקציבים אוטומטית
   ============================================================ */
function suggestBudgets(ctx) {
  const state = ctx.store.state;
  const space = ctx.space === 'all' ? null : ctx.space;
  const existing = new Set(state.budgets.map((b) => b.categoryId));

  const candidates = state.categories
    .filter((c) => c.kind === 'expense' && !c.archived && (!space || c.space === space))
    .map((c) => ({ cat: c, avg: averageForCategory(state, c.id, ctx.month, 3) }))
    .filter((x) => x.avg > 100 && !existing.has(x.cat.id))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 12);

  if (!candidates.length) { toast('אין קטגוריות חדשות להצעה — כבר הוגדרו תקציבים לכל הקטגוריות המשמעותיות', { type: 'info' }); return; }

  const chosen = new Set(candidates.map((c) => c.cat.id));
  const body = el('div', { class: 'col', style: { gap: '4px' } }, candidates.map((x) => {
    const cb = el('input', { type: 'checkbox', onchange: (e) => { if (e.target.checked) chosen.add(x.cat.id); else chosen.delete(x.cat.id); } });
    cb.checked = true;
    return el('label', { class: 'list-row', style: { cursor: 'pointer' } }, [
      cb, catIcon(x.cat, 'sm'),
      el('div', { class: 'list-main' }, [
        el('div', { class: 'list-title', text: x.cat.name }),
        el('div', { class: 'list-sub', text: `${x.cat.space === 'business' ? 'עסקי' : 'פרטי'} · ממוצע 3 חודשים` }),
      ]),
      el('span', { class: 'list-amount', text: money(Math.round(x.avg)) }),
    ]);
  }));

  const m = modal({
    title: 'הצעת תקציבים',
    subtitle: 'התקציבים מבוססים על ממוצע ההוצאה ב-3 החודשים האחרונים',
    body,
    footer: [
      el('button', { class: 'btn ghost', text: 'ביטול', onclick: () => m.close() }),
      el('button', { class: 'btn primary', text: 'יצירת התקציבים', onclick: () => {
        const rows = candidates.filter((x) => chosen.has(x.cat.id))
          .map((x) => newBudget({ space: x.cat.space, categoryId: x.cat.id, amount: Math.round(x.avg), month: null }));
        if (!rows.length) { toast('לא נבחרו קטגוריות', { type: 'err' }); return; }
        ctx.store.bulkInsert('budgets', rows);
        m.close(); ctx.refresh();
        toast(`${rows.length} תקציבים נוצרו`);
      } }),
    ],
  });
}
