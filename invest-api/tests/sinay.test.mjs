// ניסוי הדמה "ריזיקות עקרונות" (Issue #189): אימות המצב, קליטה עם hash (בלי כתיבה כפולה ל-KV), דוח 200,000$ ונתיבי HTTP.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateState, ingestSinay, sinayReport, unrealized, realizedCurve, SINAY_KEY, SLOT_USD, ACCOUNT_USD, FEE, MAX_BYTES } from '../lib/sinay.js';
import { DB } from '../lib/db.js';
import worker from '../worker.js';

const hist = (hi, lo, n = 48) => Array.from({ length: n }, () => [hi, lo]);
const coin = (px, extra = {}) => ({ last_t: '2026-11-01T18:30:00Z', hist: hist(px * 1.002, px * 0.998), ema: px, setup: null, pos: null, ...extra });
function baseState(){
  return { version: 1, start: '2026-11-01T18:30:00Z', trades: [], coins: { BTC: coin(77863.2), ETH: coin(2264.7), LTC: coin(55.75), BCH: coin(283.37) } };
}
const trade = (n, sym, net, close, extra = {}) => ({ n, sym, side: 'short', open: '2026-11-02T00:00:00Z', close, fills: 2, avg: 100, exit: 99, why: net > 0 ? 'יעד EMA50' : 'סטופ', net_pct: net, usd: net * 100, ...extra });
const clone = (x) => JSON.parse(JSON.stringify(x));

test('validateState: מקבל את המצב בפורמט של Issue #189 ומחזיר עותק נקי', () => {
  const s = baseState();
  s.coins.BTC.unknownField = 'x'; s.extra = { a: 1 };
  const v = validateState(s);
  assert.equal(v.version, 1);
  assert.deepEqual(Object.keys(v.coins), ['BTC', 'ETH', 'LTC', 'BCH']);
  assert.equal(v.coins.BTC.unknownField, undefined, 'שדות לא מוכרים לא נשמרים');
  assert.equal(v.extra, undefined);
  assert.equal(v.coins.BTC.mark, null, 'mark חסר (הריצה הראשונה) → null');
});

test('validateState: דוחה סטיות מהסכימה', () => {
  const bad = [
    (s) => { s.version = 2; },
    (s) => { s.start = 'yesterday'; },
    (s) => { s.coins.DOGE = coin(1); },
    (s) => { s.coins = {}; },
    (s) => { s.trades = [trade(1, 'XRP', 1, '2026-11-02T06:00:00Z')]; },
    (s) => { s.trades = [trade(1, 'BTC', 1, '2026-11-02T06:00:00Z', { side: 'flat' })]; },
    (s) => { s.trades = [trade(1, 'BTC', 1, '2026-11-02T06:00:00Z', { fills: 4 })]; },
    (s) => { s.trades = [trade(1, 'BTC', 1, '2026-11-02T06:00:00Z', { net_pct: 'NaN' })]; },
    (s) => { s.trades = [trade(1, 'BTC', 1, '2026-11-02T06:00:00Z', { why: '<script>alert(1)</script>' })]; },
    (s) => { s.trades = [trade(1, 'BTC', 1, '2026-11-01T00:00:00Z')]; }, // סגירה לפני פתיחה
    (s) => { s.coins.ETH.hist = [[1, 2]]; }, // שפל מעל שיא
    (s) => { s.coins.ETH.pos = { side: 'short', sg: -1, lv: [1, 2, 3], fills: [], stop: 4, start: '2026-11-01T18:30:00Z', age: 0, ref: 1 }; }, // sg לא תואם
    (s) => { s.coins.ETH.pos = { side: 'long', sg: -1, lv: [1, 2], fills: [], stop: 4, start: '2026-11-01T18:30:00Z', age: 0, ref: 1 }; },
    (s) => { s.coins.ETH.mark = ['2026-11-01T18:30:00Z', -5]; },
    (s) => { s.coins.ETH.setup = { hi: 1, lo: 2, age: 0 }; },
  ];
  for (const [i, mut] of bad.entries()){ const s = baseState(); mut(s); assert.throws(() => validateState(s), (e) => e.status === 400, `מקרה ${i}`); }
  assert.throws(() => validateState(null));
  assert.throws(() => validateState([]));
});

test('unrealized: שורט ולונג על משבצת 50,000$, שלישים, עמלה 0.05% לכל צד', () => {
  const third = SLOT_USD / 3;
  // שורט, שליש אחד ב-100, המחיר ירד ל-99 → רווח 1% על שליש פחות עמלות כניסה ויציאה
  const s = unrealized({ side: 'short', fills: [100] }, 99);
  assert.ok(Math.abs(s - (third * 0.01 - third * FEE - third * 0.99 * FEE)) < 1e-9);
  // לונג, שני שלישים, המחיר עלה 2% מכל מילוי
  const l = unrealized({ side: 'long', fills: [100, 50] }, 102);
  const exp = third * (102 / 100 - 1) + third * (102 / 50 - 1) - 2 * third * FEE - third * (102 / 100) * FEE - third * (102 / 50) * FEE;
  assert.ok(Math.abs(l - exp) < 1e-9);
  assert.equal(unrealized({ side: 'long', fills: [100] }, null), null, 'בלי mark — לא ממציאים מספר');
  assert.equal(unrealized({ side: 'long', fills: [] }, 100), null);
});

test('realizedCurve: נקודת התחלה + כל סגירה, ירידה מקסימלית מהשיא', () => {
  const trades = [trade(1, 'BTC', 2, '2026-11-02T06:00:00Z'), trade(2, 'ETH', -1, '2026-11-03T06:00:00Z'), trade(3, 'LTC', -1, '2026-11-04T06:00:00Z'), trade(4, 'BCH', 0.5, '2026-11-05T06:00:00Z')];
  const c = realizedCurve('2026-11-01T18:30:00Z', trades);
  assert.equal(c.points.length, 5);
  assert.deepEqual(c.points.map((p) => p.equity), [200000, 201000, 200500, 200000, 200250]);
  assert.equal(c.maxDrawdownUsd, -1000);
  assert.equal(c.maxDrawdown, -0.005); // 1,000 / 201,000 ≈ 0.4975%
});

test('sinayReport: בלי מצב → ממתין לסנכרון, 200,000$ בלי מספרים מומצאים', () => {
  const r = sinayReport(null);
  assert.equal(r.waiting, true);
  assert.equal(r.equityUsd, ACCOUNT_USD);
  assert.deepEqual(r.trades, []);
  assert.match(r.disclaimer, /סימולציה בלבד/);
  assert.match(r.issueUrl, /issues\/189$/);
});

test('sinayReport: P&L מוגדל ל-50,000$ למטבע, שווי כולל לא ממומש, סטטיסטיקות, setups ופוזיציות', () => {
  const s = baseState();
  s.trades = [trade(1, 'BTC', 1.2, '2026-11-02T06:00:00Z'), trade(2, 'ETH', -0.8, '2026-11-03T06:00:00Z'), trade(3, 'BTC', 0.4, '2026-11-04T06:00:00Z')];
  s.coins.ETH.pos = { side: 'short', sg: 1, lv: [2310, 2320, 2330], fills: [2310, 2320], stop: 2362, start: '2026-11-04T10:00:00Z', age: 5, ref: 2264 };
  s.coins.ETH.mark = ['2026-11-04T12:00:00Z', 2300];
  s.coins.LTC.setup = { hi: 56, lo: 55, age: 3 };
  s.coins.LTC.mark = ['2026-11-04T12:00:00Z', 55.5];
  const stored = { hash: 'x', receivedAt: '2026-11-04T12:05:00Z', state: validateState(s) };
  const r = sinayReport(stored, { now: new Date('2026-11-04T13:00:00Z') });
  assert.equal(r.realizedUsd, 400); // (1.2 − 0.8 + 0.4)% × 50,000
  const u = unrealized(s.coins.ETH.pos, 2300);
  assert.equal(r.unrealizedUsd, Math.round(u * 100) / 100);
  assert.equal(r.equityUsd, Math.round((ACCOUNT_USD + 400 + u) * 100) / 100);
  assert.equal(r.stats.trades, 3); assert.equal(r.stats.wins, 2); assert.equal(r.stats.losses, 1);
  assert.equal(r.stats.winRate, 0.6667);
  assert.equal(r.stats.avgWinUsd, 400); assert.equal(r.stats.avgLossUsd, -400);
  assert.deepEqual(r.trades.map((t) => t.n), [3, 2, 1], 'יומן — החדשה ראשונה');
  assert.equal(r.trades[0].usdScaled, 200);
  assert.equal(r.equityCurve.length, 4);
  assert.equal(r.perCoin.BTC.trades, 2); assert.equal(r.perCoin.BTC.pnlUsd, 800);
  assert.equal(r.openPositions.length, 1);
  const op = r.openPositions[0];
  assert.equal(op.sym, 'ETH'); assert.equal(op.filledThirds, 2); assert.equal(op.avg, 2315); assert.equal(op.mark, 2300);
  assert.equal(r.setups.length, 1);
  const st = r.setups[0];
  assert.equal(st.sym, 'LTC');
  assert.equal(st.nextShort, Math.round(56 * 1.024 * 1e4) / 1e4); // אמצע הטווח הטבעי של LTC = 2.4%
  assert.equal(st.nextLong, Math.round(55 * 0.976 * 1e4) / 1e4);
  assert.equal(r.lastUpdate, '2026-11-04T12:00:00Z');
  assert.equal(r.stale, false);
  assert.equal(sinayReport(stored, { now: new Date('2026-11-05T12:00:00Z') }).stale, true, 'יותר מ-13 שעות בלי עדכון = ישן');
});

test('sinayReport: פוזיציה פתוחה בלי mark (לפני הריצה הבאה) — לא נספרת ומסומנת בהערה', () => {
  const s = baseState();
  s.coins.BTC.pos = { side: 'long', sg: -1, lv: [76600, 76300, 76000], fills: [76600], stop: 75000, start: '2026-11-01T18:30:00Z', age: 1, ref: 77863 };
  const r = sinayReport({ state: validateState(s) });
  assert.equal(r.unrealizedUsd, 0);
  assert.equal(r.equityUsd, ACCOUNT_USD);
  assert.equal(r.openPositions[0].unrealizedUsd, null);
  assert.ok(r.notes.some((n) => n.includes('BTC')));
});

test('ingestSinay: כותב רק כשה-hash השתנה; גודל מוגבל; גוף לא תקין נדחה', async () => {
  let puts = 0;
  const db = new DB(null); const put0 = db.put.bind(db); db.put = async (...a) => { puts++; return put0(...a); };
  const s = baseState();
  const a = await ingestSinay(db, { state: s, commentId: 6562346570, commentUpdatedAt: '2026-11-01T18:51:38Z' });
  assert.equal(a.changed, true); assert.equal(puts, 1);
  const b = await ingestSinay(db, { state: clone(s), commentId: 6562346570, commentUpdatedAt: '2026-11-01T19:51:38Z' });
  assert.equal(b.changed, false); assert.equal(puts, 1, 'אותו מצב → אין כתיבה ל-KV');
  const s2 = clone(s); s2.coins.BTC.mark = ['2026-11-02T00:30:00Z', 78000];
  const c = await ingestSinay(db, { state: s2 });
  assert.equal(c.changed, true); assert.equal(puts, 2);
  assert.equal((await db.get(SINAY_KEY)).state.coins.BTC.mark[1], 78000);
  await assert.rejects(ingestSinay(db, { state: s }, { bytes: MAX_BYTES + 1 }), (e) => e.status === 413);
  await assert.rejects(ingestSinay(db, {}), (e) => e.status === 400);
  await assert.rejects(ingestSinay(db, { state: s, commentId: 'abc' }), (e) => e.status === 400);
  assert.equal(puts, 2);
});

function mkEnv(){
  const store = new Map(); let puts = 0;
  return { store, puts: () => puts, env: { INVEST: { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { puts++; store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }) }, APP_TOKEN: 'secret', CRON_SECRET: 's3' } };
}

test('HTTP: GET /sinay ציבורי; POST /sinay/ingest דורש סוד ולא כותב פעמיים את אותו מצב', async () => {
  const { env, puts, store } = mkEnv();
  const req = (path, opts = {}) => worker.fetch(new Request('https://api.test' + path, { method: opts.method || 'GET', headers: { 'CF-Connecting-IP': '7.7.7.7', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined }), env, {});
  const w = await (await req('/sinay')).json();
  assert.equal(w.waiting, true);
  const body = { state: baseState(), commentId: 6562346570 };
  assert.equal((await req('/sinay/ingest', { method: 'POST', body })).status, 401);
  assert.equal((await req('/sinay/ingest?secret=wrong', { method: 'POST', body })).status, 401);
  const bad = clone(body); bad.state.version = 9;
  assert.equal((await req('/sinay/ingest?secret=s3', { method: 'POST', body: bad })).status, 400);
  const p0 = puts();
  const r1 = await (await req('/sinay/ingest?secret=s3', { method: 'POST', body })).json();
  assert.equal(r1.changed, true);
  assert.equal(puts() - p0, 1);
  const r2 = await (await req('/sinay/ingest?secret=s3', { method: 'POST', body })).json();
  assert.equal(r2.changed, false);
  assert.equal(puts() - p0, 1, 'ריצה חוזרת של ה-workflow בלי שינוי → אפס כתיבות');
  assert.ok(store.has(SINAY_KEY));
  const rep = await (await req('/sinay')).json();
  assert.equal(rep.waiting, undefined);
  assert.equal(rep.equityUsd, ACCOUNT_USD);
  assert.equal(rep.stats.trades, 0);
  assert.equal((await req('/sinay/report')).status, 200);
  assert.equal((await req('/sinay/nope')).status, 404);
  // הרצה ידנית של המנוע החי — אותה הגנה כמו ingest (סוד ה-cron או טוקן האפליקציה); בלי אימות = 401 בלי שום כתיבה
  const p1 = puts();
  assert.equal((await req('/sinay/run', { method: 'POST' })).status, 401);
  assert.equal((await req('/sinay/run?secret=wrong', { method: 'POST' })).status, 401);
  assert.equal(puts() - p1, 0);
});

test('sinay-sync: רק תגובת STATE של בעל הריפו מתקבלת; חילוץ בלוק ה-JSON', async () => {
  const { pickStateComment, extractStateJson, isTrustedStateComment, MARKER } = await import('../scripts/sinay-sync.mjs');
  const body = `${MARKER}\n### STATE\n\`\`\`json\n${JSON.stringify(baseState())}\n\`\`\`\n\n---\n_Generated by Claude Code_`;
  const owner = 'meirco199-prog';
  const good = { id: 1, body, user: { login: owner, type: 'User' }, author_association: 'OWNER', created_at: '2026-11-01T18:51:38Z', updated_at: '2026-11-02T00:51:38Z' };
  const comments = [
    { ...good, id: 2, user: { login: 'stranger', type: 'User' }, author_association: 'NONE', updated_at: '2026-11-03T00:00:00Z' }, // זר שמעתיק את הסמן
    { ...good, id: 3, user: { login: owner, type: 'User' }, author_association: 'CONTRIBUTOR', updated_at: '2026-11-03T00:00:00Z' },
    { ...good, id: 4, body: '<!-- independent-review-sinay -->\nביקורת', updated_at: '2026-11-03T00:00:00Z' },
    { ...good, id: 5, user: { login: owner, type: 'Bot' }, updated_at: '2026-11-03T00:00:00Z' },
    good,
  ];
  assert.equal(pickStateComment(comments, owner).id, 1);
  assert.equal(pickStateComment(comments.slice(0, 4), owner), null);
  assert.equal(isTrustedStateComment(good, 'someone-else'), false);
  const st = extractStateJson(good.body);
  assert.doesNotThrow(() => validateState(st));
  assert.throws(() => extractStateJson(`${MARKER}\nאין בלוק`));
});
