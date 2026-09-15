import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, walkForward, multiPeriod, metrics, forwardReturns, precompute, snapshotAt } from '../engine/backtest.js';
import { technicalSnapshot } from '../engine/indicators.js';
import { syntheticRows, syntheticFacts } from './helpers.mjs';

const rows = syntheticRows({ n: 2000, start: '2016-01-04', drift: 0.0005, vol: 0.013, seed: 11 });

test('simulate trend: מפיק עקומת הון, טריידים ומדדים', () => {
  const r = simulate({ rows, strategy: 'trend' });
  assert.equal(r.equity.length, rows.length);
  assert.ok(r.trades.length > 0);
  assert.ok(r.metrics.cagr !== null && r.metrics.maxDrawdown <= 0);
  assert.ok(r.buyHold.metrics.totalReturn !== null);
  assert.ok(r.note.includes('אינו תחזית'));
});
test('ביצוע ב-Open של היום העוקב, כולל slippage ועמלה', () => {
  const r = simulate({ rows, strategy: 'trend', costs: { commission: 0.001, slippage: 0.0005 } });
  const t = r.trades[0];
  const i = rows.findIndex((x) => x[0] === t.entryDate);
  assert.ok(Math.abs(t.entryPrice - rows[i][1] * 1.0005) < 1e-3, 'fill = open × (1+slippage)');
  // ההחלטה התקבלה ביום הקודם: המחיר ביום i-1 היה מעל SMA200 (תנאי הכניסה)
  const p = precompute(rows);
  assert.ok(rows[i - 1][4] > p.sma200[i - 1]);
});
test('אין look-ahead: שינוי ברים עתידיים לא משנה טריידים קודמים', () => {
  const a = simulate({ rows, strategy: 'momentum' });
  const rows2 = rows.map((r) => r.slice());
  for (let i = 1500; i < rows2.length; i++){ rows2[i][4] *= 0.5; rows2[i][1] *= 0.5; rows2[i][2] *= 0.5; rows2[i][3] *= 0.5; }
  const b = simulate({ rows: rows2, strategy: 'momentum' });
  const cut = rows[1500][0];
  const ta = a.trades.filter((t) => t.entryDate < cut).map((t) => [t.entryDate, t.entryPrice, t.exitDate < cut ? t.exitDate : null]);
  const tb = b.trades.filter((t) => t.entryDate < cut).map((t) => [t.entryDate, t.entryPrice, t.exitDate < cut ? t.exitDate : null]);
  assert.deepEqual(ta, tb);
  for (let i = 0; i < 1499; i++) assert.equal(a.equity[i][1], b.equity[i][1]);
});
test('snapshotAt תואם ל-technicalSnapshot על prefix (אותה סמנטיקה)', () => {
  const p = precompute(rows);
  const i = 900;
  const s = snapshotAt(p, i), t = technicalSnapshot(rows.slice(0, i + 1));
  assert.equal(s.sma.s200, t.sma.s200); assert.equal(s.rsi, t.rsi); assert.equal(s.trendScore, t.trendScore);
  assert.ok(Math.abs(s.momentum.r12m - t.momentum.r12m) < 1e-12);
});
test('signal strategy עם פונדמנטלס point-in-time רץ ומפיק תוצאות', () => {
  const facts = syntheticFacts({ startYear: 2015, years: 9 });
  const r = simulate({ rows, strategy: 'signal', ctx: { facts, profile: { type: 'stock', currency: 'USD' } } });
  assert.equal(r.equity.length, rows.length);
  assert.ok(r.metrics);
});
test('metrics: Buy&Hold של סדרה עולה → CAGR חיובי, Sharpe מוגדר', () => {
  const eq = rows.map((r) => [r[0], r[4]]);
  const m = metrics(eq);
  assert.ok(m.cagr > 0 && m.sharpe !== null && m.volatility > 0 && m.maxDrawdown < 0);
});
test('walkForward: בוחר על IS, מדווח OOS משורשר ויציבות', () => {
  const wf = walkForward({ rows, strategy: 'trend', isYears: 2, oosYears: 1 });
  assert.ok(!wf.error, wf.error);
  assert.ok(wf.windows.length >= 3);
  assert.ok(wf.oosEquity.length > 200);
  assert.ok(wf.oosMetrics.cagr !== null);
  assert.ok(wf.stability.label);
  for (const w of wf.windows) assert.ok(w.window.oosStart >= w.window.isEnd);
});
test('walkForward: היסטוריה קצרה → שגיאה מפורשת', () => {
  assert.ok(walkForward({ rows: rows.slice(0, 400), strategy: 'trend' }).error);
});
test('multiPeriod: תקופות ללא נתונים מסומנות missing', () => {
  const mp = multiPeriod({ rows, strategy: 'trend' });
  assert.ok(mp.find((p) => p.id === 'gfc').missing);
  assert.ok(!mp.find((p) => p.id === 'covid').missing);
});
test('forwardReturns: 1/3/6/12 חודשים מתאריך', () => {
  const f = forwardReturns(rows, '2018-06-15');
  assert.ok(f.m1 && f.m12 && typeof f.m12.ret === 'number');
  const late = forwardReturns(rows, rows.at(-5)[0]);
  assert.equal(late.m1, null);
});
