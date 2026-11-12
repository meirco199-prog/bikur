#!/usr/bin/env node
// מחקר: "שיטת 2 אחוז" (בקשת מאיר, 12/11/2026): "כשעולה 2 אחוז או יורדת — מוכרים. בדוק 5 שנים אחרונות". מחקר בלבד — אין כסף, אין פקודות.
//
// השיטה: קונים בפתיחה. יעד: +2% ממחיר הקנייה. סטופ: −2%. מה שלא נסגר — נמכר בסגירה של אותו יום. משווים גם ל-±1%/±3%/±4% (הכלל של
// השגרה היום) ולהחזקה עד הסגירה בלי סטופ ויעד (אותן כניסות בדיוק).
// נתונים: אותו מקור כמו research-xsec.mjs — Yahoo Finance יומי (מתואם), הרכב S&P 500 היסטורי. 5 השנים האחרונות. מניות שנמחקו ואין להן
//   מחירים — חסרות (הטיית שורדים). רק מניות שהיו ב-S&P 500 באותו יום, עם מחזור ממוצע של 100 מיליון דולר ביום לפחות (כמו בשגרת הבוקר).
// נרות יומיים לא מראים מה קרה קודם — הסטופ או היעד. לכן שתי הנחות: פסימית (באותו יום שניהם נגעו → הסטופ) ואופטימית (→ היעד).
//   הפסימית היא הקובעת; האופטימית היא גבול עליון. מודפס גם כמה ימים היו "גם וגם".
// אילו מניות קונים (בפתיחה, לפי מה שידוע בפתיחה בלבד):
//   all — כל המניות הכשירות (כמו בחירה אקראית) · gapUp5 — 5 המניות שפתחו הכי גבוה מול סגירת אתמול (כמו "העולות במסחר המוקדם")
//   · gapDn5 — 5 שפתחו הכי נמוך · calm5 — 5 אקראיות מתוך אלה שזזות בדרך כלל 2%–4% ביום (ATR14, כמו בשגרת הבוקר; זרע קבוע).
// עלויות: חצי מרווח בכניסה וביציאה (לפי מחזור, כמו research-xsec) + עמלה 0.01% בכל צד + החלקה נוספת 0.05% ביציאה בסטופ.
// סטטיסטיקה: על הרווח היומי של הסל (ממוצע המניות שנקנו באותו יום) — כך ימים עם הרבה מניות לא מנפחים את ה-t.
// הכרעה (נקבעה מראש): "שיטת 2%" טובה רק אם בהנחה הפסימית, אחרי עלויות, הרווח הממוצע ליום חיובי עם t ≥ 2 גם בחצי הראשון של 5 השנים
//   וגם בשני, וגבוה מהחזקה עד הסגירה באותן כניסות (הפרש עם t ≥ 2).
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BRACKETS = [0.01, 0.02, 0.03, 0.04], PICKS = ['all', 'gapUp5', 'gapDn5', 'calm5'], MIN_ADV = 1e8, YEARS = 5, FEE = 1e-4, STOP_SLIP = 5e-4, PER_TRADE = 10000;
export const PICK_HE = { all: 'כל המניות הגדולות (כמו בחירה אקראית)', gapUp5: '5 שפתחו הכי גבוה', gapDn5: '5 שפתחו הכי נמוך', calm5: '5 אקראיות שזזות 2%–4% ביום' };

// עסקה אחת מהפתיחה: b = רוחב הסטופ/היעד (null = החזקה עד הסגירה). hs = חצי מרווח. מחזיר תשואה נטו ו"גם וגם"
export function tradeRet(o, h, l, c, b, hs, pess = true){
  const cost = 2 * (hs + FEE);
  if (!(o > 0 && h > 0 && l > 0 && c > 0)) return null;
  if (b == null) return { r: c / o - 1 - cost, both: false, why: 'סגירה' };
  const hitS = l <= o * (1 - b), hitT = h >= o * (1 + b), both = hitS && hitT;
  if (hitS && (pess || !hitT)) return { r: -b - cost - STOP_SLIP, both, why: 'סטופ' };
  if (hitT) return { r: b - cost, both, why: 'יעד' };
  return { r: c / o - 1 - cost, both, why: 'סגירה' };
}
export function meanT(xs){
  const a = xs.filter(Number.isFinite), n = a.length; if (n < 2) return { n, mean: n ? a[0] : NaN, t: NaN };
  const m = a.reduce((s, x) => s + x, 0) / n, sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
  return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : NaN };
}
// בחירת המניות ביום k מתוך מועמדים [{ s, gap, atr }]
export function pick(cands, mode, rnd){
  if (mode === 'all') return cands;
  if (mode === 'gapUp5') return [...cands].sort((a, b) => b.gap - a.gap).slice(0, 5);
  if (mode === 'gapDn5') return [...cands].sort((a, b) => a.gap - b.gap).slice(0, 5);
  const calm = cands.filter((x) => x.atr >= 0.02 && x.atr <= 0.04);
  for (let i = calm.length - 1; i > 0; i--){ const j = Math.floor(rnd() * (i + 1)); [calm[i], calm[j]] = [calm[j], calm[i]]; }
  return calm.slice(0, 5);
}
export const lcg = (seed) => { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32; };

async function main(){
  const { universes, daily, build, dayIso, inIv, halfSpread } = await import('./research-xsec.mjs');
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUTDIR = arg('--outdir', 'bracket2-out'), log = (...a) => console.error(...a), t0 = Date.now();
  mkdirSync(OUTDIR, { recursive: true });
  const U = await universes();
  const since = new Date(Date.now() - (YEARS * 365.25 + 60) * 86400e3).toISOString().slice(0, 10);
  const hist = Object.entries(U.iv500).filter(([, ivs]) => ivs.some(([, b]) => b === null || b >= since)).map(([s]) => s).filter((s) => /^[A-Z]{1,5}(-[A-Z]{1,2})?$/.test(s));
  const syms = [...new Set(['SPY', 'QQQ', ...U.sp500, ...hist])];
  log(`fetching ${syms.length} symbols`); let raw = {}; const q = [...syms];
  await Promise.all(Array.from({ length: 8 }, async () => { for (let s; (s = q.shift());){ const b = await daily(s); if (b) raw[s] = b; await new Promise((r) => setTimeout(r, 60)); } }));
  if (!raw.SPY) throw new Error('אין נתוני SPY');
  const calT = raw.SPY.t, cal = Array.from(calT, dayIso), L = cal.length, S = build(raw, calT); raw = null;
  const start = new Date(Date.now() - YEARS * 365.25 * 86400e3).toISOString().slice(0, 10);
  const k0 = cal.findIndex((d) => d >= start), kMid = k0 + Math.floor((L - k0) / 2);
  log(`loaded ${Object.keys(S).length} · ${cal[k0]} → ${cal.at(-1)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const stocks = Object.keys(S).filter((s) => s !== 'SPY' && s !== 'QQQ');
  // מחזור ממוצע 20 יום ו-ATR14 באחוזים — עד אתמול בלבד
  const F = {};
  for (const s of stocks){
    const X = S[s], adv = new Float32Array(L).fill(NaN), atr = new Float32Array(L).fill(NaN);
    for (let k = Math.max(21, k0 - 1); k < L; k++){
      let a = 0, n = 0; for (let j = k - 20; j < k; j++) if (X.DV[j] >= 0){ a += X.DV[j]; n++; } if (n >= 15) adv[k] = a / n;
      let tr = 0, m = 0; for (let j = k - 14; j < k; j++){ if (!(X.H[j] > 0 && X.Lo[j] > 0 && X.C[j - 1] > 0)) continue; tr += Math.max(X.H[j] - X.Lo[j], Math.abs(X.H[j] - X.C[j - 1]), Math.abs(X.Lo[j] - X.C[j - 1])) / X.C[j - 1]; m++; }
      if (m >= 10) atr[k] = tr / m;
    }
    F[s] = { adv, atr };
  }
  const RULES = [null, ...BRACKETS], rk = (b) => (b == null ? 'hold' : `b${b * 100}`), RULE_HE = (b) => (b == null ? 'החזקה עד הסגירה' : `±${b * 100}%`);
  // R[pick][rule][pess] = מערך רווח יומי (ממוצע הסל) לכל יום; W = מספר העסקאות ו"גם וגם"
  const R = {}, W = {};
  for (const p of PICKS){ R[p] = {}; W[p] = {}; for (const b of RULES){ R[p][rk(b)] = { pess: new Float64Array(L).fill(NaN), opt: new Float64Array(L).fill(NaN) }; W[p][rk(b)] = { n: 0, both: 0, stop: 0, tgt: 0 }; } }
  const rnd = lcg(20261112);
  for (let k = k0; k < L; k++){
    const cands = [];
    for (const s of stocks){
      const X = S[s], f = F[s];
      if (!inIv(U.iv500[s], cal[k]) || !(f.adv[k] >= MIN_ADV) || !(X.O[k] > 0 && X.C[k - 1] > 0 && X.C[k] > 0)) continue;
      cands.push({ s, gap: X.O[k] / X.C[k - 1] - 1, atr: f.atr[k], hs: halfSpread(f.adv[k]) });
    }
    if (cands.length < 20) continue;
    for (const p of PICKS){
      const sel = pick(cands, p, rnd); if (!sel.length) continue;
      for (const b of RULES){
        let sp = 0, so = 0, n = 0; const w = W[p][rk(b)];
        for (const x of sel){
          const X = S[x.s], a = tradeRet(X.O[k], X.H[k], X.Lo[k], X.C[k], b, x.hs, true), o = tradeRet(X.O[k], X.H[k], X.Lo[k], X.C[k], b, x.hs, false);
          if (!a) continue; sp += a.r; so += o.r; n++; w.n++; if (a.both) w.both++; if (a.why === 'סטופ') w.stop++; if (a.why === 'יעד') w.tgt++;
        }
        if (n){ R[p][rk(b)].pess[k] = sp / n; R[p][rk(b)].opt[k] = so / n; }
      }
    }
  }
  log(`simulated ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const slice = (arr, a, z) => Array.from(arr.slice(a, z));
  const f$ = (x) => (Number.isFinite(x) ? (x < 0 ? '−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US') : '—'), fp = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%` : '—'), ft = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
  const md = [`# "שיטת 2 אחוז" — קונים בפתיחה, מוכרים ב+2% או ב−2% (${cal[k0]} → ${cal.at(-1)})`, '',
    'בקשת מאיר (12/11/2026): "שיטת 2 אחוז טובה? כשעולה 2 אחוז או יורדת מוכרים. בדוק 5 שנים אחרונות".', '',
    `- **השיטה:** קנייה בפתיחה; יעד +2%, סטופ −2% ממחיר הקנייה; מה שלא נסגר — בסגירה. השוואה ל-±1%/±3%/±4% ולהחזקה עד הסגירה (אותן כניסות).`,
    `- **מניות:** S&P 500 של אותו יום, מחזור ממוצע ≥ 100 מיליון דולר ביום. **עלויות:** מרווח, עמלה, והחלקה נוספת בסטופ. ${PER_TRADE.toLocaleString()}$ לעסקה.`,
    '- **נרות יומיים:** כשבאותו יום נגעו גם בסטופ וגם ביעד, אי אפשר לדעת מה קודם. **פסימי** (קובע) = הסטופ קודם · **אופטימי** (גבול עליון) = היעד קודם.',
    `- **הכרעה שנקבעה מראש:** טובה רק אם בהנחה הפסימית הרווח הממוצע ליום חיובי עם t ≥ 2 בשני חצאי התקופה (${cal[k0]} → ${cal[kMid - 1]} · ${cal[kMid]} → ${cal.at(-1)}), וגבוה מהחזקה עד הסגירה.`, ''];
  const verdicts = [];
  for (const p of PICKS){
    md.push(`## ${PICK_HE[p]}`, '', '| כלל | עסקאות | סטופ / יעד / סגירה | ימי "גם וגם" | ליום (פסימי) | t | חצי 1 | חצי 2 | ליום (אופטימי) | $ לעסקה (פסימי) | מול החזקה (t) |', '|---|---|---|---|---|---|---|---|---|---|---|');
    const hold = R[p].hold.pess;
    for (const b of RULES){
      const x = R[p][rk(b)], w = W[p][rk(b)], all = meanT(slice(x.pess, k0, L)), h1 = meanT(slice(x.pess, k0, kMid)), h2 = meanT(slice(x.pess, kMid, L)), op = meanT(slice(x.opt, k0, L));
      const diff = meanT(Array.from({ length: L - k0 }, (_, i) => x.pess[k0 + i] - hold[k0 + i]));
      const pass = b != null && h1.mean > 0 && h1.t >= 2 && h2.mean > 0 && h2.t >= 2 && diff.mean > 0 && diff.t >= 2;
      if (b != null) verdicts.push({ pick: p, rule: rk(b), pass, all, h1, h2, op, diff });
      const tot = w.n || 1;
      md.push(`| ${b === 0.02 ? '**±2%**' : RULE_HE(b)} | ${w.n.toLocaleString()} | ${b == null ? '—' : `${Math.round(100 * w.stop / tot)}% / ${Math.round(100 * w.tgt / tot)}% / ${Math.round(100 * (tot - w.stop - w.tgt) / tot)}%`} | ${b == null ? '—' : `${Math.round(100 * w.both / tot)}%`} | ${fp(all.mean, 3)} | ${ft(all.t)} | ${fp(h1.mean, 3)} | ${fp(h2.mean, 3)} | ${fp(op.mean, 3)} | ${f$(all.mean * PER_TRADE)} | ${b == null ? '—' : `${fp(diff.mean, 3)} (${ft(diff.t)})`} |`);
    }
    md.push('');
  }
  // לפי שנה — ±2% מול החזקה, כל המניות ו-5 שפתחו הכי גבוה
  const years = [...new Set(cal.slice(k0).map((d) => d.slice(0, 4)))];
  md.push('## לפי שנה — ±2% (פסימי) מול החזקה עד הסגירה, $ לעסקה', '', `| מניות | כלל | ${years.join(' | ')} |`, `|---|---|${years.map(() => '---').join('|')}|`);
  for (const p of PICKS) for (const b of [0.02, null]){
    const x = R[p][rk(b)].pess;
    md.push(`| ${PICK_HE[p]} | ${RULE_HE(b)} | ${years.map((y) => { const idx = []; for (let k = k0; k < L; k++) if (cal[k].startsWith(y)) idx.push(x[k]); return f$(meanT(idx).mean * PER_TRADE); }).join(' | ')} |`);
  }
  const two = verdicts.filter((v) => v.rule === 'b2'), passAny = verdicts.filter((v) => v.pass);
  md.push('', '## מסקנה', '',
    `- **±2%:** ${two.map((v) => `${PICK_HE[v.pick]}: ${f$(v.all.mean * PER_TRADE)} לעסקה (t ${ft(v.all.t)}), אופטימי ${f$(v.op.mean * PER_TRADE)}`).join(' · ')}.`,
    two.some((v) => v.pass) ? `- **הקריטריון:** ±2% עובר ב: ${two.filter((v) => v.pass).map((v) => PICK_HE[v.pick]).join(', ')}.` : '- **הקריטריון:** ±2% **לא עובר** באף אחת מדרכי הבחירה.',
    passAny.length ? `- **כללים אחרים שעוברים:** ${passAny.map((v) => `${PICK_HE[v.pick]} ${v.rule}`).join(', ')}.` : '- **אף כלל (±1%–±4%) לא עובר** — סטופ ויעד סימטריים לא יוצרים רווח; הם רק קובעים כמה מהר יוצאים. התוצאה תלויה במה שקונים, ובעלויות.');
  writeFileSync(`${OUTDIR}/report.md`, md.join('\n') + '\n');
  writeFileSync(`${OUTDIR}/meta.json`, JSON.stringify({ from: cal[k0], mid: cal[kMid], to: cal.at(-1), symbols: stocks.length, verdicts }, null, 1));
  log(`done ${((Date.now() - t0) / 1000).toFixed(0)}s`); console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
