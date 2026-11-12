// בדיקות למחקר "שיטת 2 אחוז" (scripts/research-bracket2.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { tradeRet, meanT, pick, lcg, FEE, STOP_SLIP } from '../scripts/research-bracket2.mjs';

const close = (a, b) => Math.abs(a - b) < 1e-9;

test('tradeRet: יעד, סטופ, סגירה, והחזקה עד הסגירה — אחרי עלויות', () => {
  const hs = 3e-4, cost = 2 * (hs + FEE);
  assert.ok(close(tradeRet(100, 103, 99, 101, 0.02, hs).r, 0.02 - cost));               // רק יעד
  assert.ok(close(tradeRet(100, 101, 97.5, 99, 0.02, hs).r, -0.02 - cost - STOP_SLIP)); // רק סטופ
  assert.ok(close(tradeRet(100, 101, 99, 100.5, 0.02, hs).r, 0.005 - cost));            // אף אחד → סגירה
  assert.ok(close(tradeRet(100, 103, 97, 101, null, hs).r, 0.01 - cost));               // החזקה
});

test('tradeRet: סטופ ויעד באותו יום — פסימי = סטופ, אופטימי = יעד, ומסומן "גם וגם"', () => {
  const p = tradeRet(100, 102.5, 97.9, 100, 0.02, 0), o = tradeRet(100, 102.5, 97.9, 100, 0.02, 0, false);
  assert.equal(p.why, 'סטופ'); assert.equal(o.why, 'יעד'); assert.ok(p.both && o.both);
  assert.equal(tradeRet(0, 1, 1, 1, 0.02, 0), null);
});

test('meanT ו-pick: ממוצע ו-t; בחירה לפי פער פתיחה ולפי טווח יומי 2%–4%', () => {
  const m = meanT([1, 2, 3, NaN]); assert.equal(m.n, 3); assert.equal(m.mean, 2); assert.ok(m.t > 3);
  const c = Array.from({ length: 10 }, (_, i) => ({ s: `S${i}`, gap: i / 100 - 0.05, atr: 0.01 + i * 0.004 }));
  assert.deepEqual(pick(c, 'gapUp5', lcg(1)).map((x) => x.s), ['S9', 'S8', 'S7', 'S6', 'S5']);
  assert.deepEqual(pick(c, 'gapDn5', lcg(1)).map((x) => x.s), ['S0', 'S1', 'S2', 'S3', 'S4']);
  const calm = pick(c, 'calm5', lcg(1)); assert.ok(calm.length === 5 && calm.every((x) => x.atr >= 0.02 && x.atr <= 0.04));
  assert.equal(pick(c, 'all', lcg(1)).length, 10);
});
