#!/usr/bin/env node
// בדיקה לאחור של טורניר 30 הגרסאות (engine/tournament.js) על נרות דקה היסטוריים של 5 מטבעות.
// מקור: Coinbase (ציבורי, בלי מפתח; נגיש גם מ-GitHub Actions) או Bybit (--source bybit, רק מהשרת — Bybit חוסמת ארה"ב).
// שימוש: node invest-api/scripts/tournament-backtest.mjs [--days 60] [--source coinbase|bybit] [--json out.json]
// הפלט: טבלת Markdown לפי נטו אחרי עמלות. מחקר בלבד — אין פקודות ואין מפתחות.
import { writeFileSync } from 'node:fs';
import { runTournament, VARIANTS, FEES, SIZE } from '../engine/tournament.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DAYS = Math.min(120, Math.max(1, Number(arg('--days', 60)))), SOURCE = arg('--source', 'coinbase'), JSON_OUT = arg('--json', '');
const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'bikur-research/1.0 (backtest)', Accept: 'application/json' };

async function getJson(url, tries = 4){
  for (let k = 0; k < tries; k++){
    try { const r = await fetch(url, { headers: UA }); if (r.status === 429){ await sleep(1500 * (k + 1)); continue; } if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (k === tries - 1) throw e; await sleep(800 * (k + 1)); }
  }
}

// Coinbase: עד 300 נרות לבקשה, [[time, low, high, open, close, volume]] מהחדש לישן
async function coinbase(coin, startMs, endMs){
  const out = new Map(), step = 300 * 60e3;
  for (let s = startMs; s < endMs; s += step){
    const e = Math.min(s + step, endMs);
    const j = await getJson(`https://api.exchange.coinbase.com/products/${coin}-USD/candles?granularity=60&start=${new Date(s).toISOString()}&end=${new Date(e).toISOString()}`);
    for (const r of j || []){ const t = r[0] * 1000; if (t >= startMs && t < endMs) out.set(t, { t, o: +r[3], h: +r[2], l: +r[1], c: +r[4] }); }
    await sleep(130);
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}
// Bybit: עד 1000 נרות לבקשה, [[start, o, h, l, c, ...]] מהחדש לישן
async function bybit(coin, startMs, endMs){
  const out = new Map(); let end = endMs;
  while (end > startMs){
    const j = await getJson(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${coin}USDT&interval=1&end=${end}&limit=1000`);
    const list = j?.result?.list || []; if (!list.length) break;
    for (const r of list){ const t = +r[0]; if (t >= startMs && t + 60e3 <= endMs) out.set(t, { t, o: +r[1], h: +r[2], l: +r[3], c: +r[4] }); }
    end = Math.min(...list.map((r) => +r[0])) - 1; await sleep(120);
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

const usd = (x) => (x < 0 ? '−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US');
async function main(){
  const endMs = Math.floor(Date.now() / 60e3) * 60e3, startMs = endMs - DAYS * 86400e3, data = {};
  for (const c of COINS){
    data[c] = await (SOURCE === 'bybit' ? bybit : coinbase)(c, startMs, endMs);
    console.error(`${c}: ${data[c].length} נרות דקה (${(data[c].length / (DAYS * 1440) * 100).toFixed(1)}% כיסוי)`);
  }
  const res = runTournament(data, DAYS);
  const lines = [`## טורניר 30 גרסאות — ${DAYS} ימים, ${COINS.join('/')} (${SOURCE}), ${new Date(startMs).toISOString().slice(0, 10)} → ${new Date(endMs).toISOString().slice(0, 10)}`,
    `עמלות ${FEES.maker}%/${FEES.taker}% (ממתינה/מיידית), סיכון ${SIZE.riskUsd}$ לעסקה עד ${SIZE.maxNotional.toLocaleString('en-US')}$. סטופ לפני יעד באותו נר.`, '',
    '| # | גרסה | עסקאות | הצלחה | ברוטו | עמלות | **נטו** | PF | ירידה מקס׳ | ליום | ' + COINS.join(' | ') + ' |',
    '|---|---|---|---|---|---|---|---|---|---|' + COINS.map(() => '---').join('|') + '|'];
  res.forEach((r, i) => { const s = r.total;
    lines.push(`| ${i + 1} | \`${r.variant.id}\` | ${s.trades} | ${s.winRate ?? '—'}% | ${usd(s.gross)} | ${usd(-s.fees)} | **${usd(s.net)}** | ${s.pf === Infinity ? '∞' : s.pf ?? '—'} | ${usd(-s.maxDD)} | ${usd(s.perDay)} | ` + COINS.map((c) => usd(r.byCoin[c].net)).join(' | ') + ' |'); });
  console.log(lines.join('\n'));
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ days: DAYS, source: SOURCE, startMs, endMs, variants: VARIANTS.length, results: res }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
