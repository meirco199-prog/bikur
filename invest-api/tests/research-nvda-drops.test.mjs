// מחקר "כשאנבידיה צונחת — מי עולה" (scripts/research-nvda-drops.mjs): ימי צניחה לפי סוג, תשואת עסקה, סטטיסטיקה והכרעה
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crashDays, tradeRet, stat, measure, passes, COST } from '../scripts/research-nvda-drops.mjs';

test('ימי צניחה: סף, ו"רק של אנבידיה" מול "יחד עם השוק"', () => {
  const nv = { C: [100, 94, 94, 90, 91] }, spy = { C: [100, 99.5, 99.5, 98, 98] };
  assert.deepEqual(crashDays(nv, spy, 5, 1, 0.05, 'any'), [1]);           // −6% ביום 1; יום 3 רק −4.3%
  assert.deepEqual(crashDays(nv, spy, 5, 1, 0.04, 'any'), [1, 3]);
  assert.deepEqual(crashDays(nv, spy, 5, 1, 0.04, 'own'), [1]);           // ביום 3 השוק ירד 1.5%
  assert.deepEqual(crashDays(nv, spy, 5, 1, 0.04, 'market'), [3]);
});

test('tradeRet: באותו יום = סגירה לסגירה; אחר כך = פתיחה של מחרת עד סגירה אחרי H ימים', () => {
  const X = { O: [0, 0, 10, 0, 0], C: [10, 11, 12, 13, 15] };
  assert.ok(Math.abs(tradeRet(X, 1, 'same') - 0.1) < 1e-12);
  assert.ok(Math.abs(tradeRet(X, 1, 1) - 0.2) < 1e-12);
  assert.ok(Math.abs(tradeRet(X, 1, 3) - 0.5) < 1e-12);
  assert.ok(Number.isNaN(tradeRet(X, 2, 1)));                             // אין פתיחה ביום 3
});

test('stat ו-measure: עודף מעל השוק, עלות רק בעסקאות שאחרי, חלוקה לפיתוח/מבחן', () => {
  const s = stat([0.01, 0.03, -0.01, NaN]); assert.equal(s.n, 3); assert.ok(Math.abs(s.mean - 0.01) < 1e-12); assert.ok(Math.abs(s.up - 2 / 3) < 1e-12);
  const X = { O: [0, 10, 10, 10, 10], C: [10, 10, 11, 10, 11] }, spy = { O: [0, 10, 10, 10, 10], C: [10, 10, 10, 10, 10] };
  const m = measure(X, spy, [1, 3], 1, 1);
  assert.equal(m.ex.dev.n, 1); assert.equal(m.ex.test.n, 1);
  assert.ok(Math.abs(m.ex.dev.mean - (0.1 - COST)) < 1e-12);             // פתיחה 10 → סגירה 11, מינוס עלות
  const same = measure(X, spy, [2], 'same', 1); assert.ok(Math.abs(same.ex.test.mean - 0.1) < 1e-12); // באותו יום — בלי עלות
});

test('הכרעה: t ≥ 2 וממוצע חיובי בשתי התקופות, ומינימום אירועים', () => {
  const ok = { ex: { dev: { n: 20, mean: 0.01, t: 2.1 }, test: { n: 20, mean: 0.01, t: 2.5 } } };
  assert.equal(passes(ok), true);
  assert.equal(passes({ ex: { ...ok.ex, test: { n: 20, mean: 0.01, t: 1.9 } } }), false);
  assert.equal(passes({ ex: { ...ok.ex, dev: { n: 10, mean: 0.02, t: 3 } } }), false);
});
