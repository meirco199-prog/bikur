/* ============================================================
   insights.js — מנוע התובנות
   ------------------------------------------------------------
   התובנות נוצרות מכללים דטרמיניסטיים על גבי מספרים שחושבו
   ב-finance.js. אין כאן שום הסתמכות על AI לחישוב.
   ============================================================ */

import { monthTotals, comparisons, byCategory, selectTx, categoryAnomalies, forecast, budgetStatus, trendSeries, paceEstimate, futureCommitments, pctChange } from './finance.js';
import { money, pctPlain, monthLabel, addMonths, round2, previousMonths } from '../core/util.js';

/**
 * יצירת רשימת תובנות מדורגת.
 * כל תובנה: { id, tone, icon, title, text, weight, action? }
 * tone: good | bad | warn | info
 */
export function buildInsights(state, { month, space }) {
  const txs = state.transactions;
  const catName = (id) => state.categories.find((c) => c.id === id)?.name || 'ללא קטגוריה';
  const catIcon = (id) => state.categories.find((c) => c.id === id)?.icon || '📦';
  const out = [];
  const cmp = comparisons(txs, month, space);
  const cur = cmp.current;

  if (cur.count === 0) {
    return [{
      id: 'empty', tone: 'info', icon: '🗓️', weight: 100,
      title: `אין עדיין תנועות ב${monthLabel(month)}`,
      text: 'אפשר להוסיף תנועה ידנית, לייבא דוח בנק או אשראי, או לשכפל את החודש הקודם.',
    }];
  }

  /* ---------- 1. סך ההוצאות מול החודש הקודם ---------- */
  if (cmp.vsPrev.expense !== null && cmp.previous.count > 0) {
    const d = cmp.vsPrev.expense;
    if (Math.abs(d) >= 3) {
      out.push({
        id: 'exp-vs-prev',
        tone: d > 0 ? 'bad' : 'good',
        icon: d > 0 ? '📈' : '📉',
        weight: 90 + Math.min(Math.abs(d), 40),
        title: d > 0 ? `ההוצאות עלו ב-${pctPlain(d)}` : `ההוצאות ירדו ב-${pctPlain(Math.abs(d))}`,
        text: `ההוצאות ב${monthLabel(month)} הן ${money(cur.expense)}, לעומת ${money(cmp.previous.expense)} ב${monthLabel(cmp.previous.key)}.`,
      });
    }
  }

  /* ---------- 2. הכנסות מול ממוצע 3 חודשים ---------- */
  if (cmp.vsAvg3.income !== null && cmp.avg3.months >= 2 && Math.abs(cmp.vsAvg3.income) >= 5) {
    const d = cmp.vsAvg3.income;
    out.push({
      id: 'inc-vs-avg3',
      tone: d > 0 ? 'good' : 'bad',
      icon: d > 0 ? '💰' : '⚠️',
      weight: 85 + Math.min(Math.abs(d), 30),
      title: `${space === 'business' ? 'ההכנסה העסקית' : 'ההכנסה'} ${d > 0 ? 'גבוהה' : 'נמוכה'} ב-${pctPlain(Math.abs(d))} מממוצע 3 החודשים`,
      text: `החודש ${money(cur.income)}, ממוצע 3 החודשים האחרונים ${money(cmp.avg3.income)}.`,
    });
  }

  /* ---------- 3. שיא רווח / הפסד ---------- */
  const hist = trendSeries(txs, [...previousMonths(month, 5), month], space).filter((r) => r.count > 0);
  if (hist.length >= 3) {
    const balances = hist.map((r) => r.balance);
    const curBal = balances[balances.length - 1];
    const best = Math.max(...balances);
    const worst = Math.min(...balances);
    if (curBal === best && balances.length >= 3) {
      out.push({
        id: 'best-balance', tone: 'good', icon: '🏆', weight: 95,
        title: `${space === 'business' ? 'הרווח העסקי' : 'היתרה'} החודש הוא הגבוה ביותר ב-${hist.length} החודשים האחרונים`,
        text: `${money(curBal)} ב${monthLabel(month)}.`,
      });
    } else if (curBal === worst && balances.length >= 3) {
      out.push({
        id: 'worst-balance', tone: 'bad', icon: '🔻', weight: 94,
        title: `${space === 'business' ? 'הרווח העסקי' : 'היתרה'} החודש הוא הנמוך ביותר ב-${hist.length} החודשים האחרונים`,
        text: `${money(curBal)} ב${monthLabel(month)}.`,
      });
    }
  }

  /* ---------- 4. חריגות בקטגוריות ---------- */
  const anomalies = categoryAnomalies(txs, month, space, { lookback: 3, minPct: 22, minAbs: 200 });
  for (const a of anomalies.slice(0, 3)) {
    if (a.isNew) {
      out.push({
        id: `new-cat-${a.categoryId}`, tone: 'warn', icon: catIcon(a.categoryId), weight: 78,
        title: `הוצאה חדשה: ${catName(a.categoryId)}`,
        text: `${money(a.amount)} החודש, בקטגוריה שלא הופיעה ב-3 החודשים הקודמים.`,
      });
    } else {
      out.push({
        id: `anom-${a.categoryId}`, tone: 'bad', icon: catIcon(a.categoryId), weight: 88 + Math.min(a.change / 10, 20),
        title: `${catName(a.categoryId)} עלו ב-${pctPlain(a.change)}`,
        text: `מ-${money(a.baseline)} בממוצע ל-${money(a.amount)} החודש — תוספת של ${money(a.diff)}.`,
      });
    }
  }

  /* ---------- 5. ירידה משמעותית בקטגוריה ---------- */
  const prevKey = addMonths(month, -1);
  const curCats = byCategory(selectTx(txs, { month, space }), 'expense');
  const prevCats = byCategory(selectTx(txs, { month: prevKey, space }), 'expense');
  const prevMap = new Map(prevCats.rows.map((r) => [r.categoryId, r.amount]));
  for (const row of curCats.rows) {
    const before = prevMap.get(row.categoryId);
    if (!before) continue;
    const ch = pctChange(row.amount, before);
    if (ch !== null && ch <= -30 && before - row.amount >= 400) {
      out.push({
        id: `drop-${row.categoryId}`, tone: 'good', icon: catIcon(row.categoryId), weight: 70,
        title: `חיסכון ב${catName(row.categoryId)}`,
        text: `ירידה מ-${money(before)} ל-${money(row.amount)} — ${pctPlain(Math.abs(ch))} פחות מ${monthLabel(prevKey)}.`,
      });
      break;
    }
  }

  /* ---------- 6. ממוצע 6 חודשים ---------- */
  if (cmp.avg6.months >= 4) {
    out.push({
      id: 'avg6', tone: 'info', icon: '📊', weight: 55,
      title: `ההוצאה הממוצעת ב-6 החודשים האחרונים היא ${money(cmp.avg6.expense)}`,
      text: `ההכנסה הממוצעת ${money(cmp.avg6.income)}, יתרה ממוצעת ${money(cmp.avg6.balance)}.`,
    });
  }

  /* ---------- 7. תחזית שנתית ---------- */
  const fc = forecast(txs, month, space);
  const sc = fc.scenarios.avg3.monthlyExpense > 0 ? fc.scenarios.avg3 : fc.scenarios.ytd;
  if (sc.monthlyExpense > 0 && fc.remainingMonths >= 0) {
    out.push({
      id: 'forecast', tone: 'info', icon: '🔮', weight: 60,
      title: `אם קצב ההוצאות יימשך, ההוצאה השנתית המשוערת תהיה ${money(sc.yearExpense)}`,
      text: `לפי ${sc.label}: הכנסה שנתית צפויה ${money(sc.yearIncome)}, ${sc.yearBalance >= 0 ? 'רווח' : 'גירעון'} שנתי צפוי ${money(Math.abs(sc.yearBalance))}.`,
    });
  }

  /* ---------- 8. אחוז חיסכון / רווחיות ---------- */
  if (cur.rate !== null) {
    const isBiz = space === 'business';
    if (cur.rate < 0) {
      out.push({
        id: 'negative', tone: 'bad', icon: '🚨', weight: 99,
        title: isBiz ? 'החודש נסגר בהפסד' : 'ההוצאות גבוהות מההכנסות החודש',
        text: `פער של ${money(Math.abs(cur.balance))} בין ${money(cur.income)} הכנסות ל-${money(cur.expense)} הוצאות.`,
      });
    } else if (cur.rate >= 30) {
      out.push({
        id: 'high-rate', tone: 'good', icon: '✨', weight: 72,
        title: isBiz ? `רווחיות של ${pctPlain(cur.rate)} החודש` : `שיעור חיסכון של ${pctPlain(cur.rate)} החודש`,
        text: `${money(cur.balance)} נותרו מתוך ${money(cur.income)}.`,
      });
    }
  }

  /* ---------- 9. חריגות תקציב ---------- */
  const budgets = budgetStatus(txs, state.budgets, month, space);
  const over = budgets.filter((b) => b.over);
  if (over.length) {
    const first = over[0];
    out.push({
      id: 'budget-over', tone: 'warn', icon: '🎯', weight: 92,
      title: over.length === 1
        ? `חריגה מהתקציב ב${catName(first.categoryId)}`
        : `חריגה ב-${over.length} תקציבים`,
      text: `${catName(first.categoryId)}: ${money(first.used)} מתוך ${money(first.amount)} (${Math.round(first.usedPct)}%).`,
    });
  }

  /* ---------- 10. קצב חודש שוטף ---------- */
  const pace = paceEstimate(txs, month, space);
  if (pace.isCurrent && pace.elapsedDays >= 5 && pace.elapsedDays < pace.totalDays - 2 && pace.expense > 0) {
    out.push({
      id: 'pace', tone: 'info', icon: '⏳', weight: 66,
      title: `בקצב הנוכחי החודש ייסגר על כ-${money(pace.projectedExpense)} הוצאות`,
      text: `עד כה ${money(pace.expense)} ב-${pace.elapsedDays} ימים מתוך ${pace.totalDays}.`,
    });
  }

  /* ---------- 11. הוצאה בודדת חריגה ---------- */
  const monthTx = selectTx(txs, { month, space, direction: 'expense' });
  const biggest = monthTx.filter((t) => !t.internalTransfer && !t.isSettlement && !t.isRefund)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
  if (biggest && cur.expense > 0) {
    const share = round2((Math.abs(biggest.amount) / cur.expense) * 100);
    if (share >= 20) {
      out.push({
        id: 'big-single', tone: 'warn', icon: '🔍', weight: 68,
        title: `הוצאה אחת מהווה ${Math.round(share)}% מהוצאות החודש`,
        text: `${biggest.name || biggest.merchant} — ${money(Math.abs(biggest.amount))}.`,
      });
    }
  }

  /* ---------- 12. התחייבויות עתידיות ---------- */
  const commitments = futureCommitments(txs, month, space);
  if (commitments.length) {
    const total = commitments.reduce((s, c) => s + c.remainingAmount, 0);
    out.push({
      id: 'commitments', tone: 'info', icon: '📆', weight: 58,
      title: `${commitments.length} עסקאות בתשלומים פעילות`,
      text: `יתרת התחייבות עתידית ${money(total)}, מתוכה ${money(commitments[0].remainingAmount)} על ${commitments[0].name}.`,
    });
  }

  /* ---------- 13. הוצאות קבועות מול משתנות ---------- */
  if (cur.expense > 0 && cur.fixed > 0) {
    const fixedShare = round2((cur.fixed / cur.expense) * 100);
    if (fixedShare >= 60) {
      out.push({
        id: 'fixed-share', tone: 'warn', icon: '🔁', weight: 52,
        title: `${Math.round(fixedShare)}% מההוצאות הן קבועות`,
        text: `${money(cur.fixed)} הוצאות קבועות מתוך ${money(cur.expense)} — גמישות נמוכה לצמצום מהיר.`,
      });
    }
  }

  return out.sort((a, b) => b.weight - a.weight);
}

/** תובנות למסך הסיכום הכולל — מסתכלות על שני המרחבים יחד */
export function buildCombinedInsights(state, month) {
  const txs = state.transactions;
  const out = [];
  const biz = monthTotals(txs, month, 'business');
  const per = monthTotals(txs, month, 'personal');
  const all = monthTotals(txs, month, 'all');

  if (all.count === 0) return buildInsights(state, { month, space: 'all' });

  if (biz.balance > 0 && per.balance < 0) {
    out.push({
      id: 'biz-covers', tone: 'warn', icon: '⚖️', weight: 90,
      title: 'הפעילות העסקית מכסה על גירעון פרטי',
      text: `רווח עסקי ${money(biz.balance)} מול גירעון פרטי ${money(Math.abs(per.balance))}. היתרה המשולבת ${money(all.balance)}.`,
    });
  }

  if (biz.income > 0 && per.income > 0) {
    const share = round2((biz.income / all.income) * 100);
    out.push({
      id: 'income-mix', tone: 'info', icon: '🧮', weight: 62,
      title: `${Math.round(share)}% מההכנסות מגיעות מהפעילות העסקית`,
      text: `עסקי ${money(biz.income)}, פרטי ${money(per.income)}.`,
    });
  }

  const hh = per.expense;
  if (biz.income > 0 && hh > 0) {
    const months = biz.balance > 0 ? Math.floor(biz.balance / hh) : 0;
    if (months >= 1) {
      out.push({
        id: 'runway', tone: 'good', icon: '🛟', weight: 64,
        title: `הרווח העסקי החודש מכסה ${months} ${months === 1 ? 'חודש' : 'חודשי'} הוצאות משק בית`,
        text: `הוצאות משק הבית ${money(hh)} לחודש.`,
      });
    }
  }

  return [...out, ...buildInsights(state, { month, space: 'all' })].sort((a, b) => b.weight - a.weight);
}

/** משפט תמציתי לכותרת הדשבורד */
export function headlineFor(state, month, space) {
  const list = space === 'all' ? buildCombinedInsights(state, month) : buildInsights(state, { month, space });
  return list[0] || null;
}
