// מנוע ההגנות (engine/xsra-protect.js): בלי הגנות = 7 המנות של המחקר; תקרת מטבע, תקרת אלטים, BTC קבוע, יעד תנודתיות; מס
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, VERSIONS, PROTECT, basketVol } from '../engine/xsra-protect.js';
import { align, runDaily, xsRiskAdj, combineSleeves } from '../engine/research-daily.js';

const D0 = Date.UTC(2024, 0, 7), DAY = 86400e3;
function mk(n, f, v){ return Array.from({ length: n }, (_, i) => { const c = f(i), o = i ? f(i - 1) : c; return { t: D0 + i * DAY, o, h: Math.max(o, c), l: Math.min(o, c), c, v: v(i) }; }); }
const cyc = (g, a, ph) => { const p = [100]; for (let i = 1; i < 500; i++) p.push(p[i - 1] * (1 + g + a * Math.sin((2 * Math.PI * i) / 50 + ph) + 0.004 * Math.sin(i * 1.7 + ph))); return (i) => p[i]; };
const BARS = { BTC: mk(420, cyc(0.003, 0.002, 0), () => 1e6), ETH: mk(420, cyc(0.002, 0.012, 1), () => 5e5), SOL: mk(420, cyc(0.002, 0.015, 2), () => 3e5),
  ADA: mk(420, cyc(0.002, 0.012, 3), () => 2e5), XRP: mk(420, cyc(0.002, 0.015, 4), () => 2e5), DOGE: mk(420, cyc(0.001, 0.012, 5), () => 2e5) };
const A = align(BARS), eq = (sr) => sr.reduce((e, x) => e * (1 + x.net), 1);

test('בלי הגנות: זהה ל-7 המנות של המחקר (combineSleeves × runDaily drift), יום-יום', () => {
  const ref = combineSleeves([0, 1, 2, 3, 4, 5, 6].map((w) => runDaily(A, xsRiskAdj(A.coins, { dow: w }), { drift: true }).series));
  const got = simulate(A).series;
  assert.equal(got.length, ref.length);
  // המחקר מוריד את העמלה מההון בנפרד מהתשואה של היום (קירוב מסדר שני); כאן היא יורדת מהפוזיציות — הפרש של עמלה × תשואת יום בלבד
  for (let i = 0; i < ref.length; i++) assert.ok(Math.abs(got[i].net - ref[i].net) < 2e-5, `יום ${i}: ${got[i].net} מול ${ref[i].net}`);
  assert.ok(Math.abs(eq(got) / eq(ref) - 1) < 1e-3, `סוף: ${eq(got)} מול ${eq(ref)}`);
  assert.ok(eq(got) > 1);
});

test('א. תקרת מטבע: אחרי כל קנייה, אף מטבע לא עובר 15% מהתיק (פרט לעלייה במחיר אחרי הקנייה); ד. אלטים עד 60% בפתיחה', () => {
  const r = simulate(A, { capCoin: PROTECT.capCoin, trace: true }), K = A.coins.length;
  let maxW = 0; for (let d = 1; d < A.days.length; d++) for (let k = 0; k < K; k++) maxW = Math.max(maxW, r.wtr[d * K + k]);
  assert.ok(maxW < 0.15 * 1.25, `מקסימום ${maxW}`); // עד 25% עלייה ביום אחד — הרבה מעבר למה שיש בנתונים
  const base = simulate(A, { trace: true }); let bMax = 0; for (let i = 0; i < base.wtr.length; i++) bMax = Math.max(bMax, base.wtr[i]);
  assert.ok(bMax > 0.2, 'בלי התקרה יש ריכוז (בנתוני הבדיקה)');
  const d = simulate(A, { altCap: PROTECT.altCap });
  assert.ok(d.series.every((x) => x.altOpen <= 0.6 + 1e-4)); // העמלה של מכירת הקיצוץ מקטינה מעט את ההון
  assert.ok(simulate(A).series.some((x) => x.alt > 0.6));
});

test('ג. BTC קבוע 30%: ביום הראשון וחזרה ל-30% בתחילת רבעון; ב. יעד תנודתיות מקטין חשיפה כשהסל תנודתי', () => {
  const r = simulate(A, { btcFixed: 0.3, trace: true }), K = A.coins.length, iB = A.coins.indexOf('BTC');
  const q = A.days.findIndex((t, i) => i > 30 && new Date(t).getUTCMonth() % 3 === 0 && new Date(A.days[i - 1]).getUTCMonth() !== new Date(t).getUTCMonth());
  assert.ok(q > 0); assert.ok(r.wtr[q * K + iB] >= 0.29, `BTC ${r.wtr[q * K + iB]}`);
  const w = A.coins.map((c) => (c === 'SOL' ? 1 : 0)); assert.ok(basketVol(A, w, 300) > 0);
  const lo = simulate(A, { volTarget: 0.05 }), hi = simulate(A);
  const avg = (sr) => sr.slice(200).reduce((a, x) => a + x.exp, 0) / (sr.length - 200);
  assert.ok(avg(lo.series) < avg(hi.series) * 0.9, 'יעד נמוך → חשיפה נמוכה');
  for (const v of VERSIONS) assert.ok(Number.isFinite(eq(simulate(A, v).series)), v.key);
});

test('מס: 0% לא משנה כלום; 25% מקטין; חברה עם מס דיבידנד < בלי דיבידנד', () => {
  const plain = eq(simulate(A).series), z = simulate(A, { tax: { rate: 0, period: 'semi', carry: true } });
  assert.ok(Math.abs(z.taxInfo.equity - plain) < 1e-9);
  const p = simulate(A, { tax: { rate: 0.25, period: 'semi', carry: true } }).taxInfo, c = simulate(A, { tax: { rate: 0.23, period: 'annual', carry: true, divRate: 0.30 } }).taxInfo;
  assert.ok(p.net < plain && p.paidDuring > 0); assert.ok(c.divTax > 0 && c.net < c.equity);
});
