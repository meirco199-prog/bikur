#!/usr/bin/env node
// בדיקה לאחור ל"בוט 4" (engine/amit4-open.js): מה שעמית הראה — צניחה מתחת לרצועת בולינגר בנרות דקה, בדקות הראשונות אחרי פתיחת המסחר
// בארה"ב, בחוזי המניות של Bybit. מחקר בלבד — אין פקודות ואין מפתחות. רץ על השרת (Bybit חוסמת שרתים בארה"ב):
//   bybit-bot.yml → research4 (המנוע והסקריפט נשלחים ב-stdin; שורת ה-import מוסרת שם).
// נתונים: נרות דקה ציבוריים של Bybit, חלון של 25 דקות לפני הפתיחה עד 65 אחריה, לכל יום מסחר מאז שהחוזה קיים.
// יקום: 40 חוזי המניות/קרנות עם המחזור הגבוה ביותר (שקיימים 60 יום לפחות) + SNXXUSDT.
// קריטריון שנקבע מראש (לא משנים אחרי הריצה):
//   • בוחרים גרסה אחת לפי החצי הראשון של הימים (פיתוח) בלבד — רווח ממוצע לעסקה, לפחות 100 עסקאות.
//   • עוברת רק אם בחצי השני (מבחן): רווח ממוצע > 0 עם t ≥ 2, וגבוה מקבוצת הביקורת (כניסה בדקה אקראית באותו חלון, אותה יציאה).
//   • בנפרד: "כמו עמית" (קבועה מראש) — T5 · d0.5 · יעד 1.5% · סטופ 1% · 2 דקות.
import { nyOpenUtc, HOLIDAYS, tradeDay, randomDay, grid, lcg, stat, SIZE, FEES } from '../engine/amit4-open.js';
const B = 'https://api.bybit.com', sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (...a) => console.error(...a);
const get = async (p) => { for (let k = 0; k < 5; k++){ try { const r = await fetch(B + p); if (r.ok){ const j = await r.json(); if (j.retCode === 0) return j; if (j.retCode === 10006){ await sleep(1500 * (k + 1)); continue; } throw new Error(j.retMsg); } if (r.status === 429 || r.status >= 500){ await sleep(1500 * (k + 1)); continue; } throw new Error(`HTTP ${r.status}`); } catch (e) { if (k === 4) throw e; await sleep(1000 * (k + 1)); } } };
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const AMIT = 'T5-d0.5-g1.5-s1-N2', TOP = Number(process.env.TOP || 40), MIN_TR = 100;

const ins = []; let cur = '';
do { const j = await get(`/v5/market/instruments-info?category=linear&limit=1000${cur ? `&cursor=${encodeURIComponent(cur)}` : ''}`); ins.push(...j.result.list); cur = j.result.nextPageCursor || ''; } while (cur);
const now = Date.now(), stocks = ins.filter((x) => x.status === 'Trading' && /^(stock|ETF)$/i.test(x.symbolType || '') && now - Number(x.launchTime) > 60 * 86400e3);
const tick = (await get('/v5/market/tickers?category=linear')).result.list, turn = new Map(tick.map((x) => [x.symbol, Number(x.turnover24h)]));
const uni = [...stocks].sort((a, b) => (turn.get(b.symbol) || 0) - (turn.get(a.symbol) || 0)).slice(0, TOP);
if (!uni.some((x) => x.symbol === 'SNXXUSDT')){ const s = ins.find((x) => x.symbol === 'SNXXUSDT'); if (s) uni.push(s); }
log(`חוזי מניות: ${stocks.length}, ביקום: ${uni.length}`);

// ימי מסחר
const days = []; for (let d = Date.parse('2026-04-28T00:00:00Z'); d < now - 86400e3; d += 86400e3){ const s = iso(d), w = new Date(d).getUTCDay(); if (w > 0 && w < 6 && !HOLIDAYS.has(s)) days.push(s); }
const mid = days[Math.floor(days.length / 2)];
// נרות
const data = []; const q = [];
for (const x of uni) for (const day of days){ const open = nyOpenUtc(day); if (open && open - 25 * 60e3 > Number(x.launchTime) + 2 * 86400e3) q.push({ sym: x.symbol, day, open }); }
log(`בקשות: ${q.length}`); let done = 0;
await Promise.all(Array.from({ length: 4 }, async () => { for (let it; (it = q.shift());){
  try {
    const j = await get(`/v5/market/kline?category=linear&symbol=${it.sym}&interval=1&start=${it.open - 25 * 60e3}&end=${it.open + 65 * 60e3}&limit=100`);
    const rows = (j.result.list || []).map((r) => r.map(Number)).sort((a, b) => a[0] - b[0]);
    if (rows.length >= 60){ const A = (k) => Float64Array.from(rows, (r) => r[k]); data.push({ ...it, bars: { t: A(0), o: A(1), h: A(2), l: A(3), c: A(4) } }); }
  } catch (e) { log(`${it.sym} ${it.day}: ${e.message}`); }
  if (++done % 500 === 0) log(`${done}…`); await sleep(110);
} }));
log(`ימים עם נתונים: ${data.length}`);

const G = grid(), R = new Map();
for (const v of G){
  const rnd = lcg(12345), tr = [], rn = [];
  for (const d of data){ const a = tradeDay(d.bars, d.open, v); if (a) tr.push({ ...a, sym: d.sym, day: d.day }); const b = randomDay(d.bars, d.open, v, rnd); if (b) rn.push({ ...b, day: d.day }); }
  R.set(v.k, { v, tr, rn });
}
const part = (xs, p) => xs.filter((x) => (p === 'dev' ? x.day < mid : p === 'test' ? x.day >= mid : true)).map((x) => x.pnl);
const f$ = (x) => (Number.isFinite(x) ? (x < 0 ? '−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US') : '—'), ft = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—'), fp = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—');
const row = (k) => { const { tr, rn } = R.get(k), dv = stat(part(tr, 'dev')), ts = stat(part(tr, 'test')), al = stat(part(tr, 'all')), rt = stat(part(rn, 'test')), ra = stat(part(rn, 'all'));
  const why = {}; tr.forEach((x) => (why[x.why] = (why[x.why] || 0) + 1));
  return { k, dv, ts, al, rt, ra, line: `| ${k} | ${al.n} | ${fp(al.win)} | ${f$(dv.mean)} (${dv.n}) | ${f$(ts.mean)} (${ts.n}) | ${ft(ts.t)} | ${f$(al.sum)} | ${f$(ra.mean)} | ${Object.entries(why).map(([a, b]) => `${a} ${Math.round(100 * b / al.n)}%`).join(' · ')} |` }; };
const rows = G.map((v) => row(v.k)), elig = rows.filter((x) => x.dv.n >= MIN_TR).sort((a, b) => b.dv.mean - a.dv.mean), best = elig[0], amit = rows.find((x) => x.k === AMIT);
const pass = best && best.ts.mean > 0 && best.ts.t >= 2 && best.ts.mean > best.rt.mean;
// רגישות: הגרסה הנבחרת עם כניסה בעמלה 0 (מבצע) ועם עלויות כפולות
const sens = (k, F, ef) => { const v = R.get(k).v, xs = []; for (const d of data){ const a = tradeDay(d.bars, d.open, v, F, SIZE, ef); if (a) xs.push(a.pnl); } return stat(xs); };
const H = '| גרסה | עסקאות | הצלחה | לעסקה (פיתוח) | לעסקה (מבחן) | t מבחן | סה״כ | אקראי לעסקה | יציאות |', S = '|---|---|---|---|---|---|---|---|---|';
const md = [`# בוט 4 — "כמו עמית": קנייה בצניחה מתחת לרצועה בדקות הראשונות של המסחר בארה"ב (חוזי מניות ב-Bybit)`, '',
  `- **נתונים:** נרות דקה של Bybit, ${days[0]} → ${days.at(-1)} (${days.length} ימי מסחר), ${uni.length} חוזים, ${data.length} ימי-חוזה. פיתוח: עד ${mid}, מבחן: מ-${mid}.`,
  `- **עסקה:** ${SIZE.toLocaleString()}$, כניסה בפקודה ממתינה (עמלה ${FEES.maker * 100}%), יעד בפקודה ממתינה, סטופ וזמן מיידיים (${FEES.taker * 100}% + החלקה ${FEES.slip * 100}%).`,
  '- **שמרני:** אין יציאה באותה דקה של הכניסה; סטופ ויעד באותה דקה → סטופ. עסקה אחת ביום לכל חוזה.',
  `- **גרסאות:** ${G.length} (T = דקות אחרי הפתיחה · d = כמה מתחת לרצועה · g = יעד · s = סטופ · N = דקות מקסימום).`, '',
  '## 1. "כמו עמית" (נקבעה מראש)', '', H, S, amit.line, '',
  '## 2. 10 הגרסאות הטובות בפיתוח', '', H, S, ...elig.slice(0, 10).map((x) => x.line), '',
  '## 3. הכרעה', '',
  best ? `- **הנבחרת לפי הפיתוח:** ${best.k} — מבחן ${f$(best.ts.mean)} לעסקה (t ${ft(best.ts.t)}, ${best.ts.n} עסקאות), אקראי במבחן ${f$(best.rt.mean)}. **${pass ? 'עוברת ✅' : 'לא עוברת ❌'}**.` : '- אין גרסה עם מספיק עסקאות בפיתוח.',
  best ? (() => { const z = sens(best.k, FEES, 0), x2 = sens(best.k, { maker: 2 * FEES.maker, taker: 2 * FEES.taker, slip: 2 * FEES.slip }, 2 * FEES.maker); return `- **רגישות לעמלות (הנבחרת, כל התקופה):** כניסה בעמלה 0: ${f$(z.mean)} לעסקה · עלויות כפולות: ${f$(x2.mean)} לעסקה.`; })() : '',
  `- **"כמו עמית":** ${f$(amit.al.mean)} לעסקה על ${amit.al.n} עסקאות (מבחן ${f$(amit.ts.mean)}, t ${ft(amit.ts.t)}).`,
  `- **כמה גרסאות חיוביות בשתי התקופות:** ${rows.filter((x) => x.dv.mean > 0 && x.ts.mean > 0 && x.dv.n >= 30).length} מתוך ${G.length}.`];
console.log(md.join('\n'));
