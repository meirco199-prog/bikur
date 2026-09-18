import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepAggressive, newAggrState, aggrMetrics, sectorExposure, normalizeSector, SPY_SECTOR_WEIGHTS, AGGR_RULES } from '../engine/aggressive.js';
import { runAggressive, aggrReport } from '../lib/aggressive.js';
import { DB } from '../lib/db.js';

const rows = (n = 30, f = () => ({})) => [...Array(n)].map((_, i) => ({ symbol: 'S' + i, sector: ['Tech', 'Health', 'Fin'][i % 3], price: 100 + i, D: 40 + i * 2, actD: i >= n - 6 ? 'STRONG BUY' : i >= n - 10 ? 'BUY' : i < 5 ? 'SELL' : 'HOLD', C: 50, actC: 'HOLD', eligible: true, eligibleD: true, ...f(i) }));
const bull = { trend: 'Bull Trend', risk: 'Risk On' };

test('אגרסיבי: יום ראשון — ליבה 20% SPY, עד 5 קניות של 7.5% לפי הציון האגרסיבי (D), רזרבת מזומן, עמלות והחלקה', () => {
  const r = stepAggressive({ state: newAggrState(200000, '2026-09-17'), rows: rows(), spyPrice: 500, regime: bull, fx: 3.7, day: '2026-09-17' });
  const spy = r.trades.find((t) => t.symbol === 'SPY');
  assert.ok(spy && spy.side === 'buy' && Math.abs(spy.ils - 40000) < 2000, 'ליבה ~20%');
  const buys = r.trades.filter((t) => t.side === 'buy' && t.symbol !== 'SPY');
  assert.equal(buys.length, AGGR_RULES.maxBuysPerDay);
  assert.deepEqual(buys.map((t) => t.symbol), ['S29', 'S28', 'S27', 'S26', 'S25'], 'הציון הגבוה קודם');
  for (const b of buys) assert.ok(b.ils <= 200000 * AGGR_RULES.positionWeight + 1);
  assert.ok(r.cashIls > 200000 * AGGR_RULES.cashReserve);
  assert.ok(r.state.stats.feesIls === AGGR_RULES.feeIls * r.trades.length);
  assert.ok(r.totalIls < 200000 && r.totalIls > 199000, 'עמלות+החלקה בלבד');
  // חשיפה: מניות בודדות, קרן, מזומן וסך מנייתי — בנפרד
  const e = r.exposure;
  assert.ok(Math.abs(e.stocksShare - 0.375) < 0.02, 'חמש מניות × 7.5%'); assert.ok(Math.abs(e.etfShare - 0.20) < 0.02); assert.ok(Math.abs(e.equityShare - (e.stocksShare + e.etfShare)) < 0.002); assert.ok(Math.abs(e.cashShare + e.equityShare - 1) < 0.002);
  assert.equal(e.stocksIls + e.etfIls, e.equityIls);
  // look-through: SPY תורם לענפים לפי משקלי המדד
  const it = r.sectors.find((x) => x.sector === 'Information Technology');
  assert.ok(it && it.ils > e.etfIls * SPY_SECTOR_WEIGHTS['Information Technology'] * 0.99, 'טכנולוגיה כוללת את חלקה ב-SPY');
  assert.equal(normalizeSector('Technology'), 'Information Technology'); assert.equal(normalizeSector('Healthcare'), 'Health Care'); assert.equal(normalizeSector('Financial Services'), 'Financials');
});

test('אגרסיבי: תקרת ענף 40% נספרת look-through — טכנולוגיה ישירה + חלקה ב-SPY', () => {
  // כל המועמדות טכנולוגיה: 20% SPY × 33% = 6.6% + מניות ישירות; אחרי 4 מניות (30%) + 6.6% = 36.6%, החמישית תחרוג → נדחית
  const techRows = rows(30, () => ({ sector: 'Technology' }));
  const r = stepAggressive({ state: newAggrState(200000, '2026-09-17'), rows: techRows, spyPrice: 500, regime: bull, fx: 3.7, day: '2026-09-17' });
  const buys = r.trades.filter((t) => t.side === 'buy' && t.symbol !== 'SPY');
  assert.equal(buys.length, 4, 'הקנייה החמישית הייתה מעבירה את הענף מעל 40% look-through');
  assert.ok(r.notes.some((n) => /look-through/.test(n)));
  const tech = r.sectors.find((x) => x.sector === 'Information Technology');
  assert.ok(tech.share < 0.40 && tech.share > 0.33);
});

test('אגרסיבי: מכירה בסיגנל/עצירה/עצירה נגררת, בלי קנייה חוזרת בתוך שבוע (cooldown), ניצחונות/הפסדים', () => {
  let r = stepAggressive({ state: newAggrState(200000, '2026-09-17'), rows: rows(), spyPrice: 500, regime: bull, fx: 3.7, day: '2026-09-17' });
  // S29 נופל 20% → עצירה; S28 עולה ואז יורד 16% מהשיא → עצירה נגררת; S27 מקבל סיגנל מכירה
  let r2 = stepAggressive({ state: r.state, rows: rows(30, (i) => (i === 28 ? { price: 128 * 1.3 } : {})), spyPrice: 500, regime: bull, fx: 3.7, day: '2026-09-18' });
  assert.equal(r2.trades.filter((t) => t.side === 'sell').length, 0);
  assert.ok(r2.state.positions.S28.high > 128 * 1.29);
  const day3 = rows(30, (i) => (i === 29 ? { price: 129 * 0.8 } : i === 28 ? { price: 128 * 1.3 * 0.84 } : i === 27 ? { actD: 'SELL', D: 20 } : {}));
  let r3 = stepAggressive({ state: r2.state, rows: day3, spyPrice: 500, regime: bull, fx: 3.7, day: '2026-09-19' });
  const sells = r3.trades.filter((t) => t.side === 'sell');
  assert.deepEqual(sells.map((t) => t.symbol).sort(), ['S27', 'S28', 'S29']);
  assert.match(sells.find((t) => t.symbol === 'S29').reason, /עצירת הפסד/); assert.match(sells.find((t) => t.symbol === 'S28').reason, /נגררת/); assert.match(sells.find((t) => t.symbol === 'S27').reason, /סיגנל מכירה/);
  assert.ok(!r3.trades.some((t) => t.side === 'buy' && ['S27', 'S28', 'S29'].includes(t.symbol)), 'אין קנייה חוזרת באותו יום');
  assert.equal(r3.state.stats.trades, 3); assert.equal(r3.state.stats.wins, 1); assert.equal(r3.state.stats.losses, 2);
  const r4 = stepAggressive({ state: r3.state, rows: rows(), spyPrice: 500, regime: bull, fx: 3.7, day: '2026-09-22' });
  assert.ok(!r4.trades.some((t) => t.side === 'buy' && t.symbol === 'S29'), 'cooldown 7 ימים');
  const r5 = stepAggressive({ state: r4.state, rows: rows(), spyPrice: 500, regime: bull, fx: 3.7, day: '2026-09-28' });
  assert.ok(r5.trades.some((t) => t.side === 'buy' && t.symbol === 'S29') || Object.keys(r5.state.positions).length > 10, 'אחרי שבוע מותר שוב');
});

test('אגרסיבי: שוק דובי — הקטנת מניות ל-25% (החלשות קודם) ובלי קניות; Risk Off — רק קנייה חזקה; ליבה לא נמכרת', () => {
  let r = stepAggressive({ state: newAggrState(200000, '2026-09-17'), rows: rows(), spyPrice: 500, regime: bull, fx: 3.7, day: '2026-09-17' });
  r = stepAggressive({ state: r.state, rows: rows(), spyPrice: 500, regime: bull, fx: 3.7, day: '2026-09-18' });
  assert.equal(Object.keys(r.state.positions).length, 11);
  const bear = stepAggressive({ state: r.state, rows: rows(), spyPrice: 500, regime: { trend: 'Bear Trend', risk: 'Risk Off' }, fx: 3.7, day: '2026-09-19' });
  const stocks = bear.positions.filter((p) => !p.core).reduce((s, p) => s + p.valueIls, 0);
  assert.ok(stocks <= bear.totalIls * AGGR_RULES.bearStocksTarget + 1);
  assert.ok(bear.state.positions.SPY, 'הליבה נשארת');
  assert.ok(!bear.trades.some((t) => t.side === 'buy'));
  assert.ok(bear.trades.filter((t) => t.side === 'sell')[0].symbol === 'S20', 'הציון הנמוך נמכר קודם');
  const ro = stepAggressive({ state: newAggrState(200000, '2026-09-17'), rows: rows(), spyPrice: 500, regime: { trend: 'Bull Trend', risk: 'Risk Off' }, fx: 3.7, day: '2026-09-17' });
  assert.ok(ro.trades.filter((t) => t.side === 'buy' && t.symbol !== 'SPY').every((t) => /STRONG BUY/.test(t.reason)));
});

test('אגרסיבי: מדדים (תשואה, מול SPY, drawdown, תנודתיות) והרצה לילית אידמפוטנטית עם דוח', async () => {
  const m = aggrMetrics([['d1', 200000, 500], ['d2', 210000, 505], ['d3', 189000, 500], ['d4', 195000, 510]], 200000);
  assert.equal(m.totalReturn, -0.025); assert.equal(m.spyReturn, 0.02); assert.equal(m.excess, -0.045); assert.equal(m.maxDrawdown, -0.1); assert.ok(m.volAnnual > 0);
  assert.equal(aggrMetrics([]), null);
  const db = new DB(null); const ctx = { db, env: {} };
  await db.put('idx:snapdays', ['2026-09-17']); await db.put('rank:2026-09-17', { table: [{ symbol: 'SPY', price: 500, type: 'etf' }] }); await db.put('regime:2026-09-17', bull);
  assert.equal((await runAggressive(ctx)).ran, false, 'בלי מודל צל');
  await db.put('shadow:2026-09-17', { day: '2026-09-17', rows: rows() });
  const r = await runAggressive(ctx);
  assert.equal(r.ran, true); assert.equal(r.positions, 6); assert.ok(r.trades.length === 6);
  assert.equal((await runAggressive(ctx)).ran, false, 'כבר רץ היום');
  const rr = await runAggressive(ctx, { reset: true });
  assert.equal(rr.ran, true); assert.equal(rr.reset, true); assert.equal(rr.model, 'D'); assert.ok((await db.list('aggr:archive:')).length === 1, 'המצב הישן בארכיון');
  const rep = await aggrReport(db);
  assert.equal(rep.positions.length, 6); assert.ok(rep.positions[0].core, 'SPY הגדולה'); assert.equal(rep.equity.length, 1); assert.equal(rep.metrics.days, 1); assert.equal(rep.trades.length, 6);
  assert.ok(rep.stocksShare > 0.3 && rep.stocksShare < 0.4); assert.ok(rep.exposure.equityShare > 0.5); assert.ok(rep.sectors.length >= 3);
});
