#!/usr/bin/env node
// בקשת מאיר (7/11): "תריץ את הבדיקה במינוף ×1.5 ו-×2" — המומנטום בין מטבעות (וגרסאות מגמה להשוואה) במינוף 1/1.5/2/3, עם חוזה
// (עמלת חוזה + Funding על כל הנוציונל) וחיסול תוך-יומי לפי השפל. מחקר בלבד. משתמש באותם נתונים של research-daily.mjs (--data).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { align, strategies, runDaily, dstats } from '../engine/research-daily.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'daily-data.json.gz'), OUT = arg('--out', '');
if (!existsSync(DATA)) throw new Error(`אין נתונים: ${DATA} (נוצרים ב-research-daily.mjs)`);
const d = JSON.parse(gunzipSync(readFileSync(DATA))), F = {};
// נתון שגוי: שפל נמוך מ-10% מהפתיחה/הסגירה (ירידה של 90%+ שנסגרה באותו יום) — ב-Coinbase יש כאלה (BTC 2017-04-15: שפל $0.06).
// מחליפים את השפל/השיא בגוף הנר ומדפיסים כל תיקון. פתילים אמיתיים (כמו BTC 12/3/2020, −41%) לא נוגעים.
const fixed = [];
for (const [c, bars] of Object.entries(d.bars)) for (const b of bars){
  const lo = Math.min(b.o, b.c), hi = Math.max(b.o, b.c);
  if (b.l < 0.1 * lo){ fixed.push(`${c} ${new Date(b.t).toISOString().slice(0, 10)}: שפל ${b.l} → ${lo}`); b.l = lo; }
  if (b.h > 10 * hi){ fixed.push(`${c} ${new Date(b.t).toISOString().slice(0, 10)}: שיא ${b.h} → ${hi}`); b.h = hi; }
}
const A = align(d.bars);
for (const [c, rows] of Object.entries(d.funding || {})) F[c] = new Map(rows);
const S = strategies(A.coins), DAY = 86400e3, days = A.days, D = days.length, at = (k) => days[Math.min(D - 1, Math.floor(D * k))];
const P = { all: { from: days[0], to: days.at(-1) + DAY }, train: { from: days[0], to: at(0.6) }, val: { from: at(0.6), to: at(0.8) }, test: { from: at(0.8), to: days.at(-1) + DAY } };
const pct = (x) => (x == null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toLocaleString('en-US', { maximumFractionDigits: x && Math.abs(x) > 10 ? 0 : 1 })}%`);
const fs = (x) => (x == null ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2));
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const VARIANTS = [{ lab: '×1 ספוט (בלי מינוף)', lev: 1, spot: true }, ...[1.0001, 1.25, 1.5, 2, 3].map((lev) => ({ lab: lev > 1.01 ? `×${lev} חוזה` : '×1 חוזה', lev, liqBy: 'low' }))];
const liqs = [];
const L = [`# מינוף — ${iso(days[0])} → ${iso(days.at(-1))}, ${A.coins.length} מטבעות, נרות יומיים`,
  'חוזה: עמלה 0.055% + החלקה לכל צד, Funding היסטורי (Hyperliquid מ-2023; לפני כן לונג משלם 0.03% ליום = כ-11% בשנה על הנוציונל). חיסול: השפל של היום מוריד את ההון מתחת ל-0.5% מהחשיפה → ההון מתאפס.',
  `נתונים שגויים שתוקנו (${fixed.length}): ${fixed.join(' · ') || '—'}`, ''];
for (const id of ['XS14-top3-f200', 'DC20-10-EW', 'MA50-EW', 'BH-BTC']){
  const s = S.find((x) => x.id === id); if (!s) continue;
  L.push(`## \`${id}\``, '| מינוף | 2016–2026 מצטבר | תשואה שנתית | ירידה מקס׳ | שארפ | חיסול | Funding מצטבר | מבחן (2024–2026): שנתי / ירידה |', '|---|---|---|---|---|---|---|---|');
  const yearsRow = [];
  for (const v of VARIANTS){
    const r = v.spot ? runDaily(A, s, { funding: F }) : runDaily(A, { ...s, perp: true }, { funding: F, leverage: v.lev, liqBy: v.liqBy });
    if (r.liqInfo) liqs.push(`- \`${id}\` ${v.lab}: ${iso(r.liquidated)} — ` + r.liqInfo.map((q) => `${q.coin} (משקל ${q.w.toFixed(2)}): פתיחה ${q.o}, שפל ${q.l}, סגירה ${q.c}`).join(' · '));
    const a = dstats(r.series, P.all), t = dstats(r.series, P.test);
    L.push(`| ${v.lab} | ${pct(a.total)} | ${pct(a.cagr)} | ${pct(-a.maxDD)} | ${fs(a.sharpe)} | ${r.liquidated ? `💥 ${iso(r.liquidated)}` : '—'} | ${pct(-a.fundTotal)} | ${pct(t.cagr)} / ${pct(-t.maxDD)} |`);
    const ys = [...new Set(days.map((x) => new Date(x).getUTCFullYear()))];
    yearsRow.push(`| ${v.lab} | ` + ys.map((y) => { const q = dstats(r.series, { from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) }); return q.n >= 30 ? pct(q.total) : '—'; }).join(' | ') + ' |');
  }
  const ys = [...new Set(days.map((x) => new Date(x).getUTCFullYear()))];
  L.push('', '| מינוף | ' + ys.join(' | ') + ' |', '|---|' + ys.map(() => '---').join('|') + '|', ...yearsRow, '');
}
L.push('## נרות החיסול', ...liqs);
const md = L.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md);
