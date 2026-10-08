// אופציות בסימולציה (קנייה בלבד): B-S, פקיעה, סימבולים, מועמדים, מרג'ין, ומחזור סוכן מלא. (ההקדמה המקורית נשמרת למטה)
// מחזור יומי מלא של הסוכן דרך ה-Worker, עם KV מדומה ומחירים שנזרעו במטמון (בלי רשת): ריצה ראשונה → החלטות; ריצה שנייה → מילוי
// בפתיחת היום הבא, שערוך, עצירות; דוח ציבורי; kill switch; אין look-ahead (החלטה בסגירת S, מילוי בפתיחת S+1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installMockFetch } from './mock-providers.mjs';
import worker from '../worker.js';
import { bsPrice, bsDelta, normCdf, thirdFriday, pickExpiry, pickStrike, strikeStep, optionSymbol, parseOptionSymbol, optionInstrument, optionRows, optionCandidates, expiringPositions, impliedVolGuess, isOptionSymbol } from '../engine/options.js';
import { newAccount, fill, valuation } from '../engine/margin-sim.js';
import { commissionUsd, slippageRate, registerInstruments } from '../engine/instruments.js';
import { AGENT_INSTRUMENTS, priceSymbolOf, instrumentOf } from '../engine/instruments.js';
import { agentPrices } from '../lib/agent.js';
import { lastSessionClose } from '../engine/session.js';
import { DB } from '../lib/db.js';
import { Budget } from '../lib/budget.js';

installMockFetch();
const store = new Map();
const env = { INVEST: { get: async (k, type) => (type === 'text' ? (store.has(k) ? store.get(k) : null) : (store.has(k) ? JSON.parse(store.get(k)) : null)), put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix = '' } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) }, FINNHUB_KEY: 'x', APP_TOKEN: 'secret', CRON_SECRET: 'cron-secret-for-tests', RATE_LIMIT_OFF: '1' };
const call = (path, { method = 'GET', body, auth } = {}) => worker.fetch(new Request('https://api.test' + path, { method, headers: { 'CF-Connecting-IP': '9.9.9.9', 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer secret' } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil(){} }).then(async (r) => ({ status: r.status, j: await r.json() }));

// ימי מסחר: 300 ימי חול רצופים שמסתיימים ב-2026-09-22 (יום ג'), ועוד יום אחד (23/9) לסשן הבא
function tradingDays(n, endIso){ const out = []; const d = new Date(endIso + 'T00:00:00Z'); while (out.length < n){ if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); } return out; }
const DAYS = tradingDays(300, '2026-09-22'); const NEXT = '2026-09-23';
const mk = (f) => DAYS.map((d, i) => { const c = f(i); return [d, c * 0.999, c * 1.006, c * 0.994, c, 2e6]; });
const seedPrices = () => {
  const now = new Date().toISOString();
  for (const sym of new Set(AGENT_INSTRUMENTS.map(priceSymbolOf))){
    const h = [...sym].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 7;
    const f = sym === 'GLD' ? (i) => 250 * Math.exp(0.0016 * i) * (1 + 0.006 * Math.sin(i / 6)) // מגמה חזקה → לונג
      : sym === 'UNG' ? (i) => 30 * Math.exp(-0.0018 * i) * (1 + 0.006 * Math.sin(i / 6))       // ירידה → שורט
      : sym === 'SPY' ? (i) => 500 * (1 + 0.0003 * i)
      : (i) => 100 * (1 + 0.015 * Math.sin(i / (8 + h)));                                       // שטוח
    store.set(`px:${sym}`, JSON.stringify({ symbol: sym, currency: 'USD', source: 'seed', rows: mk(f), fetchedAt: now }));
  }
  store.set('fx:USDILS', JSON.stringify({ rate: 3.7, fetchedAt: now }));
};


const SPY = instrumentOf('SPY');
const trendRows = (n, end = '2026-10-07', start = 500, g = 0.0016) => { const days = tradingDays(n, end); return days.map((d, i) => { const c = start * Math.exp(g * i) * (1 + 0.004 * Math.sin(i / 5)); return [d, c * 0.999, c * 1.005, c * 0.995, c, 1e6]; }); };

test('Black-Scholes: ערכי ייחוס, שוויון put-call, דלתא וערך פנימי בפקיעה', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7 && Math.abs(normCdf(1.96) - 0.975) < 1e-3);
  const call = bsPrice({ S: 100, K: 100, T: 1, sigma: 0.2, right: 'C', r: 0.05 }), put = bsPrice({ S: 100, K: 100, T: 1, sigma: 0.2, right: 'P', r: 0.05 });
  assert.ok(Math.abs(call - 10.4506) < 0.01, 'call ' + call); assert.ok(Math.abs(put - 5.5735) < 0.01, 'put ' + put);
  assert.ok(Math.abs(call - put - (100 - 100 * Math.exp(-0.05))) < 1e-3, 'put-call parity');
  assert.ok(Math.abs(bsDelta({ S: 100, K: 100, T: 1, sigma: 0.2, right: 'C', r: 0.05 }) - 0.6368) < 0.005);
  assert.equal(bsPrice({ S: 110, K: 100, T: 0, sigma: 0.2, right: 'C' }), 10); assert.equal(bsPrice({ S: 90, K: 100, T: 0, sigma: 0.2, right: 'C' }), 0); assert.equal(bsPrice({ S: 90, K: 100, T: 0, sigma: 0.2, right: 'P' }), 10);
  assert.equal(bsPrice({ S: 0, K: 100, T: 1, sigma: 0.2, right: 'C' }), null);
});

test('פקיעה וסימבולים: שישי שלישי, פקיעה ≥30 יום, strike, קידוד/פענוח', () => {
  assert.equal(thirdFriday(2026, 10), '2026-11-20'); assert.equal(pickExpiry('2026-10-08', 30), '2026-11-20'); assert.equal(pickExpiry('2026-10-08', 5), '2026-10-16');
  assert.equal(strikeStep(20), 0.5); assert.equal(strikeStep(90), 1); assert.equal(strikeStep(777), 10); assert.equal(pickStrike(777.2), 780); assert.equal(pickStrike(91.4), 91);
  const sym = optionSymbol('SPY', '2026-11-20', 'C', 780); assert.equal(sym, 'SPY-20261120-C-780');
  assert.deepStrictEqual(parseOptionSymbol(sym), { underlying: 'SPY', expiry: '2026-11-20', right: 'C', strike: 780 });
  assert.deepStrictEqual(parseOptionSymbol('XLE-20261120-P-92.5'), { underlying: 'XLE', expiry: '2026-11-20', right: 'P', strike: 92.5 });
  for (const bad of ['SPY', 'SPY-20261120-X-780', 'spy-20261120-C-780', null, undefined, 'BTC-USD']) assert.equal(isOptionSymbol(bad), false, String(bad));
  const inst = optionInstrument(SPY, '2026-11-20', 'P', 780);
  assert.equal(inst.class, 'option'); assert.equal(inst.units, 100); assert.equal(inst.shortable, false); assert.equal(inst.margin.initial, 1); assert.equal(inst.underlying, 'SPY');
});

test('סדרת האופציה: עולה עם הבסיס (קול) ויורדת (פוט), high≥low, ערך פנימי ביום הפקיעה, אין שורות אחריה', () => {
  const rows = trendRows(260); const last = rows[rows.length - 1][0];
  const call = optionInstrument(SPY, '2026-11-20', 'C', pickStrike(rows[rows.length - 1][4])), put = optionInstrument(SPY, '2026-11-20', 'P', pickStrike(rows[rows.length - 1][4]));
  const cr = optionRows(call, rows), pr = optionRows(put, rows);
  assert.equal(cr[cr.length - 1][0], last); assert.ok(cr.length > 100);
  for (const r of [...cr, ...pr]){ assert.ok(r[2] >= r[1] && r[2] >= r[4] && r[3] <= r[1] && r[3] <= r[4] && r[3] > 0, JSON.stringify(r)); }
  const up = rows.map((r) => [r[0], r[1] * 1.1, r[2] * 1.1, r[3] * 1.1, r[4] * 1.1, 1]);
  assert.ok(optionRows(call, up).pop()[4] > cr[cr.length - 1][4], 'קול יקר יותר כשהבסיס עולה'); assert.ok(optionRows(put, up).pop()[4] < pr[pr.length - 1][4], 'פוט זול יותר כשהבסיס עולה');
  const exp = [...rows, ['2026-11-20', 800, 805, 795, 803, 1], ['2026-11-23', 810, 812, 808, 811, 1]];
  const er = optionRows(optionInstrument(SPY, '2026-11-20', 'C', 780), exp); assert.equal(er[er.length - 1][0], '2026-11-20', 'אין שורות אחרי הפקיעה'); assert.ok(Math.abs(er[er.length - 1][4] - 23) < 0.01, 'ערך פנימי 803-780');
});

test('מועמדי אופציות: רק מגמה ב-ETF לא-ממונף, כמות לפי תקציב פרמיה, מגבלות פתוחות/חדשות, בלי כפילות בבסיס', () => {
  const rows = trendRows(260); const day = rows[rows.length - 1][0]; const price = rows[rows.length - 1][4];
  const cand = (symbol, o = {}) => ({ symbol, strategy: 'trend', side: 'long', price, score: 90, ...o });
  const base = { rowsBySym: { SPY: rows, QQQ: rows, TQQQ: rows, XLE: rows }, instrumentOf, day, equityUsd: 66000, opts: { premiumBudgetPct: 0.03, minDte: 30, maxOpen: 3, maxNewPerDay: 1, stopPct: 0.5 } };
  const r = optionCandidates({ ...base, candidates: [cand('SPY'), cand('TQQQ', { score: 99 }), cand('QQQ', { strategy: 'meanrev', score: 95 })], held: [] });
  assert.equal(r.candidates.length, 1); const c = r.candidates[0];
  assert.equal(c.fromOptions, true); assert.equal(c.class, 'option'); assert.equal(c.strategy, 'optlong'); assert.equal(c.side, 'long'); assert.ok(c.symbol.startsWith('SPY-20261120-C-'));
  assert.ok(c.qty >= 1 && c.qty * c.price * 100 <= 66000 * 0.06 + 1e-6, `qty ${c.qty} premium ${c.price}`); assert.equal(c.stop, Math.round(c.price * 0.5 * 1e4) / 1e4);
  assert.ok(r.instruments[0].class === 'option' && r.rows[c.symbol].length > 50 && c.evidence.delta > 0 && c.evidence.dte === 44);
  assert.equal(optionCandidates({ ...base, candidates: [cand('SPY', { side: 'short' })], held: [] }).candidates[0].symbol.includes('-P-'), true, 'שורט בבסיס → פוט');
  assert.equal(optionCandidates({ ...base, candidates: [cand('SPY')], held: ['SPY-20261120-C-780'] }).candidates.length, 0, 'כבר יש אופציה על SPY');
  assert.equal(optionCandidates({ ...base, candidates: [cand('SPY')], held: ['A-20261120-C-1', 'B-20261120-C-1', 'C-20261120-C-1'] }).candidates.length, 0, 'מקסימום פתוחות');
  assert.equal(optionCandidates({ ...base, candidates: [cand('SPY'), cand('XLE')], held: [], opts: { ...base.opts, maxNewPerDay: 2 } }).candidates.length, 2);
  assert.equal(optionCandidates({ ...base, equityUsd: 3000, candidates: [cand('SPY')], held: [] }).candidates.length, 0, 'חוזה אחד מעל 6% מההון → אין');
  const stale = optionCandidates({ ...base, rowsBySym: { SPY: rows.slice(0, -1) }, candidates: [cand('SPY')], held: [] }); assert.equal(stale.candidates.length, 0); assert.equal(stale.skipped.length, 1);
});

test('מרג\'ין ועמלות: פרמיה מלאה בלי מינוף, פקיעה נסגרת, עמלה 0.65$ לחוזה וספרד 2%', () => {
  const rows = trendRows(260); const px = rows[rows.length - 1][4]; const inst = optionInstrument(SPY, '2026-11-20', 'C', pickStrike(px)); registerInstruments([inst]);
  const orows = optionRows(inst, rows); const prem = orows[orows.length - 1][4]; const day = orows[orows.length - 1][0];
  assert.equal(commissionUsd(inst, 3, prem), 1.95); assert.equal(commissionUsd(inst, 1, prem), 1); assert.equal(slippageRate(inst), 0.02);
  const st = newAccount(66000, day); const f = fill(st, { symbol: inst.symbol, side: 'buy', qty: 2, price: prem, day, strategy: 'optlong', stop: prem * 0.5 }, inst);
  assert.ok(Math.abs(f.price / prem - 1.02) < 1e-3); assert.equal(f.feeUsd, 1.3);
  const v = valuation(st, () => prem, instrumentOf);
  assert.ok(Math.abs(v.equityUsd - (66000 - f.price * 200 - 1.3 + prem * 200)) < 0.05, 'השווי יורד רק בספרד ובעמלה'); assert.ok(v.leverage < 0.2);
  assert.ok(v.maintUsd > 0 && Math.abs(v.maintUsd - prem * 200) < 0.05, 'אין אשראי על אופציה: maint = שווי');
  assert.deepStrictEqual(expiringPositions(st, day).length, 0); assert.equal(expiringPositions(st, '2026-11-19')[0].dte, 1); assert.equal(expiringPositions(st, '2026-11-20')[0].expired, true);
});

test('סוכן מלא: בפרופיל האגרסיבי נוצרת פקודת אופציה על ETF במגמה, ממולאת ביום הבא, מוצגת בדוח ולא נשלחת לדמה של IBKR', async () => {
  seedPrices();
  const r1 = await call('/agent/run?secret=cron-secret-for-tests&date=2026-09-22&batch=12', { method: 'POST' });
  assert.equal(r1.j.phase, 'done', JSON.stringify(r1.j));
  const pend = JSON.parse(store.get('agent:pending')); const opt = pend.orders.find((o) => isOptionSymbol(o.symbol));
  assert.ok(opt, 'פקודת אופציה: ' + JSON.stringify(pend.orders.map((o) => o.symbol)));
  assert.equal(opt.class, 'option'); assert.equal(opt.side, 'buy'); assert.equal(opt.strategy, 'optlong'); assert.ok(opt.symbol.startsWith('GLD-'), opt.symbol); assert.ok(/-C-/.test(opt.symbol));
  const bp = await call('/agent/broker/pending?secret=cron-secret-for-tests'); assert.equal(bp.status, 200);
  const bo = bp.j.orders.find((o) => isOptionSymbol(o.symbol)); assert.ok(bo && bp.j.orders.some((o) => o.symbol === 'GLD'), 'הגשר מקבל גם את פקודת האופציה');
  assert.deepStrictEqual({ c: bo.inst.class, u: bo.inst.units, und: bo.inst.option.underlying, r: bo.inst.option.right }, { c: 'option', u: 100, und: 'GLD', r: 'C' }, 'inst מפורט לגשר לפתרון החוזה');
  for (const sym of new Set(AGENT_INSTRUMENTS.map(priceSymbolOf))){ const v = JSON.parse(store.get(`px:${sym}`)); const last = v.rows[v.rows.length - 1]; const o = last[4] * 1.002; v.rows.push([NEXT, o, o * 1.004, o * 0.996, o * 1.001, 2e6]); store.set(`px:${sym}`, JSON.stringify(v)); }
  const r2 = await call('/agent/run?secret=cron-secret-for-tests&date=2026-09-23&batch=12', { method: 'POST' });
  assert.equal(r2.j.phase, 'done', JSON.stringify(r2.j));
  const rep = (await call('/agent/report')).j; const pos = rep.positions.find((p) => isOptionSymbol(p.symbol));
  assert.ok(pos && pos.class === 'option' && pos.side === 'long' && pos.qty >= 1 && pos.units === 100, JSON.stringify(rep.positions.map((p) => p.symbol)));
  assert.ok(rep.equityUsd > 0 && rep.equityUsd < 200000 / 3.7 * 1.05 && rep.equityUsd > 200000 / 3.7 * 0.95, 'שווי סביר ' + rep.equityUsd);
  assert.ok(rep.journal.some((j) => j.kind === 'fill' && isOptionSymbol(j.symbol)), 'מילוי אופציה ביומן');
  const bp2 = await call('/agent/broker/pending?secret=cron-secret-for-tests'); assert.ok(![...bp2.j.sync].some((o) => isOptionSymbol(o.symbol)), 'סנכרון חד-פעמי לא כולל אופציות');
  const bal = await call('/agent/policy'); assert.equal(bal.j.profile, 'aggressive');
});

test('סוכן מלא: אופציה שפקעה או קרובה לפקיעה נסגרת אוטומטית (ערך פנימי / לפני פקיעה) ונרשמת ביומן', async () => {
  const st = JSON.parse(store.get('agent:state')); const symOld = Object.keys(st.positions).find(isOptionSymbol); assert.ok(symOld, 'יש אופציה פתוחה מהבדיקה הקודמת');
  const p = parseOptionSymbol(symOld); const pos = st.positions[symOld]; delete st.positions[symOld];
  const expired = optionSymbol(p.underlying, '2026-09-24', p.right, p.strike), near = optionSymbol(p.underlying, '2026-09-25', p.right, p.strike);
  st.positions[expired] = { ...pos }; st.positions[near] = { ...pos }; store.set('agent:state', JSON.stringify(st));
  for (const sym of new Set(AGENT_INSTRUMENTS.map(priceSymbolOf))){ const v = JSON.parse(store.get(`px:${sym}`)); const last = v.rows[v.rows.length - 1]; const o = last[4] * 1.002; v.rows.push(['2026-09-24', o, o * 1.004, o * 0.996, o * 1.001, 2e6]); store.set(`px:${sym}`, JSON.stringify(v)); }
  const r = await call('/agent/run?secret=cron-secret-for-tests&date=2026-09-24&batch=12', { method: 'POST' }); assert.equal(r.j.phase, 'done', JSON.stringify(r.j));
  const after = JSON.parse(store.get('agent:state')); assert.ok(!after.positions[expired] && !after.positions[near], 'שתיהן נסגרו');
  const exits = JSON.parse(store.get('agent:journal')).filter((j) => j.kind === 'option-exit');
  assert.equal(exits.length, 2, JSON.stringify(exits.map((e) => e.reason)));
  assert.ok(exits.some((e) => e.symbol === expired && /פקיעה 2026-09-24 \(ערך פנימי\)/.test(e.reason)) && exits.some((e) => e.symbol === near && /לפני פקיעה \(1 ימים\)/.test(e.reason)));
  const bp = await call('/agent/broker/pending?secret=cron-secret-for-tests'); const xs = bp.j.exits.filter((o) => isOptionSymbol(o.symbol));
  assert.equal(xs.length, 2, 'יציאות האופציה מועברות לגשר'); assert.ok(xs.every((o) => o.kind === 'option-exit' && o.side === 'sell' && o.inst.class === 'option'));
});

test('פרופיל מאוזן: אין אופציות בכלל', async () => {
  for (const k of [...store.keys()]) if (k.startsWith('agent:')) store.delete(k);
  seedPrices(); const set = await call('/agent/profile?secret=cron-secret-for-tests&profile=balanced', { method: 'POST' }); assert.equal(set.j.profile, 'balanced');
  const r = await call('/agent/run?secret=cron-secret-for-tests&date=2026-09-22&batch=12', { method: 'POST' }); assert.equal(r.j.phase, 'done', JSON.stringify(r.j));
  assert.ok(!JSON.parse(store.get('agent:pending')).orders.some((o) => isOptionSymbol(o.symbol)));
});
