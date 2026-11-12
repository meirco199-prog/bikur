#!/usr/bin/env node
// בוט 2 (ETH, נרות 15 דקות, "חציה וחזרה לרצועה"): מתי להזיז את הסטופ למחיר הכניסה? מחקר בלבד — אין פקודות ואין מפתחות.
// בקשת מאיר (12/11/2026): "תעשה" — אחרי שבדמו 4 עסקאות ברצף התקדמו, הסטופ זז ל"כניסה + 0.06%", המחיר חזר, ועמלות של
// 35–95$ הפכו כל אחת להפסד. השאלה: האם הזזה מאוחרת יותר / לרמה שמכסה את העמלות (כ-0.11% הלוך-חזור) עדיפה?
//
// האות: בדיוק של בוט 2 (signal() מ-engine/amit2-exec.js, BOT2 גרסה 1) על נרות 15 דקות שנבנים מנרות דקה של חוזה הפרפטואל
// ETHUSDT ב-Binance (data.binance.vision), 2020-01 → 2026-10. משתנה רק כלל ההזזה למחיר הכניסה:
//   none: בלי הזזה · כשהעסקה התקדמה beAt מהדרך ליעד → הסטופ זז ל"כניסה + bePct%" (רק משפר), beAt ∈ {0.5, 0.75, 0.9}, bePct ∈ {0.06, 0.12, 0.2}.
//   היום בבוט: beAt 0.5, bePct 0.06.
// ביצוע על נרות דקה, כמו הבוט: כניסה בשוק בפתיחת הדקה הראשונה אחרי סגירת הנר; כמות לפי סיכון 400$ מול מחיר הסגירה (עד 190,000$);
// סטופ ויעד קבועים מהאות; בכל דקה: קודם סטופ (פסימי — אם סטופ ויעד באותה דקה, הסטופ), אחר כך יעד, ואז בסגירת הדקה בודקים הזזה;
// שעתיים בעסקה → סגירה בשוק. פוזיציה אחת בכל רגע. עלויות: עמלת Bybit מיידית 0.055% בכל צד + החלקה 0.01% בכל מילוי בשוק
// (כניסה, סטופ, יעד, זמן). המגבלה היומית (1,000$) לא מדומה.
//
// קריטריון שנקבע מראש (לפני הריצה, לא משנים אחריה):
//   • גרסה "עדיפה על היום" רק אם הרווח הממוצע לעסקה שלה גבוה מזה של היום גם בפיתוח (2020–2023) וגם במבחן (2024 → 10/2026),
//     וההפרש על אותם אותות (שנסחרו בשתי הגרסאות) מובהק: t ≥ 2 בכל התקופה.
//   • בנפרד: הבוט "רווחי" רק אם הרווח הממוצע לעסקה > 0 גם בפיתוח וגם במבחן. גרסה עדיפה אבל לא רווחית — לא מצדיקה להשאיר את הבוט.
// שימוש: node --max-old-space-size=6500 invest-api/scripts/research-amit2-be.mjs --from 2020-01 --to 2026-10 --cache DIR --outdir DIR
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BOT2, signal } from '../engine/amit2-exec.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUTDIR = arg('--outdir', 'invest/docs/research/amit2-be');
const log = (...a) => console.error(...a), D = (s) => Date.parse(`${s}T00:00:00Z`), iso = (t) => new Date(t).toISOString().slice(0, 10);
export const COST = { fee: 0.055, slip: 0.01 };            // אחוזים, לכל צד
export const PERIODS = { dev: { from: D('2020-01-01'), to: D('2024-01-01'), he: 'פיתוח 2020–2023' }, test: { from: D('2024-01-01'), to: D('2026-11-01'), he: 'מבחן 2024 → 10/2026' } };
export const VARIANTS = [{ k: 'none', he: 'בלי הזזה' },
  ...[0.5, 0.75, 0.9].flatMap((at) => [0.06, 0.12, 0.2].map((pct) => ({ k: `be${at}-${pct}`, at, pct, he: `אחרי ${Math.round(at * 100)}% מהדרך → כניסה +${pct}%` })))];
export const CURRENT = 'be0.5-0.06';

// נרות דקה (מערכים t,o,h,l,c) → נרות 15 דקות שלמים (לפחות 12 דקות בפועל), מהישן לחדש; idx = אינדקס הדקה הראשונה אחרי הנר
export function bars15(m1, barMs = BOT2.barMs){
  const out = []; let cur = null;
  const push = () => { if (cur && cur.n >= 12) out.push({ t: cur.t, o: cur.o, h: cur.h, l: cur.l, c: cur.c, next: cur.last + 1 }); };
  for (let i = 0; i < m1.t.length; i++){
    const b = Math.floor(m1.t[i] / barMs) * barMs;
    if (!cur || cur.t !== b){ push(); cur = { t: b, o: m1.o[i], h: m1.h[i], l: m1.l[i], c: m1.c[i], n: 0, last: i }; }
    cur.h = Math.max(cur.h, m1.h[i]); cur.l = Math.min(cur.l, m1.l[i]); cur.c = m1.c[i]; cur.n++; cur.last = i;
  }
  push();
  return out;
}

// עסקה אחת על נרות דקה מהאינדקס i0. rule: null (בלי הזזה) או { at, pct }. מחזיר { pnl, fees, why, exitT, be }
export function simTrade(m1, i0, sig, rule, P = BOT2, C = COST){
  const sg = sig.side === 'long' ? 1 : -1, n = m1.t.length;
  if (i0 >= n) return null;
  const notional = Math.min(P.riskUsd / Math.abs(sig.entryRef - sig.sl) * sig.entryRef, P.maxNotional);
  const entry = m1.o[i0] * (1 + sg * C.slip / 100), qty = notional / sig.entryRef, t0 = m1.t[i0], toTp = sg * (sig.tp - entry);
  let sl = sig.sl, be = false, exit = null, why = null, j = i0;
  for (; j < n; j++){
    const o = m1.o[j], h = m1.h[j], l = m1.l[j], c = m1.c[j];
    if (j > i0 && m1.t[j] - m1.t[j - 1] > 30 * 60e3){ exit = o; why = 'פער בנתונים'; break; }
    if (sg > 0 ? l <= sl : h >= sl){ exit = sg > 0 ? Math.min(sl, o) : Math.max(sl, o); why = be ? 'סטופ בכניסה' : 'סטופ'; break; }
    if (sg > 0 ? h >= sig.tp : l <= sig.tp){ exit = sg > 0 ? Math.max(sig.tp, o) : Math.min(sig.tp, o); why = 'יעד'; break; }
    if (m1.t[j] + 60e3 - t0 >= P.maxMins * 60e3){ exit = c; why = 'זמן'; break; }
    if (rule && !be && toTp > 0 && sg * (c - entry) >= rule.at * toTp){
      const nb = entry * (1 + sg * rule.pct / 100);
      if (sg * (nb - sl) > 0 && sg * (c - nb) > 0){ sl = nb; be = true; } // רק משפר, ורק מתחת למחיר הנוכחי (כמו בבורסה)
    }
  }
  if (exit == null){ j = n - 1; exit = m1.c[j]; why = 'סוף הנתונים'; }
  const fill = exit * (1 - sg * C.slip / 100);
  const fees = qty * (entry + fill) * C.fee / 100, pnl = sg * qty * (fill - entry) - fees;
  return { pnl, fees, why, be, exitT: m1.t[j] + 60e3, notional };
}

// פוזיציה אחת: מותר להיכנס בדקה שמתחילה בסוף דקת היציאה הקודמת (busyUntil = סוף דקת היציאה) או אחריה
export const canEnter = (entryT, busyUntil) => entryT >= busyUntil;

// כל האותות ברצף, פוזיציה אחת בכל רגע. מחזיר [{ t, side, pnl, fees, why, be }]
export function runVariant(m1, b15, rule, P = BOT2, C = COST){
  const out = []; let busyUntil = -Infinity;
  for (let k = P.bbN - 1; k < b15.length; k++){
    const bar = b15[k];
    // פוזיציה אחת: הכניסה (פתיחת הדקה bar.next) מותרת רק אחרי סוף דקת היציאה הקודמת. דקת כניסה = דקת יציאה → הפוזיציה עוד פתוחה בסגירת הנר
    if (bar.next >= m1.t.length || !canEnter(m1.t[bar.next], busyUntil)) continue;
    const sig = signal(b15.slice(k - P.bbN + 1, k + 1), P);
    if (!sig || sig.skip) continue;
    const r = simTrade(m1, bar.next, sig, rule, P, C);
    if (!r) continue;
    out.push({ t: bar.t, side: sig.side, ...r }); busyUntil = r.exitT;
  }
  return out;
}

export function summarize(tr){
  const n = tr.length, sum = tr.reduce((a, x) => a + x.pnl, 0), mean = n ? sum / n : NaN;
  const sd = n > 1 ? Math.sqrt(tr.reduce((a, x) => a + (x.pnl - mean) ** 2, 0) / (n - 1)) : NaN;
  const wins = tr.filter((x) => x.pnl > 0).length, fees = tr.reduce((a, x) => a + x.fees, 0);
  const why = {}; for (const x of tr) why[x.why] = (why[x.why] || 0) + 1;
  let eq = 0, peak = 0, dd = 0; for (const x of tr){ eq += x.pnl; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); }
  return { n, sum, mean, t: n > 1 ? mean / (sd / Math.sqrt(n)) : NaN, win: n ? wins / n : NaN, fees: n ? fees / n : NaN, dd, why };
}
// הפרש מזווג על אותם אותות (אותו זמן ואותו כיוון)
export function paired(a, b){
  const mb = new Map(b.map((x) => [`${x.t}|${x.side}`, x.pnl])), d = [];
  for (const x of a){ const y = mb.get(`${x.t}|${x.side}`); if (y != null) d.push(x.pnl - y); }
  const n = d.length, m = n ? d.reduce((s, x) => s + x, 0) / n : NaN, sd = n > 1 ? Math.sqrt(d.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)) : NaN;
  return { n, mean: m, t: n > 1 && sd > 0 ? m / (sd / Math.sqrt(n)) : NaN };
}
const inP = (tr, p) => tr.filter((x) => x.t >= p.from && x.t < p.to);
export function decide(res){
  const cur = res.get(CURRENT), out = [];
  for (const v of VARIANTS){
    if (v.k === CURRENT) continue;
    const tr = res.get(v.k), sDev = summarize(inP(tr, PERIODS.dev)), sTest = summarize(inP(tr, PERIODS.test));
    const cDev = summarize(inP(cur, PERIODS.dev)), cTest = summarize(inP(cur, PERIODS.test)), pr = paired(tr, cur);
    out.push({ k: v.k, better: sDev.mean > cDev.mean && sTest.mean > cTest.mean && pr.t >= 2, profitable: sDev.mean > 0 && sTest.mean > 0, pr });
  }
  return out;
}

const f$ = (x) => (x == null || !Number.isFinite(x) ? '—' : (x < 0 ? '−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US'));
const fp = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—'), ft = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');

async function main(){
  const { loadCoin } = await import('./research-amit-course.mjs');
  const t0 = Date.now(), d = await loadCoin('ETH'), m1 = d.m1;
  if (m1.t.length < 100000) throw new Error('אין מספיק נרות דקה של ETH');
  const b15 = bars15(m1); log(`ETH: ${b15.length.toLocaleString()} נרות 15 דקות`);
  const res = new Map(VARIANTS.map((v) => [v.k, runVariant(m1, b15, v.k === 'none' ? null : { at: v.at, pct: v.pct })]));
  const dec = decide(res), years = [...new Set(res.get(CURRENT).map((x) => new Date(x.t).getUTCFullYear()))].sort();
  const md = [`# בוט 2: מתי להזיז את הסטופ למחיר הכניסה? — ETH, ${d.first} → ${iso(m1.t.at(-1))}, נרות דקה`, '',
    'בקשת מאיר (12/11/2026): בדמו 4 עסקאות ברצף התקדמו, הסטופ זז ל"כניסה + 0.06%", המחיר חזר — והעמלות הפכו כל אחת להפסד. האם כלל אחר עדיף?', '',
    `- **האות:** בדיוק של בוט 2 (גרסה ${BOT2.version}): חציה של רצועת בולינגר (20, 2) בנר 15 דקות, סגירה בפנים, נר בכיוון; סטופ מעבר לקצה הנר, יעד אמצע הרצועה, שעתיים מקסימום.`,
    `- **ביצוע:** על נרות דקה; סיכון ${BOT2.riskUsd}$ לעסקה (עד ${BOT2.maxNotional.toLocaleString()}$); עמלה ${COST.fee}% + החלקה ${COST.slip}% בכל צד; סטופ ויעד באותה דקה → סטופ.`,
    `- **היום בבוט:** אחרי 50% מהדרך ליעד → סטופ ל"כניסה +0.06%". הלוך-חזור עולה כ-${(2 * (COST.fee + COST.slip)).toFixed(2)}% — כלומר 0.06% לא מכסה את העמלות.`,
    `- **תקופות:** ${PERIODS.dev.he} · ${PERIODS.test.he}. **קריטריון שנקבע מראש:** עדיפה על היום רק אם טובה יותר בשתי התקופות וההפרש על אותם אותות מובהק (t ≥ 2).`, '',
    '## 1. כל הגרסאות', '',
    '| כלל | עסקאות | הצלחה | $ לעסקה (פיתוח) | $ לעסקה (מבחן) | $ לעסקה (הכול) | t | סה״כ | עמלות לעסקה | ירידה מקס׳ | נסגרו בסטופ-בכניסה |', '|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const v of VARIANTS){
    const tr = res.get(v.k), a = summarize(tr), dv = summarize(inP(tr, PERIODS.dev)), ts = summarize(inP(tr, PERIODS.test));
    md.push(`| ${v.k === CURRENT ? `**${v.he} (היום)**` : v.he} | ${a.n} | ${fp(a.win)} | ${f$(dv.mean)} | ${f$(ts.mean)} | ${f$(a.mean)} | ${ft(a.t)} | ${f$(a.sum)} | ${f$(-a.fees)} | ${f$(-a.dd)} | ${fp((a.why['סטופ בכניסה'] || 0) / a.n)} |`);
  }
  md.push('', '## 2. לפי שנה — $ לעסקה (מספר עסקאות)', '', `| כלל | ${years.join(' | ')} |`, `|---|${years.map(() => '---').join('|')}|`);
  for (const v of VARIANTS){
    const tr = res.get(v.k);
    md.push(`| ${v.he}${v.k === CURRENT ? ' (היום)' : ''} | ${years.map((y) => { const s = summarize(tr.filter((x) => new Date(x.t).getUTCFullYear() === y)); return `${f$(s.mean)} (${s.n})`; }).join(' | ')} |`);
  }
  const cur = summarize(res.get(CURRENT)), wins = dec.filter((x) => x.better), prof = VARIANTS.filter((v) => { const tr = res.get(v.k); return summarize(inP(tr, PERIODS.dev)).mean > 0 && summarize(inP(tr, PERIODS.test)).mean > 0; });
  md.push('', '## 3. מול היום — הפרש על אותם אותות', '', '| כלל | אותות משותפים | הפרש ממוצע לעסקה | t | עדיפה לפי הקריטריון |', '|---|---|---|---|---|');
  for (const x of dec){ const v = VARIANTS.find((y) => y.k === x.k); md.push(`| ${v.he} | ${x.pr.n} | ${f$(x.pr.mean)} | ${ft(x.pr.t)} | ${x.better ? '✅' : '—'} |`); }
  md.push('', '## 4. מסקנה', '',
    `- **היום (50% → כניסה +0.06%):** ${cur.n} עסקאות, ${f$(cur.mean)} לעסקה, סה״כ ${f$(cur.sum)}; עמלות ${f$(-cur.fees)} לעסקה.`,
    wins.length ? `- **עדיפות על היום לפי הקריטריון:** ${wins.map((x) => VARIANTS.find((v) => v.k === x.k).he).join(' · ')}.` : '- **אף כלל לא עדיף על היום לפי הקריטריון שנקבע מראש.**',
    prof.length ? `- **רווחיות בשתי התקופות:** ${prof.map((v) => v.he).join(' · ')}.` : '- **אף גרסה לא רווחית בשתי התקופות** — שינוי ההזזה לא הופך את בוט 2 לרווחי; הבעיה היא באות עצמו מול העמלות.');
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(join(OUTDIR, 'report.md'), md.join('\n') + '\n');
  writeFileSync(join(OUTDIR, 'summary.json'), JSON.stringify({ data: { first: d.first, last: iso(m1.t.at(-1)), bars15: b15.length }, cost: COST,
    variants: Object.fromEntries(VARIANTS.map((v) => [v.k, { all: summarize(res.get(v.k)), dev: summarize(inP(res.get(v.k), PERIODS.dev)), test: summarize(inP(res.get(v.k), PERIODS.test)) }])), decision: dec }, null, 1));
  log(`סיום (${Math.round((Date.now() - t0) / 1000)}s)`); console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
