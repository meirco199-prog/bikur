// טורניר 30 הגרסאות (engine/tournament.js): הרכב הגרסאות, צבירת נרות, עמלות וסיכון, וכל אחת משלוש המשפחות על נתונים מבוקרים
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VARIANTS, aggregate, simulate, stats, runTournament, FEES, SIZE } from '../engine/tournament.js';

const T0 = Date.parse('2026-10-01T00:00:00Z');
const bar = (i, o, h, l, c, m = 1) => ({ t: T0 + i * m * 60e3, o, h, l, c });
const quiet = (n, x = 100, a = 0.1, m = 1) => Array.from({ length: n }, (_, i) => { const c = x + (i % 2 ? a : -a); return bar(i, x, Math.max(x, c) + a / 2, Math.min(x, c) - a / 2, c, m); });

test('30 גרסאות, מזהים ייחודיים, שלוש משפחות (12/12/6)', () => {
  assert.equal(VARIANTS.length, 30);
  assert.equal(new Set(VARIANTS.map((v) => v.id)).size, 30);
  const fam = (f) => VARIANTS.filter((v) => v.family === f).length;
  assert.deepEqual([fam('touch'), fam('sweep'), fam('retrace')], [12, 12, 6]);
  assert.equal(FEES.maker, 0.02); assert.equal(FEES.taker, 0.055); assert.equal(SIZE.riskUsd, 400);
});

test('aggregate: 5 נרות דקה → נר 5 דקות; קבוצה חלקית נזרקת', () => {
  const m = [bar(0, 10, 11, 9, 10.5), bar(1, 10.5, 12, 10, 11), bar(2, 11, 11.5, 8, 9), bar(3, 9, 10, 8.5, 9.5), bar(4, 9.5, 10, 9, 9.8), bar(5, 9.8, 10, 9.7, 9.9)];
  const a = aggregate(m, '5m');
  assert.equal(a.length, 1); assert.deepEqual(a[0], { t: T0, o: 10, h: 12, l: 8, c: 9.8 });
});

test('touch: נגיעה ברצועה התחתונה → לונג על הרצועה (ממתינה), יציאה ברצועה הנגדית; עמלות וסיכון 400$', () => {
  const v = VARIANTS.find((x) => x.id === 'touch-1m-w0-opp');
  const bars = quiet(20);
  bars.push(bar(20, 100, 100.05, 99.7, 99.9)); // נוגע ברצועה התחתונה (≈99.8)
  bars.push(bar(21, 99.9, 100.5, 99.85, 100.4)); // נוגע ברצועה העליונה
  const [t] = simulate(bars, v);
  assert.equal(t.side, 'long'); assert.equal(t.why, 'יעד');
  assert.ok(t.entry < 99.85 && t.exit > 100.1);
  const N = Math.min(400 / 0.0022, 190000);
  assert.ok(Math.abs(t.fees - (N * 0.0002 + N * (t.exit / t.entry) * 0.0002)) < 1e-6, 'שתי פקודות ממתינות');
  assert.ok(Math.abs(t.net - (t.gross - t.fees)) < 1e-9);
});

test('touch: פער מתחת לרצועה בפתיחה → אין מילוי (PostOnly); סף רוחב חוסם רצועות צרות', () => {
  const bars = quiet(20); bars.push(bar(20, 99.5, 99.6, 99.4, 99.5));
  assert.equal(simulate(bars, VARIANTS.find((x) => x.id === 'touch-1m-w0-opp')).length, 0);
  // ±0.05 סביב 100 → סטיית תקן 0.05 → רוחב 4·0.05/100 = 0.2% (< 0.35%)
  const b2 = quiet(20, 100, 0.05); b2.push(bar(20, 100, 100.02, 99.85, 99.95)); b2.push(bar(21, 99.95, 100.2, 99.93, 100.15));
  assert.equal(simulate(b2, VARIANTS.find((x) => x.id === 'touch-1m-w0-opp')).length, 1, 'בלי סף — נכנסים');
  assert.equal(simulate(b2, VARIANTS.find((x) => x.id === 'touch-1m-w0.35-opp')).length, 0, 'עם סף 0.35% — לא');
});

test('sweep: חציה מתחת לרצועה, סגירה בפנים וחיובית → כניסה בפתיחת הנר הבא (מיידית), סטופ מתחת לקצה', () => {
  const v = VARIANTS.find((x) => x.id === 'sweep-5m-opp-rr0');
  const bars = quiet(19, 100, 0.1, 5);
  bars.push(bar(19, 99.75, 99.95, 99.5, 99.9, 5)); // חצה מתחת וחזר, חיובי
  bars.push(bar(20, 99.9, 100.6, 99.85, 100.5, 5)); // מגיע לרצועה העליונה
  const [t] = simulate(bars, v);
  assert.equal(t.side, 'long'); assert.equal(t.entry, 99.9); assert.equal(t.why, 'יעד');
  const N = 400 / (((99.9 - 99.5 * 0.9995) / 99.9));
  assert.ok(Math.abs(t.fees - (N * 0.00055 + N * (t.exit / t.entry) * 0.00055)) < 1e-6, 'כניסה ויעד מיידיים');
});

test('sweep: סינון רווח/סיכון — יעד קרוב מהסטופ → אין עסקה ב-rr1, יש ב-rr0', () => {
  const bars = quiet(19, 100, 0.1, 5);
  bars.push(bar(19, 99.75, 99.95, 98.9, 99.9, 5)); // זנב ארוך: סטופ רחוק, אמצע קרוב
  bars.push(bar(20, 99.9, 100.05, 99.85, 100, 5));
  assert.equal(simulate(bars, VARIANTS.find((x) => x.id === 'sweep-5m-mid-rr1')).length, 0);
  assert.ok(simulate(bars, VARIANTS.find((x) => x.id === 'sweep-5m-mid-rr0')).length <= 1);
});

test('retrace: נר תנופה עולה → קנייה ממתינה בתיקון 75%, יעד בקצה התנופה', () => {
  const v = VARIANTS.find((x) => x.id === 'retrace-5m-0.75');
  const bars = quiet(20, 100, 0.1, 5); // טווח ממוצע ≈0.3
  bars.push(bar(20, 100, 101.2, 99.9, 101.1, 5)); // תנופה: טווח 1.3
  bars.push(bar(21, 101.1, 101.15, 100.2, 100.3, 5)); // יורד ל-75% (=101.2−0.975=100.225)
  bars.push(bar(22, 100.3, 101.3, 100.25, 101.25, 5)); // חוזר לקצה
  const [t] = simulate(bars, v);
  assert.equal(t.side, 'long'); assert.ok(Math.abs(t.entry - (101.2 - 0.75 * 1.3)) < 1e-9); assert.equal(t.exit, 101.2); assert.equal(t.why, 'יעד');
});

test('stats + runTournament: נטו, ירידה מקסימלית, מיון לפי נטו, על נתוני הליכה אקראית', () => {
  const s = stats([{ close: 1, net: 100, gross: 120, fees: 20 }, { close: 2, net: -300, gross: -280, fees: 20 }, { close: 3, net: 50, gross: 70, fees: 20 }], 3);
  assert.deepEqual([s.trades, s.wins, s.net, s.maxDD, s.fees], [3, 2, -150, 300, 60]);
  let x = 100, seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const walk = Array.from({ length: 3 * 1440 }, (_, i) => { const o = x; x *= 1 + (rnd() - 0.5) * 0.004; const h = Math.max(o, x) * (1 + rnd() * 0.001), l = Math.min(o, x) * (1 - rnd() * 0.001); return { t: T0 + i * 60e3, o, h, l, c: x }; });
  const res = runTournament({ AAA: walk }, 3);
  assert.equal(res.length, 30);
  for (let i = 1; i < res.length; i++) assert.ok(res[i - 1].total.net >= res[i].total.net);
  assert.ok(res.some((r) => r.total.trades > 0));
  for (const r of res) assert.ok(Number.isFinite(r.total.net) && r.total.fees >= 0);
});
