// ספריית אסטרטגיות (דרישה 6): 20 תבניות פתוחות + האסטרטגיות השמורות של המשתמש (גרסאות, שכפול, ייצוא/ייבוא).
import { esc, fmt, toast, modal } from '../../../js/core/util.js';
import { LIBRARY, CATEGORIES } from '../../../../invest-api/engine/lab/library.js';
import { strategies } from '../store.js';
import { explainBlock, download } from '../ui.js';
import { go } from '../app.js';

export async function render(main, params = {}){
  const cat = params.cat || 'all';
  const saved = strategies.list();
  const tpl = LIBRARY.filter((t) => cat === 'all' || t.category === cat);
  main.innerHTML = `<div class="page-head"><div><h1>ספריית אסטרטגיות</h1><span class="muted">כל תבנית היא נקודת התחלה פתוחה לעריכה — לא נוסחה סגורה. "ערוך" פותח בבונה, "הרץ" מריץ כפי שהיא.</span></div><div class="row"><button class="btn sm" id="exp">ייצוא השמורות</button><label class="btn sm">ייבוא<input type="file" id="imp" accept=".json" hidden></label></div></div>
  <div class="row" style="margin-bottom:.8rem"><a class="chip ${cat === 'all' ? 'on' : ''}" href="#/library">הכול (${LIBRARY.length})</a>${Object.entries(CATEGORIES).map(([k, l]) => `<a class="chip ${cat === k ? 'on' : ''}" href="#/library?cat=${k}">${esc(l)} (${LIBRARY.filter((t) => t.category === k).length})</a>`).join('')}</div>
  <h2>האסטרטגיות שלי (${saved.length})</h2>
  ${saved.length ? `<div class="lib" style="margin-bottom:1.2rem">${saved.map((s) => `<div class="card"><h3>${esc(s.name)} <span class="tag">v${s.version}</span></h3><p>${esc(s.spec.description || '').slice(0, 200)}<br><span class="muted">עודכן ${fmt.ago(s.updatedAt)}${s.templateId ? ` · מבוסס על ${esc(s.templateId)}` : ''}</span></p><div class="row"><a class="btn sm primary" href="#/backtest?id=${s.id}">▶ הרץ</a><a class="btn sm" href="#/builder?id=${s.id}">ערוך</a><button class="btn sm" data-dup="${s.id}">שכפל</button>${s.versions.length ? `<button class="btn sm" data-ver="${s.id}">גרסאות (${s.versions.length})</button>` : ''}<button class="btn sm" data-x="${s.id}">הסבר</button><button class="btn sm ghost" data-del="${s.id}">מחק</button></div></div>`).join('')}</div>` : '<div class="empty" style="margin-bottom:1.2rem">עדיין אין אסטרטגיות שמורות. בחר תבנית, ערוך ושמור.</div>'}
  <h2>תבניות (${tpl.length})</h2>
  <div class="lib">${tpl.map((t) => `<div class="card"><h3>${esc(t.name)} <span class="tag model">${esc(CATEGORIES[t.category])}</span></h3><p>${esc(t.description)}</p><div class="muted">פרמטרים לאופטימיזציה: ${Object.values(t.params).map((p) => esc(p.label)).join(', ') || '—'}</div><div class="row"><a class="btn sm primary" href="#/backtest?template=${t.id}">▶ הרץ</a><a class="btn sm" href="#/builder?template=${t.id}">ערוך</a><a class="btn sm" href="#/optimize?template=${t.id}">אופטימיזציה</a><button class="btn sm" data-xt="${t.id}">הסבר</button></div></div>`).join('')}</div>`;
  main.querySelectorAll('[data-xt]').forEach((b) => { b.onclick = () => { const t = LIBRARY.find((x) => x.id === b.dataset.xt); modal(`<h3>${esc(t.name)}</h3>${explainBlock(t.spec)}<div class="row" style="margin-top:.6rem"><button class="btn" data-close>סגור</button></div>`); }; });
  main.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => { const s = strategies.get(b.dataset.x); modal(`<h3>${esc(s.name)}</h3>${explainBlock(s.spec)}<div class="row" style="margin-top:.6rem"><button class="btn" data-close>סגור</button></div>`); }; });
  main.querySelectorAll('[data-dup]').forEach((b) => { b.onclick = () => { strategies.duplicate(b.dataset.dup); toast('שוכפל'); render(main, params); }; });
  main.querySelectorAll('[data-del]').forEach((b) => { b.onclick = () => { if (confirm('למחוק את האסטרטגיה? הגרסאות יימחקו גם הן.')){ strategies.remove(b.dataset.del); render(main, params); } }; });
  main.querySelectorAll('[data-ver]').forEach((b) => { b.onclick = () => { const s = strategies.get(b.dataset.ver); const m = modal(`<h3>גרסאות של ${esc(s.name)}</h3><div class="table-wrap compact"><table><thead><tr><th>גרסה</th><th>נשמרה</th><th>הערה</th><th></th></tr></thead><tbody>${s.versions.slice().reverse().map((v) => `<tr><td>v${v.v}</td><td>${fmt.dt(v.savedAt)}</td><td>${esc(v.note || '')}</td><td><button class="btn sm" data-r="${v.v}">שחזר</button></td></tr>`).join('')}</tbody></table></div><div class="row" style="margin-top:.6rem"><button class="btn" data-close>סגור</button></div>`); m.el.querySelectorAll('[data-r]').forEach((x) => { x.onclick = () => { strategies.restore(s.id, +x.dataset.r); m.close(); toast('שוחזר כגרסה חדשה'); render(main, params); }; }); }; });
  main.querySelector('#exp').onclick = () => download('lab-strategies.json', strategies.exportAll(), 'application/json');
  main.querySelector('#imp').onchange = async (e) => { const f = e.target.files[0]; if (!f) return; try { const n = strategies.importAll(await f.text()); toast(`יובאו — ${n} אסטרטגיות בסך הכול`); render(main, params); } catch (err) { toast(err.message, 'err'); } };
}
