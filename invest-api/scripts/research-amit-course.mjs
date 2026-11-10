#!/usr/bin/env node
// בדיקה לאחור של שיטת הקורס של עמית (engine/amit-course.js) על 5 שנים של נרות דקה מחוזי הפרפטואל של Binance (data.binance.vision —
// קבצים ציבוריים, בלי מפתח), 9 מטבעות. מחקר בלבד — אין פקודות ואין מפתחות.
// שימוש: node --max-old-space-size=6500 invest-api/scripts/research-amit-course.mjs [--from 2021-11] [--to 2026-10] [--cache DIR]
//          [--outdir invest/docs/research/amit-course] [--coins BTC,ETH] [--show-test] [--probe]
// פרוטוקול: תקופת המבחן (20% האחרונים) מוסתרת כברירת מחדל. הרצה עם --show-test נעשית פעם אחת, בסוף, בלי לשנות קוד אחריה.
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { stats, score, verdict } from '../engine/research.js';
import { prepare, triggers, execute, randomTriggers, grid, keyOf, sigKey, CANON, CATS, COIN_CAT, COURSE_COST, RISK_USD } from '../engine/amit-course.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const FROM = arg('--from', '2021-11'), TO = arg('--to', '2026-10'), CACHE = arg('--cache', 'amit-course-cache'), OUTDIR = arg('--outdir', 'invest/docs/research/amit-course');
const SHOW_TEST = process.argv.includes('--show-test'), PROBE = process.argv.includes('--probe');
const COINS = arg('--coins', 'BTC,ETH,SOL,AVAX,ADA,INJ,RENDER,NEAR,FARTCOIN').split(',');
const SYMS = { RENDER: ['RNDRUSDT', 'RENDERUSDT'] }; // RNDR שינה שם ל-RENDER (2024)
const log = (...a) => console.error(...a), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), DAY = 86400e3;

function months(){ const out = []; let [y, m] = FROM.split('-').map(Number); const [y2, m2] = TO.split('-').map(Number); while (y < y2 || (y === y2 && m <= m2)){ out.push(`${y}-${String(m).padStart(2, '0')}`); if (++m > 12){ m = 1; y++; } } return out; }
const START = Date.parse(`${FROM}-01T00:00:00Z`), END = (() => { const [y, m] = TO.split('-').map(Number); return Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1); })();
const DAYS = Math.round((END - START) / DAY);

async function download(url, file){
  if (existsSync(file)) return true;
  for (let k = 0; k < 5; k++){
    try { const r = await fetch(url, { headers: { 'User-Agent': 'bikur-research/1.0 (backtest)' } }); if (r.status === 404) return false; if (!r.ok) throw new Error(`HTTP ${r.status}`); writeFileSync(file, Buffer.from(await r.arrayBuffer())); return true; }
    catch (e) { if (k === 4){ log(`  ${url}: ${e.message}`); return false; } await sleep(1500 * (k + 1)); }
  }
}
// קובץ חודשי: open_time,open,high,low,close,volume,close_time,quote_volume,… (בקבצים חדשים יש שורת כותרת)
export async function loadCoin(coin){
  mkdirSync(CACHE, { recursive: true });
  const rows = new Map(); let got = 0, miss = [];
  for (const mo of months()){
    let ok = false;
    for (const sym of SYMS[coin] || [`${coin}USDT`]){
      const f = join(CACHE, `${sym}-1m-${mo}.zip`);
      if (!(await download(`https://data.binance.vision/data/futures/um/monthly/klines/${sym}/1m/${sym}-1m-${mo}.zip`, f))) continue;
      const csv = execFileSync('unzip', ['-p', f], { maxBuffer: 1 << 30 }).toString();
      for (const line of csv.split('\n')){
        const c = line.split(','); if (c.length < 8 || !/^\d/.test(c[0])) continue;
        let t = +c[0]; if (t > 1e14) t = Math.floor(t / 1000); // מיקרו-שניות בקבצים מ-2025
        rows.set(t, [+c[1], +c[2], +c[3], +c[4], +c[7]]);
      }
      ok = true; got++; break;
    }
    if (!ok) miss.push(mo);
  }
  const ts = [...rows.keys()].filter((t) => t >= START && t < END).sort((a, b) => a - b), n = ts.length;
  const m1 = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
  ts.forEach((t, i) => { const r = rows.get(t); m1.t[i] = t; m1.o[i] = r[0]; m1.h[i] = r[1]; m1.l[i] = r[2]; m1.c[i] = r[3]; m1.v[i] = r[4]; });
  log(`${coin}: ${n.toLocaleString()} נרות דקה, ${got} חודשים${miss.length ? `, חסרים ${miss.length} (${miss[0]}…${miss.at(-1)})` : ''}`);
  return { m1, months: got, missing: miss, first: n ? new Date(m1.t[0]).toISOString().slice(0, 10) : null };
}

// ---------- תקופות ----------
const dayAt = (k) => START + Math.round(DAYS * k) * DAY;
const P = { train: { from: START, to: dayAt(0.6) }, val: { from: dayAt(0.6), to: dayAt(0.8) }, test: { from: dayAt(0.8), to: END }, dev: { from: START, to: dayAt(0.8) }, all: { from: START, to: END } };
const FOLD_TRAIN = Math.round(DAYS * 0.33), FOLD_TEST = Math.round(DAYS * 0.082);
const folds = []; for (let d = FOLD_TRAIN; START + (d + 1) * DAY <= P.dev.to; d += FOLD_TEST) folds.push({ train: { from: START + (d - FOLD_TRAIN) * DAY, to: START + d * DAY }, test: { from: START + d * DAY, to: Math.min(START + (d + FOLD_TEST) * DAY, P.dev.to) } });
const iso = (t) => new Date(t).toISOString().slice(0, 10);

const fmt$ = (x) => (x == null || !Number.isFinite(x) ? '—' : (x < 0 ? '−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US'));
const fR = (x) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(3));
const fCI = (c) => (c ? `[${fR(c[0])}, ${fR(c[1])}]` : '—');
const fPF = (x) => (x === Infinity ? '∞' : x ?? '—');

async function main(){
  if (PROBE){ const ok = await download('https://data.binance.vision/data/futures/um/monthly/klines/BTCUSDT/1m/BTCUSDT-1m-2024-01.zip', '/tmp/probe.zip'); log(`probe data.binance.vision: ${ok}`); process.exit(ok ? 0 : 1); }
  const variants = grid(), sigs = [...new Map(variants.map((v) => [sigKey(v), v])).values()];
  const T = new Map(variants.map((v) => [keyOf(v), []])), R = new Map(variants.map((v) => [keyOf(v), []])), meta = { coins: {}, from: iso(START), to: iso(END) };
  const t0 = Date.now();
  for (const coin of COINS){
    const d = await loadCoin(coin); meta.coins[coin] = { cat: COIN_CAT[coin], months: d.months, missing: d.missing.length, first: d.first, bars: d.m1.t.length };
    if (d.m1.t.length < 50000) continue;
    const ctx = prepare(d.m1);
    for (const s of sigs){
      const tg = triggers(ctx, COIN_CAT[coin], s), rnd = randomTriggers(ctx, tg, 7 + COINS.indexOf(coin));
      for (const v of variants.filter((x) => sigKey(x) === sigKey(s))){
        T.get(keyOf(v)).push(...execute(ctx, tg, { coin, entry: v.entry, exit: v.exit }));
        R.get(keyOf(v)).push(...execute(ctx, rnd, { coin, entry: v.entry, exit: v.exit }));
      }
    }
    log(`${coin}: הגרסה הנאמנה — ${T.get(keyOf(CANON)).filter((x) => x.coin === coin).length} עסקאות (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  const coins = COINS.filter((c) => meta.coins[c]?.bars >= 50000);
  const st = (tr, p, extra = {}) => stats(tr, { ...p, coins, ...extra });
  const SC = { minTrades: 60, minCoinsPos: Math.min(5, coins.length) }, sc = (s) => score(s, SC);
  const per = (tr) => ({ train: st(tr, P.train), val: st(tr, P.val), dev: st(tr, P.dev), test: SHOW_TEST ? st(tr, P.test) : null });

  // 1. הגרסה הנאמנה (נקבעה מראש)
  const canonK = keyOf(CANON), canon = T.get(canonK), canonRnd = R.get(canonK), canonS = per(canon), rndS = per(canonRnd);
  const singleK = keyOf({ ...CANON, entry: 'single' }), singleS = per(T.get(singleK));
  // 2. הגרסה הטובה ברשת לפי אימון בלבד
  const ranked = variants.map((v) => ({ v, k: keyOf(v), sc: sc(st(T.get(keyOf(v)), P.train)) })).filter((x) => x.sc !== null).sort((a, b) => b.sc - a.sc);
  const best = ranked[0] || null, bestS = best ? per(T.get(best.k)) : null;
  // 3. Walk-Forward: בכל קפל בוחרים את הגרסה הטובה באימון הקפל ומודדים בבדיקה שאחריו
  const oos = [], picks = [];
  for (const f of folds){
    const ss = variants.map((v) => ({ k: keyOf(v), s: sc(st(T.get(keyOf(v)), f.train)) })).filter((x) => x.s !== null).sort((a, b) => b.s - a.s);
    if (!ss.length){ picks.push('—'); continue; }
    picks.push(ss[0].k); oos.push(...T.get(ss[0].k).filter((x) => x.tEntry >= f.test.from && x.tEntry < f.test.to));
  }
  const wf = st(oos, { from: folds[0]?.test.from, to: folds.at(-1)?.test.to });
  const canonWf = st(canon, { from: folds[0]?.test.from, to: folds.at(-1)?.test.to });
  const vCanon = verdict({ train: canonS.train, val: canonS.val, test: canonS.test, wf: canonWf, cost15: SHOW_TEST ? st(canon, P.test, { costMult: 1.5 }) : null });
  const vBest = best ? verdict({ train: bestS.train, val: bestS.val, test: bestS.test, wf, cost15: SHOW_TEST ? st(T.get(best.k), P.test, { costMult: 1.5 }) : null }) : { level: 'fail', why: 'אף גרסה לא עמדה בתנאי המינימום באימון' };

  // ---------- דוח ----------
  const md = [];
  const row = (name, s) => s ? `| ${name} | ${s.n} | ${s.winRate ?? '—'}% | ${fmt$(s.gross)} | ${fmt$(-s.fees - s.spreadSlip - s.funding)} | **${fmt$(s.net)}** | ${fR(s.expRGross)} | **${fR(s.expR)}** ${fCI(s.ciR)} | ${fPF(s.pf)} | ${fmt$(-s.maxDD)} |` : `| ${name} | — | | | | | | | | |`;
  const head = '| | עסקאות | הצלחה | ברוטו | עלויות | נטו | R ברוטו | R נטו [95%] | PF | ירידה מקס׳ |\n|---|---|---|---|---|---|---|---|---|---|';
  const block = (title, S, extra = []) => [`### ${title}`, head, row('אימון', S.train), row('אימות', S.val), row('פיתוח (אימון+אימות)', S.dev), S.test ? row('**מבחן**', S.test) : '| מבחן | (מוסתר) | | | | | | | | |', ...extra, ''];
  md.push(`# שיטת הקורס של עמית — בדיקה לאחור על נרות דקה, ${iso(START)} → ${iso(END)}`, '');
  md.push(`נתונים: חוזי פרפטואל של Binance (data.binance.vision), נרות דקה. מטבעות: ${coins.map((c) => `${c} (${COIN_CAT[c]}${meta.coins[c].first > iso(START) ? `, מ-${meta.coins[c].first}` : ''})`).join(', ')}.`);
  md.push(`תקופות: אימון ${iso(P.train.from)}→${iso(P.train.to)} · אימות →${iso(P.val.to)} · מבחן →${iso(P.test.to)} (${SHOW_TEST ? '**נפתח**' : 'מוסתר'}) · Walk-Forward: ${folds.length} קפלים (${FOLD_TRAIN} ימי אימון → ${FOLD_TEST} ימי בדיקה).`);
  md.push(`עלויות: עמלות ${COURSE_COST.makerBps}/${COURSE_COST.takerBps}bp (ממתינה/מיידית), חצי מרווח + החלקה לכל מטבע בביצוע מיידי, Funding ${COURSE_COST.fundingBpsPer8h}bp ל-8 שעות. סיכון ${RISK_USD}$ לעסקה אם כל 3 המנות התמלאו (R = רווח/הפסד ביחס ל-${RISK_USD}$).`, '');
  md.push('## 1. הגרסה הנאמנה לקורס (נקבעה מראש, לא נבחרה לפי תוצאות)', `\`${canonK}\`: דשדוש ${CANON.consH} שעות, טווח ≤ תחתית האזור, ווליום ×${CANON.kv}, מעבר אזור באירוע ווליום, 30-60-90, יציאה 75% בממוצע הקרוב + 25% רץ.`, '');
  md.push(...block('השיטה', canonS));
  md.push(...block('ביקורת: אותה גאומטריה בזמנים אקראיים', rndS));
  md.push(...block('השוואה: אותם טריגרים, כל הסכום בכניסה הראשונה (בלי 30-60-90)', singleS));
  // פירוק לפי כמה מנות התמלאו — חוסר הסימטריה
  const byFills = [1, 2, 3].map((f) => { const s = st(canon.filter((x) => x.fills === f), P.dev); return `| ${f === 1 ? 'מנה אחת' : f + ' מנות'} | ${s.n} | ${s.winRate ?? '—'}% | ${fmt$(s.net)} | ${fR(s.expR)} |`; });
  md.push('### לפי מספר המנות שהתמלאו (פיתוח)', '| | עסקאות | הצלחה | נטו | R נטו |', '|---|---|---|---|---|', ...byFills, '');
  const whys = [...new Set(canon.map((x) => x.why))].map((w) => { const s = st(canon.filter((x) => x.why === w), P.dev); return `| ${w} | ${s.n} | ${fmt$(s.net)} | ${fR(s.expR)} |`; });
  md.push('### לפי סיבת יציאה (פיתוח)', '| | עסקאות | נטו | R נטו |', '|---|---|---|---|', ...whys, '');
  const pc = coins.map((c) => { const s = st(canon.filter((x) => x.coin === c), P.dev), r = st(canonRnd.filter((x) => x.coin === c), P.dev); return `| ${c} | ${COIN_CAT[c]} | ${s.n} | ${s.winRate ?? '—'}% | ${fmt$(s.net)} | ${fR(s.expR)} | ${fR(r.expR)} |`; });
  md.push('### לפי מטבע (פיתוח)', '| מטבע | קטגוריה | עסקאות | הצלחה | נטו | R נטו | R אקראי |', '|---|---|---|---|---|---|---|', ...pc, '');
  const years = []; for (let y = new Date(START).getUTCFullYear(); y <= new Date(END - 1).getUTCFullYear(); y++){ const f = Math.max(START, Date.UTC(y, 0, 1)), t = Math.min(SHOW_TEST ? END : P.dev.to, Date.UTC(y + 1, 0, 1)); if (t <= f) continue; const s = st(canon, { from: f, to: t }); years.push(`| ${y} | ${s.n} | ${s.winRate ?? '—'}% | ${fmt$(s.net)} | ${fR(s.expR)} |`); }
  md.push('### לפי שנה', '| שנה | עסקאות | הצלחה | נטו | R נטו |', '|---|---|---|---|---|', ...years, '');
  md.push('### רגישות לעלויות (פיתוח)', '| ×0 (ברוטו) | ×0.5 | ×1 | ×1.5 | מכפיל איזון |', '|---|---|---|---|---|', `| ${fmt$(st(canon, P.dev, { costMult: 0 }).net)} | ${fmt$(st(canon, P.dev, { costMult: 0.5 }).net)} | ${fmt$(canonS.dev.net)} | ${fmt$(st(canon, P.dev, { costMult: 1.5 }).net)} | ${canonS.dev.breakEvenCost ?? '—'} |`, '');
  md.push(`**פסיקה (גרסה נאמנה):** ${vCanon.level === 'pass' ? '✅' : vCanon.level === 'fail' ? '❌' : '🟡'} ${vCanon.why}. Walk-Forward (אותה גרסה בקפלי הבדיקה): ${canonWf.n} עסקאות, ${fmt$(canonWf.net)}, R ${fR(canonWf.expR)} ${fCI(canonWf.ciR)}.`, '');
  md.push(`## 2. רשת של ${variants.length} גרסאות — הטובה ביותר לפי אימון בלבד`, 'פרמטרים: דשדוש 4/8 שעות · טווח ×0.5/×1 מתחתית האזור · ווליום ×3/×5 · כל נר / רק ירוק · מעבר אזור באירוע ווליום כן/לא · 30-60-90 / כניסה אחת · יציאה בקורס (75%+רץ) / 100% ברמה הקרובה.', '');
  if (best){ md.push(...block(`\`${best.k}\``, bestS)); }
  md.push(`**Walk-Forward** (בחירה מחדש בכל קפל מכל ${variants.length} הגרסאות): ${wf.n} עסקאות, ${fmt$(wf.net)}, R ${fR(wf.expR)} ${fCI(wf.ciR)}. בחירות: ${picks.map((p) => `\`${p}\``).join(', ')}.`, '');
  md.push(`**פסיקה (הטובה ברשת):** ${vBest.level === 'pass' ? '✅' : vBest.level === 'fail' ? '❌' : '🟡'} ${vBest.why}.`, '');
  const top = variants.map((v) => ({ k: keyOf(v), s: st(T.get(keyOf(v)), P.train), r: st(R.get(keyOf(v)), P.train) })).sort((a, b) => (b.s.expR ?? -9) - (a.s.expR ?? -9)).slice(0, 15);
  md.push('### 15 הגרסאות עם R הגבוה באימון (לא לבחירה — רק לתמונה)', '| גרסה | עסקאות | הצלחה | R ברוטו | R נטו [95%] | R אקראי |', '|---|---|---|---|---|---|', ...top.map((x) => `| \`${x.k}\` | ${x.s.n} | ${x.s.winRate ?? '—'}% | ${fR(x.s.expRGross)} | ${fR(x.s.expR)} ${fCI(x.s.ciR)} | ${fR(x.r.expR)} |`), '');
  const posGross = variants.filter((v) => (st(T.get(keyOf(v)), P.dev).expRGross ?? -1) > 0).length, posNet = variants.filter((v) => (st(T.get(keyOf(v)), P.dev).expR ?? -1) > 0).length;
  md.push(`בפיתוח: ${posGross}/${variants.length} גרסאות עם R ברוטו חיובי, ${posNet}/${variants.length} עם R נטו חיובי.`, '');
  md.push('## 3. מה לא נבדק (שיפוט ידני בקורס)', '- בחירת "השפל המשמעותי" במקום הקרוב (4-5), מוטיבים חוזרים (4-7), תרחישי קריסה (3-4), דייברג׳נס RSI (2-6), שורטים.', '- מטבעות קיצוניים (9–30%) ו"בלי בסיס" (7–9%) — אין רשימה מוגדרת בקורס.', '- מילוי פקודות ממתינות בלי מגבלת מחזור (אופטימי), Funding קבוע (קירוב).', '');
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(join(OUTDIR, SHOW_TEST ? 'report-test.md' : 'report.md'), md.join('\n'));
  writeFileSync(join(OUTDIR, SHOW_TEST ? 'summary-test.json' : 'summary.json'), JSON.stringify({ meta, periods: Object.fromEntries(Object.entries(P).map(([k, v]) => [k, [iso(v.from), iso(v.to)]])), canon: { key: canonK, ...canonS, random: rndS, single: singleS, wf: canonWf, verdict: vCanon }, best: best && { key: best.k, ...bestS, verdict: vBest }, wf: { ...wf, picks } }, null, 1));
  console.log(md.join('\n'));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); }); // גם מודול (research-amit-explore.mjs)
