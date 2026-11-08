// מעקב Paper Trading ל"3 המניות שירדו 3%–7%" (engine/losers-paper.js) — צד ה-Worker: שמירת המצב ב-KV ושורות לסיכום היומי בטלגרם.
// המצב מחושב ב-GitHub Actions (scripts/losers-paper.mjs, אחרי סגירת וול סטריט) ונשלח ל-POST /losers עם סוד ה-cron. תיק וירטואלי בלבד.
export const LOSPAPER_KEY = 'paper:losers';
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
const SYM = /^[A-Z][A-Z0-9.\-]{0,7}$/;
const day = (x) => (/^\d{4}-\d{2}-\d{2}$/.test(String(x)) ? String(x) : null);
const sym = (x) => (SYM.test(String(x)) ? String(x) : null);

// אימות ונרמול הדוח (מגיע מ-Actions; לא סומכים על המבנה)
export function cleanLosers(b){
  if (!b || typeof b !== 'object' || b.id !== 'LOS3-mild-CC') throw Object.assign(new Error('דוח לא תקין'), { status: 400 });
  const pos = (Array.isArray(b.pos) ? b.pos : []).slice(0, 10).filter((p) => sym(p?.s)).map((p) => ({ s: p.s, day: day(p.day), r: num(p.r), entry: num(p.entry), bp: num(p.bp), sh: num(p.sh), feeIn: num(p.feeIn) }));
  const trades = (Array.isArray(b.trades) ? b.trades : []).slice(-500).filter((t) => sym(t?.s)).map((t) => ({ s: t.s, in: day(t.in), out: day(t.out), r: num(t.r), entry: num(t.entry), exit: num(t.exit), sh: num(t.sh), pnlUsd: num(t.pnlUsd), pnlPct: num(t.pnlPct) }));
  const daily = (Array.isArray(b.daily) ? b.daily : []).slice(-500).map((x) => ({ day: day(x.day), equity: num(x.equity), spy: num(x.spy), n: num(x.n) }));
  const out = { v: 1, id: b.id, startedAt: String(b.startedAt ?? '').slice(0, 30), startDay: day(b.startDay), lastDay: day(b.lastDay), startUsd: num(b.startUsd),
    equity: num(b.equity), cash: num(b.cash), spyStart: num(b.spyStart), spyEquity: num(b.spyEquity), feesUsd: num(b.feesUsd), pos, trades, daily };
  if (out.equity === null || out.startUsd === null) throw Object.assign(new Error('דוח לא תקין: חסר הון'), { status: 400 });
  return out;
}
export async function recordLosers(db, body, { now = new Date() } = {}){
  const rep = cleanLosers(body);
  await db.put(LOSPAPER_KEY, { ...rep, receivedAt: now.toISOString() });
  return { ok: true, saved: true, lastDay: rep.lastDay };
}

const pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
const usd = (x) => `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x)).toLocaleString('en-US')}$`;
// שורות לסיכום היומי (בלי הודעה נפרדת)
export function losersLines(rep, nowMs = Date.now()){
  if (!rep || !rep.startUsd) return [];
  const eq = rep.equity / rep.startUsd - 1, spy = rep.spyEquity ? rep.spyEquity / rep.startUsd - 1 : null;
  const last = rep.lastDay, closed = (rep.trades || []).filter((t) => t.out === last), ageH = rep.receivedAt ? (nowMs - Date.parse(rep.receivedAt)) / 3600e3 : 0;
  return ['📉 מעקב Paper — מניות ארה״ב: 3 שירדו 3%–7%, קנייה בסגירה ומכירה למחרת (בלי כסף, בלי פקודות)',
    `מאז ${rep.startDay}: ${Math.round(rep.equity).toLocaleString('en-US')}$ (${pct(eq)}, ${usd(rep.equity - rep.startUsd)})${spy !== null ? ` · SPY באותה תקופה ${pct(spy)}` : ''}`,
    ...(closed.length ? [`נמכרו ${last}: ${closed.map((t) => `${t.s} ${usd(t.pnlUsd)}`).join(', ')}`] : []),
    (rep.pos || []).length ? `נקנו ${rep.pos[0].day}: ${rep.pos.map((p) => `${p.s} (${pct(p.r)})`).join(', ')}` : 'אין פוזיציות (לא היו מניות שירדו 3%–7%)',
    ...(ageH > 80 ? [`⚠️ המעקב לא התעדכן ${Math.round(ageH)} שעות`] : [])];
}
