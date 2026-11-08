// לקוח ל-Web Worker של המעבדה: הרצה עם התקדמות, ביטול (terminate + Worker חדש), תור בקשות.
import { labSettings } from './store.js';
import { $ } from '../../js/core/util.js';

let worker = null, seq = 0; const pending = new Map();
function spawn(){ worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }); worker.onmessage = (e) => { const { id, type } = e.data; const p = pending.get(id); if (!p) return; if (type === 'progress'){ p.onProgress?.(e.data); return; } pending.delete(id); if (type === 'error') p.reject(new Error(e.data.error)); else p.resolve(e.data.result); if (!pending.size) hideBusy(); }; worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error('שגיאה ב-Worker: ' + (e.message || 'לא ידועה'))); pending.clear(); hideBusy(); }; }
export function call(type, payload = {}, { onProgress = null, busy = null } = {}){
  if (!worker) spawn();
  const id = ++seq;
  if (busy) showBusy(busy);
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject, onProgress: (d) => { if (busy) updateBusy(d); onProgress?.(d); } }); worker.postMessage({ id, type, payload: { base: labSettings.get().dataBase, ...payload } }); });
}
export function cancelAll(){ if (worker){ worker.terminate(); worker = null; } for (const p of pending.values()) p.reject(new Error('בוטל על ידי המשתמש')); pending.clear(); hideBusy(); }
function showBusy(label){ const b = $('#busy'); if (!b) return; b.classList.remove('hidden'); $('#busyLabel').textContent = label; $('#busyBar').style.width = '2%'; $('#busyDetail').textContent = ''; $('#busyCancel').onclick = cancelAll; }
function updateBusy(d){ if (d.label) $('#busyLabel').textContent = d.label; if (typeof d.value === 'number') $('#busyBar').style.width = Math.round(d.value * 100) + '%'; if (d.detail !== undefined) $('#busyDetail').textContent = d.detail; }
function hideBusy(){ $('#busy')?.classList.add('hidden'); }
