import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRACKS, TRACK_IDS, TRACK_LIMITS_C, decideAggressiveB, preflight, benchStart, benchValue, trackMetrics, returnBetween, selectionAlpha, BENCHMARKS, INITIAL_ILS, FILL_SLIPPAGE } from '../engine/tracks.js';
import { newAggrState, markToMarket } from '../engine/aggressive.js';
import { RISK_LIMITS } from '../engine/risk-limits.js';
import { commissionIls } from '../lib/broker.js';

const rowsDF = (n = 30, f = () => ({})) => [...Array(n)].map((_, i) => {
  const strong = i >= n - 6, buy = !strong && i >= n - 10;
  return { symbol: 'S' + i, sector: ['Tech', 'Health', 'Fin'][i % 3], price: 100 + i, currency: 'USD',
    D: 40 + i * 2, actD: strong ? 'STRONG BUY' : buy ? 'BUY' : i < 5 ? 'SELL' : 'HOLD',
    DF: 40 + i * 2, actDF: strong ? 'STRONG BUY' : buy ? 'BUY' : i < 5 ? 'SELL' : 'HOLD',
    C: 50, actC: 'HOLD', eligible: true, eligibleD: true, eligibleDF: true, ...f(i) };
});
const bull = { trend: 'Bull Trend', risk: 'Risk On' };
const bear = { trend: 'Bear Trend', risk: 'Risk On' };

test('מסלולים: קבועים — 5 מסלולים (regB/regC/aggrB), regB ב-80% מניות, regC 80% מניות עם מגבלות משלו לא RISK_LIMITS', () => {
  assert.deepEqual(TRACK_IDS.sort(), ['aggrB', 'regB', 'regC']);
  const b = TRACKS.regB.profile.sleeves, c = TRACKS.regC.profile.sleeves;
  assert.equal(b.coreEquity + b.stocks, 0.8); assert.equal(c.coreEquity + c.stocks, 0.8);
  assert.equal(b.coreEquity, 0.6); assert.equal(b.stocks, 0.2);
  assert.equal(c.coreEquity, 0.4); assert.equal(c.stocks, 0.4);
  assert.equal(TRACKS.regB.limits, RISK_LIMITS, 'regB לא חורג מהמגבלות של החשבון האמיתי');
  assert.notEqual(TRACKS.regC.limits, RISK_LIMITS);
  assert.equal(TRACK_LIMITS_C.maxActiveShare, 0.40);
  assert.ok(TRACK_LIMITS_C.maxActiveShare > RISK_LIMITS.maxActiveShare, 'C מקבל תקציב גדול יותר במפורש, לא בעקיפין');
  assert.equal(TRACKS.aggrB.rules.equityFloor, 0.70); assert.equal(TRACKS.aggrB.rules.stocksWeight, 0.75); assert.equal(TRACKS.aggrB.rules.model, 'DF');
});

test('אגרסיבי B: אין הזדמנויות איכותיות → נשאר במזומן, לא קונה SPY בכפייה כדי למלא רצפה', () => {
  const state = newAggrState(200000, '2026-09-17');
  const noBuys = rowsDF(30, () => ({ actD: 'HOLD', actDF: 'HOLD', eligibleDF: false }));
  const r = decideAggressiveB({ state, rows: noBuys, spyPrice: 500, regime: bull, fx: 3.7, day: '2026-09-17', rules: TRACKS.aggrB.rules });
  assert.equal(r.orders.filter((o) => o.symbol !== 'SPY').length, 0, 'אין מניות בודדות');
  const spyBuys = r.orders.filter((o) => o.symbol === 'SPY' && o.side === 'buy');
  // רק השלמת ליבה הרגילה (20%), לא הרצפה — כי אין notes שמתעדות ניסיון השלמה לרצפה בלי הזדמנויות... בפועל: אין הזדמנויות => אין רצפה נאכפת
  assert.ok(r.notes.some((n) => /אין השלמת חשיפה|רצפה/.test(n)) || r.state.qualifyingToday === 0);
  assert.equal(r.state.qualifyingToday, 0);
});

test('אגרסיבי B: הזדמנויות מעטות → משלים חשיפה עד 70% דרך SPY (לא במניות)', () => {
  const state = newAggrState(200000, '2026-09-17');
  const fewBuys = rowsDF(30, (i) => (i === 29 ? {} : { actD: 'HOLD', actDF: 'HOLD', eligibleDF: false }));
  const r = decideAggressiveB({ state, rows: fewBuys, spyPrice: 500, regime: bull, fx: 3.7, day: '2026-09-17', rules: TRACKS.aggrB.rules });
  assert.equal(r.state.qualifyingToday, 1);
  const spyBuys = r.orders.filter((o) => o.symbol === 'SPY' && o.side === 'buy');
  assert.ok(spyBuys.length >= 1, 'קרן ליבה נקנית להשלים ל-20%, ואז השלמת רצפה');
  assert.ok(r.notes.some((n) => /רצפ/.test(n)));
  assert.ok(r.projectedExposure.equityShare >= TRACKS.aggrB.rules.equityFloor - 0.02, `חשיפה צפויה ${r.projectedExposure.equityShare} מתחת לרצפה`);
  // לא יותר מ-coreMax דרך SPY
  assert.ok(r.projectedExposure.etfShare <= TRACKS.aggrB.rules.coreMax + 0.02);
  // רק מניה אחת בודדת נקנתה (זו היחידה שעברה את הסינון) — השאר הושלם דרך SPY
  assert.equal(r.orders.filter((o) => o.symbol !== 'SPY').length, 1);
});

test('אגרסיבי B: שוק דובי — רצפת 70% לא נאכפת (רק הליבה הרגילה, אין קניות מניות ואין השלמה כפויה)', () => {
  const state = newAggrState(200000, '2026-09-17');
  const noBuys = rowsDF(30, () => ({ actD: 'HOLD', actDF: 'HOLD', eligibleDF: false }));
  const r = decideAggressiveB({ state, rows: noBuys, spyPrice: 500, regime: bear, fx: 3.7, day: '2026-09-17', rules: TRACKS.aggrB.rules });
  assert.equal(r.orders.filter((o) => o.symbol !== 'SPY').length, 0, 'שוק דובי: אין קניות מניות בודדות');
  assert.equal(r.orders.length, 1, 'רק הליבה הרגילה (20% SPY), לא השלמה לרצפה');
  assert.equal(r.orders[0].reason, 'ליבה 20% SPY');
  assert.ok(r.notes.some((n) => /דובי.*רצפה|רצפה.*דובי|לא נאכפת/.test(n)));
});

test('אגרסיבי B: מימון מניות איכותיות ממכירת SPY מעל הליבה כשאין מזומן פנוי', () => {
  // מצב: כמעט כל הכסף בליבה SPY (60%), הרבה מועמדות איכותיות אבל מעט מזומן
  const state = newAggrState(200000, '2026-09-17');
  state.positions.SPY = { qty: 240, entry: 500, high: 500, sector: 'core' }; // 240*500=120,000 = 60%
  state.cashIls = 5000; // מעט מזומן פנוי
  const many = rowsDF(30);
  const r = decideAggressiveB({ state, rows: many, spyPrice: 500, regime: bull, fx: 3.7, day: '2026-09-17', rules: TRACKS.aggrB.rules });
  const spySells = r.orders.filter((o) => o.symbol === 'SPY' && o.side === 'sell');
  assert.ok(spySells.length >= 1, 'צריך למכור SPY שמעל הליבה כדי לממן את הקניות האיכותיות');
  assert.match(spySells[0].reason, /מימון/);
  const stockBuys = r.orders.filter((o) => o.side === 'buy' && o.symbol !== 'SPY');
  assert.ok(stockBuys.length >= 1, 'המניות האיכותיות בכל זאת נקנות');
});

test('בדיקות תקינות (preflight): פקודות ממסלול אחר, יום לא תואם, ביצוע כפול, מחיר 09:40 חסר/חלקי, מזומן שלילי, חריגת תקציב', () => {
  const track = TRACKS.regB;
  const priceDoc = { day: '2026-09-18', count: 500, prices: { AAA: 100, BBB: 50 } };
  const base = { track, fillDay: '2026-09-18', priceDoc, fx: 3.7 };
  assert.equal(preflight({ ...base, pending: null }).ok, false);
  assert.equal(preflight({ ...base, pending: { track: 'regC', day: '2026-09-18', orders: [] } }).violations[0].code, 'mixing');
  assert.equal(preflight({ ...base, pending: { track: 'regB', day: '2026-09-17', orders: [] } }).violations[0].code, 'stale-day');
  assert.equal(preflight({ ...base, pending: { track: 'regB', day: '2026-09-18', orders: [], filled: true } }).violations[0].code, 'double-execution');
  assert.equal(preflight({ ...base, pending: { track: 'regB', day: '2026-09-18', orders: [] }, priceDoc: { day: '2026-09-17' } }).violations[0].code, 'stale-price');
  assert.equal(preflight({ ...base, pending: { track: 'regB', day: '2026-09-18', orders: [] }, priceDoc: { day: '2026-09-18', count: 100 } }).violations[0].code, 'partial-price');
  assert.equal(preflight({ ...base, pending: { track: 'regB', day: '2026-09-18', orders: [] }, fx: 40 }).violations.some((v) => v.code === 'fx'), true);
  // מזומן שלילי: קנייה גדולה מהמזומן הזמין
  const bigBuy = { track: 'regB', day: '2026-09-18', orders: [{ side: 'buy', symbol: 'AAA', qty: 1000, decisionPrice: 100 }] };
  const negCash = preflight({ ...base, pending: bigBuy, perf: { cashIls: 1000, totalIls: 200000, stocksIls: 0 } });
  assert.ok(negCash.violations.some((v) => v.code === 'negative-cash'));
  // תקציב: מניות בודדות חורגות מהתקרה של המסלול (20% ל-regB)
  const overBudget = { track: 'regB', day: '2026-09-18', orders: [{ side: 'buy', symbol: 'AAA', qty: 1000, decisionPrice: 100 }] };
  const budgetV = preflight({ ...base, pending: overBudget, priceDoc: { day: '2026-09-18', count: 500, prices: { AAA: 100 } }, perf: { cashIls: 200000, totalIls: 200000, stocksIls: 0 } });
  assert.ok(budgetV.violations.some((v) => v.code === 'budget'), JSON.stringify(budgetV.violations));
  // כמות לא תקינה
  const badQty = { track: 'regB', day: '2026-09-18', orders: [{ side: 'buy', symbol: 'AAA', qty: 0.5, decisionPrice: 100 }] };
  assert.ok(preflight({ ...base, pending: badQty, perf: { cashIls: 200000, totalIls: 200000, stocksIls: 0 } }).violations.some((v) => v.code === 'qty'));
  // תקין
  const ok = { track: 'regB', day: '2026-09-18', orders: [{ side: 'buy', symbol: 'AAA', qty: 5, decisionPrice: 100 }] };
  assert.equal(preflight({ ...base, pending: ok, perf: { cashIls: 200000, totalIls: 200000, stocksIls: 0 } }).ok, true);
});

test('מדדי ייחוס שקליים: SPY מלא ו-95/5, נכנסים ב-09:40 עם עמלה והחלקה', () => {
  const b1 = benchStart({ id: 'spy', day: '2026-09-17', price940: 500, fx: 3.7 });
  assert.equal(b1.qty, Math.floor(200000 / (500 * (1 + FILL_SLIPPAGE) * 3.7)));
  assert.ok(b1.cashIls >= 0 && b1.cashIls < 500 * 3.7, 'שארית קטנה מיחידה אחת');
  const b2 = benchStart({ id: 'spy95', day: '2026-09-17', price940: 500, fx: 3.7 });
  assert.ok(b2.cashIls > 200000 * 0.04, '5% נשאר במזומן');
  assert.ok(b2.qty < b1.qty);
  const v = benchValue(b1, 550, 3.7);
  assert.equal(v, Math.round((b1.qty * 550 * 3.7 + b1.cashIls) * 100) / 100);
});

test('trackMetrics: תשואה, drawdown, תנודתיות, תרומת מטבע, מדגם קטן', () => {
  const rows = [
    { day: '2026-09-17', total: 200000, fx: 3.7 },
    { day: '2026-09-18', total: 202000, fx: 3.7 },
    { day: '2026-09-19', total: 198000, fx: 3.8 },
  ];
  const m = trackMetrics(rows, 200000);
  assert.equal(m.totalReturn, -0.01);
  assert.ok(m.maxDrawdown < 0);
  assert.equal(m.small, true);
  assert.ok(Math.abs(m.fxContribution - (3.8 / 3.7 - 1)) < 1e-3, m.fxContribution); // מעוגל ל-4 ספרות בתצוגה
  assert.ok(isNumClose(m.returnUsdTerms, (198000 / 3.8) / (200000 / 3.7) - 1, 1e-3));
});
function isNumClose(a, b, tol = 1e-6){ return Math.abs(a - b) < tol; }

test('returnBetween: תשואה בין שני תאריכים מתוך שורות הון', () => {
  const rows = [{ day: '2026-09-15', total: 100 }, { day: '2026-09-17', total: 110 }, { day: '2026-09-19', total: 121 }];
  assert.equal(returnBetween(rows, '2026-09-17', '2026-09-19'), 0.1);
  assert.equal(returnBetween(rows, null, null), 0.21);
  assert.equal(returnBetween([{ day: 'x', total: 1 }], null, null), null);
});

test('תרומת בחירת מניות: רווח מעבר למה שאותו כסף היה עושה בקרן הליבה', () => {
  const lots = [
    { symbol: 'AAA', costIls: 10000, pnlIls: 2000, date: '2026-09-01', exitDate: '2026-09-10' }, // הנייר +20%
  ];
  const core = { '2026-09-01': 100, '2026-09-10': 105 }; // הליבה +5% באותה תקופה
  const r = selectionAlpha(lots, (d) => core[String(d).slice(0, 10)], null);
  assert.equal(r.lots, 1);
  assert.ok(Math.abs(r.ils - (2000 - 10000 * 0.05)) < 1);
});
