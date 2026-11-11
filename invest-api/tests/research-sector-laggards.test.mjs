// מחקר "המפגרות בסקטור שעולה" (scripts/research-sector-laggards.mjs): שיוך סקטור בלי מידע עתידי, בחירה, תשואת עסקה ומחקר אירועים
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGics, bestSector, assignSectors, variants, pickIn, qualifies, tradeRet, events, SECT } from '../scripts/research-sector-laggards.mjs';
import { TOPK } from '../scripts/research-xsec.mjs';

test('GICS מוויקיפדיה: טיקר + סקטור, נקודה הופכת למקף', () => {
  const html = '<table id="constituents"><tr><th>Symbol</th></tr><tr><td><a>AAPL</a></td><td>Apple</td><td>Information Technology</td></tr><tr><td>BRK.B</td><td>Berkshire</td><td>Financials</td></tr><tr><td>XX</td><td>?</td><td>Unknown</td></tr></table>';
  assert.deepEqual([...parseGics(html)], [['AAPL', 'XLK'], ['BRK-B', 'XLF']]);
});

let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
test('bestSector: בוחר את הקרן עם המתאם הגבוה; בלי מתאם מספיק → -1', () => {
  const a = Array.from({ length: 260 }, rnd), b = Array.from({ length: 260 }, rnd);
  const xs = a.map((x, i) => x + 0.3 * rnd() + 0 * b[i]);
  assert.equal(bestSector(xs, [b, a, null]), 1);
  assert.equal(bestSector(Array.from({ length: 260 }, rnd), [a, b]), -1);
  assert.equal(bestSector(xs.slice(0, 100), [b.slice(0, 100), a.slice(0, 100)]), -1); // פחות מ-200 ימים
});

test('assignSectors: שיוך לשנה נקבע רק מהימים שלפניה — שינוי בעתיד לא משנה אותו', () => {
  const L = 760, cal = Array.from({ length: L }, (_, k) => new Date(Date.UTC(2010, 0, 1) + k * 86400e3 * 1.4).toISOString().slice(0, 10));
  const walk = (f) => { const C = new Float32Array(L); let c = 100; for (let k = 0; k < L; k++){ c *= 1 + f(k); C[k] = c; } return { C }; };
  const m = Array.from({ length: L }, () => rnd() * 0.01), t = Array.from({ length: L }, () => rnd() * 0.02), f = Array.from({ length: L }, () => rnd() * 0.02);
  const spy = walk((k) => m[k]), E = { XLK: walk((k) => m[k] + t[k]), XLF: walk((k) => m[k] + f[k]) };
  const stock = walk((k) => m[k] + t[k] + rnd() * 0.01);
  const a = assignSectors([stock], E, spy, cal);
  const y = cal.find((d, k) => k > 260 && d.slice(0, 4) !== cal[k - 1].slice(0, 4)).slice(0, 4);
  assert.equal(SECT[a[0][y]], 'XLK');
  const k1 = cal.findIndex((d) => d.slice(0, 4) === y), fut = { C: Float32Array.from(stock.C, (c, k) => (k >= k1 ? c * (1 + (k - k1) * 0.05) : c)) };
  assert.equal(assignSectors([fut], E, spy, cal)[0][y], a[0][y]);
});

test('בחירה: FELL רק מניות שירדו (הכי הרבה קודם), LAG לפי התשואה היחסית, LEAD הפוך; תנאי הסקטור', () => {
  const M = [{ si: 1, r: 0.02, rel: -0.01 }, { si: 2, r: -0.01, rel: -0.04 }, { si: 3, r: -0.03, rel: -0.02 }, { si: 4, r: 0.05, rel: 0.02 }];
  assert.deepEqual(pickIn(M, 'FELL', 0), [3, 2]);
  assert.deepEqual(pickIn(M, 'LAG', 0), [2, 3, 1, 4]);
  assert.deepEqual(pickIn(M, 'LEAD', 0, 2), [4, 1]);
  assert.equal(pickIn(M, 'RAND', 5).length, 4);
  const V = variants(), up = V.find((v) => v.id === 'UP100-FELL'), dn = V.find((v) => v.id === 'DN100-LAG'), any = V.find((v) => v.id === 'ANY-LAG');
  assert.equal(qualifies(up, 0.012), true); assert.equal(qualifies(up, 0.009), false);
  assert.equal(qualifies(dn, -0.011), true); assert.equal(qualifies(dn, 0.02), false); assert.equal(qualifies(any, -0.5), true);
  assert.equal(new Set(V.map((v) => v.id)).size, V.length);
});

test('tradeRet: סגירה→סגירה, פתיחה→סגירה, מניה שנמחקה → הסגירה האחרונה', () => {
  const X = { O: [0, 0, 10, 11, 0], C: [10, 10, 12, NaN, NaN] };
  assert.ok(Math.abs(tradeRet(X, 1, 1, 'close') - 0.2) < 1e-12);
  assert.ok(Math.abs(tradeRet(X, 1, 1, 'open') - 0.2) < 1e-12);
  assert.ok(Math.abs(tradeRet(X, 1, 3, 'close') - 0.2) < 1e-12); // נמחקה אחרי יום 2
  assert.ok(Number.isNaN(tradeRet({ O: [0, 0, 0], C: [10, 10, 11] }, 1, 1, 'open')));
});

test('events: עודף = תשואת הנבחרות פחות ממוצע הסקטור; עלויות מורידות; פיתוח/מבחן לפי kDev', () => {
  const L = 30, mk = (g) => ({ O: Array.from({ length: L }, (_, k) => 100 * g ** k), C: Array.from({ length: L }, (_, k) => 100 * g ** k) });
  const X = [mk(1.01), mk(1.0)], adv = [new Float32Array(L).fill(1e9), new Float32Array(L).fill(1e9)];
  const top = new Int32Array(L * TOPK).fill(-1), members = new Array(L);
  for (let k = 2; k < 20; k++){ top[k * TOPK] = 0; members[k] = Int32Array.from([0, 1]); }
  const ctx = { L, cal: Array.from({ length: L }, (_, k) => `20${k < 10 ? '1' : '2'}0-01-${String(k + 1).padStart(2, '0')}`), X, adv, k0: 2, kDev: 9 };
  const g = events(ctx, top, members, { N: 1, H: 1, entry: 'close', net: false });
  assert.ok(Math.abs(g.all.mean - 0.005) < 1e-9, String(g.all.mean)); // 1% מול ממוצע של 0.5%
  assert.equal(g.dev.n, 8); assert.equal(g.test.n, 10);
  const n = events(ctx, top, members, { N: 1, H: 1, entry: 'close' });
  assert.ok(n.all.mean < g.all.mean && n.all.mean > 0);
});
