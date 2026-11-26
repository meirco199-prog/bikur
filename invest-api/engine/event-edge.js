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

// ---------- v1.2 ----------
// שעת הדוח ממחזור: hours = [{t, v}] נרות שעה (כולל מוקדם ומאוחר) עד סוף D; dayKey(t), minuteOfDay(t) מבחוץ.
// מחזיר 'amc' (אחרי הסגירה → התגובה ב-D+1), 'bmo' (לפני הפתיחה → D) או null (לא חד-משמעי)
export function timingFromVolume(hours, D, dayKey, minuteOfDay){
  const win = new Map(); // key → {pre, post}
  for (const b of hours){ const k = dayKey(b.t), m = minuteOfDay(b.t); const w = win.get(k) || { pre: 0, post: 0 };
    if (m >= 240 && m < 570) w.pre += b.v; else if (m >= 960 && m < 1200) w.post += b.v; win.set(k, w); }
  const d = win.get(D); if (!d) return null;
  const prior = [...win.keys()].filter((k) => k < D).sort((a, b) => b - a).slice(0, 20).map((k) => win.get(k));
  if (prior.length < 10) return null;
  const avg = (f) => prior.reduce((a, w) => a + w[f], 0) / prior.length;
  const pre = d.pre / Math.max(1, avg('pre')), post = d.post / Math.max(1, avg('post'));
  if (Math.max(pre, post) < 3) return null;
  return post >= pre ? 'amc' : 'bmo';
}
// קבוצה לפי נזילות: inSP500 (bool), medDollarVol20, price
export function groupOf(inSP500, dv, price){
  if (!(price >= 5)) return null;
  if (inSP500) return 'G500';
  if (dv >= 20e6) return 'GMID';
  if (dv >= 5e6) return 'GSMALL';
  return null;
}
export const GROUP_COST = Object.freeze({ G500: { hs: 1.5, borrow: 0 }, GMID: { hs: 4, borrow: 0.0005 }, GSMALL: { hs: 10, borrow: 0.001, shortMinPx: 10 } });
// עלות לצד בנקודות בסיס לפי נזילות ב-30 הדקות שלפני הביצוע: m = {h,l,c,v} מערכים, i = אינדקס הביצוע
export function sideBps(m, i, group, sh){
  let rs = [], vs = 0, n = 0; for (let k = Math.max(0, i - 30); k < i; k++){ rs.push((m.h[k] - m.l[k]) / m.c[k] * 1e4); vs += m.v[k]; n++; }
  rs.sort((a, b) => a - b); const med = rs.length ? rs[Math.floor(rs.length / 2)] : 10, avgV = n ? vs / n : 1;
  return Math.max(GROUP_COST[group].hs, 0.1 * med) + 2 + 10 * Math.sqrt(sh / Math.max(1, avgV));
}
// עסקה עם עלויות משתנות ושורט עם עלות השאלה. מחזיר {gross, net, net2, sh}
export function tradePnl2(m, iE, iX, side, notional, group){
  const entry = m.o[iE], exit = m.o[iX], sh = Math.floor(notional / entry); if (sh < 1) return null;
  const gross = side * sh * (exit - entry);
  const be = sideBps(m, iE, group, sh), bx = sideBps(m, iX, group, sh);
  const slip = (be * entry + bx * exit) / 1e4 * sh, borrow = side < 0 ? GROUP_COST[group].borrow * sh * entry : 0;
  const com = commission(sh, entry) + commission(sh, exit);
  return { gross, net: gross - slip - com - borrow, net2: gross - 2 * slip - com - borrow, sh };
}
// H1 לפי v1.2: אותו כלל כמו h1Trade, מחזיר גם אינדקסים לחישוב עלות
export function h1Trade2(ev, v){
  const t = h1Trade(ev, v); if (!t) return null;
  const e = entryAt(ev.m, ev.open + v.startMin * 60), x = entryAt(ev.m, ev.close - 300);
  return { ...t, iE: e.i, iX: x.i };
}
