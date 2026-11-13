#!/usr/bin/env node
// הכנת תשתית לדמו של המומנטום המשודרג (החלטת מאיר 13/11/2026: "במקביל אפשר להכין את תשתית הדמו — בלי להפעיל מסחר").
// קריאה בלבד, בלי מפתחות ובלי פקודות: אילו מ-50 המועמדים של XSRAP נסחרים ב-Bybit בספוט מול USDT (בבורסה ובשרת הדמו),
// מה המחזור היומי (נזילות), גודל פקודה מינימלי, ומה חסר לעומת היקום של המחקר (Coinbase). רץ על השרת (Bybit חוסמת שרתים בארה"ב)
// דרך bybit-bot.yml → probexs. אין כאן שום בוט ושום פקודה.
const COINS = ['BTC', 'ETH', 'LTC', 'BCH', 'LINK', 'XLM', 'ETC', 'ADA', 'SOL', 'DOGE', 'AVAX', 'DOT', 'UNI', 'ATOM', 'XRP', 'AAVE', 'FIL', 'ALGO', 'XTZ', 'ZEC',
  'ICP', 'GRT', 'SUSHI', 'CRV', 'COMP', 'SNX', 'BAT', 'ZRX', 'MKR', 'YFI', 'UMA', 'SHIB', 'MANA', 'SAND', 'AXS', 'CHZ', 'OMG', 'REP', 'DASH', 'EOS', 'ZEN', 'KNC', 'BAND', 'NMR', 'LRC', 'ENJ', '1INCH', 'MATIC', 'BNT', 'STORJ'];
const get = async (base, p) => { try { const r = await fetch(base + p); if (!r.ok) return { err: `HTTP ${r.status}` }; return await r.json(); } catch (e) { return { err: e.message }; } };
async function spot(base){
  const list = []; let cursor = '';
  do { const j = await get(base, `/v5/market/instruments-info?category=spot&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); if (j.err) return { err: j.err }; list.push(...(j.result?.list || [])); cursor = j.result?.nextPageCursor || ''; } while (cursor);
  return { list };
}
const live = await spot('https://api.bybit.com'), demo = await spot('https://api-demo.bybit.com');
console.log(`ספוט בבורסה: ${live.err || live.list.length + ' זוגות'} · ספוט בשרת הדמו: ${demo.err || demo.list.length + ' זוגות'}`);
const tick = await get('https://api.bybit.com', '/v5/market/tickers?category=spot'); const T = new Map((tick.result?.list || []).map((x) => [x.symbol, x]));
const find = (L, c) => (L.list || []).find((x) => x.symbol === `${c}USDT` || (x.baseCoin === c && x.quoteCoin === 'USDT'));
const rows = [], missing = [];
for (const c of COINS){
  const l = find(live, c), d = find(demo, c), t = l ? T.get(l.symbol) : null;
  if (!l) { missing.push(c); continue; }
  rows.push({ c, sym: l.symbol, status: l.status, demo: d ? d.status : '—', turnover: Number(t?.turnover24h || 0), minAmt: l.lotSizeFilter?.minOrderAmt, minQty: l.lotSizeFilter?.minOrderQty });
}
rows.sort((a, b) => b.turnover - a.turnover);
console.log('\n| מטבע | זוג | מצב בבורסה | בדמו | מחזור 24 שעות ($) | פקודה מינימלית ($) |\n|---|---|---|---|---|---|');
for (const r of rows) console.log(`| ${r.c} | ${r.sym} | ${r.status} | ${r.demo} | ${Math.round(r.turnover).toLocaleString('en-US')} | ${r.minAmt ?? '—'} |`);
console.log(`\nנסחרים בספוט מול USDT: ${rows.length}/${COINS.length} · בדמו: ${rows.filter((r) => r.demo !== '—').length}`);
console.log(`לא נסחרים ב-Bybit בספוט: ${missing.join(', ') || '—'}`);
const thin = rows.filter((r) => r.turnover < 1e6).map((r) => r.c);
console.log(`מחזור יומי מתחת למיליון דולר (החלקה גבוהה): ${thin.join(', ') || '—'}`);

// ---- חלק ב' (בקשת מאיר 13/11, משימת ההגנות): תאריך הרישום בספוט של Bybit (הנר החודשי/היומי הראשון), ועומק ספר הפקודות ----
// לא ניתן לשחזר מטבעות שהוסרו מהמסחר (Bybit לא מחזירה אותם) — מגבלה מתועדת.
const listing = {}, book = {};
for (const r of rows){
  const m = await get('https://api.bybit.com', `/v5/market/kline?category=spot&symbol=${r.sym}&interval=M&start=${Date.UTC(2018, 0, 1)}&limit=200`);
  const months = (m.result?.list || []).map((x) => Number(x[0])).filter(Number.isFinite);
  if (months.length){ const m0 = Math.min(...months), dd = await get('https://api.bybit.com', `/v5/market/kline?category=spot&symbol=${r.sym}&interval=D&start=${m0}&end=${m0 + 62 * 86400e3}&limit=100`);
    const ds = (dd.result?.list || []).map((x) => Number(x[0])).filter(Number.isFinite); listing[r.c] = new Date(ds.length ? Math.min(...ds) : m0).toISOString().slice(0, 10); }
  const ob = await get('https://api.bybit.com', `/v5/market/orderbook?category=spot&symbol=${r.sym}&limit=200`);
  const a = (ob.result?.a || []).map(([p, q]) => [Number(p), Number(q)]), b = (ob.result?.b || []).map(([p, q]) => [Number(p), Number(q)]);
  if (a.length && b.length){
    const mid = (a[0][0] + b[0][0]) / 2, spreadBps = (a[0][0] - b[0][0]) / mid * 1e4;
    const depth = (side, pctx) => side.filter(([p]) => Math.abs(p / mid - 1) <= pctx).reduce((s, [p, q]) => s + p * q, 0);
    const walk = (usd) => { let left = usd, cost = 0, qty = 0; for (const [p, q] of a){ const take = Math.min(left, p * q); cost += take; qty += take / p; left -= take; if (left <= 1e-9) break; } return left > 1e-9 ? null : ((cost / qty) / mid - 1) * 1e4; };
    book[r.c] = { spreadBps: Math.round(spreadBps * 10) / 10, depth05: Math.round(depth(a, 0.005) + depth(b, 0.005)), depth1: Math.round(depth(a, 0.01) + depth(b, 0.01)), buy1k: walk(1000), buy5k: walk(5000), buy25k: walk(25000) };
  }
  await new Promise((res) => setTimeout(res, 120));
}
console.log('\n| מטבע | נרשם בספוט | מרווח (נק׳ בסיס) | עומק ±0.5% ($) | עומק ±1% ($) | קנייה 1K$ (נק׳ בסיס מהאמצע) | 5K$ | 25K$ |\n|---|---|---|---|---|---|---|---|');
const f = (x) => (x == null ? '—' : x.toFixed(1));
for (const r of rows){ const o = book[r.c] || {}; console.log(`| ${r.c} | ${listing[r.c] || '—'} | ${f(o.spreadBps)} | ${(o.depth05 ?? 0).toLocaleString('en-US')} | ${(o.depth1 ?? 0).toLocaleString('en-US')} | ${f(o.buy1k)} | ${f(o.buy5k)} | ${f(o.buy25k)} |`); }
console.log('\nJSON:' + JSON.stringify({ at: new Date().toISOString(), listing, book, missing }));
