/* ============================================================
   schema.js — הגדרת הישויות, ערכי ברירת מחדל וקטגוריות התחלתיות
   מבנה הנתונים מקביל 1:1 לסכימת ה-Postgres ב-supabase-schema.sql
   ============================================================ */

import { uid, todayISO, currentMonthKey } from './util.js';

/** גרסת הסכימה — משמשת למיגרציות מקומיות */
export const SCHEMA_VERSION = 2;

export const SPACES = {
  business: { id: 'business', label: 'עסקי', icon: '🏢', color: '#3b62f0' },
  personal: { id: 'personal', label: 'פרטי', icon: '🏠', color: '#0f9d76' },
};

export const SPACE_IDS = ['business', 'personal'];

export const DIRECTIONS = {
  income:  { id: 'income',  label: 'הכנסה',  color: 'var(--pos)' },
  expense: { id: 'expense', label: 'הוצאה', color: 'var(--neg)' },
};

export const EXPENSE_TYPES = {
  fixed:    { id: 'fixed',    label: 'קבועה',    icon: '🔁' },
  variable: { id: 'variable', label: 'משתנה',   icon: '📊' },
  oneoff:   { id: 'oneoff',   label: 'חד-פעמית', icon: '⚡' },
  // חיסכון והשקעה הם כסף שיוצא, אבל הוא נשאר שלכם.
  // הוא נספר בהוצאות ומוצג בנפרד, כדי להבחין בינו לבין צריכה.
  saving:   { id: 'saving',   label: 'חיסכון',   icon: '🐖' },
};

export const PAYMENT_METHODS = {
  credit:   { id: 'credit',   label: 'כרטיס אשראי',   icon: '💳' },
  standing: { id: 'standing', label: 'הוראת קבע',     icon: '🔄' },
  transfer: { id: 'transfer', label: 'העברה בנקאית', icon: '🏦' },
  cash:     { id: 'cash',     label: 'מזומן',        icon: '💵' },
  check:    { id: 'check',    label: 'צ׳ק',          icon: '📝' },
  other:    { id: 'other',    label: 'אחר',          icon: '•' },
};

export const ACCOUNT_TYPES = {
  checking: { id: 'checking', label: 'עובר ושב', icon: '🏦' },
  credit:   { id: 'credit',   label: 'כרטיס אשראי', icon: '💳' },
  wallet:   { id: 'wallet',   label: 'ארנק דיגיטלי', icon: '📱' },
  cash:     { id: 'cash',     label: 'מזומן', icon: '💵' },
  savings:  { id: 'savings',  label: 'חיסכון / השקעות', icon: '📈' },
};

export const TX_STATUS = {
  confirmed: { id: 'confirmed', label: 'מאושר' },
  pending:   { id: 'pending',   label: 'דורש אישור' },
};

/** לוח צבעים לקטגוריות */
export const CATEGORY_COLORS = [
  '#3b62f0', '#0f9d76', '#d9455f', '#d98218', '#7c4dff', '#e0568a',
  '#2aa5b8', '#8a6d3b', '#5b8c00', '#c2410c', '#0369a1', '#7e22ce',
  '#be123c', '#15803d', '#a16207', '#4338ca', '#0891b2', '#9d174d',
];

export const CATEGORY_ICONS = [
  '🏠','🔑','👨‍👩‍👧','⚡','💧','🏛️','🔥','🏢','🌐','📺','📱','🛡️','🚗','⛽','🔌','🔧',
  '🚙','🛒','🍽️','🎬','✈️','🧒','🎒','🎨','👕','❤️','💊','🏋️','🏦','💳','📈','🐖',
  '🛍️','📦','💼','💰','🎯','🧾','🖥️','📣','🎁','☕','🐶','📚','🧹','🪑','🖨️','🤝',
];

/* ============================================================
   קטגוריות ברירת מחדל
   ============================================================ */

const P_EXPENSE = [
  ['דיור', '🏠', '#3b62f0', 'fixed'],
  ['מזונות', '👨‍👩‍👧', '#7c4dff', 'fixed'],
  ['חשמל', '⚡', '#d98218', 'variable'],
  ['מים', '💧', '#0891b2', 'variable'],
  ['ארנונה', '🏛️', '#8a6d3b', 'fixed'],
  ['גז', '🔥', '#c2410c', 'variable'],
  ['ועד בית', '🏢', '#0369a1', 'fixed'],
  ['אינטרנט', '🌐', '#2aa5b8', 'fixed'],
  ['טלוויזיה', '📺', '#7e22ce', 'fixed'],
  ['סלולר', '📱', '#0f9d76', 'fixed'],
  ['ביטוחים', '🛡️', '#be123c', 'fixed'],
  ['ביטוחי רכב', '🚗', '#d9455f', 'fixed'],
  ['דלק', '⛽', '#c2410c', 'variable'],
  ['טעינת רכב חשמלי', '🔌', '#15803d', 'variable'],
  ['טיפולי רכב', '🔧', '#a16207', 'variable'],
  ['הלוואת / ליסינג רכב', '🚙', '#4338ca', 'fixed'],
  ['קניות בסופר', '🛒', '#0f9d76', 'variable'],
  ['מסעדות', '🍽️', '#e0568a', 'variable'],
  ['בילויים', '🎬', '#7c4dff', 'variable'],
  ['חופשות', '✈️', '#0891b2', 'oneoff'],
  ['ילדים', '🧒', '#d98218', 'variable'],
  ['בתי ספר וגנים', '🎒', '#5b8c00', 'fixed'],
  ['חוגים', '🎨', '#9d174d', 'fixed'],
  ['ביגוד', '👕', '#e0568a', 'variable'],
  ['בריאות', '❤️', '#d9455f', 'variable'],
  ['תרופות', '💊', '#be123c', 'variable'],
  ['חדר כושר', '🏋️', '#15803d', 'fixed'],
  ['הלוואות', '🏦', '#8a6d3b', 'fixed'],
  ['כרטיסי אשראי', '💳', '#4338ca', 'variable'],
  ['חיסכון', '🐖', '#0f9d76', 'saving'],
  ['קניות שונות', '🛍️', '#7e22ce', 'variable'],
  ['אחר', '📦', '#7b839c', 'variable'],
];

const P_INCOME = [
  ['משכורת', '💼', '#0f9d76'],
  ['משכורת בן/בת זוג', '💼', '#2aa5b8'],
  ['קצבאות', '🏛️', '#3b62f0'],
  ['שכירות מנכס', '🔑', '#a16207'],
  ['השקעות', '📈', '#15803d'],
  ['החזרים', '↩️', '#0891b2'],
  ['הכנסה נוספת', '💰', '#d98218'],
  ['אחר', '📦', '#7b839c'],
];

const B_INCOME = [
  ['עמלות', '🤝', '#0f9d76'],
  ['נפרעים', '🧾', '#15803d'],
  ['עמלות היקף', '🎯', '#2aa5b8'],
  ['הכנסות מסוכני משנה', '👥', '#3b62f0'],
  ['הכנסות משירותים', '🛠️', '#0891b2'],
  ['הכנסה חד-פעמית', '⚡', '#d98218'],
  ['הכנסות אחרות', '📦', '#7b839c'],
];

const B_EXPENSE = [
  ['משכורות', '👥', '#d9455f', 'fixed'],
  ['שכר סוכנים', '🤝', '#be123c', 'variable'],
  ['פרילנסרים', '🧑‍💻', '#7c4dff', 'variable'],
  ['שכירות משרד', '🏢', '#3b62f0', 'fixed'],
  ['ארנונה', '🏛️', '#8a6d3b', 'fixed'],
  ['חשמל', '⚡', '#d98218', 'variable'],
  ['תוכנות', '🖥️', '#4338ca', 'fixed'],
  ['CRM', '📊', '#0369a1', 'fixed'],
  ['סלולר', '📱', '#0f9d76', 'fixed'],
  ['אינטרנט', '🌐', '#2aa5b8', 'fixed'],
  ['פרסום', '📣', '#e0568a', 'variable'],
  ['לידים', '🎯', '#9d174d', 'variable'],
  ['רכב', '🚗', '#c2410c', 'fixed'],
  ['דלק', '⛽', '#a16207', 'variable'],
  ['הנהלת חשבונות', '🧾', '#5b8c00', 'fixed'],
  ['רואה חשבון', '📚', '#7e22ce', 'fixed'],
  ['ביטוחים', '🛡️', '#0891b2', 'fixed'],
  ['ציוד משרדי', '🪑', '#8a6d3b', 'variable'],
  ['מחשוב', '💻', '#4338ca', 'variable'],
  ['עמלות סליקה', '💳', '#be123c', 'variable'],
  ['עמלות בנק', '🏦', '#d9455f', 'variable'],
  ['הלוואות', '🏦', '#c2410c', 'fixed'],
  ['מיסים', '🏛️', '#7b839c', 'variable'],
  ['הוצאות אחרות', '📦', '#7b839c', 'variable'],
];

export function defaultCategories() {
  const out = [];
  let order = 0;
  const push = (space, kind, name, icon, color, defType) => {
    out.push({
      id: uid('cat'),
      space, kind, name, icon, color,
      defaultExpenseType: defType || (kind === 'income' ? null : 'variable'),
      order: order++,
      archived: false,
      system: true,
    });
  };
  P_INCOME.forEach(([n, i, c]) => push('personal', 'income', n, i, c));
  P_EXPENSE.forEach(([n, i, c, t]) => push('personal', 'expense', n, i, c, t));
  B_INCOME.forEach(([n, i, c]) => push('business', 'income', n, i, c));
  B_EXPENSE.forEach(([n, i, c, t]) => push('business', 'expense', n, i, c, t));
  return out;
}

export function defaultAccounts() {
  // בלי 4 ספרות מומצאות. ספרות אמיתיות מגיעות מהמסמכים שהמשתמש מייבא,
  // או מהזנה ידנית — ונשמרות אצלו במכשיר בלבד.
  return [
    { id: uid('acc'), name: 'עובר ושב פרטי', type: 'checking', space: 'personal', institution: '', last4: '', color: '#0f9d76', currency: 'ILS', archived: false, openingBalance: 0 },
    { id: uid('acc'), name: 'עובר ושב עסקי', type: 'checking', space: 'business', institution: '', last4: '', color: '#3b62f0', currency: 'ILS', archived: false, openingBalance: 0 },
    { id: uid('acc'), name: 'כרטיס אשראי פרטי', type: 'credit', space: 'personal', institution: '', last4: '', color: '#7c4dff', currency: 'ILS', archived: false, billingDay: 10 },
    { id: uid('acc'), name: 'כרטיס אשראי עסקי', type: 'credit', space: 'business', institution: '', last4: '', color: '#d98218', currency: 'ILS', archived: false, billingDay: 2 },
  ];
}

export function defaultSettings() {
  return {
    theme: 'light',
    currency: 'ILS',
    startMonth: currentMonthKey(),
    showCents: false,
    autoCopyFixed: true,
    deleteSourceFileAfterImport: true,
    aiEnabled: false,
    aiEndpoint: '',
    dashboardCards: ['income', 'expense', 'balance', 'rate', 'chart', 'categories', 'top5', 'anomalies', 'trend', 'forecast'],
    savedFilters: [],
    lastSpace: 'personal',
  };
}

/** תנועה חדשה עם כל השדות — מקור אמת יחיד למבנה התנועה */
export function newTransaction(patch = {}) {
  const date = patch.date || todayISO();
  return {
    id: uid('tx'),

    /* זיהוי בסיסי */
    date,                         // תאריך עסקה YYYY-MM-DD
    billingDate: patch.billingDate || null, // תאריך חיוב בפועל
    month: (patch.month || date).slice(0, 7), // חודש שיוך (לפי תאריך חיוב אם קיים)
    name: '',                     // שם התנועה כפי שהמשתמש רואה
    merchant: '',                 // שם בית עסק / מוטב גולמי
    description: '',              // תיאור נוסף מהדוח

    /* כספים */
    amount: 0,                    // תמיד חיובי; הכיוון נקבע ב-direction
    currency: 'ILS',
    originalAmount: null,         // סכום במטבע המקור
    originalCurrency: null,
    direction: 'expense',         // income | expense

    /* שיוך */
    space: 'personal',            // business | personal
    categoryId: null,
    expenseType: 'variable',      // fixed | variable | oneoff
    paymentMethod: 'credit',
    accountId: null,
    cardLast4: null,

    /* דגלים */
    recurring: false,             // חוזר מדי חודש
    autoCopy: false,              // העתקה אוטומטית לחודש הבא
    internalTransfer: false,      // העברה פנימית — לא נכללת בחישובים
    isSettlement: false,          // חיוב אשראי מרוכז — לא נכלל בחישובים
    settlementFor: null,          // accountId של הכרטיס שחויב
    refundOfId: null,             // מזהה העסקה שזוכתה
    isRefund: false,

    /* תשלומים */
    installment: null,            // { current, total, totalAmount }

    /* מקור ובקרה */
    note: '',
    externalId: null,
    source: 'manual',             // manual | import | recurring | copy
    importId: null,
    sourceFile: null,
    confidence: 100,              // 0..100
    status: 'confirmed',          // confirmed | pending
    needsSpaceReview: false,

    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...patch,
  };
}

export function newCategory(patch = {}) {
  return {
    id: uid('cat'),
    space: 'personal',
    kind: 'expense',
    name: '',
    icon: '📦',
    color: CATEGORY_COLORS[0],
    defaultExpenseType: 'variable',
    order: 999,
    archived: false,
    system: false,
    ...patch,
  };
}

export function newAccount(patch = {}) {
  return {
    id: uid('acc'),
    name: '',
    type: 'checking',
    space: 'personal',
    institution: '',
    last4: '',
    color: CATEGORY_COLORS[0],
    currency: 'ILS',
    billingDay: null,
    openingBalance: 0,
    archived: false,
    ...patch,
  };
}

export function newBudget(patch = {}) {
  return {
    id: uid('bud'),
    space: 'personal',
    categoryId: null,
    amount: 0,
    month: null,      // null = תקציב ברירת מחדל לכל חודש
    ...patch,
  };
}

export function newMerchantRule(patch = {}) {
  return {
    id: uid('rule'),
    pattern: '',
    matchType: 'contains',  // contains | exact | regex
    categoryId: null,
    space: null,            // null = לא קובע מרחב
    direction: null,        // null = לא קובע כיוון
    expenseType: null,
    priority: 50,
    learned: false,
    hits: 0,
    createdAt: Date.now(),
    ...patch,
  };
}

export function newImportBatch(patch = {}) {
  return {
    id: uid('imp'),
    fileName: '',
    fileType: '',
    source: 'file',          // file | wallet-api
    accountId: null,
    periodFrom: null,
    periodTo: null,
    importedAt: Date.now(),
    rowCount: 0,
    approvedCount: 0,
    reviewCount: 0,
    duplicateCount: 0,
    skippedCount: 0,
    status: 'review',        // review | done | cancelled
    sourceKept: false,
    lastSyncAt: null,
    ...patch,
  };
}

export function newMonthMeta(key) {
  return { key, closed: false, copiedFrom: null, note: '', createdAt: Date.now() };
}

/** מצב ריק — נקודת ההתחלה של כל בסיס נתונים חדש */
export function emptyState() {
  return {
    version: SCHEMA_VERSION,
    categories: [],
    accounts: [],
    transactions: [],
    budgets: [],
    merchantRules: [],
    imports: [],
    months: {},
    settings: defaultSettings(),
    audit: [],
  };
}
