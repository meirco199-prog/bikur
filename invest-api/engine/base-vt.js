// סבב מחקר מוגבל (בקשת מאיר 14/11/2026, אחרי 7כג): תיק 70% ביטקוין / 30% אתריום על לוח משותף של שני המטבעות, במנוע המחקר
// (runDaily עם drift, rebal ו-partial) — כך שהתיק הפסיבי וכל הגרסאות מאוזנים *באותם מועדים* בדיוק, וכל עסקה מבוצעת בפתיחה שאחרי ההחלטה.
//  מסנן: לכל מטבע — מחזיקים כשהסגירה מעל ממוצע n; יוצאים כשמתחת. slope > 0: כניסה רק אם הממוצע גם גבוה מערכו לפני slope ימים.
//  מסנן נבדק כל יום (כמו בניסוי המקורי); שינוי במסנן משנה רק את המטבע הזה (partial). איזון ל-70/30 (× k) לפי לוח: סוף חודש / יום ראשון.
//  יעד תנודתיות (vt): ביום איזון בלבד, k = min(1, vt / σ), כש-σ = תנודתיות שנתית של 30 הימים האחרונים (סגירות עד יום ההחלטה) של
//  התיק לפני ההקטנה (0.7·BTC·דגל + 0.3·ETH·דגל). תקרת חשיפה 100%, בלי מינוף ובלי שורט.
import { portVol } from './research-daily.js';
export const BASE = Object.freeze({ wb: 0.7, we: 0.3, volN: 30 });
// הקריטריון של שלב 2 — נקבע ונשמר כאן לפני ההרצה (14/11/2026). VT35 נמדד מול S200 המקורי (חודשי) ומול 70/30 פסיבי.
export const VT_PASS = Object.freeze({
  maxDD: 0.35,          // (1) ירידה מקסימלית ≤ 35% בכל אחת מהתקופות: אימון, אימות, מבחן
  calmarWins: 2,        // (2) יחס תשואה לירידה גבוה מ-S200 המקורי בלפחות 2 מ-3 התקופות, וגם על כל התקופה
  s22Gap: 0.05,         // (3) תשואה שנתית מ-2022 לא נמוכה ביותר מ-5 נקודות מ-S200 המקורי
  neighbors: [0.30, 0.40], // (4) עמידות: (1) ו-(2) מתקיימים גם ביעד 30% וביעד 40%, וגם בעלויות כפולות
  goal: 0.20,           // מידע (היעד הכללי של מאיר): לפחות 20% בשנה באימות ובמבחן — מדווח, לא חלק מהקריטריון
});
// ניסוי אחרון (בקשת מאיר 14/11/2026): חשיפה קבועה 35% ביטקוין / 15% אתריום / 50% מזומן, איזון חודשי. נקבע ונשמר לפני ההרצה.
// FIX = התיק הקבוע; S200 = 70/30 + ממוצע 200 (המקורי, חודשי); P = 70/30 פסיבי; PE = פסיבי בחשיפה הממוצעת של S200 על כל התקופה.
export const FIX = Object.freeze({ wb: 0.35, we: 0.15 });
export const FIX_PASS = Object.freeze({
  maxDD: 0.35,   // א(1) FIX: ירידה מקסימלית ≤ 35% באימון, באימות ובמבחן
  // א(2) FIX: תשואה ÷ ירידה על כל התקופה ≥ S200 · א(3) FIX: תשואה ÷ ירידה מ-2022 ≥ S200
  wins: 2,       // ב: S200 מול PE — תשואה ÷ ירידה גבוהה בלפחות 2 מ-3 התקופות (אימון, אימות, מבחן) וגם על כל התקופה → המסנן מוסיף ערך מעבר להקטנת החשיפה
});
const DAY = 86400e3;
const sma = (a, n, d) => { if (d < n - 1) return NaN; let s = 0; for (let i = d - n + 1; i <= d; i++){ if (!Number.isFinite(a[i])) return NaN; s += a[i]; } return s / n; };
export const isMonthEnd = (t) => new Date(t).getUTCMonth() !== new Date(t + DAY).getUTCMonth();
export const isSunday = (t) => new Date(t).getUTCDay() === 0;
// A = align({ BTC, ETH }); opts: { kind: 'passive' | 'sma', n, slope, vt, rebal: 'month' | 'week' }
export function baseStrat(A, { kind = 'sma', n = 200, slope = 0, vt = 0, rebal = 'month' } = {}, P = BASE){
  const W = [P.wb, P.we], isReb = rebal === 'week' ? isSunday : isMonthEnd;
  const id = `${kind === 'passive' ? 'P' : `S${n}${slope ? 's' + slope : ''}`}${vt ? '-VT' + Math.round(vt * 100) : ''}-${rebal === 'week' ? 'W' : 'M'}`;
  const strat = { id, rebal: (d) => isReb(A.days[d]), weights: (A, d, st) => {
    st.on ??= [false, false]; st.k ??= null;
    for (let k = 0; k < 2; k++){
      const C = A.C[k], c = C[d];
      if (!Number.isFinite(c)){ st.on[k] = false; continue; }
      if (kind === 'passive'){ st.on[k] = true; continue; }
      const m = sma(C, n, d); if (!Number.isFinite(m)){ st.on[k] = false; continue; }
      const up = !slope || m > sma(C, n, d - slope);
      if (!st.on[k] && c > m && up) st.on[k] = true; else if (st.on[k] && c < m) st.on[k] = false;
    }
    const base = W.map((x, k) => (st.on[k] ? x : 0));
    if (vt && (st.k === null || isReb(A.days[d]))){ const s = portVol(A, base, d, P.volN); st.k = s > 0 ? Math.min(1, vt / s) : 1; }
    const k = vt ? st.k : 1; return base.map((x) => x * k);
  } };
  return strat;
}
