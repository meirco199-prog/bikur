// מסך אופטימיזציה (דרישה 9): רשת פרמטרים → אימון/אימות/מבחן, רגישות, מובהקות עם תיקון לריבוי ניסויים, אזהרות Overfitting; Walk-Forward.
import { esc, el, toast, cls } from '../../../js/core/util.js';
import { lineChart } from '../../../js/ui/chart.js';
import { call } from '../engine.js';
import { state } from '../app.js';
import { byId, LIBRARY } from '../../../../invest-api/engine/lab/library.js';
import { OBJECTIVES, expandGrid } from '../../../../invest-api/engine/lab/optimize.js';
import { strategies } from '../store.js';
import { P, P0, N, $$$, err, warn, explainBlock, download, toCsv } from '../ui.js';

export async function render(main, params = {}){
  const saved = strategies.list();
  let src = params.id ? (() => { const s = strategies.get(params.id); return s && { name: s.name, spec: s.spec, params: s.params }; })() : params.template ? byId(params.template) : state.lastRun ? { name: state.lastRun.spec.name, spec: state.lastRun.spec, params: state.lastRun.params || {} } : byId('top10-losers-1d');
  const today = new Date().toISOString().slice(0, 10), Y = +today.slice(0, 4);
  main.innerHTML = `<div class="page-head"><div><h1>אופטימיזציה וחיפוש אסטרטגיות</h1><span class="muted">לא "הכי טוב בעבר": בוחרים באימון, מאשרים באימות, ופותחים את תקופת המבחן פעם אחת. כל ערך = שינוי ברשת; אפשר להוסיף פרמטרים חופשיים (נתיב ב-spec).</span></div></div>
  <div class="grid g-2-1"><section class="card"><h3>אסטרטגיה ורשת פרמטרים</h3><div class="row" style="margin-bottom:.5rem"><select id="src" style="max-width:380px"><optgroup label="תבניות">${LIBRARY.map((t) => `<option value="tpl:${t.id}" ${src?.id === t.id || params.template === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</optgroup>${saved.length ? `<optgroup label="שמורות">${saved.map((s) => `<option value="id:${s.id}" ${params.id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</optgroup>` : ''}</select></div><div id="grid"></div><div class="row"><button class="btn sm" id="addp">+ פרמטר חופשי</button><span class="muted" id="combos"></span></div></section>
  <section class="card"><h3>הגדרות</h3><div class="stack"><label class="f">מה למקסם <select id="obj">${Object.entries(OBJECTIVES).map(([k, v]) => `<option value="${k}" ${k === 'sharpe' ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></label><label class="f">מתאריך <input id="from" type="date" value="${Y - 15}-01-01"></label><label class="f">עד <input id="to" type="date" value="${today}"></label><label class="f">חלוקה אימון/אימות/מבחן <select id="split"><option value="0.5,0.25">50% / 25% / 25%</option><option value="0.6,0.2">60% / 20% / 20%</option><option value="0.4,0.3">40% / 30% / 30%</option></select></label><label class="f">כמה מהטובים באימון לאמת <input id="topk" type="number" value="5" min="1" max="20"></label><button class="btn primary" id="go">▶ אופטימיזציה (אימון → אימות → מבחן)</button><hr style="border:0;border-top:1px solid var(--line)"><label class="f">Walk-Forward: שנות IS <input id="is" type="number" value="3" min="1"></label><label class="f">שנות OOS <input id="oos" type="number" value="1" min="1"></label><button class="btn" id="wf">▶ Walk-Forward</button></div></section></div>
  <div id="out" style="margin-top:1rem"></div>`;
  const gridBox = main.querySelector('#grid');
  let grid = JSON.parse(JSON.stringify(src.params || {}));
  const drawGrid = () => { gridBox.innerHTML = Object.entries(grid).map(([k, p]) => `<div class="cond"><b>${esc(p.label || k)}</b><span class="muted" style="direction:ltr">${esc(Array.isArray(p.path) ? p.path.join(' , ') : p.path)}</span><input data-k="${k}" type="text" value="${esc(p.values.join(', '))}" style="width:240px;direction:ltr"><button class="btn sm ghost x" data-del="${k}">✕</button></div>`).join('') || '<div class="muted">אין פרמטרים — הוסף פרמטר חופשי (למשל נתיב signal.rank.top וערכים 5,10,20)</div>'; gridBox.querySelectorAll('[data-k]').forEach((i) => { i.onchange = () => { grid[i.dataset.k].values = i.value.split(/[,\s]+/).map((x) => (isNaN(+x) ? x : +x)).filter((x) => x !== ''); count(); }; }); gridBox.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { delete grid[b.dataset.del]; drawGrid(); }; }); count(); };
  const count = () => { try { main.querySelector('#combos').textContent = `${expandGrid(grid).length} צירופים`; } catch (e) { main.querySelector('#combos').textContent = e.message; } };
  drawGrid();
  main.querySelector('#src').onchange = (e) => { const v = e.target.value; src = v.startsWith('tpl:') ? byId(v.slice(4)) : (() => { const s = strategies.get(v.slice(3)); return { name: s.name, spec: s.spec, params: s.params }; })(); grid = JSON.parse(JSON.stringify(src.params || {})); drawGrid(); };
  main.querySelector('#addp').onclick = () => { const path = prompt('נתיב ב-spec (למשל signal.rank.top או exit.rules.0.days):'); if (!path) return; const vals = prompt('ערכים מופרדים בפסיק:', '5, 10, 20'); if (!vals) return; grid[path.replace(/\W+/g, '_')] = { label: path, path, values: vals.split(/[,\s]+/).map(Number).filter(Number.isFinite) }; drawGrid(); };
  const out = main.querySelector('#out');
  const common = () => ({ spec: { ...src.spec, name: src.name || src.spec.name }, params: grid, objective: main.querySelector('#obj').value, from: main.querySelector('#from').value || null, to: main.querySelector('#to').value || null });
  main.querySelector('#go').onclick = async () => {
    const c = common(); if (!Object.keys(grid).length) return toast('הוסף פרמטרים לרשת', 'err');
    const [train, val] = main.querySelector('#split').value.split(',').map(Number);
    out.innerHTML = '';
    try {
      const o = await call('optimize', { spec: { ...c.spec, period: { ...(c.spec.period || {}), from: c.from, to: c.to } }, params: grid, objective: c.objective, split: { train, val }, topK: +main.querySelector('#topk').value || 5 }, { busy: 'אופטימיזציה…' });
      if (o.error) return out.innerHTML = `<div class="blocked">${esc(o.error)}</div>`;
      showOptimize(out, o, c);
    } catch (e) { out.innerHTML = err(e); }
  };
  main.querySelector('#wf').onclick = async () => {
    const c = common(); if (!Object.keys(grid).length) return toast('הוסף פרמטרים לרשת', 'err');
    out.innerHTML = '';
    try {
      const w = await call('walk', { spec: { ...c.spec, period: { ...(c.spec.period || {}), from: c.from, to: c.to } }, params: grid, objective: c.objective, isYears: +main.querySelector('#is').value || 3, oosYears: +main.querySelector('#oos').value || 1 }, { busy: 'Walk-Forward…' });
      if (w.error) return out.innerHTML = `<div class="blocked">${esc(w.error)}</div>`;
      showWalk(out, w);
    } catch (e) { out.innerHTML = err(e); }
  };
}
function showOptimize(out, o, c){
  const obj = OBJECTIVES[o.objective]?.label || o.objective, fmtScore = (s) => (s === null || s === undefined ? '—' : ['cagr', 'maxdd', 'consistency'].includes(o.objective) ? P(s) : N(s));
  const combo = (x) => Object.entries(x).map(([k, v]) => `${esc(o.spec.params?.[k]?.label || c.params[k]?.label || k)}=${v}`).join(' · ');
  const sens = Object.entries(o.sensitivity).map(([k, rows]) => `<div style="margin:.3rem 0"><b>${esc(c.params[k]?.label || k)}:</b> <span class="sens">${rows.map((r) => `<span class="${r.chosen ? 'chosen' : ''} ${r.trainScore === null ? '' : r.trainScore > 0 ? 'good' : 'bad'}" title="ציון באימון">${r.value}: ${fmtScore(r.trainScore)}</span>`).join('')}</span></div>`).join('');
  const s = o.significance, t = o.test.summary;
  out.innerHTML = `<section class="card"><h3>תוצאת האופטימיזציה — ${esc(obj)} <span class="muted">${o.combos} צירופים · אימון ${o.ranges.train.from}→${o.ranges.train.to} · אימות ${o.ranges.val.from}→${o.ranges.val.to} · מבחן ${o.ranges.test.from}→${o.ranges.test.to}</span></h3>
    ${o.warnings.length ? `<div class="limited"><b>⚠ אזהרות התאמת-יתר (Overfitting):</b><ul class="warnlist">${o.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '<div class="card tight" style="border-color:var(--pos)">אין אזהרות Overfitting אוטומטיות — זה עדיין לא אומר שהיתרון יימשך.</div>'}
    <div class="grid g3" style="margin-top:.8rem"><div class="card tight"><h4>נבחר (לפי האימות, לא לפי האימון)</h4><div>${combo(o.chosen)}</div><div class="muted">ציון באימון ${fmtScore(o.validation[0].trainScore)} · באימות ${fmtScore(o.validation[0].score)}</div></div>
    <div class="card tight"><h4>תקופת המבחן (נפתחה פעם אחת)</h4>${t ? `<div class="kpis"><div class="kpi"><span class="v ${cls(t.cagr)}">${P(t.cagr)}</span><span class="l">CAGR</span></div><div class="kpi"><span class="v">${N(t.sharpe)}</span><span class="l">Sharpe</span></div><div class="kpi"><span class="v neg">${P0(t.maxDD)}</span><span class="l">ירידה</span></div><div class="kpi"><span class="v">${t.trades}</span><span class="l">עסקאות</span></div></div>` : '<div class="muted">אין תוצאה</div>'}</div>
    <div class="card tight"><h4>מובהקות במבחן אחרי תיקון ל-${o.combos} ניסויים</h4>${s && !s.error ? `<div class="verdict ${s.pAdjusted <= 0.05 && s.deflatedSharpe >= 0.95 ? 'pos' : 'warn'}">${esc(s.verdict)}</div><div class="muted">p=${N(s.pValue, 4)} → מתוקן ${N(s.pAdjusted, 4)} · Deflated Sharpe ${N(s.deflatedSharpe)} (סף Sharpe שמזל מייצר: ${N(s.sharpeThresholdAnnual)})</div>` : '<div class="muted">—</div>'}</div></div>
    <h4 style="margin-top:.8rem">רגישות לפרמטרים (ציון באימון סביב הנבחר — פסגה בודדת = סימן רע)</h4>${sens}
    <div class="muted">חציון הציון ברשת: ${fmtScore(o.train.median)} · חלק הצירופים עם ציון חיובי: ${P0(o.train.positiveShare)}</div></section>
    <div class="grid g2" style="margin-top:1rem"><section class="card"><h3>אימות — ${o.validation.length} הטובים מהאימון</h3><div class="table-wrap compact"><table><thead><tr><th>צירוף</th><th class="num">אימון</th><th class="num">אימות</th><th class="num">CAGR</th><th class="num">ירידה</th><th class="num">עסקאות</th></tr></thead><tbody>${o.validation.map((v, i) => `<tr class="${i === 0 ? 'clickable' : ''}"><td>${i === 0 ? '★ ' : ''}${combo(v.combo)}</td><td class="num">${fmtScore(v.trainScore)}</td><td class="num">${fmtScore(v.score)}</td><td class="num">${P(v.summary?.cagr)}</td><td class="num neg">${P0(v.summary?.maxDD)}</td><td class="num">${v.summary?.trades ?? '—'}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="card"><h3>כל הרשת באימון (${o.train.rows.length}) <button class="btn sm" id="csv">CSV</button></h3><div class="table-wrap compact" style="max-height:360px"><table><thead><tr><th>צירוף</th><th class="num">ציון</th><th class="num">CAGR</th><th class="num">Sharpe</th><th class="num">ירידה</th><th class="num">עסקאות</th></tr></thead><tbody>${o.train.rows.map((r) => `<tr><td>${combo(r.combo)}</td><td class="num">${r.score === null ? `<span class="muted">${r.tooFewTrades ? 'מעט עסקאות' : r.error ? 'שגיאה' : '—'}</span>` : fmtScore(r.score)}</td><td class="num">${P(r.summary?.cagr)}</td><td class="num">${N(r.summary?.sharpe)}</td><td class="num neg">${P0(r.summary?.maxDD)}</td><td class="num">${r.summary?.trades ?? '—'}</td></tr>`).join('')}</tbody></table></div></section></div>
    ${o.test.result ? `<section class="card" style="margin-top:1rem"><h3>עקומת ההון במבחן (הצירוף הנבחר)</h3><div id="teq"></div></section>` : ''}`;
  if (o.test.result){ const r = o.test.result; out.querySelector('#teq').appendChild(lineChart({ dates: r.equity.map((e) => e[0]), series: [{ name: 'נבחר — מבחן', values: r.equity.map((e) => e[1] / r.capital * 100), color: '#4f8cff', width: 1.8 }, ...Object.entries(r.benchmarks || {}).filter(([, e]) => e).map(([b, e]) => ({ name: `${b} B&H`, values: e.map((x) => x[1] / r.capital * 100), color: '#94a3b8', dashed: true }))], height: 260, yFmt: (v) => v.toFixed(0) })); }
  out.querySelector('#csv').onclick = () => download('optimize-train.csv', toCsv(o.train.rows, [{ label: 'צירוף', get: (r) => JSON.stringify(r.combo) }, { label: 'ציון', key: 'score' }, { label: 'CAGR', get: (r) => r.summary?.cagr }, { label: 'Sharpe', get: (r) => r.summary?.sharpe }, { label: 'MaxDD', get: (r) => r.summary?.maxDD }, { label: 'עסקאות', get: (r) => r.summary?.trades }]), 'text/csv;charset=utf-8');
}
function showWalk(out, w){
  const combo = (x) => (x ? Object.entries(x).map(([k, v]) => `${k}=${v}`).join(' · ') : '—');
  out.innerHTML = `<section class="card"><h3>Walk-Forward — ${w.windows.length} חלונות <span class="tag ${w.stability.label === 'יציב' ? 'fact' : 'opinion'}">${esc(w.stability.label)}</span></h3>${w.warning ? warn(w.warning) : ''}
    ${w.oosMetrics ? `<div class="kpis"><div class="kpi"><span class="v ${cls(w.oosMetrics.cagr)}">${P(w.oosMetrics.cagr)}</span><span class="l">CAGR — OOS משורשר (ההערכה ההוגנת)</span></div><div class="kpi"><span class="v">${N(w.oosMetrics.sharpe)}</span><span class="l">Sharpe OOS</span></div><div class="kpi"><span class="v neg">${P0(w.oosMetrics.maxDD)}</span><span class="l">ירידה OOS</span></div><div class="kpi"><span class="v">${w.oosPositiveWindows}/${w.windows.length}</span><span class="l">חלונות OOS חיוביים</span></div><div class="kpi"><span class="v">${w.stability.changes}</span><span class="l">החלפות פרמטר בין חלונות</span></div></div>` : ''}
    <div id="wfeq" style="margin-top:.8rem"></div>
    <div class="table-wrap compact" style="margin-top:.8rem"><table><thead><tr><th>IS</th><th>OOS</th><th>נבחר ב-IS</th><th class="num">ציון IS</th><th class="num">OOS תשואה</th><th class="num">OOS ירידה</th><th class="num">OOS עסקאות</th></tr></thead><tbody>${w.windows.map((x) => `<tr><td>${x.isFrom} → ${x.isTo}</td><td>${x.oosFrom} → ${x.oosTo}</td><td>${combo(x.chosen)}${x.note ? ` <span class="muted">${esc(x.note)}</span>` : ''}</td><td class="num">${N(x.isScore)}</td><td class="num ${cls(x.oos?.totalReturn)}">${P(x.oos?.totalReturn)}</td><td class="num neg">${P0(x.oos?.maxDD)}</td><td class="num">${x.oos?.trades ?? '—'}</td></tr>`).join('')}</tbody></table></div></section>`;
  if (w.oosEquity?.length) out.querySelector('#wfeq').appendChild(lineChart({ dates: w.oosEquity.map((e) => e[0]), series: [{ name: 'OOS משורשר', values: w.oosEquity.map((e) => e[1] / w.oosEquity[0][1] * 100), color: '#a78bfa', area: true }], height: 220, yFmt: (v) => v.toFixed(0) }));
}
