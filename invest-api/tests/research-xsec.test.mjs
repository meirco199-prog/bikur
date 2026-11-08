// מחקר החתך (scripts/research-xsec.mjs): פענוח רשימות ויקיפדיה ושחזור הרכב היסטורי, היעדר מידע עתידי בדירוג, וחשבון הסימולציה
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConstituents, parseChanges, membership, build, indicators, variants, rankAll, simulate, stats, TOPK } from '../scripts/research-xsec.mjs';

test('ויקיפדיה: רשימת הרכב, טבלת שינויים עם rowspan והערות שוליים, ושחזור הרכב היסטורי', () => {
  const html = `<table id="constituents"><tr><th>Symbol</th></tr><tr><td><a>AAA</a></td><td>A Co</td></tr><tr><td>BRK.B</td></tr><tr><td>CCC</td></tr></table>
  <table id="changes"><tr><th>Date</th><th>Added</th></tr>
  <tr><td rowspan="2">March 3, 2020[4]</td><td>CCC</td><td>C Co</td><td>OLD</td><td>Old Co</td><td>x</td></tr>
  <tr><td>BRK.B</td><td>B</td><td>GONE</td><td>Gone</td><td>y</td></tr>
  <tr><td>January 2, 2018</td><td>AAA</td><td>A Co</td><td></td><td></td><td>back</td></tr>
  <tr><td>June 1, 2015</td><td></td><td></td><td>AAA</td><td>A Co</td><td>z</td></tr></table>`;
  assert.deepEqual(parseConstituents(html), ['AAA', 'BRK-B', 'CCC']);
  const ch = parseChanges(html);
  assert.deepEqual(ch, [{ date: '2020-03-03', add: 'CCC', rem: 'OLD' }, { date: '2020-03-03', add: 'BRK-B', rem: 'GONE' }, { date: '2018-01-02', add: 'AAA', rem: null }, { date: '2015-06-01', add: null, rem: 'AAA' }]);
  const iv = membership(['AAA', 'BRK-B', 'CCC'], ch), at = (s, d) => iv[s]?.some(([a, b]) => (a === null || d >= a) && (b === null || d < b));
  assert.equal(at('CCC', '2020-03-02'), false); assert.equal(at('CCC', '2020-03-03'), true);
  assert.equal(at('OLD', '2019-01-01'), true); assert.equal(at('OLD', '2020-03-03'), false);
  assert.equal(at('AAA', '2014-01-01'), true); assert.equal(at('AAA', '2016-01-01'), false); assert.equal(at('AAA', '2019-01-01'), true); // הוצאה ב-2015 וחזרה ב-2018
});

let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function mkRaw(nSym = 40, nDays = 420){
  const t0 = Math.floor(Date.UTC(2007, 0, 2) / 86400e3), t = []; for (let d = t0; t.length < nDays; d++){ const w = new Date(d * 86400e3).getUTCDay(); if (w % 6) t.push(d); }
  const raw = {};
  for (let s = 0; s < nSym; s++){ const sym = s ? `S${s}` : 'SPY'; let c = 20 + rnd() * 80; const o = [], h = [], l = [], cl = [], v = [];
    for (let i = 0; i < nDays; i++){ const op = c * (1 + (rnd() - 0.5) * 0.02); c = op * (1 + (rnd() - 0.5) * 0.06); o.push(op); h.push(Math.max(op, c) * 1.01); l.push(Math.min(op, c) * 0.99); cl.push(c); v.push(1e6 * (1 + rnd())); }
    raw[sym] = { t: Int32Array.from(t), o, h, l, c: cl, cr: cl, v }; }
  return raw;
}
function mkCtx(raw){
  const calT = raw.SPY.t, cal = Array.from(calT, (d) => new Date(d * 86400e3).toISOString().slice(0, 10)), L = cal.length, S = build(raw, calT);
  const spyR = new Float64Array(L); for (let k = 1; k < L; k++) spyR[k] = S.SPY.C[k] / S.SPY.C[k - 1] - 1;
  const syms = Object.keys(S).filter((s) => s !== 'SPY'), X = syms.map((s) => S[s]), I = X.map((x) => indicators(x, spyR));
  const k0 = 260, kDev = 340, elig = new Array(L); for (let k = k0; k < L; k++) elig[k] = Int32Array.from(syms.map((_, i) => i));
  return { ctx: { L, cal, X, I, k0, kDev, spyR }, elig, syms };
}

test('בלי מידע עתידי: שינוי המחירים אחרי יום k לא משנה את הבחירה ביום k (בכל האסטרטגיות)', () => {
  const raw = mkRaw(), V = variants().filter((v) => v.fam !== 'F09');
  const A = mkCtx(raw), k = 300;
  const ra = rankAll(A.ctx, V, 'x', A.elig);
  for (const s of Object.keys(raw)) for (const f of ['o', 'h', 'l', 'c', 'cr', 'v']) for (let i = k + 1; i < raw[s].c.length; i++) raw[s][f][i] *= 1 + rnd(); // שיבוש העתיד
  const B = mkCtx(raw), rb = rankAll(B.ctx, V, 'x', B.elig);
  for (const v of V){ const a = Array.from(ra[v.id].slice(k * TOPK, (k + 1) * TOPK)), b = Array.from(rb[v.id].slice(k * TOPK, (k + 1) * TOPK)); assert.deepEqual(b, a, v.id); }
  assert.ok(V.some((v) => ra[v.id][k * TOPK] >= 0), 'צריך שיהיו בחירות לבדיקה');
});

test('סימולציה: מניה אחת, החזקה של יום, בלי עלויות — התשואה = פתיחה→סגירה; עם עלויות — פחות; H תיקי-משנה לא ממנפים', () => {
  const raw = mkRaw(10, 300), { ctx } = mkCtx(raw), top = new Int32Array(ctx.L * TOPK).fill(-1);
  for (let k = ctx.k0; k < ctx.L; k++) top[k * TOPK] = 2; // תמיד מניה 2
  const g = simulate(ctx, top, { N: 1, H: 1, cost: 'gross' }); let e = 50000; for (let t = ctx.k0 + 1; t < ctx.L; t++) e *= ctx.X[2].C[t] / ctx.X[2].O[t];
  assert.ok(Math.abs(g.end / e - 1) < 1e-4, `${g.end} ≠ ${e}`);
  const n = simulate(ctx, top, { N: 1, H: 1, cost: 'net' }); assert.ok(n.end < g.end && n.trades === g.trades && n.feesUsd > 0);
  // מחירים קבועים: כל תצורה נשארת 50,000$ בלי עלויות (אין מינוף/דליפת הון)
  const flat = mkRaw(5, 300); for (const s of Object.keys(flat)) for (const f of ['o', 'h', 'l', 'c', 'cr']) flat[s][f] = flat[s][f].map(() => 50);
  const F = mkCtx(flat), tf = new Int32Array(F.ctx.L * TOPK).fill(-1); for (let k = F.ctx.k0; k < F.ctx.L; k++){ tf[k * TOPK] = 0; tf[k * TOPK + 1] = 1; }
  for (const H of [1, 3, 5]) for (const side of ['L', 'S']) assert.ok(Math.abs(simulate(F.ctx, tf, { N: 3, H, side, cost: 'gross' }).end - 50000) < 1e-6);
  const st = stats(g.yr, '2007', '2099'); assert.ok(Number.isFinite(st.sharpe) && st.n > 0);
});

test('הרכב היסטורי מתמונות מצב (fja05680/sp500): מקטעי חברות, כולל יציאה וחזרה', async () => {
  const { parseSnapshotsCsv, membershipFromSnapshots } = await import('../scripts/research-xsec.mjs');
  const snaps = parseSnapshotsCsv('date,tickers\n2010-01-04,"AAA,BBB,BRK.B"\n2012-03-01,"AAA,BRK.B,CCC"\n2015-06-01,"BBB,BRK.B,CCC"\n');
  assert.equal(snaps.length, 3); assert.ok(snaps[0].set.has('BRK-B'));
  const iv = membershipFromSnapshots(snaps), at = (s, d) => iv[s]?.some(([a, b]) => (a === null || d >= a) && (b === null || d < b));
  assert.equal(at('AAA', '2011-01-01'), true); assert.equal(at('AAA', '2016-01-01'), false);
  assert.equal(at('BBB', '2013-01-01'), false); assert.equal(at('BBB', '2016-01-01'), true); // יצאה ב-2012 וחזרה ב-2015
  assert.equal(at('CCC', '2011-01-01'), false); assert.equal(at('CCC', '2020-01-01'), true);
});
