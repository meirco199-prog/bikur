#!/usr/bin/env node
// סימולציה (בקשת מאיר, 8/11/2026): "כל יום ב-3 החודשים האחרונים שמתי על 5 או 10 המניות שירדו הכי הרבה ואז מכרתי בסוף המסחר —
// אם התחלתי ב-50,000$ כמה היה לי היום, וכמה עמלות שילמתי". מחקר בלבד, בלי פקודות.
// יקום: S&P 1500 (500+400+600 מוויקיפדיה, הרכב של היום — הטיית שורדים), נרות יומיים מ-Yahoo (ציבורי). סינון כמו בסורק: מחיר > 5$,
// מחזור ממוצע 20 יום > 20 מיליון $. שתי גרסאות:
//   A — קנייה בסגירה של יום הירידה (פקודת MOC), מכירה בסגירה של היום הבא.
//   B — קנייה בפתיחה של היום הבא, מכירה בסגירה שלו (יום מסחר אחד).
// עלויות: עמלת IBKR Pro Fixed (0.005$ למניה, מינימום 1$, מקסימום 1% מהעסקה) + עמלות רגולטור במכירה (SEC 0.00278%, FINRA TAF),
// והחלקה/מרווח 0.05% לכל צד (רגישות: 0.15%). כל ההון מושקע מחדש כל יום, חלקים שווים, מניות שלמות.
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out', ''), CACHE = arg('--cache', ''), START_USD = 50000, DAYS = 63;
const UA = { 'User-Agent': 'Mozilla/5.0 (research backtest)', Accept: '*/*' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (...a) => console.error(...a);
async function get(url, tries = 4){ for (let k = 0; k < tries; k++){ try { const r = await fetch(url, { headers: UA }); if (r.status === 429){ await sleep(3000 * (k + 1)); continue; } if (!r.ok) return null; return await r.text(); } catch { await sleep(1000 * (k + 1)); } } return null; }

async function universe(){
  const pages = ['List_of_S%26P_500_companies', 'List_of_S%26P_400_companies', 'List_of_S%26P_600_companies'], set = new Set();
  for (const p of pages){
    const h = await get(`https://en.wikipedia.org/wiki/${p}`); if (!h) { log('wiki fail', p); continue; }
    const t = h.slice(h.indexOf('<table'), h.indexOf('</table>'));
    for (const m of t.matchAll(/<tr>\s*<td[^>]*>\s*(?:<a[^>]*>)?([A-Z][A-Z0-9.\-]{0,6})(?:<\/a>)?\s*<\/td>/g)) set.add(m[1].replace('.', '-'));
  }
  return [...set];
}
async function bars(sym){
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=6mo&interval=1d&includeAdjustedClose=false`);
  try { const r = JSON.parse(j).chart.result[0], q = r.indicators.quote[0]; return r.timestamp.map((t, i) => ({ d: new Date(t * 1000).toISOString().slice(0, 10), o: q.open[i], c: q.close[i], v: q.volume[i] })).filter((b) => b.o > 0 && b.c > 0); } catch { return null; }
}
async function load(){
  if (CACHE && existsSync(CACHE)) return JSON.parse(readFileSync(CACHE, 'utf8'));
  const syms = await universe(); log(`universe: ${syms.length}`);
  const data = {}, q = [...syms, 'SPY'];
  const worker = async () => { for (let s; (s = q.shift());){ const b = await bars(s); if (b && b.length > 60) data[s] = b; await sleep(120); } };
  await Promise.all(Array.from({ length: 6 }, worker));
  log(`loaded: ${Object.keys(data).length}`);
  if (CACHE) writeFileSync(CACHE, JSON.stringify(data));
  return data;
}

const comm = (sh, px) => Math.min(Math.max(1, 0.005 * sh), 0.01 * sh * px);
const sellFees = (sh, px) => 0.0000278 * sh * px + Math.min(0.000166 * sh, 8.3);
function sim(data, days, N, mode, slip){
  let eq = START_USD, fees = 0, slipUsd = 0, trades = 0, wins = 0, peak = eq, dd = 0, worst = 0, best = 0; const log_ = [];
  const idx = {}; for (const [s, b] of Object.entries(data)) idx[s] = new Map(b.map((x, i) => [x.d, i]));
  for (let k = 0; k < days.length - 1; k++){
    const d = days[k], nx = days[k + 1], cand = [];
    for (const [s, b] of Object.entries(data)){
      if (s === 'SPY') continue;
      const i = idx[s].get(d), j = idx[s].get(nx); if (i === undefined || j === undefined || i < 21 || j !== i + 1) continue;
      const adv = b.slice(i - 20, i).reduce((a, x) => a + x.c * (x.v || 0), 0) / 20;
      if (b[i].c <= 5 || adv < 20e6) continue;
      cand.push({ s, r: b[i].c / b[i - 1].c - 1, buy: mode === 'A' ? b[i].c : b[j].o, sell: b[j].c });
    }
    cand.sort((a, b) => a.r - b.r);
    const pick = cand.slice(0, N); if (!pick.length) continue;
    let end = 0; const per = eq / pick.length;
    for (const p of pick){
      const bpx = p.buy * (1 + slip), sh = Math.floor(per / bpx); if (sh < 1){ end += per; continue; }
      const spx = p.sell * (1 - slip), f = comm(sh, bpx) + comm(sh, spx) + sellFees(sh, spx);
      const val = per - sh * bpx + sh * spx - f;
      fees += f; slipUsd += sh * (p.buy * slip + p.sell * slip); trades += 2; end += val;
    }
    const r = end / eq - 1; if (r > 0) wins += 1; worst = Math.min(worst, r); best = Math.max(best, r);
    eq = end; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak);
    log_.push({ d: nx, eq, r, picks: pick.map((p) => `${p.s} ${(p.r * 100).toFixed(1)}%`) });
  }
  return { eq, fees, slipUsd, trades, wins, n: log_.length, dd, worst, best, log: log_ };
}

const data = await load();
const all = [...new Set(Object.values(data).flatMap((b) => b.map((x) => x.d)))].sort();
const spyDays = new Set((data.SPY || []).map((x) => x.d)), tradingDays = all.filter((d) => spyDays.has(d));
const days = tradingDays.slice(-(DAYS + 1)); // 63 ימי החזקה = ~3 חודשים
const spy = data.SPY, si = new Map(spy.map((x, i) => [x.d, i])), spyRet = spy[si.get(days.at(-1))].c / spy[si.get(days[0])].c - 1;
const usd = (x) => `${Math.round(x).toLocaleString('en-US')}$`, pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
const L = [`# סימולציה — קנייה יומית של המניות שירדו הכי הרבה (${days[0]} → ${days.at(-1)}, ${days.length - 1} ימי מסחר)`,
  `יקום: ${Object.keys(data).length - 1} מניות S&P 1500 (הרכב של היום), מחיר > 5$, מחזור ממוצע > 20M$. התחלה: ${usd(START_USD)}. SPY באותה תקופה: ${pct(spyRet)} (${usd(START_USD * (1 + spyRet))}).`, '',
  '| גרסה | מניות ביום | החלקה לצד | סוף | תשואה | עמלות IBKR + רגולטור | עלות החלקה | עסקאות | ימים רווחיים | יום גרוע / טוב | ירידה מקס׳ |', '|---|---|---|---|---|---|---|---|---|---|---|'];
const res = {};
for (const mode of ['A', 'B']) for (const N of [5, 10]) for (const slip of [0.0005, 0.0015]){
  const r = sim(data, days, N, mode, slip); res[`${mode}${N}${slip}`] = r;
  L.push(`| ${mode === 'A' ? 'A: קנייה בסגירה, מכירה בסגירה למחרת' : 'B: קנייה בפתיחה למחרת, מכירה בסגירה'} | ${N} | ${(slip * 100).toFixed(2)}% | **${usd(r.eq)}** | ${pct(r.eq / START_USD - 1)} | ${usd(r.fees)} | ${usd(r.slipUsd)} | ${r.trades} | ${r.wins}/${r.n} | ${pct(r.worst)} / ${pct(r.best)} | ${pct(-r.dd)} |`);
  const g = sim(data, days, N, mode, 0); if (slip === 0.0005) L.push(`| ↳ אותה גרסה לפני עמלות והחלקה (בקירוב) | ${N} | 0 | ${usd(g.eq + g.fees)} | | | | | | | |`);
}
L.push('', '## לפי חודש (גרסה A, 10 מניות, החלקה 0.05%)');
const r10 = res['A100.0005'], byM = {}; let prev = START_USD;
for (const x of r10.log){ const m = x.d.slice(0, 7); byM[m] ||= { start: prev }; byM[m].end = x.eq; prev = x.eq; }
for (const [m, v] of Object.entries(byM)) L.push(`- ${m}: ${usd(v.start)} → ${usd(v.end)} (${pct(v.end / v.start - 1)})`);
L.push('', '## 10 הימים האחרונים (גרסה A, 5 מניות)');
for (const x of res['A50.0005'].log.slice(-10)) L.push(`- ${x.d}: ${pct(x.r)} → ${usd(x.eq)} · ${x.picks.join(', ')}`);
const md = L.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md);
