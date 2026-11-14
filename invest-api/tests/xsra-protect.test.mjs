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

test('א+ג: תקרת המטבע לא חלה על החלק הקבוע — BTC בתוך המנות נקנה כמו בלי ה-BTC הקבוע (סבב GPT 1 של #268)', () => {
  const K = A.coins.length, iB = A.coins.indexOf('BTC');
  // BTC במנות בלבד = סך BTC פחות החלק הקבוע; עם תקרה 15% הוא לא אמור להיחסם בגלל 30% של החלק הקבוע
  const ac = simulate(A, { capCoin: 0.15, btcFixed: 0.30, trace: true }), a = simulate(A, { capCoin: 0.15, trace: true });
  const btcInSleevesAC = [], btcA = [];
  for (let d = 200; d < A.days.length; d++){ btcA.push(a.wtr[d * K + iB]); btcInSleevesAC.push(ac.wtr[d * K + iB]); }
  const maxA = Math.max(...btcA), maxAC = Math.max(...btcInSleevesAC);
  assert.ok(maxA > 0.05, 'בנתוני הבדיקה המנות קונות BTC'); assert.ok(maxAC > 0.30 + 0.05, `ב-א+ג סך BTC עובר את 30% של החלק הקבוע (${maxAC})`);
});

test('xsRiskAdj: rng — אותו מספר מטבעות, בחירה שונה בין זרעים; allow — מטבע לא נבחר לפני תאריך הזמינות ונבחר אחריו', () => {
  const lcg = (seed) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); };
  const d = 300, dow = new Date(A.days[d]).getUTCDay(), pick = (o) => xsRiskAdj(A.coins, { dow, ...o }).weights(A, d, {});
  const base = pick({}), r1 = pick({ rng: lcg(1) }), r2 = pick({ rng: lcg(99) }), n = (w) => w.filter((x) => x > 0).length;
  assert.equal(n(r1), n(base)); assert.equal(n(r2), n(base));
  // יום שבו יש יותר מועמדים ממקומות (אחרת כל בחירה אקראית זהה): מחפשים בטווח, עם 2 מקומות במקום 4
  const P2 = { uni: 15, volN: 30, smaMacro: 100, smaMicro: 50, retN: 21, top: 2 };
  let differs = false;
  for (let dd = 150; dd < A.days.length - 1 && !differs; dd++){ const dw = new Date(A.days[dd]).getUTCDay();
    const ss = Array.from({ length: 8 }, (_, i) => xsRiskAdj(A.coins, { dow: dw, P: P2, rng: lcg(i + 1) }).weights(A, dd, {}).join(','));
    if (new Set(ss).size > 1) differs = true; }
  assert.ok(differs, 'זרעים שונים → בחירות שונות');
  const k = base.findIndex((x) => x > 0 && A.coins[base.indexOf(x)] !== undefined), coin = A.coins[k], from = A.days[d] + 1;
  const blocked = pick({ allow: (kk, t) => kk !== k || t >= from });
  assert.equal(blocked[k], 0, `${coin} לא זמין עדיין`);
  const later = pick({ allow: (kk, t) => kk !== k || t >= A.days[d] });
  assert.ok(later[k] > 0, `${coin} זמין`);
});

test('איזון לפי מחזור (cycle): { n: 7, step: 1, off: 4 } זהה בדיוק לשבועי; חודשי — כל מנה מוחלפת רק פעם ב-28 ימים, והמנות מדורגות כל 4 ימים', async () => {
  const { CYCLES, cycReb } = await import('../engine/xsra-protect.js');
  for (const v of [{}, { capCoin: PROTECT.capCoin, volTarget: PROTECT.volTarget }]){
    const w = simulate(A, v).series, c = simulate(A, { ...v, cycle: { n: 7, step: 1, off: 4 } }).series;
    assert.deepEqual(c.map((x) => x.net), w.map((x) => x.net), 'שבועי דרך cycle = שבועי');
  }
  for (let j = 0; j < 7; j++) for (const t of A.days) assert.equal(cycReb({ n: 7, step: 1, off: 4 }, j)(t), new Date(t).getUTCDay() === j);
  const M = CYCLES.monthly, hits = [0, 1, 2, 3, 4, 5, 6].map((j) => A.days.filter((t) => cycReb(M, j)(t)));
  for (const h of hits) for (let i = 1; i < h.length; i++) assert.equal((h[i] - h[i - 1]) / DAY, 28);
  const first = hits.map((h) => h[0]).sort((a, b) => a - b); for (let i = 1; i < 7; i++) assert.equal((first[i] - first[i - 1]) / DAY, 4);
  const wk = simulate(A).series, mo = simulate(A, { cycle: M }).series;
  const turn = (s) => s.reduce((a, x) => a + x.turn, 0); assert.ok(turn(mo) < turn(wk), `מחזור חודשי ${turn(mo)} < שבועי ${turn(wk)}`);
});
