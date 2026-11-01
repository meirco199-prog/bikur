// ניסוי סיני — דמה 200K$: מעקב אונליין אחרי ניסוי הדמה "ריזיקות עקרונות" (Issue #189). תצוגה בלבד — הנתונים מגיעים
// מ-GET /sinay (Worker), שמחשב חשבון של 200,000$ (BTC/ETH/LTC/BCH × 50,000$, בלי מינוף, כניסה בשלישים) מתוך מצב הסימולציה.
import { api } from '../core/api.js';
import { esc, fmt, isNum, cls } from '../core/util.js';
import { kpi, loading, errorBox, disclaimer } from '../ui/components.js';
import { lineChart } from '../ui/chart.js';

const SIDE = { short: 'שורט', long: 'לונג' };
const usd0 = (x) => (isNum(x) ? (x < 0 ? '-' : '') + '$' + Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—');
const usdS = (x) => (isNum(x) ? (x > 0 ? '+' : '') + usd0(x) : '—');
const px = (x) => (isNum(x) ? x.toLocaleString('en-US', { maximumFractionDigits: x >= 1000 ? 2 : x >= 10 ? 3 : 4 }) : '—');
const when = (d) => (d ? `${fmt.dt(d)} (${fmt.ago(d)})` : '—');
const ltr = (s) => `<span style="direction:ltr;unicode-bidi:isolate">${s}</span>`;

function head(r){
  const stale = r.stale ? ` <span class="tag stale" title="המשימה רצה כל 6 שעות">⚠ לא עודכן ${isNum(r.ageHours) ? Math.round(r.ageHours) + ' שעות' : ''}</span>` : '';
  return `<div class="page-head"><div><h1>ניסוי סיני — דמה 200K$</h1><span class="muted">שיטת "ריזיקות עקרונות" (amit.sinay) · BTC, ETH, LTC, BCH · 50,000$ לכל מטבע, בלי מינוף, כניסה בשלישים · עדכון אחרון ${esc(when(r.lastUpdate))}${stale}</span></div></div>`;
}

function hero(r){
  return `<section class="card"><div class="hero"><div class="big">${usd0(r.equityUsd)}</div><div class="sub ${cls(r.pnlUsd)}">${usdS(r.pnlUsd)} (${fmt.pct(r.pnlPct, 2, true)}) <small>מאז ${esc(fmt.date(r.start))}, מתוך ${usd0(r.accountUsd)}</small></div></div>
    <div class="periods">
      <div class="ptile"><div class="pl">ממומש</div><div class="pv ${cls(r.realizedUsd)}">${usdS(r.realizedUsd)}</div></div>
      <div class="ptile"><div class="pl">לא ממומש</div><div class="pv ${cls(r.unrealizedUsd)}">${usdS(r.unrealizedUsd)}</div></div>
      <div class="ptile"><div class="pl">עסקאות סגורות</div><div class="pv">${r.stats.trades} / ${r.stats.target}</div></div>
    </div></section>`;
}

function stats(s){
  return `<div class="grid g4" style="margin:1rem 0">
    ${kpi('אחוז הצלחה', isNum(s.winRate) ? fmt.pct(s.winRate, 0) + ` (${s.wins}/${s.trades})` : '—')}
    ${kpi('רווח ממוצע', usdS(s.avgWinUsd), cls(s.avgWinUsd))}
    ${kpi('הפסד ממוצע', usdS(s.avgLossUsd), cls(s.avgLossUsd))}
    ${kpi('ירידה מקסימלית (ממומש)', isNum(s.maxDrawdown) && s.maxDrawdown < 0 ? `${fmt.pct(s.maxDrawdown, 2)} · ${usd0(s.maxDrawdownUsd)}` : '0%', cls(s.maxDrawdown))}
  </div>`;
}

function positions(list){
  if (!list.length) return '<div class="muted">אין כרגע פוזיציה פתוחה.</div>';
  return `<div style="overflow-x:auto"><table><thead><tr><th>מטבע</th><th>כיוון</th><th class="num">שלישים</th><th class="num">ממוצע</th><th class="num">מחיר אחרון</th><th class="num">סטופ</th><th class="num">יעד (EMA50)</th><th class="num">לא ממומש</th><th>נפתחה</th></tr></thead><tbody>
    ${list.map((p) => `<tr><td><b>${esc(p.sym)}</b></td><td>${esc(SIDE[p.side] || p.side)}</td><td class="num">${p.filledThirds}/3</td><td class="num">${px(p.avg)}</td><td class="num">${px(p.mark)}</td><td class="num">${px(p.stop)}</td><td class="num">${px(p.ema)}</td><td class="num ${cls(p.unrealizedUsd)}">${isNum(p.unrealizedUsd) ? usdS(p.unrealizedUsd) : '<span class="tag missing" title="אין עדיין מחיר עדכני">חסר</span>'}</td><td class="muted" style="font-size:.8rem">${esc(fmt.dt(p.start))}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function setups(list){
  if (!list.length) return '<div class="muted">אין כרגע דשדוש פעיל שמחכה לכניסה.</div>';
  return `<div style="overflow-x:auto"><table><thead><tr><th>מטבע</th><th class="num">קצה עליון</th><th class="num">קצה תחתון</th><th class="num">רוחב</th><th class="num">שורט ראשון מעל</th><th class="num">לונג ראשון מתחת</th><th class="num">מחיר אחרון</th></tr></thead><tbody>
    ${list.map((s) => `<tr><td><b>${esc(s.sym)}</b></td><td class="num">${px(s.hi)}</td><td class="num">${px(s.lo)}</td><td class="num">${fmt.pct(s.widthPct, 2)}</td><td class="num">${px(s.nextShort)}</td><td class="num">${px(s.nextLong)}</td><td class="num">${px(s.mark)}</td></tr>`).join('')}
  </tbody></table></div><div class="muted" style="font-size:.8rem;margin-top:.3rem">רמת הכניסה הראשונה = הקצה ועוד/פחות אמצע "הטווח הטבעי" של המטבע (כלל 3). הדשדוש תקף 24 שעות ועד הנגיעה הראשונה.</div>`;
}

function journal(list){
  if (!list.length) return '<div class="empty">עדיין אין עסקאות סגורות. הן יופיעו כאן אחרי שהסימולציה תסגור את הראשונה.</div>';
  return `<div style="overflow-x:auto"><table><thead><tr><th>#</th><th>מטבע</th><th>כיוון</th><th>נסגרה</th><th class="num">שלישים</th><th class="num">כניסה ממוצעת</th><th class="num">יציאה</th><th>סיבה</th><th class="num">%</th><th class="num">רווח/הפסד (50K$)</th></tr></thead><tbody>
    ${list.map((t) => `<tr><td>${t.n}</td><td><b>${esc(t.sym)}</b></td><td>${esc(SIDE[t.side] || t.side)}</td><td class="muted" style="font-size:.8rem">${esc(fmt.dt(t.close))}</td><td class="num">${t.fills}/3</td><td class="num">${px(t.avg)}</td><td class="num">${px(t.exit)}</td><td>${esc(t.why)}</td><td class="num ${cls(t.net_pct)}">${ltr((t.net_pct > 0 ? '+' : '') + t.net_pct.toFixed(2) + '%')}</td><td class="num ${cls(t.usdScaled)}"><b>${usdS(t.usdScaled)}</b></td></tr>`).join('')}
  </tbody></table></div>`;
}

function perCoin(pc){
  return `<div class="muted" style="font-size:.85rem;margin-top:.4rem">לפי מטבע: ${Object.entries(pc || {}).map(([k, v]) => `${esc(k)} ${v.trades ? `${v.trades} עסקאות, ${ltr(usdS(v.pnlUsd))}` : 'אין עסקאות'}`).join(' · ')}</div>`;
}

export async function render(main){
  main.innerHTML = loading();
  let r;
  try { r = await api('/sinay', { ttl: 30000 }); } catch (e) { main.innerHTML = errorBox(e); return; }
  const dis = disclaimer(r.disclaimer || 'סימולציה בלבד — בלי כסף אמיתי. הכללים קפואים (Issue #189).');
  const link = `<a href="${esc(r.issueUrl)}" target="_blank" rel="noopener">הכללים והיומן המלא ב-Issue #189</a>`;
  if (r.waiting){
    main.innerHTML = `<div style="max-width:900px;margin:0 auto"><h1>ניסוי סיני — דמה 200K$</h1>${dis}<div class="empty">${esc(r.note || 'ממתין לסנכרון ראשון')}. הנתונים יופיעו אחרי העדכון הבא של הסימולציה (כל 6 שעות). ${link}</div></div>`;
    return;
  }
  main.innerHTML = `<div style="max-width:900px;margin:0 auto">${head(r)}${dis}
    ${(r.notes || []).length ? `<div class="card" style="margin:.6rem 0;border-color:var(--warn,#f5a524)">${r.notes.map((n) => `<div>⚠️ ${esc(n)}</div>`).join('')}</div>` : ''}
    ${hero(r)}
    ${stats(r.stats)}
    <section class="card" style="margin-bottom:1rem"><h3>עקומת שווי ממומש <span class="muted">נקודת התחלה + כל סגירת עסקה</span></h3><div id="sinay-eq"></div>${perCoin(r.perCoin)}</section>
    <section class="card" style="margin-bottom:1rem"><h3>פוזיציות פתוחות</h3>${positions(r.openPositions || [])}</section>
    <section class="card" style="margin-bottom:1rem"><h3>דשדושים במעקב <span class="muted">מחכים לכניסה נגד התנועה</span></h3>${setups(r.setups || [])}</section>
    <section class="card" style="margin-bottom:1rem"><h3>יומן עסקאות <span class="muted">החדשה ראשונה</span></h3>${journal(r.trades || [])}</section>
    <p class="muted" style="font-size:.85rem">הסכום בכל עסקה מוגדל מ-10,000$ מתוכננים ל-50,000$ למטבע (אותו אחוז, כולל עמלה 0.05% לכל צד ושלישים שלא מולאו). לא ממומש = מחיר הסגירה האחרון של נר 15 דקות, אחרי עמלות. ${link}</p>
  </div>`;
  const pts = r.equityCurve || [];
  const box = main.querySelector('#sinay-eq');
  if (pts.length >= 2) box.appendChild(lineChart({ dates: pts.map((p) => String(p.t).slice(0, 16).replace('T', ' ')), series: [{ name: 'שווי ממומש', values: pts.map((p) => p.equity), color: '#2563eb', area: true }], hlines: [{ y: r.accountUsd, label: '200K', color: '#94a3b8' }], height: 220, yFmt: (v) => fmt.num(v, 0) }));
  else box.innerHTML = '<div class="muted" style="font-size:.85rem">הגרף יתמלא אחרי העסקה הסגורה הראשונה.</div>';
}
