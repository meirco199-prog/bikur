// ניתוח עסקאות (דרישה 7): סינון וחיפוש בכל העסקאות של הריצה האחרונה, פתיחת עסקה עם גרף מחיר היסטורי סביבה ורמות הכניסה/יציאה.
import { esc, el, modal, cls } from '../../../js/core/util.js';
import { lineChart } from '../../../js/ui/chart.js';
import { state } from '../app.js';
import { call } from '../engine.js';
import { tradesTable, groupTable, P, N, $$$, exportButtons, err } from '../ui.js';
import { groupTrades } from '../../../../invest-api/engine/lab/metrics.js';

export async function render(main){
  const run = state.lastRun;
  main.innerHTML = `<div class="page-head"><div><h1>ניתוח עסקאות</h1><span class="muted">כל עסקה: מועד, מחיר, כמות, עמלות, סיבת כניסה ויציאה, רווח/הפסד, MFE/MAE. לחיצה פותחת גרף היסטורי.</span></div><div id="top" class="row"></div></div><div id="body"></div>`;
  const body = main.querySelector('#body');
  if (!run){ body.innerHTML = '<div class="empty">אין ריצה בסשן הזה. הרץ Backtest קודם.</div>'; return; }
  const trades = run.result.trades;
  main.querySelector('#top').appendChild(exportButtons(() => run, 'trades'));
  body.innerHTML = `<section class="card tight toolbar"><input id="q" placeholder="סינון: סימבול / סיבה" style="width:200px"><select id="side"><option value="">כל הכיוונים</option><option value="long">לונג</option><option value="short">שורט</option></select><select id="res"><option value="">הכול</option><option value="win">רווחיות</option><option value="loss">מפסידות</option></select><select id="exit"><option value="">כל סיבות היציאה</option>${[...new Set(trades.map((t) => t.exitReason))].map((r) => `<option>${esc(r)}</option>`).join('')}</select><label class="muted">מ- <input id="from" type="date"></label><label class="muted">עד <input id="to" type="date"></label><span class="muted" id="count"></span></section>
    <div class="grid g2" style="margin-top:.8rem"><section class="card"><h3>לפי נייר (הטובים/הגרועים)</h3><div id="bysym"></div></section><section class="card"><h3>סיכום הסינון</h3><div id="sum"></div></section></div>
    <section class="card" style="margin-top:.8rem"><div id="tbl"></div></section>`;
  const apply = () => {
    const q = body.querySelector('#q').value.trim().toUpperCase(), side = body.querySelector('#side').value, rs = body.querySelector('#res').value, ex = body.querySelector('#exit').value, from = body.querySelector('#from').value, to = body.querySelector('#to').value;
    const f = trades.filter((t) => (!q || t.symbol.includes(q) || (t.exitReason || '').toUpperCase().includes(q) || (t.entryReason || '').toUpperCase().includes(q)) && (!side || t.side === side) && (!rs || (rs === 'win' ? t.pnl > 0 : t.pnl <= 0)) && (!ex || t.exitReason === ex) && (!from || t.entryDate >= from) && (!to || t.entryDate <= to));
    body.querySelector('#count').textContent = `${f.length} מתוך ${trades.length}`;
    const tb = body.querySelector('#tbl'); tb.innerHTML = ''; tb.appendChild(tradesTable(f, { onRow: (t) => openTradeModal(t, run.spec), limit: 1000 }));
    const bs = groupTrades(f, (t) => t.symbol).sort((a, b) => b.pnl - a.pnl); body.querySelector('#bysym').innerHTML = groupTable([...bs.slice(0, 8), ...(bs.length > 16 ? bs.slice(-8) : bs.slice(8))], 'נייר');
    const pnl = f.reduce((s, t) => s + t.pnl, 0), wins = f.filter((t) => t.pnl > 0).length;
    body.querySelector('#sum').innerHTML = `<div class="kpis"><div class="kpi"><span class="v ${cls(pnl)}">${$$$(pnl)}</span><span class="l">P&L מצטבר</span></div><div class="kpi"><span class="v">${f.length ? (wins / f.length * 100).toFixed(1) + '%' : '—'}</span><span class="l">רווחיות</span></div><div class="kpi"><span class="v">${f.length ? P(f.reduce((s, t) => s + t.pnlPct, 0) / f.length, 2) : '—'}</span><span class="l">ממוצע לעסקה</span></div><div class="kpi"><span class="v">${$$$(f.reduce((s, t) => s + (t.costs?.total || 0), 0))}</span><span class="l">עלויות</span></div></div>`;
  };
  body.querySelectorAll('input,select').forEach((x) => { x.oninput = apply; });
  apply();
}
// חלון עסקה: פרטים מלאים + גרף מחיר 60 יום לפני ו-20 אחרי עם רמות כניסה/יציאה (נתונים מה-Worker)
export async function openTradeModal(t, spec){
  const m = modal(`<h3>${esc(t.symbol)} · ${t.side === 'short' ? 'שורט' : 'לונג'} · ${t.entryDate} → ${t.exitDate} <span class="num ${cls(t.pnl)}">${$$$(t.pnl)} (${P(t.pnlPct, 2)})</span></h3>
    <div class="trade-detail"><div class="levels"><span>אות: <b>${t.signalDate}</b></span><span>כניסה: <b class="num">${t.entryPrice}</b> (${t.entryAt === 'open' ? 'פתיחה' : 'סגירה'})</span><span>יציאה: <b class="num">${t.exitPrice}</b></span><span>כמות: <b class="num">${t.shares}</b></span><span>ימי החזקה: <b>${t.holdDays}</b></span><span>MFE/MAE: <b class="num">${P(t.mfe, 2)} / ${P(t.mae, 2)}</b></span></div>
    <div class="muted" style="margin:.3rem 0">סיבת כניסה: ${esc(t.entryReason || '')} · סיבת יציאה: ${esc(t.exitReason || '')}${t.sector ? ` · סקטור ${esc(t.sector)}` : ''}${t.participation ? ` · ${(t.participation * 100).toFixed(3)}% מהמחזור היומי` : ''}</div>
    <div class="muted">עלויות: עמלות ${N(t.costs?.commission)}$ · רגולטור ${N(t.costs?.fees)}$ · החלקה ${N(t.costs?.slippage)}$ · השאלה ${N(t.costs?.borrow)}$ · דיבידנדים ${N(t.dividends)}$</div>
    <div id="tchart" style="margin-top:.6rem"><div class="empty"><span class="spin"></span> טוען גרף…</div></div></div><div class="row" style="margin-top:.6rem"><button class="btn" data-close>סגור</button></div>`);
  try {
    const from = shift(t.entryDate, -90), to = shift(t.exitDate, 30);
    const s = await call('series', { symbol: t.symbol, from, to });
    const box = m.el.querySelector('#tchart'); box.innerHTML = '';
    if (!s || !s.dates.length){ box.innerHTML = '<div class="muted">אין נתוני מחיר לתקופה</div>'; return; }
    const iE = s.dates.indexOf(t.entryDate), iX = s.dates.indexOf(t.exitDate);
    const hl = [{ y: t.entryPrice, label: `כניסה ${t.entryPrice}`, color: '#4f8cff' }, { y: t.exitPrice, label: `יציאה ${t.exitPrice}`, color: t.pnl >= 0 ? '#2fbf71' : '#e5484d' }];
    const sl = spec?.exit?.rules?.find((r) => r.type === 'stop_loss'), tp = spec?.exit?.rules?.find((r) => r.type === 'take_profit'), dir = t.side === 'short' ? -1 : 1;
    if (sl) hl.push({ y: t.entryPrice * (1 - sl.pct * dir), label: 'סטופ', color: '#f5a524' }); if (tp) hl.push({ y: t.entryPrice * (1 + tp.pct * dir), label: 'יעד', color: '#a78bfa' });
    box.appendChild(lineChart({ dates: s.dates, series: [{ name: 'סגירה', values: s.c, color: '#94a3b8', width: 1.4 }, { name: 'High', values: s.h, color: '#2fbf71', width: .6, dashed: true }, { name: 'Low', values: s.l, color: '#e5484d', width: .6, dashed: true }], hlines: hl, markers: [iE >= 0 && { i: iE, label: '▲ כניסה', color: '#4f8cff' }, iX >= 0 && { i: iX, label: '▼ יציאה', color: t.pnl >= 0 ? '#2fbf71' : '#e5484d' }].filter(Boolean), height: 280 }));
  } catch (e) { m.el.querySelector('#tchart').innerHTML = err(e); }
}
const shift = (iso, days) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
