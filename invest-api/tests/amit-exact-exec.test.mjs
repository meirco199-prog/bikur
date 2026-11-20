// בוט 1 גרסה 3 — "בדיוק כמו עמית" (engine/amit-exact-exec.js): כניסה, סטופ חירום, יציאה ממתינה רודפת, זמן, עצירה
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOTX, decideExact, bandsNow, exitPrice } from '../engine/amit-exact-exec.js';
import { qtyFor } from '../engine/amit-exec.js';

const NOW = Date.parse('2026-11-20T10:00:30Z');
const flat = (n = 20, x = 61500, a = 150) => Array.from({ length: n }, (_, i) => x + (i % 2 ? a : -a)); // סגירה אחרונה בתוך הרצועות; רוחב ≈ 0.98%
const B = bandsNow(flat());
const pos = (min, entry = 61400, side = 'long') => ({ side, size: '4.390', entry, sinceMs: NOW - min * 60e3 });
const places = (a) => a.filter((x) => x.type === 'place').map((x) => x.order);

test('הגדרות: דמו בלבד, 270K$, לונג בלבד, חירום 2%, רדיפה מדקה 5, 120+15 דק׳, מגבלה יומית מעל הפסד של סטופ חירום אחד', () => {
  assert.equal(BOTX.base, 'https://api-demo.bybit.com');
  assert.equal(BOTX.notional, 270000); assert.deepEqual([...BOTX.sides], ['long']);
  assert.equal(BOTX.emergencyPct, 2); assert.equal(BOTX.chaseFromMin, 5); assert.equal(BOTX.maxMins, 120); assert.equal(BOTX.graceMins, 15);
  assert.ok(BOTX.dailyLossUsd > BOTX.notional * BOTX.emergencyPct / 100, 'המגבלה היומית לא הופכת לסטופ צמוד');
  assert.equal(qtyFor(61463, BOTX), '4.392'); // כמו בסרטון: 4.39 BTC
  assert.equal(qtyFor(40000, BOTX), '5.000'); // תקרה
});

test('שטוח + נר חדש בתוך הרצועות → קנייה אחת בלבד (PostOnly) על הרצועה התחתונה עם סטופ חירום 2% בשוק', () => {
  const a = decideExact({ pos: null, orders: [], closes: flat(), newBar: true, halt: null, nowMs: NOW, barT: 7 });
  const o = places(a);
  assert.equal(o.length, 1);
  assert.equal(o[0].side, 'Buy'); assert.equal(o[0].timeInForce, 'PostOnly'); assert.ok(!o[0].reduceOnly);
  assert.ok(Number(o[0].price) <= B.lo && B.lo - Number(o[0].price) < 0.1);
  assert.ok(Math.abs(Number(o[0].stopLoss) - Number(o[0].price) * 0.98) < 0.06);
  assert.equal(o[0].slOrderType, 'Market'); assert.equal(o[0].tpslMode, 'Full'); assert.equal(o[0].orderLinkId, 'amit-e-buy-7');
});

test('שטוח: רצועות צרות / סגירה מחוץ לרצועות → אין כניסה; בלי נר חדש — לא נוגעים', () => {
  assert.equal(places(decideExact({ pos: null, orders: [], closes: flat(20, 61500, 20), newBar: true, nowMs: NOW, barT: 1 })).length, 0);
  assert.equal(places(decideExact({ pos: null, orders: [], closes: [...flat(19), 62500], newBar: true, nowMs: NOW, barT: 1 })).length, 0);
  assert.deepEqual(decideExact({ pos: null, orders: [{ orderId: 'e', orderLinkId: 'amit-e-buy-1' }], closes: flat(), newBar: false, nowMs: NOW, barT: 1 }), []);
  // יציאה שנשארה אחרי סטופ חירום — מבוטלת; פקודות שאינן של הבוט — לא נוגעים
  assert.deepEqual(decideExact({ pos: null, orders: [{ orderId: 'x', orderLinkId: 'amit-x-1' }, { orderId: 'm', orderLinkId: 'manual' }], closes: flat(), newBar: false, nowMs: NOW, barT: 1 }), [{ type: 'cancel', orderId: 'x' }]);
});

test('מחיר היציאה: לפני דקה 5 — יעד; מדקה 5 ברווח — רדיפה במחיר הסגירה; בהפסד — יעד; אחרי 120 — סגירה גם בהפסד', () => {
  assert.deepEqual(exitPrice(pos(3, 61400), B, 3), { want: B.up, why: 'יעד' });
  assert.deepEqual(exitPrice(pos(6, 61400), B, 6), { want: B.last, why: 'רדיפה' });
  assert.deepEqual(exitPrice(pos(6, 61700), B, 6), { want: B.up, why: 'יעד' });
  assert.deepEqual(exitPrice(pos(121, 61700), B, 121), { want: B.last, why: 'זמן' });
});

test('בעסקה: מבטל כניסה שנשארה; פקודת יציאה PostOnly reduce-only, לא מתחת למחיר המבוקש', () => {
  const orders = [{ orderId: 'e', orderLinkId: 'amit-e-buy-1' }];
  const a = decideExact({ pos: pos(6), orders, closes: flat(), newBar: false, nowMs: NOW, barT: 1, ask: 61000 });
  assert.ok(a.some((x) => x.type === 'cancel' && x.orderId === 'e'));
  const [x] = places(a);
  assert.equal(x.side, 'Sell'); assert.equal(x.reduceOnly, true); assert.equal(x.timeInForce, 'PostOnly'); assert.equal(x.qty, '4.390');
  assert.equal(x.price, B.last.toFixed(1)); assert.ok(x.orderLinkId.startsWith('amit-x-'));
  const [y] = places(decideExact({ pos: pos(6), orders: [], closes: flat(), newBar: false, nowMs: NOW, barT: 1, ask: 61655.3 }));
  assert.equal(y.price, '61655.3', 'המחיר עלה מעל הסגירה — ממתינה במחיר המבוקש');
});

test('בעסקה: פקודת יציאה קיימת באותו מחיר — לא מחליפים; באמצע נר — לא נוגעים; בנר חדש במחיר אחר — מחליפים', () => {
  const px = B.last.toFixed(1), ex = [{ orderId: 'x', orderLinkId: 'amit-x-1', price: px, qty: '4.390' }];
  assert.deepEqual(decideExact({ pos: pos(6), orders: ex, closes: flat(), newBar: true, nowMs: NOW, barT: 2, ask: 1 }), []);
  assert.deepEqual(decideExact({ pos: pos(3), orders: ex, closes: flat(), newBar: false, nowMs: NOW, barT: 2, ask: 1 }), []);
  const a = decideExact({ pos: pos(3), orders: ex, closes: flat(), newBar: true, nowMs: NOW, barT: 2, ask: 1 });
  assert.deepEqual(a.map((x) => x.type), ['cancel', 'place']);
  assert.equal(places(a)[0].price, (Math.ceil(B.up * 10 - 1e-9) / 10).toFixed(1), 'לפני דקה 5 — על הרצועה העליונה');
});

test('זמן: אחרי 135 דקות → ביטול היציאה וסגירה בשוק', () => {
  const a = decideExact({ pos: pos(135), orders: [{ orderId: 'x', orderLinkId: 'amit-x-1' }], closes: flat(), newBar: false, nowMs: NOW, barT: 1 });
  assert.deepEqual(a.map((x) => x.type), ['cancel', 'close']);
});

test('שורט שנשאר מגרסה 2 — מנוהל בכיוון ההפוך (קנייה, לא מעל המחיר המוצע); יעד ישן של גרסה 2 מוחלף', () => {
  const a = decideExact({ pos: pos(2, 61600, 'short'), orders: [{ orderId: 't', orderLinkId: 'amit-tp-1' }], closes: flat(), newBar: true, nowMs: NOW, barT: 3, bid: 62000 });
  assert.ok(a.some((x) => x.type === 'cancel' && x.orderId === 't'));
  const [x] = places(a);
  assert.equal(x.side, 'Buy'); assert.equal(x.price, (Math.floor(B.lo * 10 + 1e-9) / 10).toFixed(1));
});

test('עצירה (מגבלה יומית / STOP) → ביטול הכול + סגירה', () => {
  for (const halt of ['daily', 'stop']){
    const a = decideExact({ pos: pos(10), orders: [{ orderId: 'e', orderLinkId: 'amit-x-1' }], closes: flat(), newBar: true, halt, nowMs: NOW, barT: 1 });
    assert.deepEqual(a.map((x) => x.type), ['cancelAll', 'close']);
  }
});
