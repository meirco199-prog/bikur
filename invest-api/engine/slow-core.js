// ענף מחקר נפרד (אישור מאיר 14/11/2026): Slow Core Momentum — מומנטום איטי על שלושת נכסי הליבה (BTC, ETH, SOL). מחקר בלבד; לא נוגע
// במעקב הווירטואלי של XSRA-7. הכללים והקריטריון נקבעו ונשמרו כאן לפני ההרצה.
//  איזון: בדיוק כל 30 ימים קלנדריים — יום ההחלטה הוא יום שמספרו מ-1/1/1970 מתחלק ב-30 (UTC); ביצוע בפתיחה שאחרי.
//  כשיר: תשואת 90 הימים האחרונים חיובית (וגם — בגרסה המציאותית — הנכס כבר רשום ב-Bybit).
//  דירוג: תשואת 90 יום חלקי סטיית התקן של התשואות היומיות ב-90 הימים; מחזיקים את שני הראשונים.
//  שניים כשירים: משקל לפי הציון, עם תקרה של 60% לנכס (השאר לשני) · אחד כשיר: 50% בו ו-50% מזומן · אף אחד: 100% מזומן. מזומן — 0% ריבית.
//  delay: ביצוע מאוחר ביום נוסף (בדיקת עמידות) — ההחלטה והאיזון זזים יום אחד.
export const SLOW_CORE = Object.freeze({ coins: ['BTC', 'ETH', 'SOL'], period: 30, lookback: 90, top: 2, cap: 0.60, single: 0.50 });
export const SC_PASS = Object.freeze({
  cagr: 0.20,     // (1) לפחות 20% בשנה לפני מס — מ-2022 ובתקופת המבחן
  maxDD: 0.35,    // (2) ירידה מקסימלית ≤ 35% בכל תקופה (מ-2022, מבחן, כל התקופה)
  turnover: 4,    // (3) מחזור שנתי < פי 4
  // (4) מול תיק פסיבי של 3 הנכסים (שליש לכל אחד, קנה והחזק, בלי איזון): תשואה שנתית גבוהה יותר וירידה מקסימלית קטנה יותר — מ-2022 ובמבחן
});
const DAY = 86400e3;
export const isReb30 = (t, period = SLOW_CORE.period) => Math.floor(t / DAY) % period === 0;
// A = align({ BTC, ETH, SOL }) (הסדר לפי P.coins); allow(k, t) — זמינות (למשל תאריך רישום); opts.lookback לבדיקת עמידות
export function slowCore(A, { allow = null, delay = 0, lookback } = {}, P = SLOW_CORE){
  const L = lookback ?? P.lookback, K = A.coins.length;
  const decide = (d) => {
    const sc = [];
    for (let k = 0; k < K; k++){
      const C = A.C[k]; if (d < L || !Number.isFinite(C[d]) || !Number.isFinite(C[d - L])) continue;
      if (allow && !allow(k, A.days[d])) continue;
      const r = C[d] / C[d - L] - 1; if (!(r > 0)) continue;
      let m = 0, ok = true; const xs = [];
      for (let i = d - L + 1; i <= d; i++){ const x = C[i] / C[i - 1] - 1; if (!Number.isFinite(x)){ ok = false; break; } xs.push(x); m += x; }
      if (!ok) continue; m /= xs.length; const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
      if (sd > 0) sc.push([k, r / sd]);
    }
    sc.sort((a, b) => b[1] - a[1]);
    const w = new Array(K).fill(0), pick = sc.slice(0, P.top);
    if (pick.length === 1) w[pick[0][0]] = P.single;
    else if (pick.length >= 2){ const s = pick.reduce((a, [, z]) => a + z, 0); let a = pick[0][1] / s; a = Math.min(P.cap, Math.max(1 - P.cap, a)); w[pick[0][0]] = a; w[pick[1][0]] = 1 - a; }
    return w;
  };
  const isReb = (d) => d - delay >= 0 && isReb30(A.days[d - delay], P.period);
  return { id: `SCM-${L}${delay ? '-d' + delay : ''}`, rebal: isReb, weights: (A2, d, st) => {
    if (isReb(d) || !st.w){ st.w = isReb(d) ? decide(d - delay) : new Array(K).fill(0); }
    return st.w;
  } };
}
// קנה והחזק מיום from (לפניו מזומן): קונים את w פעם אחת ולא מאזנים. rebalEvery30 = true → אותם משקלות, מאוזנים באותם ימים כמו השיטה.
export const holdFrom = (w, from, { rebalEvery30 = false } = {}) => ({ id: rebalEvery30 ? 'EQ30' : 'HOLD', rebal: rebalEvery30 ? null : null,
  weights: (A, d) => (A.days[d] >= from ? w.slice() : w.map(() => 0)) });
