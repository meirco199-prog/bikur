// בדיקות למנוע "בוט 4" (engine/amit4-open.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { nyOpenUtc, tradeDay, randomDay, grid, lcg, stat, FEES } from '../engine/amit4-open.js';

const NOF = { maker: 0, taker: 0, slip: 0 };
// 25 דקות שקטות לפני הפתיחה (מחיר 100 ± 0.05), ואחריהן הדקות שנותנים
function day(after, open = Date.UTC(2026, 10, 12, 14, 30)){
  const rows = [...Array.from({ length: 25 }, (_, i) => [100, 100.05, 99.95, i % 2 ? 100.05 : 99.95]), ...after];
  const t0 = open - 25 * 60e3, A = (k) => Float64Array.from(rows, (r) => r[k]);
  return { open, bars: { t: Float64Array.from(rows, (_, i) => t0 + i * 60e3), o: A(0), h: A(1), l: A(2), c: A(3) } };
}
const V = { T: 5, d: 0.5, g: 1.5, s: 1, N: 2 };

test('nyOpenUtc: 09:30 בניו יורק — 13:30 UTC בקיץ, 14:30 בחורף', () => {
  assert.equal(new Date(nyOpenUtc('2026-07-15')).toISOString(), '2026-07-15T13:30:00.000Z');
  assert.equal(new Date(nyOpenUtc('2026-11-12')).toISOString(), '2026-11-12T14:30:00.000Z');
});

test('tradeDay: צניחה מתחת לרצועה בפתיחה → קנייה בפקודה ממתינה, יציאה ביעד +1.5%', () => {
  const { bars, open } = day([[100, 100, 98, 98.5], [98.5, 101, 99, 100.8], [100.8, 101, 100.5, 100.7]]); // כניסה ב-99.40 (רצועה 99.9 × 0.995)
  const r = tradeDay(bars, open, V, NOF);
  assert.ok(r); assert.equal(r.why, 'יעד'); assert.ok(Math.abs(r.entry - 99.9 * 0.995) < 1e-9);
  assert.ok(Math.abs(r.r - 0.015) < 1e-9); assert.ok(Math.abs(r.pnl - 35000 * 0.015) < 1e-6);
});

test('tradeDay: סטופ, זמן, ובלי צניחה אין עסקה; העמלות נגבות', () => {
  const stop = tradeDay(day([[100, 100, 98, 98.5], [98.5, 98.6, 96, 96.5]]).bars, day([]).open, V, NOF);
  assert.equal(stop.why, 'סטופ'); assert.ok(Math.abs(stop.r + 0.01) < 1e-9);
  const tm = tradeDay(day([[100, 100, 98, 98.5], [98.5, 99.5, 99, 99.2], [99.2, 99.5, 99, 99.3]]).bars, day([]).open, V, NOF);
  assert.equal(tm.why, 'זמן');
  assert.equal(tradeDay(day([[100, 100.05, 99.95, 100], [100, 100.05, 99.95, 100]]).bars, day([]).open, V, NOF), null);
  const fee = tradeDay(day([[100, 100, 98, 98.5], [98.5, 101, 99, 100.8]]).bars, day([]).open, V, FEES);
  assert.ok(Math.abs(fee.r - (0.015 - 2 * FEES.maker)) < 1e-9);
});

test('randomDay, grid, stat', () => {
  const { bars, open } = day([[100, 100.2, 99.9, 100.1], [100.1, 102, 100, 101.9], [101.9, 102, 101.5, 101.8]]);
  const r = randomDay(bars, open, { ...V, T: 1 }, lcg(1), NOF); assert.equal(r.why, 'יעד');
  const g = grid(); assert.equal(g.length, 108); assert.ok(g.some((v) => v.k === 'T5-d0.5-g1.5-s1-N2'));
  const s = stat([1, 2, 3]); assert.equal(s.mean, 2); assert.equal(s.n, 3);
});
