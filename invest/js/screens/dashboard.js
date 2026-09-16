// עמוד ראשי: מצב שוק, תיק, הזדמנויות, רשימת מעקב, סיגנלים, סיכון, חדשות, התראות.
import { api } from '../core/api.js';
import { settings } from '../core/store.js';
import { el, esc, fmt, isNum, cls, REGIME_HE, nameOf } from '../core/util.js';
import { sigBadge, scoreBar, asOf, kpi, pctCell, loading, errorBox, symLink, disclaimer } from '../ui/components.js';
import { donut } from '../ui/chart.js';

const card = (title, body, extra = '') => `<section class="card"><h3>${title} ${extra}</h3>${body}</section>`;
const symRow = (s) => `<tr class="clickable" onclick="location.hash='#/asset/${esc(s.symbol)}'"><td>${symLink(s.symbol, s.name, s.nameHe)}</td><td class="num">${fmt.num(s.price)}</td><td>${pctCell(s.dailyChange)}</td><td>${scoreBar(s.score)}</td><td>${sigBadge(s.signal)}</td></tr>`;
const symTable = (rows) => (rows.length ? `<table><thead><tr><th>נכס</th><th class="num">מחיר</th><th>יומי</th><th>ציון</th><th>סיגנל</th></tr></thead><tbody>${rows.map(symRow).join('')}</tbody></table>` : '<div class="empty">אין נתונים</div>');

export async function render(main){
  main.innerHTML = loading('טוען תמונת מצב…');
  let regime, rank, reco, watch, alerts, paper, cron;
  try {
    [regime, rank, reco, watch, alerts, paper, cron] = await Promise.all([api('/regime', { ttl: 60000 }), api('/rank', { ttl: 60000 }), api('/reco', { ttl: 60000 }), api('/watchlist', { ttl: 30000 }), api('/alerts/log', { ttl: 30000 }), api('/paper', { ttl: 30000 }), api('/cron/status', { ttl: 30000 })]);
  } catch (e) { main.innerHTML = errorBox(e) + `<p class="muted">בדוק את כתובת ה-API בהגדרות. <a href="#/settings">הגדרות</a></p>`; return; }
  const bySym = new Map((rank?.table || []).map((r) => [r.symbol, r]));
  const pick = (syms = []) => syms.map((s) => bySym.get(s)).filter(Boolean);
  const size = settings.get().portfolioSize || 200000;
  const bal = reco?.profiles?.balanced;
  const noRank = rank?.missing;
  const fg = regime?.fearGreed;
  const buy = pick(rank?.categories?.buySignals).slice(0, 8), sell = pick(rank?.categories?.sellSignals).slice(0, 8);
  const news = (rank?.table || []).filter((r) => r.lastNews).map((r) => ({ ...r.lastNews, symbol: r.symbol })).sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || '')).slice(0, 10);
  const inputs = regime?.inputs || {};
  main.innerHTML = `
  <div class="page-head"><div><h1>תמונת מצב מלאה</h1><span class="muted">נכון ל-${esc(rank?.date || regime?.date || '—')} · ${noRank ? '<span class="tag stale">אין דירוג יומי עדיין — הרץ עיבוד בהגדרות</span>' : `${rank.analyzed} נכסים נותחו`}</span></div>
    <div class="row"><a class="btn" href="#/opportunities">🎯 הזדמנויות</a><a class="btn" href="#/portfolio">💼 תיק</a><a class="btn primary" href="#/assistant">🤖 עוזר מחקר</a></div></div>
  <div class="grid g4" style="margin-bottom:1rem">
    ${card('מצב השוק', regime && regime.risk ? `<div class="stack"><div class="row"><span class="tag ${regime.risk === 'Risk On' ? 'fact' : regime.risk === 'Risk Off' ? 'missing' : ''}">${esc(REGIME_HE[regime.risk] || regime.risk)}</span><span class="tag ${regime.trend === 'Bull Trend' ? 'fact' : regime.trend === 'Bear Trend' ? 'missing' : 'stale'}">${esc(REGIME_HE[regime.trend] || regime.trend)}</span></div>
      ${fg ? `<div class="row spread"><span class="muted">Fear & Greed (מקומי)</span><b class="num">${fg.value}</b></div><div class="progress"><i style="width:${fg.value}%;background:${fg.value < 45 ? 'var(--neg)' : fg.value > 55 ? 'var(--pos)' : 'var(--warn)'}"></i></div><span class="muted">${esc(fg.label)}</span>` : ''}
      <dl class="kv"><dt>VIX</dt><dd>${fmt.num(inputs.vix, 1)}</dd><dt>10y</dt><dd>${fmt.num(inputs.dgs10, 2)}%</dd><dt>עקום 10−2</dt><dd class="${cls(inputs.curve)}">${fmt.num(inputs.curve, 2)}</dd><dt>USD/ILS</dt><dd>${fmt.num(inputs.usdils, 3)}</dd></dl>
      <a href="#/regime" class="muted">כללי הסיווג →</a></div>` : '<div class="empty">אין נתוני משטר</div>')}
    ${card(`התיק <span class="muted num">${fmt.ils(size)}</span>`, bal ? `<div class="stack"><div class="muted">תיק מאוזן מומלץ (MODEL) · ${bal.positions.length - 1} נכסים + מזומן</div>
      ${donut({ items: Object.entries(bal.exposure.assetClass).map(([k, v]) => ({ label: { equity: 'מניות', bond: 'אג"ח', gold: 'זהב', cash: 'מזומן' }[k] || k, value: v })), size: 110 }).outerHTML}
      <div class="row"><span class="tag">תנודתיות ${fmt.pct(bal.risk?.volatility, 0)}</span><span class="tag">DD היסטורי ${fmt.pct(bal.risk?.maxDrawdown, 0)}</span><span class="tag">USD ${fmt.pct(bal.exposure.currency.USD, 0)}</span></div>
      <a href="#/portfolio" class="muted">4 פרופילים ותרחישים →</a></div>` : '<div class="empty">אין תיק מומלץ עדיין</div>')}
    ${card('תיק וירטואלי', paper && !paper.error ? `<div class="grid g2">${kpi('סה"כ שווי', fmt.ils(paper.totalIls))}${kpi('רווח/הפסד מההתחלה', fmt.ils(paper.pnlIls), cls(paper.pnlIls))}${kpi('מזומן פנוי', fmt.ils(paper.cashIls))}${kpi('אחוז הצלחה', fmt.pct(paper.winRate, 0))}</div><a href="#/paper" class="muted">תיק וירטואלי →</a>` : '<div class="empty">—</div>')}
    ${card('סיכוני שוק', regime?.rules ? `<ul class="list" style="font-size:.85rem">${regime.rules.filter((r) => r.passed !== null && ((r.dir === 'riskoff' || r.dir === 'bear') ? r.passed : !r.passed)).slice(0, 6).map((r) => `<li class="neg">${esc(r.desc)}</li>`).join('') || '<li class="pos">אין דגלי סיכון פעילים בכללי המשטר</li>'}</ul>${regime.missingInputs?.length ? `<div class="muted">חסר: ${esc(regime.missingInputs.join(', '))}</div>` : ''}` : '<div class="empty">—</div>')}
  </div>
  <div class="grid g2" style="margin-bottom:1rem">
    ${card('הזדמנויות מובילות', symTable(pick(rank?.categories?.bestOverall).slice(0, 8)), '<a class="muted" href="#/opportunities">הכול →</a>')}
    ${card('רשימת מעקב', watch?.items?.length ? symTable(watch.items.map((w) => w.snapshot || { symbol: w.symbol })) : '<div class="empty">רשימת המעקב ריקה — הוסף נכסים מדף הנכס</div>', '<a class="muted" href="#/watchlist">ניהול →</a>')}
    ${card('סיגנלי קנייה', symTable(buy), `<span class="tag fact">${rank?.categories?.buySignals?.length || 0}</span>`)}
    ${card('סיגנלי מכירה / הקטנה', symTable(sell), `<span class="tag missing">${rank?.categories?.sellSignals?.length || 0}</span>`)}
    ${card('חדשות חשובות', news.length ? `<ul class="list" style="font-size:.86rem">${news.map((n) => `<li><a href="#/asset/${esc(n.symbol)}"><b>${esc(n.symbol)}</b></a> · <a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a> <span class="muted">${esc(n.publisher || '')} · ${fmt.date(n.publishedAt)}</span></li>`).join('')}</ul>` : '<div class="empty">אין חדשות עדיין</div>')}
    ${card('התראות', alerts?.length ? `<ul class="list" style="font-size:.86rem">${alerts.slice(0, 8).map((a) => `<li><b>${esc(a.symbol)}</b> ${esc(a.label || a.type)}: ${esc(a.what)} <span class="muted">${fmt.ago(a.ts)}</span></li>`).join('')}</ul>` : '<div class="empty">אין התראות ב-14 הימים האחרונים</div>', '<a class="muted" href="#/alerts">כללים →</a>')}
  </div>
  ${cron?.state?.day ? `<div class="muted">עיבוד יומי: ${esc(cron.state.day)} · הושלמו ${cron.state.done?.length ?? cron.state.done ?? 0} · בתור ${cron.state.queueLeft ?? 0} · ${cron.state.finalized ? 'הסתיים' : 'בתהליך'}</div>` : ''}
  ${disclaimer()}`;
}
