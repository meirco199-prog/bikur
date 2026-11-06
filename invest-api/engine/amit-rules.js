// מסלול "עמית" (דמה, 6/11/2026): סקאלפ על ביטקוין בנרות של דקה — לצד שיטת "ריזיקות עקרונות" (engine/sinay-rules.js), לא במקומה.
// מקור הכללים — צילומי מסך של עמית מ-Bybit (6/11), לא ניחוש:
//   • גרף ADA (דקה) עם רצועות בולינגר (20, 2): קנייה (B) בנגיעה ברצועה התחתונה, מכירה (S) בנגיעה ברצועה העליונה.
//     בדוח העסקאות: ADA 0.1803 → 0.1817 ב-11 דקות, NEAR 3.6601 → 3.6834 ב-32 דקות, AKE שורט בדקה אחת.
//   • סרטון BTC: פוזיציה ≈ 2.534 BTC ≈ 190,000$, בטחון (מרג'ין) עד 5,000$ ("הכניסה מקסימום 5,000$"), תמיד סטופ —
//     בסרטון 75,534 מול כניסה 75,700 = −0.22%.
//   • עמלות בפועל אצלו: 0.014% לצד (ADA, כנראה פקודות מוגבלות) ו-0.035% לצד (NEAR, AKE — פקודות מיידיות).
// הכללים כאן: הרצועות מחושבות מ-20 הסגירות שלפני הנר (ידועות מראש → פקודה מוגבלת שממתינה על הרצועה).
//   אין עסקה: נר שנוגע ברצועה התחתונה → לונג במחיר הרצועה (או בפתיחה, אם נפתח מתחתיה); העליונה → שורט. רק כשהנר הקודם
//   נסגר בתוך הרצועות (נגיעה טרייה). נר שנוגע בשתיהן — מדלגים (אין סדר בתוך הדקה).
//   בעסקה: סטופ −0.22% (נבדק ראשון, גם בנר הכניסה — שמרני, פקודה מיידית) → יעד: נגיעה ברצועה הנגדית (פקודה מוגבלת)
//   → אחרי 60 דקות יוצאים בסגירת הנר (פקודה מיידית).
// מה שלא ידוע ולא הומצא: גודל העסקה משתנה אצלו (8K$–190K$) — קבענו 190K$ כמו בסרטון; הוא סוחר גם במטבעות אחרים — כאן רק BTC.
// שינוי כלל = גרסה חדשה (version 2), לא שינוי שקט. פונקציה טהורה: בלי רשת ובלי KV. סימולציה בלבד.

export const AMIT = Object.freeze({
  version: 1, sym: 'BTC', barMs: 60 * 1000,
  bbN: 20, bbK: 2,                 // רצועות בולינגר על סגירות דקה
  slPct: 0.22,                     // סטופ מהכניסה, באחוזים
  maxBars: 60,                     // יציאה בכל מקרה אחרי 60 דקות (סגירת הנר, פקודה מיידית)
  notional: 190000, margin: 5000, account: 20000,
  takerPct: 0.035, makerPct: 0.014, // העמלות שעמית משלם בפועל (מהדוח שלו), לכל צד, באחוזים
  maxTrades: 300,                  // כמה עסקאות אחרונות נשמרות במלואן (הסיכום המצטבר נשמר תמיד)
});

const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000;
const tms = (t) => Date.parse(t);

export function newAmit(){
  return { version: 1, start: null, last_t: null, closes: [], zone: null, pos: null, mark: null, trades: [],
    agg: { n: 0, wins: 0, netUsd: 0, grossUsd: 0, feesUsd: 0, winUsd: 0, lossUsd: 0, peakUsd: 0, maxDdUsd: 0 } };
}

// רצועות בולינגר: ממוצע ± K סטיות תקן (סטיית תקן של האוכלוסייה, כמו בפלטפורמות המסחר)
export function bands(closes, k = AMIT.bbK){
  const n = closes.length, mid = closes.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(closes.reduce((a, b) => a + (b - mid) ** 2, 0) / n);
  return { mid, up: mid + k * sd, lo: mid - k * sd };
}

// חימום: לומדים רק את 20 הסגירות האחרונות — בלי עסקאות לאחור
export function warmAmit(bars, P = AMIT){
  const s = newAmit();
  for (const [t, , , , c] of bars.slice(-P.bbN)){ s.closes.push(c); s.last_t = t; s.mark = [t, c]; }
  if (s.closes.length >= P.bbN){ const b = bands(s.closes, P.bbK), c = s.closes.at(-1); s.zone = c < b.lo ? 'below' : c > b.up ? 'above' : 'in'; }
  s.start = s.last_t;
  return s;
}

function closeTrade(st, p, t, ex, why, maker, P){
  const sg = p.side === 'long' ? 1 : -1;
  const gross = sg * (ex - p.entry) * p.qty;
  const fees = P.notional * P.makerPct / 100 + ex * p.qty * (maker ? P.makerPct : P.takerPct) / 100; // כניסה = פקודה מוגבלת על הרצועה
  const net = gross - fees;
  const a = st.agg;
  a.n += 1; if (net > 0){ a.wins += 1; a.winUsd = r2(a.winUsd + net); } else a.lossUsd = r2(a.lossUsd + net);
  a.netUsd = r2(a.netUsd + net); a.grossUsd = r2(a.grossUsd + gross); a.feesUsd = r2(a.feesUsd + fees);
  if (a.netUsd > a.peakUsd) a.peakUsd = a.netUsd;
  if (a.peakUsd - a.netUsd > a.maxDdUsd) a.maxDdUsd = r2(a.peakUsd - a.netUsd);
  const tr = { n: a.n, side: p.side, open: p.start, close: t, entry: r2(p.entry), exit: r2(ex), why, mins: p.age,
    gross_usd: r2(gross), fees_usd: r2(fees), net_usd: r2(net), net_pct: r4(net / P.notional * 100) };
  st.trades.push(tr);
  if (st.trades.length > P.maxTrades) st.trades = st.trades.slice(-P.maxTrades);
  return tr;
}

// מעבד נרות דקה סגורים [t, o, h, l, c] בסדר עולה. מעדכן את st במקום. מחזיר { trades, events }.
export function processAmit(st, bars, P = AMIT){
  const trades = [], events = [];
  const exit = (p, t, ex, why, maker) => { const tr = closeTrade(st, p, t, ex, why, maker, P); trades.push(tr); events.push({ type: 'exit', t, trade: tr }); st.pos = null; };
  for (const [t, o, h, l, c] of bars){
    if (st.last_t && tms(t) <= tms(st.last_t)) continue;
    const b = st.closes.length >= P.bbN ? bands(st.closes, P.bbK) : null; // ידוע לפני הנר
    if (st.pos){
      const p = st.pos; p.age += 1;
      if (p.side === 'long'){
        if (l <= p.sl) exit(p, t, Math.min(p.sl, o), 'סטופ', false);
        else if (b && h >= b.up) exit(p, t, Math.max(b.up, o), 'יעד', true);
      } else if (h >= p.sl) exit(p, t, Math.max(p.sl, o), 'סטופ', false);
      else if (b && l <= b.lo) exit(p, t, Math.min(b.lo, o), 'יעד', true);
      if (st.pos && p.age >= P.maxBars) exit(p, t, c, 'זמן (60 דק׳)', false);
    } else if (b && st.zone === 'in'){
      const lo = l <= b.lo, up = h >= b.up;
      if (lo !== up){
        const side = lo ? 'long' : 'short', sg = lo ? 1 : -1;
        const entry = lo ? Math.min(b.lo, o) : Math.max(b.up, o);
        st.pos = { side, entry, qty: P.notional / entry, sl: entry * (1 - sg * P.slPct / 100), start: t, age: 0 };
        events.push({ type: 'entry', t, side, price: entry, sl: st.pos.sl, band: lo ? b.lo : b.up });
        if ((lo && l <= st.pos.sl) || (up && h >= st.pos.sl)) exit(st.pos, t, st.pos.sl, 'סטופ', false); // נר הכניסה ממשיך עד הסטופ
      }
    }
    st.closes = [...st.closes, c].slice(-P.bbN);
    if (st.closes.length >= P.bbN){ const nb = bands(st.closes, P.bbK); st.zone = c < nb.lo ? 'below' : c > nb.up ? 'above' : 'in'; }
    else st.zone = null;
    st.last_t = t; st.mark = [t, c];
    if (!st.start) st.start = t;
  }
  return { trades, events };
}

// רווח/הפסד פתוח של הפוזיציה (עמלת הכניסה בפקודה מוגבלת + עמלת יציאה משוערת בפקודה מיידית)
export function amitUnrealized(pos, markPx, P = AMIT){
  if (!pos || !(markPx > 0)) return null;
  const sg = pos.side === 'long' ? 1 : -1;
  return sg * (markPx - pos.entry) * pos.qty - P.notional * P.makerPct / 100 - markPx * pos.qty * P.takerPct / 100;
}
