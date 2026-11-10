#!/usr/bin/env node
// המחקר המלא לפי בריף המחקר של מאיר (10/11/2026): שיטת הקורס של עמית מול משפחות חלופיות, לונג ושורט, יציאות, שכבת תיק, עלויות,
// משטרי שוק ו-20 עסקאות לדוגמה. מחקר בלבד — אין פקודות ואין מפתחות. נתונים: נרות דקה של פרפטואל Binance (data.binance.vision).
// שימוש: node --max-old-space-size=6500 invest-api/scripts/research-amit-full.mjs --from 2020-01 --to 2026-10 --cache DIR --outdir DIR
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCoin } from './research-amit-course.mjs';
import { prepare, triggers, execute as courseExec, CANON, COIN_CAT, RISK_USD } from '../engine/amit-course.js';
import { extend, signals as refinedSignals, execute as refinedExec } from '../engine/amit-refined.js';
import { invert, sweepReclaim, retest, baseline, run, portfolio, blockBootstrap, mcDrawdown } from '../engine/amit-families.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUTDIR = arg('--outdir', 'invest/docs/research/amit-course');
const COINS = arg('--coins', 'BTC,ETH,SOL,AVAX,ADA,INJ,RENDER,NEAR,FARTCOIN,XRP,DOGE,LINK,DOT,LTC,BCH,ATOM,UNI,AAVE,FIL,ETC,XLM,TRX,ALGO,SAND,AXS,APT,ARB,OP,SUI').split(',');
const CAT = { ...COIN_CAT, DOGE: 'vol' }, catOf = (c) => CAT[c] || 'follow';
const log = (...a) => console.error(...a), D = (s) => Date.parse(`${s}T00:00:00Z`), DAY = 86400e3, iso = (t) => new Date(t).toISOString().slice(0, 10);
const P = { hold: { from: D('2020-01-01'), to: D('2021-11-01') }, train: { from: D('2021-11-01'), to: D('2024-11-01') }, val: { from: D('2024-11-01'), to: D('2025-11-01') }, test: { from: D('2025-11-01'), to: D('2026-11-01') } };
const ALL = { from: P.hold.from, to: P.test.to }, PN = { hold: 'נקי 2020–21', train: 'אימון 11/21–11/24', val: 'אימות 11/24–11/25', test: 'מבחן 11/25–11/26' };
const WF0 = P.train.from, folds = []; for (let d = 365; WF0 + (d + 1) * DAY <= P.test.to; d += 180) folds.push({ train: { from: WF0 + (d - 365) * DAY, to: WF0 + d * DAY }, test: { from: WF0 + d * DAY, to: Math.min(WF0 + (d + 180) * DAY, P.test.to) } });
const EXITS = ['R1', 'R1.5', 'R2', 'R3', 'part', 't4', 'ema'];

// ---------- אחסון דחוס ----------
const store = new Map(); // key → {fam, side, t, tx, gross, cost, fund, coin, mae, mfe}
const col = (key, fam, side) => store.get(key) || store.set(key, { key, fam, side, t: [], tx: [], gross: [], cost: [], fund: [], coin: [], mae: [], mfe: [] }).get(key);
function add(key, fam, side, trades, ci){ const c = col(key, fam, side); for (const x of trades){ c.t.push(x.tEntry); c.tx.push(x.tExit); c.gross.push(x.gross); c.cost.push(x.fees + x.spread + x.slip); c.fund.push(x.funding); c.coin.push(ci); c.mae.push(x.mae ?? NaN); c.mfe.push(x.mfe ?? NaN); } }
const Rof = (c, i, m = 1) => (c.gross[i] - m * c.cost[i] - c.fund[i]) / RISK_USD;
function st(c, p, m = 1){
  const R = []; let w = 0, gw = 0, gl = 0, g = 0, cs = 0, mae = 0, mfe = 0, nm = 0; const by = new Float64Array(COINS.length);
  for (let i = 0; i < c.t.length; i++){ if (c.t[i] < p.from || c.t[i] >= p.to) continue; const r = Rof(c, i, m); R.push(r); if (r > 0){ w++; gw += r; } else gl -= r; g += c.gross[i] / RISK_USD; cs += (m * c.cost[i] + c.fund[i]) / RISK_USD; by[c.coin[i]] += r; if (Number.isFinite(c.mae[i])){ mae += c.mae[i]; mfe += c.mfe[i]; nm++; } }
  const n = R.length, mean = n ? R.reduce((a, b) => a + b, 0) / n : NaN, sd = n > 1 ? Math.sqrt(R.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1)) : NaN, se = sd / Math.sqrt(n);
  const med = n ? [...R].sort((a, b) => a - b)[n >> 1] : NaN;
  let eq = 0, pk = 0, dd = 0; for (const r of R){ eq += r; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); }
  return { n, R: mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se, med, win: n ? w / n * 100 : NaN, pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : NaN), net: eq * RISK_USD, ddR: dd, gR: n ? g / n : NaN, costR: n ? cs / n : NaN, mae: nm ? mae / nm : NaN, mfe: nm ? mfe / nm : NaN, coinsPos: [...by].filter((v) => v > 0).length };
}
const score = (s) => (s.n >= 100 && s.coinsPos >= 10 ? s.lo : null);
const tradesFor = (c, p = ALL, m = 1) => { const out = []; for (let i = 0; i < c.t.length; i++) if (c.t[i] >= p.from && c.t[i] < p.to) out.push({ coin: COINS[c.coin[i]], tEntry: c.t[i], tExit: c.tx[i], R: Rof(c, i, m) }); return out; };

const f = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d) : '—');
const pc = (x, d = 1) => (Number.isFinite(x) ? (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(d) + '%' : '—');
const f$ = (x) => (Number.isFinite(x) ? (x < 0 ? '−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US') : '—');

async function main(){
  const meta = {}, examples = [], btcTrend = new Map(); // btcTrend: יום → BTC מעל EMA200 יומי (בסגירת היום הקודם)
  const bh = {}; // buy & hold לכל תקופה: BTC, ETH
  const t0 = Date.now();
  for (const [ci, coin] of COINS.entries()){
    const d = await loadCoin(coin), m1 = d.m1, n = m1.t.length;
    meta[coin] = { cat: catOf(coin), first: d.first, last: n ? iso(m1.t[n - 1]) : null, months: d.months, missing: d.missing.length, bars: n, cover: n ? n / ((m1.t[n - 1] - m1.t[0]) / 60e3 + 1) : 0 };
    if (n < 50000) continue;
    if (coin === 'BTC' || coin === 'ETH') bh[coin] = Object.fromEntries(Object.entries(P).map(([k, p]) => { let a = NaN, b = NaN; for (let i = 0; i < n; i++){ if (m1.t[i] >= p.from && !Number.isFinite(a)) a = m1.o[i]; if (m1.t[i] < p.to) b = m1.c[i]; } return [k, b / a - 1]; }));
    for (const side of ['L', 'S']){
      const ctx = extend(prepare(side === 'L' ? m1 : invert(m1))), cat = catOf(coin), o = { coin };
      if (coin === 'BTC' && side === 'L'){ const q = ctx.q; for (let j = 0; j < q.c.length; j++){ const dd = Math.floor(q.t[j] / DAY) + 1; if (Number.isFinite(q.e200d1[j])) btcTrend.set(dd, q.c[j] > q.e200d1[j]); } }
      // A — גרסת הקורס (נאמנה, נקבעה מראש) + כניסה אחת
      const tg = triggers(ctx, cat, CANON);
      const aL = courseExec(ctx, tg, { coin, entry: 'ladder', exit: 'course' });
      add(`A|course|${side}`, 'A', side, aL, ci);
      add(`A|single|${side}`, 'A', side, courseExec(ctx, tg, { coin, entry: 'single', exit: 'course' }), ci);
      if (side === 'L') for (const x of aL) examples.push({ coin, ...x, R: (x.gross - x.fees - x.spread - x.slip - x.funding) / RISK_USD });
      // E — הגרסה ה"מזוקקת" + ablation
      for (const [name, need, entry] of [['full', {}, 'two'], ['-level', { level: false }, 'two'], ['-rsi', { rsi: false }, 'two'], ['-wick', { wick: false }, 'two'], ['-zone', { zone: false }, 'two'], ['zone-only', { level: false, rsi: false, wick: false }, 'two'], ['full-single', {}, 'single']])
        add(`E|${name}|${side}`, 'E', side, refinedExec(ctx, refinedSignals(ctx, cat, { need }), { coin, entry }), ci);
      // B / C / X עם 7 יציאות (+ ביצוע פסימי ליעדים: 5bp חצייה)
      const fams = [...['none', 'ema', 'rsi', 'vol', 'all'].map((fl) => [`B:${fl}`, sweepReclaim(ctx, cat, fl)]), ...[1, 2, 3].map((k) => [`C:${k}`, retest(ctx, cat, k)]), ...['emaX', 'brk', 'mr', 'rnd'].map((k) => [`X:${k}`, baseline(ctx, cat, k, 21 + ci)])];
      for (const [fam, sigs] of fams) for (const ex of EXITS){
        add(`${fam}|${ex}|${side}`, fam.split(':')[0], side, run(ctx, sigs, ex, o), ci);
        add(`${fam}|${ex}|${side}|pess`, fam.split(':')[0] + 'p', side, run(ctx, sigs, ex, { ...o, penBps: 5 }), ci);
      }
    }
    log(`${coin}: סיום (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  const keys = [...store.keys()].filter((k) => !k.endsWith('|pess'));
  const S = (k, p, m) => st(store.get(k), p, m);
  const md = [];
  md.push('# שיטת עמית מול חלופות — המחקר המלא (לונג ושורט, 2020–2026, 29 מטבעות)', '');
  md.push('נתונים: נרות דקה של חוזי פרפטואל Binance (data.binance.vision). האותות על נרות 15 דק׳ שנסגרו; הביצוע על נרות דקה מהדקה שאחרי האות. עלויות Bybit: Maker 2bp / Taker 5.5bp, חצי מרווח + החלקה לפי מטבע, Funding 1bp ל-8 שעות. סטופ ויעד באותה דקה → סטופ. R = רווח נטו ביחס ל-400$ סיכון מתוכנן.', '');
  md.push(`תקופות: ${Object.entries(P).map(([k, p]) => `${PN[k]} (${iso(p.from)}→${iso(p.to)})`).join(' · ')}. בחירת גרסה — לפי אימון בלבד (גבול תחתון 95%, ≥100 עסקאות, רווח ב-≥10 מטבעות). Walk-Forward: ${folds.length} קפלים (365 ימי אימון → 180 ימי בדיקה), בחירה מחדש בכל קפל.`, '');
  // 1. מקורות נתונים
  md.push('## 1. מקורות הנתונים ואיכותם', '| מטבע | קבוצה | מ- | עד | חודשים | חודשים חסרים | נרות דקה | כיסוי |', '|---|---|---|---|---|---|---|---|', ...COINS.map((c) => { const m = meta[c]; return m ? `| ${c} | ${m.cat} | ${m.first ?? '—'} | ${m.last ?? '—'} | ${m.months} | ${m.missing} | ${m.bars.toLocaleString()} | ${(m.cover * 100).toFixed(2)}% |` : `| ${c} | — | | | | | | |`; }), '', '⚠️ הטיית שורדים: הרשימה היא מטבעות שקיימים היום. מטבעות שנמחקו (LUNA, FTT ועוד) חסרים — המסקנות נוטות לטובת השיטות (מטבעות שקרסו לגמרי לא בפנים).', '');
  // 2. תוצאות מדורגות
  const famDefs = [['A', 'גרסת הקורס (30-60-90, יציאה בקורס)'], ['E', 'הגרסה ה"מזוקקת" (4 תנאים, 2 מנות)'], ['B', 'שטיפה וחזרה מעל תמיכה'], ['C', 'ריטסט אחרי פריצה'], ['X', 'קווי בסיס פשוטים (EMA, פריצה, RSI, אקראי)']];
  md.push('## 2. הגרסה הטובה בכל משפחה (נבחרה באימון) — כל התקופות', '| משפחה | כיוון | גרסה | עסקאות (אימון) | הצלחה | R אימון [95%] | R אימות | R מבחן | R נקי 2020–21 | PF (הכול) | Walk-Forward R [95%] (עסקאות) |', '|---|---|---|---|---|---|---|---|---|---|---|');
  const picks = [];
  for (const [fam, name] of famDefs) for (const side of ['L', 'S']){
    const cands = keys.filter((k) => store.get(k).fam === fam && store.get(k).side === side);
    const best = cands.map((k) => ({ k, sc: score(S(k, P.train)) })).filter((x) => x.sc !== null).sort((a, b) => b.sc - a.sc)[0];
    const oos = { t: [], tx: [], gross: [], cost: [], fund: [], coin: [], mae: [], mfe: [] }, wfPicks = [];
    for (const fo of folds){ const b = cands.map((k) => ({ k, sc: score(S(k, fo.train)) })).filter((x) => x.sc !== null).sort((a, b2) => b2.sc - a.sc)[0]; wfPicks.push(b?.k || '—'); if (!b) continue; const c = store.get(b.k); for (let i = 0; i < c.t.length; i++) if (c.t[i] >= fo.test.from && c.t[i] < fo.test.to) for (const kk of Object.keys(oos)) oos[kk].push(c[kk][i]); }
    const wf = st(oos, { from: folds[0].test.from, to: folds.at(-1).test.to });
    const k = best?.k || cands.sort((a, b) => (S(b, P.train).R || -9) - (S(a, P.train).R || -9))[0];
    const tr = S(k, P.train), a = S(k, ALL);
    picks.push({ fam, side, name, k, wf, wfPicks, ok: !!best });
    md.push(`| ${name} | ${side === 'L' ? 'לונג' : 'שורט'} | \`${k}\`${best ? '' : ' ⚠️'} | ${tr.n} | ${tr.win.toFixed(0)}% | ${f(tr.R)} [${f(tr.lo)}, ${f(tr.hi)}] | ${f(S(k, P.val).R)} | ${f(S(k, P.test).R)} | ${f(S(k, P.hold).R)} | ${Number.isFinite(a.pf) ? a.pf.toFixed(2) : '—'} | ${f(wf.R)} [${f(wf.lo)}, ${f(wf.hi)}] (${wf.n}) |`);
  }
  md.push('', '⚠️ = אף גרסה במשפחה לא עמדה בתנאי המינימום באימון; מוצגת זו עם R האימון הגבוה.', '');
  // 3. ספירה: כמה גרסאות חיוביות
  const cnt = (pred) => keys.filter(pred).length;
  md.push('## 3. כמה מתוך כל הגרסאות חיוביות?', `סה״כ ${keys.length} גרסאות (כולל לונג ושורט).`, '| תקופה | R נטו > 0 | גבול תחתון > 0 | R לפני עלויות > 0 |', '|---|---|---|---|', ...Object.keys(P).map((p) => `| ${PN[p]} | ${cnt((k) => S(k, P[p]).R > 0)} | ${cnt((k) => S(k, P[p]).lo > 0)} | ${cnt((k) => S(k, P[p]).gR > 0)} |`), `| חיובית בכל 4 התקופות | ${cnt((k) => Object.keys(P).every((p) => S(k, P[p]).R > 0))} | | |`, `| מתוכן קווי בסיס (X) — כולל אקראי | ${cnt((k) => k.startsWith('X:') && Object.keys(P).every((p) => S(k, P[p]).R > 0))} | | |`, '');
  // 4. גרסת הקורס בפירוט
  md.push('## 4. גרסת הקורס (A) — לפי תקופה, כיוון ומבנה כניסה', '| גרסה | ' + Object.keys(P).map((p) => PN[p]).join(' | ') + ' | הכול: עסקאות / הצלחה / R / PF |', '|---|---|---|---|---|---|');
  for (const k of ['A|course|L', 'A|single|L', 'A|course|S', 'A|single|S']){ const a = S(k, ALL); md.push(`| \`${k}\` | ${Object.keys(P).map((p) => f(S(k, P[p]).R)).join(' | ')} | ${a.n} / ${a.win.toFixed(0)}% / ${f(a.R)} / ${Number.isFinite(a.pf) ? a.pf.toFixed(2) : '—'} |`); }
  md.push('');
  // 5. ablation של הגרסה המזוקקת
  md.push('## 5. הגרסה ה"מזוקקת" (E) — מה כל תנאי תורם (כל התקופות)', '| גרסה | לונג: עסקאות / R [95%] | שורט: עסקאות / R [95%] |', '|---|---|---|');
  for (const nm of ['full', '-level', '-rsi', '-wick', '-zone', 'zone-only', 'full-single']){ const l = S(`E|${nm}|L`, ALL), s = S(`E|${nm}|S`, ALL); md.push(`| ${nm} | ${l.n} / ${f(l.R)} [${f(l.lo)}, ${f(l.hi)}] | ${s.n} / ${f(s.R)} [${f(s.lo)}, ${f(s.hi)}] |`); }
  md.push('', 'full = כל 4 התנאים; ‎-X = בלי התנאי X; zone-only = רק אזור הריזיקה; full-single = כל התנאים, כניסה אחת.', '');
  // 6. שטיפה וחזרה — מסננים × יציאות
  for (const side of ['L', 'S']){
    md.push(`## 6${side === 'L' ? 'א' : 'ב'}. שטיפה וחזרה (B) — מסנן × יציאה, R נטו על כל התקופות (${side === 'L' ? 'לונג' : 'שורט'})`, '| מסנן | ' + EXITS.join(' | ') + ' |', '|---|' + EXITS.map(() => '---').join('|') + '|');
    for (const fl of ['none', 'ema', 'rsi', 'vol', 'all']) md.push(`| ${fl} | ${EXITS.map((ex) => { const a = S(`B:${fl}|${ex}|${side}`, ALL); return `${f(a.R, 2)} (${a.n})`; }).join(' | ')} |`);
    md.push('');
  }
  md.push('## 7. ריטסט (C) וקווי בסיס (X) — R נטו על כל התקופות, יציאה R2 / part / ema', '| | לונג R2 | לונג part | לונג ema | שורט R2 | שורט part | שורט ema |', '|---|---|---|---|---|---|---|');
  for (const fam of ['C:1', 'C:2', 'C:3', 'X:emaX', 'X:brk', 'X:mr', 'X:rnd']) md.push(`| ${fam} | ${['L', 'S'].flatMap((s) => ['R2', 'part', 'ema'].map((ex) => { const a = S(`${fam}|${ex}|${s}`, ALL); return `${f(a.R, 2)} (${a.n})`; })).join(' | ')} |`);
  md.push('', 'C:1/2/3 = ריטסט ראשון/שני/שלישי. X: emaX = חציית EMA20/50 מעל EMA200; brk = פריצת שיא יומי; mr = RSI חוזר מעל 30; rnd = כניסה אקראית.', '');
  // 8. עלויות וביצוע פסימי — לבחירות של כל משפחה
  md.push('## 8. רגישות לעלויות וביצוע פסימי (הגרסה שנבחרה בכל משפחה, כל התקופות)', '| גרסה | R לפני עלויות | עלויות ×1 | ×2 | ×3 | יעד דורש 5bp חצייה | MAE / MFE ממוצע (R) |', '|---|---|---|---|---|---|---|');
  for (const p of picks){ const a = S(p.k, ALL), pess = store.get(p.k + '|pess') ? S(p.k + '|pess', ALL) : null; md.push(`| \`${p.k}\` | ${f(a.gR)} | ${f(a.R)} | ${f(S(p.k, ALL, 2).R)} | ${f(S(p.k, ALL, 3).R)} | ${pess ? f(pess.R) : '—'} | ${f(a.mae, 2)} / ${f(a.mfe, 2)} |`); }
  md.push('');
  // 9. שכבת תיק
  md.push('## 9. שכבת תיק (סיכון כאחוז מההון, עד 3 פוזיציות, עצירה ב-‎−2% ביום) — 2020–2026, מתחילים מ-1', '| גרסה | סיכון לעסקה | הון סופי | תשואה שנתית | ירידה מקס׳ | Sharpe | חודשי הפסד | רצף הפסדים | Bootstrap שנתי (95%) | Monte Carlo ירידה (R, 50%/95%) |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const p of [...picks.filter((x) => x.fam === 'A'), ...picks.filter((x) => x.fam !== 'A' && x.side === 'L'), ...picks.filter((x) => x.fam !== 'A' && x.side === 'S')]){
    const tr = tradesFor(store.get(p.k)), mc = mcDrawdown(tr.map((x) => x.R));
    for (const rp of [0.25, 0.5, 1]){ const pf = portfolio(tr, { riskPct: rp, maxOpen: 3, dayLossPct: 2, from: ALL.from, to: ALL.to }), bs = blockBootstrap(pf.dailyRets); md.push(`| \`${p.k}\` | ${rp}% | ${pf.final.toFixed(3)} | ${pc(pf.cagr)} | ${pc(-pf.maxDD)} | ${pf.sharpe.toFixed(2)} | ${pf.negMonths}/${pf.months} | ${pf.maxLossStreak} | ${bs ? `[${pc(bs.lo)}, ${pc(bs.hi)}]` : '—'} | ${mc ? `${mc.p50.toFixed(1)} / ${mc.p95.toFixed(1)}` : '—'} |`); }
  }
  md.push('', `השוואה — קנה והחזק (בלי מינוף): ${['BTC', 'ETH'].map((c) => `${c}: ${Object.keys(P).map((p) => `${PN[p]} ${pc(bh[c]?.[p])}`).join(', ')}`).join(' · ')}.`, '');
  // 10. משטרי שוק — לגרסת הקורס ולבחירות
  const regime = (c, pred) => { const out = { t: [], tx: [], gross: [], cost: [], fund: [], coin: [], mae: [], mfe: [] }; for (let i = 0; i < c.t.length; i++) if (pred(c.t[i], c.coin[i])) for (const kk of Object.keys(out)) out[kk].push(c[kk][i]); return out; };
  const regs = [['BTC מעל EMA200 יומי', (t) => btcTrend.get(Math.floor(t / DAY)) === true], ['BTC מתחת ל-EMA200 יומי', (t) => btcTrend.get(Math.floor(t / DAY)) === false], ['שעות אסיה 00–08 UTC', (t) => new Date(t).getUTCHours() < 8], ['אירופה 08–13', (t) => { const h = new Date(t).getUTCHours(); return h >= 8 && h < 13; }], ['ארה״ב 13–21', (t) => { const h = new Date(t).getUTCHours(); return h >= 13 && h < 21; }], ['21–24', (t) => new Date(t).getUTCHours() >= 21], ['סוף שבוע', (t) => [0, 6].includes(new Date(t).getUTCDay())], ['BTC', (t, ci) => COINS[ci] === 'BTC'], ['ETH', (t, ci) => COINS[ci] === 'ETH'], ['עוקבים (follow)', (t, ci) => catOf(COINS[ci]) === 'follow'], ['תנודתיים (vol)', (t, ci) => catOf(COINS[ci]) === 'vol']];
  const regKeys = ['A|course|L', 'A|course|S', ...picks.filter((p) => p.fam !== 'A').map((p) => p.k)];
  md.push('## 10. משטרי שוק (כל התקופות) — R נטו (עסקאות)', '| משטר | ' + regKeys.map((k) => `\`${k}\``).join(' | ') + ' |', '|---|' + regKeys.map(() => '---').join('|') + '|');
  for (const [nm, pred] of regs) md.push(`| ${nm} | ${regKeys.map((k) => { const a = st(regime(store.get(k), pred), ALL); return `${f(a.R, 2)} (${a.n})`; }).join(' | ')} |`);
  for (let y = 2020; y <= 2026; y++){ const p = { from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) }; md.push(`| שנת ${y} | ${regKeys.map((k) => { const a = st(store.get(k), p); return `${f(a.R, 2)} (${a.n})`; }).join(' | ')} |`); }
  md.push('');
  // 11. 20 עסקאות לדוגמה מגרסת הקורס (לונג)
  const ex = examples.sort((a, b) => a.R - b.R), pickN = (arr, k) => arr.slice(0, k);
  let s = 77; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const near = [...ex].sort((a, b) => Math.abs(a.R) - Math.abs(b.R));
  const groups = [['5 הטובות', pickN([...ex].reverse(), 5)], ['5 הגרועות', pickN(ex, 5)], ['5 גבוליות (R קרוב ל-0)', pickN(near, 5)], ['5 אקראיות', Array.from({ length: 5 }, () => ex[Math.floor(rnd() * ex.length)])]];
  md.push('## 11. 20 עסקאות לדוגמה — גרסת הקורס, לונג (מה היה ידוע ברגע הכניסה)', 'ברגע הכניסה ידוע: העוגן (שפל הדשדוש שנסגר), האזור לפי הקטגוריה, נר הדקה שנסגר בחצי התחתון עם ווליום ≥ ×3. המנות 60/90 ממתינות בהנזלה; הסטופ קבוע מראש.', '| קבוצה | מטבע | זמן כניסה (UTC) | עוגן | כניסה ראשונה | מנות | יציאה | R נטו |', '|---|---|---|---|---|---|---|---|');
  for (const [g, arr] of groups) for (const x of arr) md.push(`| ${g} | ${x.coin} | ${new Date(x.tEntry).toISOString().slice(0, 16).replace('T', ' ')} | ${x.anchor.toPrecision(6)} | ${x.entry.toPrecision(6)} | ${x.fills} | ${x.why} | ${f(x.R, 2)} |`);
  md.push('');
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(join(OUTDIR, 'full-report.md'), md.join('\n'));
  writeFileSync(join(OUTDIR, 'full-summary.json'), JSON.stringify({ meta, periods: Object.fromEntries(Object.entries(P).map(([k, v]) => [k, [iso(v.from), iso(v.to)]])), picks: picks.map((p) => ({ ...p, wf: { n: p.wf.n, R: p.wf.R, lo: p.wf.lo, hi: p.wf.hi } })), variants: keys.map((k) => ({ k, ...Object.fromEntries(Object.keys(P).map((p) => [p, S(k, P[p])])), all: S(k, ALL) })) }));
  console.log(md.join('\n'));
}
main().catch((e) => { console.error(e); process.exit(1); });
