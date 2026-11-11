#!/usr/bin/env node
// בוט 3 (שיטת הקורס): איך מגבילים את ההפסד הגדול כשגם המנה השלישית נכנסת? מחקר בלבד — אין פקודות ואין מפתחות.
// בקשת מאיר (11/11/2026): "אני רואה שיש הרבה עסקאות מוצלחות. והסטופ בשליש האחרון יוצר הפסדים גדולים. איך בכל זאת ניתן להימנע
// מסטופ כזה מאוחר ומהפסד גדול... תבדוק איך אפשר להגביל".
//
// האות: בדיוק של בוט 3 (CANON, engine/amit3-exec.js), אותם 8 מטבעות ואותם סוגי מטבע. משתנה רק ניהול העסקה (engine/amit-course.js → execute):
//   משקלות: 30-60-90 של הקורס (1/6,1/3,1/2) · שווה (1/3 כל אחת) · הפוך (1/2,1/3,1/6) · בלי השלישית (1/3,2/3) · כניסה אחת
//   כלל אחרי מילוי מלא: אין · סטופ 0.3%/0.6% מתחת למנה האחרונה · יציאה בממוצע (0 / +0.3%) · סגירה אחרי 30/60/120 דק׳ · ממוצע + 60 דק׳
//   סטופ בסיס: של הקורס · 1% מתחת למנה האחרונה המתוכננת · 2/4 × ATR(14) של 15 דק׳ (הצעה מ-GPT)
//   מנה שלישית רק אחרי אישור היפוך (נר 15 דק׳ שנסגר חזרה מעל הקו שלה תוך 4/8/12 נרות; הצעה מ-GPT)
// הגודל תמיד מנורמל: הפסד מלא (כל המנות + סטופ) = 400$ = 1R. כך ההשוואה בין משקלות הוגנת.
//
// קריטריון שנקבע מראש (לפני הריצה, לא משנים אחריה):
//   • בוחרים גרסה אחת לפי תקופת האימון בלבד (11/2021–11/2024, R נטו ממוצע, לפחות 100 עסקאות).
//   • היא "עוברת" רק אם: R נטו > 0 בכל 4 התקופות (כולל מבחן נקי 2020–21 ומבחן 11/2025–11/2026), טובה מאותה גאומטריה בזמנים אקראיים
//     בכל התקופות יחד, ו-R נטו > 0 על 20 מטבעות חדשים שלא היו בבחירה.
// שימוש: node --max-old-space-size=6500 invest-api/scripts/research-amit3-stop.mjs --from 2020-01 --to 2026-10 --cache DIR --outdir DIR
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepare, triggers, execute, randomTriggers, CANON, COIN_CAT, RISK_USD } from '../engine/amit-course.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUTDIR = arg('--outdir', 'invest/docs/research/amit3-stop');
const COINS = arg('--coins', 'BTC,SOL,AVAX,ADA,INJ,RENDER,NEAR,FARTCOIN').split(',');
const VCOINS = arg('--vcoins', 'XRP,DOGE,LINK,DOT,LTC,BCH,ATOM,UNI,AAVE,FIL,ETC,XLM,TRX,ALGO,SAND,AXS,APT,ARB,OP,SUI').split(',').filter(Boolean);
const VCAT = { DOGE: 'vol' };
const BOT_RISK = 200;   // סיכון לעסקה בבוט 3 (BOT3.riskUsd) — להמרת R לדולרים
const log = (...a) => console.error(...a), D = (s) => Date.parse(`${s}T00:00:00Z`), iso = (t) => new Date(t).toISOString().slice(0, 10);
export const PERIODS = { hold: { from: D('2020-01-01'), to: D('2021-11-01'), he: 'מבחן נקי 2020–21' }, train: { from: D('2021-11-01'), to: D('2024-11-01'), he: 'אימון 11/21–11/24' },
  val: { from: D('2024-11-01'), to: D('2025-11-01'), he: 'אימות 11/24–11/25' }, test: { from: D('2025-11-01'), to: D('2026-11-01'), he: 'מבחן 11/25–11/26' } };
const ALL = { from: PERIODS.hold.from, to: PERIODS.test.to, he: 'הכול' };

export const WEIGHTS = { course: [1 / 6, 1 / 3, 1 / 2], equal: [1 / 3, 1 / 3, 1 / 3], front: [1 / 2, 1 / 3, 1 / 6], two: [1 / 3, 2 / 3, 0] };
export const RULES = { none: null, sl03: { sl: 0.3 }, sl06: { sl: 0.6 }, be0: { be: 0 }, be03: { be: 0.3 }, t30: { min: 30 }, t60: { min: 60 }, t120: { min: 120 }, be0t60: { be: 0, min: 60 } };
export const W_HE = { course: '30-60-90 (1/6, 1/3, 1/2)', equal: 'שווה (1/3 כל אחת)', front: 'הפוך (1/2, 1/3, 1/6)', two: 'בלי השלישית (1/3, 2/3)', single: 'כניסה אחת' };
export const R_HE = { none: 'כמו היום', sl03: 'סטופ 0.3% מתחת למנה האחרונה', sl06: 'סטופ 0.6% מתחת למנה האחרונה', be0: 'יציאה בממוצע', be03: 'יציאה ב+0.3% מעל הממוצע',
  t30: 'סגירה אחרי 30 דק׳', t60: 'סגירה אחרי 60 דק׳', t120: 'סגירה אחרי 120 דק׳', be0t60: 'יציאה בממוצע, או סגירה אחרי 60 דק׳' };
// סטופ בסיס: של הקורס · 1% מתחת למנה האחרונה · k × ATR(14) של 15 דק׳ מתחת למנה האחרונה (הצעה מ-GPT, 11/11/2026)
export const STOPS = ['course', 1, 'atr2', 'atr4'];
const stopOpt = (stop) => (String(stop).startsWith('atr') ? { stop: 'course', stopAtr: Number(String(stop).slice(3)) } : { stop });
export const stopHe = (stop) => (stop === 'course' ? 'של הקורס' : String(stop).startsWith('atr') ? `${String(stop).slice(3)}×ATR` : `${stop}%`);
export function variants(){
  const out = [];
  for (const stop of STOPS){
    for (const w of Object.keys(WEIGHTS)) for (const r of Object.keys(RULES)) out.push({ key: `${w}-${r}-sl${stop}`, w, c3: 0, r, stop, opt: { entry: 'ladder', exit: 'course', ...stopOpt(stop), weights: WEIGHTS[w], full: RULES[r] } });
    out.push({ key: `single-none-sl${stop}`, w: 'single', c3: 0, r: 'none', stop, opt: { entry: 'single', exit: 'course', ...stopOpt(stop) } });
  }
  // מנה שלישית רק אחרי אישור היפוך: נר 15 דק׳ שנסגר חזרה מעל הקו שלה תוך 4/8/12 נרות (הצעה מ-GPT, 11/11/2026)
  for (const c3 of [4, 8, 12]) for (const stop of ['course', 1]) for (const r of ['none', 'be0', 't60'])
    out.push({ key: `course-c3n${c3}-${r}-sl${stop}`, w: 'course', c3, r, stop, opt: { entry: 'ladder', exit: 'course', ...stopOpt(stop), weights: WEIGHTS.course, full: RULES[r], confirm3: c3 } });
  return out;
}
export const BASE = 'course-none-slcourse';   // בוט 3 כמו שהוא היום

// עמודות לכל גרסה: זמן כניסה, נטו בדולרים (ל-400$ סיכון), מספר מילויים, האם מילוי מלא, מטבע
const cols = () => ({ t: [], net: [], fills: [], full: [], coin: [] });
const nW = (v) => (v.w === 'single' ? 1 : WEIGHTS[v.w].filter((x) => x > 0).length);
function push(c, trades, v, ci){ for (const x of trades){ c.t.push(x.tEntry); c.net.push(x.gross - x.fees - x.spread - x.slip - x.funding); c.fills.push(x.fills); c.full.push(x.fills >= nW(v)); c.coin.push(ci); } }

export function stat(c, p){
  const idx = []; for (let i = 0; i < c.t.length; i++) if (c.t[i] >= p.from && c.t[i] < p.to) idx.push(i);
  idx.sort((a, b) => c.t[a] - c.t[b]);
  let s = 0, s2 = 0, w = 0, sw = 0, nl = 0, sl = 0, full = 0, big = 0, worst = 0, eq = 0, peak = 0, dd = 0;
  for (const i of idx){
    const r = c.net[i] / RISK_USD; s += r; s2 += r * r;
    if (r > 0){ w++; sw += r; } else { nl++; sl += r; }
    if (c.full[i]) full++; if (r <= -0.5) big++; if (r < worst) worst = r;
    eq += r; if (eq > peak) peak = eq; if (peak - eq > dd) dd = peak - eq;
  }
  const n = idx.length, m = n ? s / n : NaN, sd = n > 1 ? Math.sqrt(Math.max(0, (s2 - n * m * m) / (n - 1))) : NaN, se = sd / Math.sqrt(n);
  return { n, R: m, lo: m - 1.96 * se, hi: m + 1.96 * se, sumR: s, win: n ? w / n * 100 : NaN, avgWin: w ? sw / w : NaN, avgLoss: nl ? sl / nl : NaN,
    fullPct: n ? full / n * 100 : NaN, bigPct: n ? big / n * 100 : NaN, worst, ddR: dd };
}
// בחירה לפי אימון בלבד (נקבע מראש)
export function pick(S, minN = 100){ return [...S.values()].filter((x) => x.train.n >= minN).sort((a, b) => b.train.R - a.train.R)[0] || null; }
export function passes(x, v){ return Object.keys(PERIODS).every((p) => x[p].R > 0) && x.all.R > x.rnd.all.R && !!v && v.R > 0; }

async function run(coins, V, catOf, seed){
  const { loadCoin } = await import('./research-amit-course.mjs');
  const T = new Map(V.map((v) => [v.key, cols()])), Rn = new Map(V.map((v) => [v.key, cols()])), meta = {};
  for (const [ci, coin] of coins.entries()){
    const d = await loadCoin(coin); meta[coin] = { first: d.first, bars: d.m1.t.length, cat: catOf(coin) };
    if (d.m1.t.length < 50000) continue;
    const ctx = prepare(d.m1), tg = triggers(ctx, catOf(coin), CANON), rnd = randomTriggers(ctx, tg, seed + ci);
    for (const v of V){ const o = { coin, ...v.opt }; push(T.get(v.key), execute(ctx, tg, o), v, ci); push(Rn.get(v.key), execute(ctx, rnd, o), v, ci); }
    log(`${coin}: ${tg.length} טריגרים`);
  }
  return { T, Rn, meta };
}

const f = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d) : '—');
const pc = (x) => (Number.isFinite(x) ? `${x.toFixed(0)}%` : '—');
const usd = (R) => (Number.isFinite(R) ? (R < 0 ? '−' : '+') + '$' + Math.abs(Math.round(R * BOT_RISK)).toLocaleString('en-US') : '—');
const name = (x) => `${W_HE[x.v.w]}${x.v.c3 ? ` · שלישית רק באישור (${x.v.c3} נרות)` : ''} · ${R_HE[x.v.r]} · סטופ ${stopHe(x.v.stop)}`;

async function main(){
  const V = variants(), t0 = Date.now();
  const A = await run(COINS, V, (c) => COIN_CAT[c] || 'follow', 41);
  const S = new Map(V.map((v) => { const c = A.T.get(v.key), r = A.Rn.get(v.key);
    return [v.key, { v, ...Object.fromEntries([...Object.keys(PERIODS), 'all'].map((p) => [p, stat(c, p === 'all' ? ALL : PERIODS[p])])), rnd: { all: stat(r, ALL) } }]; }));
  const base = S.get(BASE), best = pick(S);
  // אימות על 20 מטבעות חדשים: הבסיס, הנבחרת, והטובה (לפי אימון) בכל כלל — נקבע לפני שרואים את המטבעות
  const byRule = [...Object.keys(RULES).map((r) => pick(new Map([...S].filter(([, x]) => x.v.r === r && x.v.w !== 'single' && !x.v.c3)))),
    pick(new Map([...S].filter(([, x]) => x.v.c3))), pick(new Map([...S].filter(([, x]) => String(x.v.stop).startsWith('atr'))))].filter(Boolean);
  const vKeys = [...new Set([BASE, best?.v.key, ...byRule.map((x) => x.v.key)].filter(Boolean))], VV = V.filter((v) => vKeys.includes(v.key));
  const B = VCOINS.length ? await run(VCOINS, VV, (c) => VCAT[c] || 'follow', 77) : null;
  const VS = new Map(VV.map((v) => [v.key, B ? stat(B.T.get(v.key), ALL) : null]));
  log(`סיום (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

  const md = [], ok = best && passes(best, VS.get(best.v.key));
  md.push('# בוט 3: איך מגבילים את ההפסד כשגם המנה השלישית נכנסת? — 2020–2026, נרות דקה', '');
  md.push('בקשת מאיר (11/11/2026): "יש הרבה עסקאות מוצלחות, והסטופ בשליש האחרון יוצר הפסדים גדולים. איך ניתן להימנע מסטופ מאוחר ומהפסד גדול?"', '');
  md.push(`- **האות:** בדיוק של בוט 3 (גרסת הקורס), ${COINS.filter((c) => A.meta[c]?.bars >= 50000).map((c) => `${c}${A.meta[c].first > '2020-01-01' ? ` (מ-${A.meta[c].first})` : ''}`).join(', ')}.`);
  md.push(`- **מה משתנה:** רק ניהול העסקה — ${V.length} גרסאות (משקלות × כלל אחרי מילוי מלא × סטופ).`);
  md.push(`- **R:** רווח/הפסד ביחס להפסד המלא המתוכנן. בבוט 3 הפסד מלא = ${BOT_RISK}$, ולכן "$ בבוט" = R × ${BOT_RISK}. עלויות Bybit מלאות.`);
  md.push(`- **תקופות:** ${Object.values(PERIODS).map((p) => `${p.he}`).join(' · ')}. אימות: ${VCOINS.length} מטבעות חדשים.`);
  md.push('- **קריטריון שנקבע מראש:** בחירה לפי אימון בלבד; עוברת רק אם R > 0 בכל 4 התקופות, טובה מהאקראי, ו-R > 0 על המטבעות החדשים.', '');

  md.push('## 1. מה מאיר רואה — בוט 3 כמו היום, לפי מספר המנות שהתמלאו', '| מנות שהתמלאו | עסקאות | הצלחה | R ממוצע | $ בבוט לעסקה |', '|---|---|---|---|---|');
  { const c = A.T.get(BASE); for (const k of [1, 2, 3]){ const sub = cols(); c.t.forEach((t, i) => { if (c.fills[i] === k){ sub.t.push(t); sub.net.push(c.net[i]); sub.full.push(c.full[i]); sub.fills.push(k); } }); const x = stat(sub, ALL); md.push(`| ${k} | ${x.n} | ${pc(x.win)} | ${f(x.R)} | ${usd(x.R)} |`); } }
  md.push(`| **הכול** | ${base.all.n} | ${pc(base.all.win)} | ${f(base.all.R)} | ${usd(base.all.R)} |`, '');

  md.push('## 2. הכללים אחרי מילוי מלא (משקלות 30-60-90, סטופ של הקורס)', '| כלל | עסקאות | הצלחה | רווח ממוצע | הפסד ממוצע | הפסדים ≥ ½R | הפסד מקס׳ | R נטו | $ בבוט לעסקה | ירידה מקס׳ (R) | R אקראי |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of Object.keys(RULES)){ const x = S.get(`course-${r}-slcourse`); md.push(`| ${R_HE[r]} | ${x.all.n} | ${pc(x.all.win)} | ${f(x.all.avgWin)} | ${f(x.all.avgLoss)} | ${pc(x.all.bigPct)} | ${f(x.all.worst, 2)} | ${f(x.all.R)} | ${usd(x.all.R)} | ${x.all.ddR.toFixed(1)} | ${f(x.rnd.all.R)} |`); }
  md.push('');
  md.push('## 3. משקלות (בלי כלל נוסף)', '| משקלות | סטופ | עסקאות | הצלחה | רווח ממוצע | הפסד ממוצע | R נטו | $ בבוט לעסקה |', '|---|---|---|---|---|---|---|---|');
  for (const stop of STOPS) for (const w of [...Object.keys(WEIGHTS), 'single']){ const x = S.get(`${w}-none-sl${stop}`); md.push(`| ${W_HE[w]} | ${stopHe(stop)} | ${x.all.n} | ${pc(x.all.win)} | ${f(x.all.avgWin)} | ${f(x.all.avgLoss)} | ${f(x.all.R)} | ${usd(x.all.R)} |`); }
  md.push('');

  md.push('## 3א. מנה שלישית רק אחרי אישור היפוך (30-60-90)', '| אישור תוך | סטופ | כלל | עסקאות | הצלחה | רווח ממוצע | הפסד ממוצע | הפסדים ≥ ½R | R נטו | $ בבוט לעסקה | R אקראי |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const x of [...S.values()].filter((y) => y.v.c3)) md.push(`| ${x.v.c3} נרות | ${stopHe(x.v.stop)} | ${R_HE[x.v.r]} | ${x.all.n} | ${pc(x.all.win)} | ${f(x.all.avgWin)} | ${f(x.all.avgLoss)} | ${pc(x.all.bigPct)} | ${f(x.all.R)} | ${usd(x.all.R)} | ${f(x.rnd.all.R)} |`);
  md.push('');
  md.push('## 3ב. מה כל כלל עושה בכל סטופ (30-60-90) — R נטו, כל התקופות', `| כלל | ${STOPS.map(stopHe).join(' | ')} |`, `|---|${STOPS.map(() => '---|').join('')}`);
  for (const r of Object.keys(RULES)) md.push(`| ${R_HE[r]} | ${STOPS.map((st) => f(S.get(`course-${r}-sl${st}`).all.R)).join(' | ')} |`);
  md.push('');
  md.push('## 4. לפי תקופה — הבסיס, הנבחרת והטובה בכל כלל (נבחרה לפי אימון)', `| גרסה | ${Object.values(PERIODS).map((p) => p.he).join(' | ')} | הכול | אקראי | ${VCOINS.length} מטבעות חדשים |`, `|---|${Object.keys(PERIODS).map(() => '---|').join('')}---|---|---|`);
  for (const k of vKeys){ const x = S.get(k), v = VS.get(k); md.push(`| ${k === BASE ? '**היום:** ' : k === best?.v.key ? '**נבחרת:** ' : ''}${name(x)} | ${Object.keys(PERIODS).map((p) => `${f(x[p].R)} (${x[p].n})`).join(' | ')} | ${f(x.all.R)} | ${f(x.rnd.all.R)} | ${v ? `${f(v.R)} (${v.n})` : '—'} |`); }
  md.push('');
  md.push('## 5. מסקנה', '');
  md.push(best ? `- **הנבחרת לפי אימון:** ${name(best)} — אימון ${f(best.train.R)}, הכול ${f(best.all.R)} (${usd(best.all.R)} לעסקה בבוט), מטבעות חדשים ${f(VS.get(best.v.key)?.R)}.` : '- אין גרסה עם מספיק עסקאות.');
  md.push(`- **הקריטריון שנקבע מראש:** ${ok ? '**עברה** — אפשר להציע אותה לדמו (החלטה של מאיר).' : '**לא עברה** — אף גרסת ניהול לא עמדה בקריטריון (ראו סעיף 4 לכל תקופה).'}`);
  md.push(`- **בוט 3 היום:** ${f(base.all.R)} לעסקה (${usd(base.all.R)}), הצלחה ${pc(base.all.win)}, הפסד ממוצע ${f(base.all.avgLoss)} מול רווח ממוצע ${f(base.all.avgWin)}.`);

  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(join(OUTDIR, 'report.md'), md.join('\n') + '\n');
  const csv = ['key,period,n,R,lo,hi,win,avgWin,avgLoss,fullPct,bigPct,worst,ddR'];
  for (const [k, x] of S) for (const p of [...Object.keys(PERIODS), 'all']){ const s = x[p]; csv.push([k, p, s.n, s.R, s.lo, s.hi, s.win, s.avgWin, s.avgLoss, s.fullPct, s.bigPct, s.worst, s.ddR].map((y) => (typeof y === 'number' ? +y.toFixed(5) : y)).join(',')); }
  writeFileSync(join(OUTDIR, 'results.csv'), csv.join('\n') + '\n');
  writeFileSync(join(OUTDIR, 'meta.json'), JSON.stringify({ coins: A.meta, vcoins: B?.meta || {}, variants: V.length, best: best?.v.key || null, passes: ok, base: BASE, validated: Object.fromEntries([...VS].map(([k, v]) => [k, v])) }, null, 1));
  console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
