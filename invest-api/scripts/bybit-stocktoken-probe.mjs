#!/usr/bin/env node
// בדיקת נתונים (קריאה בלבד, בלי מפתחות): אילו חוזים של "מניות" יש ב-Bybit (כמו SNXXUSDT — פי 2 על סנדיסק), ממתי יש נרות דקה,
// ומה העמלות הרשמיות. רץ על השרת (Bybit חוסמת שרתים בארה"ב) דרך bybit-bot.yml → probe4. מחקר בלבד — אין פקודות.
const B = 'https://api.bybit.com';
const get = async (p) => { const r = await fetch(B + p); if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`); return r.json(); };
const iso = (t) => new Date(Number(t)).toISOString().slice(0, 16).replace('T', ' ');

const list = []; let cursor = '';
do { const j = await get(`/v5/market/instruments-info?category=linear&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`); list.push(...(j.result?.list || [])); cursor = j.result?.nextPageCursor || ''; } while (cursor);
console.log(`חוזים ליניאריים: ${list.length}`);
const keys = new Set(); list.forEach((x) => Object.keys(x).forEach((k) => keys.add(k))); console.log('שדות:', [...keys].join(','));
const sn = list.find((x) => x.symbol === 'SNXXUSDT'); console.log('SNXXUSDT:', JSON.stringify(sn || null).slice(0, 1500));
// מועמדים: לפי סוג החוזה/הסמל, ולפי תאריך השקה ב-12 החודשים האחרונים
const yearAgo = Date.now() - 365 * 86400e3;
const cand = list.filter((x) => x.status === 'Trading' && (/stock|tradfi|equity|xstock/i.test(JSON.stringify(x)) || (Number(x.launchTime) > yearAgo && /X+USDT$/.test(x.symbol))));
console.log(`מועמדים: ${cand.length}`);
for (const x of cand.slice(0, 80)) console.log(`${x.symbol}\t${x.baseCoin}\tהשקה ${iso(x.launchTime)}\t${x.symbolType || x.contractType || ''}\tטיק ${x.priceFilter?.tickSize}`);
// נרות דקה: הנר הראשון והאחרון של SNXXUSDT
if (sn){
  const first = await get(`/v5/market/kline?category=linear&symbol=SNXXUSDT&interval=1&start=${sn.launchTime}&limit=5`);
  const last = await get('/v5/market/kline?category=linear&symbol=SNXXUSDT&interval=1&limit=3');
  console.log('נרות ראשונים:', JSON.stringify(first.result?.list?.slice(-2)));
  console.log('נרות אחרונים:', JSON.stringify(last.result?.list));
  const day = await get('/v5/market/kline?category=linear&symbol=SNXXUSDT&interval=D&limit=200');
  console.log(`נרות יומיים: ${day.result?.list?.length}, מ-${iso(day.result?.list?.at(-1)?.[0])}`);
}
