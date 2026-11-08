// מעבדה — אופטימיזציה ואימות: רשת, חלוקת תקופות, בחירה באימות ולא באימון, Walk-Forward, Monte Carlo, מובהקות, ספרייה, מפענח טקסט.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Dataset, rowsToCompact } from '../engine/lab/data.js';
import { expandGrid, applyParams, splitPeriod, optimize, walkForward, monteCarlo, significance, normCdf, normInv, periodBreakdown, runGrid } from '../engine/lab/optimize.js';
import { simulate } from '../engine/lab/simulate.js';
import { LIBRARY, byId } from '../engine/lab/library.js';
import { normalizeSpec } from '../engine/lab/schema.js';
import { parseFreeText, buildPrompt, parseModelJson } from '../engine/lab/nlp.js';
import { syntheticRows } from './helpers.mjs';

const syms = ['A', 'B', 'C', 'D', 'E', 'F'];
const ds = new Dataset({ series: [...syms.map((s, i) => rowsToCompact(s, syntheticRows({ n: 2000, seed: i + 7, price: 40 + i * 5, drift: 0.0004 }))), rowsToCompact('SPY', syntheticRows({ n: 2000, seed: 77, price: 200, drift: 0.0004 }))] });
const spec = { universe: { type: 'list', symbols: syms, filters: { minPrice: 0, minDollarVol: 0, minBars: 20 } }, signal: { rank: { feature: 'ret', params: { days: 1 }, order: 'asc', top: 2 } }, exit: { rules: [{ type: 'time', days: 1 }] }, sizing: { capital: 20000, maxPositions: 2 }, costs: { model: 'none' }, benchmarks: ['SPY'] };
const params = { topN: { path: ['signal.rank.top', 'sizing.maxPositions'], values: [1, 2, 3] }, hold: { path: 'exit.rules.0.days', values: [1, 3] } };

test('רשת פרמטרים: כל הצירופים, applyParams כותב לכמה נתיבים, מגבלת גודל', () => {
  const g = expandGrid(params); assert.equal(g.length, 6); assert.deepEqual(g[0], { topN: 1, hold: 1 });
  const s = applyParams(spec, { topN: 3, hold: 3 }, params); assert.equal(s.signal.rank.top, 3); assert.equal(s.sizing.maxPositions, 3); assert.equal(s.exit.rules[0].days, 3); assert.equal(spec.signal.rank.top, 2, 'המקור לא השתנה');
  assert.throws(() => expandGrid({ a: { path: 'x', values: Array.from({ length: 80 }, (_, i) => i) }, b: { path: 'y', values: Array.from({ length: 80 }, (_, i) => i) } }), /צירופים/);
});

test('חלוקה כרונולוגית אימון/אימות/מבחן ללא חפיפה ובסדר הנכון', () => {
  const r = splitPeriod('2010-01-01', '2020-01-01');
  assert.equal(r.train.from, '2010-01-01'); assert.ok(r.train.to < r.val.from && r.val.to < r.test.from); assert.equal(r.test.to, '2020-01-01');
  assert.ok(r.train.to.startsWith('2015') && r.val.to.startsWith('2017'));
});

test('optimize: הבחירה הסופית לפי האימות (מתוך הטובים באימון), המבחן נפתח פעם אחת, רגישות ואזהרות', () => {
  const o = optimize(ds, spec, { params, objective: 'sharpe', topK: 3 });
  assert.ok(!o.error, o.error);
  assert.equal(o.combos, 6); assert.equal(o.train.rows.length, 6); assert.equal(o.validation.length, 3);
  assert.ok(o.validation.every((v) => o.train.rows.slice(0, 3).some((t) => JSON.stringify(t.combo) === JSON.stringify(v.combo))), 'האימות רק על הטובים באימון');
  assert.deepEqual(o.chosen, o.validation[0].combo, 'הנבחר הוא הטוב באימות');
  assert.deepEqual(o.test.combo, o.chosen); assert.ok(o.test.result.from >= o.ranges.test.from);
  assert.ok(Object.keys(o.sensitivity).length === 2 && o.sensitivity.topN.some((x) => x.chosen));
  assert.ok(o.significance && typeof o.significance.pAdjusted === 'number' && o.significance.nTrials === 6);
  assert.ok(Array.isArray(o.warnings));
  // על הליכה אקראית בלי יתרון — צפוי שלא תהיה מובהקות אחרי תיקון
  assert.ok(o.significance.pAdjusted > 0.05 || o.significance.deflatedSharpe < 0.95);
});

test('runGrid: מעט עסקאות → score=null (לא נבחר); מיון יורד לפי היעד', () => {
  const g = runGrid(ds, spec, params, { objective: 'cagr', from: '2015-01-02', to: '2015-02-15', minTrades: 500 });
  assert.ok(g.rows.every((r) => r.score === null && r.tooFewTrades));
  const g2 = runGrid(ds, spec, params, { objective: 'cagr', minTrades: 5 });
  for (let i = 1; i < g2.rows.length; i++) assert.ok((g2.rows[i - 1].score ?? -Infinity) >= (g2.rows[i].score ?? -Infinity));
});

test('Walk-Forward: חלונות IS→OOS מתגלגלים, בחירה על IS בלבד, OOS משורשר רציף', () => {
  const wf = walkForward(ds, spec, params, { isYears: 2, oosYears: 1 });
  assert.ok(!wf.error, wf.error);
  assert.ok(wf.windows.length >= 4);
  for (const w of wf.windows){ assert.ok(w.isTo < w.oosFrom); if (w.chosen) assert.ok(w.oos && typeof w.oos.cagr === 'number'); }
  for (let i = 1; i < wf.oosEquity.length; i++) assert.ok(wf.oosEquity[i][0] > wf.oosEquity[i - 1][0], 'OOS לא ממוין');
  assert.ok(wf.oosMetrics && 'cagr' in wf.oosMetrics && ['יציב', 'לא יציב (הפרמטר קופץ בין חלונות)', '—'].includes(wf.stability.label));
  assert.deepEqual(walkForward(ds, spec, params, { isYears: 30, oosYears: 1 }).error?.includes('אין מספיק שנים'), true);
});

test('Monte Carlo דטרמיניסטי עם seed, אחוזונים מסודרים, ורשימת מגבלות', () => {
  const r = simulate(ds, spec); const mc = monteCarlo(r.trades, { capital: 20000, n: 300, seed: 3 }), mc2 = monteCarlo(r.trades, { capital: 20000, n: 300, seed: 3 });
  assert.deepEqual(mc.finalEquity, mc2.finalEquity);
  assert.ok(mc.finalEquity.p5 <= mc.finalEquity.median && mc.finalEquity.median <= mc.finalEquity.p95);
  assert.ok(mc.maxDD.p5 <= mc.maxDD.median && mc.limitations.length >= 3);
  assert.ok(monteCarlo([]).error);
});

test('מובהקות: סדרה חסרת יתרון → לא מובהקת; סדרה עם יתרון חזק → מובהקת; תיקון Bonferroni מגדיל את p; התפלגות נורמלית', () => {
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3 && Math.abs(normInv(0.975) - 1.96) < 1e-2 && Math.abs(normCdf(normInv(0.3)) - 0.3) < 1e-4);
  const flat = { equity: Array.from({ length: 300 }, (_, i) => [`d${i}`, 100 + Math.sin(i) * 0.5]) };
  const s1 = significance(flat, { nTrials: 1 }); assert.ok(s1.pValue > 0.05 && s1.verdict === 'לא מובהק');
  const up = { equity: Array.from({ length: 500 }, (_, i) => [`d${i}`, 100 * Math.pow(1.002, i) * (1 + Math.sin(i * 7) * 0.001)]) };
  const s2 = significance(up, { nTrials: 1 }); assert.ok(s2.pValue < 0.01 && s2.deflatedSharpe > 0.95, JSON.stringify(s2));
  const s3 = significance(up, { nTrials: 1000, trialSharpes: Array.from({ length: 1000 }, (_, i) => (i % 7) - 3) }); assert.ok(s3.pAdjusted >= s2.pValue && s3.sharpeThresholdAnnual > 0);
  assert.ok(significance({ equity: [['a', 1], ['b', 2]] }).error);
});

test('ביצועים לפי תקופות שוק: תקופות שלא מכוסות מסומנות missing, מכוסות עם מדדים', () => {
  const r = simulate(ds, spec); const pb = periodBreakdown(r, r.benchmarks.SPY);
  assert.ok(pb.some((p) => p.missing) && pb.some((p) => !p.missing && typeof p.totalReturn === 'number' && p.bench));
});

test('ספריית האסטרטגיות: 20 תבניות תקינות, כולן עם params ברי-יישום, ודוגמת Top 10 Losers כמפורט בדרישה', () => {
  assert.equal(LIBRARY.length, 20);
  for (const t of LIBRARY){ const s = normalizeSpec(t.spec); assert.ok(s.name && t.category && t.description); for (const [, p] of Object.entries(t.params)){ assert.ok(p.values.length >= 2 && p.label); const s2 = applyParams(t.spec, Object.fromEntries(Object.entries(t.params).map(([k, v]) => [k, v.values[0]])), t.params); normalizeSpec(s2); } }
  const l = normalizeSpec(byId('top10-losers-1d').spec);
  assert.equal(l.signal.rank.top, 10); assert.equal(l.signal.rank.order, 'asc'); assert.equal(l.entry.timing, 'next_open'); assert.deepEqual(l.exit.rules[0], { type: 'time', at: 'close', days: 1 }); assert.equal(l.sizing.capital, 50000); assert.equal(l.sizing.maxPositions, 10); assert.equal(l.universe.pointInTime, true);
});

test('מפענח שפה חופשית: הדוגמה מהדרישה ועוד שתי ניסוחים → spec תקין; פלט מודל → JSON מאומת; בקשה קצרה נדחית', () => {
  const r = parseFreeText('קח את 15 המניות שירדו הכי הרבה בשלושת הימים האחרונים בנאסד"ק, בתנאי שהמחזור שלהן גבוה מהממוצע, קנה בפתיחה, מכור לאחר יומיים והשקע 100,000 דולר.');
  assert.equal(r.spec.signal.rank.top, 15); assert.equal(r.spec.signal.rank.params.days, 3); assert.equal(r.spec.signal.rank.order, 'asc'); assert.equal(r.spec.universe.index, 'nasdaq100');
  assert.equal(r.spec.signal.conditions.all[0].feature, 'rel_vol'); assert.equal(r.spec.entry.timing, 'next_open'); assert.equal(r.spec.sizing.capital, 100000); assert.equal(r.spec.exit.rules[0].type, 'time'); assert.equal(r.spec.exit.rules[0].days, 3);
  assert.ok(r.explanation.length === 7 && r.notes.length >= 1);
  const e = parseFreeText('Buy the 10 biggest losers of yesterday at the open, sell at the end of the same day, invest $50,000, stop loss 3%');
  assert.equal(e.spec.signal.rank.params.days, 1); assert.ok(e.spec.exit.rules.some((x) => x.type === 'stop_loss' && x.pct === 0.03) && e.spec.exit.rules.some((x) => x.type === 'time' && x.days === 1));
  const s = parseFreeText('שורט על 5 המניות שעלו הכי הרבה בשבוע האחרון, כיסוי למחרת, 20,000$'); assert.equal(s.spec.signal.direction, 'short'); assert.equal(s.spec.signal.rank.order, 'desc'); assert.equal(s.spec.signal.rank.params.days, 5);
  assert.throws(() => parseFreeText('קנה'), /קצרה/);
  const p = buildPrompt('x'); assert.ok(p.system.includes('rank') && p.system.includes('rel_vol'));
  const m = parseModelJson('הנה: {"name":"a","signal":{"rank":{"feature":"ret","params":{"days":2},"order":"asc","top":7}},"exit":{"rules":[{"type":"time","days":2}]},"notes":["x"]}');
  assert.equal(m.spec.signal.rank.top, 7); assert.deepEqual(m.notes, ['x']); assert.equal(m.parser, 'llm');
  assert.throws(() => parseModelJson('no json'), /JSON/);
});
