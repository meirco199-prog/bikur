// מחקר "סקטור עלה משמעותית — לקנות את המדשדשות?" (scripts/research-sector-strong.mjs): בחירה, תנאים, כניסה בפתיחה של אותו יום
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { variants, pickIn, qualifies, tradeRet, events } from '../scripts/research-sector-strong.mjs';
import { TOPK } from '../scripts/research-xsec.mjs';

test('מדשדשות: FLAT רק |x| ≤ 0.5% (הקרובה ל-0 קודם), FLAT1 עד 1%; FELL/LAG/LEAD כרגיל', () => {
  const M = [{ si: 1, x: 0.004, rel: -0.026 }, { si: 2, x: -0.001, rel: -0.031 }, { si: 3, x: 0.009, rel: -0.021 }, { si: 4, x: -0.02, rel: -0.05 }, { si: 5, x: 0.05, rel: 0.02 }];
  assert.deepEqual(pickIn(M, 'FLAT', 0), [2, 1]);
  assert.deepEqual(pickIn(M, 'FLAT1', 0), [2, 1, 3]);
  assert.deepEqual(pickIn(M, 'FELL', 0), [4, 2]);
  assert.deepEqual(pickIn(M, 'LAG', 0, 2), [4, 2]);
  assert.deepEqual(pickIn(M, 'LEAD', 0, 1), [5]);
});

test('תנאים: יום חזק לפי סגירה, לפי סטיות תקן, ולפי פער פתיחה; מזהים ייחודיים', () => {
  const V = variants(), get = (id) => V.find((v) => v.id === id);
  assert.equal(qualifies(get('UP3-FLAT'), { r: 0.031, g: 0, z: 1 }), true);
  assert.equal(qualifies(get('UP3-FLAT'), { r: 0.029, g: 0.05, z: 9 }), false);
  assert.equal(qualifies(get('Z2-FLAT'), { r: 0.01, g: 0, z: 2.1 }), true);
  assert.equal(qualifies(get('GAP2-FLAT'), { r: -0.01, g: 0.021, z: 0 }), true);
  assert.equal(qualifies(get('GAP2-FLAT'), { r: 0.05, g: 0.019, z: 5 }), false);
  assert.equal(new Set(V.map((v) => v.id)).size, V.length);
  assert.ok(V.filter((v) => v.kind === 'gap').every((v) => v.cond === 'gap'));
});

test('tradeRet open0: פתיחה של אותו יום → סגירה של k+H−1 (H=1 = סגירת אותו יום); מניה שנמחקה', () => {
  const X = { O: [0, 10, 0, 0], C: [9, 11, 12, NaN] };
  assert.ok(Math.abs(tradeRet(X, 1, 1, 'open0') - 0.1) < 1e-12);
  assert.ok(Math.abs(tradeRet(X, 1, 2, 'open0') - 0.2) < 1e-12);
  assert.ok(Math.abs(tradeRet(X, 1, 3, 'open0') - 0.2) < 1e-12);
  assert.ok(Math.abs(tradeRet(X, 0, 1, 'close') - (11 / 9 - 1)) < 1e-12);
  assert.ok(Number.isNaN(tradeRet({ O: [0, 0], C: [1, 1] }, 0, 1, 'open0')));
});

test('events open0: עודף מול ממוצע הסקטור; עלויות + החלקה מורידות', () => {
  const L = 20, mk = (gIntra) => ({ O: Array.from({ length: L }, () => 100), C: Array.from({ length: L }, () => 100 * (1 + gIntra)) });
  const X = [mk(0.01), mk(0)], adv = [new Float32Array(L).fill(1e9), new Float32Array(L).fill(1e9)];
  const top = new Int32Array(L * TOPK).fill(-1), members = new Array(L);
  for (let k = 2; k < 15; k++){ top[k * TOPK] = 0; members[k] = Int32Array.from([0, 1]); }
  const ctx = { L, cal: Array.from({ length: L }, (_, k) => (k < 8 ? '2010-01-01' : '2020-01-01')), X, adv, k0: 2, kDev: 7 };
  const g = events(ctx, top, members, { N: 1, H: 1, entry: 'open0', net: false }), n = events(ctx, top, members, { N: 1, H: 1, entry: 'open0' });
  assert.ok(Math.abs(g.all.mean - 0.005) < 1e-9); assert.equal(g.dev.n + g.test.n, 13);
  assert.ok(n.all.mean < g.all.mean - 5e-4 + 1e-12);
});
