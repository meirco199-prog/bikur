#!/usr/bin/env node
// מעקב Paper יומי למומנטום בין מטבעות (engine/xsmom-paper.js): קורא את המצב מה-Worker, מושך נרות יומיים סגורים מ-Coinbase (ציבורי),
// מקדם את התיק הווירטואלי ושולח ל-POST /xsmom עם סוד ה-cron. אין כסף, אין פקודות, אין מפתחות מסחר.
// env: WORKER_URL, CRON_SECRET. דגלים: --dry (בלי שליחה), --reset (מתחיל מחדש — רק בהחלטת בעל הריפו).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { XS, step } from '../engine/xsmom-paper.js';

const DAY = 86400e3, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'bikur-research/1.0 (paper)', Accept: 'application/json' };
async function getJson(url, init = {}, tries = 4){
  for (let k = 0; k < tries; k++){
    try { const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) } }); if (r.status === 404) return null; if (r.status === 429){ await sleep(2000 * (k + 1)); continue; } if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (k === tries - 1) throw e; await sleep(1000 * (k + 1)); }
  }
}
// 260 ימים אחרונים, רק נרות שנסגרו (היום הנוכחי ב-UTC לא נכלל)
export async function fetchCloses(nowMs = Date.now()){
  const end = Math.floor(nowMs / DAY) * DAY, start = end - 260 * DAY, out = {};
  for (const c of XS.universe){
    const j = await getJson(`https://api.exchange.coinbase.com/products/${c}-USD/candles?granularity=86400&start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}`);
    if (Array.isArray(j)) out[c] = j.map((r) => ({ t: r[0] * 1000, c: +r[4] })).filter((b) => b.t < end && b.c > 0).sort((a, b) => a.t - b.t);
    await sleep(150);
  }
  return out;
}

async function main(){
  const W = (process.env.WORKER_URL || 'https://invest-api.meirco199.workers.dev').replace(/\/$/, ''), S = process.env.CRON_SECRET || '';
  const dry = process.argv.includes('--dry'), reset = process.argv.includes('--reset');
  const prev = reset ? null : await getJson(`${W}/xsmom`);
  const closes = await fetchCloses();
  if (!closes.BTC?.length) throw new Error('אין נרות BTC');
  const { state, events, processed } = step(prev, closes);
  console.log(`ימים חדשים: ${processed} · הון ${state.equity}$ · BTC ${state.btcEquity}$ · מחזיק: ${Object.keys(state.weights).join(', ') || 'מזומן'}`);
  for (const e of events) console.log(`החלפה ${e.day}: ${e.cash ? 'מזומן' : e.picks.map((p) => `${p.coin} ${(p.ret * 100).toFixed(1)}%`).join(', ')}${e.filterOn ? ' (BTC מתחת לממוצע 200)' : ''} · עלות ${e.costUsd}$`);
  if (dry || !processed) return;
  if (!S) throw new Error('חסר CRON_SECRET');
  const r = await fetch(`${W}/xsmom?secret=${encodeURIComponent(S)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
  console.log('שמירה:', r.status, await r.text());
  if (!r.ok) process.exit(1);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((e) => { console.error(e); process.exit(1); });
