// בוט 2 של מסלול עמית — חשבון הדמו של Bybit, ETHUSDT. החלטות בלבד (טהור, בלי רשת); הבוט: scripts/bybit-amit2-bot.mjs.
// החלטת מאיר (7/11/2026, "תבנה" אחרי ניתוח שלושת סרטוני הסטורים של עמית). מה שנלקח מהסרטונים, לא ניחוש:
//   • "איפה שכולם נמחקים אני נכנס" — המחיר חוצה את הרצועה (מוחק סטופים) וחוזר פנימה; הכניסה בצד ההפוך.
//   • "תמיד מחכים לסגירה של הנר", "סגירה של נר 15 דקתי חיובי ללונג", "אינדיקציה חזקה שזה ב-15 ולא ב-5" — אישור בנר 15 דקות.
//   • "עם סטופ בנקודה התחתונה" — הסטופ מעבר לקצה של הנר שחצה, לא אחוז קבוע.
//   • "תנועה ולא אקזיט" — יעד קרוב: אמצע רצועת בולינגר. • הזזת הסטופ למחיר הכניסה אחרי שהעסקה התקדמה (ETH/BTC בסרטון).
// הכללים (גרסה 1), על נרות 15 דקות של ETHUSDT, בולינגר (20, 2) כולל הנר האחרון:
//   לונג: הנר שנסגר ירד מתחת לרצועה התחתונה, נסגר מעליה, ונסגר חיובי (סגירה > פתיחה). שורט: ההפך ברצועה העליונה.
//   כניסה: מיד בפקודת שוק. סטופ: 0.05% מעבר לקצה הנר (מינימום 0.15%, ואם יותר מ-1.2% — מוותרים). יעד: אמצע הרצועה.
//   מוותרים גם כשהיעד קרוב מהסטופ (רווח אפשרי < סיכון). גודל: סיכון 400$ לעסקה (כמו סטופ של בוט 1), עד 190,000$.
//   התקדמות של חצי הדרך ליעד → הסטופ זז למחיר הכניסה (+0.06% לעמלות). שעתיים בעסקה → סגירה בשוק.
//   מגבלת הפסד יומית 1,000$ ועצירה בקובץ STOP — כמו בוט 1. שינוי כלל = גרסה חדשה.
import { bands } from './amit-rules.js';
import { ilDay, dailyHalt } from './amit-exec.js';

export const BOT2 = Object.freeze({
  version: 1, symbol: 'ETHUSDT', category: 'linear', base: 'https://api-demo.bybit.com', market: 'https://api.bybit.com',
  barMs: 15 * 60e3, bbN: 20, bbK: 2, riskUsd: 400, maxNotional: 190000, dailyLossUsd: 1000,
  slBufPct: 0.05, minStopPct: 0.15, maxStopPct: 1.2, minRR: 1, bePct: 0.06, beAt: 0.5, maxMins: 120,
  leverage: 25, tick: 0.01, qtyStep: 0.01, tag: 'a2',
});

const dec = (step) => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
const fix = (x, step) => (Math.round(x / step) * step).toFixed(dec(step));
export const px2 = (x, P = BOT2) => fix(x, P.tick);
export const qty2 = (riskUsd, entry, sl, P = BOT2) => {
  const byRisk = riskUsd / Math.abs(entry - sl), byCap = P.maxNotional / entry;
  return (Math.floor(Math.min(byRisk, byCap) / P.qtyStep + 1e-9) * P.qtyStep).toFixed(dec(P.qtyStep));
};

// נרות Bybit מלאים: [[startMs, o, h, l, c, ...]] מהחדש לישן → סגורים בלבד, מהישן לחדש
export function closedBars15(j, nowMs, barMs = BOT2.barMs){
  const list = j?.result?.list;
  if (!Array.isArray(list)) throw new Error('kline: תשובה לא צפויה');
  return list.map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]) }))
    .filter((b) => Number.isFinite(b.t) && [b.o, b.h, b.l, b.c].every((x) => x > 0) && b.t + barMs <= nowMs)
    .sort((a, b) => a.t - b.t);
}

// האות מהנר האחרון שנסגר: { side, entryRef, sl, tp, stopPct, rr } או { skip: סיבה } או null (אין אות)
export function signal(bars, P = BOT2){
  if (!Array.isArray(bars) || bars.length < P.bbN) return null;
  const last = bars.at(-1), b = bands(bars.slice(-P.bbN).map((x) => x.c), P.bbK);
  let side = null;
  if (last.l < b.lo && last.c > b.lo && last.c > last.o) side = 'long';
  else if (last.h > b.up && last.c < b.up && last.c < last.o) side = 'short';
  if (!side) return null;
  const e = last.c, sg = side === 'long' ? 1 : -1;
  let sl = side === 'long' ? last.l * (1 - P.slBufPct / 100) : last.h * (1 + P.slBufPct / 100);
  let stopPct = Math.abs(e - sl) / e * 100;
  if (stopPct < P.minStopPct){ sl = e * (1 - sg * P.minStopPct / 100); stopPct = P.minStopPct; }
  const tp = b.mid, rr = sg * (tp - e) / Math.abs(e - sl);
  const out = { side, t: last.t, entryRef: e, sl, tp, stopPct, rr, lo: b.lo, up: b.up, mid: b.mid };
  if (stopPct > P.maxStopPct) return { ...out, skip: `סטופ רחוק מדי (${stopPct.toFixed(2)}%)` };
  if (!(rr >= P.minRR)) return { ...out, skip: `יעד קרוב מדי (רווח/סיכון ${rr.toFixed(2)})` };
  return out;
}

// snapshot: { pos: {side, size, entry, mark, sinceMs, sl}|null, trade: {be, tp}|null, bars, newBar, halt, nowMs }
// פעולות: {type:'open', order} · {type:'moveSl', price} · {type:'close', why} · {type:'cancelAll'} · {type:'skip', why}
export function decide2(s, P = BOT2){
  const pos = s.pos && Number(s.pos.size) > 0 ? s.pos : null;
  if (s.halt) return pos ? [{ type: 'cancelAll' }, { type: 'close', why: s.halt === 'daily' ? 'מגבלת הפסד יומית' : 'עצירה ידנית' }] : [];
  if (pos){
    const out = [], sg = pos.side === 'long' ? 1 : -1;
    if ((s.nowMs - pos.sinceMs) / 60e3 >= P.maxMins) return [{ type: 'close', why: 'זמן (שעתיים)' }];
    const tp = Number(s.trade?.tp), mark = Number(pos.mark), entry = Number(pos.entry), cur = Number(pos.sl);
    const toTp = sg * (tp - entry), moved = sg * (mark - entry);
    if (!s.trade?.be && toTp > 0 && moved >= P.beAt * toTp){
      const be = Number(px2(entry * (1 + sg * P.bePct / 100), P));
      if (!Number.isFinite(cur) || sg * (be - cur) > 0) out.push({ type: 'moveSl', price: px2(be, P) }); // רק משפר, אף פעם לא מרחיק
    }
    return out;
  }
  if (!s.newBar) return [];
  const sig = signal(s.bars, P);
  if (!sig) return [];
  if (sig.skip) return [{ type: 'skip', why: sig.skip, side: sig.side }];
  const qty = qty2(P.riskUsd, sig.entryRef, sig.sl, P);
  if (!(Number(qty) > 0)) return [{ type: 'skip', why: 'כמות אפס' }];
  return [{ type: 'open', signal: sig, order: { side: sig.side === 'long' ? 'Buy' : 'Sell', orderType: 'Market', qty, stopLoss: px2(sig.sl, P), takeProfit: px2(sig.tp, P),
    tpslMode: 'Full', slTriggerBy: 'LastPrice', tpTriggerBy: 'LastPrice', orderLinkId: `${P.tag}-${sig.t}` } }];
}

export { ilDay, dailyHalt };
