#!/usr/bin/env node
// מחקר מסחר יומי (פרוטוקול v1.1): הורדת נתוני SIP מ-Alpaca (חשבון חינמי) למטמון פרטי של GitHub Actions — לא לריפו.
// 1) הרכב S&P 500 היסטורי (fja05680) → 2) דירוג לפי מחזור דולרי ב-60 ימי המסחר האחרונים של השנה הקודמת → 60 מניות לשנה →
// 3) נרות יומיים ונרות דקה (שעות רגילות בלבד, מתואמים לפיצול) → 4) בקרת נתונים: פיצולים, שינויי סימול, חוסרים. לריפו: רק data-audit.json.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nyMinuteOfDay, nyDayKey } from '../engine/daytrading.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', join(process.env.HOME || '.', 'dtdata'));
const AUDIT = arg('--audit', 'invest/docs/research/daytrading/results');
const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
const LAST_DAY = '2026-10-13';           // תקופת העסקאות האישיות של מאיר (14/10–25/11/2026) מוצאת
const TOP = 60;
const K = process.env.ALPACA_KEY_ID, S = process.env.ALPACA_SECRET_KEY;
if (!K || !S){ console.error('חסרים ALPACA_KEY_ID / ALPACA_SECRET_KEY בסודות של GitHub Actions'); process.exit(2); }
const H = { 'APCA-API-KEY-ID': K, 'APCA-API-SECRET-KEY': S };
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let nReq = 0, tLast = 0;
async function api(url, tries = 6){
  for (let k = 0; k < tries; k++){
    const wait = 320 - (Date.now() - tLast); if (wait > 0) await sleep(wait); tLast = Date.now(); nReq++;
    try {
      const r = await fetch(url, { headers: H });
      if (r.status === 429 || r.status >= 500){ await sleep(3000 * (k + 1)); continue; }
      const j = await r.json().catch(() => null);
      if (!r.ok){ log('HTTP', r.status, url.slice(0, 140), JSON.stringify(j).slice(0, 200)); return null; }
      return j;
    } catch (e){ log('ERR', e.message); await sleep(2000 * (k + 1)); }
  }
  return null;
}
const B = 'https://data.alpaca.markets';
const alp = (s) => s.replace('-', '.');
async function bars(symbols, tf, start, end){
  const out = Object.fromEntries(symbols.map((s) => [s, []])); let tok = null;
  do {
    const u = `${B}/v2/stocks/bars?symbols=${symbols.map(alp).map(encodeURIComponent).join(',')}&timeframe=${tf}&start=${start}&end=${end}&limit=10000&adjustment=split&feed=sip${tok ? '&page_token=' + tok : ''}`;
    const j = await api(u); if (!j) return null;
    for (const [s, arr] of Object.entries(j.bars || {})){ const key = s.replace('.', '-'); (out[key] ||= []).push(...arr); }
    tok = j.next_page_token;
  } while (tok);
  return out;
}

// ---- 1. הרכב היסטורי ----
const split = (line) => { const o = []; let c = '', q = false; for (const ch of line){ if (ch === '"'){ q = !q; continue; } if (ch === ',' && !q){ o.push(c); c = ''; continue; } c += ch; } o.push(c); return o; };
const normSym = (s) => s.trim().toUpperCase().replace(/\s.*$/, '').replace('.', '-');
async function membership(){
  const list = await (await fetch('https://api.github.com/repos/fja05680/sp500/contents/', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'research' } })).json();
  const names = list.map((x) => x.name).filter((n) => /S&P 500 Historical Components (?:&|&amp;) Changes[^/]*\.csv/.test(n));
  const name = names.find((n) => /Updated/i.test(n)) || names[0];
  const f = list.find((x) => x.name === name);
  const csv = await (await fetch(f.download_url)).text();
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  const rows = lines.slice(1).map((l) => { const c = split(l); const day = c.find((v) => /^\d{4}-\d{2}-\d{2}/.test(v))?.slice(0, 10); const lst = c.filter((v) => v !== day).sort((a, b) => b.length - a.length)[0] || ''; return { day, symbols: lst.split(',').map(normSym).filter((s) => /^[A-Z][A-Z0-9-]{0,6}$/.test(s)) }; }).filter((r) => r.day && r.symbols.length > 300).sort((a, b) => a.day < b.day ? -1 : 1);
  return { source: name, rows };
}

// ---- בקרת נתונים: מניות לפי יום, חוסרים ----
function rthFilter(arr){
  const t = [], o = [], h = [], l = [], c = [], v = [];
  for (const b of arr){ const ts = Date.parse(b.t) / 1000, mod = nyMinuteOfDay(ts); if (mod < 570 || mod >= 960) continue; t.push(ts); o.push(b.o); h.push(b.h); l.push(b.l); c.push(b.c); v.push(b.v); }
  return { t, o, h, l, c, v };
}
function save(sym, m){
  const n = m.t.length, buf = Buffer.alloc(n * 24);
  for (let i = 0; i < n; i++){ const p = i * 24; buf.writeInt32LE(Math.round(m.t[i] / 60), p); buf.writeFloatLE(m.o[i], p + 4); buf.writeFloatLE(m.h[i], p + 8); buf.writeFloatLE(m.l[i], p + 12); buf.writeFloatLE(m.c[i], p + 16); buf.writeFloatLE(m.v[i], p + 20); }
  writeFileSync(join(DATA, 'minute', sym + '.bin'), buf);
}

async function main(){
  mkdirSync(join(DATA, 'minute'), { recursive: true }); mkdirSync(join(DATA, 'daily'), { recursive: true }); mkdirSync(AUDIT, { recursive: true });
  const audit = { protocol: 'v1.1', fetchedAt: new Date().toISOString(), source: 'Alpaca SIP (adjustment=split)', years: {}, symbols: {}, splits: [], nameChanges: [], notes: [] };
  const mem = await membership(); audit.membershipSource = mem.source;
  const universe = {};
  for (const Y of YEARS){
    const asOf = `${Y - 1}-12-31`, row = [...mem.rows].reverse().find((r) => r.day <= asOf);
    const cands = row.symbols;
    const got = {};
    for (let i = 0; i < cands.length; i += 100){ const part = await bars(cands.slice(i, i + 100), '1Day', `${Y - 1}-09-01`, `${Y - 1}-12-31`); Object.assign(got, part || {}); }
    const dv = [], missing = [];
    for (const s of cands){
      const d = (got[s] || []).slice(-60);
      if (d.length < 40){ missing.push(s); continue; }
      const x = d.map((b) => b.c * b.v).sort((a, b) => a - b); dv.push([s, x[Math.floor(x.length / 2)]]);
    }
    // סימול בלי נתונים: חיפוש שינוי שם בפעולות התאגידיות
    const renamed = [];
    for (const s of missing.slice(0, 80)){
      const ca = await api(`${B}/v1/corporate-actions?symbols=${encodeURIComponent(alp(s))}&types=name_change&start=${Y - 3}-01-01&end=${LAST_DAY}`);
      const nc = ca?.corporate_actions?.name_changes?.[0];
      if (nc?.new_symbol){
        const part = await bars([nc.new_symbol.replace('.', '-')], '1Day', `${Y - 1}-09-01`, `${Y - 1}-12-31`);
        const d = (part?.[nc.new_symbol.replace('.', '-')] || []).slice(-60);
        if (d.length >= 40){ const x = d.map((b) => b.c * b.v).sort((a, b) => a - b); dv.push([nc.new_symbol.replace('.', '-'), x[Math.floor(x.length / 2)]]); renamed.push([s, nc.new_symbol]); audit.nameChanges.push({ year: Y, old: s, new: nc.new_symbol }); }
      }
    }
    dv.sort((a, b) => b[1] - a[1]);
    universe[Y] = dv.slice(0, TOP).map((x) => x[0]);
    audit.years[Y] = { asOf: row.day, members: cands.length, withData: dv.length, missing: missing.length - renamed.length, renamed: renamed.length, selected: universe[Y], missingSample: missing.filter((s) => !renamed.some((r) => r[0] === s)).slice(0, 40) };
    log(Y, 'members', cands.length, 'withData', dv.length, 'top', universe[Y].slice(0, 8).join(','));
  }
  writeFileSync(join(DATA, 'universe.json'), JSON.stringify(universe));
  // ---- 2. סימולים, טווחים ----
  const span = {};
  for (const Y of YEARS) for (const s of universe[Y]){ span[s] ||= [Y, Y]; span[s][0] = Math.min(span[s][0], Y); span[s][1] = Math.max(span[s][1], Y); }
  span.QQQ = [2018, 2026];
  const syms = Object.keys(span);
  log('symbols', syms.length);
  for (const s of syms){
    const [a, z] = span[s];
    const start = `${a - 1}-01-01`, endD = z === 2026 ? LAST_DAY : `${z + 1}-01-15`;
    const dfile = join(DATA, 'daily', s + '.json'), mfile = join(DATA, 'minute', s + '.bin');
    if (!existsSync(dfile)){ const d = await bars([s], '1Day', start, endD); writeFileSync(dfile, JSON.stringify((d?.[s] || []).map((b) => ({ key: nyDayKey(Date.parse(b.t) / 1000 + 6 * 3600), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })))); }
    if (!existsSync(mfile)){
      const mStart = `${a}-01-01` > '2018-01-01' ? new Date(Date.parse(`${a}-01-01`) - 110 * 864e5).toISOString().slice(0, 10) : '2017-09-12';
      const all = { t: [], o: [], h: [], l: [], c: [], v: [] };
      // לפי חלקים של שנה, כדי לא להחזיק את כל ה-JSON בזיכרון
      for (let y0 = Number(mStart.slice(0, 4)); y0 <= Number(endD.slice(0, 4)); y0++){
        const st = y0 === Number(mStart.slice(0, 4)) ? mStart : `${y0}-01-01`, en = y0 === Number(endD.slice(0, 4)) ? endD : `${y0}-12-31`;
        if (st > en) continue;
        const r = await bars([s], '1Min', `${st}T00:00:00Z`, `${en}T23:59:59Z`);
        const m = rthFilter(r?.[s] || []); for (const k of Object.keys(all)) all[k].push(...m[k]);
      }
      save(s, all);
      // חוסרים: לכל יום מסחר — כמה דקות מתוך 390 (או 210 ביום מקוצר)
      const per = new Map(); for (const t of all.t){ const k = nyDayKey(t); per.set(k, (per.get(k) || 0) + 1); }
      const counts = [...per.values()], short = counts.filter((n) => n < 0.95 * 390 && n > 230).length;
      audit.symbols[s] = { years: span[s], minuteBars: all.t.length, days: per.size, daysUnder95pct: short, nReq };
      log(s, span[s].join('-'), all.t.length, 'bars', per.size, 'days', 'short', short, 'req', nReq);
    }
  }
  // ---- 3. פיצולים (בקרה): קפיצות לילה מעל 40% בנתונים המתואמים = חשד לפיצול שלא תואם ----
  for (const s of syms){
    const d = JSON.parse(readFileSync(join(DATA, 'daily', s + '.json'), 'utf8'));
    for (let i = 1; i < d.length; i++){ const r = d[i].o / d[i - 1].c; if (r > 1.4 || r < 0.6) audit.splits.push({ sym: s, day: d[i].key, gap: +r.toFixed(3) }); }
  }
  const ca = await api(`${B}/v1/corporate-actions?symbols=${syms.map(alp).join(',')}&types=forward_split,reverse_split&start=2018-01-01&end=${LAST_DAY}`);
  audit.knownSplits = [...(ca?.corporate_actions?.forward_splits || []), ...(ca?.corporate_actions?.reverse_splits || [])].map((x) => ({ sym: x.symbol, day: x.ex_date, ratio: `${x.new_rate}:${x.old_rate}` }));
  audit.requests = nReq;
  writeFileSync(join(AUDIT, 'data-audit.json'), JSON.stringify(audit, null, 1));
  log('done', nReq, 'requests');
}
main().catch((e) => { console.error(e); process.exit(1); });
