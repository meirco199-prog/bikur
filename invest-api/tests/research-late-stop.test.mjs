import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBot1, runBot2, simLS, pnlOf, rng, randomRun, VARIANTS, SLIP, COSTS, decide, stats } from '../scripts/research-late-stop.mjs';
import { runVariant as guardRun, COST as GCOST } from '../scripts/research-amit1-guard.mjs';
import { runVariant as beRun, bars15, COST as BCOST } from '../scripts/research-amit2-be.mjs';

// נרות דקה סינתטיים (הילוך מקרי עם תנודתיות משתנה), דטרמיניסטי
function synth(n, seed = 7, vol = 0.0012){
  const R = rng(seed), t = new Float64Array(n), o = new Float64Array(n), h = new Float64Array(n), l = new Float64Array(n), c = new Float64Array(n);
  let p = 30000; const t0 = Date.parse('2021-03-01T00:00:00Z');
  for (let i = 0; i < n; i++){
    const s = vol * (0.5 + 1.5 * Math.abs(Math.sin(i / 700)));
    const op = p, cl = op * (1 + (R() - 0.5) * 2 * s), hi = Math.max(op, cl) * (1 + R() * s), lo = Math.min(op, cl) * (1 - R() * s);
    t[i] = t0 + i * 60e3; o[i] = op; h[i] = hi; l[i] = lo; c[i] = cl; p = cl;
  }
  return { t, o, h, l, c, v: new Float64Array(n) };
}
const m1 = synth(60000);
const base = VARIANTS.find((v) => v.k === 'base');

test('בוט 1: גרסת base משחזרת בדיוק את research-amit1-guard (now)', () => {
  const g = guardRun(m1, { k: 'now' }), b = runBot1(m1, base);
  assert.ok(g.length > 50, `מעט עסקאות: ${g.length}`);
  assert.equal(b.length, g.length);
  const C = { maker: GCOST.maker, taker: GCOST.taker };
  for (let i = 0; i < g.length; i++){
    assert.equal(b[i].t, g[i].t);
    assert.ok(Math.abs(pnlOf(b[i], C, GCOST.slip) - g[i].pnl) < 1e-6, `עסקה ${i}: ${pnlOf(b[i], C, GCOST.slip)} מול ${g[i].pnl}`);
  }
});

test('בוט 2: גרסת base משחזרת בדיוק את research-amit2-be (be0.5-0.06)', () => {
  const b15 = bars15(m1), g = beRun(m1, b15, { at: 0.5, pct: 0.06 }), b = runBot2(m1, b15, base);
  assert.ok(g.length > 10, `מעט עסקאות: ${g.length}`);
  assert.equal(b.length, g.length);
  const C = { maker: BCOST.fee, taker: BCOST.fee };
  for (let i = 0; i < g.length; i++) assert.ok(Math.abs(pnlOf(b[i], C, BCOST.slip) - g[i].pnl) < 1e-6, `עסקה ${i}`);
});

// מסלול ידני: כניסה 100, לונג, d = 1%
function path(rows){ const t0 = Date.parse('2022-01-01T00:00:00Z'); const n = rows.length;
  const m = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n) };
  rows.forEach(([o, h, l, c], i) => { m.t[i] = t0 + i * 60e3; m.o[i] = o; m.h[i] = h; m.l[i] = l; m.c[i] = c; }); return m; }
const spec = { i: 0, sg: 1, entry: 100, d: 0.01, qty: 1, entryMaker: false, inMinute: false, tp: 110, tpMaker: false, maxMins: 120, timeByIndex: false, be: null };

test('השהיה: ירידה ל-98.5 בדקה 2 לא עוצרת ב-delay5, ועוצרת ב-base', () => {
  const rows = [[100, 100.2, 99.8, 100], [100, 100, 98.5, 98.7], [98.7, 99.5, 98.6, 99.4], [99.4, 99.8, 99.3, 99.7], [99.7, 99.9, 99.6, 99.8], [99.8, 100, 99.7, 99.9], [99.9, 110.5, 99.9, 110]];
  const m = path(rows);
  assert.equal(simLS(m, spec, base).why, 'סטופ');
  const r = simLS(m, spec, VARIANTS.find((v) => v.k === 'delay5'));
  assert.equal(r.why, 'יעד'); assert.equal(r.exit, 110);
});

test('השהיה: סטופ החירום (×3 = 97) פועל מיד', () => {
  const m = path([[100, 100, 99.9, 100], [100, 100, 96.5, 96.8], [96.8, 97, 96, 96.2]]);
  const r = simLS(m, spec, VARIANTS.find((v) => v.k === 'delay30'));
  assert.equal(r.why, 'סטופ חירום'); assert.equal(r.exit, 97);
});

test('השהיה: ברגע ההפעלה המחיר כבר מתחת לסטופ → יציאה בפתיחה', () => {
  const rows = [[100, 100, 99.9, 100], [100, 100, 98.5, 98.6], [98.6, 98.7, 98.4, 98.5], [98.5, 98.6, 98.3, 98.4], [98.4, 98.5, 98.2, 98.3], [98.3, 98.4, 98.1, 98.2], [98.2, 98.3, 98.0, 98.1]];
  const r = simLS(path(rows), spec, VARIANTS.find((v) => v.k === 'delay5'));
  assert.equal(r.why, 'סטופ'); assert.equal(r.exitI, 5); assert.equal(r.exit, 98.3);
});

test('סגירת נר: נגיעה מתחת לסטופ בתוך הנר לא עוצרת; סגירה מתחת → יציאה בפתיחה הבאה', () => {
  // הכניסה ב-00:00; נר 15 דק׳ נסגר בסוף הדקה 14
  const rows = Array.from({ length: 20 }, (_, i) => (i === 3 ? [100, 100, 98.6, 99.5] : i === 14 ? [99.2, 99.3, 98.7, 98.8] : i === 15 ? [98.9, 99, 98.8, 98.9] : [99.5, 99.7, 99.3, 99.5]));
  const r = simLS(path(rows), spec, VARIANTS.find((v) => v.k === 'close15'));
  assert.equal(r.why, 'סטופ בסגירה'); assert.equal(r.exitI, 15); assert.equal(r.exit, 98.9);
});

test('רחב ×2: סטופ ב-98', () => {
  const m = path([[100, 100, 99.9, 100], [100, 100, 98.5, 98.7], [98.7, 98.8, 97.9, 98]]);
  const r = simLS(m, spec, VARIANTS.find((v) => v.k === 'wide2'));
  assert.equal(r.exit, 98); assert.equal(r.exitI, 2);
});

test('כניסות אקראיות: דטרמיניסטי, אותו מספר עסקאות בערך, לא חופף', () => {
  const b = runBot1(m1, base), a1 = randomRun(m1, b, base, 'bot1', 5), a2 = randomRun(m1, b, base, 'bot1', 5);
  assert.deepEqual(a1.map((x) => x.t), a2.map((x) => x.t));
  assert.ok(a1.length > 0 && a1.length <= b.length);
  for (let i = 1; i < a1.length; i++) assert.ok(a1[i].t > a1[i - 1].t);
});

test('הכרעה רצה על כל הגרסאות', () => {
  const res = new Map(VARIANTS.map((v) => [v.k, runBot1(m1, v)])), rnd = new Map(VARIANTS.map((v) => [v.k, [-1, -2]]));
  const d = decide(res, rnd, COSTS.vip0, SLIP.bot1);
  assert.equal(d.length, VARIANTS.length - 1);
  for (const x of d) assert.equal(typeof x.saves, 'boolean');
  assert.ok(Number.isFinite(stats(res.get('base'), COSTS.zero, 0).mean));
});
