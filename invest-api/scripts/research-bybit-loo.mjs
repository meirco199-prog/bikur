#!/usr/bin/env node
// מחקר 7לא (החלטת מאיר 15/11/2026, לפני פתיחת המעקב הווירטואלי השני): עד כמה התוצאה של 7ל (38 מטבעות Bybit, 7 מנות, שבועי, א+ב)
// תלויה במטבע בודד. בלי שינוי פרמטרים — אותה הרצה בדיוק כמו גרסה AB של 7ל (scripts/research-bybit-horizons.mjs), רק בלי מטבע אחד.
// 1. השמטת מטבע אחד (Leave-One-Asset-Out): 38 הרצות, בכל אחת מטבע אחד לא נכנס ליקום (BTC עדיין משמש למסנן ביטקוין מעל ממוצע 100).
// 2. תרומת רווח לפי מטבע (דולרים, לפני ואחרי עמלות), וריכוז הרווח ב-5 המטבעות המובילים.
// קריאה שנקבעה לפני ההרצה (LOO.pass): "לא תלוי במטבע בודד" אם בכל אחת מ-38 ההשמטות, מ-2022: השווי הסופי מעל 50,000$ וגם מעל ביטקוין
// קנה-והחזק באותו חלון. אחרת — "תלוי במטבע בודד". זו קריאה תיאורית — לא משנים בעקבותיה שום פרמטר.
// שימוש: node invest-api/scripts/research-bybit-loo.mjs --data xsra-data.json.gz --bybit invest/docs/research/xs-protect/bybit-probe.json [--out r.md] [--json r.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { align, DCOST } from '../engine/research-daily.js';
import { simulate, VERSIONS } from '../engine/xsra-protect.js';

export const LOO = Object.freeze({ version: 'AB', topN: 5, pass: { window: 'מ-2022', aboveCap: true, aboveBtc: true } });
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'xsra-data.json.gz'), BYB = arg('--bybit', 'invest/docs/research/xs-protect/bybit-probe.json'), OUT = arg('--out', ''), JOUT = arg('--json', '');
const CAP = 50000, T22 = Date.UTC(2022, 0, 1), log = (...a) => console.error(...a);
// ---- בדיוק כמו 7ל ----
const d0 = JSON.parse(gunzipSync(readFileSync(DATA))), byb = JSON.parse(readFileSync(BYB, 'utf8'));
for (const bars of Object.values(d0.bars)) for (const b of bars){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }
const listT = Object.fromEntries(Object.entries(byb.listing).map(([c, d]) => [c, Date.parse(d + 'T00:00:00Z')]));
const CUT = Object.fromEntries(Object.entries(d0.bars).filter(([c]) => byb.listing[c]).map(([c, b]) => [c, b.filter((x) => x.t >= Date.UTC(2021, 0, 1))]).filter(([, b]) => b.length));
const A = align(CUT), allow = (k, t) => t >= (listT[A.coins[k]] ?? Infinity);
const C5 = { ...DCOST, slipBps: Object.fromEntries(Object.keys(byb.listing).map((c) => { const m = byb.book[c]?.buy5k; return [c, Math.max(DCOST.slipBps[c] ?? DCOST.slipOther, m == null ? 300 : m)]; })) };
const LAST = A.days.at(-1), NOW = new Date(LAST);
const back = (y) => Date.UTC(NOW.getUTCFullYear() - y, NOW.getUTCMonth(), NOW.getUTCDate());
const WIN = [['שנה אחרונה', back(1)], ['שנתיים', back(2)], ['5 שנים', back(5)], ['מ-2022', T22]];
const V = VERSIONS.find((v) => v.key === LOO.version), K = A.coins.length, iB = A.coins.indexOf('BTC');
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`), usd = (x) => `${x < 0 ? '−' : ''}${Math.round(Math.abs(x)).toLocaleString('en-US')}$`;
log(`מטבעות: ${K}, ימים: ${A.days.length}, עד ${iso(LAST)}`);
// הרצה ממשקיע חדש ב-si, עם יקום מוגבל (skip = מטבע שלא נכנס), כולל תיעוד עמלות ותרומה
function run(si, skip = null, detail = false){
  const al = skip === null ? allow : (k, t) => k !== skip && allow(k, t), fees = detail ? new Float64Array(K) : null;
  const r = simulate(A, { ...V, allow: al, C: C5, startIdx: si, trace: detail, onTrade: detail ? (e) => { if (e.d >= si) fees[e.k] += e.fee; } : null });
  let E = 1, pk = 1, dd = 0; const pnl = detail ? new Float64Array(K) : null;
  for (let d = si; d < A.days.length; d++){ const x = r.series[d - 1]; if (pnl) for (let k = 0; k < K; k++) pnl[k] += r.contrib[d * K + k] * E; E *= 1 + x.net; pk = Math.max(pk, E); dd = Math.max(dd, 1 - E / pk); }
  const y = (A.days.length - si) / 365;
  return { end: E * CAP, ret: E - 1, cagr: y >= 0.9 ? E ** (1 / y) - 1 : null, dd, pnl: pnl && [...pnl].map((x) => x * CAP), fees: fees && [...fees].map((x) => x * CAP) };
}
const SI = Object.fromEntries(WIN.map(([l, t]) => [l, A.days.findIndex((x) => x >= t)]));
const BTC = Object.fromEntries(WIN.map(([l]) => { const si = SI[l], r = (1 - 0.0012) * A.C[iB].at(-1) / A.O[iB][si] - 1; return [l, { end: (1 + r) * CAP, ret: r }]; }));
// ---- מלא + תרומה ----
const FULL = {}, CON = {};
for (const [l] of WIN){ log('full', l); const r = run(SI[l], null, true); FULL[l] = { end: r.end, ret: r.ret, cagr: r.cagr, dd: r.dd };
  const rows = A.coins.map((c, k) => ({ coin: c, gross: r.pnl[k], fees: r.fees[k], net: r.pnl[k] - r.fees[k] })).filter((x) => Math.abs(x.gross) > 0.5 || x.fees > 0.5).sort((a, b) => b.net - a.net);
  const total = rows.reduce((a, x) => a + x.net, 0), top = rows.slice(0, LOO.topN), topNet = top.reduce((a, x) => a + x.net, 0), pos = rows.filter((x) => x.net > 0).reduce((a, x) => a + x.net, 0);
  CON[l] = { rows, total, top: top.map((x) => x.coin), topNet, topShareOfTotal: total > 0 ? topNet / total : null, topShareOfGains: pos > 0 ? topNet / pos : null, check: r.end - CAP - total }; }
// ---- השמטת מטבע אחד ----
const LO = [];
for (let k = 0; k < K; k++){ log('loo', A.coins[k]); LO.push({ coin: A.coins[k], win: Object.fromEntries(WIN.map(([l]) => { const r = run(SI[l], k); return [l, { end: r.end, ret: r.ret, cagr: r.cagr, dd: r.dd }]; })) }); }
const W0 = LOO.pass.window, okRow = (x) => x.win[W0].end > CAP && x.win[W0].end > BTC[W0].end;
const fails = LO.filter((x) => !okRow(x)).map((x) => x.coin);
const stat = (l) => { const v = LO.map((x) => x.win[l].end).sort((a, b) => a - b); return { min: v[0], med: v[Math.floor(v.length / 2)], max: v.at(-1), minCoin: LO.find((x) => x.win[l].end === v[0]).coin, maxCoin: LO.find((x) => x.win[l].end === v.at(-1)).coin }; };
const ST = Object.fromEntries(WIN.map(([l]) => [l, stat(l)]));
const VERD = { pass: !fails.length, fails };
log(JSON.stringify(VERD));
// ---- דוח ----
const L = ['# עד כמה המומנטום ב-Bybit תלוי במטבע בודד — השמטת מטבע אחד ותרומת רווח לפי מטבע (מחקר 7לא)', '',
  `אותה הרצה בדיוק כמו גרסה א+ב של מחקר 7ל (38 המטבעות של Bybit, כל מטבע מיום הרישום שלו, 7 מנות, החלפה שבועית, תקרה 15% ויעד תנודתיות 40%, עלות לפי ספר הפקודות, 50,000$, משקיע חדש בתחילת כל חלון). בלי שום שינוי פרמטרים. נרות יומיים של Coinbase עד ${iso(LAST)}. מחקר בלבד.`, '',
  '## 1. השמטת מטבע אחד — טווח התוצאות', '', '| חלון | מלא (38 מטבעות) | הגרוע ביותר בלי מטבע אחד | חציון | הטוב ביותר | ביטקוין |', '|---|---|---|---|---|---|'];
for (const [l] of WIN){ const s = ST[l]; L.push(`| ${l} | ${usd(FULL[l].end)} (${pct(FULL[l].ret)}) | ${usd(s.min)} (בלי ${s.minCoin}) | ${usd(s.med)} | ${usd(s.max)} (בלי ${s.maxCoin}) | ${usd(BTC[l].end)} |`); }
L.push('', `**הקריאה שנקבעה מראש** (בכל אחת מ-38 ההשמטות, ${W0}: מעל 50,000$ וגם מעל ביטקוין): **${VERD.pass ? 'לא תלוי במטבע בודד' : `תלוי במטבע בודד — נכשל בהשמטה של ${fails.join(', ')}`}**`, '',
  '## 2. כל 38 ההשמטות (שווי סופי מ-50,000$ / ירידה מקסימלית)', '', `| בלי | ${WIN.map(([l]) => l).join(' | ')} |`, `|---|${WIN.map(() => '---').join('|')}|`);
for (const x of LO.slice().sort((a, b) => a.win[W0].end - b.win[W0].end)) L.push(`| ${x.coin} | ${WIN.map(([l]) => `${usd(x.win[l].end)} / ${pct(-x.win[l].dd)}`).join(' | ')} |`);
L.push(`| **מלא** | ${WIN.map(([l]) => `**${usd(FULL[l].end)} / ${pct(-FULL[l].dd)}**`).join(' | ')} |`);
for (const [l] of WIN){ const c = CON[l];
  L.push('', `## 3. תרומת רווח לפי מטבע — ${l} (מ-${iso(A.days[SI[l]])})`, '',
    `רווח נטו כולל: ${usd(c.total)}. ${LOO.topN} המובילים (${c.top.join(', ')}): ${usd(c.topNet)}${c.topShareOfTotal !== null ? ` = ${Math.round(c.topShareOfTotal * 100)}% מהרווח הנטו` : ''}${c.topShareOfGains !== null ? `, ${Math.round(c.topShareOfGains * 100)}% מסך הרווחים של המטבעות המרוויחים` : ''}.`, '',
    '| מטבע | רווח לפני עמלות | עמלות | נטו |', '|---|---|---|---|');
  for (const x of c.rows) L.push(`| ${x.coin} | ${usd(x.gross)} | ${usd(-x.fees)} | ${usd(x.net)} |`); }
L.push('', '(רווח לפי מטבע: סכום השינוי היומי בשווי של כל מטבע בתיק; העמלות — לפי כל קנייה ומכירה של אותו מטבע. סך הנטו של כל המטבעות = השינוי בשווי התיק.)');
const md = L.join('\n') + '\n'; if (OUT) writeFileSync(OUT, md); else process.stdout.write(md);
if (JOUT) writeFileSync(JOUT, JSON.stringify({ LOO, last: iso(LAST), FULL, BTC, ST, LO, CON, VERD }, null, 1));
