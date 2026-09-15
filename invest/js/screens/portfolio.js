// Portfolio Builder: 4 פרופילים ל-200,000 ₪, חשיפות, קורלציה, סיכון, תרחישים.
import { api, getBundle } from '../core/api.js';
import { run } from '../core/compute.js';
import { settings } from '../core/store.js';
import { esc, fmt, isNum, cls, toast } from '../core/util.js';
import { sigBadge, scoreBar, kind, loading, errorBox, symLink, disclaimer, kpi } from '../ui/components.js';
import { donut } from '../ui/chart.js';

const LBL = { equity: 'מניות', bond: 'אג"ח', gold: 'זהב', cash: 'מזומן' };
export async function render(main){
  main.innerHTML = loading('בונה תיקים…');
  let reco, st;
  try { [reco, st] = await Promise.all([api('/reco', { ttl: 60000 }), api('/settings', { ttl: 60000 })]); } catch (e) { main.innerHTML = errorBox(e); return; }
  if (reco.missing){ main.innerHTML = `<div class="empty">${esc(reco.reason)} — <a href="#/settings">הרץ עיבוד יומי</a></div>`; return; }
  const size = reco.sizeIls;
  main.innerHTML = `<div class="page-head"><div><h1>תיק ${fmt.ils(size)}</h1><span class="muted">${esc(reco.date)} · USD/ILS ${fmt.num(reco.usdils, 3)} (${esc(reco.fxSource || '—')}, ${esc(fmt.date(reco.fxAsOf))}) · ${kind('MODEL')}</span></div>
  <div class="row"><a class="btn" href="#/settings">שינוי גודל תיק / משקלים</a></div></div>
  <div class="tabs" id="tabs">${Object.values(reco.profiles).map((p, i) => `<button class="${i === 1 ? 'active' : ''}" data-p="${p.id}">${esc(p.label)}</button>`).join('')}</div><div id="p"></div>
  <p class="muted">${esc(reco.note)} שיטה: ${esc(Object.values(reco.profiles)[0].method)}</p>${disclaimer('הקצאה מודלית לפי אילוצים גלויים; לא ייעוץ השקעות. ביצועי עבר אינם ערובה.')}`;
  const box = main.querySelector('#p');
  const show = async (id) => {
    const p = reco.profiles[id]; const r = p.risk || {};
    const pos = p.positions;
    box.innerHTML = `<div class="grid g4" style="margin-bottom:1rem">${kpi('Expected Risk (תנודתיות שנתית)', fmt.pct(r.volatility, 1))}${kpi('Historical Drawdown (2 שנים)', fmt.pct(r.maxDrawdown, 1), 'neg')}${kpi('בטא מול S&P', fmt.num(r.beta))}${kpi('קורלציה ממוצעת / N אפקטיבי', `${fmt.num(r.avgCorrelation)} / ${fmt.num(r.effectiveN, 1)}`)}</div>
    <div class="grid g-2-1"><section class="card"><h3>הקצאה</h3><table><thead><tr><th>נכס</th><th>סוג</th><th>ענף</th><th class="num">%</th><th class="num">₪</th><th>מטבע</th><th>ציון</th><th>סיגנל</th><th class="num">תנודתיות</th><th class="num">קורלציה לנבחרים</th></tr></thead><tbody>${pos.map((x) => `<tr>${x.symbol === 'CASH' ? `<td><b>מזומן / פק"מ</b></td><td>cash</td><td>—</td>` : `<td>${symLink(x.symbol, x.name)}</td><td>${esc(x.role === 'core' ? 'ליבה' : x.role === 'satellite' ? 'לוויין' : LBL[x.assetClass] || x.assetClass)}</td><td>${esc(x.sector || '')}</td>`}<td class="num">${fmt.pct(x.weight, 1)}</td><td class="num">${fmt.ils(x.ils)}</td><td>${esc(x.currency)}</td><td>${x.score != null ? scoreBar(x.score) : ''}</td><td>${x.signal ? sigBadge(x.signal) : ''}</td><td class="num">${fmt.pct(x.vol, 0)}</td><td class="num">${isNum(x.avgCorrToPicked) ? fmt.num(x.avgCorrToPicked) : ''}</td></tr>`).join('')}</tbody></table>
      <div class="muted" style="margin-top:.5rem">אילוצים: max position ${fmt.pct(p.constraints.maxPosition, 0)} למניה, ${fmt.pct(p.constraints.maxEtfPosition, 0)} ל-ETF/אג"ח · max ענף ${fmt.pct(p.constraints.maxSector, 0)} · עד ${p.constraints.maxStocks} מניות · ציון ≥ ${p.constraints.minScore} · תנודתיות ≤ ${fmt.pct(p.constraints.maxVol, 0)}</div></section>
      <div class="stack"><section class="card"><h3>Sector Exposure</h3>${donut({ items: Object.entries(p.exposure.sector).map(([k, v]) => ({ label: k, value: v })), size: 130 }).outerHTML}</section><section class="card"><h3>Geographic / Currency</h3>${donut({ items: Object.entries(p.exposure.geo).map(([k, v]) => ({ label: k, value: v })), size: 110 }).outerHTML}<div class="row" style="margin-top:.4rem">${Object.entries(p.exposure.currency).map(([k, v]) => `<span class="tag">${esc(k)} ${fmt.pct(v, 0)}</span>`).join('')}</div><p class="muted">חשיפה ל-USD/ILS: ${fmt.pct(p.exposure.currency.USD || 0, 0)} מהתיק</p></section></div></div>
    <section class="card" style="margin-top:1rem"><h3>Scenario Analysis / Stress Test ${kind('MODEL')}</h3><div id="scen">${loading('מחשב תרחישים…')}</div></section>
    <section class="card" style="margin-top:1rem"><h3>מטריצת קורלציה (252 ימים)</h3>${r.correlation ? corrTable(r.correlation) : '<div class="muted">—</div>'}</section>`;
    // תרחישים: מחושבים בדפדפן מהמשקלים והסיכון
    try { const sc = await run('portfolioRisk', { weights: Object.fromEntries(pos.filter((x) => x.symbol !== 'CASH').map((x) => [x.symbol, x.weight])), seriesMap: {}, meta: {}, benchRows: null, positions: pos, sizeIls: size }); const list = sc.scenarios; box.querySelector('#scen').innerHTML = `<table><thead><tr><th>תרחיש</th><th class="num">השפעה %</th><th class="num">השפעה ₪</th><th>איך חושב</th></tr></thead><tbody>${list.map((x) => `<tr><td>${esc(x.label)}</td><td class="num ${cls(x.impactPct)}">${fmt.pct(x.impactPct, 1, true)}</td><td class="num ${cls(x.impactIls)}">${fmt.ils(x.impactIls)}</td><td style="white-space:normal" class="muted">${esc(x.how)}</td></tr>`).join('')}</tbody></table><p class="muted">אומדנים מבטות/אלסטיות היסטוריות (MODEL ESTIMATE) — לא תחזית.</p>`; }
    catch (e) { const risk = { beta: r.beta }; box.querySelector('#scen').innerHTML = errorBox(e); }
  };
  main.querySelector('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; main.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('active', x === b)); show(b.dataset.p); });
  show('balanced');
}
function corrTable(c){ const syms = Object.keys(c); return `<div class="table-wrap" style="max-height:360px"><table><thead><tr><th></th>${syms.map((s) => `<th class="num">${esc(s)}</th>`).join('')}</tr></thead><tbody>${syms.map((a) => `<tr><td><b>${esc(a)}</b></td>${syms.map((b) => { const v = c[a][b]; const col = !isNum(v) ? '' : v > 0.7 ? 'rgba(229,72,77,.35)' : v > 0.4 ? 'rgba(245,165,36,.25)' : v < 0 ? 'rgba(47,191,113,.25)' : ''; return `<td class="num" style="background:${col}">${isNum(v) ? v.toFixed(2) : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`; }
