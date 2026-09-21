// שערוך לפי סגירה מאומתת (AI_COUNCIL#17): בחירת השער לכל נייר, סימון stale, ושורות equity לפי יום הסשן
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DB } from '../lib/db.js';
import { PaperBroker } from '../lib/broker.js';
import { newAggrState } from '../engine/aggressive.js';
import { resolveClosePrices, markToClose } from '../lib/mark.js';

const NOW = new Date('2026-09-22T02:00:00Z'); // שלישי 22/9 05:00 ישראל — הסשן האחרון שנסגר: שני 21/9 (20:00Z)
const rows = (...days) => days.map((d, i) => [d, 100 + i, 101 + i, 99 + i, 100 + i, 1000]);
const loaders = {
  prices: async (sym) => ({
    AAA: { source: 'stooq', rows: rows('2026-09-17', '2026-09-18', '2026-09-21') },
    BBB: { source: 'stooq', rows: rows('2026-09-17', '2026-09-18') },
    CCC: { source: 'stooq', rows: rows('2026-09-17', '2026-09-18') },
    SPY: { source: 'stooq', rows: rows('2026-09-17', '2026-09-18', '2026-09-21') },
  }[sym] || null),
  quote: async (sym) => ({
    BBB: { price: 555, source: 'twelvedata', fetchedAt: '2026-09-21T20:05:00Z' }, // נמשך אחרי הסגירה — זו הסגירה בפועל
    CCC: { price: 444, source: 'twelvedata', fetchedAt: '2026-09-21T15:00:00Z' }, // תוך-יומי — לא סגירה
  }[sym] || null),
};

test('resolveClosePrices: סגירת הסשן מהסדרה; ציטוט אחרי סגירה = סגירה; ציטוט תוך-יומי בלי סגירה = stale עם השער האחרון', async () => {
  const r = await resolveClosePrices({ db: new DB(null) }, ['AAA', 'BBB', 'CCC', 'ZZZ'], { now: NOW, loaders });
  assert.equal(r.session, '2026-09-21');
  assert.deepEqual({ ...r.prices.AAA }, { price: 102, asOf: '2026-09-21', source: 'stooq (close)', stale: false, prevClose: 101 });
  assert.equal(r.prices.BBB.price, 555); assert.equal(r.prices.BBB.asOf, '2026-09-21'); assert.equal(r.prices.BBB.stale, false); assert.equal(r.prices.BBB.prevClose, 101);
  assert.equal(r.prices.CCC.price, 101); assert.equal(r.prices.CCC.asOf, '2026-09-18'); assert.equal(r.prices.CCC.stale, true, 'ציטוט מלפני הסגירה לא נחשב סגירה — השער האחרון מסומן ישן');
  assert.equal(r.prices.ZZZ.price, null); assert.equal(r.prices.ZZZ.stale, true);
  assert.equal(r.stale, true); assert.deepEqual(r.staleSymbols, ['CCC', 'ZZZ']); assert.equal(r.pricedAsOf, '2026-09-18', 'התאריך הישן ביותר, לא החדש ביותר');
});

test('markToClose: שורות equity לפי יום הסשן, סופיות רק כשכל השערים סגירות; זמנית לא דורסת סופית; ימי סוף שבוע נמחקים', async () => {
  const db = new DB(null); const ctx = { db };
  await db.put('fx:USDILS', { rate: 3 });
  const broker = new PaperBroker(db); await broker.reset(100000);
  await broker.placeOrder({ symbol: 'AAA', side: 'buy', qty: 10, price: 100, fx: 3, reason: 'אוטומט: בדיקה' });
  await db.put('aggr:state', { ...newAggrState(100000, '2026-09-17'), positions: { BBB: { qty: 5, entry: 500, high: 500 } }, variant: 'D-x' });
  // שורות ישנות: יום עיבוד בסוף שבוע (נמחק) ושורה זמנית לאותו סשן (נדרסת בסופית)
  await db.put('paper:equity', [['2026-09-19', 1, 1], ['2026-09-21', 2, 2, { final: false, pricedAsOf: '2026-09-18' }]]);
  const r1 = await markToClose(ctx, { now: NOW, loaders });
  assert.equal(r1.session, '2026-09-21');
  assert.equal(r1.paper.final, true); assert.equal(r1.paper.written, true);
  const pe = await db.get('paper:equity'); assert.deepEqual(pe.map((e) => e[0]), ['2026-09-21']); assert.equal(pe[0][3].final, true);
  const acc = await broker.account(); assert.equal(pe[0][1], Math.round((acc.cashIls + 10 * 102 * 3) * 100) / 100, 'השווי לפי סגירת 21/9 (102) ולא לפי 18/9');
  assert.equal(r1.aggr.final, true); const ae = await db.get('aggr:equity'); assert.equal(ae.length, 1); assert.equal(ae[0][0], '2026-09-21'); assert.equal(ae[0][3], 'D-x'); assert.equal(ae[0][4].positions, 1); assert.equal(ae[0][5].final, true);
  assert.equal(ae[0][1], Math.round(100000 + 5 * 555 * 3), 'BBB לפי ציטוט אחרי הסגירה');
  // עכשיו נייר בלי סגירה (CCC) → זמני; השורה הסופית של 21/9 לא נדרסת
  await broker.placeOrder({ symbol: 'CCC', side: 'buy', qty: 1, price: 100, fx: 3, reason: 'אוטומט: בדיקה' });
  const r2 = await markToClose(ctx, { now: NOW, loaders });
  assert.equal(r2.paper.final, false); assert.deepEqual(r2.paper.staleSymbols, ['CCC']); assert.equal(r2.paper.pricedAsOf, '2026-09-18'); assert.equal(r2.paper.written, false, 'זמנית לא דורסת סופית');
  const pe2 = await db.get('paper:equity'); assert.equal(pe2[0][1], pe[0][1]);
  // סשן חדש (22/9 נסגר) בלי שורה קיימת → נכתבת שורה זמנית, ואחרי שהסגירה מגיעה — סופית דורסת אותה
  const NOW2 = new Date('2026-09-23T02:00:00Z');
  const r3 = await markToClose(ctx, { now: NOW2, loaders }); assert.equal(r3.session, '2026-09-22'); assert.equal(r3.paper.final, false); assert.equal(r3.paper.written, true);
  const loaders2 = { ...loaders, prices: async (sym) => ({ AAA: { source: 'stooq', rows: rows('2026-09-18', '2026-09-21', '2026-09-22') }, CCC: { source: 'stooq', rows: rows('2026-09-18', '2026-09-21', '2026-09-22') }, BBB: { source: 'stooq', rows: rows('2026-09-21', '2026-09-22') }, SPY: { source: 'stooq', rows: rows('2026-09-22') } }[sym] || null) };
  const r4 = await markToClose(ctx, { now: NOW2, loaders: loaders2 }); assert.equal(r4.paper.final, true); assert.equal(r4.paper.written, true);
  const pe4 = await db.get('paper:equity'); assert.deepEqual(pe4.map((e) => [e[0], e[3].final]), [['2026-09-21', true], ['2026-09-22', true]]);
});
