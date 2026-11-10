// בוט 3 של מסלול עמית — "שיטת הקורס" בחשבון הדמו של Bybit (כסף וירטואלי). החלטות בלבד (טהור, בלי רשת); הבוט: scripts/bybit-amit3-bot.mjs.
// החלטת מאיר (10/11/2026): "אני רוצה שתפעיל דמו בבייביט. תבחן את הגרסאות. אני ראיתי חבר בעיניים שלי מצליח עם השיטה."
// זו החלטת בעל הריפו בניגוד לתוצאת הבדיקה לאחור (invest/docs/research/amit-course/FINAL-REPORT.md: No-Go, ‎−0.037R לעסקה) — ולכן
// היא רצה כניסוי קדימה מוגדר מראש (AI_COUNCIL: "מחלוקת → ניסוי שמכריע עם נתונים"), לא כ"הוכחה". קריטריונים: invest/docs/BYBIT_BOT.md.
//
// הכללים = הגרסה הנאמנה לקורס בדיוק כמו בבדיקה לאחור (engine/amit-course.js, CANON): עוגן בשפל דשדוש של 4 שעות (15 דק׳), אזור ריזיקה
// לפי סוג המטבע (טבלת 3-1), מעבר לעמודת הווליום באירוע ווליום, טריגר בנר דקה שנסגר בחצי התחתון עם ווליום ≥ ×3, 30-60-90
// (שוק + 2 פקודות ממתינות בהנזלה), סטופ אחד, 75% ברמה הקרובה (EMA20/EMA50/VWAP של 15 דק׳) → סטופ לכניסה → 25% לרמה הרחוקה, 24 שעות.
import { prepare, triggers, CANON, CATS } from './amit-course.js';

export const BOT3 = Object.freeze({
  version: 1, base: 'https://api-demo.bybit.com', market: 'https://api.bybit.com', category: 'linear', tag: 'a3',
  coins: Object.freeze({ BTC: 'btc', SOL: 'follow', AVAX: 'follow', ADA: 'follow', INJ: 'follow', RENDER: 'follow', NEAR: 'vol', FARTCOIN: 'vol' }),
  riskUsd: 200,                // הפסד אם כל 3 המנות התמלאו והסטופ נפגע
  maxNotional: 60000, leverage: 10, dailyLossUsd: 1000, maxHoldMin: 1440, historyMin: 6 * 1440,
  weights: Object.freeze([1 / 6, 1 / 3, 1 / 2]),
});

// נרות Bybit: [[startMs, o, h, l, c, volume, turnover], …] מהחדש לישן → נרות סגורים בלבד, מהישן לחדש (v = מחזור בדולרים)
export function klines(list, nowMs){
  if (!Array.isArray(list)) throw new Error('kline: תשובה לא צפויה');
  return list.map((r) => ({ t: Number(r[0]), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[6]) }))
    .filter((b) => Number.isFinite(b.t) && [b.o, b.h, b.l, b.c].every((x) => x > 0) && b.t + 60e3 <= nowMs).sort((a, b) => a.t - b.t);
}
// מערך נרות [{t,o,h,l,c,v}] → מבנה העמודות של המנוע
export function toM1(bars){
  const n = bars.length, m = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
  bars.forEach((b, i) => { m.t[i] = b.t; m.o[i] = b.o; m.h[i] = b.h; m.l[i] = b.l; m.c[i] = b.c; m.v[i] = b.v; });
  return m;
}

// האם הנר האחרון שנסגר הוא טריגר? מריץ את אותו מנוע של הבדיקה לאחור על החלון (בלי מבט לעתיד: רק נרות סגורים).
export function liveSignal(bars, cat, lastSeenT = 0){
  if (bars.length < 1500) return { signal: null };
  const ctx = prepare(toM1(bars)), tg = triggers(ctx, cat, CANON), last = tg.at(-1);
  const signal = last && last.i === bars.length - 1 && last.t > lastSeenT ? last : null;
  return { signal, ctx };
}

const dec = (step) => Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
export const roundStep = (x, step, mode = 'floor') => { const k = (mode === 'floor' ? Math.floor : Math.round)(x / step + 1e-9); return Number((k * step).toFixed(dec(step))); };

// תכנון 30-60-90: מחירים, סטופ, כמויות (יחידות) לפי סיכון קבוע אם כל המנות התמלאו. inst: { qtyStep, minQty, tick }
export function planEntry(g, inst, P = BOT3){
  const C = g.P, L = g.L, px = [g.c, L * (1 - C.flush[0] / 100), L * (1 - C.flush[1] / 100)], stop = L * (1 - (C.flush[1] + C.stopExtra) / 100);
  if (!(px[2] > stop && px[0] > px[1])) return null;
  const lossPer = P.weights.reduce((s, w, k) => s + w * (1 - stop / px[k]), 0), N = Math.min(P.riskUsd / lossPer, P.maxNotional);
  const qty = P.weights.map((w, k) => roundStep(w * N / px[k], inst.qtyStep));
  if (qty.some((q) => q < inst.minQty)) return null;   // מטבע שגודל המנה הקטנה בו מתחת למינימום של הבורסה
  return { px: [px[0], roundStep(px[1], inst.tick, 'round'), roundStep(px[2], inst.tick, 'round')], stop: roundStep(stop, inst.tick, 'round'), qty, N, anchor: g.anchor, zone: C.zone, signalT: g.t };
}

// ניהול עסקה פתוחה על נר הדקה האחרון שנסגר. trade: {phase, entryT, zone, runner}, pos: {size, avg}|null, ctx: מ-liveSignal.
// פעולות: {type:'done'} · {type:'cancelPending'} · {type:'reduce', qty} · {type:'moveSl', price} · {type:'closeAll', why}
export function manage(trade, pos, ctx, nowMs, inst, P = BOT3){
  if (!pos || !(pos.size > 0)) return trade.filled ? [{ type: 'cancelPending' }, { type: 'done', why: 'הפוזיציה נסגרה (סטופ או יעד)' }] : nowMs - trade.entryT > 4 * 3600e3 ? [{ type: 'cancelPending' }, { type: 'done', why: 'לא התמלא' }] : [];
  if (nowMs - trade.entryT >= P.maxHoldMin * 60e3) return [{ type: 'cancelPending' }, { type: 'closeAll', why: '24 שעות' }];
  const { q, m1, n } = ctx, i = n - 1, j = ctx.idx15[i] - 1; if (j < 0) return [];
  const hi = m1.h[i], avg = pos.avg, z0 = trade.zone[0] / 100;
  const lv = [q.ema20[j], q.ema50[j], q.vwap[j], q.ema200[j]].filter((x) => x > avg * 1.003).sort((a, b) => a - b);
  if (trade.phase === 0){
    const tp1 = lv.length ? lv[0] : avg * (1 + z0);
    if (hi >= tp1){
      const red = roundStep(pos.size * 0.75, inst.qtyStep);
      const runner = Math.max(lv.at(-1) || 0, tp1 * (1 + z0 / 2));
      return [{ type: 'cancelPending' }, ...(red >= inst.minQty ? [{ type: 'reduce', qty: red, why: `75% ברמה ${tp1.toPrecision(6)}` }] : []), { type: 'moveSl', price: roundStep(avg * 1.0006, inst.tick, 'round') }, { type: 'phase', phase: 1, runner }];
    }
  } else if (hi >= trade.runner) return [{ type: 'closeAll', why: `25% ברמה ${trade.runner.toPrecision(6)}` }];
  return [];
}
