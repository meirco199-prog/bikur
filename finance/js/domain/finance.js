/* ============================================================
   finance.js — מנוע החישוב הדטרמיניסטי
   ------------------------------------------------------------
   כל סכום, יתרה, אחוז, ממוצע ותחזית מחושבים כאן בקוד בלבד.
   אין שימוש ב-AI לחישובים. הפונקציות טהורות וניתנות לבדיקה.
   ============================================================ */

import { round2, monthKeyOf, addMonths, previousMonths, currentMonthKey, daysInMonth, todayISO } from '../core/util.js';

/* ============================================================
   כללי הכללה בחישוב
   ============================================================ */

/**
 * תנועה נספרת בחישובי הכנסות/הוצאות רק אם היא לא:
 *  - העברה פנימית (בין חשבונות שלי)
 *  - חיוב אשראי מרוכז (הסכום כבר נספר בעסקאות עצמן)
 *  - ממתינה לאישור ייבוא
 */
export function countsInTotals(tx) {
  return !tx.internalTransfer && !tx.isSettlement && tx.status !== 'pending';
}

/** סכום חתום של תנועה: זיכוי מקטין את הצד שלו */
export function signedAmount(tx) {
  const a = Math.abs(Number(tx.amount) || 0);
  return tx.isRefund ? -a : a;
}

/* ============================================================
   בחירה וסינון
   ============================================================ */

/**
 * סינון תנועות.
 * space: 'business' | 'personal' | 'all'
 */
export function selectTx(transactions, filters = {}) {
  const {
    space = 'all', month = null, months = null, direction = null,
    categoryId = null, accountId = null, paymentMethod = null,
    expenseType = null, text = '', amountMin = null, amountMax = null,
    dateFrom = null, dateTo = null, status = null, includeExcluded = true,
    flag = null,
  } = filters;

  const monthSet = months ? new Set(months) : null;
  const q = String(text || '').trim().toLowerCase();

  return transactions.filter((tx) => {
    if (space !== 'all' && tx.space !== space) return false;
    if (month && tx.month !== month) return false;
    if (monthSet && !monthSet.has(tx.month)) return false;
    if (direction && tx.direction !== direction) return false;
    if (categoryId && tx.categoryId !== categoryId) return false;
    if (accountId && tx.accountId !== accountId) return false;
    if (paymentMethod && tx.paymentMethod !== paymentMethod) return false;
    if (expenseType && tx.expenseType !== expenseType) return false;
    if (status && tx.status !== status) return false;
    if (!includeExcluded && !countsInTotals(tx)) return false;
    if (dateFrom && tx.date < dateFrom) return false;
    if (dateTo && tx.date > dateTo) return false;
    const amt = Math.abs(Number(tx.amount) || 0);
    if (amountMin !== null && amountMin !== '' && amt < Number(amountMin)) return false;
    if (amountMax !== null && amountMax !== '' && amt > Number(amountMax)) return false;
    if (flag === 'transfer' && !tx.internalTransfer) return false;
    if (flag === 'settlement' && !tx.isSettlement) return false;
    if (flag === 'refund' && !tx.isRefund) return false;
    if (flag === 'recurring' && !tx.recurring) return false;
    if (flag === 'installment' && !tx.installment) return false;
    if (q) {
      const hay = `${tx.name} ${tx.merchant} ${tx.description} ${tx.note} ${tx.cardLast4 || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/* ============================================================
   סכומים
   ============================================================ */

/** סך הכנסות/הוצאות/יתרה עבור אוסף תנועות */
export function totals(txs) {
  let income = 0, expense = 0, fixed = 0, variable = 0, oneoff = 0;
  let count = 0;
  for (const tx of txs) {
    if (!countsInTotals(tx)) continue;
    const v = signedAmount(tx);
    count++;
    if (tx.direction === 'income') income += v;
    else {
      expense += v;
      if (tx.expenseType === 'fixed') fixed += v;
      else if (tx.expenseType === 'oneoff') oneoff += v;
      else variable += v;
    }
  }
  income = round2(income); expense = round2(expense);
  const balance = round2(income - expense);
  return {
    income, expense, balance, count,
    fixed: round2(fixed), variable: round2(variable), oneoff: round2(oneoff),
    /** אחוז חיסכון / רווח מתוך ההכנסה */
    rate: income > 0 ? round2((balance / income) * 100) : null,
  };
}

/** סכומי חודש בודד */
export function monthTotals(transactions, month, space = 'all') {
  return totals(selectTx(transactions, { month, space }));
}

/** מפה של חודש → סכומים */
export function totalsByMonth(transactions, months, space = 'all') {
  const map = new Map(months.map((m) => [m, { income: 0, expense: 0, balance: 0, rate: null, count: 0, fixed: 0, variable: 0, oneoff: 0 }]));
  const wanted = new Set(months);
  const buckets = new Map(months.map((m) => [m, []]));
  for (const tx of transactions) {
    if (space !== 'all' && tx.space !== space) continue;
    if (!wanted.has(tx.month)) continue;
    buckets.get(tx.month).push(tx);
  }
  for (const m of months) map.set(m, totals(buckets.get(m)));
  return map;
}

/* ============================================================
   השוואות ושינויים
   ============================================================ */

/** שינוי באחוזים בין שני ערכים. מחזיר null כשאין בסיס להשוואה. */
export function pctChange(current, base) {
  const c = Number(current) || 0;
  const b = Number(base) || 0;
  if (b === 0) return c === 0 ? 0 : null;
  return round2(((c - b) / Math.abs(b)) * 100);
}

/** ממוצע חשבוני של רשימת מספרים (מתעלם מ-null) */
export function average(values) {
  const nums = values.filter((v) => typeof v === 'number' && isFinite(v));
  if (!nums.length) return 0;
  return round2(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/**
 * ממוצע N החודשים שקדמו לחודש הנתון.
 * onlyWithData=true מתעלם מחודשים ריקים לגמרי כדי לא לעוות ממוצע.
 */
export function trailingAverage(transactions, month, n, space, field = 'expense', onlyWithData = true) {
  const months = previousMonths(month, n);
  const map = totalsByMonth(transactions, months, space);
  const vals = [];
  for (const m of months) {
    const t = map.get(m);
    if (onlyWithData && t.count === 0) continue;
    vals.push(t[field]);
  }
  return { value: average(vals), months: vals.length };
}

/** חבילת ההשוואות המלאה לדשבורד */
export function comparisons(transactions, month, space) {
  const cur = monthTotals(transactions, month, space);
  const prevKey = addMonths(month, -1);
  const prev = monthTotals(transactions, prevKey, space);

  const avg3Exp = trailingAverage(transactions, month, 3, space, 'expense');
  const avg6Exp = trailingAverage(transactions, month, 6, space, 'expense');
  const avg3Inc = trailingAverage(transactions, month, 3, space, 'income');
  const avg6Inc = trailingAverage(transactions, month, 6, space, 'income');
  const avg3Bal = trailingAverage(transactions, month, 3, space, 'balance');
  const avg6Bal = trailingAverage(transactions, month, 6, space, 'balance');

  return {
    current: cur,
    previous: { key: prevKey, ...prev },
    vsPrev: {
      income: pctChange(cur.income, prev.income),
      expense: pctChange(cur.expense, prev.expense),
      balance: pctChange(cur.balance, prev.balance),
    },
    avg3: { income: avg3Inc.value, expense: avg3Exp.value, balance: avg3Bal.value, months: avg3Exp.months },
    avg6: { income: avg6Inc.value, expense: avg6Exp.value, balance: avg6Bal.value, months: avg6Exp.months },
    vsAvg3: {
      income: pctChange(cur.income, avg3Inc.value),
      expense: pctChange(cur.expense, avg3Exp.value),
      balance: pctChange(cur.balance, avg3Bal.value),
    },
    vsAvg6: {
      income: pctChange(cur.income, avg6Inc.value),
      expense: pctChange(cur.expense, avg6Exp.value),
      balance: pctChange(cur.balance, avg6Bal.value),
    },
  };
}

/* ============================================================
   קטגוריות
   ============================================================ */

/** חלוקה לפי קטגוריה, ממוינת מהגבוה לנמוך */
export function byCategory(txs, direction = 'expense') {
  const map = new Map();
  let total = 0;
  for (const tx of txs) {
    if (!countsInTotals(tx)) continue;
    if (tx.direction !== direction) continue;
    const v = signedAmount(tx);
    const key = tx.categoryId || '__none__';
    const cur = map.get(key) || { categoryId: key, amount: 0, count: 0 };
    cur.amount = round2(cur.amount + v);
    cur.count++;
    map.set(key, cur);
    total += v;
  }
  total = round2(total);
  const rows = [...map.values()]
    .map((r) => ({ ...r, share: total > 0 ? round2((r.amount / total) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);
  return { rows, total };
}

/** N ההוצאות הגדולות */
export function topExpenses(txs, n = 5) {
  return txs
    .filter((tx) => countsInTotals(tx) && tx.direction === 'expense' && !tx.isRefund)
    .slice()
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, n);
}

/**
 * קטגוריות עם עלייה חריגה מול ממוצע החודשים הקודמים.
 * חריגה = עלייה של מעל minPct אחוז וגם מעל minAbs שקלים.
 */
export function categoryAnomalies(transactions, month, space, {
  lookback = 3, minPct = 25, minAbs = 250,
} = {}) {
  const curTx = selectTx(transactions, { month, space });
  const cur = byCategory(curTx, 'expense');
  const prevMonths = previousMonths(month, lookback);
  const prevTx = selectTx(transactions, { months: prevMonths, space });
  const prevPerMonth = new Map();

  for (const m of prevMonths) {
    const b = byCategory(prevTx.filter((t) => t.month === m), 'expense');
    for (const row of b.rows) {
      if (!prevPerMonth.has(row.categoryId)) prevPerMonth.set(row.categoryId, []);
      prevPerMonth.get(row.categoryId).push(row.amount);
    }
  }

  const out = [];
  for (const row of cur.rows) {
    const hist = prevPerMonth.get(row.categoryId) || [];
    const baseline = hist.length ? average(hist) : 0;
    const diff = round2(row.amount - baseline);
    const change = pctChange(row.amount, baseline);
    if (baseline === 0) {
      if (row.amount >= minAbs) {
        out.push({ categoryId: row.categoryId, amount: row.amount, baseline: 0, diff, change: null, isNew: true, monthsOfHistory: 0 });
      }
      continue;
    }
    if (change !== null && change >= minPct && diff >= minAbs) {
      out.push({ categoryId: row.categoryId, amount: row.amount, baseline, diff, change, isNew: false, monthsOfHistory: hist.length });
    }
  }
  return out.sort((a, b) => b.diff - a.diff);
}

/** קטגוריות שנעלמו: היו בחודש הקודם ואינן בנוכחי */
export function vanishedCategories(transactions, month, space) {
  const cur = new Set(byCategory(selectTx(transactions, { month, space }), 'expense').rows.map((r) => r.categoryId));
  const prevKey = addMonths(month, -1);
  const prev = byCategory(selectTx(transactions, { month: prevKey, space }), 'expense').rows;
  return prev.filter((r) => !cur.has(r.categoryId));
}

/* ============================================================
   מגמה
   ============================================================ */

/** סדרת חודשים לגרף */
export function trendSeries(transactions, months, space) {
  const map = totalsByMonth(transactions, months, space);
  return months.map((m) => {
    const t = map.get(m);
    return { month: m, income: t.income, expense: t.expense, balance: t.balance, rate: t.rate, count: t.count };
  });
}

/** רגרסיה לינארית פשוטה — מחזירה שיפוע וחיתוך */
export function linearTrend(values) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => typeof v === 'number' && isFinite(v));
  const n = pts.length;
  if (n < 2) return { slope: 0, intercept: n ? pts[0][1] : 0, n };
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const [x, y] of pts) { sx += x; sy += y; sxy += x * y; sxx += x * x; }
  const denom = n * sxx - sx * sx;
  if (denom === 0) return { slope: 0, intercept: sy / n, n };
  const slope = (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return { slope: round2(slope), intercept: round2(intercept), n };
}

/* ============================================================
   תחזית
   ============================================================ */

/**
 * תחזית שנתית לפי שלושה בסיסים: ממוצע 3, ממוצע 6, ומתחילת השנה.
 * הכל חישוב אריתמטי בלבד.
 */
export function forecast(transactions, month, space, opts = {}) {
  const { commitments = 0 } = opts;
  const year = Number(month.slice(0, 4));
  const monthNum = Number(month.slice(5, 7));

  const ytdMonths = [];
  for (let m = 1; m <= monthNum; m++) ytdMonths.push(`${year}-${String(m).padStart(2, '0')}`);
  const ytdMap = totalsByMonth(transactions, ytdMonths, space);
  let ytdIncome = 0, ytdExpense = 0, activeMonths = 0;
  for (const m of ytdMonths) {
    const t = ytdMap.get(m);
    ytdIncome += t.income; ytdExpense += t.expense;
    if (t.count > 0) activeMonths++;
  }
  ytdIncome = round2(ytdIncome); ytdExpense = round2(ytdExpense);

  const inc3 = trailingAverageIncl(transactions, month, 3, space, 'income');
  const exp3 = trailingAverageIncl(transactions, month, 3, space, 'expense');
  const inc6 = trailingAverageIncl(transactions, month, 6, space, 'income');
  const exp6 = trailingAverageIncl(transactions, month, 6, space, 'expense');
  const incYtd = activeMonths ? round2(ytdIncome / activeMonths) : 0;
  const expYtd = activeMonths ? round2(ytdExpense / activeMonths) : 0;

  const remaining = Math.max(0, 12 - monthNum);

  const build = (avgIncome, avgExpense, label) => {
    const restIncome = round2(avgIncome * remaining);
    const restExpense = round2(avgExpense * remaining + commitments);
    return {
      label,
      monthlyIncome: avgIncome,
      monthlyExpense: avgExpense,
      monthlyBalance: round2(avgIncome - avgExpense),
      restIncome, restExpense,
      restBalance: round2(restIncome - restExpense),
      yearIncome: round2(ytdIncome + restIncome),
      yearExpense: round2(ytdExpense + restExpense),
      yearBalance: round2(ytdIncome + restIncome - ytdExpense - restExpense),
    };
  };

  return {
    month, year, remainingMonths: remaining, activeMonths, commitments,
    ytd: { income: ytdIncome, expense: ytdExpense, balance: round2(ytdIncome - ytdExpense), months: activeMonths },
    scenarios: {
      avg3: build(inc3, exp3, 'ממוצע 3 חודשים'),
      avg6: build(inc6, exp6, 'ממוצע 6 חודשים'),
      ytd:  build(incYtd, expYtd, 'מתחילת השנה'),
    },
  };
}

/** ממוצע N החודשים האחרונים כולל החודש הנוכחי */
function trailingAverageIncl(transactions, month, n, space, field) {
  const months = [];
  for (let i = n - 1; i >= 0; i--) months.push(addMonths(month, -i));
  const map = totalsByMonth(transactions, months, space);
  const vals = [];
  for (const m of months) {
    const t = map.get(m);
    if (t.count === 0) continue;
    vals.push(t[field]);
  }
  return average(vals);
}

/** קצב הוצאה בחודש שוטף → הערכה לסוף החודש */
export function paceEstimate(transactions, month, space) {
  const t = monthTotals(transactions, month, space);
  const isCurrent = month === currentMonthKey();
  if (!isCurrent) return { ...t, projectedExpense: t.expense, projectedIncome: t.income, elapsedDays: daysInMonth(month), totalDays: daysInMonth(month), isCurrent: false };
  const total = daysInMonth(month);
  const elapsed = Math.max(1, Number(todayISO().slice(8, 10)));
  const factor = total / elapsed;
  return {
    ...t, isCurrent: true, elapsedDays: elapsed, totalDays: total,
    projectedExpense: round2(t.expense * factor),
    projectedIncome: round2(t.income * factor),
  };
}

/** התחייבויות עתידיות ידועות: יתרת תשלומים + הוצאות קבועות */
export function futureCommitments(transactions, month, space) {
  const rows = [];
  const seen = new Set();
  for (const tx of transactions) {
    if (space !== 'all' && tx.space !== space) continue;
    if (tx.month !== month) continue;
    if (!tx.installment) continue;
    const left = Number(tx.installment.total) - Number(tx.installment.current);
    if (left <= 0) continue;
    const key = `${tx.merchant}|${tx.installment.total}|${tx.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      name: tx.name || tx.merchant,
      monthly: Math.abs(tx.amount),
      remainingPayments: left,
      remainingAmount: round2(Math.abs(tx.amount) * left),
      current: tx.installment.current,
      total: tx.installment.total,
      categoryId: tx.categoryId,
    });
  }
  return rows.sort((a, b) => b.remainingAmount - a.remainingAmount);
}

/* ============================================================
   תקציבים
   ============================================================ */

/** תקציב אפקטיבי לקטגוריה בחודש: תקציב ייעודי לחודש גובר על הכללי */
export function budgetFor(budgets, categoryId, month) {
  const specific = budgets.find((b) => b.categoryId === categoryId && b.month === month);
  if (specific) return specific;
  return budgets.find((b) => b.categoryId === categoryId && !b.month) || null;
}

/** מצב כל התקציבים בחודש */
export function budgetStatus(transactions, budgets, month, space) {
  const txs = selectTx(transactions, { month, space });
  const spent = new Map();
  for (const tx of txs) {
    if (!countsInTotals(tx) || tx.direction !== 'expense') continue;
    spent.set(tx.categoryId, round2((spent.get(tx.categoryId) || 0) + signedAmount(tx)));
  }
  const relevant = budgets.filter((b) => (space === 'all' || b.space === space) && (b.month === month || !b.month));
  const seen = new Set();
  const rows = [];
  for (const b of relevant) {
    if (seen.has(b.categoryId)) continue;
    const eff = budgetFor(relevant, b.categoryId, month);
    if (!eff) continue;
    seen.add(b.categoryId);
    const used = spent.get(b.categoryId) || 0;
    const amount = Number(eff.amount) || 0;
    rows.push({
      budgetId: eff.id, categoryId: b.categoryId, space: eff.space,
      amount, used, remaining: round2(amount - used),
      usedPct: amount > 0 ? round2((used / amount) * 100) : null,
      over: amount > 0 && used > amount,
      isMonthSpecific: !!eff.month,
    });
  }
  return rows.sort((a, b) => (b.usedPct || 0) - (a.usedPct || 0));
}

/* ============================================================
   השוואת חודשים
   ============================================================ */

export function compareMonths(transactions, monthA, monthB, space) {
  const a = monthTotals(transactions, monthA, space);
  const b = monthTotals(transactions, monthB, space);

  const catA = byCategory(selectTx(transactions, { month: monthA, space }), 'expense');
  const catB = byCategory(selectTx(transactions, { month: monthB, space }), 'expense');
  const mapA = new Map(catA.rows.map((r) => [r.categoryId, r.amount]));
  const mapB = new Map(catB.rows.map((r) => [r.categoryId, r.amount]));
  const ids = new Set([...mapA.keys(), ...mapB.keys()]);

  const categories = [];
  for (const id of ids) {
    const va = mapA.get(id) || 0;
    const vb = mapB.get(id) || 0;
    categories.push({
      categoryId: id, a: va, b: vb,
      diff: round2(vb - va),
      change: pctChange(vb, va),
      isNew: va === 0 && vb > 0,
      vanished: vb === 0 && va > 0,
    });
  }
  categories.sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff));

  return {
    monthA, monthB, a, b,
    totals: {
      income:  { a: a.income,  b: b.income,  diff: round2(b.income - a.income),   change: pctChange(b.income, a.income) },
      expense: { a: a.expense, b: b.expense, diff: round2(b.expense - a.expense), change: pctChange(b.expense, a.expense) },
      balance: { a: a.balance, b: b.balance, diff: round2(b.balance - a.balance), change: pctChange(b.balance, a.balance) },
    },
    categories,
    increases: categories.filter((c) => c.diff > 0 && !c.isNew),
    decreases: categories.filter((c) => c.diff < 0 && !c.vanished),
    added: categories.filter((c) => c.isNew),
    removed: categories.filter((c) => c.vanished),
  };
}

/* ============================================================
   חשבונות
   ============================================================ */

/** תנועה נטו בחשבון (כולל העברות פנימיות — הן משפיעות על היתרה) */
export function accountFlow(transactions, accountId, month = null) {
  let inflow = 0, outflow = 0, count = 0;
  for (const tx of transactions) {
    if (tx.accountId !== accountId) continue;
    if (month && tx.month !== month) continue;
    if (tx.status === 'pending') continue;
    const v = signedAmount(tx);
    count++;
    if (tx.direction === 'income') inflow += v; else outflow += v;
  }
  return { inflow: round2(inflow), outflow: round2(outflow), net: round2(inflow - outflow), count };
}

/** רשימת כל החודשים שיש בהם נתונים, מהחדש לישן */
export function monthsWithData(transactions) {
  const set = new Set();
  for (const tx of transactions) if (tx.month) set.add(tx.month);
  return [...set].sort().reverse();
}

/** טווח החודשים בפועל, מורחב לחודש הנוכחי */
export function dataMonthRange(transactions) {
  const months = monthsWithData(transactions);
  const cur = currentMonthKey();
  if (!months.length) return { from: cur, to: cur };
  const from = months[months.length - 1];
  const to = months[0] > cur ? months[0] : cur;
  return { from, to };
}

export { monthKeyOf };
