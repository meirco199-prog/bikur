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
  const O = M(), H = M(), L = M(), C = M();
  coins.forEach((c, k) => { for (const b of byCoin[c]){ const i = idx.get(Math.floor(b.t / DAY) * DAY); O[k][i] = b.o; H[k][i] = b.h; L[k][i] = b.l; C[k][i] = b.c; } });
  // יום חסר באמצע (אין מסחר) → ממשיכים את הסגירה הקודמת, כדי שתשואה לא תיחשב כחסרה
  for (let k = 0; k < coins.length; k++) for (let d = 1; d < days.length; d++) if (Number.isNaN(C[k][d]) && Number.isFinite(C[k][d - 1]) && hasLater(C[k], d)){ C[k][d] = O[k][d] = H[k][d] = L[k][d] = C[k][d - 1]; }
  return { coins, days, O, H, L, C };
}
const hasLater = (a, d) => { for (let i = d + 1; i < a.length; i++) if (Number.isFinite(a[i])) return true; return false; };

const sma = (a, n, d) => { if (d < n - 1) return NaN; let s = 0; for (let i = d - n + 1; i <= d; i++){ if (!Number.isFinite(a[i])) return NaN; s += a[i]; } return s / n; };
const ret = (a, n, d) => (d >= n && Number.isFinite(a[d]) && Number.isFinite(a[d - n]) ? a[d] / a[d - n] - 1 : NaN);
const hi = (a, n, d) => { if (d < n) return NaN; let m = -Infinity; for (let i = d - n; i < d; i++){ if (!Number.isFinite(a[i])) return NaN; m = Math.max(m, a[i]); } return m; };
const lo = (a, n, d) => { if (d < n) return NaN; let m = Infinity; for (let i = d - n; i < d; i++){ if (!Number.isFinite(a[i])) return NaN; m = Math.min(m, a[i]); } return m; };
const vol = (C, n, d) => { if (d < n) return NaN; let s = 0, s2 = 0; for (let i = d - n + 1; i <= d; i++){ const r = Math.log(C[i] / C[i - 1]); if (!Number.isFinite(r)) return NaN; s += r; s2 += r * r; } const m = s / n; return Math.sqrt(Math.max(0, s2 / n - m * m) * 365); };

// ---------- אסטרטגיות: (A, d, state) → משקלות יעד לכל מטבע (סכום |w| ≤ 1). מתבצעות בפתיחת d+1 ----------
// כל אסטרטגיה: { id, family, perp (לונג/שורט בחוזה), weights(A, d, st) }
export function strategies(coins){
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
      if (st.w && d % 7 !== 0) return st.w;
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

// ---------- הרצת תיק יומי ----------
// funding: { coin: Map(dayMs → סכום שיעורי Funding של היום) } (אופציונלי)
export function runDaily(A, strat, { funding = {}, costMult = 1, C: cost = DCOST, volTarget = 0 } = {}){
  const { coins, days, O, C } = A, K = coins.length, out = [], st = {};
  const slip = (k) => (cost.slipBps[coins[k]] ?? cost.slipOther) / 1e4;
  let w = new Array(K).fill(0), entries = 0;
  for (let d = 1; d < days.length; d++){
    // יום d: בפתיחה מבצעים את מה שהוחלט בסגירת d−1
    let tgt = strat.weights(A, d - 1, st).map((x) => (Number.isFinite(x) ? x : 0));
    if (volTarget > 0){ const pv = portVol(A, tgt, d - 1); if (pv > 0) tgt = tgt.map((x) => x * Math.min(1, volTarget / pv)); }
    const gross = tgt.reduce((s, x) => s + Math.abs(x), 0); if (gross > 1) tgt = tgt.map((x) => x / gross); // בלי מינוף
    let r = 0, cst = 0, fund = 0, turn = 0;
    for (let k = 0; k < K; k++){
      const c0 = C[k][d - 1], o = O[k][d], c = C[k][d];
      const ok = Number.isFinite(c0) && Number.isFinite(o) && Number.isFinite(c);
      if (!ok){ if (w[k] || tgt[k]) { tgt[k] = 0; } continue; }
      r += w[k] * (o / c0 - 1) + tgt[k] * (c / o - 1); // הלילה עם המשקל הישן, היום עם החדש
      const dw = Math.abs(tgt[k] - w[k]); turn += dw;
      if (!w[k] && tgt[k]) entries += 1;
      cst += dw * ((strat.perp ? cost.perpBps : cost.spotBps) / 1e4 + slip(k)) * costMult;
      if (strat.perp && tgt[k]){
        const f = funding[coins[k]]?.get(days[d]);
        fund += f !== undefined ? tgt[k] * f : (tgt[k] > 0 ? tgt[k] * cost.longFundBpsDay / 1e4 : 0);
      }
    }
    out.push({ t: days[d], gross: r, cost: cst, fund, net: r - cst - fund, turn, exp: tgt.reduce((s, x) => s + Math.abs(x), 0) });
    w = tgt;
  }
  return { series: out, entries };
}
function portVol(A, w, d, n = 30){
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
    maxDD: r2(dd), total: r2(eq - 1), grossTotal: r2(sum((x) => x.gross)), costTotal: r2(sum((x) => x.cost)), fundTotal: r2(sum((x) => x.fund)),
    turnYr: r2(sum((x) => x.turn) / n * 365), exposure: r2(sum((x) => x.exp) / n) };
}
export const dscore = (st) => (st && st.ci && st.n >= 300 && st.exposure > 0.05 ? st.ci[0] : null);
