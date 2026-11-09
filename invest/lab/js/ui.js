// רכיבי תצוגה משותפים למעבדה: KPI, טבלאות מדדים, Heatmap, הסבר האסטרטגיה, אזהרות כיסוי, ייצוא.
import { esc, fmt, isNum, cls, el } from '../../js/core/util.js';
import { lineChart, barChart } from '../../js/ui/chart.js';
import { explainSpec } from '../../../invest-api/engine/lab/schema.js';

export const P = (x, d = 1) => (isNum(x) ? `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%` : '—');
export const P0 = (x, d = 1) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : '—');
export const N = (x, d = 2) => (isNum(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 }) : x === Infinity ? '∞' : '—');
export const $$$ = (x) => (isNum(x) ? Math.round(x).toLocaleString('en-US') + '$' : '—');
export const kpiBox = (label, value, c = '') => `<div class="kpi"><span class="v ${c}">${value}</span><span class="l">${esc(label)}</span></div>`;

export function kpis(a, res){
  const s = a.series, t = a.trades;
  return `<div class="kpis">
    ${kpiBox('הון סופי', $$$(res.finalEquity), cls(res.finalEquity - res.capital))}${kpiBox('רווח/הפסד', $$$(res.finalEquity - res.capital), cls(res.finalEquity - res.capital))}${kpiBox('תשואה כוללת', P(s.totalReturn), cls(s.totalReturn))}${s.additive ? kpiBox('תשואה שנתית ממוצעת (על ההון הקבוע)', P(s.avgAnnual), cls(s.avgAnnual)) : kpiBox('CAGR', P(s.cagr), cls(s.cagr))}
    ${kpiBox('ירידה מקסימלית', P0(s.maxDD), 'neg')}${kpiBox('Sharpe', N(s.sharpe), cls(s.sharpe))}${kpiBox('Sortino', N(s.sortino), cls(s.sortino))}${kpiBox('Calmar', N(s.calmar), cls(s.calmar))}
    ${kpiBox('עסקאות', N(t.count, 0))}${kpiBox('אחוז רווחיות', P0(t.winRate))}${kpiBox('Profit Factor', N(t.profitFactor))}${kpiBox('Expectancy לעסקה', P(t.expectancyPct, 2), cls(t.expectancyPct))}
    ${kpiBox('עלויות כוללות', $$$(res.totals.costs), 'neg')}${kpiBox('תנודתיות שנתית', P0(s.annVol))}${kpiBox('VaR 95% יומי', P0(s.var95), 'neg')}${kpiBox('חשיפה ממוצעת', P0(s.avgExposure))}
  </div>`;
}
export function metricsTable(a, benchKeys = []){
  const add = !!a.series.additive;
  const rows = [['תשואה כוללת', (m) => P(m.totalReturn)], [add ? 'תשואה שנתית ממוצעת (אסטרטגיה) / CAGR (ייחוס)' : 'CAGR', (m) => (m.additive ? P(m.avgAnnual) : P(m.cagr))], ['תנודתיות שנתית', (m) => P0(m.annVol)], ['Sharpe', (m) => N(m.sharpe)], ['Sortino', (m) => N(m.sortino)], ['Calmar', (m) => N(m.calmar)], ['ירידה מקסימלית', (m) => P0(m.maxDD)], ['ימי ירידה ארוכים ביותר', (m) => N(m.longestDrawdownDays, 0)], ['התאוששות מהירידה (ימים)', (m) => (m.recovered ? N(m.recoveryDays, 0) : 'לא התאוששה')], ['VaR 95% יומי', (m) => P0(m.var95)], ['CVaR 95%', (m) => P0(m.cvar95)], ['ימים חיוביים', (m) => P0(m.positiveDays)], ['רצף ימי הפסד מקסימלי', (m) => N(m.maxLosingDays, 0)]];
  const bs = benchKeys.filter((b) => a.benchmarks?.[b]);
  return `<div class="table-wrap compact"><table><thead><tr><th>מדד</th><th class="num">האסטרטגיה${add ? ' <span class="tag opinion" title="מצב מחקר: אחוזים = שינוי בדולרים חלקי ההון הקבוע">על ההון הקבוע</span>' : ''}</th>${bs.map((b) => `<th class="num">${esc(b)} (B&H${add ? ', מכפלי' : ''})</th>`).join('')}</tr></thead><tbody>${rows.map(([l, f]) => `<tr><td>${l}</td><td class="num">${f(a.series)}</td>${bs.map((b) => `<td class="num muted">${f(a.benchmarks[b].metrics)}</td>`).join('')}</tr>`).join('')}${bs.map((b) => { const r = a.benchmarks[b].relative; return r ? (r.additive ? `<tr><td>מול ${esc(b)}: קורלציה יומית <span class="muted">(בטא/אלפא לא מחושבים במצב מחקר — יחידות שונות)</span></td><td class="num" colspan="${bs.length + 1}">${N(r.correlation)}</td></tr>` : `<tr><td>מול ${esc(b)}: בטא / אלפא שנתית / קורלציה</td><td class="num" colspan="${bs.length + 1}">${N(r.beta)} / ${P(r.alphaAnnual)} / ${N(r.correlation)}</td></tr>`) : ''; }).join('')}</tbody></table></div>${add ? '<p class="muted">מצב מחקר: עמודת האסטרטגיה באחוזים מההון הקבוע (אדיטיבי); עמודות הייחוס — תשואה מכפלית רגילה. ההשוואה היא בדולרים על אותו הון התחלתי, לא באותה יחידת תשואה.</p>' : ''}`;
}
export function tradeStats(t){
  const rows = [['מספר עסקאות', N(t.count, 0)], ['אחוז עסקאות רווחיות', P0(t.winRate)], ['רווח ממוצע לעסקה', `${$$$(t.avgTrade)} (${P(t.avgTradePct, 2)})`], ['רווח ממוצע בעסקה מרוויחה', `${$$$(t.avgWin)} (${P(t.avgWinPct, 2)})`], ['הפסד ממוצע בעסקה מפסידה', `${$$$(t.avgLoss)} (${P(t.avgLossPct, 2)})`], ['Profit Factor', N(t.profitFactor)], ['Expectancy', `${$$$(t.expectancy)} לעסקה · ${P(t.expectancyPct, 2)}`], ['יחס רווח/הפסד ממוצע', N(t.payoff)], ['העסקה הטובה / הגרועה', `${P(t.best)} / ${P(t.worst)}`], ['רצף הפסדים / רווחים מקסימלי', `${N(t.maxLosingStreak, 0)} / ${N(t.maxWinningStreak, 0)}`], ['משך החזקה ממוצע (ימים)', N(t.avgHoldDays, 1)], ['MFE / MAE ממוצעים', `${P(t.avgMfe, 2)} / ${P(t.avgMae, 2)}`], ['עלויות כוללות בעסקאות', $$$(t.totalCosts)], ['עסקאות מעל 1% מהמחזור היומי', `${N(t.highParticipation, 0)} (מקס׳ ${P0(t.maxParticipation, 2)})`]];
  return `<div class="table-wrap compact"><table><tbody>${rows.map(([l, v]) => `<tr><td>${l}</td><td class="num">${v}</td></tr>`).join('')}</tbody></table></div>`;
}
const heatColor = (v) => { if (!isNum(v)) return ''; const a = Math.min(1, Math.abs(v) / 0.08); return v >= 0 ? `background:rgba(47,191,113,${0.15 + a * 0.75})` : `background:rgba(229,72,77,${0.15 + a * 0.75})`; };
export function heatmap(h){
  const M = ['ינו', 'פבר', 'מרץ', 'אפר', 'מאי', 'יונ', 'יול', 'אוג', 'ספט', 'אוק', 'נוב', 'דצמ'];
  return `<div class="table-wrap" style="max-height:none;border:0"><table class="heat"><thead><tr><th>שנה</th>${M.map((m) => `<th>${m}</th>`).join('')}<th>שנה</th></tr></thead><tbody>${h.map((r) => `<tr><th>${r.year}</th>${r.months.map((v) => `<td class="c ${isNum(v) ? '' : 'na'}" style="${heatColor(v)}" title="${isNum(v) ? P(v, 2) : 'אין נתונים'}">${isNum(v) ? (v * 100).toFixed(1) : '·'}</td>`).join('')}<td class="tot ${cls(r.total)}">${P(r.total)}</td></tr>`).join('')}</tbody></table></div>`;
}
export function groupTable(rows, label){ return `<div class="table-wrap compact"><table><thead><tr><th>${esc(label)}</th><th class="num">עסקאות</th><th class="num">רווחיות</th><th class="num">ממוצע</th><th class="num">P&L</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.key)}</td><td class="num">${r.count}</td><td class="num">${P0(r.winRate)}</td><td class="num ${cls(r.avgPct)}">${P(r.avgPct, 2)}</td><td class="num ${cls(r.pnl)}">${$$$(r.pnl)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">אין</td></tr>'}</tbody></table></div>`; }
export function groupBars(rows, { height = 150 } = {}){ return barChart({ labels: rows.map((r) => r.key), values: rows.map((r) => r.avgPct), height, yFmt: (v) => (v * 100).toFixed(2) + '%' }); }
export function equityChart(res, { height = 320, extra = [] } = {}){
  const dates = res.equity.map((e) => e[0]), base = res.capital;
  const series = [{ name: res.spec?.name || 'האסטרטגיה', values: res.equity.map((e) => e[1] / base * 100), color: '#4f8cff', width: 1.9 }];
  const colors = ['#f5a524', '#94a3b8', '#a78bfa', '#38bdf8'];
  Object.entries(res.benchmarks || {}).forEach(([b, eq], i) => { if (eq) series.push({ name: `${b} Buy&Hold`, values: eq.map((e) => e[1] / base * 100), color: colors[i % colors.length], dashed: true, width: 1.2 }); });
  for (const s of extra) series.push(s);
  return lineChart({ dates, series, height, logScale: true, yFmt: (v) => v.toFixed(0) });
}
export function drawdownChart(a, { height = 150 } = {}){ return lineChart({ dates: a.drawdown.map((d) => d[0]), series: [{ name: 'ירידה מהשיא', values: a.drawdown.map((d) => d[1] * 100), color: '#e5484d', area: true, width: 1.2 }], height, yFmt: (v) => v.toFixed(0) + '%' }); }
export function histogramChart(h, { height = 160 } = {}){ return barChart({ labels: h.map((b) => `${(b.from * 100).toFixed(1)}%`), values: h.map((b) => b.count), height, colors: h.map((b) => ((b.from + b.to) / 2 >= 0 ? '#2fbf71' : '#e5484d')), yFmt: (v) => String(Math.round(v)) }); }

export function explainBlock(spec){
  try { const { sections } = explainSpec(spec); return `<div class="explain">${sections.map((s) => `<h4>${esc(s.title)}</h4>${s.lines.map((l) => esc(l)).join('\n')}`).join('\n')}</div>`; }
  catch (e) { return `<div class="blocked">הגדרה לא תקינה: ${esc(e.message)}</div>`; }
}
export function coverageBox(res, a){
  const c = res.coverage || a?.coverage; if (!c) return '';
  const g = res.gaps;
  const miss = c.missing?.length ? `<details><summary>${c.missing.length} ניירות ללא נתונים</summary><div class="muted" style="direction:ltr;text-align:left;word-break:break-all">${esc(c.missing.join(', '))}</div></details>` : '';
  return `<div class="${res.limited ? 'limited' : 'card tight'}"><b>${res.limited ? '⚠ תוצאה מוגבלת' : 'כיסוי נתונים'}</b> — ${esc(c.note || '')}${isNum(c.ratio) && c.total ? ` · כיסוי ${P0(c.ratio)} (${c.withData}/${c.total})` : ''}${g ? ` · פערים בנרות ${P0(g.ratio, 2)}` : ''}${miss}</div>`;
}
export function assumptionsBox(res){ return `<details class="card tight"><summary>הנחות ביצוע, מקור הנתונים ומגבלות (${res.assumptions.length})</summary><ul class="warnlist">${res.assumptions.map((x) => `<li>${esc(x)}</li>`).join('')}<li>פקודות שלא בוצעו: ${esc(Object.entries(res.skipped || {}).map(([k, v]) => `${SKIP_HE[k] || k}: ${v}`).join(' · ') || 'אין')}</li></ul></details>`; }
export const SKIP_HE = { no_bar: 'אין נר ביום הביצוע', small: 'סכום קטן ממניה אחת', leverage: 'חריגה ממינוף', cash: 'אין מזומן', max_positions: 'תיק מלא', max_trades: 'מגבלת עסקאות יומית', period_filter: 'יום מחוץ למסנן', regime: 'מצב שוק לא מתאים', limit_not_filled: 'Limit לא התמלא', stop_not_triggered: 'Stop-entry לא הופעל', already_held: 'כבר מוחזקת', expired: 'פקעה' };

export function tradesTable(trades, { onRow = null, limit = 500 } = {}){
  const rows = trades.slice().reverse().slice(0, limit);
  const wrap = el(`<div class="table-wrap compact"><table><thead><tr><th>#</th><th>נייר</th><th>כיוון</th><th>אות</th><th>כניסה</th><th class="num">מחיר</th><th>יציאה</th><th class="num">מחיר</th><th class="num">כמות</th><th class="num">ימים</th><th class="num">P&L</th><th class="num">%</th><th class="num">עלויות</th><th>סיבת כניסה</th><th>סיבת יציאה</th></tr></thead><tbody>${rows.map((t) => `<tr class="${onRow ? 'clickable' : ''}" data-id="${t.id}"><td>${t.id}</td><td><b>${esc(t.symbol)}</b>${t.sector ? ` <span class="muted">${esc(t.sector)}</span>` : ''}</td><td>${t.side === 'short' ? 'שורט' : 'לונג'}</td><td>${t.signalDate}</td><td>${t.entryDate} <span class="muted">${t.entryAt === 'open' ? 'פתיחה' : 'סגירה'}</span></td><td class="num">${t.entryPrice}</td><td>${t.exitDate}</td><td class="num">${t.exitPrice}</td><td class="num">${t.shares}</td><td class="num">${t.holdDays}</td><td class="num ${cls(t.pnl)}">${$$$(t.pnl)}</td><td class="num ${cls(t.pnlPct)}">${P(t.pnlPct, 2)}</td><td class="num">${N(t.costs?.total)}</td><td class="muted">${esc(t.entryReason || '')}</td><td class="muted">${esc(t.exitReason || '')}</td></tr>`).join('')}</tbody></table></div>`);
  if (onRow) wrap.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) onRow(trades.find((t) => t.id === +tr.dataset.id)); });
  if (trades.length > limit) wrap.appendChild(el(`<div class="muted">מוצגות ${limit} האחרונות מתוך ${trades.length} — הייצוא כולל הכול</div>`));
  return wrap;
}
// ייצוא
export function download(name, content, type = 'text/plain;charset=utf-8'){ const blob = content instanceof Blob ? content : new Blob([content], { type }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
export function toCsv(rows, cols){ const q = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }; return '﻿' + [cols.map((c) => q(c.label)).join(','), ...rows.map((r) => cols.map((c) => q(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(','))].join('\r\n'); }
export const TRADE_COLS = [{ key: 'id', label: 'מספר' }, { key: 'symbol', label: 'נייר' }, { key: 'side', label: 'כיוון' }, { key: 'sector', label: 'סקטור' }, { key: 'signalDate', label: 'תאריך אות' }, { key: 'entryDate', label: 'כניסה' }, { key: 'entryAt', label: 'מועד כניסה' }, { key: 'entryPrice', label: 'מחיר כניסה' }, { key: 'exitDate', label: 'יציאה' }, { key: 'exitPrice', label: 'מחיר יציאה' }, { key: 'shares', label: 'כמות' }, { key: 'holdDays', label: 'ימי החזקה' }, { key: 'pnl', label: 'רווח/הפסד $' }, { key: 'pnlPct', label: 'רווח/הפסד %' }, { label: 'עמלות', get: (t) => t.costs?.commission }, { label: 'עמלות רגולטור', get: (t) => t.costs?.fees }, { label: 'החלקה', get: (t) => t.costs?.slippage }, { label: 'השאלה', get: (t) => t.costs?.borrow }, { key: 'dividends', label: 'דיבידנדים' }, { key: 'mfe', label: 'MFE' }, { key: 'mae', label: 'MAE' }, { key: 'participation', label: 'חלק מהמחזור' }, { key: 'entryReason', label: 'סיבת כניסה' }, { key: 'exitReason', label: 'סיבת יציאה' }];
export function exportButtons(getRun, name = 'strategy'){
  const box = el('<div class="row"></div>');
  const b = (label, fn) => { const x = el(`<button class="btn sm">${label}</button>`); x.onclick = () => { try { fn(getRun()); } catch (e) { alert(e.message); } }; box.appendChild(x); };
  b('CSV עסקאות', (r) => download(`${name}-trades.csv`, toCsv(r.result.trades, TRADE_COLS), 'text/csv;charset=utf-8'));
  b('CSV הון יומי', (r) => download(`${name}-equity.csv`, toCsv(r.result.equity.map((e) => ({ date: e[0], equity: e[1], cash: e[2], exposure: e[3], positions: e[4] })), [{ key: 'date', label: 'תאריך' }, { key: 'equity', label: 'הון' }, { key: 'cash', label: 'מזומן' }, { key: 'exposure', label: 'חשיפה' }, { key: 'positions', label: 'פוזיציות' }]), 'text/csv;charset=utf-8'));
  b('Excel (CSV מלא)', (r) => { const rows = [...TRADE_COLS.map((c) => c.label)].join('\t'); download(`${name}.xls`, '﻿' + [rows, ...r.result.trades.map((t) => TRADE_COLS.map((c) => (typeof c.get === 'function' ? c.get(t) : t[c.key]) ?? '').join('\t'))].join('\r\n'), 'application/vnd.ms-excel;charset=utf-8'); });
  b('JSON מלא', (r) => download(`${name}.json`, JSON.stringify(r), 'application/json'));
  b('PDF (הדפסה)', () => window.print());
  return box;
}
export const limitedTag = (r) => (r?.limited ? '<span class="tag opinion" title="כיסוי חלקי / הנחה אופטימית — ראה כיסוי והנחות">מוגבל</span>' : '');
export const warn = (t) => `<div class="limited">⚠ ${esc(t)}</div>`;
export const err = (e) => `<div class="blocked">שגיאה: ${esc(e?.message || e)}</div>`;
