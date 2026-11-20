import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bands, simTrade, pnl, VARIANTS, COSTS, P, runVariant, randomRun, stats } from '../scripts/research-amit-exact.mjs';
import { bandsAt } from '../scripts/research-amit1-guard.mjs';

const path = (rows) => { const t0 = Date.parse('2022-01-01T00:00:00Z'), n = rows.length; const m = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n) };
  rows.forEach(([o, h, l, c], i) => { m.t[i] = t0 + i * 60e3; m.o[i] = o; m.h[i] = h; m.l[i] = l; m.c[i] = c; }); return m; };
const V = (k) => VARIANTS.find((v) => v.k === k);
const flatB = (n, lo, up) => ({ lo: new Float64Array(n).fill(lo), up: new Float64Array(n).fill(up), mid: new Float64Array(n).fill((lo + up) / 2) });

test('36 גרסאות ייחודיות', () => { assert.equal(VARIANTS.length, 36); assert.equal(new Set(VARIANTS.map((v) => v.k)).size, 36); });

test('רצועות מתגלגלות = bandsAt של בוט 1', () => {
  const c = Float64Array.from({ length: 300 }, (_, i) => 100 + Math.sin(i / 7) * 2 + i * 0.01), B = bands(c);
  for (const i of [20, 50, 299]){ const b = bandsAt(c, i); assert.ok(Math.abs(B.lo[i] - b.lo) < 1e-6 && Math.abs(B.up[i] - b.up) < 1e-6); }
});

test('יעד ברצועה הנגדית — ממתינה', () => {
  const m = path([[100, 100, 99, 99.5], [99.5, 100, 99.4, 99.9], [99.9, 101.3, 99.8, 101.2]]);
  const r = simTrade(m, flatB(3, 99, 101), 0, 1, 99, V('Cx-X1-T30-both'));
  assert.equal(r.why, 'יעד'); assert.equal(r.exitMaker, true); assert.equal(r.exit, 101);
});

test('רדיפה: אחרי 5 דקות ברווח — ממתינה במחיר הסגירה, מתמלאת בדקה הבאה', () => {
  const rows = [[100, 100, 99, 99.2], [99.2, 99.4, 99.1, 99.3], [99.3, 99.4, 99.2, 99.3], [99.3, 99.4, 99.2, 99.3], [99.3, 99.4, 99.2, 99.3], [99.3, 99.5, 99.2, 99.4], [99.4, 99.6, 99.3, 99.45]];
  const r = simTrade(path(rows), flatB(7, 99, 105), 0, 1, 99, V('C5-X1-T30-both'));
  assert.equal(r.why, 'רדיפה'); assert.equal(r.exitMaker, true); assert.equal(r.exit, 99.4); assert.equal(r.exitI, 6);
});

test('סטופ חירום 0.5% — בשוק', () => {
  const m = path([[100, 100, 99, 99.2], [99, 99.1, 98.4, 98.5]]);
  const r = simTrade(m, flatB(2, 99, 105), 0, 1, 99, V('Cx-X0.5-T30-both'));
  assert.equal(r.why, 'חירום'); assert.equal(r.exitMaker, false); assert.ok(Math.abs(r.exit - 99 * 0.995) < 1e-9);
});

test('זמן: אחרי T — רדיפה ממתינה גם בהפסד; אחרי T+15 — שוק', () => {
  const rows = Array.from({ length: 60 }, (_, i) => { const o = 98.9 - i * 0.005, c = o - 0.005; return [o, o, c, c]; }); // יורד לאט: ממתינה במחיר הסגירה לא מתמלאת
  const r = simTrade(path(rows), flatB(60, 98, 110), 0, 1, 99, V('Cx-X2-T30-both'));
  assert.equal(r.why, 'זמן (שוק)'); assert.equal(r.exitI, 45); assert.equal(r.exitMaker, false);
});

test('עמלות עמית: כניסה ויציאה ממתינות = 0.014% × 2', () => {
  const x = { sg: 1, entry: 100, exit: 100, exitMaker: true };
  assert.ok(Math.abs(pnl(x, COSTS.amit) + P.notional * 0.00028) < 1e-6);
});

test('ריצה סינתטית מלאה + אקראי דטרמיניסטי', () => {
  const n = 20000, t0 = Date.parse('2021-01-01'); let p = 30000, s = 7; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const m = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n) };
  for (let i = 0; i < n; i++){ const o = p, c = o * (1 + (R() - 0.5) * 0.004); m.t[i] = t0 + i * 60e3; m.o[i] = o; m.c[i] = c; m.h[i] = Math.max(o, c) * (1 + R() * 0.001); m.l[i] = Math.min(o, c) * (1 - R() * 0.001); p = c; }
  const B = bands(m.c), v = V('C5-X1-T30-both'), tr = runVariant(m, B, v);
  assert.ok(tr.length > 20);
  const a = randomRun(m, B, tr, v, 1), b = randomRun(m, B, tr, v, 1);
  assert.deepEqual(a.map((x) => x.t), b.map((x) => x.t));
  assert.ok(Number.isFinite(stats(tr, COSTS.amit, P.slip).mean));
});
