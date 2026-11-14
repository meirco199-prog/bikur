// Slow Core Momentum (engine/slow-core.js): איזון כל 30 ימים בדיוק, בלי הצצה לעתיד, תקרה 60%, נכס אחד = 50% מזומן, ביצוע מאוחר
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slowCore, isReb30, SLOW_CORE, SC_PASS } from '../engine/slow-core.js';
import { align, runDaily } from '../engine/research-daily.js';

const D0 = Date.UTC(2021, 0, 1), DAY = 86400e3;
const bars = (f, n = 700) => Array.from({ length: n }, (_, i) => { const c = f(i), o = i ? f(i - 1) : c; return { t: D0 + i * DAY, o, h: Math.max(o, c), l: Math.min(o, c), c }; });
const fB = (i) => 100 * (1 + 0.0015 * i) * (1 + 0.2 * Math.sin(i / 70)) * (1 + 0.02 * Math.sin(i * 1.3)), fE = (i) => 50 * (1 + 0.001 * i) * (1 + 0.3 * Math.sin(i / 55 + 1)) * (1 + 0.03 * Math.sin(i * 2.1)), fS = (i) => 20 * (1 + 0.002 * i) * (1 + 0.4 * Math.sin(i / 40 + 2)) * (1 + 0.04 * Math.sin(i * 1.7));
const mkA = (b = fB, e = fE, s = fS) => align({ BTC: bars(b), ETH: bars(e), SOL: bars(s) });
const run = (A, o = {}) => { const s = slowCore(A, o); return runDaily(A, s, { drift: true, rebal: s.rebal, trace: true }).series; };

test('איזון בדיוק כל 30 ימים קלנדריים; בין איזונים המשקלות רק זזים עם המחיר (אין מסחר)', () => {
  const A = mkA(), sr = run(A), reb = sr.filter((x) => x.reb).map((x) => x.t);
  for (let i = 1; i < reb.length; i++) assert.equal((reb[i] - reb[i - 1]) / DAY, 30);
  for (const t of reb) assert.ok(isReb30(t - DAY), 'ביצוע ביום שאחרי יום ההחלטה');
  for (const x of sr) if (!x.reb) assert.ok(x.turn < 1e-12, 'אין מסחר בין איזונים');
});

test('בלי הצצה לעתיד: שינוי מחירים אחרי T לא משנה משקלות ותשואות עד T (כולל delay ו-lookback אחר)', () => {
  const T = 500, A1 = mkA(), A2 = mkA((i) => (i <= T ? fB(i) : fB(i) * 3), (i) => (i <= T ? fE(i) : fE(i) * 0.2), (i) => (i <= T ? fS(i) : fS(i) * 5));
  for (const o of [{}, { delay: 1 }, { lookback: 60 }, { lookback: 120 }]){
    const a = run(A1, o), b = run(A2, o), k = a.findIndex((x) => x.t === A1.days[T]);
    assert.deepEqual(a.slice(0, k + 1).map((x) => x.w), b.slice(0, k + 1).map((x) => x.w), JSON.stringify(o));
    assert.deepEqual(a.slice(0, k + 1).map((x) => x.net), b.slice(0, k + 1).map((x) => x.net));
  }
});

test('תקרה 60% כששניים כשירים; אחד כשיר → 50% ו-50% מזומן; אף אחד → מזומן; delay מזיז את הביצוע ביום', () => {
  // BTC עולה חזק ויציב, ETH עולה קצת ורועש, SOL יורד
  const A = mkA((i) => 100 * 1.004 ** i, (i) => 50 * 1.0005 ** i * (1 + 0.05 * Math.sin(i * 1.9)), (i) => 20 * 0.998 ** i);
  const sr = run(A), on = sr.filter((x) => x.reb && x.w.some((y) => y > 0));
  assert.ok(on.length > 3);
  for (const x of on){ const s = x.w.reduce((a, y) => a + y, 0); assert.ok(Math.max(...x.w) <= SLOW_CORE.cap + 1e-12); assert.ok(Math.abs(s - 1) < 1e-12 || Math.abs(s - 0.5) < 1e-12); assert.equal(x.w[2], 0, 'SOL יורד — לא כשיר'); }
  assert.ok(on.some((x) => Math.abs(x.w[0] - 0.6) < 1e-12), 'התקרה נאכפת');
  const A1 = mkA((i) => 100 * 1.003 ** i, (i) => 50 * 0.997 ** i, (i) => 20 * 0.997 ** i), one = run(A1).filter((x) => x.reb && x.w[0] > 0);
  for (const x of one){ assert.ok(Math.abs(x.w[0] - 0.5) < 1e-12); assert.equal(x.w[1] + x.w[2], 0); }
  const A0 = mkA((i) => 100 * 0.997 ** i, (i) => 50 * 0.997 ** i, (i) => 20 * 0.997 ** i); assert.ok(run(A0).every((x) => x.w.every((y) => y === 0)));
  const r0 = run(A).filter((x) => x.reb).map((x) => x.t), r1 = run(A, { delay: 1 }).filter((x) => x.reb).map((x) => x.t);
  assert.deepEqual(r1, r0.map((t) => t + DAY).filter((t) => t <= A.days.at(-1)));
  assert.equal(SC_PASS.turnover, 4);
});
