#!/usr/bin/env node
// חיפוש כלל חלופי לסימולציית "המניות שירדו הכי הרבה" (בקשת מאיר, 8/11/2026): "תבדוק באותה היסטוריה ותמצא אופציה אחרת שכן מרוויחה —
// סטופ אחר, סוג מניות מסוים, מכירה בזמן אחר... תבדוק כמה כללים כמה אופציות ונראה איזו עדיפה". מחקר בלבד, בלי פקודות.
//
// אותו יקום ואותן עלויות כמו research-losers.mjs (S&P 1500 של היום, מחיר > 5$, מחזור 20 יום > 20M$, עמלות IBKR Pro Fixed + רגולטור,
// החלקה 0.05% לכל צד). ההבדל: נבדקים אלפי כללים, ולכל כלל יש **בדיקה מחוץ לתקופה** — 3 החודשים של מאיר הם תקופה אחת, וה-~21 חודשים
// שלפניהם (נרות שעה של Yahoo זמינים כ-730 יום אחורה) הם תקופה שנייה. כלל שנבחר כי הצליח ב-3 חודשים ונכשל לפני כן — מזל, לא שיטה.
//
// ממדים: כיוון (לונג/שורט), מה בוחרים (יורדות/עולות), כמה מניות (3/5/10/20), סינון (עוצמת ירידה, גאפ מול ירידה תוך-יומית, יום שבו
// SPY עלה/ירד, מגמה מעל/מתחת לממוצע 50, מחיר, נזילות), כניסה (סגירה / פתיחה למחרת), יציאה (פתיחה למחרת, שעה מסוימת למחרת, סגירה,
// החזקה 2/3/5 ימים), סטופ לפוזיציה (אחוזים: יעד/סטופ/נגרר) וסטופ יומי לכל התיק (אחוז מההון).
// מימוש: החזקה של H ימים = H תיקי-משנה מדורגים (כל יום תיק-משנה אחר נכנס), כך שההון לא נעול ואין חפיפה. גודל פוזיציה = הון תיק-המשנה ÷ N
// (אם הסינון מצא פחות מ-N מניות — היתרה במזומן). שורט: בלי עמלת השאלה (בפועל במניות שקרסו היא יכולה להיות גבוהה — מסומן בדוח).
// סטופ על נרות שעה: פתיחה מעבר לרמה → יציאה בפתיחה; נר שנגע בשתי הרמות → מניחים שהסטופ קרה קודם (שמרני). אין נר שעה → הנר היומי.
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { get, universe, comm, sellFees, sleep, log } from './losers-common.mjs';

export const START_USD = 50000, SLIP = 0.0005, DAYS3M = 63, BORROW_DAY = 0.0002; // עמלת השאלה לשורט: 0.02% ליום (~5% בשנה)

// ---------- נתונים ----------
// מחירים גולמיים (כמו נרות השעה) + רשימת פיצולים: התשואה והממוצע מחושבים על סדרה מתוקנת-פיצולים, ועסקה שחוצה פיצול לא נבחרת
export async function daily(sym, range = '3y'){
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=${range}&interval=1d&includeAdjustedClose=false&events=split`);
  try { const r = JSON.parse(j).chart.result[0], q = r.indicators.quote[0], out = { d: [], o: [], h: [], l: [], c: [], v: [] };
    out.sp = Object.values(r.events?.splits || {}).filter((x) => x.numerator > 0 && x.denominator > 0).map((x) => [new Date(x.date * 1000).toISOString().slice(0, 10), x.numerator / x.denominator]);
    r.timestamp.forEach((t, i) => { if (!(q.open[i] > 0 && q.close[i] > 0 && q.high[i] > 0 && q.low[i] > 0)) return;
      out.d.push(new Date(t * 1000).toISOString().slice(0, 10)); out.o.push(q.open[i]); out.h.push(q.high[i]); out.l.push(q.low[i]); out.c.push(q.close[i]); out.v.push(q.volume[i] || 0); });
    return out; } catch { return null; }
}
const offCache = new Map();
function et(t){ // שניות UTC → { day: תאריך בניו יורק, hr: שעה עשרונית }
  const u = new Date(t * 1000), key = u.toISOString().slice(0, 10);
  let off = offCache.get(key);
  if (off === undefined){ off = Number(new Date(`${key}T16:00:00Z`).toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hourCycle: 'h23' })) - 16; offCache.set(key, off); }
  const s = new Date((t + off * 3600) * 1000);
  return { day: s.toISOString().slice(0, 10), hr: s.getUTCHours() + s.getUTCMinutes() / 60 };
}
export async function hourly(sym, need){ // רק הימים שצריך: { day: [[סוף הנר, o, h, l, c], ...] }
  const p2 = Math.floor(Date.now() / 1000), p1 = p2 - 728 * 86400;
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?period1=${p1}&period2=${p2}&interval=1h&includePrePost=false`);
  try { const r = JSON.parse(j).chart.result[0], q = r.indicators.quote[0], out = {};
    r.timestamp.forEach((t, i) => { if (!(q.open[i] > 0 && q.high[i] > 0 && q.low[i] > 0 && q.close[i] > 0)) return; const { day, hr } = et(t);
      if (hr < 9.4 || hr > 15.6 || (need && !need.has(day))) return; (out[day] ||= []).push([Math.min(hr + 1, 16), q.open[i], q.high[i], q.low[i], q.close[i]]); });
    return { bars: out, first: r.timestamp.length ? et(r.timestamp[0]).day : null }; } catch { return null; }
}

// ---------- הכנה ----------
// D: { sym: {d,o,h,l,c,v} }, Hr: { sym: { day: bars } } → מבנה מוכן לסימולציה
export function prepare(D, Hr = {}, { minAdv = 20e6, minPx = 5 } = {}){
  const spy = D.SPY, days = spy.d, L = days.length, dk = new Map(days.map((d, k) => [d, k]));
  const spyR = days.map((_, k) => k ? spy.c[k] / spy.c[k - 1] - 1 : 0);
  const sma = (n) => spy.c.map((_, k) => (k >= n - 1 ? spy.c.slice(k - n + 1, k + 1).reduce((a, x) => a + x, 0) / n : 0));
  const spyMa50 = sma(50), spyMa200 = sma(200);
  const S = {}, cand = days.map(() => []);
  for (const [s, b] of Object.entries(D)){
    if (s === 'SPY' || !b?.d?.length) continue;
    const n = b.d.length, adv = new Float64Array(n), ma = new Float64Array(n), K = new Int32Array(n).fill(-1), f = new Float64Array(n).fill(1), isSp = new Uint8Array(n);
    // מקדם פיצול: מחיר גולמי ÷ מכפלת היחסים של הפיצולים שאחריו = סדרה רציפה
    for (const [d, ratio] of b.sp || []){ for (let i = 0; i < n && b.d[i] < d; i++) f[i] *= ratio; const q = b.d.indexOf(d); if (q >= 0) isSp[q] = 1; }
    const ac = (i) => b.c[i] / f[i];
    let sv = 0, sc = 0;
    for (let i = 0; i < n; i++){
      K[i] = dk.get(b.d[i]) ?? -1;
      if (i >= 20){ adv[i] = sv / 20; sv -= b.c[i - 20] * b.v[i - 20]; } sv += b.c[i] * b.v[i];
      sc += ac(i); if (i >= 50) sc -= ac(i - 50); if (i >= 49) ma[i] = sc / 50;
    }
    S[s] = { ...b, K };
    for (let i = 50; i < n - 1; i++){
      const k = K[i]; if (k < 1 || K[i + 1] !== k + 1 || K[i - 1] !== k - 1) continue; // יום רצוף בלי חורים
      if (b.c[i] <= minPx || adv[i] < minAdv) continue;
      const r = ac(i) / ac(i - 1) - 1, g = (b.o[i] / f[i]) / ac(i - 1) - 1;
      let spl = 99; for (let j = 1; j <= 5 && i + j < n; j++) if (isSp[i + j]){ spl = j; break; } // פיצול בימי ההחזקה → לא נבחרת להחזקה כזו
      // תשואה מצטברת של 2 ו-3 ימים, ורצף ימי ירידה/עלייה שמסתיים היום
      const r2 = K[i - 2] === k - 2 ? ac(i) / ac(i - 2) - 1 : r, r3 = K[i - 3] === k - 3 ? ac(i) / ac(i - 3) - 1 : r2;
      let sd = 0, su = 0; for (let j = i; j > 0 && j > i - 10; j--){ const d = ac(j) / ac(j - 1) - 1; if (d < 0 && !su) sd += 1; else if (d > 0 && !sd) su += 1; else break; }
      cand[k].push({ s, i, r, r2, r3, sd, su, gs: r ? g / r : 0, px: b.c[i], adv: adv[i], up: ac(i) > ma[i], spl });
    }
  }
  for (const c of cand) c.sort((a, b) => a.r - b.r);
  const by = (key) => cand.map((c) => [...c].sort((a, b) => a[key] - b[key]));
  return { days, L, spyR, spyC: spy.c, spyMa50, spyMa200, S, cand, candBy: { r: cand, r2: by('r2'), r3: by('r3') }, Hr };
}

export const FILT = {
  all: { he: 'כולן', f: () => true },
  mild: { he: 'ירידה 3%–7%', f: (x) => x.r < -0.03 && x.r >= -0.07, lo: true, brk: -0.03 },
  mid: { he: 'ירידה 7%–15%', f: (x) => x.r < -0.07 && x.r >= -0.15, lo: true, brk: -0.07 },
  big: { he: 'ירידה מעל 15%', f: (x) => x.r < -0.15, lo: true, brk: -0.15 },
  gap: { he: 'רוב התנועה בגאפ בפתיחה', f: (x) => x.gs >= 0.6 },
  intra: { he: 'רוב התנועה במהלך היום (בלי גאפ)', f: (x) => x.gs <= 0.3 },
  spyUp: { he: 'רק ביום ש-SPY עלה', f: (x, k, P) => P.spyR[k] > 0, day: true },
  spyDn: { he: 'רק ביום ש-SPY ירד', f: (x, k, P) => P.spyR[k] < 0, day: true },
  upTr: { he: 'מעל ממוצע 50 יום (מגמת עלייה)', f: (x) => x.up },
  dnTr: { he: 'מתחת לממוצע 50 יום', f: (x) => !x.up },
  px50: { he: 'מחיר מעל 50$', f: (x) => x.px >= 50 },
  pxLo: { he: 'מחיר מתחת ל-30$', f: (x) => x.px < 30 },
  liq: { he: 'מחזור מעל 100M$ ביום', f: (x) => x.adv >= 100e6 },
  // רצפים (research-losers-open.mjs)
  dn2: { he: '2+ ימי ירידה ברצף', f: (x) => x.sd >= 2, x2: true }, dn3: { he: '3+ ימי ירידה ברצף', f: (x) => x.sd >= 3, x2: true },
  up2: { he: '2+ ימי עלייה ברצף', f: (x) => x.su >= 2, x2: true }, up3: { he: '3+ ימי עלייה ברצף', f: (x) => x.su >= 3, x2: true },
  // מצב השוק (לא ברשת הכללית; משמשים במחקר הכיוון ההפוך, research-losers-short.mjs)
  bear50: { he: 'שוק יורד (SPY מתחת לממוצע 50)', f: (x, k, P) => P.spyMa50[k] > 0 && P.spyC[k] < P.spyMa50[k], x2: true, day: true },
  bull50: { he: 'שוק עולה (SPY מעל ממוצע 50)', f: (x, k, P) => P.spyMa50[k] > 0 && P.spyC[k] >= P.spyMa50[k], x2: true, day: true },
  bear200: { he: 'שוק יורד (SPY מתחת לממוצע 200)', f: (x, k, P) => P.spyMa200[k] > 0 && P.spyC[k] < P.spyMa200[k], x2: true, day: true },
  bull200: { he: 'שוק עולה (SPY מעל ממוצע 200)', f: (x, k, P) => P.spyMa200[k] > 0 && P.spyC[k] >= P.spyMa200[k], x2: true, day: true },
};

function dayBars(P, s, i){ // נרות היום i של המניה: שעתיים אם יש, אחרת הנר היומי כנר אחד
  const b = P.S[s], h = P.Hr[s]?.[b.d[i]];
  return h?.length ? h : [[16, b.o[i], b.h[i], b.l[i], b.c[i]]];
}
const hasHourly = (P, s, i) => !!P.Hr[s]?.[P.S[s].d[i]]?.length;

export function select(P, cfg, k){
  const fs = cfg._fs || Object.defineProperty(cfg, '_fs', { value: cfg.filt.split('+').map((f) => { if (!FILT[f]) throw new Error(`סינון לא מוכר: ${f}`); return FILT[f]; }) })._fs, out = [], H = cfg.hold || 1;
  for (const f of fs) if (f.day && !f.f(null, k, P)) return out; // סינון ברמת היום (מצב השוק) — בלי לסרוק מניות
  const xs = fs.filter((f) => !f.day), F = (x) => xs.every((f) => f.f(x, k, P)), lo = cfg.sel === 'lo';
  const key = cfg.key || 'r'; // לפי מה מדרגים: תשואת יום (r) או 2/3 ימים (r2/r3)
  const brk = lo && key === 'r' ? Math.min(0, ...xs.map((f) => f.brk ?? 0)) : 0; // הרשימה ממוינת: אחרי הסף אין יותר מועמדים
  const c = (P.candBy?.[key] || P.cand)[k], n = c.length;
  for (let q = 0; q < n && out.length < cfg.N; q++){
    const x = c[lo ? q : n - 1 - q];
    if (lo ? x[key] >= brk : x[key] <= 0) break; // "יורדות" = רק מי שירדה בפועל (ועד סף הסינון), "עולות" = רק מי שעלתה
    if (x.spl <= H || !F(x)) continue;
    const b = P.S[x.s]; if (b.K[x.i + H] !== k + H) continue; // אין נתון ליום היציאה
    if (cfg.exit === 'hour' && !hasHourly(P, x.s, x.i + 1)) continue;
    out.push(x);
  }
  return out;
}

// מסלול פוזיציה אחת → מחיר כניסה ויציאה גולמיים (לפני החלקה)
export function walk(P, cfg, x){
  const b = P.S[x.s], i = x.i, H = cfg.hold || 1, long = cfg.side === 'L';
  const e = cfg.entry === 'C' ? b.c[i] : b.o[i + 1];
  if (cfg.exit === 'open') return { e, x: b.o[i + 1], why: 'end' };
  const st = cfg.stop; let ext = e;
  for (let j = 1; j <= H; j++){
    const bars = dayBars(P, x.s, i + j);
    for (let q = 0; q < bars.length; q++){
      const [end, o, h, l, c] = bars[q];
      if (cfg.exit === 'hour' && end > cfg.hr + 1e-9) return { e, x: bars[q - 1]?.[4] ?? o, why: 'end' };
      if (st){
        if (long){
          const S = st.tr ? ext * (1 - st.tr) : st.sl ? e * (1 - st.sl) : -Infinity, T = st.tp ? e * (1 + st.tp) : Infinity;
          if (o <= S) return { e, x: o, why: 'sl' }; if (o >= T) return { e, x: o, why: 'tp' };
          if (l <= S) return { e, x: S, why: 'sl' }; if (h >= T) return { e, x: T, why: 'tp' };
          ext = Math.max(ext, h);
        } else {
          const S = st.tr ? ext * (1 + st.tr) : st.sl ? e * (1 + st.sl) : Infinity, T = st.tp ? e * (1 - st.tp) : -Infinity;
          if (o >= S) return { e, x: o, why: 'sl' }; if (o <= T) return { e, x: o, why: 'tp' };
          if (h >= S) return { e, x: S, why: 'sl' }; if (l <= T) return { e, x: T, why: 'tp' };
          ext = Math.min(ext, l);
        }
      }
      if (cfg.exit === 'hour' && end >= cfg.hr - 1e-9 && j === H) return { e, x: c, why: 'end' };
    }
  }
  return { e, x: b.c[i + H], why: 'end' }; // סגירה של יום היציאה
}

function trade(long, e, x, per, days = 1){ // רווח/הפסד נטו ועמלות (שורט: + עמלת השאלה לכל יום החזקה)
  if (long){ const bp = e * (1 + SLIP), sh = Math.floor(per / bp); if (sh < 1) return { pnl: 0, fee: 0 }; const sp = x * (1 - SLIP), fee = comm(sh, bp) + comm(sh, sp) + sellFees(sh, sp); return { pnl: sh * (sp - bp) - fee, fee }; }
  const sp = e * (1 - SLIP), sh = Math.floor(per / sp); if (sh < 1) return { pnl: 0, fee: 0 }; const bp = x * (1 + SLIP), fee = comm(sh, sp) + sellFees(sh, sp) + comm(sh, bp) + sh * sp * BORROW_DAY * days; return { pnl: sh * (sp - bp) - fee, fee };
}

// סטופ יומי לכל התיק (רק החזקה של יום אחד): נמדד בפתיחה (כניסה בסגירה) ובסגירת כל נר שעה; כשהרווח/הפסד המשותף מגיע לסף — יוצאים מהכול
function portDay(P, cfg, picks, per, eq){
  const long = cfg.side === 'L', pos = [];
  for (const x of picks){
    const b = P.S[x.s], e = cfg.entry === 'C' ? b.c[x.i] : b.o[x.i + 1], bp = long ? e * (1 + SLIP) : e * (1 - SLIP), sh = Math.floor(per / bp);
    if (sh < 1) continue;
    const bars = dayBars(P, x.s, x.i + 1);
    pos.push({ x, e, bp, sh, last: cfg.entry === 'C' ? b.o[x.i + 1] : e, m: new Map(bars.map((z) => [z[0], z[4]])), fin: cfg.exit === 'hour' ? null : b.c[x.i + 1] });
  }
  const tp = cfg.port.tpUsd ?? cfg.port.tp * eq, sl = cfg.port.slUsd ?? cfg.port.sl * eq; // סף בדולרים קבועים או באחוז מההון
  const mtm = () => pos.reduce((a, p) => a + p.sh * (long ? p.last - p.bp : p.bp - p.last), 0);
  let why = 'end';
  const chk = () => { const v = mtm(); if (v >= tp){ why = 'tp'; return true; } if (v <= -sl){ why = 'sl'; return true; } return false; };
  if (!(cfg.entry === 'C' && chk())){
    const ts = [...new Set(pos.flatMap((p) => [...p.m.keys()]))].sort((a, b) => a - b);
    let hit = false;
    for (const t of ts){
      if (cfg.exit === 'hour' && t > cfg.hr + 1e-9) break;
      for (const p of pos){ const c = p.m.get(t); if (c) p.last = c; }
      if (t < 16 && chk()){ hit = true; break; } // בנר האחרון (16:00) יוצאים בכל מקרה בסגירה
    }
    if (!hit && cfg.exit !== 'hour') for (const p of pos) p.last = p.fin;
  }
  let pnl = 0, fee = 0;
  for (const p of pos){ const r = trade(long, p.e, p.last, per); pnl += r.pnl; fee += r.fee; }
  return { pnl, fee, why };
}

// הרצת כלל על חלון: ימי איתות k ≥ k0 שהיציאה שלהם (k+H) ≤ kEnd
export function run(P, cfg, k0, kEnd){
  if (cfg.sw) return runSw(P, cfg, k0, kEnd);
  const H = cfg.hold || 1, sl = Array(H).fill(START_USD / H), long = cfg.side === 'L';
  let fees = 0, trades = 0, wins = 0, days = 0, tp = 0, slh = 0, peak = START_USD, dd = 0, noHr = 0;
  for (let k = k0; k + H <= kEnd; k++){
    const j = (k - k0) % H, eq = sl[j], picks = select(P, cfg, k); if (!picks.length) continue;
    const per = eq / cfg.N; let pnl = 0;
    if (cfg.port){ const r = portDay(P, cfg, picks, per, eq); pnl = r.pnl; fees += r.fee; if (r.why === 'tp') tp += 1; if (r.why === 'sl') slh += 1; }
    else for (const x of picks){ const w = walk(P, cfg, x), r = trade(long, w.e, w.x, per, H); pnl += r.pnl; fees += r.fee; if (w.why === 'tp') tp += 1; if (w.why === 'sl') slh += 1; }
    if (cfg.port || cfg.stop || cfg.exit === 'hour') for (const x of picks) if (!hasHourly(P, x.s, x.i + 1)) noHr += 1; // בדיקה: סטופ בלי נרות שעה
    sl[j] = eq + pnl; trades += picks.length; days += 1; if (pnl > 0) wins += 1;
    const tot = sl.reduce((a, v) => a + v, 0); peak = Math.max(peak, tot); dd = Math.max(dd, 1 - tot / peak);
  }
  const end = sl.reduce((a, v) => a + v, 0);
  return { end, ret: end / START_USD - 1, fees, trades, wins, days, tp, sl: slh, dd, noHr };
}

// החלפה לפי מצב השוק (החזקה של יום אחד): בכל יום — אם SPY מתחת לממוצע ma, הכלל bear; אחרת הכלל bull (null = מזומן)
function runSw(P, cfg, k0, kEnd){
  const ma = cfg.sw.ma === 200 ? P.spyMa200 : P.spyMa50;
  let eq = START_USD, fees = 0, trades = 0, wins = 0, days = 0, peak = eq, dd = 0, bearDays = 0;
  for (let k = k0; k + 1 <= kEnd; k++){
    const bear = ma[k] > 0 && P.spyC[k] < ma[k]; if (bear) bearDays += 1;
    const cc = bear ? cfg.sw.bear : cfg.sw.bull; if (!cc) continue;
    const picks = select(P, cc, k); if (!picks.length) continue;
    const per = eq / cc.N; let pnl = 0;
    for (const x of picks){ const w = walk(P, cc, x), r = trade(cc.side === 'L', w.e, w.x, per, 1); pnl += r.pnl; fees += r.fee; }
    eq += pnl; trades += picks.length; days += 1; if (pnl > 0) wins += 1; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
  }
  return { end: eq, ret: eq / START_USD - 1, fees, trades, wins, days, tp: 0, sl: 0, dd, bearDays };
}

export function label(c){
  if (c.sw) return `לפי מצב השוק (SPY מול ממוצע ${c.sw.ma}): בשוק יורד — ${c.sw.bear ? label(c.sw.bear) : 'מזומן'} ‖ בשוק עולה — ${c.sw.bull ? label(c.sw.bull) : 'מזומן'}`;
  const side = c.side === 'L' ? 'קנייה' : 'שורט', sel = (c.sel === 'lo' ? 'יורדות' : 'עולות') + (c.key && c.key !== 'r' ? ` (${c.key.slice(1)} ימים)` : '');
  const ex = c.exit === 'open' ? 'מכירה בפתיחה למחרת' : c.exit === 'hour' ? `מכירה ב-${Math.floor(c.hr)}:${c.hr % 1 ? '30' : '00'} למחרת` : (c.hold || 1) === 1 ? 'מכירה בסגירה' : `החזקה ${c.hold} ימים`;
  const st = c.stop ? (c.stop.tr ? ` · סטופ נגרר ${c.stop.tr * 100}%` : ` · ${c.stop.tp ? `יעד +${c.stop.tp * 100}%` : ''}${c.stop.tp && c.stop.sl ? '/' : ''}${c.stop.sl ? `סטופ −${c.stop.sl * 100}%` : ''}`) : '';
  const pt = c.port ? (c.port.tpUsd != null ? ` · סטופ תיק +${c.port.tpUsd}$/−${c.port.slUsd}$` : ` · סטופ תיק +${c.port.tp * 100}%/−${c.port.sl * 100}%`) : '';
  return `${side} ${c.N} ${sel} · ${c.filt.split('+').map((f) => FILT[f].he).join(' + ')} · כניסה ב${c.entry === 'C' ? 'סגירה' : 'פתיחה למחרת'} · ${ex}${st}${pt}`;
}

// ---------- רשת ----------
const EXITS = [{ exit: 'open', hold: 1 }, ...[10.5, 11.5, 12.5, 13.5, 14.5, 15.5].map((hr) => ({ exit: 'hour', hr, hold: 1 })), ...[1, 2, 3, 5].map((hold) => ({ exit: 'close', hold }))];
const STOPS = [
  ...[0.02, 0.03, 0.05, 0.08].map((sl) => ({ sl })), ...[0.02, 0.03, 0.05].map((tp) => ({ tp })),
  ...[[0.01, 0.01], [0.02, 0.02], [0.03, 0.03], [0.05, 0.05], [0.1, 0.1], [0.02, 0.01], [0.03, 0.015], [0.04, 0.02], [0.06, 0.03], [0.01, 0.02], [0.015, 0.03], [0.02, 0.04], [0.03, 0.06]].map(([tp, sl]) => ({ tp, sl })),
  ...[0.02, 0.03, 0.05].map((tr) => ({ tr })),
];
const PORTS = [[0.005, 0.005], [0.01, 0.01], [0.02, 0.02], [0.01, 0.005], [0.02, 0.01], [0.03, 0.015], [0.005, 0.01], [0.01, 0.02]].map(([tp, sl]) => ({ tp, sl }));

export function grid(P){
  const out = [];
  for (const side of ['L', 'S']) for (const sel of ['lo', 'hi']) for (const N of [3, 5, 10, 20]) for (const [filt, F] of Object.entries(FILT)){
    if ((F.lo && sel !== 'lo') || F.x2) continue;
    for (const entry of ['C', 'O']) for (const ex of EXITS){
      if (ex.exit === 'open' && entry === 'O') continue;
      out.push({ side, sel, N, filt, entry, ...ex });
    }
  }
  return out;
}
export function withStops(base){
  const out = [];
  for (const c of base){
    if (c.exit === 'open') continue;
    for (const stop of STOPS) out.push({ ...c, stop });
    if ((c.hold || 1) === 1) for (const port of PORTS) out.push({ ...c, port });
  }
  return out;
}

// ---------- טעינה ----------
// אילו (מניה, יום) צריכים נרות שעה: לכל יום, לכל דירוג (r/r2/r3), לכל סינון שאינו ברמת היום — וגם לכל צירוף ב-combos (צירוף יכול לבחור
// מניה שאיננה ב-20 הראשונות של אף סינון בודד; הערת GPT ב-#227) — 20 המועמדות הראשונות, ל-5 ימי ההחזקה שאחרי
export function hourlyNeed(P0, combos = []){
  const specs = [...Object.entries(FILT).filter(([, F]) => !F.day).map(([k, F]) => ({ lo: !!F.lo, fs: [F] })),
    ...combos.map((c) => { const fs = c.split('+').map((f) => FILT[f]); if (fs.some((f) => !f)) throw new Error(`סינון לא מוכר: ${c}`); return { lo: fs.some((f) => f.lo), fs: fs.filter((f) => !f.day) }; })];
  const need = {};
  for (let k = 1; k < P0.L - 1; k++) for (const key of ['r', 'r2', 'r3']) for (const sp of specs) for (const sel of ['lo', 'hi']){
    if (sp.lo && sel === 'hi') continue;
    const c = P0.candBy[key][k]; let m = 0;
    for (let q = 0; q < c.length && m < 20; q++){ const x = c[sel === 'lo' ? q : c.length - 1 - q]; if (!sp.fs.every((f) => f.f(x, k, P0))) continue; m += 1;
      for (let j = 1; j <= 5; j++){ const d = P0.days[k + j]; if (d) (need[x.s] ||= new Set()).add(d); } }
  }
  return need;
}
// נרות יומיים לכל היקום (range) + נרות שעה (כ-730 יום אחורה, רק לימים שבהם מניה יכולה להיות מוחזקת)
export async function loadData({ cache = '', range = '3y', combos = [] } = {}){
  if (cache && existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  {
    const syms = await universe(); let D, Hr; log(`universe: ${syms.length}`);
    D = {}; const q = [...syms, 'SPY'];
    await Promise.all(Array.from({ length: 6 }, async () => { for (let s; (s = q.shift());){ const b = await daily(s, range); if (b && b.d.length > 80) D[s] = b; await sleep(100); } }));
    log(`daily loaded: ${Object.keys(D).length}`);
    // נרות שעה רק לימים שבהם מניה יכולה להיות מוחזקת: 20 הראשונות בכל סינון, בכל יום, ל-5 הימים שאחרי
    const need = hourlyNeed(prepare(D), combos);
    Hr = {}; const hq = Object.keys(need); log(`hourly for ${hq.length} symbols`);
    await Promise.all(Array.from({ length: 6 }, async () => { for (let s; (s = hq.shift());){ const h = await hourly(s, need[s]); if (h) Hr[s] = h.bars; await sleep(100); } }));
    const sh = await hourly('SPY', null); Hr.__first = sh?.first;
    log(`hourly loaded: ${Object.keys(Hr).length - 1}, first hourly day ${Hr.__first}`);
    if (cache) try { writeFileSync(cache, JSON.stringify({ D, Hr })); } catch (e) { log(`cache not saved (${e.message}) — continuing without it`); }
    return { D, Hr };
  }
}

// ---------- ראשי ----------
async function main(){
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUT = arg('--out', ''), CACHE = arg('--cache', '');
  const { D, Hr } = await loadData({ cache: CACHE, range: '3y' });
  const P = prepare(D, Hr), L = P.L;
  // חלונות: 3 החודשים (63 ימי החזקה אחרונים) מול התקופה שלפניהם מאז שיש נרות שעה
  const k3 = L - 1 - DAYS3M, kH = L - 1 - 32, kP = Math.max(60, P.days.findIndex((d) => d >= (Hr.__first || P.days[0])) + 1);
  const W = { p: [kP, k3], m: [k3, L - 1], h1: [k3, kH], h2: [kH, L - 1] };
  const priorDays = k3 - kP, ann = (r, n) => (1 + r) ** (252 / n) - 1;
  const spyRet = (a, b) => P.spyC[b] / P.spyC[a] - 1;
  const usd = (x) => `${Math.round(x).toLocaleString('en-US')}$`, pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
  const evalc = (c) => { const r = {}; for (const [w, [a, b]] of Object.entries(W)) r[w] = run(P, c, a, b); return { c, ...r, pa: ann(r.p.ret, priorDays) }; };

  log(`days ${P.days[0]} → ${P.days.at(-1)} (L=${L}); prior ${P.days[kP]} → ${P.days[k3]} (${priorDays}); 3m ${P.days[k3]} → ${P.days.at(-1)}`);
  const t0 = Date.now();
  const base = grid(P).map(evalc); log(`stage 1: ${base.length} configs, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  // שלב 2: סטופים — על בסיס "קנייה של היורדות" (5/10, כל הסינונים העיקריים) ועל 10 הטובות בכל תקופה מהשלב הראשון
  const keyOf = (c) => JSON.stringify(c), seen = new Set();
  const top = (arr, f, n) => [...arr].sort((a, b) => f(b) - f(a)).slice(0, n);
  const stage2Base = [
    ...base.filter((x) => x.c.side === 'L' && x.c.sel === 'lo' && [5, 10].includes(x.c.N) && ['all', 'mid', 'big', 'gap', 'intra', 'upTr', 'liq'].includes(x.c.filt) && x.c.exit === 'close' && [1, 3].includes(x.c.hold)).map((x) => x.c),
    ...top(base, (x) => x.m.ret, 10).map((x) => x.c), ...top(base, (x) => x.pa, 10).map((x) => x.c),
  ].filter((c) => !seen.has(keyOf(c)) && seen.add(keyOf(c)));
  const st = withStops(stage2Base).map(evalc); log(`stage 2: ${st.length} configs, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const ALL = [...base, ...st];

  const row = (x) => `| ${label(x.c)} | **${usd(x.m.end)}** | ${pct(x.m.ret)} | ${pct(x.h1.ret)} / ${pct(x.h2.ret)} | ${x.m.trades} | ${pct(-x.m.dd)} | ${pct(x.p.ret)} (${pct(x.pa)} לשנה) | ${pct(-x.p.dd)} |`;
  const HEAD = ['| כלל | 3 חודשים: סוף | תשואה | חצי ראשון / שני | עסקאות | ירידה מקס׳ | 21 החודשים שלפני: מצטבר (שנתי) | ירידה מקס׳ שם |', '|---|---|---|---|---|---|---|---|'];
  const canon = (c) => JSON.stringify([c.side, c.sel, c.N, c.filt, c.entry, c.exit, c.hr ?? null, c.hold || 1, c.stop ?? null, c.port ?? null]);
  const byKey = new Map(ALL.map((x) => [canon(x.c), x])), find = (o) => byKey.get(canon(o));
  const B = { side: 'L', sel: 'lo', N: 10, filt: 'all', entry: 'C', exit: 'close', hold: 1 };
  const L_ = [`# חיפוש כלל חלופי — המניות שירדו הכי הרבה (${P.days[k3]} → ${P.days.at(-1)}, ובדיקה על ${P.days[kP]} → ${P.days[k3]})`, '',
    `- יקום: ${Object.keys(P.S).length} מניות S&P 1500 (הרכב של היום — הטיית שורדים, חזקה יותר בתקופה הארוכה), מחיר > 5$, מחזור 20 יום > 20M$.`,
    `- התחלה 50,000$ בכל תקופה בנפרד. עמלות IBKR + רגולטור, החלקה 0.05% לכל צד. שורט — בלי עמלת השאלה.`,
    `- נבדקו **${ALL.length.toLocaleString('en-US')} כללים** (${base.length} בלי סטופ + ${st.length} עם סטופ לפוזיציה/לתיק).`,
    `- SPY: 3 חודשים ${pct(spyRet(k3, L - 1))} · 21 החודשים שלפני ${pct(spyRet(kP, k3))} (${pct(ann(spyRet(kP, k3), priorDays))} לשנה).`,
    `- כלל שהרוויח בשתי התקופות: **${ALL.filter((x) => x.m.ret > 0 && x.p.ret > 0).length}** מתוך ${ALL.length} · הרוויח ב-3 החודשים: ${ALL.filter((x) => x.m.ret > 0).length} · הרוויח לפני: ${ALL.filter((x) => x.p.ret > 0).length}.`, ''];
  const sect = (title, xs, note) => { L_.push(`## ${title}`); if (note) L_.push(note); L_.push(...HEAD, ...xs.filter(Boolean).map(row), ''); };
  // משתנה אחד בכל פעם מהבסיס (קנייה של 10 היורדות בסגירה, מכירה בסגירה למחרת)
  sect('הבסיס — הסימולציה המקורית', [find(B), find({ ...B, N: 5 }), find({ ...B, entry: 'O' }), find({ ...B, N: 5, entry: 'O' })]);
  sect('מתי למכור (קנייה של 10 היורדות בסגירה)', EXITS.map((e) => find({ ...B, ...e })));
  sect('כמה מניות', [3, 5, 10, 20].map((N) => find({ ...B, N })));
  sect('איזה סוג מניות (10 היורדות שעוברות את הסינון)', Object.keys(FILT).map((filt) => find({ ...B, filt })));
  sect('סטופ לכל מניה (10 היורדות, סגירה → סגירה)', STOPS.map((stop) => find({ ...B, stop })));
  sect('סטופ יומי לכל התיק (10 היורדות, סגירה → סגירה; % מההון — 1% = 500$ בהתחלה)', PORTS.map((port) => find({ ...B, port })));
  sect('הכיוון ההפוך — להשוואה', [find({ ...B, sel: 'hi' }), find({ ...B, side: 'S' }), find({ ...B, side: 'S', sel: 'hi' }), find({ ...B, side: 'S', exit: 'hour', hr: 10.5 }), find({ ...B, side: 'S', entry: 'O' })]);
  sect('20 הכללים הטובים ביותר ב-3 החודשים', top(ALL, (x) => x.m.ret, 20),
    '⚠️ מתוך אלפי כללים, חלק "ינצחו" במקרה. העמודה של 21 החודשים שלפני היא הבדיקה: אם שם הכלל הפסיד — סביר שזה מזל.');
  sect('20 הכללים הטובים ביותר ב-21 החודשים שלפני — ומה קרה להם ב-3 החודשים (הבדיקה ההוגנת)', top(ALL, (x) => x.pa, 20),
    'כאן הבחירה נעשית על התקופה הקודמת בלבד, ו-3 החודשים הם מבחן עיוור — כמו שהיה קורה אילו בחרנו כלל לפני 3 חודשים.');
  const rob = ALL.filter((x) => x.m.ret > 0 && x.p.ret > 0 && x.h1.ret > 0 && x.h2.ret > 0 && x.m.trades >= 30);
  sect(`עמידים: הרוויחו בשני חצאי 3 החודשים וגם ב-21 החודשים שלפני (לפחות 30 עסקאות) — ${rob.length} כללים, 25 הראשונים לפי התשואה הנמוכה מבין התקופות`,
    top(rob, (x) => Math.min(x.m.ret * 4, x.pa), 25));
  const md = L_.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
