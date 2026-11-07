#!/usr/bin/env node
// מעקב Paper לפריצת תנודתיות תוך-יומית על BTC/ETH (engine/vbo-paper.js): קורא את המצב מה-Worker, מושך נרות שעה סגורים מ-Coinbase (ציבורי),
// מקדם את התיק הווירטואלי על כל השעות שנסגרו מאז הריצה הקודמת, ושולח ל-POST /vbo עם סוד ה-cron. אין כסף, אין פקודות, אין מפתחות מסחר.
// env: WORKER_URL, CRON_SECRET. דגלים: --dry (בלי שליחה), --reset (מתחיל מחדש — רק בהחלטת בעל הריפו).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { VBO, step } from '../engine/vbo-paper.js';

const HOUR = 3600e3, DAY = 86400e3, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'bikur-research/1.0 (paper)', Accept: 'application/json' };
async function getJson(url, init = {}, tries = 4){
  for (let k = 0; k < tries; k++){
    try { const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) } }); if (r.status === 404) return null; if (r.status === 429){ await sleep(2000 * (k + 1)); continue; } if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (k === tries - 1) throw e; await sleep(1000 * (k + 1)); }
  }
}
// 26 ימים אחרונים של נרות שעה, רק נרות שנסגרו (השעה הנוכחית לא נכללת); 300 נרות לבקשה
export async function fetchHourly(nowMs = Date.now()){
  const end = Math.floor(nowMs / HOUR) * HOUR, start = end - 26 * DAY, out = {};
  for (const c of VBO.coins){
    const m = new Map();
    for (let s = start; s < end; s += 300 * HOUR){
      const e = Math.min(s + 300 * HOUR, end), j = await getJson(`https://api.exchange.coinbase.com/products/${c}-USD/candles?granularity=3600&start=${new Date(s).toISOString()}&end=${new Date(e).toISOString()}`);
      for (const r of Array.isArray(j) ? j : []){ const t = r[0] * 1000; if (t >= start && t + HOUR <= end) m.set(t, { t, o: +r[3], h: +r[2], l: +r[1], c: +r[4] }); }
      await sleep(150);
    }
    out[c] = [...m.values()].sort((a, b) => a.t - b.t);
  }
  return out;
}

async function main(){
  const W = (process.env.WORKER_URL || 'https://invest-api.meirco199.workers.dev').replace(/\/$/, ''), S = process.env.CRON_SECRET || '';
  const dry = process.argv.includes('--dry'), reset = process.argv.includes('--reset');
  const prev = reset ? null : await getJson(`${W}/vbo`);
  const bars = await fetchHourly();
  if (!bars.BTC?.length) throw new Error('אין נרות BTC');
  if (prev?.lastHour && Date.parse(prev.lastHour) < bars.BTC[0].t) console.log(`⚠️ פער: הריצה הקודמת עיבדה עד ${prev.lastHour}, הנתונים מתחילים ב-${new Date(bars.BTC[0].t).toISOString()}`);
  const { state, events, processed } = step(prev, bars);
  console.log(`שעות חדשות: ${processed} · הון ${state.equity}$ · BTC ${state.btcEquity}$ · פתוח: ${Object.keys(state.pos).join(', ') || 'אין'} · עסקאות: ${state.trades.length}`);
  for (const e of events) console.log(e.type === 'entry' ? `כניסה ${e.coin} ${e.at}: ${e.price} (טריגר ${e.trig}) · ${e.usd}$` : `יציאה ${e.coin} ${e.out}: ${e.entry} → ${e.exit} · ${e.pnlUsd}$ (${(e.pnlPct * 100).toFixed(2)}%)`);
  if (dry || !processed) return;
  if (!S) throw new Error('חסר CRON_SECRET');
  const r = await fetch(`${W}/vbo?secret=${encodeURIComponent(S)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
  console.log('שמירה:', r.status, await r.text());
  if (!r.ok) process.exit(1);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((e) => { console.error(e); process.exit(1); });
