// המסך הפשוט (ברירת מחדל): מצב · מה לקנות · מה למכור · התיק שלי. עברית בלבד, בלי מונחים.
import { api, invalidate } from '../core/api.js';
import { settings } from '../core/store.js';
import { esc, fmt, isNum, cls, toast, modal, SIGNAL_HE, REGIME_HE, nameOf } from '../core/util.js';
import { loading, errorBox, scoreBar } from '../ui/components.js';

const plain = (s) => {
  // משפט אחד בעברית פשוטה מתוך רכיבי הציון
  const c = s.components || {}; const good = [], bad = [];
  const say = (k, g, b) => { const v = c[k]; if (!isNum(v)) return; if (v >= 70) good.push(g); else if (v <= 40) bad.push(b); };
  say('fundamental', 'חברה רווחית ויציבה', 'רווחיות חלשה'); say('valuation', 'המחיר סביר ביחס לשווי', 'המחיר יקר ביחס לשווי'); say('growth', 'צומחת', 'לא צומחת'); say('technical', 'המגמה עולה', 'המגמה יורדת'); say('momentum', 'תנופה חיובית', 'תנופה שלילית'); say('risk', 'סיכון נמוך יחסית', 'תנודתית ומסוכנת');
  return (good.length ? 'בעד: ' + good.slice(0, 3).join(', ') + '. ' : '') + (bad.length ? 'נגד: ' + bad.slice(0, 2).join(', ') + '.' : '');
};
const money = (x, cur) => (cur === 'ILS' ? `${fmt.num(x)} ₪` : `$${fmt.num(x)}`);

export async function render(main){
  main.innerHTML = loading('טוען את התמונה של היום…');
  let regime, rank, watch, paper, reco;
  try { [regime, rank, watch, paper, reco] = await Promise.all([api('/regime', { ttl: 60000 }), api('/rank', { ttl: 60000 }), api('/watchlist', { ttl: 30000 }), api('/paper', { ttl: 30000 }), api('/reco', { ttl: 60000 })]); }
  catch (e) { main.innerHTML = errorBox(e) + '<p class="muted"><a href="#/settings">בדוק את החיבור בהגדרות</a></p>'; return; }
  const table = rank?.table || [];
  const by = new Map(table.map((r) => [r.symbol, r]));
  const buys = table.filter((r) => ['STRONG BUY', 'BUY'].includes(r.signal)).sort((a, b) => b.score - a.score).slice(0, 8);
  const held = new Set([...(paper?.open || []).map((p) => p.symbol), ...(watch?.items || []).map((w) => w.symbol)]);
  const sells = table.filter((r) => held.has(r.symbol) && ['SELL', 'REDUCE'].includes(r.signal));
  const weak = table.filter((r) => !held.has(r.symbol) && r.signal === 'SELL').slice(0, 5);
  const mood = regime?.risk ? `${REGIME_HE[regime.trend] || regime.trend} · ${REGIME_HE[regime.risk] || regime.risk}` : 'אין נתונים';
  const moodText = !regime?.risk ? '' : regime.trend === 'Bull Trend' && regime.risk === 'Risk On' ? 'השוק בעלייה והמשקיעים מוכנים לקחת סיכון. זמן סביר להיכנס בהדרגה, לא בבת אחת.' : regime.trend === 'Bear Trend' ? 'השוק בירידה. עדיף להמתין עם קניות חדשות ולהחזיק יותר מזומן.' : regime.risk === 'Risk Off' ? 'המשקיעים בורחים מסיכון. להיזהר, להקטין פוזיציות תנודתיות.' : 'שוק מעורב. לקנות רק מה שמקבל סיגנל ברור, ובסכומים קטנים.';
  const size = settings.get().portfolioSize || 200000;
  const bal = reco?.profiles?.balanced;
  const card = (title, body, sub = '') => `<section class="card"><h3>${esc(title)} ${sub ? `<span class="muted">${esc(sub)}</span>` : ''}</h3>${body}</section>`;
  const buyRow = (r) => `<div class="card tight" style="margin-bottom:.5rem"><div class="row spread"><div><a href="#/asset/${esc(r.symbol)}"><b style="font-size:1.05rem">${esc(nameOf(r))}</b></a> <span class="muted">${esc(r.symbol)} · ${esc(r.sector || '')}</span></div><div class="row"><span class="num">${money(r.price, r.currency)}</span>${scoreBar(r.score)}</div></div>
    <div style="margin:.3rem 0">${esc(plain(r))}</div>
    <div class="row muted" style="font-size:.85rem">${r.mos != null ? (r.mos >= 0 ? `<span class="pos">מרווח ביטחון ${fmt.pct(r.mos, 0)} מתחת לשווי המוערך</span>` : `<span class="warn">המחיר ${fmt.pct(-r.mos, 0)} מעל השווי המוערך</span>`) : ''}<span>סיכון: ${esc(r.riskLevel || '—')}</span>${r.nextEarnings ? `<span>דוח הבא ${fmt.date(r.nextEarnings)}</span>` : ''}</div>
    <div class="row" style="margin-top:.4rem"><button class="btn sm primary" data-buy="${esc(r.symbol)}" data-price="${r.price}">קנייה (וירטואלית)</button><button class="btn sm" data-watch="${esc(r.symbol)}">${held.has(r.symbol) ? 'במעקב ✓' : 'הוסף למעקב'}</button><a class="btn sm ghost" href="#/asset/${esc(r.symbol)}">למה? פרטים</a></div></div>`;
  const sellRow = (r) => `<div class="card tight" style="margin-bottom:.5rem;border-color:var(--neg)"><div class="row spread"><div><a href="#/asset/${esc(r.symbol)}"><b>${esc(nameOf(r))}</b></a> <span class="muted">${esc(r.symbol)}</span></div><span class="sig sig-${esc(r.signal.replace(' ', '_'))}">${esc(SIGNAL_HE[r.signal])}</span></div><div>${esc(plain(r))}</div>${(paper?.open || []).some((p) => p.symbol === r.symbol) ? `<button class="btn sm danger" data-sell="${esc(r.symbol)}" style="margin-top:.4rem">מכירה (וירטואלית)</button>` : ''}</div>`;
  const pos = paper?.open || [];
  main.innerHTML = `
  <div class="page-head"><div><h1>היום</h1><span class="muted">נכון ל-${esc(rank?.date || '—')} · ${table.length ? `${table.length} נכסים נבדקו` : 'אין עדיין ניתוח להיום'}</span></div><a class="btn ghost sm" href="#/dashboard">מצב מתקדם →</a></div>
  ${card('מצב השוק', regime?.risk ? `<div class="row"><span class="tag ${regime.risk === 'Risk On' ? 'fact' : regime.risk === 'Risk Off' ? 'missing' : ''}" style="font-size:1rem">${esc(mood)}</span></div><p>${esc(moodText)}</p><p class="muted">S&P 500: ${regime.inputs?.spx ? (regime.inputs.spx.aboveSma200 ? 'מעל הממוצע השנתי (חיובי)' : 'מתחת לממוצע השנתי (שלילי)') : '—'}${isNum(regime.inputs?.vix) ? ` · מדד הפחד VIX: ${fmt.num(regime.inputs.vix, 0)} (${regime.inputs.vix < 20 ? 'רגוע' : regime.inputs.vix < 30 ? 'מתוח' : 'פאניקה'})` : ''}${isNum(regime.inputs?.usdils) ? ` · דולר: ${fmt.num(regime.inputs.usdils, 2)} ₪` : ''}</p>` : '<div class="empty">אין נתוני שוק עדיין</div>')}
  ${card('מה לקנות עכשיו', buys.length ? buys.map(buyRow).join('') + '<p class="muted">רק נכסים שקיבלו סיגנל קנייה. כניסה בהדרגה, לא יותר מ-10% מהתיק לנכס אחד.</p>' : `<div class="empty">אין כרגע סיגנלי קנייה ברורים. ${table.length ? 'זה בסדר, לפעמים הכי נכון לחכות.' : 'הניתוח היומי עוד לא רץ.'}</div>`, buys.length ? `${buys.length} סיגנלים` : '')}
  ${card('מה למכור או להקטין', sells.length ? sells.map(sellRow).join('') : `<div class="empty">אין נכס ברשימת המעקב או בתיק הווירטואלי שקיבל סיגנל מכירה.</div>${weak.length ? `<p class="muted">נכסים בשוק שכדאי להתרחק מהם כרגע: ${weak.map((r) => esc(nameOf(r))).join(', ')}</p>` : ''}`)}
  ${card('התיק שלי (וירטואלי)', pos.length ? `<table><thead><tr><th>נכס</th><th class="num">כמות</th><th class="num">קניתי ב-</th><th class="num">עכשיו</th><th class="num">רווח/הפסד</th><th></th></tr></thead><tbody>${pos.map((p) => `<tr><td><a href="#/asset/${esc(p.symbol)}">${esc(nameOf(by.get(p.symbol) || { symbol: p.symbol }))}</a></td><td class="num">${p.qty}</td><td class="num">${fmt.num(p.price)}</td><td class="num">${fmt.num(p.current)}</td><td class="num ${cls(p.pnl)}">${fmt.usd(p.pnl)} (${fmt.pct(p.pnlPct, 1, true)})</td><td class="row"><button class="btn sm" data-sell="${esc(p.symbol)}">מכור</button><button class="btn sm ghost" data-cancel="${esc(p.id)}" title="מחיקת רישום (טעות או כפילות)">בטל רישום</button></td></tr>`).join('')}</tbody></table><p class="muted">${pos.length} רישומים · הקנייה האחרונה: ${fmt.dt(pos[pos.length - 1]?.date)}</p><p class="muted">שווי ${fmt.usd(paper.marketValue)} · רווח לא ממומש <span class="${cls(paper.unrealized)}">${fmt.usd(paper.unrealized)}</span> · ממומש <span class="${cls(paper.realized)}">${fmt.usd(paper.realized)}</span></p>` : '<div class="empty">התיק הווירטואלי ריק. לחץ "קנייה (וירטואלית)" על נכס כדי לעקוב אחרי ביצועי המערכת בלי כסף אמיתי.</div>')}
  ${card(`איך הייתי מחלק ${fmt.ils(size)} היום`, bal ? `<table><thead><tr><th>נכס</th><th class="num">אחוז</th><th class="num">סכום</th></tr></thead><tbody>${bal.positions.map((x) => `<tr><td>${x.symbol === 'CASH' ? '<b>מזומן / פיקדון</b>' : `<a href="#/asset/${esc(x.symbol)}">${esc(nameOf(by.get(x.symbol) || x))}</a> <span class="muted">${esc(x.symbol)}</span>`}</td><td class="num">${fmt.pct(x.weight, 0)}</td><td class="num">${fmt.ils(x.ils)}</td></tr>`).join('')}</tbody></table><p class="muted">תיק "מאוזן": תנודתיות צפויה ${fmt.pct(bal.risk?.volatility, 0)} בשנה, ירידה זמנית אפשרית של ${fmt.pct(bal.risk?.maxDrawdown, 0)}. <a href="#/portfolio">פרופילים אחרים (שמרני / צמיחה / אגרסיבי) →</a></p>` : '<div class="empty">התיק המומלץ ייבנה אחרי הניתוח היומי.</div>', 'הצעה, לא ייעוץ')}
  <p class="disclaimer">כל הסיגנלים הם תוצאה של מודל מחשב שמנתח נתונים, לא ייעוץ השקעות. הכסף שלך, ההחלטה שלך.</p>`;
  if (main.__simpleClick) main.removeEventListener('click', main.__simpleClick);
  main.__simpleClick = async (e) => {
    const b = e.target.closest('[data-buy],[data-sell],[data-watch],[data-cancel]'); if (!b) return;
    if (b.dataset.cancel){ if (!confirm('למחוק את הרישום הזה מהתיק הווירטואלי?')) return; try { await api('/paper/trade?id=' + b.dataset.cancel, { method: 'DELETE' }); invalidate(''); toast('הרישום נמחק'); render(main); } catch (err) { toast(err.message, 'err'); } return; }
    if (b.dataset.watch){ try { await api('/watchlist', { method: 'POST', body: { symbol: b.dataset.watch } }); invalidate(''); toast('נוסף למעקב'); render(main); } catch (err) { toast(err.message, 'err'); } return; }
    const side = b.dataset.buy ? 'buy' : 'sell', sym = b.dataset.buy || b.dataset.sell;
    const price = +b.dataset.price || by.get(sym)?.price;
    const suggested = price && side === 'buy' ? Math.max(1, Math.floor((size * 0.05) / (by.get(sym)?.currency === 'ILS' ? price : price * 3.7))) : (pos.find((p) => p.symbol === sym)?.qty || 1);
    const mm = modal(`<h2>${side === 'buy' ? 'קנייה' : 'מכירה'} וירטואלית — ${esc(nameOf(by.get(sym) || { symbol: sym }))}</h2><p class="muted">זה תרגול: לא זז כסף אמיתי. המערכת תעקוב אם ההחלטה הייתה טובה.</p><div class="stack"><label>כמות <input id="q" type="number" value="${suggested}" min="1"></label><p class="muted">מחיר נוכחי ${fmt.num(price)} · סה"כ כ-${fmt.num(price * suggested, 0)} ${by.get(sym)?.currency === 'ILS' ? '₪' : '$'}${side === 'buy' ? ' (כ-5% מהתיק)' : ''}</p><div class="row"><button class="btn primary" id="ok">אישור</button><button class="btn" data-close>ביטול</button></div><div id="err" class="neg" style="white-space:pre-wrap"></div></div>`);
    mm.el.querySelector('#ok').onclick = async () => {
      const ok = mm.el.querySelector('#ok'); ok.disabled = true; ok.textContent = 'שולח…';
      try { const r = await api('/paper/order', { method: 'POST', body: { symbol: sym, side, qty: +mm.el.querySelector('#q').value, reason: side === 'buy' ? `סיגנל ${by.get(sym)?.signal || ''}` : 'מכירה מהמסך הפשוט' } }); invalidate(''); mm.close(); await render(main); const sec = [...main.querySelectorAll('section.card')].find((x) => x.textContent.includes('התיק שלי')); if (sec){ sec.style.borderColor = 'var(--pos)'; sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); sec.insertAdjacentHTML('afterbegin', `<div class="tag fact" style="font-size:.95rem;margin-bottom:.5rem">✓ ${side === 'buy' ? 'נרשם' : 'נמכר'}: ${esc(nameOf(by.get(sym) || { symbol: sym }))} במחיר ${fmt.num(r.price)} (${esc(r.priceSource?.source || '')})</div>`); } }
      catch (err) { ok.disabled = false; ok.textContent = 'אישור'; const s = settings.get(); mm.el.querySelector('#err').textContent = 'לא הצלחתי לרשום: ' + err.message + (err.status === 401 ? '\nהאפליקציה לא מחוברת עם הטוקן. פתח שוב את קישור החיבור מהמייל, או הדבק את הטוקן בהגדרות.' : err.status === 0 ? '\nאין חיבור לשרת. בדוק אינטרנט.' : '') + (!s.token ? '\n(לא שמור טוקן במכשיר הזה)' : ''); }
    };
  };
  main.addEventListener('click', main.__simpleClick);
}
