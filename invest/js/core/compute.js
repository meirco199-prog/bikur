// חישוב בדפדפן: אותו engine, ב-Web Worker (לא חוסם את הממשק). משמש ל-backtest, As-Of ולמצב "חישוב מקומי".
let worker, seq = 0; const pending = new Map();
function get(){
  if (worker) return worker;
  worker = new Worker(new URL('../engine-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => { const { id, result, error, progress } = e.data; const p = pending.get(id); if (!p) return; if (progress !== undefined){ p.onProgress?.(progress); return; } pending.delete(id); error ? p.reject(new Error(error)) : p.resolve(result); };
  worker.onerror = (e) => { for (const p of pending.values()) p.reject(new Error(e.message || 'worker error')); pending.clear(); };
  return worker;
}
export function run(task, payload, onProgress){
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject, onProgress }); get().postMessage({ id, task, payload }); });
}
