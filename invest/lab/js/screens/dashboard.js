// Dashboard ראשי: מצב הנתונים, הריצה האחרונה, תוצאות הייחוס שנבנו ב-Actions, אסטרטגיות שמורות, קיצורי דרך.
import { esc, fmt, cls } from '../../../js/core/util.js';
import { state, dataStatus, go } from '../app.js';
import { strategies, results } from '../store.js';
import { P, P0, N, $$$, limitedTag } from '../ui.js';
import { LIBRARY } from '../../../../invest-api/engine/lab/library.js';

export async function render(main){
  main.innerHTML = `<div class="page-head"><div><h1>Investment Strategy Lab</h1><span class="muted">מעבדת מחקר לאסטרטגיות השקעה — הגדר, הרץ על ההיסטוריה, בדוק סיכון ומובהקות. מחקר בלבד; Backtest אינו תחזית.</span></div></div><div id="dash"><div class="empty"><span class="spin"></span> בודק את מערך הנתונים…</div></div>`;
  const box = main.querySelector('#dash');
  const m = state.manifest || await dataStatus();
  const saved = strategies.list(), savedRes = await results.list();
  const dataCard = m ? `<section class="card"><h3>מערך הנתונים <span class="tag ${m.coverage?.pointInTime ? 'fact' : 'opinion'}">${m.coverage?.pointInTime ? 'הרכב מדד point-in-time' : 'הרכב נוכחי בלבד'}</span></h3>
      <div class="kpis">${k('ניירות עם מחירים', N(m.manifest.symbolCount, 0))}${k('מתאריך', m.manifest.from || '—')}${k('נבנה', (m.manifest.builtAt || '').slice(0, 10))}${k('כיסוי חברי S&P 500', m.coverage ? P0(m.coverage.ratio) : '—', m.coverage && m.coverage.ratio < 0.9 ? 'warn' : '')}</div>
      <p class="muted" style="margin-top:.6rem">${esc(m.manifest.provider || '')}${m.coverage?.note ? ' · ' + esc(m.coverage.note) : ''}</p><div class="row"><a class="btn sm" href="#/data">פרטים ומקורות</a></div></section>`
    : `<section class="card"><h3>מערך הנתונים</h3><div class="blocked">אין מערך נתונים זמין בכתובת שהוגדרה. הרץ את ה-workflow <b>Invest lab data</b> ב-GitHub Actions (Run workflow) — הוא בונה את ענף <code>lab-data</code>; או שנה את כתובת הנתונים במסך "נתונים ומקורות".</div><div class="row" style="margin-top:.5rem"><a class="btn sm" href="#/data">נתונים ומקורות</a></div></section>`;
  const ref = m?.results?.runs?.length ? `<section class="card"><h3>תוצאות ייחוס (ריצה מלאה ב-GitHub Actions) <span class="muted">${esc((m.results.builtAt || '').slice(0, 10))}</span></h3><div class="table-wrap compact"><table><thead><tr><th>אסטרטגיה</th><th>תקופה</th><th class="num">הון</th><th class="num">CAGR</th><th class="num">ירידה</th><th class="num">Sharpe</th><th class="num">עסקאות</th><th></th></tr></thead><tbody>${m.results.runs.map((r) => `<tr><td><b>${esc(r.name)}</b> ${r.limited ? '<span class="tag opinion">מוגבל</span>' : ''}</td><td>${r.from} → ${r.to}</td><td class="num ${cls(r.finalEquity - r.capital)}">${$$$(r.capital)} → ${$$$(r.finalEquity)}</td><td class="num ${cls(r.cagr)}">${P(r.cagr)}</td><td class="num neg">${P0(r.maxDD)}</td><td class="num">${N(r.sharpe)}</td><td class="num">${r.trades}</td><td><a class="btn sm" href="#/backtest?ref=${esc(r.id)}">פתח</a></td></tr>`).join('')}</tbody></table></div></section>` : '';
  const last = state.lastRun ? `<section class="card"><h3>הריצה האחרונה בסשן ${limitedTag(state.lastRun.result)}</h3><p><b>${esc(state.lastRun.spec.name)}</b> · ${state.lastRun.result.from} → ${state.lastRun.result.to}</p><div class="kpis">${k('הון סופי', $$$(state.lastRun.result.finalEquity), cls(state.lastRun.result.finalEquity - state.lastRun.result.capital))}${k('CAGR', P(state.lastRun.analysis.series.cagr), cls(state.lastRun.analysis.series.cagr))}${k('ירידה מקסימלית', P0(state.lastRun.analysis.series.maxDD), 'neg')}${k('Sharpe', N(state.lastRun.analysis.series.sharpe))}</div><div class="row" style="margin-top:.6rem"><a class="btn sm primary" href="#/backtest">לתוצאות המלאות</a><a class="btn sm" href="#/trades">עסקאות</a></div></section>` : '';
  box.innerHTML = `<div class="grid g2">${dataCard}
    <section class="card"><h3>התחל כאן</h3><div class="stack">
      <a class="btn" href="#/backtest?template=top10-losers-1d">▶ הרץ את דוגמת הייחוס: Top 10 Daily Losers (S&P 500, 20 שנה)</a>
      <a class="btn" href="#/builder">🧩 בנה אסטרטגיה חדשה ללא קוד</a>
      <a class="btn" href="#/ai">🤖 תאר אסטרטגיה במילים — ה-AI ינסח, המנוע יחשב</a>
      <a class="btn" href="#/library">📚 ${LIBRARY.length} תבניות פתוחות לעריכה</a>
      <a class="btn" href="#/optimize">🎛️ אופטימיזציה עם אימון/אימות/מבחן ו-Walk-Forward</a></div></section>
    ${last}${ref}
    <section class="card"><h3>אסטרטגיות שמורות (${saved.length})</h3>${saved.length ? `<div class="table-wrap compact"><table><tbody>${saved.slice(0, 8).map((s) => `<tr><td><b>${esc(s.name)}</b> <span class="muted">v${s.version}</span></td><td class="muted">${fmt.ago(s.updatedAt)}</td><td><a class="btn sm" href="#/builder?id=${s.id}">ערוך</a> <a class="btn sm primary" href="#/backtest?id=${s.id}">הרץ</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="muted">עדיין אין. שמור אסטרטגיה מהבונה או מהספרייה.</div>'}</section>
    <section class="card"><h3>תוצאות שמורות (${savedRes.length})</h3>${savedRes.length ? `<div class="table-wrap compact"><table><tbody>${savedRes.slice(0, 8).map((r) => `<tr><td><b>${esc(r.name)}</b> <span class="muted">${r.from} → ${r.to}</span></td><td class="num ${cls(r.summary?.cagr)}">${P(r.summary?.cagr)}</td><td><a class="btn sm" href="#/backtest?saved=${r.id}">פתח</a></td></tr>`).join('')}</tbody></table></div>` : '<div class="muted">תוצאות שתשמור יופיעו כאן ויהיו זמינות להשוואה.</div>'}</section>
  </div>
  <section class="card" style="margin-top:1.2rem"><h3>מה המערכת עושה — ומה לא</h3><ul class="warnlist"><li>האות מחושב בסיום יום t רק מנתונים עד t; הביצוע ביום העוקב במחיר הפתיחה/הסגירה הרשמי. אין קנייה במחיר אתמול.</li><li>חברות במדד לפי ההרכב ההיסטורי של כל יום (point-in-time); חברים ללא נתוני מחיר (מניות שנמחקו) מדווחים — לא מומצאים.</li><li>עלויות מלאות: עמלה, החלקה, עמלות רגולטור, השאלה בשורט, ריבית מרג'ין, דיבידנדים ופיצולים.</li><li>אופטימיזציה: בחירה באימון, אישור באימות, מבחן נפתח פעם אחת; Walk-Forward; Monte Carlo; תיקון לריבוי ניסויים (Bonferroni, Deflated Sharpe).</li><li>המערכת לא מבצעת מסחר, לא נותנת ייעוץ ולא מבטיחה שיתרון היסטורי יימשך.</li></ul></section>`;
}
const k = (l, v, c = '') => `<div class="kpi"><span class="v ${c}">${v}</span><span class="l">${esc(l)}</span></div>`;
