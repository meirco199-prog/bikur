// משפחת המגמה על BTC/ETH (engine/trend-btceth.js): בלי הצצה לעתיד, כללי כניסה/יציאה, תיק 50/50, משך התאוששות
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trendTF, trendBR, trendMP, smaFilter, combine5050, longestRecovery, TREND, BUILD } from '../engine/trend-btceth.js';
import { align, runDaily } from '../engine/research-daily.js';

const D0 = Date.UTC(2020, 0, 1), DAY = 86400e3;
const bars = (f, n = 500) => Array.from({ length: n }, (_, i) => { const c = f(i), o = i ? f(i - 1) : c; return { t: D0 + i * DAY, o, h: Math.max(o, c) * 1.005, l: Math.min(o, c) * 0.995, c }; });
const wave = (i) => 100 * (1 + 0.002 * i) * (1 + 0.15 * Math.sin(i / 40));
const W = (strat, A) => { const st = {}; return A.days.map((_, d) => strat.weights(A, d, st)[0]); };

test('בלי הצצה לעתיד: שינוי מחירים אחרי יום d לא משנה אף משקל עד d (כל השיטות, כל הרשת)', () => {
  const A1 = align({ X: bars(wave) }), cut = 300, A2 = align({ X: bars((i) => (i <= cut ? wave(i) : wave(i) * (i % 2 ? 1.5 : 0.6))) });
  for (const [k, cfg] of Object.entries(TREND).filter(([k]) => ['TF', 'BR', 'MP'].includes(k))) for (const p of cfg.grid){
    const w1 = W(BUILD[k](p), A1), w2 = W(BUILD[k](p), A2); assert.deepEqual(w1.slice(0, cut + 1), w2.slice(0, cut + 1), `${k} ${JSON.stringify(p)}`); }
});

test('TF: נכנס במגמה עולה ויוצא כשהסגירה מתחת לממוצע; BR: נכנס רק אחרי בדיקה חוזרת; MP: נכנס בתיקון בתוך מגמה', () => {
  const up = (i) => 100 * 1.003 ** i; const A = align({ X: bars(up) });
  const tf = W(trendTF({ n: 100, s: 20 }), A); assert.equal(tf[90], 0); assert.equal(tf[200], 1);
  const A2 = align({ X: bars((i) => (i < 300 ? up(i) : up(300) * 0.99 ** (i - 300))) }); const tf2 = W(trendTF({ n: 100, s: 20 }), A2); assert.equal(tf2[499], 0);
  // פריצה ביום 200, חזרה לרמה ביום 203, ואז עלייה
  const br = (i) => (i < 200 ? 100 : i === 200 ? 110 : i < 203 ? 112 : i === 203 ? 101 : 101 + (i - 203));
  const A3 = align({ X: bars(br) }); const w3 = W(trendBR({ n: 20, t: 0.02, k: 10 }), A3);
  assert.equal(w3[200], 0, 'לא נכנסים ביום הפריצה'); assert.equal(w3[202], 0); assert.equal(w3[203], 1, 'נכנסים ביום הבדיקה החוזרת');
  // MP: מגמה עולה ואז תיקון של 10%
  const mp = (i) => (i < 320 ? up(i) : i < 330 ? up(320) * (1 - 0.011 * (i - 320)) : up(320) * 0.89 * 1.004 ** (i - 330));
  const A4 = align({ X: bars(mp) }); const w4 = W(trendMP({ dd: 0.08, e: 100 }), A4);
  assert.equal(w4[310], 0, 'לא קונים אחרי זינוק'); assert.ok(w4.slice(321, 331).some((x) => x === 1), 'קונים בתיקון');
});

test('runDaily: ביצוע בפתיחה שאחרי, עלות בכל שינוי; combine5050 חוזר ל-50/50 בכל חודש; longestRecovery', () => {
  const A = align({ X: bars(wave) }), r = runDaily(A, trendTF({ n: 50, s: 10 }), { drift: true });
  assert.ok(r.entries > 0 && r.series.some((x) => x.cost > 0));
  const a = [{ t: Date.UTC(2020, 0, 30), net: 0.1 }, { t: Date.UTC(2020, 1, 1), net: 0 }, { t: Date.UTC(2020, 1, 2), net: 0.1 }];
  const b = [{ t: Date.UTC(2020, 0, 30), net: 0 }, { t: Date.UTC(2020, 1, 1), net: 0 }, { t: Date.UTC(2020, 1, 2), net: 0 }];
  const c = combine5050(a, b); assert.ok(Math.abs(c[0].net - 0.05) < 1e-12); assert.ok(Math.abs(c[2].net - 0.05) < 1e-12, 'חזרה ל-50/50 בתחילת פברואר');
  // עלות העברה: חלק BTC מושקע (exp 1) עלה 10% → בתחילת פברואר עוברים 2.5% מההון מ-BTC (מוכרים) ל-ETH (מזומן, חינם) → 2.5% × 12bp
  const a2 = a.map((x) => ({ ...x, exp: 1 })), b2 = b.map((x) => ({ ...x, exp: 0 }));
  const e = combine5050(a2, b2, { bps: 12 }), rc = (0.025 * 12 / 1e4) / 1.05;
  assert.ok(Math.abs(e[1].net - (-rc)) < 1e-12, 'עלות ההעברה'); assert.ok(Math.abs(e[1].cost - rc) < 1e-12);
  const s = [0.1, -0.2, 0.05, 0.3].map((net, i) => ({ t: D0 + i * DAY, net }));
  assert.equal(longestRecovery(s), 3);
});

test('smaFilter: מעל הממוצע מחזיקים, מתחת מזומן, בלי הצצה לעתיד; combine5050 עם wa = 0.7', () => {
  const up = (i) => 100 * 1.003 ** i, A = align({ X: bars((i) => (i < 300 ? up(i) : up(300) * 0.99 ** (i - 300))) });
  const w = W(smaFilter({ n: 200 }), A); assert.equal(w[150], 0); assert.equal(w[250], 1); assert.equal(w[499], 0);
  const A1 = align({ X: bars(wave) }), A2 = align({ X: bars((i) => (i <= 300 ? wave(i) : wave(i) * 3)) });
  for (const n of [150, 200, 250]) assert.deepEqual(W(smaFilter({ n }), A1).slice(0, 301), W(smaFilter({ n }), A2).slice(0, 301));
  const a = [{ t: Date.UTC(2020, 0, 30), net: 0.1 }, { t: Date.UTC(2020, 1, 1), net: 0.1 }], b = [{ t: Date.UTC(2020, 0, 30), net: 0 }, { t: Date.UTC(2020, 1, 1), net: 0 }];
  const c = combine5050(a, b, { wa: 0.7 }); assert.ok(Math.abs(c[0].net - 0.07) < 1e-12); assert.ok(Math.abs(c[1].net - 0.07) < 1e-12, 'חזרה ל-70/30');
});
