// השוואת אסטרטגיות (דרישה 8): כמה אסטרטגיות באותו גרף ובטבלה אחת — אותו הון, אותה תקופה, אותן עלויות (נכפים על כולן).
import { esc, el, toast, cls } from '../../../js/core/util.js';
import { lineChart, chartColors } from '../../../js/ui/chart.js';
import { call } from '../engine.js';
import { byId, LIBRARY } from '../../../../invest-api/engine/lab/library.js';
import { strategies, results } from '../store.js';
import { P, P0, N, $$$, limitedTag, err, download, toCsv, rangePicker, bindRange, readRange } from '../ui.js';

export async function render(main){
  const saved = strategies.list(), savedRes = await results.list();
  const today = new Date().toISOString().slice(0, 10), Y = +today.slice(0, 4);
  main.innerHTML = `<div class="page-head"><div><h1>השוואת אסטרטגיות</h1><span class="muted">בחר עד 6 אסטרטגיות. כולן ירוצו באותו הון, באותה תקופה ובאותו מודל עלויות — השוואה הוגנת. Buy&Hold של SPY/QQQ מתווסף אוטומטית.</span></div></div>
  <div class="grid g-2-1"><section class="card"><h3>מה להשוות</h3><div class="row" style="margin-bottom:.5rem"><select id="add" style="max-width:380px"><optgroup label="תבניות">${LIBRARY.map((t) => `<option value="tpl:${t.id}">${esc(t.name)}</option>`).join('')}</optgroup>${saved.length ? `<optgroup label="שמורות">${saved.map((s) => `<option value="id:${s.id}">${esc(s.name)}</option>`).join('')}</optgroup>` : ''}${savedRes.length ? `<optgroup label="תוצאות שמורות (ללא הרצה מחדש — רק אם התקופה זהה)">${savedRes.map((r) => `<option value="res:${r.id}">${esc(r.name)} (${r.from}→${r.to})</option>`).join('')}</optgroup>` : ''}</select><button class="btn" id="addBtn">+ הוסף</button><button class="btn sm ghost" id="preset">דוגמת הדרישה (א׳–ד׳)</button></div><div id="list" class="stack"></div></section>
  <section class="card"><h3>הנחות משותפות</h3><div class="stack"><label class="f"><span>הון התחלתי $</span><input id="cap" type="number" value="50000"></label><h4>תקופה</h4>${rangePicker({ from: `${Y - 10}-01-01`, to: today })}<label class="f"><span>עלויות</span> <select id="costs"><option value="ibkr_fixed">IBKR Fixed + החלקה 5 נ"ב</option><option value="bps">10 נ"ב לכל צד</option><option value="none">ללא (לא ריאלי)</option></select></label><button class="btn primary" id="go">▶ הרץ השוואה</button></div></section></div>
  <div id="out" style="margin-top:1rem"></div>`;
  const items = [];
  const list = main.querySelector('#list');
  const drawList = () => { list.innerHTML = items.map((it, i) => `<div class="row spread" style="padding:.3rem .5rem;background:var(--bg3);border-radius:8px"><span><i style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${chartColors[i % chartColors.length]};margin-inline-end:.4rem"></i><b>${esc(it.name)}</b> <span class="muted">${it.kind}</span></span><button class="btn sm ghost" data-rm="${i}">✕</button></div>`).join('') || '<div class="muted">הוסף אסטרטגיות מהרשימה</div>'; list.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => { items.splice(+b.dataset.rm, 1); drawList(); }; }); };
  const add = (v) => { if (items.length >= 6) return toast('עד 6 אסטרטגיות', 'err'); if (v.startsWith('tpl:')){ const t = byId(v.slice(4)); items.push({ name: t.name, kind: 'תבנית', spec: t.spec }); } else if (v.startsWith('id:')){ const s = strategies.get(v.slice(3)); items.push({ name: s.name, kind: 'שמורה', spec: s.spec }); } else { items.push({ name: savedRes.find((r) => r.id === v.slice(4))?.name, kind: 'תוצאה שמורה', resultId: v.slice(4) }); } drawList(); };
  main.querySelector('#addBtn').onclick = () => add(main.querySelector('#add').value);
  main.querySelector('#preset').onclick = () => { items.length = 0; const a = byId('top10-losers-1d'); items.push({ name: "א׳: 10 שירדו הכי הרבה אתמול", kind: 'תבנית', spec: a.spec }); items.push({ name: "ב׳: 10 שירדו הכי הרבה ב-3 ימים", kind: 'תבנית', spec: { ...a.spec, signal: { ...a.spec.signal, rank: { ...a.spec.signal.rank, params: { days: 3 } } } } }); items.push({ name: "ג׳: 10 שעלו הכי הרבה בשבוע", kind: 'תבנית', spec: { ...a.spec, signal: { ...a.spec.signal, rank: { feature: 'ret', params: { days: 5 }, order: 'desc', top: 10 } } } }); items.push({ name: "ד׳: Buy & Hold S&P 500", kind: 'תבנית', spec: { name: 'Buy & Hold SPY', universe: { type: 'list', symbols: ['SPY'], filters: { minPrice: 0, minDollarVol: 0, minBars: 2 } }, signal: { conditions: { all: [{ feature: 'bars', op: '>', value: 1 }] } }, entry: { timing: 'next_open' }, exit: { rules: [{ type: 'time', days: 100000 }] }, sizing: { capital: 50000, maxPositions: 1 }, benchmarks: ['SPY'] } }); drawList(); };
  drawList(); bindRange(main);
  main.querySelector('#go').onclick = async () => {
    if (!items.length) return toast('הוסף אסטרטגיות', 'err');
    const rg = readRange(main); const cap = +main.querySelector('#cap').value || 50000, from = rg.from, to = rg.to, costs = main.querySelector('#costs').value;
    const out = main.querySelector('#out'); out.innerHTML = '';
    const runs = [];
    try {
      for (let i = 0; i < items.length; i++){
        const it = items[i];
        if (it.resultId){ const r = await results.get(it.resultId); if (!r) continue; runs.push({ name: it.name, run: r.run, note: r.run.result.from !== from || r.run.result.to !== to ? 'תקופה/הון שונים — לא השוואה הוגנת' : null }); continue; }
        const spec = { ...it.spec, period: { ...(it.spec.period || {}), from, to }, sizing: { ...(it.spec.sizing || {}), capital: cap }, costs: { model: costs }, benchmarks: ['SPY', 'QQQ'] };
        const run = await call('run', { spec, extras: false }, { busy: `מריץ ${i + 1}/${items.length}: ${it.name}` });
        if (run.error){ runs.push({ name: it.name, error: run.error }); continue; }
        runs.push({ name: it.name, run });
      }
    } catch (e) { out.innerHTML = err(e); return; }
    const ok = runs.filter((r) => r.run);
    if (!ok.length){ out.innerHTML = `<div class="blocked">${runs.map((r) => `${esc(r.name)}: ${esc(r.error || '')}`).join('<br>')}</div>`; return; }
    const base = ok[0].run.result, dates = base.equity.map((e) => e[0]);
    const align = (eq) => { const m = new Map(eq.map((e) => [e[0], e[1]])); let last = null; return dates.map((d) => { if (m.has(d)) last = m.get(d); return last === null ? null : last / eq[0][1] * 100; }); };
    const series = ok.map((r, i) => ({ name: r.name, values: align(r.run.result.equity), color: chartColors[i % chartColors.length], width: 1.6 }));
    for (const [b, eq] of Object.entries(base.benchmarks || {})) if (eq) series.push({ name: `${b} B&H`, values: align(eq), color: '#94a3b8', dashed: true, width: 1 });
    const row = (label, f) => `<tr><td>${label}</td>${ok.map((r) => `<td class="num">${f(r.run)}</td>`).join('')}</tr>`;
    out.innerHTML = `<section class="card"><h3>צמיחת התיק (100 = הון התחלתי ${$$$(cap)}) · ${base.from} → ${base.to}</h3><div id="chart"></div></section>
      <section class="card" style="margin-top:1rem"><h3>טבלת השוואה <button class="btn sm" id="csv">CSV</button></h3><div class="table-wrap compact"><table><thead><tr><th>מדד</th>${ok.map((r) => `<th class="num">${esc(r.name)} ${limitedTag(r.run.result)}</th>`).join('')}</tr></thead><tbody>
        ${row('הון סופי', (r) => `<span class="${cls(r.result.finalEquity - r.result.capital)}">${$$$(r.result.finalEquity)}</span>`)}${row('תשואה כוללת', (r) => P(r.analysis.series.totalReturn))}${row('CAGR', (r) => P(r.analysis.series.cagr))}${row('ירידה מקסימלית', (r) => P0(r.analysis.series.maxDD))}${row('Sharpe', (r) => N(r.analysis.series.sharpe))}${row('Sortino', (r) => N(r.analysis.series.sortino))}${row('Calmar', (r) => N(r.analysis.series.calmar))}${row('תנודתיות שנתית', (r) => P0(r.analysis.series.annVol))}${row('עסקאות', (r) => N(r.analysis.trades.count, 0))}${row('אחוז רווחיות', (r) => P0(r.analysis.trades.winRate))}${row('Profit Factor', (r) => N(r.analysis.trades.profitFactor))}${row('עלויות כוללות', (r) => $$$(r.result.totals.costs))}${row('חשיפה ממוצעת', (r) => P0(r.analysis.series.avgExposure))}${row('שנים חיוביות', (r) => { const ys = Object.values(r.analysis.periodic.yearly); return `${ys.filter((y) => y > 0).length}/${ys.length}`; })}
      </tbody></table></div>${runs.filter((r) => r.error || r.note).map((r) => `<div class="limited">${esc(r.name)}: ${esc(r.error || r.note)}</div>`).join('')}</section>
      <section class="card" style="margin-top:1rem"><h3>תשואה שנתית לפי אסטרטגיה</h3><div class="table-wrap compact"><table><thead><tr><th>שנה</th>${ok.map((r) => `<th class="num">${esc(r.name)}</th>`).join('')}</tr></thead><tbody>${[...new Set(ok.flatMap((r) => Object.keys(r.run.analysis.periodic.yearly)))].sort().map((y) => `<tr><td>${y}</td>${ok.map((r) => { const v = r.run.analysis.periodic.yearly[y]; return `<td class="num ${cls(v)}">${P(v)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div></section>`;
    out.querySelector('#chart').appendChild(lineChart({ dates, series, height: 340, logScale: true, yFmt: (v) => v.toFixed(0) }));
    out.querySelector('#csv').onclick = () => download('compare.csv', toCsv(ok, [{ label: 'אסטרטגיה', get: (r) => r.name }, { label: 'הון סופי', get: (r) => r.run.result.finalEquity }, { label: 'CAGR', get: (r) => r.run.analysis.series.cagr }, { label: 'MaxDD', get: (r) => r.run.analysis.series.maxDD }, { label: 'Sharpe', get: (r) => r.run.analysis.series.sharpe }, { label: 'עסקאות', get: (r) => r.run.analysis.trades.count }, { label: 'רווחיות', get: (r) => r.run.analysis.trades.winRate }, { label: 'מוגבל', get: (r) => r.run.result.limited }]), 'text/csv;charset=utf-8');
  };
}
