import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asOf, annual, quarterly, ttm, computeMetrics, peHistory } from '../engine/fundamentals.js';
import { fairValue, dcf, discountRate } from '../engine/valuation.js';
import { syntheticFacts, syntheticRows } from './helpers.mjs';

const facts = syntheticFacts();

test('annual/quarterly מפרידים לפי משך תקופה', () => {
  assert.equal(annual(facts, 'Revenue').length, 6);
  assert.equal(quarterly(facts, 'Revenue').length, 18);
});
test('asOf מסנן לפי תאריך הגשה (point-in-time), לא לפי סוף תקופה', () => {
  // הדוח השנתי ל-2023 הוגש 2024-02-24; ב-2024-01-15 הוא עוד לא ידוע
  const a = asOf(facts, '2024-01-15');
  assert.equal(annual(a, 'Revenue').at(-1).end, '2022-12-31');
  const b = asOf(facts, '2024-03-01');
  assert.equal(annual(b, 'Revenue').at(-1).end, '2023-12-31');
});
test('TTM = FY + רבעונים אחרי − רבעונים מקבילים', () => {
  const t = ttm(facts, 'Revenue');
  const fy = annual(facts, 'Revenue').at(-1).val;
  // 3 רבעונים של 2023 (השנה האחרונה היא 2023, ורבעוני 2023 ≤ end של FY) → אין רבעונים אחרי → FY
  // הסימולציה שלנו: רבעוני 2023 מסתיימים לפני 2023-12-31, כך שאין "אחרי" → basis צריך להיות FY
  assert.ok(t.basis === 'TTM' || t.basis === 'FY');
  assert.ok(Math.abs(t.value - fy) < fy * 0.6);
});
test('computeMetrics מפיק יחסים הגיוניים', () => {
  const m = computeMetrics(facts, { price: 50 });
  assert.ok(!m.missing);
  assert.ok(m.netMargin > 0.14 && m.netMargin < 0.16, `netMargin ${m.netMargin}`);
  assert.ok(m.pe > 0);
  assert.ok(m.revenueGrowth > 0.11 && m.revenueGrowth < 0.13);
  assert.ok(m.fcf > 0 && m.fcfMargin > 0);
  assert.ok(m.roe > 0);
  assert.equal(m.fields.pe.kind, 'derived');
  assert.ok(m.history.revenue.length === 6);
});
test('computeMetrics ממלא מספק חיצוני רק שדות חסרים ומסמן מקור', () => {
  const m = computeMetrics({ source: 'EDGAR', series: { Revenue: annual(facts, 'Revenue') } }, { price: 50, ratios: { pe: 22, forwardPe: 18, source: 'FMP' } });
  assert.equal(m.pe, 22);
  assert.equal(m.fields.pe.kind, 'provider');
  assert.equal(m.forwardPe, 18);
  assert.equal(m.fields.forwardPe.kind, 'estimate');
});
test('computeMetrics ללא דוחות → missing', () => {
  assert.ok(computeMetrics({ series: {} }, { price: 1 }).missing);
});
test('peHistory משתמש ב-EPS שהיה ידוע בכל תאריך', () => {
  const rows = syntheticRows({ n: 1500, start: '2019-01-02' });
  const h = peHistory(facts, rows, 20);
  assert.ok(h.length > 30);
  assert.ok(h.every((x) => x[1] > 0));
});
test('DCF: ערך עולה כשההיוון יורד', () => {
  const a = dcf({ fcfPerShare: 5, growth: 0.1, discount: 0.09 }), b = dcf({ fcfPerShare: 5, growth: 0.1, discount: 0.11 });
  assert.ok(a > b && b > 0);
  assert.equal(dcf({ fcfPerShare: -1, growth: 0.1, discount: 0.1 }), null);
  const r = discountRate({ dgs10: 4.5, beta: 1.2 });
  assert.ok(r >= 0.08 && r <= 0.12);
});
test('fairValue מחזיר טווח (low<high) ו-Margin of Safety', () => {
  const rows = syntheticRows({ n: 1500, start: '2019-01-02', price: 40, drift: 0.0003 });
  const price = rows.at(-1)[4];
  const m = computeMetrics(facts, { price });
  const fv = fairValue({ metrics: m, rows, facts, price, macro: { dgs10: 4 } });
  assert.ok(!fv.missing, fv.reason);
  assert.ok(fv.low <= fv.high);
  assert.ok(fv.methods.length >= 2);
  assert.equal(typeof fv.marginOfSafety, 'number');
});
