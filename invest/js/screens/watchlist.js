// רשימת מעקב עם מיון לפי Opportunity Score.
import { api, invalidate } from '../core/api.js';
import { esc, fmt, table, toast } from '../core/util.js';
import { sigBadge, scoreBar, pctCell, loading, errorBox, symLink, asOf } from '../ui/components.js';

export async function render(main){
  main.innerHTML = loading();
  let w;
  try { w = await api('/watchlist'); } catch (e) { main.innerHTML = errorBox(e); return; }
  const rows = w.items.map((x) => ({ ...(x.snapshot || {}), symbol: x.symbol, note: x.note, addedAt: x.addedAt, hasSnap: !!x.snapshot, opp: x.snapshot ? (x.snapshot.score || 0) + (x.snapshot.mos > 0 ? 5 : 0) + (['STRONG BUY', 'BUY'].includes(x.snapshot.signal) ? 10 : 0) : -1 }));
  main.innerHTML = `<div class="page-head"><div><h1>רשימת מעקב</h1><span class="muted">${rows.length} נכסים · נתונים מ-${esc(w.date || '—')}</span></div>
  <div class="row"><input id="add" placeholder="סימבול להוספה" style="width:140px"><button class="btn primary" id="addBtn">＋ הוסף</button></div></div><div id="t"></div>`;
  const cols = [
    { key: 'symbol', label: 'נכס', render: (s) => symLink(s.symbol, s.name, s.nameHe) + (s.note ? `<div class="muted" style="font-size:.75rem">${esc(s.note)}</div>` : '') },
    { key: 'price', label: 'מחיר', num: true, render: (s) => fmt.num(s.price) }, { key: 'dailyChange', label: 'יומי', num: true, render: (s) => pctCell(s.dailyChange) },
    { key: 'opp', label: 'Opportunity', num: true, render: (s) => scoreBar(s.score) }, { key: 'signal', label: 'סיגנל', render: (s) => sigBadge(s.signal) }, { key: 'trend', label: 'מגמה' }, { key: 'rsi', label: 'RSI', num: true },
    { key: 'analystUpside', label: 'Upside אנליסטים', num: true, render: (s) => pctCell(s.analystUpside, 0) }, { key: 'mos', label: 'הערכת שווי (MoS)', num: true, render: (s) => pctCell(s.mos, 0) }, { key: 'riskLevel', label: 'סיכון', render: (s) => esc(s.riskLevel || '—') },
    { key: 'lastNews', label: 'חדשות אחרונות', render: (s) => (s.lastNews ? `<a href="${esc(s.lastNews.url)}" target="_blank" rel="noopener" title="${esc(s.lastNews.title)}">${esc(String(s.lastNews.title).slice(0, 40))}…</a> <span class="muted">${fmt.date(s.lastNews.publishedAt)}</span>` : '—') },
    { key: 'nextEarnings', label: 'דוח הבא', render: (s) => fmt.date(s.nextEarnings) }, { key: 'date', label: 'עודכן', render: (s) => (s.hasSnap ? asOf(s.date, { source: s.dataAsOf?.prices?.source, stale: s.dataAsOf?.prices?.stale }) : '<span class="tag stale">טרם נותח</span>') },
    { key: 'x', label: '', render: (s) => `<button class="btn sm ghost" data-del="${esc(s.symbol)}">✕</button>` },
  ];
  const t = main.querySelector('#t'); t.appendChild(table(cols, rows, { sortKey: 'opp', onRow: (s) => { location.hash = '#/asset/' + s.symbol; } }));
  t.addEventListener('click', async (e) => { const b = e.target.closest('[data-del]'); if (!b) return; e.stopPropagation(); try { await api('/watchlist?symbol=' + b.dataset.del, { method: 'DELETE' }); invalidate('/watchlist'); toast('הוסר'); render(main); } catch (err) { toast(err.message, 'err'); } });
  main.querySelector('#addBtn').onclick = async () => { const s = main.querySelector('#add').value.trim().toUpperCase(); if (!s) return; try { await api('/watchlist', { method: 'POST', body: { symbol: s } }); invalidate('/watchlist'); toast(`${s} נוסף`); render(main); } catch (err) { toast(err.message, 'err'); } };
}
