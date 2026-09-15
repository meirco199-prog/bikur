// שרת API מקומי לבדיקות E2E: עוטף את ה-Worker עם ספקים מדומים ו-KV בזיכרון, ומריץ cron מלא בעלייה.
import http from 'node:http';
import { installMockFetch } from '../mock-providers.mjs';
import worker, { cronStep } from '../../worker.js';
import { DB } from '../../lib/db.js';
import { Budget } from '../../lib/budget.js';
installMockFetch();
const store = new Map();
const kv = { get: async (k) => (store.has(k) ? JSON.parse(store.get(k)) : null), put: async (k, v) => { store.set(k, v); }, delete: async (k) => store.delete(k), list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }) };
const env = { INVEST: kv, FINNHUB_KEY: 'x', FRED_KEY: 'x', APP_TOKEN: 'secret', CRON_BATCH: '300', STOOQ_ENABLED: '1', TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: 'c' };
const realFetch = globalThis.fetch;
if (process.env.SEED !== '0'){
  const db = new DB(kv); const ctx = { env, db, budget: new Budget(db) };
  await db.put('user:watchlist', [{ symbol: 'NVDA', addedAt: '2026-09-01', note: 'בדיקה' }, { symbol: 'AAPL', addedAt: '2026-09-01' }]);
  const r = await cronStep(ctx, { batch: 300 }); console.log('seeded', r.done, 'finalized', r.finalized);
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
