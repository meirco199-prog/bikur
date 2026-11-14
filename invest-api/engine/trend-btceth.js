// משפחת מחקר חדשה (החלטת מאיר 14/11/2026, "כיוון 1"): מסחר מגמה על BTC ו-ETH בלבד — ספוט, רק לונג, בלי מינוף, בלי מס.
// שלוש שיטות עם כללים שנקבעו לפני ההרצה. כל שיטה היא "אסטרטגיה" של engine/research-daily.js (weights(A, d, st)) על לוח של מטבע
// אחד, ולכן הביצוע זהה למנוע המחקר: ההחלטה בסגירת d (רק מידע עד d כולל), הביצוע בפתיחת d+1, עמלה + החלקה, משקלות שזזים.
//  1. TF (מגמה): נכנסים כשהסגירה מעל ממוצע N והממוצע עולה (מעל הממוצע של לפני S ימים); יוצאים כשהסגירה מתחת לממוצע.
//  2. BR (פריצה ובדיקה חוזרת): סגירה מעל השיא של N הסגירות הקודמות = פריצה (רמה = אותו שיא). תוך 10 ימים: יום שבו השפל חוזר לרמה
//     (עד T% מעליה) והסגירה מעל הרמה → כניסה. פריצה שנסגרה 5% מתחת לרמה — מבוטלת. יציאה: סגירה מתחת לשפל של K הסגירות
//     הקודמות, או 5% מתחת לרמת הפריצה.
//  3. MP (מגמה ותיקון): מגמת עלייה = סגירה מעל ממוצע 200 וממוצע 50 מעל ממוצע 200; כניסה כשהסגירה D% ומעלה מתחת לשיא של 20 הסגירות
//     האחרונות (תיקון, לא אחרי זינוק). יציאה: סגירה מתחת לממוצע E, או 15% מתחת לסגירה של יום הכניסה.
export const TREND = Object.freeze({
  TF: { primary: { n: 100, s: 20 }, grid: [50, 100, 150, 200].flatMap((n) => [10, 20, 40].map((s) => ({ n, s }))) },
  BR: { primary: { n: 20, t: 0.02, k: 10 }, grid: [20, 40, 55].flatMap((n) => [0.01, 0.02, 0.04].flatMap((t) => [10, 20].map((k) => ({ n, t, k })))) },
  MP: { primary: { dd: 0.08, e: 100 }, grid: [0.05, 0.08, 0.12].flatMap((dd) => [50, 100].map((e) => ({ dd, e }))) },
  retestDays: 10, brFail: 0.05, mpStop: 0.15, mpHi: 20,
});
const sma = (a, n, d) => { if (d < n - 1) return NaN; let s = 0; for (let i = d - n + 1; i <= d; i++){ if (!Number.isFinite(a[i])) return NaN; s += a[i]; } return s / n; };
const maxPrev = (a, n, d) => { if (d < n) return NaN; let m = -Infinity; for (let i = d - n; i < d; i++){ if (!Number.isFinite(a[i])) return NaN; m = Math.max(m, a[i]); } return m; };
const minPrev = (a, n, d) => { if (d < n) return NaN; let m = Infinity; for (let i = d - n; i < d; i++){ if (!Number.isFinite(a[i])) return NaN; m = Math.min(m, a[i]); } return m; };
const maxIncl = (a, n, d) => { if (d < n - 1) return NaN; let m = -Infinity; for (let i = d - n + 1; i <= d; i++){ if (!Number.isFinite(a[i])) return NaN; m = Math.max(m, a[i]); } return m; };

// כל הבונים מחזירים אסטרטגיה למטבע יחיד (k = 0) — weights(A, d, st) → [0 | 1]. המצב (st) מתעדכן יום אחרי יום, מ-d = 0.
export function trendTF({ n, s }){
  return { id: `TF-${n}-${s}`, weights: (A, d, st) => {
    const C = A.C[0], c = C[d], m = sma(C, n, d), m0 = sma(C, n, d - s);
    if (!Number.isFinite(m) || !Number.isFinite(m0) || !Number.isFinite(c)) return [st.in ? 1 : 0];
    if (!st.in && c > m && m > m0) st.in = true; else if (st.in && c < m) st.in = false;
    return [st.in ? 1 : 0];
  } };
}
export function trendBR({ n, t, k }, P = TREND){
  return { id: `BR-${n}-${Math.round(t * 100)}-${k}`, weights: (A, d, st) => {
    const C = A.C[0], L = A.L[0], c = C[d];
    if (!Number.isFinite(c)) return [st.in ? 1 : 0];
    if (st.in){ const lo = minPrev(C, k, d); if ((Number.isFinite(lo) && c < lo) || c < st.level * (1 - P.brFail)){ st.in = false; st.level = null; } return [st.in ? 1 : 0]; }
    if (st.pend){ // פריצה ממתינה לבדיקה חוזרת
      if (d - st.pend.d > P.retestDays || c < st.pend.level * (1 - P.brFail)) st.pend = null;
      else if (d > st.pend.d && Number.isFinite(L[d]) && L[d] <= st.pend.level * (1 + t) && c > st.pend.level){ st.in = true; st.level = st.pend.level; st.pend = null; return [1]; }
    }
    const hi = maxPrev(C, n, d);
    if (!st.pend && Number.isFinite(hi) && c > hi) st.pend = { level: hi, d };
    return [0];
  } };
}
export function trendMP({ dd, e }, P = TREND){
  return { id: `MP-${Math.round(dd * 100)}-${e}`, weights: (A, d, st) => {
    const C = A.C[0], c = C[d];
    if (!Number.isFinite(c)) return [st.in ? 1 : 0];
    if (st.in){ const me = sma(C, e, d); if ((Number.isFinite(me) && c < me) || c < st.entry * (1 - P.mpStop)) st.in = false; return [st.in ? 1 : 0]; }
    const m50 = sma(C, 50, d), m200 = sma(C, 200, d), hi = maxIncl(C, P.mpHi, d);
    if (c > m200 && m50 > m200 && Number.isFinite(hi) && c <= hi * (1 - dd)){ st.in = true; st.entry = c; return [1]; }
    return [0];
  } };
}
export const BUILD = { TF: trendTF, BR: trendBR, MP: trendMP };
// כלל סיכון פשוט לתיק בסיס (בקשת מאיר 14/11/2026, אחרי כיוון 2): מחזיקים כשהסגירה מעל ממוצע n, מזומן כשמתחת. בלי מסנן שיפוע.
export function smaFilter({ n }){
  return { id: `SMA-${n}`, weights: (A, d, st) => {
    const C = A.C[0], c = C[d], m = sma(C, n, d);
    if (!Number.isFinite(m) || !Number.isFinite(c)) return [st.in ? 1 : 0];
    if (!st.in && c > m) st.in = true; else if (st.in && c < m) st.in = false;
    return [st.in ? 1 : 0];
  } };
}

// שתי סדרות יומיות (BTC, ETH) → תיק 50/50 (או wa/1−wa) שחוזר להקצאה בתחילת כל חודש. עלות ההעברה: החלק שעובר בין החלקים × החשיפה של כל חלק
// (מזומן עובר בחינם; חלק מושקע קונה/מוכר את המטבע) × bps לכל צד (ברירת מחדל 0 — לבדיקות; המחקר מעביר 10+2).
export function combine5050(a, b, { bps = 0, wa = 0.5 } = {}){
  const ts = [...new Set([...a.map((x) => x.t), ...b.map((x) => x.t)])].sort((p, q) => p - q), ma = new Map(a.map((x) => [x.t, x])), mb = new Map(b.map((x) => [x.t, x]));
  let ea = wa, eb = 1 - wa, prevM = null, xa0 = 0, xb0 = 0; const out = [];
  for (const t of ts){ const m = new Date(t).getUTCMonth(), xa = ma.get(t), xb = mb.get(t); let rc = 0;
    if (prevM !== null && m !== prevM){ const e = ea + eb, dlt = Math.abs(ea - e * wa); rc = dlt * (xa0 + xb0) * bps / 1e4 / e; ea = e * (1 - rc) * wa; eb = e * (1 - rc) * (1 - wa); }
    prevM = m;
    const ra = xa?.net ?? 0, rb = xb?.net ?? 0, e0 = ea + eb;
    const net = (ea * ra + eb * rb) / e0 * (1 - rc) - rc, cost = (ea * (xa?.cost ?? 0) + eb * (xb?.cost ?? 0)) / e0 + rc, turn = (ea * (xa?.turn ?? 0) + eb * (xb?.turn ?? 0)) / e0, exp = (ea * (xa?.exp ?? 0) + eb * (xb?.exp ?? 0)) / e0;
    ea *= 1 + ra; eb *= 1 + rb; xa0 = xa?.exp ?? 0; xb0 = xb?.exp ?? 0; out.push({ t, net, gross: 0, cost, fund: 0, turn, exp }); }
  return out;
}
// משך ההתאוששות הארוך ביותר (ימים משיא עד שיא חדש) בחלון; ירידה פתוחה נספרת עד סוף החלון
export function longestRecovery(series, { from = -Infinity, to = Infinity } = {}){
  let e = 1, pk = 1, pkT = null, best = 0, open = false;
  for (const x of series){ if (x.t < from || x.t >= to) continue; if (pkT === null) pkT = x.t; e *= 1 + x.net; if (e >= pk){ best = Math.max(best, (x.t - pkT) / 86400e3); pk = e; pkT = x.t; open = false; } else open = true;
    if (open) best = Math.max(best, (x.t - pkT) / 86400e3); }
  return Math.round(best);
}
