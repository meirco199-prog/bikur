// עוזר המסחר האישי (engine/trader.js): שעות בורסה כולל יום מקוצר, פענוח Flex, פוזיציות חיות, המלצות, התראות, חלופות יציאה, טעויות
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../engine/trader.js';

const CAL = [{ date: '2026-11-25', open: '09:30', close: '16:00', session_open: '0400', session_close: '2000' }, { date: '2026-11-27', open: '09:30', close: '13:00', session_open: '0400', session_close: '2000' }];
const at = (iso) => Date.parse(iso) / 1000;

test('שעות הבורסה: מוקדם/רגיל/מאוחר/סגור; חג (26/11) סגור; יום מקוצר נסגר ב-13:00; שעון חורף', () => {
  assert.equal(T.marketPhase(CAL, at('2026-11-25T10:00:00Z'), T.nyOffsetSec).phase, 'pre');   // 05:00 ניו יורק
  assert.equal(T.marketPhase(CAL, at('2026-11-25T15:00:00Z'), T.nyOffsetSec).phase, 'regular');
  assert.equal(T.marketPhase(CAL, at('2026-11-25T22:00:00Z'), T.nyOffsetSec).phase, 'post');
  assert.equal(T.marketPhase(CAL, at('2026-11-26T15:00:00Z'), T.nyOffsetSec).phase, 'closed', 'חג ההודיה');
  const h = T.marketPhase(CAL, at('2026-11-27T18:30:00Z'), T.nyOffsetSec);
  assert.equal(h.phase, 'post'); assert.equal(h.half, true); assert.equal(h.closeT, at('2026-11-27T18:00:00Z'));
});

const ACT = `<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1">
<EquitySummaryByReportDateInBase accountId="U1" reportDate="20261125" total="326507.36" />
<ConversionRate accountId="U1" fromCurrency="USD" toCurrency="ILS" rate="3.33" />
<OpenPosition accountId="U1" assetCategory="STK" symbol="ANT" position="1138" markPrice="84.25" costBasisPrice="82.575" currency="USD" fxRateToBase="3.33" levelOfDetail="SUMMARY" />
<OpenPosition accountId="U1" assetCategory="OPT" symbol="ANT 261218C00090000" position="1" markPrice="2" costBasisPrice="2" currency="USD" />
</FlexStatement></FlexStatements></FlexQueryResponse>`;
const TC = `<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1"><TradeConfirms>
<TradeConfirm accountId="U1" assetCategory="STK" symbol="AMD" buySell="BUY" quantity="100" price="400" dateTime="20261127;100500" commission="-1.00" tradeID="1" />
<TradeConfirm accountId="U1" assetCategory="STK" symbol="AMD" buySell="BUY" quantity="100" price="402" dateTime="20261127;101000" commission="-1.00" tradeID="2" />
<TradeConfirm accountId="U1" assetCategory="STK" symbol="ANT" buySell="SELL" quantity="-138" price="85" dateTime="20261127;110000" commission="-1.00" tradeID="3" />
</TradeConfirms></FlexStatement></FlexStatements></FlexQueryResponse>`;

test('Flex: פוזיציות (מניות בלבד), שווי ושער דולר; ביצועים עם זמן ניו יורק; פוזיציות חיות עם עלות ממוצעת', () => {
  const m = T.flexPositions(ACT);
  assert.equal(m.U1.nav, 326507.36); assert.equal(m.U1.usdRate, 3.33); assert.equal(m.U1.positions.length, 1);
  const tr = T.flexTrades(TC, T.nyOffsetSec);
  assert.equal(tr.length, 3); assert.equal(tr[0].t, at('2026-11-27T15:05:00Z')); assert.equal(tr[2].side, 'SELL'); assert.equal(tr[2].qty, 138);
  const live = T.livePositions(m, tr);
  const amd = live.find((p) => p.sym === 'AMD'), ant = live.find((p) => p.sym === 'ANT');
  assert.equal(amd.qty, 200); assert.equal(amd.avg, 401); assert.equal(amd.openedToday, true); assert.equal(amd.entryT, at('2026-11-27T15:05:00Z'));
  assert.equal(ant.qty, 1000); assert.equal(ant.openedToday, false);
});

test('המלצה: יומי = 1.5 × תנודת 5 דקות ויעד 2R; גודל לפי 0.5% סיכון ותקרה 20%; טווח ארוך בלי סטופ', () => {
  const r = T.recommend({ cls: 'day', entry: 100, atr5: 0.4, nav: 100000 });
  assert.ok(Math.abs(r.stop - 99.4) < 1e-9); assert.ok(Math.abs(r.target - 101.2) < 1e-9); assert.equal(r.shares, 200, 'תקרה 20,000$');
  const s = T.recommend({ cls: 'swing', entry: 100, atrD: 3, nav: 100000 }); assert.equal(s.stop, 94); assert.equal(s.shares, 83);
  assert.equal(T.recommend({ cls: 'long', entry: 100, nav: 1e5 }).stop, null);
});

test('התראות: הפסד יומי 1%, ריכוז 20%/30%, רווח שהפך להפסד, ירידה מתחת לסטופ, 20 דקות לפני סגירה ביום מקוצר', () => {
  const phase = T.marketPhase(CAL, at('2026-11-27T17:45:00Z'), T.nyOffsetSec);
  const positions = [
    { acct: 'U1', sym: 'ANT', qty: 1000, avg: 82, last: 81, peak: 83.5, cls: 'day', rec: { stop: 81.5 }, entryT: 1 },
    { acct: 'U1', sym: 'AMD', qty: 10, avg: 400, last: 401, peak: 401, cls: 'long' },
  ];
  const a = T.alerts({ positions, navByAcct: { U1: 100000 }, dayPnl: -1500, phase, now: at('2026-11-27T17:45:00Z') });
  const keys = a.map((x) => x.key.split(':')[0]);
  assert.ok(keys.includes('loss0.01')); assert.ok(!keys.includes('loss0.02'));
  assert.ok(keys.includes('conc0.2') && keys.includes('conc0.3'));
  assert.ok(keys.includes('giveback') && keys.includes('stop') && keys.includes('preclose'));
  assert.ok(a.find((x) => x.key.startsWith('preclose')).text.includes('יום מקוצר'));
  assert.equal(a.filter((x) => x.text.includes('AMD') && !x.key.startsWith('conc')).length, 0, 'טווח ארוך — רק ריכוז');
});

test('זינוק בכניסה, חלופות יציאה (סטופ לפני יעד באותו נר), וניתוח טעויות לפי עלות', () => {
  assert.match(T.spikeAtEntry({ run60: 0.025, vsVwap: 0 }), /עלייה של 2.5%/);
  assert.equal(T.spikeAtEntry({ run60: 0.005, vsVwap: 0.002 }), null);
  const bars = [{ t: 10, o: 100, h: 103, l: 98.9, c: 101 }, { t: 20, o: 101, h: 101, l: 100, c: 100.5 }];
  const x = T.exitAlternatives({ entry: 100, entryT: 0, exit: 100.5, R: 1, bars, closeT: 100 });
  assert.ok(Math.abs(x.system + 0.01) < 1e-12, 'באותו נר גם סטופ וגם יעד → סטופ'); assert.ok(Math.abs(x.actual - 0.005) < 1e-12);
  const m = T.mistakes([{ cls: 'day', overnight: true, pnl: -500, peakRet: 0 }, { peakRet: 0.02, pnl: -200 }, { spike: 'x', pnl: 100 }]);
  assert.deepEqual(m.map((c) => c.name), ['עסקה יומית שהוחזקה ללילה', 'עסקה שהייתה ברווח של +1% ונסגרה בהפסד', 'כניסה אחרי זינוק']);
});

test('ריכוז ביחידות אחידות: פוזיציה בדולרים מול שווי מומר לדולרים, גם כשחשבון הבסיס בשקלים (שער 3.8)', () => {
  const phase = T.marketPhase(CAL, at('2026-11-25T15:00:00Z'), T.nyOffsetSec);
  const navUsd = 380000 / 3.8; // שווי חשבון בשקלים, מומר לדולרים כמו בשירות
  const a = T.alerts({ positions: [{ acct: 'U1', sym: 'X', qty: 1000, avg: 19, last: 19.9, peak: 19.9, cls: 'swing', fx: 3.8 }], navByAcct: { U1: navUsd }, dayPnl: 0, phase, now: at('2026-11-25T15:00:00Z') });
  assert.equal(a.filter((x) => x.key.startsWith('conc')).length, 0, '19,900$ מתוך 100,000$ = 19.9% — אין התראה (לא 76%)');
  const b = T.alerts({ positions: [{ acct: 'U1', sym: 'X', qty: 1000, avg: 19, last: 20.5, peak: 20.5, cls: 'swing', fx: 3.8 }], navByAcct: { U1: navUsd }, dayPnl: 0, phase, now: at('2026-11-25T15:00:00Z') });
  assert.deepEqual(b.filter((x) => x.key.startsWith('conc')).map((x) => x.key.split(':')[0]), ['conc0.2']);
});

// ---------- העברה שעתית מ-IBKR ----------
import { keygen, publicKeyOf, encrypt, decrypt } from '../engine/trader-push.js';
const RAW = {
  PR: {
    positions: { positions: [{ contract_description: 'ANT', position: 74, market_price: 84.25, market_value: 6234.5, currency: 'USD', average_price: 92.51, asset_class: 'STK' },
      { contract_description: 'ANT 261218C00090000', position: 1, market_price: 2, market_value: 200, currency: 'USD', average_price: 2, asset_class: 'OPT' }] },
    summary: { currency: 'ILS', net_liquidation: 45252.96, gross_position_value: 20759.6 },
    trades: { trades: [
      { trade_id: 'a', symbol: 'AMD', sec_type: 'STK', side: 'BUY', size: 10, price: 400, trade_time: '2026-11-27T15:05:00Z', commission: 1 },
      { trade_id: 'b', symbol: 'AMD', sec_type: 'STK', side: 'SELL', size: 10, price: 404, trade_time: '2026-11-27T15:40:00Z', commission: 1 },
      { trade_id: 'c', symbol: 'ANT', sec_type: 'STK', side: 'BUY', size: 24, price: 84, trade_time: '2026-11-27T16:00:00Z', commission: 1 },
      { trade_id: 'd', symbol: 'MRVL', sec_type: 'STK', side: 'BUY', size: 5, price: 140, trade_time: '2026-11-26T15:00:00Z', commission: 1 }] },
  },
  CO: { positions: { positions: [{ contract_description: 'NVDA', position: 20, market_price: 150, market_value: 3000, currency: 'USD', average_price: 148, asset_class: 'STK' }] }, summary: { currency: 'USD', net_liquidation: 100000 }, trades: { trades: [] } },
};

test('העברה מ-IBKR: תמונת מצב בלי מספרי חשבון, מניות בלבד, שער דולר משווי הפוזיציות; "נפתחה היום" משחזור הביצועים', () => {
  const s = T.snapshotFromConnector(RAW, 1800000000);
  assert.ok(T.validSnapshot(s)); assert.deepEqual(Object.keys(s.accounts).sort(), ['CO', 'PR']);
  assert.equal(s.accounts.PR.positions.length, 1, 'אופציה לא נכללת');
  assert.ok(Math.abs(s.accounts.PR.usdRate - 20759.6 / 6234.5) < 1e-9); assert.equal(s.accounts.CO.usdRate, 1);
  const { positions, trades } = T.snapshotLive(s, '2026-11-27', T.nyOffsetSec);
  assert.equal(trades.length, 3, 'רק ביצועים של היום (ניו יורק)');
  const ant = positions.find((p) => p.sym === 'ANT'), nv = positions.find((p) => p.sym === 'NVDA');
  assert.equal(ant.qty, 74); assert.equal(ant.avg, 92.51); assert.equal(ant.openedToday, false, 'הייתה פוזיציה של 50 מאתמול');
  assert.equal(nv.acct, 'CO'); assert.equal(positions.length, 2, 'AMD נקנתה ונמכרה היום');
  // פוזיציה שכולה נקנתה היום
  const s2 = T.snapshotFromConnector({ PR: { positions: { positions: [{ contract_description: 'AMD', position: 10, average_price: 400, currency: 'USD', asset_class: 'STK' }] }, summary: { currency: 'USD', net_liquidation: 1e5 }, trades: { trades: [RAW.PR.trades.trades[0]] } } }, 1800000000);
  const amd = T.snapshotLive(s2, '2026-11-27', T.nyOffsetSec).positions[0];
  assert.equal(amd.openedToday, true); assert.equal(amd.entryT, at('2026-11-27T15:05:00Z'));
  // קלט עוין נדחה
  assert.equal(T.validSnapshot({ ...s, accounts: { U123: s.accounts.PR } }), false);
  assert.equal(T.validSnapshot({ ...s, trades: [{ ...s.trades[0], sym: '<img>' }] }), false);
});

test('הצפנה: רק המפתח הפרטי של השרת מפענח; שינוי של תו אחד נדחה; תמונת מצב רגילה קטנה', () => {
  const k = keygen(), pub = publicKeyOf(k), s = T.snapshotFromConnector(RAW, 1800000000);
  const c = encrypt(s, pub);
  assert.deepEqual(decrypt(c, k), s);
  assert.ok(c.length < 1500, `אורך ${c.length}`);
  assert.throws(() => decrypt(c, keygen()));
  const bad = c.slice(0, 80) + (c[80] === 'A' ? 'B' : 'A') + c.slice(81);
  assert.throws(() => decrypt(bad, k));
  assert.match(c, /^[A-Za-z0-9_-]+$/);
});
