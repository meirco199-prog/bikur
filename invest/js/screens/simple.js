// המסכים הפשוטים: היום · לקנות · למכור · התיק שלי. עברית בלבד, בלי מונחים. כל היתר ב"עוד".
import { api, invalidate } from '../core/api.js';
import { settings } from '../core/store.js';
import { esc, fmt, isNum, cls, toast, modal, SIGNAL_HE, REGIME_HE, nameOf } from '../core/util.js';
import { loading, errorBox } from '../ui/components.js';

let D = null; // נתונים משותפים לכל המסכים הפשוטים (מטמון קצר)
async function load(){
  const [regime, rank, watch, paper, reco, auto, shadow, aggr] = await Promise.all([api('/regime', { ttl: 60000 }), api('/rank', { ttl: 60000 }), api('/watchlist', { ttl: 30000 }), api('/paper', { ttl: 30000 }), api('/reco', { ttl: 60000 }), api('/auto/status', { ttl: 30000 }).catch(() => null), api('/shadow/report', { ttl: 60000 }).catch(() => null), api('/aggressive/report', { ttl: 60000 }).catch(() => null)]);
  const table = rank?.table || [];
  const by = new Map(table.map((r) => [r.symbol, r]));
  const usdils = regime?.inputs?.usdils || reco?.usdils || 3.7;
  return { regime, rank, watch, paper, reco, auto, shadow, aggr, table, by, usdils, size: settings.get().portfolioSize || 200000 };
}
const ils = (usd) => fmt.ils(usd * (D?.usdils || 3.7));
const riskWord = (r) => ({ 'נמוך': 'סיכון נמוך', 'בינוני': 'סיכון בינוני', 'גבוה': 'סיכון גבוה' }[r?.riskLevel] || 'סיכון לא ידוע');
const why = (r) => { // משפט אחד בעברית פשוטה
  const c = r.components || {}; const good = [], bad = [];
  const say = (k, g, b) => { const v = c[k]; if (!isNum(v)) return; if (v >= 70) good.push(g); else if (v <= 40) bad.push(b); };
  say('fundamental', 'החברה רווחית ויציבה', 'החברה לא רווחית מספיק'); say('valuation', 'המחיר סביר', 'המחיר יקר'); say('growth', 'צומחת', 'לא צומחת'); say('technical', 'המגמה עולה', 'המגמה יורדת'); say('momentum', 'בתנופה', 'מאבדת תנופה'); say('risk', 'יציבה', 'תנודתית');
  return (good.length ? good.slice(0, 3).join(', ') : '') + (bad.length ? (good.length ? '. אבל: ' : 'חסרונות: ') + bad.slice(0, 2).join(', ') : '') + '.';
};
const barOf = (r) => r?.barDate || r?.dataAsOf?.asOf || null;
const lastBar = () => D.rank?.barDate || D.table.map(barOf).filter(Boolean).sort().slice(-1)[0] || null;
const asOfLine = () => { const b = lastBar(); const u = D.rank?.universes; const uLine = u ? ` · יקום: S&P 500 ${u.sp500} + מורחב ${u.extended}` : ''; return b ? `לפי שערי סגירה של ${fmt.date(b)}` + (D.rank?.date && D.rank.date !== b ? ` · הניתוח חושב ב-${fmt.date(D.rank.date)}` : '') + uLine : esc(D.rank?.date || ''); };
const held = () => new Set([...(D.paper?.open || []).map((p) => p.symbol), ...(D.watch?.items || []).map((w) => w.symbol)]);
const sec = (title, body, sub = '') => `<section class="card"><h3>${esc(title)} ${sub ? `<span class="muted">${esc(sub)}</span>` : ''}</h3>${body}</section>`;
const acct = () => { const p = D.paper || {}; return { rows: p.positions || [], cash: p.cashIls || 0, val: p.valueIls || 0, total: p.totalIls || 0, pnl: p.pnlIls || 0, pnlPct: p.pnlPct || 0, initial: p.account?.initialIls || D.size, fees: p.commissionsIls || 0 }; };
const buyCard = (r, compact = false) => `<div class="card tight" style="margin-bottom:.5rem"><div class="row spread"><a href="#/asset/${esc(r.symbol)}" style="font-size:1.1rem;font-weight:700">${esc(nameOf(r))}</a><span class="tag ${r.signal === 'STRONG BUY' ? 'fact' : ''}">${esc(SIGNAL_HE[r.signal] || '')}</span></div>
  <div style="margin:.25rem 0">${esc(why(r))}</div>
  <div class="muted" style="font-size:.85rem">סגירה${barOf(r) ? ' ' + fmt.date(barOf(r)) : ''}: ${r.currency === 'ILS' ? fmt.num(r.price) + ' ₪' : '$' + fmt.num(r.price) + ' (' + ils(r.price) + ')'} · ${esc(riskWord(r))}${r.nextEarnings ? ' · דוח בקרוב: ' + fmt.date(r.nextEarnings) : ''}</div>
  ${compact ? '' : `<div class="row" style="margin-top:.45rem"><button class="btn sm primary" data-buy="${esc(r.symbol)}">קנייה</button><button class="btn sm" data-watch="${esc(r.symbol)}">${held().has(r.symbol) ? 'במעקב ✓' : 'עקוב'}</button><a class="btn sm ghost" href="#/asset/${esc(r.symbol)}">פרטים</a></div>`}</div>`;
const sellCard = (r) => `<div class="card tight" style="margin-bottom:.5rem;border-color:var(--neg)"><div class="row spread"><a href="#/asset/${esc(r.symbol)}" style="font-size:1.1rem;font-weight:700">${esc(nameOf(r))}</a><span class="sig sig-${esc(r.signal.replace(' ', '_'))}">${esc(SIGNAL_HE[r.signal])}</span></div><div>${esc(why(r))}</div>${(D.paper?.open || []).some((p) => p.symbol === r.symbol) ? `<button class="btn sm danger" data-sell="${esc(r.symbol)}" style="margin-top:.4rem">מכירה</button>` : ''}</div>`;
const mood = () => {
  const g = D.regime; if (!g?.risk) return '<div class="empty">אין נתוני שוק עדיין</div>';
  const label = `${REGIME_HE[g.trend] || g.trend} · ${REGIME_HE[g.risk] || g.risk}`;
  const text = g.trend === 'Bull Trend' && g.risk === 'Risk On' ? 'השוק בעלייה והמשקיעים רגועים. אפשר לקנות בהדרגה.' : g.trend === 'Bear Trend' ? 'השוק בירידה. עדיף לחכות עם קניות ולהחזיק מזומן.' : g.risk === 'Risk Off' ? 'המשקיעים מפחדים. להיזהר ולהקטין סיכון.' : 'שוק מעורב. לקנות רק מה שמקבל סיגנל ברור, בסכומים קטנים.';
  const color = g.trend === 'Bull Trend' && g.risk !== 'Risk Off' ? 'fact' : g.trend === 'Bear Trend' || g.risk === 'Risk Off' ? 'missing' : 'stale';
  return `<span class="tag ${color}" style="font-size:1rem">${esc(label)}</span><p style="margin:.4rem 0 0">${esc(text)}</p>`;
};

const orderLine = (o) => `<div style="padding:.35rem 0;border-bottom:1px solid var(--line)"><div class="row spread"><b>${o.side === 'buy' ? '🟢 קנה' : '🔴 מכר'} ${o.qty} × ${esc(o.name || o.symbol)}</b><span class="${o.error ? 'neg' : ''}">${o.error ? 'לא בוצע' : (o.currency === 'ILS' ? fmt.num(o.price) + ' ₪' : '$' + fmt.num(o.price)) + (o.costIls ? ' · ' + fmt.ils(o.costIls) : o.proceedsIls ? ' · ' + fmt.ils(o.proceedsIls) + (isNum(o.pnlIls) ? ' (' + (o.pnlIls >= 0 ? 'רווח ' : 'הפסד ') + fmt.ils(Math.abs(o.pnlIls)) + ')' : '') : '')}</span></div><div class="muted" style="font-size:.85rem">${esc(o.error || o.reason || '')}</div></div>`;
const runBlock = (j) => `<div class="muted" style="font-size:.85rem">${fmt.dt(j.ts)} · ${j.regime ? esc((REGIME_HE[j.regime.trend] || j.regime.trend) + ' · ' + (REGIME_HE[j.regime.risk] || j.regime.risk)) : ''}${j.after ? ` · אחרי: ${fmt.ils(j.after.totalIls)} (מזומן ${fmt.ils(j.after.cashIls)})` : ''}</div>
  ${j.orders?.length ? j.orders.map(orderLine).join('') : '<div style="padding:.3rem 0">לא בוצעו פעולות.</div>'}
  ${j.notes?.length ? `<div class="muted" style="font-size:.85rem;margin-top:.3rem">${j.notes.map(esc).join(' · ')}</div>` : ''}
  ${j.skipped?.length ? `<details style="margin-top:.3rem"><summary class="muted" style="cursor:pointer;font-size:.85rem">נדחו ${j.skipped.length} מועמדים — למה?</summary><div class="muted" style="font-size:.82rem">${j.skipped.map((x) => `${esc(nameOf(D.by.get(x.symbol) || { symbol: x.symbol }))}: ${esc(x.reason)}`).join('<br>')}</div></details>` : ''}`;
const autoCard = (full = false) => {
  const a = D.auto; if (!a) return '';
  const on = a.enabled !== false;
  const head = `<div class="row spread" style="margin-bottom:.4rem"><span class="tag ${on ? 'fact' : 'missing'}">${on ? 'פעיל' : 'כבוי'}</span><div class="row"><button class="btn sm" data-auto-run="1">הרץ עכשיו</button><button class="btn sm ghost" data-auto-toggle="${on ? '0' : '1'}">${on ? 'כבה' : 'הפעל'}</button></div></div>`;
  const body = a.last ? `<div class="muted" style="font-size:.85rem;margin-bottom:.2rem">ריצה אחרונה</div>${runBlock(a.last)}` : '<div class="empty">עוד לא רץ. הוא ירוץ לבד אחרי העיבוד הלילי, או לחץ "הרץ עכשיו".</div>';
  const hist = full && a.journal?.length > 1 ? `<details style="margin-top:.5rem"><summary style="cursor:pointer">ריצות קודמות (${a.journal.length - 1})</summary>${a.journal.slice(1).map((j) => `<div style="margin:.5rem 0;padding-top:.4rem;border-top:1px solid var(--line)">${runBlock(j)}</div>`).join('')}</details>` : '';
  return sec('האוטומט מנהל את חשבון התרגול', head + body + hist + `<p class="muted" style="margin-top:.5rem;font-size:.85rem">כללים קבועים וגלויים: קונה רק סיגנלי קנייה, בשלבים, עד 3 ביום; מוכר בסיגנל מכירה או בעצירת הפסד לפי התנודתיות של כל נייר (8% עד 20%); כל פוזיציה מסכנת עד ${((a.rules?.riskBudget || 0.005) * 100).toFixed(1)}% מהתיק. <a href="#/explain">כל הכללים</a></p>`, 'רץ פעם ביום, אחרי הניתוח');
};

// מודל צל: ציונים חלופיים שמחושבים כל לילה במקביל למודל שמפעיל את האוטומט, בלי לסחור. מציג הסכמה, 5 המובילות, ותשואות עתידיות כשנצברו
const shadowCard = () => {
  const sh = D.shadow; if (!sh || sh.missing) return '';
  const nm = (s) => esc(nameOf(D.by.get(s) || { symbol: s }));
  const pct = (x) => (isNum(x) ? Math.round(x * 100) + '%' : '—');
  const top = (m) => (sh.top?.[m] || []).slice(0, 5).map(nm).join(', ') || '—';
  const H = sh.stats?.horizons?.['20'] || sh.stats?.horizons?.['5'] || sh.stats?.horizons?.['1'];
  const hDays = H === sh.stats?.horizons?.['20'] ? 20 : H === sh.stats?.horizons?.['5'] ? 5 : 1;
  const statRows = H ? ['A', 'B', 'C', 'D'].map((m) => { const M = H.models?.[m]; if (!M || !M.n) return ''; const buy = M.actions?.['STRONG BUY'] || M.actions?.BUY; return `<tr><td>${esc(sh.models?.[m]?.label || m)}</td><td class="num">${M.n}</td><td class="num">${buy ? fmt.pct(buy.mean, 1, true) : '—'}</td><td class="num">${M.actions?.SELL ? fmt.pct(M.actions.SELL.mean, 1, true) : '—'}</td><td class="num">${isNum(M.ic) ? M.ic : '—'}</td><td>${M.monotonic === null ? 'עוד אין' : M.monotonic ? 'כן' : 'לא'}</td></tr>`; }).join('') : '';
  const rev = sh.revisionsUsed ? `ריוויזיות תחזיות בשימוש (${sh.revisionsAvailable} חברות)` : `ריוויזיות תחזיות: לא זמינות עדיין${isNum(sh.revisionHistoryDays) ? ` (נצברו ${sh.revisionHistoryDays} מתוך 30 ימי היסטוריה)` : ''} — מודל C רץ בלעדיהן, לא עם אפס`;
  return sec('מודל צל (לא סוחר)', `<div class="muted" style="font-size:.85rem;margin-bottom:.4rem">${sh.n} מניות${sh.universe === 'sp500' ? ' (חברות S&P 500 בלבד)' : ''} · ${esc(sh.day || '')}${sh.overlay ? ` · שכבת מאקרו: ${sh.overlay === 'bear' ? 'שוק דובי — בלי קניות' : 'בריחה מסיכון — רק קנייה חזקה'}` : ''}</div>
    <div class="grid g2" style="margin-bottom:.4rem"><div class="kpi"><span class="v">${pct(sh.agreement?.AB)}</span><span class="l">הסכמה בפעולה: ישן מול יחסי-ענף</span></div><div class="kpi"><span class="v">${pct(sh.agreement?.buyOverlapAC)}</span><span class="l">חפיפה ברשימת הקנייה: ישן מול C</span></div></div>
    <div style="font-size:.9rem"><div><b>הישן (A):</b> ${top('A')}</div><div><b>יחסי-ענף (B):</b> ${top('B')}</div><div><b>B + ריוויזיות + מאקרו (C):</b> ${top('C')}</div><div><b>אגרסיבי (D, בלי תמחור):</b> ${top('D')}</div></div>
    <div class="muted" style="font-size:.85rem;margin-top:.4rem">${esc(rev)}</div>
    ${sh.dist?.C ? `<div class="muted" style="font-size:.85rem;margin-top:.3rem">התפלגות היום (C): חציון ${sh.dist.C.median}, "קנייה חזקה" ${pct(sh.dist.C.strongBuyShare)} מהמניות${sh.distSeries?.length > 5 ? ` · לפני ${sh.distSeries.length} ימים: ${pct(sh.distSeries[0]?.C?.strong)}` : ''}</div>` : ''}
    ${statRows ? `<div class="muted" style="font-size:.85rem;margin-top:.5rem">תשואה עתידית ל-${hDays} ימי מסחר, על ${H.days} ימי סיגנל שנסגרו</div><table><thead><tr><th>מודל</th><th class="num">n</th><th class="num">קנייה</th><th class="num">מכירה</th><th class="num">IC</th><th>מונוטוני?</th></tr></thead><tbody>${statRows}</tbody></table>` : '<div class="muted" style="font-size:.85rem;margin-top:.4rem">תשואות עתידיות (1/5/20 ימים) יתחילו להיסגר אחרי היום הראשון. ההשוואה בין המודלים תהיה משמעותית אחרי כמה שבועות.</div>'}
    <p class="muted" style="margin-top:.5rem;font-size:.85rem">המודלים החדשים לא שולחים פקודות. הם נמדדים מול הישן ומחליפים אותו רק אם יוכיחו את עצמם. <a href="#/explain">איך זה נבדק</a></p>`, 'מודל ציון חדש בבדיקה');
};

// מסלול אגרסיבי: תיק צל שני (סימולציה, לא חשבון התרגול) — ריכוזי, לפי מודל C, יציאה מהירה. נמדד מול SPY עם drawdown ותנודתיות
const aggrCard = () => {
  const a = D.aggr; if (!a || a.missing) return '';
  const m = a.metrics || {};
  const posLine = (a.positions || []).filter((p) => !p.core).slice(0, 10).map((p) => `${esc(nameOf(D.by.get(p.symbol) || { symbol: p.symbol }))} <span class="${cls(p.pnlPct)}">${fmt.pct(p.pnlPct, 1, true)}</span>`).join(' · ');
  return sec('מסלול אגרסיבי (תיק צל, לא סוחר)', `<div class="grid g2" style="margin-bottom:.4rem"><div class="kpi"><span class="v">${fmt.ils(a.totalIls)}</span><span class="l">שווי (התחלה ${fmt.ils(a.initialIls)})</span></div><div class="kpi"><span class="v ${cls(m.excess)}">${isNum(m.excess) ? fmt.pct(m.excess, 1, true) : '—'}</span><span class="l">מול SPY באותה תקופה</span></div><div class="kpi"><span class="v ${cls(m.totalReturn)}">${isNum(m.totalReturn) ? fmt.pct(m.totalReturn, 1, true) : '—'}</span><span class="l">תשואה מההתחלה</span></div><div class="kpi"><span class="v neg">${isNum(m.maxDrawdown) ? fmt.pct(m.maxDrawdown, 1) : '—'}</span><span class="l">ירידה מקסימלית מהשיא</span></div></div>
    ${a.exposure ? `<table style="margin-bottom:.4rem"><thead><tr><th>חשיפה</th><th class="num">מניות בודדות</th><th class="num">קרן SPY</th><th class="num">מזומן</th><th class="num">סה"כ מנייתי</th></tr></thead><tbody><tr><td>אחוז מהתיק</td><td class="num">${fmt.pct(a.exposure.stocksShare, 0)}</td><td class="num">${fmt.pct(a.exposure.etfShare, 0)}</td><td class="num">${fmt.pct(a.exposure.cashShare, 0)}</td><td class="num"><b>${fmt.pct(a.exposure.equityShare, 0)}</b></td></tr><tr><td>₪</td><td class="num">${fmt.ils(a.exposure.stocksIls)}</td><td class="num">${fmt.ils(a.exposure.etfIls)}</td><td class="num">${fmt.ils(a.exposure.cashIls)}</td><td class="num">${fmt.ils(a.exposure.equityIls)}</td></tr></tbody></table>` : ''}
    ${a.sectors?.length ? `<div class="muted" style="font-size:.85rem">ענפים (look-through, כולל מה שבתוך SPY): ${a.sectors.slice(0, 4).map((x) => `${esc(x.sector)} ${fmt.pct(x.share, 0)}`).join(' · ')}</div>` : ''}
    <div class="muted" style="font-size:.85rem">${m.days || 0} ימי מסחר · תנודתיות שנתית ${isNum(m.volAnnual) ? fmt.pct(m.volAnnual, 0) : '—'} · עסקאות ${a.stats?.trades || 0} (רווח ${a.stats?.wins || 0} / הפסד ${a.stats?.losses || 0})</div>
    ${posLine ? `<div style="font-size:.9rem;margin-top:.4rem">${posLine}</div>` : '<div class="muted" style="margin-top:.4rem">אין מניות כרגע.</div>'}
    ${a.trades?.length ? `<details style="margin-top:.4rem"><summary class="muted" style="cursor:pointer;font-size:.85rem">עסקאות אחרונות (${a.trades.length})</summary><div class="muted" style="font-size:.82rem">${a.trades.slice(0, 12).map((t) => `${esc(t.day)} ${t.side === 'buy' ? 'קנה' : 'מכר'} ${t.qty} × ${esc(nameOf(D.by.get(t.symbol) || { symbol: t.symbol }))}${isNum(t.pnlIls) ? ` (${t.pnlIls >= 0 ? 'רווח' : 'הפסד'} ${fmt.ils(Math.abs(t.pnlIls))})` : ''}: ${esc(t.reason || '')}`).join('<br>')}</div></details>` : ''}
    <p class="muted" style="margin-top:.5rem;font-size:.85rem">20% SPY, עד 10 מניות של 7.5% לפי הציון האגרסיבי (D: מומנטום, צמיחה, ריוויזיות, איכות, סיכון, בלי תמחור), ענף ≤ 40% כולל look-through של SPY, עצירה 12% מהכניסה ו-15% מהשיא, שוק דובי → מניות עד 25%. לא רודף אחרי יעד תשואה: נמדד מול SPY, ומחיר הסיכון נרשם. <a href="#/explain">הכללים</a></p>`, 'סימולציה במקביל, בלי פקודות');
};

const VIEWS = {
  today(){
    const buys = D.table.filter((r) => ['STRONG BUY', 'BUY'].includes(r.signal)).sort((a, b) => b.score - a.score);
    const h = held(); const sells = D.table.filter((r) => h.has(r.symbol) && ['SELL', 'REDUCE'].includes(r.signal));
    const A = acct();
    return `<h1>היום</h1><div class="muted" style="margin-bottom:.8rem">${asOfLine()}</div>
    ${sec('מצב השוק', mood())}
    ${sec('החשבון שלי', `<div class="grid g2"><div class="kpi"><span class="v">${fmt.ils(A.total)}</span><span class="l">סה"כ (מזומן + ניירות)</span></div><div class="kpi"><span class="v ${cls(A.pnl)}">${fmt.ils(A.pnl)} <small>(${fmt.pct(A.pnlPct, 1, true)})</small></span><span class="l">רווח / הפסד מההתחלה</span></div></div><div class="muted" style="margin-top:.4rem">מזומן פנוי: ${fmt.ils(A.cash)} · ניירות: ${fmt.ils(A.val)}</div><a class="btn" href="#/mine" style="margin-top:.5rem">לתיק המלא</a>`)}
    ${autoCard()}
    ${shadowCard()}
    ${aggrCard()}
    ${sec('מה לעשות היום', (sells.length ? sells.map(sellCard).join('') : '') + (buys.length ? buys.slice(0, 3).map((r) => buyCard(r)).join('') + (buys.length > 3 ? `<a class="btn" href="#/buy">עוד ${buys.length - 3} הזדמנויות</a>` : '') : (sells.length ? '' : '<div class="empty">אין היום פעולה מומלצת. לפעמים לא לעשות כלום זו ההחלטה הנכונה.</div>')))}`;
  },
  buy(){
    const buys = D.table.filter((r) => ['STRONG BUY', 'BUY'].includes(r.signal)).sort((a, b) => b.score - a.score);
    const watchOnly = D.table.filter((r) => r.signal === 'WATCH').sort((a, b) => b.score - a.score).slice(0, 6);
    return `<h1>מה לקנות</h1><div class="muted" style="margin-bottom:.8rem">${buys.length} נכסים עם סיגנל קנייה · ${asOfLine()}</div>
    ${buys.length ? buys.map((r) => buyCard(r)).join('') : '<div class="empty">אין כרגע סיגנלי קנייה.</div>'}
    ${watchOnly.length ? sec('כמעט — במעקב', watchOnly.map((r) => buyCard(r, true)).join(''), 'טובות, אבל עוד לא זמן לקנות') : ''}
    <p class="muted">כלל אצבע: לא יותר מ-10% מהתיק בנכס אחד, ולקנות בשניים-שלושה שלבים ולא בבת אחת.</p>`;
  },
  sell(){
    const h = held(); const sells = D.table.filter((r) => h.has(r.symbol) && ['SELL', 'REDUCE'].includes(r.signal));
    const avoid = D.table.filter((r) => !h.has(r.symbol) && r.signal === 'SELL').sort((a, b) => a.score - b.score).slice(0, 8);
    const mine = D.table.filter((r) => h.has(r.symbol) && !['SELL', 'REDUCE'].includes(r.signal));
    return `<h1>מה למכור</h1><div class="muted" style="margin-bottom:.8rem">בודק את מה שיש לך ואת רשימת המעקב</div>
    ${sells.length ? sells.map(sellCard).join('') : '<div class="empty">שום דבר שיש לך לא צריך מכירה כרגע.</div>'}
    ${mine.length ? sec('מה שיש לך — במצב טוב', mine.map((r) => `<div class="row spread" style="padding:.35rem 0;border-bottom:1px solid var(--line)"><a href="#/asset/${esc(r.symbol)}">${esc(nameOf(r))}</a><span class="tag">${esc(SIGNAL_HE[r.signal])}</span></div>`).join('')) : ''}
    ${avoid.length ? sec('להתרחק', avoid.map((r) => `<div class="row spread" style="padding:.35rem 0;border-bottom:1px solid var(--line)"><a href="#/asset/${esc(r.symbol)}">${esc(nameOf(r))}</a><span class="muted" style="font-size:.85rem">${esc(why(r))}</span></div>`).join(''), 'לא לקנות עכשיו') : ''}`;
  },
  mine(){
    const A = acct(); const bal = D.reco?.profiles;
    const prof = settings.get().riskProfile || 'balanced';
    const p = bal?.[prof];
    const pos = (r) => `<div class="card tight" style="margin-bottom:.5rem"><div class="row spread"><a href="#/asset/${esc(r.symbol)}" style="font-weight:700;font-size:1.05rem">${esc(r.nameHe || r.name || r.symbol)}</a><span class="${cls(r.pnlIls)}" style="font-weight:700">${r.pnlIls === null ? '—' : fmt.ils(r.pnlIls) + ' (' + fmt.pct(r.pnlPct, 1, true) + ')'}</span></div>
      <div class="muted" style="font-size:.88rem">${r.qty} יחידות · מחיר ממוצע ${r.currency === 'ILS' ? fmt.num(r.avgPrice) + ' ₪' : '$' + fmt.num(r.avgPrice)} · עכשיו ${r.current === null ? '—' : (r.currency === 'ILS' ? fmt.num(r.current) + ' ₪' : '$' + fmt.num(r.current))} · שווה ${fmt.ils(r.valueIls ?? r.costIls)}</div>
      <div class="row" style="margin-top:.4rem">${r.signal ? `<span class="tag ${['STRONG BUY', 'BUY'].includes(r.signal) ? 'fact' : ['SELL', 'REDUCE'].includes(r.signal) ? 'missing' : ''}">המערכת: ${esc(SIGNAL_HE[r.signal])}</span>` : ''}<button class="btn sm" data-sell="${esc(r.symbol)}" data-qty="${r.qty}">מכירה</button></div></div>`;
    return `<h1>התיק שלי</h1>
    ${sec('החשבון', `<div class="grid g2" style="margin-bottom:.4rem"><div class="kpi"><span class="v">${fmt.ils(A.total)}</span><span class="l">סה"כ שווי</span></div><div class="kpi"><span class="v ${cls(A.pnl)}">${fmt.ils(A.pnl)} <small>(${fmt.pct(A.pnlPct, 1, true)})</small></span><span class="l">רווח / הפסד מההתחלה</span></div><div class="kpi"><span class="v">${fmt.ils(A.cash)}</span><span class="l">מזומן פנוי לקנייה</span></div><div class="kpi"><span class="v">${fmt.ils(A.val)}</span><span class="l">שווי הניירות</span></div></div>
      <div class="muted">התחלת עם ${fmt.ils(A.initial)} · עמלות ששולמו ${fmt.ils(A.fees)} · דולר ${fmt.num(D.usdils, 2)} ₪${A.cash < 0 ? ' · <span class="neg">החשבון בחריגה (קניות מלפני מגבלת המזומן). לחץ "התחל מחדש".</span>' : ''}</div>
      <div class="row" style="margin-top:.5rem"><button class="btn sm ghost" data-reset="1">התחל מחדש עם ${fmt.ils(D.size)}</button></div>`, 'חשבון תרגול')}
    ${sec('מה יש לי', A.rows.length ? A.rows.map(pos).join('') + '<p class="muted">מכירה מחזירה מזומן לחשבון. עמלות כמו בברוקר אמיתי (כ-1$ לפקודה + המרת מטבע).</p>' : '<div class="empty">אין ניירות. עבור ל"לקנות".</div>')}
    ${autoCard(true)}
    ${sec('מה מומלץ לי', p ? `<div class="row" style="margin-bottom:.6rem">${[['conservative', 'בטוח'], ['balanced', 'בינוני'], ['growth', 'צמיחה'], ['aggressive', 'נועז']].map(([k, l]) => `<button class="chip ${k === prof ? 'on' : ''}" data-prof="${k}">${l}</button>`).join('')}</div>
      <table><thead><tr><th>נכס</th><th class="num">אחוז</th><th class="num">סכום</th></tr></thead><tbody>${p.positions.map((x) => `<tr><td>${x.symbol === 'CASH' ? 'מזומן / פיקדון' : `<a href="#/asset/${esc(x.symbol)}">${esc(nameOf(D.by.get(x.symbol) || x))}</a>`}</td><td class="num">${fmt.pct(x.weight, 0)}</td><td class="num">${fmt.ils(x.ils)}</td></tr>`).join('')}</tbody></table>
      <p class="muted">איך היה נראה תיק של ${fmt.ils(D.size)} ברמת סיכון "${esc({ conservative: 'בטוח', balanced: 'בינוני', growth: 'צמיחה', aggressive: 'נועז' }[prof])}": בשנה גרועה הוא עלול לרדת בערך ${fmt.pct(Math.abs(p.risk?.maxDrawdown || 0), 0)}. <a href="#/explain">איך זה נבנה?</a></p>` : '<div class="empty">ההמלצה תופיע אחרי הניתוח היומי.</div>', 'הצעה, לא ייעוץ')}`;
  },
};

export async function render(main, params = {}){
  const view = params.view || 'today';
  main.innerHTML = loading('טוען…');
  try { D = await load(); } catch (e) { main.innerHTML = errorBox(e) + '<p class="muted"><a href="#/settings">בדוק את החיבור בהגדרות</a></p>'; return; }
  main.innerHTML = `<div style="max-width:720px;margin:0 auto">${VIEWS[view] ? VIEWS[view]() : VIEWS.today()}<p class="disclaimer">המערכת מנתחת נתונים ומציעה. היא לא יועץ השקעות. ההחלטה שלך.</p></div>`;
  if (main.__simpleClick) main.removeEventListener('click', main.__simpleClick);
  main.__simpleClick = async (e) => {
    const b = e.target.closest('[data-buy],[data-sell],[data-watch],[data-cancel],[data-prof],[data-reset],[data-auto-run],[data-auto-toggle]'); if (!b) return;
    if (b.dataset.autoToggle !== undefined){ try { await api('/settings', { method: 'POST', body: { autopilot: b.dataset.autoToggle === '1' } }); invalidate(''); toast(b.dataset.autoToggle === '1' ? 'האוטומט הופעל' : 'האוטומט כובה'); render(main, params); } catch (err) { toast(err.message, 'err'); } return; }
    if (b.dataset.autoRun){ b.disabled = true; b.textContent = 'רץ…'; try { const r = await api('/auto/run', { method: 'POST', body: {} }); invalidate(''); toast(r.ran ? (r.orders?.length ? `בוצעו ${r.orders.filter((o) => o.ok).length} פעולות` : 'רץ — אין פעולות היום') : r.reason, r.ran ? 'ok' : 'err', 5000); render(main, params); } catch (err) { toast(err.message, 'err'); render(main, params); } return; }
    if (b.dataset.reset){ if (!confirm(`לאפס את חשבון התרגול ולהתחיל מחדש עם ${fmt.ils(D.size)}? הרישומים הקודמים יישמרו בארכיון.`)) return; try { await api('/paper/reset', { method: 'POST', body: {} }); invalidate(''); toast('החשבון אופס'); render(main, params); } catch (err) { toast(err.message, 'err'); } return; }
    if (b.dataset.prof){ settings.set({ riskProfile: b.dataset.prof }); api('/settings', { method: 'POST', body: { riskProfile: b.dataset.prof } }).then(() => invalidate('')).catch(() => {}); render(main, params); return; }
    if (b.dataset.watch){ try { await api('/watchlist', { method: 'POST', body: { symbol: b.dataset.watch } }); invalidate(''); toast('נוסף למעקב'); render(main, params); } catch (err) { toast(err.message, 'err'); } return; }
    if (b.dataset.cancel){ if (!confirm('למחוק את הרישום הזה?')) return; try { await api('/paper/trade?id=' + b.dataset.cancel, { method: 'DELETE' }); invalidate(''); toast('נמחק'); render(main, params); } catch (err) { toast(err.message, 'err'); } return; }
    const side = b.dataset.buy ? 'buy' : 'sell', sym = b.dataset.buy || b.dataset.sell;
    const r = D.by.get(sym); const held0 = (D.paper?.positions || []).find((p) => p.symbol === sym); const price = r?.price ?? held0?.current ?? held0?.avgPrice;
    const isIls = (r?.currency || held0?.currency) === 'ILS'; const A = acct();
    const suggested = side === 'buy' ? Math.max(1, Math.floor(Math.min(D.size * 0.05, Math.max(0, A.cash) * 0.98) / (isIls ? price : price * D.usdils))) : (+b.dataset.qty || held0?.qty || 1);
    const mm = modal(`<h2>${side === 'buy' ? 'קנייה' : 'מכירה'} — ${esc(nameOf(r || held0 || { symbol: sym }))}</h2><p class="muted">חשבון תרגול. מזומן פנוי: <b>${fmt.ils(A.cash)}</b>${side === 'sell' && held0 ? ` · יש לך ${held0.qty} יחידות` : ''}</p><div class="stack"><label>כמה יחידות? <input id="q" type="number" value="${suggested}" min="1" step="1" style="font-size:1.2rem;width:120px"></label><p id="tot"></p><p class="muted" style="font-size:.85rem">המחיר כאן הוא שער הסגירה האחרון שידוע למערכת${r && barOf(r) ? ' (' + fmt.date(barOf(r)) + ')' : ''}. הביצוע ייעשה לפי השער העדכני ברגע האישור, והוא יוצג לך אחרי הביצוע.</p><div class="row"><button class="btn primary" id="ok" style="font-size:1.05rem">אישור</button><button class="btn" data-close>ביטול</button></div><div id="err" class="neg" style="white-space:pre-wrap"></div></div>`);
    const q = mm.el.querySelector('#q'), tot = mm.el.querySelector('#tot');
    const upd = () => { const n = Math.floor(+q.value || 0); const amt = isIls ? n * price : n * price * D.usdils; tot.innerHTML = `מחיר ליחידה ${isIls ? fmt.num(price) + ' ₪' : '$' + fmt.num(price)} · סה"כ <b>${fmt.ils(amt)}</b> + עמלה משוערת ${fmt.ils(isIls ? Math.max(5, amt * 0.001) : (Math.min(Math.max(1, n * 0.005), n * price * 0.01) + Math.max(2, n * price * 0.00002)) * D.usdils)}${side === 'buy' ? ` (${fmt.pct(amt / D.size, 0)} מהתיק)` + (amt > A.cash ? ' <span class="neg">— יותר מהמזומן הפנוי</span>' : '') : ''}`; };
    q.oninput = upd; upd();
    mm.el.querySelector('#ok').onclick = async () => {
      const ok = mm.el.querySelector('#ok'); ok.disabled = true; ok.textContent = 'שולח…';
      try { const res = await api('/paper/order', { method: 'POST', body: { symbol: sym, side, qty: +q.value, reason: side === 'buy' ? `סיגנל ${r?.signal || ''}` : 'מכירה' } }); invalidate(''); mm.close(); location.hash = '#/mine'; await render(main, { view: 'mine' }); toast(`✓ ${side === 'buy' ? 'נקנה' : 'נמכר'}: ${nameOf(r || { symbol: sym })} במחיר ${fmt.num(res.price)}${res.priceSource?.asOf ? ' (שער מ-' + fmt.dt(res.priceSource.asOf) + ')' : ''}`, 'ok', 6000); }
      catch (err) { ok.disabled = false; ok.textContent = 'אישור'; mm.el.querySelector('#err').textContent = 'לא הצלחתי: ' + err.message + (err.status === 401 ? '\nהאפליקציה לא מחוברת. פתח את קישור החיבור מהמייל.' : ''); }
    };
  };
  main.addEventListener('click', main.__simpleClick);
}
