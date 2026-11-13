// בדיקות למחקר "המניות שירדו הכי הרבה ב-3 ימים" (scripts/research-reversal3.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickBasket, dayReturn, grow, VARIANTS, START } from '../scripts/research-reversal3.mjs';

const close = (a, b) => Math.abs(a - b) < 1e-9;
const C = [{ s: 'A', sig: -0.10, ret: 0.02, c: 0.001 }, { s: 'B', sig: 0.05, ret: -0.01, c: 0.001 }, { s: 'C', sig: -0.20, ret: 0.04, c: 0.001 }, { s: 'D', sig: 0.01, ret: 0, c: 0.001 }];

test('pickBasket: היורדות הכי הרבה / העולות הכי הרבה', () => {
  assert.deepEqual(pickBasket(C, 2, 'down').map((x) => x.s), ['C', 'A']);
  assert.deepEqual(pickBasket(C, 1, 'up').map((x) => x.s), ['B']);
  assert.equal(pickBasket(C, 10).length, 4);
});

test('dayReturn: עלות רק על מה שנכנס ויוצא; מניה שנשארת — בלי עלות', () => {
  const b = pickBasket(C, 2, 'down');
  const d1 = dayReturn(b, new Map());                         // יום ראשון: קונים שתיים
  assert.ok(close(d1.r, 0.03 - 0.001));                       // ממוצע 3% פחות עלות קנייה (0.1%)
  const d2 = dayReturn(b, d1.held);                           // אותו סל — בלי עלות
  assert.ok(close(d2.r, 0.03));
  const d3 = dayReturn([C[1]], d2.held);                       // מוכרים שתיים, קונים אחת
  assert.ok(close(d3.r, -0.01 - 0.001 - 0.001));
  assert.ok(close(dayReturn(b, new Map(), 2).r, 0.03 - 0.002)); // עלויות כפולות
});

test('grow: ריבית דריבית, ירידה מקסימלית', () => {
  const g = grow([0.1, -0.5, 0.2]);
  assert.ok(close(g.end, START * 1.1 * 0.5 * 1.2)); assert.ok(close(g.dd, 0.5)); assert.equal(g.n, 3);
  assert.ok(VARIANTS.some((v) => v.k === 'open-L3-5') && VARIANTS.some((v) => v.k === 'close-L3-5'));
});
