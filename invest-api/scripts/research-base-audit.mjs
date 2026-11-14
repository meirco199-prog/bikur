#!/usr/bin/env node
// סבב מחקר מוגבל (בקשת מאיר 14/11/2026): שלב 1 — ביקורת נתונים לתיק הבסיס (7כג); שלב 2 — ניסוי אחד: 70/30 + ממוצע 200 + יעד תנודתיות 35%,
// איזון שבועי. הקריטריון של שלב 2 שמור ב-engine/base-vt.js (VT_PASS) לפני ההרצה. מחקר בלבד — בלי פקודות ובלי שינוי במעקב.
// שימוש: node invest-api/scripts/research-base-audit.mjs --data xsra-data.json.gz [--prev invest/docs/research/base-portfolio/results.json] [--out r.md] [--json r.json]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { align, runDaily, dstats } from '../engine/research-daily.js';
import { longestRecovery } from '../engine/trend-btceth.js';
import { baseStrat, VT_PASS } from '../engine/base-vt.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'xsra-data.json.gz'), PREV = arg('--prev', 'invest/docs/research/base-portfolio/results.json'), OUT = arg('--out', ''), JOUT = arg('--json', '');
const DAY = 86400e3, WARM = 250, log = (...a) => console.error(...a);
const d0 = JSON.parse(gunzipSync(readFileSync(DATA)));
for (const c of ['BTC', 'ETH']) for (const b of d0.bars[c]){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }
const A = align({ BTC: d0.bars.BTC, ETH: d0.bars.ETH });
const first = Math.max(d0.bars.BTC[0].t, d0.bars.ETH[0].t), START = Math.floor(first / DAY) * DAY + WARM * DAY, LAST = A.days.at(-1) + DAY;
const W = { train: { from: START, to: Date.UTC(2022, 10, 18) }, val: { from: Date.UTC(2022, 10, 18), to: Date.UTC(2024, 10, 12) }, test: { from: Date.UTC(2024, 10, 12), to: LAST }, s22: { from: Date.UTC(2022, 0, 1), to: LAST }, all: { from: START, to: LAST } };
const WN = { train: 'אימון (עד 11/2022)', val: 'אימות 2022–2024', test: 'מבחן 2024–2026', s22: 'מ-2022', all: 'הכול' };
const iso = (t) => new Date(t).toISOString().slice(0, 10), yr = (t) => new Date(t).getUTCFullYear();
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
const f2 = (x) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '' : '−') + Math.abs(x).toFixed(2));
const yn = (b) => (b ? '✅' : '❌');
const runV = (o, costMult = 1, AA = A) => { const s = baseStrat(AA, o); return runDaily(AA, s, { drift: true, rebal: s.rebal, partial: true, trace: true, costMult }).series.filter((x) => x.t >= START); };
const entriesIn = (sr, w) => { let n = 0; for (let i = 1; i < sr.length; i++){ const x = sr[i]; if (x.t < w.from || x.t >= w.to) continue; for (let k = 0; k < 2; k++) if (x.w[k] > 0 && !(sr[i - 1].w[k] > 0)) n++; } return n; };
const ddWhen = (sr, w) => { let e = 1, pk = 1, pkT = null, best = 0, out = null; const s = sr.filter((x) => x.t >= w.from && x.t < w.to);
  for (const x of s){ if (pkT === null) pkT = x.t; e *= 1 + x.net; if (e > pk){ pk = e; pkT = x.t; } const dd = 1 - e / pk; if (dd > best){ best = dd; out = { dd, peak: pkT, trough: x.t }; } } return out; };
function metrics(sr){
  const o = {}; for (const [k, w] of Object.entries(W)){ const s = dstats(sr, w), sel = sr.filter((x) => x.t >= w.from && x.t < w.to);
    o[k] = { cagr: s.cagr, maxDD: s.maxDD, calmar: s.maxDD > 0 ? Math.round(s.cagr / s.maxDD * 100) / 100 : null, sharpe: s.sharpe, exposure: s.exposure, trades: entriesIn(sr, w), rebal: sel.filter((x) => x.reb).length,
      cost: Math.round(sel.reduce((a, x) => a + x.cost, 0) * 1000) / 1000, years: s.years, rec: longestRecovery(sr, w) }; }
  const m = new Map(); for (const x of sr){ const y = yr(x.t); m.set(y, (m.get(y) ?? 1) * (1 + x.net)); } o.yearly = Object.fromEntries([...m].map(([y, e]) => [y, Math.round((e - 1) * 1000) / 1000]));
  return o;
}
const V = {}, SR = {};
const add = (key, name, o, costMult = 1) => { SR[key] = runV(o, costMult); V[key] = { name, o, m: metrics(SR[key]) }; log(key, pct(V[key].m.s22.cagr), pct(-V[key].m.all.maxDD)); };
// ---- שלב 1: חודשי, אותם מועדים ----
add('P-M', '70/30 פסיבי (חודשי)', { kind: 'passive' });
add('S200-M', '70/30 + ממוצע 200 (חודשי, המקורי)', { n: 200 });
add('S150-M', '70/30 + ממוצע 150 (חודשי)', { n: 150 });
add('S250-M', '70/30 + ממוצע 250 (חודשי)', { n: 250 });
for (const s of [10, 20, 40]) add(`S200s${s}-M`, `70/30 + ממוצע 200 + ממוצע עולה (${s} ימים)`, { n: 200, slope: s });
// ---- שלב 2: שבועי ----
add('P-W', '70/30 פסיבי (שבועי)', { kind: 'passive', rebal: 'week' });
add('S200-W', '70/30 + ממוצע 200 (שבועי)', { n: 200, rebal: 'week' });
add('VT35', '70/30 + ממוצע 200 + יעד תנודתיות 35% (שבועי) — הניסוי', { n: 200, vt: 0.35, rebal: 'week' });
add('VT30', 'אותו דבר, יעד 30%', { n: 200, vt: 0.30, rebal: 'week' });
add('VT40', 'אותו דבר, יעד 40%', { n: 200, vt: 0.40, rebal: 'week' });
add('VT35x2', 'הניסוי בעלויות כפולות', { n: 200, vt: 0.35, rebal: 'week' }, 2);

// ---- ביקורת 1: מועדי איזון זהים ----
const rebDates = (k) => SR[k].filter((x) => x.reb).map((x) => x.t);
const sameReb = { monthly: JSON.stringify(rebDates('P-M')) === JSON.stringify(rebDates('S200-M')), weekly: ['S200-W', 'VT35'].every((k) => JSON.stringify(rebDates('P-W')) === JSON.stringify(rebDates(k))), nM: rebDates('P-M').length, nW: rebDates('P-W').length };
// ---- ביקורת 2: בלי מידע עתידי — חיתוך הנתונים בתאריכים, והשוואת המשקלות עד החיתוך ----
const CUTS = [Date.UTC(2018, 5, 1), Date.UTC(2020, 5, 1), Date.UTC(2022, 5, 1), Date.UTC(2024, 5, 1), Date.UTC(2026, 0, 1)];
const look = CUTS.map((T) => { const AA = align({ BTC: d0.bars.BTC.filter((b) => b.t <= T), ETH: d0.bars.ETH.filter((b) => b.t <= T) }); const r = {};
  for (const k of ['S200-M', 'VT35']){ const a = runV(V[k].o, 1, AA), full = new Map(SR[k].map((x) => [x.t, x])); let bad = 0, n = 0; for (const x of a){ const y = full.get(x.t); if (!y) continue; n++; if (Math.abs(y.w[0] - x.w[0]) > 1e-12 || Math.abs(y.w[1] - x.w[1]) > 1e-12 || Math.abs(y.net - x.net) > 1e-12) bad++; } r[k] = { n, bad }; }
  return { T: iso(T), ...r }; });
// ---- ביקורת 3: כל כניסה/יציאה מבוצעת בפתיחה של היום שאחרי האות (חישוב עצמאי של האות מהסגירות) ----
function timing(n = 200){
  const sr = runV({ n }), idx = new Map(A.days.map((t, i) => [t, i])); let ok = 0, bad = 0;
  for (let k = 0; k < 2; k++){ const C = A.C[k]; let on = false; const flips = [];
    for (let d = 0; d < A.days.length; d++){ const c = C[d]; if (!Number.isFinite(c) || d < n - 1){ continue; } let s = 0, fin = true; for (let i = d - n + 1; i <= d; i++){ if (!Number.isFinite(C[i])){ fin = false; break; } s += C[i]; } if (!fin) continue; const m = s / n;
      if (!on && c > m){ on = true; flips.push([d, 1]); } else if (on && c < m){ on = false; flips.push([d, 0]); } }
    const byT = new Map(sr.map((x) => [x.t, x]));
    for (const [d, to] of flips){ const x = byT.get(A.days[d + 1]), p = byT.get(A.days[d]); if (!x || !p) continue; if ((to ? x.w[k] > 0 && !(p.w[k] > 0) : x.w[k] === 0 && p.w[k] > 0)) ok++; else bad++; } }
  return { ok, bad };
}
const TIM = timing(200);
// ---- ביקורת 4: השוואה לתוצאות 7כג (שיטת "שני חלקים" עם איזון חודשי) ----
let prev = null; if (existsSync(PREV)){ const j = JSON.parse(readFileSync(PREV, 'utf8')); prev = { P70: j.variants.P70.m, F200: j.variants['F70-200'].m }; }
// ---- הירידה של 61%: מתי, למה, ומה היה עם/בלי שיפוע ----
function ddEpisodes(sr, top = 3){ const out = []; let e = 1, pk = 1, pkT = sr[0].t, tr = 1, trT = sr[0].t;
  for (const x of sr){ e *= 1 + x.net; if (e >= pk){ if (pk > 0 && 1 - tr / pk > 0.2) out.push({ dd: 1 - tr / pk, peak: pkT, trough: trT, rec: x.t }); pk = e; pkT = x.t; tr = e; trT = x.t; } else if (e < tr){ tr = e; trT = x.t; } }
  if (1 - tr / pk > 0.2) out.push({ dd: 1 - tr / pk, peak: pkT, trough: trT, rec: null });
  return out.sort((a, b) => b.dd - a.dd).slice(0, top); }
const EP = ddEpisodes(SR['S200-M']);
const coinDetail = (ep) => [0, 1].map((k) => { const s = SR['S200-M'], i0 = s.findIndex((x) => x.t === ep.peak), seg = s.slice(i0, s.findIndex((x) => x.t === ep.trough) + 1);
  const exit = seg.findIndex((x, j) => j > 0 && x.w[k] === 0 && seg[j - 1].w[k] > 0), iP = A.days.indexOf(ep.peak), C = A.C[k];
  const exitT = exit >= 0 ? seg[exit].t : null, iE = exitT ? A.days.indexOf(exitT) : -1;
  let hi = 0; for (let i = iP; i <= (iE >= 0 ? iE : iP); i++) hi = Math.max(hi, C[i]);
  return { coin: k ? 'ETH' : 'BTC', wPeak: s[i0].w[k], exit: exitT ? iso(exitT) : null, dropToExit: iE >= 0 ? A.O[k][iE] / hi - 1 : null, reentries: seg.filter((x, j) => j > 0 && x.w[k] > 0 && !(seg[j - 1].w[k] > 0)).length,
    coinMove: C[A.days.indexOf(ep.trough)] / C[iP] - 1 }; });
const EPD = EP.map((ep) => ({ ...ep, coins: coinDetail(ep), passiveDD: (() => { const s = SR['P-M'].filter((x) => x.t >= ep.peak && x.t <= ep.trough); let e = 1, pk = 1, dd = 0; for (const x of s){ e *= 1 + x.net; pk = Math.max(pk, e); dd = Math.max(dd, 1 - e / pk); } return dd; })() }));

// ---- שלב 2: הקריטריון שנקבע מראש ----
const evalVT = (k) => { const m = V[k].m, s = V['S200-M'].m; const c1 = ['train', 'val', 'test'].every((w) => m[w].maxDD <= VT_PASS.maxDD);
  const wins = ['train', 'val', 'test'].filter((w) => m[w].calmar > s[w].calmar).length, c2 = wins >= VT_PASS.calmarWins && m.all.calmar > s.all.calmar;
  return { c1, c2, wins, c3: m.s22.cagr >= s.s22.cagr - VT_PASS.s22Gap }; };
const E = { VT35: evalVT('VT35'), VT30: evalVT('VT30'), VT40: evalVT('VT40'), VT35x2: evalVT('VT35x2') };
const robust = ['VT30', 'VT40', 'VT35x2'].every((k) => E[k].c1 && E[k].c2);
const VERDICT = { c1: E.VT35.c1, c2: E.VT35.c2, c3: E.VT35.c3, c4: robust, goal: V.VT35.m.val.cagr >= VT_PASS.goal && V.VT35.m.test.cagr >= VT_PASS.goal };
VERDICT.pass = VERDICT.c1 && VERDICT.c2 && VERDICT.c3 && VERDICT.c4;
log('VT35', JSON.stringify(VERDICT));

// ---- דוח ----
const L = [];
L.push('# תיק בסיס — ביקורת נתונים ויעד תנודתיות 35% (מחקר 7כד)', '',
  `נתונים: נרות יומיים של Coinbase, לוח משותף לביטקוין ולאתריום, הערכה מ-${iso(START)} (250 ימי חימום) עד ${iso(LAST - DAY)}. עמלה 0.1% + החלקה 0.02% לכל צד, כולל כל איזון. בלי מס. ` +
  'ההחלטה בסגירה (UTC), הביצוע בפתיחה שאחרי. איזון חודשי = החלטה בסגירת היום האחרון בחודש, ביצוע בפתיחת הראשון; שבועי = החלטה בסגירת יום ראשון, ביצוע בפתיחת שני.', '');
L.push('## שלב 1 — ביקורת', '',
  `1. **מועדי איזון זהים:** פסיבי וממוצע 200 (חודשי) — ${yn(sameReb.monthly)} (${sameReb.nM} איזונים); פסיבי, ממוצע 200 והניסוי (שבועי) — ${yn(sameReb.weekly)} (${sameReb.nW} איזונים). בין איזונים, יציאה/כניסה של מטבע אחד לא נוגעת במטבע השני.`,
  `2. **בלי מידע עתידי:** חתכתי את הנתונים ב-${CUTS.length} תאריכים והרצתי שוב — המשקלות והתשואות עד החיתוך זהים לגמרי להרצה המלאה: ` + look.map((x) => `${x.T}: ${x['S200-M'].bad + x.VT35.bad === 0 ? '✅' : '❌'} (${x['S200-M'].n} ימים)`).join(' · '),
  `3. **ביצוע בפתיחה שאחרי האות:** חישוב עצמאי של האות מהסגירות — ${TIM.ok} כניסות/יציאות בדיוק ביום שאחרי האות, ${TIM.bad} חריגות.`,
  prev ? `4. **השוואה לחישוב של 7כג** (שני חלקים נפרדים): 70/30 פסיבי מ-2022 ${pct(prev.P70.s22.cagr)} → ${pct(V['P-M'].m.s22.cagr)}; ממוצע 200 מ-2022 ${pct(prev.F200.s22.cagr)} → ${pct(V['S200-M'].m.s22.cagr)}, ירידה על הכול ${pct(-prev.F200.all.maxDD)} → ${pct(-V['S200-M'].m.all.maxDD)}. ההבדל: ב-7כג מטבע שיצא החזיק מזומן "בחלק שלו" עד סוף החודש; כאן התיק כולו חוזר ל-70/30 באותם מועדים.` : '4. (אין תוצאות 7כג להשוואה)', '');
L.push('### כל החלונות — תשואה שנתית / ירידה מקס׳ / תשואה ÷ ירידה / עסקאות / עלות', '');
const keys1 = ['P-M', 'S200-M', 'S150-M', 'S250-M', 'S200s10-M', 'S200s20-M', 'S200s40-M'];
const tbl = (keys) => { L.push(`| | ${['train', 'val', 'test', 's22', 'all'].map((w) => WN[w]).join(' | ')} |`, `|---|${['train', 'val', 'test', 's22', 'all'].map(() => '---').join('|')}|`);
  for (const k of keys){ const m = V[k].m; L.push(`| ${V[k].name} | ${['train', 'val', 'test', 's22', 'all'].map((w) => `${pct(m[w].cagr)} / ${pct(-m[w].maxDD)} / ${f2(m[w].calmar)} / ${m[w].trades} / ${pct(m[w].cost)}`).join(' | ')} |`); } L.push(''); };
tbl(keys1);
L.push('### הירידה הגדולה של ממוצע 200 (חודשי) — שלוש הירידות העמוקות', '', '| ירידה | שיא | שפל | חזרה לשיא | פסיבי באותו חלון | ביטקוין: משקל בשיא / יציאה / ירידה מהשיא עד היציאה / כניסות חוזרות | אתריום: אותו דבר |', '|---|---|---|---|---|---|---|');
for (const e of EPD){ const c = (x) => `${f2(x.wPeak)} / ${x.exit ?? 'לא יצא'} / ${pct(x.dropToExit)} / ${x.reentries}`;
  L.push(`| ${pct(-e.dd)} | ${iso(e.peak)} | ${iso(e.trough)} | ${e.rec ? iso(e.rec) : 'עוד לא'} | ${pct(-e.passiveDD)} | ${c(e.coins[0])} | ${c(e.coins[1])} |`); }
L.push('', '**רגישות לתנאי שיפוע הממוצע** (מ-2022 / כל התקופה): ' + ['S200-M', 'S200s10-M', 'S200s20-M', 'S200s40-M'].map((k) => `${V[k].name.replace('70/30 + ', '')}: ${pct(V[k].m.s22.cagr)} / ${pct(V[k].m.all.cagr)}, ירידה ${pct(-V[k].m.all.maxDD)}`).join(' · '), '');
L.push('## שלב 2 — הניסוי: יעד תנודתיות 35%, איזון שבועי', '',
  `**הקריטריון (נשמר בקוד לפני ההרצה, \`VT_PASS\` ב-engine/base-vt.js):** (1) ירידה מקסימלית ≤ ${VT_PASS.maxDD * 100}% באימון, באימות ובמבחן · (2) תשואה ÷ ירידה גבוהה מממוצע 200 המקורי בלפחות ${VT_PASS.calmarWins} מ-3 התקופות וגם על כל התקופה · ` +
  `(3) תשואה שנתית מ-2022 לא נמוכה ביותר מ-${VT_PASS.s22Gap * 100} נקודות מהמקורי · (4) עמידות: (1)+(2) גם ביעד 30% וביעד 40% ובעלויות כפולות. מידע: יעד 20% בשנה באימות ובמבחן.`, '',
  '| | עמידה |', '|---|---|',
  `| (1) ירידה ≤ 35% בכל תקופה | ${yn(VERDICT.c1)} (${['train', 'val', 'test'].map((w) => pct(-V.VT35.m[w].maxDD)).join(' / ')}) |`,
  `| (2) תשואה ÷ ירידה מול המקורי | ${yn(VERDICT.c2)} (${E.VT35.wins} מ-3; כל התקופה ${f2(V.VT35.m.all.calmar)} מול ${f2(V['S200-M'].m.all.calmar)}) |`,
  `| (3) מ-2022 לא פחות מ-5 נקודות | ${yn(VERDICT.c3)} (${pct(V.VT35.m.s22.cagr)} מול ${pct(V['S200-M'].m.s22.cagr)}) |`,
  `| (4) עמידות (30%, 40%, עלויות כפולות) | ${yn(VERDICT.c4)} (${['VT30', 'VT40', 'VT35x2'].map((k) => `${k}: ${yn(E[k].c1 && E[k].c2)}`).join(', ')}) |`,
  `| **עובר?** | ${VERDICT.pass ? '**כן**' : '**לא**'} |`,
  `| מידע: 20% בשנה באימות ובמבחן | ${yn(VERDICT.goal)} (${pct(V.VT35.m.val.cagr)} / ${pct(V.VT35.m.test.cagr)}) |`, '');
tbl(['P-M', 'S200-M', 'P-W', 'S200-W', 'VT35', 'VT30', 'VT40', 'VT35x2']);
L.push('### חשיפה ממוצעת ושארפ', '', '| | חשיפה (הכול) | שארפ מ-2022 | התאוששות ארוכה (ימים, הכול) |', '|---|---|---|---|');
for (const k of ['P-M', 'S200-M', 'S200-W', 'VT35', 'VT30', 'VT40']) L.push(`| ${V[k].name} | ${Math.round(V[k].m.all.exposure * 100)}% | ${f2(V[k].m.s22.sharpe)} | ${V[k].m.all.rec} |`);
const ys = Object.keys(V['P-M'].m.yearly).sort();
L.push('', '## תשואה לפי שנה', '', `| | ${ys.join(' | ')} |`, `|---|${ys.map(() => '---').join('|')}|`);
for (const k of ['P-M', 'S200-M', 'S200s20-M', 'S200-W', 'VT35', 'VT30', 'VT40']) L.push(`| ${V[k].name} | ${ys.map((y) => pct(V[k].m.yearly[y])).join(' | ')} |`);
L.push('', `(${ys[0]} חלקית — מ-${iso(START)}.)`, '');
const md = L.join('\n') + '\n';
if (OUT) writeFileSync(OUT, md); else process.stdout.write(md);
if (JOUT) writeFileSync(JOUT, JSON.stringify({ meta: { start: iso(START), last: iso(LAST - DAY), VT_PASS }, audit: { sameReb, look, timing: TIM, prev }, episodes: EPD.map((e) => ({ ...e, peak: iso(e.peak), trough: iso(e.trough), rec: e.rec ? iso(e.rec) : null })), variants: Object.fromEntries(Object.entries(V).map(([k, v]) => [k, { name: v.name, o: v.o, m: v.m }])), criterion: E, verdict: VERDICT }, null, 1));
