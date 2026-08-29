/* ============================================================
   gate.js — מסך הכניסה: הפרדה בין עסקי, פרטי וסיכום כולל
   ============================================================ */

import { el, money, monthLabel, pct, previousMonths } from '../core/util.js';
import { monthTotals, comparisons, monthsWithData } from '../domain/finance.js';
import { headlineFor } from '../domain/insights.js';
import { deltaChip, insightCard } from '../ui/components.js';
import { sparkline } from '../ui/charts.js';
import { trendSeries } from '../domain/finance.js';

export default function renderGate(ctx) {
  const state = ctx.store.state;
  const month = ctx.month;
  const txs = state.transactions;

  const wrap = el('div', { class: 'gate' });

  wrap.append(el('div', { class: 'gate-head' }, [
    el('div', { class: 'gate-logo', text: '₪' }),
    el('h1', { class: 'gate-title', text: 'ניהול הכנסות והוצאות' }),
    el('p', { class: 'gate-sub', text: `תמונה מלאה של הכסף — עסקי ופרטי, בנפרד וביחד. ${monthLabel(month)}.` }),
  ]));

  const cards = el('div', { class: 'gate-cards' });

  const spaces = [
    {
      id: 'business', title: 'ניהול עסקי', icon: '🏢', color: '#3b62f0',
      desc: 'עמלות, נפרעים, שכר, פרסום ומיסים — רווחיות העסק חודש בחודשו.',
      balanceLabel: 'רווח',
    },
    {
      id: 'personal', title: 'ניהול פרטי', icon: '🏠', color: '#0f9d76',
      desc: 'משק הבית: משכורות, משכנתא, קניות, רכב וילדים.',
      balanceLabel: 'יתרה',
    },
    {
      id: 'all', title: 'סיכום כולל', icon: '🌐', color: '#7c4dff',
      desc: 'תמונה מאוחדת של שני המרחבים יחד — הכסף האמיתי בסוף החודש.',
      balanceLabel: 'יתרה כוללת',
    },
  ];

  for (const s of spaces) {
    const t = monthTotals(txs, month, s.id);
    const cmp = comparisons(txs, month, s.id);
    const series = trendSeries(txs, [...previousMonths(month, 5), month], s.id);
    const hasData = series.some((x) => x.count > 0);

    cards.append(el('button', { class: 'gate-card', onclick: () => ctx.go(s.id) }, [
      el('div', { class: 'gc-glow', style: { background: s.color } }),
      el('div', { class: 'row-between' }, [
        el('div', { class: 'gc-icon', style: { background: `${s.color}1f`, color: s.color }, text: s.icon }),
        hasData ? sparkline(series.map((x) => x.balance), { color: s.color, width: 76, height: 26 }) : null,
      ]),
      el('div', { class: 'gc-title', text: s.title }),
      el('div', { class: 'gc-desc', text: s.desc }),
      el('div', { class: 'gc-stats' }, [
        statBit('הכנסות', money(t.income), 'var(--pos)'),
        statBit('הוצאות', money(t.expense), 'var(--neg)'),
        // חיסכון והשקעות אינם הוצאה — מוצגים בנפרד גם כאן
        t.saving > 0 ? statBit('חיסכון', money(t.saving), 'var(--brand-500)') : null,
        statBit(s.balanceLabel, money(t.balance), t.balance >= 0 ? 'var(--text)' : 'var(--neg)'),
      ].filter(Boolean)),
      el('div', { class: 'row', style: { gap: '8px', marginTop: '10px', flexWrap: 'wrap' } }, [
        cmp.vsPrev.expense !== null
          ? el('span', { class: 'row tiny muted-2', style: { gap: '5px' } }, [
              'הוצאות מול חודש קודם:', deltaChip(cmp.vsPrev.expense, { invert: true }),
            ])
          : null,
        t.rate !== null
          ? el('span', { class: 'chip', text: `${s.id === 'business' ? 'רווחיות' : 'חיסכון'} ${pct(t.rate).replace('+', '')}` })
          : null,
      ]),
      el('div', { class: 'gc-go', text: 'כניסה ←' }),
    ]));
  }

  wrap.append(cards);

  /* ---------- תובנה מובילה ---------- */
  const headline = headlineFor(state, month, 'all');
  if (headline) {
    wrap.append(el('div', { style: { width: '100%', maxWidth: '1020px' } }, [insightCard(headline)]));
  }

  /* ---------- קיצורי דרך ---------- */
  wrap.append(el('div', { class: 'gate-foot' }, [
    el('button', { class: 'btn', onclick: () => ctx.go('import') }, ['📥 ייבוא דוח בנק או אשראי']),
    el('button', { class: 'btn', onclick: () => ctx.addTransaction() }, ['＋ תנועה חדשה']),
    el('button', { class: 'btn', onclick: () => ctx.go('months') }, ['🗓️ ניהול חודשים']),
    el('button', { class: 'btn', onclick: () => ctx.go('insights') }, ['💡 תובנות']),
    el('button', { class: 'btn ghost', onclick: () => ctx.toggleTheme() }, [ctx.theme === 'dark' ? '☀️ מצב בהיר' : '🌙 מצב כהה']),
  ]));

  /* ---------- שורת מצב ---------- */
  const months = monthsWithData(txs);
  wrap.append(el('div', { class: 'tiny muted-2 center' }, [
    `${txs.length.toLocaleString('he-IL')} תנועות · ${months.length} חודשי היסטוריה · הנתונים נשמרים במכשיר בלבד`,
    // מספר הגרסה מגיע מ-sw.js אחרי טעינת הדף, ולכן מתעדכן לתוך התג הזה
    el('span', { 'data-app-version': '', text: window.__APP_VERSION ? ` · גרסה ${window.__APP_VERSION}` : '' }),
  ]));

  return wrap;
}

function statBit(label, value, color) {
  return el('div', {}, [
    el('div', { class: 'gc-stat-l', text: label }),
    el('div', { class: 'gc-stat-v', style: { color }, text: value }),
  ]);
}
