/* ============================================================
   dashboard.js — דשבורד עסקי / פרטי / סיכום כולל
   ============================================================ */

import { el, money, moneyShort, monthLabel, monthLabelShort, previousMonths } from '../core/util.js';
import { monthTotals, comparisons, byCategory, topExpenses, categoryAnomalies, trendSeries, forecast, budgetStatus, selectTx } from '../domain/finance.js';
import { buildInsights, buildCombinedInsights } from '../domain/insights.js';
import { statCard, sectionCard, deltaChip, insightCard, emptyState, catIcon, progressBar } from '../ui/components.js';
import { incomeExpenseChart, donutChart, hBarList, trendChart } from '../ui/charts.js';

export default function renderDashboard(ctx) {
  const state = ctx.store.state;
  const { month, space } = ctx;
  const txs = state.transactions;
  const isBiz = space === 'business';
  const isAll = space === 'all';

  const cmp = comparisons(txs, month, space);
  const cur = cmp.current;
  const catOf = (id) => state.categories.find((c) => c.id === id);

  const node = el('div', { class: 'col', style: { gap: '20px' } });

  /* ============================================================
     כרטיסי מפתח
     ============================================================ */
  const balanceLabel = isBiz ? 'רווח החודש' : isAll ? 'יתרה כוללת' : 'יתרה החודש';
  const rateLabel = isBiz ? 'שיעור רווחיות' : 'שיעור חיסכון';

  node.append(el('div', { class: 'grid g-4' }, [
    statCard({
      label: 'סך הכנסות החודש', value: money(cur.income), icon: '↗', tone: 'pos',
      delta: cmp.vsPrev.income, deltaLabel: 'מול חודש קודם',
    }),
    statCard({
      label: 'סך הוצאות החודש', value: money(cur.expense), icon: '↙', tone: 'neg',
      delta: cmp.vsPrev.expense === null ? null : cmp.vsPrev.expense, deltaLabel: 'מול חודש קודם',
    }),
    statCard({
      label: balanceLabel, value: money(cur.balance), icon: '≡',
      tone: cur.balance >= 0 ? 'pos' : 'neg',
      delta: cmp.vsPrev.balance, deltaLabel: 'מול חודש קודם',
    }),
    statCard({
      label: rateLabel, value: cur.rate === null ? '—' : `${cur.rate.toFixed(1).replace(/\.0$/, '')}%`,
      icon: '%', tone: cur.rate === null ? '' : cur.rate >= 0 ? 'pos' : 'neg',
      sub: cur.count ? `${cur.count} תנועות בחודש` : 'אין תנועות',
    }),
  ]));

  /* --- פילוח ההוצאה: צריכה מול חיסכון והשקעות --- */
  if (cur.saving > 0) {
    node.append(el('div', { class: 'card pad-sm' }, [
      el('div', { class: 'row wrap', style: { gap: '18px' } }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'bold small', text: 'מתוך ההוצאות החודש' }),
          el('div', { class: 'tiny muted-2', text: 'חיסכון והשקעות הם כסף שיצא מהחשבון אבל נשאר שלכם' }),
        ]),
        breakdownBit('צריכה בפועל', money(cur.spending), 'var(--neg)'),
        breakdownBit('חיסכון והשקעות', money(cur.saving), 'var(--pos)'),
        cur.income > 0
          ? breakdownBit('שיעור החיסכון מההכנסה', `${((cur.saving / cur.income) * 100).toFixed(1).replace(/\.0$/, '')}%`, 'var(--brand-500)')
          : null,
      ]),
    ]));
  }

  if (!cur.count) {
    node.append(sectionCard('', {
      body: emptyState({
        icon: '🗓️',
        title: `אין תנועות ב${monthLabel(month)}`,
        text: 'אפשר להוסיף תנועה ידנית, לייבא דוח בנק או אשראי, או לשכפל את החודש הקודם.',
        action: el('div', { class: 'row', style: { gap: '8px', marginTop: '10px' } }, [
          el('button', { class: 'btn primary', text: '＋ תנועה חדשה', onclick: () => ctx.addTransaction() }),
          el('button', { class: 'btn', text: '📥 ייבוא קובץ', onclick: () => ctx.go('import') }),
          el('button', { class: 'btn', text: '🗓️ שכפול מחודש קודם', onclick: () => ctx.go('months') }),
        ]),
      }),
    }));
    return { node, topbar: topbarFor(ctx, space, cur) };
  }

  /* ============================================================
     השוואות: חודש קודם, ממוצע 3, ממוצע 6
     ============================================================ */
  node.append(sectionCard('השוואה לתקופות קודמות', {
    sub: 'כל האחוזים מחושבים מול הנתונים ההיסטוריים בפועל',
    body: el('div', { class: 'table-wrap' }, [buildComparisonTable(cmp, isBiz)]),
  }));

  /* ============================================================
     גרף הכנסות מול הוצאות + פילוח קטגוריות
     ============================================================ */
  const chartMonths = [...previousMonths(month, 7), month];
  const series = trendSeries(txs, chartMonths, space);

  node.append(el('div', { class: 'grid g-2-1' }, [
    sectionCard('הכנסות מול הוצאות', {
      sub: '8 החודשים האחרונים',
      body: incomeExpenseChart(series, { height: 270 }),
    }),
    sectionCard('חלוקת הוצאות לפי קטגוריות', {
      sub: monthLabel(month),
      body: buildDonut(txs, month, space, state, cur),
    }),
  ]));

  /* ============================================================
     5 ההוצאות הגדולות + קטגוריות מובילות
     ============================================================ */
  const monthTx = selectTx(txs, { month, space });
  const top5 = topExpenses(monthTx, 5);
  const catBreak = byCategory(monthTx, 'expense');

  node.append(el('div', { class: 'grid g-2' }, [
    sectionCard('5 ההוצאות הגדולות', {
      sub: monthLabel(month),
      body: top5.length
        ? el('div', { class: 'col', style: { gap: '2px' } }, top5.map((tx) => {
            const c = catOf(tx.categoryId);
            return el('div', {
              class: 'list-row', style: { cursor: 'pointer', paddingInline: 0 },
              onclick: () => ctx.editTransaction(tx),
            }, [
              catIcon(c),
              el('div', { class: 'list-main' }, [
                el('div', { class: 'list-title truncate', text: tx.name || tx.merchant }),
                el('div', { class: 'list-sub' }, [
                  `${c?.name || 'ללא קטגוריה'} · ${tx.date.slice(8)}/${tx.date.slice(5, 7)}`,
                  tx.installment ? el('span', { class: 'chip', style: { marginInlineStart: '6px' }, text: `תשלום ${tx.installment.current}/${tx.installment.total}` }) : null,
                ]),
              ]),
              el('div', { class: 'list-amount neg', text: money(tx.amount) }),
            ]);
          }))
        : emptyState({ icon: '💸', text: 'אין הוצאות בחודש זה' }),
    }),
    sectionCard('קטגוריות מובילות', {
      sub: `${catBreak.rows.length} קטגוריות פעילות`,
      actions: [el('button', { class: 'btn xs ghost', text: 'לכל התנועות', onclick: () => ctx.go('transactions') })],
      body: hBarList(catBreak.rows.slice(0, 7).map((r) => {
        const c = catOf(r.categoryId);
        return { label: c?.name || 'ללא קטגוריה', value: r.amount, color: c?.color, icon: c?.icon, share: r.share };
      }), {
        onClick: (d) => {
          const c = state.categories.find((x) => x.name === d.label && (space === 'all' || x.space === space));
          ctx.go('transactions', { categoryId: c?.id, month });
        },
      }),
    }),
  ]));

  /* ============================================================
     חריגות + מגמה
     ============================================================ */
  const anomalies = categoryAnomalies(txs, month, space, { lookback: 3, minPct: 20, minAbs: 200 });

  node.append(el('div', { class: 'grid g-2' }, [
    sectionCard('קטגוריות עם עלייה חריגה', {
      sub: 'מול ממוצע 3 החודשים הקודמים',
      body: anomalies.length
        ? el('div', { class: 'col', style: { gap: '10px' } }, anomalies.slice(0, 6).map((a) => {
            const c = catOf(a.categoryId);
            return el('div', { class: 'row', style: { gap: '10px' } }, [
              catIcon(c, 'sm'),
              el('div', { class: 'grow', style: { minWidth: 0 } }, [
                el('div', { class: 'small bold truncate', text: c?.name || 'ללא קטגוריה' }),
                el('div', { class: 'tiny muted-2', text: a.isNew ? 'קטגוריה חדשה החודש' : `ממוצע קודם ${money(a.baseline)}` }),
              ]),
              el('div', { style: { textAlign: 'end' } }, [
                el('div', { class: 'small bold num', text: money(a.amount) }),
                el('div', { class: 'tiny neg num', text: a.isNew ? 'חדש' : `+${money(a.diff)}` }),
              ]),
              a.isNew ? el('span', { class: 'chip warn', text: 'חדש' }) : deltaChip(a.change, { invert: true }),
            ]);
          }))
        : emptyState({ icon: '✅', title: 'אין חריגות', text: 'כל הקטגוריות בטווח הרגיל שלהן.' }),
    }),
    sectionCard(isBiz ? 'מגמת הרווח החודשי' : 'מגמת היתרה החודשית', {
      sub: '8 החודשים האחרונים',
      body: trendChart(series.map((s) => ({ month: s.month, value: s.balance })), {
        height: 200, color: 'var(--brand-500)', label: isBiz ? 'רווח' : 'יתרה',
      }),
    }),
  ]));

  /* ============================================================
     פילוח עסקי מול פרטי — רק בסיכום כולל
     ============================================================ */
  if (isAll) {
    const biz = monthTotals(txs, month, 'business');
    const per = monthTotals(txs, month, 'personal');
    node.append(sectionCard('פילוח עסקי מול פרטי', {
      sub: monthLabel(month),
      body: el('div', { class: 'grid g-2' }, [
        spaceBlock('🏢 עסקי', biz, '#3b62f0', 'רווח', () => ctx.go('business')),
        spaceBlock('🏠 פרטי', per, '#0f9d76', 'יתרה', () => ctx.go('personal')),
      ]),
    }));
  }

  /* ============================================================
     תחזית + תקציבים
     ============================================================ */
  const fc = forecast(txs, month, space);
  const scenario = fc.scenarios.avg3.monthlyExpense > 0 ? fc.scenarios.avg3 : fc.scenarios.ytd;
  const budgets = budgetStatus(txs, state.budgets, month, space);

  node.append(el('div', { class: 'grid g-2' }, [
    sectionCard('תחזית להמשך השנה', {
      sub: `${scenario.label} · נותרו ${fc.remainingMonths} חודשים בשנת ${fc.year}`,
      actions: [el('button', { class: 'btn xs ghost', text: 'לתחזית המלאה', onclick: () => ctx.go('forecast') })],
      body: el('div', { class: 'col', style: { gap: '12px' } }, [
        forecastRow('הכנסה שנתית צפויה', money(scenario.yearIncome), 'var(--pos)'),
        forecastRow('הוצאה שנתית צפויה', money(scenario.yearExpense), 'var(--neg)'),
        forecastRow(isBiz ? 'רווח שנתי צפוי' : 'חיסכון שנתי צפוי', money(scenario.yearBalance), scenario.yearBalance >= 0 ? 'var(--pos)' : 'var(--neg)'),
        el('div', { style: { height: '1px', background: 'var(--line)' } }),
        forecastRow('ממוצע חודשי — הוצאות', money(scenario.monthlyExpense), 'var(--text-2)'),
        forecastRow('מתחילת השנה עד היום', money(fc.ytd.balance), fc.ytd.balance >= 0 ? 'var(--pos)' : 'var(--neg)'),
      ]),
    }),
    sectionCard('מצב תקציבים', {
      sub: budgets.length ? `${budgets.filter((b) => b.over).length} חריגות מתוך ${budgets.length} תקציבים` : 'לא הוגדרו תקציבים',
      actions: [el('button', { class: 'btn xs ghost', text: 'ניהול תקציבים', onclick: () => ctx.go('budgets') })],
      body: budgets.length
        ? el('div', { class: 'col', style: { gap: '13px' } }, budgets.slice(0, 6).map((b) => {
            const c = catOf(b.categoryId);
            return el('div', {}, [
              el('div', { class: 'row', style: { gap: '8px', marginBottom: '5px' } }, [
                el('span', { text: c?.icon || '📦' }),
                el('span', { class: 'grow small bold truncate', text: c?.name || 'קטגוריה' }),
                el('span', { class: 'tiny num', style: { color: b.over ? 'var(--neg)' : 'var(--text-3)' },
                  text: `${money(b.used)} / ${money(b.amount)}` }),
                el('span', { class: `chip ${b.over ? 'neg' : b.usedPct >= 85 ? 'warn' : 'pos'}`, text: `${Math.round(b.usedPct || 0)}%` }),
              ]),
              progressBar(b.usedPct, { over: b.over }),
            ]);
          }))
        : emptyState({
            icon: '🎯', text: 'הגדרת תקציב לקטגוריה תציג כאן מעקב וחריגות.',
            action: el('button', { class: 'btn sm mt-4', text: 'הגדרת תקציב', onclick: () => ctx.go('budgets') }),
          }),
    }),
  ]));

  /* ============================================================
     תובנות
     ============================================================ */
  const insights = (isAll ? buildCombinedInsights(state, month) : buildInsights(state, { month, space })).slice(0, 4);
  if (insights.length) {
    node.append(sectionCard('תובנות', {
      sub: 'מחושבות מהנתונים שלך',
      actions: [el('button', { class: 'btn xs ghost', text: 'כל התובנות', onclick: () => ctx.go('insights') })],
      body: el('div', { class: 'grid g-2' }, insights.map(insightCard)),
    }));
  }

  return { node, topbar: topbarFor(ctx, space, cur) };
}

/* ============================================================
   עזרים
   ============================================================ */

function topbarFor(ctx, space, cur) {
  const title = space === 'business' ? 'ניהול עסקי' : space === 'personal' ? 'ניהול פרטי' : 'סיכום כולל';
  return {
    title,
    sub: `${monthLabel(ctx.month)} · ${cur.count} תנועות`,
    actions: [
      el('button', { class: 'btn sm', onclick: () => ctx.go('import') }, ['📥 ייבוא']),
      el('button', { class: 'btn sm primary', onclick: () => ctx.addTransaction() }, ['＋ תנועה']),
    ],
  };
}

function buildComparisonTable(cmp, isBiz) {
  const rows = [
    { label: 'הכנסות', cur: cmp.current.income, prev: cmp.previous.income, a3: cmp.avg3.income, a6: cmp.avg6.income,
      dPrev: cmp.vsPrev.income, d3: cmp.vsAvg3.income, d6: cmp.vsAvg6.income, invert: false },
    { label: 'הוצאות', cur: cmp.current.expense, prev: cmp.previous.expense, a3: cmp.avg3.expense, a6: cmp.avg6.expense,
      dPrev: cmp.vsPrev.expense, d3: cmp.vsAvg3.expense, d6: cmp.vsAvg6.expense, invert: true },
    { label: isBiz ? 'רווח' : 'יתרה', cur: cmp.current.balance, prev: cmp.previous.balance, a3: cmp.avg3.balance, a6: cmp.avg6.balance,
      dPrev: cmp.vsPrev.balance, d3: cmp.vsAvg3.balance, d6: cmp.vsAvg6.balance, invert: false },
  ];

  const table = el('table', { class: 'tbl' });
  table.append(el('thead', {}, [el('tr', {}, [
    el('th', { text: '' }),
    el('th', { class: 'num', text: 'החודש' }),
    el('th', { class: 'num', text: `חודש קודם (${monthLabelShort(cmp.previous.key)})` }),
    el('th', { class: 'num', text: 'שינוי' }),
    el('th', { class: 'num', text: 'ממוצע 3 ח׳' }),
    el('th', { class: 'num', text: 'שינוי' }),
    el('th', { class: 'num', text: 'ממוצע 6 ח׳' }),
    el('th', { class: 'num', text: 'שינוי' }),
  ])]));

  const tbody = el('tbody');
  for (const r of rows) {
    tbody.append(el('tr', {}, [
      el('td', { class: 'bold', text: r.label }),
      el('td', { class: 'num bold', text: money(r.cur) }),
      el('td', { class: 'num muted', text: money(r.prev) }),
      el('td', { class: 'num' }, [deltaChip(r.dPrev, { invert: r.invert })]),
      el('td', { class: 'num muted', text: money(r.a3) }),
      el('td', { class: 'num' }, [deltaChip(r.d3, { invert: r.invert })]),
      el('td', { class: 'num muted', text: money(r.a6) }),
      el('td', { class: 'num' }, [deltaChip(r.d6, { invert: r.invert })]),
    ]));
  }
  table.append(tbody);
  return table;
}

function buildDonut(txs, month, space, state, cur) {
  const monthTx = selectTx(txs, { month, space });
  const b = byCategory(monthTx, 'expense');
  const data = b.rows.map((r) => {
    const c = state.categories.find((x) => x.id === r.categoryId);
    return { label: c?.name || 'ללא קטגוריה', value: r.amount, color: c?.color || '#7b839c' };
  });
  return donutChart(data, {
    size: 176, thickness: 24,
    centerValue: moneyShort(cur.expense),
    centerLabel: 'סך הוצאות',
  });
}

function spaceBlock(title, t, color, balanceLabel, onClick) {
  return el('div', {
    class: 'card pad-sm hoverable', style: { cursor: 'pointer', borderInlineStart: `3px solid ${color}` },
    onclick: onClick,
  }, [
    el('div', { class: 'card-title mb-3', text: title }),
    el('div', { class: 'col', style: { gap: '7px' } }, [
      miniRow('הכנסות', money(t.income), 'var(--pos)'),
      miniRow('הוצאות', money(t.expense), 'var(--neg)'),
      miniRow(balanceLabel, money(t.balance), t.balance >= 0 ? 'var(--text)' : 'var(--neg)', true),
      t.rate !== null ? miniRow(balanceLabel === 'רווח' ? 'רווחיות' : 'שיעור חיסכון', `${t.rate.toFixed(1).replace(/\.0$/, '')}%`, 'var(--text-2)') : null,
    ]),
  ]);
}

function miniRow(label, value, color, strong = false) {
  return el('div', { class: 'row-between' }, [
    el('span', { class: 'small muted', text: label }),
    el('span', { class: `num ${strong ? 'bold' : ''}`, style: { color, fontSize: strong ? '17px' : '14px' }, text: value }),
  ]);
}

function breakdownBit(label, value, color) {
  return el('div', {}, [
    el('div', { class: 'tiny muted-2', text: label }),
    el('div', { class: 'num bold', style: { color, fontSize: '18px' }, text: value }),
  ]);
}

function forecastRow(label, value, color) {
  return el('div', { class: 'row-between' }, [
    el('span', { class: 'small muted', text: label }),
    el('span', { class: 'num bold', style: { color }, text: value }),
  ]);
}
