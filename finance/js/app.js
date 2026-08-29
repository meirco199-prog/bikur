/* ============================================================
   app.js — נקודת הכניסה: אתחול, ניתוב ובניית השלד
   ============================================================ */

import store from './core/store.js';
import { buildDemoState } from './core/seed.js';
import { defaultCategories, defaultAccounts } from './core/schema.js';
import { el, clear, currentMonthKey, monthLabelShort, addMonths, setMoneyPrecision } from './core/util.js';
import { buildSidebar, buildTopbar, buildTabbar } from './ui/nav.js';
import { modal, toast } from './ui/components.js';
import { openTxForm } from './ui/txform.js';
import { monthsWithData } from './domain/finance.js';

import renderGate from './screens/gate.js';
import renderDashboard from './screens/dashboard.js';
import renderMonths from './screens/months.js';
import renderTransactions from './screens/transactions.js';
import renderImport from './screens/import.js';
import renderCompare from './screens/compare.js';
import renderBudgets from './screens/budgets.js';
import renderInsights from './screens/insights.js';
import renderForecast from './screens/forecast.js';
import renderCategories from './screens/categories.js';
import renderAccounts from './screens/accounts.js';
import renderSettings from './screens/settings.js';

/* ============================================================
   מצב האפליקציה
   ============================================================ */
const app = {
  route: 'gate',
  space: 'personal',
  month: currentMonthKey(),
  sidebarOpen: false,
  params: {},
};

const SCREENS = {
  gate:         { render: renderGate,         chrome: false },
  home:         { render: renderGate,         chrome: false },
  business:     { render: renderDashboard,    title: 'ניהול עסקי',      space: 'business' },
  personal:     { render: renderDashboard,    title: 'ניהול פרטי',      space: 'personal' },
  all:          { render: renderDashboard,    title: 'סיכום כולל',      space: 'all' },
  months:       { render: renderMonths,       title: 'ניהול חודשים' },
  transactions: { render: renderTransactions, title: 'תנועות' },
  import:       { render: renderImport,       title: 'ייבוא וסנכרון',   noMonth: true },
  compare:      { render: renderCompare,      title: 'השוואת חודשים',   noMonth: true },
  budgets:      { render: renderBudgets,      title: 'תקציבים' },
  insights:     { render: renderInsights,     title: 'תובנות' },
  forecast:     { render: renderForecast,     title: 'תחזית' },
  categories:   { render: renderCategories,   title: 'קטגוריות',        noMonth: true },
  accounts:     { render: renderAccounts,     title: 'חשבונות וכרטיסים', noMonth: true },
  settings:     { render: renderSettings,     title: 'הגדרות',          noMonth: true },
};

/* ============================================================
   הקשר שמועבר לכל מסך
   ============================================================ */
const ctx = {
  store,
  get state() { return store.state; },
  get space() { return app.space; },
  get month() { return app.month; },
  get route() { return app.route; },
  get theme() { return document.documentElement.dataset.theme || 'light'; },
  get params() { return app.params; },

  go(route, params = {}) {
    // שומרים איפה היינו במסך הנוכחי, כדי שחזרה אחורה תחזיר לאותה נקודה
    scrollMemory.set(app.route, window.scrollY);
    app.params = params;
    if (SCREENS[route]?.space) app.space = SCREENS[route].space;
    app.route = route;
    app.sidebarOpen = false;
    const hash = `#/${route}`;
    if (location.hash !== hash) { history.pushState(null, '', hash); }
    render({ scrollTo: 0 });
  },

  setSpace(space) {
    app.space = space;
    store.setSetting('lastSpace', space === 'all' ? app.space : space);
    if (['business', 'personal', 'all'].includes(app.route)) {
      ctx.go(space);
    } else render();
  },

  setMonth(month) {
    app.month = month;
    render();
  },

  /** רינדור מחדש בלי לזוז מהמקום — אחרי עריכה, סינון או מחיקה */
  refresh() { render(); },

  toggleSidebar() {
    app.sidebarOpen = !app.sidebarOpen;
    render();
  },

  toggleTheme() {
    const next = ctx.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    store.setSetting('theme', next);
    render();
  },

  addTransaction(presets = {}) { openTxForm(ctx, null, presets); },
  editTransaction(tx) { openTxForm(ctx, tx); },

  openSpaceSwitcher() {
    const opts = [
      { id: 'personal', label: 'ניהול פרטי / משק בית', icon: '🏠', desc: 'הכנסות והוצאות הבית' },
      { id: 'business', label: 'ניהול עסקי', icon: '🏢', desc: 'הכנסות והוצאות העסק' },
      { id: 'all', label: 'סיכום כולל', icon: '🌐', desc: 'תמונה מאוחדת של שני המרחבים' },
    ];
    const m = modal({
      title: 'מעבר בין מרחבים',
      size: 'narrow',
      body: el('div', { class: 'col', style: { gap: '8px' } }, opts.map((o) => el('button', {
        class: 'card hoverable pad-sm',
        style: { textAlign: 'start', cursor: 'pointer', border: app.space === o.id ? '1px solid var(--brand-500)' : null },
        onclick: () => { m.close(); ctx.setSpace(o.id); },
      }, [
        el('div', { class: 'row' }, [
          el('span', { style: { fontSize: '22px' }, text: o.icon }),
          el('div', { class: 'grow' }, [
            el('div', { class: 'bold', text: o.label }),
            el('div', { class: 'tiny muted-2', text: o.desc }),
          ]),
          app.space === o.id ? el('span', { class: 'chip brand', text: 'נבחר' }) : null,
        ]),
      ]))),
    });
  },

  openMonthPicker() {
    const withData = new Set(monthsWithData(store.state.transactions));
    const cur = currentMonthKey();
    const years = new Set([...withData].map((m) => m.slice(0, 4)));
    years.add(cur.slice(0, 4));
    years.add(app.month.slice(0, 4));
    const sorted = [...years].sort().reverse();

    const body = el('div', { class: 'col', style: { gap: '18px' } });
    for (const year of sorted) {
      const grid = el('div', { class: 'grid', style: { gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' } });
      for (let mm = 1; mm <= 12; mm++) {
        const key = `${year}-${String(mm).padStart(2, '0')}`;
        const has = withData.has(key);
        grid.append(el('button', {
          class: `btn sm ${key === app.month ? 'primary' : ''}`,
          style: { position: 'relative', opacity: has || key === app.month ? 1 : .55 },
          onclick: () => { m.close(); ctx.setMonth(key); },
          title: has ? 'קיימות תנועות' : 'ללא תנועות',
        }, [
          monthLabelShort(key).split(' ')[0],
          has && key !== app.month ? el('span', { style: { position: 'absolute', top: '4px', insetInlineEnd: '5px', width: '5px', height: '5px', borderRadius: '50%', background: 'var(--brand-500)' } }) : null,
        ]));
      }
      body.append(el('div', {}, [
        el('div', { class: 'card-title mb-3', text: year }),
        grid,
      ]));
    }
    const m = modal({ title: 'בחירת חודש', subtitle: 'נקודה כחולה מסמנת חודש עם תנועות', body, size: 'narrow' });
  },
};

/* ============================================================
   ערכת נושא
   ============================================================ */
function applyTheme(theme) {
  const t = theme === 'auto'
    ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : theme;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0b0e18' : '#f5f6fa');
}

/* ============================================================
   רינדור
   ============================================================ */
/** זיכרון מיקום הגלילה לכל מסך */
const scrollMemory = new Map();

/**
 * רינדור.
 * כברירת מחדל נשארים באותו מיקום גלילה — רינדור מחדש אחרי עריכה
 * או סינון לא אמור לזרוק את המשתמש לראש הדף.
 * scrollTo מאפשר לקבוע מיקום אחר (0 במעבר למסך חדש).
 */
function render(opts = {}) {
  const root = document.getElementById('app');
  const screen = SCREENS[app.route] || SCREENS.gate;
  const keepY = opts.scrollTo === undefined ? window.scrollY : opts.scrollTo;
  clear(root);

  // חישוב תגי התראה בתפריט
  ctx.badges = {};
  const pending = store.state.transactions.filter((t) => t.status === 'pending').length;
  if (pending) ctx.badges.transactions = pending;

  if (screen.chrome === false) {
    root.append(screen.render(ctx));
    return;
  }

  const shell = el('div', { class: 'shell' });
  const side = buildSidebar(ctx);
  if (app.sidebarOpen) side.classList.add('open');
  shell.append(side);

  if (app.sidebarOpen) {
    shell.append(el('div', { class: 'side-scrim', onclick: () => ctx.toggleSidebar() }));
  }

  const main = el('main', { class: 'main' });
  const content = el('div', { class: 'content' });

  const built = screen.render(ctx);
  const node = built?.node || built;
  const topbarOpts = built?.topbar || {};

  main.append(buildTopbar(ctx, {
    title: topbarOpts.title || screen.title || '',
    sub: topbarOpts.sub || '',
    actions: topbarOpts.actions || [],
    showMonth: !screen.noMonth && topbarOpts.showMonth !== false,
  }));

  content.append(node);
  main.append(content);
  shell.append(main);
  root.append(shell);

  root.append(buildTabbar(ctx));

  if (!['import', 'settings', 'categories', 'accounts'].includes(app.route)) {
    root.append(el('button', {
      class: 'fab no-print', title: 'הוספת תנועה',
      onclick: () => ctx.addTransaction(), text: '+',
    }));
  }

  restoreScroll(keepY);
}

/**
 * הדפדפן צריך פריים אחד כדי לחשב את גובה התוכן החדש,
 * אחרת גלילה לנקודה שמעבר לגובה הנוכחי פשוט לא תתפוס.
 */
function restoreScroll(y) {
  if (!y) { window.scrollTo(0, 0); return; }
  window.scrollTo(0, y);
  requestAnimationFrame(() => {
    if (Math.abs(window.scrollY - y) > 2) window.scrollTo(0, y);
  });
}

/* ============================================================
   ניתוב לפי כתובת
   ============================================================ */
function routeFromHash() {
  const raw = location.hash.replace(/^#\/?/, '').split('?')[0];
  if (raw && SCREENS[raw]) {
    app.route = raw;
    if (SCREENS[raw].space) app.space = SCREENS[raw].space;
  } else {
    app.route = 'gate';
  }
}

function navigateBack() {
  scrollMemory.set(app.route, window.scrollY);
  routeFromHash();
  render({ scrollTo: scrollMemory.get(app.route) ?? 0 });
}
window.addEventListener('popstate', navigateBack);
window.addEventListener('hashchange', navigateBack);

/* ============================================================
   קיצורי מקלדת
   ============================================================ */
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.metaKey || e.ctrlKey) {
    if (e.key === 'z') { if (store.canUndo()) { store.undo(); render(); toast('הפעולה בוטלה'); e.preventDefault(); } }
    return;
  }
  if (e.key === 'n') { ctx.addTransaction(); e.preventDefault(); }
  if (e.key === 'ArrowLeft') { ctx.setMonth(addMonths(app.month, 1)); }
  if (e.key === 'ArrowRight') { ctx.setMonth(addMonths(app.month, -1)); }
});

/* ============================================================
   אתחול
   ============================================================ */
async function boot() {
  await store.init();

  // בסיס נתונים ריק — טעינת נתוני הדגמה כדי שהאפליקציה תהיה שימושית מיד
  if (!store.state.categories.length && !store.state.transactions.length) {
    const demo = buildDemoState();
    store.replaceState(demo);
  }
  // בסיס נתונים ללא קטגוריות (למשל אחרי איפוס) — טעינת ברירות המחדל
  if (!store.state.categories.length) {
    store.bulkInsert('categories', defaultCategories(), { audit: false });
    if (!store.state.accounts.length) store.bulkInsert('accounts', defaultAccounts(), { audit: false });
  }

  applyTheme(store.setting('theme', 'light'));
  setMoneyPrecision(store.setting('showCents', false));
  app.space = store.setting('lastSpace', 'personal');

  const months = monthsWithData(store.state.transactions);
  const cur = currentMonthKey();
  app.month = months.includes(cur) ? cur : (months[0] || cur);

  routeFromHash();
  render();

  document.getElementById('boot')?.remove();
}

boot().catch((err) => {
  console.error(err);
  document.getElementById('app').innerHTML =
    `<div style="padding:40px;text-align:center;font-family:system-ui">
       <h2>אירעה שגיאה בטעינת האפליקציה</h2>
       <p style="color:#888">${err.message}</p>
     </div>`;
});

export { ctx, app };
