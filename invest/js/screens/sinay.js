// 🪙 קריפטו — דמה 200K$: המסך הייעודי לניסוי הדמה "ריזיקות עקרונות" (Issue #189) על BTC/ETH/LTC/BCH.
// תצוגה בלבד — הנתונים מ-GET /sinay (Worker). המנוע רץ בתוך ה-Worker כל 15 דקות (lib/sinay-live.js) ושולח לטלגרם כל
// דשדוש חדש, כניסה, מילוי שליש ויציאה. בלי כסף אמיתי ובלי פקודות לברוקר.
import { api } from '../core/api.js';
import { esc, fmt, isNum, cls } from '../core/util.js';
import { kpi, loading, errorBox, disclaimer } from '../ui/components.js';
import { lineChart } from '../ui/chart.js';

const SIDE = { short: 'שורט', long: 'לונג' };
const NAME = { BTC: 'ביטקוין', ETH: 'את׳ריום', LTC: 'לייטקוין', BCH: 'ביטקוין קאש' };
const usd0 = (x) => (isNum(x) ? (x < 0 ? '-' : '') + '$' + Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—');
const usdS = (x) => (isNum(x) ? (x > 0 ? '+' : '') + usd0(x) : '—');
const px = (x) => (isNum(x) ? x.toLocaleString('en-US', { maximumFractionDigits: x >= 1000 ? 0 : x >= 10 ? 2 : 4 }) : '—');
const ltr = (s) => `<span style="direction:ltr;unicode-bidi:isolate">${s}</span>`;
const hours = (bars) => (isNum(bars) ? `${Math.max(0, Math.round(bars / 4))} שעות` : '—');
const bar = (frac, color) => `<div style="height:6px;background:var(--line,#e2e8f0);border-radius:3px;overflow:hidden;margin:.35rem 0"><i style="display:block;height:100%;width:${Math.max(2, Math.min(100, frac * 100)).toFixed(0)}%;background:${color}"></i></div>`;

function head(r){
  const live = r.engine === 'worker';
  const badge = r.stale ? `<span class="tag stale">⚠ לא עודכן ${isNum(r.ageHours) ? Math.round(r.ageHours * 10) / 10 + ' שעות' : ''}</span>` : `<span class="tag fact">● ${live ? 'חי' : 'מתעדכן'}</span>`;
  return `<div class="page-head"><div><h1>🪙 קריפטו — דמה</h1><span class="muted">BTC · ETH · LTC · BCH · שיטת "ריזיקות עקרונות" · מתעדכן כל ${esc(r.updateEvery || '15 דקות')} · נר אחרון ${esc(fmt.dt(r.lastUpdate))} ${badge}</span></div></div>`;
}

function hero(r){
  return `<section class="card"><div class="hero"><div class="big">${usd0(r.equityUsd)}</div><div class="sub ${cls(r.pnlUsd)}">${usdS(r.pnlUsd)} (${fmt.pct(r.pnlPct, 2, true)}) <small>מאז ${esc(fmt.date(r.start))}, מתוך ${usd0(r.accountUsd)} וירטואליים</small></div></div>
    <div class="periods">
      <div class="ptile"><div class="pl">ממומש</div><div class="pv ${cls(r.realizedUsd)}">${usdS(r.realizedUsd)}</div></div>
      <div class="ptile"><div class="pl">פתוח עכשיו</div><div class="pv ${cls(r.unrealizedUsd)}">${usdS(r.unrealizedUsd)}</div></div>
      <div class="ptile"><div class="pl">הצלחות</div><div class="pv">${r.stats.wins}/${r.stats.trades}</div></div>
    </div></section>`;
}

// כרטיס "מה קורה עכשיו" לכל מטבע — במילים פשוטות
function coinCard(sym, pc, r){
  const pos = (r.openPositions || []).find((p) => p.sym === sym), st = (r.setups || []).find((s) => s.sym === sym);
  let body, tone;
  if (pos){
    tone = 'var(--accent,#2563eb)';
    body = `<b>בעסקה: ${esc(SIDE[pos.side])} ${pos.filledThirds}/3</b> · כניסה ממוצעת ${px(pos.avg)}<br>
      יעד (EMA50) ≈ ${px(pos.ema)} · סטופ ${px(pos.stop)}<br>
      ${pos.filledThirds < 3 ? `השליש הבא ב-${px(pos.levels[pos.filledThirds])} · ` : ''}פתוח עכשיו: <b class="${cls(pos.unrealizedUsd)}">${usdS(pos.unrealizedUsd)}</b>`;
  } else if (st){
    tone = 'var(--warn,#f5a524)';
    body = `<b>דשדוש פעיל — מחכים לנגיעה</b> · טווח ${px(st.lo)}–${px(st.hi)}<br>
      🔻 עולה ל-<b>${px(st.shortLevels?.[0] ?? st.nextShort)}</b> → כניסה לשורט<br>
      🔺 יורד ל-<b>${px(st.longLevels?.[0] ?? st.nextLong)}</b> → כניסה ללונג<br>
      <span class="muted">תקף עוד ${hours(st.barsLeft)}</span>`;
  } else {
    tone = 'var(--muted,#94a3b8)';
    const w = pc?.range12h, need = pc?.rangeNeeded;
    body = `<b>מחכים לדשדוש</b><br><span class="muted">טווח 12 השעות האחרונות: ${isNum(w) ? fmt.pct(w, 2) : '—'} · צריך עד ${isNum(need) ? fmt.pct(need, 1) : '—'}</span>${isNum(w) && isNum(need) ? bar(need / Math.max(w, need), tone) : ''}`;
  }
  const res = pc?.trades ? `${pc.trades} עסקאות · ${ltr(usdS(pc.pnlUsd))}` : 'עוד אין עסקאות';
  return `<div class="card" style="border-inline-start:4px solid ${tone}"><div style="display:flex;justify-content:space-between;align-items:baseline"><span><b style="font-size:1.1rem">${esc(sym)}</b> <span class="muted">${esc(NAME[sym] || '')}</span></span><b style="direction:ltr">$${px(pc?.mark)}</b></div>
    <div style="margin-top:.4rem;font-size:.92rem;line-height:1.55">${body}</div><div class="muted" style="font-size:.8rem;margin-top:.4rem">${res}</div></div>`;
}

// התקדמות למעבר לכסף אמיתי — יעד 50 עסקאות (Issue #189). הקריטריון הסופי = החלטה של בעל הריפו
function readiness(r){
  const s = r.stats, target = s.target || 50;
  const checks = [
    [s.trades >= target, `${s.trades}/${target} עסקאות סגורות`],
    [r.realizedUsd > 0, `רווח נטו אחרי עמלות: ${usdS(r.realizedUsd)}`],
    [isNum(s.maxDrawdown) ? s.maxDrawdown > -0.05 : true, `ירידה מקסימלית: ${isNum(s.maxDrawdown) && s.maxDrawdown < 0 ? fmt.pct(s.maxDrawdown, 2) : '0%'} (עד 5%)`],
  ];
  return `<section class="card" style="margin:1rem 0"><h3>בדרך לכסף אמיתי</h3>${bar(s.trades / target, '#16a34a')}
    ${checks.map(([ok, t]) => `<div>${ok ? '✅' : '⏳'} ${t}</div>`).join('')}
    <div class="muted" style="font-size:.82rem;margin-top:.4rem">הצעה למדידה, לא החלטה: המעבר לכסף אמיתי, הסכום והפלטפורמה — של מאיר בלבד.</div></section>`;
}

const HOW = `<details class="card" style="margin-bottom:1rem"><summary><b>איך זה עובד — בשתי דקות</b></summary><ol style="line-height:1.7;margin:.5rem 0 0">
  <li><b>מחכים לדשדוש:</b> 12 שעות שבהן המטבע זז בטווח צר (ביטקוין עד 1.2%, את׳ריום עד 1.5%, לייטקוין וביטקוין קאש עד 1.8%).</li>
  <li><b>נכנסים נגד הפריצה:</b> אם המחיר יוצא מהטווח — נכנסים בכיוון ההפוך, בשלושה שלישים, כל שליש רחוק יותר.</li>
  <li><b>יוצאים:</b> כשהמחיר חוזר לממוצע (EMA50) — רווח. אם ממשיך לברוח — סטופ קבוע. אחרי 24 שעות — יוצאים בכל מקרה.</li>
  <li><b>כל דבר נשלח לטלגרם</b> ברגע שהוא קורה: דשדוש חדש (עם כל הרמות מראש), כניסה, מילוי, יציאה.</li>
  <li><b>הכסף וירטואלי:</b> 50,000$ לכל מטבע, בלי מינוף, עמלה 0.05% לכל צד. הכללים קפואים — לא משנים אותם באמצע.</li></ol></details>`;

function setupsTable(list){
  if (!list.length) return '<div class="muted">אין כרגע דשדוש פעיל.</div>';
  const lv = (a) => (a || []).map(px).join(' · ');
  return `<div style="overflow-x:auto"><table><thead><tr><th>מטבע</th><th class="num">טווח</th><th class="num">שורט (⅓ · ⅔ · 3/3)</th><th class="num">סטופ שורט</th><th class="num">לונג (⅓ · ⅔ · 3/3)</th><th class="num">סטופ לונג</th><th>תקף עוד</th></tr></thead><tbody>
    ${list.map((s) => `<tr><td><b>${esc(s.sym)}</b></td><td class="num">${px(s.lo)}–${px(s.hi)}</td><td class="num">${lv(s.shortLevels)}</td><td class="num">${px(s.shortStop)}</td><td class="num">${lv(s.longLevels)}</td><td class="num">${px(s.longStop)}</td><td>${hours(s.barsLeft)}</td></tr>`).join('')}
  </tbody></table></div>`;
}

function journal(list){
  if (!list.length) return '<div class="empty">עדיין אין עסקאות סגורות.</div>';
  return `<div style="overflow-x:auto"><table><thead><tr><th>#</th><th>מטבע</th><th>כיוון</th><th>נסגרה</th><th class="num">שלישים</th><th class="num">כניסה</th><th class="num">יציאה</th><th>סיבה</th><th class="num">%</th><th class="num">על 50K$</th></tr></thead><tbody>
    ${list.map((t) => `<tr><td>${t.n}</td><td><b>${esc(t.sym)}</b></td><td>${esc(SIDE[t.side] || t.side)}</td><td class="muted" style="font-size:.8rem">${esc(fmt.dt(t.close))}</td><td class="num">${t.fills}/3</td><td class="num">${px(t.avg)}</td><td class="num">${px(t.exit)}</td><td>${esc(t.why)}</td><td class="num ${cls(t.net_pct)}">${ltr((t.net_pct > 0 ? '+' : '') + t.net_pct.toFixed(2) + '%')}</td><td class="num ${cls(t.usdScaled)}"><b>${usdS(t.usdScaled)}</b></td></tr>`).join('')}
  </tbody></table></div>`;
}

// 🧪 מסלול עמית (GET /amit): סקאלפ ביטקוין על נרות דקה — הכללים מצילומי המסך שלו (רצועות בולינגר, סטופ, עמלות)
const WHY_A = { 'סטופ': '🛑 סטופ', 'יעד': '🎯 יעד' };
// הבוט בחשבון הדמו של Bybit (אותם כללים, פקודות אמיתיות על כסף וירטואלי) — דוח מהשרת כל שעתיים
function botBlock(b){
  if (!b) return `<div class="muted" style="font-size:.85rem;margin:.4rem 0">🤖 בוט Bybit (חשבון דמו): עוד לא דיווח.</div>`;
  const ageH = (Date.now() - Date.parse(b.receivedAt)) / 3600e3;
  const pos = b.pos ? ` · בעסקה: ${esc(SIDE[b.pos.side] || b.pos.side)} ${esc(String(b.pos.size))} BTC מ-${px(b.pos.entry)}` : '';
  return `<div style="margin:.5rem 0;padding:.5rem .6rem;border:1px dashed var(--border,#444);border-radius:8px">
    <b>🤖 בוט בחשבון הדמו של Bybit</b> <span class="muted" style="font-size:.8rem">אותם כללים · פקודות אמיתיות · כסף וירטואלי · מגבלת הפסד יומית 1,000$</span>
    <div style="font-size:.9rem;margin-top:.25rem">היום ${b.today.n} עסקאות, <b class="${cls(b.today.netUsd)}">${usdS(b.today.netUsd)}</b> · מצטבר ${b.total.n} עסקאות (${b.total.wins} הצלחות), <b class="${cls(b.total.netUsd)}">${usdS(b.total.netUsd)}</b>${isNum(b.equity) ? ` · הון ${usd0(b.equity)}` : ''}${pos}</div>
    ${b.halt ? `<div style="color:var(--warn,#f5a524)">${b.halt === 'daily' ? '⛔ נעצר להיום — מגבלת הפסד יומית' : '⏸️ עצור ידנית'}</div>` : ''}
    ${ageH > 3 ? `<div style="color:var(--warn,#f5a524)">⚠ אין דיווח ${Math.round(ageH)} שעות</div>` : ''}</div>`;
}

function amitSection(a){
  if (!a) return '';
  const p = a.params || {};
  const head = `<h3 style="margin:0 0 .3rem">🧪 מסלול עמית — סקאלפ ביטקוין <span class="muted" style="font-size:.85rem">נרות דקה · דמה</span></h3>`;
  const rules = `<details style="margin-top:.5rem"><summary class="muted">הכללים (מצילומי המסך של עמית, 6/11)</summary><ul style="line-height:1.6;margin:.4rem 0 0">
    <li>פוזיציה ${usd0(p.notionalUsd)} (כמו בסרטון: 2.534 ביטקוין), בטחון ${usd0(p.marginUsd)}, חשבון ${usd0(p.accountUsd)}.</li>
    <li><b>כניסה:</b> המחיר נוגע ברצועת בולינגר (20, 2) של גרף הדקה — בתחתונה קונים (לונג), בעליונה מוכרים (שורט). כמו הסימונים B ו-S על הגרף שלו.</li>
    <li><b>יציאה:</b> נגיעה ברצועה הנגדית · סטופ −${p.slPct}% · אחרי ${p.maxMins} דקות בכל מקרה.</li>
    <li>עמלות כמו בדוח שלו: ${p.makerPct}% לפקודה מוגבלת (כניסה, יעד), ${p.takerPct}% לפקודה מיידית (סטופ, זמן).</li>
    <li><span class="muted">מה שלא ידוע: גודל העסקה משתנה אצלו (8K$–190K$) — קבענו 190K$ כמו בסרטון; הוא סוחר גם במטבעות אחרים — כאן רק ביטקוין.</span></li></ul></details>`;
  if (a.waiting) return `<section class="card" style="margin:1rem 0;border-inline-start:4px solid #7c3aed">${head}<div class="muted">${esc(a.note || 'ממתין לריצה ראשונה')}</div>${rules}</section>`;
  const s = a.stats || {};
  const pos = a.openPosition;
  const posTxt = pos ? `<div style="margin:.4rem 0"><b>בעסקה: ${esc(SIDE[pos.side])}</b> מ-${px(pos.entry)} · יעד (רצועה נגדית) ${px(pos.target)} · סטופ ${px(pos.sl)} · ${pos.mins} דק׳ · פתוח <b class="${cls(pos.unrealizedUsd)}">${usdS(pos.unrealizedUsd)}</b></div>` : `<div class="muted" style="margin:.4rem 0">אין עסקה פתוחה — מחכים לנגיעה ברצועה.</div>`;
  const be = isNum(s.breakevenWinRate) ? ` · צריך ${fmt.pct(s.breakevenWinRate, 0)} כדי לא להפסיד` : '';
  const rows = (a.trades || []).slice(0, 12).map((t) => `<tr><td>${t.n}</td><td>${esc(SIDE[t.side] || t.side)}</td><td class="muted" style="font-size:.8rem">${esc(fmt.dt(t.close))}</td><td class="num">${px(t.entry)}</td><td class="num">${px(t.exit)}</td><td>${esc(WHY_A[t.why] || t.why)}</td><td class="num">${t.mins}</td><td class="num muted">${usd0(t.fees_usd)}</td><td class="num ${cls(t.net_usd)}"><b>${usdS(t.net_usd)}</b></td></tr>`).join('');
  return `<section class="card" style="margin:1rem 0;border-inline-start:4px solid #7c3aed">${head}
    ${'bot' in a ? botBlock(a.bot) : ''}
    <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:baseline"><span style="font-size:1.5rem;font-weight:700">${usd0(a.equityUsd)}</span><span class="${cls(a.pnlUsd)}">${usdS(a.pnlUsd)} (${fmt.pct(a.pnlPct, 2, true)})</span><span class="muted" style="font-size:.85rem">מתוך ${usd0(p.accountUsd)} · היום ${a.today?.trades || 0} עסקאות, ${ltr(usdS(a.today?.netUsd))}</span></div>
    ${posTxt}
    <div class="muted" style="font-size:.88rem">${s.trades} עסקאות · ${s.wins} הצלחות${isNum(s.winRate) ? ` (${fmt.pct(s.winRate, 0)})` : ''}${be} · רווח ממוצע ${usdS(s.avgWinUsd)} · הפסד ממוצע ${usdS(s.avgLossUsd)} · עמלות ששולמו ${usd0(a.feesUsd)}</div>
    ${a.stale ? '<div style="color:var(--warn,#f5a524)">⚠ לא עודכן לאחרונה</div>' : ''}
    ${a.partial ? `<div style="color:var(--warn,#f5a524)">⚠ חור בנתונים (${a.gaps} פעמים המקור לא היה זמין יותר מ-5 שעות) — התוצאות חלקיות</div>` : ''}
    ${rows ? `<div style="overflow-x:auto;margin-top:.5rem"><table><thead><tr><th>#</th><th>כיוון</th><th>נסגרה</th><th class="num">כניסה</th><th class="num">יציאה</th><th>סיבה</th><th class="num">דק׳</th><th class="num">עמלות</th><th class="num">נטו</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
    ${rules}</section>`;
}

export async function render(main){
  main.innerHTML = loading();
  let r;
  let amit = null;
  try { [r, amit] = await Promise.all([api('/sinay', { ttl: 30000 }), api('/amit', { ttl: 30000 }).catch(() => null)]); } catch (e) { main.innerHTML = errorBox(e); return; }
  const dis = disclaimer('דמה בלבד — בלי כסף אמיתי ובלי פקודות לברוקר. הכללים קפואים (Issue #189).');
  const link = `<a href="${esc(r.issueUrl)}" target="_blank" rel="noopener">הכללים המלאים ב-Issue #189</a>`;
  if (r.waiting){ main.innerHTML = `<div style="max-width:900px;margin:0 auto"><h1>🪙 קריפטו — דמה</h1>${dis}<div class="empty">${esc(r.note || 'ממתין לריצה ראשונה')}. ${link}</div>${amitSection(amit)}</div>`; return; }
  const coins = r.coins || Object.keys(r.perCoin || {});
  main.innerHTML = `<div style="max-width:900px;margin:0 auto">${head(r)}${dis}
    ${(r.notes || []).length ? `<div class="card" style="margin:.6rem 0;border-color:var(--warn,#f5a524)">${r.notes.map((n) => `<div>⚠️ ${esc(n)}</div>`).join('')}</div>` : ''}
    ${hero(r)}
    <h3 style="margin:1rem 0 .5rem">מה קורה עכשיו</h3>
    <div class="grid g2" style="gap:.6rem">${coins.map((s) => coinCard(s, r.perCoin?.[s], r)).join('')}</div>
    ${amitSection(amit)}
    ${readiness(r)}
    ${HOW}
    <div class="grid g4" style="margin:1rem 0">
      ${kpi('אחוז הצלחה', isNum(r.stats.winRate) ? fmt.pct(r.stats.winRate, 0) : '—')}
      ${kpi('רווח ממוצע', usdS(r.stats.avgWinUsd), cls(r.stats.avgWinUsd))}
      ${kpi('הפסד ממוצע', usdS(r.stats.avgLossUsd), cls(r.stats.avgLossUsd))}
      ${kpi('ירידה מקסימלית', isNum(r.stats.maxDrawdown) && r.stats.maxDrawdown < 0 ? fmt.pct(r.stats.maxDrawdown, 2) : '0%', cls(r.stats.maxDrawdown))}
    </div>
    <section class="card" style="margin-bottom:1rem"><h3>עקומת שווי <span class="muted">אחרי כל עסקה שנסגרה</span></h3><div id="sinay-eq"></div></section>
    <section class="card" style="margin-bottom:1rem"><h3>דשדושים פעילים <span class="muted">כל הרמות מראש</span></h3>${setupsTable(r.setups || [])}</section>
    <section class="card" style="margin-bottom:1rem"><h3>יומן עסקאות <span class="muted">החדשה ראשונה</span></h3>${journal(r.trades || [])}</section>
    <p class="muted" style="font-size:.85rem">מקור המחירים: ${esc(r.feed === 'kraken' ? 'Kraken' : r.feed === 'coinbase' ? 'Coinbase' : r.feed === 'ibkr-paxos' ? 'IBKR (Paxos)' : r.feed || '—')} · נרות 15 דקות. ${link}</p>
  </div>`;
  const pts = r.equityCurve || [];
  const box = main.querySelector('#sinay-eq');
  if (pts.length >= 2) box.appendChild(lineChart({ dates: pts.map((p) => String(p.t).slice(0, 16).replace('T', ' ')), series: [{ name: 'שווי', values: pts.map((p) => p.equity), color: '#2563eb', area: true }], hlines: [{ y: r.accountUsd, label: '200K', color: '#94a3b8' }], height: 220, yFmt: (v) => fmt.num(v, 0) }));
  else box.innerHTML = '<div class="muted" style="font-size:.85rem">הגרף יתמלא אחרי העסקה הסגורה הראשונה.</div>';
}
