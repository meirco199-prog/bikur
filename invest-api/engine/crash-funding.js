// כיוון 2 (אישור מאיר 14/11/2026): קנייה בקריסות לפי דמי המימון — BTC ו-ETH בלבד, ספוט, רק לונג, בלי מינוף, בלי מס.
// ההיגיון הכלכלי: אחרי קריסה, כשדמי המימון שליליים (השורטים משלמים ללונגים), השוק עמוס במוכרים בחסר וממונפים נמחקו — מחפשים
// התאוששות. הכללים נקבעו לפני ההרצה. כל אסטרטגיה היא weights(A, d, st) למטבע יחיד, כמו ב-engine/trend-btceth.js, ולכן הביצוע זהה:
// ההחלטה בסגירת d (רק מידע עד d כולל — כולל דמי המימון של יום d, שידועים בסגירה), הביצוע בפתיחת d+1.
//  קריסה: הסגירה של d נמוכה ב-x ומעלה מהשיא של 7 הסגירות הקודמות (ETH: x × 4/3, כי הוא תנודתי יותר).
//  מסנן מימון (f): 'neg' = ממוצע דמי המימון היומיים של 3 הימים האחרונים שלילי · 'neg1' = מתחת ל-−0.01% ליום · 'p10' = בעשירון
//  התחתון של כל הממוצעים הקודמים (לפחות 180 ימי היסטוריה) · 'none' = בלי מסנן (להשוואה: האם המימון מוסיף משהו).
//  החזקה: h ימים מההחלטה, או יציאה כשהסגירה 20% מתחת לסגירה של יום הכניסה. אחרי יציאה — כניסה חדשה רק אחרי שתנאי הקריסה התבטל
//  לפחות יום אחד (אירוע חדש, לא אותה קריסה).
export const CF = Object.freeze({
  primary: { x: 0.15, f: 'neg', h: 20 },
  grid: [0.10, 0.15, 0.20].flatMap((x) => ['neg', 'neg1', 'p10'].flatMap((f) => [10, 20, 40].map((h) => ({ x, f, h })))),
  look: 7, fN: 3, stop: 0.20, ethMult: 4 / 3, pctMin: 180, pctQ: 0.10, neg1: -0.0001,
});
const DAY = 86400e3;
const maxPrev = (a, n, d) => { if (d < n) return NaN; let m = -Infinity; for (let i = d - n; i < d; i++){ if (!Number.isFinite(a[i])) return NaN; m = Math.max(m, a[i]); } return m; };
export const crashDepth = (A, d, P = CF) => { const hi = maxPrev(A.C[0], P.look, d), c = A.C[0][d]; return Number.isFinite(hi) && Number.isFinite(c) ? 1 - c / hi : NaN; };

// דמי מימון יומיים (Map: יום UTC → סכום יומי) → ממוצע של fN הימים עד d כולל (לפחות 2 תצפיות), וסף העשירון מההיסטוריה שלפני d
export function fundingView(A, F, P = CF){
  const avg = A.days.map((t, d) => { let s = 0, n = 0; for (let i = Math.max(0, d - P.fN + 1); i <= d; i++){ const v = F.get(A.days[i]); if (v !== undefined){ s += v; n++; } } return n >= 2 ? s / n : NaN; });
  const q = new Array(A.days.length).fill(NaN), hist = [];
  for (let d = 0; d < A.days.length; d++){ // רק ממוצעים של ימים קודמים (בלי d) — בלי הצצה לעתיד
    if (hist.length >= P.pctMin){ const s = hist.slice().sort((a, b) => a - b); q[d] = s[Math.floor(s.length * P.pctQ)]; }
    if (Number.isFinite(avg[d])) hist.push(avg[d]); }
  return { avg, q };
}
export function fundOK(fv, d, f, P = CF){
  if (f === 'none') return true; const a = fv.avg[d]; if (!Number.isFinite(a)) return false;
  return f === 'neg' ? a < 0 : f === 'neg1' ? a < P.neg1 : f === 'p10' ? Number.isFinite(fv.q[d]) && a <= fv.q[d] : false;
}
// כלל ההחזקה המשותף: entry(d) → בוליאני (האם יש אירוע ביום d); arm(d) → האם תנאי הקריסה כבוי (מאפשר אירוע חדש)
export function holder(id, entry, arm, { h, stop = CF.stop }){
  return { id, weights: (A, d, st) => {
    const c = A.C[0][d]; if (st.armed === undefined) st.armed = true;
    if (!Number.isFinite(c)) return [st.in ? 1 : 0];
    if (st.in){ st.n += 1; if (st.n >= h || c < st.entry * (1 - stop)){ st.in = false; } if (arm(d)) st.armed = true; return [st.in ? 1 : 0]; }
    if (arm(d)) st.armed = true;
    if (st.armed && entry(d)){ st.in = true; st.entry = c; st.n = 0; st.armed = false; return [1]; }
    return [0];
  } };
}
// האסטרטגיה: coin = 'BTC' | 'ETH' (לסף), F = Map של דמי המימון היומיים
export function crashBuy(A, F, coin, { x, f, h }, P = CF){
  const X = coin === 'ETH' ? x * P.ethMult : x, fv = fundingView(A, F, P);
  return holder(`CF-${Math.round(x * 100)}-${f}-${h}`, (d) => crashDepth(A, d, P) >= X && fundOK(fv, d, f, P), (d) => !(crashDepth(A, d, P) >= X), { h, stop: P.stop });
}
// השוואה אקראית: אותם ימי החזקה וכלל עצירה, כניסות בימים אקראיים (rng) בהסתברות p ליום
export function randomBuy(rng, p, { h }, P = CF){
  return holder('RND', () => rng() < p, () => true, { h, stop: P.stop });
}
// עסקאות מסדרה של runDaily: רצף ימים עם חשיפה (כולל יום היציאה)
export function tradeList(sr){
  const out = []; let cur = null;
  for (const x of sr){ if (x.exp > 0){ if (!cur) cur = { t: x.t, r: 1, n: 0 }; cur.r *= 1 + x.net; cur.n += 1; }
    else if (cur){ cur.r *= 1 + x.net; out.push({ t: cur.t, ret: cur.r - 1, days: cur.n }); cur = null; } }
  if (cur) out.push({ t: cur.t, ret: cur.r - 1, days: cur.n, open: true });
  return out;
}
export const toFundingMap = (rows) => new Map(rows.map(([day, r]) => [Date.parse(day + 'T00:00:00Z'), r]));
export { DAY };
