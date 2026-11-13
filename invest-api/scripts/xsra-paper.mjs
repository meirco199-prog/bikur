#!/usr/bin/env node
// מעקב Paper יומי למומנטום המשודרג, 7 מנות (engine/xsra-paper.js): קורא את המצב מה-Worker, מושך 150 נרות יומיים סגורים (עם נפח) מ-Coinbase
// ל-50 המועמדים, מקדם את התיק הווירטואלי ושולח ל-POST /xsra עם סוד ה-cron. אין כסף, אין פקודות, אין מפתחות מסחר.
// env: WORKER_URL, CRON_SECRET. דגלים: --dry (בלי שליחה), --reset (מתחיל מחדש — רק בהחלטת בעל הריפו).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { XSRAP, step, totalWeights } from '../engine/xsra-paper.js';

const DAY = 86400e3, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'bikur-research/1.0 (paper)', Accept: 'application/json' };
async function getJson(url, tries = 4){
  for (let k = 0; k < tries; k++){
    try { const r = await fetch(url, { headers: UA }); if (r.status === 404 || r.status === 400) return null; if (r.status === 429){ await sleep(2000 * (k + 1)); continue; } if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (k === tries - 1) throw e; await sleep(1000 * (k + 1)); }
  }
}
// 150 ימים אחרונים (ממוצע 100 + מרווח), רק נרות שנסגרו (היום הנוכחי ב-UTC לא נכלל). Coinbase: [time, low, high, open, close, volume]
export async function fetchBars(nowMs = Date.now()){
  const end = Math.floor(nowMs / DAY) * DAY, start = end - 150 * DAY, out = {};
  for (const c of XSRAP.universe){
    let j = null; try { j = await getJson(`https://api.exchange.coinbase.com/products/${c}-USD/candles?granularity=86400&start=${new Date(start).toISOString()}&end=${new Date(end).toISOString()}`); } catch (e) { console.error(`${c}: ${e.message}`); }
    if (Array.isArray(j) && j.length) out[c] = j.map((r) => ({ t: r[0] * 1000, o: +r[3], h: +r[2], l: +r[1], c: +r[4], v: +r[5] })).filter((b) => b.t < end && b.c > 0).sort((a, b) => a.t - b.t);
    await sleep(150);
  }
  return out;
}

async function main(){
  const W = (process.env.WORKER_URL || 'https://invest-api.meirco199.workers.dev').replace(/\/$/, ''), S = process.env.CRON_SECRET || '';
  const dry = process.argv.includes('--dry'), reset = process.argv.includes('--reset');
  const prev = reset ? null : await getJson(`${W}/xsra`).catch(() => null);
  const bars = await fetchBars();
  if (!bars.BTC?.length) throw new Error('אין נרות BTC');
  console.log(`מטבעות עם נרות: ${Object.keys(bars).length}/${XSRAP.universe.length}`);
  const { state, events, processed } = step(prev, bars);
  const w = totalWeights(state);
  console.log(`ימים חדשים: ${processed} · הון ${state.equity}$ · BTC ${state.btcEquity}$ · מחזיק: ${Object.entries(w).map(([c, x]) => `${c} ${(x * 100).toFixed(0)}%`).join(', ') || 'מזומן'}`);
  for (const e of events) console.log(`מנה ${e.sleeve} (${e.day}): ${e.cash ? 'מזומן' : e.pick.map((p) => `${p.coin} ${p.score}`).join(', ')} · עלות ${e.costUsd}$`);
  if (dry || !processed) return;
  if (!S) throw new Error('חסר CRON_SECRET');
  const r = await fetch(`${W}/xsra?secret=${encodeURIComponent(S)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
  console.log('שמירה:', r.status, await r.text());
  if (!r.ok) process.exit(1);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((e) => { console.error(e); process.exit(1); });
