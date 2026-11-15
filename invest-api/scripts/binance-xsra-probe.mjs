#!/usr/bin/env node
// בקשת מאיר (15/11/2026): לבדוק את Binance כמו שבדקנו את Bybit — קריאה ציבורית בלבד, בלי מפתחות ובלי פקודות.
// אילו מ-50 המועמדים של XSRAP נסחרים בספוט מול USDT, מאיזה תאריך (הנר היומי הראשון), ועלות קנייה לפי ספר הפקודות (1K$/5K$/25K$).
// מטבע ששמו הוחלף (למשל MATIC→POL) נחשב חסר — שמרני, כמו ב-Bybit. רץ על השרת (Binance חוסמת שרתים בארה"ב) דרך bybit-bot.yml → probebin.
// הפלט: אותו מבנה כמו invest/docs/research/xs-protect/bybit-probe.json, כדי שאותם סקריפטים ירוצו עליו.
const COINS = ['BTC', 'ETH', 'LTC', 'BCH', 'LINK', 'XLM', 'ETC', 'ADA', 'SOL', 'DOGE', 'AVAX', 'DOT', 'UNI', 'ATOM', 'XRP', 'AAVE', 'FIL', 'ALGO', 'XTZ', 'ZEC',
  'ICP', 'GRT', 'SUSHI', 'CRV', 'COMP', 'SNX', 'BAT', 'ZRX', 'MKR', 'YFI', 'UMA', 'SHIB', 'MANA', 'SAND', 'AXS', 'CHZ', 'OMG', 'REP', 'DASH', 'EOS', 'ZEN', 'KNC', 'BAND', 'NMR', 'LRC', 'ENJ', '1INCH', 'MATIC', 'BNT', 'STORJ'];
const B = 'https://api.binance.com';
const get = async (p) => { try { const r = await fetch(B + p); if (!r.ok) return { err: `HTTP ${r.status}` }; return await r.json(); } catch (e) { return { err: e.message }; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const info = await get('/api/v3/exchangeInfo?permissions=SPOT');
if (info.err) { console.log(`Binance: ${info.err}`); process.exit(0); }
const sym = new Map((info.symbols || []).filter((s) => s.quoteAsset === 'USDT' && s.status === 'TRADING').map((s) => [s.baseAsset, s]));
console.log(`ספוט מול USDT ב-Binance (במסחר): ${sym.size} זוגות`);
const rows = [], missing = [], listing = {}, book = {};
for (const c of COINS){
  const s = sym.get(c); if (!s){ missing.push(c); continue; }
  const k = await get(`/api/v3/klines?symbol=${s.symbol}&interval=1d&startTime=0&limit=1`);
  if (Array.isArray(k) && k.length) listing[c] = new Date(Number(k[0][0])).toISOString().slice(0, 10);
  const t = await get(`/api/v3/ticker/24hr?symbol=${s.symbol}`);
  const ob = await get(`/api/v3/depth?symbol=${s.symbol}&limit=1000`);
  const a = (ob.asks || []).map(([p, q]) => [Number(p), Number(q)]), b = (ob.bids || []).map(([p, q]) => [Number(p), Number(q)]);
  if (a.length && b.length){
    const mid = (a[0][0] + b[0][0]) / 2, spreadBps = (a[0][0] - b[0][0]) / mid * 1e4;
    const depth = (side, x) => side.filter(([p]) => Math.abs(p / mid - 1) <= x).reduce((acc, [p, q]) => acc + p * q, 0);
    const walk = (usd) => { let left = usd, cost = 0, qty = 0; for (const [p, q] of a){ const take = Math.min(left, p * q); cost += take; qty += take / p; left -= take; if (left <= 1e-9) break; }
      return left > 1e-9 ? null : Math.round((cost / qty / mid - 1) * 1e4 * 10) / 10; };
    book[c] = { spreadBps: Math.round(spreadBps * 10) / 10, depth05: Math.round(depth(a, 0.005) + depth(b, 0.005)), depth1: Math.round(depth(a, 0.01) + depth(b, 0.01)), buy1k: walk(1000), buy5k: walk(5000), buy25k: walk(25000) };
  }
  rows.push({ c, sym: s.symbol, turnover: Number(t.quoteVolume || 0) });
  await sleep(150);
}
rows.sort((x, y) => y.turnover - x.turnover);
const f = (x) => (x == null ? '—' : x.toFixed(1));
console.log('\n| מטבע | זוג | נרשם | מחזור 24 שעות ($) | מרווח (נק׳ בסיס) | קנייה 1K$ | 5K$ | 25K$ |\n|---|---|---|---|---|---|---|---|');
for (const r of rows){ const o = book[r.c] || {}; console.log(`| ${r.c} | ${r.sym} | ${listing[r.c] || '—'} | ${Math.round(r.turnover).toLocaleString('en-US')} | ${f(o.spreadBps)} | ${f(o.buy1k)} | ${f(o.buy5k)} | ${f(o.buy25k)} |`); }
console.log(`\nנסחרים בספוט מול USDT: ${rows.length}/${COINS.length} · חסרים: ${missing.join(', ') || '—'}`);
console.log('\nJSON:' + JSON.stringify({ venue: 'binance', at: new Date().toISOString(), listing, book, missing }));
