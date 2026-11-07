// מעקב Paper Trading ל-Donchian 20/10 (engine/dc-paper.js) — צד ה-Worker: שמירת המצב ב-KV ושורות לסיכום היומי בטלגרם.
// המצב מחושב ב-GitHub Actions (scripts/dc-paper.mjs, פעם ביום) ונשלח ל-POST /dc עם סוד ה-cron. תיק וירטואלי בלבד.
export const DCPAPER_KEY = 'paper:dc';
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const str = (x, n = 40) => String(x ?? '').slice(0, n);
const COIN = /^[A-Z0-9]{2,6}$/;
const wmap = (o) => { const w = {}; for (const [k, v] of Object.entries(o || {}).slice(0, 30)) if (COIN.test(k) && num(v) !== null) w[k] = num(v); return w; };
const coins = (a) => (Array.isArray(a) ? a : []).slice(0, 30).map((x) => str(x, 6)).filter((x) => COIN.test(x));

// אימות ונרמול הדוח (מגיע מ-Actions; לא סומכים על המבנה)
export function cleanDc(b){
  if (!b || typeof b !== 'object' || b.id !== 'DC20-10-EW') throw Object.assign(new Error('דוח לא תקין'), { status: 400 });
  const day = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x)) ? String(x) : null);
  const inPos = {}; for (const [k, v] of Object.entries(b.inPos || {}).slice(0, 30)) if (COIN.test(k)) inPos[k] = !!v;
  const changes = (Array.isArray(b.changes) ? b.changes : []).slice(-300).map((e) => ({ day: day(e.day), in: coins(e.in), out: coins(e.out), held: coins(e.held), live: num(e.live), turnover: num(e.turnover), costUsd: num(e.costUsd), equity: num(e.equity) }));
  const daily = (Array.isArray(b.daily) ? b.daily : []).slice(-500).map((x) => ({ day: day(x.day), equity: num(x.equity), btc: num(x.btc) }));
  const out = { v: 1, id: b.id, startedAt: str(b.startedAt, 30), startDay: day(b.startDay), lastDay: str(b.lastDay, 30), startUsd: num(b.startUsd), equity: num(b.equity),
    btcStart: num(b.btcStart), btcEquity: num(b.btcEquity), inPos, tgt: wmap(b.tgt), weights: wmap(b.weights), costsUsd: num(b.costsUsd), changes, daily };
  if (out.equity === null || out.startUsd === null) throw Object.assign(new Error('דוח לא תקין: חסר הון'), { status: 400 });
  return out;
}
export async function recordDc(db, body, { now = new Date() } = {}){
  const rep = cleanDc(body);
  await db.put(DCPAPER_KEY, { ...rep, receivedAt: now.toISOString() });
  return { ok: true, saved: true, lastDay: rep.lastDay };
}

const pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
// שורות לסיכום הקריפטו היומי (בלי הודעה נפרדת)
export function dcLines(rep, nowMs = Date.now()){
  if (!rep || !rep.startUsd) return [];
  const eq = rep.equity / rep.startUsd - 1, btc = rep.btcEquity && rep.startUsd ? rep.btcEquity / rep.startUsd - 1 : null;
  const held = Object.keys(rep.weights || {}).filter((k) => rep.weights[k] > 0.0001), last = (rep.changes || []).at(-1);
  const inv = held.reduce((s, k) => s + rep.weights[k], 0);
  const ageH = rep.receivedAt ? (nowMs - Date.parse(rep.receivedAt)) / 3600e3 : 0;
  return ['📊 מעקב Paper — Donchian 20/10 על 20 מטבעות (בלי כסף, בלי פקודות)',
    `מאז ${rep.startDay}: ${Math.round(rep.equity).toLocaleString('en-US')}$ (${pct(eq)})${btc !== null ? ` · ביטקוין באותה תקופה ${pct(btc)}` : ''}`,
    held.length ? `במגמה: ${held.length} מטבעות (${Math.round(inv * 100)}% מהתיק) — ${held.join(', ')}` : 'אין מטבע במגמה — הכול במזומן',
    ...(last && (last.in.length || last.out.length) ? [`שינוי אחרון ${last.day}: ${last.in.length ? `נכנסו ${last.in.join(', ')}` : ''}${last.in.length && last.out.length ? ' · ' : ''}${last.out.length ? `יצאו ${last.out.join(', ')}` : ''}`] : []),
    ...(ageH > 50 ? [`⚠️ המעקב לא התעדכן ${Math.round(ageH)} שעות`] : [])];
}
