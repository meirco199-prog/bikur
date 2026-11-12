// "בוט 4" — מה שעמית הראה ב-12/11/2026: חוזה של מניה ב-Bybit (SNXXUSDT, פי 2 על סנדיסק), דקה אחרי פתיחת המסחר בארה"ב המחיר צונח
// מתחת לרצועת בולינגר התחתונה בנרות דקה, הוא קונה בתחתית בפקודה ממתינה (עמלה 0 בכניסה), ומוכר אחרי 48 שניות ב-+1.7%. גודל ~35,000$.
// כאן: הכללים המכניים הכי קרובים, לבדיקה לאחור בלבד (scripts/research-amit4-open.mjs). טהור — בלי רשת.
//   כניסה: בדקות הראשונות אחרי הפתיחה (T), פקודת קנייה ממתינה במחיר "רצועה תחתונה × (1 − d)" לפי 20 הסגירות שלפני הדקה. מתמלאת אם השפל נגע.
//   יציאה: יעד +g% (פקודה ממתינה), סטופ −s% (מיידית), או סגירה אחרי N דקות (מיידית). באותה דקה של הכניסה — אין יציאה (שמרני).
//   באותה דקה סטופ ויעד → סטופ. עסקה אחת ביום לכל חוזה.
export const SIZE = 35000;
export const FEES = { maker: 0.0002, taker: 0.00055, slip: 0.0002 }; // Bybit רגיל; החלקה רק במילוי מיידי

// שעת הפתיחה בניו יורק (09:30) כ-UTC ms ליום נתון (YYYY-MM-DD)
export function nyOpenUtc(day){
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false });
  for (const h of [13, 14]){ const t = Date.parse(`${day}T${String(h).padStart(2, '0')}:30:00Z`); if (fmt.format(t).replace(/^24/, '00') === '09:30') return t; }
  return null;
}
export const HOLIDAYS = new Set(['2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25']);

const lowerBand = (c, i, n = 20, k = 2) => { if (i < n) return NaN; let m = 0; for (let j = i - n; j < i; j++) m += c[j]; m /= n; let v = 0; for (let j = i - n; j < i; j++) v += (c[j] - m) ** 2; return m - k * Math.sqrt(v / n); };

// יציאה מדקה i (הכניסה בדקה i, יציאה מהדקה שאחריה): יעד / סטופ / זמן
function exitFrom(bars, i, entry, v, F){
  const { t, o, h, l, c } = bars, tgt = entry * (1 + v.g / 100), stp = entry * (1 - v.s / 100);
  for (let j = i + 1; j < t.length; j++){
    if (l[j] <= stp) return { exit: Math.min(stp, o[j]) * (1 - F.slip), fee: F.taker, why: 'סטופ' };
    if (h[j] >= tgt) return { exit: Math.max(tgt, o[j]), fee: F.maker, why: 'יעד' };
    if (t[j] + 60e3 - t[i] >= v.N * 60e3) return { exit: c[j] * (1 - F.slip), fee: F.taker, why: 'זמן' };
  }
  return null; // אין מספיק נתונים אחרי הכניסה
}
const result = (t, entry, x, entryFee, size) => ({ t, entry, exit: x.exit, why: x.why, pnl: (size / entry) * (x.exit - entry) - size * (entryFee + x.fee), r: x.exit / entry - 1 - entryFee - x.fee });

// bars: { t, o, h, l, c } מערכים לחלון של יום אחד (מהישן לחדש). open = UTC ms של הפתיחה. v = { d, g, s, N, T }
export function tradeDay(bars, open, v, F = FEES, size = SIZE, entryFee = F.maker){
  const { t, o, l, c } = bars;
  for (let i = 0; i < t.length; i++){
    if (t[i] < open || t[i] >= open + v.T * 60e3) continue;
    const lb = lowerBand(c, i); if (!(lb > 0)) continue;
    const px = lb * (1 - v.d / 100);
    if (!(l[i] <= px)) continue;
    const entry = Math.min(px, o[i]), x = exitFrom(bars, i, entry, v, F);
    return x ? result(t[i], entry, x, entryFee, size) : null;
  }
  return null;
}
// קבוצת ביקורת: אותה יציאה, כניסה בשוק (מיידית + החלקה) בפתיחת דקה אקראית בתוך אותו חלון (זרע קבוע)
export function randomDay(bars, open, v, rnd, F = FEES, size = SIZE){
  const idx = []; for (let i = 0; i < bars.t.length; i++) if (bars.t[i] >= open && bars.t[i] < open + v.T * 60e3) idx.push(i);
  if (!idx.length) return null;
  const i = idx[Math.floor(rnd() * idx.length)], entry = bars.o[i] * (1 + F.slip), x = exitFrom(bars, i, entry, v, F);
  return x ? result(bars.t[i], entry, x, F.taker, size) : null;
}
export function grid(){
  const out = [];
  for (const T of [5, 15]) for (const d of [0, 0.5, 1]) for (const g of [1, 1.5, 2]) for (const s of [1, 2]) for (const N of [2, 5, 15]) out.push({ T, d, g, s, N, k: `T${T}-d${d}-g${g}-s${s}-N${N}` });
  return out;
}
export const lcg = (seed) => { let x = seed >>> 0 || 1; return () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32; };
export function stat(xs){ const n = xs.length; if (!n) return { n, mean: NaN, t: NaN, sum: 0, win: NaN }; const m = xs.reduce((a, b) => a + b, 0) / n; const sd = n > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : NaN; return { n, mean: m, sum: m * n, t: sd > 0 ? m / (sd / Math.sqrt(n)) : NaN, win: xs.filter((x) => x > 0).length / n }; }
