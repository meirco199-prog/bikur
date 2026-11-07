// טורניר 30 גרסאות של מסלול עמית — סימולציה על נרות היסטוריים (בדיקה לאחור), טהור (בלי רשת). החלטת מאיר (7/11/2026):
// "תבנה 30 בוטים שתכסה כל אופציה... ובסוף התהליך נחליט מה עדיף". ב-Bybit יש פוזיציה אחת לכל מטבע בחשבון, ולכן 30 בוטים חיים
// במקביל אינם אפשריים — במקום זה כל הגרסאות רצות על אותם נתונים, אותן עמלות ואותו סיכון לעסקה, ומשווים.
// שלוש משפחות (מה שנראה בסרטונים של עמית):
//   touch   — נגיעה ברצועת בולינגר (20, 2) → יציאה ברצועה הנגדית/באמצע; כמו בוט 1.
//   sweep   — הנר חצה את הרצועה ונסגר בפנים, בכיוון → כניסה בשוק, סטופ מעבר לקצה; כמו בוט 2.
//   retrace — נר תנופה (טווח ≥ פי 2 מהממוצע) → פקודה ממתינה בתיקון של 50%/75% ("ריטריס 75%", "3/4"), יעד בקצה התנופה.
// הנחות שמרניות: סטופ נבדק לפני יעד באותו נר; פקודה ממתינה שהמחיר כבר עבר (פער) — לא מתמלאת (כמו PostOnly);
// עמלות של חשבון רגיל ב-Bybit (נמדדו בדמו): 0.02% לפקודה ממתינה, 0.055% למיידית. גודל: סיכון 400$ לעסקה, עד 190,000$.
import { bands } from './amit-rules.js';

export const FEES = Object.freeze({ maker: 0.02, taker: 0.055 });
export const SIZE = Object.freeze({ riskUsd: 400, maxNotional: 190000, minStopPct: 0.15 });
const TF = { '1m': 1, '5m': 5, '15m': 15, '1h': 60 };
const TOUCH_STOP = { '1m': 0.22, '5m': 0.45, '15m': 0.8 }; // סטופ קבוע לפי טווח זמן (1m = 0.22% כמו בסרטון של עמית)

// 30 הגרסאות. id יציב — לא משנים משמעות של id קיים (גרסה חדשה = id חדש)
export const VARIANTS = Object.freeze([
  ...['1m', '5m', '15m'].flatMap((tf) => [0, 0.35].flatMap((minW) => ['opp', 'mid'].map((exit) =>
    ({ id: `touch-${tf}-w${minW}-${exit}`, family: 'touch', tf, minWidthPct: minW, exit, stopPct: TOUCH_STOP[tf], maxBars: 60 })))),
  ...['5m', '15m', '1h'].flatMap((tf) => ['mid', 'opp'].flatMap((target) => [0, 1].map((minRR) =>
    ({ id: `sweep-${tf}-${target}-rr${minRR}`, family: 'sweep', tf, target, minRR, maxBars: 8 })))),
  ...['5m', '15m', '1h'].flatMap((tf) => [0.5, 0.75].map((r) =>
    ({ id: `retrace-${tf}-${r}`, family: 'retrace', tf, retrace: r, impulseX: 2, validBars: 4, maxBars: 12 }))),
]);

// נרות דקה [{t,o,h,l,c}] (מהישן לחדש) → נרות של טווח זמן גדול יותר (רק קבוצות מלאות)
export function aggregate(bars1m, tf){
  const m = TF[tf]; if (m === 1) return bars1m;
  const ms = m * 60e3, out = []; let cur = null, n = 0;
  for (const b of bars1m){
    const k = Math.floor(b.t / ms) * ms;
    if (!cur || cur.t !== k){ if (cur && n === m) out.push(cur); cur = { t: k, o: b.o, h: b.h, l: b.l, c: b.c }; n = 1; continue; }
    cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; n += 1;
  }
  if (cur && n === m) out.push(cur);
  return out;
}

const notionalFor = (stopPct) => Math.min(SIZE.riskUsd / (Math.max(stopPct, SIZE.minStopPct) / 100), SIZE.maxNotional);
function closeTrade(pos, exit, exitMaker, t, why){
  const sg = pos.side === 'long' ? 1 : -1, N = pos.notional;
  const gross = sg * (exit - pos.entry) / pos.entry * N;
  const fees = N * (pos.entryMaker ? FEES.maker : FEES.taker) / 100 + N * (exit / pos.entry) * (exitMaker ? FEES.maker : FEES.taker) / 100;
  return { side: pos.side, open: pos.t, close: t, entry: pos.entry, exit, why, gross, fees, net: gross - fees, bars: pos.age };
}

// ניהול פוזיציה בנר: סטופ קודם (מיידית), אחר כך יעד, אחר כך הזזת סטופ לכניסה (מהנר הבא), אחר כך זמן. מחזיר עסקה או null
function manage(pos, b, v){
  pos.age += 1;
  const long = pos.side === 'long';
  if (long ? b.l <= pos.sl : b.h >= pos.sl) return closeTrade(pos, long ? Math.min(pos.sl, b.o) : Math.max(pos.sl, b.o), false, b.t, pos.be ? 'סטופ בכניסה' : 'סטופ');
  if (Number.isFinite(pos.tp) && (long ? b.h >= pos.tp : b.l <= pos.tp)) return closeTrade(pos, long ? Math.max(pos.tp, b.o) : Math.min(pos.tp, b.o), pos.tpMaker, b.t, 'יעד');
  if (pos.beAt && !pos.be && (long ? b.h >= pos.beAt : b.l <= pos.beAt)){ pos.be = true; pos.sl = pos.entry * (1 + (long ? 1 : -1) * 0.0006); }
  if (pos.age >= v.maxBars) return closeTrade(pos, b.c, false, b.t, 'זמן');
  return null;
}

// מריץ גרסה אחת על נרות של מטבע אחד (בטווח הזמן של הגרסה). מחזיר רשימת עסקאות
export function simulate(bars, v){
  const trades = [], N = 20;
  let pos = null, pending = null;
  for (let i = N; i < bars.length; i++){
    const b = bars[i];
    if (pos){
      // touch: היעד זז עם הרצועות (ידועות לפני הנר)
      if (v.family === 'touch'){ const bb = bands(bars.slice(i - N, i).map((x) => x.c)); pos.tp = v.exit === 'mid' ? bb.mid : (pos.side === 'long' ? bb.up : bb.lo); }
      const tr = manage(pos, b, v); if (tr){ trades.push(tr); pos = null; }
      continue;
    }
    if (v.family === 'touch'){
      const prev = bars.slice(i - N, i).map((x) => x.c), bb = bands(prev), pc = prev.at(-1);
      if (pc < bb.lo || pc > bb.up || (bb.up - bb.lo) / bb.mid * 100 < v.minWidthPct) continue;
      const lo = b.l <= bb.lo, up = b.h >= bb.up;
      if (lo === up) continue; // אף אחת או שתיהן — מדלגים
      const side = lo ? 'long' : 'short', entry = lo ? bb.lo : bb.up;
      if (lo ? b.o < entry : b.o > entry) continue; // פער מעבר לרצועה — פקודה ממתינה (PostOnly) לא מתמלאת
      const sg = lo ? 1 : -1, sl = entry * (1 - sg * v.stopPct / 100);
      pos = { side, entry, sl, tp: NaN, tpMaker: true, entryMaker: true, notional: notionalFor(v.stopPct), t: b.t, age: 0 };
      if (lo ? b.l <= sl : b.h >= sl){ trades.push(closeTrade(pos, sl, false, b.t, 'סטופ')); pos = null; } // נר הכניסה ממשיך עד הסטופ
      continue;
    }
    if (v.family === 'sweep'){
      // האות מהנר הקודם שנסגר (i−1), כניסה בפתיחת הנר הזה
      const sb = bars[i - 1], bb = bands(bars.slice(i - N, i).map((x) => x.c));
      let side = null;
      if (sb.l < bb.lo && sb.c > bb.lo && sb.c > sb.o) side = 'long'; else if (sb.h > bb.up && sb.c < bb.up && sb.c < sb.o) side = 'short';
      if (!side) continue;
      const sg = side === 'long' ? 1 : -1, entry = b.o;
      let sl = side === 'long' ? sb.l * 0.9995 : sb.h * 1.0005;
      let stopPct = sg * (entry - sl) / entry * 100;
      if (!(stopPct > 0)) continue;
      if (stopPct < SIZE.minStopPct){ stopPct = SIZE.minStopPct; sl = entry * (1 - sg * stopPct / 100); }
      if (stopPct > 1.2) continue;
      const tp = v.target === 'mid' ? bb.mid : (side === 'long' ? bb.up : bb.lo);
      if (sg * (tp - entry) <= 0 || sg * (tp - entry) / Math.abs(entry - sl) < v.minRR) continue;
      pos = { side, entry, sl, tp, tpMaker: false, entryMaker: false, notional: notionalFor(stopPct), t: b.t, age: 0, beAt: entry + 0.5 * (tp - entry) };
      const tr = manage(pos, b, v); if (tr){ trades.push(tr); pos = null; }
      continue;
    }
    if (v.family === 'retrace'){
      if (pending && i > pending.until) pending = null;
      // נר תנופה חדש (i−1): טווח ≥ impulseX × ממוצע 14 הנרות שלפניו
      const ib = bars[i - 1], avg = bars.slice(i - 15, i - 1).reduce((s, x) => s + (x.h - x.l), 0) / 14;
      if (avg > 0 && ib.h - ib.l >= v.impulseX * avg && ib.c !== ib.o){
        const up = ib.c > ib.o, rng = ib.h - ib.l;
        const entry = up ? ib.h - v.retrace * rng : ib.l + v.retrace * rng;
        const sl = up ? ib.l * 0.999 : ib.h * 1.001, tp = up ? ib.h : ib.l;
        pending = { side: up ? 'long' : 'short', entry, sl, tp, until: i + v.validBars - 1 };
      }
      if (!pending) continue;
      const p = pending, long = p.side === 'long';
      if (long ? b.h >= p.tp : b.l <= p.tp){ pending = null; continue; } // המחיר חזר לקצה לפני שהתמלאנו — מבטלים
      if (!(long ? b.l <= p.entry : b.h >= p.entry)) continue;
      if (long ? b.o < p.entry : b.o > p.entry){ pending = null; continue; } // פער — PostOnly לא מתמלא
      const stopPct = Math.abs(p.entry - p.sl) / p.entry * 100;
      pending = null;
      if (stopPct > 2) continue;
      pos = { side: p.side, entry: p.entry, sl: p.sl, tp: p.tp, tpMaker: true, entryMaker: true, notional: notionalFor(stopPct), t: b.t, age: 0, beAt: p.entry + 0.5 * (p.tp - p.entry) };
      if (long ? b.l <= pos.sl : b.h >= pos.sl){ trades.push(closeTrade(pos, pos.sl, false, b.t, 'סטופ')); pos = null; }
    }
  }
  return trades;
}

// סטטיסטיקה: עסקאות, הצלחות, ברוטו, עמלות, נטו, יחס רווח/הפסד, ירידה מקסימלית (לפי סדר הסגירה), נטו ליום
export function stats(trades, days){
  const t = [...trades].sort((a, b) => a.close - b.close);
  let eq = 0, peak = 0, dd = 0, win = 0, loss = 0;
  for (const x of t){ eq += x.net; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); if (x.net > 0) win += x.net; else loss -= x.net; }
  const r = (x) => Math.round(x * 100) / 100;
  return { trades: t.length, wins: t.filter((x) => x.net > 0).length, winRate: t.length ? r(t.filter((x) => x.net > 0).length / t.length * 100) : null,
    gross: r(t.reduce((s, x) => s + x.gross, 0)), fees: r(t.reduce((s, x) => s + x.fees, 0)), net: r(eq),
    pf: loss > 0 ? r(win / loss) : (win > 0 ? Infinity : null), maxDD: r(dd), perDay: days ? r(eq / days) : null };
}

// כל 30 הגרסאות על כל המטבעות: { [coin]: bars1m } → [{ variant, total, byCoin }] ממוינים לפי נטו
export function runTournament(bars1mByCoin, days, variants = VARIANTS){
  const byTf = {};
  for (const [coin, bars] of Object.entries(bars1mByCoin)) for (const tf of Object.keys(TF)) (byTf[tf] ||= {})[coin] = aggregate(bars, tf);
  return variants.map((v) => {
    const byCoin = {}, all = [];
    for (const coin of Object.keys(bars1mByCoin)){ const tr = simulate(byTf[v.tf][coin], v); byCoin[coin] = stats(tr, days); all.push(...tr); }
    return { variant: v, total: stats(all, days), byCoin };
  }).sort((a, b) => b.total.net - a.total.net);
}
