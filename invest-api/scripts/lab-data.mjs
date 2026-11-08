#!/usr/bin/env node
// מעבדת האסטרטגיות — בניית מערך הנתונים (רץ ב-GitHub Actions, שם יש רשת; נשמר לענף lab-data). מחקר בלבד.
// פלט (תיקיית OUT):
//   manifest.json                 — מקור, זמן בנייה, רשימת סימבולים {from,to,n,name,sector,delisted}, יקומים זמינים, חסרים, הערות
//   universe/<id>.json            — הרכב מדד point-in-time: {id, pointInTime, from, to, members:{SYM:[[fromDay,toDay|null],…]}}
//   bars/<SYM>.<decade>.json      — סדרות compact לפי עשור (d=ימים מאז 1970, o/h/l/c גולמי, a=סגירה מתואמת, v, div, split)
//   coverage.json                 — דוח כיסוי: חברי מדד היסטוריים בלי נתונים (survivorship), פערים
// ספקים: Tiingo (TIINGO_KEY; רשמי, מתואם, 1000 קריאות/יום) → ברירת מחדל Yahoo chart API (ציבורי; לא רשמי — מחקר בלבד, כמו
// research-losers.mjs). אף ספק חינמי אינו מספק מניות שנמחקו — הן נרשמות כחסרות ומוצגות למשתמש, לא מומצאות.
// הרכב S&P 500 היסטורי: מאגר fja05680/sp500 (יומי מ-1996, מבוסס שינויים רשמיים) → גיבוי: ההרכב הנוכחי (datasets/s-and-p-500-companies) מסומן pointInTime=false.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { membershipFromDaily, dayNum, isoOf } from '../engine/lab/data.js';

const env = process.env, arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out', env.LAB_OUT || 'lab-data-out'), YEARS = +arg('--years', env.LAB_YEARS || 20), LIMIT = +arg('--limit', env.LAB_LIMIT || 0), PROVIDER = arg('--provider', env.LAB_PROVIDER || (env.TIINGO_KEY ? 'tiingo' : 'yahoo'));
const EXTRA = (arg('--extra', env.LAB_EXTRA || 'SPY,QQQ,IWM,DIA,TLT,GLD,XLK,XLF,XLV,XLE,XLY,XLP,XLI,XLU,XLB,XLRE,XLC,BTC-USD,ETH-USD,SOL-USD,XRP-USD,ADA-USD,BNB-USD,DOGE-USD')).split(',').map((s) => s.trim()).filter(Boolean);
const FROM = `${new Date().getUTCFullYear() - YEARS}-01-01`;
const UA = { 'User-Agent': 'Mozilla/5.0 (bikur invest-lab research; github.com/meirco199-prog/bikur)', Accept: '*/*' };
const log = (...a) => console.error(...a), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastStatus = null;
async function get(url, { json = false, tries = 4, headers = {} } = {}){
  // api.github.com: עם GITHUB_TOKEN (ב-Actions) — בלי טוקן המכסה היא 60 בקשות/שעה לכתובת IP משותפת, והרשימה נכשלת בשקט (ריצה 42523832207)
  const auth = /^https:\/\/api\.github\.com\//.test(url) && (env.GH_TOKEN || env.GITHUB_TOKEN) ? { Authorization: `Bearer ${env.GH_TOKEN || env.GITHUB_TOKEN}` } : {};
  for (let k = 0; k < tries; k++){
    try { const r = await fetch(url, { headers: { ...UA, ...auth, ...headers } }); lastStatus = r.status; if (r.status === 429 || r.status >= 500){ await sleep(2000 * (k + 1)); continue; } if (!r.ok) return null; return json ? await r.json() : await r.text(); }
    catch (e) { lastStatus = e.message; await sleep(1500 * (k + 1)); }
  }
  return null;
}
const parseCsv = (text) => { const lines = text.split(/\r?\n/).filter((l) => l.trim()); const head = split(lines[0]); return lines.slice(1).map((l) => { const c = split(l); return Object.fromEntries(head.map((h, i) => [h.trim(), (c[i] ?? '').trim()])); }); };
function split(line){ const out = []; let cur = '', q = false; for (const ch of line){ if (ch === '"'){ q = !q; continue; } if (ch === ',' && !q){ out.push(cur); cur = ''; continue; } cur += ch; } out.push(cur); return out; }
const normSym = (s) => s.trim().toUpperCase().replace(/\s.*$/, '').replace('.', '-');

// --- הרכב S&P 500 ---
async function sp500Universe(){
  const notes = [];
  // 1. היסטורי יומי (fja05680)
  try {
    // שם הקובץ במאגר (11/2026): "S&P 500 Historical Components & Changes (Updated).csv" (ובעבר עם תאריך בסוגריים) — מעדיפים את ה-Updated
    const NAME = /S&P 500 Historical Components (?:&|&amp;) Changes[^"<>/]*\.csv/;
    const pick = (names) => { const c = names.filter((n) => NAME.test(n)); return c.find((n) => /Updated/i.test(n)) || c.find((n) => /\(/.test(n)) || c[0] || null; };
    let file = null;
    const list = await get('https://api.github.com/repos/fja05680/sp500/contents/', { json: true, headers: { Accept: 'application/vnd.github+json' } });
    if (Array.isArray(list)){ const name = pick(list.map((x) => x.name)); const f = name && list.find((x) => x.name === name); if (f) file = { name: f.name, download_url: f.download_url }; else notes.push(`fja05680: ${list.length} קבצים ברשימה, אף אחד לא תואם: ${list.map((x) => x.name).join(' | ').slice(0, 300)}`); }
    else {
      notes.push(`fja05680: רשימת הקבצים מ-api.github.com נכשלה (${lastStatus}) — מנסים דרך דף ה-HTML`);
      const html = await get('https://github.com/fja05680/sp500'); const names = html ? [...new Set([...html.matchAll(new RegExp(NAME.source, 'g'))].map((m) => m[0].replace(/&amp;/g, '&')))] : [];
      const name = pick(names);
      if (name){ const branch = (html.match(/\/fja05680\/sp500\/(?:blob|tree)\/([^/"]+)\//) || [])[1] || 'master'; file = { name, download_url: `https://raw.githubusercontent.com/fja05680/sp500/${branch}/${encodeURIComponent(name)}` }; }
      else notes.push(`fja05680: גם דף ה-HTML לא הניב שם קובץ (${lastStatus})`);
    }
    if (file){
      const csv = await get(file.download_url);
      const rows = parseMembershipCsv(csv);
      if (rows.length > 100){ const m = membershipFromDaily(rows); log(`sp500 history: ${rows.length} snapshots, ${Object.keys(m.members).length} distinct members, ${isoOf(m.from)}→${isoOf(m.to)}`); return { id: 'sp500', pointInTime: true, source: `fja05680/sp500 (${file.name})`, ...m, notes }; }
      notes.push(`fja05680: הקובץ ${file.name} נמצא אך לא נותח (${csv ? csv.length + ' תווים' : 'הורדה נכשלה: ' + lastStatus})`);
    }
  } catch (e) { notes.push('fja05680: ' + e.message); }
  // 2. גיבוי: הרכב נוכחי (לא point-in-time)
  const csv = await get('https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv');
  if (!csv) throw new Error('לא ניתן להשיג הרכב S&P 500 משום מקור — לא בונים מערך נתונים חלקי בשקט');
  const members = {}; for (const r of parseCsv(csv)){ const s = normSym(r.Symbol || ''); if (/^[A-Z][A-Z0-9-]{0,6}$/.test(s)) members[s] = [[dayNum('1990-01-01'), null]]; }
  notes.push('⚠ אין היסטוריית חברות — נעשה שימוש בהרכב הנוכחי (הטיית שורדים)');
  return { id: 'sp500', pointInTime: false, source: 'datasets/s-and-p-500-companies (current)', from: null, to: null, members, notes };
}
// CSV של חברות יומיות: עמודת תאריך (ISO) + עמודת רשימת טיקרים מופרדת בפסיקים — בלי להניח שמות עמודות
export function parseMembershipCsv(csv){
  if (!csv) return [];
  return parseCsv(csv).map((r) => { const vals = Object.values(r); const day = (vals.find((v) => /^\d{4}-\d{2}-\d{2}/.test(v)) || '').slice(0, 10); const list = vals.filter((v) => v !== day).sort((a, b) => (b.match(/,/g) || []).length - (a.match(/,/g) || []).length)[0] || ''; return { day, symbols: list.split(',').map(normSym).filter((s) => /^[A-Z][A-Z0-9-]{0,6}$/.test(s)) }; }).filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day) && r.symbols.length > 300);
}
async function sectors(){
  const out = {}, names = {};
  const csv = await get('https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv');
  if (csv) for (const r of parseCsv(csv)){ const s = normSym(r.Symbol || ''); if (s){ out[s] = r['GICS Sector'] || null; names[s] = r.Security || null; } }
  return { sectors: out, names, note: 'סקטורים לפי הסיווג הנוכחי (GICS) — לא point-in-time; מניות שנמחקו ללא סקטור' };
}

// --- מחירים ---
async function yahoo(sym){
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${Math.floor(Date.parse(FROM + 'T00:00:00Z') / 1000)}&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`, { json: true });
  const r = j?.chart?.result?.[0]; if (!r?.timestamp?.length) return null;
  const q = r.indicators.quote[0], adj = r.indicators.adjclose?.[0]?.adjclose || q.close, out = { d: [], o: [], h: [], l: [], c: [], v: [], a: [] };
  r.timestamp.forEach((t, i) => { if (!(q.close[i] > 0 && q.open[i] > 0 && q.high[i] > 0 && q.low[i] > 0)) return; const day = Math.floor((t + (r.meta.gmtoffset || 0)) / 86400); if (out.d.length && out.d[out.d.length - 1] >= day) return; out.d.push(day); out.o.push(+q.open[i].toFixed(4)); out.h.push(+q.high[i].toFixed(4)); out.l.push(+q.low[i].toFixed(4)); out.c.push(+q.close[i].toFixed(4)); out.v.push(Math.round(q.volume[i] || 0)); out.a.push(+(adj[i] > 0 ? adj[i] : q.close[i]).toFixed(5)); });
  const ev = r.events || {};
  out.div = Object.values(ev.dividends || {}).map((d) => [Math.floor((d.date + (r.meta.gmtoffset || 0)) / 86400), +d.amount]);
  out.split = Object.values(ev.splits || {}).map((s) => [Math.floor((s.date + (r.meta.gmtoffset || 0)) / 86400), s.numerator / s.denominator]);
  out.meta = { name: r.meta.longName || r.meta.shortName || null, exchange: r.meta.exchangeName || null, currency: r.meta.currency || 'USD' };
  return out;
}
async function tiingo(sym){
  const arr = await get(`https://api.tiingo.com/tiingo/daily/${encodeURIComponent(sym.toLowerCase())}/prices?startDate=${FROM}&format=json&token=${env.TIINGO_KEY}`, { json: true });
  if (!Array.isArray(arr) || !arr.length) return null;
  const out = { d: [], o: [], h: [], l: [], c: [], v: [], a: [], div: [], split: [], meta: {} };
  for (const x of arr){ if (!(x.close > 0 && x.open > 0)) continue; const day = dayNum(x.date.slice(0, 10)); out.d.push(day); out.o.push(+x.open.toFixed(4)); out.h.push(+x.high.toFixed(4)); out.l.push(+x.low.toFixed(4)); out.c.push(+x.close.toFixed(4)); out.v.push(Math.round(x.volume || 0)); out.a.push(+x.adjClose.toFixed(5)); if (x.divCash > 0) out.div.push([day, +x.divCash]); if (x.splitFactor && x.splitFactor !== 1) out.split.push([day, +x.splitFactor]); }
  return out;
}
const fetchers = { yahoo, tiingo: env.TIINGO_KEY ? tiingo : null };
const decadeOf = (day) => Math.floor(new Date(day * 86400000).getUTCFullYear() / 10) * 10;

async function main(){
  const t0 = Date.now();
  mkdirSync(join(OUT, 'bars'), { recursive: true }); mkdirSync(join(OUT, 'universe'), { recursive: true });
  const fetcher = fetchers[PROVIDER]; if (!fetcher) throw new Error(`ספק ${PROVIDER} לא זמין (חסר מפתח?)`);
  const uni = await sp500Universe(); for (const n of uni.notes) log('universe:', n); const { sectors: sec, names, note: secNote } = await sectors();
  writeFileSync(join(OUT, 'universe', 'sp500.json'), JSON.stringify({ id: uni.id, pointInTime: uni.pointInTime, source: uni.source, from: uni.from, to: uni.to, members: uni.members, notes: uni.notes }));
  // רק חברים שהיו במדד בתוך טווח השנים המבוקש
  const fromDay = dayNum(FROM);
  let syms = Object.entries(uni.members).filter(([, iv]) => iv.some(([a, b]) => b === null || b >= fromDay)).map(([s]) => s);
  syms = [...new Set([...syms, ...EXTRA])]; if (LIMIT) syms = [...syms.slice(0, LIMIT), ...EXTRA.filter((e) => !syms.slice(0, LIMIT).includes(e))];
  log(`provider=${PROVIDER} from=${FROM} symbols=${syms.length}`);
  const manifest = { version: 1, builtAt: new Date().toISOString(), provider: PROVIDER === 'yahoo' ? 'Yahoo Finance chart API (ציבורי, לא רשמי — מחקר בלבד)' : 'Tiingo (API רשמי, מחירים מתואמים)', from: FROM, universes: { sp500: { pointInTime: uni.pointInTime, source: uni.source, members: Object.keys(uni.members).length, from: uni.from ? isoOf(uni.from) : null, to: uni.to ? isoOf(uni.to) : null } }, symbols: {}, missing: [], notes: [...uni.notes, secNote, 'מניות שנמחקו מהמסחר: ספקים חינמיים לא מספקים את ההיסטוריה שלהן — הן ברשימת missing ומוצגות בדוח הכיסוי של כל בדיקה.'], extra: EXTRA };
  const queue = [...syms]; let done = 0, okN = 0;
  const worker = async () => {
    for (let sym; (sym = queue.shift());){
      const c = await fetcher(sym); done++;
      if (!c || c.d.length < 20){ manifest.missing.push(sym); if (done % 25 === 0) log(`${done}/${syms.length} ok=${okN}`); await sleep(PROVIDER === 'yahoo' ? 150 : 3800); continue; }
      okN++;
      const lastDay = c.d[c.d.length - 1], delisted = (dayNum(new Date().toISOString().slice(0, 10)) - lastDay) > 10;
      manifest.symbols[sym] = { from: isoOf(c.d[0]), to: isoOf(lastDay), n: c.d.length, name: names[sym] || c.meta?.name || null, sector: sec[sym] || null, exchange: c.meta?.exchange || null, delisted, decades: [] };
      // פיצול לעשורים
      const groups = new Map(); c.d.forEach((day, i) => { const dec = decadeOf(day); if (!groups.has(dec)) groups.set(dec, []); groups.get(dec).push(i); });
      for (const [dec, idx] of groups){ const part = { s: sym, d: idx.map((i) => c.d[i]), o: idx.map((i) => c.o[i]), h: idx.map((i) => c.h[i]), l: idx.map((i) => c.l[i]), c: idx.map((i) => c.c[i]), v: idx.map((i) => c.v[i]), a: idx.map((i) => c.a[i]), div: c.div.filter(([d]) => decadeOf(d) === dec), split: c.split.filter(([d]) => decadeOf(d) === dec), meta: { name: names[sym] || c.meta?.name || null, sector: sec[sym] || null, exchange: c.meta?.exchange || null } }; writeFileSync(join(OUT, 'bars', `${sym}.${dec}.json`), JSON.stringify(part)); manifest.symbols[sym].decades.push(dec); }
      if (done % 25 === 0) log(`${done}/${syms.length} ok=${okN}`);
      await sleep(PROVIDER === 'yahoo' ? 150 : 3800); // Tiingo: 50/שעה בחינם → ~1 ל-72 שניות בפועל; בתשלום מהיר יותר
    }
  };
  await Promise.all(Array.from({ length: PROVIDER === 'yahoo' ? 4 : 1 }, worker));
  manifest.sectors = Object.fromEntries(Object.entries(sec).filter(([s]) => manifest.symbols[s]));
  // כיסוי: חברי מדד בטווח בלי נתונים
  const members = Object.entries(uni.members).filter(([, iv]) => iv.some(([a, b]) => b === null || b >= fromDay)).map(([s]) => s);
  const missingMembers = members.filter((s) => !manifest.symbols[s]);
  const coverage = { builtAt: manifest.builtAt, from: FROM, provider: PROVIDER, universeMembersInRange: members.length, withData: members.length - missingMembers.length, missingMembers, ratio: +((members.length - missingMembers.length) / Math.max(1, members.length)).toFixed(3), pointInTime: uni.pointInTime, note: missingMembers.length ? `${missingMembers.length} חברי מדד היסטוריים ללא מחירים (ברובם נמחקו/מוזגו) — כל בדיקה מסומנת "מוגבלת" עם הרשימה` : 'כיסוי מלא' };
  writeFileSync(join(OUT, 'coverage.json'), JSON.stringify(coverage, null, 1));
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest));
  log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${okN} series, ${manifest.missing.length} missing, coverage ${(coverage.ratio * 100).toFixed(1)}%`);
  console.log(JSON.stringify({ ok: true, series: okN, missing: manifest.missing.length, coverage: coverage.ratio, pointInTime: uni.pointInTime }));
}
if (process.argv[1] && process.argv[1].endsWith('lab-data.mjs')) main().catch((e) => { log('::error::' + e.message); process.exit(1); });
