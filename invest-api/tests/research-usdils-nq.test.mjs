import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zoned, priceAt, buildDays, trades, stats, decide, corr, VARIANTS } from '../scripts/research-usdils-nq.mjs';

const H = 3600e3;
test('שעון קיר → UTC (קיץ/חורף בישראל ובניו יורק)', () => {
  assert.equal(new Date(zoned(2026, 1, 15, 9, 0, 'Asia/Jerusalem')).toISOString(), '2026-01-15T07:00:00.000Z');
  assert.equal(new Date(zoned(2026, 7, 15, 9, 0, 'Asia/Jerusalem')).toISOString(), '2026-07-15T06:00:00.000Z');
  assert.equal(new Date(zoned(2026, 1, 15, 16, 0, 'America/New_York')).toISOString(), '2026-01-15T21:00:00.000Z');
  assert.equal(new Date(zoned(2026, 7, 15, 16, 0, 'America/New_York')).toISOString(), '2026-07-15T20:00:00.000Z');
});

test('מחיר בזמן T: רק נר שהסתיים עד T, ולא ישן מדי', () => {
  const s = { t: [0, H, 2 * H], c: [10, 11, 12] };
  assert.equal(priceAt(s, 2 * H), 11, 'הנר שמתחיל ב-2H עוד לא הסתיים');
  assert.equal(priceAt(s, 3 * H), 12);
  assert.equal(priceAt(s, 10 * H), null, 'ישן מדי');
  assert.equal(priceAt(s, H / 2), null);
});

// סדרות שעתיות סינתטיות: נאסד"ק יורד בלילה → דולר עולה ביום (קשר מושתל)
function synth(days = 60){
  const t0 = Date.parse('2026-01-05T00:00:00Z'), nq = { t: [], c: [] }, fx = { t: [], c: [] };
  let n = 20000, f = 3.5;
  for (let i = 0; i < days * 24; i++){
    const t = t0 + i * H, hr = new Date(t).getUTCHours(), dayIdx = Math.floor(i / 24), down = dayIdx % 2 === 0;
    if (hr >= 22 || hr < 7) n *= down ? 0.9995 : 1.0005;   // לילה: חוזים
    if (hr >= 7 && hr < 21) f *= down ? 1.0002 : 0.9998;     // יום: הדולר בכיוון ההפוך
    nq.t.push(t); nq.c.push(n); fx.t.push(t); fx.c.push(f);
  }
  return { nq, fx };
}

test('ימים: אות לפני הכניסה, יציאות אחרי; קשר מושתל מתגלה', () => {
  const { nq, fx } = synth(), days = buildDays(nq, fx);
  assert.ok(days.length > 30);
  for (const d of days) assert.ok(Number.isFinite(d.S) && d.fxM > 0);
  const tr = trades(days, VARIANTS.find((v) => v.k === 'th0-b'));
  assert.ok(tr.length > 20);
  assert.ok(stats(tr, 0).mean > 0, 'בקשר המושתל קנייה בירידת נאסד"ק מרוויחה');
});

test('סימן: אות שלילי = קנייה של דולר; סף 0.5% מסנן', () => {
  const days = [{ t: 0, S: -0.01, fxM: 3, ex: { a: 3.03, b: 3.03, c: 3.03 } }, { t: 1, S: 0.002, fxM: 3, ex: { a: 2.97, b: 2.97, c: 2.97 } }];
  const a = trades(days, { th: 0, h: 'a' }), b = trades(days, { th: 0.5, h: 'a' });
  assert.equal(a.length, 2); assert.equal(a[0].sg, 1); assert.ok(Math.abs(a[0].gross - 1) < 1e-9); assert.equal(a[1].sg, -1); assert.ok(Math.abs(a[1].gross - 1) < 1e-9);
  assert.equal(b.length, 1);
});

test('הכרעה ומתאם', () => {
  assert.ok(Math.abs(corr([1, 2, 3, 4], [2, 4, 6, 8]) - 1) < 1e-12);
  const tr = Array.from({ length: 400 }, (_, i) => ({ t: i * 86400e3, sg: 1, gross: 0.3 + (i % 3) * 0.1 }));
  assert.equal(decide(tr, 200 * 86400e3).pass, true);
  const bad = tr.map((x, i) => ({ ...x, gross: i < 200 ? 0.5 : -0.1 }));
  assert.equal(decide(bad, 200 * 86400e3).c1, false);
});
