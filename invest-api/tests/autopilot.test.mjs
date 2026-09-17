import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideOrders, AUTO_RULES } from '../engine/autopilot.js';

const row = (symbol, signal, score, extra = {}) => ({ symbol, signal, score, price: 100, currency: 'USD', type: 'stock', sector: 'Technology', riskLevel: 'בינוני', vol1y: 0.3, components: { fundamental: 80, valuation: 75, technical: 72 }, ...extra });
const perf = (cash, positions = []) => ({ cashIls: cash, valueIls: positions.reduce((s, p) => s + p.valueIls, 0), totalIls: cash + positions.reduce((s, p) => s + p.valueIls, 0), positions });
const bull = { trend: 'Bull Trend', risk: 'Risk On' };

test('אוטומט: קונה בשלבים לפי סיגנל וציון, עם מכסה יומית ורזרבת מזומן', () => {
  const table = [row('AAA', 'STRONG BUY', 80), row('BBB', 'BUY', 70), row('CCC', 'BUY', 66), row('DDD', 'BUY', 65), row('EEE', 'WATCH', 72)];
  const d = decideOrders({ table, regime: bull, perf: perf(200000), fx: 3.7, today: '2026-09-17' });
  assert.equal(d.orders.length, AUTO_RULES.maxBuysPerRun);
  assert.deepEqual(d.orders.map((o) => o.symbol), ['AAA', 'BBB', 'CCC']);
  for (const o of d.orders){ assert.equal(o.side, 'buy'); assert.ok(o.qty >= 1); assert.ok(o.estIls <= 200000 * 0.10 / 3 + 1, 'שלב = עד שליש מהיעד'); assert.match(o.reason, /שלב ראשון/); }
  assert.ok(d.skipped.find((s) => s.symbol === 'DDD' && /מכסת/.test(s.reason)));
  assert.ok(!d.orders.find((o) => o.symbol === 'EEE'));
});

test('אוטומט: שוק דובי — אין קניות, עצירת הפסד הדוקה', () => {
  const table = [row('AAA', 'STRONG BUY', 80), row('HLD', 'HOLD', 55)];
  const pos = [{ symbol: 'HLD', qty: 10, valueIls: 3300, costIls: 3700, pnlPct: -0.09 }];
  const d = decideOrders({ table, regime: { trend: 'Bear Trend', risk: 'Risk On' }, perf: perf(150000, pos), fx: 3.7 });
  assert.ok(!d.orders.some((o) => o.side === 'buy'));
  assert.ok(d.orders.find((o) => o.symbol === 'HLD' && o.rule === 'stop' && o.qty === 10));
  assert.ok(d.notes.some((n) => /דובי/.test(n)));
});

test('אוטומט: מכירה לפי סיגנל, הקטנה לחצי, עצירת הפסד 12%', () => {
  const table = [row('S', 'SELL', 30), row('R', 'REDUCE', 45), row('L', 'HOLD', 55), row('K', 'BUY', 68)];
  const pos = [
    { symbol: 'S', qty: 7, valueIls: 2000, pnlPct: 0.05 },
    { symbol: 'R', qty: 9, valueIls: 2000, pnlPct: 0.1 },
    { symbol: 'L', qty: 4, valueIls: 2000, pnlPct: -0.13 },
    { symbol: 'K', qty: 3, valueIls: 2000, pnlPct: 0.02 },
  ];
  const d = decideOrders({ table, regime: bull, perf: perf(100000, pos), fx: 3.7 });
  const sells = d.orders.filter((o) => o.side === 'sell');
  assert.deepEqual(sells.map((o) => [o.symbol, o.qty, o.rule]), [['S', 7, 'signal'], ['R', 5, 'reduce'], ['L', 4, 'stop']]);
  assert.ok(d.orders.find((o) => o.symbol === 'K' && o.side === 'buy' && o.rule === 'add'), 'ממשיך לבנות פוזיציה עם סיגנל קנייה');
});

test('אוטומט: לא קונה לפני דוח, לא חורג מיעד, לא קונה בלי מזומן', () => {
  const table = [row('E', 'STRONG BUY', 85, { nextEarnings: '2026-09-19' }), row('F', 'STRONG BUY', 84)];
  const d = decideOrders({ table, regime: bull, perf: perf(200000, [{ symbol: 'F', qty: 50, valueIls: 21000, pnlPct: 0 }]), fx: 3.7, today: '2026-09-17' });
  assert.ok(d.skipped.find((s) => s.symbol === 'E' && /דוח/.test(s.reason)));
  assert.ok(d.skipped.find((s) => s.symbol === 'F' && /יעד/.test(s.reason)));
  const d2 = decideOrders({ table: [row('F', 'STRONG BUY', 84)], regime: bull, perf: perf(9000, [{ symbol: 'X', qty: 1, valueIls: 191000, pnlPct: 0 }]), fx: 3.7 });
  assert.equal(d2.orders.length, 0); assert.ok(d2.skipped.find((s) => /מזומן/.test(s.reason)));
});

test('אוטומט: Risk Off — רק קנייה חזקה ובחצי גודל', () => {
  const table = [row('A', 'STRONG BUY', 80), row('B', 'BUY', 75)];
  const d = decideOrders({ table, regime: { trend: 'Bull Trend', risk: 'Risk Off' }, perf: perf(200000), fx: 3.7 });
  assert.deepEqual(d.orders.map((o) => o.symbol), ['A']);
  assert.ok(d.orders[0].estIls <= 200000 * 0.10 * 0.5 / 3 + 1, 'שלב = שליש מיעד מוקטן');
});
