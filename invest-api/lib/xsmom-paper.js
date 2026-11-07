// מעקב Paper Trading למומנטום בין מטבעות (engine/xsmom-paper.js) — צד ה-Worker: שמירת המצב ב-KV ושורות לסיכום היומי בטלגרם.
// המצב מחושב ב-GitHub Actions (scripts/xsmom-paper.mjs, פעם ביום) ונשלח ל-POST /xsmom עם סוד ה-cron. תיק וירטואלי בלבד.
export const XSPAPER_KEY = 'paper:xsmom';
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const str = (x, n = 40) => String(x ?? '').slice(0, n);

// אימות ונרמול הדוח (מגיע מ-Actions; לא סומכים על המבנה)
export function cleanPaper(b){
  if (!b || typeof b !== 'object' || b.id !== 'XS14-top3-f200') throw Object.assign(new Error('דוח לא תקין'), { status: 400 });
  const day = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x)) ? String(x) : null);
  const weights = {}; for (const [k, v] of Object.entries(b.weights || {}).slice(0, 10)) if (/^[A-Z0-9]{2,6}$/.test(k) && num(v) !== null) weights[k] = num(v);
  const reb = (Array.isArray(b.rebalances) ? b.rebalances : []).slice(-300).map((r) => ({ day: day(r.day), cash: !!r.cash, filterOn: !!r.filterOn, btcVsSma: num(r.btcVsSma),
    picks: (Array.isArray(r.picks) ? r.picks : []).slice(0, 5).map((p) => ({ coin: str(p.coin, 6), ret: num(p.ret) })), turnover: num(r.turnover), costUsd: num(r.costUsd), equity: num(r.equity) }));
  const daily = (Array.isArray(b.daily) ? b.daily : []).slice(-500).map((x) => ({ day: day(x.day), equity: num(x.equity), btc: num(x.btc) }));
  const out = { v: 1, id: b.id, startedAt: str(b.startedAt, 30), startDay: day(b.startDay), lastDay: str(b.lastDay, 30), startUsd: num(b.startUsd), equity: num(b.equity),
    btcStart: num(b.btcStart), btcEquity: num(b.btcEquity), weights, costsUsd: num(b.costsUsd), rebalances: reb, daily };
  if (out.equity === null || out.startUsd === null) throw Object.assign(new Error('דוח לא תקין: חסר הון'), { status: 400 });
  return out;
}
export async function recordPaper(db, body, { now = new Date() } = {}){
  const rep = cleanPaper(body);
  await db.put(XSPAPER_KEY, { ...rep, receivedAt: now.toISOString() });
  return { ok: true, saved: true, lastDay: rep.lastDay };
}

const pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
// שורות לסיכום הקריפטו היומי (בלי הודעה נפרדת — מאיר ביקש רק סיכום יום)
export function paperLines(rep, nowMs = Date.now()){
  if (!rep || !rep.startUsd) return [];
  const eq = rep.equity / rep.startUsd - 1, btc = rep.btcEquity && rep.startUsd ? rep.btcEquity / rep.startUsd - 1 : null;
  const hold = Object.keys(rep.weights || {}).filter((k) => rep.weights[k] > 0.001);
  const last = (rep.rebalances || []).at(-1);
  const ageH = rep.receivedAt ? (nowMs - Date.parse(rep.receivedAt)) / 3600e3 : 0;
  return ['📈 מעקב Paper — מומנטום בין מטבעות (בלי כסף, בלי פקודות)',
    `מאז ${rep.startDay}: ${Math.round(rep.equity).toLocaleString('en-US')}$ (${pct(eq)})${btc !== null ? ` · ביטקוין באותה תקופה ${pct(btc)}` : ''}`,
    hold.length ? `מחזיק: ${hold.join(', ')}${last ? ` (נבחרו ${last.day})` : ''}` : `במזומן${last?.filterOn ? ' — ביטקוין מתחת לממוצע 200 יום' : ''}`,
    ...(ageH > 50 ? [`⚠️ המעקב לא התעדכן ${Math.round(ageH)} שעות`] : [])];
}
