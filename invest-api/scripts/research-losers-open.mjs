#!/usr/bin/env node
// קנייה בפתיחה + סטופ 500$ לכל התיק (בקשת מאיר, 8/11/2026): "בסטופ 500 ברווח או הפסד בחצי השנה האחרונה, לכל התיק, שאני קונה בפתיחת
// המסחר. בדוק מספר אופציות: המניות שירדו הכי הרבה יום קודם או עלו הכי הרבה, 3/5/15/20 מניות, או יומיים-שלושה אחרונים — אם 3 ימים ברצף
// יורדות אז יום למחרת עלה. תנסה כמה ורסיות, תבדוק מה מרוויח". מחקר בלבד, בלי פקודות.
// המנוע: research-losers-grid.mjs (עמלות IBKR, החלקה 0.05% לצד, S&P 1500 של היום). קונים בפתיחה של יום המסחר, בחלקים שווים מ-50,000$.
// סטופ התיק: הרווח/הפסד המשותף של כל המניות נמדד בסגירת כל נר שעה; כשהוא מגיע ל-+500$ או ל-−500$ מוכרים הכול; אחרת מוכרים בסגירה.
// חלונות: חצי השנה האחרונה (126 ימי מסחר), שני הרבעונים שלה בנפרד, ו-~15 החודשים שלפניה (מאז שיש נרות שעה) כבדיקה מחוץ לתקופה.
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadData, prepare, run, label, START_USD } from './research-losers-grid.mjs';

const D6 = 126;
const PORTS = [null, { tpUsd: 500, slUsd: 500 }, { tpUsd: 250, slUsd: 250 }, { tpUsd: 1000, slUsd: 1000 }, { tpUsd: 1000, slUsd: 500 }, { tpUsd: 500, slUsd: 1000 }];
export function rules(){
  const out = [];
  for (const sel of ['lo', 'hi']) for (const key of ['r', 'r2', 'r3']) for (const N of [3, 5, 10, 15, 20])
    for (const filt of sel === 'lo' ? ['all', 'dn2', 'dn3', 'liq', 'dn3+liq', 'upTr', 'mild'] : ['all', 'up2', 'up3', 'liq', 'up3+liq', 'upTr']){
      if (filt === 'mild' && key !== 'r') continue;
      for (const port of PORTS) out.push({ side: 'L', sel, key, N, filt, entry: 'O', exit: 'close', hold: 1, ...(port ? { port } : {}) });
    }
  return out;
}

async function main(){
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUT = arg('--out', ''), CACHE = arg('--cache', '');
  const { D, Hr } = await loadData({ cache: CACHE, range: '3y' });
  const P = prepare(D, Hr), L = P.L, days = P.days;
  const k6 = L - 1 - D6, kq = L - 1 - D6 / 2, kP = Math.max(60, days.findIndex((d) => d >= (Hr.__first || days[0])) + 1);
  const W = { m: [k6, L - 1], q1: [k6, kq], q2: [kq, L - 1], p: [kP, k6] };
  const nP = k6 - kP, ann = (r, n) => (1 + r) ** (252 / Math.max(n, 1)) - 1, spyRet = (a, b) => P.spyC[b] / P.spyC[a] - 1;
  const usd = (x) => `${Math.round(x).toLocaleString('en-US')}$`, pct = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`;
  const pl = (x) => `${x >= 0 ? 'רווח' : 'הפסד'} ${usd(Math.abs(x))}`;
  log(`6m ${days[k6]} → ${days.at(-1)}; prior ${days[kP]} → ${days[k6]} (${nP})`);
  const R = rules().map((c) => { const r = { c }; for (const [w, [a, b]] of Object.entries(W)) r[w] = run(P, c, a, b); r.pa = ann(r.p.ret, nP); return r; });
  const canon = (c) => JSON.stringify([c.sel, c.key, c.N, c.filt, c.port ?? null]), byKey = new Map(R.map((x) => [canon(x.c), x])), find = (c) => byKey.get(canon(c));
  const HEAD = ['| כלל | חצי שנה: 50,000$ → | רבעון 1 / רבעון 2 | ימי מסחר / נסגרו ב-+ / ב-− | ירידה מקס׳ | עמלות | 15 החודשים שלפני (בשנה) |', '|---|---|---|---|---|---|---|'];
  const row = (x) => `| ${label(x.c).replace(' · כניסה בפתיחה למחרת · מכירה בסגירה', '')} | **${usd(x.m.end)}** (${pl(x.m.end - START_USD)}) | ${pl(x.q1.end - START_USD)} / ${pl(x.q2.end - START_USD)} | ${x.m.days} / ${x.m.tp} / ${x.m.sl} | ${pct(-x.m.dd)} | ${usd(x.m.fees)} | ${pct(x.p.ret)} (${pct(x.pa)}) |`;
  const top = (arr, f, n) => [...arr].sort((a, b) => f(b) - f(a)).slice(0, n);
  const P500 = { tpUsd: 500, slUsd: 500 }, B = { side: 'L', sel: 'lo', key: 'r', N: 10, filt: 'all', entry: 'O', exit: 'close', hold: 1 };
  const out = [`# קנייה בפתיחה + סטופ ±500$ לכל התיק — חצי השנה האחרונה (${days[k6]} → ${days.at(-1)})`, '',
    `- ${Object.keys(P.S).length} מניות S&P 1500 (מחיר > 5$, מחזור > 20M$). קונים בפתיחה בחלקים שווים מ-50,000$, מוכרים ב-±500$ לכל התיק (נמדד בסגירת כל נר שעה) או בסגירה.`,
    `- עמלות IBKR + החלקה 0.05% לצד. נבדקו ${R.length} כללים. SPY בחצי השנה: ${pct(spyRet(k6, L - 1))} (${usd(START_USD * (1 + spyRet(k6, L - 1)))}).`,
    `- הרוויחו בחצי השנה: ${R.filter((x) => x.m.ret > 0).length} · בחצי השנה וגם ב-15 החודשים שלפני: ${R.filter((x) => x.m.ret > 0 && x.p.ret > 0).length} · וגם בשני הרבעונים: ${R.filter((x) => x.m.ret > 0 && x.p.ret > 0 && x.q1.ret > 0 && x.q2.ret > 0).length}.`, ''];
  const sect = (t, xs, note) => { out.push(`## ${t}`); if (note) out.push(note); out.push(...HEAD, ...xs.filter(Boolean).map(row), ''); };
  sect('הבסיס: 10 שירדו הכי הרבה אתמול — בלי סטופ ועם סטופים שונים לתיק', PORTS.map((port) => find({ ...B, ...(port ? { port } : {}) })));
  for (const sel of ['lo', 'hi']) for (const key of ['r', 'r2', 'r3'])
    sect(`${sel === 'lo' ? 'שירדו' : 'שעלו'} הכי הרבה ${key === 'r' ? 'אתמול' : `ב-${key.slice(1)} הימים האחרונים`} — כמה מניות (סטופ ±500$)`, [3, 5, 10, 15, 20].map((N) => find({ ...B, sel, key, N, port: P500 })));
  sect('רצפים: 3+ ימי ירידה ברצף (קונים למחרת בפתיחה), סטופ ±500$', [3, 5, 10, 15, 20].map((N) => find({ ...B, filt: 'dn3', N, port: P500 })).concat([3, 5, 10].map((N) => find({ ...B, filt: 'dn2', N, port: P500 }))));
  sect('רצפים: 3+ ימי עלייה ברצף, סטופ ±500$', [3, 5, 10, 15, 20].map((N) => find({ ...B, sel: 'hi', filt: 'up3', N, port: P500 })));
  sect('20 הכללים הטובים ביותר בחצי השנה', top(R, (x) => x.m.ret, 20), '⚠️ מתוך מאות כללים חלק ינצחו במקרה — העמודה האחרונה (15 החודשים שלפני) היא הבדיקה.');
  sect('20 הכללים הטובים ביותר ב-15 החודשים שלפני — ומה קרה להם בחצי השנה (מבחן עיוור)', top(R, (x) => x.pa, 20));
  const rob = R.filter((x) => x.m.ret > 0 && x.p.ret > 0 && x.q1.ret > 0 && x.q2.ret > 0);
  sect(`עקביים: הרוויחו בשני הרבעונים של חצי השנה וגם ב-15 החודשים שלפני — ${rob.length} כללים`, top(rob, (x) => Math.min(x.m.ret * 2, x.pa), 20));
  const md = out.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md);
}
const log = (...a) => console.error(...a);
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
