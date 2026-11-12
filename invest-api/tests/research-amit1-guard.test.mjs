// בדיקות למחקר סינון "סכין נופלת" וסטופ נגרר של בוט 1 (scripts/research-amit1-guard.mjs)
import test from 'node:test';
import assert from 'node:assert/strict';
import { bandsAt, mom15, simTrade, runVariant, paired, BOT1 } from '../scripts/research-amit1-guard.mjs';

const NOC = { maker: 0, taker: 0, slip: 0 };
function m1Of(rows, t0 = Date.UTC(2024, 0, 1)){
  const n = rows.length, m = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n) };
  rows.forEach(([o, h, l, c], i) => { m.t[i] = t0 + i * 60e3; m.o[i] = o; m.h[i] = h; m.l[i] = l; m.c[i] = c; });
  return m;
}
// 21 דקות מתנדנדות סביב 100 (רצועות רחבות ~±1%), ואחריהן השורות הנתונות
const warm = Array.from({ length: 21 }, (_, i) => { const c = i % 2 ? 100.5 : 99.5; return [c, c, c, c]; });

test('bandsAt + mom15: רצועות מ-20 הסגירות שלפני, מומנטום בכיוון העסקה', () => {
  const m = m1Of(warm), b = bandsAt(m.c, 21);
  assert.ok(Math.abs(b.mid - 100) < 1e-9); assert.ok(Math.abs(b.lo - 99) < 1e-9); assert.ok(Math.abs(b.up - 101) < 1e-9);
  const c = Float64Array.from({ length: 20 }, (_, i) => 100 - i * 0.1);   // יורד
  assert.ok(mom15(c, 17, 1) < 0); assert.ok(mom15(c, 17, -1) > 0);
});

test('simTrade: סטופ בדקת הכניסה, יעד ברצועה הנגדית, סטופ נגרר אחרי +0.3%', () => {
  const stop = simTrade(m1Of([...warm, [99.5, 99.5, 98.7, 98.8]]), 21, 1, 99, {}, BOT1, NOC);
  assert.equal(stop.why, 'סטופ'); assert.equal(stop.exitI, 21); assert.ok(Math.abs(stop.pnl + BOT1.notional * 0.0022) < 1e-6);
  const tp = simTrade(m1Of([...warm, [99.5, 99.5, 98.95, 99.2], [99.3, 101.2, 99.2, 101]]), 21, 1, 99, {}, BOT1, NOC);
  assert.equal(tp.why, 'יעד'); assert.ok(tp.pnl > 0);
  // +0.4% ואז חזרה: עם נגרר 0.1% יוצאים ברווח, בלי — סטופ מלא
  const path = [...warm, [99.5, 99.5, 98.95, 99.2], [99.2, 99.4, 99.1, 99.38], [99.38, 99.38, 98.7, 98.75]];
  const plain = simTrade(m1Of(path), 21, 1, 99, {}, BOT1, NOC), tr = simTrade(m1Of(path), 21, 1, 99, { trail: { a: 0.3, b: 0.1 } }, BOT1, NOC);
  assert.equal(plain.why, 'סטופ'); assert.equal(tr.why, 'סטופ נגרר'); assert.ok(tr.pnl > 0);
});

test('runVariant: סינון סכין נופלת מדלג על כניסה אחרי ירידה, paired סופר דילוג כ-0', () => {
  // ירידה חדה ב-15 הדקות האחרונות, ואז נגיעה ברצועה התחתונה
  const fall = Array.from({ length: 30 }, (_, i) => { const c = 100 + (i % 2 ? 0.5 : -0.5) - (i > 14 ? (i - 14) * 0.15 : 0); return [c, c, c, c]; });
  const m = m1Of([...fall, [97.9, 97.9, 96, 96.1]]);
  const now = runVariant(m, {}, BOT1, NOC), kn = runVariant(m, { knife: 0.5 }, BOT1, NOC);
  assert.equal(now.length, 1); assert.equal(now[0].why, 'סטופ'); assert.equal(kn.length, 0);
  const pr = paired(kn, now); assert.equal(pr.n, 1); assert.ok(Math.abs(pr.mean + now[0].pnl) < 1e-6); // דילוג = 0 → חסכנו את ההפסד
});
