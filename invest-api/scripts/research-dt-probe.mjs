#!/usr/bin/env node
// בדיקת חיבור ל-Alpaca (קריאה בלבד, נתוני שוק). מדפיס רק סיכומים — לא שומר נתונים בריפו (תנאי הרישיון).
const K = process.env.ALPACA_KEY_ID, S = process.env.ALPACA_SECRET_KEY;
const out = { keys: !!(K && S) };
const H = { 'APCA-API-KEY-ID': K || '', 'APCA-API-SECRET-KEY': S || '' };
async function j(u){ const r = await fetch(u, { headers: H }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t.slice(0, 200); } return { status: r.status, b }; }
const B = 'https://data.alpaca.markets';
if (out.keys){
  const a = await j(`${B}/v2/stocks/bars?symbols=SPY&timeframe=1Min&start=2018-01-02T14:30:00Z&end=2018-01-02T21:00:00Z&limit=10000&adjustment=split&feed=sip`);
  out.spy2018 = { status: a.status, n: a.b?.bars?.SPY?.length, first: a.b?.bars?.SPY?.[0], msg: a.b?.message };
  for (const s of ['FB', 'META', 'NVDA', 'TWTR', 'ATVI']){
    const d = await j(`${B}/v2/stocks/bars?symbols=${s}&timeframe=1Day&start=2021-06-01&end=2021-06-10&limit=100&adjustment=split&feed=sip`);
    out['d_' + s] = { status: d.status, n: d.b?.bars?.[s]?.length, c: d.b?.bars?.[s]?.[0]?.c, msg: d.b?.message };
  }
  const n24 = await j(`${B}/v2/stocks/bars?symbols=NVDA&timeframe=1Day&start=2024-06-05&end=2024-06-12&limit=100&adjustment=split&feed=sip`);
  out.nvdaSplit = n24.b?.bars?.NVDA?.map((x) => [x.t.slice(0, 10), x.c]);
  const n24r = await j(`${B}/v2/stocks/bars?symbols=NVDA&timeframe=1Day&start=2024-06-05&end=2024-06-12&limit=100&adjustment=raw&feed=sip`);
  out.nvdaRaw = n24r.b?.bars?.NVDA?.map((x) => [x.t.slice(0, 10), x.c]);
  const ca = await j(`${B}/v1/corporate-actions?symbols=META,NVDA&types=forward_split,name_change&start=2021-01-01&end=2024-12-31`);
  out.ca = { status: ca.status, keys: ca.b && typeof ca.b === 'object' ? Object.keys(ca.b.corporate_actions || ca.b) : ca.b, sample: JSON.stringify(ca.b).slice(0, 600) };
  const rec = await j(`${B}/v2/stocks/bars?symbols=SPY&timeframe=1Min&start=2026-11-24T14:30:00Z&end=2026-11-24T15:00:00Z&limit=100&feed=sip`);
  out.recent = { status: rec.status, n: rec.b?.bars?.SPY?.length };
}
console.log(JSON.stringify(out, null, 1));
