// שיטות קצרות טווח (engine/research-hourly.js): לוח שעתי, ביצוע בפתיחת הנר שאחרי ההחלטה (בלי הצצה לעתיד), עלויות, שעות מסחר, יציאה בסוף יום
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignH, strategies, runBars, recost, hstats, HCOST, HOUR } from '../engine/research-hourly.js';

const T0 = Date.UTC(2021, 0, 4); // יום שני, 00:00 UTC
const series = (n, f, from = 0) => Array.from({ length: n }, (_, i) => { const c = f(i + from), o = f(i + from - 1) ?? c; return { t: T0 + (i + from) * HOUR, o, h: Math.max(o, c), l: Math.min(o, c), c, v: 100 }; });
let seed = 11; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const walk = (n) => { let x = 100; return series(n, () => (x *= Math.exp((rnd() - 0.5) * 0.02))); };

test('alignH: לוח משותף, NaN לפני שהמטבע קיים, נר חסר ממשיך את הסגירה, ונר שגוי (שפל ~0) מתוקן', () => {
  const btc = series(10, (i) => 100 + i), eth = series(8, (i) => 10 + i, 2);
  btc.splice(3, 1); btc[5] = { ...btc[5], l: 0.06 };
  const A = alignH({ BTC: btc, ETH: eth });
  assert.equal(A.T.length, 10); assert.ok(Number.isNaN(A.C[1][1])); assert.equal(A.C[1][2], 12); assert.equal(A.C[0][3], A.C[0][2]);
  assert.equal(A.fixed.length, 1); assert.ok(A.L[0][6] > 100);
});

test('קנה והחזק: עלות כניסה אחת (חוזה + החלקה), Funding ברירת מחדל ללונג, וסיכום לסדרה יומית', () => {
  const A = alignH({ BTC: series(24 * 5, (i) => 100 * 1.001 ** i) });
  const s = { ...strategies(A).find((x) => x.id === 'BH-BTC'), perp: true }, { daily } = runBars(A, s);
  assert.equal(daily.length, 5);
  assert.ok(Math.abs(daily[0].cost - (HCOST.perpBps + HCOST.slipBps.BTC) / 1e4) < 1e-12);
  assert.ok(Math.abs(daily[2].fund - HCOST.longFundBpsDay / 1e4) < 1e-9, 'Funding של יום שלם = 3bp');
  const total = daily.reduce((e, x) => e * (1 + x.gross), 1);
  assert.ok(total > 1.1);
});

test('בלי הצצה לעתיד: אות שנוצר בסגירת הנר לא תופס את הקפיצה של אותו נר', () => {
  // שטוח, ואז קפיצה של 10% בנר 100. פריצת ערוץ 24 שעות נדלקת בסגירה הזו → נכנסים רק בנר 101
  const A = alignH({ BTC: series(140, (i) => (i < 100 ? 100 : 110)), ETH: series(140, () => 50) });
  const s = strategies(A).find((x) => x.id === 'DCH24-12-BE'), { daily } = runBars(A, s);
  assert.ok(daily.every((d) => Math.abs(d.gross) < 1e-12), 'אין רווח מהקפיצה');
  assert.ok(daily.some((d) => d.exp > 0), 'אבל נכנסים אחריה');
});

test('שעות מסחר: SES-us מחזיק רק בנרות 13:00–20:00 UTC; פריצת תנודתיות יוצאת בסוף היום', () => {
  const A = alignH({ BTC: walk(24 * 60), ETH: walk(24 * 60) }), S = strategies(A);
  const us = S.find((x) => x.id === 'SES-us-BE'), st = {};
  for (let i = 30; i < 80; i++){ const w = us.weights(A, i, st), h = new Date(A.T[i] + HOUR).getUTCHours(); assert.equal(w[0] > 0, h >= 13 && h < 21, `hour ${h}`); }
  const vbo = S.find((x) => x.id === 'VBO0.3-BE'), sv = {};
  for (let i = 48; i < A.T.length; i++){ const w = vbo.weights(A, i, sv); if (new Date(A.T[i]).getUTCHours() === 23) assert.equal(w[0] + w[1], 0); }
});

test('בלי מינוף: סכום המשקלות המוחלטים ≤ 1 בכל נר, בכל האסטרטגיות', () => {
  const A = alignH({ BTC: walk(24 * 45), ETH: walk(24 * 45), SOL: walk(24 * 45), ADA: walk(24 * 45), LTC: walk(24 * 45), DOGE: walk(24 * 45), XRP: walk(24 * 45), DOT: walk(24 * 45), LINK: walk(24 * 45) });
  const F = { BTC: new Map(A.T.map((t) => [t, 0.0002])) };
  for (const s of strategies(A, F)){ const { daily } = runBars(A, s, { funding: F }); for (const d of daily) assert.ok(d.exp <= 1 + 1e-9, s.id); }
});

test('recost: Maker 2bp לכל צד במקום העלות המקורית; hstats: רווח גולמי ועלות ליחידת מחזור', () => {
  const d = [{ t: 0, gross: 0.01, cost: 0.002, fund: 0, net: 0.008, turn: 2, exp: 1, ent: 1 }];
  const m = recost(d, { bpsPerTurn: 2 }); assert.ok(Math.abs(m[0].cost - 0.0004) < 1e-12 && Math.abs(m[0].net - 0.0096) < 1e-12);
  assert.ok(Math.abs(recost(d, { mult: 2 })[0].net - 0.006) < 1e-12);
  const h = hstats(d); assert.equal(h.edgeBps, 50); assert.equal(h.costBps, 10);
});

test('עסקאות: סכום ה-pnl של כל העסקאות = סכום התשואות היומיות פחות עלויות ו-Funding; tstats מחשב Profit Factor ותוחלת', async () => {
  const { tstats } = await import('../engine/research-hourly.js');
  const A = alignH({ BTC: walk(24 * 60), ETH: walk(24 * 60), SOL: walk(24 * 60), ADA: walk(24 * 60), LTC: walk(24 * 60), DOGE: walk(24 * 60), XRP: walk(24 * 60), DOT: walk(24 * 60) });
  for (const id of ['VBO0.3-BE', 'EMA12-48-EW-LS', 'REV4-r4-LS', 'DCH24-12-EW']){
    const s = strategies(A).find((x) => x.id === id), { daily, trades } = runBars(A, s);
    const a = daily.reduce((t, x) => t + x.gross - x.cost - x.fund, 0), b = trades.reduce((t, x) => t + x.pnl, 0);
    assert.ok(Math.abs(a - b) < 1e-9, `${id}: ${a} ≠ ${b}`); assert.ok(trades.length > 0, id);
  }
  const st = tstats([{ t: 0, w: 0.5, pnl: 0.01, bars: 3 }, { t: 1, w: 0.5, pnl: -0.005, bars: 1 }, { t: 2, w: 1, pnl: 0.01, bars: 2 }]);
  assert.equal(st.n, 3); assert.equal(st.pf, 3); assert.equal(st.winRate, 0.67); assert.equal(st.expPct, 0.67); // (2% − 1% + 1%) / 3
});
