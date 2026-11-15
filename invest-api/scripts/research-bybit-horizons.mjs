#!/usr/bin/env node
// בקשת מאיר (15/11/2026): המומנטום ב-Bybit בלבד (38 מטבעות, תאריכי רישום, עלות לפי ספר הפקודות) — טווח ארוך (השיטה הקיימת, 7 מנות, שבועי;
// בלי/עם א+ב) וטווח קצר (אותו רעיון עם יציאה מהירה). מחקר בלבד — בלי פקודות ובלי שינוי במעקב.
// טווח קצר — נקבע לפני ההרצה (SHORT): אותם מסננים (יקום 15 לפי נפח, ביטקוין מעל ממוצע 100, מטבע מעל ממוצע 50, 4 מטבעות × 25%),
// דירוג תשואה/תנודתיות על L ימים, החלפה כל H ימים (תיק אחד, ביצוע בפתיחה שאחרי). H ∈ {1,2,3}, L ∈ {3,7,21} = 9 גרסאות, כולן מוצגות.
// קריטריון לטווח הקצר (SHORT.pass): (1) לפחות 20% בשנה אחרי עלויות מ-2022 ובשנתיים האחרונות · (2) מעל השיטה השבועית (בלי הגנות) ומעל ביטקוין
// באותם חלונות · (3) לפחות חצי מ-9 הגרסאות חיוביות אחרי עלויות מ-2022. "לפני עלויות" — מידע בלבד (האם יש אות שהעמלות מוחקות).
// שימוש: node invest-api/scripts/research-bybit-horizons.mjs --data xsra-data.json.gz --bybit invest/docs/research/xs-protect/bybit-probe.json [--out r.md] [--json r.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { align, runDaily, dstats, xsRiskAdj, XSRA, DCOST } from '../engine/research-daily.js';
import { simulate, VERSIONS } from '../engine/xsra-protect.js';

export const SHORT = Object.freeze({ H: [1, 2, 3], L: [3, 7, 21], pass: { cagr: 0.20, share: 0.5 } });
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'xsra-data.json.gz'), BYB = arg('--bybit', 'invest/docs/research/xs-protect/bybit-probe.json'), OUT = arg('--out', ''), JOUT = arg('--json', '');
const DAY = 86400e3, CAP = 50000, T22 = Date.UTC(2022, 0, 1), log = (...a) => console.error(...a);
const d0 = JSON.parse(gunzipSync(readFileSync(DATA))), byb = JSON.parse(readFileSync(BYB, 'utf8'));
for (const bars of Object.values(d0.bars)) for (const b of bars){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }
const listT = Object.fromEntries(Object.entries(byb.listing).map(([c, d]) => [c, Date.parse(d + 'T00:00:00Z')]));
const CUT = Object.fromEntries(Object.entries(d0.bars).filter(([c]) => byb.listing[c]).map(([c, b]) => [c, b.filter((x) => x.t >= Date.UTC(2021, 0, 1))]).filter(([, b]) => b.length));
const A = align(CUT), allow = (k, t) => t >= (listT[A.coins[k]] ?? Infinity);
const C5 = { ...DCOST, slipBps: Object.fromEntries(Object.keys(byb.listing).map((c) => { const m = byb.book[c]?.buy5k; return [c, Math.max(DCOST.slipBps[c] ?? DCOST.slipOther, m == null ? 300 : m)]; })) };
const C0 = { ...DCOST, spotBps: 0, slipBps: {}, slipOther: 0 };
const LAST = A.days.at(-1), NOW = new Date(LAST);
const back = (y) => Date.UTC(NOW.getUTCFullYear() - y, NOW.getUTCMonth(), NOW.getUTCDate());
const WIN = [['שנה אחרונה', back(1)], ['שנתיים', back(2)], ['3 שנים', back(3)], ['5 שנים', back(5)], ['מ-2022', T22]];
const iso = (t) => new Date(t).toISOString().slice(0, 10), yr = (t) => new Date(t).getUTCFullYear();
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`), usd = (x) => `${x < 0 ? '−' : ''}${Math.round(Math.abs(x)).toLocaleString('en-US')}$`;
const yn = (b) => (b ? '✅' : '❌');
// סדרה → מדדים בחלון שמתחיל ב-from (משקיע של 50K$ שמצטרף ב-from; בטווח הקצר התיק מתחלף כל 1–3 ימים, ולכן ההבדל מ"משקיע חדש" זניח)
function win(sr, from){ const s = sr.filter((x) => x.t >= from); let E = 1, fee = 0, pk = 1, dd = 0, turn = 0; for (const x of s){ fee += x.cost * E; turn += x.turn; E *= 1 + x.net; pk = Math.max(pk, E); dd = Math.max(dd, 1 - E / pk); }
  const y = s.length / 365; return { end: E * CAP, ret: E - 1, cagr: y >= 0.9 ? E ** (1 / y) - 1 : null, fee: fee * CAP, dd, turnYr: y ? turn / y : 0 }; }
const yearly = (sr) => { const m = new Map(); for (const x of sr){ const k = yr(x.t); m.set(k, (m.get(k) ?? 1) * (1 + x.net)); } return Object.fromEntries([...m].map(([k, e]) => [k, e - 1])); };
// ---- טווח ארוך: 7 מנות שבועי, משקיע חדש בכל נקודת התחלה (startIdx) ----
const LONG = {};
for (const k of ['base', 'AB']){ const v = VERSIONS.find((x) => x.key === k); log('long', k);
  LONG[k] = { name: k === 'base' ? 'טווח ארוך — השיטה הקיימת (שבועי, 7 מנות)' : 'טווח ארוך + 2 ההגנות (תקרה 15%, יעד תנודתיות)', win: Object.fromEntries(WIN.map(([lab, t]) => { const si = A.days.findIndex((x) => x >= t);
    return [lab, win(simulate(A, { ...v, allow, C: C5, startIdx: si }).series, A.days[si])]; })), yearly: yearly(simulate(A, { ...v, allow, C: C5 }).series) }; }
// ---- טווח קצר ----
const run = (H, L, C) => runDaily(A, xsRiskAdj(A.coins, { P: { ...XSRA, retN: L }, allow, isReb: (t) => Math.floor(t / DAY) % H === 0 }), { drift: true, C }).series;
const SH = [];
for (const H of SHORT.H) for (const L of SHORT.L){ log('short', H, L); const net = run(H, L, C5), gross = run(H, L, C0);
  SH.push({ H, L, name: `קצר: החזקה ${H} ${H === 1 ? 'יום' : 'ימים'}, דירוג ${L} ימים`, win: Object.fromEntries(WIN.map(([lab, t]) => [lab, win(net, t)])), gross: Object.fromEntries(WIN.map(([lab, t]) => [lab, win(gross, t)])), yearly: yearly(net), s22: dstats(net, { from: T22 }), s22g: dstats(gross, { from: T22 }) }); }
// ביטקוין
const iB = A.coins.indexOf('BTC'), BTC = Object.fromEntries(WIN.map(([lab, t]) => { const si = A.days.findIndex((x) => x >= t); const o = A.O[iB][si], c = A.C[iB].at(-1); let pk = 0, dd = 0; for (let d = si; d < A.days.length; d++){ pk = Math.max(pk, A.C[iB][d]); dd = Math.max(dd, 1 - A.C[iB][d] / pk); }
  const r = (1 - 0.0012) * c / o - 1, y = (A.days.length - si) / 365; return [lab, { end: (1 + r) * CAP, ret: r, cagr: y >= 0.9 ? (1 + r) ** (1 / y) - 1 : null, dd }]; }));
// ---- הקריטריון לטווח הקצר ----
const P = SHORT.pass, ok = (s) => ['מ-2022', 'שנתיים'].every((w) => s.win[w].cagr != null && s.win[w].cagr >= P.cagr && s.win[w].cagr > LONG.base.win[w].cagr && s.win[w].cagr > BTC[w].cagr);
const share = SH.filter((s) => s.win['מ-2022'].cagr > 0).length / SH.length;
for (const s of SH) s.pass = ok(s);
const VERD = { anyPass: SH.some((s) => s.pass), passing: SH.filter((s) => s.pass).map((s) => `${s.H}/${s.L}`), share, robust: share >= P.share };
log(JSON.stringify(VERD));
// ---- דוח ----
const L = ['# המומנטום ב-Bybit בלבד — טווח ארוך וטווח קצר, 50,000$ (מחקר 7ל)', '',
  `נתונים: נרות יומיים של Coinbase עד ${iso(LAST)}; היקום — 38 המטבעות שנסחרים בספוט של Bybit, כל מטבע רק מיום הרישום שלו; עלות: עמלה 0.1% + החלקה לפי ספר הפקודות של Bybit (פקודה של 5,000$) לכל קנייה ומכירה. בלי מס. מחקר בלבד.`, '',
  '## 1. כמה היה שווה היום (50,000$)', '', `| | ${WIN.map(([l]) => l).join(' | ')} |`, `|---|${WIN.map(() => '---').join('|')}|`];
const cell = (w) => `${usd(w.end)} (${pct(w.ret)})`;
for (const k of ['base', 'AB']) L.push(`| ${LONG[k].name} | ${WIN.map(([l]) => cell(LONG[k].win[l])).join(' | ')} |`);
const best = SH.slice().sort((a, b) => b.win['מ-2022'].ret - a.win['מ-2022'].ret);
for (const s of SH) L.push(`| ${s.name} | ${WIN.map(([l]) => cell(s.win[l])).join(' | ')} |`);
L.push(`| ביטקוין קנה-והחזק | ${WIN.map(([l]) => cell(BTC[l])).join(' | ')} |`, '');
L.push('## 2. עמלות ששולמו (דולרים) וירידה מקסימלית בדרך', '', `| | ${WIN.map(([l]) => l).join(' | ')} |`, `|---|${WIN.map(() => '---').join('|')}|`);
for (const k of ['base', 'AB']) L.push(`| ${LONG[k].name} | ${WIN.map(([l]) => `${usd(LONG[k].win[l].fee)} / ${pct(-LONG[k].win[l].dd)}`).join(' | ')} |`);
for (const s of SH) L.push(`| ${s.name} | ${WIN.map(([l]) => `${usd(s.win[l].fee)} / ${pct(-s.win[l].dd)}`).join(' | ')} |`);
L.push('', '## 3. טווח קצר — לפני עלויות מול אחרי (מ-2022, תשואה שנתית)', '', '| גרסה | לפני עלויות | אחרי עלויות | מחזור בשנה | שארפ לפני / אחרי |', '|---|---|---|---|---|');
for (const s of SH) L.push(`| ${s.name} | ${pct(s.s22g.cagr)} | ${pct(s.s22.cagr)} | פי ${Math.round(s.win['מ-2022'].turnYr)} | ${s.s22g.sharpe?.toFixed(2)} / ${s.s22.sharpe?.toFixed(2)} |`);
const ys = Object.keys(LONG.base.yearly).sort();
L.push('', '## 4. תשואה לפי שנה (אחרי עלויות)', '', `| | ${ys.join(' | ')} |`, `|---|${ys.map(() => '---').join('|')}|`);
for (const k of ['base', 'AB']) L.push(`| ${LONG[k].name} | ${ys.map((y) => pct(LONG[k].yearly[y])).join(' | ')} |`);
for (const s of SH) L.push(`| ${s.name} | ${ys.map((y) => pct(s.yearly[y])).join(' | ')} |`);
L.push('', `(${ys[0]}: עד 7/2021 אין מטבעות ב-Bybit — מזומן; ${ys.at(-1)} עד ${iso(LAST)}.)`, '',
  '## 5. הקריטריון לטווח הקצר (נקבע לפני ההרצה)', '', `(1) לפחות ${P.cagr * 100}% בשנה אחרי עלויות מ-2022 ובשנתיים האחרונות · (2) מעל השיטה השבועית ומעל ביטקוין באותם חלונות · (3) לפחות חצי מהגרסאות חיוביות אחרי עלויות מ-2022.`, '',
  `**גרסאות שעוברות (1)+(2):** ${VERD.passing.length ? VERD.passing.join(', ') : 'אף אחת'} · **(3):** ${Math.round(share * 100)}% חיוביות ${yn(VERD.robust)} · **פסיקה: ${VERD.anyPass && VERD.robust ? 'עובר' : 'לא עובר'}**`);
const md = L.join('\n') + '\n'; if (OUT) writeFileSync(OUT, md); else process.stdout.write(md);
if (JOUT) writeFileSync(JOUT, JSON.stringify({ SHORT, LONG, SH, BTC, VERD }, null, 1));
