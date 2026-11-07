// שיטות ארוכות טווח (engine/research-daily.js): לוח יומי, ביצוע בפתיחה שאחרי ההחלטה (בלי הצצה לעתיד), עלויות, בלי מינוף, Funding, וסטטיסטיקה
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { align, strategies, runDaily, runCarry, dstats, dscore, DCOST } from '../engine/research-daily.js';

const D0 = Date.parse('2020-01-01T00:00:00Z'), DAY = 86400e3;
const series = (n, f, from = 0) => Array.from({ length: n }, (_, i) => { const c = f(i + from), o = f(i + from - 1) ?? c; return { t: D0 + (i + from) * DAY, o, h: Math.max(o, c), l: Math.min(o, c), c }; });

test('align: לוח משותף, NaN לפני שהמטבע קיים, יום חסר באמצע ממשיך את הסגירה', () => {
  const btc = series(10, (i) => 100 + i), eth = series(8, (i) => 10 + i, 2);
  btc.splice(3, 1); // יום 3 חסר ב-BTC (קיים ב-ETH)
  const A = align({ BTC: btc, ETH: eth });
  assert.equal(A.days.length, 10); assert.ok(Number.isNaN(A.C[1][1])); assert.equal(A.C[1][5], 15);
  assert.equal(A.C[0][3], A.C[0][2]);
});

test('קנה והחזק BTC: תשואה = מחיר סיום / פתיחה ראשונה, פחות עלות כניסה אחת (ספוט + החלקה)', () => {
  const A = align({ BTC: series(100, (i) => 100 * 1.01 ** i) });
  const s = strategies(A.coins).find((x) => x.id === 'BH-BTC'), { series: r } = runDaily(A, s);
  const net = r.reduce((e, x) => e * (1 + x.net), 1) - 1, gross = r.reduce((e, x) => e * (1 + x.gross), 1) - 1;
  assert.ok(Math.abs(gross - (A.C[0][99] / A.O[0][1] - 1)) < 1e-9, 'נכנסים בפתיחת היום השני');
  assert.ok(Math.abs(r[0].cost - (DCOST.spotBps + DCOST.slipBps.BTC) / 1e4) < 1e-12); assert.ok(net < gross);
});

test('בלי הצצה לעתיד: קפיצת מחיר ביום d לא נתפסת על ידי אות שנוצר מאותה סגירה', () => {
  // שטוח 250 ימים, ואז קפיצה של 50% בסגירת יום 250 — MA50 נדלק רק בסגירה הזו, ולכן הקפיצה עצמה לא נכנסת לתשואה
  const A = align({ BTC: series(260, (i) => (i < 250 ? 100 : 150)) });
  const s = strategies(A.coins).find((x) => x.id === 'MA50-BTC'), { series: r } = runDaily(A, s);
  const jump = r.find((x) => x.t === D0 + 250 * DAY);
  assert.equal(jump.gross, 0);
  assert.ok(r.find((x) => x.t === D0 + 251 * DAY).exp > 0, 'נכנסים למחרת');
});

test('בלי מינוף: סכום המשקלות המוחלטים ≤ 1 בכל יום, בכל האסטרטגיות', () => {
  let x = 100, seed = 4; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const mk = () => { x = 100; return series(400, () => (x *= Math.exp((rnd() - 0.5) * 0.06))); };
  const A = align({ BTC: mk(), ETH: mk(), SOL: mk(), ADA: mk(), LTC: mk(), DOGE: mk() });
  for (const s of strategies(A.coins)){ const { series: r } = runDaily(A, s); for (const d of r) assert.ok(d.exp <= 1 + 1e-9, s.id); }
});

test('חוזה: לונג משלם Funding (נתון היסטורי, או 3bp ליום כברירת מחדל); שורט מקבל רק כשיש נתון', () => {
  const A = align({ BTC: series(120, (i) => 100 + (i % 2)), ETH: series(120, (i) => 10 + (i % 3)) });
  const s = { id: 'L', family: 'x', perp: true, weights: () => [1, 0] }, { series: r } = runDaily(A, s);
  assert.ok(Math.abs(r[5].fund - 3e-4) < 1e-12);
  const F = { BTC: new Map([[A.days[5], -0.001]]) }, sh = { id: 'S', family: 'x', perp: true, weights: () => [-1, 0] };
  const { series: r2 } = runDaily(A, sh, { funding: F });
  assert.ok(Math.abs(r2[4].fund - 0.001) < 1e-12, 'שורט עם Funding שלילי משלם'); assert.equal(r2[10].fund, 0);
});

test('גביית Funding: שיעור קבוע מעל הסף → תשואה = סכום השיעורים פחות עלות כניסה אחת', () => {
  const days = Array.from({ length: 60 }, (_, i) => D0 + i * DAY), F = { BTC: new Map(days.map((d) => [d, 0.001])) };
  const { series: r } = runCarry(F, ['BTC'], days, { thr: 0.0002 });
  const tot = r.reduce((s, x) => s + x.net, 0), entry = (DCOST.spotBps + DCOST.perpBps + 2 * DCOST.slipBps.BTC) / 1e4;
  assert.ok(Math.abs(tot - (53 * 0.001 - entry)) < 1e-9);
});

test('dstats: שארפ שנתי עם טווח ביטחון, ירידה מקסימלית; dscore דורש מספיק ימים וחשיפה', () => {
  const s = Array.from({ length: 400 }, (_, i) => ({ t: D0 + i * DAY, net: i % 2 ? 0.01 : -0.008, gross: 0, cost: 0, fund: 0, turn: 0, exp: 1 }));
  const st = dstats(s);
  assert.ok(st.sharpe > 0 && st.ci[0] < st.sharpe && st.ci[1] > st.sharpe && st.maxDD > 0.007 && st.maxDD < 0.01);
  assert.equal(dscore(dstats(s.slice(0, 200))), null); assert.equal(dscore(st), st.ci[0]);
});

test('מינוף: ×2 מכפיל את התשואה היומית, בחוזה (עמלה + Funding על כל הנוציונל); ירידה תוך-יומית גדולה → חיסול והון אפס', () => {
  const up = align({ BTC: series(60, (i) => 100 * 1.01 ** i) });
  const s = strategies(up.coins).find((x) => x.id === 'BH-BTC');
  const r1 = runDaily(up, s).series, r2 = runDaily(up, s, { leverage: 2 }).series;
  assert.ok(Math.abs(r2[10].gross - 2 * r1[10].gross) < 1e-12); assert.ok(Math.abs(r2[10].fund - 2 * 3e-4) < 1e-12);
  // יום עם שפל של −60% → במינוף ×2 החשיפה מוחקת את ההון
  const crash = series(40, (i) => 100); crash[20] = { ...crash[20], l: 40 };
  const A = align({ BTC: crash }), r = runDaily(A, s, { leverage: 2 });
  assert.ok(r.liquidated); assert.equal(dstats(r.series).total, -1);
  assert.equal(runDaily(A, s, { leverage: 1.5 }).liquidated, null, '×1.5: ירידה של 60% = הפסד 90%, עדיין לא חיסול');
});
