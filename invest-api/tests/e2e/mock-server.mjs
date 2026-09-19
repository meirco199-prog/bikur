// שרת API מקומי לבדיקות E2E: עוטף את ה-Worker עם ספקים מדומים ו-KV בזיכרון, ומריץ cron מלא בעלייה.
import http from 'node:http';
import { installMockFetch } from '../mock-providers.mjs';
import worker, { cronStep } from '../../worker.js';
import { DB } from '../../lib/db.js';
import { Budget } from '../../lib/budget.js';
installMockFetch();
const store = new Map();
const kv = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => store.delete(k), list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }) };
const env = { INVEST: kv, FINNHUB_KEY: 'x', FRED_KEY: 'x', APP_TOKEN: 'secret', AUTO_ANY_TIME: '1', RATE_LIMIT_OFF: '1', CRON_BATCH: '300', STOOQ_ENABLED: '1', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' };
const realFetch = globalThis.fetch;
if (process.env.SEED !== '0'){
  const db = new DB(kv); const ctx = { env, db, budget: new Budget(db) };
  await db.put('user:watchlist', [{ symbol: 'NVDA', addedAt: '2026-09-01', note: 'בדיקה' }, { symbol: 'AAPL', addedAt: '2026-09-01' }]);
  const r = await cronStep(ctx, { batch: 300 }); console.log('seeded', r.done, 'finalized', r.finalized);
  const { runShadow } = await import('../../lib/shadow.js'); console.log('shadow', JSON.stringify((await runShadow(ctx)).agreement));
  const { runAggressive, executeAggressive } = await import('../../lib/aggressive.js'); console.log('aggressive', JSON.stringify((await runAggressive(ctx)).totalIls), 'exec', JSON.stringify((await executeAggressive(ctx)).filled?.length));
  // מסלולי השוואה (regB/regC/אגרסיבי B): החלטה + מחירי 09:40 מדומים (קרוב לסגירה) + מילוי, כדי שיהיו נתונים למסך ההשוואה
  const { runTracksDecide, runTracksFill } = await import('../../lib/tracks.js');
  const decideDay = await db.get('idx:snapdays').then((d) => d[d.length - 1]);
  const rankForEntry = await db.get(`rank:${decideDay}`);
  if (rankForEntry?.table?.length){
    await db.put(`entry940:${decideDay}`, { day: decideDay, count: rankForEntry.table.length, at: '09:40 ET', source: 'seed', prices: Object.fromEntries(rankForEntry.table.filter((x) => x.price > 0).map((x) => [x.symbol, x.price * 1.001])) });
    const dTracks = await runTracksDecide(ctx, { day: decideDay });
    // decidedAt נרשם לפי השעון האמיתי; preflight חוסם מילוי שההחלטה עליו נוצרה אחרי 09:40 ניו יורק של יום המילוי
    // (engine/session.js decidedBeforeFillWindow) — כדי שעליית השרת לא תיכשל בתלות בשעה האמיתית שבה היא רצה,
    // מתקנים כאן את decidedAt לזמן מוקדם באותו יום בדוי, בדיוק כמו שהיה נראה decidedAt של ריצה לילית תקינה.
    for (const id of ['regB', 'regC', 'aggrB']){ const p = await db.get(`track:${id}:pending`); if (p){ p.decidedAt = new Date(decideDay + 'T05:00:00.000Z').toISOString(); await db.put(`track:${id}:pending`, p); } }
    const fTracks = await runTracksFill(ctx, { day: decideDay });
    console.log('tracks decide', JSON.stringify(Object.fromEntries(Object.entries(dTracks.tracks).map(([k, v]) => [k, v.orders ?? v]))), 'fill', JSON.stringify(Object.fromEntries(Object.entries(fTracks.tracks).map(([k, v]) => [k, v.filled ?? v]))));
  }
  // snapshot של אתמול (לצורך "מה השתנה") — מעתיקים עם ציון שונה
  const days = await db.get('idx:snapdays'); const day = days[0]; const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  for (const k of await db.list(`snap:${day}:`)){ const s = await db.get(k); await db.put(`snap:${y}:${s.symbol}`, { ...s, date: y, score: Math.max(0, (s.score || 50) - 12), signal: 'HOLD' }); }
  await db.put('idx:snapdays', [y, day]);
}
const port = +process.env.PORT || 8787;
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const r = await worker.fetch(new Request('http://localhost' + req.url, { method: req.method, headers: { ...req.headers, 'CF-Connecting-IP': '127.0.0.1' }, body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body }), env, { waitUntil(){} });
  res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log('mock api on', port));
