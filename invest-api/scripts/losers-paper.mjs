#!/usr/bin/env node
// מעקב Paper יומי ל"3 המניות שירדו 3%–7%" (engine/losers-paper.js): קורא את המצב מה-Worker, מושך נרות יומיים של S&P 1500 מ-Yahoo (ציבורי,
// אותו מקור כמו המחקר), מקדם את התיק הווירטואלי ושולח ל-POST /losers עם סוד ה-cron. אין כסף, אין פקודות, אין מפתחות מסחר.
// env: WORKER_URL, CRON_SECRET. דגלים: --dry (בלי שליחה), --reset (מתחיל מחדש — רק בהחלטת בעל הריפו).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { step } from '../engine/losers-paper.js';
import { universe, sleep } from './losers-common.mjs';
import { daily } from './research-losers-grid.mjs';

const UA = { 'User-Agent': 'bikur-research/1.0 (paper)', Accept: 'application/json' };
async function main(){
  const W = (process.env.WORKER_URL || 'https://invest-api.meirco199.workers.dev').replace(/\/$/, ''), S = process.env.CRON_SECRET || '';
  const dry = process.argv.includes('--dry'), reset = process.argv.includes('--reset');
  const prev = reset ? null : await (await fetch(`${W}/losers`, { headers: UA })).json().catch(() => null);
  const syms = await universe(), bars = {}, q = [...syms, 'SPY'];
  await Promise.all(Array.from({ length: 6 }, async () => { for (let s; (s = q.shift());){ const b = await daily(s, '3mo'); if (b?.d?.length > 25) bars[s] = b; await sleep(80); } }));
  console.log(`נטענו ${Object.keys(bars).length - 1}/${syms.length} מניות`);
  if (!bars.SPY?.d?.length) throw new Error('אין נרות SPY');
  if (Object.keys(bars).length < 1000) throw new Error(`נטענו מעט מדי מניות (${Object.keys(bars).length}) — לא מקדמים מצב על נתונים חסרים`);
  const { state, events, processed } = step(prev, bars);
  console.log(`ימים חדשים: ${processed} · הון ${state.equity}$ · SPY ${state.spyEquity}$ · מוחזקות: ${state.pos.map((p) => p.s).join(', ') || 'אין'}`);
  for (const e of events) console.log(e.type === 'entry' ? `קנייה ${e.day}: ${e.s} (${(e.r * 100).toFixed(1)}%) ${e.sh} מניות ב-${e.price}` : `מכירה ${e.out}: ${e.s} ${e.pnlUsd}$`);
  if (dry || !processed) return;
  if (!S) throw new Error('חסר CRON_SECRET');
  const r = await fetch(`${W}/losers?secret=${encodeURIComponent(S)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
  console.log('שמירה:', r.status, await r.text());
  if (!r.ok) process.exit(1);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((e) => { console.error(e); process.exit(1); });
