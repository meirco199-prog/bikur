#!/usr/bin/env node
// חקירה: האם אפשר להוציא מהשיטה של עמית גרסה רווחית? (בקשת מאיר 10/11/2026: סטופ צמוד, יציאה מהירה ברווח, הרבה עסקאות, ווליום
// כשיקול כניסה, עד 5,000$ לעסקה). 1,620 גרסאות (engine/amit-course.js → grid2), כל אחת מול קבוצת ביקורת אקראית באותה גאומטריה.
// מחקר בלבד — אין פקודות ואין מפתחות.
//
// הגנה מפני "מציאת מזל" ב-1,620 ניסיונות:
//   • בחירה לפי אימון בלבד (11/2021–11/2024), אימות 11/2024–11/2025, מבחן 11/2025–11/2026 (נצפה כבר בבדיקה הקודמת לגרסה הנאמנה בלבד).
//   • **מבחן נקי שאף גרסה לא ראתה: 1/2020–10/2021** (תקופה מוקדמת יותר — הורדה רק עכשיו).
//   • Walk-Forward: בכל קפל בוחרים מחדש מכל 1,620 הגרסאות ומודדים בתקופה שאחריו.
// שימוש: node --max-old-space-size=6500 invest-api/scripts/research-amit-explore.mjs --from 2020-01 --to 2026-10 --cache DIR --outdir DIR
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCoin } from './research-amit-course.mjs';
import { prepare, triggers, execute, randomTriggers, grid2, key2, sig2, COIN_CAT, RISK_USD } from '../engine/amit-course.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUTDIR = arg('--outdir', 'invest/docs/research/amit-course'), COINS = arg('--coins', 'BTC,ETH,SOL,AVAX,ADA,INJ,RENDER,NEAR,FARTCOIN').split(',');
const log = (...a) => console.error(...a), D = (s) => Date.parse(`${s}T00:00:00Z`), DAY = 86400e3, iso = (t) => new Date(t).toISOString().slice(0, 10);
const P = { hold: { from: D('2020-01-01'), to: D('2021-11-01') }, train: { from: D('2021-11-01'), to: D('2024-11-01') }, val: { from: D('2024-11-01'), to: D('2025-11-01') }, test: { from: D('2025-11-01'), to: D('2026-11-01') } };
const WF0 = D('2021-11-01'), WF1 = D('2026-11-01'), folds = [];
for (let d = 603; WF0 + (d + 1) * DAY <= WF1; d += 150) folds.push({ train: { from: WF0 + (d - 603) * DAY, to: WF0 + d * DAY }, test: { from: WF0 + d * DAY, to: Math.min(WF0 + (d + 150) * DAY, WF1) } });

// אחסון דחוס: לכל גרסה עמודות (זמן כניסה, נטו, ברוטו, נומינלי, מטבע)
const newCols = () => ({ t: [], net: [], gross: [], not: [], coin: [] });
const push = (c, tr, ci) => { for (const x of tr){ c.t.push(x.tEntry); c.net.push(x.gross - x.fees - x.spread - x.slip - x.funding); c.gross.push(x.gross); c.not.push(x.notional); c.coin.push(ci); } };
function st(c, p){
  let n = 0, s = 0, s2 = 0, g = 0, w = 0, r5 = 0, g5 = 0; const byCoin = new Float64Array(COINS.length);
  for (let i = 0; i < c.t.length; i++){
    if (c.t[i] < p.from || c.t[i] >= p.to) continue;
    const r = c.net[i] / RISK_USD; n++; s += r; s2 += r * r; g += c.gross[i] / RISK_USD; if (c.net[i] > 0) w++;
    if (c.not[i] > 0){ r5 += c.net[i] / c.not[i] * 5000; g5 += c.gross[i] / c.not[i] * 5000; } byCoin[c.coin[i]] += c.net[i];
  }
  const m = n ? s / n : NaN, sd = n > 1 ? Math.sqrt(Math.max(0, (s2 - n * m * m) / (n - 1))) : NaN, se = sd / Math.sqrt(n);
  return { n, net: s * RISK_USD, R: m, lo: m - 1.96 * se, hi: m + 1.96 * se, gR: n ? g / n : NaN, win: n ? w / n * 100 : NaN, per5k: n ? r5 / n : NaN, gross5k: n ? g5 / n : NaN,
    perDay: n / ((p.to - p.from) / DAY), coinsPos: [...byCoin].filter((v) => v > 0).length };
}
const score = (s) => (s.n >= 100 && s.coinsPos >= 5 ? s.lo : null);

const f = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d) : '—');
const f$ = (x) => (Number.isFinite(x) ? (x < 0 ? '−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US') : '—');
const f$2 = (x) => (Number.isFinite(x) ? (x < 0 ? '−' : '+') + '$' + Math.abs(x).toFixed(2) : '—');

async function main(){
  const V = grid2(), sigs = [...new Map(V.map((v) => [sig2(v), v])).values()];
  const T = new Map(V.map((v) => [key2(v), newCols()])), R = new Map(V.map((v) => [key2(v), newCols()])), meta = {};
  const t0 = Date.now();
  for (const [ci, coin] of COINS.entries()){
    const d = await loadCoin(coin); meta[coin] = { first: d.first, bars: d.m1.t.length };
    if (d.m1.t.length < 50000) continue;
    const ctx = prepare(d.m1);
    for (const s of sigs){
      const tg = triggers(ctx, COIN_CAT[coin], s), rnd = randomTriggers(ctx, tg, 11 + ci);
      for (const v of V){ if (sig2(v) !== sig2(s)) continue; const o = { coin, entry: v.entry, exit: v.exit, stop: v.stop, maxHoldMin: v.hold }; push(T.get(key2(v)), execute(ctx, tg, o), ci); push(R.get(key2(v)), execute(ctx, rnd, o), ci); }
    }
    log(`${coin}: סיום (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  const S = new Map(V.map((v) => { const k = key2(v), c = T.get(k), r = R.get(k); return [k, { v, k, ...Object.fromEntries(Object.keys(P).map((p) => [p, st(c, P[p])])), rnd: Object.fromEntries(Object.keys(P).map((p) => [p, st(r, P[p])])) }]; }));
  const all = [...S.values()];
  const pickBy = (cands) => cands.map((x) => ({ x, sc: score(x.train) })).filter((y) => y.sc !== null).sort((a, b) => b.sc - a.sc)[0]?.x || null;
  // Walk-Forward על כל הרשת
  const wfOf = (cands) => { const oos = newCols(), picks = []; for (const fo of folds){ const b = cands.map((x) => ({ k: x.k, sc: score(st(T.get(x.k), fo.train)) })).filter((y) => y.sc !== null).sort((a, b) => b.sc - a.sc)[0]; picks.push(b ? b.k : '—'); if (!b) continue; const c = T.get(b.k); for (let i = 0; i < c.t.length; i++) if (c.t[i] >= fo.test.from && c.t[i] < fo.test.to){ oos.t.push(c.t[i]); oos.net.push(c.net[i]); oos.gross.push(c.gross[i]); oos.not.push(c.not[i]); oos.coin.push(c.coin[i]); } } return { s: st(oos, { from: folds[0].test.from, to: folds.at(-1).test.to }), picks }; };

  const md = [];
  md.push(`# חקירה: האם אפשר להוציא מהשיטה של עמית גרסה רווחית? — ${V.length.toLocaleString()} גרסאות, נרות דקה 2020–2026`, '');
  md.push(`בקשת מאיר: סטופ צמוד, יציאה מהירה ברווח, הרבה עסקאות, ווליום כשיקול כניסה, עד 5,000$ לעסקה. מטבעות: ${COINS.filter((c) => meta[c]?.bars >= 50000).map((c) => `${c}${meta[c].first > '2020-01-01' ? ` (מ-${meta[c].first})` : ''}`).join(', ')}.`);
  md.push(`תקופות: **מבחן נקי (לא נראה אף פעם) ${iso(P.hold.from)}→${iso(P.hold.to)}** · אימון ${iso(P.train.from)}→${iso(P.train.to)} · אימות →${iso(P.val.to)} · מבחן →${iso(P.test.to)} · Walk-Forward ${folds.length} קפלים (603→150 ימים).`);
  md.push(`עלויות Bybit מלאות (עמלות 2/5.5bp, מרווח, החלקה, Funding). R = רווח/הפסד ביחס ל-${RISK_USD}$ סיכון. "על 5,000$" = הרווח הממוצע לעסקה אם נכנסים ב-5,000$ (התוצאה ביחס לסכום שנכנס בפועל).`, '');
  md.push('**מה משתנה ברשת:** אזור — חצי תחתון / רבע תחתון · ווליום ×3/×5/×10 · נר — כל נר / ירוק / "שטיפה וחזרה" (ירד מתחת לאזור וחזר בנר ירוק) · כניסה — 30-60-90 / הכול בטריגר / רק בהנזלה · סטופ — של הקורס / 1% / 0.5% · יציאה — של הקורס / הכול ברמה הקרובה / יעד +0.5% / +1% / +1.5% · זמן — עד 24 שעות / 4 שעות.', '');
  const cnt = (pred) => all.filter(pred).length;
  md.push('## 1. כמה גרסאות מרוויחות?', '| תקופה | R נטו > 0 | גבול תחתון 95% > 0 | R ברוטו > 0 | טובה מהאקראי (R ברוטו) |', '|---|---|---|---|---|');
  for (const [p, name] of [['train', 'אימון'], ['val', 'אימות'], ['test', 'מבחן'], ['hold', '**מבחן נקי 2020–21**']]) md.push(`| ${name} | ${cnt((x) => x[p].R > 0)} | ${cnt((x) => x[p].lo > 0)} | ${cnt((x) => x[p].gR > 0)} | ${cnt((x) => x[p].gR > x.rnd[p].gR)} |`);
  md.push(`| כל התקופות יחד (אימון+אימות+מבחן+נקי, כל אחת > 0) | ${cnt((x) => ['train', 'val', 'test', 'hold'].every((p) => x[p].R > 0))} | | | |`, '');
  const row = (label, x) => x ? `| ${label} | \`${x.k}\` | ${x.train.n} | ${f(x.train.win, 0)}% | ${f(x.train.R)} | ${f(x.rnd.train.R)} | ${f(x.val.R)} | ${f(x.test.R)} | **${f(x.hold.R)}** (${x.hold.n}) | ${f$2(x.hold.per5k)} | ${x.train.perDay.toFixed(1)} |` : `| ${label} | — (אף גרסה לא עמדה בתנאי המינימום) | | | | | | | | | |`;
  const head = '| | גרסה | עסקאות באימון | הצלחה | R אימון | R אקראי | R אימות | R מבחן | **R מבחן נקי** (עסקאות) | על 5,000$ במבחן הנקי | עסקאות ליום |\n|---|---|---|---|---|---|---|---|---|---|---|';
  md.push('## 2. הגרסה הטובה ביותר בכל משפחה (נבחרה לפי אימון בלבד)', head);
  const fam = [
    ['כל הרשת', () => true],
    ['סטופ צמוד (0.5% / 1%)', (v) => v.stop !== 'course'],
    ['יציאה מהירה (+0.5% / +1%)', (v) => v.exit === 0.5 || v.exit === 1],
    ['סטופ צמוד + יציאה מהירה + 4 שעות', (v) => v.stop !== 'course' && (v.exit === 0.5 || v.exit === 1) && v.hold === 240],
    ['הרבה עסקאות (ווליום ×3, כל נר)', (v) => v.kv === 3 && v.candle === 'any'],
    ['ווליום חזק (×10)', (v) => v.kv === 10],
    ['שטיפה וחזרה', (v) => v.candle === 'reclaim'],
    ['כניסה רק בהנזלה', (v) => v.entry === 'deep'],
    ['30-60-90 כמו בקורס', (v) => v.entry === 'ladder'],
    ['כניסה אחת', (v) => v.entry === 'single'],
  ];
  const famRes = fam.map(([name, pred]) => { const c = all.filter((x) => pred(x.v)), b = pickBy(c); md.push(row(name, b)); return { name, best: b?.k || null, wf: wfOf(c) }; });
  md.push('', '### Walk-Forward לכל משפחה (בחירה מחדש בכל קפל, מדידה בתקופה שאחריו)', '| משפחה | עסקאות | R נטו [95%] | נטו | על 5,000$ |', '|---|---|---|---|---|', ...famRes.map((r) => `| ${r.name} | ${r.wf.s.n} | ${f(r.wf.s.R)} [${f(r.wf.s.lo)}, ${f(r.wf.s.hi)}] | ${f$(r.wf.s.net)} | ${f$2(r.wf.s.per5k)} |`), '');
  const top = [...all].sort((a, b) => (b.train.R || -9) - (a.train.R || -9)).filter((x) => x.train.n >= 100).slice(0, 20);
  md.push('## 3. 20 הגרסאות עם R הגבוה באימון (לפחות 100 עסקאות) — מה קרה להן אחר כך', '| גרסה | עסקאות | R אימון | R אקראי | R אימות | R מבחן | R מבחן נקי | על 5,000$ (נקי) |', '|---|---|---|---|---|---|---|---|', ...top.map((x) => `| \`${x.k}\` | ${x.train.n} | ${f(x.train.R)} | ${f(x.rnd.train.R)} | ${f(x.val.R)} | ${f(x.test.R)} | ${f(x.hold.R)} | ${f$2(x.hold.per5k)} |`), '');
  // יציאה מהירה: כמה מהרווח הולך לעלויות
  const q = all.filter((x) => x.v.exit === 0.5 && x.v.stop === 0.5 && x.v.entry === 'single' && x.v.hold === 240);
  const agg = (p) => { let n = 0, g = 0, nn = 0; for (const x of q){ n += x[p].n; g += x[p].gross5k * x[p].n || 0; nn += x[p].per5k * x[p].n || 0; } return { n, g: g / n, nn: nn / n }; };
  const a = agg('train');
  md.push('## 4. למה "הרבה עסקאות קטנות" קשה', `ממוצע על כל גרסאות "כניסה אחת, סטופ 0.5%, יעד +0.5%, עד 4 שעות" באימון (${a.n} עסקאות): לפני עלויות ${f$2(a.g)} לעסקה של 5,000$, אחרי עלויות ${f$2(a.nn)}. עמלה הלוך-חזור בשוק ≈ 0.11% (5.50$ על 5,000$) + מרווח והחלקה — כשהיעד 0.5% (25$), העלויות הן כרבע עד שליש מהרווח.`, '');
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(join(OUTDIR, 'explore.md'), md.join('\n'));
  writeFileSync(join(OUTDIR, 'explore.json'), JSON.stringify({ meta, periods: Object.fromEntries(Object.entries(P).map(([k, v]) => [k, [iso(v.from), iso(v.to)]])), families: famRes.map((r) => ({ name: r.name, best: r.best, wf: r.wf.s, picks: r.wf.picks })), variants: all.map((x) => ({ k: x.k, train: x.train, val: x.val, test: x.test, hold: x.hold, rndTrainR: x.rnd.train.R, rndHoldR: x.rnd.hold.R })) }));
  console.log(md.join('\n'));
}
main().catch((e) => { console.error(e); process.exit(1); });
