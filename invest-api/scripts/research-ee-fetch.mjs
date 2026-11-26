#!/usr/bin/env node
// מחקר "יתרון מאירועים" (פרוטוקול v1.0): הורדה למטמון הפרטי של Actions (לא לריפו): הרכב S&P 500 היסטורי, לוח הדוחות של נאסד"ק לכל יום,
// נרות יומיים של חברי המדד, נרות דקה של ימי תגובה עם פער ≥ 1% (הסף הנמוך ברשת), ונרות דקה מלאים של SPY ו-QQQ.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nyMinuteOfDay, nyDayKey } from '../engine/daytrading.js';
import { parseEps, reactionDay } from '../engine/event-edge.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', join(process.env.HOME || '.', 'eedata'));
const FROM = '2017-12-15', TO = '2026-10-13';
const H = { 'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID, 'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY };
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tLast = 0;
async function getJson(url, headers, gap = 320){
  for (let k = 0; k < 6; k++){
    const w = gap - (Date.now() - tLast); if (w > 0) await sleep(w); tLast = Date.now();
    try { const r = await fetch(url, { headers }); if (r.status === 429 || r.status >= 500){ await sleep(3000 * (k + 1)); continue; } if (!r.ok) return null; return await r.json(); }
    catch { await sleep(2000 * (k + 1)); }
  }
  return null;
}
const alp = (s) => s.replace('-', '.'), back = (s) => s.replace('.', '-');
async function bars(symbols, tf, start, end){
  const out = {}; let tok = null;
  do {
    const j = await getJson(`https://data.alpaca.markets/v2/stocks/bars?symbols=${symbols.map(alp).map(encodeURIComponent).join(',')}&timeframe=${tf}&start=${start}&end=${end}&limit=10000&adjustment=split&feed=sip${tok ? '&page_token=' + tok : ''}`, H);
    if (!j) return out;
    for (const [s, a] of Object.entries(j.bars || {})) (out[back(s)] ||= []).push(...a);
    tok = j.next_page_token;
  } while (tok);
  return out;
}
const split = (line) => { const o = []; let c = '', q = false; for (const ch of line){ if (ch === '"'){ q = !q; continue; } if (ch === ',' && !q){ o.push(c); c = ''; continue; } c += ch; } o.push(c); return o; };
const normSym = (s) => s.trim().toUpperCase().replace(/\s.*$/, '').replace('.', '-');
async function membership(){
  const list = await (await fetch('https://api.github.com/repos/fja05680/sp500/contents/', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'research', ...(process.env.GITHUB_TOKEN ? { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN } : {}) } })).json();
  if (!Array.isArray(list)) throw new Error('fja05680: ' + JSON.stringify(list).slice(0, 200));
  const names = list.map((x) => x.name).filter((n) => /S&P 500 Historical Components (?:&|&amp;) Changes[^/]*\.csv/.test(n));
  const f = list.find((x) => x.name === (names.find((n) => /Updated/i.test(n)) || names[0]));
  const csv = await (await fetch(f.download_url)).text();
  return csv.split(/\r?\n/).filter((l) => l.trim()).slice(1).map((l) => { const c = split(l); const day = c.find((v) => /^\d{4}-\d{2}-\d{2}/.test(v))?.slice(0, 10); const lst = c.filter((v) => v !== day).sort((a, b) => b.length - a.length)[0] || ''; return { key: Number((day || '').replace(/-/g, '')), symbols: lst.split(',').map(normSym).filter((s) => /^[A-Z][A-Z0-9-]{0,6}$/.test(s)) }; }).filter((r) => r.key && r.symbols.length > 300).sort((a, b) => a.key - b.key);
}
const rth = (arr) => arr.map((b) => [Date.parse(b.t) / 1000, b.o, b.h, b.l, b.c, b.v]).filter((x) => { const m = nyMinuteOfDay(x[0]); return m >= 570 && m < 960; });

async function main(){
  mkdirSync(join(DATA, 'daily'), { recursive: true }); mkdirSync(join(DATA, 'ev'), { recursive: true });
  if (existsSync(join(DATA, 'complete.flag'))){ log('במטמון'); return; }
  const audit = { protocol: 'event-edge v1.0', fetchedAt: new Date().toISOString() };
  // 1. הרכב
  const mem = await membership(); writeFileSync(join(DATA, 'membership.json'), JSON.stringify(mem));
  const memberOn = (key) => { let r = mem[0]; for (const x of mem){ if (x.key <= key) r = x; else break; } return new Set(r.symbols); };
  // 2. לוח הדוחות
  let cal = existsSync(join(DATA, 'earnings.json')) ? JSON.parse(readFileSync(join(DATA, 'earnings.json'), 'utf8')) : null;
  if (!cal){
    cal = []; const UA = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json, text/plain, */*' };
    for (let t = Date.parse(FROM); t <= Date.parse(TO); t += 864e5){
      const d = new Date(t), wd = d.getUTCDay(); if (wd === 0 || wd === 6) continue;
      const ds = d.toISOString().slice(0, 10), key = Number(ds.replace(/-/g, ''));
      const j = await getJson(`https://api.nasdaq.com/api/calendar/earnings?date=${ds}`, UA, 450);
      const rows = j?.data?.rows || [], mset = memberOn(key);
      for (const r of rows){ const s = normSym(r.symbol || ''); if (!mset.has(s)) continue; cal.push({ d: key, s, time: r.time, eps: parseEps(r.eps), f: parseEps(r.epsForecast) }); }
      if (d.getUTCDate() === 1) log('calendar', ds, cal.length);
    }
    writeFileSync(join(DATA, 'earnings.json'), JSON.stringify(cal));
  }
  audit.events = cal.length; audit.withBoth = cal.filter((e) => e.eps != null && e.f != null).length;
  audit.timeCounts = cal.reduce((a, e) => { a[e.time] = (a[e.time] || 0) + 1; return a; }, {});
  // 3. נרות יומיים לכל הסימולים
  const syms = [...new Set(cal.map((e) => e.s))].sort(); audit.symbols = syms.length;
  const need = syms.filter((s) => !existsSync(join(DATA, 'daily', s + '.json')));
  for (let i = 0; i < need.length; i += 50){
    const part = await bars(need.slice(i, i + 50), '1Day', '2017-09-01', TO);
    for (const s of need.slice(i, i + 50)) writeFileSync(join(DATA, 'daily', s + '.json'), JSON.stringify((part[s] || []).map((b) => ({ key: nyDayKey(Date.parse(b.t) / 1000 + 6 * 3600), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))));
    log('daily', i + 50, '/', need.length);
  }
  // 4. ימי תגובה עם |פער| ≥ 1% → נרות דקה (בקשה אחת לכל יום, כל הסימולים יחד)
  const byDay = new Map(); let noDaily = 0, small = 0;
  for (const e of cal){
    if (e.eps == null || e.f == null) continue;
    const daily = JSON.parse(readFileSync(join(DATA, 'daily', e.s + '.json'), 'utf8'));
    if (daily.length < 2){ noDaily++; continue; }
    const r = reactionDay(daily, e.d, e.time); if (!r) continue;
    const R = daily[r.idx], gap = R.o / daily[r.idx - 1].c - 1;
    if (Math.abs(gap) < 0.01){ small++; continue; }
    if (R.key > Number(TO.replace(/-/g, ''))) continue;
    (byDay.get(R.key) || byDay.set(R.key, []).get(R.key)).push(e.s);
  }
  audit.noDaily = noDaily; audit.smallGap = small; audit.reactionDays = byDay.size; audit.minuteEvents = [...byDay.values()].reduce((a, x) => a + x.length, 0);
  for (const [key, list] of byDay){
    const f = join(DATA, 'ev', key + '.json'); if (existsSync(f)) continue;
    const ds = String(key).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    const part = await bars([...new Set(list)], '1Min', `${ds}T13:00:00Z`, `${ds}T21:30:00Z`);
    writeFileSync(f, JSON.stringify(Object.fromEntries(Object.entries(part).map(([s, a]) => [s, rth(a)]))));
  }
  log('event minutes done');
  // 5. SPY ו-QQQ — נרות דקה מלאים, שנה אחרי שנה
  for (const s of ['SPY', 'QQQ']){
    const f = join(DATA, s + '_m.json'); if (existsSync(f)) continue;
    const all = [];
    for (let y = 2017; y <= 2026; y++){ const r = await bars([s], '1Min', `${y === 2017 ? '2017-12-01' : y + '-01-01'}T00:00:00Z`, `${y === 2026 ? TO : y + '-12-31'}T23:59:59Z`); all.push(...rth(r[s] || [])); log(s, y, all.length); }
    writeFileSync(f, JSON.stringify(all));
    const d = await bars([s], '1Day', '2017-09-01', TO); writeFileSync(join(DATA, 'daily', s + '.json'), JSON.stringify((d[s] || []).map((b) => ({ key: nyDayKey(Date.parse(b.t) / 1000 + 6 * 3600), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))));
  }
  mkdirSync('invest/docs/research/event-edge/results', { recursive: true });
  writeFileSync('invest/docs/research/event-edge/results/data-audit.json', JSON.stringify(audit, null, 1));
  writeFileSync(join(DATA, 'complete.flag'), new Date().toISOString());
  log('done', JSON.stringify(audit));
}
main().catch((e) => { console.error(e); process.exit(1); });
