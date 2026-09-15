// fetch עם timeout, פרסור JSON/CSV, שגיאות מסווגות. אין retry אוטומטי לספקים עם מכסה (כדי לא לשרוף תקציב).
export class ProviderError extends Error {
  constructor(provider, status, message, kind = 'error'){ super(`${provider}: ${message}`); this.provider = provider; this.status = status; this.kind = kind; }
}

export async function fetchWithTimeout(url, opts = {}, ms = 12000){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

export async function getJSON(provider, url, opts = {}, ms = 12000){
  let res;
  try { res = await fetchWithTimeout(url, opts, ms); }
  catch (e) { throw new ProviderError(provider, 0, e.name === 'AbortError' ? 'timeout' : e.message, 'network'); }
  const text = await res.text();
  if (res.status === 429) throw new ProviderError(provider, 429, 'rate limited', 'quota');
  if (res.status === 401 || res.status === 403) throw new ProviderError(provider, res.status, 'unauthorized / plan does not include this endpoint', 'auth');
  if (res.status === 402) throw new ProviderError(provider, 402, 'endpoint requires paid plan', 'paid');
  if (!res.ok) throw new ProviderError(provider, res.status, `HTTP ${res.status} ${text.slice(0, 120)}`);
  try { return JSON.parse(text); }
  catch { throw new ProviderError(provider, res.status, `invalid JSON: ${text.slice(0, 80)}`, 'parse'); }
}

export async function getText(provider, url, opts = {}, ms = 12000){
  let res;
  try { res = await fetchWithTimeout(url, opts, ms); }
  catch (e) { throw new ProviderError(provider, 0, e.name === 'AbortError' ? 'timeout' : e.message, 'network'); }
  if (!res.ok) throw new ProviderError(provider, res.status, `HTTP ${res.status}`);
  return res.text();
}

// CSV פשוט (ללא מרכאות מורכבות) → מערך אובייקטים
export function parseCSV(text){
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((l) => { const c = l.split(','); const o = {}; head.forEach((h, i) => { o[h] = c[i]?.trim(); }); return o; });
}

export const num = (x) => { const n = typeof x === 'string' ? parseFloat(x.replace(/[,%$]/g, '')) : x; return Number.isFinite(n) ? n : null; };
export const nowIso = () => new Date().toISOString();
