#!/usr/bin/env node
// מחקר: "איזה מניות בדרך כלל עולות כשאנבידיה צונחת" (בקשת מאיר, 12/11/2026, אחרי ירידה של כ-6% באנבידיה בלילה). מחקר בלבד — אין כסף, אין פקודות.
//
// נתונים: אותו מקור כמו research-xsec.mjs — Yahoo Finance (יומי, מתואם לפיצולים ודיבידנדים), הרכב S&P 500 היסטורי, וקרנות:
//   שוק, ענפים, שבבים, זהב, אגרות חוב, דולר, מדד הפחד וקרנות הפוכות. 2007 → היום. מניות שנמחקו ואין להן מחירים — חסרות (הטיית שורדים).
// יום צניחה: תשואת אנבידיה מסגירה לסגירה ≤ −θ (3% / 5% / 8%). שלושה סוגים:
//   any — כל צניחה · own — צניחה של אנבידיה כשהשוק (SPY) ירד פחות מ-1% (בעיה של החברה, כמו הלילה) · market — כשגם השוק ירד 1%+.
// מה מודדים, לכל מניה או קרן (רק מניות שהיו ב-S&P 500 באותו יום, עם מחזור של 10 מיליון דולר ביום לפחות):
//   (א) באותו יום (סגירה של אתמול → סגירה של היום): התשואה, ואחוז הימים שבהם עלתה. תיאורי בלבד — אי אפשר לדעת מראש שאנבידיה תצנח.
//   (ב) בימים שאחרי — מה שאפשר באמת לעשות: קנייה בפתיחה של מחרת, מכירה בסגירה אחרי 1 / 3 / 5 ימים. תשואה עודפת מעל SPY (אותה כניסה
//       ויציאה), אחרי עלות של 0.10% לעסקה הלוך ושוב.
// חלוקה: פיתוח 2008–2018, מבחן 2019 → היום.
// הכרעה (נקבעה מראש): מניה או קרן "עולה באמת אחרי צניחה של אנבידיה" רק אם בכניסה בפתיחה של מחרת, אחרי עלויות, התשואה העודפת חיובית
//   עם t ≥ 2 גם בפיתוח וגם במבחן (לפחות 15 אירועים בכל תקופה). מודפס גם כמה מניות היו עוברות במקרה, לפי מספר המניות שנבדקו.
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const DEV_END = '2018-12-31', SIG_START = '2008-01-02', COST = 0.001, MIN_ADV = 1e7, MIN_EV = 15;
export const ETF = ['SPY', 'QQQ', 'SMH', 'SOXX', 'XLK', 'XLC', 'XLY', 'XLI', 'XLF', 'XLE', 'XLB', 'XLP', 'XLV', 'XLU', 'XLRE', 'GLD', 'TLT', 'IEF', 'UUP', 'SH', 'PSQ', 'SOXS', 'VIXY'];
export const ETF_HE = { SPY: 'השוק (500 הגדולות)', QQQ: 'נאסד״ק 100', SMH: 'קרן שבבים', SOXX: 'קרן שבבים 2', XLK: 'טכנולוגיה', XLC: 'תקשורת', XLY: 'צריכה מחזורית',
  XLI: 'תעשייה', XLF: 'פיננסים', XLE: 'אנרגיה', XLB: 'חומרים', XLP: 'צריכה בסיסית', XLV: 'בריאות', XLU: 'תשתיות', XLRE: 'נדל״ן', GLD: 'זהב', TLT: 'אג״ח ארוכות',
  IEF: 'אג״ח בינוניות', UUP: 'הדולר', SH: 'הפוכה לשוק', PSQ: 'הפוכה לנאסד״ק', SOXS: 'הפוכה לשבבים פי 3', VIXY: 'מדד הפחד' };
export const NAMES_HE = { NVDA: 'אנבידיה', AMD: 'אי־אם־די', INTC: 'אינטל', AVGO: 'ברודקום', MU: 'מיקרון', QCOM: 'קוואלקום', TSM: 'טאיוואן סמיקונדקטור', MRVL: 'מרוול',
  AAPL: 'אפל', MSFT: 'מיקרוסופט', GOOGL: 'גוגל', AMZN: 'אמזון', META: 'מטא', TSLA: 'טסלה' };
export const THS = [0.03, 0.05, 0.08], MODES = ['any', 'own', 'market'], HS = [1, 3, 5];
export const MODE_HE = { any: 'כל צניחה', own: 'צניחה של אנבידיה בלבד (השוק ירד פחות מ-1%)', market: 'צניחה יחד עם השוק (השוק ירד 1%+)' };

const r1 = (C, k) => (C[k] > 0 && C[k - 1] > 0 ? C[k] / C[k - 1] - 1 : NaN);
// ימי הצניחה: אינדקסים k ≥ k0 שבהם אנבידיה ירדה לפחות th, לפי סוג
export function crashDays(nv, spy, L, k0, th, mode){
  const out = [];
  for (let k = Math.max(1, k0); k < L; k++){
    const r = r1(nv.C, k), m = r1(spy.C, k); if (!(r <= -th) || !Number.isFinite(m)) continue;
    if (mode === 'own' && !(m > -0.01)) continue; if (mode === 'market' && !(m <= -0.01)) continue; out.push(k);
  }
  return out;
}
// תשואת עסקה: 'same' = סגירה k−1 → סגירה k; אחרת פתיחה k+1 → סגירה k+H (NaN אם חסר)
export function tradeRet(X, k, H){
  if (H === 'same') return r1(X.C, k);
  const o = X.O[k + 1], c = X.C[k + H]; return o > 0 && c > 0 ? c / o - 1 : NaN;
}
// סטטיסטיקה לאירועים: ממוצע, t, אחוז חיוביים. xs: מערך מספרים
export function stat(xs){
  const v = xs.filter(Number.isFinite), n = v.length; if (!n) return { n: 0, mean: NaN, t: NaN, up: NaN };
  const m = v.reduce((a, b) => a + b, 0) / n, sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : NaN;
  return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : NaN, up: v.filter((x) => x > 0).length / n };
}
// לכל מניה: תשואות (ותשואות עודפות מעל SPY, אחרי עלות לעסקאות שאחרי) באירועים, מחולקות לפיתוח/מבחן לפי kDev
export function measure(X, spy, days, H, kDev, eligible = () => true){
  const raw = { dev: [], test: [] }, ex = { dev: [], test: [] };
  for (const k of days){
    if (!eligible(k)) continue; const r = tradeRet(X, k, H), m = tradeRet(spy, k, H); if (!Number.isFinite(r) || !Number.isFinite(m)) continue;
    const p = k <= kDev ? 'dev' : 'test'; raw[p].push(r); ex[p].push(H === 'same' ? r - m : r - m - COST);
  }
  const all = (o) => [...o.dev, ...o.test];
  return { raw: { dev: stat(raw.dev), test: stat(raw.test), all: stat(all(raw)) }, ex: { dev: stat(ex.dev), test: stat(ex.test), all: stat(all(ex)) } };
}
export const passes = (m) => m.ex.dev.n >= MIN_EV && m.ex.test.n >= MIN_EV && m.ex.dev.mean > 0 && m.ex.test.mean > 0 && m.ex.dev.t >= 2 && m.ex.test.t >= 2;

const pc = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%` : '—');
const pu = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—');
const tt = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const nm = (s) => ETF_HE[s] || NAMES_HE[s] || s;

async function main(){
  const { universes, daily, build, dayIso, inIv } = await import('./research-xsec.mjs');
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUTDIR = arg('--outdir', 'nvda-drops-out'), log = (...a) => console.error(...a), t0 = Date.now();
  mkdirSync(OUTDIR, { recursive: true });
  const U = await universes();
  const hist = Object.entries(U.iv500).filter(([, ivs]) => ivs.some(([, b]) => b === null || b >= '2007-01-01')).map(([s]) => s).filter((s) => /^[A-Z]{1,5}(-[A-Z]{1,2})?$/.test(s));
  const syms = [...new Set(['NVDA', ...ETF, ...U.sp500, ...hist])];
  log(`fetching ${syms.length} symbols`); let raw = {}; const q = [...syms];
  await Promise.all(Array.from({ length: 8 }, async () => { for (let s; (s = q.shift());){ const b = await daily(s); if (b) raw[s] = b; await new Promise((r) => setTimeout(r, 60)); } }));
  if (!raw.SPY || !raw.NVDA) throw new Error('אין נתוני SPY / NVDA');
  const calT = raw.SPY.t, cal = Array.from(calT, dayIso), L = cal.length, S = build(raw, calT); raw = null;
  const k0 = cal.findIndex((d) => d >= SIG_START), kDev = cal.findIndex((d) => d > DEV_END) - 1;
  log(`loaded ${Object.keys(S).length} · ${cal[0]} → ${cal.at(-1)} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const etfSet = new Set(ETF), stocks = Object.keys(S).filter((s) => !etfSet.has(s) && s !== 'SPY');
  const adv = (X) => { const a = new Float32Array(L).fill(NaN); for (let k = 20; k < L; k++){ let s = 0, n = 0; for (let j = k - 20; j < k; j++) if (X.DV[j] >= 0){ s += X.DV[j]; n += 1; } if (n >= 15) a[k] = s / n; } return a; };
  const elig = Object.fromEntries(stocks.map((s) => { const a = adv(S[s]), iv = U.iv500[s]; return [s, (k) => (s === 'NVDA' || inIv(iv, cal[k])) && a[k] >= MIN_ADV]; }));

  const md = [], csv = ['th,mode,H,sym,n_dev,n_test,mean_dev,mean_test,t_dev,t_test,up_dev,up_test,raw_mean_all,raw_up_all'], meta = { cal: [cal[0], cal.at(-1)], kDev: cal[kDev], counts: {}, pass: {} };
  md.push('# כשאנבידיה צונחת — מי עולה? (2008 → היום)', '');
  md.push('בקשת מאיר (12/11/2026): "איזה מניות בדרך כלל עולות כשאנבידיה צונחת — תבדוק היסטורית".', '');
  md.push(`- **ימי צניחה:** אנבידיה ירדה ${THS.map((x) => `${x * 100}%`).join(' / ')} ומעלה ביום (סגירה לסגירה). ${MODES.map((m) => `**${m === 'any' ? 'כל צניחה' : m === 'own' ? 'רק של אנבידיה' : 'יחד עם השוק'}**`).join(' · ')}.`);
  md.push('- **באותו יום:** תיאורי בלבד (אי אפשר לדעת מראש). **בימים שאחרי:** קנייה בפתיחה של מחרת, מכירה אחרי 1/3/5 ימים — תשואה עודפת מעל השוק, אחרי עלות 0.10%.');
  md.push(`- **תקופות:** פיתוח ${cal[k0]} → ${DEV_END}, מבחן 2019 → ${cal.at(-1)}. **הכרעה שנקבעה מראש:** עודף חיובי עם t ≥ 2 בשתי התקופות (לפחות ${MIN_EV} אירועים בכל אחת).`, '');

  md.push('## 1. כמה ימי צניחה היו', '| ירידה של | כל צניחה | רק של אנבידיה | יחד עם השוק |', '|---|---|---|---|');
  const D = {}; for (const th of THS){ D[th] = {}; for (const mode of MODES){ D[th][mode] = crashDays(S.NVDA, S.SPY, L, k0, th, mode); meta.counts[`${th}-${mode}`] = D[th][mode].length; } md.push(`| ${th * 100}%+ | ${D[th].any.length} | ${D[th].own.length} | ${D[th].market.length} |`); }
  md.push('', `הלילה (11/11/2026, אחרי הסגירה): ירידה של כ-6% בלי ירידה בשוק — כלומר סוג "רק של אנבידיה".`, '');

  const universe = [...ETF.filter((s) => S[s]), ...stocks];
  const M = {}; // M[th][mode][H][sym]
  for (const th of THS){ M[th] = {}; for (const mode of MODES){ M[th][mode] = {}; for (const H of ['same', ...HS]){ const o = (M[th][mode][H] = {}); for (const s of universe){ const m = measure(S[s], S.SPY, D[th][mode], H, kDev, etfSet.has(s) ? () => true : elig[s]); if (m.raw.all.n) o[s] = m; const e = m.ex; csv.push([th, mode, H, s, e.dev.n, e.test.n, e.dev.mean, e.test.mean, e.dev.t, e.test.t, e.dev.up, e.test.up, m.raw.all.mean, m.raw.all.up].map((x) => (typeof x === 'number' ? +x.toFixed(5) : x)).join(',')); } } } }
  log(`measured ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  const TH = 0.05;
  for (const mode of ['own', 'any']){
    const same = M[TH][mode].same;
    md.push(`## ${mode === 'own' ? '2' : '3'}. באותו יום — ירידה של 5%+ (${MODE_HE[mode]})`, '');
    if (mode === 'own') md.push('שימו לב: בסוג הזה השוק לפי ההגדרה ירד פחות מ-1%, ולכן הרבה מניות "עולות" רק כי השוק עלה. העמודה "מול השוק" היא המדד הנכון.', '');
    md.push('### קרנות ומניות מרכזיות', '| | עלתה באותו יום (אחוז הימים) | תשואה ממוצעת באותו יום | מול השוק | אירועים |', '|---|---|---|---|---|');
    for (const s of [...ETF, 'AMD', 'INTC', 'AVGO', 'MU', 'QCOM', 'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'META', 'TSLA'].filter((x) => same[x])){ const m = same[s]; md.push(`| ${nm(s)} (${s}) | ${pu(m.raw.all.up)} | ${pc(m.raw.all.mean)} | ${pc(m.ex.all.mean)} | ${m.raw.all.n} |`); }
    md.push('', '### המניות שעלו הכי הרבה פעמים באותו יום (מ-S&P 500, לפחות 20 אירועים)', '| מניה | עלתה (פיתוח) | עלתה (מבחן) | עלתה (הכול) | תשואה ממוצעת | אירועים |', '|---|---|---|---|---|---|');
    const top = stocks.filter((s) => same[s] && same[s].raw.all.n >= 20).sort((a, b) => same[b].raw.all.up - same[a].raw.all.up).slice(0, 25);
    for (const s of top){ const m = same[s]; md.push(`| ${nm(s)} (${s}) | ${pu(m.raw.dev.up)} | ${pu(m.raw.test.up)} | **${pu(m.raw.all.up)}** | ${pc(m.raw.all.mean)} | ${m.raw.all.n} |`); }
    md.push('');
  }

  md.push('## 4. בימים שאחרי — מה אפשר באמת לעשות (קנייה בפתיחה של מחרת, עודף מעל השוק אחרי עלויות)', '');
  for (const mode of ['own', 'any']){
    md.push(`### ירידה של 5%+ — ${MODE_HE[mode]}`, '| | 1 יום: פיתוח / מבחן (t) | 3 ימים: פיתוח / מבחן (t) | 5 ימים: פיתוח / מבחן (t) |', '|---|---|---|---|');
    for (const s of ['NVDA', 'AMD', 'INTC', 'AVGO', 'MU', 'SMH', 'QQQ', 'XLP', 'XLV', 'XLU', 'GLD', 'TLT', 'SOXS'].filter((x) => M[TH][mode][1][x])){
      md.push(`| ${nm(s)} (${s}) | ${HS.map((H) => { const e = M[TH][mode][H][s]?.ex; return e ? `${pc(e.dev.mean)} / ${pc(e.test.mean)} (${tt(e.dev.t)} / ${tt(e.test.t)})` : '—'; }).join(' | ')} |`);
    }
    md.push('');
  }
  md.push('## 5. ההכרעה — מי עבר (עודף חיובי עם t ≥ 2 בפיתוח ובמבחן)', '| ירידה | סוג | ימים | נבדקו | עברו | צפוי במקרה (בערך) | מי |', '|---|---|---|---|---|---|---|');
  for (const th of THS) for (const mode of MODES) for (const H of HS){
    const o = M[th][mode][H], tested = Object.keys(o).filter((s) => o[s].ex.dev.n >= MIN_EV && o[s].ex.test.n >= MIN_EV), ok = tested.filter((s) => passes(o[s]));
    meta.pass[`${th}-${mode}-${H}`] = ok; md.push(`| ${th * 100}%+ | ${mode === 'any' ? 'כל צניחה' : mode === 'own' ? 'רק של אנבידיה' : 'יחד עם השוק'} | ${H} | ${tested.length} | **${ok.length}** | ${(tested.length * 0.023 * 0.023).toFixed(1)} | ${ok.slice(0, 8).map((s) => nm(s)).join(', ') || '—'} |`);
  }
  md.push('', '"צפוי במקרה": אם אין שום קשר, כ-2.3% מהמניות יעברו t ≥ 2 בכל תקופה, ולכן בשתי התקופות יחד בערך 0.05% מהן.');
  writeFileSync(`${OUTDIR}/report.md`, md.join('\n') + '\n'); writeFileSync(`${OUTDIR}/results.csv`, csv.join('\n') + '\n'); writeFileSync(`${OUTDIR}/meta.json`, JSON.stringify(meta, null, 1));
  console.log(md.join('\n')); log(`done ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
