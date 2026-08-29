/* ============================================================
   nav.js — סרגל צד, סרגל עליון וניווט מובייל
   ============================================================ */

import { el, monthLabel, addMonths, currentMonthKey } from '../core/util.js';
import { SPACES } from '../core/schema.js';

export const MENU = [
  { group: 'סקירה', items: [
    { id: 'home',      label: 'בית',          icon: '🏠' },
    { id: 'business',  label: 'עסקי',         icon: '🏢' },
    { id: 'personal',  label: 'פרטי',         icon: '👤' },
    { id: 'all',       label: 'סיכום כולל',   icon: '🌐' },
  ] },
  { group: 'ניהול', items: [
    { id: 'months',       label: 'חודשים',        icon: '🗓️' },
    { id: 'transactions', label: 'תנועות',        icon: '📋' },
    { id: 'import',       label: 'ייבוא וסנכרון', icon: '📥' },
    { id: 'budgets',      label: 'תקציבים',       icon: '🎯' },
  ] },
  { group: 'ניתוח', items: [
    { id: 'compare',  label: 'השוואת חודשים', icon: '⚖️' },
    { id: 'insights', label: 'תובנות',        icon: '💡' },
    { id: 'forecast', label: 'תחזית',         icon: '🔮' },
  ] },
  { group: 'הגדרות', items: [
    { id: 'categories', label: 'קטגוריות',        icon: '🏷️' },
    { id: 'accounts',   label: 'חשבונות וכרטיסים', icon: '💳' },
    { id: 'settings',   label: 'הגדרות',          icon: '⚙️' },
  ] },
];

const TABS = [
  { id: 'home',         label: 'בית',    icon: '🏠' },
  { id: 'transactions', label: 'תנועות', icon: '📋' },
  { id: 'import',       label: 'ייבוא',  icon: '📥' },
  { id: 'insights',     label: 'תובנות', icon: '💡' },
  { id: 'more',         label: 'עוד',    icon: '☰' },
];

export function buildSidebar(ctx) {
  const side = el('aside', { class: 'side', id: 'sidebar' });

  side.append(el('div', { class: 'side-brand', onclick: () => ctx.go('home') }, [
    el('div', { class: 'sb-logo', text: '₪' }),
    el('div', {}, [
      el('div', { class: 'sb-name', text: 'ניהול פיננסי' }),
      el('div', { class: 'sb-sub', text: 'עסקי ופרטי' }),
    ]),
  ]));

  const sp = SPACES[ctx.space] || { label: 'סיכום כולל', icon: '🌐', color: 'var(--text-2)' };
  side.append(el('div', { class: 'space-switch' }, [
    el('button', { class: 'ss-btn', onclick: () => ctx.openSpaceSwitcher() }, [
      el('span', { text: sp.icon }),
      el('span', { class: 'grow', style: { textAlign: 'start' }, text: ctx.space === 'all' ? 'סיכום כולל' : `מרחב ${sp.label}` }),
      el('span', { class: 'ss-caret', text: '▾' }),
    ]),
  ]));

  const nav = el('nav', { class: 'side-nav' });
  for (const group of MENU) {
    nav.append(el('div', { class: 'nav-group-label', text: group.group }));
    for (const item of group.items) {
      const badge = ctx.badges?.[item.id];
      nav.append(el('button', {
        class: `nav-item ${ctx.route === item.id ? 'active' : ''}`,
        onclick: () => ctx.go(item.id),
      }, [
        el('span', { class: 'ni-icon', text: item.icon }),
        el('span', { class: 'grow', text: item.label }),
        badge ? el('span', { class: 'ni-badge', text: badge }) : null,
      ]));
    }
  }
  side.append(nav);

  side.append(el('div', { class: 'side-foot' }, [
    el('button', {
      class: 'btn ghost sm grow', title: 'מצב תצוגה',
      onclick: () => ctx.toggleTheme(),
    }, [ctx.theme === 'dark' ? '☀️ בהיר' : '🌙 כהה']),
    el('button', { class: 'btn ghost sm', title: 'הגדרות', onclick: () => ctx.go('settings'), text: '⚙️' }),
  ]));

  return side;
}

export function buildTopbar(ctx, { title, sub = '', actions = [], showMonth = true }) {
  const bar = el('header', { class: 'topbar' });

  bar.append(el('button', {
    class: 'btn ghost icon menu-btn', title: 'תפריט',
    onclick: () => ctx.toggleSidebar(), text: '☰',
  }));

  bar.append(el('div', { style: { minWidth: 0 } }, [
    el('div', { class: 'tb-title truncate', text: title }),
    sub ? el('div', { class: 'tb-sub truncate', text: sub }) : null,
  ]));

  const right = el('div', { class: 'tb-actions' });
  if (showMonth) right.append(monthPicker(ctx));
  actions.forEach((a) => right.append(a));
  bar.append(right);
  return bar;
}

export function monthPicker(ctx) {
  const wrap = el('div', { class: 'month-pick' });
  // ב-RTL החץ הימני מוביל אחורה בזמן
  wrap.append(el('button', { title: 'חודש קודם', text: '›', onclick: () => ctx.setMonth(addMonths(ctx.month, -1)) }));
  wrap.append(el('button', {
    class: 'mp-label num', title: 'בחירת חודש',
    text: monthLabel(ctx.month),
    onclick: () => ctx.openMonthPicker(),
  }));
  wrap.append(el('button', { title: 'חודש הבא', text: '‹', onclick: () => ctx.setMonth(addMonths(ctx.month, 1)) }));
  if (ctx.month !== currentMonthKey()) {
    wrap.append(el('button', { title: 'חזרה לחודש הנוכחי', text: '⟲', onclick: () => ctx.setMonth(currentMonthKey()) }));
  }
  return wrap;
}

export function buildTabbar(ctx) {
  const bar = el('nav', { class: 'tabbar' });
  TABS.forEach((t) => {
    bar.append(el('button', {
      class: ctx.route === t.id ? 'active' : '',
      onclick: () => (t.id === 'more' ? ctx.toggleSidebar() : ctx.go(t.id)),
    }, [
      el('span', { class: 'tb-ic', text: t.icon }),
      el('span', { text: t.label }),
    ]));
  });
  return bar;
}
