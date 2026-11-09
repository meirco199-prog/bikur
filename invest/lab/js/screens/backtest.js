// מסך Backtesting ותוצאות (דרישה 7): הרצה, KPI, גרפים (הון, ירידה, Heatmap, התפלגות, פילוחים), מדדי סיכון, תקופות שוק, מובהקות, Monte Carlo,
// כיסוי נתונים והנחות, כל העסקאות, שמירה וייצוא. מקור ה-spec: תבנית / אסטרטגיה שמורה / טיוטה מהבונה / תוצאה שמורה / תוצאת ייחוס מ-Actions.
import { esc, el, toast, cls } from '../../../js/core/util.js';
import { call } from '../engine.js';
import { state, go } from '../app.js';
import { byId } from '../../../../invest-api/engine/lab/library.js';
import { normalizeSpec } from '../../../../invest-api/engine/lab/schema.js';
import { strategies, results } from '../store.js';
import { setDraft } from './builder.js';
import { kpis, metricsTable, tradeStats, heatmap, groupTable, groupBars, equityChart, drawdownChart, histogramChart, explainBlock, coverageBox, assumptionsBox, tradesTable, exportButtons, limitedTag, P, P0, N, $$$, err, rangePicker, bindRange, readRange } from '../ui.js';
import { openTradeModal } from './trades.js';

export async function render(main, params = {}){
  let src = null; // {spec, params, name, id}
  if (params.draft && state.pendingSpec) src = state.pendingSpec;
  else if (params.id){ const s = strategies.get(params.id); if (s) src = { spec: s.spec, params: s.params, name: s.name, id: s.id }; }
  else if (params.template){ const t = byId(params.template); if (t) src = { spec: t.spec, params: t.params, name: t.name, templateId: t.id }; }
  main.innerHTML = `<div class="page-head"><div><h1>Backtesting</h1><span class="muted">הרצה כרונולוגית ללא look-ahead · ביצוע ריאלי · עלויות מלאות · Backtest אינו תחזית</span></div><div class="row" id="top"></div></div><div id="setup"></div><div id="out"></div>`;
  const out = main.querySelector('#out');
  if (params.saved){ const r = await results.get(params.saved); if (!r) return out.innerHTML = err('התוצאה השמורה לא נמצאה'); return showRun(main, r.run, { name: r.name, savedId: r.id, strategyId: r.strategyId }); }
  if (params.ref){ try { const run = await call('result', { file: `${params.ref}.json` }, { busy: 'טוען תוצאת ייחוס…' }); if (!run) throw new Error('הקובץ לא נמצא בענף הנתונים'); return showRun(main, { spec: run.spec, result: run.result, analysis: run.analysis, periods: run.periods, significance: run.significance, mc: run.mc, optimize: run.optimize, walk: run.walk }, { name: run.spec.name, reference: true, builtAt: run.builtAt }); } catch (e) { return out.innerHTML = err(e); } }
  if (!src && state.lastRun) return showRun(main, state.lastRun, { name: state.lastRun.spec.name });
  if (!src){ const t = byId('top10-losers-1d'); src = { spec: t.spec, params: t.params, name: t.name, templateId: t.id }; }
  const spec = JSON.parse(JSON.stringify(src.spec));
  main.querySelector('#setup').innerHTML = `<div class="grid g-2-1"><section class="card"><h3>${esc(src.name || spec.name)} <span class="muted">${src.id ? 'אסטרטגיה שמורה' : src.templateId ? 'תבנית' : 'טיוטה'}</span></h3>${explainBlock(spec)}</section>
    <section class="card"><h3>הרצה</h3><div class="stack"><h4>תקופת הבדיקה</h4>${rangePicker({ from: spec.period?.from || '', to: spec.period?.to || '' })}<label class="f"><span>הון התחלתי $</span><input id="cap" type="number" value="${spec.sizing?.capital ?? 50000}"></label><div class="muted">טעינת מערך מלא של S&P 500 לוקחת זמן בפעם הראשונה; הנתונים נשמרים במטמון הדפדפן.</div><button class="btn primary" id="go">▶ הרץ</button><a class="btn" href="#/builder${src.id ? '?id=' + src.id : src.templateId ? '?template=' + src.templateId : ''}">✎ ערוך בבונה</a></div></section></div>`;
  bindRange(main);
  main.querySelector('#go').onclick = async () => {
    const rg = readRange(main); spec.period = { ...(spec.period || {}), from: rg.from, to: rg.to }; spec.sizing = { ...(spec.sizing || {}), capital: +main.querySelector('#cap').value || 50000 };
    try { normalizeSpec(spec); } catch (e) { return toast(e.message, 'err'); }
    out.innerHTML = '';
    try {
      const run = await call('run', { spec }, { busy: 'טוען נתונים ומריץ…' });
      if (run.error){ out.innerHTML = `<div class="blocked"><b>${run.blocked ? 'הבדיקה חסומה' : 'שגיאה'}:</b> ${esc(run.error)}${run.coverage ? `<div class="muted">${esc(run.coverage.note || '')}</div>` : ''}</div>`; return; }
      run.params = src.params; run.name = src.name || spec.name; run.strategyId = src.id || null; state.lastRun = run;
      showRun(main, run, { name: run.name, strategyId: src.id, params: src.params });
    } catch (e) { out.innerHTML = err(e); }
  };
  if (params.autorun === '1') main.querySelector('#go').click();
}

export function showRun(main, run, { name, savedId = null, strategyId = null, reference = false, builtAt = null, params = null } = {}){
  const out = main.querySelector('#out') || main; const res = run.result, a = run.analysis, spec = run.spec;
  main.querySelector('#setup') && (main.querySelector('#setup').innerHTML = '');
  const top = main.querySelector('#top'); if (top){ top.innerHTML = ''; top.append(el(`<a class="btn sm" href="#/backtest?${strategyId ? 'id=' + strategyId : 'template=' + (byId(spec.name) ? spec.name : 'top10-losers-1d')}">הרצה חדשה</a>`)); const edit = el('<button class="btn sm">✎ ערוך בבונה</button>'); edit.onclick = () => { setDraft(spec, { id: strategyId, params: params || run.params || {}, name }); go('builder'); }; top.appendChild(edit); if (!reference && !savedId){ const save = el('<button class="btn sm">💾 שמור תוצאה</button>'); save.onclick = async () => { const rec = await results.save({ name: name || spec.name, kind: 'backtest', from: res.from, to: res.to, strategyId, summary: { cagr: a.series.cagr, sharpe: a.series.sharpe, maxDD: a.series.maxDD, trades: a.trades.count, finalEquity: res.finalEquity, capital: res.capital, limited: res.limited }, run: { spec, result: res, analysis: a, periods: run.periods, significance: run.significance, mc: run.mc } }); toast(rec ? 'התוצאה נשמרה — זמינה להשוואה' : 'לא ניתן לשמור (IndexedDB)'); }; top.appendChild(save); } top.appendChild(exportButtons(() => ({ spec, result: res, analysis: a, periods: run.periods, significance: run.significance, mc: run.mc }), (name || spec.name).replace(/[^\w֐-׿-]+/g, '_'))); }
  const sig = run.significance && !run.significance.error ? run.significance : null, mc = run.mc && !run.mc.error ? run.mc : null;
  const periods = (run.periods || []).filter((p) => !p.missing);
  out.innerHTML = `
  <section class="card"><h3>${esc(name || spec.name)} ${limitedTag(res)} <span class="muted">${res.from} → ${res.to} · ${res.days.toLocaleString('en-US')} ימי מסחר · ${reference ? `ריצה מלאה ב-GitHub Actions (${esc((builtAt || '').slice(0, 10))})` : `${(res.runtimeMs / 1000).toFixed(1)} שניות`}</span></h3>${kpis(a, res)}</section>
  ${coverageBox(res, a)}
  ${res.trades.length === 0 ? `<div class="limited"><b>0 עסקאות.</b> התנאים/הדירוג לא ייצרו אף פקודה שבוצעה בתקופה הזו (ראה "פקודות שלא בוצעו" בהנחות). בדוק את התנאים בסורק ההיסטורי, הרחב את התקופה או שנה את המסננים.</div>` : ''}
  <div class="grid g-2-1" style="margin-top:1rem"><section class="card"><h3>צמיחת התיק (לוג, 100 = הון התחלתי) מול Buy&Hold</h3><div id="eq"></div></section><section class="card"><h3>מדדי סיכון ותשואה</h3>${metricsTable(a, spec.benchmarks || [])}</section></div>
  <div class="grid g2" style="margin-top:1rem"><section class="card"><h3>Drawdown</h3><div id="dd"></div></section><section class="card"><h3>התפלגות רווח/הפסד לעסקה</h3><div id="hist"></div></section></div>
  <section class="card" style="margin-top:1rem"><h3>תשואות חודשיות ושנתיות</h3>${heatmap(a.periodic.heatmap)}</section>
  <div class="grid g2" style="margin-top:1rem"><section class="card"><h3>סטטיסטיקת עסקאות</h3>${tradeStats(a.trades)}</section><section class="card"><h3>לפי שנה</h3>${groupTable(a.breakdowns.byYear, 'שנה')}</section></div>
  <div class="grid g3" style="margin-top:1rem"><section class="card"><h3>לפי יום בשבוע (יום הכניסה)</h3><div id="wd"></div>${groupTable(a.breakdowns.byWeekday, 'יום')}</section><section class="card"><h3>לפי חודש</h3><div id="mo"></div>${groupTable(a.breakdowns.byMonth, 'חודש')}</section><section class="card"><h3>לפי משך החזקה (ימים)</h3><div id="hd"></div>${groupTable(a.breakdowns.byHold, 'ימים')}</section></div>
  <div class="grid g2" style="margin-top:1rem"><section class="card"><h3>לפי סקטור</h3>${groupTable(a.breakdowns.bySector, 'סקטור')}</section><section class="card"><h3>לפי סיבת יציאה</h3>${groupTable(a.breakdowns.byExit, 'סיבה')}</section></div>
  ${periods.length ? `<section class="card" style="margin-top:1rem"><h3>תקופות שוק שונות</h3><div class="table-wrap compact"><table><thead><tr><th>תקופה</th><th>טווח</th><th class="num">האסטרטגיה${a.series.additive ? ' (על ההון הקבוע)' : ''}</th><th class="num">ירידה</th><th class="num">Sharpe</th><th class="num">SPY${a.series.additive ? ' (מכפלי)' : ''}</th><th class="num">עסקאות</th><th class="num">רווחיות</th></tr></thead><tbody>${periods.map((p) => `<tr><td>${esc(p.label)}</td><td class="muted">${p.from} → ${p.to}</td><td class="num ${cls(p.totalReturn)}">${P(p.totalReturn)}</td><td class="num neg">${P0(p.maxDD)}</td><td class="num">${N(p.sharpe)}</td><td class="num muted">${p.bench ? P(p.bench.totalReturn) : '—'}</td><td class="num">${p.trades}</td><td class="num">${P0(p.winRate)}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
  <div class="grid g2" style="margin-top:1rem">
    <section class="card"><h3>מובהקות סטטיסטית</h3>${sig ? `<p class="verdict ${sig.pValue <= 0.05 ? 'pos' : 'warn'}">${esc(sig.verdict)}</p><div class="table-wrap compact"><table><tbody><tr><td>ממוצע תשואה יומית</td><td class="num">${P(sig.meanDaily, 4)}</td></tr><tr><td>t / p-value</td><td class="num">${N(sig.tStat)} / ${N(sig.pValue, 4)}</td></tr><tr><td>p (bootstrap)</td><td class="num">${N(sig.pBootstrap, 4)}</td></tr><tr><td>Sharpe שנתי</td><td class="num">${N(sig.sharpeAnnual)}</td></tr><tr><td>Probabilistic Sharpe (סיכוי ש-Sharpe > 0)</td><td class="num">${P0(sig.probabilisticSharpe)}</td></tr><tr><td>צידוד / קורטוזיס של התשואות</td><td class="num">${N(sig.skew)} / ${N(sig.kurtosis)}</td></tr></tbody></table></div><p class="muted">מובהקות של בדיקה בודדת. אחרי חיפוש בין וריאציות יש לתקן לריבוי ניסויים — ראה מסך האופטימיזציה (Deflated Sharpe, Bonferroni).</p>` : '<div class="muted">אין מספיק ימים</div>'}</section>
    <section class="card"><h3>Monte Carlo — ערבוב סדר העסקאות</h3>${mc ? `<div class="kpis">${k('הון סופי — אחוזון 5', $$$(mc.finalEquity.p5), 'neg')}${k('חציון', $$$(mc.finalEquity.median))}${k('אחוזון 95', $$$(mc.finalEquity.p95), 'pos')}${k('ירידה חציונית', P0(mc.maxDD.median), 'neg')}${k('הסתברות להפסד', P0(mc.probLoss))}${k('הסתברות לירידה > 20%', P0(mc.probDD20))}</div><details style="margin-top:.5rem"><summary>מגבלות השיטה</summary><ul class="warnlist">${mc.limitations.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details>` : '<div class="muted">אין עסקאות</div>'}</section></div>
  <section class="card" style="margin-top:1rem"><h3>הגדרת האסטרטגיה כפי שהורצה</h3>${explainBlock(spec)}</section>
  <div style="margin-top:1rem">${assumptionsBox(res)}</div>
  <section class="card" style="margin-top:1rem"><h3>כל העסקאות (${res.trades.length}) <span class="muted">לחץ על עסקה לגרף היסטורי ולפרטים · הייצוא כולל הכול</span></h3><div id="trades"></div></section>`;
  out.querySelector('#eq').appendChild(equityChart({ ...res, spec }));
  out.querySelector('#dd').appendChild(drawdownChart(a));
  out.querySelector('#hist').appendChild(histogramChart(a.histogram));
  out.querySelector('#wd').appendChild(groupBars(a.breakdowns.byWeekday)); out.querySelector('#mo').appendChild(groupBars(a.breakdowns.byMonth)); out.querySelector('#hd').appendChild(groupBars(a.breakdowns.byHold));
  out.querySelector('#trades').appendChild(tradesTable(res.trades, { onRow: (t) => openTradeModal(t, spec) }));
}
const k = (l, v, c = '') => `<div class="kpi"><span class="v ${c}">${v}</span><span class="l">${esc(l)}</span></div>`;
