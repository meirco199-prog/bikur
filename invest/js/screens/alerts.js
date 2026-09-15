// Alert Engine: כללים, לוג, ערוצים, התראות דפדפן.
import { api, invalidate } from '../core/api.js';
import { settings } from '../core/store.js';
import { esc, fmt, toast, modal } from '../core/util.js';
import { loading, errorBox, symLink } from '../ui/components.js';

export async function render(main){
  main.innerHTML = loading();
  let rules, log, types, st;
  try { [rules, log, types, st] = await Promise.all([api('/alerts/rules'), api('/alerts/log'), api('/alerts/types', { ttl: 600000 }), api('/settings', { ttl: 60000 })]); } catch (e) { main.innerHTML = errorBox(e); return; }
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  main.innerHTML = `<div class="page-head"><div><h1>התראות</h1><span class="muted">כל התראה: מה קרה · למה זה חשוב · מה השתנה. Cooldown נגד spam.</span></div><div class="row"><button class="btn" id="notif">${perm === 'granted' ? '🔔 התראות דפדפן פעילות' : '🔕 הפעל התראות דפדפן'}</button><button class="btn" id="test">בדיקת Telegram/Email</button><button class="btn primary" id="add">＋ כלל</button></div></div>
  <div class="grid g-1-2"><section class="card"><h3>כללים (${rules.length})</h3><p class="muted">ברירת מחדל לרשימת המעקב: שינוי סיגנל ${st.alertDefaults?.signalChange !== false ? '✔' : '✖'} · חדשות מהותיות ${st.alertDefaults?.materialNews !== false ? '✔' : '✖'} · ערוצים: ${esc((st.alertChannels || []).join(', '))} (<a href="#/settings">הגדרות</a>)</p>${rules.length ? `<table><thead><tr><th>נכס</th><th>סוג</th><th>פרמטרים</th><th>ערוצים</th><th></th></tr></thead><tbody>${rules.map((r) => `<tr><td>${r.symbol === '*' ? '<b>הכול</b>' : symLink(r.symbol)}</td><td>${esc(types[r.type]?.label || r.type)}</td><td class="num muted">${esc(JSON.stringify(r.params || {}))}</td><td>${(r.channels || []).map((c) => `<span class="tag">${esc(c)}</span>`).join(' ')}</td><td><button class="btn sm ghost" data-del="${esc(r.id)}">✕</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">אין כללים מותאמים</div>'}</section>
  <section class="card"><h3>לוג (14 ימים)</h3>${log.length ? log.map((a) => `<div class="card tight" style="margin-bottom:.5rem"><div class="row spread"><b>${symLink(a.symbol)} · ${esc(a.label || a.type)}</b><span class="muted">${fmt.dt(a.ts)}</span></div><div><b>מה קרה:</b> ${esc(a.what)}</div><div><b>למה זה חשוב:</b> ${esc(a.why)}</div><div><b>מה השתנה:</b> ${esc(a.changed)}</div><div class="muted">ערוצים: ${esc(Object.entries(a.channels || {}).map(([k, v]) => `${k}: ${v}`).join(' · '))}</div></div>`).join('') : '<div class="empty">אין התראות</div>'}</section></div>`;
  main.querySelector('#notif').onclick = async () => { if (!('Notification' in window)) return toast('הדפדפן לא תומך', 'err'); const p = await Notification.requestPermission(); settings.set({ notifications: p === 'granted' }); toast(p === 'granted' ? 'התראות דפדפן פעילות (כשהאפליקציה פתוחה)' : 'לא אושר'); render(main); };
  main.querySelector('#test').onclick = async () => { try { const r = await api('/alerts/test', { method: 'POST', body: { channels: ['telegram', 'email'] } }); toast('Telegram: ' + r.channels.telegram + ' · Email: ' + r.channels.email); } catch (e) { toast(e.message, 'err'); } };
  main.querySelector('#add').onclick = () => { const mm = modal(`<h2>כלל התראה</h2><div class="stack"><label>נכס (או * לכולם) <input id="s" value="*"></label><select id="t">${Object.entries(types).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select><label>פרמטרים JSON <input id="p" value="{}"></label><div class="row"><label><input type="checkbox" value="browser" checked> דפדפן</label><label><input type="checkbox" value="telegram"> Telegram</label><label><input type="checkbox" value="email"> Email</label></div><label>Cooldown (שעות) <input id="c" type="number" value="24"></label><div class="row"><button class="btn primary" id="ok">שמור</button><button class="btn" data-close>ביטול</button></div></div>`); mm.el.querySelector('#t').onchange = () => { mm.el.querySelector('#p').value = JSON.stringify(types[mm.el.querySelector('#t').value].params || {}); }; mm.el.querySelector('#t').onchange(); mm.el.querySelector('#ok').onclick = async () => { try { await api('/alerts/rules', { method: 'POST', body: { symbol: mm.el.querySelector('#s').value.trim().toUpperCase(), type: mm.el.querySelector('#t').value, params: JSON.parse(mm.el.querySelector('#p').value || '{}'), channels: [...mm.el.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value), cooldownH: +mm.el.querySelector('#c').value } }); mm.close(); toast('נשמר'); render(main); } catch (e) { toast(e.message, 'err'); } }; };
  main.addEventListener('click', async (e) => { const b = e.target.closest('[data-del]'); if (!b) return; try { await api('/alerts/rules?id=' + b.dataset.del, { method: 'DELETE' }); toast('נמחק'); render(main); } catch (err) { toast(err.message, 'err'); } });
}
// בדיקה תקופתית של התראות חדשות → Notification API (כשהאפליקציה פתוחה)
export async function pollAlerts(){
  try {
    const s = settings.get(); if (!s.notifications || !('Notification' in window) || Notification.permission !== 'granted') return;
    const log = await api('/alerts/log'); const last = s.lastAlertSeen || '';
    const fresh = log.filter((a) => a.ts > last).slice(0, 3);
    for (const a of fresh) new Notification(`${a.symbol}: ${a.label || a.type}`, { body: `${a.what}\n${a.why}`, tag: a.id });
    if (log[0]) settings.set({ lastAlertSeen: log[0].ts });
  } catch {}
}
