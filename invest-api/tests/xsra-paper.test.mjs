// מעקב Paper למומנטום המשודרג (engine/xsra-paper.js): זהות למנוע המחקר (xsRiskAdj), כל מנה מוחלפת ביום שלה, הקצאה מיד ביום הראשון,
// עלויות, כללי ההחלטה שנקבעו מראש, ואימות הדוח ב-Worker + שורות הסיכום היומי
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XSRAP, step, targetsAt, totalWeights, verdict, newState } from '../engine/xsra-paper.js';
import { align, xsRiskAdj, runDaily } from '../engine/research-daily.js';
import { cleanXsra, xsraLines } from '../lib/xsra-paper.js';

const D0 = Date.UTC(2024, 0, 7), DAY = 86400e3; // יום ראשון
function mk(n, f, v){ return Array.from({ length: n }, (_, i) => { const c = f(i), o = i ? f(i - 1) : c; return { t: D0 + i * DAY, o, h: Math.max(o, c), l: Math.min(o, c), c, v: v(i) }; }); }
// מגמות מתחלפות (מחזור של ~50 יום בשלבים שונים) כדי שהבחירה תשתנה משבוע לשבוע; BTC עולה בעקביות (מעל ממוצע 100)
const cyc = (g, a, ph) => { const p = [100]; for (let i = 1; i < 300; i++) p.push(p[i - 1] * (1 + g + a * Math.sin((2 * Math.PI * i) / 50 + ph) + 0.004 * Math.sin(i * 1.7 + ph))); return (i) => p[i]; };
const BARS = { BTC: mk(260, cyc(0.003, 0.002, 0), () => 1e6), ETH: mk(260, cyc(0.002, 0.012, 1), () => 5e5), SOL: mk(260, cyc(0.002, 0.015, 2), () => 3e5),
  ADA: mk(260, cyc(0.002, 0.012, 3), () => 2e5), XRP: mk(260, cyc(0.002, 0.015, 4), () => 2e5), DOGE: mk(260, cyc(0.001, 0.012, 5), () => 2e5) };
const upto = (n) => Object.fromEntries(Object.entries(BARS).map(([c, b]) => [c, b.slice(0, n)]));

test('targetsAt = xsRiskAdj של המחקר באותו יום', () => {
  const A = align(BARS), i = 200, d = A.days[i];
  const ref = xsRiskAdj(A.coins, { dow: new Date(d).getUTCDay() }).weights(A, i, {}), got = targetsAt(A, d).w;
  A.coins.forEach((c, k) => assert.equal(got[c] || 0, ref[k]));
  assert.ok(Object.keys(got).length > 0 && Object.keys(got).length <= 4);
});

test('step: יום ראשון — כל 7 המנות מוקצות; אחר כך רק המנה של היום; ריצה יומית = ריצה אחת על כל הימים', () => {
  let { state: s, events } = step(null, upto(180));
  assert.equal(events.length, 7); assert.equal(s.sleeves.length, 7);
  assert.ok(Math.abs(s.equity - (XSRAP.startUsd - s.costsUsd)) < 0.05);
  let daily = s;
  for (let n = 181; n <= 200; n++){ const r = step(daily, upto(n)); daily = r.state; assert.equal(r.processed, 1);
    const dow = new Date(D0 + (n - 1) * DAY).getUTCDay(); assert.deepEqual(r.events.map((e) => e.sleeve), [dow]); }
  const once = step(s, upto(200)).state;
  assert.ok(Math.abs(once.equity / daily.equity - 1) < 1e-4, 'עיגול יומי בלבד'); assert.deepEqual(once.sleeves.map((x) => Object.keys(x.weights)), daily.sleeves.map((x) => Object.keys(x.weights)));
  const w = totalWeights(daily), inv = Object.values(w).reduce((a, x) => a + x, 0); assert.ok(inv <= 1 + 1e-3);
});

test('זהות למחקר: אחרי ההחלפה הראשונה של מנה, ההון שלה זז בדיוק כמו המנה במחקר (פתיחה = סגירה קודמת)', () => {
  const A = align(BARS), start = 180;
  let { state: s } = step(null, upto(start + 1)); const hist = [JSON.parse(JSON.stringify(s))];
  for (let n = start + 2; n <= 240; n++){ s = step(s, upto(n)).state; hist.push(JSON.parse(JSON.stringify(s))); }
  for (const k of [0, 3, 6]){
    const res = runDaily(A, xsRiskAdj(A.coins, { dow: k }), { drift: true }).series; // res[j] = יום j+1
    const idx = (d) => A.days.indexOf(d), dayOf = (h) => Date.parse(h.lastDay);
    // החלפה ראשונה של מנה k שבה גם המחקר וגם המעקב באמת סחרו (אחריה המשקלות זהים בשניהם: 25% לכל מטבע שנבחר)
    const R = hist.findIndex((h, j) => { if (j === 0 || new Date(dayOf(h)).getUTCDay() !== k) return false; const di = idx(dayOf(h));
      const ev = h.changes.findLast((e) => e.sleeve === k && e.day === h.lastDay.slice(0, 10)); return res[di].turn > 0 && ev && ev.turnover > 0; });
    assert.ok(R > 0, `אין החלפה משותפת למנה ${k}`);
    const h1 = hist[R + 1], dR1 = idx(dayOf(h1));
    // ביום ההחלפה של המנה המעקב מוריד את העלות בסגירה, והמחקר — בפתיחה שאחרי; לכן משווים רק בשאר הימים
    for (const h of hist.slice(R + 2).filter((x) => new Date(dayOf(x)).getUTCDay() !== k)){
      const dd = idx(dayOf(h)); let g = 1; for (let j = dR1 + 1; j <= dd; j++) g *= 1 + res[j - 1].net;
      const p = h.sleeves[k].equity / h1.sleeves[k].equity;
      assert.ok(Math.abs(p / g - 1) < 2e-4, `מנה ${k}, ${h.lastDay.slice(0, 10)}: ${p} מול ${g}`);
    }
  }
});

test('verdict: עצירה בירידה מעל 55%, אחרי 12 חודשים — פיגור של 20 נק׳ עם ירידה גדולה יותר; cleanXsra + xsraLines', () => {
  const s = newState(0); s.startDay = '2026-11-14'; const t0 = Date.parse('2026-11-14');
  Object.assign(s, { equity: 9000, btcEquity: 9500, maxDD: 0.2, btcMaxDD: 0.1 });
  assert.equal(verdict(s, XSRAP, t0 + 100 * DAY).status, 'running');
  assert.equal(verdict({ ...s, maxDD: 0.56 }, XSRAP, t0 + 100 * DAY).status, 'stop-dd');
  assert.equal(verdict({ ...s, maxDD: 0.56, btcMaxDD: 0.6 }, XSRAP, t0 + 100 * DAY).status, 'running');
  assert.equal(verdict({ ...s, equity: 9000, btcEquity: 12000 }, XSRAP, t0 + 370 * DAY).status, 'stop-lag');
  assert.equal(verdict({ ...s, equity: 13000, btcEquity: 12000, maxDD: 0.05 }, XSRAP, t0 + 370 * DAY).status, 'pass');
  const st = step(null, upto(200)).state, rep = cleanXsra(st);
  assert.equal(rep.sleeves.length, 7); assert.throws(() => cleanXsra({ ...st, id: 'X' }), /לא תקין/);
  assert.throws(() => cleanXsra({ ...st, sleeves: st.sleeves.slice(0, 3) }), /מנות/);
  const lines = xsraLines({ ...rep, receivedAt: new Date().toISOString() });
  assert.match(lines[0], /7 מנות/); assert.match(lines[1], /ביטקוין/);
});
