// מחקר המשך (בקשת מאיר, 7/11/2026: "תבדוק גם שיטות אחרות בקריפטו שכן עבדו לאורך שנים"): בדיקה לאחור של שיטות ארוכות טווח על נרות
// יומיים — מעקב מגמה, מומנטום בין מטבעות, יחס ETH/BTC, וגביית Funding. מחקר בלבד: פונקציות טהורות, בלי רשת, בלי פקודות.
// ההבדל מ-engine/research.js: כאן תיק יומי (משקלות לכל מטבע) ולא עסקאות בודדות על נרות דקה. אותו פרוטוקול: אימון/אימות/מבחן, Walk-Forward,
// בחירה לפי הגבול התחתון של טווח הביטחון (של יחס שארפ) ולא לפי הרווח, עלויות מלאות, ובלי מינוף (חשיפה כוללת ≤ 100% מההון).
//
// ביצוע: ההחלטה בסגירת יום d (UTC), הביצוע בפתיחת יום d+1. לונג בלבד = ספוט (עמלה 0.1% לכל צד, בלי Funding). לונג/שורט = חוזה
// (0.055%, Funding: שיעור היסטורי אם יש; אחרת לונג משלם 0.03% ליום ושורט לא מקבל כלום — שמרני). מרווח+החלקה לכל צד לפי מטבע.

export const DCOST = Object.freeze({ spotBps: 10, perpBps: 5.5, slipBps: { BTC: 2, ETH: 2 }, slipOther: 5, longFundBpsDay: 3 });
const DAY = 86400e3;

// { coin: [{t,o,h,l,c}] } → לוח יומי משותף: days[], O/H/L/C[k][d] (NaN לפני שהמטבע קיים)
export function align(byCoin){
  const coins = Object.keys(byCoin), set = new Set();
  for (const c of coins) for (const b of byCoin[c]) set.add(Math.floor(b.t / DAY) * DAY);
  const days = [...set].sort((a, b) => a - b), idx = new Map(days.map((d, i) => [d, i]));
  const M = () => coins.map(() => new Float64Array(days.length).fill(NaN));
  const O = M(), H = M(), L = M(), C = M(), V = M(); // V = נפח מסחר (ביחידות המטבע), אם יש בנרות (b.v); אחרת NaN
  coins.forEach((c, k) => { for (const b of byCoin[c]){ const i = idx.get(Math.floor(b.t / DAY) * DAY); O[k][i] = b.o; H[k][i] = b.h; L[k][i] = b.l; C[k][i] = b.c; if (Number.isFinite(b.v)) V[k][i] = b.v; } });
  // יום חסר באמצע (אין מסחר) → ממשיכים את הסגירה הקודמת, כדי שתשואה לא תיחשב כחסרה
  for (let k = 0; k < coins.length; k++) for (let d = 1; d < days.length; d++) if (Number.isNaN(C[k][d]) && Number.isFinite(C[k][d - 1]) && hasLater(C[k], d)){ C[k][d] = O[k][d] = H[k][d] = L[k][d] = C[k][d - 1]; V[k][d] = 0; }
  return { coins, days, O, H, L, C, V };
}
const hasLater = (a, d) => { for (let i = d + 1; i < a.length; i++) if (Number.isFinite(a[i])) return true; return false; };

const sma = (a, n, d) => { if (d < n - 1) return NaN; let s = 0; for (let i = d - n + 1; i <= d; i++){ if (!Number.isFinite(a[i])) return NaN; s += a[i]; } return s / n; };
const ret = (a, n, d) => (d >= n && Number.isFinite(a[d]) && Number.isFinite(a[d - n]) ? a[d] / a[d - n] - 1 : NaN);
const hi = (a, n, d) => { if (d < n) return NaN; let m = -Infinity; for (let i = d - n; i < d; i++){ if (!Number.isFinite(a[i])) return NaN; m = Math.max(m, a[i]); } return m; };
const lo = (a, n, d) => { if (d < n) return NaN; let m = Infinity; for (let i = d - n; i < d; i++){ if (!Number.isFinite(a[i])) return NaN; m = Math.min(m, a[i]); } return m; };
const vol = (C, n, d) => { if (d < n) return NaN; let s = 0, s2 = 0; for (let i = d - n + 1; i <= d; i++){ const r = Math.log(C[i] / C[i - 1]); if (!Number.isFinite(r)) return NaN; s += r; s2 += r * r; } const m = s / n; return Math.sqrt(Math.max(0, s2 / n - m * m) * 365); };

// ---------- אסטרטגיות: (A, d, state) → משקלות יעד לכל מטבע (סכום |w| ≤ 1). מתבצעות בפתיחת d+1 ----------
// כל אסטרטגיה: { id, family, perp (לונג/שורט בחוזה), weights(A, d, st) }
// rebalDow (בקשה 8/11 אחרי הערת GPT): יום קבוע בשבוע (UTC, 0 = ראשון) להחלפת המומנטום בין מטבעות, כמו במעקב ה-Paper. ברירת מחדל: d % 7 (כל 7 ימים מתחילת הנתונים)
export function strategies(coins, { rebalDow = null } = {}){
  const K = coins.length, iB = coins.indexOf('BTC'), iE = coins.indexOf('ETH');
  const live = (A, k, d, need) => d >= need && Number.isFinite(A.C[k][d - need]) && Number.isFinite(A.C[k][d]);
  const ew = (A, d, f, need) => { const act = []; for (let k = 0; k < K; k++) if (live(A, k, d, need)) act.push(k); const w = new Array(K).fill(0); if (!act.length) return w; for (const k of act){ const s = f(k); if (s) w[k] = s / act.length; } return w; };
  const S = [];
  // השוואה: קנה והחזק
  S.push({ id: 'BH-BTC', family: 'bench', weights: (A, d) => coins.map((_, k) => (k === iB && Number.isFinite(A.C[k][d]) ? 1 : 0)) });
  S.push({ id: 'BH-EW', family: 'bench', weights: (A, d) => ew(A, d, () => 1, 1) });
  // 1. ממוצע נע: מחזיקים מטבע כשהסגירה מעל הממוצע של N ימים (ספוט, לונג בלבד)
  for (const n of [50, 100, 200]){
    S.push({ id: `MA${n}-BTC`, family: 'ma', weights: (A, d) => coins.map((_, k) => (k === iB && A.C[k][d] > sma(A.C[k], n, d) ? 1 : 0)) });
    S.push({ id: `MA${n}-EW`, family: 'ma', weights: (A, d) => ew(A, d, (k) => (A.C[k][d] > sma(A.C[k], n, d) ? 1 : 0), n) });
  }
  // 2. מומנטום בזמן (TSMOM): תשואת L ימים חיובית → לונג; גרסת לונג/שורט בחוזה
  for (const L of [14, 28, 56, 91]){
    S.push({ id: `TS${L}-EW`, family: 'tsmom', weights: (A, d) => ew(A, d, (k) => (ret(A.C[k], L, d) > 0 ? 1 : 0), L) });
    S.push({ id: `TS${L}-LS`, family: 'tsmom', perp: true, weights: (A, d) => ew(A, d, (k) => { const r = ret(A.C[k], L, d); return r > 0 ? 1 : r < 0 ? -1 : 0; }, L) });
  }
  // 3. פריצת ערוץ יומית (Donchian): כניסה בשיא N ימים, יציאה בשפל M ימים (ספוט, לונג בלבד)
  for (const [n, m] of [[20, 10], [55, 20], [100, 50]]){
    S.push({ id: `DC${n}-${m}-EW`, family: 'donchian', weights: (A, d, st) => {
      st.in ||= new Array(K).fill(0);
      return ew(A, d, (k) => { const c = A.C[k][d]; if (!st.in[k] && c > hi(A.C[k], n, d)) st.in[k] = 1; else if (st.in[k] && c < lo(A.C[k], m, d)) st.in[k] = 0; return st.in[k]; }, n);
    } });
  }
  // 4. מומנטום בין מטבעות: פעם בשבוע — K החזקים לפי תשואת L ימים (ספוט). גרסה עם מסנן: רק כש-BTC מעל הממוצע של 200 יום
  for (const L of [14, 28, 56]) for (const top of [3, 5]) for (const filt of [false, true]){
    S.push({ id: `XS${L}-top${top}${filt ? '-f200' : ''}`, family: 'xsmom', weights: (A, d, st) => {
      const reb = rebalDow === null ? d % 7 === 0 : new Date(A.days[d]).getUTCDay() === rebalDow;
      if (st.w && !reb) return st.w;
      const r = []; for (let k = 0; k < K; k++) if (live(A, k, d, Math.max(L, 60))){ const x = ret(A.C[k], L, d); if (Number.isFinite(x)) r.push([k, x]); }
      const w = new Array(K).fill(0);
      if (!(filt && !(A.C[iB][d] > sma(A.C[iB], 200, d)))){ r.sort((a, b) => b[1] - a[1]); const pick = r.slice(0, top).filter((x) => x[1] > 0); for (const [k] of pick) w[k] = 1 / top; }
      return (st.w = w);
    } });
  }
  // 5. יחס ETH/BTC: חריגה של ציון תקן (60 יום) מעבר ל-±z → מהמרים על חזרה (חוזה, ניטרלי לשוק); יציאה בחציית האפס
  if (iB >= 0 && iE >= 0) for (const z of [1.5, 2]){
    S.push({ id: `EB-z${z}`, family: 'ethbtc', perp: true, weights: (A, d, st) => {
      const w = new Array(K).fill(0), n = 60; if (d < n) return w;
      const x = []; for (let i = d - n + 1; i <= d; i++){ const v = Math.log(A.C[iE][i] / A.C[iB][i]); if (!Number.isFinite(v)) return w; x.push(v); }
      const m = x.reduce((s, v) => s + v, 0) / n, sd = Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / n), zz = sd > 0 ? (x.at(-1) - m) / sd : 0;
      if (!st.pos && zz < -z) st.pos = 1; else if (!st.pos && zz > z) st.pos = -1; else if (st.pos && Math.sign(zz) === st.pos) st.pos = 0;
      w[iE] = 0.5 * (st.pos || 0); w[iB] = -0.5 * (st.pos || 0); return w;
    } });
  }
  return S;
}

// ---------- מומנטום בין מטבעות "משודרג" (בקשת מאיר 13/11/2026, אחרי בדיקות העמידות של 3 המטבעות) ----------
// הכללים נקבעו מראש, בלי כיוונון מספרים: בסגירת יום dow (UTC) —
// 1. יקום דינמי: 15 המטבעות עם נפח המסחר הדולרי (סגירה × נפח) הגבוה ב-30 הימים האחרונים (רק מידע עד d).
// 2. מאקרו: BTC מעל הממוצע של 100 יום, אחרת מזומן. מיקרו: המטבע עצמו מעל הממוצע של 50 יום שלו.
// 3. דירוג: תשואת 21 יום חלקי סטיית התקן של התשואות היומיות ב-21 הימים (לא שנתי). 4 הראשונים, 25% לכל אחד (פחות מועמדים → מזומן).
// מנה (tranche) אחת = אסטרטגיה עם יום החלפה אחד; שתי מנות של 50% (ראשון + רביעי) מחברים עם combineSleeves.
export const XSRA = Object.freeze({ uni: 15, volN: 30, smaMacro: 100, smaMicro: 50, retN: 21, top: 4 });
// rel (הצעת GPT 13/11, ענף מחקר נפרד — "מומנטום יחסי מול ביטקוין"): מטבע שאינו BTC נכנס רק אם תשואת 21 הימים שלו גבוהה משל BTC;
// דירוג בין הנבחרים — אותו ציון (תשואה/תנודתיות). משבצת שלא התמלאה מקבלת BTC (במקום מזומן). המסנן המאקרו (BTC מעל ממוצע 100) נשאר: מתחתיו — מזומן.
// rng (בדיקת בסיס אקראית, משימת ההגנות 13/11): במקום הדירוג — בחירה אקראית מבין המועמדים שעברו את כל המסננים (אותו מספר מטבעות).
// allow(k, dayMs) (בדיקת Bybit): מטבע שאינו זמין באותו יום לא נכנס ליקום. ברירות המחדל לא משנות שום דבר.
// isReb(dayMs) (בדיקת האיזון החודשי, 14/11): יום ההחלפה לפי פונקציה במקום יום בשבוע. ברירת המחדל (null) — יום בשבוע, כמו קודם.
export function xsRiskAdj(coins, { dow = 0, P = XSRA, id, rel = false, rng = null, allow = null, isReb = null } = {}){
  const K = coins.length, iB = coins.indexOf('BTC');
  return { id: id || `XSRA${rel ? 'rel' : ''}-d${dow}`, family: 'xsra', weights: (A, d, st) => {
    const reb = isReb ? isReb(A.days[d]) : new Date(A.days[d]).getUTCDay() === dow;
    if (st.w && !reb) return st.w;
    const w = new Array(K).fill(0); st.pick = [];
    if (!(iB >= 0 && A.C[iB][d] > sma(A.C[iB], P.smaMacro, d))) return (st.w = w);
    const need = Math.max(P.volN, P.smaMicro, P.retN + 1);
    const dv = [];
    for (let k = 0; k < K; k++){
      if (d < need) continue; let s = 0, ok = true;
      for (let i = d - P.volN + 1; i <= d; i++){ const x = A.C[k][i] * A.V[k][i]; if (!Number.isFinite(x)){ ok = false; break; } s += x; }
      if (ok && s > 0 && Number.isFinite(A.C[k][d - need]) && (!allow || allow(k, A.days[d]))) dv.push([k, s]);
    }
    dv.sort((a, b) => b[1] - a[1]);
    const cand = [];
    const rB = ret(A.C[iB], P.retN, d);
    for (const [k] of dv.slice(0, P.uni)){
      if (rel && (k === iB || !(ret(A.C[k], P.retN, d) > rB))) continue; // יחסי: רק מטבעות שעלו יותר מ-BTC (BTC עצמו — רק כממלא מקום)
      if (!(A.C[k][d] > sma(A.C[k], P.smaMicro, d))) continue;
      const r = ret(A.C[k], P.retN, d); let m = 0; const xs = [];
      for (let i = d - P.retN + 1; i <= d; i++){ const x = A.C[k][i] / A.C[k][i - 1] - 1; xs.push(x); m += x; }
      m /= xs.length; const sd = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
      if (Number.isFinite(r) && sd > 0) cand.push([k, r / sd]);
    }
    if (rng){ for (let i = cand.length - 1; i > 0; i--){ const j = Math.floor(rng() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; } } else cand.sort((a, b) => b[1] - a[1]);
    for (const [k] of cand.slice(0, P.top)) w[k] = 1 / P.top;
    if (rel && cand.length < P.top) w[iB] += (P.top - cand.length) / P.top; // משבצות ריקות → BTC
    st.pick = cand.slice(0, P.top).map(([k, z]) => [coins[k], z]);
    return (st.w = w);
  } };
}
// מנות נפרדות: כל מנה תיק עצמאי (משקלות שזזים, עלויות משלה), בלי איזון בין המנות. התשואה היומית = ממוצע משוקלל לפי ההון של כל מנה.
export function combineSleeves(list, shares = list.map(() => 1 / list.length)){
  const n = list[0].length; for (const s of list) if (s.length !== n) throw new Error('combineSleeves: אורכים שונים');
  const eq = shares.slice(), out = [];
  for (let i = 0; i < n; i++){
    const tot = eq.reduce((a, b) => a + b, 0); let net = 0, gross = 0, cost = 0, turn = 0, exp = 0;
    list.forEach((s, j) => { const f = eq[j] / tot, x = s[i]; if (x.t !== list[0][i].t) throw new Error('combineSleeves: ימים שונים');
      net += f * x.net; gross += f * x.gross; cost += f * x.cost; turn += f * x.turn; exp += f * x.exp; eq[j] *= 1 + x.net; });
    out.push({ t: list[0][i].t, gross, cost, fund: 0, net, turn, exp });
  }
  return out;
}

// ---------- הרצת תיק יומי ----------
// funding: { coin: Map(dayMs → סכום שיעורי Funding של היום) } (אופציונלי)
// leverage > 1 (בקשת מאיר 7/11: "תריץ את הבדיקה במינוף ×1.5 ו-×2"): המשקלות כפול המינוף, הביצוע בחוזה (עמלת חוזה + Funding על כל
// הנוציונל), וחיסול: אם במהלך היום (שפל/שיא) ההון יורד מתחת לביטחונות המינימליים (mmr × החשיפה) — ההון מתאפס והסדרה נעצרת.
// liqBy: 'low' = לפי השפל של היום בבורסה (מחמיר: גם "פתיל" חריג של בורסה אחת); 'close' = לפי הסגירה (מקל: מחיר הסימון בחוזים מבוסס מדד של כמה בורסות)
// drift (8/11, אחרי הערת GPT): המשקלות זזים עם המחירים בין החלפות, ומחליפים רק כשהאות משתנה — כמו תיק אמיתי ומעקב ה-Paper.
// ברירת המחדל (false) = משקלי יעד קבועים כל יום בלי עלות איזון (ההתנהגות המקורית; התוצאות הקודמות לא משתנות).
// tax (בקשת מאיר 13/11/2026, "מודל מס"): מס רווחי הון בישראל — { rate: 0.25, carry: 'year' | 'forward' }. דורש drift (תיק אמיתי).
// כל מכירה (החלפה שבועית, יציאה, מטבע שירד מהמסחר) = אירוע מס; בסיס עלות ממוצע לכל מטבע, עמלות קנייה בתוך הבסיס ועמלות מכירה
// מורידות את התמורה. רווחים והפסדים ממומשים מתקזזים בתוך השנה הקלנדרית; המס על הרווח נטו משולם בפתיחת היום הראשון של השנה הבאה
// — קודם מהמזומן, ואם אין מספיק, במכירה יחסית מכל המטבעות (שגם היא אירוע מס של השנה החדשה). carry 'year' = הפסד שנתי נטו לא עובר
// לשנה הבאה (מה שהתבקש, שמרני); 'forward' = הפסד הון עובר לשנים הבאות (כמו בפקודה). בלי תיאום אינפלציה ובלי מס יסף. רווח שלא מומש לא
// ממוסה עד המכירה — taxInfo.liq מחשב את ההון אם מוכרים הכול ביום האחרון (כולל המס של השנה השוטפת). tax.from = תחילת החשבון (כמו
// משקיע שמתחיל באותו יום: מה שכבר מוחזק נחשב כאילו נקנה בו); taxInfo.from = ההון ביום הזה.
export function runDaily(A, strat, { funding = {}, costMult = 1, C: cost = DCOST, volTarget = 0, leverage = 1, mmr = 0.005, liqBy = 'low', drift = false, tax = null, trace = false, rebal = null, partial = false } = {}){
  // rebal(d) (עם drift): ביום החלטה d שבו rebal מחזיר true — חוזרים למשקלות היעד גם אם האות לא השתנה (איזון לפי לוח זמנים).
  // partial (עם drift): כשהאות משתנה ביום שאינו יום איזון — משנים רק את המטבעות שהאות שלהם השתנה; השאר נשארים במשקל שזז.
  const { coins, days, O, C, H, L: LO } = A, K = coins.length, out = [], st = {}, perp = !!strat.perp || leverage > 1;
  if (tax && (!drift || perp)) throw new Error('tax: רק ספוט עם drift');
  const tx = tax ? { rate: tax.rate ?? 0.25, fwd: tax.carry === 'forward', from: tax.from ?? -Infinity, on: false, Efrom: 1, B: new Array(K).fill(0), E: 1, real: 0, carry: 0, yr: null, years: [] } : null;
  const settle = (y, E0) => { const base = tx.real + (tx.fwd ? tx.carry : 0), due = Math.max(0, base) * tx.rate;
    tx.years.push({ y, realized: tx.real, base, tax: due, taxPct: due / E0 }); tx.carry = tx.fwd ? Math.min(0, base) : 0; tx.real = 0; return due; };
  let liquidated = null, liqInfo = null;
  const slip = (k) => (cost.slipBps[coins[k]] ?? cost.slipOther) / 1e4;
  let rebDay = false, w = new Array(K).fill(0), entries = 0, prevRaw = null, tax0 = 0, taxFee = 0, Ep = 0;
  const same = (a, b) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) < 1e-12);
  for (let d = 1; d < days.length; d++){
    // יום d: בפתיחה מבצעים את מה שהוחלט בסגירת d−1
    const raw = strat.weights(A, d - 1, st).map((x) => (Number.isFinite(x) ? x : 0));
    let tgt = raw.slice(), wo = w;
    if (drift){ // המשקלות בפתיחה אחרי תנועת הלילה; אות שלא השתנה → לא נוגעים בתיק
      let nt = 0; const g = w.map((x, k) => { const q = C[k][d - 1], o = O[k][d]; const m = Number.isFinite(q) && Number.isFinite(o) ? o / q : 1; nt += x * (m - 1); return x * m; });
      wo = g.map((x) => x / (1 + nt));
      if (tx){ // מס: תשלום בתחילת שנה חדשה, ואז מימוש רווח/הפסד בכל מכירה
        const y = new Date(days[d]).getUTCFullYear(), E0 = tx.E, Eo = E0 * (1 + nt); tax0 = 0; taxFee = 0; Ep = Eo;
        if (!tx.on && days[d] >= tx.from){ // תחילת חשבון המס (tax.from): מה שמוחזק נחשב כאילו נקנה עכשיו
          tx.on = true; tx.yr = y; tx.Efrom = E0; for (let k = 0; k < K; k++) tx.B[k] = wo[k] * Eo; }
        if (tx.on && y !== tx.yr){
          const due = settle(tx.yr, E0); tx.yr = y;
          if (due > 0){
            const hold = wo.reduce((s2, x) => s2 + x, 0), cash = Eo * (1 - hold), sale = Math.max(0, due - cash), sh = sale > 0 && hold > 0 ? Math.min(1, sale / (hold * Eo)) : 0;
            for (let k = 0; k < K; k++) if (wo[k] && sh){ const v = wo[k] * Eo, fee = sh * v * ((cost.slipBps[coins[k]] ?? cost.slipOther) + cost.spotBps) / 1e4 * costMult; tx.real += sh * (v - tx.B[k]) - fee; tx.B[k] *= 1 - sh; taxFee += fee; }
            Ep = Eo - due - taxFee; wo = wo.map((x) => x * (1 - sh) * Eo / Ep); tax0 = due / E0; taxFee /= E0;
          }
        }
      }
      const reb = !!(rebal && rebal(d - 1));
      if (prevRaw && !reb && same(raw, prevRaw)) tgt = wo.slice();
      else if (prevRaw && !reb && partial) tgt = raw.map((x, k) => (Math.abs(x - prevRaw[k]) < 1e-12 ? wo[k] : x));
      rebDay = reb;
    }
    prevRaw = raw;
    if (volTarget > 0){ const pv = portVol(A, tgt, d - 1); if (pv > 0) tgt = tgt.map((x) => x * Math.min(1, volTarget / pv)); }
    const gross = tgt.reduce((s, x) => s + Math.abs(x), 0); if (gross > 1) tgt = tgt.map((x) => x / gross); // בלי מינוף
    if (leverage !== 1) tgt = tgt.map((x) => x * leverage);
    let r = 0, cst = 0, fund = 0, turn = 0, worst = 0, night = 0;
    for (let k = 0; k < K; k++){
      const c0 = C[k][d - 1], o = O[k][d], c = C[k][d];
      const ok = Number.isFinite(c0) && Number.isFinite(o) && Number.isFinite(c);
      if (!ok){ if (tx?.on && wo[k] > 0){ tx.real += wo[k] * Ep - tx.B[k]; tx.B[k] = 0; } if (w[k] || tgt[k]) { tgt[k] = 0; } continue; }
      r += w[k] * (o / c0 - 1) + tgt[k] * (c / o - 1); // הלילה עם המשקל הישן, היום עם החדש
      night += w[k] * (o / c0 - 1);
      if (tgt[k]){ const ext = liqBy === 'close' ? c : tgt[k] > 0 ? LO?.[k]?.[d] : H?.[k]?.[d]; if (Number.isFinite(ext)) worst += tgt[k] * (ext / o - 1); }
      const dw = Math.abs(tgt[k] - wo[k]); turn += dw;
      if (!w[k] && tgt[k]) entries += 1;
      cst += dw * ((perp ? cost.perpBps : cost.spotBps) / 1e4 + slip(k)) * costMult;
      if (tx?.on && dw > 1e-15){ const fee = dw * ((cost.spotBps) / 1e4 + slip(k)) * costMult * tx.E;
        if (tgt[k] < wo[k]){ const f = (wo[k] - tgt[k]) / wo[k]; tx.real += f * (wo[k] * Ep - tx.B[k]) - fee; tx.B[k] *= 1 - f; }
        // קנייה: בסיס העלות = כל הכסף שיצא (tgt − wo) × Ep, *כולל* העמלה — כי המנוע מוריד את העמלה מההון, והמשקל החדש tgt נמדד על
        // ההון שאחרי העמלה; כלומר המטבעות שווים (tgt − wo) × Ep − fee, והבסיס גבוה מהם בדיוק בעמלה. הוספת fee כאן הייתה סופרת אותה פעמיים
        // (נבדק: "מחיר קבוע, קנייה ואז מכירה" ו"רווח ממומש + לא ממומש = כל הרווח" ב-research-daily.test.mjs).
        else tx.B[k] += (tgt[k] - wo[k]) * Ep; }
      if (perp && tgt[k]){
        const f = funding[coins[k]]?.get(days[d]);
        fund += f !== undefined ? tgt[k] * f : (tgt[k] > 0 ? tgt[k] * cost.longFundBpsDay / 1e4 : 0);
      }
    }
    const expo = tgt.reduce((s, x) => s + Math.abs(x), 0);
    if (leverage > 1 && 1 + night + worst <= mmr * expo){ // חיסול: ההון נמחק
      out.push({ t: days[d], gross: -1, cost: 0, fund: 0, net: -1, turn: 0, exp: expo, liquidated: true }); liquidated = days[d];
      liqInfo = coins.map((c, k) => (tgt[k] ? { coin: c, w: tgt[k], o: O[k][d], l: LO?.[k]?.[d], c: C[k][d] } : null)).filter(Boolean);
      for (let e = d + 1; e < days.length; e++) out.push({ t: days[e], gross: 0, cost: 0, fund: 0, net: 0, turn: 0, exp: 0 });
      break;
    }
    if (tx){ cst += taxFee; out.push({ t: days[d], gross: r, cost: cst, fund, tax: tax0, net: r - cst - fund - tax0, turn, exp: expo }); tx.E *= 1 + r - cst - fund - tax0; }
    else out.push({ t: days[d], gross: r, cost: cst, fund, net: r - cst - fund, turn, exp: expo, ...(trace ? { w: tgt.slice(), reb: rebDay } : {}) }); // trace: משקלות היום (לייחוס רווח למטבע)
    if (drift){ let dr = 0; const v = tgt.map((x, k) => { const o = O[k][d], c = C[k][d], m = x && Number.isFinite(o) && Number.isFinite(c) ? c / o : 1; dr += x * (m - 1); return x * m; }); w = v.map((x) => x / (1 + dr)); }
    else w = tgt;
  }
  let taxInfo = null;
  if (tx){ // מכירת הכול ביום האחרון: רווח שלא מומש + הרווח הממומש של השנה השוטפת (עם קיזוז לפי carry)
    let unreal = 0, fee = 0; for (let k = 0; k < K; k++) if (w[k]){ unreal += w[k] * tx.E - tx.B[k]; fee += w[k] * tx.E * (cost.spotBps + (cost.slipBps[coins[k]] ?? cost.slipOther)) / 1e4 * costMult; }
    const base = tx.on ? tx.real + unreal - fee + (tx.fwd ? tx.carry : 0) : 0, due = Math.max(0, base) * tx.rate;
    taxInfo = { years: tx.years, open: { y: tx.yr, realized: tx.real, unrealized: unreal }, carry: tx.carry, from: tx.Efrom, liq: { equity: tx.E, fee, tax: due, net: tx.E - fee - due } };
  }
  return { series: out, entries, liquidated, liqInfo, taxInfo };
}
export function portVol(A, w, d, n = 30){
  if (d < n) return 0; const rs = [];
  for (let i = d - n + 1; i <= d; i++){ let r = 0; for (let k = 0; k < w.length; k++) if (w[k]){ const x = A.C[k][i] / A.C[k][i - 1] - 1; if (Number.isFinite(x)) r += w[k] * x; } rs.push(r); }
  const m = rs.reduce((s, x) => s + x, 0) / n; return Math.sqrt(rs.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1) * 365);
}

// גביית Funding (Basis): ספוט לונג + חוזה שורט באותו גודל — המחיר מתקזז, מקבלים את ה-Funding. נכנסים כשממוצע 7 הימים מעל סף
// (שיעור יומי), יוצאים כשמתחת לחצי ממנו. עלות כניסה/יציאה: 4 רגליים (ספוט + חוזה, כל אחת עם החלקה). משקל שווה בין המטבעות.
// הנחה: הפרש ספוט/חוזה (Basis) חוזר לאפס — לא נמדד כאן (מגבלה מתועדת).
export function runCarry(funding, coins, days, { thr = 0.0002, cost = DCOST, costMult = 1 } = {}){
  const K = coins.length, inPos = new Array(K).fill(false), out = [];
  for (let d = 7; d < days.length; d++){
    let r = 0, cst = 0, act = 0;
    for (let k = 0; k < K; k++){
      const F = funding[coins[k]]; if (!F) continue;
      const hist = []; for (let i = d - 7; i < d; i++){ const v = F.get(days[i]); if (v !== undefined) hist.push(v); }
      if (hist.length < 5) { inPos[k] = false; continue; }
      act += 1;
      const avg = hist.reduce((s, x) => s + x, 0) / hist.length, was = inPos[k];
      if (!was && avg > thr) inPos[k] = true; else if (was && avg < thr / 2) inPos[k] = false;
      if (inPos[k] !== was) cst += (cost.spotBps + cost.perpBps + 2 * ((cost.slipBps[coins[k]] ?? cost.slipOther))) / 1e4 * costMult;
      if (inPos[k]){ const f = F.get(days[d]); if (f !== undefined) r += f; }
    }
    const n = Math.max(1, act);
    out.push({ t: days[d], gross: r / n, cost: cst / n, fund: 0, net: (r - cst) / n, turn: 0, exp: inPos.filter(Boolean).length / n });
  }
  return { series: out };
}

// ---------- סטטיסטיקה של סדרה יומית ----------
export function dstats(series, { from = -Infinity, to = Infinity } = {}){
  const s = series.filter((x) => x.t >= from && x.t < to), n = s.length;
  if (n < 30) return { n, sharpe: null, ci: null };
  const r = s.map((x) => x.net), m = r.reduce((a, b) => a + b, 0) / n, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  const srD = sd > 0 ? m / sd : 0, se = Math.sqrt((1 + srD * srD / 2) / n), A = Math.sqrt(365);
  let eq = 1, peak = 1, dd = 0; for (const x of r){ eq *= 1 + x; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); }
  const sum = (f) => s.reduce((a, x) => a + f(x), 0), r2 = (x) => Math.round(x * 1000) / 1000;
  return { n, years: r2(n / 365), cagr: r2(eq ** (365 / n) - 1), vol: r2(sd * A), sharpe: r2(srD * A), ci: [r2((srD - 1.96 * se) * A), r2((srD + 1.96 * se) * A)],
    maxDD: r2(dd), total: r2(eq - 1), grossTotal: r2(sum((x) => x.gross)), costTotal: r2(sum((x) => x.cost)), fundTotal: r2(sum((x) => x.fund)), taxTotal: r2(sum((x) => x.tax || 0)),
    turnYr: r2(sum((x) => x.turn) / n * 365), exposure: r2(sum((x) => x.exp) / n) };
}
export const dscore = (st) => (st && st.ci && st.n >= 300 && st.exposure > 0.05 ? st.ci[0] : null);
