// סורק מניות היסטורי (דרישה 13.4): מה היו האותות של אסטרטגיה בסיום יום נתון — מועמדות, ערכי המאפיינים, הדירוג ומה קרה למחרת. אותו מנוע כמו הסימולציה.
import { esc, toast } from '../../../js/core/util.js';
import { call } from '../engine.js';
import { state } from '../app.js';
import { byId, LIBRARY } from '../../../../invest-api/engine/lab/library.js';
import { strategies } from '../store.js';
import { fmtFeature } from '../../../../invest-api/engine/lab/signals.js';
import { explainBlock, err, N } from '../ui.js';

export async function render(main, params = {}){
  const saved = strategies.list();
  const pick = params.id ? strategies.get(params.id)?.spec : params.template ? byId(params.template)?.spec : state.lastRun?.spec || byId('top10-losers-1d').spec;
  const yesterday = new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10);
  main.innerHTML = `<div class="page-head"><div><h1>סורק היסטורי</h1><span class="muted">בחר אסטרטגיה ותאריך: אילו ניירות עברו את המסננים והתנאים בסיום אותו יום, מה הדירוג, ומה קרה למחרת. בדיוק מה שהסימולציה "ראתה".</span></div></div>
  <section class="card tight toolbar"><select id="src" style="max-width:360px"><option value="last" ${!params.id && !params.template ? 'selected' : ''}>הריצה/הטיוטה האחרונה</option><optgroup label="שמורות">${saved.map((s) => `<option value="id:${s.id}" ${params.id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup><optgroup label="תבניות">${LIBRARY.map((t) => `<option value="tpl:${t.id}" ${params.template === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</optgroup></select><label class="muted">תאריך <input id="date" type="date" value="${params.date || yesterday}"></label><button class="btn primary" id="go">סרוק</button><button class="btn" id="prev">◀ יום קודם</button><button class="btn" id="next">יום הבא ▶</button></section>
  <div id="out"><div class="grid g-2-1"><div></div><section class="card"><h3>ההגדרה</h3>${explainBlock(pick)}</section></div></div>`;
  const out = main.querySelector('#out');
  const specOf = () => { const v = main.querySelector('#src').value; if (v === 'last') return pick; if (v.startsWith('id:')) return strategies.get(v.slice(3))?.spec; return byId(v.slice(4))?.spec; };
  const run = async () => {
    const spec = specOf(), date = main.querySelector('#date').value; if (!spec || !date) return toast('בחר אסטרטגיה ותאריך', 'err');
    try {
      const r = await call('scan', { spec: { ...spec, period: { ...(spec.period || {}), from: shift(date, -800), to: shift(date, 10) } }, date }, { busy: 'סורק…' });
      if (r.error) return out.innerHTML = `<div class="blocked">${esc(r.error)}</div>`;
      const cols = r.columns;
      const row = (p, i) => `<tr><td>${p.rank ?? i + 1}</td><td><b>${esc(p.symbol)}</b> <span class="muted">${esc(p.name || '')}</span></td><td class="muted">${esc(p.sector || '')}</td><td class="num">${N(p.close)}</td>${cols.map((c) => `<td class="num">${fmtFeature(c.name, p.values[c.key])}</td>`).join('')}${p.nextOpen !== undefined ? `<td class="num">${N(p.nextOpen)}</td><td class="num">${N(p.nextClose)}</td><td class="num ${p.nextOpen && p.nextClose ? (p.nextClose >= p.nextOpen ? 'pos' : 'neg') : ''}">${p.nextOpen && p.nextClose ? ((p.nextClose / p.nextOpen - 1) * 100).toFixed(2) + '%' : '—'}</td>` : '<td></td><td></td><td></td>'}</tr>`;
      const head = `<tr><th>#</th><th>נייר</th><th>סקטור</th><th class="num">סגירה</th>${cols.map((c) => `<th class="num">${esc(c.label)}</th>`).join('')}<th class="num">פתיחה למחרת</th><th class="num">סגירה למחרת</th><th class="num">פתיחה→סגירה</th></tr>`;
      out.innerHTML = `<section class="card"><h3>אותות בסיום ${r.date}${r.date !== r.requested ? ` <span class="muted">(יום המסחר האחרון עד ${r.requested})</span>` : ''} <span class="muted">${r.universe ? `${esc(r.universe.id)} ${r.universe.pointInTime ? '(הרכב היסטורי)' : '(הרכב נוכחי)'} · ` : ''}${r.eligible} עברו את המסננים · ${r.passed} עברו את התנאים · ${r.picks.length} נבחרו${r.missingFeatureHits ? ` · ${r.missingFeatureHits} בדיקות עם נתון חסר` : ''}</span></h3>
        <h4>נבחרו (הפקודות ליום המסחר הבא, ${r.picks[0]?.nextDate || '—'})</h4><div class="table-wrap compact"><table><thead>${head}</thead><tbody>${r.picks.map(row).join('') || '<tr><td colspan="9" class="muted">אין אותות ביום הזה</td></tr>'}</tbody></table></div>
        ${r.passedNotPicked.length ? `<details style="margin-top:.6rem"><summary>עברו את התנאים אך לא נכנסו לדירוג (${r.passedNotPicked.length})</summary><div class="table-wrap compact"><table><thead>${head}</thead><tbody>${r.passedNotPicked.map(row).join('')}</tbody></table></div></details>` : ''}
        <p class="muted" style="margin-top:.5rem">"פתיחה→סגירה למחרת" מוצג לאימות ידני בלבד — זה מה שקרה אחרי האות, ולא משמש לבחירה.</p></section>`;
    } catch (e) { out.innerHTML = err(e); }
  };
  main.querySelector('#go').onclick = run;
  main.querySelector('#prev').onclick = () => { main.querySelector('#date').value = shift(main.querySelector('#date').value, -1); run(); };
  main.querySelector('#next').onclick = () => { main.querySelector('#date').value = shift(main.querySelector('#date').value, 1); run(); };
  if (params.date) run();
}
const shift = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
