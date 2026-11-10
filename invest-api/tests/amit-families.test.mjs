// בדיקות: משפחות ההשוואה (engine/amit-families.js), הגרסה ה"מזוקקת" (engine/amit-refined.js), ומבחני look-ahead לכל המודולים
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, triggers, CANON, RISK_USD } from '../engine/amit-course.js';
import { extend, signals as refinedSignals, execute as refinedExec, rsi } from '../engine/amit-refined.js';
import { invert, sweepReclaim, retest, baseline, run, portfolio, blockBootstrap, mcDrawdown } from '../engine/amit-families.js';

const T0 = Date.UTC(2024, 0, 1);
function walk(n, seed = 3){
  let s = seed, p = 100; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const m = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
  for (let i = 0; i < n; i++){ const o = p; p *= 1 + (r() - 0.5) * 0.004; m.t[i] = T0 + i * 60e3; m.o[i] = o; m.c[i] = p; m.h[i] = Math.max(o, p) * (1 + r() * 0.0015); m.l[i] = Math.min(o, p) * (1 - r() * 0.0015); m.v[i] = 1000 * (r() < 0.02 ? 8 : 1) * (0.5 + r()); }
  return m;
}
const cut = (m, n) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.slice(0, n)]));
const ctxOf = (m) => extend(prepare(m));

test('look-ahead: אותות עד זמן T זהים עם נתונים שנחתכו ב-T ובלי חיתוך (כל המשפחות)', () => {
  const full = walk(20 * 1440), N = 12 * 1440, part = cut(full, N), Tcut = full.t[N - 1] - 3600e3;
  const A = ctxOf(full), B = ctxOf(part);
  const fams = {
    course: (c) => triggers(c, 'follow', CANON),
    refined: (c) => refinedSignals(c, 'follow', { need: { level: false, rsi: false } }),
    sweep: (c) => sweepReclaim(c, 'follow', 'none'),
    retest: (c) => retest(c, 'follow', 1),
    emaX: (c) => baseline(c, 'follow', 'emaX'), brk: (c) => baseline(c, 'follow', 'brk'), mr: (c) => baseline(c, 'follow', 'mr'),
  };
  for (const [name, f] of Object.entries(fams)){
    const a = f(A).filter((x) => x.t < Tcut).map((x) => x.t), b = f(B).filter((x) => x.t < Tcut).map((x) => x.t);
    assert.deepEqual(a, b, name);
  }
  // אינדיקטורים של 15 דק׳ (EMA/VWAP/RSI/EMA200 בטווחים גבוהים) — ערכי העבר לא משתנים כשמוסיפים עתיד
  const jn = B.q.c.length - 8;
  for (const key of ['ema20', 'ema50', 'ema200', 'vwap', 'rsi', 'e200h1', 'e200h4', 'vAvg96']) for (const j of [jn - 500, jn - 50, jn]) {
    const x = A.q[key][j], y = B.q[key][j];
    assert.ok((Number.isNaN(x) && Number.isNaN(y)) || Math.abs(x - y) < 1e-9, `${key}[${j}] ${x} vs ${y}`);
  }
});

test('invert: היפוך פעמיים מחזיר את הסדרה, גבוה↔נמוך מתחלפים', () => {
  const m = walk(500), r = invert(m), rr = invert(r);
  for (const i of [0, 100, 499]){ assert.ok(Math.abs(rr.c[i] - m.c[i]) < 1e-9); assert.ok(r.h[i] >= r.l[i]); assert.ok(Math.abs(r.h[i] - 1 / m.l[i]) < 1e-12); }
});

test('RSI: עליות בלבד → 100, ירידות בלבד → 0', () => {
  const up = Float64Array.from({ length: 40 }, (_, i) => 100 + i), dn = Float64Array.from({ length: 40 }, (_, i) => 100 - i);
  assert.equal(rsi(up)[30], 100); assert.equal(rsi(dn)[30], 0);
});

// מסלול: 3 ימים דשדוש סביב 100, שטיפה ל-98.8 בנר עם ווליום, וחזרה מעל 100
function sweepPath(){
  const p = [];
  for (let i = 0; i < 3 * 1440; i++) p.push(100 + 0.08 * Math.sin(i / 9));
  for (let k = 1; k <= 30; k++) p.push(100 - k * 0.04);         // → 98.8
  for (let k = 1; k <= 45; k++) p.push(98.8 + k * 0.035);        // → 100.4
  for (let k = 0; k < 600; k++) p.push(100.4 + Math.min(4, k * 0.01));
  const n = p.length, m = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
  p.forEach((c, i) => { const o = i ? p[i - 1] : c; m.t[i] = T0 + i * 60e3; m.o[i] = o; m.c[i] = c; m.h[i] = Math.max(o, c) * 1.0002; m.l[i] = Math.min(o, c) * 0.9998; m.v[i] = i >= 3 * 1440 && i < 3 * 1440 + 30 ? 20000 : 1000; });
  return m;
}
test('שטיפה וחזרה: אות אחד, סטופ מתחת לשפל השטיפה; מסנן ווליום עובר, יציאה ב-R2 מרוויחה', () => {
  const ctx = ctxOf(sweepPath()), s = sweepReclaim(ctx, 'follow', 'none');
  assert.equal(s.length, 1); assert.ok(s[0].stop < 98.8 && s[0].stop > 98.5, `stop ${s[0].stop}`);
  assert.equal(sweepReclaim(ctx, 'follow', 'vol').length, 1);
  const [tr] = run(ctx, s, 'R2', { coin: 'SOL' });
  assert.equal(tr.why, 'יעד'); assert.ok(Math.abs(tr.gross - 2 * RISK_USD) < 30, `gross ${tr.gross}`);
  assert.ok(tr.mfe >= 2 && tr.mae <= 0);
});

test('run: סטופ ≈ ‎−1R ברוטו; part: חצי ב-1R והשאר בכניסה', () => {
  const ctx = ctxOf(sweepPath()), s = sweepReclaim(ctx, 'follow', 'none');
  const tight = [{ ...s[0], stop: ctx.m1.o[s[0].i] * 0.995 }];
  const down = invert(sweepPath()), cd = ctxOf(down);           // אותו מסלול הפוך: המחיר יורד אחרי הכניסה
  const fake = [{ ...tight[0], stop: cd.m1.o[tight[0].i] * 0.99 }];
  const [st] = run(cd, fake, 'R2', { coin: 'SOL' });
  assert.equal(st.why, 'סטופ'); assert.ok(Math.abs(st.gross + RISK_USD) < 25, `gross ${st.gross}`);
  const [pt] = run(ctx, tight, 'part', { coin: 'SOL' });
  assert.ok(pt.gross > 0.5 * RISK_USD - 5);
});

test('ריטסט וקווי בסיס רצים בלי שגיאה ומחזירים אותות כרונולוגיים', () => {
  const ctx = ctxOf(walk(10 * 1440));
  for (const s of [retest(ctx, 'follow', 1), baseline(ctx, 'follow', 'emaX'), baseline(ctx, 'follow', 'brk'), baseline(ctx, 'follow', 'mr'), baseline(ctx, 'follow', 'rnd')]){
    for (let i = 1; i < s.length; i++) assert.ok(s[i].t > s[i - 1].t);
    for (const x of s) assert.ok(x.stop > 0);
  }
});

test('הגרסה המזוקקת: כל ארבעת התנאים מצמצמים; ביצוע עם 2 מנות וסטופ 1.9%', () => {
  const ctx = ctxOf(walk(20 * 1440, 11));
  const all = refinedSignals(ctx, 'follow'), none = refinedSignals(ctx, 'follow', { need: { level: false, rsi: false, wick: false } });
  assert.ok(none.length >= all.length);
  const tr = refinedExec(ctx, none.slice(0, 30), { coin: 'SOL' });
  for (const x of tr){ assert.ok(x.fills >= 1 && x.fills <= 2); if (x.why === 'סטופ') assert.ok(x.gross < 0); }
});

test('תיק: +1R ו-‎−1R בסיכון 1% → 1.01 × 0.99; מגבלת פוזיציות פתוחות מדלגת', () => {
  const d = 86400e3, tr = [{ tEntry: T0, tExit: T0 + 3600e3, R: 1 }, { tEntry: T0 + 2 * d, tExit: T0 + 2 * d + 3600e3, R: -1 }];
  const p = portfolio(tr, { riskPct: 1, maxOpen: 3 });
  assert.ok(Math.abs(p.final - 1.01 * 0.99) < 1e-9, `${p.final}`); assert.equal(p.taken, 2);
  const over = [0, 1, 2, 3].map((k) => ({ tEntry: T0 + k * 60e3, tExit: T0 + d, R: 1 }));
  assert.equal(portfolio(over, { maxOpen: 3 }).skipped, 1);
});

test('Bootstrap ו-Monte Carlo: טווחים מסודרים', () => {
  const rets = Array.from({ length: 400 }, (_, i) => (i % 7 === 0 ? -0.01 : 0.002));
  const b = blockBootstrap(rets); assert.ok(b.lo <= b.mid && b.mid <= b.hi);
  const m = mcDrawdown(Array.from({ length: 200 }, (_, i) => (i % 3 ? 0.5 : -1))); assert.ok(m.p5 <= m.p50 && m.p50 <= m.p95);
});
