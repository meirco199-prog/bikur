/* ============================================================
   seed.js — נתוני הדגמה
   ------------------------------------------------------------
   8 חודשי היסטוריה מלאים, עסקי ופרטי, כדי שכל הגרפים,
   ההשוואות, המגמות והתחזיות יעבדו מיד.
   הגנרטור דטרמיניסטי — אותם נתונים בכל טעינה.
   ============================================================ */

import {
  defaultCategories, defaultAccounts, defaultSettings,
  newTransaction, newBudget, newMerchantRule, newImportBatch, emptyState,
} from './schema.js';
import { currentMonthKey, addMonths, daysInMonth, round2, uid } from './util.js';

/** מחולל מספרים פסאודו-אקראי עם זרע קבוע */
function rng(seed = 20260829) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MONTHS_BACK = 7; // 8 חודשים כולל הנוכחי

/* ============================================================
   מתכוני תנועות
   ------------------------------------------------------------
   freq: כמה פעמים בחודש (1 = פעם אחת, 4 = ארבע פעמים)
   vary: אחוז סטייה מהסכום הבסיסי
   drift: שינוי הדרגתי לאורך החודשים (מגמה)
   ============================================================ */

const PERSONAL_INCOME = [
  { cat: 'משכורת', name: 'משכורת חודשית', amount: 27500, day: 1, vary: 0.02, drift: 0.004, method: 'transfer', recurring: true },
  { cat: 'משכורת בן/בת זוג', name: 'משכורת בן/בת הזוג', amount: 14200, day: 2, vary: 0.03, method: 'transfer', recurring: true },
  { cat: 'קצבאות', name: 'קצבת ילדים — ביטוח לאומי', amount: 748, day: 20, vary: 0, method: 'transfer', recurring: true },
  { cat: 'שכירות מנכס', name: 'שכר דירה — דירת השקעה', amount: 4300, day: 5, vary: 0, method: 'transfer', recurring: true },
  { cat: 'החזרים', name: 'החזר מס הכנסה', amount: 3100, day: 14, vary: 0.2, months: [2], method: 'transfer' },
];

const PERSONAL_EXPENSE = [
  { cat: 'דיור', name: 'משכנתא — בנק', amount: 7420, day: 4, vary: 0.01, type: 'fixed', method: 'standing', recurring: true },
  { cat: 'ארנונה', name: 'ארנונה עירייה', amount: 690, day: 6, vary: 0, type: 'fixed', method: 'standing', recurring: true },
  { cat: 'ועד בית', name: 'ועד בית', amount: 250, day: 3, vary: 0, type: 'fixed', method: 'standing', recurring: true },
  { cat: 'חשמל', name: 'חברת החשמל', amount: 640, day: 12, vary: 0.28, type: 'variable', method: 'standing', recurring: true, seasonal: true },
  { cat: 'מים', name: 'מי אביבים', amount: 240, day: 15, vary: 0.15, type: 'variable', method: 'standing', recurring: true },
  { cat: 'גז', name: 'סופרגז', amount: 96, day: 9, vary: 0.1, type: 'fixed', method: 'standing', recurring: true },
  { cat: 'אינטרנט', name: 'בזק בינלאומי', amount: 129, day: 8, vary: 0, type: 'fixed', method: 'credit', recurring: true },
  { cat: 'טלוויזיה', name: 'Netflix', amount: 54.9, day: 11, vary: 0, type: 'fixed', method: 'credit', recurring: true },
  { cat: 'סלולר', name: 'פרטנר — חבילה משפחתית', amount: 189, day: 10, vary: 0, type: 'fixed', method: 'standing', recurring: true },
  { cat: 'ביטוחים', name: 'הראל ביטוח בריאות', amount: 612, day: 7, vary: 0, type: 'fixed', method: 'standing', recurring: true },
  { cat: 'ביטוחי רכב', name: 'ביטוח ישיר — רכב', amount: 385, day: 7, vary: 0, type: 'fixed', method: 'standing', recurring: true },
  { cat: 'הלוואת / ליסינג רכב', name: 'ליסינג רכב', amount: 2150, day: 5, vary: 0, type: 'fixed', method: 'standing', recurring: true },
  { cat: 'חדר כושר', name: 'הולמס פלייס', amount: 289, day: 2, vary: 0, type: 'fixed', method: 'credit', recurring: true },
  { cat: 'בתי ספר וגנים', name: 'צהרון + גן', amount: 2340, day: 3, vary: 0, type: 'fixed', method: 'standing', recurring: true },
  { cat: 'חוגים', name: 'חוג התעמלות', amount: 320, day: 4, vary: 0, type: 'fixed', method: 'credit', recurring: true },
  { cat: 'חיסכון', name: 'הפקדה לקרן השתלמות', amount: 2000, day: 1, vary: 0, type: 'saving', method: 'standing', recurring: true },
  { cat: 'חיסכון', name: 'הפקדה לקופת גמל להשקעה', amount: 1500, day: 1, vary: 0, type: 'saving', method: 'standing', recurring: true },

  { cat: 'קניות בסופר', name: 'שופרסל דיל', amount: 780, day: 5, freq: 2, vary: 0.3, type: 'variable', method: 'credit' },
  { cat: 'קניות בסופר', name: 'רמי לוי', amount: 520, day: 17, freq: 2, vary: 0.35, type: 'variable', method: 'credit' },
  { cat: 'קניות בסופר', name: 'מחסני השוק', amount: 310, day: 24, vary: 0.4, type: 'variable', method: 'credit' },
  { cat: 'מסעדות', name: 'ארומה', amount: 68, day: 6, freq: 3, vary: 0.5, type: 'variable', method: 'credit' },
  { cat: 'מסעדות', name: 'וולט', amount: 145, day: 13, freq: 3, vary: 0.55, type: 'variable', method: 'credit' },
  { cat: 'דלק', name: 'פז יילו', amount: 340, day: 8, freq: 2, vary: 0.25, type: 'variable', method: 'credit' },
  { cat: 'טעינת רכב חשמלי', name: 'אלקטרה פאוור', amount: 180, day: 19, freq: 2, vary: 0.3, type: 'variable', method: 'credit' },
  { cat: 'בריאות', name: 'סופר פארם', amount: 210, day: 16, freq: 2, vary: 0.45, type: 'variable', method: 'credit' },
  { cat: 'תרופות', name: 'בית מרקחת כללית', amount: 118, day: 21, vary: 0.4, type: 'variable', method: 'credit' },
  { cat: 'בילויים', name: 'סינמה סיטי', amount: 190, day: 22, vary: 0.4, type: 'variable', method: 'credit' },
  { cat: 'ביגוד', name: 'קסטרו', amount: 430, day: 18, vary: 0.6, type: 'variable', method: 'credit' },
  { cat: 'ילדים', name: 'ציוד לילדים', amount: 380, day: 14, vary: 0.5, type: 'variable', method: 'credit' },
  { cat: 'קניות שונות', name: 'איקאה', amount: 520, day: 26, vary: 0.7, type: 'variable', method: 'credit', months: [0, 3, 5] },
  { cat: 'קניות שונות', name: 'Amazon', amount: 260, day: 11, vary: 0.6, type: 'variable', method: 'credit' },
  { cat: 'כרטיסי אשראי', name: 'עמלת כרטיס אשראי', amount: 22, day: 2, vary: 0, type: 'fixed', method: 'credit' },
];

const BUSINESS_INCOME = [
  { cat: 'עמלות', name: 'עמלות סוכנות — הראל', amount: 52000, day: 5, vary: 0.16, drift: 0.012, method: 'transfer', recurring: true },
  { cat: 'עמלות', name: 'עמלות סוכנות — מגדל', amount: 27000, day: 7, vary: 0.2, method: 'transfer', recurring: true },
  { cat: 'נפרעים', name: 'נפרעים — כלל ביטוח', amount: 21000, day: 12, vary: 0.22, drift: 0.008, method: 'transfer', recurring: true },
  { cat: 'עמלות היקף', name: 'עמלת היקף רבעונית', amount: 26000, day: 15, vary: 0.25, months: [1, 4, 7], method: 'transfer' },
  { cat: 'הכנסות מסוכני משנה', name: 'הכנסות מסוכני משנה', amount: 12500, day: 9, vary: 0.3, method: 'transfer' },
  { cat: 'הכנסות משירותים', name: 'ייעוץ פיננסי', amount: 6500, day: 18, vary: 0.4, method: 'transfer' },
  { cat: 'הכנסה חד-פעמית', name: 'בונוס יעד שנתי', amount: 32000, day: 20, vary: 0.1, months: [3], method: 'transfer' },
];

const BUSINESS_EXPENSE = [
  { cat: 'משכורות', name: 'משכורות עובדים', amount: 28400, day: 9, vary: 0.04, drift: 0.006, type: 'fixed', method: 'transfer', recurring: true },
  { cat: 'שכר סוכנים', name: 'עמלות לסוכני משנה', amount: 11200, day: 10, vary: 0.22, type: 'variable', method: 'transfer', recurring: true },
  { cat: 'פרילנסרים', name: 'מעצב גרפי', amount: 2800, day: 14, vary: 0.5, type: 'variable', method: 'transfer' },
  { cat: 'שכירות משרד', name: 'שכירות משרד', amount: 8900, day: 1, vary: 0, type: 'fixed', method: 'standing', recurring: true },
  { cat: 'ארנונה', name: 'ארנונה עסקית', amount: 1420, day: 6, vary: 0, type: 'fixed', method: 'standing', recurring: true },
  { cat: 'חשמל', name: 'חשמל משרד', amount: 780, day: 12, vary: 0.24, type: 'variable', method: 'standing', recurring: true, seasonal: true },
  { cat: 'CRM', name: 'Salesforce', amount: 1240, day: 3, vary: 0, type: 'fixed', method: 'credit', recurring: true },
  { cat: 'תוכנות', name: 'Google Workspace', amount: 420, day: 4, vary: 0, type: 'fixed', method: 'credit', recurring: true },
  { cat: 'תוכנות', name: 'Microsoft 365', amount: 310, day: 4, vary: 0, type: 'fixed', method: 'credit', recurring: true },
  { cat: 'תוכנות', name: 'חשבונית ירוקה', amount: 89, day: 2, vary: 0, type: 'fixed', method: 'credit', recurring: true },
  { cat: 'סלולר', name: 'סלקום עסקי', amount: 460, day: 10, vary: 0, type: 'fixed', method: 'standing', recurring: true },
  { cat: 'אינטרנט', name: 'בזק עסקי', amount: 340, day: 8, vary: 0, type: 'fixed', method: 'standing', recurring: true },
  { cat: 'פרסום', name: 'Meta Ads', amount: 6200, day: 1, freq: 2, vary: 0.35, drift: 0.02, type: 'variable', method: 'credit' },
  { cat: 'פרסום', name: 'Google Ads', amount: 4800, day: 15, vary: 0.3, drift: 0.018, type: 'variable', method: 'credit' },
  { cat: 'לידים', name: 'רכישת לידים', amount: 3400, day: 11, vary: 0.4, type: 'variable', method: 'credit' },
  { cat: 'רכב', name: 'ליסינג רכב עסקי', amount: 3100, day: 5, vary: 0, type: 'fixed', method: 'standing', recurring: true },
  { cat: 'דלק', name: 'דלק — רכב עסקי', amount: 1250, day: 13, vary: 0.2, type: 'variable', method: 'credit' },
  { cat: 'הנהלת חשבונות', name: 'הנהלת חשבונות', amount: 1800, day: 7, vary: 0, type: 'fixed', method: 'transfer', recurring: true },
  { cat: 'רואה חשבון', name: 'רואה חשבון — דוח שנתי', amount: 6800, day: 20, vary: 0, months: [2], type: 'oneoff', method: 'transfer' },
  { cat: 'ביטוחים', name: 'ביטוח אחריות מקצועית', amount: 940, day: 7, vary: 0, type: 'fixed', method: 'standing', recurring: true },
  { cat: 'ציוד משרדי', name: 'אופיס דיפו', amount: 480, day: 17, vary: 0.6, type: 'variable', method: 'credit' },
  { cat: 'מחשוב', name: 'KSP — ציוד מחשוב', amount: 3900, day: 22, vary: 0.4, months: [1, 5], type: 'oneoff', method: 'credit' },
  { cat: 'עמלות סליקה', name: 'עמלות סליקה — טרנזילה', amount: 620, day: 28, vary: 0.2, type: 'variable', method: 'credit', recurring: true },
  { cat: 'עמלות בנק', name: 'עמלות בנק', amount: 210, day: 25, vary: 0.15, type: 'variable', method: 'transfer', recurring: true },
  { cat: 'מיסים', name: 'מקדמות מס הכנסה', amount: 9200, day: 15, vary: 0.12, type: 'fixed', method: 'transfer', recurring: true },
  { cat: 'מיסים', name: 'מע״מ', amount: 6400, day: 15, vary: 0.25, type: 'variable', method: 'transfer', recurring: true },
];

/* ============================================================
   בניית הנתונים
   ============================================================ */

export function buildDemoState() {
  const rand = rng();
  const state = emptyState();
  state.categories = defaultCategories();
  state.accounts = defaultAccounts();
  state.settings = { ...defaultSettings(), lastSpace: 'personal' };

  const catId = (space, kind, name) => {
    const c = state.categories.find((x) => x.space === space && x.kind === kind && x.name === name);
    return c ? c.id : null;
  };
  const acc = (name) => state.accounts.find((a) => a.name === name);

  const persBank = acc('עובר ושב פרטי');
  const bizBank = acc('עובר ושב עסקי');
  const persCard = acc('כרטיס אשראי פרטי');
  const bizCard = acc('כרטיס אשראי עסקי');
  const wallet = persCard;

  const thisMonth = currentMonthKey();
  const months = [];
  for (let i = MONTHS_BACK; i >= 0; i--) months.push(addMonths(thisMonth, -i));

  const txs = [];

  const emit = (recipe, space, kind, monthIdx, month) => {
    if (recipe.months && !recipe.months.includes(monthIdx)) return;
    const freq = recipe.freq || 1;
    const dim = daysInMonth(month);
    const monthNum = Number(month.slice(5, 7));

    for (let k = 0; k < freq; k++) {
      let amount = recipe.amount;
      if (recipe.drift) amount *= 1 + recipe.drift * monthIdx;
      if (recipe.vary) amount *= 1 + (rand() * 2 - 1) * recipe.vary;
      if (recipe.seasonal) {
        // חשמל: שיא בקיץ ובחורף
        const s = Math.cos(((monthNum - 1) / 12) * 2 * Math.PI * 2) * 0.22;
        amount *= 1 + s;
      }
      amount = round2(Math.max(1, amount));

      const spread = freq > 1 ? Math.floor((dim / freq) * k) : 0;
      const day = Math.min(dim, Math.max(1, (recipe.day || 10) + spread + Math.floor(rand() * 3) - 1));
      const date = `${month}-${String(day).padStart(2, '0')}`;

      const method = recipe.method || 'credit';
      let accountId = null;
      if (space === 'personal') accountId = method === 'credit' ? persCard.id : persBank.id;
      else accountId = method === 'credit' ? bizCard.id : bizBank.id;
      const account = state.accounts.find((a) => a.id === accountId);

      txs.push(newTransaction({
        date, month,
        name: recipe.name,
        merchant: recipe.name,
        amount,
        direction: kind,
        space,
        categoryId: catId(space, kind, recipe.cat),
        expenseType: kind === 'income' ? null : (recipe.type || 'variable'),
        paymentMethod: method,
        accountId,
        cardLast4: account?.type === 'credit' ? account.last4 : null,
        recurring: !!recipe.recurring,
        autoCopy: recipe.type === 'fixed',
        source: 'manual',
        confidence: 100,
        createdAt: Date.now() - (MONTHS_BACK - monthIdx) * 2592000000,
      }));
    }
  };

  months.forEach((month, monthIdx) => {
    PERSONAL_INCOME.forEach((r) => emit(r, 'personal', 'income', monthIdx, month));
    PERSONAL_EXPENSE.forEach((r) => emit(r, 'personal', 'expense', monthIdx, month));
    BUSINESS_INCOME.forEach((r) => emit(r, 'business', 'income', monthIdx, month));
    BUSINESS_EXPENSE.forEach((r) => emit(r, 'business', 'expense', monthIdx, month));
  });

  /* ---------- עסקה בתשלומים: מקרר ב-6 תשלומים ---------- */
  const startIdx = Math.max(0, months.length - 5);
  for (let p = 1; p <= 6; p++) {
    const idx = startIdx + p - 1;
    if (idx >= months.length) break;
    const month = months[idx];
    txs.push(newTransaction({
      date: `${month}-18`, month,
      name: 'מקרר — א.ל.מ חשמל',
      merchant: 'א.ל.מ חשמל',
      amount: 1166.67,
      direction: 'expense',
      space: 'personal',
      categoryId: catId('personal', 'expense', 'קניות שונות'),
      expenseType: 'fixed',
      paymentMethod: 'credit',
      accountId: persCard.id,
      cardLast4: persCard.last4,
      installment: { current: p, total: 6, totalAmount: 7000 },
      note: 'רכישה ב-6 תשלומים ללא ריבית',
      source: 'import',
    }));
  }

  /* ---------- זיכוי: החזר מחנות ---------- */
  const refundMonth = months[months.length - 3];
  txs.push(newTransaction({
    date: `${refundMonth}-22`, month: refundMonth,
    name: 'זיכוי — קסטרו',
    merchant: 'קסטרו',
    amount: 430,
    direction: 'expense',
    isRefund: true,
    space: 'personal',
    categoryId: catId('personal', 'expense', 'ביגוד'),
    expenseType: 'variable',
    paymentMethod: 'credit',
    accountId: persCard.id,
    cardLast4: persCard.last4,
    note: 'החזר על פריט שהוחזר לחנות',
    source: 'import',
  }));

  /* ---------- העברות פנימיות וחיובי אשראי מרוכזים ---------- */
  months.forEach((month) => {
    txs.push(newTransaction({
      date: `${month}-25`, month,
      name: 'העברה מהעסק לחשבון הפרטי',
      merchant: 'העברה בין חשבונות',
      amount: 20000,
      direction: 'expense',
      space: 'business',
      categoryId: catId('business', 'expense', 'הוצאות אחרות'),
      expenseType: 'variable',
      paymentMethod: 'transfer',
      accountId: bizBank.id,
      internalTransfer: true,
      note: 'משיכת בעלים — לא נספרת כהוצאה',
      source: 'import',
    }));

    const persCardTotal = round2(txs
      .filter((t) => t.month === month && t.accountId === persCard.id && t.direction === 'expense' && !t.isRefund)
      .reduce((s, t) => s + t.amount, 0));
    if (persCardTotal > 0) {
      txs.push(newTransaction({
        date: `${month}-10`, month,
        name: 'ישראכרט — חיוב חודשי מרוכז',
        merchant: 'ישראכרט',
        amount: persCardTotal,
        direction: 'expense',
        space: 'personal',
        categoryId: catId('personal', 'expense', 'כרטיסי אשראי'),
        expenseType: 'variable',
        paymentMethod: 'transfer',
        accountId: persBank.id,
        isSettlement: true,
        settlementFor: persCard.id,
        note: 'חיוב מרוכז — העסקאות עצמן כבר נספרו',
        source: 'import',
      }));
    }
  });

  /* ---------- תנועות בארנק הדיגיטלי ---------- */
  months.slice(-4).forEach((month) => {
    txs.push(newTransaction({
      date: `${month}-16`, month,
      name: 'תשלום בארנק דיגיטלי',
      merchant: 'Bit',
      amount: round2(120 + rand() * 260),
      direction: 'expense',
      space: 'personal',
      categoryId: catId('personal', 'expense', 'קניות שונות'),
      expenseType: 'variable',
      paymentMethod: 'other',
      accountId: wallet.id,
      source: 'import',
    }));
  });

  state.transactions = txs;

  /* ---------- תקציבים ---------- */
  const budgets = [
    ['personal', 'קניות בסופר', 4200],
    ['personal', 'מסעדות', 2000],
    ['personal', 'דלק', 900],
    ['personal', 'בילויים', 700],
    ['personal', 'ביגוד', 800],
    ['personal', 'בריאות', 600],
    ['business', 'פרסום', 15000],
    ['business', 'לידים', 4000],
    ['business', 'תוכנות', 1200],
    ['business', 'ציוד משרדי', 700],
  ];
  state.budgets = budgets
    .map(([space, name, amount]) => {
      const id = catId(space, 'expense', name);
      return id ? newBudget({ space, categoryId: id, amount, month: null }) : null;
    })
    .filter(Boolean);

  /* ---------- חוקי בתי עסק שנלמדו ---------- */
  const rules = [
    ['מחסני השוק', 'personal', 'קניות בסופר'],
    ['א.ל.מ חשמל', 'personal', 'קניות שונות'],
    ['אלקטרה פאוור', 'personal', 'טעינת רכב חשמלי'],
    ['Meta Ads', 'business', 'פרסום'],
    ['רכישת לידים', 'business', 'לידים'],
  ];
  state.merchantRules = rules
    .map(([pattern, space, name]) => {
      const id = catId(space, 'expense', name);
      return id ? newMerchantRule({ pattern, space, categoryId: id, learned: true, hits: 3 + Math.floor(rand() * 8), direction: 'expense' }) : null;
    })
    .filter(Boolean);

  /* ---------- היסטוריית ייבוא ---------- */
  state.imports = months.slice(-3).map((month, i) => newImportBatch({
    fileName: i % 2 === 0 ? `עוש_${month}.csv` : `אשראי_${month}.xlsx`,
    fileType: i % 2 === 0 ? 'csv' : 'xlsx',
    accountId: i % 2 === 0 ? persBank.id : persCard.id,
    periodFrom: `${month}-01`,
    periodTo: `${month}-${daysInMonth(month)}`,
    importedAt: Date.now() - (3 - i) * 2592000000,
    rowCount: 40 + Math.floor(rand() * 50),
    approvedCount: 38 + Math.floor(rand() * 40),
    reviewCount: Math.floor(rand() * 6),
    duplicateCount: Math.floor(rand() * 4),
    status: 'done',
    sourceKept: false,
  }));

  /* ---------- מטא-דאטה של חודשים ---------- */
  state.months = {};
  months.forEach((m, i) => {
    state.months[m] = { key: m, closed: i < months.length - 1, copiedFrom: i > 0 ? months[i - 1] : null, note: '', createdAt: Date.now() };
  });

  state.audit = [{
    id: uid('log'), ts: Date.now(), action: 'seed', entity: 'system', entityId: null,
    details: `נטענו נתוני הדגמה: ${txs.length} תנועות ב-${months.length} חודשים`,
  }];

  return state;
}

export { MONTHS_BACK };
