// מחקר מסחר יומי (פרוטוקול v1.1) — בדיקות למנוע: ימים ונרות, יציאה שמרנית, עלויות, אותות בלי מבט לעתיד, חשבון בלי מינוף, סטטיסטיקה
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine/daytrading.js';
import { metrics, holm, bh, portfolio } from '../scripts/research-dt-analyze.mjs';

const OPEN = Date.parse('2024-06-03T13:30:00Z') / 1000; // 09:30 ניו יורק (קיץ)
// יום של נרות דקה: path = מערך מחירי סגירה; o = סגירה קודמת; h/l = ±spread
function mkDay(open, path, { start = 100, spread = 0.02, vol = 1000 } = {}){
  const m = { t: [], o: [], h: [], l: [], c: [], v: [] }; let prev = start;
  path.forEach((c, i) => { m.t.push(open + i * 60); m.o.push(prev); m.h.push(Math.max(prev, c) + spread); m.l.push(Math.min(prev, c) - spread); m.c.push(c); m.v.push(vol); prev = c; });
  return m;
}
const cat = (...ms) => { const o = { t: [], o: [], h: [], l: [], c: [], v: [] }; for (const m of ms) for (const k of Object.keys(o)) o[k].push(...m[k]); return o; };
const days = (m) => E.splitDays(m, E.nyDayKey, E.nyOpenOf);
const flat = (n, x = 100) => Array(n).fill(x);
const B0 = { stop: 's', tR: 2, be: null, step: false, trailPct: null, trailAtr: null, partial: false, maxMin: null, overnight: false };

test('ימים ונרות: 390 דקות → יום מלא עם 78 נרות 5 דקות; 210 דקות → יום מקוצר שנסגר ב-13:00; זמן ניו יורק נכון בקיץ ובחורף', () => {
  const full = days(mkDay(OPEN, flat(390)))[0];
  assert.equal(full.close - full.open, 6.5 * 3600);
  assert.equal(E.bars5(mkDay(OPEN, flat(390)), full).length, 78);
  const half = days(mkDay(OPEN, flat(210)))[0];
  assert.equal(half.close - half.open, 3.5 * 3600);
  const winter = Date.parse('2024-01-05T14:30:00Z') / 1000;
  assert.equal(E.nyMinuteOfDay(winter), 570); assert.equal(E.nyOpenOf(winter), winter); assert.equal(E.nyDayKey(winter), 20240105);
});

test('יציאה: סטופ ויעד באותו נר → סטופ; יעד מתמלא רק אם עבר בסנט; פער מתחת לסטופ → מחיר הפתיחה', () => {
  // נר 1 עם שיא 110 ושפל 90 — גם הסטופ (95) וגם היעד (110) → סטופ
  const m = mkDay(OPEN, flat(390)); m.h[1] = 111; m.l[1] = 90;
  const d = days(m);
  let r = E.simulateExit(m, d, 0, 0, 100, 95, 1, B0);
  assert.equal(r.kind, 'stop'); assert.deepEqual(r.fills, [[1, 95, 1]]);
  // יעד 110 בדיוק — לא מתמלא; 110.01 — מתמלא במחיר היעד
  const m2 = mkDay(OPEN, flat(390)); m2.h[3] = 110; const d2 = days(m2);
  assert.notEqual(E.simulateExit(m2, d2, 0, 0, 100, 95, 1, B0).kind, 'target');
  m2.h[4] = 110.01; r = E.simulateExit(m2, d2, 0, 0, 100, 95, 1, B0);
  assert.equal(r.kind, 'target'); assert.deepEqual(r.fills, [[1, 110, 0]]);
  // פער: נפתח ב-93 מתחת לסטופ 95 → מילוי ב-93
  const m3 = mkDay(OPEN, flat(390)); m3.o[5] = 93; m3.l[5] = 92.5; const r3 = E.simulateExit(m3, days(m3), 0, 0, 100, 95, 1, B0);
  assert.deepEqual(r3.fills, [[1, 93, 1]]);
});

test('יציאה: סטופ למחיר הכניסה מתעדכן לפי השיא ותקף רק מהנר הבא; מגבלת זמן; סוף יום 5 דקות לפני הסגירה; החזקה ללילה עד סוף היום הבא', () => {
  const m = mkDay(OPEN, flat(390)); m.h[2] = 101.2; m.l[2] = 99.9; m.l[3] = 99.95; // שיא +1.2% ושפל מתחת לכניסה באותו נר
  const d = days(m);
  const r = E.simulateExit(m, d, 0, 0, 100, 95, 1, { ...B0, be: 0.01 });
  assert.equal(r.kind, 'protect'); assert.equal(r.tExit, m.t[3], 'הסטופ למחיר הכניסה פעל רק בנר שאחרי');
  const t30 = E.simulateExit(m, d, 0, 10, 100, 95, 1, { ...B0, be: null, maxMin: 30 });
  assert.equal(t30.kind, 'time'); assert.equal(t30.tExit, m.t[40]);
  const eod = E.simulateExit(m, d, 0, 10, 100, 95, 1, { ...B0, be: null });
  assert.equal(eod.kind, 'eod'); assert.equal(eod.tExit, d[0].close - 300);
  const two = cat(mkDay(OPEN, flat(390)), mkDay(OPEN + 86400, flat(390))), dd = days(two);
  const on = E.simulateExit(two, dd, 0, 10, 100, 95, 1, { ...B0, overnight: true });
  assert.equal(on.tExit, dd[1].close - 300);
});

test('יציאה: מימוש חלקי — חצי ב-1R, השאר עם סטופ במחיר הכניסה; נגרר באחוזים לא יורד מתחת לסטופ ההתחלתי', () => {
  const m = mkDay(OPEN, flat(390)); m.h[2] = 105.1; m.l[4] = 99.9; const d = days(m);
  const r = E.simulateExit(m, d, 0, 0, 100, 95, 1, { ...B0, partial: true });
  assert.deepEqual(r.fills, [[0.5, 105, 0], [0.5, 100, 1]]); assert.equal(r.kind, 'protect');
  const m2 = mkDay(OPEN, flat(390)); m2.l[1] = 96; const r2 = E.simulateExit(m2, days(m2), 0, 0, 100, 95, 1, { ...B0, trailPct: 0.01 });
  assert.equal(r2.kind, 'stop'); assert.ok(Math.abs(r2.fills[0][1] - 100.02 * 0.99) < 1e-9, 'נגרר 1% מתחת לשיא 100.02');
});

test('עלויות: עמלת IBKR (מינימום 0.35$, 0.0035$ למניה, עד 1%); חצי מרווח והחלקה רק בביצוע בשוק; גודל מחקר = min(500$/R, 20,000$)', () => {
  assert.equal(E.commission(50, 100), 0.35); assert.equal(E.commission(1000, 100), 3.5); assert.equal(E.commission(10, 0.5), 0.05);
  const bps = E.fixedBps();
  const lim = E.pnlUsd(100, [[1, 102, 0]], 100, bps), mkt = E.pnlUsd(100, [[1, 102, 1]], 100, bps);
  assert.ok(Math.abs(lim - (100 * (102 - 100 * 1.00035) - 0.7)) < 1e-9);
  assert.ok(mkt < lim);
  assert.equal(E.researchShares(100, 99), 200); assert.equal(E.researchShares(100, 99.9), 200, 'תקרה 20,000$');
  const v = E.varBps(20, 1000, 100); assert.ok(Math.abs(v.entry - (2 + 1 + 10 * Math.sqrt(0.1))) < 1e-9);
});

test('נרמול סטופ: צמוד מ-0.5 ATR → מורחב; רחוק מ-3 ATR → אין עסקה; סטופ לפי כפולת ATR', () => {
  assert.equal(E.normStop(100, 99.9, 1, 's'), 99.5);
  assert.equal(E.normStop(100, 96, 1, 's'), null);
  assert.equal(E.normStop(100, 98, 1, 's'), 98);
  assert.equal(E.normStop(100, 0, 1, 1.5), 98.5);
});

test('אותות בלי מבט לעתיד: האותות עד נר k זהים כשמוסיפים את המשך היום; פריצת טווח הפתיחה ומומנטום בזמן קבוע', () => {
  let x = 100, s = 3; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const path = Array.from({ length: 390 }, (_, i) => (x += (rnd() - 0.48) * 0.15 + (i > 40 && i < 60 ? 0.05 : 0)));
  const m = mkDay(OPEN, path), d = days(m)[0], b5 = E.bars5(m, d);
  const st = E.indState(); for (let i = 0; i < 60; i++) E.indUpdate(st, { h: 100.1, l: 99.9, c: 100 });
  const snap = JSON.parse(JSON.stringify(st)); const ind = b5.map((b) => E.indUpdate(st, b));
  let pv = 0, vv = 0; const vw = b5.map((b) => { pv += b.tpv; vv += b.v; return pv / vv; });
  const rv = b5.map(() => 2.5), dc = { prevClose: 99, atrD: 3, aboveMa20: true };
  const full = E.signals(b5, ind, vw, rv, dc, d.open);
  const cut = 30, st2 = Object.assign(E.indState(), snap);
  const ind2 = b5.slice(0, cut).map((b) => E.indUpdate(st2, b));
  const part = E.signals(b5.slice(0, cut), ind2, vw.slice(0, cut), rv.slice(0, cut), dc, d.open);
  for (const k of E.STRATS){
    if (k === 'breakout_retest' || k === 'reversal') continue; // מוגבלות למופע ראשון/מצב — נבדקות למטה
    assert.deepEqual(part[k], full[k].filter((g) => g.i < cut), k);
  }
  assert.ok(full.orb.length <= 1);
  assert.ok(full.momentum_rvol.every((g) => g.fixedTime));
});

test('חשבון: בלי מינוף (החשיפה לא עוברת את המזומן), עד 5 פוזיציות, ומגבלת "שני הפסדים" עוצרת כניסות באותו יום', () => {
  const mk = (i, key, g) => ({ key, tEntry: 1000 + i, f: { entry: 100, rvol: 1 }, bases: { 0: { stop: 99, g, xm: 100 + g, nOrd: 2, tExit: 5000 + i } } });
  const recs = Array.from({ length: 8 }, (_, i) => mk(i, 20240603, 1));
  const p = portfolio(recs, 0, { riskPct: 0.01, capPct: 0.3 });
  assert.equal(p.taken, 4, '3 × 30% = 90%, הרביעית רק ב-10% שנשארו, החמישית בלי מזומן'); assert.equal(p.rejected, 4);
  const p5 = portfolio(recs, 0, { riskPct: 0.001, capPct: 0.05 });
  assert.equal(p5.taken, 5); assert.equal(p5.rejected, 3);
  const seq = [mk(0, 20240603, -1), mk(10000, 20240603, -1), mk(20000, 20240603, 1)].map((r, i) => ({ ...r, bases: { 0: { ...r.bases[0], tExit: r.tEntry + 10 } } }));
  assert.equal(portfolio(seq, 0, { daily: 'two' }).taken, 2);
});

test('סטטיסטיקה: PF, t, bootstrap לפי ימים, Holm ו-BH', () => {
  const tr = [{ key: 1, pnl: 10 }, { key: 1, pnl: -5 }, { key: 2, pnl: 10 }, { key: 3, pnl: -5 }];
  const m = metrics(tr, { boot: 500 });
  assert.equal(m.n, 4); assert.equal(m.pf, 2); assert.equal(m.win, 0.5); assert.equal(m.days, 3); assert.ok(m.pBoot > 0 && m.pBoot < 1);
  assert.deepEqual(holm([0.01, 0.04, 0.03]).map((x) => +x.toFixed(2)), [0.03, 0.06, 0.06]);
  assert.deepEqual(bh([0.01, 0.04, 0.03]).map((x) => +x.toFixed(2)), [0.03, 0.04, 0.04]);
});
