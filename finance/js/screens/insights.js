/* ============================================================
   insights.js — מסך התובנות
   ============================================================ */

import { el, money, monthLabel, previousMonths } from '../core/util.js';
import { buildInsights, buildCombinedInsights } from '../domain/insights.js';
import { trendSeries, categoryAnomalies, futureCommitments } from '../domain/finance.js';
import { sectionCard, emptyState, insightCard, catIcon, deltaChip, buttonGroup } from '../ui/components.js';
import { trendChart } from '../ui/charts.js';

export default function renderInsights(ctx) {
  const state = ctx.store.state;
  const { month, space } = ctx;

  const list = space === 'all' ? buildCombinedInsights(state, month) : buildInsights(state, { month, space });
  const node = el('div', { class: 'col', style: { gap: '18px' } });

  /* ---------- מרחב ---------- */
  node.append(el('div', { class: 'row wrap', style: { gap: '10px' } }, [
    buttonGroup([
      { value: 'personal', label: '🏠 פרטי' },
      { value: 'business', label: '🏢 עסקי' },
      { value: 'all', label: '🌐 כולל' },
    ], space, (v) => ctx.setSpace(v)),
    el('span', { class: 'chip', text: `${list.length} תובנות ל${monthLabel(month)}` }),
  ]));

  /* ---------- תובנות ---------- */
  const grouped = {
    bad: list.filter((i) => i.tone === 'bad'),
    warn: list.filter((i) => i.tone === 'warn'),
    good: list.filter((i) => i.tone === 'good'),
    info: list.filter((i) => i.tone === 'info'),
  };

  const sections = [
    ['דורש תשומת לב', grouped.bad, '🚨'],
    ['כדאי לשים לב', grouped.warn, '⚠️'],
    ['חדשות טובות', grouped.good, '✨'],
    ['נתונים ומגמות', grouped.info, '📊'],
  ];

  let any = false;
  for (const [title, items, icon] of sections) {
    if (!items.length) continue;
    any = true;
    node.append(sectionCard(`${icon} ${title}`, {
      sub: `${items.length} תובנות`,
      body: el('div', { class: 'grid g-2' }, items.map(insightCard)),
    }));
  }
  if (!any) {
    node.append(sectionCard('', { body: emptyState({ icon: '💡', title: 'אין תובנות להצגה', text: 'הוסיפו תנועות או ייבאו דוח כדי שנוכל לנתח.' }) }));
  }

  /* ---------- מגמות ארוכות טווח ---------- */
  const months = [...previousMonths(month, 11), month];
  const series = trendSeries(state.transactions, months, space).filter((s) => s.count > 0);

  if (series.length >= 3) {
    node.append(el('div', { class: 'grid g-2' }, [
      sectionCard('מגמת הוצאות', {
        sub: `${series.length} חודשים אחרונים`,
        body: trendChart(series.map((s) => ({ month: s.month, value: s.expense })), { color: 'var(--neg)', label: 'הוצאות', height: 190 }),
      }),
      sectionCard('מגמת הכנסות', {
        sub: `${series.length} חודשים אחרונים`,
        body: trendChart(series.map((s) => ({ month: s.month, value: s.income })), { color: 'var(--pos)', label: 'הכנסות', height: 190 }),
      }),
    ]));

    const rates = series.filter((s) => s.rate !== null);
    if (rates.length >= 3) {
      node.append(sectionCard(space === 'business' ? 'מגמת רווחיות' : 'מגמת שיעור החיסכון', {
        sub: 'אחוז מתוך ההכנסה',
        body: trendChart(rates.map((s) => ({ month: s.month, value: s.rate })), { color: 'var(--brand-500)', label: 'אחוז', height: 180, fill: false }),
      }));
    }
  }

  /* ---------- כל החריגות ---------- */
  const anomalies = categoryAnomalies(state.transactions, month, space, { lookback: 3, minPct: 15, minAbs: 120 });
  const catOf = (id) => state.categories.find((c) => c.id === id);
  if (anomalies.length) {
    node.append(sectionCard('כל החריגות בקטגוריות', {
      sub: 'מול ממוצע 3 החודשים הקודמים',
      body: el('div', { class: 'col', style: { gap: '2px' } }, anomalies.map((a) => {
        const c = catOf(a.categoryId);
        return el('div', { class: 'list-row', style: { paddingInline: 0, cursor: 'pointer' },
          onclick: () => ctx.go('transactions', { categoryId: a.categoryId }) }, [
          catIcon(c, 'sm'),
          el('div', { class: 'list-main' }, [
            el('div', { class: 'list-title', text: c?.name || 'ללא קטגוריה' }),
            el('div', { class: 'list-sub', text: a.isNew ? 'לא הופיעה בחודשים הקודמים' : `ממוצע קודם ${money(a.baseline)} (${a.monthsOfHistory} חודשים)` }),
          ]),
          el('span', { class: 'list-amount', text: money(a.amount) }),
          a.isNew ? el('span', { class: 'chip warn', text: 'חדש' }) : deltaChip(a.change, { invert: true }),
        ]);
      })),
    }));
  }

  /* ---------- התחייבויות עתידיות ---------- */
  const commitments = futureCommitments(state.transactions, month, space);
  if (commitments.length) {
    node.append(sectionCard('התחייבויות עתידיות ידועות', {
      sub: 'יתרת תשלומים בעסקאות פעילות',
      body: el('div', { class: 'col', style: { gap: '2px' } }, commitments.map((c) => el('div', { class: 'list-row', style: { paddingInline: 0 } }, [
        el('span', { class: 'cat-icon sm', text: '💳' }),
        el('div', { class: 'list-main' }, [
          el('div', { class: 'list-title', text: c.name }),
          el('div', { class: 'list-sub', text: `תשלום ${c.current} מתוך ${c.total} · ${money(c.monthly)} בחודש · נותרו ${c.remainingPayments} תשלומים` }),
        ]),
        el('span', { class: 'list-amount', text: money(c.remainingAmount) }),
      ]))),
    }));
  }

  return { node, topbar: { title: 'תובנות', sub: monthLabel(month) } };
}
