// המעקב הווירטואלי השני (engine/xsra-bybit-paper.js): זהות מלאה למחקר 7ל (simulate, גרסה AB, עלות C5), יום התחלה בלי מבט לאחור,
// ריצה יומית = ריצה אחת, היסטוריה נעולה, כללי ההתראה/הפסילה/12 החודשים, ובידוד מוחלט מ-XSRA-7 המקורי (מפתח, מזהה, נתיב)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { XSRB, COST, step, replay, verdict, alignBars, newState } from '../engine/xsra-bybit-paper.js';
import { simulate, VERSIONS } from '../engine/xsra-protect.js';
import { DCOST } from '../engine/research-daily.js';
import { cleanXsrb, recordXsrb, xsrbLines, XSRB_KEY } from '../lib/xsra-bybit-paper.js';
import { XSRAPAPER_KEY } from '../lib/xsra-paper.js';
import { XSRAP } from '../engine/xsra-paper.js';

const DAY = 86400e3, D0 = Date.UTC(2024, 0, 1);
const cyc = (g, a, ph, n) => { const p = [100]; for (let i = 1; i < n; i++) p.push(p[i - 1] * (1 + g + a * Math.sin((2 * Math.PI * i) / 50 + ph) + 0.004 * Math.sin(i * 1.7 + ph))); return p; };
function mk(n, p, v){ return Array.from({ length: n }, (_, i) => ({ t: D0 + i * DAY, o: i ? p[i - 1] : p[0], h: Math.max(p[i], i ? p[i - 1] : p[0]), l: Math.min(p[i], i ? p[i - 1] : p[0]), c: p[i], v })); }
const N = 330, COINS = ['BTC', 'ETH', 'SOL', 'ADA', 'XRP', 'DOGE', 'LINK', 'AVAX', 'LRC'];
const BARS = Object.fromEntries(COINS.map((c, j) => [c, mk(N, cyc(j ? 0.002 : 0.003, j ? 0.012 + 0.001 * j : 0.002, j, N), (10 - j) * 1e5)]));
const upto = (n, B = BARS) => Object.fromEntries(Object.entries(B).map(([c, b]) => [c, b.slice(0, n)]));
const START = 200; // יום ההתחלה (אינדקס)
const NOW0 = D0 + (START - 1) * DAY + 3600e3; // הריצה הראשונה (בתוך יום START−1, כדי שיום ההתחלה יהיה START)
const iso = (i) => new Date(D0 + i * DAY).toISOString().slice(0, 10);
const AB = VERSIONS.find((v) => v.key === 'AB');

test('הקבועים = bybit-probe.json, והעלות = C5 של מחקר 7ל; ההגנות = גרסה AB', () => {
  const p = JSON.parse(readFileSync(new URL('../../invest/docs/research/xs-protect/bybit-probe.json', import.meta.url), 'utf8'));
  assert.deepEqual({ ...XSRB.listing }, p.listing);
  assert.equal(XSRB.universe.length, 38);
  for (const c of XSRB.universe){ assert.equal(XSRB.buy5k[c], p.book[c]?.buy5k ?? null); assert.equal(COST.slipBps[c], Math.max(DCOST.slipBps[c] ?? DCOST.slipOther, p.book[c]?.buy5k == null ? 300 : p.book[c].buy5k)); }
  assert.equal(COST.spotBps, 10);
  assert.deepEqual({ ...XSRB.protect }, { capCoin: AB.capCoin, volTarget: AB.volTarget });
  assert.equal(XSRB.startUsd, 50000);
  assert.deepEqual({ ...XSRB.rules }, { alertDd: 0.35, killDd: 0.45, months: 12, lagPts: 0.20 });
});

test('הוק התיעוד לא משנה את החישוב של simulate', () => {
  const A = alignBars(BARS), o = { ...XSRB.protect, C: COST, startIdx: START };
  const a = simulate(A, o).series, n = []; const b = simulate(A, { ...o, onTrade: (e) => n.push(e) }).series;
  assert.deepEqual(a, b); assert.ok(n.length > 10);
});

test('ריצה ראשונה: קובעת את יום ההתחלה (חצות UTC הבאה, אחרי הנר האחרון), בלי עסקאות', () => {
  const r = step(null, upto(START), null, NOW0);
  assert.equal(r.created, true); assert.equal(r.processed, 0);
  assert.equal(r.state.startDay, iso(START)); assert.equal(r.state.equity, 50000); assert.equal(r.state.trades.length, 0);
  assert.equal(r.state.id, 'XSRA-7-BYBIT-AB');
  assert.equal(step(r.state, upto(START)).processed, 0, 'יום ההתחלה עוד לא נסגר');
  // ריצה באמצע יום START (הנר האחרון שנסגר: START−1) — יום ההתחלה הוא חצות הבאה, START+1, כי פתיחת START כבר ידועה
  assert.equal(step(null, upto(START), null, D0 + START * DAY + 5 * 3600e3).state.startDay, iso(START + 1));
});

test('זהות למחקר: ריצה יומית = simulate (AB, C5, משקיע חדש ביום ההתחלה) × 50,000$; עסקאות, עלויות ותרומה מתאזנים', () => {
  let s = step(null, upto(START), null, NOW0).state;
  for (let n = START + 1; n <= N; n++){ const r = step(s, upto(n)); s = r.state; assert.equal(r.processed, 1); }
  const once = step(step(null, upto(START), null, NOW0).state, upto(N)).state;
  const A = alignBars(BARS), allow = () => true, ref = simulate(A, { ...AB, allow, C: COST, startIdx: START }).series;
  let E = 1; for (let d = START; d < A.days.length; d++) E *= 1 + ref[d - 1].net;
  assert.ok(Math.abs(s.equity / (E * 50000) - 1) < 1e-6, `${s.equity} מול ${E * 50000}`);
  assert.ok(Math.abs(once.equity / s.equity - 1) < 1e-6);
  assert.equal(s.daily.length, N - START); assert.equal(s.daily[0].day, iso(START));
  assert.equal(once.trades.length, s.trades.length);
  assert.ok(s.trades.length > 20 && s.trades.every((t) => t.day >= s.startDay));
  const fees = s.trades.reduce((a, t) => a + t.fee, 0); assert.ok(Math.abs(fees - s.costsUsd) < 0.02 * s.trades.length);
  const pnl = Object.values(s.contrib).reduce((a, x) => a + x, 0);
  assert.ok(Math.abs(pnl - s.costsUsd - (s.equity - 50000)) < 1, `תרומה ${pnl} − עלויות ${s.costsUsd} מול ${s.equity - 50000}`);
  const inv = Object.values(s.weights).reduce((a, x) => a + x, 0); assert.ok(inv <= 1 + 1e-3);
  for (const [c, w] of Object.entries(s.weights)) assert.ok(w <= 0.15 + 0.03, `${c} ${w}`); // תקרה 15% בזמן קנייה (סטייה עם המחיר בלבד)
  // ביטקוין פסיבי: קנייה בפתיחת יום ההתחלה, עמלה 0.1% + החלקה
  const iB = A.coins.indexOf('BTC'); assert.ok(Math.abs(s.btcEquity - 50000 * (1 - 0.0012) * A.C[iB].at(-1) / A.O[iB][START]) < 0.02);
});

test('היסטוריה נעולה: תיקון של נרות ישנים לא משכתב ימים שנשמרו; הימים החדשים נשרשרים, והפער נמדד', () => {
  let s = step(null, upto(START), null, NOW0).state; s = step(s, upto(START + 20)).state; const frozen = JSON.stringify(s.daily);
  const B2 = JSON.parse(JSON.stringify(BARS)); for (const b of B2.ETH.slice(START + 3, START + 8)){ b.c *= 1.05; b.o *= 1.05; }
  const r = step(s, upto(START + 21, B2));
  assert.equal(r.processed, 1); assert.equal(JSON.stringify(r.state.daily.slice(0, 20)), frozen);
  assert.notEqual(r.state.replayDrift, 0);
});

test('מטבע מוחזק בלי נר ביום האחרון — מחכים (לא רושמים מכירה שלא קרתה)', () => {
  let s = step(null, upto(START), null, NOW0).state; s = step(s, upto(START + 30)).state;
  const held = Object.keys(s.weights).find((c) => c !== 'BTC'); assert.ok(held, 'אין מטבע מוחזק בדוגמה');
  const B = upto(START + 31); B[held] = B[held].slice(0, START + 30);
  const r = step(s, B); assert.equal(r.processed, 0); assert.ok(!r.state.trades.some((t) => t.side === 'delist'));
});

test('כללים שנקבעו מראש: התראה ב-35%, פסילה ב-45% (נשארת, והנתונים ממשיכים), בחינה אחרי 12 חודשים', () => {
  const s = newState('2026-11-16', 0); const t0 = Date.parse('2026-11-16T00:00:00Z');
  Object.assign(s, { equity: 40000, btcEquity: 45000, maxDD: 0.2, btcMaxDD: 0.1, daily: [{ day: '2026-11-16', equity: 40000, btc: 45000, xsra: null }] });
  assert.equal(verdict(s, XSRB, t0 + 50 * DAY).status, 'running');
  assert.equal(verdict({ ...s, flags: { alert: '2027-01-01', kill: null } }, XSRB, t0 + 50 * DAY).status, 'alert');
  assert.equal(verdict({ ...s, flags: { alert: '2027-01-01', kill: '2027-02-01' }, maxDD: 0.46 }, XSRB, t0 + 50 * DAY).status, 'disqualified');
  assert.equal(verdict({ ...s, flags: { alert: '2027-01-01', kill: '2027-02-01' }, equity: 90000 }, XSRB, t0 + 400 * DAY).status, 'disqualified');
  assert.equal(verdict({ ...s, equity: 40000, btcEquity: 60000 }, XSRB, t0 + 370 * DAY).status, 'fail');
  assert.equal(verdict({ ...s, equity: 70000, btcEquity: 60000, maxDD: 0.05 }, XSRB, t0 + 370 * DAY).status, 'pass');
  assert.equal(verdict({ ...s, equity: 58000, btcEquity: 60000 }, XSRB, t0 + 370 * DAY).status, 'decide');
  // הדגלים נקבעים מהשורות היומיות של step
  let st = step(null, upto(START), null, NOW0).state; st = step(st, upto(N)).state;
  assert.equal(!!st.flags.alert, st.maxDD >= 0.35); assert.equal(!!st.flags.kill, st.maxDD >= 0.45);
});

test('בידוד מ-XSRA-7: מפתח, מזהה ונתיב אחרים; ה-Worker כותב רק ל-paper:xsrb; אין התחלה מחדש, מחיקה או ביטול פסילה', async () => {
  assert.notEqual(XSRB_KEY, XSRAPAPER_KEY); assert.notEqual(XSRB.id, XSRAP.id);
  const puts = [], store = new Map(), db = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { puts.push(k); store.set(k, v); } };
  let s = step(null, upto(START), null, NOW0).state; await recordXsrb(db, s);
  s = step(s, upto(START + 15)).state; await recordXsrb(db, s);
  assert.deepEqual([...new Set(puts)], [XSRB_KEY]);
  await assert.rejects(recordXsrb(db, { ...s, startDay: '2030-01-01' }), /נעול/);
  await assert.rejects(recordXsrb(db, { ...s, daily: s.daily.slice(0, 3) }), /מחיקה/);
  const edited = s.daily.map((x, i) => (i === 4 ? { ...x, equity: x.equity + 1000 } : x));
  await assert.rejects(recordXsrb(db, { ...s, daily: edited }), /יום שכבר נשמר/); // אותו אורך, ערך ישן שונה
  const s2 = step(s, upto(START + 16)).state; await recordXsrb(db, s2); // הוספה של יום חדש — מותרת
  s = s2;
  await recordXsrb(db, { ...s, flags: { alert: '2024-08-01', kill: '2024-08-02' } });
  await assert.rejects(recordXsrb(db, { ...s, flags: { alert: null, kill: null } }), /פסילה/);
  assert.throws(() => cleanXsrb({ ...s, id: XSRAP.id }), /לא תקין/);
  const rep = { ...cleanXsrb(s), receivedAt: new Date().toISOString() }, lines = xsrbLines(rep, Date.parse(s.lastDay));
  assert.match(lines[0], /מעקב 2/); assert.match(lines[1], /ביטקוין/);
  assert.match(xsrbLines(cleanXsrb(step(null, upto(START), null, NOW0).state))[1], /מתחיל ב-/);
});

test('replay דורש היסטוריה מספקת לפני יום ההתחלה', () => {
  const A = alignBars(upto(150)); assert.throws(() => replay(A, A.days[60]), /היסטוריה/);
});

test('סיכום הקריפטו היומי: שורות מעקב 2 נוספות רק כשיש דוח; הנתיב /xsrb — קריאה ציבורית, כתיבה רק עם הסוד', async () => {
  const { formatSummary } = await import('../lib/amit-live.js');
  const { newAmit } = await import('../engine/amit-rules.js');
  const worker = (await import('../worker.js')).default;
  let s = step(null, upto(START), null, NOW0).state; s = step(s, upto(START + 10)).state;
  const st = newAmit(), rep = { ...cleanXsrb(s), receivedAt: new Date().toISOString() };
  assert.doesNotMatch(formatSummary(st, '2026-11-16'), /מעקב 2/);
  assert.match(formatSummary(st, '2026-11-16', null, null, Date.now(), null, null, null, null, null, rep), /מעקב 2 — מומנטום 7ל/);
  const env = { CRON_SECRET: 'right', APP_TOKEN: 'tok' }, req = (path, method = 'GET', body) => worker.fetch(new Request('https://api.test' + path, { method, body, headers: { 'CF-Connecting-IP': '7.7.7.9', 'Content-Type': 'application/json' } }), env, {});
  assert.equal((await req('/xsrb', 'POST', JSON.stringify(s))).status, 401);
  assert.equal((await req('/xsrb?secret=wrong', 'POST', JSON.stringify(s))).status, 401);
  assert.equal((await req('/xsrb')).status, 200);
  const ok = await req('/xsrb?secret=right', 'POST', JSON.stringify(s)); // מסלול ההצלחה (סבב GPT 1 של #282)
  assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { ok: true, saved: true, lastDay: s.lastDay });
  assert.equal((await req('/xsrb?secret=right', 'POST', JSON.stringify({ ...s, id: 'XSRA-7' }))).status, 400);
});
