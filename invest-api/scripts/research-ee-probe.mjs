#!/usr/bin/env node
// מחקר "יתרון מאירועים" — שער נתונים (קריאה בלבד): האם יש היסטוריה חינמית ואמינה של (1) תאריכי דוחות + הפתעה, (2) חדשות לפי מניה.
// מדפיס סיכומים בלבד; לא שומר נתונים בריפו.
const K = process.env.ALPACA_KEY_ID, S = process.env.ALPACA_SECRET_KEY;
const H = { 'APCA-API-KEY-ID': K || '', 'APCA-API-SECRET-KEY': S || '' };
const UA = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json, text/plain, */*' };
const out = {};
async function j(u, h){ try { const r = await fetch(u, { headers: h }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t.slice(0, 300); } return { s: r.status, b }; } catch (e){ return { s: 'ERR', b: e.message }; } }
// 1. לוח הדוחות של נאסד"ק לפי תאריך (כולל EPS בפועל מול תחזית) — בודקים 2018, 2021, 2024
for (const d of ['2018-04-26', '2021-07-27', '2024-10-30']){
  const r = await j(`https://api.nasdaq.com/api/calendar/earnings?date=${d}`, UA);
  const rows = r.b?.data?.rows || [];
  out['nasdaq_' + d] = { status: r.s, n: rows.length, sample: rows.slice(0, 3).map((x) => ({ s: x.symbol, time: x.time, eps: x.eps, f: x.epsForecast, sur: x.surprise })) };
}
// 2. חדשות Alpaca (Benzinga) — היסטוריה ושעות
for (const [sym, st, en] of [['AAPL', '2018-05-01', '2018-05-03'], ['NVDA', '2021-08-18', '2021-08-20'], ['MSFT', '2024-10-30', '2024-11-01']]){
  const r = await j(`https://data.alpaca.markets/v1beta1/news?symbols=${sym}&start=${st}T00:00:00Z&end=${en}T00:00:00Z&limit=50`, H);
  const n = r.b?.news || [];
  out['news_' + sym + '_' + st] = { status: r.s, n: n.length, sample: n.slice(0, 4).map((x) => ({ t: x.created_at, h: x.headline.slice(0, 90), syms: x.symbols.length })) };
}
// 3. Alpha Vantage EARNINGS (אם יש מפתח) — לא חובה
out.alphaVantageKey = !!process.env.ALPHAVANTAGE_KEY;
console.log(JSON.stringify(out, null, 1));
