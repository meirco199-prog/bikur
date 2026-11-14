#!/usr/bin/env node
// כיוון 3 (14/11/2026): זרימות נטו יומיות לקרנות הסל האמריקאיות על ביטקוין ספוט (מינואר 2024) — קריאה ציבורית בלבד, בלי מפתחות.
// מקור: הטבלה המלאה של Farside Investors (מיליוני דולרים, כל קרן + סה"כ). הפלט: [תאריך מסחר, סה"כ זרימה נטו במיליוני $] ודוח קצר.
// שימוש: node invest-api/scripts/etf-flows-probe.mjs --out dir   (ETF_STDOUT=1 → שורת ETFJSON: ב-base64 ליומן, בלי קבצים)
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out', '.'), STDOUT = process.env.ETF_STDOUT === '1';
const URLS = ['https://farside.co.uk/bitcoin-etf-flow-all-data/', 'https://farside.co.uk/btc/'];
const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const num = (s) => { const t = s.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim(); if (t === '-' || t === '') return 0; const neg = /^\(.*\)$/.test(t); const v = Number(t.replace(/[(),\s]/g, '')); return Number.isFinite(v) ? (neg ? -v : v) : NaN; };
const L = ['# זרימות לקרנות הסל על ביטקוין — מקורות', '', '| מקור | מצב | ימים | מתאריך | עד |', '|---|---|---|---|---|'];
let best = null;
for (const url of URLS){
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (research)', Accept: 'text/html' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = await r.text(), rows = [];
    for (const tr of html.split(/<tr[\s>]/i).slice(1)){
      const tds = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => m[1]); if (tds.length < 3) continue;
      const m = tds[0].replace(/<[^>]*>/g, '').trim().match(/^(\d{1,2}) (\w{3}) (\d{4})$/); if (!m || MON[m[2]] === undefined) continue;
      const total = num(tds.at(-1)); if (!Number.isFinite(total)) continue;
      rows.push([new Date(Date.UTC(+m[3], MON[m[2]], +m[1])).toISOString().slice(0, 10), Math.round(total * 10) / 10]);
    }
    rows.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    L.push(`| ${url} | ${rows.length ? '✅' : '❌ אין שורות'} | ${rows.length} | ${rows[0]?.[0] ?? ''} | ${rows.at(-1)?.[0] ?? ''} |`);
    if (rows.length && (!best || rows.length > best.rows.length)) best = { url, rows };
  } catch (e){ L.push(`| ${url} | ❌ ${String(e.message).slice(0, 60)} | | | |`); }
}
const J = JSON.stringify({ note: 'זרימה נטו יומית לכל קרנות הסל האמריקאיות על ביטקוין ספוט, מיליוני דולרים (Farside, עמודת Total). תאריך = יום המסחר בארה"ב.', fetched: new Date().toISOString(), source: best?.url ?? null, daily: best?.rows ?? [] });
console.log(L.join('\n'));
if (STDOUT) console.log('ETFJSON:' + gzipSync(J).toString('base64'));
else { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/sources.md`, L.join('\n') + '\n'); if (best) writeFileSync(`${OUT}/etf-flows.json`, J); }
