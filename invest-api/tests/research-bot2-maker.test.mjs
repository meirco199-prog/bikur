import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simB2, runB2, pnlOf, stats, VARIANTS, COSTS, SLIP } from '../scripts/research-bot2-maker.mjs';
import { bars15 } from '../scripts/research-amit2-be.mjs';
import { BOT2 } from '../engine/amit2-exec.js';

const path = (rows, t0 = Date.parse('2022-01-01T00:00:00Z')) => { const n = rows.length, m = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n) };
  rows.forEach(([o, h, l, c], i) => { m.t[i] = t0 + i * 60e3; m.o[i] = o; m.h[i] = h; m.l[i] = l; m.c[i] = c; }); return m; };

test('6 גרסאות ייחודיות; base = כניסה ויעד בשוק', () => {
  assert.equal(VARIANTS.length, 6); assert.equal(new Set(VARIANTS.map((v) => v.k)).size, 6);
  const b = VARIANTS[0]; assert.equal(b.k, 'base'); assert.equal(b.em, null); assert.equal(b.tpm, false);
});

test('יעד בשוק: נגיעה מספיקה; יעד ממתין: צריך לעבור ב-0.01%', () => {
  const m = path([[100, 100.5, 99.9, 100.2], [100.2, 101.0, 100.1, 100.9]]);
  const s = { i: 0, sg: 1, ef: 100, sl: 99, tp: 101 };
  assert.equal(simB2(m, { ...s, tpm: false }).why, 'יעד');
  const r = simB2(m, { ...s, tpm: true });
  assert.notEqual(r.why, 'יעד', 'נגיעה בדיוק ביעד לא ממלאת פקודה ממתינה');
  const m2 = path([[100, 100.5, 99.9, 100.2], [100.2, 101.02, 100.1, 100.9]]);
  const r2 = simB2(m2, { ...s, tpm: true });
  assert.equal(r2.why, 'יעד'); assert.equal(r2.maker, true); assert.equal(r2.exit, 101);
});

test('סטופ קודם ליעד באותה דקה (פסימי); בדקת מילוי של כניסה ממתינה — רק סטופ', () => {
  const m = path([[100, 101.5, 98.5, 100]]);
  assert.equal(simB2(m, { i: 0, sg: 1, ef: 100, sl: 99, tp: 101 }).why, 'סטופ');
  const m2 = path([[100, 101.5, 99.5, 100], [100, 100.2, 99.8, 100]]);
  const r = simB2(m2, { i: 0, sg: 1, ef: 100, sl: 99, tp: 101, onlyStopFirst: true });
  assert.notEqual(r.exitI, 0, 'היעד לא נבדק בדקת המילוי');
});

test('הזזה לכניסה +0.06% אחרי 50% מהדרך, ואז סטופ בכניסה', () => {
  const m = path([[100, 100.6, 99.9, 100.55], [100.55, 100.56, 100.0, 100.02]]);
  const r = simB2(m, { i: 0, sg: 1, ef: 100, sl: 99, tp: 101 });
  assert.equal(r.why, 'סטופ בכניסה'); assert.ok(Math.abs(r.exit - 100.06) < 1e-9);
});

test('עמלות: כניסה ויציאה ממתינות = ממתינה × 2, בלי החלקה', () => {
  const x = { sg: 1, qty: 1000, entry: 100, entryMaker: true, exit: 100, exitMaker: true };
  assert.ok(Math.abs(pnlOf(x, COSTS.actual) + 1000 * 100 * 0.0201 * 2 / 100) < 1e-6);
  const y = { ...x, entryMaker: false, exitMaker: false };
  assert.ok(pnlOf(y, COSTS.actual) < pnlOf(x, COSTS.actual));
});

test('ריצה סינתטית: כל הגרסאות רצות; כניסה ממתינה — לא יותר עסקאות מאותות; עקביות', () => {
  const n = 40000, t0 = Date.parse('2021-01-01'); let p = 2000, s = 11; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const m = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n) };
  for (let i = 0; i < n; i++){ const o = p, c = o * (1 + (R() - 0.5) * 0.006); m.t[i] = t0 + i * 60e3; m.o[i] = o; m.c[i] = c; m.h[i] = Math.max(o, c) * (1 + R() * 0.002); m.l[i] = Math.min(o, c) * (1 - R() * 0.002); p = c; }
  const b15 = bars15(m);
  const base = runB2(m, b15, VARIANTS[0]), em5 = runB2(m, b15, VARIANTS[2]);
  assert.ok(base.trades.length > 10);
  assert.equal(base.missed.length, 0);
  assert.equal(em5.trades.length + em5.missed.length, em5.signals);
  assert.ok(em5.trades.every((x) => x.entryMaker));
  assert.ok(Number.isFinite(stats(base.trades, COSTS.actual).mean));
  assert.equal(SLIP, 0.01); assert.equal(BOT2.bePct, 0.06);
});
