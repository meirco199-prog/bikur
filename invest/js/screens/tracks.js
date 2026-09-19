// השוואת מסלולים: חשבון התרגול (מאוזן) + המסלול האגרסיבי הקיים (קבוצות ביקורת, לא משתנות) מול שלושה מסלולי צל חדשים
// (regB, regC, אגרסיבי B) ומול שני מדדי ייחוס שקליים (SPY, 95% SPY+מזומן). כל המסלולים החדשים הם Shadow בלבד — בלי פקודות לברוקר.
import { api } from '../core/api.js';
import { esc, fmt, isNum, cls } from '../core/util.js';
import { kpi, loading, errorBox, pctCell, disclaimer } from '../ui/components.js';
import { lineChart } from '../ui/chart.js';

const COLOR = { paper: '#4f8cff', aggr: '#f5a524', regB: '#2fbf71', regC: '#a78bfa', aggrB: '#e5484d', spy: '#38bdf8', spy95: '#84cc16' };

function equityCurve(items, benchmarks, commonFrom){
  const series = [...items.map((i) => ({ id: i.id, label: i.label, rows: i.equity || [] })), ...Object.values(benchmarks).filter((b) => !b.missing).map((b) => ({ id: b.id, label: b.label, rows: b.equity || [], isBench: true }))];
  const starts = series.map((s) => s.rows[0]?.day).filter(Boolean);
  const from = commonFrom || (starts.length ? starts.sort()[0] : null);
  const dateSet = new Set();
  for (const s of series) for (const r of s.rows) if (!from || r.day >= from) dateSet.add(r.day);
  const dates = [...dateSet].sort();
  if (!dates.length) return null;
  const chartSeries = series.map((s) => {
    const map = new Map(s.rows.map((r) => [r.day, r.total]));
    let base = null;
    const values = dates.map((d) => { const v = map.get(d); if (!isNum(v)) return null; if (base == null) base = v; return base ? +(v / base * 100).toFixed(2) : null; });
    return { name: s.label, values, color: COLOR[s.id], dashed: !!s.isBench };
  });
  return { dates, series: chartSeries };
}

function trackRow(it){
  const missing = it.missing;
  const ex = it.excess || {};
  const m = it.metrics || {};
  return `<tr>
    <td><b>${esc(it.label)}</b>${it.control ? ' <span class="tag" title="לא משתנה — קבוצת ביקורת">ביקורת</span>' : ''}${missing ? ' <span class="tag missing">עוד לא התחיל</span>' : ''}<div class="muted" style="font-size:.78rem">${esc(it.desc || '')}</div></td>
    <td class="num">${isNum(it.totalIls) ? fmt.ils(it.totalIls) : '—'}</td>
    <td class="num ${cls(m.totalReturn)}">${fmt.pct(m.totalReturn, 1, true)}</td>
    <td class="num ${cls(ex.own)}" title="${esc(ex.benchLabel || '')} · מתאריך התחלת המסלול">${fmt.pct(ex.own, 1, true)}</td>
    <td class="num ${cls(ex.common)}" title="מתקופה משותפת לכל המסלולים${ex.note ? ' — ' + esc(ex.note) : ''}">${fmt.pct(ex.common, 1, true)}</td>
    <td class="num">${isNum(it.exposure?.equityShare) ? fmt.pct(it.exposure.equityShare, 0) : '—'}</td>
    <td class="num">${isNum(it.exposure?.cashShare) ? fmt.pct(it.exposure.cashShare, 0) : '—'}</td>
    <td class="num ${cls(m.maxDrawdown)}">${fmt.pct(m.maxDrawdown, 1)}</td>
    <td class="num">${isNum(m.volAnnual) ? fmt.pct(m.volAnnual, 1) : '—'}</td>
    <td class="num">${it.costs?.trades ?? '—'} / ${isNum(it.costs?.feesIls) ? fmt.ils(it.costs.feesIls) : '—'}</td>
    <td class="muted" style="font-size:.78rem">${it.startDay ? fmt.date(it.startDay) : '—'}${m.small ? ' <span class="tag stale">מדגם קטן</span>' : ''}</td>
  </tr>`;
}

function benchRow(b){
  const m = b.metrics || {};
  return `<tr class="muted"><td>${esc(b.label)} <span class="tag" title="מדד ייחוס שקלי — לא מסלול">מדד</span></td><td class="num">${isNum(b.totalIls) ? fmt.ils(b.totalIls) : '—'}</td><td class="num ${cls(m.totalReturn)}">${fmt.pct(m.totalReturn, 1, true)}</td><td>—</td><td>—</td><td>—</td><td>—</td><td class="num ${cls(m.maxDrawdown)}">${fmt.pct(m.maxDrawdown, 1)}</td><td class="num">${isNum(m.volAnnual) ? fmt.pct(m.volAnnual, 1) : '—'}</td><td>—</td><td class="muted" style="font-size:.78rem">${b.startDay ? fmt.date(b.startDay) : '—'}</td></tr>`;
}

export async function render(main){
  main.innerHTML = loading();
  let c;
  try { c = await api('/tracks/compare', { ttl: 30000 }); } catch (e) { main.innerHTML = errorBox(e); return; }
  const items = c.items || [];
  const bench = c.benchmarks || {};
  main.innerHTML = `<div class="page-head"><div><h1>השוואת מסלולים</h1><span class="muted">מאוזן ואגרסיבי (קיימים, קבוצות ביקורת) מול שלושה מסלולי צל חדשים ומול מדדי ייחוס שקליים · נכון ל-${esc(fmt.date(c.asOf))} · שער ${fmt.num(c.fx, 3)}</span></div></div>
  ${(c.notes || []).length ? `<div class="card" style="margin-bottom:1rem;border-color:var(--warn,#f5a524)">${c.notes.map((n) => `<div>⚠️ ${esc(n)}</div>`).join('')}</div>` : ''}
  <div class="grid g4" style="margin-bottom:1rem">
    ${kpi('מסלולים פעילים', items.filter((i) => !i.missing).length)}
    ${kpi('תקופה משותפת מ-', c.commonFrom ? fmt.date(c.commonFrom) : '—')}
    ${kpi('SPY עכשיו', isNum(c.spyNow) ? fmt.usd(c.spyNow) : '—')}
    ${kpi('כל מסלול: 200,000 ₪', 'התחלה זהה')}
  </div>
  <section class="card" style="margin-bottom:1rem"><h3>עקומת שווי — מנורמל ל-100 מתחילת התקופה המשותפת</h3><div class="muted" style="margin-bottom:.5rem">קווים מקווקווים = מדדי ייחוס. מסלול שהתחיל אחרי התקופה המשותפת מופיע רק מהיום שבו התחיל בפועל — אינו ניתן להשוואה מלאה עד אז.</div><div id="eqc"></div></section>
  <section class="card" style="margin-bottom:1rem;overflow-x:auto"><h3>טבלת השוואה</h3><table><thead><tr><th>מסלול</th><th class="num">שווי</th><th class="num">תשואה מצטברת</th><th class="num">עודף מתחילת המסלול</th><th class="num">עודף בתקופה משותפת</th><th class="num">חשיפה מנייתית</th><th class="num">מזומן</th><th class="num">ירידה מקסימלית</th><th class="num">תנודתיות שנתית</th><th class="num">עסקאות / עמלות</th><th>התחלה</th></tr></thead><tbody>${items.map(trackRow).join('')}${Object.values(bench).map(benchRow).join('')}</tbody></table></section>
  <section class="grid g2">
    ${items.map((it) => `<div class="card"><h4>${esc(it.label)}</h4><p class="muted" style="font-size:.85rem">${esc(it.desc || it.note || '')}</p>${it.selection ? `<div class="muted">תרומת בחירת מניות (מעל הליבה): <b class="${cls(it.selection.ils)}">${isNum(it.selection.ils) ? fmt.ils(it.selection.ils) : '—'}</b> (${it.selection.lots} עסקאות)</div>` : ''}${it.pending ? `<div class="muted">פקודות ממתינות (${fmt.date(it.pending.day)}): ${it.pending.orders}${it.pending.filled ? ' — בוצעו' : ' — טרם בוצעו'}</div>` : ''}</div>`).join('')}
  </section>
  ${disclaimer('כל המסלולים החדשים (regB, regC, אגרסיבי B) הם סימולציה בלבד (Shadow) — לא נשלחות פקודות לברוקר, והם לא משנים את חשבון התרגול או המסלול האגרסיבי הקיימים.')}`;
  const eq = equityCurve(items, bench, c.commonFrom);
  if (eq) main.querySelector('#eqc').appendChild(lineChart({ dates: eq.dates, series: eq.series, height: 300, yFmt: (v) => v.toFixed(0) }));
  else main.querySelector('#eqc').innerHTML = '<div class="empty">עדיין אין מספיק היסטוריה משותפת לגרף</div>';
}
