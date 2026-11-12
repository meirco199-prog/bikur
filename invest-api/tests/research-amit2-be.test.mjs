// בדיקות למחקר ההזזה למחיר הכניסה של בוט 2 (scripts/research-amit2-be.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { bars15, simTrade, runVariant, paired, decide, VARIANTS, CURRENT } from '../scripts/research-amit2-be.mjs';
import { BOT2 } from '../engine/amit2-exec.js';

const NOC = { fee: 0, slip: 0 };
// נרות דקה מתוך רשימת [o,h,l,c], החל מ-t0, דקה אחרי דקה
function m1Of(rows, t0 = Date.UTC(2024, 0, 1)){
  const n = rows.length, m = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n) };
  rows.forEach(([o, h, l, c], i) => { m.t[i] = t0 + i * 60e3; m.o[i] = o; m.h[i] = h; m.l[i] = l; m.c[i] = c; });
  return m;
}
const LONG = { side: 'long', entryRef: 100, sl: 99, tp: 102 }; // סיכון 1 → כמות 400 (40,000$)

test('bars15: מקבץ דקות לנרות 15 דקות שלמים, next = הדקה הראשונה אחרי הנר', () => {
  const rows = Array.from({ length: 31 }, (_, i) => [100 + i, 101 + i, 99 + i, 100.5 + i]);
  const b = bars15(m1Of(rows));
  assert.equal(b.length, 2);                       // הנר השלישי (דקה אחת) לא שלם
  assert.deepEqual([b[0].o, b[0].h, b[0].l, b[0].c, b[0].next], [100, 115, 99, 114.5, 15]);
  assert.equal(b[1].next, 30);
});

test('simTrade: סטופ, יעד, וסטופ ויעד באותה דקה → סטופ (פסימי)', () => {
  const stop = simTrade(m1Of([[100, 100.2, 98.9, 99]]), 0, LONG, null, BOT2, NOC);
  assert.equal(stop.why, 'סטופ'); assert.equal(Math.round(stop.pnl), -400);
  const tp = simTrade(m1Of([[100, 102.1, 99.5, 102]]), 0, LONG, null, BOT2, NOC);
  assert.equal(tp.why, 'יעד'); assert.equal(Math.round(tp.pnl), 800);
  const both = simTrade(m1Of([[100, 102.5, 98.5, 101]]), 0, LONG, null, BOT2, NOC);
  assert.equal(both.why, 'סטופ');
});

test('simTrade: הזזה אחרי 50% מהדרך → יציאה בכניסה + bePct; בלי הזזה → סטופ מלא', () => {
  const rows = [[100, 101.1, 99.9, 101.05], [101, 101, 100.0, 100.05], [100, 100, 98.9, 99]];
  const be = simTrade(m1Of(rows), 0, LONG, { at: 0.5, pct: 0.06 }, BOT2, NOC);
  assert.equal(be.why, 'סטופ בכניסה'); assert.equal(be.pnl.toFixed(2), (400 * 0.06).toFixed(2));
  const none = simTrade(m1Of(rows), 0, LONG, null, BOT2, NOC);
  assert.equal(none.why, 'סטופ'); assert.equal(Math.round(none.pnl), -400);
  const late = simTrade(m1Of(rows), 0, LONG, { at: 0.75, pct: 0.06 }, BOT2, NOC); // 1.05 < 0.75 × 2 → לא זז
  assert.equal(late.why, 'סטופ');
});

test('simTrade: עמלות והחלקה נגבות בשני הצדדים; שעתיים → סגירה בזמן', () => {
  const rows = Array.from({ length: 130 }, () => [100, 100.1, 99.9, 100]);
  const r = simTrade(m1Of(rows), 0, LONG, null, BOT2, { fee: 0.055, slip: 0.01 });
  assert.equal(r.why, 'זמן');
  assert.ok(Math.abs(r.fees - 40000 * 2 * 0.00055) < 1);           // ≈ 44$
  assert.ok(r.pnl < -r.fees);                                      // גם ההחלקה הלוך-חזור
});

test('runVariant: פוזיציה אחת בכל רגע; paired משווה רק אותות משותפים; decide מחזירה כל גרסה מול היום', () => {
  const a = [{ t: 1, side: 'long', pnl: 10 }, { t: 2, side: 'short', pnl: 5 }], b = [{ t: 1, side: 'long', pnl: 4 }, { t: 3, side: 'long', pnl: 9 }];
  const p = paired(a, b); assert.equal(p.n, 1); assert.equal(p.mean, 6);
  assert.equal(runVariant(m1Of([[100, 100, 100, 100]]), [], null).length, 0);
  const res = new Map(VARIANTS.map((v) => [v.k, [{ t: Date.UTC(2021, 0, 1), side: 'long', pnl: -1 }, { t: Date.UTC(2025, 0, 1), side: 'long', pnl: -1 }]]));
  const dec = decide(res);
  assert.equal(dec.length, VARIANTS.length - 1); assert.ok(VARIANTS.some((v) => v.k === CURRENT));
  assert.ok(dec.every((x) => !x.better && !x.profitable));
});
