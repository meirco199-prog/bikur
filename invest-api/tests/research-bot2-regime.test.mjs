import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vol24, percentileOf, blockBoot, summary, decide, VALIDATE, SLIP_OF, coinTrades } from '../scripts/research-bot2-regime.mjs';

const mkB = (closes, t0 = Date.parse('2021-01-01T00:00:00Z')) => closes.map((c, k) => ({ t: t0 + k * 15 * 60e3, o: c, h: c, l: c, c }));

test('תנודתיות 24 שעות = סטיית תקן של 96 תשואות לוג עד הנר כולל', () => {
  let s = 3; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const c = [100]; for (let i = 1; i < 300; i++) c.push(c[i - 1] * (1 + (R() - 0.5) * 0.01));
  const V = vol24(mkB(c));
  assert.ok(Number.isNaN(V[95])); assert.ok(Number.isFinite(V[96]));
  const r = []; for (let k = 200 - 95; k <= 200; k++) r.push(Math.log(c[k] / c[k - 1]));
  const m = r.reduce((a, b) => a + b, 0) / 96, sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / 95);
  assert.ok(Math.abs(V[200] - sd) < 1e-12);
});

test('אחוזון: רק נתונים מלפני היום; מינימום 90 יום; שינוי בעתיד לא משנה את המשטר של היום', () => {
  const n = 96 * 200; let s = 5; const R = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const c = [100]; for (let i = 1; i < n; i++) c.push(c[i - 1] * (1 + (R() - 0.5) * 0.004));
  const b = mkB(c), V = vol24(b), p = percentileOf(b, V);
  assert.equal(p(96 * 50), null, 'לפני 90 יום — אין משטר');
  const k = 96 * 150 + 10, before = p(k);
  const c2 = c.slice(); for (let i = 96 * 151; i < n; i++) c2[i] = c2[i - 1] * (1 + (R() - 0.5) * 0.05); // עתיד סוער מאוד
  const b2 = mkB(c2), p2 = percentileOf(b2, vol24(b2));
  assert.deepEqual(p2(k), before);
  assert.ok([0, 1, 2].includes(before.reg));
});

test('מדגם חוזר בבלוקים: דטרמיניסטי ומכיל את הממוצע', () => {
  const tr = Array.from({ length: 300 }, (_, i) => ({ t: Date.parse('2022-01-01') + i * 6 * 3600e3, net: (i % 3) - 0.8, gross: 0, net2: 0, R: 0 }));
  const a = blockBoot(tr, 500, 1), b = blockBoot(tr, 500, 1), m = tr.reduce((s, x) => s + x.net, 0) / tr.length;
  assert.deepEqual(a, b); assert.ok(a.lo <= m && m <= a.hi);
});

test('summary: בלי העסקה הטובה, ירידה מקסימלית, R', () => {
  const tr = [10, -5, 100, -20, 3].map((net, i) => ({ t: i * 1e6, net, gross: net + 1, net2: net - 1, R: net / 10 }));
  const S = summary(tr);
  assert.equal(S.total, 88); assert.equal(S.noTop1, -12); assert.equal(S.dd, 20); assert.equal(S.R.max, 10);
});

test('הכרעה: כל ארבעת התנאים נדרשים', () => {
  const mk = (coin, reg, net, t) => ({ coin, reg, net, gross: net, net2: net, R: 0, t });
  const tr = []; let t = Date.parse('2021-01-01');
  for (const c of VALIDATE) for (let i = 0; i < 60; i++){ t += 3 * 86400e3 / 8; tr.push(mk(c, 2, 50 + (i % 5), t), mk(c, 0, -50, t + 1)); }
  for (let i = 0; i < tr.length; i++) if (i % 2 === 0) tr[i].t = (i < tr.length / 2 ? Date.parse('2022-06-01') : Date.parse('2025-06-01')) + i * 3600e3;
  const d = decide(tr);
  assert.equal(d.pass, true);
  const bad = tr.map((x) => (x.coin === 'BTC' || x.coin === 'SOL' || x.coin === 'XRP' || x.coin === 'BNB' ? { ...x, net: x.reg === 2 ? -10 : x.net } : x));
  assert.equal(decide(bad).c2, false);
});

test('החלקה: 0.01% ל-ETH/BTC, 0.03% לשאר; 8 מטבעות אימות בלי ETH', () => {
  assert.equal(SLIP_OF('ETH'), 0.01); assert.equal(SLIP_OF('BTC'), 0.01); assert.equal(SLIP_OF('SOL'), 0.03);
  assert.equal(VALIDATE.length, 8); assert.ok(!VALIDATE.includes('ETH'));
  assert.equal(typeof coinTrades, 'function');
});
