// מסגרת הניסויים (engine/research.js): צבירה, רצועות, ביצוע מציאותי של פקודות (תור, PostOnly, מילוי חלקי), עלויות מלאות,
// סטופ לפני יעד, Funding, סטטיסטיקה עם טווח ביטחון, ספים סיבתיים, בחירת מסננים ופסיקה.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggregate, rollingBands, execute, stats, trailingDailyThreshold, greedyFilters, verdict, score, prepare, signals, BASES, COST } from '../engine/research.js';
import { bands } from '../engine/amit-rules.js';

const T0 = Date.parse('2026-03-02T00:00:00Z'), M = 60e3;
const bar = (i, o, h, l, c, v = 1e9) => ({ t: T0 + i * M, o, h, l, c, v });
const flat = (n, x = 100, from = 0) => Array.from({ length: n }, (_, k) => bar(from + k, x, x * 1.0001, x * 0.9999, x));
const ctxOf = (m1) => ({ m1, t1: Float64Array.from(m1, (b) => b.t) });
const limitLong = (extra = {}) => ({ t: T0, validMs: 5 * M, holdMs: 60 * M, be: false, feat: { long: {}, short: {} },
  legs: [{ side: 1, type: 'limit', price: 100, stop: () => 99.5, target: () => 101, minRR: 0, tpMaker: true }], ...extra });
const N400 = 400 / 0.005; // סיכון 400$, סטופ 0.5% → 80,000$

test('aggregate: נרות חלקיים (לפחות חצי) נשמרים, מחזור מצטבר; 1m מקבל end', () => {
  const m = [bar(0, 10, 11, 9, 10.5, 1), bar(1, 10.5, 12, 10, 11, 2), bar(2, 11, 11.5, 8, 9, 3), bar(5, 9, 10, 8.5, 9.5, 4)];
  const a = aggregate(m, '5m');
  assert.equal(a.length, 1); assert.deepEqual(a[0], { t: T0, end: T0 + 5 * M, o: 10, h: 12, l: 8, c: 9, v: 6 }); // הקבוצה השנייה (דקה אחת) נזרקת
  assert.equal(aggregate(m, '1m')[0].end, T0 + M);
});

test('rollingBands = amit-rules.bands על אותן 20 סגירות', () => {
  const m = Array.from({ length: 30 }, (_, i) => bar(i, 0, 0, 0, 100 + Math.sin(i) * 2));
  const bb = rollingBands(m), ref = bands(m.slice(10, 30).map((x) => x.c));
  assert.ok(Math.abs(bb.lo[29] - ref.lo) < 1e-9 && Math.abs(bb.up[29] - ref.up) < 1e-9 && Number.isNaN(bb.mid[18]));
});

test('פקודה ממתינה: נגיעה בדיוק = אין מילוי (תור); חציה ב-1bp+ = מילוי, יעד ממתין בלי מרווח/החלקה', () => {
  const touch = [bar(0, 100.2, 100.3, 100.0, 100.1), ...flat(10, 100.1, 1)];
  assert.equal(execute(ctxOf(touch), [limitLong()], { coin: 'BTC' }).length, 0);
  const m = [bar(0, 100.2, 100.3, 99.98, 100.1), bar(1, 100.1, 101.03, 100.05, 101), ...flat(5, 101, 2)];
  const [t] = execute(ctxOf(m), [limitLong()], { coin: 'BTC' });
  assert.equal(t.why, 'יעד'); assert.equal(t.entry, 100); assert.equal(t.exit, 101);
  assert.ok(Math.abs(t.notional - N400) < 1e-6 && Math.abs(t.gross - 800) < 1e-6);
  assert.ok(Math.abs(t.fees - (N400 * 2e-4 + N400 * 1.01 * 2e-4)) < 1e-6);
  assert.equal(t.spread, 0); assert.equal(t.slip, 0);
  assert.ok(Math.abs(t.net - (t.gross - t.fees - t.funding)) < 1e-9 && t.funding > 0);
});

test('PostOnly: אם המחיר כבר מתחת לרצועה כשהפקודה מונחת — נדחית', () => {
  const m = [bar(0, 99.9, 100.1, 99.5, 99.8), ...flat(10, 99.8, 1)];
  assert.equal(execute(ctxOf(m), [limitLong()], { coin: 'BTC' }).length, 0);
});

test('מילוי חלקי: לכל היותר 10% ממחזור הדקה; פחות מ-25% מהגודל = נשארים בתור', () => {
  const mk = (v) => [bar(0, 100.2, 100.3, 99.9, 100, v), bar(1, 100, 101.1, 99.95, 101, 1e9), ...flat(3, 101, 2)];
  const [t] = execute(ctxOf(mk(400000)), [limitLong()], { coin: 'BTC' });
  assert.ok(Math.abs(t.frac - 0.5) < 1e-9 && Math.abs(t.notional - N400 / 2) < 1e-6 && Math.abs(t.risk - 200) < 1e-6);
  assert.equal(execute(ctxOf(mk(100000)), [limitLong({ validMs: M })], { coin: 'BTC' }).length, 0);
});

test('כניסה בשוק + סטופ: עמלה מיידית בשני הצדדים, חצי מרווח והחלקה לכל צד; פער פותח מתחת לסטופ → מחיר הפתיחה', () => {
  const sig = { t: T0, validMs: 0, holdMs: 60 * M, be: false, feat: { long: {}, short: {} },
    legs: [{ side: 1, type: 'market', stop: (s, e) => e * 0.99, target: (s, e) => e * 1.02, minRR: 0, tpMaker: true }] };
  const [t] = execute(ctxOf([bar(0, 100, 100.2, 99.8, 100), bar(1, 98.5, 98.7, 98.2, 98.4), ...flat(3, 98.4, 2)]), [sig], { coin: 'BTC' });
  assert.equal(t.why, 'סטופ'); assert.equal(t.exit, 98.5);
  const N = 400 / 0.01, Nx = N * 0.985;
  assert.ok(Math.abs(t.fees - (N + Nx) * 5.5e-4) < 1e-6);
  assert.ok(Math.abs(t.spread - (N + Nx) * 0.5e-4) < 1e-6 && Math.abs(t.slip - (N + Nx) * 1e-4) < 1e-6);
});

test('סטופ ויעד באותה דקה → סטופ (שמרני); יעד בדקת הכניסה לא נספר', () => {
  const m = [bar(0, 100.2, 101.5, 99.9, 100.5), bar(1, 100.5, 101.2, 99.4, 100), ...flat(3, 100, 2)];
  const [t] = execute(ctxOf(m), [limitLong()], { coin: 'BTC' });
  assert.equal(t.why, 'סטופ'); assert.equal(t.exit, 99.5);
});

test('Funding: ברירת מחדל 1bp ל-8 שעות כעלות; נתונים שעתיים — לונג משלם שיעור חיובי, שורט מקבל', () => {
  const m = [bar(0, 100.2, 100.3, 99.9, 100), ...flat(600, 100, 1)];
  const [t] = execute(ctxOf(m), [limitLong({ holdMs: 8 * 3600e3 })], { coin: 'BTC' });
  assert.equal(t.why, 'זמן'); assert.ok(Math.abs(t.funding - N400 * 1e-4) < 1e-6);
  const f = Array.from({ length: 9 }, (_, h) => ({ t: T0 + h * 3600e3, rate: 0.0001 }));
  const [t2] = execute(ctxOf(m), [limitLong({ holdMs: 8 * 3600e3 })], { coin: 'BTC', funding: f });
  assert.ok(Math.abs(t2.funding - 8 * 0.0001 * N400) < 1e-6);
});

test('stats: נטו, תוחלת ב-R עם טווח, ימים בלי עסקאות, מכפיל עלויות', () => {
  const mk = (d, gross, risk = 100) => ({ coin: 'BTC', tEntry: T0 + d * 86400e3, tExit: T0 + d * 86400e3 + M, gross, fees: 10, spread: 5, slip: 5, funding: 0, risk, rGross: gross / risk });
  const tr = [mk(0, 120), mk(0, -80), mk(2, 60)];
  const s = stats(tr, { from: T0, to: T0 + 4 * 86400e3 });
  assert.equal(s.n, 3); assert.equal(s.net, 40); assert.equal(s.days, 4); assert.equal(s.perDay, 10);
  assert.ok(Math.abs(s.expR - 40 / 300) < 1e-3 && s.ciR[0] < s.expR && s.ciR[1] > s.expR);
  assert.equal(stats(tr, { costMult: 2 }).net, -20);
});

test('סף יומי סיבתי: משתמש רק בימים קודמים (לפחות 10)', () => {
  const times = [], vals = [];
  for (let d = 0; d < 15; d++) for (let k = 0; k < 3; k++){ times.push(T0 + d * 86400e3 + k * 3600e3); vals.push(d < 12 ? 1 : 100); }
  const thr = trailingDailyThreshold(times, vals);
  assert.ok(Number.isNaN(thr(T0 + 5 * 86400e3)));
  assert.equal(thr(T0 + 12 * 86400e3), 1); // היום ה-12 (ערכים 100) לא משפיע על הסף של עצמו
  assert.equal(thr(T0 + 14 * 86400e3), 1);
});

test('greedyFilters: מוסיף מסנן רק אם הוא משפר את הגבול התחתון; score דורש מינימום עסקאות ומטבעות', () => {
  const coins = ['A', 'B', 'C'], tr = [];
  for (let i = 0; i < 300; i++){ const good = i % 2 === 0, g = good ? (i % 6 === 0 ? 40 : 160) : -100; tr.push({ coin: coins[i % 3], tEntry: T0 + i * M, tExit: T0 + i * M + 1, gross: g, fees: 0, spread: 0, slip: 0, funding: 0, risk: 100, rGross: g / 100, feat: { trend: good, atr: i % 3 === 0, vol: true, rvol: false, liq: true, sess: true } }); }
  const g = greedyFilters(tr, { coins });
  assert.ok(g.filters.includes('trend')); assert.ok(g.score > 0);
  assert.equal(score(stats(tr.slice(0, 30), { coins })), null);
});

test('verdict: מסווג את סיבת הכישלון', () => {
  const st = (o) => ({ n: 200, expRGross: 0.1, ciRGross: [0.05, 0.15], expR: 0.05, ciR: [0.01, 0.09], net: 1000, ...o });
  assert.match(verdict({ train: st({ expRGross: -0.1, ciRGross: [-0.2, 0] }) }).why, /אין יתרון גם לפני/);
  assert.match(verdict({ train: st({ expR: -0.1 }) }).why, /העלויות מוחקות/);
  assert.match(verdict({ train: st({ ciR: [-0.01, 0.1] }) }).why, /לא מובהקת/);
  assert.equal(verdict({ train: st(), val: { net: -5 } }).level, 'fail');
  assert.equal(verdict({ train: st(), val: { net: 5 }, wf: { net: 5 } }).level, 'pending');
  assert.equal(verdict({ train: st(), val: { net: 5 }, wf: { net: 5 }, test: st(), cost15: { net: 1 } }).level, 'pass');
  assert.equal(verdict({ train: st(), val: { net: 5 }, wf: { net: 5 }, test: st({ ciR: [-0.1, 0.2] }), cost15: { net: 1 } }).level, 'promising');
});

test('קצה לקצה על הליכה אקראית: כל הבסיסים רצים, מספרים סופיים, אין יתרון ברוטו מובהק לבוט 1', () => {
  let x = 100, seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const m1 = Array.from({ length: 12 * 1440 }, (_, i) => { const o = x; x *= 1 + (rnd() - 0.5) * 0.003; return bar(i, o, Math.max(o, x) * (1 + rnd() * 6e-4), Math.min(o, x) * (1 - rnd() * 6e-4), x, 3e6 * (0.5 + rnd())); });
  const ctx = prepare(m1);
  assert.equal(BASES.length, 72); assert.equal(new Set(BASES.map((b) => b.id)).size, 72);
  for (const b of BASES){ const tr = execute(ctx, signals(ctx, b), { coin: 'SOL' }); for (const t of tr) assert.ok(Number.isFinite(t.net) && t.fees >= 0 && t.risk > 0 && t.tExit > t.tEntry, b.id); }
  const s = stats(execute(ctx, signals(ctx, BASES[0]), { coin: 'SOL' }));
  assert.ok(s.n > 100 && !(s.ciRGross[0] > 0) && s.net < 0);
  assert.equal(COST.takerBps, 5.5);
});

test('כניסה מדורגת: שלבים ממתינים מתמלאים בנפרד, כולם Maker, סיכון לפי מה שהתמלא; יעד לפני מילוי → ביטול', () => {
  const rungs = [{ price: 100, w: 1 / 6 }, { price: 99.6, w: 2 / 6 }, { price: 99.25, w: 3 / 6 }];
  const sig = { t: T0, validMs: 10 * M, holdMs: 60 * M, be: false, feat: { long: {}, short: {} }, legs: [{ side: 1, type: 'ladder', rungs, stopPx: 99, targetPx: 101 }] };
  const m = [bar(0, 100.2, 100.3, 99.98, 100.1), bar(1, 100.1, 100.2, 99.55, 99.7), bar(2, 99.7, 101.05, 99.65, 101), ...flat(3, 101, 3)];
  const [t] = execute(ctxOf(m), [sig], { coin: 'BTC' });
  const d = (p) => (p - 99) / p, Nf = 400 / rungs.reduce((s, r) => s + r.w * d(r.price), 0), n1 = Nf / 6, n2 = Nf / 3;
  assert.match(t.why, /^יעד \(2\/3/); assert.equal(t.fT, 0); assert.equal(t.spread, 0);
  assert.ok(Math.abs(t.notional - (n1 + n2)) < 1e-6 && Math.abs(t.risk - (n1 * d(100) + n2 * d(99.6))) < 1e-6);
  assert.ok(Math.abs(t.gross - (n1 * 0.01 + n2 * (101 - 99.6) / 99.6)) < 1e-6);
  const early = [bar(0, 100.2, 101.2, 100.1, 101), ...flat(5, 101, 1)];
  assert.equal(execute(ctxOf(early), [sig], { coin: 'BTC' }).length, 0);
});

test('מימוש חלקי: חצי ב-1R (Maker), סטופ עובר לכניסה, השאר נסגר שם', () => {
  const sig = { t: T0, validMs: 0, holdMs: 60 * M, be: false, partial: { at: 1, frac: 0.5, runner: 3 }, feat: { long: {}, short: {} },
    legs: [{ side: 1, type: 'market', stop: (s, e) => e * 0.99, target: (s, e) => e * 1.03, minRR: 0, tpMaker: true }] };
  const m = [bar(0, 100, 100.2, 99.8, 100), bar(1, 100, 101.05, 99.9, 101), bar(2, 101, 101.1, 100.0, 100.2), ...flat(3, 100.2, 3)];
  const [t] = execute(ctxOf(m), [sig], { coin: 'BTC' });
  assert.equal(t.why, 'מימוש חלקי + סטופ בכניסה');
  assert.ok(Math.abs(t.gross - (20000 * 0.01 + 20000 * 0.0006)) < 1e-6);
});

test('מגבלת עסקאות ליום + דרגת עמלות + מכפיל איזון', () => {
  const sigs = Array.from({ length: 5 }, (_, k) => ({ t: T0 + k * 10 * M, validMs: 0, holdMs: 5 * M, be: false, maxPerDay: 2, feat: { long: {}, short: {} },
    legs: [{ side: 1, type: 'market', stop: (s, e) => e * 0.99, target: (s, e) => e * 1.05, minRR: 0, tpMaker: true }] }));
  const tr = execute(ctxOf(flat(60)), sigs, { coin: 'BTC' });
  assert.equal(tr.length, 2);
  const x = { coin: 'BTC', tEntry: T0, tExit: T0 + M, gross: 100, fees: 75, fM: 20, fT: 55, spread: 10, slip: 5, funding: 0, risk: 100, rGross: 1 };
  const s = stats([x], { feeTier: { maker: 1.4, taker: 3.5 } });
  assert.ok(Math.abs(s.net - (100 - (14 + 35) - 15)) < 1e-6);
  assert.equal(stats([x]).breakEvenCost, 1.11);
});

test('בסיס 5 דקות + מגמה ארוכת טווח: סטופ נגרר, בלי יעד, Funding קבוע לפני תחילת הנתונים', () => {
  // עלייה הדרגתית ואז ירידה חדה: פריצת ערוץ יומי → לונג, יציאה בסטופ הנגרר
  const m5 = []; let x = 100;
  for (let i = 0; i < 200 * 288; i++){ const day = Math.floor(i / 288); x = day < 150 ? 100 * (1 + 0.004 * Math.max(0, day - 100)) * (1 + 0.002 * Math.sin(i / 7)) : x * 0.9995; m5.push({ t: T0 + i * 5 * M, o: x, h: x * 1.001, l: x * 0.999, c: x, v: 1e8 }); }
  const ctx = prepare(m5, { baseMin: 5 });
  assert.equal(ctx.tf['1m'], undefined); assert.equal(ctx.tf['1d'].bars.length, 200);
  const b = BASES.find((q) => q.id === 'T-donchian-1d-20-long');
  const f = [{ t: T0 + 180 * 86400e3, rate: 0.0001 }];
  const tr = execute(ctx, signals(ctx, b), { coin: 'BTC', funding: f });
  assert.ok(tr.length >= 1); const t = tr[0];
  assert.equal(t.side, 1); assert.equal(t.why, 'סטופ נגרר'); assert.ok(t.gross > 0 && t.tExit > T0 + 150 * 86400e3);
  assert.ok(t.funding > 0, 'לפני 180 יום אין נתוני Funding → עלות קבועה');
});

test('R ביחס לתקציב הסיכון המתוכנן: מילוי חלקי לא מנפח את התוחלת', () => {
  const mk = (v) => [bar(0, 100.2, 100.3, 99.9, 100, v), bar(1, 100, 101.1, 99.95, 101, 1e9), ...flat(3, 101, 2)];
  const [t] = execute(ctxOf(mk(400000)), [limitLong()], { coin: 'BTC' }); // חצי מילוי: סיכון בפועל 200$
  assert.equal(t.budget, 400); assert.ok(Math.abs(t.r - t.net / 400) < 1e-12);
  const s = stats([t]); assert.ok(Math.abs(s.expR - Math.round(t.net / 400 * 1000) / 1000) < 1e-9);
  const [t2] = execute(ctxOf(mk(400000)), [limitLong()], { coin: 'BTC', risk: { riskUsd: 100 } });
  assert.equal(t2.budget, 100);
});
