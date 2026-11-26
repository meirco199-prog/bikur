#!/usr/bin/env node
// מחקר "יתרון מאירועים" (פרוטוקול v1.2) — הורדה: הורדה למטמון הפרטי של Actions (לא לריפו): הרכב S&P 500 היסטורי, לוח הדוחות של נאסד"ק לכל יום,
// נרות יומיים של חברי המדד, נרות דקה של ימי תגובה עם פער ≥ 1% (הסף הנמוך ברשת), ונרות דקה מלאים של SPY ו-QQQ.
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nyMinuteOfDay, nyDayKey } from '../engine/daytrading.js';
import { parseEps, timingFromVolume, groupOf } from '../engine/event-edge.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', join(process.env.HOME || '.', 'eedata'));
const rthAll = (arr) => arr.map((b) => [Date.parse(b.t) / 1000, b.o, b.h, b.l, b.c, b.v]);
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


// v1.2: כל המניות בלוח הדוחות (לא רק S&P 500); שעת הדוח ממחזור לפני הפתיחה/אחרי הסגירה; קבוצות לפי נזילות; נרות דקה ליום התגובה
const kd = (key) => String(key).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
async function main(){
  mkdirSync(join(DATA, 'daily'), { recursive: true }); mkdirSync(join(DATA, 'ev2'), { recursive: true }); mkdirSync(join(DATA, 'hr'), { recursive: true });
  if (existsSync(join(DATA, 'complete2.flag'))){ log('במטמון (v1.2)'); return; }
  const audit = { protocol: 'event-edge v1.2', fetchedAt: new Date().toISOString() };
  const mem = existsSync(join(DATA, 'membership.json')) ? JSON.parse(readFileSync(join(DATA, 'membership.json'), 'utf8')) : await membership();
  writeFileSync(join(DATA, 'membership.json'), JSON.stringify(mem));
  const memberOn = (key) => { let r = mem[0]; for (const x of mem){ if (x.key <= key) r = x; else break; } return new Set(r.symbols); };
  // 1. לוח מלא
  let cal = existsSync(join(DATA, 'earnings_all.json')) ? JSON.parse(readFileSync(join(DATA, 'earnings_all.json'), 'utf8')) : null;
  if (!cal){
    cal = []; const UA = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json, text/plain, */*' };
    for (let t = Date.parse(FROM); t <= Date.parse(TO); t += 864e5){
      const d = new Date(t), wd = d.getUTCDay(); if (wd === 0 || wd === 6) continue;
      const ds = d.toISOString().slice(0, 10), key = Number(ds.replace(/-/g, '')), mset = memberOn(key);
      const j = await getJson(`https://api.nasdaq.com/api/calendar/earnings?date=${ds}`, UA, 450);
      for (const r of j?.data?.rows || []){ const s = normSym(r.symbol || ''); if (!/^[A-Z][A-Z0-9-]{0,6}$/.test(s)) continue; const eps = parseEps(r.eps), f = parseEps(r.epsForecast); if (eps == null || f == null) continue; cal.push({ d: key, s, time: r.time, eps, f, sp: mset.has(s) }); }
      if (d.getUTCDate() === 1) log('calendar', ds, cal.length);
    }
    writeFileSync(join(DATA, 'earnings_all.json'), JSON.stringify(cal));
  }
  audit.events = cal.length; audit.sp500Events = cal.filter((e) => e.sp).length;
  // 2. נרות יומיים לכל הסימולים
  const syms = [...new Set(cal.map((e) => e.s))].sort(); audit.symbols = syms.length;
  const need = syms.filter((s) => !existsSync(join(DATA, 'daily', s + '.json')));
  for (let i = 0; i < need.length; i += 50){
    const part = await bars(need.slice(i, i + 50), '1Day', '2017-09-01', TO);
    for (const s of need.slice(i, i + 50)) writeFileSync(join(DATA, 'daily', s + '.json'), JSON.stringify((part[s] || []).map((b) => ({ key: nyDayKey(Date.parse(b.t) / 1000 + 6 * 3600), o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }))));
    if (i % 1000 === 0) log('daily', i, '/', need.length);
  }
  // 3. סינון נזילות לפני יום הדוח (מחיר ≥ 5$, מחזור ≥ 5M$ או S&P 500) → נרות שעה סביב D לשעת הדוח
  // מעבר לפי סימול — כל קובץ יומי נטען פעם אחת (זיכרון)
  const daily = (sym) => JSON.parse(readFileSync(join(DATA, 'daily', sym + '.json'), 'utf8'));
  const bySym = new Map(); for (const e of cal) (bySym.get(e.s) || bySym.set(e.s, []).get(e.s)).push(e);
  const cands = []; let noData = 0, illiquid = 0;
  for (const [sym, evs] of bySym){
    const d = daily(sym);
    for (const e of evs){
      const i = d.findIndex((x) => x.key >= e.d); if (i < 21){ noData++; continue; }
      const prior = d.slice(i - 20, i), dv = prior.map((x) => x.c * x.v).sort((a, b) => a - b)[10], px = d[i - 1].c;
      const g = groupOf(e.sp, dv, px); if (!g){ illiquid++; continue; }
      cands.push({ ...e, g, dv });
    }
  }
  audit.noDailyData = noData; audit.illiquid = illiquid; audit.candidates = cands.length;
  const byD = new Map(); for (const e of cands) (byD.get(e.d) || byD.set(e.d, []).get(e.d)).push(e);
  const timing = {}; let tAmc = 0, tBmo = 0, tNone = 0, agree = 0, explicitN = 0;
  for (const [D, list] of [...byD].sort((a, b) => a[0] - b[0])){
    if (D > Number(TO.replace(/-/g, ''))) continue;
    // נשמר רק הסיווג לכל אירוע (לא נרות השעה עצמם — חוסך מקום במטמון)
    const f = join(DATA, 'hr', D + '.json'); let tv;
    if (existsSync(f)) tv = JSON.parse(readFileSync(f, 'utf8'));
    else {
      const st = new Date(Date.parse(kd(D)) - 35 * 864e5).toISOString().slice(0, 10);
      const r = await bars([...new Set(list.map((e) => e.s))], '1Hour', `${st}T00:00:00Z`, `${kd(D)}T23:59:59Z`);
      tv = Object.fromEntries([...new Set(list.map((e) => e.s))].map((s) => [s, timingFromVolume((r[s] || []).map((b) => ({ t: Date.parse(b.t) / 1000, v: b.v })), D, nyDayKey, nyMinuteOfDay)]));
      writeFileSync(f, JSON.stringify(tv));
    }
    for (const e of list){
      const ex = e.time === 'time-pre-market' ? 'bmo' : e.time === 'time-after-hours' ? 'amc' : null;
      if (ex){ explicitN++; if (tv[e.s] === ex) agree++; }
      const t = ex || tv[e.s]; if (t === 'amc') tAmc++; else if (t === 'bmo') tBmo++; else tNone++;
      if (t) timing[`${D}|${e.s}`] = t;
    }
  }
  audit.timing = { amc: tAmc, bmo: tBmo, undetermined: tNone, explicit: explicitN, explicitAgree: agree };
  writeFileSync(join(DATA, 'timing.json'), JSON.stringify(timing));
  // 4. יום התגובה ופער ≥ 1% → נרות דקה (שעות רגילות) לפי יום
  const byR = new Map(); let small = 0;
  const cBySym = new Map(); for (const e of cands) (cBySym.get(e.s) || cBySym.set(e.s, []).get(e.s)).push(e);
  for (const [sym, evs] of cBySym){
    const d = daily(sym);
    for (const e of evs){
      const t = timing[`${e.d}|${e.s}`]; if (!t) continue;
      let i = d.findIndex((x) => x.key >= e.d); if (i < 1) continue;
      if (t === 'amc'){ if (d[i].key === e.d) i++; } else if (d[i].key !== e.d) continue;
      if (i >= d.length) continue;
      const R = d[i], gap = R.o / d[i - 1].c - 1; if (Math.abs(gap) < 0.01){ small++; continue; }
      e.R = R.key; e.prevClose = d[i - 1].c;
      (byR.get(R.key) || byR.set(R.key, []).get(R.key)).push(e.s);
    }
  }
  audit.smallGap = small; audit.reactionDays = byR.size; audit.minuteEvents = [...byR.values()].reduce((a, x) => a + x.length, 0);
  for (const [key, list] of byR){
    const f = join(DATA, 'ev2', key + '.json'); if (existsSync(f)) continue;
    const part = await bars([...new Set(list)], '1Min', `${kd(key)}T13:00:00Z`, `${kd(key)}T21:30:00Z`);
    writeFileSync(f, JSON.stringify(Object.fromEntries(Object.entries(part).map(([s, a]) => [s, rth(a)]))));
  }
  writeFileSync(join(DATA, 'cands.json'), JSON.stringify(cands));
  mkdirSync('invest/docs/research/event-edge/results', { recursive: true });
  writeFileSync('invest/docs/research/event-edge/results/data-audit-v1.2.json', JSON.stringify(audit, null, 1));
  writeFileSync(join(DATA, 'complete2.flag'), new Date().toISOString());
  log('done', JSON.stringify(audit));
}
main().catch((e) => { console.error(e); process.exit(1); });
