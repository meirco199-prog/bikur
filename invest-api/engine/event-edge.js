// מחקר "יתרון מאירועים" (invest/docs/research/event-edge/PROTOCOL_v1.0.md). פונקציות טהורות בלבד: פענוח לוח הדוחות, יום התגובה,
// H1 (סחף ביום התגובה לדוח) ו-H2 (מומנטום תוך-יומי של SPY/QQQ), ועלויות לפי הבדיקה בפועל בחשבונות של מאיר. בלי רשת, בלי פקודות.

// "$1.23" / "($0.12)" / "-$0.12" / "" → מספר או null
export function parseEps(x){
  if (x == null) return null;
  const s = String(x).trim(); if (!s || s === 'N/A' || s === '--') return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  const v = Number(s.replace(/[()$,\s-]/g, ''));
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}
export function surprise(eps, f){ return eps == null || f == null || f === 0 ? null : (eps - f) / Math.abs(f); }

// יום התגובה: daily = [{key,o,c}] ממוינים; d = מפתח יום הדוח (yyyymmdd); time = 'time-pre-market' | 'time-after-hours' | אחר
// מחזיר {idx (מיקום יום התגובה ב-daily), explicit (bool)} או null
export function reactionDay(daily, d, time){
  let i = daily.findIndex((x) => x.key >= d); if (i < 1) return null;
  const sameDay = daily[i].key === d;
  if (time === 'time-pre-market') return sameDay ? { idx: i, explicit: true } : null;
  if (time === 'time-after-hours'){ const j = sameDay ? i + 1 : i; return j < daily.length ? { idx: j, explicit: true } : null; }
  // לא צוין: היום עם פער הפתיחה הגדול יותר בערך מוחלט (D אם היה יום מסחר, או הבא)
  const cands = (sameDay ? [i, i + 1] : [i]).filter((j) => j >= 1 && j < daily.length);
  if (!cands.length) return null;
  const gap = (j) => Math.abs(daily[j].o / daily[j - 1].c - 1);
  const idx = cands.reduce((a, b) => gap(b) > gap(a) ? b : a);
  return { idx, explicit: false };
}

// עלויות (פרוטוקול סעיף 2): עמלה בתמחור הקבוע × 1.3, מרווח והחלקה לכל ביצוע בשוק
export const COST = Object.freeze({ perShare: 0.005, minOrder: 1, maxPct: 0.01, feeMult: 1.3, bps: 3.5 });
export const commission = (sh, px) => sh <= 0 ? 0 : COST.feeMult * Math.min(Math.max(COST.minOrder, COST.perShare * sh), COST.maxPct * sh * px);
// עסקה בשוק בכניסה וביציאה; side = 1 לונג, −1 שורט. מחזיר {gross, net}
export function tradePnl(entry, exit, side, notional, costMult = 1){
  const sh = Math.floor(notional / entry); if (sh < 1) return null;
  const gross = side * sh * (exit - entry);
  const slip = costMult * COST.bps / 1e4 * sh * (entry + exit);
  return { gross, net: gross - slip - commission(sh, entry) - commission(sh, exit), sh };
}

// מחיר בזמן: m = {t,o,c} של יום (שעות רגילות). priceAt(T) = סגירת הנר האחרון שהתחיל לפני T; entryAt(T) = פתיחת הנר הראשון שמתחיל ב-T או אחריו
export function priceAt(m, T){ let p = null; for (let i = 0; i < m.t.length && m.t[i] < T; i++) p = m.c[i]; return p; }
export function entryAt(m, T){ for (let i = 0; i < m.t.length; i++) if (m.t[i] >= T) return { i, px: m.o[i] }; return null; }

// H1 לאירוע אחד: ev = {sur, prevClose, m (נרות דקה של יום התגובה), open (09:30 בשניות), close (סגירת היום בשניות)}
// v = {gap (סף), held (bool), startMin (15/30/60 דקות אחרי הפתיחה)}. מחזיר {side, entry, exit} או null
export function h1Trade(ev, v){
  if (!ev.m || !ev.m.t.length || ev.sur == null) return null;
  const o = ev.m.o[0], gap = o / ev.prevClose - 1, T = ev.open + v.startMin * 60;
  const side = ev.sur > 0 && gap >= v.gap ? 1 : ev.sur < 0 && gap <= -v.gap ? -1 : 0;
  if (!side) return null;
  const p = priceAt(ev.m, T); if (p == null) return null;
  if (v.held && (side > 0 ? p < o : p > o)) return null;
  const e = entryAt(ev.m, T), x = entryAt(ev.m, ev.close - 300);
  if (!e || !x || x.i <= e.i) return null;
  return { side, entry: e.px, exit: x.px, gap };
}

// H2 ליום אחד: day = {m (נרות דקה, שעות רגילות), open, close, prevClose}; v = {thr, withR12}. מחזיר {side, entry, exit, r1} או null
export function h2Trade(day, v){
  const { m, open, close, prevClose } = day; if (!m || !m.t.length || !(prevClose > 0)) return null;
  const p10 = priceAt(m, open + 1800); if (p10 == null) return null;
  const r1 = p10 / prevClose - 1;
  const side = r1 > v.thr ? 1 : r1 < -v.thr ? -1 : 0; if (!side) return null;
  const tIn = close - 1800, pA = priceAt(m, tIn - 1800), pB = priceAt(m, tIn);
  if (v.withR12){ if (pA == null || pB == null) return null; const r12 = pB / pA - 1; if (Math.sign(r12) !== side) return null; }
  const e = entryAt(m, tIn); if (!e) return null;
  let lastI = -1; for (let i = 0; i < m.t.length; i++) if (m.t[i] < close) lastI = i;
  if (lastI <= e.i) return null;
  return { side, entry: e.px, exit: m.c[lastI], r1 };
}

export const H1_GRID = Object.freeze([0.01, 0.02, 0.04].flatMap((gap) => [true, false].flatMap((held) => [15, 30, 60].map((startMin) => Object.freeze({ gap, held, startMin, k: `gap${gap * 100}%_${held ? 'held' : 'any'}_${startMin === 15 ? '0945' : startMin === 30 ? '1000' : '1030'}` })))));
export const H1_BASE = 'gap2%_held_1000';
export const H2_GRID = Object.freeze([0, 0.0025, 0.005].flatMap((thr) => [false, true].map((withR12) => Object.freeze({ thr, withR12, k: `r1>${thr * 100}%${withR12 ? '+r12' : ''}` }))));
export const H2_BASE = 'r1>0%';
