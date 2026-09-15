// Historical "As Of": מה המערכת הייתה יודעת בתאריך X — סיגנלים, דירוג, תיק — והשוואה למה שקרה בפועל.
import { api, getBundle } from '../core/api.js';
import { run } from '../core/compute.js';
import { settings } from '../core/store.js';
import { esc, fmt, isNum, cls, toast } from '../core/util.js';
import { sigBadge, scoreBar, kind, loading, errorBox, disclaimer, symLink, pctCell } from '../ui/components.js';

export async function render(main, params = {}){
  main.innerHTML = `<div class="page-head"><div><h1>As-Of — מסע בזמן</h1><span class="muted">חישוב מחדש מנתונים שהיו ידועים בתאריך בלבד: מחירים ≤ תאריך, דוחות לפי תאריך הגשה ל-SEC, חדשות לפי פרסום. קונצנזוס אנליסטים אינו זמין נקודתית → מסומן חסר.</span></div></div>
  <div class="card tight toolbar"><label>תאריך <input id="date" type="date" value="${esc(params.date || '2024-01-02')}"></label><select id="scope"><option value="watch">רשימת מעקב + ליבה</option><option value="core">ליבה (ETF) בלבד</option><option value="all">כל ה-universe (איטי)</option></select><input id="sym" placeholder="או נכס בודד" value="${esc(params.symbol || '')}" style="width:120px"><button class="btn primary" id="go">חשב</button><span id="prog" class="muted"></span></div>
  <div id="out"><div class="empty">בחר תאריך והרץ</div></div>${disclaimer('הדמיה היסטורית. תשואות "בפועל" מחושבות ממחירי סגירה בלבד. אם קיים snapshot אמיתי מאותו יום — הוא מוצג לצד החישוב כהוכחה שהמודל לא שונה בדיעבד.')}`;
  const out = main.querySelector('#out'), prog = main.querySelector('#prog');
  const go = async () => {
    const date = main.querySelector('#date').value; if (!date) return;
    const single = main.querySelector('#sym').value.trim().toUpperCase();
    out.innerHTML = loading('טוען נתונים היסטוריים…');
    try {
      if (single){ const r = await api(`/asof/${single}?date=${date}`); out.innerHTML = singleView(r, single, date); return; }
      const scope = main.querySelector('#scope').value;
      const [u, w, regime, macro] = await Promise.all([api('/universe', { ttl: 60000 }), api('/watchlist', { ttl: 60000 }), api(`/regime?date=${date}`), api('/macro', { ttl: 600000 })]);
      let syms = u.items.filter((a) => a.role === 'core' || a.assetClass === 'bond' || a.assetClass === 'gold').map((a) => a.symbol);
      if (scope === 'watch') syms = [...new Set([...syms, ...w.items.map((x) => x.symbol)])];
      if (scope === 'all') syms = u.items.map((a) => a.symbol);
      const bundles = [];
      for (let i = 0; i < syms.length; i++){ prog.textContent = `טוען ${i + 1}/${syms.length}`; try { const b = await getBundle(syms[i]); if (b.prices && !b.prices.missing) bundles.push({ ...b, asset: { ...(u.items.find((a) => a.symbol === syms[i]) || {}), ...b.asset } }); } catch {} }
      const spy = bundles.find((b) => b.asset.symbol === 'SPY')?.prices?.rows || null;
      const fxRows = macro?.USDILS?.rows || [];
      const usdils = fxRows.filter((r) => r[0] <= date).slice(-1)[0]?.[1] || null;
      const res = await run('asof', { bundles, date, regime, benchRows: spy, dgs10Rows: macro?.DGS10?.rows, weights: null, sizeIls: settings.get().portfolioSize, usdils }, (p) => { prog.textContent = `מחשב ${Math.round(p * 100)}%`; });
      prog.textContent = '';
      const days = await api('/days', { ttl: 60000 }); const stored = days.includes(date) ? await api(`/rank?date=${date}`).catch(() => null) : null;
      const by = new Map(res.analyses.map((a) => [a.symbol, a]));
      const H = ['m1', 'm3', 'm6', 'm12'], HL = { m1: '1M', m3: '3M', m6: '6M', m12: '12M' };
      const fw = (a, h) => a?.forward?.[h]?.ret;
      const avg = (syms, h) => { const v = syms.map((s) => fw(by.get(s), h)).filter(isNum); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null; };
      out.innerHTML = `<div class="grid g4" style="margin-bottom:1rem"><div class="card"><div class="kpi"><span class="v" style="font-size:1rem">${esc(regime.summary || '')}</span><span class="l">משטר השוק ב-${esc(date)}</span></div></div><div class="card"><div class="kpi"><span class="v">${res.rank.analyzed}</span><span class="l">נכסים נותחו · ${res.rank.categories.buySignals.length} BUY · ${res.rank.categories.sellSignals.length} SELL</span></div></div><div class="card"><div class="kpi"><span class="v ${cls(res.benchForward?.m12?.ret)}">${fmt.pct(res.benchForward?.m12?.ret, 1, true)}</span><span class="l">SPY בפועל 12 חודשים אחרי</span></div></div><div class="card"><div class="kpi"><span class="v">${stored ? '<span class="tag fact">יש snapshot אמיתי</span>' : '<span class="tag">חישוב מחדש</span>'}</span><span class="l">${stored ? 'נשמר בפועל באותו יום — להשוואה למטה' : 'לא היה snapshot שמור לתאריך זה'}</span></div></div></div>
      <section class="card"><h3>ממוצע תשואה בפועל לפי קבוצת סיגנל ${kind('FACT')}</h3><table><thead><tr><th>קבוצה</th><th class="num">N</th>${H.map((h) => `<th class="num">${HL[h]}</th>`).join('')}</tr></thead><tbody>${[['BUY signals', res.rank.categories.buySignals], ['Best Overall', res.rank.categories.bestOverall], ['SELL/REDUCE', res.rank.categories.sellSignals], ['AVOID', res.rank.categories.avoid], ['הכול', res.rank.table.map((t) => t.symbol)]].map(([l, syms]) => `<tr><td>${esc(l)}</td><td class="num">${syms.length}</td>${H.map((h) => `<td class="num ${cls(avg(syms, h))}">${fmt.pct(avg(syms, h), 1, true)}</td>`).join('')}</tr>`).join('')}<tr><td><b>SPY (benchmark)</b></td><td class="num">1</td>${H.map((h) => `<td class="num ${cls(res.benchForward?.[h]?.ret)}">${fmt.pct(res.benchForward?.[h]?.ret, 1, true)}</td>`).join('')}</tr></tbody></table></section>
      <section class="card" style="margin-top:1rem"><h3>תיקים מומלצים באותו יום → תשואה בפועל</h3><table><thead><tr><th>פרופיל</th><th>נכסים</th>${H.map((h) => `<th class="num">${HL[h]}</th>`).join('')}</tr></thead><tbody>${Object.values(res.reco.profiles).map((p) => `<tr><td><b>${esc(p.label)}</b></td><td style="white-space:normal">${p.positions.map((x) => `${esc(x.symbol)} ${Math.round(x.weight * 100)}%`).join(' · ')}</td>${H.map((h) => `<td class="num ${cls(p.forward?.[h]?.ret)}">${p.forward?.[h] ? fmt.pct(p.forward[h].ret, 1, true) + (p.forward[h].coverage < 0.95 ? `<small class="muted"> (${Math.round(p.forward[h].coverage * 100)}%)</small>` : '') : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table><p class="muted">תשואת תיק = סכום משוקלל של תשואות הנכסים (ללא איזון מחדש, מזומן = 0). כיסוי < 100% = לחלק מהנכסים אין מחיר עתידי.</p></section>
      <section class="card" style="margin-top:1rem"><h3>דירוג מלא ב-${esc(date)} ${stored ? '<span class="muted">· עמודה "נשמר" = מה שנשמר בפועל באותו יום</span>' : ''}</h3><div class="table-wrap"><table><thead><tr><th>נכס</th><th class="num">ציון</th><th>סיגנל</th>${stored ? '<th>נשמר</th>' : ''}<th class="num">מחיר</th>${H.map((h) => `<th class="num">${HL[h]}</th>`).join('')}<th>נתונים חסרים</th></tr></thead><tbody>${res.rank.table.slice().sort((a, b) => b.score - a.score).map((t) => { const a = by.get(t.symbol); const st = stored?.table?.find((x) => x.symbol === t.symbol); return `<tr><td>${symLink(t.symbol, t.name)}</td><td class="num">${scoreBar(t.score)}</td><td>${sigBadge(t.signal)}</td>${stored ? `<td>${st ? `${st.score} ${sigBadge(st.signal)}` : '—'}</td>` : ''}<td class="num">${fmt.num(t.price)}</td>${H.map((h) => `<td class="num ${cls(fw(a, h))}">${fmt.pct(fw(a, h), 1, true)}</td>`).join('')}<td class="muted" style="white-space:normal;font-size:.75rem">${esc((res.snaps.find((s) => s.symbol === t.symbol)?.missingComponents || []).map((m) => m.label).join(', '))}</td></tr>`; }).join('')}</tbody></table></div></section>`;
    } catch (e) { prog.textContent = ''; out.innerHTML = errorBox(e); }
  };
  main.querySelector('#go').onclick = go;
  if (params.symbol || params.date) go();
}
function singleView(r, s, date){
  if (r.missing) return `<div class="empty">${esc(r.reason)}</div>`;
  const f = r.forward || {};
  return `<div class="grid g2"><section class="card"><h3>${esc(s)} נכון ל-${esc(date)}</h3><div class="grid g2">${['score', 'signal'].map(() => '').join('')}<div class="kpi"><span class="v">${scoreBar(r.score.total)}</span><span class="l">ציון (כיסוי ${fmt.pct(r.score.coverage, 0)})</span></div><div class="kpi"><span class="v">${sigBadge(r.signal.label)}</span><span class="l">סיגנל · ${esc(r.regimeAtDate?.summary || '')}</span></div><div class="kpi"><span class="v">${fmt.num(r.price)}</span><span class="l">מחיר סגירה ${esc(r.barDate)}</span></div><div class="kpi"><span class="v">${r.metrics && !r.metrics.missing ? esc(fmt.date(r.metrics.asOf)) : '—'}</span><span class="l">הדוח האחרון שהיה ידוע (לפי הגשה)</span></div></div>
  <h4 style="margin-top:.6rem">למה</h4><ul class="list">${(r.signal.why || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul><h4>חסר בתאריך זה</h4><ul class="list muted">${(r.score.missing || []).map((m) => `<li>${esc(m.label)}: ${esc(m.reason)}</li>`).join('') || '<li>—</li>'}</ul>${r.storedSnapshot ? `<p><span class="tag fact">snapshot אמיתי מאותו יום:</span> ציון ${r.storedSnapshot.score}, ${sigBadge(r.storedSnapshot.signal)}, מחיר ${fmt.num(r.storedSnapshot.price)} (גרסת משקלים ${esc(r.storedSnapshot.weightsVersion)})</p>` : ''}</section>
  <section class="card"><h3>מה קרה בפועל ${kind('FACT')}</h3><table><thead><tr><th>אופק</th><th>תאריך</th><th class="num">תשואה</th></tr></thead><tbody>${[['1 חודש', f.m1], ['3 חודשים', f.m3], ['6 חודשים', f.m6], ['12 חודשים', f.m12]].map(([l, x]) => `<tr><td>${l}</td><td class="num">${esc(x?.date || 'טרם הגיע')}</td><td class="num ${cls(x?.ret)}">${fmt.pct(x?.ret, 1, true)}</td></tr>`).join('')}</tbody></table><p class="muted">${esc(r.note)}</p><a href="#/asof?date=${esc(date)}" class="muted">הרץ על כל רשימת המעקב →</a></section></div>`;
}
