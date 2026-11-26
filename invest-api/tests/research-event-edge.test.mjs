// מחקר "יתרון מאירועים" — פענוח לוח הדוחות, יום התגובה, H1, H2, עלויות לפי החשבונות בפועל
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as X from '../engine/event-edge.js';

const OPEN = Date.parse('2024-06-03T13:30:00Z') / 1000, CLOSE = OPEN + 6.5 * 3600;
const day = (path, start) => ({ t: path.map((_, i) => OPEN + i * 60), o: path.map((c, i) => i ? path[i - 1] : start), c: path });

test('לוח דוחות: "$1.23", "($0.12)", ריק; הפתעה יחסית לערך המוחלט של התחזית', () => {
  assert.equal(X.parseEps('$1.23'), 1.23); assert.equal(X.parseEps('($0.12)'), -0.12); assert.equal(X.parseEps(''), null); assert.equal(X.parseEps('N/A'), null);
  assert.equal(X.surprise(1.1, 1), 0.10000000000000009); assert.ok(Math.abs(X.surprise(-0.1, -0.2) - 0.5) < 1e-12); assert.equal(X.surprise(1, 0), null);
});

test('יום התגובה: לפני הפתיחה → אותו יום; אחרי הסגירה → הבא; לא צוין → היום עם הפער הגדול', () => {
  const d = [{ key: 20240603, o: 100, c: 100 }, { key: 20240604, o: 101, c: 101 }, { key: 20240605, o: 110, c: 110 }];
  assert.deepEqual(X.reactionDay(d, 20240604, 'time-pre-market'), { idx: 1, explicit: true });
  assert.deepEqual(X.reactionDay(d, 20240604, 'time-after-hours'), { idx: 2, explicit: true });
  assert.deepEqual(X.reactionDay(d, 20240604, 'time-not-supplied'), { idx: 2, explicit: false });
  assert.equal(X.reactionDay(d, 20240605, 'time-after-hours'), null, 'אין יום אחרי — אין אירוע');
});

test('H1: הפתעה חיובית + פער ≥ 2% + "מחזיק" ב-10:00 → לונג מ-10:00 עד 15:55; בלי "מחזיק" כשהמחיר ירד מתחת לפתיחה → אין', () => {
  const path = Array.from({ length: 390 }, (_, i) => 103 + i * 0.01);
  const ev = { sur: 0.1, prevClose: 100, m: day(path, 103), open: OPEN, close: CLOSE };
  const t = X.h1Trade(ev, { gap: 0.02, held: true, startMin: 30 });
  assert.equal(t.side, 1); assert.equal(t.entry, path[29]); assert.equal(t.exit, path[384]);
  const down = Array.from({ length: 390 }, (_, i) => 102.9 - i * 0.001);
  assert.equal(X.h1Trade({ ...ev, m: day(down, 103) }, { gap: 0.02, held: true, startMin: 30 }), null);
  assert.ok(X.h1Trade({ ...ev, m: day(down, 103) }, { gap: 0.02, held: false, startMin: 30 }));
  assert.equal(X.h1Trade({ ...ev, sur: -0.1 }, { gap: 0.02, held: true, startMin: 30 }), null, 'הפתעה שלילית עם פער למעלה — לא נכנסים');
  assert.equal(X.h1Trade({ ...ev, prevClose: 102 }, { gap: 0.02, held: true, startMin: 30 }), null, 'פער 1% מתחת לסף');
});

test('H2: r1 מסגירת אתמול עד 10:00; כניסה 15:30 ויציאה בסגירת 15:59; דרישת r12 באותו כיוון', () => {
  const path = Array.from({ length: 390 }, (_, i) => 100 + i * 0.01);
  const t = X.h2Trade({ m: day(path, 100), open: OPEN, close: CLOSE, prevClose: 99 }, { thr: 0, withR12: false });
  assert.equal(t.side, 1); assert.equal(t.entry, path[359]); assert.equal(t.exit, path[389]);
  assert.ok(Math.abs(t.r1 - (path[29] / 99 - 1)) < 1e-12);
  const p2 = path.map((x, i) => (i >= 330 && i < 360 ? 104 - (i - 330) * 0.05 : x));
  assert.equal(X.h2Trade({ m: day(p2, 100), open: OPEN, close: CLOSE, prevClose: 99 }, { thr: 0, withR12: true }), null);
  assert.equal(X.h2Trade({ m: day(path, 100), open: OPEN, close: CLOSE, prevClose: 100.29 }, { thr: 0.005, withR12: false }), null);
});

test('עלויות לפי החשבונות בפועל: מינימום 1$ להזמנה × 1.3, 3.5 נ"ב לצד; כפולות בבדיקת רגישות', () => {
  assert.equal(X.commission(10, 100), 1.3); assert.equal(X.commission(1000, 100), 6.5);
  const p = X.tradePnl(100, 101, 1, 20000), p2 = X.tradePnl(100, 101, 1, 20000, 2);
  assert.equal(p.sh, 200); assert.equal(p.gross, 200);
  assert.ok(Math.abs(p.net - (200 - 3.5e-4 * 200 * 201 - 1.3 - 1.3)) < 1e-9); assert.ok(p2.net < p.net);
  assert.equal(X.tradePnl(100, 99, -1, 20000).gross, 200, 'שורט מרוויח בירידה');
});
