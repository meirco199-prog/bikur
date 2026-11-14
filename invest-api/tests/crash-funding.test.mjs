// כיוון 2 — קנייה בקריסות לפי דמי המימון (engine/crash-funding.js): בלי הצצה לעתיד, כלל האירוע, המסנן וההחזקה
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CF, crashBuy, crashDepth, fundingView, fundOK, holder, randomBuy, tradeList, toFundingMap } from '../engine/crash-funding.js';
import { align, runDaily } from '../engine/research-daily.js';

const D0 = Date.UTC(2020, 0, 1), DAY = 86400e3;
const bars = (f, n = 600) => Array.from({ length: n }, (_, i) => { const c = f(i), o = i ? f(i - 1) : c; return { t: D0 + i * DAY, o, h: Math.max(o, c), l: Math.min(o, c), c }; });
const wave = (i) => 100 * (1 + 0.001 * i) * (1 + 0.2 * Math.sin(i / 25));
const fmap = (g, n = 600) => new Map(Array.from({ length: n }, (_, i) => [D0 + i * DAY, g(i)]));
const W = (s, A) => { const st = {}; return A.days.map((_, d) => s.weights(A, d, st)[0]); };

test('בלי הצצה לעתיד: שינוי מחירים ודמי מימון אחרי d לא משנה משקל עד d (כל הרשת, שני המטבעות)', () => {
  const cut = 400, A1 = align({ X: bars(wave) }), A2 = align({ X: bars((i) => (i <= cut ? wave(i) : wave(i) * (i % 2 ? 0.5 : 1.4))) });
  const F1 = fmap((i) => 0.0003 * Math.sin(i / 9)), F2 = fmap((i) => (i <= cut ? 0.0003 * Math.sin(i / 9) : -0.01));
  for (const coin of ['BTC', 'ETH']) for (const p of CF.grid){
    const w1 = W(crashBuy(A1, F1, coin, p), A1), w2 = W(crashBuy(A2, F2, coin, p), A2);
    assert.deepEqual(w1.slice(0, cut + 1), w2.slice(0, cut + 1), `${coin} ${JSON.stringify(p)}`); }
  const fv1 = fundingView(A1, F1), fv2 = fundingView(A2, F2);
  for (let d = 0; d <= cut; d++){ assert.equal(fv1.q[d], fv2.q[d]); assert.equal(fv1.avg[d], fv2.avg[d]); }
});

test('אירוע: קריסה של 15% מהשיא של 7 ימים + מימון שלילי → כניסה; החזקה h ימים; אירוע חדש רק אחרי שהקריסה התבטלה', () => {
  // מחיר 100, ביום 200 יורד ל-80 (‎−20%), נשאר שם עד 205, ואז חוזר ל-100
  const px = (i) => (i < 200 ? 100 : i <= 205 ? 80 : 100), A = align({ X: bars(px) });
  assert.ok(Math.abs(crashDepth(A, 200) - 0.2) < 1e-12);
  const neg = fmap(() => -0.0002), pos = fmap(() => 0.0001);
  const w = W(crashBuy(A, neg, 'BTC', { x: 0.15, f: 'neg', h: 10 }), A);
  assert.equal(w[199], 0); assert.equal(w[200], 1, 'נכנסים ביום הקריסה'); assert.equal(w[209], 1); assert.equal(w[210], 0, 'יוצאים אחרי 10 ימים');
  assert.equal(w.slice(211).some((x) => x === 1), false, 'אין כניסה חוזרת על אותה קריסה');
  assert.equal(W(crashBuy(A, pos, 'BTC', { x: 0.15, f: 'neg', h: 10 }), A).some((x) => x === 1), false, 'מימון חיובי → אין כניסה');
  const A18 = align({ X: bars((i) => (i < 200 ? 100 : i <= 205 ? 82 : 100)) });
  assert.equal(W(crashBuy(A18, neg, 'BTC', { x: 0.15, f: 'neg', h: 10 }), A18)[200], 1, 'BTC: ירידה של 18% עוברת סף 15%');
  assert.equal(W(crashBuy(A18, neg, 'ETH', { x: 0.15, f: 'neg', h: 10 }), A18)[200], 0, 'ETH: הסף 20% — ירידה של 18% לא עוברת');
});

test('סף: ETH = x × 4/3; neg1 ו-p10; עצירה של 20%; runDaily ועסקאות; אקראי', () => {
  assert.equal(fundOK({ avg: [-0.00005], q: [NaN] }, 0, 'neg'), true); assert.equal(fundOK({ avg: [-0.00005], q: [NaN] }, 0, 'neg1'), false);
  assert.equal(fundOK({ avg: [-0.0002], q: [NaN] }, 0, 'p10'), false, 'בלי היסטוריה אין עשירון'); assert.equal(fundOK({ avg: [-0.0002], q: [-0.0001] }, 0, 'p10'), true);
  const px = (i) => (i < 200 ? 100 : i === 200 ? 84 : 84 * 0.97 ** (i - 200)), A = align({ X: bars(px) });
  const w = W(crashBuy(A, fmap(() => -0.0002), 'BTC', { x: 0.15, f: 'neg', h: 40 }), A);
  const out = w.findIndex((x, i) => i > 200 && x === 0); assert.ok(out > 200 && out < 210, 'עצירה ב-20% מתחת לכניסה');
  const r = runDaily(A, crashBuy(A, fmap(() => -0.0002), 'BTC', { x: 0.15, f: 'neg', h: 40 }), { drift: true }), tr = tradeList(r.series);
  assert.equal(tr.length, 1); assert.ok(tr[0].ret < -0.2 && tr[0].ret > -0.3);
  let s = 1; const rng = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const wr = W(randomBuy(rng, 0.02, { h: 10 }), align({ X: bars(wave) })); assert.ok(wr.filter((x) => x === 1).length > 30);
  assert.equal(toFundingMap([['2020-01-02', 0.1]]).get(D0 + DAY), 0.1);
});
