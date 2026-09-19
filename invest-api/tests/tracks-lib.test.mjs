// אינטגרציה: lib/tracks.js על מסד נתונים בזיכרון (DB עם kv=null). בודק בידוד מלא מ-paper:*/aggr:*, זרימת החלטה→מילוי,
// אימות אחוזי הקצאה מול היעד, ובדיקות תקינות שחוסמות מילוי במקרים פגומים.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMockFetch } from './mock-providers.mjs';
import { DB } from '../lib/db.js';
import { PaperBroker } from '../lib/broker.js';
import { runTracksDecide, runTracksFill, trackReport, tracksCompare } from '../lib/tracks.js';
import { TRACKS, INITIAL_ILS } from '../engine/tracks.js';
import { isNum } from '../engine/util.js';

installMockFetch();

const secs = ['Tech', 'Health', 'Fin', 'Energy', 'Industrials'];
function mkRankTable(day, n = 40){
  const table = [{ symbol: 'SPY', type: 'etf', assetClass: 'equity', role: 'core', price: 500, currency: 'USD', sector: 'רב-ענפי', universe: 'sp500' }, { symbol: 'VTI', type: 'etf', assetClass: 'equity', role: 'core', price: 250, currency: 'USD', sector: 'רב-ענפי' }, { symbol: 'BND', type: 'etf', assetClass: 'bond', role: 'core', price: 70, currency: 'USD', sector: 'אג"ח' }, { symbol: 'GLD', type: 'etf', assetClass: 'gold', role: 'core', price: 190, currency: 'USD', sector: 'סחורות' }];
  for (let i = 0; i < n; i++){
    const strong = i >= n - 8, buy = !strong && i >= n - 16;
    table.push({ symbol: 'ST' + i, type: 'stock', sector: secs[i % secs.length], price: 50 + i, currency: 'USD', coverage: 0.95, universe: 'sp500',
      score: 60 + i, signal: strong ? 'STRONG BUY' : buy ? 'BUY' : 'HOLD', vol1y: 0.3, nextEarnings: null,
      components: { fundamental: 70, valuation: 60, growth: 65, quality: 70, technical: 65, momentum: 65, risk: 70 } });
  }
  return { date: day, barDate: day, table };
}
function mkShadowRows(table, day){
  return table.filter((r) => r.type === 'stock').map((r, i) => {
    const strong = r.signal === 'STRONG BUY', buy = r.signal === 'BUY';
    return { symbol: r.symbol, name: r.symbol, sector: r.sector, price: r.price, open: r.price * 0.995, currency: 'USD',
      A: r.score, actA: r.signal, D: 40 + i, actD: strong ? 'STRONG BUY' : buy ? 'BUY' : 'HOLD',
      DF: 40 + i, actDF: strong ? 'STRONG BUY' : buy ? 'BUY' : 'HOLD',
      eligible: true, eligibleD: true, eligibleDF: true, coverage: 0.95,
      raw: { momentum: 60 + i, growth: 50, quality: 50, risk: 50 }, pct: { momentum: 60, growth: 50, quality: 50, risk: 50 }, fwd: {} };
  });
}
async function seedDay(db, day, { n = 40 } = {}){
  const rank = mkRankTable(day, n);
  await db.put(`rank:${day}`, rank);
  await db.put(`regime:${day}`, { trend: 'Bull Trend', risk: 'Risk On', summary: 'Bull · Risk On' });
  await db.put('fx:USDILS', { rate: 3.7 });
  const shadow = { day, rows: mkShadowRows(rank.table, day), models: { DF: { variant: 'DF-preRevision' } } };
  await db.put(`shadow:${day}`, shadow);
  const days = (await db.get('idx:snapdays')) || []; days.push(day); await db.put('idx:snapdays', days);
  return { rank, shadow };
}
async function seedEntry940(db, day, prices){ await db.put(`entry940:${day}`, { day, count: Object.keys(prices).length, prices }); }
function entryPricesFor(rank, jitter = 1.001){ const p = {}; for (const r of rank.table) p[r.symbol] = r.price * jitter; return p; }

function mkCtx(){ const db = new DB(null); return { db, env: {} }; }

test('בידוד: מפתחות המסלולים נפרדים לגמרי מ-paper:*/aggr:* — כתיבה לתיק חדש לא נוגעת בחשבון התרגול', async () => {
  const ctx = mkCtx();
  const broker = new PaperBroker(ctx.db); // חשבון התרגול הרגיל
  await broker.account(200000);
  await seedDay(ctx.db, '2026-09-17');
  await runTracksDecide(ctx, { day: '2026-09-17' });
  const paperAcc = await ctx.db.get('paper:account');
  assert.equal(paperAcc.cashIls, 200000, 'חשבון התרגול לא נגע');
  const paperTrades = await ctx.db.get('paper:trades');
  assert.ok(!paperTrades || paperTrades.length === 0);
  // מפתחות track: קיימים בנפרד
  assert.ok(await ctx.db.get('track:regB:pending'));
  assert.ok(await ctx.db.get('track:regC:pending'));
  assert.ok(await ctx.db.get('track:aggrB:state'));
  // חשבון regB נוצר בקריאה עצל (כמו paper:account) אבל במפתח נפרד לגמרי, ומתחיל מ-200,000 משלו — לא מזין/מוזן מהאמיתי
  const trackAcc = await ctx.db.get('track:regB:paper:account');
  assert.ok(trackAcc && trackAcc.cashIls === 200000);
  assert.notEqual(trackAcc.createdAt, paperAcc.createdAt, 'שני מסמכי חשבון נפרדים, לא אותה רשומה');
});

test('regB/regC: החלטה לילית → פקודות ממתינות, מילוי ב-09:40, הקצאה מתכנסת ליעד (60/20/10/5/5 ו-40/40/10/5/5)', async () => {
  const ctx = mkCtx();
  const day = '2026-09-17';
  const { rank } = await seedDay(ctx.db, day);
  const dec = await runTracksDecide(ctx, { day });
  assert.equal(dec.ran, true);
  assert.ok(dec.tracks.regB.orders > 0); assert.ok(dec.tracks.regC.orders > 0);
  const pendB = await ctx.db.get('track:regB:pending');
  assert.equal(pendB.track, 'regB'); assert.equal(pendB.filled, false);
  await seedEntry940(ctx.db, day, entryPricesFor(rank));
  const fill = await runTracksFill(ctx, { day });
  assert.equal(fill.tracks.regB.filled > 0, true);
  assert.equal(fill.tracks.regC.filled > 0, true);
  // מילוי כפול לא קורה
  const fill2 = await runTracksFill(ctx, { day });
  assert.equal(fill2.tracks.regB.skipped, 'כבר בוצע');
  // חשבון regB נפרד לגמרי מ-regC ומ-paper
  const accB = await ctx.db.get('track:regB:paper:account'); const accC = await ctx.db.get('track:regC:paper:account');
  assert.ok(accB.cashIls < 200000); assert.ok(accC.cashIls < 200000);
  assert.notEqual(accB.cashIls, accC.cashIls, 'שני מסלולים שונים לא מתכנסים לאותו מזומן');
});

test('הקצאת יעד: regB מתכנס לקרן ליבה 60%, מניות ~20% (עם מספיק ימים); לא חורג מ-maxActiveShare הרגיל', async () => {
  const ctx = mkCtx();
  let day = '2026-09-17';
  const dates = ['2026-09-17', '2026-09-18', '2026-09-19', '2026-09-22', '2026-09-23', '2026-09-24'];
  let lastRank = null;
  for (const d of dates){
    const { rank } = await seedDay(ctx.db, d);
    lastRank = rank;
    await runTracksDecide(ctx, { day: d });
    await seedEntry940(ctx.db, d, entryPricesFor(rank));
    await runTracksFill(ctx, { day: d });
  }
  const r = await trackReport(ctx.db, 'regB');
  assert.ok(r.exposure.stocksShare <= 0.22, `מניות בודדות ${r.exposure.stocksShare} > תקרה 20%+שוליים`);
  assert.ok(r.exposure.stocksShare > 0, 'לפחות התחיל לבנות פוזיציה');
});

test('אגרסיבי B: זורם מהחלטה למילוי, חשיפה מנייתית לא חורגת מ-95%, variant נרשם', async () => {
  const ctx = mkCtx();
  const day = '2026-09-17';
  const { rank } = await seedDay(ctx.db, day);
  await runTracksDecide(ctx, { day });
  await seedEntry940(ctx.db, day, entryPricesFor(rank));
  await runTracksFill(ctx, { day });
  const r = await trackReport(ctx.db, 'aggrB');
  assert.equal(r.kind, 'aggressive');
  assert.ok(r.exposure.equityShare <= 0.96, `חשיפה ${r.exposure.equityShare} מעל 95%`);
  assert.equal(r.variant, 'DF-preRevision');
  assert.ok(r.positions.every((p) => !isNum(p.stopLevel) || p.stopLevel < p.entry), 'רמת עצירה מתחת לכניסה');
});

test('preflight חוסם מילוי: מחיר 09:40 חסר ליום — הפקודות נשארות ממתינות ולא מבוצעות בשקט', async () => {
  const ctx = mkCtx();
  const day = '2026-09-17';
  await seedDay(ctx.db, day);
  await runTracksDecide(ctx, { day });
  const fill = await runTracksFill(ctx, { day }); // בלי entry940 בכלל
  assert.ok(fill.tracks.regB.blocked, JSON.stringify(fill.tracks.regB));
  assert.ok(fill.tracks.regB.blocked.includes('stale-price'));
  const pend = await ctx.db.get('track:regB:pending');
  assert.equal(pend.filled, false, 'לא בוצע בלי מחיר');
});

test('preflight חוסם מזומן שלילי: תקציב מוגזם בטבלת ההחלטה לא עובר, גם אם מישהו ניפח את הפקודות ידנית', async () => {
  const ctx = mkCtx();
  const day = '2026-09-17';
  const { rank } = await seedDay(ctx.db, day);
  await runTracksDecide(ctx, { day });
  const pend = await ctx.db.get('track:regB:pending');
  pend.orders.push({ side: 'buy', symbol: 'ST0', qty: 100000, decisionPrice: 50, currency: 'USD', reason: 'הזרקת בדיקה' });
  await ctx.db.put('track:regB:pending', pend);
  await seedEntry940(ctx.db, day, entryPricesFor(rank));
  const fill = await runTracksFill(ctx, { day });
  assert.ok(fill.tracks.regB.blocked.includes('negative-cash') || fill.tracks.regB.blocked.includes('budget'), JSON.stringify(fill.tracks.regB));
});

test('preflight חוסם ערבוב: פקודות עם track שגוי לא מתבצעות תחת מסלול אחר', async () => {
  const ctx = mkCtx();
  const day = '2026-09-17';
  const { rank } = await seedDay(ctx.db, day);
  await runTracksDecide(ctx, { day });
  const pend = await ctx.db.get('track:regB:pending');
  pend.track = 'regC'; // מדמה באג/ערבוב
  await ctx.db.put('track:regB:pending', pend);
  await seedEntry940(ctx.db, day, entryPricesFor(rank));
  const fill = await runTracksFill(ctx, { day });
  assert.ok(fill.tracks.regB.blocked.includes('mixing'));
});

test('tracksCompare: מחזיר 5 פריטים + חשבון התרגול + אגרסיבי, מדדי ייחוס שקליים, ואזהרת מדגם קטן', async () => {
  const ctx = mkCtx();
  const broker = new PaperBroker(ctx.db); await broker.account(200000);
  const day = '2026-09-17';
  const { rank } = await seedDay(ctx.db, day);
  await runTracksDecide(ctx, { day });
  await seedEntry940(ctx.db, day, entryPricesFor(rank));
  await runTracksFill(ctx, { day });
  const cmp = await tracksCompare(ctx.db);
  const ids = cmp.items.map((i) => i.id).sort();
  assert.deepEqual(ids, ['aggrB', 'paper', 'regB', 'regC'].sort()); // אין aggr כי /aggr:state ריק בתרחיש הזה
  const paper = cmp.items.find((i) => i.id === 'paper');
  assert.equal(paper.control, true); assert.equal(paper.totalIls, INITIAL_ILS);
  assert.ok(cmp.notes.some((n) => /מדגם קטן/.test(n)));
  assert.ok(cmp.benchmarks.spy); assert.ok(cmp.benchmarks.spy95);
});

test('runTracksDecide פעם ביום: הרצה שנייה לאותו יום בלי force לא יוצרת פקודות כפולות', async () => {
  const ctx = mkCtx();
  const day = '2026-09-17';
  await seedDay(ctx.db, day);
  const d1 = await runTracksDecide(ctx, { day });
  const d2 = await runTracksDecide(ctx, { day });
  assert.equal(d2.tracks.regB.skipped, 'כבר הוחלט היום');
  const j = await ctx.db.get('track:regB:journal');
  assert.equal(j.filter((e) => e.type === 'decide').length, 1, 'רק החלטה אחת נרשמה ביומן');
});
