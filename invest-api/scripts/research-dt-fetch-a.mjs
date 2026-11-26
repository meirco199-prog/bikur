#!/usr/bin/env node
// מחקר מסחר יומי, שלב א (בקשת מאיר 26/11/2026): הורדת מחירים בלבד — נרות דקה/2 דקות (כולל מסחר מוקדם ומאוחר) ונרות יומיים
// למניות שמאיר סחר בהן 14/10–25/11/2026, ולמדדי ייחוס. אין כאן עסקאות או נתוני חשבון (הריפו ציבורי) — הניתוח עצמו רץ מקומית.
// מקור: Yahoo Finance (1m: 30 יום אחרונים, עד 8 ימים לבקשה; 2m: 60 יום; 1d: שנה). מחקר בלבד.
import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--outdir', 'invest/docs/research/daytrading/data-a');
const US = 'AAOI ADBE AEHR ALAB ALM AMD ANT APA ASST AUGO AXON BABA BEAM BMNR BRK-B CIEN COHR COIN CRDO CRSP CRWD DASH DOCN ECHO EQPT EXPE FA FIX FTAI GOOGL HOOD IBRX INIO IONQ IONS IRTC KLAC LEGN LINE LITE LLY LRCX MA MELI MNDY MPC MRVL MSFT MSTR MTSI MU NBIS OKTA PL PPTA PURR RGTI RKLB ROAD SITM SMMT SNDK STLA TEM TSLA TSM USAR VEEV VLO VOO VRT TEVA QQQ SPY SMH';
const TA = 'AZRG BEZQ DSCT ESLT HARL LUMI MGDL MLSR MTRX MZTF NICE NWMD POLI TEVA';
const SYMS = [...US.split(' '), ...TA.split(' ').map((s) => s + '.TA'), '^TA125.TA'];
const log = (...a) => console.error(...a), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url){ for (let i = 0; i < 4; i++){ try { const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (r.ok) return await r.json(); log(url, r.status); if (r.status === 404) return null; } catch (e) { log(url, e.message); } await sleep(2000 * (i + 1)); } return null; }
async function chart(sym, interval, p1, p2){
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=${interval}&includePrePost=true`);
  const r = j?.chart?.result?.[0]; if (!r?.timestamp) return [];
  const q = r.indicators.quote[0], out = [];
  r.timestamp.forEach((t, i) => { if (q.close[i] != null && q.open[i] != null) out.push([t, q.open[i], q.high[i], q.low[i], q.close[i], q.volume[i] ?? 0]); });
  return out;
}
const now = Math.floor(Date.now() / 1000), D = 86400;
mkdirSync(OUT, { recursive: true });
const meta = {};
for (const s of SYMS){
  const m1 = [];
  for (let a = now - 29 * D; a < now; a += 7 * D){ m1.push(...await chart(s, '1m', a, Math.min(now, a + 7 * D))); await sleep(400); }
  const m2 = await chart(s, '2m', Math.floor(Date.parse('2026-10-08') / 1000), now); await sleep(400);
  const d1 = await chart(s, '1d', now - 400 * D, now); await sleep(400);
  const uniq = (a) => [...new Map(a.map((x) => [x[0], x])).values()].sort((x, y) => x[0] - y[0]);
  const rec = { sym: s, m1: uniq(m1), m2: uniq(m2), d1: uniq(d1) };
  meta[s] = { m1: rec.m1.length, m2: rec.m2.length, d1: rec.d1.length };
  writeFileSync(join(OUT, s.replace(/[^A-Za-z0-9.]/g, '_') + '.json.gz'), gzipSync(JSON.stringify(rec)));
  log(s, meta[s]);
}
writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ fetchedAt: new Date().toISOString(), source: 'Yahoo Finance chart v8', meta }, null, 1));
