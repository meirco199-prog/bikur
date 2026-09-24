import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newAccount, fill, valuation, markToMarket, accrue, liquidateIfNeeded, stopExits, simMetrics } from '../engine/margin-sim.js';
import { instrumentOf, commissionUsd, AGENT_INSTRUMENTS } from '../engine/instruments.js';

const px = (m) => (s) => m[s] ?? null;

test('היקום: כל סוגי המכשירים קיימים, לכל מכשיר margin/עמלות/סשן, חוזה סינתטי מפנה ל-proxy קיים', () => {
  const classes = new Set(AGENT_INSTRUMENTS.map((i) => i.class));
  for (const c of ['etf', 'crypto', 'fx', 'future']) assert.ok(classes.has(c), c);
  for (const i of AGENT_INSTRUMENTS){ assert.ok(i.margin && i.margin.initial > 0 && i.margin.maint > 0, i.symbol); assert.ok(['us', '24x7', '24x5', '23h'].includes(i.session), i.symbol); if (i.proxy) assert.ok(instrumentOf(i.proxy), `proxy ${i.proxy} של ${i.symbol}`); }
  assert.equal(new Set(AGENT_INSTRUMENTS.map((i) => i.symbol)).size, AGENT_INSTRUMENTS.length, 'סימבולים ייחודיים');
  assert.equal(commissionUsd(instrumentOf('SPY'), 100, 500), 1, 'מניות: 0.005$/יחידה מינימום 1$');
  assert.equal(Math.round(commissionUsd(instrumentOf('BTC-USD'), 0.1, 60000) * 100) / 100, 10.8, 'קריפטו 0.18%');
  assert.equal(commissionUsd(instrumentOf('MES'), 2, 500), 1.7, 'חוזה 0.85$');
});

test('לונג במניה: מזומן יורד, שערוך, P&L ממומש בסגירה, ספירת wins', () => {
  const st = newAccount(100000, '2026-09-01');
  const f = fill(st, { symbol: 'SPY', side: 'buy', qty: 10, price: 500, day: '2026-09-01', strategy: 'trend', stop: 480 }, instrumentOf('SPY'));
  assert.equal(f.price, 500.25, 'slippage 0.05%'); assert.equal(f.feeUsd, 1);
  assert.equal(st.cashUsd, 100000 - 5002.5 - 1);
  const v = valuation(st, px({ SPY: 520 }), instrumentOf);
  assert.equal(v.longUsd, 5200); assert.equal(v.equityUsd, 100000 - 5003.5 + 5200); assert.equal(v.maintUsd, 1300); assert.equal(v.positions[0].stop, 480);
  const c = fill(st, { symbol: 'SPY', side: 'sell', qty: 10, price: 520, day: '2026-09-05' }, instrumentOf('SPY'));
  assert.ok(c.realizedUsd > 190 && c.realizedUsd < 200, String(c.realizedUsd)); assert.equal(st.trades, 1); assert.equal(st.wins, 1); assert.deepEqual(st.positions, {});
});

test('שורט: מזומן עולה, שווי שורט ב-margin, עלות השאלה, רווח כשהמחיר יורד', () => {
  const st = newAccount(50000, '2026-09-01');
  fill(st, { symbol: 'ARKK', side: 'short', qty: 100, price: 50, day: '2026-09-01' }, instrumentOf('ARKK'));
  assert.ok(st.cashUsd > 50000 + 4990, 'תמורת השורט נכנסת');
  let v = valuation(st, px({ ARKK: 45 }), instrumentOf);
  assert.equal(v.shortUsd, 4500); assert.equal(v.positions[0].side, 'short'); assert.equal(v.positions[0].maintUsd, 1350, 'שורט: 30% תחזוקה'); assert.ok(v.unrealizedUsd > 490);
  const a = accrue(st, v, instrumentOf, 30);
  assert.ok(a.borrowUsd > 1.8 && a.borrowUsd < 1.9, 'השאלה 0.5% לשנה על 4500$ ל-30 יום: ' + a.borrowUsd); assert.equal(a.interestUsd, 0, 'אין הלוואה — אין ריבית');
  const c = fill(st, { symbol: 'ARKK', side: 'cover', qty: 100, price: 45, day: '2026-09-10' }, instrumentOf('ARKK'));
  assert.ok(c.realizedUsd > 490 && c.realizedUsd < 500, String(c.realizedUsd));
});

test('חוזה סינתטי: אין מזומן בפתיחה, סילוק יומי למזומן, margin 8%/6.5%, מינוף אפקטיבי', () => {
  const st = newAccount(20000, '2026-09-01');
  const inst = instrumentOf('MES');
  fill(st, { symbol: 'MES', side: 'buy', qty: 1, price: 500, day: '2026-09-01' }, inst);
  assert.equal(st.cashUsd, 20000 - 0.85, 'רק עמלה');
  let v = valuation(st, px({ MES: 500.1 }), instrumentOf);
  assert.equal(v.grossUsd, 25005); assert.equal(v.maintUsd, 1625.33); assert.ok(v.leverage > 1.2, 'מינוף ' + v.leverage);
  markToMarket(st, px({ MES: 505 }), instrumentOf, '2026-09-02');
  assert.ok(st.cashUsd > 20000 + 240, 'סילוק יומי: (505−500.1)×50 ≈ 245$: ' + st.cashUsd);
  markToMarket(st, px({ MES: 500 }), instrumentOf, '2026-09-03');
  assert.ok(st.cashUsd < 20000, 'ירידה מסולקת גם היא');
});

test('הלוואת margin: ריבית יומית על מזומן שלילי; חיסול כפוי כשהנזילות העודפת שלילית', () => {
  const st = newAccount(10000, '2026-09-01');
  fill(st, { symbol: 'TQQQ', side: 'buy', qty: 300, price: 60, day: '2026-09-01' }, instrumentOf('TQQQ')); // 18,000$ עם 10,000$ הון
  assert.ok(st.cashUsd < -7900, 'הלוואה');
  let v = valuation(st, px({ TQQQ: 60 }), instrumentOf);
  assert.equal(v.marginLoanUsd, -st.cashUsd); assert.ok(v.leverage > 5, 'ETF פי 3 על מינוף 1.8 = חשיפה אפקטיבית ' + v.leverage);
  const a = accrue(st, v, instrumentOf, 1);
  assert.ok(a.interestUsd > 1.2 && a.interestUsd < 1.4, 'ריבית 5.83% לשנה על ~8000$ ליום: ' + a.interestUsd);
  // ירידה של 40%: שווי 10,800$, הון ≈ 2,800$, תחזוקה 75%×10,800 = 8,100$ → חיסול
  const acts = liquidateIfNeeded(st, px({ TQQQ: 36 }), instrumentOf, '2026-09-02');
  assert.equal(acts.length, 1); assert.equal(acts[0].forced, true); assert.deepEqual(st.positions, {}); assert.equal(st.liquidations, 1);
  assert.ok(st.cashUsd > 2500 && st.cashUsd < 2900, 'נשאר ~2,700$ אחרי חיסול עם slippage: ' + st.cashUsd);
});

test('עצירות: לונג נסגר כשהנמוך של היום מתחת ל-stop, שורט כשהגבוה מעל', () => {
  const st = newAccount(50000, '2026-09-01');
  fill(st, { symbol: 'GLD', side: 'buy', qty: 10, price: 300, day: '2026-09-01', stop: 290 }, instrumentOf('GLD'));
  fill(st, { symbol: 'USO', side: 'short', qty: 50, price: 70, day: '2026-09-01', stop: 75 }, instrumentOf('USO'));
  const ex = stopExits(st, { lowOf: px({ GLD: 288, USO: 69 }), highOf: px({ GLD: 301, USO: 76 }), priceOf: px({ GLD: 295, USO: 74 }) }, instrumentOf, '2026-09-02');
  assert.equal(ex.length, 2); assert.deepEqual(st.positions, {});
  assert.ok(ex[0].price <= 290 && ex[0].price > 289, 'לונג יוצא ב-stop עם slippage: ' + ex[0].price);
  assert.ok(ex[1].price >= 75, 'שורט מכוסה ב-stop: ' + ex[1].price);
});

test('מדדים: תשואה, מול SPY, ירידה מרבית', () => {
  const m = simMetrics([['d1', 100000, 500], ['d2', 104000, 505], ['d3', 98800, 500], ['d4', 101000, 510]], 100000);
  assert.equal(m.totalReturn, 0.01); assert.equal(m.spyReturn, 0.02); assert.equal(m.excess, -0.01); assert.equal(m.maxDrawdown, 0.05); assert.equal(m.days, 4);
});
