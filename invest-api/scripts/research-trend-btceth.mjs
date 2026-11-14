#!/usr/bin/env node
// משפחת מחקר "כיוון 1" (החלטת מאיר 14/11/2026): מסחר מגמה על BTC ו-ETH בלבד — שלוש שיטות, כללים שנקבעו מראש (engine/trend-btceth.js),
// סבב אחד בלבד. ספוט, רק לונג, בלי מינוף, בלי מס. ההחלטה בסגירה, הביצוע בפתיחה שאחרי, עמלה 0.1% + החלקה 0.02% לכל צד (+ בדיקה ×2).
// תיק משולב: 50% BTC, 50% ETH, חוזר ל-50/50 בתחילת כל חודש (כולל עלות ההעברה). השוואה: החזקת BTC, החזקת ETH, החזקת 50/50, ו-50/50
// פסיבי בסיכון זהה (אותה תנודתיות, השאר במזומן). קריטריון ההצלחה נקבע לפני ההרצה (PASS למטה). הגרסה הראשית לא מוחלפת בשכנה טובה יותר.
// שימוש: node invest-api/scripts/research-trend-btceth.mjs --data xsra-data.json.gz [--out report.md] [--json results.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { align, runDaily, dstats, DCOST } from '../engine/research-daily.js';
import { TREND, BUILD, combine5050, longestRecovery } from '../engine/trend-btceth.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'xsra-data.json.gz'), OUT = arg('--out', ''), JOUT = arg('--json', '');
const DAY = 86400e3, WARM = 200, COINS = ['BTC', 'ETH'], log = (...a) => console.error(...a);
const PASS = Object.freeze({ cagr: 0.20, maxDD: 0.35, gridShare: 0.5 }); // נקבע מראש (14/11/2026)

const d0 = JSON.parse(gunzipSync(readFileSync(DATA)));
for (const c of COINS){ if (!d0.bars[c]) throw new Error(`חסר ${c}`); for (const b of d0.bars[c]){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; } }
const AC = Object.fromEntries(COINS.map((c) => [c, align({ [c]: d0.bars[c] })]));
const first = Math.max(...COINS.map((c) => AC[c].days[0])), START = first + WARM * DAY; // חימום: 200 ימים מאז שלשני המטבעות יש נתונים (ממוצע 200)
const AF = align({ BTC: d0.bars.BTC, ETH: d0.bars.ETH }), od = AF.days.filter((t) => t >= START && t < Date.UTC(2026, 10, 7)), at = (k) => od[Math.floor(od.length * k)], LAST = AF.days.at(-1) + DAY;
const W = { train: { from: START, to: at(0.6) }, val: { from: at(0.6), to: at(0.8) }, test: { from: at(0.8), to: LAST }, s22: { from: Date.UTC(2022, 0, 1), to: LAST }, all: { from: START, to: LAST } };
const WN = { train: 'אימון', val: 'אימות', test: 'מבחן', s22: 'מ-2022', all: 'הכול' };
const iso = (t) => new Date(t).toISOString().slice(0, 10), yr = (t) => new Date(t).getUTCFullYear();
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
const f2 = (x) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '' : '−') + Math.abs(x).toFixed(2));
const ci = (s) => (s?.ci ? `[${f2(s.ci[0])}, ${f2(s.ci[1])}]` : '');
const cut = (sr) => sr.filter((x) => x.t >= START);
const BPS = DCOST.spotBps + DCOST.slipBps.BTC; // 12 נק׳ בסיס לכל צד (BTC ו-ETH זהים)

// עסקאות לכל מטבע: רצף ימים עם חשיפה, כולל יום היציאה (הלילה + העלות נרשמים בו)
function trades(sr, w){
  const out = []; let cur = null;
  for (const x of sr){ if (x.t < w.from || x.t >= w.to){ cur = null; continue; }
    if (x.exp > 0){ if (!cur) cur = { t: x.t, r: 1, n: 0 }; cur.r *= 1 + x.net; cur.n += 1; }
    else if (cur){ cur.r *= 1 + x.net; out.push({ t: cur.t, ret: cur.r - 1, days: cur.n }); cur = null; } }
  if (cur) out.push({ t: cur.t, ret: cur.r - 1, days: cur.n, open: true });
  return out;
}
// הירידה המקסימלית בחלון: תאריך השיא, תאריך השפל, ותאריך החזרה לשיא (null = עוד לא חזרה)
const ddWhen = (sr, w) => { let e = 1, pk = 1, pkT = null, best = 0, out = null; const s = sr.filter((x) => x.t >= w.from && x.t < w.to);
  for (const x of s){ if (pkT === null) pkT = x.t; e *= 1 + x.net; if (e > pk){ pk = e; pkT = x.t; } const dd = 1 - e / pk; if (dd > best){ best = dd; out = { dd: Math.round(dd * 1000) / 1000, peak: iso(pkT), trough: iso(x.t), pkE: pk }; } }
  if (out){ let e2 = 1, rec = null; for (const x of s){ e2 *= 1 + x.net; if (x.t > Date.parse(out.trough) && e2 >= out.pkE){ rec = iso(x.t); break; } } out.recovered = rec; delete out.pkE; } return out; };
const yearly = (sr) => { const m = new Map(); for (const x of sr){ const y = yr(x.t); m.set(y, (m.get(y) ?? 1) * (1 + x.net)); } return Object.fromEntries([...m].map(([y, e]) => [y, Math.round((e - 1) * 1000) / 1000])); };
function metrics(sr, legs = null){
  const o = {};
  for (const [k, w] of Object.entries(W)){ const s = dstats(sr, w); const tr = legs ? legs.flatMap((l) => trades(l, w)) : [];
    o[k] = { cagr: s.cagr, sharpe: s.sharpe, ci: s.ci, maxDD: s.maxDD, vol: s.vol, turnYr: s.turnYr, exposure: s.exposure, costTotal: s.costTotal, rec: longestRecovery(sr, w), years: s.years,
      trades: tr.length, tradesYr: s.years ? Math.round(tr.length / s.years * 10) / 10 : null, win: tr.length ? Math.round(tr.filter((x) => x.ret > 0).length / tr.length * 100) / 100 : null,
      avgTrade: tr.length ? Math.round(tr.reduce((a, x) => a + x.ret, 0) / tr.length * 1000) / 1000 : null }; }
  o.yearly = yearly(sr); o.ddAll = ddWhen(sr, W.all); return o;
}
const hold = { id: 'HOLD', weights: () => [1] };
const leg = (c, strat, costMult = 1) => cut(runDaily(AC[c], strat, { drift: true, costMult }).series);
function run(strat, costMult = 1){ const lb = leg('BTC', strat(), costMult), le = leg('ETH', strat(), costMult); return { lb, le, comb: combine5050(lb, le, { bps: BPS * costMult }) }; }

// ---- מדדי ייחוס ----
const H = run(() => hold), BENCH = { BTC: metrics(H.lb), ETH: metrics(H.le), P5050: metrics(H.comb) };
// 50/50 פסיבי בסיכון זהה: באותו חלון, x = תנודתיות השיטה / תנודתיות ה-50/50, השאר מזומן (איזון יומי, בלי עלות — קירוב שמתועד)
const riskMatched = (vol, w) => { const pv = dstats(H.comb, w).vol; const x = pv ? Math.min(1, vol / pv) : 0; const s = dstats(H.comb.map((y) => ({ ...y, net: y.net * x, gross: 0, cost: 0, turn: 0, exp: x })), w); return { x: Math.round(x * 100) / 100, cagr: s.cagr, maxDD: s.maxDD, sharpe: s.sharpe }; };

// ---- הרצה: לכל שיטה — הגרסה הראשית (עם ×2 עלויות) וכל הרשת ----
const RES = { meta: { start: iso(START), first: iso(first), windows: Object.fromEntries(Object.entries(W).map(([k, w]) => [k, [iso(w.from), iso(Math.min(w.to, LAST) - DAY)]])), pass: PASS, bps: BPS }, bench: BENCH, methods: {} };
const passOf = (m) => ({ c1: m.val.cagr >= PASS.cagr && m.test.cagr >= PASS.cagr, c2: ['train', 'val', 'test'].every((k) => m[k].maxDD <= PASS.maxDD), c3: m.val.sharpe > BENCH.P5050.val.sharpe && m.test.sharpe > BENCH.P5050.test.sharpe });
for (const [key, cfg] of Object.entries({ TF: TREND.TF, BR: TREND.BR, MP: TREND.MP })){
  const P = run(() => BUILD[key](cfg.primary)), P2 = run(() => BUILD[key](cfg.primary), 2);
  const prim = { id: BUILD[key](cfg.primary).id, comb: metrics(P.comb, [P.lb, P.le]), BTC: metrics(P.lb, [P.lb]), ETH: metrics(P.le, [P.le]), cost2: metrics(P2.comb, [P2.lb, P2.le]) };
  prim.pass = passOf(prim.comb);
  prim.riskMatched = Object.fromEntries(['train', 'val', 'test', 's22'].map((k) => [k, riskMatched(prim.comb[k].vol, W[k])]));
  const grid = cfg.grid.map((p) => { const R = run(() => BUILD[key](p)), m = metrics(R.comb, [R.lb, R.le]), ps = passOf(m);
    return { id: BUILD[key](p).id, p, primary: JSON.stringify(p) === JSON.stringify(cfg.primary), val: m.val, test: m.test, train: m.train, s22: m.s22, all: m.all, pass: ps }; });
  const share = grid.filter((g) => g.pass.c1 && g.pass.c2).length / grid.length;
  prim.pass.c4 = share >= PASS.gridShare; prim.pass.all = prim.pass.c1 && prim.pass.c2 && prim.pass.c3 && prim.pass.c4;
  RES.methods[key] = { primary: prim, grid, gridShare: Math.round(share * 100) / 100,
    gridMedian: Object.fromEntries(['val', 'test', 's22'].map((k) => { const med = (f) => { const a = grid.map(f).filter(Number.isFinite).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; }; return [k, { cagr: med((g) => g[k].cagr), maxDD: med((g) => g[k].maxDD), sharpe: med((g) => g[k].sharpe) }]; })) };
  log(`${key} ${prim.id}: אימות ${pct(prim.comb.val.cagr)} / מבחן ${pct(prim.comb.test.cagr)} / ירידה ${pct(-prim.comb.all.maxDD)} · רשת ${Math.round(share * 100)}%`);
}

// ---- דוח ----
const NAME = { TF: '1. מגמה (ממוצע נע + ממוצע עולה)', BR: '2. פריצה ובדיקה חוזרת', MP: '3. מגמה ותיקון' };
const L = [];
L.push('# מסחר מגמה על ביטקוין ואתריום — שלוש שיטות, סבב אחד (מחקר 7כא)', '',
  `נתונים: נרות יומיים של Coinbase. תחילת ההערכה ${iso(START)} (200 ימי חימום מ-${iso(first)}, כשלשני המטבעות יש נתונים). ` +
  `אימון ${RES.meta.windows.train.join(' → ')} · אימות ${RES.meta.windows.val.join(' → ')} · מבחן ${RES.meta.windows.test.join(' → ')}.`, '',
  `עלויות: עמלה ${DCOST.spotBps / 100}% + החלקה ${DCOST.slipBps.BTC / 100}% לכל צד, כולל העברות האיזון החודשי בין שני החלקים. בלי מס. ספוט, רק לונג, בלי מינוף. ` +
  'ההחלטה בסגירה (UTC), הביצוע בפתיחה שאחרי.', '',
  `**קריטריון שנקבע מראש** (על התיק המשולב): (1) לפחות ${PASS.cagr * 100}% בשנה באימות ובמבחן · (2) ירידה מקסימלית עד ${PASS.maxDD * 100}% באימון, באימות ובמבחן · ` +
  `(3) שארפ גבוה מזה של 50/50 פסיבי באימות ובמבחן · (4) לפחות ${PASS.gridShare * 100}% מהרשת עומדות ב-(1) וב-(2).`, '');
L.push('## טבלת השוואה — התיק המשולב', '', '| | אימון | אימות | מבחן | מ-2022 | ירידה מקס׳ (הכול) | שארפ אימות / מבחן | חשיפה | עסקאות בשנה | התאוששות ארוכה (ימים) |', '|---|---|---|---|---|---|---|---|---|---|');
const row = (name, m) => `| ${name} | ${pct(m.train.cagr)} | ${pct(m.val.cagr)} | ${pct(m.test.cagr)} | ${pct(m.s22.cagr)} | ${pct(-m.all.maxDD)} | ${f2(m.val.sharpe)} / ${f2(m.test.sharpe)} | ${Math.round(m.all.exposure * 100)}% | ${m.all.tradesYr ?? '—'} | ${m.all.rec} |`;
for (const [k, v] of Object.entries(RES.methods)) L.push(row(`${NAME[k]} (${v.primary.id})`, v.primary.comb));
L.push(row('החזקת ביטקוין', BENCH.BTC), row('החזקת אתריום', BENCH.ETH), row('החזקת 50/50', BENCH.P5050), '');
L.push('## ירידה מקסימלית ושארפ לפי תקופה', '', '| | ירידה: אימון / אימות / מבחן | שארפ אימון [טווח ביטחון 95%] | שארפ אימות | שארפ מבחן |', '|---|---|---|---|---|');
const row2 = (name, m) => `| ${name} | ${pct(-m.train.maxDD)} / ${pct(-m.val.maxDD)} / ${pct(-m.test.maxDD)} | ${f2(m.train.sharpe)} ${ci(m.train)} | ${f2(m.val.sharpe)} ${ci(m.val)} | ${f2(m.test.sharpe)} ${ci(m.test)} |`;
for (const [k, v] of Object.entries(RES.methods)) L.push(row2(NAME[k], v.primary.comb));
L.push(row2('החזקת 50/50', BENCH.P5050), '');
L.push('## מתי הייתה הירידה המקסימלית (כל התקופה)', '', '| | ירידה | שיא | שפל | חזרה לשיא |', '|---|---|---|---|---|');
const row3 = (name, m) => `| ${name} | ${pct(-m.ddAll.dd)} | ${m.ddAll.peak} | ${m.ddAll.trough} | ${m.ddAll.recovered ?? 'עוד לא'} |`;
for (const [k, v] of Object.entries(RES.methods)){ L.push(row3(NAME[k], v.primary.comb)); for (const c of COINS) L.push(row3(`— ${c === 'BTC' ? 'ביטקוין' : 'אתריום'} לבד`, v.primary[c])); }
for (const [n, m] of [['ביטקוין', BENCH.BTC], ['אתריום', BENCH.ETH], ['50/50', BENCH.P5050]]) L.push(row3(`החזקת ${n}`, m));
L.push('');
L.push('## הקריטריון', '', '| שיטה | (1) 20%+ באימות ובמבחן | (2) ירידה ≤35% | (3) שארפ מעל הפסיבי | (4) רשת | חלק הרשת שעובר (1)+(2) | עוברת? |', '|---|---|---|---|---|---|---|');
const yn = (b) => (b ? '✅' : '❌');
for (const [k, v] of Object.entries(RES.methods)){ const p = v.primary.pass; L.push(`| ${NAME[k]} | ${yn(p.c1)} | ${yn(p.c2)} | ${yn(p.c3)} | ${yn(p.c4)} | ${Math.round(v.gridShare * 100)}% | ${p.all ? '**כן**' : '**לא**'} |`); }
L.push('');
L.push('## מול פסיבי בסיכון זהה', '', 'אותה תנודתיות כמו השיטה: x מהתיק ב-50/50 פסיבי והשאר במזומן (איזון יומי בלי עלות — קירוב לטובת הפסיבי במעט).', '',
  '| שיטה | תקופה | השיטה: תשואה / ירידה / שארפ | פסיבי בסיכון זהה (x): תשואה / ירידה / שארפ |', '|---|---|---|---|');
for (const [k, v] of Object.entries(RES.methods)) for (const w of ['train', 'val', 'test', 's22']){ const m = v.primary.comb[w], r = v.primary.riskMatched[w];
  L.push(`| ${NAME[k]} | ${WN[w]} | ${pct(m.cagr)} / ${pct(-m.maxDD)} / ${f2(m.sharpe)} | (${r.x}) ${pct(r.cagr)} / ${pct(-r.maxDD)} / ${f2(r.sharpe)} |`); }
L.push('');
const ys = [...new Set(Object.keys(BENCH.P5050.yearly))].sort();
L.push('## תשואה לפי שנה (התיק המשולב)', '', `| | ${ys.join(' | ')} |`, `|---|${ys.map(() => '---').join('|')}|`);
for (const [k, v] of Object.entries(RES.methods)) L.push(`| ${NAME[k]} | ${ys.map((y) => pct(v.primary.comb.yearly[y])).join(' | ')} |`);
for (const [n, m] of [['ביטקוין', BENCH.BTC], ['אתריום', BENCH.ETH], ['50/50', BENCH.P5050]]) L.push(`| החזקת ${n} | ${ys.map((y) => pct(m.yearly[y])).join(' | ')} |`);
L.push('', `(${ys[0]} חלקית — מ-${iso(START)}; ${ys.at(-1)} עד ${iso(LAST - DAY)}.)`, '');
L.push('## כל מטבע לחוד (הגרסה הראשית)', '', '| שיטה | מטבע | אימון | אימות | מבחן | ירידה מקס׳ | חשיפה | עסקאות | הצלחה | עסקה ממוצעת |', '|---|---|---|---|---|---|---|---|---|---|');
for (const [k, v] of Object.entries(RES.methods)) for (const c of COINS){ const m = v.primary[c];
  L.push(`| ${NAME[k]} | ${c === 'BTC' ? 'ביטקוין' : 'אתריום'} | ${pct(m.train.cagr)} | ${pct(m.val.cagr)} | ${pct(m.test.cagr)} | ${pct(-m.all.maxDD)} | ${Math.round(m.all.exposure * 100)}% | ${m.all.trades} | ${m.all.win == null ? '—' : Math.round(m.all.win * 100) + '%'} | ${pct(m.all.avgTrade)} |`); }
L.push('');
L.push('## עלויות כפולות (הגרסה הראשית)', '', '| שיטה | אימות | מבחן | מ-2022 | ירידה מקס׳ | מחזור בשנה | עלות כוללת (×1 → ×2) |', '|---|---|---|---|---|---|---|');
for (const [k, v] of Object.entries(RES.methods)){ const a = v.primary.comb, b = v.primary.cost2; L.push(`| ${NAME[k]} | ${pct(a.val.cagr)} → ${pct(b.val.cagr)} | ${pct(a.test.cagr)} → ${pct(b.test.cagr)} | ${pct(a.s22.cagr)} → ${pct(b.s22.cagr)} | ${pct(-b.all.maxDD)} | ${f2(a.all.turnYr)} | ${pct(a.all.costTotal)} → ${pct(b.all.costTotal)} |`); }
L.push('');
L.push('## עמידות — כל הרשת (שום גרסה לא נבחרה בדיעבד)', '');
for (const [k, v] of Object.entries(RES.methods)){
  L.push(`### ${NAME[k]} — ${v.grid.length} גרסאות, ${Math.round(v.gridShare * 100)}% עוברות (1)+(2); חציון: אימות ${pct(v.gridMedian.val.cagr)}, מבחן ${pct(v.gridMedian.test.cagr)}, מ-2022 ${pct(v.gridMedian.s22.cagr)}`, '',
    '| גרסה | אימון | אימות | מבחן | מ-2022 | ירידה: אימון / אימות / מבחן | שארפ אימות / מבחן | (1) | (2) |', '|---|---|---|---|---|---|---|---|---|');
  for (const g of v.grid) L.push(`| ${g.primary ? '**' + g.id + '** (ראשית)' : g.id} | ${pct(g.train.cagr)} | ${pct(g.val.cagr)} | ${pct(g.test.cagr)} | ${pct(g.s22.cagr)} | ${pct(-g.train.maxDD)} / ${pct(-g.val.maxDD)} / ${pct(-g.test.maxDD)} | ${f2(g.val.sharpe)} / ${f2(g.test.sharpe)} | ${yn(g.pass.c1)} | ${yn(g.pass.c2)} |`);
  L.push('');
}
L.push('## הערות', '', '- כל שיטה רצה על כל מטבע בנפרד (חצי מהתיק לכל מטבע); כשהשיטה מחוץ לשוק — מזומן בלי ריבית.',
  '- עסקה = רצף ימים בשוק במטבע אחד; עסקה פתוחה בסוף התקופה נספרת עם הרווח שלא מומש.',
  '- התאוששות = הימים הרבים ביותר משיא עד שיא חדש בתקופה; ירידה שעוד לא התאוששה נספרת עד סוף התקופה.',
  '- אין בחירה של גרסה מהרשת: הגרסה הראשית נקבעה לפני ההרצה, והרשת מוצגת רק כבדיקת עמידות.');
const md = L.join('\n') + '\n';
if (OUT) writeFileSync(OUT, md); else process.stdout.write(md);
if (JOUT) writeFileSync(JOUT, JSON.stringify(RES, null, 1));
