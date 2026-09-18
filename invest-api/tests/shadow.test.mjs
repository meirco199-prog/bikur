import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeShadow, rankActions, pctRank, spearman, fillForward, accumulateStats, summarizeStats, componentCorrelation, rawFactors, SHADOW_MODELS, SHADOW_RULES, scoreDistribution } from '../engine/shadow.js';
import { DB } from '../lib/db.js';
import { runShadow, shadowReport } from '../lib/shadow.js';

const secs = ['Technology', 'Healthcare', 'Financials'];
const mk = (n, f = () => ({})) => [...Array(n)].map((_, i) => ({ symbol: 'S' + i, type: 'stock', sector: secs[i % 3], price: 100 + i, currency: 'USD', score: 40 + i, signal: i >= n - 6 ? 'BUY' : i < 4 ? 'SELL' : 'HOLD', components: { fundamental: 30 + i, valuation: 90 - i, growth: 50 + (i % 7) * 5, quality: 35 + i, technical: (20 + i * 2) % 80, momentum: (25 + i * 3) % 90, risk: 60, analyst: null, sentiment: 50, macro: 65 }, ...f(i) }));

test('מודל צל: אחוזון בתוך הענף, איחוד כפילויות, זכאות רק עם ארבעת הגורמים, ריוויזיות חסרות = null (לא 0)', () => {
  const table = [...mk(40), { symbol: 'SPY', type: 'etf', price: 500, score: 70, signal: 'HOLD', components: {} }];
  const revisions = Object.fromEntries(mk(40).map((r, i) => [r.symbol, i < 12 ? { available: true, epsRevision: (i - 6) / 100 } : { available: false, reason: 'היסטוריה של 3 ימים בלבד (נדרשים 30)' }]));
  const d = computeShadow({ table, revisions, regime: { trend: 'Bull Trend', risk: 'Risk On' }, day: '2026-09-17' });
  assert.equal(d.n, 40, 'ETF לא נכללת'); assert.equal(d.eligible, 40);
  const r0 = d.rows[0];
  assert.equal(r0.pct._relativeTo, 'sector'); assert.ok(r0.pct.value >= 0 && r0.pct.value <= 100);
  assert.equal(rawFactors(r0 && table[0].components).profitability, (30 + 35) / 2, 'פונדמנטלי+איכות → רווחיות');
  assert.equal(d.revisionsAvailable, 12); assert.equal(d.revisionsUsed, true);
  assert.equal(d.rows[20].revision, null); assert.match(d.rows[20].revisionNote, /היסטוריה של 3 ימים/); assert.equal(d.rows[20].revisionPct, null);
  assert.ok(Object.keys(d.rows[20].contribC).every((k) => k !== 'revision'), 'בלי ריוויזיה: המשקל מתחלק בין השאר, לא אפס');
  assert.ok(Object.keys(d.rows[3].contribC).includes('revision'));
  assert.ok(isFinite(d.rows[3].C) && isFinite(d.rows[3].B));
  assert.deepEqual(Object.keys(d.models.A.actions), ['STRONG BUY', 'BUY', 'HOLD', 'SELL']);
  assert.equal(d.models.B.actions['STRONG BUY'], 6); assert.equal(d.models.B.actions.BUY, 6); assert.equal(d.models.B.actions.SELL, 8);
  assert.ok(d.agreement.AB >= 0 && d.agreement.AB <= 1); assert.equal(d.top.B.length, 10);
  assert.ok(d.corr.keys.includes('score') && d.corr.matrix.length === d.corr.keys.length);
  assert.ok(d.corr.dupes.some((x) => x.a === 'fundamental' && x.b === 'quality'), 'כפילות מזוהה במתאם');
  // מניה בלי צמיחה → לא זכאית, ציון null, לא מומצא
  const d2 = computeShadow({ table: mk(30, (i) => (i === 0 ? { components: { fundamental: 50, valuation: 50, technical: 50, momentum: 50, risk: 50 } } : {})), revisions: {}, day: '2026-09-17' });
  assert.equal(d2.rows[0].eligible, false); assert.equal(d2.rows[0].B, null); assert.equal(d2.rows[0].actB, null);
  assert.equal(d2.revisionsUsed, false);
});

test('מודל צל: פעולה לפי דירוג יחסי, שכבת מאקרו (דובי: בלי קניות; Risk Off: רק חזקה), מעט מניות → HOLD', () => {
  const scores = [...Array(40)].map((_, i) => i);
  const a = rankActions(scores);
  assert.equal(a[39], 'STRONG BUY'); assert.equal(a[30], 'BUY'); assert.equal(a[0], 'SELL'); assert.equal(a[20], 'HOLD');
  const bear = rankActions(scores, { overlay: 'bear' }); assert.ok(!bear.includes('BUY') && !bear.includes('STRONG BUY') && bear.includes('SELL'));
  const ro = rankActions(scores, { overlay: 'riskoff' }); assert.ok(!ro.includes('BUY') && ro.includes('STRONG BUY'));
  assert.ok(rankActions([1, 2, 3, 4, 5]).every((x) => x === 'HOLD'));
  assert.equal(rankActions([null, 5, null])[0], null);
  const d = computeShadow({ table: mk(30), revisions: {}, regime: { trend: 'Bear Trend', risk: 'Risk On' } });
  assert.equal(d.overlay, 'bear'); assert.equal(d.models.C.actions.BUY + d.models.C.actions['STRONG BUY'], 0); assert.ok(d.models.B.actions.BUY > 0, 'B בלי שכבת מאקרו');
});

test('מודל צל: אחוזון, ספירמן, מילוי תשואות עתידיות ותשואה עודפת, צבירה וסיכום (מונוטוניות, IC)', () => {
  assert.equal(pctRank([1, 2, 3, 4], 3), 62.5); assert.equal(pctRank([], 1), null); assert.equal(pctRank([1, 2], null), null);
  assert.equal(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]), 1); assert.equal(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), -1); assert.equal(spearman([1, 2], [1, 2]), null);
  const d = computeShadow({ table: mk(60), revisions: {}, day: '2026-09-17' });
  // מחירי "היום": ציון גבוה → עלייה גדולה יותר (מונוטוני), SPY +2%
  const priceNow = Object.fromEntries(d.rows.map((r) => [r.symbol, r.price * (1 + (r.B || 50) / 1000)]));
  const f = fillForward(d, 5, priceNow, { spyNow: 102, spyThen: 100, day: '2026-09-24' });
  assert.equal(f.filled, 60); assert.equal(d.fwd[5].spy, 0.02);
  assert.ok(Math.abs(d.rows[0].fwd[5].excess - (d.rows[0].fwd[5].ret - 0.02)) < 1e-6);
  assert.equal(fillForward(d, 5, priceNow).already, true, 'לא ממלאים פעמיים');
  let stats = accumulateStats(null, d, 5);
  stats = accumulateStats(stats, d, 5); // אותו יום פעמיים → לא נספר שוב
  const sum = summarizeStats(stats);
  const B = sum.horizons['5'].models.B;
  assert.equal(sum.horizons['5'].days, 1); assert.equal(B.n, 60); assert.equal(B.ic, 1, 'IC=1 כשהתשואה מונוטונית בציון');
  assert.equal(B.monotonic, true); assert.ok(B.actions['STRONG BUY'].mean > B.actions.SELL.mean);
  assert.ok(B.buckets.find((b) => b.bucket === '<50').n > 0);
  assert.equal(summarizeStats(null), null);
});

test('מודל צל: הרצה לילית — מסמך ליום, אידמפוטנטי, מילוי תשואות למסמכים ישנים לפי idx:snapdays, דוח קומפקטי', async () => {
  const db = new DB(null); const ctx = { db, env: {} };
  const days = ['2026-09-10', '2026-09-11', '2026-09-16', '2026-09-17'];
  await db.put('idx:snapdays', days);
  for (const [k, day] of days.entries()){ const table = [...mk(30, () => ({})).map((r) => ({ ...r, price: r.price * (1 + k * 0.01) })), { symbol: 'SPY', type: 'etf', price: 500 + k, score: 70, signal: 'HOLD', components: {} }]; await db.put(`rank:${day}`, { table, barDate: day }); await db.put(`regime:${day}`, { trend: 'Bull Trend', risk: 'Risk On' }); }
  await db.put('esthist:S1', [{ date: '2026-08-01', epsFy1: 5, fy1Date: '2027-12-31' }, { date: '2026-09-17', epsFy1: 5.5, fy1Date: '2027-12-31' }]);
  const r1 = await runShadow(ctx, { day: '2026-09-16' });
  assert.equal(r1.ran, true); assert.equal(r1.created, true); assert.equal(r1.n, 30);
  assert.deepEqual(r1.filled, {}, 'אין מסמכים ישנים עדיין');
  const r2 = await runShadow(ctx, { day: '2026-09-17' });
  assert.equal(r2.created, true); assert.equal(r2.filled['1'].day, '2026-09-16'); assert.equal(r2.filled['1'].filled, 30);
  assert.equal(r2.filled['5'], undefined, 'אין מסמך של לפני 5 ימי ניתוח');
  const old = await db.get('shadow:2026-09-16');
  assert.ok(old.fwd['1'] && Math.abs(old.rows[0].fwd['1'].ret - (1.03 / 1.02 - 1)) < 1e-4); assert.ok(Math.abs(old.fwd['1'].spy - (503 / 502 - 1)) < 1e-4);
  const r3 = await runShadow(ctx, { day: '2026-09-17' });
  assert.equal(r3.created, false); assert.deepEqual(r3.filled, {});
  const rep = await shadowReport(db);
  assert.equal(rep.day, '2026-09-17'); assert.equal(rep.rows.length, 30); assert.ok(!('raw' in rep.rows[0]), 'דוח קומפקטי');
  assert.ok(rep.stats.horizons['1'].models.A.n === 30);
  assert.ok(rep.rows.find((r) => r.symbol === 'S1').revision === 0.1);
  assert.ok(rep.rows.find((r) => r.symbol === 'S2').revisionNote);
});

test('מודל צל: אופקים 1/5/20/60 והתפלגות ציונים יומית (חלק קנייה חזקה, חציון, קבוצות)', async () => {
  assert.deepEqual(SHADOW_RULES.horizons, [1, 5, 20, 60]);
  const d = scoreDistribution([10, 55, 65, 75, 85, 90], ['SELL', 'HOLD', 'HOLD', 'BUY', 'STRONG BUY', 'STRONG BUY']);
  assert.equal(d.n, 6); assert.equal(d.buckets['80+'], 2); assert.equal(d.buckets['<50'], 1); assert.equal(d.strongBuyShare, 0.333); assert.equal(d.buyShare, 0.167); assert.equal(d.median, 65);
  assert.deepEqual(scoreDistribution([]), { n: 0 });
  const doc = computeShadow({ table: mk(30), revisions: {}, day: '2026-09-17' });
  assert.ok(doc.dist.A.n === 30 && doc.dist.B.n === 30 && isFinite(doc.dist.C.mean));
  assert.ok(doc.dist.B.strongBuyShare > 0.1 && doc.dist.B.strongBuyShare < 0.2, 'כ-15% קנייה חזקה');
  const db = new DB(null); const ctx = { db, env: {} };
  await db.put('idx:snapdays', ['2026-09-17']); await db.put('rank:2026-09-17', { table: mk(30) });
  await runShadow(ctx, { day: '2026-09-17' });
  const series = await db.get('shadow:dist');
  assert.equal(series.length, 1); assert.equal(series[0].day, '2026-09-17'); assert.ok(isFinite(series[0].B.strong));
  const rep = await shadowReport(db); assert.equal(rep.distSeries.length, 1);
});

test('מודל צל: מודל D (אגרסיבי, בלי תמחור) ויקום ייחוס S&P 500 בלבד כשמתויג', () => {
  const t = mk(120); t.forEach((r, i) => { r.universe = i < 105 ? 'sp500' : 'extended'; });
  const d = computeShadow({ table: t, revisions: {}, day: '2026-09-17' });
  assert.equal(d.universe, 'sp500'); assert.equal(d.n, 105, 'המורחב לא נכנס לאחוזונים');
  assert.ok(d.models.D && d.top.D.length === 10 && isFinite(d.rows[0].D));
  assert.ok(!('value' in SHADOW_MODELS.D.weights), 'בלי תמחור');
  assert.ok(d.dist.D.n === 105 && isFinite(d.agreement.CD));
  // מניה בלי מומנטום → לא זכאית ב-D
  const t2 = mk(30, (i) => (i === 0 ? { components: { fundamental: 50, valuation: 50, growth: 50, quality: 50, technical: 50, risk: 50 } } : {}));
  const d2 = computeShadow({ table: t2, revisions: {}, day: '2026-09-17' });
  assert.equal(d2.rows[0].eligibleD, false); assert.equal(d2.rows[0].D, null); assert.equal(d2.universe, 'all');
  // בלי תיוג / פחות מ-100 מתויגות → כל המניות
  const t3 = mk(60); t3.forEach((r, i) => { r.universe = i < 50 ? 'sp500' : 'extended'; });
  assert.equal(computeShadow({ table: t3, revisions: {}, day: 'x' }).n, 60);
});

test('מודל צל: כניסה בפתיחת היום הבא (לא סגירת הסיגנל), SPY מאותה נקודה, ו-D-preRevision נצבר בנפרד', async () => {
  const d = computeShadow({ table: mk(30, (i) => ({ open: 100 + i })), revisions: {}, day: '2026-09-17' });
  assert.equal(d.models.D.variant, 'D-preRevision'); assert.equal(d.rows[0].open, 100);
  const priceNow = Object.fromEntries(d.rows.map((r) => [r.symbol, r.price * 1.1]));
  const entryOpen = Object.fromEntries(d.rows.map((r) => [r.symbol, r.price * 1.05])); // פתיחת מחר גבוהה ב-5% מסגירת הסיגנל (גאפ)
  fillForward(d, 1, priceNow, { spyNow: 110, spyThen: 100, spyEntry: 105, day: '2026-09-18', entryOpen });
  assert.ok(Math.abs(d.rows[0].fwd[1].ret - (1.1 / 1.05 - 1)) < 1e-4, 'התשואה נמדדת מהפתיחה, לא מהסגירה'); assert.equal(d.rows[0].fwd[1].entryKind, 'next-open');
  assert.ok(Math.abs(d.fwd[1].spy - (110 / 105 - 1)) < 1e-4, 'SPY מאותה נקודת כניסה'); assert.equal(d.fwd[1].atOpen, 30);
  const st = accumulateStats(null, d, 1);
  assert.ok(st.horizons[1]['D-preRevision'] && !st.horizons[1].D, 'רקורד נפרד עד שיש ריוויזיות');
  // בלי פתיחה → סגירה, מסומן
  const d2 = computeShadow({ table: mk(30), revisions: {}, day: '2026-09-17' });
  fillForward(d2, 1, priceNow, { spyNow: 110, spyThen: 100, day: 'x' });
  assert.equal(d2.rows[0].fwd[1].entryKind, 'close'); assert.equal(d2.fwd[1].spyEntryKind, 'close');
  // הרצה לילית: shards (צינור אחיד) → הפול = חברות המדד מה-shards; שורות ה-Worker שלא ב-shards = מורחב
  const { putSnapsBatch } = await import('../lib/snapstore.js');
  const db = new DB(null); const ctx = { db, env: {} };
  const uni = mk(120).map((r) => ({ ...r, symbol: 'U' + r.symbol.slice(1), open: r.price - 1 }));
  await putSnapsBatch(db, '2026-09-17', uni);
  await db.put('meta:mechanical', { symbols: uni.slice(0, 110).map((r) => r.symbol) });
  await db.put('idx:snapdays', ['2026-09-17']); await db.put('rank:2026-09-17', { table: [...mk(20), { symbol: 'SPY', type: 'etf', price: 500, open: 498, score: 70, signal: 'HOLD', components: {} }] });
  const r = await runShadow(ctx, { day: '2026-09-17' });
  assert.equal(r.pipeline, 'uniform'); assert.equal(r.uniformCount, 120); assert.equal(r.n, 110, 'רק חברות המדד מה-shards באחוזונים');
  const doc = await db.get('shadow:2026-09-17'); assert.equal(doc.rows[0].open, doc.rows[0].price - 1);
});
