// BUY / SELL signals — כל הסיגנלים הפעילים עם רמות.
import { api } from '../core/api.js';
import { esc, fmt, table } from '../core/util.js';
import { sigBadge, scoreBar, pctCell, loading, errorBox, symLink, disclaimer, confBadge } from '../ui/components.js';

export async function render(main){
  main.innerHTML = loading();
  let rank, days;
  try { [rank, days] = await Promise.all([api('/rank', { ttl: 60000 }), api('/days', { ttl: 60000 })]); } catch (e) { main.innerHTML = errorBox(e); return; }
  if (rank.missing){ main.innerHTML = `<div class="empty">${esc(rank.reason)}</div>`; return; }
  const order = { 'STRONG BUY': 0, BUY: 1, WATCH: 2, HOLD: 3, REDUCE: 4, SELL: 5, 'NO SIGNAL': 6 };
  const rows = rank.table.slice().sort((a, b) => order[a.signal] - order[b.signal] || b.score - a.score);
  const cols = [
    { key: 'symbol', label: 'נכס', render: (s) => symLink(s.symbol, s.name, s.nameHe) }, { key: 'signal', label: 'סיגנל', render: (s) => sigBadge(s.signal), sortVal: (s) => -order[s.signal] }, { key: 'score', label: 'ציון', num: true, render: (s) => scoreBar(s.score) },
    { key: 'confidence', label: 'ביטחון', num: true, render: (s) => fmt.num(s.confidence, 2) }, { key: 'price', label: 'מחיר', num: true, render: (s) => fmt.num(s.price) }, { key: 'trend', label: 'מגמה' }, { key: 'rsi', label: 'RSI', num: true },
    { key: 'mos', label: 'MoS', num: true, render: (s) => pctCell(s.mos, 0) }, { key: 'analystUpside', label: 'אנליסטים', num: true, render: (s) => pctCell(s.analystUpside, 0) }, { key: 'nextEarnings', label: 'דוח הבא', render: (s) => fmt.date(s.nextEarnings) },
  ];
  main.innerHTML = `<div class="page-head"><div><h1>סיגנלים</h1><span class="muted">${esc(rank.date)} · ${days.length} ימי היסטוריה שמורים</span></div>
  <div class="row"><span class="tag fact">BUY: ${rank.categories.buySignals.length}</span><span class="tag missing">SELL/REDUCE: ${rank.categories.sellSignals.length}</span></div></div>
  <div class="tabs" id="tabs"><button class="active" data-f="buy">קנייה</button><button data-f="sell">מכירה/הקטנה</button><button data-f="watch">מעקב</button><button data-f="all">הכול</button></div><div id="t"></div>${disclaimer()}`;
  const t = main.querySelector('#t');
  const show = (f) => { const sel = f === 'buy' ? rows.filter((r) => ['STRONG BUY', 'BUY'].includes(r.signal)) : f === 'sell' ? rows.filter((r) => ['SELL', 'REDUCE'].includes(r.signal)) : f === 'watch' ? rows.filter((r) => r.signal === 'WATCH') : rows; t.innerHTML = ''; t.appendChild(table(cols, sel, { onRow: (s) => { location.hash = '#/asset/' + s.symbol; } })); };
  main.querySelector('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; main.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b)); show(b.dataset.f); });
  show('buy');
}
