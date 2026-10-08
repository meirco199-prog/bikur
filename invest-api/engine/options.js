// אופציות בסימולציה (החלטת בעל הריפו 8/10/2026: "רק אם יש בדמה תעשה" — נבדק: חשבון הדמה מורשה ל-OPT, ל-SPY יש שרשרת).
// שלב א': **קנייה בלבד** (call/put) על ETF לא-ממונף מהיקום הקבוע, **בסימולציה בלבד** — הפסד מקסימלי = הפרמטרה ששולמה.
// בלי מכירת אופציות (הפסד בלתי מוגבל), בלי spreads, בלי הקצאה/assignment. אין נתוני אופציות אמיתיים (OPRA בתשלום): המחיר הוא
// Black-Scholes על סדרת המחירים של הנכס הבסיס עם תנודתיות ממומשת (30 יום) × 1.1 — קירוב, לא ציטוט. אין מיפוי לדמה של IBKR (שלב ב').
// פונקציות טהורות. סימבול פנימי: <UNDER>-<YYYYMMDD>-<C|P>-<strike>.
import { round, isNum } from './util.js';

export const OPTION_RATE = 0.043;       // ריבית חסרת סיכון מקורבת (דומה ל-benchmark של IBKR)
export const MIN_VOL = 0.12, VOL_MARKUP = 1.1, CONTRACT_UNITS = 100;
const DAY_MS = 86400000;
const SYMBOL_RE = /^([A-Z][A-Z0-9.]{0,9})-(\d{8})-([CP])-(\d+(?:\.\d+)?)$/;

// התפלגות נורמלית מצטברת (Abramowitz–Stegun 7.1.26 ל-erf), דיוק ~1e-7
export function normCdf(x){
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Black-Scholes לאופציה אירופאית: S מחיר, K strike, T בשנים, sigma שנתי, right 'C'|'P'. T≤0 → ערך פנימי */
export function bsPrice({ S, K, T, sigma, right, r = OPTION_RATE }){
  if (!(S > 0) || !(K > 0)) return null;
  const intrinsic = right === 'C' ? Math.max(0, S - K) : Math.max(0, K - S);
  if (!(T > 0) || !(sigma > 0)) return intrinsic;
  const sq = sigma * Math.sqrt(T), d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / sq, d2 = d1 - sq, disc = Math.exp(-r * T);
  return right === 'C' ? S * normCdf(d1) - K * disc * normCdf(d2) : K * disc * normCdf(-d2) - S * normCdf(-d1);
}
export function bsDelta({ S, K, T, sigma, right, r = OPTION_RATE }){
  if (!(T > 0) || !(sigma > 0)) return right === 'C' ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
  const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
  return right === 'C' ? normCdf(d1) : normCdf(d1) - 1;
}

/** תנודתיות ממומשת שנתית מ-n סגירות אחרונות (יומי, לוג-תשואות); null אם אין מספיק */
export function realizedVol(closes, n = 30){
  const c = closes.slice(-(n + 1)).filter(isNum); if (c.length < 10) return null;
  const r = []; for (let i = 1; i < c.length; i++) if (c[i - 1] > 0 && c[i] > 0) r.push(Math.log(c[i] / c[i - 1]));
  if (r.length < 8) return null;
  const m = r.reduce((s, x) => s + x, 0) / r.length;
  return Math.sqrt(r.reduce((s, x) => s + (x - m) ** 2, 0) / (r.length - 1)) * Math.sqrt(252);
}
export const impliedVolGuess = (closes) => Math.max(MIN_VOL, (realizedVol(closes) ?? MIN_VOL) * VOL_MARKUP);

const ymd = (d) => d.toISOString().slice(0, 10);
const utc = (s) => new Date(s + 'T00:00:00Z');
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / DAY_MS);
/** יום שישי השלישי בחודש (פקיעה חודשית סטנדרטית) */
export function thirdFriday(year, month){ const d = new Date(Date.UTC(year, month, 1)); const first = (5 - d.getUTCDay() + 7) % 7; return ymd(new Date(Date.UTC(year, month, 1 + first + 14))); }
/** הפקיעה החודשית הראשונה שרחוקה לפחות minDays ימים מ-day */
export function pickExpiry(day, minDays = 30){
  const d = utc(day);
  for (let k = 0; k < 8; k++){ const e = thirdFriday(d.getUTCFullYear(), d.getUTCMonth() + k); if (daysBetween(day, e) >= minDays) return e; }
  return null;
}
export const strikeStep = (price) => (price < 25 ? 0.5 : price < 100 ? 1 : price < 250 ? 2.5 : price < 500 ? 5 : 10);
/** strike קרוב ל-ATM (מעוגל לצעד). */
export function pickStrike(price){ const st = strikeStep(price); return round(Math.round(price / st) * st, 2); }

export const optionSymbol = (underlying, expiry, right, strike) => `${underlying}-${expiry.replace(/-/g, '')}-${right}-${strike}`;
export function parseOptionSymbol(sym){
  const m = SYMBOL_RE.exec(String(sym || '')); if (!m) return null;
  const e = m[2]; const expiry = `${e.slice(0, 4)}-${e.slice(4, 6)}-${e.slice(6, 8)}`;
  return { underlying: m[1], expiry, right: m[3], strike: Number(m[4]) };
}
export const isOptionSymbol = (sym) => SYMBOL_RE.test(String(sym || ''));

/** מכשיר אופציה (קנייה בלבד): פרמיה מלאה כ-margin (אין מינוף, אין אשראי על אופציות), units=100, בלי שורט */
export function optionInstrument(under, expiry, right, strike){
  const symbol = optionSymbol(under.symbol, expiry, right, strike);
  const kind = right === 'C' ? 'Call' : 'Put';
  return { symbol, name: `${under.symbol} ${kind} ${strike} ${expiry}`, nameHe: `${under.nameHe || under.symbol} ${right === 'C' ? 'קול' : 'פוט'} ${strike} · ${expiry}`, class: 'option', sector: under.sector, currency: 'USD', exchange: 'SMART', session: 'us', settle: 'trade', units: CONTRACT_UNITS, leverage: 1, margin: { initial: 1, maint: 1, shortInitial: null, shortMaint: null }, shortable: false, borrowFee: 0, synthetic: true, dynamic: true, underlying: under.symbol, expiry, right, strike };
}
/** משחזר מכשיר מהסימבול (פוזיציות/פקודות ממתינות בריצה הבאה). underlyingOf(symbol) → מכשיר הבסיס */
export function optionInstrumentFromSymbol(sym, underlyingOf){
  const p = parseOptionSymbol(sym); if (!p) return null;
  const under = underlyingOf(p.underlying); if (!under) return null;
  return optionInstrument(under, p.expiry, p.right, p.strike);
}

/**
 * סדרת מחירי האופציה (rows כמו כל מכשיר: [date, open, high, low, close, volume]) מסדרת הבסיס: לכל יום מחשבים B-S מה-open/high/low/close
 * של הבסיס באותו יום, עם תנודתיות ממומשת עד אותו יום. בפוט high/low מתהפכים. ביום הפקיעה — ערך פנימי; אחריו אין שורות.
 */
export function optionRows(inst, underlyingRows, { maxRows = 220 } = {}){
  const closesAll = underlyingRows.map((x) => x[4]);
  const out = [];
  underlyingRows.forEach((x, i) => {
    if (!isNum(x[4]) || x[0] > inst.expiry || i < underlyingRows.length - maxRows) return;
    const sigma = impliedVolGuess(closesAll.slice(0, i + 1));
    const T = Math.max(0, daysBetween(x[0], inst.expiry)) / 365;
    const px = (S) => bsPrice({ S, K: inst.strike, T, sigma, right: inst.right });
    const o = px(x[1] ?? x[4]), c = px(x[4]);
    const a = px(x[2] ?? x[4]), b = px(x[3] ?? x[4]);
    const hi = inst.right === 'C' ? a : b, lo = inst.right === 'C' ? b : a;
    const p = (v) => Math.max(0.01, round(v, 4));
    out.push([x[0], p(o), p(Math.max(o, c, hi, lo)), p(Math.min(o, c, hi, lo)), p(c), 1]);
  });
  return out;
}

/**
 * מועמדי אופציות מתוך מועמדי המגמה/המומנטום של הסוכן. רק ETF לא-ממונף מהיקום הקבוע, trend/xmom בלבד, לא מעל maxNew חדשים ביום וסך maxOpen פתוחים,
 * ולא אופציה נוספת על אותו בסיס. כמות לפי תקציב פרמיה (אחוז מההון), בלי להעלות מעבר לשער הפקודות.
 * מחזיר { candidates, instruments, rows } — instruments ו-rows לרישום בריצה (לא נשמרים במועמד עצמו).
 */
export function optionCandidates({ candidates = [], rowsBySym = {}, instrumentOf, day, equityUsd, opts = {}, held = [] }){
  const o = { premiumBudgetPct: 0.03, maxContractPremiumPct: 0.06, minDte: 30, maxOpen: 3, maxNewPerDay: 1, stopPct: 0.5, ...opts };
  const heldUnder = new Set(held.map(parseOptionSymbol).filter(Boolean).map((p) => p.underlying));
  const openCount = held.filter(isOptionSymbol).length;
  const out = { candidates: [], instruments: [], rows: {}, skipped: [] };
  if (!(equityUsd > 0) || openCount >= o.maxOpen) return out;
  const expiry = pickExpiry(day, o.minDte); if (!expiry) return out;
  for (const c of [...candidates].sort((a, b) => b.score - a.score)){
    if (out.candidates.length >= o.maxNewPerDay || openCount + out.candidates.length >= o.maxOpen) break;
    if (!['trend', 'xmom'].includes(c.strategy) || c.needsResearch || c.conflict) continue;   // אות כיווני בלבד; חזרה לממוצע/זעזוע לא
    const under = instrumentOf(c.symbol);
    if (!under || under.class !== 'etf' || under.dynamic || Math.abs(under.leverage || 1) !== 1 || heldUnder.has(c.symbol)) continue;
    const urows = rowsBySym[c.symbol]; if (!urows || urows.length < 70 || urows[urows.length - 1][0] !== day) { out.skipped.push({ symbol: c.symbol, reason: 'אין סגירה של היום בבסיס' }); continue; }
    const right = c.side === 'long' ? 'C' : 'P';
    const inst = optionInstrument(under, expiry, right, pickStrike(c.price));
    const rows = optionRows(inst, urows); const last = rows[rows.length - 1];
    if (!last || last[0] !== day) continue;
    const premium = last[4], cost = premium * CONTRACT_UNITS;
    // יעד: premiumBudgetPct מההון; חוזה בודד מותר גם אם הוא מעל היעד, עד maxContractPremiumPct (אחרת ETF יקרים לעולם לא יתאימו)
    const qty = cost <= equityUsd * o.maxContractPremiumPct ? Math.max(1, Math.floor((equityUsd * o.premiumBudgetPct) / cost)) : 0;
    if (!(qty >= 1)) { out.skipped.push({ symbol: c.symbol, reason: `חוזה אחד עולה ${round(cost, 0)}$ — מעל ${round(o.maxContractPremiumPct * 100, 1)}% מההון` }); continue; }
    const sigma = impliedVolGuess(urows.map((x) => x[4])), dte = daysBetween(day, expiry);
    const delta = bsDelta({ S: c.price, K: inst.strike, T: dte / 365, sigma, right });
    out.candidates.push({ symbol: inst.symbol, name: inst.name, nameHe: inst.nameHe, class: 'option', sector: inst.sector, strategy: 'optlong', side: 'long', day, price: round(premium, 4), stop: round(premium * (1 - o.stopPct), 4), stopPct: o.stopPct, horizonDays: dte, riskPct: o.premiumBudgetPct, score: round(c.score * 0.9, 1), qty, label: 'אופציית קנייה (call/put) לפי מגמה בבסיס — הפסד מקסימלי = הפרמיה', invalidation: `פקיעה ${expiry}, ירידה של ${round(o.stopPct * 100, 0)}% בפרמיה, או ביטול המגמה ב-${c.symbol}`, fromOptions: true, evidence: { underlying: c.symbol, underlyingSide: c.side, underlyingPrice: c.price, strike: inst.strike, expiry, dte, delta: round(delta, 2), volGuess: round(sigma, 3), priced: 'Black-Scholes על תנודתיות ממומשת×1.1 (לא ציטוט שוק)' } });
    out.instruments.push(inst); out.rows[inst.symbol] = rows;
  }
  return out;
}

/** אופציות מוחזקות שפקעו או קרובות לפקיעה (daysBefore ימים): [{symbol, qty, expired, dte}] */
export function expiringPositions(state, day, { daysBefore = 2 } = {}){
  const out = [];
  for (const [sym, p] of Object.entries(state.positions || {})){
    const o = parseOptionSymbol(sym); if (!o || !(p.qty > 0)) continue;
    const dte = daysBetween(day, o.expiry);
    if (dte <= daysBefore) out.push({ symbol: sym, qty: p.qty, expired: dte <= 0, dte });
  }
  return out;
}
