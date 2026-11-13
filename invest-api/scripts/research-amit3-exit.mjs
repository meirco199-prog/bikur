#!/usr/bin/env node
// בוט 3 (שיטת הקורס): לצאת מוקדם — "באינדיקטור השני, עד 1.8%" — כדי לקחת רווחים קטנים יותר ולא ליפול בהפסדים גדולים. מחקר בלבד.
// בקשת מאיר (13/11/2026), אחרי עסקה של עמית (כניסה 1,000$ ואז 1,500$ במינוף 15, יציאה בעלייה חדה): "תנסה לעשות בבוט — לצאת
//   באינדיקטור השני, עד 1.8, כדי להרוויח עסקאות קטנות יותר, אבל לא ליפול בהפסדים גדולים".
//
// האות: בדיוק של בוט 3 (CANON), אותם 8 מטבעות. "אינדיקטור" = הקווים שהבוט כבר יוצא בהם: EMA20 / EMA50 / VWAP / EMA200 של נר 15 דק׳,
//   מעל מחיר הכניסה הממוצע (מינימום +0.3%), מהקרוב לרחוק. היום: 75% בקו הראשון, הסטופ לכניסה, 25% בקו האחרון.
// גרסאות (נקבעו מראש):
//   יציאה: היום (75%+25%) · 100% בקו הראשון · 100% בקו השני · אותן שתיים עם תקרה 1.8% · יעד קבוע 1.0% / 1.5% / 1.8%
//   × סטופ: של הקורס · 1% מתחת למנה האחרונה · 2×ATR  × משקלות: 30-60-90 · בלי המנה השלישית (1/3, 2/3).
// ההכרעה — כמו בסעיף 7ח (נקבעה מראש): בחירה לפי אימון בלבד; עוברת רק אם R > 0 בכל 4 התקופות, טובה מהאקראי, ו-R > 0 על 20 מטבעות חדשים.
//   בנפרד, "מה שמאיר ביקש" (קו שני, עד 1.8%, סטופ ומשקלות של היום) מוצג בכל התקופות ועל המטבעות החדשים, גם אם לא נבחר.
// שימוש: node --max-old-space-size=6500 invest-api/scripts/research-amit3-exit.mjs --from 2020-01 --to 2026-10 --cache DIR --outdir DIR
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EXITS = { course: { exit: 'course' }, first: { exit: 'first' }, second: { exit: 'second' }, first18: { exit: 'first', exitCap: 1.8 },
  second18: { exit: 'second', exitCap: 1.8 }, fix10: { exit: 1.0 }, fix15: { exit: 1.5 }, fix18: { exit: 1.8 } };
export const EXIT_HE = { course: 'היום: 75% בקו הראשון + 25% בקו האחרון', first: '100% בקו הראשון', second: '100% בקו השני', first18: '100% בקו הראשון, עד 1.8%',
  second18: '100% בקו השני, עד 1.8%', fix10: 'יעד קבוע +1.0%', fix15: 'יעד קבוע +1.5%', fix18: 'יעד קבוע +1.8%' };
export const REQUESTED = 'second18-course-slcourse', BASE_EXIT = 'course-course-slcourse';
export function exitVariants(WEIGHTS){
  const out = [];
  for (const e of Object.keys(EXITS)) for (const stop of ['course', 1, 'atr2']) for (const w of ['course', 'two']){
    const so = String(stop).startsWith('atr') ? { stop: 'course', stopAtr: Number(String(stop).slice(3)) } : { stop };
    out.push({ key: `${e}-${w}-sl${stop}`, e, w, r: 'none', stop, opt: { entry: 'ladder', ...EXITS[e], ...so, weights: WEIGHTS[w] } });
  }
  return out;
}

async function main(){
  const M = await import('./research-amit3-stop.mjs');
  const { COIN_CAT, RISK_USD } = await import('../engine/amit-course.js');
  const { PERIODS, WEIGHTS, W_HE, stopHe, stat, pick, passes, run } = M;
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUTDIR = arg('--outdir', 'invest/docs/research/amit3-exit'), COINS = 'BTC,SOL,AVAX,ADA,INJ,RENDER,NEAR,FARTCOIN'.split(',');
  const VCOINS = 'XRP,DOGE,LINK,DOT,LTC,BCH,ATOM,UNI,AAVE,FIL,ETC,XLM,TRX,ALGO,SAND,AXS,APT,ARB,OP,SUI'.split(','), VCAT = { DOGE: 'vol' };
  const ALL = { from: PERIODS.hold.from, to: PERIODS.test.to }, BOT_RISK = 200, log = (...a) => console.error(...a), t0 = Date.now();
  const V = exitVariants(WEIGHTS);
  const A = await run(COINS, V, (c) => COIN_CAT[c] || 'follow', 41);
  const S = new Map(V.map((v) => { const c = A.T.get(v.key), r = A.Rn.get(v.key);
    return [v.key, { v, ...Object.fromEntries([...Object.keys(PERIODS), 'all'].map((p) => [p, stat(c, p === 'all' ? ALL : PERIODS[p])])), rnd: { all: stat(r, ALL) } }]; }));
  const best = pick(S), keys = [...new Set([BASE_EXIT, REQUESTED, best?.v.key].filter(Boolean))];
  const B = await run(VCOINS, V.filter((v) => keys.includes(v.key)), (c) => VCAT[c] || 'follow', 77);
  const VS = new Map(keys.map((k) => [k, stat(B.T.get(k), ALL)]));
  log(`סיום (${((Date.now() - t0) / 1000).toFixed(0)}s)`);

  const f = (x, d = 3) => (Number.isFinite(x) ? (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(d) : '—'), pc = (x) => (Number.isFinite(x) ? `${x.toFixed(0)}%` : '—');
  const usd = (R) => (Number.isFinite(R) ? (R < 0 ? '−' : '+') + '$' + Math.abs(Math.round(R * BOT_RISK)).toLocaleString('en-US') : '—');
  const name = (x) => `${EXIT_HE[x.v.e]} · ${W_HE[x.v.w]} · סטופ ${stopHe(x.v.stop)}`;
  const ok = best && passes(best, VS.get(best.v.key)), req = S.get(REQUESTED), base = S.get(BASE_EXIT);
  const md = ['# בוט 3: לצאת "בקו השני, עד 1.8%" — רווחים קטנים יותר, פחות הפסדים גדולים? — 2020–2026, נרות דקה', '',
    'בקשת מאיר (13/11/2026): "תנסה לעשות בבוט — לצאת באינדיקטור השני, עד 1.8, כדי להרוויח עסקאות קטנות יותר, אבל לא ליפול בהפסדים גדולים".', '',
    `- **האות:** בדיוק של בוט 3, ${COINS.join(', ')}. **הקווים:** EMA20 / EMA50 / VWAP / EMA200 של נר 15 דק׳ מעל מחיר הכניסה הממוצע, מהקרוב לרחוק.`,
    `- **גרסאות:** ${V.length} (יציאה × סטופ × משקלות). **R:** ביחס להפסד המלא המתוכנן; בבוט 3 הפסד מלא = ${BOT_RISK}$. עלויות Bybit מלאות.`,
    `- **תקופות:** ${Object.values(PERIODS).map((p) => p.he).join(' · ')}. אימות: ${VCOINS.length} מטבעות חדשים.`,
    '- **ההכרעה (נקבעה מראש):** בחירה לפי אימון בלבד; עוברת רק אם R > 0 בכל 4 התקופות, טובה מהאקראי, ו-R > 0 על המטבעות החדשים.', '',
    '## 1. היציאות (סטופ ומשקלות של היום) — כל התקופות', '| יציאה | עסקאות | הצלחה | רווח ממוצע | הפסד ממוצע | הפסדים ≥ ½R | R נטו | $ בבוט לעסקה | R אקראי |', '|---|---|---|---|---|---|---|---|---|'];
  for (const e of Object.keys(EXITS)){ const x = S.get(`${e}-course-slcourse`); md.push(`| ${e === 'second18' ? `**${EXIT_HE[e]}** (הבקשה)` : EXIT_HE[e]} | ${x.all.n} | ${pc(x.all.win)} | ${f(x.all.avgWin)} | ${f(x.all.avgLoss)} | ${pc(x.all.bigPct)} | ${f(x.all.R)} | ${usd(x.all.R)} | ${f(x.rnd.all.R)} |`); }
  md.push('', '## 2. כל הגרסאות — R נטו, כל התקופות', `| יציאה | ${['course', 1, 'atr2'].flatMap((st) => ['course', 'two'].map((w) => `סטופ ${stopHe(st)} · ${w === 'two' ? 'בלי השלישית' : '30-60-90'}`)).join(' | ')} |`, `|---|${'---|'.repeat(6)}`);
  for (const e of Object.keys(EXITS)) md.push(`| ${EXIT_HE[e]} | ${['course', 1, 'atr2'].flatMap((st) => ['course', 'two'].map((w) => f(S.get(`${e}-${w}-sl${st}`).all.R))).join(' | ')} |`);
  md.push('', '## 3. לפי תקופה', `| גרסה | ${Object.values(PERIODS).map((p) => p.he).join(' | ')} | הכול | אקראי | ${VCOINS.length} מטבעות חדשים |`, `|---|${Object.keys(PERIODS).map(() => '---|').join('')}---|---|---|`);
  for (const k of keys){ const x = S.get(k), v = VS.get(k); md.push(`| ${k === BASE_EXIT ? '**היום:** ' : k === REQUESTED ? '**הבקשה:** ' : ''}${k === best?.v.key ? '**נבחרת:** ' : ''}${name(x)} | ${Object.keys(PERIODS).map((p) => `${f(x[p].R)} (${x[p].n})`).join(' | ')} | ${f(x.all.R)} | ${f(x.rnd.all.R)} | ${f(v.R)} (${v.n}) |`); }
  md.push('', '## 4. מסקנה', '',
    `- **הבקשה (קו שני, עד 1.8%):** ${f(req.all.R)} לעסקה (${usd(req.all.R)}), הצלחה ${pc(req.all.win)} (היום ${pc(base.all.win)}), הפסד ממוצע ${f(req.all.avgLoss)} (היום ${f(base.all.avgLoss)}), רווח ממוצע ${f(req.all.avgWin)} (היום ${f(base.all.avgWin)}). מטבעות חדשים: ${f(VS.get(REQUESTED).R)}.`,
    `- **בוט 3 היום:** ${f(base.all.R)} לעסקה (${usd(base.all.R)}).`,
    best ? `- **הנבחרת לפי אימון:** ${name(best)} — הכול ${f(best.all.R)} (${usd(best.all.R)}), מטבעות חדשים ${f(VS.get(best.v.key).R)}.` : '- אין גרסה עם מספיק עסקאות.',
    `- **ההכרעה שנקבעה מראש:** ${ok ? '**עברה** — אפשר להציע לדמו (החלטה של מאיר).' : '**לא עברה** — שינוי היציאה לא הופך את בוט 3 לרווחי.'}`);
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(join(OUTDIR, 'report.md'), md.join('\n') + '\n');
  writeFileSync(join(OUTDIR, 'meta.json'), JSON.stringify({ variants: V.length, best: best?.v.key || null, passes: ok, requested: { key: REQUESTED, all: req.all, v: VS.get(REQUESTED) }, base: { key: BASE_EXIT, all: base.all }, risk: RISK_USD }, null, 1));
  console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
