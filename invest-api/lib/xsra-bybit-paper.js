// המעקב הווירטואלי השני — המומנטום של מחקר 7ל על 38 המטבעות של Bybit (engine/xsra-bybit-paper.js) — צד ה-Worker: שמירה ב-KV
// ושורות לסיכום הקריפטו היומי. נפרד מ-XSRA-7 המקורי: מפתח אחר (paper:xsrb), נתיב אחר (/xsrb). תיק וירטואלי בלבד.
import { XSRB, verdict } from '../engine/xsra-bybit-paper.js';
export const XSRB_KEY = 'paper:xsrb';
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const COIN = /^[A-Z0-9]{2,6}$/;
const day = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x)) ? String(x) : null);
const cmap = (o, n = 60) => { const w = {}; for (const [k, v] of Object.entries(o || {}).slice(0, n)) if (COIN.test(k) && num(v) !== null) w[k] = num(v); return w; };
const bad = (m) => Object.assign(new Error(m), { status: 400 });

// אימות ונרמול (מגיע מ-Actions; לא סומכים על המבנה)
export function cleanXsrb(b){
  if (!b || typeof b !== 'object' || b.id !== XSRB.id || b.v !== XSRB.version) throw bad('דוח לא תקין');
  if (!day(b.startDay)) throw bad('דוח לא תקין: יום התחלה');
  const daily = (Array.isArray(b.daily) ? b.daily : []).slice(-1500).map((x) => ({ day: day(x.day), equity: num(x.equity), btc: num(x.btc), xsra: num(x.xsra), dd: num(x.dd), exp: num(x.exp), cost: num(x.cost) }));
  if (daily.some((x) => !x.day || x.equity === null)) throw bad('דוח לא תקין: שורות יומיות');
  const trades = (Array.isArray(b.trades) ? b.trades : []).slice(-8000).map((t) => ({ day: day(t.day), sleeve: num(t.sleeve), coin: COIN.test(String(t.coin)) ? String(t.coin) : null,
    side: ['buy', 'sell', 'delist'].includes(t.side) ? t.side : null, usd: num(t.usd), fee: num(t.fee) })).filter((t) => t.day && t.coin && t.side);
  const f = b.flags || {}, xb = b.xsraBase && day(b.xsraBase.day) && num(b.xsraBase.equity) !== null ? { day: b.xsraBase.day, equity: num(b.xsraBase.equity) } : null;
  const out = { v: XSRB.version, id: XSRB.id, startedAt: String(b.startedAt ?? '').slice(0, 30), startDay: b.startDay, lastDay: day(b.lastDay), startUsd: num(b.startUsd), equity: num(b.equity),
    btcEquity: num(b.btcEquity), peak: num(b.peak), maxDD: num(b.maxDD), btcPeak: num(b.btcPeak), btcMaxDD: num(b.btcMaxDD), costsUsd: num(b.costsUsd), turnover: num(b.turnover),
    xsraBase: xb, replayDrift: num(b.replayDrift), flags: { alert: day(f.alert), kill: day(f.kill) }, weights: cmap(b.weights), contrib: cmap(b.contrib), daily, trades };
  if (out.equity === null || out.startUsd === null) throw bad('דוח לא תקין: חסר הון');
  return out;
}
// prev: המצב שכבר שמור. היסטוריה נעולה — אין מחיקה ואין התחלה מחדש דרך הנתיב הזה (גם לא אחרי פסילה)
export async function recordXsrb(db, body, { now = new Date() } = {}){
  const rep = cleanXsrb(body), prev = await db.get(XSRB_KEY);
  if (prev?.startDay){
    if (rep.startDay !== prev.startDay) throw bad('יום ההתחלה נעול — אין התחלה מחדש');
    if ((prev.daily?.length || 0) > rep.daily.length && rep.daily.length < 1500) throw bad('אין מחיקה של נתוני מעקב');
    if (prev.lastDay && rep.lastDay && rep.lastDay < prev.lastDay) throw bad('הדוח ישן מהשמור');
    for (const k of ['alert', 'kill']) if (prev.flags?.[k] && rep.flags[k] !== prev.flags[k]) throw bad('אין ביטול של התראה או פסילה');
  }
  await db.put(XSRB_KEY, { ...rep, receivedAt: now.toISOString() });
  return { ok: true, saved: true, lastDay: rep.lastDay };
}

const pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
const VERD = { alert: '⚠️ התראה: הירידה מהשיא עברה 35%', disqualified: '🛑 המועמד נפסל: ירידה של 45% מהשיא (הנתונים ממשיכים להיאסף)',
  fail: '🛑 12 חודשים: מפגר אחרי ביטקוין ביותר מ-20 נק׳ עם ירידה גדולה יותר — נכשל', pass: '✅ 12 חודשים: מנצח את ביטקוין עם ירידה קטנה יותר — החלטה של מאיר', decide: '⏳ 12 חודשים עברו — החלטה של מאיר' };
export function xsrbLines(rep, nowMs = Date.now()){
  if (!rep || !rep.startUsd) return [];
  const head = '🧭 מעקב 2 — מומנטום 7ל, 38 מטבעות Bybit + 2 הגנות (בלי כסף, בלי פקודות)';
  if (!rep.daily?.length) return [head, `מתחיל ב-${rep.startDay} עם ${rep.startUsd.toLocaleString('en-US')}$ וירטואליים`];
  const v = verdict(rep, XSRB, nowMs), ageH = rep.receivedAt ? (nowMs - Date.parse(rep.receivedAt)) / 3600e3 : 0;
  const held = Object.entries(rep.weights || {}).filter(([, x]) => x > 0.005).sort((a, b) => b[1] - a[1]), inv = held.reduce((s, [, x]) => s + x, 0);
  return [head,
    `מאז ${rep.startDay}: ${Math.round(rep.equity).toLocaleString('en-US')}$ (${pct(v.r)}) · ביטקוין ${pct(v.b)}${v.xr !== null ? ` · XSRA-7 המקורי ${pct(v.xr)}` : ''} · ירידה מקס׳ ${pct(-(rep.maxDD || 0))} (ביטקוין ${pct(-(rep.btcMaxDD || 0))})`,
    held.length ? `מחזיק ${Math.round(inv * 100)}%: ${held.slice(0, 8).map(([c, x]) => `${c} ${Math.round(x * 100)}%`).join(', ')}` : 'הכול במזומן',
    ...(VERD[v.status] ? [VERD[v.status]] : []),
    ...(ageH > 50 ? [`⚠️ מעקב 2 לא התעדכן ${Math.round(ageH)} שעות`] : [])];
}
