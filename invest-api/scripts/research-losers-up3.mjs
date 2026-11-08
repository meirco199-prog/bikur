#!/usr/bin/env node
// "3 ימי עלייה ברצף → קונים ביום הרביעי" (בקשת מאיר, 8/11/2026): "אם זה עלה 3 ימים ברצף אז נקנה אותו ביום הרביעי והוא יעלה לפי
// הסטטיסטיקה. תריץ בדיקה ב-10 שנים ובשנתיים האחרונות". מחקר בלבד, בלי פקודות.
// שני חלקים: (1) סטטיסטיקה גולמית — מכל המניות שעלו 3+ ימים ברצף (S&P 1500 של היום, מחיר > 5$, מחזור > 20M$), כמה עלו ביום הרביעי
// ובכמה בממוצע, מול כל המניות באותם ימים (שיעור הבסיס). (2) כללי מסחר — קונים בפתיחה של היום הרביעי (או בסגירה של השלישי) 3/5/10
// מניות, מחזיקים יום/3/5 ימים; עמלות IBKR + החלקה 0.05% לצד. סטופ ±250$/±500$ לכל התיק נבדק רק בשנתיים האחרונות (יש נרות שעה).
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadData, prepare, run, label, START_USD } from './research-losers-grid.mjs';

const COMBOS = ['up3+liq', 'up3+bull50'];
export function rules(){
  const out = [];
  for (const key of ['r3', 'r']) for (const N of [3, 5, 10]) for (const filt of ['up3', 'up3+liq', 'up3+bull50']) for (const entry of ['O', 'C']) for (const hold of [1, 3, 5])
    out.push({ side: 'L', sel: 'hi', key, N, filt, entry, exit: 'close', hold });
  for (const key of ['r3', 'r']) for (const N of [3, 5, 10]) for (const filt of ['up3', 'up3+liq']) for (const port of [{ tpUsd: 250, slUsd: 250 }, { tpUsd: 500, slUsd: 500 }])
    out.push({ side: 'L', sel: 'hi', key, N, filt, entry: 'O', exit: 'close', hold: 1, port });
  return out;
}

// סטטיסטיקה: לכל מועמד ביום k שעונה על pred — התשואה ביום k+1 (פתיחה→סגירה, וסגירה→סגירה)
function stats(P, k0, k1, pred){
  let n = 0, upOC = 0, upCC = 0, sOC = 0, sCC = 0;
  for (let k = k0; k < k1; k++) for (const x of P.cand[k]){
    if (x.spl <= 1 || !pred(x)) continue;
    const b = P.S[x.s]; if (b.K[x.i + 1] !== k + 1) continue;
    const oc = b.c[x.i + 1] / b.o[x.i + 1] - 1, cc = b.c[x.i + 1] / b.c[x.i] - 1;
    n += 1; sOC += oc; sCC += cc; if (oc > 0) upOC += 1; if (cc > 0) upCC += 1;
  }
  return { n, pOC: upOC / n, pCC: upCC / n, mOC: sOC / n, mCC: sCC / n };
}

async function main(){
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUT = arg('--out', ''), CACHE = arg('--cache', '');
  const { D, Hr } = await loadData({ cache: CACHE, range: '10y', combos: COMBOS });
  const P = prepare(D, Hr), L = P.L, days = P.days, kOf = (d) => { const k = days.findIndex((x) => x >= d); return k < 0 ? L - 1 : k; };
  const years = []; for (let y = Number(days[0].slice(0, 4)) + 1; y <= Number(days.at(-1).slice(0, 4)); y++) years.push(y);
  const W = { all: [kOf(`${years[0]}-01-01`), L - 1], y2: [L - 1 - 504, L - 1], m6: [L - 1 - 126, L - 1] };
  for (const y of years) W[y] = [kOf(`${y}-01-01`), y === years.at(-1) ? L - 1 : kOf(`${y + 1}-01-01`)];
  const nd = (w) => W[w][1] - W[w][0], ann = (r, n) => (1 + r) ** (252 / Math.max(n, 1)) - 1, spyRet = (w) => P.spyC[W[w][1]] / P.spyC[W[w][0]] - 1;
  const usd = (x) => `${Math.round(x).toLocaleString('en-US')}$`, pct = (x, d = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%`;
  const sh = (x) => `${(x * 100).toFixed(1)}%`, pl = (x) => `${x >= 0 ? 'רווח' : 'הפסד'} ${usd(Math.abs(x))}`;
  log(`days ${days[0]} → ${days.at(-1)}; 2y from ${days[W.y2[0]]}; hourly from ${Hr.__first}`);

  const out = [`# "3 ימי עלייה ברצף → קונים ביום הרביעי" — 10 שנים ושנתיים (${days[W.all[0]]} → ${days.at(-1)})`, '',
    `- יקום: ${Object.keys(P.S).length} מניות S&P 1500 (הרכב של היום — הטיית שורדים לטובת קנייה), מחיר > 5$, מחזור > 20M$. עמלות IBKR + החלקה 0.05% לצד.`,
    `- SPY: 10 השנים ${pct(ann(spyRet('all'), nd('all')))} בשנה · השנתיים האחרונות ${pct(spyRet('y2'))} · חצי השנה ${pct(spyRet('m6'))}.`, '',
    '## 1. סטטיסטיקה: מה קרה ביום הרביעי? (כל המניות, בלי עמלות)',
    '| קבוצה | תקופה | מקרים | עלו ביום הרביעי (פתיחה→סגירה) | ממוצע פתיחה→סגירה | עלו (סגירה→סגירה) | ממוצע סגירה→סגירה |', '|---|---|---|---|---|---|---|'];
  const groups = [['כל המניות (שיעור הבסיס)', () => true], ['עלו 3+ ימים ברצף', (x) => x.su >= 3], ['עלו 4+ ימים ברצף', (x) => x.su >= 4], ['עלו 5+ ימים ברצף', (x) => x.su >= 5], ['ירדו 3+ ימים ברצף (להשוואה)', (x) => x.sd >= 3]];
  for (const [w, wl] of [['all', '10 שנים'], ['y2', 'שנתיים'], ['m6', 'חצי שנה']]) for (const [g, f] of groups){
    const s = stats(P, W[w][0], W[w][1], f);
    out.push(`| ${g} | ${wl} | ${s.n.toLocaleString('en-US')} | ${sh(s.pOC)} | ${pct(s.mOC, 2)} | ${sh(s.pCC)} | ${pct(s.mCC, 2)} |`);
  }
  out.push('', '**לפי שנה — עלו 3+ ימים ברצף, ביום הרביעי (פתיחה→סגירה): אחוז שעלו / ממוצע**', '',
    `| ${years.join(' | ')} |`, `|${years.map(() => '---').join('|')}|`,
    `| ${years.map((y) => { const s = stats(P, W[y][0], W[y][1], (x) => x.su >= 3); return `${sh(s.pOC)} / ${pct(s.mOC, 2)}`; }).join(' | ')} |`, '');

  const R = rules().map((c) => { const r = { c }; for (const w of Object.keys(W)) if (!c.port || !/^\d/.test(w) || Number(w) >= 2025) r[w] = run(P, c, ...W[w]);
    r.a10 = ann(r.all.ret, nd('all')); r.pos = years.filter((y) => r[y] && r[y].ret > 0).length; return r; });
  const H = ['| כלל | 10 שנים: בשנה (ירידה מקס׳) | שנים ברווח | שנתיים: 50,000$ → | חצי שנה: 50,000$ → | ימים ברווח (10 שנים) |', '|---|---|---|---|---|---|'];
  const row = (x) => `| ${label(x.c)} | ${x.c.port ? '—' : `${pct(x.a10)} (${pct(-x.all.dd)})`} | ${x.c.port ? '—' : `${x.pos}/${years.length}`} | ${usd(x.y2.end)} (${pl(x.y2.end - START_USD)}) | ${usd(x.m6.end)} (${pl(x.m6.end - START_USD)}) | ${x.c.port ? '—' : sh(x.all.wins / Math.max(x.all.days, 1))} |`;
  const yH = [`| כלל | ${years.join(' | ')} |`, `|---|${years.map(() => '---').join('|')}|`], yRow = (x) => `| ${label(x.c)} | ${years.map((y) => pct(x[y].ret)).join(' | ')} |`;
  const canon = (c) => JSON.stringify([c.key, c.N, c.filt, c.entry, c.hold, c.port ?? null]), byKey = new Map(R.map((x) => [canon(x.c), x])), find = (c) => byKey.get(canon(c));
  const B = { side: 'L', sel: 'hi', key: 'r3', N: 3, filt: 'up3', entry: 'O', exit: 'close', hold: 1 };
  const sect = (t, xs, h = H, rw = row, note) => { out.push(`## ${t}`); if (note) out.push(note); out.push(...h, ...xs.filter(Boolean).map(rw), ''); };
  sect('2. הכלל שביקשת: קונים בפתיחה של היום הרביעי, מוכרים בסגירה (בלי סטופ)', [3, 5, 10].flatMap((N) => [find({ ...B, N }), find({ ...B, N, key: 'r' })]),
    H, row, '"r3" = אלה שעלו הכי הרבה ב-3 הימים מבין מי שעלה 3 ימים ברצף; "r" = אלה שעלו הכי הרבה ביום השלישי.');
  sect('לפי שנה', [3, 5, 10].map((N) => find({ ...B, N })), yH, yRow, `SPY: ${years.map((y) => `${y} ${pct(spyRet(y))}`).join(' · ')}`);
  sect('3. וריאציות: כניסה בסגירה של היום השלישי, החזקה 3/5 ימים, רק נזילות, רק בשוק עולה', [
    find({ ...B, entry: 'C' }), find({ ...B, hold: 3 }), find({ ...B, hold: 5 }), find({ ...B, entry: 'C', hold: 5 }), find({ ...B, filt: 'up3+liq' }), find({ ...B, filt: 'up3+liq', hold: 5 }),
    find({ ...B, filt: 'up3+bull50' }), find({ ...B, filt: 'up3+bull50', hold: 5 }), find({ ...B, N: 10, filt: 'up3+liq', hold: 5 })]);
  sect('4. עם סטופ לכל התיק (קנייה בפתיחה, נמדד בכל שעה) — רק שנתיים (אין נרות שעה לפני כן)', R.filter((x) => x.c.port && x.c.key === 'r3'));
  const top = [...R].filter((x) => !x.c.port).sort((a, b) => b.a10 - a.a10).slice(0, 10);
  sect('5. 10 הגרסאות הטובות ביותר על 10 שנים', top);
  const md = out.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md);
}
const log = (...a) => console.error(...a);
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
