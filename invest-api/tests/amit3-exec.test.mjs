// בדיקות לבוט 3 (שיטת הקורס בדמו של Bybit): אותו טריגר כמו בבדיקה לאחור, תכנון 30-60-90, ניהול העסקה
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOT3, klines, toM1, liveSignal, planEntry, manage, roundStep, retry } from '../engine/amit3-exec.js';
import { prepare, triggers, CANON } from '../engine/amit-course.js';

const T0 = Date.UTC(2026, 0, 1);
function scenario(kind){
  const p = [];
  for (let i = 0; i < 3 * 1440; i++) p.push({ c: 100 + 0.05 * Math.sin(i / 7) });
  for (let k = 1; k <= 20; k++) p.push({ c: 100 - k * 0.13 });
  p.push({ o: 97.45, c: 97.3, l: 97.2, h: 97.5, v: 20000 });
  if (kind === 'up') for (let k = 1; k <= 240; k++) p.push({ c: Math.min(100.5, 97.3 + k * 0.03) });
  return p.map((x, i) => { const prev = i ? p[i - 1].c : x.c, o = x.o ?? prev; return { t: T0 + i * 60e3, o, c: x.c, h: x.h ?? Math.max(o, x.c) * 1.0002, l: x.l ?? Math.min(o, x.c) * 0.9998, v: x.v ?? 1000 }; });
}
const INST = { qtyStep: 0.01, minQty: 0.01, tick: 0.001 };

test('klines: רק נרות סגורים, מהישן לחדש, v = מחזור', () => {
  const now = T0 + 3 * 60e3 + 5000;
  const list = [[String(T0 + 3 * 60e3), '1', '2', '0.5', '1.5', '10', '15'], [String(T0 + 2 * 60e3), '1', '2', '0.5', '1.2', '10', '12'], [String(T0 + 60e3), '1', '2', '0.5', '1.1', '10', '11']];
  const b = klines(list, now); assert.equal(b.length, 2); assert.ok(b[0].t < b[1].t); assert.equal(b[1].v, 12);
});

test('liveSignal: מזהה טריגר רק כשהוא הנר האחרון שנסגר — אותו טריגר כמו בבדיקה לאחור', () => {
  const all = scenario('flat'), k = all.length - 1;               // הנר האחרון הוא נר הטריגר
  const { signal } = liveSignal(all, 'follow');
  const bt = triggers(prepare(toM1(all)), 'follow', CANON);
  assert.ok(signal); assert.equal(signal.i, k); assert.equal(signal.t, bt.at(-1).t);
  assert.equal(liveSignal(all, 'follow', signal.t).signal, null);  // אותו נר — לא פעמיים
  assert.equal(liveSignal(all.slice(0, -1), 'follow').signal, null); // נר לפני — אין טריגר
});

test('liveSignal: משיכה שנכשלה — בסבב הבא נוספו 2 נרות, והטריגר בנר שלפני האחרון לא הולך לאיבוד (minI)', () => {
  const all = scenario('flat'), bt = triggers(prepare(toM1(all)), 'follow', CANON);
  const L = all.at(-1), more = [...all, { t: L.t + 60e3, o: L.c, c: L.c + 0.02, h: L.c + 0.05, l: L.c - 0.01, v: 1000 }];
  assert.equal(liveSignal(more, 'follow').signal, null);                          // בלי minI: הטריגר כבר לא האחרון → היה מתפספס
  const { signal } = liveSignal(more, 'follow', 0, more.length - 2);              // שני הנרות החדשים נבדקים
  assert.ok(signal); assert.equal(signal.t, bt.at(-1).t);
  assert.equal(liveSignal(more, 'follow', signal.t, more.length - 2).signal, null); // ואותו טריגר לא נכנס פעמיים
  assert.equal(liveSignal(more, 'follow', 0, more.length).signal, null);          // אין נרות חדשים → אין טריגר
});

test('retry: מגבלת קצב (10006) — ניסיון חוזר עם המתנה שגדלה; שגיאה אחרת — בלי ניסיון חוזר', async () => {
  const waits = [], sleep = async (ms) => { waits.push(ms); };
  let n = 0;
  const ok = await retry(async () => { if (++n < 3){ const e = new Error('10006 Too many visits'); e.code = 10006; throw e; } return 'ok'; }, { sleep });
  assert.equal(ok, 'ok'); assert.equal(n, 3); assert.equal(waits.length, 2); assert.ok(waits[0] >= 1000 && waits[1] >= 2000);
  n = 0; await assert.rejects(retry(async () => { n++; const e = new Error('10001 params error'); e.code = 10001; throw e; }, { sleep }), /10001/); assert.equal(n, 1);
  n = 0; await assert.rejects(retry(async () => { n++; const e = new Error('x'); e.code = 10006; throw e; }, { sleep, tries: 3 })); assert.equal(n, 3);
});

test('planEntry: 30-60-90 — ההפסד אם כל המנות התמלאו והסטופ נפגע ≈ סיכון הבוט', () => {
  const { signal } = liveSignal(scenario('flat'), 'follow'), p = planEntry(signal, INST);
  const loss = p.qty.reduce((s, q, k) => s + q * (p.px[k] - p.stop), 0);
  assert.ok(Math.abs(loss - BOT3.riskUsd) < BOT3.riskUsd * 0.02, `loss ${loss}`);
  assert.ok(p.px[0] > p.px[1] && p.px[1] > p.px[2] && p.px[2] > p.stop);
  assert.ok(p.qty[2] > p.qty[1] && p.qty[1] > p.qty[0]);
  assert.equal(planEntry(signal, { ...INST, minQty: 1e9 }), null);
});

test('manage: 75% ברמה הקרובה → סטופ לכניסה → 25% ברמה הרחוקה; 24 שעות → סגירה', () => {
  const bars = scenario('up'), base = bars.slice(0, 3 * 1440 + 21), ctx0 = liveSignal(base, 'follow');
  const tr = { phase: 0, entryT: base.at(-1).t, zone: ctx0.signal.P.zone, filled: true };
  let acts = [];
  for (let n = base.length + 1; n <= bars.length && !acts.some((a) => a.type === 'reduce'); n++){ const { ctx } = liveSignal(bars.slice(0, n), 'follow'); acts = manage(tr, { size: 10, avg: 97.3 }, ctx, bars[n - 1].t, INST); }
  assert.ok(acts.some((a) => a.type === 'reduce' && Math.abs(a.qty - 7.5) < 1e-9));
  const sl = acts.find((a) => a.type === 'moveSl'); assert.ok(sl.price > 97.3);
  const ph = acts.find((a) => a.type === 'phase'); assert.equal(ph.phase, 1); assert.ok(ph.runner > 97.3);
  const { ctx } = liveSignal(bars, 'follow');
  assert.deepEqual(manage({ ...tr }, { size: 10, avg: 97.3 }, ctx, tr.entryT + 25 * 3600e3, INST).map((a) => a.type), ['cancelPending', 'closeAll']);
  assert.deepEqual(manage({ ...tr }, null, ctx, tr.entryT + 60e3, INST).map((a) => a.type), ['cancelPending', 'done']);
  assert.deepEqual(manage({ ...tr, filled: false }, null, ctx, tr.entryT + 60e3, INST), []);
});

test('roundStep ובטיחות: הכתובת קבועה לדמו, לא נוגעים ב-ETH (בוט 2)', () => {
  assert.equal(roundStep(1.2345, 0.01), 1.23); assert.equal(roundStep(1.235, 0.01, 'round'), 1.24);
  assert.ok(BOT3.base.includes('api-demo.')); assert.ok(!('ETH' in BOT3.coins));
});

// ---------- שער הפקודות (order-gate) לבוט 3 ----------
import { gate3, linkId3, BOT3_POLICY } from '../engine/amit3-gate.js';
const ENV0 = (extra = {}) => ({ now: Date.UTC(2026, 10, 10, 12), equity: 100000, available: 90000, dayPnl: 0, hwm: 100000, positions: {}, journal: [], ...extra });

test('שער: כניסה רגילה עוברת; ETH (לא ברשימה) ושורט נדחים', () => {
  const ok = gate3({ sym: 'SOLUSDT', side: 'buy', qty: 10, price: 150, id: linkId3('SOLUSDT', 1, 'e1'), worstLoss: 40 }, ENV0());
  assert.equal(ok.allowed, true, ok.reasons.join(','));
  assert.equal(gate3({ sym: 'ETHUSDT', side: 'buy', qty: 1, price: 3000, id: 'x', worstLoss: 50 }, ENV0()).allowed, false);
  assert.equal(gate3({ sym: 'SOLUSDT', side: 'short', qty: 1, price: 150, id: 'y', worstLoss: 5 }, ENV0()).allowed, false);
});
test('שער: מגבלה יומית חוסמת כניסה אבל לא סגירה; כפילות נחסמת; מנה מעבר לתקרה נחסמת', () => {
  const env = ENV0({ dayPnl: -1001, positions: { SOLUSDT: { size: 10, avg: 150, unrealized: -100 } } });
  assert.equal(gate3({ sym: 'AVAXUSDT', side: 'buy', qty: 10, price: 30, id: 'a', worstLoss: 10 }, env).allowed, false);
  assert.equal(gate3({ sym: 'SOLUSDT', side: 'sell', qty: 10, price: 150, id: 'b' }, env).allowed, true);
  const dup = ENV0({ journal: [{ clientOrderId: 'same' }] });
  assert.equal(gate3({ sym: 'SOLUSDT', side: 'buy', qty: 1, price: 150, id: 'same', worstLoss: 4 }, dup).allowed, false);
  assert.equal(gate3({ sym: 'SOLUSDT', side: 'buy', qty: 1000, price: 150, id: 'big', worstLoss: 400 }, ENV0()).allowed, false); // 150,000$ > 60,000$
});
test('שער: מנה 60/90 לפוזיציה מפסידה — רק כחלק מתוכנית שנקבעה מראש (addToPlan); בלי סטופ (worstLoss=null) — נדחה', () => {
  const env = ENV0({ positions: { SOLUSDT: { size: 2, avg: 150, unrealized: -3 } } });
  assert.equal(gate3({ sym: 'SOLUSDT', side: 'buy', qty: 4, price: 149, id: 'e2', worstLoss: 20 }, env).allowed, false);
  assert.equal(gate3({ sym: 'SOLUSDT', side: 'buy', qty: 4, price: 149, id: 'e2b', worstLoss: 20, addToPlan: true }, env).allowed, true);
  assert.equal(gate3({ sym: 'SOLUSDT', side: 'buy', qty: 1, price: 150, id: 'n' }, ENV0()).allowed, false);
  assert.equal(BOT3_POLICY.mode, 'paper'); assert.equal(BOT3_POLICY.noAveragingDown, true); assert.ok(linkId3('FARTCOINUSDT', Date.now(), 'e3').length <= 36);
});
test('שער: ביטול פקודה ממתינה מותר גם בעצירה יומית בלי פוזיציה (אחרת מנות 60/90 עלולות להתמלא)', () => {
  const env = ENV0({ dayPnl: -5000 });
  assert.equal(gate3({ sym: 'SOLUSDT', side: 'sell', qty: 4, price: 149, id: 'a3-SOL-x-e2-c' }, env).allowed, false); // בלי הדגל — נחסם (סיכון חדש)
  const c = gate3({ sym: 'SOLUSDT', side: 'sell', qty: 4, price: 149, id: 'a3-SOL-x-e2-c', cancel: true }, env);
  assert.equal(c.allowed, true); assert.equal(c.checks.cancel, true);
});
