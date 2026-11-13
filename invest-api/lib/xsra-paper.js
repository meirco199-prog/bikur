// מעקב Paper למומנטום המשודרג, 7 מנות (engine/xsra-paper.js) — צד ה-Worker: שמירת המצב ב-KV ושורות לסיכום הקריפטו היומי בטלגרם.
// המצב מחושב ב-GitHub Actions (scripts/xsra-paper.mjs, פעם ביום) ונשלח ל-POST /xsra עם סוד ה-cron. תיק וירטואלי בלבד.
import { XSRAP, verdict } from '../engine/xsra-paper.js';
export const XSRAPAPER_KEY = 'paper:xsra';
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const str = (x, n = 40) => String(x ?? '').slice(0, n);
const COIN = /^[A-Z0-9]{2,6}$/;
const day = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x)) ? String(x) : null);
const wmap = (o) => { const w = {}; for (const [k, v] of Object.entries(o || {}).slice(0, 10)) if (COIN.test(k) && num(v) !== null) w[k] = num(v); return w; };

// אימות ונרמול הדוח (מגיע מ-Actions; לא סומכים על המבנה)
export function cleanXsra(b){
  if (!b || typeof b !== 'object' || b.id !== XSRAP.id) throw Object.assign(new Error('דוח לא תקין'), { status: 400 });
  const sleeves = (Array.isArray(b.sleeves) ? b.sleeves : []).slice(0, 7).map((sl) => ({ dow: num(sl.dow), equity: num(sl.equity), weights: wmap(sl.weights), tgt: wmap(sl.tgt) }));
  if (sleeves.length !== 7 || sleeves.some((sl) => sl.equity === null)) throw Object.assign(new Error('דוח לא תקין: מנות'), { status: 400 });
  const changes = (Array.isArray(b.changes) ? b.changes : []).slice(-400).map((e) => ({ day: day(e.day), sleeve: num(e.sleeve), cash: !!e.cash,
    held: (Array.isArray(e.held) ? e.held : []).slice(0, 4).map((x) => str(x, 6)).filter((x) => COIN.test(x)),
    pick: (Array.isArray(e.pick) ? e.pick : []).slice(0, 4).map((p) => ({ coin: str(p.coin, 6), score: num(p.score) })), turnover: num(e.turnover), costUsd: num(e.costUsd), sleeveEquity: num(e.sleeveEquity) }));
  const daily = (Array.isArray(b.daily) ? b.daily : []).slice(-500).map((x) => ({ day: day(x.day), equity: num(x.equity), btc: num(x.btc) }));
  const out = { v: 1, id: b.id, startedAt: str(b.startedAt, 30), startDay: day(b.startDay), lastDay: str(b.lastDay, 30), startUsd: num(b.startUsd), equity: num(b.equity),
    btcStart: num(b.btcStart), btcEquity: num(b.btcEquity), peak: num(b.peak), maxDD: num(b.maxDD), btcPeak: num(b.btcPeak), btcMaxDD: num(b.btcMaxDD), sleeves, costsUsd: num(b.costsUsd), changes, daily };
  if (out.equity === null || out.startUsd === null) throw Object.assign(new Error('דוח לא תקין: חסר הון'), { status: 400 });
  return out;
}
export async function recordXsra(db, body, { now = new Date() } = {}){
  const rep = cleanXsra(body);
  await db.put(XSRAPAPER_KEY, { ...rep, receivedAt: now.toISOString() });
  return { ok: true, saved: true, lastDay: rep.lastDay };
}

const pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
const VERD = { running: '', waiting: '', 'stop-dd': '🛑 כלל העצירה הופעל: ירידה מעל 55% (וגדולה משל ביטקוין)', 'stop-lag': '🛑 כלל העצירה הופעל: פיגור של יותר מ-20 נק׳ אחרי ביטקוין עם ירידה גדולה יותר', pass: '✅ 12 חודשים: מנצח את ביטקוין עם ירידה קטנה יותר — החלטה של מאיר', decide: '⏳ 12 חודשים עברו — החלטה של מאיר' };
// שורות לסיכום הקריפטו היומי (בלי הודעה נפרדת)
export function xsraLines(rep, nowMs = Date.now()){
  if (!rep || !rep.startUsd) return [];
  const eq = rep.equity / rep.startUsd - 1, btc = rep.btcEquity && rep.startUsd ? rep.btcEquity / rep.startUsd - 1 : null;
  const tot = rep.sleeves.reduce((a, sl) => a + sl.equity, 0) || 1, w = {};
  for (const sl of rep.sleeves) for (const [c, x] of Object.entries(sl.weights || {})) w[c] = (w[c] || 0) + x * sl.equity / tot;
  const held = Object.entries(w).filter(([, x]) => x > 0.005).sort((a, b) => b[1] - a[1]), inv = held.reduce((s, [, x]) => s + x, 0);
  const v = verdict(rep, XSRAP, nowMs), ageH = rep.receivedAt ? (nowMs - Date.parse(rep.receivedAt)) / 3600e3 : 0;
  return ['🧭 מעקב Paper — מומנטום משודרג, 7 מנות (בלי כסף, בלי פקודות)',
    `מאז ${rep.startDay}: ${Math.round(rep.equity).toLocaleString('en-US')}$ (${pct(eq)})${btc !== null ? ` · ביטקוין ${pct(btc)}` : ''} · ירידה מקס׳ ${pct(-(rep.maxDD || 0))} (ביטקוין ${pct(-(rep.btcMaxDD || 0))})`,
    held.length ? `מחזיק ${Math.round(inv * 100)}%: ${held.slice(0, 8).map(([c, x]) => `${c} ${Math.round(x * 100)}%`).join(', ')}` : 'הכול במזומן',
    ...(VERD[v.status] ? [VERD[v.status]] : []),
    ...(ageH > 50 ? [`⚠️ המעקב לא התעדכן ${Math.round(ageH)} שעות`] : [])];
}
