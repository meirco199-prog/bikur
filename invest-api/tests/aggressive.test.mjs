import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stepAggressive, newAggrState, aggrMetrics, sectorExposure, normalizeSector, SPY_SECTOR_WEIGHTS, AGGR_RULES } from '../engine/aggressive.js';
import { runAggressive, aggrReport, executeAggressive } from '../lib/aggressive.js';
import { installMockFetch } from './mock-providers.mjs';
import { Budget } from '../lib/budget.js';
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

test('אגרסיבי: מדדים; לילה = החלטה בלבד (pending), מילוי למחרת בחלון לפי ציטוט חי עם פער מול מחיר ההחלטה; SPY נרשם באותה נקודה', async () => {
  const m = aggrMetrics([['d1', 200000, 500], ['d2', 210000, 505], ['d3', 189000, 500], ['d4', 195000, 510]], 200000);
  assert.equal(m.totalReturn, -0.025); assert.equal(m.spyReturn, 0.02); assert.equal(m.excess, -0.045); assert.equal(m.maxDrawdown, -0.1); assert.ok(m.volAnnual > 0);
  assert.equal(aggrMetrics([['d1', 200000, 500], ['d2', 210000, 510]], 200000, 490).spyReturn, round4(510 / 490 - 1), 'מול SPY מנקודת המילוי הראשון');
  assert.equal(aggrMetrics([]), null);
  installMockFetch();
  const db = new DB(null); const ctx = { db, env: { FINNHUB_KEY: 'x', AUTO_ANY_TIME: '1' }, budget: new Budget(db) };
  await db.put('idx:snapdays', ['2026-09-17']); await db.put('rank:2026-09-17', { table: [{ symbol: 'SPY', price: 500, type: 'etf' }] }); await db.put('regime:2026-09-17', bull);
  assert.equal((await runAggressive(ctx)).ran, false, 'בלי מודל צל');
  await db.put('shadow:2026-09-17', { day: '2026-09-17', rows: rows(), models: { D: { variant: 'D-preRevision' } } });
  const r = await runAggressive(ctx);
  assert.equal(r.ran, true); assert.equal(r.positions, 0, 'בלילה לא ממלאים'); assert.equal(r.pending.length, 6); assert.equal(r.variant, 'D-preRevision');
  assert.equal((await runAggressive(ctx)).ran, false, 'כבר רץ היום');
  const st = await db.get('aggr:state'); assert.equal(st.pending.orders.length, 6); assert.equal(st.cashIls, 200000, 'המזומן לא זז לפני מילוי');
  // ביצוע: ציטוטים מדומים (finnhub mock = סגירה × 1.015) → פער חיובי מול מחיר ההחלטה
  const ex = await executeAggressive(ctx);
  assert.equal(ex.ran, true); assert.equal(ex.filled.length, 6); assert.ok(ex.spyRefSet);
  for (const t of ex.filled){ assert.equal(t.fillKind, 'live-quote'); assert.ok(isFinite(t.gapPct)); assert.ok(t.quotePrice > 0); }
  const st2 = await db.get('aggr:state'); assert.equal(st2.pending, null); assert.equal(Object.keys(st2.positions).length, 6); assert.ok(st2.spyRef > 0);
  assert.equal((await executeAggressive(ctx)).ran, false, 'אין ממתינות');
  const rr = await runAggressive(ctx, { reset: true });
  assert.equal(rr.ran, true); assert.equal(rr.reset, true); assert.equal(rr.model, 'D'); assert.ok((await db.list('aggr:archive:')).length === 1, 'המצב הישן בארכיון');
  const rep = await aggrReport(db);
  assert.ok(rep.pending && rep.pending.orders.length === 6); assert.equal(rep.positions.length, 0); assert.equal(rep.equity.length, 1);
});
const round4 = (x) => Math.round(x * 10000) / 10000;

test('אגרסיבי: היסטוריית חשיפה יומית (מניות/SPY/מזומן בפועל, לא רק יעדים) והסבר קריא לכל פוזיציה (למה נבחרה ומתי תימכר)', async () => {
  installMockFetch();
  const db = new DB(null); const ctx = { db, env: { FINNHUB_KEY: 'x', AUTO_ANY_TIME: '1' }, budget: new Budget(db) };
  await db.put('idx:snapdays', ['2026-09-17']); await db.put('rank:2026-09-17', { table: [{ symbol: 'SPY', price: 500, type: 'etf' }] }); await db.put('regime:2026-09-17', bull);
  await db.put('shadow:2026-09-17', { day: '2026-09-17', rows: rows(), models: { D: { variant: 'D-preRevision' } } });
  await runAggressive(ctx);
  await executeAggressive(ctx);
  const rep = await aggrReport(db);
  // חשיפה יומית: יש רשומה ליום עם מניות/SPY/מזומן בפועל (לא רק את השווי הכולל)
  assert.equal(rep.exposureHistory.length, 1);
  const eh = rep.exposureHistory[0];
  assert.equal(eh.day, '2026-09-17');
  assert.ok(isNum(eh.stocksShare) && isNum(eh.etfShare) && isNum(eh.cashShare));
  assert.ok(eh.positions === 0, 'ביום ההחלטה עוד לא בוצע מילוי — החשיפה שנרשמה היא לפני המילוי');
  // פוזיציה בודדת: הסבר כניסה (ציון/מודל/גורמים) והסבר יציאה (עצירה/עצירה נגררת/סיגנל)
  const pos = rep.positions.find((p) => !p.core);
  assert.ok(pos, 'יש לפחות פוזיציה אחת');
  assert.match(pos.why, /מודל D: STRONG BUY \(ציון \d/);
  assert.match(pos.sellTrigger, /עצירת הפסד 12%/); assert.match(pos.sellTrigger, /עצירה נגררת 15%/);
  assert.ok(isNum(pos.entryScore) && isNum(pos.stopLevel) && pos.stopLevel < pos.entry);
  const core = rep.positions.find((p) => p.core);
  assert.match(core.why, /ליבת התיק/); assert.match(core.sellTrigger, /לא נמכרת/);
});
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
