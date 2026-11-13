// בדיקות למחקר הסקאלפינג (scripts/research-scalp.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { trade, cost, signal, runCoin, summ, COST, RULES, STOPS, RR, lcg } from '../scripts/research-scalp.mjs';

const close = (a, b) => Math.abs(a - b) < 1e-9;
function m1Of(rows, t0 = Date.UTC(2024, 0, 1)){
  const n = rows.length, m = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n) };
  rows.forEach(([o, h, l, c], i) => { m.t[i] = t0 + i * 60e3; m.o[i] = o; m.h[i] = h; m.l[i] = l; m.c[i] = c; });
  return m;
}

test('trade: יעד, סטופ, וסטופ ויעד באותה דקה → סטופ', () => {
  const up = trade(m1Of([[100, 100.25, 99.95, 100.2]]), 0, 1, 0.1, 0.2);
  assert.equal(up.why, 'יעד'); assert.ok(close(up.g, 0.002));
  const dn = trade(m1Of([[100, 100.05, 99.85, 99.9]]), 0, 1, 0.1, 0.2);
  assert.equal(dn.why, 'סטופ'); assert.ok(close(dn.g, -0.001));
  const both = trade(m1Of([[100, 100.3, 99.8, 100]]), 0, 1, 0.1, 0.2);
  assert.equal(both.why, 'סטופ');
  const sh = trade(m1Of([[100, 100.05, 99.75, 99.8]]), 0, -1, 0.1, 0.2);  // שורט: ירידה = רווח
  assert.equal(sh.why, 'יעד'); assert.ok(close(sh.g, 0.002));
});

test('cost: הלוך-חזור לפי סוג היציאה', () => {
  assert.ok(close(cost('יעד'), (COST.taker + COST.slip + COST.maker) / 100));
  assert.ok(close(cost('סטופ'), 2 * (COST.taker + COST.slip) / 100));
});

test('signal + runCoin: כל הגרסאות, עסקה אחת בכל רגע, פיצול פיתוח/מבחן', () => {
  const rows = Array.from({ length: 400 }, (_, i) => { const c = 100 + Math.sin(i / 5) * 0.5; return [c, c + 0.05, c - 0.05, c]; });
  const m = m1Of(rows);
  assert.ok([1, -1].includes(signal(m, 30, 'random', lcg(1))));
  const R = runCoin(m);
  assert.equal(Object.keys(R).length, RULES.length * STOPS.length * RR.length);
  const r = R['random-s0.1-x1']; assert.equal(r.dev.n, 0); assert.ok(r.test.n > 10);   // 2024 → מבחן
  const s = summ(r.test, 1); assert.ok(s.net < s.gross);                                // העלויות מורידות
});
