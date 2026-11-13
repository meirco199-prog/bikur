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
