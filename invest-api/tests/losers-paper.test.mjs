// מעקב Paper ל"3 המניות שירדו 3%–7%": זהות למנוע המחקר (research-losers-grid.mjs), טיפול בפיצולים, אימות הדוח ב-Worker,
// POST/GET /losers ושורה בסיכום היומי
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOS, step, picks, index } from '../engine/losers-paper.js';
import { cleanLosers, losersLines, LOSPAPER_KEY } from '../lib/losers-paper.js';
import { prepare, run } from '../scripts/research-losers-grid.mjs';
import { formatSummary } from '../lib/amit-live.js';

let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const gauss = () => Math.sqrt(-2 * Math.log(rnd())) * Math.cos(2 * Math.PI * rnd());
function mk(nSym = 60, nDays = 160){
  const days = []; let t = Date.UTC(2026, 0, 5);
  while (days.length < nDays){ const d = new Date(t); if (d.getUTCDay() % 6) days.push(d.toISOString().slice(0, 10)); t += 864e5; }
  const D = {};
  for (let s = 0; s < nSym; s++){
    const b = { d: [], o: [], h: [], l: [], c: [], v: [], sp: [] }; let c = 20 + rnd() * 80;
    for (const d of days){ const o = c * (1 + 0.01 * gauss()), x = o * (1 + 0.03 * gauss()); b.d.push(d); b.o.push(o); b.h.push(Math.max(o, x) * 1.01); b.l.push(Math.min(o, x) * 0.99); b.c.push(x); b.v.push(1e6 + rnd() * 2e6); c = x; }
    D[s ? `S${s}` : 'SPY'] = b;
  }
  return { D, days };
}
const cut = (D, n) => Object.fromEntries(Object.entries(D).map(([s, b]) => [s, { ...b, d: b.d.slice(0, n), o: b.o.slice(0, n), h: b.h.slice(0, n), l: b.l.slice(0, n), c: b.c.slice(0, n), v: b.v.slice(0, n) }]));

test('זהות למנוע המחקר: אותן מניות ואותו הון סופי (L, יורדות 3%–7%, 3 מניות, סגירה → סגירה)', () => {
  const { D } = mk(), k0 = 70, k1 = 150;
  const res = run(prepare(D), { side: 'L', sel: 'lo', N: 3, filt: 'mild', entry: 'C', exit: 'close', hold: 1 }, k0, k1);
  const a = step(null, cut(D, k0 + 1)).state, { state } = step(a, cut(D, k1 + 1));
  assert.ok(state.trades.length > 100, `צריך הרבה עסקאות לבדיקה (${state.trades.length})`);
  assert.equal(state.trades.length, res.trades);
  const newFees = state.pos.reduce((x, p) => x + p.feeIn, 0); // הכניסות של היום האחרון — במחקר הן שייכות לחלון הבא
  assert.ok(Math.abs(state.equity + newFees - res.end) < 1, `${state.equity + newFees} ≠ ${res.end}`);
});

test('ריצה ראשונה: נכנסים רק ביום האחרון, 3 מניות בשליש מההון, רק ירידות 3%–7%', () => {
  const { D } = mk(), { state, processed } = step(null, D);
  assert.equal(processed, 1); assert.ok(state.pos.length <= 3);
  for (const p of state.pos){ assert.ok(p.r < -0.03 && p.r >= -0.07); assert.ok(p.sh * p.bp <= LOS.startUsd / 3 + 1); }
});

test('פיצול: ירידה גולמית של 52.5% ביום פיצול 2:1 נמדדת כירידה האמיתית (5%) על הסדרה המתוקנת', () => {
  const { D, days } = mk(20, 60), b = D.S1, k = 59;
  b.c[k] = b.c[k - 1] * 0.95 / 2; b.sp = [[days[k], 2]]; // פיצול 2:1 ביום k וירידה אמיתית של 5%
  const all = picks(index(D), k, { ...LOS, lo: -1, hi: 0, N: 100 }), s1 = all.find((x) => x.s === 'S1');
  assert.ok(s1 && Math.abs(s1.r + 0.05) < 1e-9, `S1: ${s1?.r}`);
  b.sp = []; assert.ok(Math.abs(picks(index(D), k, { ...LOS, lo: -1, hi: 0, N: 100 }).find((x) => x.s === 'S1').r + 0.525) < 1e-9); // בלי נתון הפיצול — 52.5%
});

test('Worker: cleanLosers דוחה דוח זר; POST /losers בלי סוד = 401, עם סוד = נשמר; GET /losers; שורה 📉 בסיכום היומי', async () => {
  const { D } = mk(), a = step(null, cut(D, 100)).state, { state } = step(a, D);
  assert.throws(() => cleanLosers({ ...state, id: 'x' }), /לא תקין/);
  const rep = { ...cleanLosers(state), receivedAt: new Date().toISOString() };
  assert.match(losersLines(rep).join('\n'), /3 שירדו 3%–7%/);
  const s = { trades: [], agg: { n: 0, wins: 0, netUsd: 0, feesUsd: 0 }, pos: null };
  assert.match(formatSummary(s, '2026-11-09', null, null, Date.now(), null, null, null, null, rep), /📉 מעקב Paper — מניות ארה״ב/);
  const { default: worker } = await import('../worker.js');
  const store = new Map(), kv = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async () => ({ keys: [] }) };
  const env = { CRON_SECRET: 'c', INVEST: kv, APP_TOKEN: 't' };
  const post = (q) => worker.fetch(new Request(`https://x/losers${q}`, { method: 'POST', body: JSON.stringify(state), headers: { 'Content-Type': 'application/json' } }), env, {});
  assert.equal((await post('')).status, 401);
  assert.equal((await post('?secret=c')).status, 200);
  const g = await (await worker.fetch(new Request('https://x/losers'), env, {})).json();
  assert.equal(g.id, 'LOS3-mild-CC'); assert.equal(LOSPAPER_KEY, 'paper:losers'); assert.equal(g.trades.length, state.trades.length);
});
