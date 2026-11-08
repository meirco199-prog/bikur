// מנוע מחקר "המניות שירדו" (scripts/research-losers-grid.mjs): כיסוי נרות השעה גם לצירופי סינונים (הערת GPT ב-#227),
// סטופ תיק בדולרים, ורצפים / תשואת 2–3 ימים
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepare, select, run, hourlyNeed } from '../scripts/research-losers-grid.mjs';

let seed = 9; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
function mk(nSym = 120, nDays = 120, liqEvery = 3){
  const days = []; let t = Date.UTC(2026, 0, 5);
  while (days.length < nDays){ const d = new Date(t); if (d.getUTCDay() % 6) days.push(d.toISOString().slice(0, 10)); t += 864e5; }
  const D = {}, Hr = { __first: days[0] };
  for (let s = 0; s < nSym; s++){
    const sym = s ? `S${s}` : 'SPY', b = { d: [], o: [], h: [], l: [], c: [], v: [], sp: [] }; let c = 30 + rnd() * 50; Hr[sym] = {};
    const vol = s % liqEvery ? 1e6 : 5e6; // חלק מהמניות נזילות (> 100M$ ביום)
    for (const d of days){ const o = c * (1 + 0.005 * gauss()); let x = o; const hb = [];
      for (let h = 0; h < 7; h++){ const ho = x; x *= 1 + 0.01 * gauss(); hb.push([Math.min(10.5 + h, 16), ho, Math.max(ho, x) * 1.001, Math.min(ho, x) * 0.999, x]); }
      Hr[sym][d] = hb; b.d.push(d); b.o.push(o); b.h.push(Math.max(...hb.map((z) => z[2]))); b.l.push(Math.min(...hb.map((z) => z[3]))); b.c.push(x); b.v.push(vol); c = x; }
    D[sym] = b;
  }
  return { D, Hr };
}
const misses = (P, need, cfg) => { let m = 0, n = 0; for (let k = 51; k < P.L - 2; k++) for (const x of select(P, cfg, k)){ n += 1; if (!need[x.s]?.has(P.days[k + 1])) m += 1; } return { m, n }; };

test('נרות שעה: צירוף סינונים (dn3+liq / up3+liq) מכוסה רק כשהצירוף נמסר ל-hourlyNeed — בלי זה חלק מהמניות חסרות', () => {
  const { D } = mk(600, 80, 2), P = prepare(D); // יקום גדול ומעט מניות נזילות: הצירוף בוחר מניות מעבר ל-20 הראשונות של כל סינון בודד
  const cfgs = [{ sel: 'lo', filt: 'dn3+liq' }, { sel: 'hi', filt: 'up3+liq' }].flatMap((c) => ['r', 'r2', 'r3'].map((key) => ({ side: 'L', N: 20, entry: 'O', exit: 'close', hold: 1, key, ...c })));
  const without = hourlyNeed(P, []), withC = hourlyNeed(P, ['dn3+liq', 'up3+liq']);
  const a = cfgs.map((c) => misses(P, without, c)), b = cfgs.map((c) => misses(P, withC, c));
  assert.ok(b.reduce((s, x) => s + x.n, 0) > 200, 'צריך הרבה בחירות לבדיקה');
  assert.ok(a.reduce((s, x) => s + x.m, 0) > 0, 'הבדיקה צריכה להראות את הבעיה בלי הצירופים');
  assert.equal(b.reduce((s, x) => s + x.m, 0), 0, 'עם הצירופים — כל המניות שנבחרו מכוסות');
  assert.throws(() => hourlyNeed(P, ['dn3+nope']), /סינון לא מוכר/);
});

test('סטופ תיק בדולרים: סף ענק = בלי סטופ; run מדווח כמה פוזיציות היו בלי נרות שעה (noHr)', () => {
  const { D, Hr } = mk(60, 100), P = prepare(D, Hr), c = { side: 'L', sel: 'lo', N: 10, filt: 'all', entry: 'O', exit: 'close', hold: 1 };
  assert.ok(Math.abs(run(P, { ...c, port: { tpUsd: 1e12, slUsd: 1e12 } }, 55, 95).end - run(P, c, 55, 95).end) < 1e-6);
  const r = run(P, { ...c, port: { tpUsd: 500, slUsd: 500 } }, 55, 95); assert.equal(r.noHr, 0); assert.ok(r.tp + r.sl > 0);
  const P2 = prepare(D, {}), r2 = run(P2, { ...c, port: { tpUsd: 500, slUsd: 500 } }, 55, 95); assert.equal(r2.noHr, r2.trades);
});

test('רצפים ותשואה מצטברת: sd/su סופרים ימים רצופים, r3 = תשואת 3 ימים', () => {
  const { D } = mk(10, 70), b = D.S1;
  b.c[59] = b.c[58] * 1.01; for (let i = 60; i <= 63; i++) b.c[i] = b.c[i - 1] * 0.98; // יום עלייה ואחריו 4 ימי ירידה ברצף
  const P = prepare(D), x = P.cand[63].find((q) => q.s === 'S1');
  assert.equal(x.sd, 4); assert.equal(x.su, 0);
  assert.ok(Math.abs(x.r3 - (0.98 ** 3 - 1)) < 1e-9);
});
