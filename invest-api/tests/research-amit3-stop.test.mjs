// מחקר "בוט 3: הגבלת ההפסד כשגם המנה השלישית נכנסת" (scripts/research-amit3-stop.mjs): גרסאות, סטטיסטיקה, בחירה וקריטריון
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { variants, stat, pick, passes, BASE, PERIODS, WEIGHTS, RULES, STOPS } from '../scripts/research-amit3-stop.mjs';
import { RISK_USD } from '../engine/amit-course.js';

test('גרסאות: מזהים ייחודיים, הבסיס = בוט 3 כמו היום (30-60-90, בלי כלל, סטופ של הקורס)', () => {
  const V = variants();
  assert.equal(V.length, STOPS.length * (Object.keys(WEIGHTS).length * Object.keys(RULES).length + 1) + 3 * 2 * 3);
  assert.equal(V.find((v) => v.key === 'course-none-slatr2').opt.stopAtr, 2);
  assert.equal(V.filter((v) => v.opt.confirm3).length, 18);
  assert.equal(new Set(V.map((v) => v.key)).size, V.length);
  const b = V.find((v) => v.key === BASE);
  assert.deepEqual(b.opt.weights, [1 / 6, 1 / 3, 1 / 2]); assert.equal(b.opt.full, null); assert.equal(b.opt.stop, 'course');
});

test('stat: הצלחה, רווח/הפסד ממוצע, הפסדים גדולים, ירידה מקסימלית לפי סדר הזמן', () => {
  const t0 = PERIODS.train.from, R = (r) => r * RISK_USD;
  const c = { t: [t0 + 3, t0 + 1, t0 + 2, t0 + 4, PERIODS.test.from], net: [R(0.2), R(0.1), R(-1), R(0.3), R(5)], fills: [1, 1, 3, 1, 1], full: [false, false, true, false, false], coin: [0, 0, 0, 0, 0] };
  const s = stat(c, PERIODS.train);
  assert.equal(s.n, 4); assert.equal(s.win, 75); assert.ok(Math.abs(s.R - (-0.1)) < 1e-12);
  assert.ok(Math.abs(s.avgWin - 0.2) < 1e-12); assert.equal(s.avgLoss, -1); assert.equal(s.bigPct, 25); assert.equal(s.fullPct, 25);
  assert.ok(Math.abs(s.ddR - 1) < 1e-12);                       // +0.1 → −1 (ירידה של 1R מהשיא)
});

test('בחירה לפי אימון בלבד (מינימום עסקאות); קריטריון: כל 4 התקופות > 0, טובה מהאקראי, מטבעות חדשים > 0', () => {
  const mk = (train, n = 200) => ({ train: { R: train, n } });
  const S = new Map([['a', mk(0.5, 50)], ['b', mk(0.1)], ['c', mk(0.2)]]);
  assert.equal(pick(S), S.get('c'));
  const good = { hold: { R: 0.1 }, train: { R: 0.1 }, val: { R: 0.1 }, test: { R: 0.1 }, all: { R: 0.1 }, rnd: { all: { R: 0 } } };
  assert.equal(passes(good, { R: 0.05 }), true);
  assert.equal(passes({ ...good, test: { R: -0.01 } }, { R: 0.05 }), false);
  assert.equal(passes({ ...good, rnd: { all: { R: 0.2 } } }, { R: 0.05 }), false);
  assert.equal(passes(good, { R: -0.01 }), false); assert.equal(passes(good, null), false);
});
