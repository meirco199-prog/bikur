#!/usr/bin/env node
// מומנטום בין מטבעות "משודרג" (בקשת מאיר 13/11/2026): תיקון הכשלים של "3 המטבעות החזקים" (xs-check.md) — בלי כיוונון מספרים.
// הכללים (engine/research-daily.js, xsRiskAdj): יקום דינמי של 15 המטבעות עם הנפח הדולרי הגבוה ב-30 יום, BTC מעל ממוצע 100 (אחרת מזומן),
// מטבע מעל ממוצע 50 שלו, דירוג תשואה 21 יום / סטיית תקן יומית 21 יום, 4 מטבעות × 25%, ושתי מנות של 50% (ראשון + רביעי).
// היקום: 20 המטבעות של המחקר + 30 שהיו גדולים ב-Coinbase, כולל כאלה שקרסו או שהמסחר בהם הופסק (הטיית שורדים חלקית: רק מה שעדיין יש לו נרות).
// עלויות: ספוט 0.1% + החלקה לכל צד (0.02% BTC/ETH, 0.05% השאר). אותה חלוקה לאימון/אימות/מבחן כמו במחקר המקורי. מחקר בלבד.
// שימוש: node invest-api/scripts/research-xs-ra.mjs --data xsra-data.json.gz [--out report.md] [--json results.json]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { align, strategies, runDaily, dstats, xsRiskAdj, combineSleeves } from '../engine/research-daily.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'xsra-data.json.gz'), OUT = arg('--out', ''), JOUT = arg('--json', '');
const DAY = 86400e3, START = Date.UTC(2016, 0, 1), END = Date.UTC(2026, 10, 13), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (...a) => console.error(...a);
const BASE = ['BTC', 'ETH', 'LTC', 'BCH', 'LINK', 'XLM', 'ETC', 'ADA', 'SOL', 'DOGE', 'AVAX', 'DOT', 'UNI', 'ATOM', 'XRP', 'AAVE', 'FIL', 'ALGO', 'XTZ', 'ZEC'];
const EXTRA = ['ICP', 'GRT', 'SUSHI', 'CRV', 'COMP', 'SNX', 'BAT', 'ZRX', 'MKR', 'YFI', 'UMA', 'SHIB', 'MANA', 'SAND', 'AXS', 'CHZ', 'OMG', 'REP', 'DASH', 'EOS', 'ZEN', 'KNC', 'BAND', 'NMR', 'LRC', 'ENJ', '1INCH', 'MATIC', 'BNT', 'STORJ'];
const UA = { 'User-Agent': 'bikur-research/1.0 (backtest)', Accept: 'application/json' };
async function getJson(url, tries = 5){
  for (let k = 0; k < tries; k++){
    try { const r = await fetch(url, { headers: UA }); if (r.status === 429){ await sleep(2000 * (k + 1)); continue; } if (r.status === 404 || r.status === 400) return null; if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (k === tries - 1) throw e; await sleep(1000 * (k + 1)); }
  }
}
async function daily(coin){ // Coinbase: [time, low, high, open, close, volume]
  const out = new Map();
  for (let s = START; s < END; s += 300 * DAY){
    const e = Math.min(s + 300 * DAY, END), j = await getJson(`https://api.exchange.coinbase.com/products/${coin}-USD/candles?granularity=86400&start=${new Date(s).toISOString()}&end=${new Date(e).toISOString()}`);
    if (j === null) return out.size ? [...out.values()].sort((a, b) => a.t - b.t) : null;
    for (const r of j || []){ const t = r[0] * 1000; if (t >= START && t < END) out.set(t, { t, o: +r[3], h: +r[2], l: +r[1], c: +r[4], v: +r[5] }); }
    await sleep(150);
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}
let d;
if (existsSync(DATA)) d = JSON.parse(gunzipSync(readFileSync(DATA)));
else {
  d = { bars: {} };
  for (const c of [...BASE, ...EXTRA]){ try { const b = await daily(c); if (b && b.length > 200){ d.bars[c] = b; log(`${c}: ${b.length} ימים ${new Date(b[0].t).toISOString().slice(0, 10)} → ${new Date(b.at(-1).t).toISOString().slice(0, 10)}`); } else log(`${c}: אין נתונים`); } catch (e) { log(`${c}: ${e.message}`); } }
  writeFileSync(DATA, gzipSync(JSON.stringify(d)));
}
for (const bars of Object.values(d.bars)) for (const b of bars){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
const fs = (x) => (x == null ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2)), fci = (c) => (c ? `[${fs(c[0])}, ${fs(c[1])}]` : '—');
const without = (bars, cs) => Object.fromEntries(Object.entries(bars).filter(([k]) => !cs.includes(k)));
const ALL = d.bars, BASEB = Object.fromEntries(Object.entries(ALL).filter(([k]) => BASE.includes(k)));
// אותה חלוקה כמו במחקר המקורי (ימי 2016-01-01 → 2026-11-06): אימון 60%, אימות 20%, מבחן 20%
const A0 = align(ALL), od = A0.days.filter((t) => t < Date.UTC(2026, 10, 7)), at = (k) => od[Math.floor(od.length * k)], LAST = A0.days.at(-1) + DAY;
const P = { all: { from: A0.days[0], to: LAST }, train: { from: A0.days[0], to: at(0.6) }, val: { from: at(0.6), to: at(0.8) }, test: { from: at(0.8), to: LAST }, s22: { from: Date.UTC(2022, 0, 1), to: LAST } };
const DN = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

const cache = new Map();
function sleeve(bars, dow, key){ const k = `${key}|${dow}`; if (cache.has(k)) return cache.get(k); const A = align(bars), r = runDaily(A, xsRiskAdj(A.coins, { dow }), { drift: true }).series; cache.set(k, r); return r; }
const tranche = (bars, dows, key) => combineSleeves(dows.map((w) => sleeve(bars, w, key)));
const other = (bars, id, opt = {}) => { const A = align(bars), s = strategies(A.coins, { rebalDow: opt.dow ?? null }).find((q) => q.id === id); return runDaily(A, s, { drift: true }).series; };
const S = (sr) => Object.fromEntries(Object.entries(P).map(([k, w]) => [k, dstats(sr, w)]));
const HDR = ['| גרסה | מבחן: שנתי / שארפ [95%] / ירידה מקס׳ | אימות: שנתי / ירידה | מ-2022: שנתי / ירידה | 2016–2026: שנתי / ירידה | חשיפה ממוצעת | מחזור בשנה |', '|---|---|---|---|---|---|---|'];
const row = (lab, st) => `| ${lab} | **${pct(st.test.cagr)}** / ${fs(st.test.sharpe)} ${fci(st.test.ci)} / ${pct(-st.test.maxDD)} | ${pct(st.val.cagr)} / ${pct(-st.val.maxDD)} | ${pct(st.s22.cagr)} / ${pct(-st.s22.maxDD)} | ${pct(st.all.cagr)} / ${pct(-st.all.maxDD)} | ${Math.round(st.all.exposure * 100)}% | ${st.all.turnYr.toFixed(1)}× |`;

const res = {};
const main = S(tranche(ALL, [0, 3], 'all')), btc = S(other(ALL, 'BH-BTC'));
res.main = main; res.btc = btc;
const L = [`# מומנטום בין מטבעות "משודרג" — יקום דינמי, מסנן כפול, דירוג לפי תשואה/תנודתיות, 2 מנות (${iso(A0.days[0])} → ${iso(A0.days.at(-1))})`, '',
  `**הנתונים:** ${Object.keys(ALL).length} מטבעות מ-Coinbase, כולל מטבעות שקרסו או שהמסחר בהם הופסק: ${Object.entries(ALL).filter(([k]) => EXTRA.includes(k)).map(([c, b]) => `${c} (${iso(b[0].t).slice(0, 7)}→${iso(b.at(-1).t).slice(0, 7)})`).join(', ')}.`,
  `**התקופות (כמו במחקר המקורי):** אימון ${iso(P.train.from)} → ${iso(P.train.to)} · אימות → ${iso(P.val.to)} · **מבחן ${iso(P.test.from)} → ${iso(A0.days.at(-1))}**.`,
  '**הכללים (נקבעו מראש, בלי כיוונון):** 15 המטבעות עם הנפח הדולרי הגבוה ב-30 יום · BTC מעל ממוצע 100 יום (אחרת מזומן) · מטבע מעל ממוצע 50 יום שלו · דירוג תשואת 21 יום / סטיית התקן היומית ב-21 יום · 4 מטבעות × 25% (פחות מועמדים → השאר מזומן) · 2 מנות נפרדות של 50%: אחת מוחלפת בסגירת יום ראשון (UTC), השנייה בסגירת יום רביעי. הביצוע בפתיחת היום שאחרי; המשקלות זזים עם המחיר בין החלפות.',
  '**עלויות:** עמלת Taker של 0.1% (ספוט) + החלקה 0.02% (BTC/ETH) / 0.05% (השאר) בכל קנייה ומכירה.',
  '**קריטריון הצלחה (נקבע לפני ההרצה):** ✅ רק אם כל הארבעה: (1) במבחן — תשואה שנתית חיובית, גבוהה מ-BTC, **וגם** ירידה מקסימלית קטנה משלו; (2) במבחן — שארפ גבוה משל BTC; (3) גם אחרי הוצאת המטבע שהוצאתו פוגעת הכי הרבה — תשואת המבחן גבוהה מ-BTC; (4) הפער בתשואה מ-2022 בין 7 זוגות ימי החלפה (יום X + יום X+3) קטן מחצי הפער בין 7 ימים בודדים.', ''];
L.push('## 1. התוצאה מול BTC ומול השיטה הישנה', ...HDR);
L.push(row('**משודרג — 2 מנות (ראשון + רביעי), 50 מטבעות**', main));
L.push(row('קנה והחזק BTC', btc));
const old = S(other(ALL, 'XS14-top3-f200', { dow: 0 })); res.old = old;
L.push(row('הישנה: 3 החזקים לפי 14 יום (ראשון), 50 מטבעות', old));
L.push(row('Donchian 20/10, 50 מטבעות', S(other(ALL, 'DC20-10-EW'))));
const mainBase = S(tranche(BASEB, [0, 3], 'base')); res.mainBase = mainBase;
L.push(row('משודרג — רק 20 המטבעות של היום (עם הטיית שורדים, להשוואה)', mainBase));

// בדיקת עמידות: הוצאת מטבע אחד בכל פעם (רק מטבעות שנבחרו אי פעם יכולים לשנות משהו — מריצים את כולם)
log('הוצאת מטבע אחד בכל פעם…');
const loo = [];
for (const c of Object.keys(ALL)){ if (c === 'BTC') continue; const st = S(tranche(without(ALL, [c]), [0, 3], `-${c}`)); loo.push({ c, test: st.test.cagr, s22: st.s22.cagr, sh: st.test.sharpe, dd: st.test.maxDD, st }); }
loo.sort((a, b) => a.test - b.test);
const worst = loo[0], zec = loo.find((x) => x.c === 'ZEC'); res.loo = loo.map(({ st, ...x }) => x);
L.push('', '## 2. עמידות: מוציאים מטבע אחד (כל אחד בתורו, חוץ מ-BTC)', ...HDR);
L.push(row(`בלי ${worst.c} — המטבע שהוצאתו פוגעת הכי הרבה במבחן`, worst.st));
for (const x of loo.slice(1, 4)) L.push(row(`בלי ${x.c}`, x.st));
if (zec && !loo.slice(0, 4).includes(zec)) L.push(row('בלי ZEC', zec.st));
L.push('', `טווח תשואת המבחן בכל ${loo.length} ההוצאות: ${pct(loo[0].test)} עד ${pct(loo.at(-1).test)} (חציון ${pct(loo[Math.floor(loo.length / 2)].test)}).`);

// ימי החלפה: יום בודד (100%) מול זוגות של 2 מנות
L.push('', '## 3. רגישות ליום ההחלפה', '', '| ימים | מבחן: שנתי / שארפ | אימות: שנתי | מ-2022: שנתי / ירידה |', '|---|---|---|---|');
const single = [], pairs = [];
for (let w = 0; w < 7; w++){ const st = S(sleeve(ALL, w, 'all')); single.push(st); L.push(`| מנה אחת, יום ${DN[w]} | ${pct(st.test.cagr)} / ${fs(st.test.sharpe)} | ${pct(st.val.cagr)} | ${pct(st.s22.cagr)} / ${pct(-st.s22.maxDD)} |`); }
for (let w = 0; w < 7; w++){ const st = S(tranche(ALL, [w, (w + 3) % 7], 'all')); pairs.push(st); L.push(`| 2 מנות: ${DN[w]} + ${DN[(w + 3) % 7]} | ${pct(st.test.cagr)} / ${fs(st.test.sharpe)} | ${pct(st.val.cagr)} | ${pct(st.s22.cagr)} / ${pct(-st.s22.maxDD)} |`); }
const spread = (arr, f) => { const v = arr.map(f); return [Math.min(...v), Math.max(...v)]; };
const sS = spread(single, (s) => s.s22.cagr), sP = spread(pairs, (s) => s.s22.cagr), tS = spread(single, (s) => s.test.cagr), tP = spread(pairs, (s) => s.test.cagr);
L.push('', `- **מ-2022:** יום בודד ${pct(sS[0])} עד ${pct(sS[1])} (פער ${((sS[1] - sS[0]) * 100).toFixed(1)} נק׳) · 2 מנות ${pct(sP[0])} עד ${pct(sP[1])} (פער ${((sP[1] - sP[0]) * 100).toFixed(1)} נק׳).`,
  `- **במבחן:** יום בודד ${pct(tS[0])} עד ${pct(tS[1])} · 2 מנות ${pct(tP[0])} עד ${pct(tP[1])}.`);
// לפי שנה
L.push('', '## 4. לפי שנה');
const ys = [...new Set(A0.days.map((x) => new Date(x).getUTCFullYear()))];
L.push('| גרסה | ' + ys.join(' | ') + ' |', '|---|' + ys.map(() => '---').join('|') + '|');
const yr = (lab, sr) => L.push(`| ${lab} | ` + ys.map((y) => { const q = dstats(sr, { from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) }); return q.n >= 30 ? pct(q.total) : '—'; }).join(' | ') + ' |');
yr('משודרג (2 מנות)', tranche(ALL, [0, 3], 'all')); yr(`משודרג בלי ${worst.c}`, tranche(without(ALL, [worst.c]), [0, 3], `-${worst.c}`)); yr('הישנה (50 מטבעות)', other(ALL, 'XS14-top3-f200', { dow: 0 })); yr('BTC', other(ALL, 'BH-BTC'));
// מאיפה הרווח: תרומת כל מטבע לפי שנה (משקל היום × תשואת סגירה-לסגירה, לפי ההון של כל מנה) — בדיקת שפיות לשנים החריגות
{
  const A = align(ALL), sl = [0, 3].map((w) => runDaily(A, xsRiskAdj(A.coins, { dow: w }), { drift: true, trace: true }).series);
  const eq = [0.5, 0.5], byY = {};
  for (let i = 0; i < sl[0].length; i++){
    const di = i + 1, y = new Date(A.days[di]).getUTCFullYear(), tot = eq[0] + eq[1];
    for (let j = 0; j < 2; j++){ const x = sl[j][i]; for (let k = 0; k < A.coins.length; k++) if (x.w[k]){ const g = A.C[k][di] / A.C[k][di - 1] - 1; if (Number.isFinite(g)){ (byY[y] ||= {})[A.coins[k]] = (byY[y][A.coins[k]] || 0) + eq[j] / tot * x.w[k] * g; } } eq[j] *= 1 + x.net; }
  }
  L.push('', '## 4א. מאיפה הרווח — 3 המטבעות שתרמו הכי הרבה בכל שנה (סכום תרומות יומיות, משודרג 2 מנות)', '', '| שנה | הכי תורמים | הכי מזיקים | מספר מטבעות שהוחזקו |', '|---|---|---|---|');
  res.contrib = byY;
  for (const y of Object.keys(byY).sort()){ const e = Object.entries(byY[y]).sort((a, b) => b[1] - a[1]); const f = (a) => a.map(([c, v]) => `${c} ${pct(v)}`).join(', ');
    L.push(`| ${y} | ${f(e.slice(0, 3))} | ${f(e.slice(-2).reverse().filter((x) => x[1] < 0))} | ${e.length} |`); }
  const pr = pairs.map((s2) => s2.s22.cagr).sort((a, b) => a - b), pt = pairs.map((s2) => s2.test.cagr).sort((a, b) => a - b);
  L.push('', `**חציון 7 זוגות ימי ההחלפה:** מבחן ${pct(pt[3])}, מ-2022 ${pct(pr[3])} — מול BTC ${pct(btc.test.cagr)} / ${pct(btc.s22.cagr)}. הזוג הגרוע ביותר: מבחן ${pct(pt[0])}, מ-2022 ${pct(pr[0])}.`);
}
// פסיקה לפי הקריטריון שנקבע מראש
const c1 = main.test.cagr > 0 && main.test.cagr > btc.test.cagr && main.test.maxDD < btc.test.maxDD, c2 = main.test.sharpe > btc.test.sharpe, c3 = worst.test > btc.test.cagr, c4 = (sP[1] - sP[0]) < 0.5 * (sS[1] - sS[0]);
res.verdict = { c1, c2, c3, c4, pass: c1 && c2 && c3 && c4 };
L.push('', '## 5. פסיקה לפי הקריטריון שנקבע מראש',
  `1. מבחן: תשואה ${pct(main.test.cagr)} מול BTC ${pct(btc.test.cagr)}, ירידה ${pct(-main.test.maxDD)} מול ${pct(-btc.test.maxDD)} → ${c1 ? '✅' : '❌'}`,
  `2. מבחן: שארפ ${fs(main.test.sharpe)} מול ${fs(btc.test.sharpe)} → ${c2 ? '✅' : '❌'}`,
  `3. בלי ${worst.c}: מבחן ${pct(worst.test)} מול BTC ${pct(btc.test.cagr)} → ${c3 ? '✅' : '❌'}`,
  `4. פער ימי ההחלפה מ-2022: 2 מנות ${((sP[1] - sP[0]) * 100).toFixed(1)} נק׳ מול יום בודד ${((sS[1] - sS[0]) * 100).toFixed(1)} נק׳ → ${c4 ? '✅' : '❌'}`,
  '', `**פסיקה: ${res.verdict.pass ? '✅ עוברת' : '❌ לא עוברת'}**`);
// ---------- 6. גרסת 7 מנות (הצעת GPT, 13/11/2026, אחרי הדוח): 1/7 מהתיק מוחלף בכל יום בשבוע — מבטל את בחירת היום ----------
// הקריטריון שלו, כלשונו, נקבע לפני ההרצה: "שארפ גבוה מביטקוין וירידה מקסימלית נמוכה משל ביטקוין בכל אחת משלוש התקופות (אימון, אימות ומבחן),
// ללא תלות ביום ההתחלה, תוך שמירה על תשואה שנתית עודפת נטו מעמלות". הפירוש: בכל תקופה — שארפ > BTC, ירידה < BTC, ותשואה שנתית > BTC.
{
  const seven = S(tranche(ALL, [0, 1, 2, 3, 4, 5, 6], 'all')), sevenB = S(tranche(BASEB, [0, 1, 2, 3, 4, 5, 6], 'base')); res.seven = seven;
  const loo7 = []; for (const x of loo.slice(0, 3)) loo7.push({ c: x.c, st: S(tranche(without(ALL, [x.c]), [0, 1, 2, 3, 4, 5, 6], `-${x.c}`)) });
  L.push('', '## 6. גרסת 7 מנות (1/7 בכל יום) — הצעת GPT אחרי הדוח',
    '**הקריטריון (של GPT, כלשונו, נקבע לפני ההרצה):** בכל אחת משלוש התקופות — אימון, אימות, מבחן — שארפ גבוה מ-BTC, ירידה מקסימלית נמוכה משל BTC, ותשואה שנתית גבוהה מ-BTC (נטו מעמלות).', '',
    '| גרסה | אימון: שנתי / שארפ / ירידה | אימות: שנתי / שארפ / ירידה | מבחן: שנתי / שארפ / ירידה | מ-2022: שנתי / ירידה |', '|---|---|---|---|---|');
  const r3 = (lab, st) => L.push(`| ${lab} | ${['train', 'val', 'test'].map((k) => `${pct(st[k].cagr)} / ${fs(st[k].sharpe)} / ${pct(-st[k].maxDD)}`).join(' | ')} | ${pct(st.s22.cagr)} / ${pct(-st.s22.maxDD)} |`);
  r3('**7 מנות, 50 מטבעות**', seven); r3('2 מנות (ראשון + רביעי)', main); r3('קנה והחזק BTC', btc);
  for (const x of loo7) r3(`7 מנות בלי ${x.c}`, x.st);
  r3('7 מנות, רק 20 המטבעות של היום', sevenB);
  const per = ['train', 'val', 'test'].map((k) => ({ k, sh: seven[k].sharpe > btc[k].sharpe, dd: seven[k].maxDD < btc[k].maxDD, cg: seven[k].cagr > btc[k].cagr }));
  res.seven.verdict = per; const ok = per.every((x) => x.sh && x.dd && x.cg), nm = { train: 'אימון', val: 'אימות', test: 'מבחן' };
  L.push('', ...per.map((x) => `- ${nm[x.k]}: שארפ ${x.sh ? '✅' : '❌'} · ירידה ${x.dd ? '✅' : '❌'} · תשואה ${x.cg ? '✅' : '❌'}`), '', `**פסיקה (7 מנות): ${ok ? '✅ עוברת' : '❌ לא עוברת'}**`);
}
// ---------- 7. מומנטום יחסי מול ביטקוין, 7 מנות (הצעת GPT אחרי סעיף 6; ענף מחקר נפרד, לא נוגע במעקב החי) ----------
// הכלל נקבע לפני ההרצה: כמו סעיף 6, אבל מטבע שאינו BTC נבחר רק אם תשואת 21 הימים שלו גבוהה משל BTC, ומשבצת ריקה → BTC (לא מזומן).
// הקריטריון — אותו קריטריון של GPT מסעיף 6: שארפ, ירידה ותשואה טובים מ-BTC בכל אחת משלוש התקופות.
{
  const relCache = new Map();
  const relSleeve = (bars, dow, key) => { const k = `${key}|${dow}`; if (relCache.has(k)) return relCache.get(k); const A = align(bars), r = runDaily(A, xsRiskAdj(A.coins, { dow, rel: true }), { drift: true }).series; relCache.set(k, r); return r; };
  const relT = (bars, key) => combineSleeves([0, 1, 2, 3, 4, 5, 6].map((w) => relSleeve(bars, w, key)));
  const rel7 = S(relT(ALL, 'all')); res.rel7 = rel7;
  const relLoo = []; for (const c of Object.keys(ALL)){ if (c === 'BTC') continue; relLoo.push({ c, st: S(relT(without(ALL, [c]), `-${c}`)) }); }
  relLoo.sort((a, b) => a.st.test.cagr - b.st.test.cagr);
  L.push('', '## 7. מומנטום יחסי מול ביטקוין, 7 מנות — הצעת GPT (ענף מחקר נפרד)',
    '**הכלל (נקבע לפני ההרצה):** כמו סעיף 6, אבל מטבע שאינו BTC נבחר רק אם עלה ב-21 הימים יותר מ-BTC; משבצת שלא התמלאה → BTC במקום מזומן. המסנן המאקרו (BTC מעל ממוצע 100, אחרת מזומן) נשאר.',
    '**הקריטריון:** כמו בסעיף 6 — בכל אחת משלוש התקופות שארפ, ירידה ותשואה טובים מ-BTC.', '',
    '| גרסה | אימון: שנתי / שארפ / ירידה | אימות: שנתי / שארפ / ירידה | מבחן: שנתי / שארפ / ירידה | מ-2022: שנתי / ירידה |', '|---|---|---|---|---|');
  const r3 = (lab, st) => L.push(`| ${lab} | ${['train', 'val', 'test'].map((k) => `${pct(st[k].cagr)} / ${fs(st[k].sharpe)} / ${pct(-st[k].maxDD)}`).join(' | ')} | ${pct(st.s22.cagr)} / ${pct(-st.s22.maxDD)} |`);
  r3('**יחסי, 7 מנות, 50 מטבעות**', rel7); r3('7 מנות (סעיף 6, במעקב החי)', res.seven); r3('קנה והחזק BTC', btc);
  for (const x of relLoo.slice(0, 3)) r3(`יחסי בלי ${x.c}`, x.st);
  r3('יחסי, רק 20 המטבעות של היום', S(relT(BASEB, 'base')));
  L.push('', `טווח תשואת המבחן בכל ${relLoo.length} ההוצאות (יחסי): ${pct(relLoo[0].st.test.cagr)} עד ${pct(relLoo.at(-1).st.test.cagr)}.`);
  const per = ['train', 'val', 'test'].map((k) => ({ k, sh: rel7[k].sharpe > btc[k].sharpe, dd: rel7[k].maxDD < btc[k].maxDD, cg: rel7[k].cagr > btc[k].cagr }));
  res.rel7.verdict = per; const ok = per.every((x) => x.sh && x.dd && x.cg), nm = { train: 'אימון', val: 'אימות', test: 'מבחן' };
  L.push('', ...per.map((x) => `- ${nm[x.k]}: שארפ ${x.sh ? '✅' : '❌'} · ירידה ${x.dd ? '✅' : '❌'} · תשואה ${x.cg ? '✅' : '❌'}`), '', `**פסיקה (יחסי, 7 מנות): ${ok ? '✅ עוברת' : '❌ לא עוברת'}**`);
  // לפי שנה: יחסי מול 7 מנות מול BTC (האם הפער ב-2023–2024 נסגר)
  L.push('', '| גרסה | ' + ys.join(' | ') + ' |', '|---|' + ys.map(() => '---').join('|') + '|');
  yr('יחסי, 7 מנות', relT(ALL, 'all')); yr('7 מנות', tranche(ALL, [0, 1, 2, 3, 4, 5, 6], 'all')); yr('BTC', other(ALL, 'BH-BTC'));
}
const md = L.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md); if (JOUT) writeFileSync(JOUT, JSON.stringify(res, (k, v) => (v instanceof Float64Array ? undefined : v), 1));
