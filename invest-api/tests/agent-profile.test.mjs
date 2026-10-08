// הפרופיל האגרסיבי של הסוכן (החלטת מאיר 8/10/2026): סימולציה בלבד, מגבלות נעולות, ההגנות מוחמרות ולא מוקלות,
// והמעבר בין פרופילים לא נוגע בשער ובמצב live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_SIM_POLICY, AGENT_SIM_POLICY_AGGRESSIVE, AGENT_POLICY_PROFILES, DEFAULT_AGENT_PROFILE } from '../engine/agent-sim-policy.js';
import { gateOrder, policyHash } from '../engine/order-gate.js';
import { agentPolicy, agentProfile, setAgentProfile } from '../lib/agent.js';

const A = AGENT_SIM_POLICY_AGGRESSIVE, B = AGENT_SIM_POLICY;
const memDb = () => { const m = new Map(); return { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } }; };

test('הפרופיל האגרסיבי: ערכים נעולים, סימולציה בלבד, בלי approval', () => {
  assert.equal(A.profile, 'aggressive'); assert.equal(A.mode, 'simulation'); assert.equal(A.approval, null); assert.equal(A.killSwitch, false);
  assert.deepStrictEqual(
    { total: A.leverage.total, trade: A.maxTradeShare, asset: A.maxAssetShare, sector: A.maxSectorShare, strategy: A.maxStrategyShare, crypto: A.maxClassShare.crypto, daily: A.maxDailyLoss, dd: A.maxDrawdown, margin: A.marginBuffer, orders: A.maxOrdersPerDay },
    { total: 3.0, trade: 0.12, asset: 0.18, sector: 0.40, strategy: 0.55, crypto: 0.10, daily: 0.03, dd: 0.15, margin: 0.30, orders: 20 });
  assert.ok(Object.isFrozen(A) && Object.isFrozen(A.leverage) && Object.isFrozen(A.maxClassShare));
  assert.equal(B.mode, 'simulation'); assert.equal(B.approval, null); assert.equal(B.maxStrategyShare, 0.45, 'המאוזן לא השתנה');
});

test('האגרסיבי מרחיב רק יכולת פעולה; עצירות ההפסד והמינוף לא מוקלים', () => {
  for (const k of ['maxTradeShare', 'maxAssetShare', 'maxSectorShare', 'maxStrategyShare', 'maxOrdersPerDay']) assert.ok(A[k] >= B[k], k);
  assert.ok(A.maxDailyLoss <= B.maxDailyLoss && A.maxDrawdown <= B.maxDrawdown && A.marginBuffer >= B.marginBuffer);
  assert.ok(A.leverage.total <= B.leverage.total);
  for (const c of Object.keys(B.maxClassShare)) assert.ok(A.maxClassShare[c] <= B.maxClassShare[c], 'סוג ' + c);
  for (const c of Object.keys(B.leverage.byClass).filter((k) => k !== 'option')) assert.equal(A.leverage.byClass[c], B.leverage.byClass[c], 'מינוף לפי סוג ' + c);
  // אופציות (קנייה בלבד, הפרמיה = ההפסד המקסימלי) הן ההרחבה היחידה בסוגי המכשירים; המאוזן נשאר בלי
  assert.deepStrictEqual([...A.allowedClasses], [...B.allowedClasses, 'option']); assert.ok(!B.allowedClasses.includes('option') && !B.options);
  assert.deepStrictEqual({ ...A.options }, { enabled: true, premiumBudgetPct: 0.03, maxContractPremiumPct: 0.06, minDte: 30, maxOpen: 3, maxNewPerDay: 1, stopPct: 0.5, exitDte: 2 });
  assert.equal(A.maxClassShare.option, 0.15); assert.ok(Object.isFrozen(A.options) && Object.isFrozen(A.allowedClasses));
  assert.notEqual(policyHash(A), policyHash(B));
  assert.ok(A.maxTradeShare <= A.maxAssetShare, 'פקודה אחת לא עוברת את תקרת הנכס');
});

test('ברירת המחדל אגרסיבית; ה-KV מחליף פרופיל; kill switch חל על שניהם', async () => {
  assert.equal(DEFAULT_AGENT_PROFILE, 'aggressive'); assert.deepStrictEqual(Object.keys(AGENT_POLICY_PROFILES).sort(), ['aggressive', 'balanced']);
  const db = memDb();
  assert.equal(await agentProfile(db), 'aggressive'); assert.equal((await agentPolicy(db)).maxStrategyShare, 0.55);
  await setAgentProfile(db, 'balanced'); assert.equal((await agentPolicy(db)).maxStrategyShare, 0.45);
  await db.put('agent:profile', { profile: 'bogus' }); assert.equal(await agentProfile(db), 'aggressive', 'ערך לא מוכר → ברירת המחדל');
  await assert.rejects(() => setAgentProfile(db, 'live'), /פרופיל לא מוכר/);
  await setAgentProfile(db, 'aggressive'); await db.put('agent:kill', { on: true, reason: 'test' });
  const k = await agentPolicy(db); assert.equal(k.killSwitch, true); assert.equal(k.profile, 'aggressive'); assert.equal(k.mode, 'simulation');
});

// פקודה אחת שמאוזן דוחה על תקרת האסטרטגיה ואגרסיבי מאשר; ושני הפרופילים דוחים כשצריך
const caps = { tradable: new Set(['QQQ', 'XLK']), classes: new Set(['etf']), exchanges: null };
const base = { equityIls: 200000, cashIls: 100000, grossExposureIls: 90000, dayPnlIls: 0, hwmIls: 200000, availableFundsIls: 150000, maintenanceMarginIls: 30000, reconciliationOk: true };
const held = [{ symbol: 'SMH', class: 'etf', sector: 'tech', strategy: 'trend', qty: 10, valueIls: 85000 }];
const ord = (o = {}) => ({ symbol: 'QQQ', class: 'etf', side: 'buy', qty: 1, priceRef: 1, notionalIls: 20000, currency: 'USD', strategy: 'trend', sector: 'index', exposureMultiplier: 1, worstCaseLossIls: 20000, day: '2026-10-08', quoteAsOf: '2026-10-08', marketOpen: true, ...o });
const gate = (policy, o, extra = {}) => gateOrder({ order: ord(o), policy, account: base, positions: held, capabilities: caps, journal: [], now: new Date('2026-10-08T14:40:00Z'), ...extra });

test('השער: תקרת אסטרטגיה 45% חוסמת במאוזן, 55% מתירה באגרסיבי; ההגנות נשארות', () => {
  const b = gate(B, {}); assert.equal(b.allowed, false); assert.ok(b.reasons.some((r) => /אסטרטגיה trend/.test(r)), JSON.stringify(b.reasons));
  const a = gate(A, {}); assert.equal(a.allowed, true, JSON.stringify(a.reasons));
  // חריגה מתקרת הפקודה (12%): נחסם גם באגרסיבי
  assert.equal(gate(A, { notionalIls: 26000 }).allowed, false);
  // הפסד יומי 3%: נחסם באגרסיבי, ובמאוזן (4%) עדיין מותר
  const loss = { ...base, dayPnlIls: -6500 };
  assert.equal(gate(A, {}, { account: loss }).allowed, false); assert.ok(gate(A, {}, { account: loss }).reasons.some((r) => /הפסד יומי/.test(r)));
  assert.equal(gate(B, { strategy: 'xmom' }, { account: loss }).allowed, true);
  // ירידה מהשיא 15% חוסמת באגרסיבי
  assert.equal(gate(A, { strategy: 'xmom' }, { account: { ...base, equityIls: 168000 } }).allowed, false);
  // kill switch חוסם הכול
  assert.equal(gate({ ...A, killSwitch: true }, { strategy: 'xmom' }).allowed, false);
  // מינוף כולל 3.0 (מקסימום): 2.05× מותר, 3.05× נחסם
  assert.equal(gate(A, { strategy: 'xmom', notionalIls: 20000 }, { account: { ...base, grossExposureIls: 390000 } }).allowed, true);
  assert.equal(gate(A, { strategy: 'xmom', notionalIls: 20000 }, { account: { ...base, grossExposureIls: 590000 } }).allowed, false);
});

test('גבול ה-live: מצב live בלי approval תקף נדחה בשני הפרופילים; האגרסיבי לא יכול להיות live בטעות', () => {
  for (const p of [A, B]){
    const r = gate({ ...p, mode: 'live' }, { strategy: 'xmom' });
    assert.equal(r.allowed, false); assert.ok(r.reasons.some((x) => /live בלי אישור/.test(x)));
    const wrong = gate({ ...p, mode: 'live', approval: { policyHash: policyHash(B), capitalIls: 200000 } }, { strategy: 'xmom' });
    assert.equal(wrong.allowed, false, 'approval על hash של פרופיל אחר לא תקף');
  }
});
