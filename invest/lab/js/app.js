// שלד המעבדה: ניתוב hash, ניווט, ערכת נושא (משותפת לאפליקציית invest), מצב הנתונים.
import { $, esc } from '../../js/core/util.js';
import { settings } from '../../js/core/store.js';
import { call } from './engine.js';
import { labSettings } from './store.js';

const ROUTES = { '': () => import('./screens/dashboard.js'), dashboard: () => import('./screens/dashboard.js'), builder: () => import('./screens/builder.js'), library: () => import('./screens/library.js'), scanner: () => import('./screens/scanner.js'), backtest: () => import('./screens/backtest.js'), compare: () => import('./screens/compare.js'), optimize: () => import('./screens/optimize.js'), trades: () => import('./screens/trades.js'), ai: () => import('./screens/ai.js'), data: () => import('./screens/data.js') };
const NAV = [['dashboard', '📊 Dashboard'], ['builder', '🧩 בונה אסטרטגיות'], ['library', '📚 ספריית אסטרטגיות'], ['scanner', '🔎 סורק היסטורי'], ['backtest', '🧪 Backtesting'], ['compare', '⚖️ השוואות'], ['optimize', '🎛️ אופטימיזציה'], ['trades', '📒 ניתוח עסקאות'], ['ai', '🤖 מחקר AI'], ['data', '🗄️ נתונים ומקורות']];
const BOTTOM = [['dashboard', '📊', 'ראשי'], ['builder', '🧩', 'בונה'], ['backtest', '🧪', 'בדיקה'], ['library', '📚', 'ספרייה'], ['ai', '🤖', 'AI']];
export const state = { lastRun: null, manifest: null };
export function parse(){ const h = location.hash.replace(/^#\/?/, ''); const [path, qs] = h.split('?'); return { route: path.split('/')[0] || '', params: Object.fromEntries(new URLSearchParams(qs || '')) }; }
export const go = (route, params = {}) => { const qs = new URLSearchParams(params).toString(); location.hash = `#/${route}${qs ? '?' + qs : ''}`; };
async function navigate(){
  const { route, params } = parse();
  $('#overlay').innerHTML = ''; $('#sidenav').classList.remove('open');
  document.querySelectorAll('.sidenav a, .bottombar a').forEach((a) => a.classList.toggle('active', a.dataset.r === (route || 'dashboard')));
  const main = $('#main'), loader = ROUTES[route];
  if (!loader){ main.innerHTML = '<div class="empty">הדף לא נמצא</div>'; return; }
  try { const mod = await loader(); await mod.render(main, params); window.scrollTo(0, 0); }
  catch (e) { main.innerHTML = `<div class="blocked">שגיאה בטעינת הדף: ${esc(e.message)}</div>`; console.error(e); }
}
function buildNav(){ $('#sidenav').innerHTML = NAV.map(([r, l]) => `<a href="#/${r}" data-r="${r}">${esc(l)}</a>`).join('') + `<div class="sep">מחקר בלבד</div><div class="muted" style="padding:.4rem .7rem;font-size:.78rem">Backtest אינו תחזית. אין מסחר אמיתי. הצלחה היסטורית ≠ הבטחה לרווח.</div>`; const bb = document.createElement('nav'); bb.className = 'bottombar'; bb.innerHTML = BOTTOM.map(([r, i, l]) => `<a href="#/${r}" data-r="${r}"><span>${i}</span>${esc(l)}</a>`).join(''); document.body.appendChild(bb); }
function theme(){ const t = settings.get().theme || 'light'; document.documentElement.dataset.theme = t; $('#themeBtn').onclick = () => { settings.set({ theme: t === 'dark' ? 'light' : 'dark' }); theme(); }; }
export async function dataStatus(force = false){
  const dot = $('#dataStatus .status-dot');
  try { const r = await call('manifest', { force }); state.manifest = r; dot.className = 'status-dot ' + (r.coverage?.pointInTime ? 'ok' : 'warn'); $('#dataStatus').title = `נתונים: ${r.manifest.provider || ''} · נבנו ${(r.manifest.builtAt || '').slice(0, 10)} · ${r.manifest.symbolCount} ניירות`; return r; }
  catch (e) { dot.className = 'status-dot bad'; $('#dataStatus').title = 'אין מערך נתונים: ' + e.message; state.manifest = null; return null; }
}
buildNav(); theme();
$('#menuBtn').onclick = () => $('#sidenav').classList.toggle('open');
window.addEventListener('hashchange', navigate);
navigate(); dataStatus();
