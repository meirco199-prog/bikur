#!/usr/bin/env node
// בדיקות המשך ל"3 המטבעות החזקים" (XS14-top3-f200) — בקשת מאיר (8/11, אחרי ניתוח GPT): יום החלפה כמו במעקב (ראשון UTC),
// משקלות שזזים עם המחירים (drift) כמו בתיק אמיתי, בלי ZEC, 5 מטבעות במקום 3, וטיפול חלקי בהטיית השורדים: יקום רחב יותר
// שכולל מטבעות שקרסו או ירדו מהמסחר ב-Coinbase (מה שעדיין יש לו נרות). השוואה: Donchian 20/10 וקנה-והחזק BTC. מחקר בלבד.
// שימוש: node invest-api/scripts/research-xs-check.mjs --data daily-data.json.gz [--extra extra-data.json.gz] [--out r.md]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { align, strategies, runDaily, dstats } from '../engine/research-daily.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'daily-data.json.gz'), EXTRA = arg('--extra', ''), OUT = arg('--out', '');
const DAY = 86400e3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (...a) => console.error(...a);
// מטבעות נוספים שהיו גדולים ב-Coinbase בשלב כלשהו — כולל כאלה שקרסו או שהמסחר בהם הופסק (אם עדיין יש להם היסטוריה)
const EXTRA_COINS = ['ICP', 'GRT', 'SUSHI', 'CRV', 'COMP', 'SNX', 'BAT', 'ZRX', 'MKR', 'YFI', 'UMA', 'SHIB', 'MANA', 'SAND', 'AXS', 'CHZ', 'OMG', 'REP', 'DASH', 'EOS', 'ZEN', 'KNC', 'BAND', 'NMR', 'LRC', 'ENJ', '1INCH', 'MATIC', 'BNT', 'STORJ'];
const UA = { 'User-Agent': 'bikur-research/1.0 (backtest)', Accept: 'application/json' };
async function getJson(url, tries = 5){
  for (let k = 0; k < tries; k++){
    try { const r = await fetch(url, { headers: UA }); if (r.status === 429){ await sleep(2000 * (k + 1)); continue; } if (r.status === 404 || r.status === 400) return null; if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (k === tries - 1) throw e; await sleep(1000 * (k + 1)); }
  }
}
async function daily(coin, start, end){
  const out = new Map();
  for (let s = start; s < end; s += 300 * DAY){
    const e = Math.min(s + 300 * DAY, end), j = await getJson(`https://api.exchange.coinbase.com/products/${coin}-USD/candles?granularity=86400&start=${new Date(s).toISOString()}&end=${new Date(e).toISOString()}`);
    if (j === null) return null;
    for (const r of j || []){ const t = r[0] * 1000; if (t >= start && t < end) out.set(t, { t, o: +r[3], h: +r[2], l: +r[1], c: +r[4] }); }
    await sleep(150);
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

const d = JSON.parse(gunzipSync(readFileSync(DATA)));
const start = Math.min(...Object.values(d.bars).map((b) => b[0].t)), end = Math.max(...Object.values(d.bars).map((b) => b.at(-1).t)) + DAY;
let extra = {};
if (EXTRA && existsSync(EXTRA)) extra = JSON.parse(gunzipSync(readFileSync(EXTRA)));
else if (EXTRA){
  for (const c of EXTRA_COINS){ try { const b = await daily(c, start, end); if (b && b.length > 200){ extra[c] = b; log(`${c}: ${b.length} ימים, ${new Date(b[0].t).toISOString().slice(0, 10)} → ${new Date(b.at(-1).t).toISOString().slice(0, 10)}`); } else log(`${c}: אין נתונים`); } catch (e) { log(`${c}: ${e.message}`); } }
  writeFileSync(EXTRA, gzipSync(JSON.stringify(extra)));
}
// נתונים שגויים (כמו BTC 15/4/2017, שפל $0.06): לא משפיעים על הספוט (סגירות בלבד), אבל מנקים ליתר ביטחון
for (const bars of [...Object.values(d.bars), ...Object.values(extra)]) for (const b of bars){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }
const F = {}; for (const [c, rows] of Object.entries(d.funding || {})) F[c] = new Map(rows);

const iso = (t) => new Date(t).toISOString().slice(0, 10), pct = (x) => (x == null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toLocaleString('en-US', { maximumFractionDigits: Math.abs(x) > 10 ? 0 : 1 })}%`);
const fs = (x) => (x == null ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2)), fci = (c) => (c ? `[${fs(c[0])}, ${fs(c[1])}]` : '—');
const base = align(d.bars), days = base.days, D = days.length, at = (k) => days[Math.min(D - 1, Math.floor(D * k))];
const P = { all: { from: days[0], to: days.at(-1) + DAY }, train: { from: days[0], to: at(0.6) }, val: { from: at(0.6), to: at(0.8) }, test: { from: at(0.8), to: days.at(-1) + DAY }, since22: { from: Date.UTC(2022, 0, 1), to: days.at(-1) + DAY } };
const without = (bars, c) => Object.fromEntries(Object.entries(bars).filter(([k]) => k !== c));
const run = (bars, id, { dow = null, drift = false } = {}) => { const A = align(bars), s = strategies(A.coins, { rebalDow: dow }).find((q) => q.id === id); return s ? runDaily(A, s, { funding: F, drift }).series : null; };
const row = (lab, sr) => { const a = dstats(sr, P.all), tr = dstats(sr, P.train), v = dstats(sr, P.val), t = dstats(sr, P.test), s22 = dstats(sr, P.since22);
  return `| ${lab} | ${pct(a.cagr)} / ${pct(-a.maxDD)} | ${pct(tr.cagr)} | ${pct(v.cagr)} | **${pct(t.cagr)}** / ${fs(t.sharpe)} ${fci(t.ci)} / ${pct(-t.maxDD)} | ${pct(s22.cagr)} / ${pct(-s22.maxDD)} | ${pct(-a.costTotal)} |`; };
const HDR = ['| גרסה | 2016–2026: שנתי / ירידה מקס׳ | אימון שנתי | אימות שנתי | מבחן: שנתי / שארפ [95%] / ירידה | מ-2022: שנתי / ירידה | עלויות מצטברות |', '|---|---|---|---|---|---|---|'];
const ext = { ...d.bars, ...extra };

const L = [`# בדיקות המשך — "3 המטבעות החזקים" (XS14-top3-f200), ${iso(days[0])} → ${iso(days.at(-1))}`,
  `אימון ${iso(P.train.from)}→${iso(P.train.to)} · אימות →${iso(P.val.to)} · מבחן →${iso(days.at(-1))}. ספוט: עמלה 0.1% + החלקה לכל צד. "ראשון" = החלפה בסגירת יום ראשון UTC (כמו המעקב). "drift" = המשקלות זזים עם המחירים בין החלפות (כמו תיק אמיתי).`,
  `יקום מורחב: ${Object.keys(extra).length} מטבעות נוספים — ${Object.entries(extra).map(([c, b]) => `${c} (${iso(b[0].t).slice(0, 7)}→${iso(b.at(-1).t).slice(0, 7)})`).join(', ') || '—'}.`, ''];
L.push('## 1. פערי הקוד: יום ההחלפה ומשקלות שזזים', ...HDR);
L.push(row('מקורי (כל 7 ימים מ-1/1/2016 = יום שישי, משקל קבוע)', run(d.bars, 'XS14-top3-f200')));
L.push(row('ראשון, משקל קבוע', run(d.bars, 'XS14-top3-f200', { dow: 0 })));
L.push(row('**ראשון + drift (= המעקב)**', run(d.bars, 'XS14-top3-f200', { dow: 0, drift: true })));
L.push('', '## 2. רגישות ליום ההחלפה (drift)', ...HDR);
const DN = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
for (let dow = 0; dow < 7; dow++) L.push(row(`יום ${DN[dow]}`, run(d.bars, 'XS14-top3-f200', { dow, drift: true })));
L.push('', '## 3. בלי ZEC, 5 מטבעות, ויקום רחב יותר (הטיית שורדים) — ראשון + drift', ...HDR);
L.push(row('3 מטבעות, 20 המטבעות (בסיס)', run(d.bars, 'XS14-top3-f200', { dow: 0, drift: true })));
L.push(row('3 מטבעות, בלי ZEC', run(without(d.bars, 'ZEC'), 'XS14-top3-f200', { dow: 0, drift: true })));
L.push(row('5 מטבעות', run(d.bars, 'XS14-top5-f200', { dow: 0, drift: true })));
L.push(row('5 מטבעות, בלי ZEC', run(without(d.bars, 'ZEC'), 'XS14-top5-f200', { dow: 0, drift: true })));
if (Object.keys(extra).length){
  L.push(row(`3 מטבעות, יקום מורחב (${Object.keys(ext).length})`, run(ext, 'XS14-top3-f200', { dow: 0, drift: true })));
  L.push(row('3 מטבעות, יקום מורחב בלי ZEC', run(without(ext, 'ZEC'), 'XS14-top3-f200', { dow: 0, drift: true })));
  L.push(row('5 מטבעות, יקום מורחב בלי ZEC', run(without(ext, 'ZEC'), 'XS14-top5-f200', { dow: 0, drift: true })));
}
L.push('', '## 4. השוואה', ...HDR);
L.push(row('Donchian 20/10 (משקל קבוע, כמו בדוח)', run(d.bars, 'DC20-10-EW')));
L.push(row('Donchian 20/10 + drift', run(d.bars, 'DC20-10-EW', { drift: true })));
L.push(row('Donchian 20/10 + drift, בלי ZEC', run(without(d.bars, 'ZEC'), 'DC20-10-EW', { drift: true })));
if (Object.keys(extra).length) L.push(row('Donchian 20/10 + drift, יקום מורחב', run(ext, 'DC20-10-EW', { drift: true })));
L.push(row('קנה והחזק BTC', run(d.bars, 'BH-BTC')));
L.push(row('קנה והחזק — סל שווה של 20 המטבעות (drift)', run(d.bars, 'BH-EW', { drift: true })));
// לפי שנה: הבסיס המתוקן מול בלי ZEC, 5 מטבעות ו-Donchian
L.push('', '## 5. לפי שנה (ראשון + drift)');
const ys = [...new Set(days.map((x) => new Date(x).getUTCFullYear()))];
L.push('| גרסה | ' + ys.join(' | ') + ' |', '|---|' + ys.map(() => '---').join('|') + '|');
const yr = (lab, sr) => L.push(`| ${lab} | ` + ys.map((y) => { const q = dstats(sr, { from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) }); return q.n >= 30 ? pct(q.total) : '—'; }).join(' | ') + ' |');
yr('3 מטבעות', run(d.bars, 'XS14-top3-f200', { dow: 0, drift: true }));
yr('3 בלי ZEC', run(without(d.bars, 'ZEC'), 'XS14-top3-f200', { dow: 0, drift: true }));
yr('5 בלי ZEC', run(without(d.bars, 'ZEC'), 'XS14-top5-f200', { dow: 0, drift: true }));
if (Object.keys(extra).length) yr('3, יקום מורחב בלי ZEC', run(without(ext, 'ZEC'), 'XS14-top3-f200', { dow: 0, drift: true }));
yr('Donchian 20/10', run(d.bars, 'DC20-10-EW', { drift: true }));
yr('BTC', run(d.bars, 'BH-BTC'));
const md = L.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md);
