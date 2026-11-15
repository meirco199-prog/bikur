#!/usr/bin/env node
// מעקב וירטואלי שני — מומנטום 7ל על 38 המטבעות של Bybit + 2 הגנות (engine/xsra-bybit-paper.js). פעם ביום: קורא את המצב מ-GET /xsrb,
// מושך נרות יומיים סגורים (עם נפח) מ-Coinbase מ-200 יום לפני יום ההתחלה, קורא את XSRA-7 המקורי (GET /xsra, קריאה בלבד, להשוואה),
// מקדם את התיק הווירטואלי ושולח ל-POST /xsrb עם סוד ה-cron. אין כסף, אין פקודות, אין מפתחות מסחר. לא נוגע ב-/xsra.
// env: WORKER_URL, CRON_SECRET. דגל: --dry (בלי שליחה).
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { XSRB, step, verdict } from '../engine/xsra-bybit-paper.js';

const DAY = 86400e3, sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'bikur-research/1.0 (paper)', Accept: 'application/json' };
async function getJson(url, tries = 4){
  for (let k = 0; k < tries; k++){
    try { const r = await fetch(url, { headers: UA }); if (r.status === 404 || r.status === 400) return null; if (r.status === 429){ await sleep(2000 * (k + 1)); continue; } if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (k === tries - 1) throw e; await sleep(1000 * (k + 1)); }
  }
}
// נרות יומיים סגורים מ-fromMs עד היום (לא כולל היום הנוכחי ב-UTC). Coinbase: עד 300 נרות בבקשה; [time, low, high, open, close, volume]
export async function fetchBars(fromMs, nowMs = Date.now(), coins = XSRB.universe){
  const end = Math.floor(nowMs / DAY) * DAY, out = {}, missing = [];
  for (const c of coins){
    const rows = new Map();
    for (let a = fromMs; a < end; a += 290 * DAY){
      const b = Math.min(end, a + 290 * DAY); let j = null;
      try { j = await getJson(`https://api.exchange.coinbase.com/products/${c}-USD/candles?granularity=86400&start=${new Date(a).toISOString()}&end=${new Date(b).toISOString()}`); } catch (e) { console.error(`${c}: ${e.message}`); }
      if (Array.isArray(j)) for (const r of j) if (r[0] * 1000 >= fromMs && r[0] * 1000 < end && +r[4] > 0) rows.set(r[0] * 1000, { t: r[0] * 1000, o: +r[3], h: +r[2], l: +r[1], c: +r[4], v: +r[5] });
      await sleep(150);
    }
    if (rows.size) out[c] = [...rows.values()].sort((x, y) => x.t - y.t); else missing.push(c);
  }
  return { bars: out, missing };
}

async function main(){
  const W = (process.env.WORKER_URL || 'https://invest-api.meirco199.workers.dev').replace(/\/$/, ''), S = process.env.CRON_SECRET || '';
  const dry = process.argv.includes('--dry'), now = Date.now();
  const prev = await getJson(`${W}/xsrb`);
  const from = (prev?.startDay ? Date.parse(prev.startDay + 'T00:00:00Z') : Math.floor(now / DAY) * DAY) - XSRB.lookbackDays * DAY;
  const { bars, missing } = await fetchBars(from, now);
  if (!bars.BTC?.length) throw new Error('אין נרות BTC');
  console.log(`מטבעות עם נרות: ${Object.keys(bars).length}/${XSRB.universe.length}${missing.length ? ` (חסרים: ${missing.join(', ')})` : ''}`);
  const xsra = await getJson(`${W}/xsra`).catch(() => null); // קריאה בלבד — להשוואה באותם מועדים
  const { state, processed, created, events } = step(prev, bars, xsra, now);
  if (created) console.log(`מעקב חדש: מתחיל ב-${state.startDay} עם ${state.startUsd}$ (העסקה הראשונה בפתיחת היום הזה)`);
  else {
    const v = verdict(state, XSRB, now);
    console.log(`ימים חדשים: ${processed} · הון ${state.equity}$ · ביטקוין ${state.btcEquity}$ · ירידה מקס׳ ${(state.maxDD * 100).toFixed(1)}% · מצב: ${v.status} · פער הרצה מחדש ${state.replayDrift}`);
    console.log(`משקלות: ${Object.entries(state.weights).map(([c, x]) => `${c} ${(x * 100).toFixed(1)}%`).join(', ') || 'מזומן'}`);
    for (const e of events) console.log(`${e.day} מנה ${e.sleeve} ${e.side} ${e.coin} ${e.usd}$ (עלות ${e.fee}$)`);
  }
  if (dry || !(processed || created)) return;
  if (!S) throw new Error('חסר CRON_SECRET');
  const r = await fetch(`${W}/xsrb?secret=${encodeURIComponent(S)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
  console.log('שמירה:', r.status, await r.text());
  if (!r.ok) process.exit(1);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((e) => { console.error(e); process.exit(1); });
