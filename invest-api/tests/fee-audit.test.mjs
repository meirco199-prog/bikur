import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditFees, botOf, roleOf, renderAudit, RATES } from '../engine/fee-audit.js';

const row = (o) => ({ execType: 'Trade', execId: Math.random().toString(36), execTime: '1795000000000', ...o });

test('שיוך לבוט: קידומת ואז סימול', () => {
  assert.equal(botOf({ orderLinkId: 'amit-e-buy-1' }), 'bot1');
  assert.equal(botOf({ orderLinkId: 'a2-123' }), 'bot2');
  assert.equal(botOf({ orderLinkId: 'a3-SOL-abc-e1', symbol: 'SOLUSDT' }), 'bot3');
  assert.equal(botOf({ orderLinkId: '', symbol: 'BTCUSDT' }), 'bot1');
  assert.equal(botOf({ orderLinkId: '', symbol: 'ETHUSDT' }), 'bot2');
  assert.equal(botOf({ orderLinkId: '', symbol: 'AVAXUSDT' }), 'bot3');
});

test('תפקיד: סטופ/יעד מוצמדים, יעד ממתין, כניסה, מימון', () => {
  assert.equal(roleOf({ stopOrderType: 'StopLoss' }), 'sl');
  assert.equal(roleOf({ stopOrderType: 'TakeProfit' }), 'tp');
  assert.equal(roleOf({ orderLinkId: 'amit-tp-5' }), 'tp');
  assert.equal(roleOf({ orderLinkId: 'amit-e-sell-5' }), 'entry');
  assert.equal(roleOf({ orderLinkId: 'a2-1795000000000' }), 'entry');
  assert.equal(roleOf({ orderLinkId: 'a3-SOL-x1-e2' }), 'entry');
  assert.equal(roleOf({ orderLinkId: 'a3-SOL-x1-r' }), 'close');
  assert.equal(roleOf({ execType: 'Funding' }), 'funding');
  assert.equal(roleOf({ orderLinkId: '' }), 'close');
});

test('סיכום: עמלה בפועל, חלק maker, מודלים, וכפילויות נספרות פעם אחת', () => {
  const e = row({ execId: 'x1', symbol: 'BTCUSDT', orderLinkId: 'amit-e-buy-1', execValue: '100000', execFee: '20', isMaker: true, feeRate: '0.0002', orderType: 'Limit' });
  const rows = [
    e, { ...e }, // כפילות
    row({ symbol: 'BTCUSDT', stopOrderType: 'StopLoss', orderLinkId: '', execValue: '100000', execFee: '55', isMaker: false, feeRate: '0.00055', orderType: 'Market' }),
    row({ symbol: 'BTCUSDT', execType: 'Funding', execFee: '3', execValue: '0' }),
  ];
  const a = auditFees(rows);
  assert.equal(a.n, 3);
  const B = a.bots.bot1;
  assert.equal(B.roles.entry.n, 1);
  assert.equal(B.total.fee, 75);
  assert.equal(B.total.value, 200000);
  assert.equal(B.total.makerShare, 0.5);
  assert.equal(B.funding.fee, 3);
  assert.ok(Math.abs(B.models.vip0 - (100000 * RATES.vip0.maker + 100000 * RATES.vip0.taker)) < 1e-9);
  assert.ok(Math.abs(B.models.amit - (100000 * RATES.amit.maker + 100000 * RATES.amit.taker)) < 1e-9);
  assert.ok(Math.abs(B.models.research - (100000 * 0.0002 + 100000 * 0.00075)) < 1e-9);
  const md = renderAudit(a, [{ symbol: 'BTCUSDT', takerFeeRate: '0.00055', makerFeeRate: '0.0002' }]);
  assert.match(md, /בוט 1/);
  assert.match(md, /0\.055%/);
});

test('ריק — לא נופל', () => {
  const a = auditFees([]);
  assert.equal(a.n, 0);
  assert.equal(typeof renderAudit(a), 'string');
});
