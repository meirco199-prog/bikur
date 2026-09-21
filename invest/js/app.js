// שלד האפליקציה: ניתוב hash, ניווט, חיפוש, ערכת נושא, בדיקת חיבור, polling התראות.
import { api, health } from './core/api.js';
import { settings } from './core/store.js';
import { $, esc, debounce } from './core/util.js';
import { pollAlerts } from './screens/alerts.js';

const ROUTES = {
  '': () => import('./screens/simple.js'), today: () => import('./screens/simple.js'), buy: () => import('./screens/simple.js'), sell: () => import('./screens/simple.js'), mine: () => import('./screens/simple.js'), more: () => import('./screens/more.js'), explain: () => import('./screens/explain.js'), dashboard: () => import('./screens/dashboard.js'), search: () => import('./screens/search.js'), asset: () => import('./screens/asset.js'), watchlist: () => import('./screens/watchlist.js'),
  opportunities: () => import('./screens/opportunities.js'), portfolio: () => import('./screens/portfolio.js'), signals: () => import('./screens/signals.js'), regime: () => import('./screens/regime.js'), backtest: () => import('./screens/backtest.js'),
  asof: () => import('./screens/asof.js'), paper: () => import('./screens/paper.js'), alerts: () => import('./screens/alerts.js'), assistant: () => import('./screens/assistant.js'), settings: () => import('./screens/settings.js'), tracks: () => import('./screens/tracks.js'),
};
const NAV = [['', '🏠 היום'], ['buy', '🟢 לקנות'], ['sell', '🔴 למכור'], ['mine', '💼 התיק שלי'], ['more', '⋯ עוד'], ['sep', 'עוד'], ['search', '🔍 חיפוש'], ['watchlist', '⭐ מעקב'], ['explain', '📖 איך זה עובד'], ['assistant', '🤖 שאל את המערכת'], ['settings', '⚙️ הגדרות'], ['sep', 'מקצועי'], ['dashboard', '📊 תמונת מצב מלאה'], ['opportunities', '🎯 הזדמנויות'], ['signals', '🚦 סיגנלים'], ['portfolio', '📐 בניית תיק'], ['regime', '🌡️ מצב השוק'], ['backtest', '🧪 בדיקה היסטורית'], ['asof', '⏳ מסע בזמן'], ['paper', '🧾 תיק וירטואלי'], ['tracks', '🧪 השוואת מסלולים'], ['alerts', '🔔 התראות']];
const BOTTOM = [['', '🏠', 'היום'], ['buy', '🟢', 'לקנות'], ['sell', '🔴', 'למכור'], ['mine', '💼', 'התיק שלי'], ['more', '⋯', 'עוד']];

function parse(){ const h = location.hash.replace(/^#\/?/, ''); const [path, qs] = h.split('?'); const parts = path.split('/'); const params = Object.fromEntries(new URLSearchParams(qs || '')); if (parts[0] === 'asset' && parts[1]) params.symbol = decodeURIComponent(parts[1]); if (['buy', 'sell', 'mine', 'today'].includes(parts[0])) params.view = parts[0]; return { route: parts[0] || '', params }; }
async function navigate(){
  const { route, params } = parse();
  document.getElementById('overlay').innerHTML = ''; // מודל פתוח לא נשאר בין מסכים
  $('#sidenav').classList.remove('open');
  document.querySelectorAll('.sidenav a, .bottombar a').forEach((a) => a.classList.toggle('active', a.dataset.r === (route === 'today' ? '' : route)));
  const main = $('#main');
  const loader = ROUTES[route];
  if (!loader){ main.innerHTML = '<div class="empty">הדף לא נמצא</div>'; return; }
  try { const mod = await loader(); await mod.render(main, params); window.scrollTo(0, 0); }
  catch (e) { main.innerHTML = `<div class="empty" style="border-color:var(--neg)">שגיאה בטעינת הדף: ${esc(e.message)}</div>`; console.error(e); }
}
function buildNav(){ $('#sidenav').innerHTML = NAV.map(([r, l]) => (r === 'sep' ? `<div class="sep">${esc(l)}</div>` : `<a href="#/${r}" data-r="${r}">${esc(l)}</a>`)).join(''); const bb = document.createElement('nav'); bb.className = 'bottombar'; bb.innerHTML = BOTTOM.map(([r, i, l]) => `<a href="#/${r}" data-r="${r}"><span>${i}</span>${esc(l)}</a>`).join(''); document.body.appendChild(bb); }
function theme(){ const t = settings.get().theme || 'light'; document.documentElement.dataset.theme = t; $('#themeBtn').onclick = () => { settings.set({ theme: t === 'dark' ? 'light' : 'dark' }); theme(); }; }
function search(){
  const input = $('#searchInput'), res = $('#searchResults');
  const go = debounce(async () => { const q = input.value.trim(); if (!q){ res.classList.add('hidden'); return; } try { const r = await api('/search?q=' + encodeURIComponent(q), { ttl: 60000 }); const items = r.items.slice(0, 12); res.innerHTML = (items.length ? items.map((a) => `<div data-s="${esc(a.symbol)}"><span><b>${esc(a.symbol)}</b> <span class="muted">${esc(a.name || '')}</span></span><span class="muted">${esc(a.type || '')} ${esc(a.country || '')}</span></div>`).join('') : '') + (/^[A-Z0-9.^\-]{1,12}$/i.test(q) ? `<div data-s="${esc(q.toUpperCase())}"><span>פתח <b>${esc(q.toUpperCase())}</b> ישירות</span></div>` : ''); res.classList.remove('hidden'); } catch { res.classList.add('hidden'); } }, 200);
  input.addEventListener('input', go); input.addEventListener('focus', go);
  res.addEventListener('click', (e) => { const d = e.target.closest('[data-s]'); if (!d) return; location.hash = '#/asset/' + d.dataset.s; res.classList.add('hidden'); input.value = ''; });
  document.addEventListener('click', (e) => { if (!e.target.closest('#search')) res.classList.add('hidden'); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && input.value.trim()){ location.hash = '#/asset/' + input.value.trim().toUpperCase(); res.classList.add('hidden'); input.value = ''; } });
}
async function apiStatus(){ const h = await health(); const dot = $('#apiStatus .status-dot'); dot.className = 'status-dot ' + (h.ok ? (h.auth === 'token' ? 'ok' : 'warn') : 'bad'); $('#apiStatus').title = h.ok ? `API v${h.version} · ${h.auth}` : h.error || 'אין חיבור'; }
buildNav(); theme(); search();
$('#menuBtn').onclick = () => $('#sidenav').classList.toggle('open');
window.addEventListener('hashchange', navigate);
navigate(); apiStatus(); setInterval(apiStatus, 60000);
pollAlerts(); setInterval(pollAlerts, 5 * 60000);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
