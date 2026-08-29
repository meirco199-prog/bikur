/* ============================================================
   forecast.js — תחזית שנתית לפי שלושה בסיסי חישוב
   ============================================================ */

import { el, money, monthLabel, monthLabelShort, addMonths, round2 } from '../core/util.js';
import { forecast, futureCommitments, trendSeries, paceEstimate } from '../domain/finance.js';
import { sectionCard, emptyState, statCard, buttonGroup, dataTable } from '../ui/components.js';
import { incomeExpenseChart } from '../ui/charts.js';

let basis = 'avg3';

export default function renderForecast(ctx) {
  const state = ctx.store.state;
  const { month, space } = ctx;
  const isBiz = space === 'business';

  const commitments = futureCommitments(state.transactions, month, space);
  const commitmentTotal = round2(commitments.reduce((s, c) => s + c.remainingAmount, 0));

  const fc = forecast(state.transactions, month, space, { commitments: 0 });
  const fcWith = forecast(state.transactions, month, space, { commitments: commitmentTotal });

  const sc = fc.scenarios[basis];
  const scWith = fcWith.scenarios[basis];

  const node = el('div', { class: 'col', style: { gap: '18px' } });

  if (!sc || sc.monthlyExpense === 0 && sc.monthlyIncome === 0) {
    return {
      node: sectionCard('', { body: emptyState({ icon: '🔮', title: 'אין מספיק נתונים לתחזית', text: 'נדרש לפחות חודש אחד עם תנועות.' }) }),
      topbar: { title: 'תחזית' },
    };
  }

  /* ---------- בחירת בסיס החישוב ---------- */
  node.append(el('div', { class: 'card pad-sm' }, [
    el('div', { class: 'row wrap', style: { gap: '12px' } }, [
      el('div', { class: 'grow' }, [
        el('div', { class: 'bold small', text: 'בסיס החישוב' }),
        el('div', { class: 'tiny muted-2', text: 'התחזית מחושבת אריתמטית מהנתונים בפועל — ללא הערכות חיצוניות' }),
      ]),
      buttonGroup([
        { value: 'avg3', label: 'ממוצע 3 חודשים' },
        { value: 'avg6', label: 'ממוצע 6 חודשים' },
        { value: 'ytd', label: 'מתחילת השנה' },
      ], basis, (v) => { basis = v; ctx.refresh(); }),
    ]),
  ]));

  /* ---------- כרטיסי תחזית ---------- */
  node.append(el('div', { class: 'grid g-4' }, [
    statCard({ label: `הכנסה שנתית צפויה ${fc.year}`, value: money(sc.yearIncome), icon: '↗', tone: 'pos',
      sub: `${money(fc.ytd.income)} עד כה` }),
    statCard({ label: `הוצאה שנתית צפויה ${fc.year}`, value: money(sc.yearExpense), icon: '↙', tone: 'neg',
      sub: `${money(fc.ytd.expense)} עד כה` }),
    statCard({ label: isBiz ? 'רווח שנתי צפוי' : 'חיסכון שנתי צפוי', value: money(sc.yearBalance),
      icon: '≡', tone: sc.yearBalance >= 0 ? 'pos' : 'neg', sub: `${money(fc.ytd.balance)} עד כה` }),
    statCard({ label: 'ממוצע חודשי צפוי', value: money(sc.monthlyBalance), icon: '📅',
      tone: sc.monthlyBalance >= 0 ? 'pos' : 'neg',
      sub: `הכנסה ${money(sc.monthlyIncome)} · הוצאה ${money(sc.monthlyExpense)}` }),
  ]));

  /* ---------- פירוט התחזית ---------- */
  node.append(el('div', { class: 'grid g-2' }, [
    sectionCard('פירוט התחזית', {
      sub: `${sc.label} · נותרו ${fc.remainingMonths} חודשים בשנה`,
      body: el('div', { class: 'col', style: { gap: '11px' } }, [
        detailRow('מתחילת השנה — הכנסות', money(fc.ytd.income), 'var(--pos)'),
        detailRow('מתחילת השנה — הוצאות', money(fc.ytd.expense), 'var(--neg)'),
        detailRow('מתחילת השנה — יתרה', money(fc.ytd.balance), fc.ytd.balance >= 0 ? 'var(--pos)' : 'var(--neg)', true),
        divider(),
        detailRow(`יתרת השנה (${fc.remainingMonths} חודשים) — הכנסות צפויות`, money(sc.restIncome), 'var(--text-2)'),
        detailRow('יתרת השנה — הוצאות צפויות', money(sc.restExpense), 'var(--text-2)'),
        detailRow('יתרת השנה — יתרה צפויה', money(sc.restBalance), sc.restBalance >= 0 ? 'var(--pos)' : 'var(--neg)', true),
        divider(),
        detailRow(`סה״כ ${fc.year} צפוי`, money(sc.yearBalance), sc.yearBalance >= 0 ? 'var(--pos)' : 'var(--neg)', true),
        commitmentTotal ? divider() : null,
        commitmentTotal ? detailRow('בהתחשב בהתחייבויות עתידיות ידועות', money(scWith.yearBalance),
          scWith.yearBalance >= 0 ? 'var(--pos)' : 'var(--neg)', true) : null,
      ].filter(Boolean)),
    }),
    sectionCard('השוואת בסיסי חישוב', {
      sub: 'כדי לראות את טווח האפשרויות',
      pad: false,
      body: dataTable([
        { label: 'בסיס', render: (r) => el('span', { class: 'small bold', text: r.label }) },
        { label: 'הכנסה שנתית', align: 'end', render: (r) => el('span', { class: 'num small', text: money(r.yearIncome) }) },
        { label: 'הוצאה שנתית', align: 'end', render: (r) => el('span', { class: 'num small', text: money(r.yearExpense) }) },
        { label: isBiz ? 'רווח' : 'חיסכון', align: 'end', render: (r) => el('span', { class: 'num small bold',
          style: { color: r.yearBalance >= 0 ? 'var(--pos)' : 'var(--neg)' }, text: money(r.yearBalance) }) },
      ], [fc.scenarios.avg3, fc.scenarios.avg6, fc.scenarios.ytd]),
    }),
  ]));

  /* ---------- גרף: בפועל מול צפוי ---------- */
  const past = [];
  for (let m = 1; m <= Number(month.slice(5, 7)); m++) past.push(`${fc.year}-${String(m).padStart(2, '0')}`);
  const actual = trendSeries(state.transactions, past, space).filter((s) => s.count > 0);
  const projected = [];
  for (let i = 1; i <= fc.remainingMonths; i++) {
    projected.push({ month: addMonths(month, i), income: sc.monthlyIncome, expense: sc.monthlyExpense, balance: sc.monthlyBalance });
  }

  if (actual.length) {
    node.append(sectionCard('בפועל מול צפוי', {
      sub: `${actual.length} חודשים בפועל · ${projected.length} חודשים בתחזית`,
      body: el('div', {}, [
        incomeExpenseChart([...actual, ...projected], { height: 280 }),
        projected.length ? el('div', { class: 'tiny muted-2 center mt-4',
          text: `${monthLabelShort(projected[0].month)} ואילך — תחזית לפי ${sc.label}` }) : null,
      ]),
    }));
  }

  /* ---------- קצב החודש השוטף ---------- */
  const pace = paceEstimate(state.transactions, month, space);
  if (pace.isCurrent && pace.expense > 0) {
    node.append(sectionCard('קצב החודש הנוכחי', {
      sub: `${pace.elapsedDays} ימים מתוך ${pace.totalDays}`,
      body: el('div', { class: 'grid g-3' }, [
        statCard({ label: 'הוצאות עד כה', value: money(pace.expense), icon: '💸' }),
        statCard({ label: 'צפי לסוף החודש', value: money(pace.projectedExpense), icon: '📈', tone: 'warn' }),
        statCard({ label: 'צפי יתרה בסוף החודש', value: money(round2(pace.projectedIncome - pace.projectedExpense)),
          icon: '≡', tone: pace.projectedIncome - pace.projectedExpense >= 0 ? 'pos' : 'neg' }),
      ]),
    }));
  }

  /* ---------- התחייבויות עתידיות ---------- */
  node.append(sectionCard('התחייבויות עתידיות ידועות', {
    sub: commitments.length ? `${commitments.length} עסקאות בתשלומים · סה״כ ${money(commitmentTotal)}` : 'אין עסקאות בתשלומים פעילות',
    pad: false,
    body: commitments.length
      ? dataTable([
          { label: 'עסקה', render: (c) => el('div', { class: 'row', style: { gap: '8px' } }, [
            el('span', { class: 'cat-icon sm', text: '💳' }),
            el('div', {}, [
              el('div', { class: 'small bold', text: c.name }),
              el('div', { class: 'tiny muted-2', text: `תשלום ${c.current} מתוך ${c.total}` }),
            ]),
          ]) },
          { label: 'תשלום חודשי', align: 'end', render: (c) => el('span', { class: 'num small', text: money(c.monthly) }) },
          { label: 'תשלומים שנותרו', align: 'end', render: (c) => el('span', { class: 'num small', text: c.remainingPayments }) },
          { label: 'יתרה לתשלום', align: 'end', render: (c) => el('span', { class: 'num small bold', text: money(c.remainingAmount) }) },
        ], commitments)
      : emptyState({ icon: '✅', text: 'אין תשלומים עתידיים ידועים מעבר להוצאות השוטפות.' }),
  }));

  return { node, topbar: { title: 'תחזית', sub: `${monthLabel(month)} · ${sc.label}` } };
}

function detailRow(label, value, color, strong = false) {
  return el('div', { class: 'row-between' }, [
    el('span', { class: `small ${strong ? 'bold' : 'muted'}`, text: label }),
    el('span', { class: 'num bold', style: { color, fontSize: strong ? '17px' : '14.5px' }, text: value }),
  ]);
}

function divider() {
  return el('div', { style: { height: '1px', background: 'var(--line)' } });
}
