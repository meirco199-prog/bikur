// מעקב Paper ל-Donchian 20/10: זהות למנוע המחקר (DC20-10-EW עם drift), התחלה עם מצב "במגמה" מההיסטוריה, איזון רק כשהאות משתנה,
// אימות הדוח ב-Worker, POST/GET /dc ושורות בסיכום היומי
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DC, step } from '../engine/dc-paper.js';
import { cleanDc, dcLines, DCPAPER_KEY } from '../lib/dc-paper.js';
import { align, strategies, runDaily } from '../engine/research-daily.js';
import { formatSummary } from '../lib/amit-live.js';

const DAY = 86400e3, D0 = Date.parse('2025-01-01T00:00:00Z');
let seed = 21; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const walk = (n, p0) => { let x = p0; return Array.from({ length: n }, (_, i) => { const o = x; x *= Math.exp((rnd() - 0.49) * 0.06); return { t: D0 + i * DAY, o, h: Math.max(o, x), l: Math.min(o, x), c: x }; }); };
const COINS = ['BTC', 'ETH', 'SOL', 'ADA', 'LINK'];
const mk = (n = 300) => Object.fromEntries(COINS.map((c, i) => [c, walk(n, 100 * (i + 1))]));
const closesOf = (bars, n) => Object.fromEntries(Object.entries(bars).map(([c, b]) => [c, b.slice(0, n).map((x) => ({ t: x.t, c: x.c }))]));

test('זהות למנוע המחקר: אותם ימי איזון ואותם מטבעות, ותשואה זהה (DC20-10-EW עם drift)', () => {
  const bars = mk(), A = align(bars), s = strategies(A.coins).find((q) => q.id === DC.id);
  const { series } = runDaily(A, s, { drift: true });
  const first = step(null, closesOf(bars, 151)).state, { state } = step(first, closesOf(bars, 300));
  // ימי האיזון במחקר: ימים שבהם משקלי היעד השתנו (ההחלטה בסגירת d, הביצוע ב-d+1)
  const st = {}, eng = []; let prev = null;
  for (let d = 0; d < 300; d++){ const w = s.weights(A, d, st).map((x) => +x.toFixed(12)); if (d > 150 && prev && w.join() !== prev.join()) eng.push(`${new Date(A.days[d]).toISOString().slice(0, 10)}:${COINS.filter((_, k) => w[k] > 0).join(',')}`); prev = w; }
  const pap = state.changes.slice(1).map((e) => `${e.day}:${COINS.filter((c) => e.held.includes(c)).join(',')}`);
  assert.ok(eng.length >= 5, `צריך כמה איזונים לבדיקה (${eng.length})`);
  assert.deepEqual(pap, eng);
  const a = state.daily.findIndex((x) => x.day === '2025-06-15'), eqA = state.daily[a].equity, eqB = state.daily.at(-1).equity;
  const from = Date.parse('2025-06-15T00:00:00Z'), g = series.filter((x) => x.t > from).reduce((e, x) => e * (1 + x.net), 1);
  assert.ok(Math.abs(eqB / eqA - g) < 0.005, `${eqB / eqA} ≠ ${g}`);
});

test('ריצה ראשונה: מצב "במגמה" מההיסטוריה, הקצאה של 1/N לכל מטבע במגמה בסגירת היום האחרון, עלות כניסה', () => {
  const bars = mk(200), { state, processed, events } = step(null, closesOf(bars, 200));
  assert.equal(processed, 1); assert.equal(events.length, 1);
  const held = Object.keys(state.weights); assert.ok(held.every((c) => state.inPos[c] && Math.abs(state.weights[c] - 1 / COINS.length) < 1e-12));
  assert.ok(state.equity < DC.startUsd || !held.length);
});

test('Worker: cleanDc דוחה דוח זר; POST /dc בלי סוד = 401, עם סוד = נשמר; GET /dc; שורה 📊 בסיכום היומי', async () => {
  const { state } = step(null, closesOf(mk(200), 200));
  assert.throws(() => cleanDc({ ...state, id: 'x' }), /לא תקין/);
  const rep = { ...cleanDc(state), receivedAt: new Date().toISOString() };
  assert.match(dcLines(rep).join('\n'), /Donchian 20\/10/);
  const s = { trades: [], agg: { n: 0, wins: 0, netUsd: 0, feesUsd: 0 }, pos: null };
  assert.match(formatSummary(s, '2026-11-08', null, null, Date.now(), null, null, null, rep), /📊 מעקב Paper — Donchian/);
  const { default: worker } = await import('../worker.js');
  const store = new Map(), kv = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async () => ({ keys: [] }) };
  const env = { CRON_SECRET: 'c', INVEST: kv, APP_TOKEN: 't' };
  const post = (q) => worker.fetch(new Request(`https://x/dc${q}`, { method: 'POST', body: JSON.stringify(state), headers: { 'Content-Type': 'application/json' } }), env, {});
  assert.equal((await post('')).status, 401);
  assert.equal((await post('?secret=c')).status, 200);
  const g = await (await worker.fetch(new Request('https://x/dc'), env, {})).json();
  assert.equal(g.id, 'DC20-10-EW'); assert.equal(DCPAPER_KEY, 'paper:dc');
});
