// מחקר מסחר יומי במניות ארה"ב (פרוטוקול v1.1, invest/docs/research/daytrading/PROTOCOL_v1.1.md). מחקר בלבד: פונקציות טהורות,
// בלי רשת, בלי פקודות. נרות דקה של שעות המסחר הרגילות → נרות 5 דקות → אותות של 6 אסטרטגיות → סימולציית יציאה על נרות הדקה,
// בסדר שמרני בתוך נר (סטופ קודם, אחר כך יעד, ורק אחר כך עדכון הגנות שתקף מהנר הבא).

export const COST = Object.freeze({ perShare: 0.0035, minOrder: 0.35, maxPct: 0.01, halfSpreadBps: 1.5, slipBps: 2 });
export const RESEARCH = Object.freeze({ riskUsd: 500, capUsd: 20000 });
export const STRATS = Object.freeze(['pullback', 'breakout_retest', 'reversal', 'orb', 'vwap_reclaim', 'momentum_rvol']);
const BAR = 300; // שניות בנר 5 דקות

// ---------- ימים ונרות ----------
// m = {t (שניות), o,h,l,c,v} ממוינים, רק שעות המסחר הרגילות. dayKey(t) → מחרוזת תאריך בניו יורק (מסופק מבחוץ).
// מחזיר ימים: {key, i0, i1 (לא כולל), open (09:30 בשניות), close (16:00 או 13:00 בימים מקוצרים)}.
export function splitDays(m, dayKey, openOf){
  const days = []; let cur = null;
  for (let i = 0; i < m.t.length; i++){
    const k = dayKey(m.t[i]);
    if (!cur || cur.key !== k){ if (cur) days.push(cur); cur = { key: k, i0: i, i1: i + 1, open: openOf(m.t[i]) }; } else cur.i1 = i + 1;
  }
  if (cur) days.push(cur);
  for (const d of days){
    const last = m.t[d.i1 - 1] + 60, full = d.open + 6.5 * 3600, half = d.open + 3.5 * 3600;
    d.close = last <= half + 15 * 60 ? half : full; // הנר האחרון עד 13:15 → יום מקוצר
  }
  return days;
}

// נרות 5 דקות של יום: {k, o,h,l,c,v, end, i0, i1, tpv (סכום מחיר טיפוסי × מחזור)}; k = מספר הנר מהפתיחה
export function bars5(m, d){
  const out = []; let cur = null;
  for (let i = d.i0; i < d.i1; i++){
    const k = Math.floor((m.t[i] - d.open) / BAR);
    if (k < 0) continue;
    if (!cur || cur.k !== k){
      if (cur) out.push(cur);
      cur = { k, o: m.o[i], h: m.h[i], l: m.l[i], c: m.c[i], v: m.v[i], end: d.open + (k + 1) * BAR, i0: i, i1: i + 1, tpv: (m.h[i] + m.l[i] + m.c[i]) / 3 * m.v[i] };
    } else {
      cur.h = Math.max(cur.h, m.h[i]); cur.l = Math.min(cur.l, m.l[i]); cur.c = m.c[i]; cur.v += m.v[i]; cur.i1 = i + 1; cur.tpv += (m.h[i] + m.l[i] + m.c[i]) / 3 * m.v[i];
    }
  }
  if (cur) out.push(cur);
  return out;
}

// מצב מדדים רציף בין ימים: EMA20, EMA50, ATR14 (Wilder) על נרות 5 דקות
export function indState(){ return { e20: NaN, e50: NaN, atr: NaN, pc: NaN, n: 0, trs: [] }; }
export function indUpdate(s, b){
  const a20 = 2 / 21, a50 = 2 / 51;
  s.e20 = Number.isFinite(s.e20) ? s.e20 + a20 * (b.c - s.e20) : b.c;
  s.e50 = Number.isFinite(s.e50) ? s.e50 + a50 * (b.c - s.e50) : b.c;
  const tr = Number.isFinite(s.pc) ? Math.max(b.h, s.pc) - Math.min(b.l, s.pc) : b.h - b.l;
  if (s.n < 14){ s.trs.push(tr); if (s.trs.length === 14) s.atr = s.trs.reduce((x, y) => x + y, 0) / 14; } else s.atr = (s.atr * 13 + tr) / 14;
  s.n++; s.pc = b.c;
  return { e20: s.e20, e50: s.e50, atr: s.atr, warm: s.n >= 50 };
}

// הקשר יומי מנרות יומיים סגורים עד אתמול: daily = [{key,o,h,l,c,v}] ממוינים; idx = מיקום היום הנוכחי (הימים לפניו בלבד)
export function dailyCtx(daily, idx){
  if (idx < 51) return null;
  const c = (j) => daily[j].c, sma = (n, end) => { let s = 0; for (let j = end - n; j < end; j++) s += c(j); return s / n; };
  const ma20 = sma(20, idx), ma50 = sma(50, idx), ma20p = sma(20, idx - 5);
  let atr = 0; for (let j = idx - 14; j < idx; j++) atr += Math.max(daily[j].h, c(j - 1)) - Math.min(daily[j].l, c(j - 1)); atr /= 14;
  const prev = c(idx - 1);
  return { prevClose: prev, ma20, ma50, aboveMa20: prev > ma20, aboveMa50: prev > ma50, ma20Rising: ma20 > ma20p, atrD: atr };
}

// ---------- אותות ----------
// b5: נרות היום, ind[i] = מדדים אחרי נר i, vwap[i], rvol[i]; dc = הקשר יומי. מחזיר לכל אסטרטגיה רשימת אותות {i (נר האות), stop}
// בסדר זמן. כל אות "מבני" — הסטופ לפי ההגדרה בפרוטוקול (לפני נרמול לפי ATR).
export function signals(b5, ind, vwap, rvol, dc, open){
  const out = Object.fromEntries(STRATS.map((s) => [s, []]));
  if (!dc || b5.length < 4) return out;
  const atrOk = (i) => Number.isFinite(ind[i]?.atr) && ind[i].atr > 0;
  // 1. משיכה במגמת עלייה (תוך-יומי בלבד; מגמה יומית = מסנן חיצוני)
  for (let i = 1; i < b5.length; i++){
    const b = b5[i], p = b5[i - 1];
    if (p.k !== b.k - 1 || !atrOk(i)) continue;
    if (b.c > vwap[i] && ind[i].e20 > ind[i].e50 && p.l <= ind[i - 1].e20 && b.c > p.h){
      let lo = Infinity; for (let j = Math.max(0, i - 2); j <= i; j++) lo = Math.min(lo, b5[j].l);
      out.pullback.push({ i, stop: lo });
    }
  }
  // 2. פריצה ובדיקה חוזרת: רמה = שיא 30 הדקות הראשונות (נרות 0–5)
  { let level = -Infinity, ok = true;
    for (let i = 0; i < b5.length && b5[i].k <= 5; i++) level = Math.max(level, b5[i].h);
    if (b5.filter((b) => b.k <= 5).length < 6) ok = false;
    let brk = -1;
    for (let i = 0; ok && i < b5.length; i++){
      const b = b5[i]; if (b.k <= 5) continue;
      if (brk < 0){ if (b.c > level) brk = i; continue; }
      if (b.k - b5[brk].k > 12) break;
      if (b.l <= level * 1.001 && b.c > level && atrOk(i)){ out.breakout_retest.push({ i, stop: b.l - 0.1 * ind[i].atr }); break; }
    }
  }
  // 3. היפוך עם אישור: ירידה של ATR יומי מהפתיחה, שפל חדש, ואז סגירה מעל שיא 3 הנרות הקודמים ומעל EMA20
  { const o = b5[0].o; let lo = Infinity, dropped = false, newLowAt = -1;
    for (let i = 0; i < b5.length; i++){
      const b = b5[i];
      if (b.l < lo){ lo = b.l; newLowAt = i; }
      if (o - lo >= dc.atrD) dropped = true;
      if (!dropped || i < 3 || newLowAt === i || !atrOk(i)) continue;
      const hi3 = Math.max(b5[i - 1].h, b5[i - 2].h, b5[i - 3].h);
      if (b.c > hi3 && b.c > ind[i].e20){ out.reversal.push({ i, stop: lo }); dropped = false; }
    }
  }
  // 4. פריצת טווח הפתיחה: טווח = 15 הדקות הראשונות (נרות 0–2), רוחב ≤ 1.5 × ATR יומי
  { const orb = b5.filter((b) => b.k <= 2);
    if (orb.length === 3){
      const hi = Math.max(...orb.map((b) => b.h)), lo = Math.min(...orb.map((b) => b.l));
      if (hi - lo <= 1.5 * dc.atrD){
        for (let i = 0; i < b5.length; i++){ const b = b5[i]; if (b.k <= 2) continue; if (b.c > hi && atrOk(i)){ out.orb.push({ i, stop: (hi + lo) / 2 }); break; } }
      }
    }
  }
  // 5. חזרה מעל VWAP: לפחות 6 נרות רצופים מתחת, ואז סגירה מעל עם מחזור מעל ממוצע הנרות של היום
  { let below = 0, volSum = 0;
    for (let i = 0; i < b5.length; i++){
      const b = b5[i];
      if (b.c > vwap[i] && below >= 6 && i > 0 && b.v > volSum / i && atrOk(i)){
        let lo = Infinity; for (let j = Math.max(0, i - 5); j <= i; j++) lo = Math.min(lo, b5[j].l);
        out.vwap_reclaim.push({ i, stop: lo });
      }
      below = b.c < vwap[i] ? below + 1 : 0; volSum += b.v;
    }
  }
  // 6. מומנטום ומחזור חריג: בכל נר (הבחירה לפי שעת התחלה נעשית בחוץ — "הנר שמסתיים בשעת ההתחלה")
  for (let i = 0; i < b5.length; i++){
    const b = b5[i];
    if (!atrOk(i) || !(rvol[i] >= 2) || b.c < dc.prevClose * 1.02 || b.c <= vwap[i]) continue;
    out.momentum_rvol.push({ i, stop: Math.min(vwap[i] - 0.25 * ind[i].atr, b.c - 0.5 * ind[i].atr), fixedTime: true });
  }
  return out;
}

// נרמול הסטופ: R < 0.5 ATR → מורחב ל-0.5 ATR; R > 3 ATR → אין עסקה. stopMode: 's' (מבני) או מספר (כפולת ATR)
export function normStop(entry, structStop, atr, stopMode){
  let stop = stopMode === 's' ? structStop : entry - stopMode * atr;
  if (entry - stop < 0.5 * atr) stop = entry - 0.5 * atr;
  if (entry - stop > 3 * atr) return null;
  return stop;
}

// ---------- יציאה ----------
// cfg: {tR (יעד ב-R או null), be (אחוז, למשל 0.01, או null), step (bool), trailPct, trailAtr (כפולה), partial (bool),
//       maxMin (מגבלת זמן בדקות או null), overnight (bool)}
// days: מערך הימים של המניה; di = אינדקס יום הכניסה. מחזיר {fills:[[frac, px, market(1/0)]], tExit, kind}
export function simulateExit(m, days, di, iEntry, entry, stop0, atr, cfg){
  const R = entry - stop0;
  let stop = stop0, hh = entry, rem = 1, partDone = false;
  let target = cfg.tR != null ? entry + cfg.tR * R : Infinity;
  const fills = [];
  const eodDay = cfg.overnight && di + 1 < days.length ? days[di + 1] : days[di];
  const tEod = eodDay.close - 300;
  const tLimit = Math.min(tEod, cfg.maxMin != null ? m.t[iEntry] + cfg.maxMin * 60 : Infinity);
  const iEnd = eodDay.i1;
  const lockLv = [[3, 2], [2, 1], [1.5, 0.5], [1, 0.25]];
  for (let i = iEntry; i < iEnd; i++){
    if (i > iEntry && m.t[i] >= tLimit){ fills.push([rem, m.o[i], 1]); return { fills, tExit: m.t[i], kind: m.t[i] >= tEod ? 'eod' : 'time' }; }
    if (m.l[i] <= stop){ fills.push([rem, Math.min(stop, m.o[i]), 1]); return { fills, tExit: m.t[i], kind: stop >= entry ? 'protect' : 'stop' }; }
    if (cfg.partial && !partDone && m.h[i] >= entry + R + 0.01){
      fills.push([0.5, entry + R, 0]); rem = 0.5; partDone = true; stop = Math.max(stop, entry); target = entry + 3 * R;
      continue; // את השאר בודקים מהנר הבא
    }
    if (m.h[i] >= target + 0.01){ fills.push([rem, target, 0]); return { fills, tExit: m.t[i], kind: 'target' }; }
    hh = Math.max(hh, m.h[i]);
    if (cfg.be != null && hh >= entry * (1 + cfg.be)) stop = Math.max(stop, entry);
    if (cfg.step){ const r = (hh - entry) / R; for (const [at, lock] of lockLv) if (r >= at){ stop = Math.max(stop, entry + lock * R); break; } }
    if (cfg.trailPct != null) stop = Math.max(stop, hh * (1 - cfg.trailPct));
    if (cfg.trailAtr != null) stop = Math.max(stop, hh - cfg.trailAtr * atr);
  }
  const last = iEnd - 1; fills.push([rem, m.c[last], 1]);
  return { fills, tExit: m.t[last], kind: 'eod' };
}

// ---------- עלויות ----------
export const commission = (sh, px) => sh <= 0 ? 0 : Math.min(Math.max(COST.minOrder, COST.perShare * sh), COST.maxPct * sh * px); // IBKR מדורג: מינימום 0.35$, ותקרה 1% מהשווי גוברת
// רווח נטו בדולרים ל-sh מניות. bps = {entry, exit} עלות בנקודות בסיס לביצוע בשוק (חצי מרווח + החלקה)
export function pnlUsd(entry, fills, sh, bps){
  const eFill = entry * (1 + bps.entry / 1e4);
  let pnl = -commission(sh, entry);
  for (const [f, px, mkt] of fills){
    const q = Math.floor(sh * f + 1e-9) || (f > 0 && sh > 0 ? 1 : 0);
    const x = mkt ? px * (1 - bps.exit / 1e4) : px;
    pnl += q * (x - eFill) - commission(q, px);
  }
  return pnl;
}
export const fixedBps = () => ({ entry: COST.halfSpreadBps + COST.slipBps, exit: COST.halfSpreadBps + COST.slipBps });
// עלות משתנה: חצי מרווח = 0.1 × חציון טווח הדקה (נ"ב), בין 0.5 ל-15; החלקה = 1 + 10 × שורש(מניות / מחזור ממוצע לדקה)
export function varBps(medRangeBps, avgMinVol, sh){
  const hs = Math.min(15, Math.max(0.5, 0.1 * medRangeBps));
  const slip = 1 + 10 * Math.sqrt(sh / Math.max(1, avgMinVol));
  return { entry: hs + slip, exit: hs + slip };
}
export const researchShares = (entry, stop) => Math.max(0, Math.floor(Math.min(RESEARCH.riskUsd / (entry - stop), RESEARCH.capUsd / entry)));

// ---------- וריאנטים (שלב ג', שינוי אחד בכל פעם) ----------
const B = { stop: 's', tR: 2, be: null, step: false, trailPct: null, trailAtr: null, partial: false, maxMin: null, overnight: false };
export const VARIANTS = Object.freeze([
  ['base', {}],
  ['stop_atr1', { stop: 1 }], ['stop_atr1.5', { stop: 1.5 }], ['stop_atr2', { stop: 2 }],
  ['tgt_1R', { tR: 1 }], ['tgt_1.5R', { tR: 1.5 }], ['tgt_3R', { tR: 3 }], ['tgt_none', { tR: null }],
  ['be_0.5%', { be: 0.005 }], ['be_1%', { be: 0.01 }], ['be_1.5%', { be: 0.015 }], ['be_2%', { be: 0.02 }],
  ['lock_steps', { step: true }],
  ['trail_0.5%', { trailPct: 0.005 }], ['trail_1%', { trailPct: 0.01 }], ['trail_1.5%', { trailPct: 0.015 }],
  ['trail_atr1', { trailAtr: 1 }], ['trail_atr1.5', { trailAtr: 1.5 }], ['trail_atr2', { trailAtr: 2 }],
  ['partial_1R', { partial: true }],
  ['time_30m', { maxMin: 30 }], ['time_1h', { maxMin: 60 }], ['time_2h', { maxMin: 120 }], ['time_4h', { maxMin: 240 }],
  ['overnight', { overnight: true }],
].map(([k, v]) => Object.freeze([k, Object.freeze({ ...B, ...v })])));
export const START_TIMES = Object.freeze([['0945', 15 * 60], ['1000', 30 * 60], ['1030', 60 * 60]]);

// ---------- זמן ניו יורק בלי Intl (DST בארה"ב: מהיום ראשון השני במרץ עד הראשון בנובמבר, 02:00 מקומי) ----------
const offCache = new Map();
export function nyOffsetSec(tSec){
  const day = Math.floor(tSec / 86400);
  let off = offCache.get(day);
  if (off === undefined){
    const d = new Date(day * 86400e3), y = d.getUTCFullYear();
    const nthSunday = (mon, n) => { const f = new Date(Date.UTC(y, mon, 1)); const first = 1 + ((7 - f.getUTCDay()) % 7); return Date.UTC(y, mon, first + 7 * (n - 1)) / 1000; };
    const start = nthSunday(2, 2) + 7 * 3600, end = nthSunday(10, 1) + 6 * 3600; // 02:00 EST = 07:00 UTC; 02:00 EDT = 06:00 UTC
    off = (tSec >= start && tSec < end) ? -4 * 3600 : -5 * 3600;
    // מקרה קצה: היום עצמו של המעבר — מחשבים לפי הצהריים (שעות המסחר תמיד אחרי המעבר)
    const noon = day * 86400 + 17 * 3600; off = (noon >= start && noon < end) ? -4 * 3600 : -5 * 3600;
    offCache.set(day, off);
  }
  return off;
}
export const nyLocal = (tSec) => tSec + nyOffsetSec(tSec);
export const nyDayKey = (tSec) => { const d = new Date(nyLocal(tSec) * 1000); return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(); };
export const nyOpenOf = (tSec) => { const loc = nyLocal(tSec), mid = loc - (((loc % 86400) + 86400) % 86400); return mid + 9.5 * 3600 - nyOffsetSec(tSec); };
export const nyMinuteOfDay = (tSec) => Math.floor(((nyLocal(tSec) % 86400) + 86400) % 86400 / 60);
