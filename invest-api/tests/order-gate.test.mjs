import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRADING_POLICY } from '../engine/trading-policy.js';
import { gateOrder, haltState, policyHash, clientOrderId, isRiskReducing } from '../engine/order-gate.js';

const DAY = '2026-09-23';
const caps = { tradable: new Set(['SPY', 'AAPL', 'GLD', 'BTC', 'ESZ6']), classes: new Set(['stock', 'etf', 'crypto', 'future']), exchanges: new Set(['NYSE', 'NASDAQ', 'ARCA', 'CME']) };
const account = { equityIls: 200000, cashIls: 60000, grossExposureIls: 140000, dayPnlIls: 500, hwmIls: 201000, reconciliationOk: true };
const positions = [
  { symbol: 'SPY', class: 'etf', sector: 'רב-ענפי', strategy: 'S2', qty: 10, valueIls: 28000, pnlIls: 900 },
  { symbol: 'AAPL', class: 'stock', sector: 'Technology', strategy: 'S1', qty: 10, valueIls: 12000, pnlIls: -300 },
];
const order = (o = {}) => ({ symbol: 'GLD', class: 'etf', side: 'buy', qty: 10, priceRef: 300, notionalIls: 9000, currency: 'USD', strategy: 'S3', sector: 'gold', exchange: 'ARCA', exposureMultiplier: 1, worstCaseLossIls: 9000, day: DAY, quoteAsOf: DAY + 'T14:35:00Z', marketOpen: true, ...o });
const gate = (o = {}, extra = {}) => gateOrder({ order: order(o), policy: TRADING_POLICY, account, positions, capabilities: caps, journal: [], now: new Date(DAY + 'T14:40:00Z'), ...extra });

test('המדיניות המאושרת קפואה: סימולציה בלבד, בלי מינוף/שורט/נגזרים', () => {
  assert.equal(TRADING_POLICY.mode, 'simulation'); assert.equal(TRADING_POLICY.approval, null);
  assert.deepStrictEqual([...TRADING_POLICY.allowedClasses], ['stock', 'etf']);
  assert.equal(TRADING_POLICY.shorting, false); assert.equal(TRADING_POLICY.shortLeveraged, false); assert.equal(TRADING_POLICY.unboundedLoss, false);
  assert.equal(TRADING_POLICY.leverage.total, 1.0); assert.equal(TRADING_POLICY.maxDailyLoss, 0.02); assert.equal(TRADING_POLICY.maxDrawdown, 0.10);
  assert.equal(TRADING_POLICY.liquidityReserve, 0.10); assert.equal(TRADING_POLICY.killSwitch, false); assert.equal(TRADING_POLICY.noAveragingDown, true);
  assert.ok(Object.isFrozen(TRADING_POLICY));
});

test('פקודה תקינה בתוך כל המגבלות — מאושרת, עם מזהה דטרמיניסטי', () => {
  const r = gate();
  assert.equal(r.allowed, true, JSON.stringify(r.reasons)); assert.equal(r.reducing, false); assert.equal(r.notionalIls, 9000);
  assert.equal(r.clientOrderId, 'agent:2026-09-23:S3:GLD:buy:v1'); assert.equal(Object.values(r.checks).every(Boolean), true);
  assert.equal(clientOrderId({ day: DAY, strategy: 'S3', symbol: 'GLD', side: 'buy' }), r.clientOrderId, 'אותה החלטה → אותו מזהה');
});

test('kill switch חוסם הכול — גם סגירה', () => {
  const p = { ...TRADING_POLICY, killSwitch: true };
  assert.equal(gate({}, { policy: p }).allowed, false);
  const close = gate({ symbol: 'SPY', side: 'sell', notionalIls: 5000, worstCaseLossIls: 0 }, { policy: p });
  assert.equal(close.allowed, false); assert.equal(close.reducing, true); assert.match(close.reasons.join(), /kill switch/);
});

test('מצב live בלי אישור תואם — נדחה; עם אישור עם hash נכון — עובר; שינוי במדיניות מבטל את האישור', () => {
  const live = { ...TRADING_POLICY, mode: 'live' };
  assert.match(gate({}, { policy: live }).reasons.join(), /live בלי אישור/);
  const approved = { ...live, approval: { at: '2026-10-01', by: 'meirco199-prog', policyHash: policyHash(live), capitalIls: 200000 } };
  assert.equal(gate({}, { policy: approved }).allowed, true, 'אישור תואם');
  const tampered = { ...approved, maxTradeShare: 0.5 };
  assert.match(gate({}, { policy: tampered }).reasons.join(), /hash/);
  const smallApproval = { ...approved, approval: { ...approved.approval, capitalIls: 100000 } };
  assert.equal(gate({}, { policy: smallApproval }).allowed, false, 'ההון חורג מהאישור');
  assert.notEqual(policyHash(live), policyHash({ ...live, killSwitch: true }));
  assert.equal(policyHash(live), policyHash({ ...live, approval: { x: 1 } }), 'שדה האישור עצמו לא נכלל ב-hash');
});

test('כפילות: אותו clientOrderId שכבר ביומן היום — נדחה', () => {
  const j = [{ clientOrderId: 'agent:2026-09-23:S3:GLD:buy:v1' }];
  assert.match(gate({}, { journal: j }).reasons.join(), /כפולה/);
  assert.equal(gate({ decisionVersion: 2 }, { journal: j }).allowed, true, 'גרסת החלטה חדשה = פקודה חדשה');
});

test('מפת יכולות: לא ידועה → חסום; נייר/סוג/בורסה מחוץ למפה → חסום', () => {
  assert.match(gate({}, { capabilities: null }).reasons.join(), /לא ידועה/);
  assert.match(gate({ symbol: 'XYZ' }).reasons.join(), /לא ניתן למסחר/);
  assert.match(gate({ exchange: 'LSE' }).reasons.join(), /לא ניתן למסחר/);
});

test('סוג מכשיר, שורט, הפסד בלתי מוגבל — לפי המדיניות', () => {
  assert.match(gate({ symbol: 'BTC', class: 'crypto', notionalIls: 5000 }).reasons.join(), /סוג מכשיר לא מאושר/);
  assert.match(gate({ symbol: 'AAPL', class: 'stock', side: 'short', notionalIls: 5000 }).reasons.join(), /שורט לא מאושר/);
  assert.match(gate({ worstCaseLossIls: null }).reasons.join(), /בלתי מוגבל/);
  const wide = { ...TRADING_POLICY, allowedClasses: ['stock', 'etf', 'future'], unboundedLoss: true, leverage: { total: 3, byClass: { future: 3, stock: 1, etf: 1 } }, maxTradeShare: 0.5, maxAssetShare: 0.5, maxSectorShare: 0.5, maxStrategyShare: 0.5, maxClassShare: { future: 0.5 } };
  const shortPol = { ...wide, shorting: true };
  assert.match(gate({ symbol: 'SPY', side: 'short', notionalIls: 5000, exposureMultiplier: 3, leveraged: true, worstCaseLossIls: null }, { policy: shortPol }).reasons.join(), /ממונף\/הפוך/, 'שורט על ממונף נחסם כברירת מחדל');
  assert.equal(gate({ symbol: 'SPY', side: 'short', notionalIls: 5000, exposureMultiplier: 3, leveraged: true, worstCaseLossIls: null }, { policy: { ...shortPol, shortLeveraged: true } }).allowed, true, 'מותר רק בהיתר מפורש');
  const fut = gate({ symbol: 'ESZ6', class: 'future', exchange: 'CME', notionalIls: 20000, exposureMultiplier: 5, worstCaseLossIls: null }, { policy: wide });
  assert.equal(fut.allowed, true, JSON.stringify(fut.reasons)); assert.equal(fut.notionalIls, 100000, 'חשיפה = notional × מכפיל');
});

test('נתונים ושעות: ציטוט ישן או שוק סגור חוסמים פתיחה, לא סגירה', () => {
  assert.match(gate({ quoteAsOf: '2026-09-22T20:00:00Z' }).reasons.join(), /ציטוט חי/);
  assert.match(gate({ marketOpen: false }).reasons.join(), /השוק לא פתוח/);
  const close = gate({ symbol: 'AAPL', class: 'stock', side: 'sell', notionalIls: 6000, worstCaseLossIls: 0, quoteAsOf: '2026-09-22', marketOpen: false });
  assert.equal(close.allowed, true, JSON.stringify(close.reasons)); assert.equal(close.reducing, true);
});

test('עצירות חשבון: הפסד יומי, drawdown, reconciliation — חוסמות סיכון חדש ומתירות הקטנה', () => {
  const lossAcc = { ...account, dayPnlIls: -4100 };
  assert.deepEqual(haltState({ account: lossAcc }).halted, true);
  assert.match(gate({}, { account: lossAcc }).reasons.join(), /הפסד יומי 2.05%/);
  assert.equal(gate({ symbol: 'SPY', side: 'sell', notionalIls: 5000, worstCaseLossIls: 0 }, { account: lossAcc }).allowed, true);
  const ddAcc = { ...account, hwmIls: 230000, equityIls: 200000 };
  assert.match(gate({}, { account: ddAcc }).reasons.join(), /ירידה מהשיא 13.04%/);
  assert.match(gate({}, { account: { ...account, reconciliationOk: false } }).reasons.join(), /reconciliation/);
  assert.equal(haltState({ account }).halted, false);
});

test('מכסת פקודות יומית', () => {
  const j = Array.from({ length: 20 }, (_, i) => ({ clientOrderId: 'x' + i }));
  assert.match(gate({}, { journal: j }).reasons.join(), /מכסת פקודות/);
});

test('גדלים וחשיפות: פקודה, נייר, ענף, אסטרטגיה, סוג, מינוף, רזרבה, margin, הגדלת מפסידה', () => {
  assert.match(gate({ notionalIls: 12000 }).reasons.join(), /6.0% מההון > 5%/);
  assert.match(gate({ symbol: 'AAPL', class: 'stock', sector: 'Technology', strategy: 'S1', notionalIls: 9000, exchange: 'NASDAQ' }).reasons.join(), /AAPL אחרי הפקודה 10.5% > 10%/);
  const techHeavy = [...positions, { symbol: 'MSFT', class: 'stock', sector: 'Technology', strategy: 'S1', qty: 1, valueIls: 40000, pnlIls: 100 }];
  const r = gate({ symbol: 'AAPL', class: 'stock', sector: 'Technology', strategy: 'S1', notionalIls: 4000, exchange: 'NASDAQ' }, { positions: techHeavy, account: { ...account, grossExposureIls: 80000 } });
  assert.match(r.reasons.join(), /ענף Technology אחרי הפקודה 28.0% > 25%/);
  const stratHeavy = [{ symbol: 'SPY', class: 'etf', sector: 'x', strategy: 'S3', qty: 1, valueIls: 55000, pnlIls: 1 }];
  assert.match(gate({ notionalIls: 9000 }, { positions: stratHeavy, account: { ...account, grossExposureIls: 55000 } }).reasons.join(), /אסטרטגיה S3 אחרי הפקודה 32.0% > 30%/);
  const cryptoPolicy = { ...TRADING_POLICY, allowedClasses: ['stock', 'etf', 'crypto'] };
  assert.match(gate({ symbol: 'BTC', class: 'crypto', notionalIls: 9000, exchange: 'NASDAQ' }, { policy: cryptoPolicy, positions: [{ symbol: 'BTC', class: 'crypto', qty: 1, valueIls: 5000, pnlIls: 1 }], account: { ...account, grossExposureIls: 5000 } }).reasons.join(), /סוג crypto אחרי הפקודה 7.0% > 5%/);
  assert.match(gate({}, { account: { ...account, grossExposureIls: 195000 } }).reasons.join(), /מינוף אחרי הפקודה 1.02 > 1/);
  assert.match(gate({}, { account: { ...account, cashIls: 25000 } }).reasons.join(), /מזומן אחרי הפקודה 8.0% < רזרבה 10%/);
  assert.match(gate({}, { account: { ...account, availableFundsIls: 30000, maintenanceMarginIls: 25000 } }).reasons.join(), /margin = 1.20 < 1.30/);
  assert.match(gate({ symbol: 'AAPL', class: 'stock', sector: 'Technology', strategy: 'S1', notionalIls: 4000, exchange: 'NASDAQ' }).reasons.join(), /הגדלת פוזיציה מפסידה ב-AAPL/);
  assert.equal(gate({ symbol: 'AAPL', class: 'stock', sector: 'Technology', strategy: 'S1', notionalIls: 4000, exchange: 'NASDAQ', allowAddToLoser: true }).allowed, true, 'דגל מפורש של האסטרטגיה מתיר');
});

test('הקטנת סיכון מזוהה נכון, וכל הסיבות מדווחות יחד (לא רק הראשונה)', () => {
  assert.equal(isRiskReducing({ symbol: 'SPY', side: 'sell' }, positions), true);
  assert.equal(isRiskReducing({ symbol: 'SPY', side: 'buy' }, positions), false);
  assert.equal(isRiskReducing({ symbol: 'NEW', side: 'sell' }, positions), false, 'מכירה של מה שאין = פתיחת שורט, לא הקטנה');
  const r = gate({ symbol: 'BTC', class: 'crypto', side: 'short', notionalIls: 30000, worstCaseLossIls: null, quoteAsOf: '2026-09-01', marketOpen: false }, { capabilities: null, policy: { ...TRADING_POLICY, killSwitch: true } });
  assert.equal(r.allowed, false); assert.ok(r.reasons.length >= 7, 'כל הסיבות: ' + r.reasons.length);
  assert.match(gate({ qty: 0 }).reasons.join(), /לא תקינה/);
});
