import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paperBreakdown } from '../engine/paper-breakdown.js';

const table = [
  { symbol: 'VTI', type: 'etf', assetClass: 'equity', role: 'core' },
  { symbol: 'BND', type: 'etf', assetClass: 'bond', role: 'core' },
  { symbol: 'AAA', type: 'stock', assetClass: 'equity' },
  { symbol: 'BBB', type: 'stock', assetClass: 'equity' },
];
// מזומן נגזר מהעסקאות עצמן (כמו PaperBroker אמיתי): 200,000 − 3,710 (AAA) − 18,508 (VTI) − 930 (BBB כניסה, כולל עמלה) + 1,104 (BBB יציאה, 5×60×3.7−6)
const account = { initialIls: 200000, cashIls: 200000 - 3710 - 18508 - 930 + 1104 };

test('פירוק חשבון: הפרדת ממומש/לא ממומש, עמלות, ידני/אוטומט, מאז גרסת האסטרטגיה הנוכחית', () => {
  const journal = [
    { day: '2026-09-10', executed: true, rulesVersion: 9 },
    { day: '2026-09-16', executed: true, rulesVersion: 10 },
    { day: '2026-09-17', executed: true, rulesVersion: 10 },
  ];
  const trades = [
    // AAA: נקנתה תחת גרסה 9 (לפני האסטרטגיה הנוכחית), עדיין פתוחה, ירדה במחיר
    { symbol: 'AAA', qty: 10, price: 100, currency: 'USD', fx: 3.7, feeIls: 10, costIls: 3710, date: '2026-09-10T10:00:00Z', snapDate: '2026-09-10', reason: 'אוטומט: BUY' },
    // BBB: נקנתה תחת גרסה 10 (האסטרטגיה הנוכחית), נסגרה ברווח
    { symbol: 'BBB', qty: 5, price: 50, currency: 'USD', fx: 3.7, feeIls: 5, costIls: 930, date: '2026-09-16T10:00:00Z', snapDate: '2026-09-16', reason: 'אוטומט: BUY',
      exitDate: '2026-09-17T10:00:00Z', exitPrice: 60, exitFx: 3.7, exitFeeIls: 6, pnlIls: 180.5, pnlPct: 0.2 },
    // VTI: קנייה ידנית (לא אוטומט), פתוחה
    { symbol: 'VTI', qty: 20, price: 250, currency: 'USD', fx: 3.7, feeIls: 8, costIls: 18508, date: '2026-09-12T10:00:00Z', snapDate: '2026-09-12', reason: 'קנייה ידנית' },
  ];
  const priceOf = (s) => ({ AAA: 90, VTI: 260 })[s] ?? null; // BBB כבר נסגרה
  const nameOf = (s) => ({ AAA: 'חברת א', BBB: 'חברת ב', VTI: 'ואנגארד' }[s] || s);
  const r = paperBreakdown({ trades, account, priceOf, fx: 3.7, table, nameOf, journal, currentVersion: 10, targets: { coreEquity: 0.5, stocks: 0.2, bonds: 0.2, gold: 0.05, cash: 0.05 } });

  // AAA: ירדה 10% במחיר, לא ממומשת, לפני האסטרטגיה הנוכחית (v9)
  const aaa = r.bySymbol.find((x) => x.symbol === 'AAA');
  assert.ok(aaa.unrealizedIls < 0, 'AAA הפסידה');
  assert.equal(aaa.realizedIls, 0);
  assert.equal(aaa.bucket, 'stocks');
  assert.equal(r.strategy.activeSinceDay, '2026-09-16');
  // הפיצול לפני/מאז כולל רק עסקאות אוטומט (VTI הידנית לא נכנסת לחישוב הזה, גם שהיא לפני התאריך — יש לה bySource.manual משלה)
  assert.ok(r.strategy.beforeIls < 0, 'ההפסד של AAA (אוטומט, לפני) משויך נכון, בלי VTI הידנית');
  assert.equal(r.strategy.beforeTrades, 1);

  // BBB: רווח ממומש תחת הגרסה הנוכחית — pnlIls הגולמי (180.5) פחות עמלת היציאה (6) = 174.5 נטו
  const bbb = r.bySymbol.find((x) => x.symbol === 'BBB');
  assert.equal(bbb.realizedIls, 174.5);
  assert.equal(bbb.feesIls, 11, 'עמלת כניסה + עמלת יציאה, לא נדרסת (מדד מידע נפרד מהרווח הנקי)');
  assert.ok(r.strategy.sinceIls > 0, 'הרווח של BBB משויך לתקופה של הגרסה הנוכחית');
  assert.equal(r.strategy.sinceTrades, 1);

  // VTI: ידני, לא נספר תחת bySource.autopilot
  const vti = r.bySymbol.find((x) => x.symbol === 'VTI');
  assert.equal(vti.bucket, 'etf');
  assert.ok(vti.unrealizedIls > 0, 'VTI עלתה');
  assert.equal(r.bySource.manual.trades, 1);
  assert.equal(r.bySource.autopilot.trades, 2);
  assert.ok(r.bySource.manual.netIls > 0);

  // עמלות כוללות (מדד מידע, לא מנוכה פעמיים מ-netIls): 10 (AAA כניסה) + 5+6 (BBB) + 8 (VTI כניסה) = 29
  assert.equal(r.totals.feesIls, 29);
  // netIls כבר נטו מכל העמלות דרך costIls (כניסה) ועמלת היציאה שנוכתה בנפרד — לא עוד ניכוי
  assert.ok(Math.abs(r.totals.netIls - (r.totals.realizedIls + r.totals.unrealizedIls)) < 0.01);

  // תרומת מטבע: כל השערים כאן זהים (3.7) — אין תרומת מטבע כלל, גם לא בפוזיציה שנסגרה וגם לא בפתוחה
  assert.equal(r.totals.fxEffectIls, 0);
  assert.ok(r.totals.priceEffectIls !== 0, 'תרומת המחיר לא ריקה כשהמחירים באמת זזו');

  // הקצאה בפועל: מזומן פנוי תואם את מה שנגזר מהעסקאות
  assert.ok(r.allocation.actual.cashShare > 0);
  assert.deepEqual(r.allocation.target, { coreEquity: 0.5, stocks: 0.2, bonds: 0.2, gold: 0.05, cash: 0.05 });
  assert.equal(r.allocation.freeCashIls, account.cashIls);

  // התאמה: סך התיק בפועל שווה להתחלתי + נטו (עד כדי עיגול)
  assert.ok(Math.abs(r.reconciliation.diffIls) < 1, JSON.stringify(r.reconciliation));
});

test('תרומת מטבע מופרדת מתרומת מחיר: פוזיציה שהמחיר שלה לא זז אבל הדולר התחזק', () => {
  const trades = [{ symbol: 'AAA', qty: 10, price: 100, currency: 'USD', fx: 3.5, feeIls: 0, costIls: 3500, date: '2026-09-10T10:00:00Z', snapDate: '2026-09-10', reason: 'קנייה ידנית' }];
  const r = paperBreakdown({ trades, account: { initialIls: 200000, cashIls: 196500 }, priceOf: () => 100, fx: 3.7, table: [{ symbol: 'AAA', type: 'stock' }], journal: [], currentVersion: 10 });
  const aaa = r.bySymbol[0];
  assert.equal(aaa.priceEffectIls, 0, 'המחיר לא זז');
  assert.ok(aaa.fxEffectIls > 0, 'הדולר התחזק — כל הרווח מהפרש מטבע');
  assert.equal(r.totals.priceEffectIls, 0);
});

test('לא מייחס הפסד לאסטרטגיה הנוכחית כשעוד לא רצה בגרסה הזו', () => {
  const trades = [{ symbol: 'AAA', qty: 10, price: 100, currency: 'USD', fx: 3.7, feeIls: 0, costIls: 3700, date: '2026-09-10T10:00:00Z', snapDate: '2026-09-10', reason: 'אוטומט: BUY' }];
  const r = paperBreakdown({ trades, account: { initialIls: 200000, cashIls: 196300 }, priceOf: () => 90, fx: 3.7, table: [{ symbol: 'AAA', type: 'stock' }], journal: [{ day: '2026-09-10', executed: true, rulesVersion: 9 }], currentVersion: 10 });
  assert.equal(r.strategy.activeSinceDay, null);
  assert.equal(r.strategy.sinceIls, 0);
  assert.ok(r.strategy.beforeIls < 0);
});
