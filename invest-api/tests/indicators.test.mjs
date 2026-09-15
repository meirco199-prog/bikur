import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, rsi, macd, bollinger, atr, technicalSnapshot, indicatorSeries, drawdowns, supportResistance } from '../engine/indicators.js';
import { syntheticRows } from './helpers.mjs';

test('SMA מחשב ממוצע פשוט', () => {
  const s = sma([1, 2, 3, 4, 5, 6], 3);
  assert.deepEqual(s, [null, null, 2, 3, 4, 5]);
});
test('EMA מתחיל מ-SMA וממשיך לפי נוסחה', () => {
  const e = ema([10, 11, 12, 13, 14], 3);
  assert.equal(e[2], 11);
  assert.ok(Math.abs(e[3] - (13 * 0.5 + 11 * 0.5)) < 1e-9);
});
test('RSI — דוגמה קלאסית של Wilder (14 ימים) ≈ 70.5', () => {
  const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  const r = rsi(closes, 14);
  assert.ok(Math.abs(r[14] - 70.53) < 0.2, `RSI=${r[14]}`);
});
test('RSI תמיד בין 0 ל-100 ו-null לפני חימום', () => {
  const rows = syntheticRows({ n: 300 });
  const r = rsi(rows.map((x) => x[4]));
  assert.equal(r[13], null);
  assert.ok(r.slice(14).every((v) => v >= 0 && v <= 100));
});
test('MACD: line = EMA12−EMA26, hist = line−signal', () => {
  const c = syntheticRows({ n: 200 }).map((x) => x[4]);
  const m = macd(c), e12 = ema(c, 12), e26 = ema(c, 26);
  const i = 150;
  assert.ok(Math.abs(m.line[i] - (e12[i] - e26[i])) < 1e-9);
  assert.ok(Math.abs(m.hist[i] - (m.line[i] - m.signal[i])) < 1e-9);
});
test('Bollinger: מחיר בין הרצועות רוב הזמן, %B עקבי', () => {
  const c = syntheticRows({ n: 400 }).map((x) => x[4]);
  const b = bollinger(c, 20, 2);
  let inside = 0, cnt = 0;
  for (let i = 19; i < c.length; i++){ cnt++; if (c[i] >= b.lower[i] && c[i] <= b.upper[i]) inside++; assert.ok(Math.abs(b.pctB[i] - (c[i] - b.lower[i]) / (b.upper[i] - b.lower[i])) < 1e-9); }
  assert.ok(inside / cnt > 0.85);
});
test('ATR חיובי ובסדר גודל של הטווח היומי', () => {
  const rows = syntheticRows({ n: 100 });
  const a = atr(rows, 14);
  assert.equal(a[12], null);
  assert.ok(a[99] > 0 && a[99] < rows[99][4] * 0.1);
});
test('אינדיקטורים אחוריים: שינוי בר עתידי לא משנה ערכים קודמים (אין look-ahead)', () => {
  const rows = syntheticRows({ n: 500 });
  const a = indicatorSeries(rows);
  const rows2 = rows.map((r) => r.slice());
  rows2[499][4] = rows2[499][4] * 1.5; rows2[498][4] *= 0.7;
  const b = indicatorSeries(rows2);
  for (const k of ['sma20', 'sma50', 'sma200', 'rsi']) for (let i = 0; i < 497; i++) assert.equal(a[k][i], b[k][i], `${k}[${i}]`);
  for (let i = 0; i < 497; i++) assert.equal(a.macd.hist[i], b.macd.hist[i]);
  // וגם: חישוב על prefix זהה לחישוב על הסדרה המלאה
  const pre = indicatorSeries(rows.slice(0, 400));
  for (let i = 0; i < 400; i++){ assert.equal(pre.sma200[i], a.sma200[i]); assert.equal(pre.rsi[i], a.rsi[i]); }
});
test('technicalSnapshot: מבנה מלא, מגמה מזוהה במגמה עולה', () => {
  const rows = syntheticRows({ n: 600, drift: 0.002, vol: 0.008 });
  const t = technicalSnapshot(rows);
  assert.ok(!t.missing);
  assert.ok(t.trendScore >= 75, `trend ${t.trendScore}`);
  assert.ok(t.rsi > 0 && t.rsi <= 100);
  assert.ok(t.high52 >= t.price * 0.99);
  assert.ok(Array.isArray(t.events));
  assert.ok(t.momentum.r12m > 0);
  assert.ok(t.vol1y > 0);
});
test('technicalSnapshot: פחות מ-30 ימים → missing', () => {
  assert.ok(technicalSnapshot(syntheticRows({ n: 10 })).missing);
});
test('drawdowns: שיא→שפל מחושב נכון', () => {
  const d = drawdowns([100, 120, 90, 110, 60, 80]);
  assert.equal(d.maxDrawdown, 0.5 - 1);
  assert.equal(d.maxIdx, 4);
});
test('supportResistance: תמיכות מתחת למחיר, התנגדויות מעל', () => {
  const rows = syntheticRows({ n: 300, vol: 0.02 });
  const sr = supportResistance(rows);
  const last = rows[rows.length - 1][4];
  assert.ok(sr.supports.every((s) => s.level < last));
  assert.ok(sr.resistances.every((s) => s.level > last));
});
