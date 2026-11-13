#!/usr/bin/env node
// מחקר: "סקאלפינג" — סטופ קצר מאוד, רווח קטן, הרבה עסקאות ביום, במינוף (בקשת מאיר, 13/11/2026). מחקר בלבד — אין פקודות.
// מאיר: "כל הרעיון להרוויח בקטן מאוד עם מינוף, ולהפסיד גם בקטן בגלל סטופ קצר... תעשה בדיקה של אלפי עסקאות ביום או כמה שאפשר עם סטופ קצר מאוד".
//
// נתונים: נרות דקה של חוזי הפרפטואל ב-Binance (data.binance.vision), BTC / ETH / SOL, 2020-01 → 2026-10 (אותו cache כמו research-amit-course).
// כניסות (נקבעו מראש) — אות בסגירת דקה, כניסה בפתיחת הדקה הבאה:
//   random   — תמיד בשוק: מיד אחרי יציאה נכנסים שוב, כיוון אקראי (זרע קבוע) — קבוצת ביקורת ו"כמה שיותר עסקאות"
//   band     — סגירה מתחת לרצועת בולינגר (20, 2) → לונג, מעל → שורט (כמו בוט 1)
//   breakout — סגירה מעל השיא של 20 הדקות הקודמות → לונג, מתחת לשפל → שורט
//   mom5     — עלייה של 0.3%+ ב-5 דקות → לונג (המשך), ירידה → שורט
// יציאות: סטופ 0.05% / 0.1% / 0.2% / 0.3% · יעד = 1 / 2 / 3 × הסטופ · מקסימום 60 דקות. סטופ ויעד באותה דקה → סטופ (פסימי). עסקה אחת בכל רגע לכל מטבע.
// עלויות (Bybit, חשבון רגיל): כניסה בשוק 0.055% + החלקה 0.01%; יציאה ביעד בפקודה ממתינה 0.02%; סטופ/זמן 0.055% + החלקה 0.01%.
//   מוצג גם "לפני עלויות" ו"נקודת האיזון" — כמה עמלה הלוך-חזור השיטה יכולה לשלם ועדיין לא להפסיד.
// מינוף: לא משנה את הרווח לעסקה באחוזים מהפוזיציה — רק כמה גדולה הפוזיציה. ב-190,000$ (כמו בוט 1, מינוף ~38 על 5,000$) כל 0.1% = 190$.
// הכרעה (נקבעה מראש): גרסה "עובדת" רק אם אחרי עלויות הרווח הממוצע לעסקה > 0 עם t ≥ 2 גם בפיתוח (2020–2023) וגם במבחן (2024 → 10/2026),
//   ב-2 מטבעות לפחות מתוך 3. נבדקות 48 גרסאות לכל מטבע — אחת שעוברת בקושי יכולה להיות מקרה.
// שימוש: node --max-old-space-size=6500 invest-api/scripts/research-scalp.mjs --from 2020-01 --to 2026-10 --cache DIR --outdir DIR
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const COST = { taker: 0.055, maker: 0.02, slip: 0.01 };   // אחוזים לכל צד
export const STOPS = [0.05, 0.1, 0.2, 0.3], RR = [1, 2, 3], RULES = ['random', 'band', 'breakout', 'mom5'], MAX_MIN = 60, NOTIONAL = 190000;
const D = (s) => Date.parse(`${s}T00:00:00Z`);
export const SPLIT = D('2024-01-01');
export const RULE_HE = { random: 'אקראי, תמיד בשוק', band: 'מחוץ לרצועה → חזרה (כמו בוט 1)', breakout: 'פריצת שיא/שפל 20 דק׳', mom5: 'המשך תנופה של 5 דק׳ (0.3%+)' };

// אות בסגירת דקה i: +1 לונג, −1 שורט, 0 כלום
export function signal(m, i, rule, rnd){
  const c = m.c;
  if (rule === 'random') return rnd() < 0.5 ? 1 : -1;
  if (rule === 'mom5'){ if (i < 5) return 0; const r = c[i] / c[i - 5] - 1; return r >= 0.003 ? 1 : r <= -0.003 ? -1 : 0; }
  if (i < 20) return 0;
  if (rule === 'breakout'){ let hi = -Infinity, lo = Infinity; for (let j = i - 20; j < i; j++){ if (m.h[j] > hi) hi = m.h[j]; if (m.l[j] < lo) lo = m.l[j]; } return c[i] > hi ? 1 : c[i] < lo ? -1 : 0; }
  let s = 0; for (let j = i - 19; j <= i; j++) s += c[j]; const mu = s / 20; let v = 0; for (let j = i - 19; j <= i; j++) v += (c[j] - mu) ** 2; const sd = Math.sqrt(v / 20);
  return c[i] < mu - 2 * sd ? 1 : c[i] > mu + 2 * sd ? -1 : 0;   // band
}
// עסקה: כניסה בפתיחת דקה e בכיוון sg. מחזיר { g: תשואה לפני עלויות (שבר), why: 'יעד'|'סטופ'|'זמן'|'פער', x: אינדקס דקת היציאה }
export function trade(m, e, sg, stopPct, tgtPct){
  const n = m.t.length, p0 = m.o[e], st = p0 * (1 - sg * stopPct / 100), tg = p0 * (1 + sg * tgtPct / 100);
  for (let j = e; j < n; j++){
    if (j > e && m.t[j] - m.t[j - 1] > 5 * 60e3) return { g: sg * (m.o[j] / p0 - 1), why: 'פער', x: j };
    if (sg > 0 ? m.l[j] <= st : m.h[j] >= st){ const px = j === e ? st : (sg > 0 ? Math.min(st, m.o[j]) : Math.max(st, m.o[j])); return { g: sg * (px / p0 - 1), why: 'סטופ', x: j }; }
    if (sg > 0 ? m.h[j] >= tg : m.l[j] <= tg){ const px = j === e ? tg : (sg > 0 ? Math.max(tg, m.o[j]) : Math.min(tg, m.o[j])); return { g: sg * (px / p0 - 1), why: 'יעד', x: j }; }
    if (j - e + 1 >= MAX_MIN) return { g: sg * (m.c[j] / p0 - 1), why: 'זמן', x: j };
  }
  return null;
}
// עלות הלוך-חזור (שבר) לפי סוג היציאה
export const cost = (why, C = COST) => (C.taker + C.slip + (why === 'יעד' ? C.maker : C.taker + C.slip)) / 100;
export const lcg = (seed) => { let x = seed >>> 0 || 1; return () => (x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32; };

// כל הגרסאות על מטבע אחד: { [key]: { dev: {...}, test: {...} } } — סכומים בלבד (חסכוני בזיכרון)
export function runCoin(m, opts = {}){
  const out = {}, n = m.t.length;
  for (const rule of RULES) for (const s of STOPS) for (const rr of RR){
    const k = `${rule}-s${s}-x${rr}`, rnd = lcg(1234), acc = { dev: blank(), test: blank() };
    for (let i = 25; i < n - 2;){
      const sg = signal(m, i, rule, rnd);
      if (!sg){ i++; continue; }
      const r = trade(m, i + 1, sg, s, s * rr);
      if (!r) break;
      add(acc[m.t[i + 1] < SPLIT ? 'dev' : 'test'], r, opts.C);
      i = r.x;                                                        // הסיגנל הבא: בסגירת דקת היציאה
    }
    out[k] = { rule, s, rr, ...acc };
  }
  return out;
}
const blank = () => ({ n: 0, g: 0, net: 0, net2: 0, c: 0, win: 0, t0: Infinity, t1: -Infinity });
function add(a, r, C = COST){ const net = r.g - cost(r.why, C); a.n++; a.g += r.g; a.c += cost(r.why, C); a.net += net; a.net2 += net * net; if (net > 0) a.win++; }
export function summ(a, days){
  const m = a.n ? a.net / a.n : NaN, sd = a.n > 1 ? Math.sqrt(Math.max(0, (a.net2 - a.n * m * m) / (a.n - 1))) : NaN;
  return { n: a.n, perDay: a.n / days, gross: a.n ? a.g / a.n : NaN, cost: a.n ? a.c / a.n : NaN, net: m, t: sd > 0 ? m / (sd / Math.sqrt(a.n)) : NaN, win: a.n ? a.win / a.n : NaN };
}

async function main(){
  const { loadCoin } = await import('./research-amit-course.mjs');
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUTDIR = arg('--outdir', 'invest/docs/research/scalp'), COINS = (arg('--coins', 'BTC,ETH,SOL')).split(','), log = (...a) => console.error(...a), t0 = Date.now();
  const R = {};
  for (const coin of COINS){
    const d = await loadCoin(coin), m = d.m1; if (m.t.length < 100000) continue;
    const res = runCoin(m), dDev = (Math.min(SPLIT, m.t.at(-1)) - m.t[0]) / 86400e3, dTest = Math.max(1, (m.t.at(-1) - SPLIT) / 86400e3);
    R[coin] = Object.fromEntries(Object.entries(res).map(([k, x]) => [k, { ...x, dev: summ(x.dev, dDev), test: summ(x.test, dTest) }]));
    log(`${coin}: ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  const coins = Object.keys(R), keys = Object.keys(R[coins[0]]);
  const pass = (k) => coins.filter((c) => { const x = R[c][k]; return x.dev.net > 0 && x.dev.t >= 2 && x.test.net > 0 && x.test.t >= 2; }).length >= 2;
  const pp = (x, d = 3) => (Number.isFinite(x) ? `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%` : '—'), f$ = (x) => (Number.isFinite(x) ? (x < 0 ? '−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US') : '—');
  const md = [`# סקאלפינג: סטופ קצר מאוד, רווח קטן, הרבה עסקאות — ${coins.join(' / ')}, נרות דקה 2020 → 10/2026`, '',
    'בקשת מאיר (13/11/2026): "להרוויח בקטן מאוד עם מינוף, ולהפסיד גם בקטן בגלל סטופ קצר... בדיקה של אלפי עסקאות ביום או כמה שאפשר עם סטופ קצר מאוד".', '',
    `- **כניסות:** ${RULES.map((r) => RULE_HE[r]).join(' · ')}. **סטופ:** ${STOPS.map((s) => `${s}%`).join(' / ')}; **יעד:** ×1/×2/×3 מהסטופ; עד ${MAX_MIN} דקות. סטופ ויעד באותה דקה → סטופ.`,
    `- **עלויות Bybit:** כניסה בשוק ${COST.taker}% + החלקה ${COST.slip}%; יעד ${COST.maker}%; סטופ/זמן ${COST.taker}% + ${COST.slip}%. **הלוך-חזור: ${(cost('יעד') * 100).toFixed(3)}% ביעד, ${(cost('סטופ') * 100).toFixed(3)}% בסטופ.**`,
    `- **מינוף:** לא משנה את הרווח באחוזים מהפוזיציה. בפוזיציה של ${NOTIONAL.toLocaleString()}$ (כמו בוט 1) כל 0.1% = ${NOTIONAL / 1000}$, וכל עסקה משלמת כ-${Math.round(NOTIONAL * cost('סטופ'))}$ עמלות בסטופ.`,
    '- **הכרעה (נקבעה מראש):** רווח אחרי עלויות > 0 עם t ≥ 2 בפיתוח (2020–2023) ובמבחן (2024 →), ב-2 מטבעות לפחות.', ''];
  for (const coin of coins){
    md.push(`## ${coin}`, '', '| כניסה | סטופ | יעד | עסקאות ביום | הצלחה | לפני עלויות לעסקה | עלות לעסקה | נטו לעסקה (פיתוח) | נטו לעסקה (מבחן) | t מבחן | $ ביום (מבחן, 190K$) |', '|---|---|---|---|---|---|---|---|---|---|---|');
    for (const k of keys){ const x = R[coin][k], all = x.test; md.push(`| ${RULE_HE[x.rule]} | ${x.s}% | ${(x.s * x.rr).toFixed(2)}% | ${Math.round((x.dev.perDay + x.test.perDay) / 2)} | ${Math.round(all.win * 100)}% | ${pp(all.gross)} | ${pp(-all.cost)} | ${pp(x.dev.net)} | ${pp(x.test.net)} | ${Number.isFinite(x.test.t) ? x.test.t.toFixed(1) : '—'} | ${f$(x.test.net * NOTIONAL * x.test.perDay)} |`); }
    md.push('');
  }
  // הכי טוב לפני עלויות — האם יש בכלל יתרון?
  const bestGross = keys.map((k) => ({ k, g: coins.reduce((s, c) => s + R[c][k].test.gross, 0) / coins.length, ...R[coins[0]][k] })).sort((a, b) => b.g - a.g).slice(0, 5);
  const passing = keys.filter(pass);
  md.push('## מסקנה', '',
    `- **5 הגרסאות עם הרווח הגבוה ביותר לפני עלויות (מבחן, ממוצע המטבעות):** ${bestGross.map((x) => `${RULE_HE[x.rule]} סטופ ${x.s}% יעד ×${x.rr}: ${pp(x.g)}`).join(' · ')}. מול עלות של ${(cost('יעד') * 100).toFixed(3)}%–${(cost('סטופ') * 100).toFixed(3)}% לעסקה.`,
    passing.length ? `- **עוברות את ההכרעה:** ${passing.join(', ')}.` : `- **אף גרסה לא עוברת את ההכרעה** (מתוך ${keys.length} × ${coins.length} מטבעות). ככל שהסטופ קצר יותר — העמלה גדולה יותר ביחס לתנועה, וההפסד גדל.`);
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(join(OUTDIR, 'report.md'), md.join('\n') + '\n');
  writeFileSync(join(OUTDIR, 'meta.json'), JSON.stringify({ coins, cost: COST, passing, results: R }, null, 1));
  log(`done ${((Date.now() - t0) / 1000).toFixed(0)}s`); console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
