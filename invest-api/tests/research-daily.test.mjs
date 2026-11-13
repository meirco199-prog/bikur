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

test('drift: אות קבוע → אין מסחר אחרי הכניסה, והתיק = קנה-והחזק של כל רגל (המשקלות זזים עם המחירים); rebalDow: החלפה רק ביום ראשון', () => {
  const A = align({ BTC: series(60, (i) => 100 * 1.02 ** i), ETH: series(60, (i) => 50 * 0.99 ** i) });
  const s = { id: 'half', family: 'x', weights: () => [0.5, 0.5] }, { series: r } = runDaily(A, s, { drift: true });
  assert.ok(r.slice(1).every((x) => x.turn < 1e-12), 'אין איזון אחרי הכניסה');
  const eq = r.reduce((e, x) => e * (1 + x.gross), 1), bh = 0.5 * A.C[0][59] / A.O[0][1] + 0.5 * A.C[1][59] / A.O[1][1];
  assert.ok(Math.abs(eq - bh) / bh < 2e-3, `${eq} ≠ ${bh}`); // תשואה מצטברת = חצי-חצי קנה והחזק (בקירוב של סכימת לילה+יום)
  const { series: r0 } = runDaily(A, s); assert.ok(Math.abs(r0.reduce((e, x) => e * (1 + x.gross), 1) - bh) / bh > 5e-3, 'בלי drift = איזון יומי (שונה)');
  let x = 100, seed = 9; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647), mk = () => { x = 100; return series(300, () => (x *= Math.exp((rnd() - 0.48) * 0.05))); };
  const B = align({ BTC: mk(), ETH: mk(), SOL: mk(), ADA: mk(), LTC: mk() });
  const xs = strategies(B.coins, { rebalDow: 0 }).find((q) => q.id === 'XS14-top3'), st = {}; let prev = null;
  for (let d = 70; d < 300; d++){ const w = xs.weights(B, d, st); if (prev && w !== prev) assert.equal(new Date(B.days[d]).getUTCDay(), 0); prev = w; }
});

test('מס רווחי הון (tax): קיזוז בתוך השנה, תשלום בתחילת השנה הבאה, חשבון רווח מלא, ובלי מס על רווח שלא מומש', () => {
  // 800 יום מ-2020: מחיר עולה 0.3% ליום (פתיחה = סגירה קודמת, אין "לילה"); אסטרטגיה נכנסת ויוצאת כל 10 ימים
  const A = align({ BTC: series(800, (i) => 100 * 1.003 ** i) });
  const tog = { id: 'TOG', weights: (_, d) => [Math.floor(d / 10) % 2 ? 1 : 0] };
  const pre = runDaily(A, tog, { drift: true }), zero = runDaily(A, tog, { drift: true, tax: { rate: 0 } }), t = runDaily(A, tog, { drift: true, tax: { rate: 0.25 } });
  const eq = (r) => r.series.reduce((e, x) => e * (1 + x.net), 1);
  assert.ok(Math.abs(eq(pre) - eq(zero)) < 1e-12, 'מס 0% = בלי מס');
  // כל הרווח = ממומש בכל השנים + ממומש בשנה הפתוחה + לא ממומש (בדיקת שלמות של בסיס העלות)
  const z = zero.taxInfo, all = z.years.reduce((s, y) => s + y.realized, 0) + z.open.realized + z.open.unrealized;
  assert.ok(Math.abs(all - (eq(zero) - 1)) < 1e-9, `רווח ${all} מול ${eq(zero) - 1}`);
  // 2020 ו-2021 רווחיות → מס של 25% מהרווח הממומש, משולם ביום הראשון של השנה הבאה
  assert.deepEqual(t.taxInfo.years.map((y) => y.y), [2020, 2021]);
  for (const y of t.taxInfo.years){ assert.ok(y.realized > 0); assert.ok(Math.abs(y.tax - 0.25 * y.realized) < 1e-12); }
  const jan21 = t.series.find((x) => x.t === Date.UTC(2021, 0, 1));
  assert.ok(Math.abs(jan21.tax * eq({ series: t.series.filter((x) => x.t < Date.UTC(2021, 0, 1)) }) - t.taxInfo.years[0].tax) < 1e-12);
  assert.equal(t.series.filter((x) => x.tax > 0).length, 2);
  assert.ok(eq(t) < eq(pre) && t.taxInfo.liq.net < t.taxInfo.liq.equity);
  // קנה והחזק: אין מכירה → אין מס עד הסוף; במכירה ביום האחרון — 25% מהרווח (אחרי עמלות)
  const bh = runDaily(A, strategies(A.coins).find((x) => x.id === 'BH-BTC'), { drift: true, tax: { rate: 0.25 } }).taxInfo;
  assert.ok(bh.years.every((y) => y.tax === 0));
  assert.ok(Math.abs(bh.liq.tax - 0.25 * (bh.liq.equity - bh.liq.fee - 1)) < 1e-9);
});

test('מס: מחיר קבוע, קנייה ואז מכירה — ההפסד הממומש = עמלת הקנייה + עמלת המכירה (העמלה לא נספרת פעמיים)', () => {
  // סבב GPT 1 של #260: בדיקה שעמלת הקנייה בתוך בסיס העלות. מחיר קבוע 100; קונים ביום 11, מוכרים ביום 21
  const A = align({ BTC: series(30, () => 100) }), one = (DCOST.spotBps + DCOST.slipBps.BTC) / 1e4;
  const r = runDaily(A, { id: 'IO', weights: (_, d) => [d >= 10 && d < 20 ? 1 : 0] }, { drift: true, tax: { rate: 0.25 } });
  const eq = r.series.reduce((e, x) => e * (1 + x.net), 1), ti = r.taxInfo;
  assert.ok(Math.abs(eq - (1 - one - one * (1 - one))) < 1e-12, 'ההון: שתי עמלות');
  assert.ok(Math.abs(ti.open.realized - (eq - 1)) < 1e-12, `ממומש ${ti.open.realized} = ‎−(עמלת קנייה + עמלת מכירה) ${eq - 1}`);
  assert.equal(ti.liq.tax, 0); assert.equal(ti.open.unrealized, 0);
});

test('מס: הפסד נטו בשנה — בלי מס; carry "year" מאפס אותו, "forward" מקזז מול השנה הבאה', () => {
  // שנה ראשונה יורדת (−0.2% ליום), השנה השנייה עולה
  const A = align({ BTC: series(730, (i) => (i < 366 ? 100 * 0.998 ** i : 100 * 0.998 ** 366 * 1.002 ** (i - 366))) });
  const tog = { id: 'TOG', weights: (_, d) => [Math.floor(d / 10) % 2 ? 1 : 0] };
  const y = runDaily(A, tog, { drift: true, tax: { rate: 0.25 } }).taxInfo, f = runDaily(A, tog, { drift: true, tax: { rate: 0.25, carry: 'forward' } }).taxInfo;
  assert.ok(y.years[0].realized < 0 && y.years[0].tax === 0 && f.years[0].tax === 0);
  assert.equal(y.carry, 0); assert.ok(f.carry < 0 || f.liq.tax < y.liq.tax, 'ההפסד מ-2020 מקטין את המס אחר כך');
  assert.throws(() => runDaily(A, tog, { tax: { rate: 0.25 } }), /drift/);
  // tax.from: החשבון מתחיל ב-2021 — אין שנת מס 2020, וההון באותו יום נשמר להשוואה
  const fr = runDaily(A, tog, { drift: true, tax: { rate: 0.25, from: Date.UTC(2021, 0, 1) } }).taxInfo;
  assert.equal(fr.years.length, 0); assert.equal(fr.open.y, 2021); assert.ok(fr.from < 1);
});
