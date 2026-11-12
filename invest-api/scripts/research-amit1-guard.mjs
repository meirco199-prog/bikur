#!/usr/bin/env node
// בוט 1 (ביטקוין, נרות דקה, "נגיעה ברצועה" — engine/amit-exec.js גרסה 2): האם סינון "סכין נופלת" או סטופ נגרר אחרי רווח
// היו מצילים אותו? מחקר בלבד — אין פקודות ואין מפתחות.
// רקע (12/11/2026): מאיר — "יש המון רווחים אבל בהפסד אחד זה צולל. תבנה מנגנון של סטופים שיתפוס את זה ברגע הנכון".
//   הניתוח של 31 העסקאות האמיתיות (scripts/analyze-bot1-trades.mjs) מצא שני מועמדים: לא להיכנס כשהמחיר נע נגד הכיוון יותר מ-x%
//   ב-15 הדקות שלפני הכניסה, וסטופ נגרר אחרי +0.3%. על 31 עסקאות ו-37 מנגנונים זה יכול להיות מקרה — כאן הם נבדקים על שנים.
//
// האות: בדיוק של בוט 1 גרסה 2. רצועות בולינגר (20, 2) מ-20 הסגירות שלפני הדקה; הדקה הקודמת נסגרה בתוך הרצועות; רוחב ≥ 0.35%.
//   פקודות ממתינות (PostOnly) על שתי הרצועות → מילוי רק אם השפל/השיא עבר את הרצועה ב-0.01% לפחות (נגיעה = תור), ורק אם הדקה
//   לא נפתחה מעבר לרצועה (PostOnly נדחית). דקה שנוגעת בשתי הרצועות — מדלגים. 190,000$ לעסקה.
//   סטופ −0.22% (נבדק כבר בדקת הכניסה — שמרני), יעד: הרצועה הנגדית (מתעדכנת בכל דקה, פקודה ממתינה), 60 דקות → סגירה בשוק.
//   עלויות: כניסה ויעד 0.02% (ממתינה); סטופ וזמן 0.055% + החלקה 0.02%. פוזיציה אחת בכל רגע. המגבלה היומית לא מדומה.
// נתונים: נרות דקה של חוזה הפרפטואל BTCUSDT ב-Binance (data.binance.vision), 2020-01 → 2026-10.
//
// גרסאות (נקבעו מראש, לפני הריצה — רק מה שבלט בניתוח של 31 העסקאות):
//   now: היום · knife-0.2 / knife-0.3 / knife-0.5: לא נכנסים כשהמומנטום 15 דק׳ בכיוון העסקה < −x% ·
//   trail0.3-0.1 / trail0.3-0.15: אחרי +0.3% הסטופ נגרר 0.1%/0.15% מתחת לשיא · knife-0.5+trail0.3-0.1: שניהם.
// קריטריון שנקבע מראש (לא משנים אחרי הריצה):
//   • "עדיפה על היום" — רק אם בשתי התקופות (פיתוח 2020–2023, מבחן 2024 → 10/2026) גם הרווח הממוצע לעסקה וגם הסה״כ גבוהים מהיום,
//     וההפרש על העסקאות של היום (עסקה שהגרסה דילגה עליה = 0) מובהק: t ≥ 2.
//   • "מצילה את הבוט" — רק אם בנוסף הרווח הממוצע לעסקה > 0 בשתי התקופות. עדיפה אבל מפסידה — לא סיבה להפעיל את הבוט.
// שימוש: node --max-old-space-size=6500 invest-api/scripts/research-amit1-guard.mjs --from 2020-01 --to 2026-10 --cache DIR --outdir DIR
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUTDIR = arg('--outdir', 'invest/docs/research/amit1-guard');
const log = (...a) => console.error(...a), D = (s) => Date.parse(`${s}T00:00:00Z`), iso = (t) => new Date(t).toISOString().slice(0, 10);
export const BOT1 = { bbN: 20, bbK: 2, minWidthPct: 0.35, slPct: 0.22, maxMins: 60, notional: 190000, queuePct: 0.01 };
export const COST = { maker: 0.02, taker: 0.055, slip: 0.02 };   // אחוזים, לכל צד
export const PERIODS = { dev: { from: D('2020-01-01'), to: D('2024-01-01'), he: 'פיתוח 2020–2023' }, test: { from: D('2024-01-01'), to: D('2026-11-01'), he: 'מבחן 2024 → 10/2026' } };
export const VARIANTS = [
  { k: 'now', he: 'היום (בלי שינוי)' },
  ...[0.2, 0.3, 0.5].map((z) => ({ k: `knife-${z}`, knife: z, he: `לא נכנסים כשמומנטום 15 דק׳ < −${z}%` })),
  ...[0.1, 0.15].map((b) => ({ k: `trail0.3-${b}`, trail: { a: 0.3, b }, he: `אחרי +0.3% → סטופ נגרר ${b}% מתחת לשיא` })),
  { k: 'knife-0.5+trail0.3-0.1', knife: 0.5, trail: { a: 0.3, b: 0.1 }, he: 'שניהם: סינון −0.5% + נגרר 0.1% אחרי +0.3%' },
];

// רצועות מ-n הסגירות שלפני הדקה i (סטיית תקן של האוכלוסייה, כמו amit-rules.bands)
export function bandsAt(c, i, n = BOT1.bbN, k = BOT1.bbK){
  if (i < n) return null;
  let m = 0; for (let j = i - n; j < i; j++) m += c[j]; m /= n;
  let v = 0; for (let j = i - n; j < i; j++) v += (c[j] - m) ** 2;
  const sd = Math.sqrt(v / n); return { mid: m, lo: m - k * sd, up: m + k * sd };
}
// מומנטום 15 דק׳ בכיוון העסקה עד הדקה שלפני הכניסה (אותה הגדרה כמו analyze-bot1-trades: c(1)/c(16))
export const mom15 = (c, i, sg) => (i >= 16 ? sg * (c[i - 1] / c[i - 16] - 1) * 100 : NaN);

// עסקה מדקת הכניסה i (המילוי בתוך הדקה). מחזיר { pnl, gross, why, exitI }
export function simTrade(m1, i, sg, entry, v, P = BOT1, C = COST){
  const { t, o, h, l, c } = m1, n = t.length, qty = P.notional / entry;
  let stop = entry * (1 - sg * P.slPct / 100), peak = entry, trailing = false, exit = null, why = null, maker = false, j = i;
  if (sg > 0 ? l[i] <= stop : h[i] >= stop){ exit = stop; why = 'סטופ'; }   // דקת הכניסה ממשיכה עד הסטופ
  else for (j = i + 1; j < n; j++){
    if (t[j] - t[j - 1] > 30 * 60e3){ exit = o[j]; why = 'פער בנתונים'; break; }
    if (sg > 0 ? l[j] <= stop : h[j] >= stop){ exit = sg > 0 ? Math.min(stop, o[j]) : Math.max(stop, o[j]); why = trailing ? 'סטופ נגרר' : 'סטופ'; break; }
    const b = bandsAt(c, j, P.bbN, P.bbK), tgt = sg > 0 ? b.up : b.lo;
    if (sg > 0 ? h[j] >= tgt : l[j] <= tgt){ exit = sg > 0 ? Math.max(tgt, o[j]) : Math.min(tgt, o[j]); why = 'יעד'; maker = true; break; }
    if (j - i >= P.maxMins){ exit = c[j]; why = 'זמן'; break; }
    if (v.trail){
      peak = sg > 0 ? Math.max(peak, h[j]) : Math.min(peak, l[j]);
      if (sg * (peak / entry - 1) * 100 >= v.trail.a){
        const ns = peak * (1 - sg * v.trail.b / 100);
        if (sg * (ns - stop) > 0 && sg * (c[j] - ns) > 0){ stop = ns; trailing = true; } // רק משפר, ורק מתחת למחיר הנוכחי
      }
    }
  }
  if (exit == null){ j = n - 1; exit = c[j]; why = 'סוף הנתונים'; }
  const fill = maker ? exit : exit * (1 - sg * C.slip / 100);
  const gross = sg * qty * (fill - entry), fees = P.notional * C.maker / 100 + qty * fill * (maker ? C.maker : C.taker) / 100;
  return { pnl: gross - fees, gross, why, exitI: j };
}

// כל האותות ברצף, פוזיציה אחת. מחזיר [{ t, side, pnl, gross, why }]
export function runVariant(m1, v, P = BOT1, C = COST){
  const { t, o, h, l, c } = m1, out = [], q = P.queuePct / 100;
  for (let i = P.bbN + 1; i < t.length; i++){
    const b = bandsAt(c, i, P.bbN, P.bbK);
    if (!(c[i - 1] >= b.lo && c[i - 1] <= b.up)) continue;                 // הדקה הקודמת נסגרה בפנים (נגיעה טרייה)
    if ((b.up - b.lo) / b.mid * 100 < P.minWidthPct) continue;
    const lo = l[i] <= b.lo * (1 - q) && o[i] > b.lo, up = h[i] >= b.up * (1 + q) && o[i] < b.up;
    if (lo === up) continue;                                               // אין נגיעה, או נגיעה בשתיהן
    const sg = lo ? 1 : -1;
    if (v.knife != null && mom15(c, i, sg) < -v.knife) continue;
    const r = simTrade(m1, i, sg, lo ? b.lo : b.up, v, P, C);
    out.push({ t: t[i], side: sg, pnl: r.pnl, gross: r.gross, why: r.why });
    i = r.exitI;                                                           // כניסה הבאה — מהדקה שאחרי היציאה
  }
  return out;
}

export function summarize(tr){
  const n = tr.length, sum = tr.reduce((a, x) => a + x.pnl, 0), mean = n ? sum / n : NaN, gross = n ? tr.reduce((a, x) => a + x.gross, 0) / n : NaN;
  const sd = n > 1 ? Math.sqrt(tr.reduce((a, x) => a + (x.pnl - mean) ** 2, 0) / (n - 1)) : NaN;
  const why = {}; for (const x of tr) why[x.why] = (why[x.why] || 0) + 1;
  return { n, sum, mean, gross, t: n > 1 && sd > 0 ? mean / (sd / Math.sqrt(n)) : NaN, win: n ? tr.filter((x) => x.pnl > 0).length / n : NaN, big: n ? tr.filter((x) => x.why === 'סטופ').length / n : NaN, why };
}
// הפרש על העסקאות של היום: לכל עסקה של היום — הגרסה באותה דקה ובאותו כיוון, או 0 אם הגרסה לא נכנסה
export function paired(v, cur){
  const mv = new Map(v.map((x) => [`${x.t}|${x.side}`, x.pnl])), d = cur.map((x) => (mv.get(`${x.t}|${x.side}`) ?? 0) - x.pnl);
  const n = d.length, m = n ? d.reduce((s, x) => s + x, 0) / n : NaN, sd = n > 1 ? Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : NaN;
  return { n, mean: m, t: n > 1 && sd > 0 ? m / (sd / Math.sqrt(n)) : NaN };
}
export const inP = (tr, p) => tr.filter((x) => x.t >= p.from && x.t < p.to);
export function decide(res){
  const cur = res.get('now'), cd = summarize(inP(cur, PERIODS.dev)), ct = summarize(inP(cur, PERIODS.test));
  return VARIANTS.filter((v) => v.k !== 'now').map((v) => {
    const tr = res.get(v.k), sd = summarize(inP(tr, PERIODS.dev)), st = summarize(inP(tr, PERIODS.test)), pr = paired(tr, cur);
    const better = sd.mean > cd.mean && st.mean > ct.mean && sd.sum > cd.sum && st.sum > ct.sum && pr.t >= 2;
    return { k: v.k, better, saves: better && sd.mean > 0 && st.mean > 0, pr };
  });
}

const f$ = (x) => (x == null || !Number.isFinite(x) ? '—' : (x < 0 ? '−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US'));
const fp = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—'), ft = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');

async function main(){
  const { loadCoin } = await import('./research-amit-course.mjs');
  const t0 = Date.now(), d = await loadCoin('BTC'), m1 = d.m1;
  if (m1.t.length < 100000) throw new Error('אין מספיק נרות דקה של BTC');
  const res = new Map(VARIANTS.map((v) => { const r = runVariant(m1, v); log(`${v.k}: ${r.length} עסקאות`); return [v.k, r]; }));
  const dec = decide(res), years = [...new Set(res.get('now').map((x) => new Date(x.t).getUTCFullYear()))].sort();
  const md = [`# בוט 1: סינון "סכין נופלת" וסטופ נגרר — ביטקוין, ${d.first} → ${iso(m1.t.at(-1))}, נרות דקה`, '',
    'בקשת מאיר (12/11/2026): "יש המון רווחים אבל בהפסד אחד זה צולל — מנגנון סטופים שיתפוס את זה ברגע הנכון". שני המנגנונים שבלטו בניתוח של 31 העסקאות האמיתיות, על שנים של נתונים.', '',
    `- **האות:** בוט 1 גרסה 2 — נגיעה ברצועת בולינגר (20, 2) בדקה, אחרי סגירה בפנים, רוחב ≥ ${BOT1.minWidthPct}%; כניסה ממתינה על הרצועה; סטופ −${BOT1.slPct}%, יעד הרצועה הנגדית, ${BOT1.maxMins} דקות מקסימום; ${BOT1.notional.toLocaleString()}$ לעסקה.`,
    `- **עלויות:** כניסה ויעד ${COST.maker}%; סטופ וזמן ${COST.taker}% + החלקה ${COST.slip}%. סטופ נבדק כבר בדקת הכניסה; סטופ ויעד באותה דקה → סטופ.`,
    `- **תקופות:** ${PERIODS.dev.he} · ${PERIODS.test.he}. **קריטריון שנקבע מראש:** עדיפה על היום רק אם טובה יותר בשתי התקופות (לעסקה ובסה״כ) וההפרש על עסקאות היום מובהק (t ≥ 2); מצילה את הבוט רק אם גם רווחית בשתי התקופות.`, '',
    '## 1. כל הגרסאות', '',
    '| גרסה | עסקאות | הצלחה | סטופ מלא | לפני עלויות לעסקה | $ לעסקה (פיתוח) | $ לעסקה (מבחן) | $ לעסקה (הכול) | t | סה״כ |', '|---|---|---|---|---|---|---|---|---|---|'];
  for (const v of VARIANTS){
    const tr = res.get(v.k), a = summarize(tr), dv = summarize(inP(tr, PERIODS.dev)), ts = summarize(inP(tr, PERIODS.test));
    md.push(`| ${v.k === 'now' ? `**${v.he}**` : v.he} | ${a.n.toLocaleString()} | ${fp(a.win)} | ${fp(a.big)} | ${f$(a.gross)} | ${f$(dv.mean)} | ${f$(ts.mean)} | ${f$(a.mean)} | ${ft(a.t)} | ${f$(a.sum)} |`);
  }
  md.push('', '## 2. לפי שנה — $ לעסקה (מספר עסקאות)', '', `| גרסה | ${years.join(' | ')} |`, `|---|${years.map(() => '---').join('|')}|`);
  for (const v of VARIANTS){ const tr = res.get(v.k); md.push(`| ${v.he} | ${years.map((y) => { const s = summarize(tr.filter((x) => new Date(x.t).getUTCFullYear() === y)); return `${f$(s.mean)} (${s.n})`; }).join(' | ')} |`); }
  md.push('', '## 3. מול היום — על העסקאות של היום (דילוג = 0)', '', '| גרסה | עסקאות היום | שיפור ממוצע לעסקה | t | עדיפה | מצילה את הבוט |', '|---|---|---|---|---|---|');
  for (const x of dec){ const v = VARIANTS.find((y) => y.k === x.k); md.push(`| ${v.he} | ${x.pr.n.toLocaleString()} | ${f$(x.pr.mean)} | ${ft(x.pr.t)} | ${x.better ? '✅' : '—'} | ${x.saves ? '✅' : '—'} |`); }
  const cur = summarize(res.get('now')), wins = dec.filter((x) => x.better), saves = dec.filter((x) => x.saves);
  md.push('', '## 4. מסקנה', '',
    `- **היום:** ${cur.n.toLocaleString()} עסקאות, ${f$(cur.mean)} לעסקה (לפני עלויות ${f$(cur.gross)}), סה״כ ${f$(cur.sum)}.`,
    wins.length ? `- **עדיפות על היום לפי הקריטריון:** ${wins.map((x) => VARIANTS.find((v) => v.k === x.k).he).join(' · ')}.` : '- **אף מנגנון לא עדיף על היום לפי הקריטריון שנקבע מראש.**',
    saves.length ? `- **מצילות את הבוט (רווחיות בשתי התקופות):** ${saves.map((x) => VARIANTS.find((v) => v.k === x.k).he).join(' · ')}.` : '- **אף מנגנון לא הופך את בוט 1 לרווחי בשתי התקופות.**');
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(join(OUTDIR, 'report.md'), md.join('\n') + '\n');
  writeFileSync(join(OUTDIR, 'summary.json'), JSON.stringify({ data: { first: d.first, last: iso(m1.t.at(-1)), bars: m1.t.length }, cost: COST, bot: BOT1,
    variants: Object.fromEntries(VARIANTS.map((v) => [v.k, { all: summarize(res.get(v.k)), dev: summarize(inP(res.get(v.k), PERIODS.dev)), test: summarize(inP(res.get(v.k), PERIODS.test)) }])), decision: dec }, null, 1));
  log(`סיום (${Math.round((Date.now() - t0) / 1000)}s)`); console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
