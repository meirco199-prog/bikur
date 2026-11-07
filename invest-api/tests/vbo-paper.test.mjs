// מעקב Paper לפריצת תנודתיות תוך-יומית BTC/ETH: זהות לכלל של מנוע המחקר (אותן כניסות), התחלה בלי שחזור עבר, יציאה בסוף היום,
// חשבון עלויות, אימות הדוח ב-Worker ושורות בסיכום היומי
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VBO, step, signal, newState } from '../engine/vbo-paper.js';
import { cleanVbo, vboLines, VBOPAPER_KEY } from '../lib/vbo-paper.js';
import { alignH, strategies, runBars } from '../engine/research-hourly.js';
import { formatSummary } from '../lib/amit-live.js';

const HOUR = 3600e3, DAY = 86400e3, T0 = Date.parse('2026-01-01T00:00:00Z');
let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const walk = (n, p0, drift = 0.0004) => { let x = p0; return Array.from({ length: n }, (_, i) => { const o = x; x *= Math.exp(drift + (rnd() - 0.5) * 0.02); return { t: T0 + i * HOUR, o, h: Math.max(o, x) * 1.001, l: Math.min(o, x) * 0.999, c: x }; }); };
const mk = (days = 50) => ({ BTC: walk(24 * days, 40000), ETH: walk(24 * days, 2000) });
const iso = (t) => new Date(t).toISOString();

test('זהות למנוע המחקר: אותן כניסות (מטבע + שעה) כמו VBO0.7-ma20-BE ב-research-hourly', () => {
  const bars = mk(), A = alignH(bars), s = strategies(A).find((x) => x.id === VBO.id), { trades } = runBars(A, s);
  const from = T0 + 25 * DAY; // מתחילים בסוף יום 24 (23:00) — אין פוזיציה פתוחה במנוע
  const prev = { ...newState(T0, VBO), lastHour: iso(from - HOUR), startDay: iso(from).slice(0, 10), btcStart: bars.BTC[25 * 24 - 1].c };
  const { state } = step(prev, bars);
  const eng = trades.filter((x) => x.t > from).map((x) => `${x.coin}@${iso(x.t)}`).sort();
  const pap = state.trades.map((x) => `${x.coin}@${x.in}`).concat(Object.entries(state.pos).map(([c, p]) => `${c}@${p.t}`)).sort();
  assert.ok(eng.length >= 3, `צריך כמה עסקאות לבדיקה (${eng.length})`);
  assert.deepEqual(pap, eng);
});

test('ריצה ראשונה: מתחילים מהשעה הסגורה האחרונה — בלי שחזור עבר ובלי פוזיציה', () => {
  const bars = mk(30), { state, processed, events } = step(null, bars);
  assert.equal(processed, 1); assert.equal(events.length, 0); assert.deepEqual(state.pos, {}); assert.equal(state.equity, VBO.startUsd);
  assert.equal(state.lastHour, iso(bars.BTC.at(-1).t));
});

test('יציאה בסגירת 23:00 UTC; ההון = התחלה + סכום ה-pnl של העסקאות (כולל עלויות ו-Funding)', () => {
  const bars = mk(), from = T0 + 25 * DAY;
  const prev = { ...newState(T0, VBO), lastHour: iso(from - HOUR), startDay: '2026-01-26', btcStart: 1 };
  const { state } = step(prev, { BTC: bars.BTC.slice(0, 49 * 24), ETH: bars.ETH.slice(0, 49 * 24) }); // נגמר ב-23:00 → הכול סגור
  assert.deepEqual(state.pos, {});
  for (const t of state.trades) assert.equal(new Date(Date.parse(t.out)).getUTCHours(), 0, 'יציאה בסוף היום (סגירת נר 23:00 = 00:00)');
  const sum = state.trades.reduce((s, x) => s + x.pnlUsd, 0);
  assert.ok(Math.abs(VBO.startUsd + sum - state.equity) < 0.05 * state.trades.length + 0.01);
  assert.ok(state.costsUsd > 0 && state.fundUsd > 0);
});

test('signal: טריגר = פתיחת היום + 0.7 × הטווח של אתמול, ורק מעל ממוצע 20 יום', () => {
  const bars = mk(30), t = bars.BTC[25 * 24 + 5].t, q = signal(bars, 'BTC', t);
  const day = (d) => bars.BTC.slice(d * 24, d * 24 + 24), y = day(24), today = day(25);
  const trig = today[0].o + 0.7 * (Math.max(...y.map((b) => b.h)) - Math.min(...y.map((b) => b.l)));
  assert.ok(Math.abs(q.trig - trig) < 0.01);
  const ma = Array.from({ length: 20 }, (_, i) => day(24 - i).at(-1).c).reduce((s, x) => s + x, 0) / 20;
  assert.equal(q.ok, bars.BTC[25 * 24 + 5].c > trig && y.at(-1).c > ma);
});

test('Worker: cleanVbo דוחה דוח זר; שורות בסיכום היומי', () => {
  assert.throws(() => cleanVbo({ id: 'X' }), /לא תקין/);
  const bars = mk(), prev = { ...newState(T0, VBO), lastHour: iso(T0 + 25 * DAY - HOUR), startDay: '2026-01-26', btcStart: bars.BTC[599].c };
  const { state } = step(prev, bars), rep = { ...cleanVbo(state), receivedAt: iso(T0 + 50 * DAY) };
  const lines = vboLines(rep, T0 + 50 * DAY).join('\n');
  assert.match(lines, /פריצה תוך-יומית BTC\/ETH/); assert.match(lines, /עסקאות: \d+/);
  assert.match(vboLines({ ...rep, receivedAt: iso(T0) }, T0 + 50 * DAY).join('\n'), /לא התעדכן/);
  const s = { trades: [], agg: { n: 0, wins: 0, netUsd: 0, feesUsd: 0 } };
  assert.match(formatSummary(s, '2026-02-19', null, null, T0 + 50 * DAY, null, null, rep), /⚡ מעקב Paper/);
  assert.equal(VBOPAPER_KEY, 'paper:vbo');
});

test('שעה שחסרה ל-BTC מעובדת ל-ETH; נר 23:00 חסר → יוצאים במחיר האחרון הידוע (הערת GPT ב-#221)', () => {
  const bars = mk(), from = T0 + 25 * DAY;
  const prev = { ...newState(T0, VBO), lastHour: iso(from - HOUR), startDay: '2026-01-26', btcStart: bars.BTC[599].c };
  const full = step(prev, bars).state;
  const ethTrade = full.trades.find((x) => x.coin === 'ETH'); assert.ok(ethTrade, 'צריך עסקת ETH לבדיקה');
  const tIn = Date.parse(ethTrade.in) - HOUR, tOut = Date.parse(ethTrade.out) - HOUR; // נר ההחלטה ונר 23:00 של אותה עסקה
  const holes = { BTC: bars.BTC.filter((b) => b.t !== tIn && b.t !== tOut), ETH: bars.ETH };
  const r = step(prev, holes).state, e2 = r.trades.find((x) => x.in === ethTrade.in);
  assert.ok(e2, 'הכניסה ל-ETH לא פוספסה כשנר ה-BTC חסר'); assert.equal(e2.out, ethTrade.out);
  // ETH חסר בנר 23:00 → יציאה בשעה הנכונה, במחיר הסגירה האחרון של ETH
  const holes2 = { BTC: bars.BTC, ETH: bars.ETH.filter((b) => b.t !== tOut) };
  const e3 = step(prev, holes2).state.trades.find((x) => x.in === ethTrade.in);
  assert.equal(e3.out, ethTrade.out); assert.equal(e3.exit, bars.ETH.find((b) => b.t === tOut - HOUR).c);
});
