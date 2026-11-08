#!/usr/bin/env node
// הכיוון ההפוך (בקשת מאיר, 8/11/2026): "אם מניות שירדו בחדות המשיכו לרדת למחרת — זה יכול להיות כלל שכן מרוויח. תבדוק כללים בכיוון הזה".
// מחקר בלבד, בלי פקודות. אותו מנוע ואותן עלויות כמו research-losers-grid.mjs (S&P 1500 של היום, עמלות IBKR, החלקה 0.05% לצד), ובנוסף:
//   - 10 שנים של נרות יומיים (2016–2026) במקום 3 — כדי לראות שוקים שונים (2018, קריסת 2020, 2022) ולא רק את 3 החודשים האחרונים.
//     נרות שעה יש רק ל-~730 הימים האחרונים; לפני כן סטופ נבדק על הנר היומי (נר שנגע בשתי הרמות → הסטופ קודם; שמרני).
//   - שורט: עמלת השאלה 0.02% ליום (~5% בשנה — מניות S&P בדרך כלל זולות יותר, מניה שקרסה לפעמים יקרה יותר).
//   - הטיית שורדים: היקום הוא הרכב של היום, כלומר חסרות מניות שקרסו ויצאו מהמדד — לשורט זה **נגד** (חסרים השורטים הטובים ביותר).
//   - סינון לפי מצב השוק (SPY מעל/מתחת לממוצע 50/200), וכלל "מחליף": בשוק יורד — שורט על יורדות, בשוק עולה — קנייה של יורדות.
// חלוקה: אימון 2017–2023 (בוחרים רק לפיו), מבחן 2024 → 11/2026, ובנוסף 3 החודשים של מאיר וכל שנה בנפרד.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadData, prepare, run, label, START_USD, DAYS3M } from './research-losers-grid.mjs';

const F_SHORT = ['all', 'mild', 'mid', 'big', 'gap', 'intra', 'dnTr', 'upTr', 'liq', 'spyDn', 'spyUp', 'bear50', 'bear200',
  'mid+bear50', 'big+bear50', 'mid+bear200', 'big+bear200', 'gap+bear50', 'dnTr+bear50', 'liq+bear50'];
const EX = [{ exit: 'open', hold: 1, entry: 'C' }, ...['C', 'O'].flatMap((entry) => [1, 2, 3, 5].map((hold) => ({ exit: 'close', hold, entry })))];
const STOPS = [{ sl: 0.03 }, { sl: 0.05 }, { sl: 0.08 }, { sl: 0.1 }, { tr: 0.03 }, { tr: 0.05 }];

export function rules(){
  const out = [];
  for (const N of [3, 5, 10]) for (const filt of F_SHORT) for (const ex of EX){
    const c = { side: 'S', sel: 'lo', N, filt, ...ex };
    out.push(c);
    if (ex.exit === 'close') for (const stop of STOPS) out.push({ ...c, stop });
  }
  // המשך גם למעלה: קנייה של העולות (מומנטום של יום)
  for (const N of [3, 5, 10]) for (const filt of ['all', 'bull50', 'bull200', 'liq', 'upTr']) for (const ex of EX) out.push({ side: 'L', sel: 'hi', N, filt, ...ex });
  // בסיס להשוואה: קנייה של היורדות
  for (const N of [3, 5, 10]) for (const filt of ['all', 'mild', 'bull50', 'mild+bull50', 'mild+bull200']) out.push({ side: 'L', sel: 'lo', N, filt, entry: 'C', exit: 'close', hold: 1 });
  const bear = [null, { side: 'S', sel: 'lo', N: 5, filt: 'mid', entry: 'C', exit: 'close', hold: 1 }, { side: 'S', sel: 'lo', N: 3, filt: 'mid', entry: 'O', exit: 'close', hold: 1 },
    { side: 'S', sel: 'lo', N: 5, filt: 'all', entry: 'C', exit: 'close', hold: 1 }, { side: 'S', sel: 'lo', N: 5, filt: 'big', entry: 'C', exit: 'close', hold: 1 }];
  const bull = [null, { side: 'L', sel: 'lo', N: 3, filt: 'mild', entry: 'C', exit: 'close', hold: 1 }, { side: 'L', sel: 'lo', N: 5, filt: 'mild', entry: 'C', exit: 'close', hold: 1 }];
  for (const ma of [50, 200]) for (const b of bear) for (const u of bull) if (b || u) out.push({ sw: { ma, bear: b, bull: u } });
  return out;
}

async function main(){
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUT = arg('--out', ''), CACHE = arg('--cache', '');
  const { D, Hr } = await loadData({ cache: CACHE, range: '10y' });
  const P = prepare(D, Hr), L = P.L, days = P.days, kOf = (d) => { const k = days.findIndex((x) => x >= d); return k < 0 ? L - 1 : k; };
  const years = []; for (let y = Number(days[0].slice(0, 4)) + 1; y <= Number(days.at(-1).slice(0, 4)); y++) years.push(y);
  const k3 = L - 1 - DAYS3M, kP = Math.max(60, kOf(Hr.__first || days[0]) + 1);
  const W = { tr: [kOf('2017-01-01'), kOf('2024-01-01')], te: [kOf('2024-01-01'), L - 1], m: [k3, L - 1], p: [kP, k3] };
  for (const y of years) W[y] = [kOf(`${y}-01-01`), y === years.at(-1) ? L - 1 : kOf(`${y + 1}-01-01`)];
  const nd = (w) => W[w][1] - W[w][0], ann = (r, n) => (1 + r) ** (252 / Math.max(n, 1)) - 1;
  const usd = (x) => `${Math.round(x).toLocaleString('en-US')}$`, pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
  const spyRet = (w) => P.spyC[W[w][1]] / P.spyC[W[w][0]] - 1;
  log(`days ${days[0]} → ${days.at(-1)} (${L}); train ${days[W.tr[0]]}→${days[W.tr[1]]}; test →${days.at(-1)}; hourly from ${Hr.__first}`);
  const t0 = Date.now(), R = rules().map((c) => { const r = { c }; for (const w of Object.keys(W)) r[w] = run(P, c, ...W[w]);
    r.tra = ann(r.tr.ret, nd('tr')); r.tea = ann(r.te.ret, nd('te')); r.pos = years.filter((y) => r[y].ret > 0).length; r.worst = Math.min(...years.map((y) => r[y].ret)); return r; });
  log(`${R.length} rules, ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const HEAD = ['| כלל | 2017–2023 בשנה (ירידה מקס׳) | 2024–11/2026 בשנה (ירידה מקס׳) | 3 החודשים: 50,000$ → | שנים ברווח | שנה גרועה | עסקאות באימון |', '|---|---|---|---|---|---|---|'];
  const row = (x) => `| ${label(x.c)} | ${pct(x.tra)} (${pct(-x.tr.dd)}) | ${pct(x.tea)} (${pct(-x.te.dd)}) | ${usd(x.m.end)} (${x.m.end >= START_USD ? 'רווח' : 'הפסד'} ${usd(Math.abs(x.m.end - START_USD))}) | ${x.pos}/${years.length} | ${pct(x.worst)} | ${x.tr.trades} |`;
  const yHead = [`| כלל | ${years.join(' | ')} |`, `|---|${years.map(() => '---').join('|')}|`];
  const yRow = (x) => `| ${label(x.c)} | ${years.map((y) => pct(x[y].ret)).join(' | ')} |`;
  const canon = (c) => JSON.stringify([c.side, c.sel, c.N, c.filt, c.entry, c.exit, c.hold || 1, c.stop ?? null, c.sw ?? null]);
  const byKey = new Map(R.map((x) => [canon(x.c), x])), find = (c) => byKey.get(canon(c));
  const top = (arr, f, n) => [...arr].sort((a, b) => f(b) - f(a)).slice(0, n);
  const out = [`# הכיוון ההפוך — שורט על מניות שירדו בחדות (${days[W.tr[0]]} → ${days.at(-1)})`, '',
    `- יקום: ${Object.keys(P.S).length} מניות S&P 1500 (הרכב של היום). עמלות IBKR, החלקה 0.05% לצד, שורט: עמלת השאלה 0.02% ליום. התחלה 50,000$ בכל תקופה.`,
    `- נבדקו ${R.length.toLocaleString('en-US')} כללים. **בחירה לפי 2017–2023 בלבד**; 2024–2026 ו-3 החודשים הם מבחן.`,
    `- SPY: 2017–2023 ${pct(ann(spyRet('tr'), nd('tr')))} בשנה · 2024–11/2026 ${pct(ann(spyRet('te'), nd('te')))} בשנה · 3 החודשים ${pct(spyRet('m'))}.`,
    `- הרוויחו באימון: ${R.filter((x) => x.tr.ret > 0).length} · באימון וגם במבחן: ${R.filter((x) => x.tr.ret > 0 && x.te.ret > 0).length} · באימון, במבחן וב-3 החודשים: ${R.filter((x) => x.tr.ret > 0 && x.te.ret > 0 && x.m.ret > 0).length}.`, ''];
  const sect = (t, xs, note, H = HEAD, rw = row) => { out.push(`## ${t}`); if (note) out.push(note); out.push(...H, ...xs.filter(Boolean).map(rw), ''); };
  const S1 = { side: 'S', sel: 'lo', entry: 'C', exit: 'close', hold: 1 };
  sect('הבסיס: שורט על היורדות, סגירה → סגירה', [3, 5, 10].map((N) => find({ ...S1, N, filt: 'all' })).concat([find({ ...S1, side: 'L', N: 10, filt: 'all' })]));
  sect('הכלל שבלט ב-3 החודשים (שורט 3–5 יורדות 7%–15%) — לאורך 10 שנים', [find({ ...S1, N: 3, filt: 'mid', entry: 'O' }), find({ ...S1, N: 5, filt: 'mid', entry: 'O' }), find({ ...S1, N: 5, filt: 'mid' }), find({ ...S1, N: 3, filt: 'mid', entry: 'O', stop: { sl: 0.05 } })],
    null, yHead, yRow);
  sect('סינון לפי מצב השוק (שורט 5 יורדות, סגירה → סגירה)', ['all', 'bear50', 'bear200', 'mid', 'mid+bear50', 'mid+bear200', 'big', 'big+bear50', 'big+bear200'].map((filt) => find({ ...S1, N: 5, filt })));
  sect('כלל מחליף לפי מצב השוק', top(R.filter((x) => x.c.sw), (x) => x.tra, 28), 'בכל יום: אם SPY מתחת לממוצע — הכלל של "שוק יורד", אחרת הכלל של "שוק עולה".');
  const elig = R.filter((x) => x.tr.trades >= 150 && !x.c.sw);
  const best = top(elig, (x) => x.tra, 20);
  sect('20 הכללים הטובים ביותר ב-2017–2023 — ומה קרה להם אחר כך (מבחן עיוור)', best, '⚠️ נבחרו רק לפי האימון. אם הם נכשלים במבחן — זה מזל של האימון.');
  sect('20 הכללים העקביים ביותר (הכי הרבה שנים ברווח, ואז השנה הגרועה)', top(elig, (x) => x.pos * 10 + x.worst, 20));
  sect('לפי שנה — 8 הטובים באימון, והכלל המחליף הטוב באימון', [...best.slice(0, 8), top(R.filter((x) => x.c.sw), (x) => x.tra, 1)[0]], `SPY: ${years.map((y) => `${y} ${pct(spyRet(y))}`).join(' · ')}`, yHead, yRow);
  const md = out.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md);
}
const log = (...a) => console.error(...a);
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
