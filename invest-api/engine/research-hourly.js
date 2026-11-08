// מחקר המשך (בקשת מאיר, 8/11/2026: "תבדוק שיטות נוספות מהעבר לטווח קצר של דקות שעות ימים שכן יכולים לעבוד"): בדיקה לאחור של שיטות
// קצרות טווח על נרות שעה — מגמה קצרה, חזרה אחרי ירידה חדה, פריצת תנודתיות תוך-יומית, שעות מסחר/סוף שבוע, היפוך ומומנטום בין מטבעות,
// קפיצות מחזור, ו-Funding קיצוני. מחקר בלבד: פונקציות טהורות, בלי רשת, בלי פקודות.
// אותו פרוטוקול כמו engine/research-daily.js: ההחלטה בסגירת נר i, הביצוע בפתיחת נר i+1 (בלי הצצה לעתיד), עלויות מלאות לכל שינוי משקל,
// בלי מינוף (סכום |משקלות| ≤ 1), והסטטיסטיקה על סדרה יומית (dstats/dscore של research-daily) — בחירה לפי הגבול התחתון של שארפ.
// ביצוע: חוזה עתידי (Bybit): עמלת Taker 0.055% + החלקה לכל צד; Funding היסטורי שעתי (Hyperliquid) אם יש, אחרת לונג משלם 0.03% ליום.

export const HCOST = Object.freeze({ perpBps: 5.5, slipBps: { BTC: 2, ETH: 2 }, slipOther: 5, longFundBpsDay: 3, makerBps: 2 });
export const HOUR = 3600e3;
const DAY = 86400e3;

// { coin: [{t,o,h,l,c,v}] } → לוח משותף בצעדים של step: T[], O/H/L/C/V[k][i] (NaN לפני שהמטבע קיים). נר חסר באמצע → ממשיכים את הסגירה.
// ניקוי: שפל נמוך מ-10% מגוף הנר / שיא גבוה פי 10 = נתון שגוי (כמו BTC ב-Coinbase 15/4/2017) → גוף הנר. כל תיקון נרשם ב-fixed.
export function alignH(byCoin, { step = HOUR } = {}){
  const coins = Object.keys(byCoin), set = new Set(), fixed = [];
  for (const c of coins) for (const b of byCoin[c]) set.add(Math.floor(b.t / step) * step);
  const T = [...set].sort((a, b) => a - b), idx = new Map(T.map((t, i) => [t, i])), N = T.length;
  const M = () => coins.map(() => new Float64Array(N).fill(NaN));
  const O = M(), H = M(), L = M(), C = M(), V = M();
  coins.forEach((c, k) => {
    for (const b of byCoin[c]){
      const i = idx.get(Math.floor(b.t / step) * step), lo = Math.min(b.o, b.c), hi = Math.max(b.o, b.c);
      let l = b.l, h = b.h;
      if (l < 0.1 * lo){ fixed.push({ coin: c, t: b.t, field: 'l', from: l, to: lo }); l = lo; }
      if (h > 10 * hi){ fixed.push({ coin: c, t: b.t, field: 'h', from: h, to: hi }); h = hi; }
      O[k][i] = b.o; H[k][i] = h; L[k][i] = l; C[k][i] = b.c; V[k][i] = b.v ?? 0;
    }
    let last = -1; for (let i = N - 1; i >= 0; i--) if (Number.isFinite(C[k][i])){ last = i; break; }
    for (let i = 1; i < last; i++) if (Number.isNaN(C[k][i]) && Number.isFinite(C[k][i - 1])){ C[k][i] = O[k][i] = H[k][i] = L[k][i] = C[k][i - 1]; V[k][i] = 0; }
  });
  return { coins, T, O, H, L, C, V, step, fixed };
}

const hourOf = (t) => Math.floor((t % DAY) / HOUR);
const dowOf = (t) => (Math.floor(t / DAY) + 4) % 7; // 0 = ראשון (1/1/1970 היה יום חמישי)

// ---------- אינדיקטורים מחושבים מראש (פעם אחת לכל מטבע) ----------
function indicators(A){
  const memo = new Map(), K = A.coins.length, N = A.T.length;
  const get = (key, f) => { if (!memo.has(key)) memo.set(key, f()); return memo.get(key); };
  const sma = (k, n) => get(`sma${k}:${n}`, () => { const a = new Float64Array(N).fill(NaN), C = A.C[k]; let s = 0, cnt = 0; for (let i = 0; i < N; i++){ const x = C[i]; if (Number.isFinite(x)){ s += x; cnt += 1; } else { s = 0; cnt = 0; } if (cnt > n){ s -= C[i - n]; cnt = n; } if (cnt === n) a[i] = s / n; } return a; });
  const ema = (k, n) => get(`ema${k}:${n}`, () => { const a = new Float64Array(N).fill(NaN), C = A.C[k], al = 2 / (n + 1); let e = NaN, seen = 0; for (let i = 0; i < N; i++){ const x = C[i]; if (!Number.isFinite(x)){ e = NaN; seen = 0; continue; } e = Number.isFinite(e) ? e + al * (x - e) : x; seen += 1; if (seen >= n) a[i] = e; } return a; });
  // שיא/שפל של n הנרות הקודמים (בלי הנר הנוכחי)
  const roll = (k, n, isMax) => get(`roll${k}:${n}:${isMax}`, () => { const a = new Float64Array(N).fill(NaN), C = A.C[k];
    for (let i = n; i < N; i++){ let m = isMax ? -Infinity : Infinity, ok = true; for (let j = i - n; j < i; j++){ const x = C[j]; if (!Number.isFinite(x)){ ok = false; break; } m = isMax ? Math.max(m, x) : Math.min(m, x); } if (ok) a[i] = m; }
    return a; });
  // סטיית תקן של תשואות לוג שעתיות ב-n הנרות האחרונים
  const vol = (k, n) => get(`vol${k}:${n}`, () => { const a = new Float64Array(N).fill(NaN), C = A.C[k], r = new Float64Array(N).fill(NaN); for (let i = 1; i < N; i++) r[i] = Math.log(C[i] / C[i - 1]);
    let s = 0, s2 = 0, cnt = 0; for (let i = 1; i < N; i++){ const x = r[i]; if (Number.isFinite(x)){ s += x; s2 += x * x; cnt += 1; } else { s = s2 = 0; cnt = 0; } if (cnt > n){ const y = r[i - n]; s -= y; s2 -= y * y; cnt = n; } if (cnt === n) a[i] = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)); } return a; });
  // ממוצע המחזור ב-n הנרות הקודמים (בלי הנר הנוכחי); לפני שהמטבע קיים המחזור נספר כאפס
  const vmean = (k, n) => get(`vm${k}:${n}`, () => { const a = new Float64Array(N).fill(NaN), V = A.V[k], v = (j) => (Number.isFinite(V[j]) ? V[j] : 0); let s = 0; for (let i = 1; i < N; i++){ s += v(i - 1); if (i - 1 - n >= 0) s -= v(i - 1 - n); if (i >= n) a[i] = s / n; } return a; });
  // "יום מסחר" שמתחיל בשעה offH (UTC; ברירת מחדל 0 = יום UTC): פתיחת היום (פתיחת הנר הראשון שלו), טווח היום הקודם (שיא−שפל),
  // והאם סגירת אתמול מעל הממוצע של maN הסגירות היומיות האחרונות. offH ו-maN נוספו לבדיקת העמידות של בוט A (8/11)
  const day = (k, offH = 0, maN = 20) => get(`day${k}:${offH}:${maN}`, () => { const open = new Float64Array(N).fill(NaN), prevRange = new Float64Array(N).fill(NaN), ma20ok = new Uint8Array(N);
    let curDay = null, dOpen = NaN, dHi = -Infinity, dLo = Infinity, pRange = NaN; const closes = [];
    for (let i = 0; i < N; i++){
      const d = Math.floor((A.T[i] - offH * HOUR) / DAY);
      if (d !== curDay){ if (curDay !== null && i > 0 && Number.isFinite(A.C[k][i - 1])){ pRange = dHi > -Infinity ? dHi - dLo : NaN; closes.push(A.C[k][i - 1]); } curDay = d; dOpen = A.O[k][i]; dHi = -Infinity; dLo = Infinity; }
      if (Number.isFinite(A.H[k][i])){ dHi = Math.max(dHi, A.H[k][i]); dLo = Math.min(dLo, A.L[k][i]); }
      open[i] = dOpen; prevRange[i] = pRange;
      if (closes.length >= maN){ let s = 0; for (let j = closes.length - maN; j < closes.length; j++) s += closes[j]; ma20ok[i] = closes.at(-1) > s / maN ? 1 : 0; }
    }
    return { open, prevRange, ma20ok }; });
  return { sma, ema, roll, vol, vmean, day, K };
}

// ---------- אסטרטגיות: (A, i, st) → משקלות יעד (סכום |w| ≤ 1), מתבצעות בפתיחת נר i+1 ----------
// funding: { coin: Map(hourMs → שיעור) } — רק לאסטרטגיית ה-Funding הקיצוני
// פריצת תנודתיות תוך-יומית (בוט A) כאסטרטגיה בודדת עם פרמטרים: k0 (חלק מטווח אתמול), filt + maN (מסנן ממוצע יומי),
// U (מטבעות), offH (שעת תחילת "יום המסחר" ב-UTC; היציאה בסגירת השעה האחרונה שלו). ברירות המחדל = VBO0.7-ma20 של המחקר.
export function vboStrategy(A, { k0 = 0.7, filt = true, maN = 20, U = null, offH = 0, id = null } = {}, I = indicators(A)){
  const { coins, T, C } = A, K = coins.length, UU = U || coins.map((_, k) => k);
  const live = (k, i, need) => i >= need && Number.isFinite(C[k][i - need]) && Number.isFinite(C[k][i]);
  const ew = (i, f, need) => { const w = new Array(K).fill(0), act = UU.filter((k) => live(k, i, need)); for (const k of act){ const s = f(k); if (s) w[k] = s / act.length; } return w; };
  return { id: id || `VBO${k0}${filt ? `-ma${maN}` : ''}-o${offH}`, family: 'vol-breakout', perp: true, weights: (A_, i, st) => {
    st.in ||= new Array(K).fill(0); st.d ||= new Array(K).fill(-1);
    const t = T[i] - offH * HOUR, dn = Math.floor(t / DAY), last = hourOf(t) === 23;
    return ew(i, (k) => {
      if (st.d[k] !== dn){ st.d[k] = dn; st.in[k] = 0; }
      if (last) return (st.in[k] = 0);
      const D = I.day(k, offH, maN), trig = D.open[i] + k0 * D.prevRange[i];
      if (!st.in[k] && Number.isFinite(trig) && C[k][i] > trig && (!filt || D.ma20ok[i])) st.in[k] = 1;
      return st.in[k];
    }, 48);
  } };
}
export { indicators };

export function strategies(A, funding = {}){
  const { coins, T, C, V } = A, K = coins.length, I = indicators(A), N = T.length;
  const iB = coins.indexOf('BTC'), iE = coins.indexOf('ETH');
  const ALL = coins.map((_, k) => k), BE = [iB, iE].filter((k) => k >= 0);
  const UNI = { BE, EW: ALL };
  const ret = (k, i, L) => (i >= L ? C[k][i] / C[k][i - L] - 1 : NaN);
  const live = (k, i, need) => i >= need && Number.isFinite(C[k][i - need]) && Number.isFinite(C[k][i]);
  const ew = (U, i, f, need) => { const w = new Array(K).fill(0), act = U.filter((k) => live(k, i, need)); for (const k of act){ const s = f(k); if (s) w[k] = s / act.length; } return w; };
  const at = (i, R) => ((T[i] + HOUR) / HOUR) % R === 0; // נקודת איזון מחדש: סוף נר שמסיים בלוק של R שעות (מיושר ל-UTC)
  const bull = (i) => iB >= 0 && C[iB][i] > I.sma(iB, 4800)[i]; // BTC מעל הממוצע של 200 יום (4800 שעות)
  const S = [];
  S.push({ id: 'BH-BTC', family: 'bench', weights: (A_, i) => coins.map((_, k) => (k === iB && Number.isFinite(C[k][i]) ? 1 : 0)) });
  S.push({ id: 'BH-EW', family: 'bench', weights: (A_, i) => ew(ALL, i, () => 1, 1) });

  // 1. מגמה קצרה (TSMOM שעתי): כיוון התשואה של L שעות, איזון כל R שעות. לונג בלבד / לונג-שורט
  for (const L of [24, 72, 168]) for (const R of [4, 24]) for (const [u, U] of Object.entries(UNI)) for (const ls of [false, true]){
    S.push({ id: `TSH${L}-r${R}-${u}${ls ? '-LS' : ''}`, family: 'tsmom-h', perp: true, weights: (A_, i, st) => {
      if (st.w && !at(i, R)) return st.w;
      return (st.w = ew(U, i, (k) => { const r = ret(k, i, L); return r > 0 ? 1 : ls && r < 0 ? -1 : 0; }, L));
    } });
  }
  // 2. חציית ממוצעים נעים מעריכיים על נרות שעה
  for (const [f, s] of [[12, 48], [24, 96], [48, 192], [100, 400]]) for (const [u, U] of Object.entries(UNI)) for (const ls of [false, true]){
    S.push({ id: `EMA${f}-${s}-${u}${ls ? '-LS' : ''}`, family: 'ema-h', perp: true, weights: (A_, i) => ew(U, i, (k) => { const a = I.ema(k, f)[i], b = I.ema(k, s)[i]; return !(a && b) ? 0 : a > b ? 1 : ls ? -1 : 0; }, s) });
  }
  // 3. פריצת ערוץ שעתית (Donchian): כניסה בשיא n שעות, יציאה בשפל m שעות (לונג בלבד)
  for (const [n, m] of [[24, 12], [72, 36], [168, 72]]) for (const [u, U] of Object.entries(UNI)){
    S.push({ id: `DCH${n}-${m}-${u}`, family: 'donchian-h', perp: true, weights: (A_, i, st) => {
      st.in ||= new Array(K).fill(0);
      return ew(U, i, (k) => { const c = C[k][i], h = I.roll(k, n, true)[i], l = I.roll(k, m, false)[i]; if (!st.in[k] && c > h) st.in[k] = 1; else if (st.in[k] && c < l) st.in[k] = 0; return st.in[k]; }, n);
    } });
  }
  // 4. היפוך קצר בין מטבעות: כל R שעות — לונג על 3 המפסידים של L השעות האחרונות (ובגרסה ניטרלית: שורט על 3 המנצחים)
  for (const L of [4, 24]) for (const R of [4, 24]) for (const ls of [false, true]){
    S.push({ id: `REV${L}-r${R}${ls ? '-LS' : ''}`, family: 'reversal-xs', perp: true, weights: (A_, i, st) => {
      if (st.w && !at(i, R)) return st.w;
      const r = []; for (const k of ALL) if (live(k, i, 720)){ const x = ret(k, i, L); if (Number.isFinite(x)) r.push([k, x]); }
      const w = new Array(K).fill(0); if (r.length < 8) return (st.w = w);
      r.sort((a, b) => a[1] - b[1]);
      for (const [k] of r.slice(0, 3)) w[k] = ls ? 1 / 6 : 1 / 3;
      if (ls) for (const [k] of r.slice(-3)) w[k] = -1 / 6;
      return (st.w = w);
    } });
  }
  // 5. מומנטום קצר בין מטבעות: כל 24 שעות — 3 החזקים לפי L שעות (רק תשואה חיובית), עם/בלי מסנן BTC מעל ממוצע 200 יום
  for (const L of [24, 72, 168]) for (const filt of [false, true]){
    S.push({ id: `XSH${L}-top3${filt ? '-f200' : ''}`, family: 'xsmom-h', perp: true, weights: (A_, i, st) => {
      if (st.w && !at(i, 24)) return st.w;
      const w = new Array(K).fill(0); if (filt && !bull(i)) return (st.w = w);
      const r = []; for (const k of ALL) if (live(k, i, 720)){ const x = ret(k, i, L); if (Number.isFinite(x)) r.push([k, x]); }
      r.sort((a, b) => b[1] - a[1]); for (const [k, x] of r.slice(0, 3)) if (x > 0) w[k] = 1 / 3;
      return (st.w = w);
    } });
  }
  // 6. קנייה אחרי ירידה חדה (חזרה לממוצע): תשואת L שעות נמוכה מ-z סטיות תקן, רק כשהמטבע מעל הממוצע של 200 יום; החזקה H שעות
  for (const L of [4, 24]) for (const z of [2, 3]) for (const H of [12, 48]) for (const [u, U] of Object.entries(UNI)){
    S.push({ id: `DIP${L}-z${z}-h${H}-${u}`, family: 'dip-mr', perp: true, weights: (A_, i, st) => {
      st.until ||= new Array(K).fill(-1);
      return ew(U, i, (k) => {
        if (i < st.until[k]) return 1;
        const sd = I.vol(k, 720)[i], r = ret(k, i, L), ma = I.sma(k, 4800)[i];
        if (sd > 0 && Number.isFinite(r) && C[k][i] > ma && Math.log(1 + r) < -z * sd * Math.sqrt(L)){ st.until[k] = i + H; return 1; }
        return 0;
      }, 720);
    } });
  }
  // 7. פריצת תנודתיות תוך-יומית: לונג כשהמחיר עובר את פתיחת היום + k × הטווח של אתמול; יציאה בסוף היום (00:00 UTC)
  for (const k0 of [0.3, 0.5, 0.7]) for (const filt of [false, true]) for (const [u, U] of Object.entries(UNI)) S.push(vboStrategy(A, { k0, filt, U, id: `VBO${k0}${filt ? '-ma20' : ''}-${u}` }, I));
  // 8. שעות מסחר וסוף שבוע (השערות קבועות מראש, בלי בחירת שעות לפי הנתונים): לונג רק בחלון
  const SESS = { asia: [0, 8], europe: [8, 13], us: [13, 21], late: [21, 24] };
  for (const [u, U] of Object.entries(UNI)){
    for (const [name, [a, b]] of Object.entries(SESS)) S.push({ id: `SES-${name}-${u}`, family: 'session', perp: true, weights: (A_, i) => { const h = hourOf(T[i] + HOUR); return ew(U, i, () => (h >= a && h < b ? 1 : 0), 1); } });
    S.push({ id: `SES-weekend-${u}`, family: 'session', perp: true, weights: (A_, i) => { const d = dowOf(T[i] + HOUR); return ew(U, i, () => (d === 0 || d === 6 ? 1 : 0), 1); } });
    S.push({ id: `SES-weekday-${u}`, family: 'session', perp: true, weights: (A_, i) => { const d = dowOf(T[i] + HOUR); return ew(U, i, () => (d >= 1 && d <= 5 ? 1 : 0), 1); } });
  }
  // 9. קפיצת מחזור: מחזור השעה גדול פי m מהממוצע של השבוע — המשך (לונג אחרי עלייה) או היפוך (לונג אחרי ירידה); החזקה H שעות
  for (const m of [4, 8]) for (const H of [6, 24]) for (const mode of ['cont', 'fade']){
    S.push({ id: `VOL${m}x-h${H}-${mode}`, family: 'volume-spike', perp: true, weights: (A_, i, st) => {
      st.until ||= new Array(K).fill(-1);
      return ew(ALL, i, (k) => {
        if (i < st.until[k]) return 1;
        const vm = I.vmean(k, 168)[i], r = ret(k, i, 1);
        if (vm > 0 && V[k][i] > m * vm && Number.isFinite(r) && (mode === 'cont' ? r > 0 : r < 0)){ st.until[k] = i + H; return 1; }
        return 0;
      }, 720);
    } });
  }
  // 10. Funding קיצוני (Hyperliquid, מ-2023): סכום 24 שעות מעל הסף → שורט (הלונגים צפופים), מתחת למינוס הסף → לונג; יציאה מתחת לשליש מהסף
  const fArr = coins.map((c) => { const F = funding[c]; if (!F || !F.size) return null; const a = new Float64Array(N).fill(NaN); for (let i = 0; i < N; i++){ const v = F.get(T[i]); if (v !== undefined) a[i] = v; } return a; });
  const f24 = (k, i) => { const a = fArr[k]; if (!a || i < 24) return NaN; let s = 0, n = 0; for (let j = i - 23; j <= i; j++) if (Number.isFinite(a[j])){ s += a[j]; n += 1; } return n >= 20 ? s * 24 / n : NaN; };
  if (fArr.some(Boolean)) for (const thr of [0.0005, 0.001]){
    S.push({ id: `FND${thr * 100}`, family: 'funding-contra', perp: true, weights: (A_, i, st) => {
      st.pos ||= new Array(K).fill(0); const w = new Array(K).fill(0), act = ALL.filter((k) => fArr[k] && Number.isFinite(f24(k, i)));
      for (const k of act){ const f = f24(k, i); if (!st.pos[k] && f > thr) st.pos[k] = -1; else if (!st.pos[k] && f < -thr) st.pos[k] = 1; else if (st.pos[k] && Math.abs(f) < thr / 3) st.pos[k] = 0; w[k] = st.pos[k] / K; }
      return w;
    } });
  }
  return S;
}

// ---------- הרצה: תיק לפי נרות, מסוכם לסדרה יומית (UTC) ----------
// מחזיר daily = [{t (יום), gross, cost, fund, net (מורכב בתוך היום), turn, exp (ממוצע), ent (כניסות)}] — אותו מבנה כמו runDaily,
// ו-trades = [{t (כניסה), coin, dir, w (משקל בכניסה), pnl (חלק מההון, אחרי עלויות ו-Funding, בלי ריבית דריבית), bars}]
export function runBars(A, strat, { funding = {}, costMult = 1, C: cost = HCOST } = {}){
  const { coins, T, O, C } = A, K = coins.length, N = T.length, st = {}, perp = !!strat.perp;
  const slip = (k) => (cost.slipBps[coins[k]] ?? cost.slipOther) / 1e4;
  const longFundBar = cost.longFundBpsDay / 1e4 * (A.step / DAY);
  const daily = [], trades = [], open = new Array(K).fill(null); let w = new Array(K).fill(0), entries = 0;
  let curDay = null, eq = 1, g = 0, cs = 0, fu = 0, tu = 0, ex = 0, nb = 0, en = 0;
  const flush = () => { if (curDay !== null) daily.push({ t: curDay, gross: g, cost: cs, fund: fu, net: eq - 1, turn: tu, exp: nb ? ex / nb : 0, ent: en }); };
  for (let i = 1; i < N; i++){
    const dKey = Math.floor(T[i] / DAY) * DAY;
    if (dKey !== curDay){ flush(); curDay = dKey; eq = 1; g = cs = fu = tu = ex = nb = en = 0; }
    let tgt = strat.weights(A, i - 1, st).map((x) => (Number.isFinite(x) ? x : 0));
    const gross = tgt.reduce((s, x) => s + Math.abs(x), 0); if (gross > 1) tgt = tgt.map((x) => x / gross);
    let r = 0, cst = 0, fund = 0, turn = 0;
    for (let k = 0; k < K; k++){
      const c0 = C[k][i - 1], o = O[k][i], c = C[k][i];
      if (!(Number.isFinite(c0) && Number.isFinite(o) && Number.isFinite(c))){ tgt[k] = 0; if (open[k]){ trades.push(open[k]); open[k] = null; } continue; }
      const night = w[k] * (o / c0 - 1), day = tgt[k] * (c / o - 1), rate = (cost.perpBps / 1e4 + slip(k)) * costMult;
      r += night + day;
      const dw = Math.abs(tgt[k] - w[k]); turn += dw;
      const flip = tgt[k] && Math.sign(tgt[k]) !== Math.sign(w[k]);
      if (flip){ entries += 1; en += 1; } // כניסה חדשה או היפוך כיוון
      cst += dw * rate;
      let fk = 0;
      if (perp && tgt[k]){ const f = funding[coins[k]]?.get(T[i]); fk = f !== undefined ? tgt[k] * f : (tgt[k] > 0 ? tgt[k] * longFundBar : 0); fund += fk; }
      // מעקב עסקאות (לכל מטבע): הלילה + עלות היציאה לעסקה הישנה; הכניסה, היום וה-Funding לחדשה
      let tr = open[k];
      if (tr){ tr.pnl += night; if (!tgt[k] || flip){ tr.pnl -= Math.abs(w[k]) * rate; trades.push(tr); tr = open[k] = null; } }
      if (tgt[k]){
        if (!tr) tr = open[k] = { t: T[i], coin: coins[k], dir: Math.sign(tgt[k]), w: Math.abs(tgt[k]), pnl: -Math.abs(tgt[k]) * rate, bars: 0 };
        else tr.pnl -= dw * rate;
        tr.pnl += day - fk; tr.bars += 1;
      }
    }
    const net = r - cst - fund;
    eq *= 1 + net; g += r; cs += cst; fu += fund; tu += turn; ex += tgt.reduce((s, x) => s + Math.abs(x), 0); nb += 1;
    w = tgt;
  }
  flush();
  for (const tr of open) if (tr) trades.push({ ...tr, openAtEnd: true });
  return { daily, entries, trades };
}

// תרחיש עלות אחר בלי הרצה מחדש: עלות = turn × perBpsSide (למשל Maker 0.02% בלי החלקה), או כפולה של העלות המקורית
export function recost(daily, { mult = null, bpsPerTurn = null } = {}){
  return daily.map((x) => { const c = bpsPerTurn !== null ? x.turn * bpsPerTurn / 1e4 : x.cost * mult; return { ...x, cost: c, net: x.net + x.cost - c }; });
}

// מדדים קצרי טווח לתקופה: רווח גולמי ועלות ליחידת מחזור (נקודות בסיס), כניסות בשנה, אחוז זמן בשוק
export function hstats(daily, { from = -Infinity, to = Infinity } = {}){
  const s = daily.filter((x) => x.t >= from && x.t < to), n = s.length; if (!n) return { n: 0 };
  const sum = (f) => s.reduce((a, x) => a + f(x), 0), turn = sum((x) => x.turn), r1 = (x) => Math.round(x * 10) / 10;
  return { n, edgeBps: turn ? r1(sum((x) => x.gross) / turn * 1e4) : null, costBps: turn ? r1(sum((x) => x.cost) / turn * 1e4) : null, entriesYr: Math.round(sum((x) => x.ent) / n * 365), exposure: Math.round(sum((x) => x.exp) / n * 100) / 100 };
}

// מדדי עסקאות לתקופה (לפי זמן הכניסה): אחוז הצלחה, Profit Factor (סך הרווחים / סך ההפסדים, אחרי עלויות), תוחלת לעסקה
// (באחוזים מגודל הפוזיציה), רווח ממוצע / הפסד ממוצע, ומשך החזקה ממוצע בנרות. עסקה שעוד פתוחה בסוף הנתונים לא נספרת.
export function tstats(trades, { from = -Infinity, to = Infinity } = {}){
  const s = trades.filter((x) => !x.openAtEnd && x.t >= from && x.t < to), n = s.length; if (!n) return { n: 0 };
  const pos = s.map((x) => x.pnl / x.w), win = pos.filter((x) => x > 0), loss = pos.filter((x) => x <= 0);
  const sw = win.reduce((a, b) => a + b, 0), sl = -loss.reduce((a, b) => a + b, 0), r2 = (x) => Math.round(x * 100) / 100;
  return { n, winRate: r2(win.length / n), pf: sl > 0 ? r2(sw / sl) : null, expPct: r2(pos.reduce((a, b) => a + b, 0) / n * 100),
    avgWinPct: win.length ? r2(sw / win.length * 100) : null, avgLossPct: loss.length ? r2(-sl / loss.length * 100) : null, avgBars: Math.round(s.reduce((a, x) => a + x.bars, 0) / n) };
}
