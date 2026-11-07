#!/usr/bin/env node
// מעקב Paper יומי ל-Donchian 20/10 (engine/dc-paper.js): קורא את המצב מה-Worker, מושך נרות יומיים סגורים מ-Coinbase (ציבורי, אותו מקור
// ואותם 20 מטבעות כמו מעקב המומנטום), מקדם את התיק הווירטואלי ושולח ל-POST /dc עם סוד ה-cron. אין כסף, אין פקודות, אין מפתחות מסחר.
// env: WORKER_URL, CRON_SECRET. דגלים: --dry (בלי שליחה), --reset (מתחיל מחדש — רק בהחלטת בעל הריפו).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { step } from '../engine/dc-paper.js';
import { fetchCloses } from './xsmom-paper.mjs';

const UA = { 'User-Agent': 'bikur-research/1.0 (paper)', Accept: 'application/json' };
async function main(){
  const W = (process.env.WORKER_URL || 'https://invest-api.meirco199.workers.dev').replace(/\/$/, ''), S = process.env.CRON_SECRET || '';
  const dry = process.argv.includes('--dry'), reset = process.argv.includes('--reset');
  const prev = reset ? null : await (await fetch(`${W}/dc`, { headers: UA })).json().catch(() => null);
  const closes = await fetchCloses();
  if (!closes.BTC?.length) throw new Error('אין נרות BTC');
  const { state, events, processed } = step(prev, closes);
  console.log(`ימים חדשים: ${processed} · הון ${state.equity}$ · BTC ${state.btcEquity}$ · במגמה: ${Object.keys(state.weights).join(', ') || 'אין (מזומן)'}`);
  for (const e of events) console.log(`איזון ${e.day}: ${e.in.length ? `נכנסו ${e.in.join(', ')} ` : ''}${e.out.length ? `יצאו ${e.out.join(', ')} ` : ''}· מחזיק ${e.held.length}/${e.live} · עלות ${e.costUsd}$`);
  if (dry || !processed) return;
  if (!S) throw new Error('חסר CRON_SECRET');
  const r = await fetch(`${W}/dc?secret=${encodeURIComponent(S)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
  console.log('שמירה:', r.status, await r.text());
  if (!r.ok) process.exit(1);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((e) => { console.error(e); process.exit(1); });
