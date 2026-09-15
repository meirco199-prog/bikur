// חיפוש וסינון universe + Market Screening חיצוני (FMP).
import { api } from '../core/api.js';
import { esc, fmt, table, toast } from '../core/util.js';
import { sigBadge, scoreBar, pctCell, loading, errorBox, symLink } from '../ui/components.js';

export async function render(main){
  main.innerHTML = `<div class="page-head"><h1>סריקת נכסים</h1><span class="muted">universe + סינון; FMP screener להרחבה</span></div>
  <div class="card tight toolbar" id="filters">
    <input id="q" placeholder="סימבול / שם" style="width:160px">
    <select id="type"><option value="">כל הסוגים</option><option value="stock">מניות</option><option value="etf">ETF</option></select>
    <select id="assetClass"><option value="">כל הנכסים</option><option value="equity">מניות</option><option value="bond">אג"ח</option><option value="gold">זהב</option></select>
    <select id="country"><option value="">כל המדינות</option><option value="US">ארה"ב</option><option value="IL">ישראל</option><option value="Intl">בינלאומי</option><option value="EM">מתפתחים</option></select>
    <select id="sector"><option value="">כל הענפים</option>${['Technology', 'Healthcare', 'Financial Services', 'Consumer Cyclical', 'Consumer Defensive', 'Industrials', 'Energy', 'Utilities', 'Communication Services', 'Basic Materials'].map((s) => `<option>${s}</option>`).join('')}</select>
    <select id="risk"><option value="">כל רמות הסיכון</option><option value="נמוך">סיכון נמוך</option><option value="בינוני">בינוני</option><option value="גבוה">גבוה</option></select>
    <select id="signal"><option value="">כל הסיגנלים</option><option>STRONG BUY</option><option>BUY</option><option>WATCH</option><option>HOLD</option><option>REDUCE</option><option>SELL</option></select>
    <label class="muted">ציון ≥ <input id="minScore" type="number" min="0" max="100" style="width:64px"></label>
    <label class="muted">תנודתיות ≤ <input id="maxVol" type="number" step="5" placeholder="%" style="width:64px"></label>
    <label class="muted">תשואה שנתית ≥ <input id="minRet" type="number" step="5" placeholder="%" style="width:64px"></label>
    <button class="btn primary" id="go">סנן</button>
    <button class="btn" id="ext" title="דורש FMP_KEY ב-Worker">🌐 Screener חיצוני (FMP)</button>
  </div>
  <div id="out">${loading()}</div>`;
  const out = main.querySelector('#out');
  const run = async () => {
    out.innerHTML = loading();
    const f = {}; for (const id of ['q', 'type', 'assetClass', 'country', 'sector', 'risk']) { const v = main.querySelector('#' + id).value; if (v) f[id] = v; }
    const maxVol = +main.querySelector('#maxVol').value, minRet = +main.querySelector('#minRet').value; if (maxVol) f.maxVol = maxVol / 100; if (minRet) f.minReturn1y = minRet / 100;
    try {
      const r = await api('/universe?' + new URLSearchParams(f), { ttl: 30000 });
      const sig = main.querySelector('#signal').value, minScore = +main.querySelector('#minScore').value;
      let items = r.items.filter((a) => (!sig || a.signal === sig) && (!minScore || (a.score ?? -1) >= minScore));
      out.innerHTML = `<div class="muted" style="margin-bottom:.4rem">${items.length} נכסים · נתוני דירוג מ-${esc(r.date || '—')}</div>`;
      out.appendChild(table([
        { key: 'symbol', label: 'נכס', render: (a) => symLink(a.symbol, a.name) }, { key: 'type', label: 'סוג' }, { key: 'sector', label: 'ענף' }, { key: 'country', label: 'מדינה' },
        { key: 'price', label: 'מחיר', num: true, render: (a) => fmt.num(a.price) }, { key: 'dailyChange', label: 'יומי', num: true, render: (a) => pctCell(a.dailyChange) },
        { key: 'score', label: 'ציון', num: true, render: (a) => scoreBar(a.score) }, { key: 'signal', label: 'סיגנל', render: (a) => sigBadge(a.signal) },
        { key: 'momentum12m', label: '12 חודשים', num: true, render: (a) => pctCell(a.momentum12m, 0) }, { key: 'vol1y', label: 'תנודתיות', num: true, render: (a) => fmt.pct(a.vol1y, 0) }, { key: 'pe', label: 'P/E', num: true, render: (a) => fmt.num(a.pe, 1) }, { key: 'analystUpside', label: 'Upside אנליסטים', num: true, render: (a) => pctCell(a.analystUpside, 0) },
      ], items, { sortKey: 'score', onRow: (a) => { location.hash = '#/asset/' + a.symbol; } }));
    } catch (e) { out.innerHTML = errorBox(e); }
  };
  main.querySelector('#go').onclick = run; main.querySelector('#q').addEventListener('keydown', (e) => e.key === 'Enter' && run());
  main.querySelector('#ext').onclick = async () => {
    out.innerHTML = loading('מריץ screener חיצוני…');
    try {
      const f = { minMarketCap: 2e9, limit: 50 }; const sector = main.querySelector('#sector').value; if (sector) f.sector = sector; const country = main.querySelector('#country').value; if (country && country !== 'Intl') f.country = country;
      const r = await api('/screen?' + new URLSearchParams({ ...f, add: '1' }), { auth: true });
      if (r.missing){ out.innerHTML = `<div class="empty">${esc(r.reason)}<br><span class="muted">${esc(r.note || '')}</span></div>`; return; }
      toast(`נוספו ${r.added || 0} נכסים ל-universe; ינותחו בעיבוד הבא`);
      out.innerHTML = ''; out.appendChild(table([{ key: 'symbol', label: 'נכס', render: (a) => symLink(a.symbol, a.name) }, { key: 'sector', label: 'ענף' }, { key: 'marketCap', label: 'שווי שוק', num: true, render: (a) => fmt.big(a.marketCap) }, { key: 'price', label: 'מחיר', num: true }, { key: 'beta', label: 'בטא', num: true }, { key: 'dividend', label: 'דיבידנד', num: true }], r.items, { onRow: (a) => { location.hash = '#/asset/' + a.symbol; } }));
    } catch (e) { out.innerHTML = errorBox(e); }
  };
  run();
}
