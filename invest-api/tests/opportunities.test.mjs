import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanOpportunities, sizeByRisk, STRATEGIES } from '../engine/opportunities.js';
import { AGENT_SIM_POLICY } from '../engine/agent-sim-policy.js';
import { instrumentOf } from '../engine/instruments.js';
import { gateOrder, policyHash } from '../engine/order-gate.js';

// סדרה סינתטית: n ימים, מחיר לפי פונקציה; נפח קבוע. תאריכים עוקבים (ימי חול לא חשובים כאן)
const series = (n, f, { vol = 1e6 } = {}) => Array.from({ length: n }, (_, i) => { const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10); const c = f(i); return [d, c * 0.998, c * 1.01, c * 0.99, c, vol]; });
const up = (i) => 100 * Math.exp(0.0015 * i) * (1 + 0.01 * Math.sin(i / 7));
const down = (i) => 100 * Math.exp(-0.0015 * i) * (1 + 0.01 * Math.sin(i / 7));
const flat = (i) => 100 * (1 + 0.02 * Math.sin(i / 9));

test('מגמה: עלייה יציבה עם פריצה → לונג; ירידה → שורט (רק במכשיר שניתן לשורט); שטוח → כלום', () => {
  const s = [{ inst: instrumentOf('GLD'), rows: series(300, up) }, { inst: instrumentOf('USO'), rows: series(300, down) }, { inst: instrumentOf('BTC-USD'), rows: series(300, down) }, { inst: instrumentOf('TLT'), rows: series(300, flat) }];
  const r = scanOpportunities({ series: s, day: s[0].rows[299][0] });
  assert.equal(r.scanned, 4);
  const gld = r.candidates.find((c) => c.symbol === 'GLD'); assert.ok(gld && gld.side === 'long', JSON.stringify(r.candidates.map((c) => [c.symbol, c.strategy, c.side])));
  assert.ok(gld.stop < gld.price && gld.stopPct > 0 && gld.stopPct < 0.2); assert.ok(gld.invalidation); assert.equal(gld.unboundedLoss, false);
  const uso = r.candidates.find((c) => c.symbol === 'USO'); assert.ok(uso && uso.side === 'short'); assert.equal(uso.unboundedLoss, true);
  assert.ok(!r.candidates.find((c) => c.symbol === 'BTC-USD' && c.side === 'short'), 'קריפטו ספוט לא ניתן לשורט');
  assert.ok(!r.candidates.find((c) => c.symbol === 'TLT' && !c.needsResearch), 'שטוח — בלי מועמד לפקודה');
});

test('זעזוע: קפיצה של 5 ימים ≥ 3 סטיות תקן → מועמד למחקר בלי פקודה; סדרה קצרה מדולגת', () => {
  const shock = (i) => (i >= 295 ? 100 * 1.25 : 100 * (1 + 0.003 * Math.sin(i / 5)));
  const r = scanOpportunities({ series: [{ inst: instrumentOf('XBI'), rows: series(300, shock) }, { inst: instrumentOf('SLV'), rows: series(30, up) }] });
  const x = r.candidates.find((c) => c.symbol === 'XBI'); assert.ok(x && x.needsResearch && x.strategy === 'volshock', JSON.stringify(r.candidates));
  assert.equal(r.skipped.length, 1); assert.match(r.skipped[0].reason, /30 ימים/);
});

test('מומנטום חוצה-נכסים: העשירון העליון לונג, התחתון שורט; ממונפים וחוזים מחוץ לדירוג', () => {
  const insts = ['GLD', 'SLV', 'USO', 'UNG', 'TLT', 'XLE', 'XLF', 'EURUSD', 'BTC-USD', 'SPY', 'QQQ', 'IWM', 'TQQQ', 'MES'];
  const s = insts.map((sym, k) => ({ inst: instrumentOf(sym), rows: series(300, (i) => 100 * Math.exp((0.002 - 0.0004 * k) * i)) }));
  const r = scanOpportunities({ series: s });
  const xm = r.candidates.filter((c) => c.strategy === 'xmom');
  assert.ok(xm.some((c) => c.symbol === 'GLD' && c.side === 'long'), 'הגבוה ביותר לונג');
  assert.ok(!xm.some((c) => ['TQQQ', 'MES'].includes(c.symbol)), 'ממונף/חוזה לא בדירוג');
  assert.ok(r.candidates.every((c) => typeof c.score === 'number'));
});

test('גודל לפי סיכון + שער הפקודות במדיניות הסימולציה: שורט וחוזה עוברים, ותקרות עדיין נאכפות', () => {
  const eq = 54000; // ~200,000 ₪
  const qty = sizeByRisk({ equityUsd: eq, riskPct: 0.01, price: 100, stop: 95, units: 1 });
  assert.equal(qty, 108, '540$ סיכון ÷ 5$ = 108');
  assert.equal(sizeByRisk({ equityUsd: eq, riskPct: 0.01, price: 500, stop: 490, units: 50 }), 1, 'חוזה: 540 ÷ (10×50) = 1.08 → 1');
  assert.equal(sizeByRisk({ equityUsd: 1000, riskPct: 0.01, price: 100, stop: 95 }), 0, 'קטן מדי');
  const caps = { tradable: new Set(['USO', 'MES', 'BTC-USD']), classes: new Set(['etf', 'future', 'crypto']), exchanges: null };
  const fx = 3.7, account = { equityIls: eq * fx, cashIls: eq * fx, grossExposureIls: 0, dayPnlIls: 0, hwmIls: eq * fx, availableFundsIls: eq * fx, maintenanceMarginIls: 0, reconciliationOk: true };
  const base = { policy: AGENT_SIM_POLICY, account, positions: [], capabilities: caps, journal: [] };
  const short = gateOrder({ ...base, order: { symbol: 'USO', class: 'etf', side: 'short', qty: 60, priceRef: 70, notionalIls: 4200 * fx, strategy: 'trend', sector: 'energy', exposureMultiplier: 1, worstCaseLossIls: null, day: '2026-09-23', quoteAsOf: '2026-09-23', marketOpen: true } });
  assert.equal(short.allowed, true, JSON.stringify(short.reasons));
  const fut = gateOrder({ ...base, order: { symbol: 'MES', class: 'future', side: 'buy', qty: 1, priceRef: 500, notionalIls: 25000 * fx, strategy: 'xmom', sector: 'index', exposureMultiplier: 1, worstCaseLossIls: null, day: '2026-09-23', quoteAsOf: '2026-09-23', marketOpen: true } });
  assert.equal(fut.allowed, false, 'חוזה אחד = 46% מההון > 10% לפקודה'); assert.match(fut.reasons.join(), /10%/);
  const btc = gateOrder({ ...base, order: { symbol: 'BTC-USD', class: 'crypto', side: 'buy', qty: 0.05, priceRef: 60000, notionalIls: 3000 * fx, strategy: 'xmom', sector: 'crypto', exposureMultiplier: 1, worstCaseLossIls: 3000 * fx, day: '2026-09-23', quoteAsOf: '2026-09-23', marketOpen: true }, positions: [{ symbol: 'ETH-USD', class: 'crypto', sector: 'crypto', strategy: 'xmom', qty: 1, valueIls: 6000 * fx, pnlIls: 0 }] });
  assert.equal(btc.allowed, false); assert.match(btc.reasons.join(), /סוג crypto/);
  const sqqq = gateOrder({ ...base, capabilities: { tradable: new Set(['SQQQ']), classes: new Set(['etf']), exchanges: null }, order: { symbol: 'SQQQ', class: 'etf', side: 'short', qty: 60, priceRef: 20, notionalIls: 1200 * fx, strategy: 'trend', sector: 'index', exposureMultiplier: 3, leveraged: true, worstCaseLossIls: null, day: '2026-09-23', quoteAsOf: '2026-09-23', marketOpen: true } });
  assert.equal(sqqq.allowed, false); assert.match(sqqq.reasons.join(), /ממונף\/הפוך/);
  assert.equal(AGENT_SIM_POLICY.shortLeveraged, false); assert.equal(AGENT_SIM_POLICY.maxSectorShare, 0.30);
  assert.equal(AGENT_SIM_POLICY.mode, 'simulation'); assert.equal(AGENT_SIM_POLICY.approval, null); assert.ok(policyHash(AGENT_SIM_POLICY).length > 8);
  assert.ok(Object.keys(STRATEGIES).length >= 4);
});
