#!/usr/bin/env node
// כיוון 2 (אישור מאיר 14/11/2026): איסוף היסטוריית דמי המימון (Funding) של BTC ו-ETH מכמה בורסות — קריאה ציבורית בלבד, בלי מפתחות.
// לכל מקור: מאיזה תאריך יש נתונים, כמה תצפיות, והאם הגישה חסומה. הפלט: סכום יומי (UTC) של שיעורי המימון לכל מקור ומטבע
// (חיובי = הלונגים משלמים לשורטים), ודוח קצר. שימוש: node invest-api/scripts/funding-history-probe.mjs --out dir
import { writeFileSync, mkdirSync } from 'node:fs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out', '.'), DAY = 86400e3, NOW = Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (...a) => console.error(...a);
async function get(url){
  for (let k = 0; k < 5; k++){
    const r = await fetch(url, { headers: { 'User-Agent': 'research-client' } }).catch((e) => ({ ok: false, status: 0, err: e.message }));
    if (r.status === 429 || r.status >= 500){ await sleep(3000 * (k + 1)); continue; }
    if (!r.ok) throw new Error(`HTTP ${r.status}${r.err ? ' ' + r.err : ''}`);
    return r.json();
  }
  throw new Error('יותר מדי ניסיונות');
}
const S = {
  // BitMEX: 8 שעות, XBTUSD מ-2016, ETHUSD מ-2018
  bitmex: { BTC: 'XBTUSD', ETH: 'ETHUSD', async fetch(sym){ const out = []; for (let start = 0; ; start += 500){ const j = await get(`https://www.bitmex.com/api/v1/funding?symbol=${sym}&count=500&start=${start}&reverse=false`);
    for (const x of j) out.push([Date.parse(x.timestamp), Number(x.fundingRate)]); if (j.length < 500) break; await sleep(2200); } return out; } },
  // Bybit: חוזה הפוך (BTCUSD/ETHUSD) מ-2018, מהחדש לישן לפי endTime
  bybit: { BTC: 'BTCUSD', ETH: 'ETHUSD', async fetch(sym){ const out = []; let end = NOW; for (;;){ const j = await get(`https://api.bybit.com/v5/market/funding/history?category=inverse&symbol=${sym}&limit=200&endTime=${end}`);
    const l = j?.result?.list ?? []; if (j.retCode && j.retCode !== 0) throw new Error(j.retMsg); for (const x of l) out.push([Number(x.fundingRateTimestamp), Number(x.fundingRate)]); if (l.length < 200) break; end = Math.min(...l.map((x) => Number(x.fundingRateTimestamp))) - 1; await sleep(300); }
    return out.sort((a, b) => a[0] - b[0]); } },
  // Binance: חוזה דולרי, מ-2019
  binance: { BTC: 'BTCUSDT', ETH: 'ETHUSDT', async fetch(sym){ const out = []; let st = 0; for (;;){ const j = await get(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=1000&startTime=${st}`);
    for (const x of j) out.push([x.fundingTime, Number(x.fundingRate)]); if (j.length < 1000) break; st = j.at(-1).fundingTime + 1; await sleep(300); } return out; } },
  // Deribit: שיעור 8 שעות לכל שעה (interest_8h) — סוכם יומית כממוצע × 3; מ-2019
  deribit: { BTC: 'BTC-PERPETUAL', ETH: 'ETH-PERPETUAL', daily: 'mean8h', async fetch(sym){ const out = []; for (let s = Date.UTC(2018, 7, 1); s < NOW; s += 30 * DAY){
    const j = await get(`https://www.deribit.com/api/v2/public/get_funding_rate_history?instrument_name=${sym}&start_timestamp=${s}&end_timestamp=${Math.min(NOW, s + 30 * DAY)}`);
    for (const x of j.result ?? []) out.push([x.timestamp, Number(x.interest_8h)]); await sleep(250); } return out; } },
};
mkdirSync(OUT, { recursive: true });
const RES = {}, DAILY = {}, L = ['# היסטוריית דמי המימון — אילו מקורות זמינים', '', '| מקור | מטבע | מצב | מתאריך | עד | תצפיות | ימים |', '|---|---|---|---|---|---|---|'];
const iso = (t) => new Date(t).toISOString().slice(0, 10);
for (const [src, cfg] of Object.entries(S)) for (const c of ['BTC', 'ETH']){
  try {
    const raw = await cfg.fetch(cfg[c]), seen = new Set(), rows = raw.filter(([t, r]) => Number.isFinite(t) && Number.isFinite(r) && !seen.has(t) && seen.add(t));
    const m = new Map(), n = new Map(); for (const [t, r] of rows){ const d = Math.floor(t / DAY) * DAY; m.set(d, (m.get(d) ?? 0) + r); n.set(d, (n.get(d) ?? 0) + 1); }
    const daily = [...m].sort((a, b) => a[0] - b[0]).map(([d, s]) => [iso(d), cfg.daily === 'mean8h' ? Math.round(s / n.get(d) * 3 * 1e8) / 1e8 : Math.round(s * 1e8) / 1e8]);
    (DAILY[src] ??= {})[c] = daily; RES[`${src}:${c}`] = { ok: true, n: rows.length, from: daily[0]?.[0], to: daily.at(-1)?.[0], days: daily.length };
    L.push(`| ${src} | ${c} | ✅ | ${daily[0]?.[0] ?? '—'} | ${daily.at(-1)?.[0] ?? '—'} | ${rows.length} | ${daily.length} |`); log(src, c, rows.length, daily[0]?.[0]);
  } catch (e){ RES[`${src}:${c}`] = { ok: false, err: String(e.message).slice(0, 120) }; L.push(`| ${src} | ${c} | ❌ ${String(e.message).slice(0, 60)} | | | | |`); log(src, c, e.message); }
}
writeFileSync(`${OUT}/funding-sources.md`, L.join('\n') + '\n');
writeFileSync(`${OUT}/funding-daily.json`, JSON.stringify({ note: 'סכום יומי (UTC) של שיעורי המימון; חיובי = לונגים משלמים. deribit: ממוצע interest_8h × 3', fetched: new Date(NOW).toISOString(), sources: RES, daily: DAILY }));
console.log(L.join('\n'));
