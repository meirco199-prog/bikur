// ניתוח לילי של כל חברות ה-S&P 500 ב-GitHub Actions (בלי מגבלות CPU/מכסות של ה-Worker), עם אותו מנוע טהור (engine/*).
// מקורות חינמיים שעובדים מ-GitHub: מחירים — Yahoo Finance chart (ללא מפתח); דוחות — SEC EDGAR companyfacts (ללא מפתח; מטמון actions/cache).
// אין FMP כאן (המפתח לא זמין ל-Actions ותקציבו קטן), לכן לרכיבי אנליסטים/תחזיות אין נתונים בשמות האלה — הם מסומנים חסרים, לא מומצאים.
// התוצאה: snapshots → POST /ingest/snapshots (shards, ~16 כתיבות KV לכל 500 חברות) → הדירוג מאוחד עם יקום הבסיס של ה-Worker.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { analyzeBundle, toSnapshot } from '../engine/pipeline.js';
import { normalizeCompanyFacts } from '../providers/edgar.js';

const W = process.env.WORKER_URL || 'https://invest-api.meirco199.workers.dev';
const SECRET = process.env.CRON_SECRET;
const CACHE = process.env.SP500_CACHE_DIR || '.cache/sp500';
const UA = process.env.EDGAR_UA || 'bikur-invest research (github.com/meirco199-prog/bikur) contact via GitHub';
const LIMIT = +process.env.SP500_LIMIT || 0; // לבדיקות: כמה סימבולים לכל היותר
// מקור מחירים: yahoo (ברירת מחדל, לניסוי הצל בלבד — לא מקור לפרודקשן) | twelvedata (מפתח ב-Actions secret TWELVEDATA_KEY, 7 קריאות/דקה).
// גיבוי לכל סימבול שנכשל: /prices/{sym} דרך ה-Worker (Twelve Data מהתקציב שלו), עד SP500_FALLBACK_MAX בלילה — כדי ששינוי אצל Yahoo לא ימחק סריקה שלמה.
const PRICE_SOURCE = process.env.SP500_PRICE_SOURCE || (process.env.TWELVEDATA_KEY ? 'twelvedata' : 'yahoo');
const FALLBACK_MAX = +process.env.SP500_FALLBACK_MAX || 60;
let fallbacksUsed = 0; const sourceCounts = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function getJSON(url, opts = {}, tries = 3, timeoutMs = 25000){
  for (let i = 0; i < tries; i++){
    try { const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) }); if (r.status === 429 || r.status >= 500){ await sleep(1500 * (i + 1)); continue; } if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (i === tries - 1) throw e; await sleep(1000 * (i + 1)); }
  }
}
async function cacheGet(name, maxAgeMs){ const p = `${CACHE}/${name}.json`; if (!existsSync(p)) return null; try { const j = JSON.parse(await readFile(p, 'utf8')); if (j.fetchedAt && Date.now() - Date.parse(j.fetchedAt) < maxAgeMs) return j.data; } catch {} return null; }
async function cachePut(name, data){ await mkdir(CACHE, { recursive: true }); await writeFile(`${CACHE}/${name}.json`, JSON.stringify({ fetchedAt: new Date().toISOString(), data })); }

// Yahoo Finance chart → שורות [date, o, h, l, c, v] (סגירה מתואמת לפיצולים, לא לדיבידנדים — כמו Twelve Data)
export function parseYahooChart(j){
  const r = j?.chart?.result?.[0]; if (!r?.timestamp?.length) return null;
  const q = r.indicators?.quote?.[0] || {}; const rows = [];
  for (let i = 0; i < r.timestamp.length; i++){ const c = q.close?.[i]; if (c === null || c === undefined) continue; rows.push([new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10), q.open?.[i] ?? c, q.high?.[i] ?? c, q.low?.[i] ?? c, c, q.volume?.[i] ?? 0]); }
  return rows;
}
const yahooSym = (s) => s.replace('.', '-');
async function pricesYahoo(symbol){
  const j = await getJSON(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym(symbol))}?range=7y&interval=1d&events=splits`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bikur-invest/1.0)', Accept: 'application/json' } });
  const rows = parseYahooChart(j); if (!rows?.length) throw new Error('yahoo: אין שורות');
  return { rows, currency: j.chart.result[0].meta?.currency || 'USD', source: 'yahoo', asOf: rows[rows.length - 1][0], quality: 0.7 };
}
let tdLast = 0;
async function pricesTwelveData(symbol){
  const gap = 60000 / 7 - (Date.now() - tdLast); if (gap > 0) await sleep(gap); tdLast = Date.now();
  const j = await getJSON(`https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=1600&apikey=${process.env.TWELVEDATA_KEY}`);
  if (j?.status === 'error' || !Array.isArray(j?.values)) throw new Error('twelvedata: ' + (j?.message || 'אין נתונים'));
  const rows = j.values.map((v) => [v.datetime, +v.open, +v.high, +v.low, +v.close, +v.volume || 0]).filter((r) => Number.isFinite(r[4])).sort((a, b) => a[0].localeCompare(b[0]));
  return { rows, currency: j.meta?.currency || 'USD', source: 'twelvedata', asOf: rows[rows.length - 1][0], quality: 0.8 };
}
async function pricesWorker(symbol){
  if (fallbacksUsed >= FALLBACK_MAX) throw new Error('גיבוי דרך ה-Worker מוצה להלילה');
  fallbacksUsed++;
  const j = await getJSON(`${W}/prices/${encodeURIComponent(symbol)}`);
  if (j?.missing || !Array.isArray(j?.rows) || !j.rows.length) throw new Error('worker: ' + (j?.reason || 'אין שורות'));
  return { rows: j.rows, currency: j.currency || 'USD', source: (j.source || 'worker') + '-via-worker', asOf: j.asOf, quality: j.quality ?? 0.7 };
}
async function prices(symbol){
  const cached = await cacheGet(`px-${symbol}`, 18 * 3600 * 1000); if (cached) return cached;
  const chain = PRICE_SOURCE === 'twelvedata' ? [pricesTwelveData, pricesYahoo, pricesWorker] : [pricesYahoo, pricesWorker];
  let lastErr = null;
  for (const f of chain){ try { const out = await f(symbol); sourceCounts[out.source] = (sourceCounts[out.source] || 0) + 1; await cachePut(`px-${symbol}`, out); return out; } catch (e) { lastErr = e; } }
  throw lastErr || new Error('אין מקור מחירים');
}
let tickerMap = null;
async function cikFor(symbol){
  if (!tickerMap){ tickerMap = await cacheGet('edgar-tickers', 30 * 86400000); if (!tickerMap){ const j = await getJSON('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': UA } }); tickerMap = {}; for (const v of Object.values(j)) tickerMap[String(v.ticker).toUpperCase()] = { cik: String(v.cik_str).padStart(10, '0'), name: v.title }; await cachePut('edgar-tickers', tickerMap); } }
  return tickerMap[symbol.toUpperCase().replace('.', '-')] || tickerMap[symbol.toUpperCase()] || null;
}
async function facts(symbol){
  const cached = await cacheGet(`facts-${symbol}`, 7 * 86400000); if (cached) return cached;
  const c = await cikFor(symbol); if (!c) return { missing: true, reason: 'EDGAR: אין CIK' };
  const j = await getJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${c.cik}.json`, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  const n = normalizeCompanyFacts(j);
  const out = Object.keys(n.series).length ? { ...n, source: 'EDGAR', asOf: Object.values(n.series).flat().reduce((m, f) => (f.filed > m ? f.filed : m), ''), quality: 1 } : { missing: true, reason: 'EDGAR: אין תגיות' };
  await cachePut(`facts-${symbol}`, out); return out;
}

export async function main(){
  if (!SECRET) throw new Error('חסר CRON_SECRET');
  const day = today();
  // כל חברי המדד (כולל אלה שגם ביקום הבסיס) עוברים כאן אותו צינור ובאותו זמן — כדי שאחוזוני B/C/D יהיו על נתונים מאותו סוג
  const universe = await getJSON(`${W}/universe`);
  const sp = await getJSON(`${W}/universe/sp500`);
  let syms = (sp.items || []).map((a) => a.symbol);
  if (!syms.length) syms = (universe.items || []).filter((a) => a.origin === 'mechanical' && a.type === 'stock').map((a) => a.symbol);
  if (LIMIT) syms = syms.slice(0, LIMIT);
  log(`יקום מכני: ${syms.length} חברות, יום ${day}`);
  const regime = await getJSON(`${W}/regime`).catch(() => null);
  const spy = await prices('SPY'); const qqq = await prices('QQQ').catch(() => null);
  const macro = await getJSON(`${W}/macro/DGS10`).catch(() => null);
  const dgs10Rows = macro?.rows || null;
  const snaps = []; const errors = [];
  const meta = new Map((universe.items || []).map((a) => [a.symbol, a]));
  let i = 0;
  for (const sym of syms){
    i++;
    try {
      const asset = meta.get(sym) || { symbol: sym, name: sym, type: 'stock', assetClass: 'equity', role: 'satellite', sector: (sp.items || []).find((a) => a.symbol === sym)?.sector || null, country: 'US', currency: 'USD' };
      const [px, f] = await Promise.all([prices(sym), facts(sym).catch((e) => ({ missing: true, reason: 'EDGAR: ' + e.message }))]);
      const bundle = { asset, prices: px, quote: { missing: true, reason: 'לילה' }, profile: { missing: true, reason: 'לא נמשך ב-Actions' }, facts: f, ratios: { missing: true, reason: 'אין FMP ב-Actions' }, est: { missing: true, reason: 'אין FMP ב-Actions' }, analyst: { missing: true, reason: 'אין FMP ב-Actions' }, news: { missing: true, reason: 'לא נמשך' }, insider: { missing: true, reason: 'לא נמשך' }, etf: { missing: true, reason: 'לא ETF' }, earn: { missing: true, reason: 'תאריכי דוחות מ-FMP (Worker) בלבד' } };
      const a = analyzeBundle(bundle, { regime, benchRows: spy.rows, techRows: asset?.sector === 'Technology' ? qqq?.rows : null, peers: [], dgs10Rows });
      snaps.push(toSnapshot(a));
    } catch (e) { errors.push({ sym, msg: e.message.slice(0, 120) }); snaps.push({ symbol: sym, date: day, missing: true, reason: e.message.slice(0, 120) }); }
    if (i % 25 === 0) log(`${i}/${syms.length} · שגיאות ${errors.length}`);
    await sleep(350); // Yahoo/EDGAR: לא יותר מ-3 בקשות בשנייה
  }
  let written = 0, skipped = 0;
  for (let k = 0; k < snaps.length; k += 100){
    const batch = snaps.slice(k, k + 100);
    const last = k + 100 >= snaps.length;
    const r = await getJSON(`${W}/ingest/snapshots?secret=${encodeURIComponent(SECRET)}${last ? '&finalize=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date: day, source: 'github-actions', snapshots: batch }) }, 1, 120000); // בלי retry: ה-Worker אולי סיים גם אם התשובה איחרה
    written += r.written || 0; skipped += r.skipped || 0;
    if (last) log(`ingest: written ${written}, skipped ${skipped}, rerank ${r.rerank}, shards ${r.shards?.length}`);
  }
  const ok = snaps.filter((s) => !s.missing).length;
  log(`סיום: ${ok}/${snaps.length} עם ציון; שגיאות: ${errors.length}; מקורות מחירים: ${JSON.stringify(sourceCounts)} (מקור ראשי ${PRICE_SOURCE}, גיבויים ${fallbacksUsed}/${FALLBACK_MAX})`);
  for (const e of errors.slice(0, 15)) log('  ', e.sym, e.msg);
  return { day, total: snaps.length, ok, written, skipped, errors: errors.length, priceSource: PRICE_SOURCE, sources: sourceCounts, fallbacks: fallbacksUsed };
}
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main().then((r) => { console.log(JSON.stringify(r)); }).catch((e) => { console.error('nightly-sp500 failed:', e.message); process.exit(1); });
