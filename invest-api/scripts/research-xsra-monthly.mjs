#!/usr/bin/env node
// בדיקה אחת (בקשת מאיר 14/11/2026): המומנטום המשודרג (7 מנות) עם איזון חודשי במקום שבועי — כל השאר אותם כללים בדיוק.
// הקריטריון נשמר ב-engine/xsra-protect.js (MONTHLY_PASS) לפני ההרצה. הגרסה המציאותית: 38 מטבעות Bybit, מיום הרישום, ספר פקודות 5,000$.
// רבעוני — מידע בלבד, לא מועמד. מחקר בלבד: בלי שינוי במעקב החי ובלי פקודות.
// שימוש: node invest-api/scripts/research-xsra-monthly.mjs --data xsra-data.json.gz --bybit invest/docs/research/xs-protect/bybit-probe.json [--out r.md] [--json r.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { align, dstats, DCOST } from '../engine/research-daily.js';
import { simulate, VERSIONS, CYCLES, MONTHLY_PASS } from '../engine/xsra-protect.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'xsra-data.json.gz'), BYB = arg('--bybit', 'invest/docs/research/xs-protect/bybit-probe.json'), OUT = arg('--out', ''), JOUT = arg('--json', '');
const DAY = 86400e3, T21 = Date.UTC(2021, 0, 1), T22 = Date.UTC(2022, 0, 1), log = (...a) => console.error(...a);
const d0 = JSON.parse(gunzipSync(readFileSync(DATA))), byb = JSON.parse(readFileSync(BYB, 'utf8'));
for (const bars of Object.values(d0.bars)) for (const b of bars){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }
const ALL = Object.fromEntries(Object.entries(d0.bars).filter(([c]) => byb.listing[c]));
const CUT = Object.fromEntries(Object.entries(ALL).map(([c, b]) => [c, b.filter((x) => x.t >= T21)]).filter(([, b]) => b.length));
const listT = Object.fromEntries(Object.entries(byb.listing).map(([c, d]) => [c, Date.parse(d + 'T00:00:00Z')]));
const AF = align(ALL), AC = align(CUT), allowC = (k, t) => t >= (listT[AC.coins[k]] ?? Infinity);
const C5 = { ...DCOST, slipBps: Object.fromEntries(Object.keys(byb.listing).map((c) => { const m = byb.book[c]?.buy5k; return [c, Math.max(DCOST.slipBps[c] ?? DCOST.slipOther, m == null ? 300 : m)]; })) };
const od = AF.days.filter((t) => t < Date.UTC(2026, 10, 7)), LAST = AC.days.at(-1) + DAY;
const W = { test: { from: od[Math.floor(od.length * 0.8)], to: LAST }, s22: { from: T22, to: LAST } };
const i22 = AC.days.findIndex((t) => t >= T22), y22 = (AC.days.length - i22) / 365;
const TAX = { rate: 0.25, period: 'semi', carry: true };
const iso = (t) => new Date(t).toISOString().slice(0, 10), yr = (t) => new Date(t).getUTCFullYear();
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
const f2 = (x) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '' : '−') + Math.abs(x).toFixed(2));
const yn = (b) => (b ? '✅' : '❌');
const VK = ['AB', 'A', 'base'], VER = Object.fromEntries(VK.map((k) => [k, VERSIONS.find((v) => v.key === k)]));
const NAME = { AB: 'א+ב (הראשית)', A: 'א. תקרה 15%', base: 'בלי הגנות' }, CN = { weekly: 'שבועי (כמו היום)', monthly: 'חודשי', quarterly: 'רבעוני (מידע בלבד)' };
const R = {};
for (const vk of VK) for (const [ck, cyc] of Object.entries(CYCLES)){
  log(vk, ck);
  const opt = { ...VER[vk], allow: allowC, C: C5, ...(cyc ? { cycle: cyc } : {}) };
  const full = simulate(AC, opt).series, fresh = simulate(AC, { ...opt, startIdx: i22 }).series.filter((x) => x.t >= T22);
  const sT = dstats(full, W.test), s22 = dstats(fresh, W.s22);
  let E = 1, fee = 0, turn = 0; for (const x of fresh){ fee += x.cost * E; turn += x.turn; E *= 1 + x.net; }
  const ti = simulate(AC, { ...opt, startIdx: i22, tax: TAX }).taxInfo, after = ti.net ** (1 / y22) - 1;
  const ym = new Map(); let e = 1; for (const x of fresh){ const y = yr(x.t); if (!ym.has(y)) ym.set(y, { e0: e }); e *= 1 + x.net; ym.get(y).e1 = e; }
  R[`${vk}:${ck}`] = { s22: { cagr: s22.cagr, maxDD: s22.maxDD, sharpe: s22.sharpe, ci: s22.ci }, test: { cagr: sT.cagr, maxDD: sT.maxDD, sharpe: sT.sharpe }, feeTotal: fee, feeYr: fee / y22, turnYr: turn / y22, after,
    yearly: Object.fromEntries([...ym].map(([y, v]) => [y, v.e1 / v.e0 - 1])) };
}
const P = MONTHLY_PASS, g = (vk, ck) => R[`${vk}:${ck}`];
const ok24 = (vk, w) => g(vk, 'monthly')[w].cagr >= g(vk, 'weekly')[w].cagr - P.cagrGap && g(vk, 'monthly')[w].maxDD <= g(vk, 'weekly')[w].maxDD + P.ddGap;
const m = g(P.primary, 'monthly'), wk = g(P.primary, 'weekly');
const V = { c1: m.feeTotal <= P.feeRatio * wk.feeTotal, c2: m.s22.cagr >= wk.s22.cagr - P.cagrGap, c3: m.after >= wk.after, c4: m.s22.maxDD <= wk.s22.maxDD + P.ddGap,
  c5: ok24(P.primary, 'test') && P.robust.every((vk) => ok24(vk, 's22') && ok24(vk, 'test')) };
V.pass = V.c1 && V.c2 && V.c3 && V.c4 && V.c5;
log(JSON.stringify(V));
const L = [];
L.push('# המומנטום המשודרג — איזון חודשי מול שבועי (מחקר 7כז)', '',
  `אותם כללים בדיוק (7 מנות, יקום 15 לפי נפח, ביטקוין מעל ממוצע 100, מטבע מעל ממוצע 50, דירוג תשואה/תנודתיות של 21 יום, 4 מטבעות); השינוי היחיד: **כל מנה מוחלפת פעם ב-28 ימים במקום כל 7**, והמנות מדורגות כל 4 ימים. ` +
  'כמו בשבועי, גם המסנן של ביטקוין נבדק רק ביום ההחלפה של כל מנה. הגרסה המציאותית: 38 מטבעות Bybit, כל מטבע מיום הרישום, עלות לפי ספר הפקודות (5,000$). ' +
  `"מ-2022" = משקיע חדש מ-1/1/2022 (כולל עמלות הקנייה הראשונה); מס: פרטי 25%, חצי-שנתי, העברת הפסדים. מבחן: ${iso(W.test.from)} → ${iso(LAST - DAY)}.`, '',
  `**הקריטריון (נשמר בקוד לפני ההרצה, \`MONTHLY_PASS\` ב-engine/xsra-protect.js), א+ב חודשי מול א+ב שבועי:** (1) עמלות מ-2022 ≤ ${P.feeRatio * 100}% · (2) תשואה שנתית מ-2022 לא נמוכה ביותר מ-${P.cagrGap * 100} נקודות · ` +
  `(3) אחרי מס ≥ השבועי · (4) ירידה מקסימלית לא גדולה ביותר מ-${P.ddGap * 100} נקודות · (5) (2)+(4) גם במבחן, וגם בגרסה המקורית ובגרסה א'.`, '',
  '| | עמידה |', '|---|---|',
  `| (1) עמלות | ${yn(V.c1)} (${Math.round(m.feeTotal * 1000) / 10}% מול ${Math.round(wk.feeTotal * 1000) / 10}% מההון ההתחלתי, ${Math.round(m.feeTotal / wk.feeTotal * 100)}%) |`,
  `| (2) תשואה מ-2022 | ${yn(V.c2)} (${pct(m.s22.cagr)} מול ${pct(wk.s22.cagr)}) |`,
  `| (3) אחרי מס | ${yn(V.c3)} (${pct(m.after)} מול ${pct(wk.after)}) |`,
  `| (4) ירידה מקסימלית | ${yn(V.c4)} (${pct(-m.s22.maxDD)} מול ${pct(-wk.s22.maxDD)}) |`,
  `| (5) עמידות | ${yn(V.c5)} (${['test'].map((w) => `א+ב במבחן ${yn(ok24(P.primary, w))}`).concat(P.robust.map((vk) => `${NAME[vk]}: ${yn(ok24(vk, 's22') && ok24(vk, 'test'))}`)).join(', ')}) |`,
  `| **עובר?** | ${V.pass ? '**כן**' : '**לא**'} |`, '');
L.push('## כל הגרסאות', '', '| גרסה | איזון | מ-2022: תשואה שנתית / ירידה / שארפ | אחרי מס | עמלות מ-2022 (מההון ההתחלתי) | עמלות בשנה | מחזור בשנה | מבחן: תשואה / ירידה |', '|---|---|---|---|---|---|---|---|');
for (const vk of VK) for (const ck of Object.keys(CYCLES)){ const x = g(vk, ck);
  L.push(`| ${NAME[vk]} | ${CN[ck]} | ${pct(x.s22.cagr)} / ${pct(-x.s22.maxDD)} / ${f2(x.s22.sharpe)} | ${pct(x.after)} | ${pct(-x.feeTotal)} | ${pct(-x.feeYr)} | ${x.turnYr.toFixed(1)}× | ${pct(x.test.cagr)} / ${pct(-x.test.maxDD)} |`); }
const ys = Object.keys(g('AB', 'weekly').yearly).sort();
L.push('', '## תשואה לפי שנה (משקיע מ-1/2022, לפני מס)', '', `| גרסה | ${ys.join(' | ')} |`, `|---|${ys.map(() => '---').join('|')}|`);
for (const vk of VK) for (const ck of Object.keys(CYCLES)) L.push(`| ${NAME[vk]} — ${CN[ck]} | ${ys.map((y) => pct(g(vk, ck).yearly[y])).join(' | ')} |`);
L.push('');
const md = L.join('\n') + '\n';
if (OUT) writeFileSync(OUT, md); else process.stdout.write(md);
if (JOUT) writeFileSync(JOUT, JSON.stringify({ meta: { pass: P, cycles: CYCLES, tax: TAX, test: [iso(W.test.from), iso(LAST - DAY)] }, results: R, verdict: V }, null, 1));
