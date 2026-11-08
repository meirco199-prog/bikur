// מעבדת האסטרטגיות — בדיקות המנוע (דרישה 15): עסקאות ידניות, look-ahead, ימים ללא מסחר, מחיקה, פיצולים/דיבידנדים, מחירים חסרים,
// תיק רב-פוזיציות, עלויות ומינוף, מחירים בלתי אפשריים, תשואה מצטברת.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dataset, Series, rowsToCompact, membershipFromDaily, isMember, dayNum, isoOf } from '../engine/lab/data.js';
import { simulate, commission } from '../engine/lab/simulate.js';
import { analyze, seriesMetrics, maxDrawdown } from '../engine/lab/metrics.js';
import { normalizeSpec, explainSpec } from '../engine/lab/schema.js';
import { compile, describe } from '../engine/lab/rules.js';
import { FeatureCache } from '../engine/lab/features.js';
import { syntheticRows, tradingDates } from './helpers.mjs';

// עוזר: סדרה מרשימת סגירות (פתיחה = סגירה קודמת, high/low סביב)
const D = tradingDates(40, '2020-01-02');
function mk(sym, closes, { opens = null, highs = null, lows = null, vol = 1e6, start = 0, div = [], split = [] } = {}){
  const rows = closes.map((c, i) => { const o = opens ? opens[i] : (i ? closes[i - 1] : c); const h = highs ? highs[i] : Math.max(o, c) * 1.01, l = lows ? lows[i] : Math.min(o, c) * 0.99; return [D[start + i], o, h, l, c, vol]; });
  return rowsToCompact(sym, rows, { div, split });
}
const NOCOST = { model: 'none' };
const base = (over = {}) => ({ name: 't', universe: { type: 'list', symbols: ['A', 'B', 'C'], filters: { minPrice: 0, minDollarVol: 0, minBars: 2 } }, signal: { rank: { feature: 'ret', params: { days: 1 }, order: 'asc', top: 1 } }, entry: { timing: 'next_open' }, exit: { rules: [{ type: 'time', days: 1, at: 'close' }] }, sizing: { capital: 10000, maxPositions: 1 }, costs: NOCOST, benchmarks: [], ...over });

test('עסקה ידנית: היורדת ביותר נקנית בפתיחה למחרת ונמכרת בסגירה — P&L מחושב ידנית', () => {
  // יום 1→2: A יורדת 10%, B עולה, C יציבה. למחרת (יום 3) A נפתחת ב-92 ונסגרת ב-95.
  const A = mk('A', [100, 90, 95, 96, 97], { opens: [100, 100, 92, 95, 96] }), B = mk('B', [50, 55, 56, 57, 58]), C = mk('C', [20, 20, 20, 20, 20]);
  const ds = new Dataset({ series: [A, B, C] });
  const r = simulate(ds, base());
  assert.equal(r.trades.length, 3); // אותות בימים 2,3,4 → עסקאות בימים 3,4,5 (ביום 1 אין תשואה, ביום האחרון אין אות)
  const t = r.trades[0];
  assert.equal(t.symbol, 'A'); assert.equal(t.signalDate, D[1]); assert.equal(t.entryDate, D[2]); assert.equal(t.exitDate, D[2]);
  assert.equal(t.entryPrice, 92); assert.equal(t.exitPrice, 95);
  assert.equal(t.shares, Math.floor(10000 / 92)); // 108
  assert.equal(t.pnl, +(108 * 3).toFixed(2));
  assert.equal(t.holdDays, 1);
  // אין קנייה במחיר הסגירה של יום הירידה (90)
  assert.notEqual(t.entryPrice, 90);
});

test('תשואה מצטברת: ההון הסופי = הון התחלתי + סכום ה-P&L של כל העסקאות (כולל עלויות ודיבידנדים)', () => {
  const syms = ['A', 'B', 'C', 'D', 'E'];
  const ds = new Dataset({ series: syms.map((s, i) => rowsToCompact(s, syntheticRows({ n: 400, seed: i + 3, price: 40 + i * 7 }))) });
  for (const costs of [NOCOST, { model: 'ibkr_fixed' }, { model: 'bps', bps: 10, slippageBps: 5 }]){
    const r = simulate(ds, base({ universe: { type: 'list', symbols: syms, filters: { minPrice: 0, minDollarVol: 0, minBars: 2 } }, signal: { rank: { feature: 'ret', params: { days: 2 }, order: 'asc', top: 2 } }, exit: { rules: [{ type: 'time', days: 3, at: 'close' }, { type: 'stop_loss', pct: 0.04 }] }, sizing: { capital: 20000, maxPositions: 2 }, costs }));
    const sum = r.trades.reduce((a, t) => a + t.pnl, 0);
    assert.ok(Math.abs(r.finalEquity - (20000 + sum)) < 0.05 * r.trades.length / 10 + 0.05, `${costs.model}: ${r.finalEquity} vs ${20000 + sum}`);
    assert.equal(r.equity[r.equity.length - 1][1], r.finalEquity);
  }
});

test('Look-ahead: חיתוך הנתונים בתאריך D לא משנה אף עסקה שנסגרה לפני D (אינווריאנטיות prefix)', () => {
  const syms = ['A', 'B', 'C', 'D', 'E', 'F'];
  const full = syms.map((s, i) => rowsToCompact(s, syntheticRows({ n: 500, seed: i + 11, price: 30 + i * 5 })));
  const spec = base({ universe: { type: 'list', symbols: syms, filters: { minPrice: 0, minDollarVol: 0, minBars: 30 } }, signal: { conditions: { all: [{ feature: 'rsi', params: { n: 14 }, op: '<', value: 45 }] }, rank: { feature: 'ret', params: { days: 3 }, order: 'asc', top: 2 } }, exit: { rules: [{ type: 'time', days: 4, at: 'close' }, { type: 'take_profit', pct: 0.03 }, { type: 'trailing_stop', pct: 0.05 }] }, sizing: { capital: 30000, maxPositions: 2 } });
  const rFull = simulate(new Dataset({ series: full }), spec);
  const cut = 350, cutDate = isoOf(full[0].d[cut]);
  const rCut = simulate(new Dataset({ series: full.map((c) => new Series(c).slice(-Infinity, full[0].d[cut])) }), spec);
  const before = rFull.trades.filter((t) => t.exitDate < cutDate), beforeCut = rCut.trades.filter((t) => t.exitDate < cutDate);
  assert.ok(before.length > 20);
  assert.deepEqual(beforeCut.map((t) => [t.symbol, t.entryDate, t.entryPrice, t.exitDate, t.exitPrice, t.shares]), before.map((t) => [t.symbol, t.entryDate, t.entryPrice, t.exitDate, t.exitPrice, t.shares]));
  // גם עקומת ההון זהה עד יום החיתוך (לפני שפוזיציות פתוחות נסגרות בכפייה)
  const eqA = rFull.equity.filter((e) => e[0] < cutDate).slice(0, -5), eqB = rCut.equity.filter((e) => e[0] < cutDate).slice(0, eqA.length);
  assert.deepEqual(eqB, eqA);
});

test('ימים ללא מסחר: לוח השנה הוא איחוד; נייר בלי נר ביום הביצוע לא נקנה (skipped.no_bar) ולא מומצא לו מחיר', () => {
  const A = mk('A', [100, 90, 95, 96, 97, 98]);
  const Bc = mk('B', [50, 52, 51, 53, 54, 55]);
  // ל-B חסר הנר של יום 3 (אינדקס 2)
  const B = { ...Bc, d: Bc.d.filter((_, i) => i !== 2), o: Bc.o.filter((_, i) => i !== 2), h: Bc.h.filter((_, i) => i !== 2), l: Bc.l.filter((_, i) => i !== 2), c: Bc.c.filter((_, i) => i !== 2), v: Bc.v.filter((_, i) => i !== 2), a: Bc.a.filter((_, i) => i !== 2) };
  const ds = new Dataset({ series: [A, B] });
  assert.equal(ds.n, 6); assert.equal(ds.bar('B', 2), null);
  // אות ביום 2: A ירדה 10%, B עלתה → A. ביום 2 (אינדקס 1) B עלתה; נכריח בחירה של B ע"י top=2
  const r = simulate(ds, base({ universe: { type: 'list', symbols: ['A', 'B'], filters: { minPrice: 0, minDollarVol: 0, minBars: 2 } }, signal: { rank: { feature: 'ret', params: { days: 1 }, order: 'asc', top: 2 } }, sizing: { capital: 10000, maxPositions: 2 } }));
  assert.ok(r.skipped.no_bar >= 1);
  assert.ok(!r.trades.some((t) => t.symbol === 'B' && t.entryDate === D[2]));
});

test('מניה שנמחקה: פוזיציה פתוחה נסגרת בכפייה בסגירה האחרונה הידועה, ולא נשארת "תלויה"', () => {
  const A = mk('A', [100, 80, 70, 60]); // נמחקת אחרי יום 4
  const B = mk('B', [50, 50, 50, 50, 50, 50, 50, 50]), C = mk('C', [20, 20, 20, 20, 20, 20, 20, 20]);
  const ds = new Dataset({ series: [A, B, C] });
  const r = simulate(ds, base({ exit: { rules: [{ type: 'time', days: 30, at: 'close' }] } }));
  const t = r.trades.find((x) => x.symbol === 'A');
  assert.ok(t); assert.equal(t.entryDate, D[2]); assert.equal(t.exitDate, D[3]); assert.equal(t.exitPrice, 60);
  assert.match(t.exitReason, /נמחקה/);
});

test('פיצול 2:1 בזמן החזקה: הכמות מוכפלת, מחיר הכניסה מחולק, ה-P&L כאילו לא היה פיצול', () => {
  // A: קנייה ב-100 (פתיחה יום 3), פיצול ביום 4 (מחיר 55 = 110 לפני פיצול), מכירה ביום 5 ב-60 (=120)
  const A = mk('A', [100, 90, 100, 55, 60], { opens: [100, 100, 100, 54, 57], highs: [101, 101, 101, 56, 61], lows: [99, 89, 99, 53, 56], split: [[D[3], 2]] });
  const B = mk('B', [50, 51, 52, 53, 54]), C = mk('C', [20, 20, 20, 20, 20]);
  const ds = new Dataset({ series: [A, B, C] });
  const r = simulate(ds, base({ exit: { rules: [{ type: 'time', days: 3, at: 'close' }] }, sizing: { capital: 10000, maxPositions: 1 } }));
  const t = r.trades.find((x) => x.symbol === 'A' && x.entryDate === D[2]);
  assert.equal(t.shares, 200); assert.equal(t.entryPrice, 50); assert.equal(t.exitPrice, 60);
  assert.equal(t.pnl, 2000); // 100 מניות × (120−100)
});

test('דיבידנד ב-ex-date נזקף ללונג (ונגבה משורט); ללא דיבידנדים כשה-costs.dividends=false', () => {
  const A = mk('A', [100, 90, 90, 90, 90], { opens: [100, 100, 90, 90, 90], div: [[D[3], 1.5]] });
  const B = mk('B', [50, 51, 52, 53, 54]), C = mk('C', [20, 20, 20, 20, 20]);
  const ds = new Dataset({ series: [A, B, C] });
  const spec = base({ exit: { rules: [{ type: 'time', days: 3, at: 'close' }] } });
  const r = simulate(ds, spec); const t = r.trades.find((x) => x.symbol === 'A');
  assert.equal(t.shares, 111); assert.equal(t.dividends, +(111 * 1.5).toFixed(2)); assert.equal(t.pnl, +(111 * 1.5).toFixed(2));
  const r2 = simulate(ds, base({ exit: { rules: [{ type: 'time', days: 3, at: 'close' }] }, costs: { model: 'none', dividends: false } }));
  assert.equal(r2.trades.find((x) => x.symbol === 'A').dividends, 0);
  const r3 = simulate(ds, base({ signal: { direction: 'short', rank: { feature: 'ret', params: { days: 1 }, order: 'asc', top: 1 } }, exit: { rules: [{ type: 'time', days: 3, at: 'close' }] }, costs: { model: 'none', shortBorrowAnnualPct: 0 } }));
  assert.equal(r3.trades.find((x) => x.symbol === 'A').dividends, -(+(111 * 1.5).toFixed(2)));
});

test('מחירים בלתי אפשריים: סטופ/יעד מתמלאים רק אם הנר נגע ברמה; פער בפתיחה → מחיר הפתיחה; שתי הרמות באותו נר → סטופ (שמרני)', () => {
  // כניסה בפתיחה 100 ביום 3. יום 3: high 103, low 99 → יעד 5% לא, סטופ 3% לא. יום 4: low 96, high 106 → שניהם → סטופ ב-97.
  const A = mk('A', [100, 90, 101, 100, 100], { opens: [100, 100, 100, 100, 100], highs: [101, 101, 103, 106, 101], lows: [99, 89, 99, 96, 99] });
  const B = mk('B', [50, 51, 52, 53, 54]), C = mk('C', [20, 20, 20, 20, 20]);
  const r = simulate(new Dataset({ series: [A, B, C] }), base({ exit: { rules: [{ type: 'take_profit', pct: 0.05 }, { type: 'stop_loss', pct: 0.03 }, { type: 'time', days: 10 }] } }));
  const t = r.trades.find((x) => x.symbol === 'A'); assert.equal(t.exitDate, D[3]); assert.equal(t.exitPrice, 97); assert.match(t.exitReason, /סטופ/);
  // פער: יום 4 נפתח ב-90 (מתחת לסטופ 97) → יציאה ב-90, לא ב-97
  const A2 = mk('A', [100, 90, 101, 91, 100], { opens: [100, 100, 100, 90, 100], highs: [101, 101, 103, 92, 101], lows: [99, 89, 99, 88, 99] });
  const r2 = simulate(new Dataset({ series: [A2, B, C] }), base({ exit: { rules: [{ type: 'stop_loss', pct: 0.03 }, { type: 'time', days: 10 }] } }));
  const t2 = r2.trades.find((x) => x.symbol === 'A'); assert.equal(t2.exitPrice, 90); assert.match(t2.exitReason, /פער/);
  // כל מחיר ביצוע נמצא בתוך טווח הנר של יומו
  for (const tr of [...r.trades, ...r2.trades]){ const ds = tr.symbol === 'A' && r2.trades.includes(tr) ? A2 : tr.symbol === 'A' ? A : tr.symbol === 'B' ? B : C; const i = ds.d.indexOf(dayNum(tr.exitDate)); assert.ok(tr.exitPrice >= ds.l[i] - 1e-9 && tr.exitPrice <= ds.h[i] + 1e-9, `${tr.symbol} ${tr.exitDate} ${tr.exitPrice} not in [${ds.l[i]},${ds.h[i]}]`); }
});

test('פקודת Limit מתמלאת רק כשהמחיר נגע בה (ובפתיחה נמוכה — במחיר הפתיחה); אחרת פגה ונספרת', () => {
  const A = mk('A', [100, 90, 95, 96, 97, 98], { opens: [100, 100, 91, 95, 96, 97], lows: [99, 89, 88, 94, 95, 96], highs: [101, 101, 96, 97, 98, 99] });
  const B = mk('B', [50, 51, 52, 53, 54, 55]), C = mk('C', [20, 20, 20, 20, 20, 20]);
  const ds = new Dataset({ series: [A, B, C] });
  // limit 1% מתחת ל-90 = 89.1; ביום 3 הפתיחה 91 > 89.1 אבל low 88 → מילוי ב-89.1
  const r = simulate(ds, base({ entry: { timing: 'limit', limitPct: -0.01, validDays: 1 }, exit: { rules: [{ type: 'time', days: 1 }] } }));
  const t = r.trades.find((x) => x.symbol === 'A' && x.entryDate === D[2]); assert.ok(t); assert.equal(t.entryPrice, +(89.1).toFixed(4));
  // limit 5% מתחת (85.5) — לא נגע → אין עסקה ונספר
  const r2 = simulate(ds, base({ entry: { timing: 'limit', limitPct: -0.05, validDays: 1 }, exit: { rules: [{ type: 'time', days: 1 }] } }));
  assert.ok(!r2.trades.some((x) => x.symbol === 'A' && x.entryDate === D[2])); assert.ok(r2.skipped.limit_not_filled >= 1);
});

test('תיק רב-פוזיציות: חלוקה שווה לפי מקומות, מזומן לא יורד מתחת לאפס במינוף 1, חשיפה ≤ הון×מינוף במינוף 2', () => {
  const syms = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  const ds = new Dataset({ series: syms.map((s, i) => rowsToCompact(s, syntheticRows({ n: 300, seed: i + 21, price: 20 + i * 9 }))) });
  const spec = base({ universe: { type: 'list', symbols: syms, filters: { minPrice: 0, minDollarVol: 0, minBars: 2 } }, signal: { rank: { feature: 'ret', params: { days: 1 }, order: 'asc', top: 4 } }, exit: { rules: [{ type: 'time', days: 3, at: 'close' }] }, sizing: { capital: 40000, maxPositions: 4 } });
  const r = simulate(ds, spec);
  assert.ok(r.trades.length > 50);
  for (const e of r.equity) assert.ok(e[2] >= -1e-6, 'מזומן שלילי במינוף 1');
  for (const e of r.equity) assert.ok(e[4] <= 4);
  const first = r.trades[0]; assert.ok(first.shares * first.entryPrice <= 10000 + 1e-6 && first.shares * first.entryPrice > 9000);
  const r2 = simulate(ds, { ...spec, sizing: { capital: 40000, maxPositions: 4, leverage: 2 }, costs: { model: 'none', marginAnnualPct: 0 } });
  for (const e of r2.equity) assert.ok(e[3] <= 2.15, `חשיפה ${e[3]} > 2 (מעבר לתזוזת שוק תוך-יומית)`);
  assert.ok(r2.equity.some((e) => e[3] > 1.2), 'המינוף לא נוצל');
  const r3 = simulate(ds, { ...spec, sizing: { capital: 40000, maxPositions: 4, leverage: 2 }, costs: { model: 'none', marginAnnualPct: 6 } });
  assert.ok(r3.totals.margin > 0, 'ריבית מרג\'ין לא נגבתה');
});

test('עלויות IBKR: עמלה מינימום 1$, 0.005$/מניה, תקרה 1%; החלקה לרעת הסוחר בשני הצדדים; עמלות רגולטור רק במכירה', () => {
  const C = { model: 'ibkr_fixed', perShare: 0.005, minPerOrder: 1, maxPctOfTrade: 0.01, slippageBps: 5, spreadBps: 0, regulatorySell: true };
  assert.equal(commission(C, 100, 50), 1); assert.equal(commission(C, 1000, 50), 5); assert.equal(commission(C, 1000, 0.2), 2); // תקרה 1% מ-200$
  const A = mk('A', [100, 90, 95, 96, 97], { opens: [100, 100, 92, 95, 96] }), B = mk('B', [50, 55, 56, 57, 58]), Cc = mk('C', [20, 20, 20, 20, 20]);
  const r = simulate(new Dataset({ series: [A, B, Cc] }), base({ costs: C }));
  const t = r.trades[0]; assert.equal(t.entryPrice, +(92 * 1.0005).toFixed(4)); assert.equal(t.exitPrice, +(95 * 0.9995).toFixed(4));
  assert.ok(t.costs.fees > 0 && t.costs.commission >= 2);
  const gross = t.shares * (t.exitPrice - t.entryPrice); assert.ok(Math.abs(t.pnl - (gross - t.costs.commission - t.costs.fees)) < 0.02);
});

test('שורט: רווח כשהמחיר יורד, עלות השאלה נצברת, סטופ מעל מחיר הכניסה', () => {
  const A = mk('A', [100, 110, 105, 100, 95], { opens: [100, 100, 110, 105, 100], highs: [101, 111, 111, 106, 101], lows: [99, 99, 104, 99, 94] }), B = mk('B', [50, 50, 50, 50, 50]), C = mk('C', [20, 20, 20, 20, 20]);
  const r = simulate(new Dataset({ series: [A, B, C] }), base({ signal: { direction: 'short', rank: { feature: 'ret', params: { days: 1 }, order: 'desc', top: 1 } }, exit: { rules: [{ type: 'time', days: 3, at: 'close' }, { type: 'stop_loss', pct: 0.05 }] }, costs: { model: 'none', shortBorrowAnnualPct: 3.6 } }));
  const t = r.trades.find((x) => x.symbol === 'A'); assert.equal(t.side, 'short'); assert.equal(t.entryPrice, 110); assert.equal(t.exitPrice, 95);
  assert.ok(t.costs.borrow > 0); assert.ok(Math.abs(t.pnl - (90 * 15 - t.costs.borrow)) < 0.01);
});

test('יציאת תנאי (RSI) ויציאה מהדירוג מתבצעות בפתיחה למחרת; סטופ נגרר עוקב אחרי השיא', () => {
  const syms = ['A', 'B', 'C', 'D'];
  const ds = new Dataset({ series: syms.map((s, i) => rowsToCompact(s, syntheticRows({ n: 300, seed: i + 31, price: 50 }))) });
  const r = simulate(ds, base({ universe: { type: 'list', symbols: syms, filters: { minPrice: 0, minDollarVol: 0, minBars: 20 } }, signal: { rank: { feature: 'ret', params: { days: 5 }, order: 'asc', top: 2 } }, exit: { rules: [{ type: 'condition', at: 'next_open', conditions: { feature: 'rsi', params: { n: 5 }, op: '>', value: 60 } }, { type: 'rank_exit', at: 'next_open' }, { type: 'trailing_stop', pct: 0.04 }, { type: 'time', days: 30 }] }, sizing: { capital: 20000, maxPositions: 2 } }));
  assert.ok(r.trades.some((t) => /תנאי יציאה|יצאה מהדירוג/.test(t.exitReason) && /פתיחה/.test(t.exitReason)));
  assert.ok(r.trades.some((t) => /נגרר/.test(t.exitReason)));
  for (const t of r.trades.filter((x) => /נגרר/.test(x.exitReason) && !/פער/.test(x.exitReason))) assert.ok(t.exitPrice < t.entryPrice * (1 + t.mfe), 'הנגרר יצא מתחת לשיא');
});

test('חברות במדד point-in-time: מניה שלא הייתה במדד ביום האות לא נבחרת; דוח כיסוי מונה חברים ללא נתונים', () => {
  const A = mk('A', [100, 80, 90, 91, 92]), B = mk('B', [50, 49, 50, 51, 52]), C = mk('C', [20, 20, 20, 20, 20]);
  const universe = membershipFromDaily([{ day: D[0], symbols: ['B', 'C', 'ZZZ'] }, { day: D[3], symbols: ['A', 'B', 'C', 'ZZZ'] }]);
  assert.ok(isMember(universe.members.A, dayNum(D[3])) && !isMember(universe.members.A, dayNum(D[1])));
  const ds = new Dataset({ series: [A, B, C], universe });
  const r = simulate(ds, base({ universe: { type: 'index', index: 'sp500', pointInTime: true, filters: { minPrice: 0, minDollarVol: 0, minBars: 2 } } }));
  // ביום 2 A ירדה 20% אבל לא הייתה במדד → נבחרת B (ירדה 2%)
  assert.equal(r.trades[0].symbol, 'B');
  assert.equal(r.coverage.pointInTime, true); assert.deepEqual(r.coverage.missing, ['ZZZ']); assert.equal(r.coverage.total, 4);
  assert.ok(r.limited === false || r.coverage.ratio < 0.9);
});

test('מסנני תקופה: ימים בשבוע, מצב שוק (SPY מתחת ל-SMA → אין כניסות) ומגבלת הפסד יומי', () => {
  const syms = ['A', 'B', 'C'];
  const series = syms.map((s, i) => rowsToCompact(s, syntheticRows({ n: 300, seed: i + 41, price: 50 })));
  series.push(rowsToCompact('SPY', syntheticRows({ n: 300, seed: 99, price: 300, drift: -0.004 })));
  const ds = new Dataset({ series });
  const r = simulate(ds, base({ period: { weekdays: [1, 2] }, benchmarks: ['SPY'] }));
  for (const t of r.trades) assert.ok([1, 2].includes(new Date(t.entryDate + 'T00:00:00Z').getUTCDay()));
  const r2 = simulate(ds, base({ period: { regime: 'bull', regimeSymbol: 'SPY', regimeSma: 50 }, benchmarks: ['SPY'] }));
  const r3 = simulate(ds, base({ benchmarks: ['SPY'] }));
  assert.ok(r2.trades.length < r3.trades.length && r2.skipped.regime > 0);
  const r4 = simulate(ds, base({ universe: { type: 'list', symbols: syms, filters: { minPrice: 0, minDollarVol: 0, minBars: 2 } }, signal: { rank: { feature: 'ret', params: { days: 1 }, order: 'asc', top: 3 } }, exit: { rules: [{ type: 'time', days: 10 }] }, sizing: { capital: 30000, maxPositions: 3, dailyLossLimitPct: 0.01 } }));
  assert.ok(r4.trades.some((t) => /מגבלת הפסד יומי/.test(t.exitReason)));
});

test('מדדים: עקומת הון ידועה → CAGR, Max Drawdown, Sharpe; פילוחים וחום חודשי', () => {
  const eq = [['2020-01-01', 100], ['2020-07-01', 120], ['2021-01-01', 90], ['2021-07-01', 110], ['2022-01-01', 121]];
  const m = seriesMetrics(eq);
  assert.equal(m.totalReturn, 0.21); assert.ok(Math.abs(m.cagr - (Math.pow(1.21, 1 / 2.0027) - 1)) < 0.002);
  assert.equal(m.maxDD, -0.25); assert.equal(m.peakDate, '2020-07-01'); assert.equal(m.troughDate, '2021-01-01'); assert.equal(m.recoveryDate, '2022-01-01');
  const dd = maxDrawdown([['a', 100], ['b', 50], ['c', 60]]); assert.equal(dd.maxDD, -0.5); assert.equal(dd.recovered, false);
  const syms = ['A', 'B', 'C', 'D'];
  const ds = new Dataset({ series: [...syms.map((s, i) => rowsToCompact(s, syntheticRows({ n: 600, seed: i + 51, price: 50 }))), rowsToCompact('SPY', syntheticRows({ n: 600, seed: 5, price: 300 }))] });
  const r = simulate(ds, base({ universe: { type: 'list', symbols: syms, filters: { minPrice: 0, minDollarVol: 0, minBars: 2 } }, benchmarks: ['SPY'] }));
  const a = analyze(r);
  assert.ok(a.trades.count > 100 && a.trades.winRate > 0 && a.trades.winRate < 1);
  assert.ok(a.periodic.heatmap.length >= 2 && a.periodic.heatmap[0].months.length === 12);
  assert.ok(a.breakdowns.byWeekday.length >= 4 && a.breakdowns.byHold[0].key === '1');
  assert.ok(a.benchmarks.SPY.metrics.cagr !== undefined && a.benchmarks.SPY.relative.beta !== null);
  assert.ok(Math.abs(a.trades.netPnl - (r.finalEquity - 10000)) < 1);
});

test('סכימה: שגיאות ברורות בעברית על קלט לא תקין; הסבר מלא לפני הרצה', () => {
  assert.throws(() => normalizeSpec({ signal: {} }), /תנאי כניסה או דירוג/);
  assert.throws(() => normalizeSpec({ signal: { rank: { feature: 'nope' } } }), /מאפיין לא מוכר/);
  assert.throws(() => normalizeSpec({ signal: { rank: { feature: 'ret' } }, period: { from: '2020-01-01', to: '2019-01-01' } }), /לפני הסיום/);
  assert.throws(() => normalizeSpec({ signal: { conditions: { feature: 'rsi', op: '<<', value: 1 } } }), /אופרטור לא מוכר/);
  assert.throws(() => normalizeSpec({ signal: { rank: { feature: 'ret' } }, exit: { rules: [{ type: 'rank_exit' }] }, signal: { conditions: { feature: 'rsi', op: '<', value: 30 } } }), /rank_exit/);
  const ex = explainSpec({ signal: { rank: { feature: 'ret', params: { days: 1 }, order: 'asc', top: 10 } }, exit: { rules: [{ type: 'time', days: 1 }] } });
  assert.equal(ex.sections.length, 7); assert.ok(ex.sections[2].lines.some((l) => /10 הנמוכות/.test(l)));
  const d = describe({ all: [{ feature: 'ret', params: { days: 3 }, op: '<', value: -0.08 }, { not: { field: 'sector', op: 'in', value: ['Energy'] } }] });
  assert.match(d, /−8\.0%/); assert.match(d, /NOT/);
});

test('עץ תנאים: AND/OR/NOT מקוננים, השוואה למאפיין אחר, top_n רוחבי, וחסר → false + ספירה', () => {
  const s1 = rowsToCompact('A', syntheticRows({ n: 100, seed: 1 })), s2 = rowsToCompact('B', syntheticRows({ n: 100, seed: 2 })), s3 = rowsToCompact('C', syntheticRows({ n: 5, seed: 3 }));
  const ds = new Dataset({ series: [s1, s2, s3] }), fc = new FeatureCache(), k = ds.n - 1;
  const c = compile({ any: [{ all: [{ feature: 'rsi', params: { n: 14 }, op: 'between', value: [0, 100] }, { not: { feature: 'close', op: '>', value: 1e9 } }] }, { feature: 'volume', op: '>', value: { feature: 'volume', mult: 100 } }] });
  const ctx = { k, missing: 0, val: (sym, key) => { const i = ds.rowIndex(sym, k); const [n, p] = key.match(/^(\w+)(?:\((.*)\))?$/).slice(1); const ps = n === 'rsi' ? { n: +p } : {}; return i < 0 ? NaN : fc.get(ds.series.get(sym), n, ps)[i]; }, prev: () => NaN, attr: () => null, xsPct: () => NaN, xsRank: () => NaN };
  assert.equal(c.test(ctx, 'A'), true); assert.equal(c.test(ctx, 'B'), true);
  assert.equal(c.test(ctx, 'C'), false); assert.ok(ctx.missing > 0); // ל-C אין נר ביום האחרון → NaN
  const c2 = compile({ feature: 'ret', params: { days: 1 }, op: 'bottom_n', value: 2 }); assert.equal(c2.features.size, 1);
});

test('סורק היסטורי (scanAt): אותו מנוע אותות כמו הסימולציה — הבחירות ליום זהות לעסקאות שנפתחו למחרת', async () => {
  const { scanAt } = await import('../engine/lab/signals.js');
  const syms = ['A', 'B', 'C', 'D', 'E'];
  const ds = new Dataset({ series: syms.map((s, i) => rowsToCompact(s, syntheticRows({ n: 300, seed: i + 61, price: 50 }), { meta: { name: 'חברה ' + s, sector: 'Tech' } })) });
  const spec = base({ universe: { type: 'list', symbols: syms, filters: { minPrice: 0, minDollarVol: 0, minBars: 20 } }, signal: { conditions: { all: [{ feature: 'rsi', params: { n: 5 }, op: '<', value: 60 }] }, rank: { feature: 'ret', params: { days: 2 }, order: 'asc', top: 2 } }, sizing: { capital: 20000, maxPositions: 2 } });
  const r = simulate(ds, spec); const day = r.trades[40].signalDate;
  const sc = scanAt(ds, spec, day);
  assert.equal(sc.date, day); assert.ok(sc.columns.length === 2 && sc.picks.length <= 2 && sc.eligible === 5);
  const opened = r.trades.filter((t) => t.signalDate === day).map((t) => t.symbol).sort();
  assert.deepEqual(sc.picks.map((p) => p.symbol).sort(), opened);
  assert.ok(sc.picks[0].nextOpen > 0 && sc.picks[0].values[sc.columns[0].key] !== undefined && sc.picks[0].name === 'חברה ' + sc.picks[0].symbol);
  assert.ok(scanAt(ds, spec, '1990-01-01').error);
});

test('יציאה באות הפוך (opposite_signal) ויציאה מהדירוג (rank_exit): תאריך, מחיר (פתיחה למחרת) וסיבה — ממצא GPT Review #231', () => {
  // דירוג לפי ret(1): A היורדת ביותר ביום 2 → נקנית ביום 3; ביום 3 A העולה ביותר (אות הפוך) → יציאה בפתיחת יום 4 במחיר הפתיחה
  const A = mk('A', [100, 90, 99, 98, 97, 96], { opens: [100, 100, 90, 98.5, 98, 97] }), B = mk('B', [50, 50, 49, 48, 47, 46]), C = mk('C', [20, 20, 20, 20, 20, 20]);
  const ds = new Dataset({ series: [A, B, C] });
  const r = simulate(ds, base({ signal: { rank: { feature: 'ret', params: { days: 1 }, order: 'asc', top: 1 } }, exit: { rules: [{ type: 'opposite_signal', at: 'next_open' }, { type: 'time', days: 30 }] } }));
  const t = r.trades.find((x) => x.symbol === 'A' && x.entryDate === D[2]);
  assert.ok(t, 'A נקנתה ביום 3'); assert.equal(t.exitDate, D[3]); assert.equal(t.exitPrice, 98.5); assert.match(t.exitReason, /אות הפוך \(פתיחה למחרת\)/);
  // rank_exit: ביום 3 A כבר לא בדירוג (B היורדת ביותר) → יציאה בפתיחת יום 4
  const r2 = simulate(ds, base({ signal: { rank: { feature: 'ret', params: { days: 1 }, order: 'asc', top: 1 } }, exit: { rules: [{ type: 'rank_exit', at: 'next_open' }, { type: 'time', days: 30 }] } }));
  const t2 = r2.trades.find((x) => x.symbol === 'A' && x.entryDate === D[2]);
  assert.equal(t2.exitDate, D[3]); assert.equal(t2.exitPrice, 98.5); assert.match(t2.exitReason, /יצאה מהדירוג/);
  // בסגירה (MOC): אותה החלטה, ביצוע בסגירת יום 3
  const r3 = simulate(ds, base({ signal: { rank: { feature: 'ret', params: { days: 1 }, order: 'asc', top: 1 } }, exit: { rules: [{ type: 'rank_exit', at: 'close' }, { type: 'time', days: 30 }] } }));
  const t3 = r3.trades.find((x) => x.symbol === 'A' && x.entryDate === D[2]); assert.equal(t3.exitDate, D[2]); assert.equal(t3.exitPrice, 99); assert.match(t3.exitReason, /סגירה/);
});

test('מצב מחקר (sizing.unlimited): סכום קבוע גם כשהמזומן נגמר, ההון יכול להיות שלילי, בלי ריבית מרג\'ין, מסומן מוגבל; חשבון אמיתי נעצר כשהמזומן נגמר', () => {
  // A יורדת 10% כל יום → נקנית כל יום ומפסידה; הון 1,000$ עם מקום אחד של 1,000$
  const closes = Array.from({ length: 28 }, (_, i) => +(100 * Math.pow(0.9, i)).toFixed(2)), opens = closes.map((c, i) => (i ? closes[i - 1] : c));
  const A = mk('A', closes, { opens }), B = mk('B', closes.map((c) => 50), { opens: closes.map(() => 50) }), C = mk('C', closes.map(() => 20));
  const ds = new Dataset({ series: [A, B, C] });
  const real = simulate(ds, base({ sizing: { capital: 1000, maxPositions: 1, reinvest: false } }));
  const research = simulate(ds, base({ sizing: { capital: 1000, maxPositions: 1, reinvest: false, unlimited: true }, costs: { model: 'none', marginAnnualPct: 6 } }));
  const lastReal = real.trades[real.trades.length - 1]; assert.ok(lastReal.shares * lastReal.entryPrice < 500, 'בחשבון אמיתי הפוזיציה מצטמקת עם המזומן');
  assert.ok(real.finalEquity >= -1e-6 && research.finalEquity < 0, `הון: אמיתי ${real.finalEquity}, מחקר ${research.finalEquity}`);
  assert.ok(research.trades.every((t) => Math.abs(t.shares * t.entryPrice - 1000) < 100), 'סכום קבוע ~1,000$ לכל עסקה');
  assert.equal(research.totals.margin, 0); assert.ok(research.limited && research.assumptions.some((a) => /מצב מחקר/.test(a)));
  const an = analyze(research); assert.ok(an.series.additive && an.series.cagr === null && an.series.totalReturn < -1 && an.series.maxDD < -1 && Object.values(an.periodic.yearly)[0] < 0, JSON.stringify(an.series));
});
