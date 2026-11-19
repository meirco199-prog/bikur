import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simTrade, RULES, ruleStats, pairedVsBase, corr, atrBucket, gapBucket, FEE, STOP_SLIP } from '../scripts/research-stop-grid.mjs';

const mk = (rows) => ({ O: Float32Array.from(rows.map((r) => r[0])), H: Float32Array.from(rows.map((r) => r[1])), Lo: Float32Array.from(rows.map((r) => r[2])), C: Float32Array.from(rows.map((r) => r[3])) });
const R = (k) => RULES.find((r) => r.k === k);
const cost = 2 * FEE; // hs = 0

test('54 כללים, מפתחות ייחודיים, 3 קווי בסיס', () => {
  assert.equal(RULES.length, 54);
  assert.equal(new Set(RULES.map((r) => r.k)).size, 54);
  assert.equal(RULES.filter((r) => r.fam === 'base').length, 3);
});

test('יעד ביום הכניסה', () => {
  const X = mk([[100, 103, 99.5, 102]]);
  const r = simTrade(X, 0, R('sym2.5-H20'), 0.02, 0);
  assert.equal(r.why, 'target'); assert.ok(Math.abs(r.r - (0.025 - cost)) < 1e-6);
});

test('גם וגם באותו יום: פסימי = סטופ, אופטימי = יעד', () => {
  const X = mk([[100, 103, 97, 100]]);
  assert.equal(simTrade(X, 0, R('sym2.5-H1'), 0.02, 0, true).why, 'stop');
  assert.equal(simTrade(X, 0, R('sym2.5-H1'), 0.02, 0, false).why, 'target');
  const p = simTrade(X, 0, R('sym2.5-H1'), 0.02, 0, true);
  assert.ok(Math.abs(p.r - (-0.025 - cost - STOP_SLIP)) < 1e-6);
});

test('קפיצה מתחת לסטופ ביום הבא — יציאה במחיר הפתיחה', () => {
  const X = mk([[100, 101, 99, 100], [95, 96, 94, 95]]);
  const r = simTrade(X, 0, R('sym2.5-H20'), 0.02, 0);
  assert.equal(r.why, 'stop'); assert.equal(r.gap, true); assert.ok(Math.abs(r.r - (-0.05 - cost - STOP_SLIP)) < 1e-6);
});

test('H=1 — יציאה בסגירה; H=5 — אחרי 5 ימים', () => {
  const rows = [[100, 101, 99, 100.5], [100.5, 101, 100, 100.8], [100.8, 101, 100, 100.9], [100.9, 101.5, 100.5, 101], [101, 101.5, 100.5, 101.2], [101.2, 102, 101, 101.8]];
  const X = mk(rows);
  const a = simTrade(X, 0, R('hold-H1'), 0.02, 0), b = simTrade(X, 0, R('hold-H5'), 0.02, 0);
  assert.equal(a.days, 1); assert.ok(Math.abs(a.r - (0.005 - cost)) < 1e-6);
  assert.equal(b.days, 5); assert.ok(Math.abs(b.r - (0.012 - cost)) < 1e-5);
});

test('ATR: סטופ = יעד = 1×ATR', () => {
  const X = mk([[100, 103.1, 99, 101]]);
  const r = simTrade(X, 0, R('atr1-H1'), 0.03, 0);
  assert.equal(r.why, 'target'); assert.ok(Math.abs(r.r - (0.03 - cost)) < 1e-6);
});

test('סטופ נגרר עולה עם הסגירה ולא יורד', () => {
  // ATR 2%, נגרר 1×ATR: אחרי סגירה 110 — סטופ 107.8; יום אחרי יורד ל-107 → סטופ ב-107.8
  const X = mk([[100, 101, 99.5, 100], [100, 110.5, 100, 110], [109, 109.5, 107, 108]]);
  const r = simTrade(X, 0, R('trail1-H5'), 0.02, 0);
  assert.equal(r.why, 'stop'); assert.ok(Math.abs(r.r - (107.8 / 100 - 1 - cost - STOP_SLIP)) < 1e-5);
});

test('סטופ בלבד: אין יעד', () => {
  const X = mk([[100, 110, 99, 109]]);
  const r = simTrade(X, 0, R('stoponly2.5-H5'), 0.02, 0);
  assert.equal(r.why, 'time'); assert.ok(r.r > 0.08);
});

test('דליים, מתאם, סטטיסטיקה', () => {
  assert.equal(atrBucket(0.01), 0); assert.equal(atrBucket(0.02), 1); assert.equal(atrBucket(0.05), 2);
  assert.equal(gapBucket(-0.02), 0); assert.equal(gapBucket(0), 1); assert.equal(gapBucket(0.02), 2);
  const a = Array.from({ length: 200 }, (_, i) => Math.sin(i)), b = a.map((x) => 2 * x + 1);
  assert.ok(Math.abs(corr(a, b) - 1) < 1e-9);
  const trades = [{ k: 0, res: { x: { p: 0.01, o: 0.01, why: 2, d: 1 }, b: { p: 0, o: 0, why: 0, d: 1 } } }, { k: 1, res: { x: { p: -0.01, o: 0, why: 1, d: 2 }, b: { p: 0, o: 0, why: 0, d: 1 } } }, { k: 2, res: { x: { p: 0.02, o: 0.02, why: 2, d: 1 }, b: { p: 0.01, o: 0.01, why: 0, d: 1 } } }];
  const s = ruleStats(trades, 'x');
  assert.equal(s.n, 3); assert.ok(Math.abs(s.mean - 0.02 / 3) < 1e-12); assert.ok(Math.abs(s.win - 2 / 3) < 1e-12);
  assert.ok(Number.isFinite(pairedVsBase(trades, 'x', 'b').mean));
});
