// בדיקות למחקר "המניות שירדו הכי הרבה ב-3 ימים" (scripts/research-reversal3.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickBasket, dayReturn, grow, accelerating, VARIANTS, START } from '../scripts/research-reversal3.mjs';

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

test('accelerating: ביום השלישי הירידה הכי גדולה', () => {
  assert.equal(accelerating([100, 99, 98, 94]), true);    // −1%, −1%, −4%
  assert.equal(accelerating([100, 95, 94, 93]), false);   // הירידה הגדולה ביום הראשון
  assert.equal(accelerating([100, 101, 102, 101.5]), true);  // עלייה, עלייה, ואז ירידה — היום השלישי הוא הירידה הגדולה
  assert.equal(accelerating([100, 98, 96, 97]), false);       // ביום השלישי עלתה
  assert.equal(accelerating([100, 0, 98, 94]), false);
});

test('momo3: ההכרעה דורשת מעל המדד, t ≥ 2, 60% שנים, ועלויות כפולות', async () => {
  const { verdict, VARIANTS: V, MAIN } = await import('../scripts/research-momo3.mjs');
  const g = { end: 90000, mean: 0.001, t: 2.5, pct: 0.8 }, spy = { end: 80000 }, g2 = { pct: 0.3 };
  assert.equal(verdict(g, spy, g2, 9, 14), true);
  assert.equal(verdict({ ...g, t: 1.9 }, spy, g2, 9, 14), false);
  assert.equal(verdict(g, { end: 95000 }, g2, 9, 14), false);
  assert.equal(verdict(g, spy, g2, 8, 14), false);
  assert.equal(verdict(g, spy, { pct: -0.1 }, 9, 14), false);
  assert.ok(V.some((v) => v.k === MAIN));
});

test('dayReturn: יום בלי סל — מוכרים את הסל של אתמול ומשלמים עלות יציאה', () => {
  const prev = new Map([['A', 0.001], ['B', 0.001]]);
  const d = dayReturn([], prev, 1);
  assert.ok(close(d.r, -0.001)); assert.equal(d.held.size, 0);
  assert.ok(close(dayReturn([], prev, 2).r, -0.002));
  assert.equal(dayReturn([], new Map(), 1).r, 0);                 // אין סל ואין מה למכור — 0
});
