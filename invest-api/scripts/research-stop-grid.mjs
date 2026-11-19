#!/usr/bin/env node
// איזה סטופ עדיף במניות — מחקר בלבד, אין פקודות ואין מפתחות. פרוטוקול נעול: invest/docs/research/stop-grid/PROTOCOL_v1.0.md
// בקשת מאיר (19/11/2026): "בדוק אסטרטגיה של סטופים במניות כמו שעשיתי עם 2.5. בדוק אלו סטופים עדיפים. תבחן כל אופציה, סקטור, זמנים".
// שימוש: node --max-old-space-size=6000 invest-api/scripts/research-stop-grid.mjs --outdir DIR
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const FEE = 1e-4, STOP_SLIP = 5e-4, PER_TRADE = 10000, PER_DAY = 20, MIN_ADV = 1e8, SEED = 20261120;
export const DEV = ['2010-01-01', '2019-01-01'], TEST = ['2019-01-01', '2099-01-01'];
export const SECTORS = ['XLK', 'XLF', 'XLE', 'XLV', 'XLI', 'XLP', 'XLY', 'XLU', 'XLB'];
export const SECTOR_HE = { XLK: 'טכנולוגיה', XLF: 'פיננסים', XLE: 'אנרגיה', XLV: 'בריאות', XLI: 'תעשייה', XLP: 'צריכה בסיסית', XLY: 'צריכה מחזורית', XLU: 'תשתיות', XLB: 'חומרים' };

// ---------- הכללים (נעולים בפרוטוקול, סעיף 4) ----------
const HS = [1, 5, 20];
export const RULES = Object.freeze([
  ...[1.5, 2, 2.5, 3, 4, 5].flatMap((w) => HS.map((H) => ({ k: `sym${w}-H${H}`, fam: 'sym', stop: w / 100, tgt: w / 100, H, he: `±${w}% · עד ${H} ימים` }))),
  ...[[2, 4], [2.5, 5], [2.5, 7.5], [3, 6]].flatMap(([s, t]) => HS.map((H) => ({ k: `asym${s}-${t}-H${H}`, fam: 'asym', stop: s / 100, tgt: t / 100, H, he: `סטופ ${s}% / יעד ${t}% · עד ${H} ימים` }))),
  ...[0.5, 1, 1.5, 2].flatMap((m) => HS.map((H) => ({ k: `atr${m}-H${H}`, fam: 'atr', stopAtr: m, tgtAtr: m, H, he: `±${m}×ATR · עד ${H} ימים` }))),
  ...HS.map((H) => ({ k: `atr1-2-H${H}`, fam: 'atr', stopAtr: 1, tgtAtr: 2, H, he: `סטופ 1×ATR / יעד 2×ATR · עד ${H} ימים` })),
  ...[1, 2].flatMap((m) => [5, 20].map((H) => ({ k: `trail${m}-H${H}`, fam: 'trail', trailAtr: m, H, he: `נגרר ${m}×ATR, בלי יעד · עד ${H} ימים` }))),
  ...[5, 20].map((H) => ({ k: `stoponly2.5-H${H}`, fam: 'stoponly', stop: 0.025, H, he: `סטופ 2.5% בלי יעד · עד ${H} ימים` })),
  ...HS.map((H) => ({ k: `hold-H${H}`, fam: 'base', H, he: `החזקה ${H} ימים בלי סטופ (קו בסיס)` })),
]);
export const MEIR = 'sym2.5-H20';

// עסקה אחת: קנייה בפתיחה של היום k. X = { O, H, Lo, C } (מערכים, ייתכנו NaN), atr = ATR14 באחוזים (שבר), hs = חצי מרווח.
// מחזיר { r: נטו, why: 'stop'|'target'|'time', days, gap: האם יצא בקפיצה }
export function simTrade(X, k, rule, atr, hs, pess = true){
  const { O, H: Hi, Lo, C } = X, L = C.length, e = O[k];
  if (!(e > 0)) return null;
  const sd = rule.stop ?? (rule.stopAtr != null ? rule.stopAtr * atr : null), td = rule.tgt ?? (rule.tgtAtr != null ? rule.tgtAtr * atr : null);
  if ((sd != null && !(sd > 0)) || (td != null && !(td > 0)) || (rule.trailAtr != null && !(atr > 0))) return null;
  let S = sd != null ? e * (1 - sd) : null; const T = td != null ? e * (1 + td) : null;
  let maxC = e, exit = null, why = 'time', days = 0, gap = false, last = k;
  for (let j = k; j < L && days < rule.H; j++){
    if (!(C[j] > 0 && Hi[j] > 0 && Lo[j] > 0 && O[j] > 0)) continue;
    days++; last = j;
    if (j > k){
      if (S != null && O[j] <= S){ exit = O[j]; why = 'stop'; gap = true; break; }
      if (T != null && O[j] >= T){ exit = O[j]; why = 'target'; gap = true; break; }
    }
    const hitS = S != null && Lo[j] <= S, hitT = T != null && Hi[j] >= T;
    if (hitS && (pess || !hitT)){ exit = S; why = 'stop'; break; }
    if (hitT){ exit = T; why = 'target'; break; }
    if (rule.trailAtr != null){ maxC = Math.max(maxC, C[j]); const ns = maxC * (1 - rule.trailAtr * atr); if (S == null || ns > S) S = ns; }
  }
  if (exit == null){ if (days === 0) return null; exit = C[last]; why = 'time'; }
  const r = exit / e - 1 - 2 * (hs + FEE) - (why === 'stop' ? STOP_SLIP : 0);
  return { r, why, days, gap };
}

export function rng(seed){ let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
export function meanT(xs){
  const a = xs.filter(Number.isFinite), n = a.length; if (n < 2) return { n, mean: n ? a[0] : NaN, t: NaN };
  const m = a.reduce((s, x) => s + x, 0) / n, sd = Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
  return { n, mean: m, t: sd > 0 ? m / (sd / Math.sqrt(n)) : NaN };
}
export const corr = (a, b) => {
  let n = 0, sa = 0, sb = 0; for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])){ n++; sa += a[i]; sb += b[i]; }
  if (n < 100) return NaN; const ma = sa / n, mb = sb / n; let c = 0, va = 0, vb = 0;
  for (let i = 0; i < a.length; i++) if (Number.isFinite(a[i]) && Number.isFinite(b[i])){ c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; }
  return va > 0 && vb > 0 ? c / Math.sqrt(va * vb) : NaN;
};
export const atrBucket = (a) => (a < 0.015 ? 0 : a <= 0.03 ? 1 : 2), gapBucket = (g) => (g < -0.01 ? 0 : g <= 0.01 ? 1 : 2);
export const ATR_HE = ['ATR < 1.5%', 'ATR 1.5%–3%', 'ATR > 3%'], GAP_HE = ['פתיחה ב-‎−1% ומטה', 'פתיחה ‎−1%..+1%', 'פתיחה ב-+1% ומעלה'], DOW_HE = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];

// סטטיסטיקה לקבוצת עסקאות של כלל: t על הממוצע היומי (לפי יום הכניסה)
export function ruleStats(trades, rk, filter = () => true){
  const byDay = new Map(); let n = 0, sum = 0, so = 0, win = 0, stop = 0, tgt = 0, days = 0, worst = Infinity, gaps = 0;
  for (const t of trades){
    if (!filter(t)) continue; const x = t.res[rk]; if (!x) continue;
    n++; sum += x.p; so += x.o; if (x.p > 0) win++; if (x.why === 1) stop++; if (x.why === 2) tgt++; days += x.d; worst = Math.min(worst, x.p); if (x.g) gaps++;
    const a = byDay.get(t.k) || [0, 0]; a[0] += x.p; a[1]++; byDay.set(t.k, a);
  }
  const mt = meanT([...byDay.values()].map(([s, c]) => s / c));
  return { n, mean: n ? sum / n : NaN, opt: n ? so / n : NaN, t: mt.t, win: n ? win / n : NaN, stop: n ? stop / n : NaN, tgt: n ? tgt / n : NaN, days: n ? days / n : NaN, worst, gaps: n ? gaps / n : NaN };
}
export function pairedVsBase(trades, rk, bk, filter = () => true){
  const byDay = new Map();
  for (const t of trades){ if (!filter(t)) continue; const x = t.res[rk], b = t.res[bk]; if (!x || !b) continue; const a = byDay.get(t.k) || [0, 0]; a[0] += x.p - b.p; a[1]++; byDay.set(t.k, a); }
  return meanT([...byDay.values()].map(([s, c]) => s / c));
}

async function main(){
  const { universes, daily, build, dayIso, inIv, halfSpread } = await import('./research-xsec.mjs');
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUTDIR = arg('--outdir', 'stop-grid-out'), log = (...a) => console.error(...a), t0 = Date.now();
  mkdirSync(OUTDIR, { recursive: true });
  const U = await universes();
  const hist = Object.entries(U.iv500).filter(([, ivs]) => ivs.some(([, b]) => b === null || b >= '2009-06-01')).map(([s]) => s).filter((s) => /^[A-Z]{1,5}(-[A-Z]{1,2})?$/.test(s));
  const syms = [...new Set(['SPY', ...SECTORS, ...U.sp500, ...hist])];
  log(`fetching ${syms.length} symbols`); let raw = {}; const q = [...syms];
  await Promise.all(Array.from({ length: 8 }, async () => { for (let s; (s = q.shift());){ const b = await daily(s); if (b) raw[s] = b; await new Promise((r) => setTimeout(r, 60)); } }));
  if (!raw.SPY || SECTORS.some((s) => !raw[s])) throw new Error('חסרים SPY או קרנות סקטור');
  const calT = raw.SPY.t, cal = Array.from(calT, dayIso), L = cal.length, S = build(raw, calT); raw = null;
  const k0 = cal.findIndex((d) => d >= DEV[0]), kEnd = L - 21; // רק כניסות עם 20 ימי מסחר אחריהן
  const stocks = Object.keys(S).filter((s) => s !== 'SPY' && !SECTORS.includes(s));
  log(`loaded ${stocks.length} stocks · ${cal[k0]} → ${cal[kEnd]} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const ret = (X) => { const r = new Float32Array(L).fill(NaN); for (let k = 1; k < L; k++) if (X.C[k] > 0 && X.C[k - 1] > 0) r[k] = X.C[k] / X.C[k - 1] - 1; return r; };
  const secR = Object.fromEntries(SECTORS.map((s) => [s, ret(S[s])]));
  // מחזור, ATR — עד אתמול; סקטור — לפי מתאם ב-252 הימים שלפני תחילת השנה
  const yearStart = [...new Set(cal.map((d) => d.slice(0, 4)))].map((y) => cal.findIndex((d) => d.startsWith(y)));
  const F = {};
  for (const s of stocks){
    const X = S[s], adv = new Float32Array(L).fill(NaN), atr = new Float32Array(L).fill(NaN), r = ret(X), sec = new Int8Array(L).fill(-1);
    for (let k = Math.max(21, k0 - 1); k < L; k++){
      let a = 0, n = 0; for (let j = k - 20; j < k; j++) if (X.DV[j] >= 0){ a += X.DV[j]; n++; } if (n >= 15) adv[k] = a / n;
      let tr = 0, m = 0; for (let j = k - 14; j < k; j++){ if (!(X.H[j] > 0 && X.Lo[j] > 0 && X.C[j - 1] > 0)) continue; tr += Math.max(X.H[j] - X.Lo[j], Math.abs(X.H[j] - X.C[j - 1]), Math.abs(X.Lo[j] - X.C[j - 1])) / X.C[j - 1]; m++; }
      if (m >= 10) atr[k] = tr / m;
    }
    for (let yi = 0; yi < yearStart.length; yi++){
      const ys = yearStart[yi], ye = yearStart[yi + 1] ?? L; if (ys < 252) continue;
      const a = r.slice(ys - 252, ys); let best = -1, bc = -2;
      SECTORS.forEach((e, i) => { const c = corr(a, secR[e].slice(ys - 252, ys)); if (c > bc){ bc = c; best = i; } });
      sec.fill(best, ys, ye);
    }
    F[s] = { adv, atr, sec };
  }
  const R = rng(SEED), trades = [], WHY = { stop: 1, target: 2, time: 0 };
  for (let k = k0; k <= kEnd; k++){
    const cands = [];
    for (const s of stocks){
      const X = S[s], f = F[s];
      if (!inIv(U.iv500[s], cal[k]) || !(f.adv[k] >= MIN_ADV) || !(X.O[k] > 0 && X.C[k - 1] > 0) || !(f.atr[k] > 0)) continue;
      cands.push(s);
    }
    if (cands.length < PER_DAY) continue;
    for (let i = cands.length - 1; i > 0; i--){ const j = Math.floor(R() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
    for (const s of cands.slice(0, PER_DAY)){
      const X = S[s], f = F[s], hs = halfSpread(f.adv[k]), res = {};
      for (const rule of RULES){
        const p = simTrade(X, k, rule, f.atr[k], hs, true), o = simTrade(X, k, rule, f.atr[k], hs, false);
        if (p && o) res[rule.k] = { p: p.r, o: o.r, why: WHY[p.why], d: p.days, g: p.gap };
      }
      trades.push({ k, s, d: cal[k], sec: f.sec[k], atrB: atrBucket(f.atr[k]), gapB: gapBucket(X.O[k] / X.C[k - 1] - 1), dow: new Date(cal[k] + 'T00:00:00Z').getUTCDay(), y: cal[k].slice(0, 4), res });
    }
  }
  log(`simulated ${trades.length} entries · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const inDev = (t) => t.d >= DEV[0] && t.d < DEV[1], inTest = (t) => t.d >= TEST[0] && t.d < TEST[1];
  const base = (rule) => `hold-H${rule.H}`;
  const rows = RULES.map((rule) => {
    const a = ruleStats(trades, rule.k), dv = ruleStats(trades, rule.k, inDev), ts = ruleStats(trades, rule.k, inTest);
    const pd = rule.fam === 'base' ? null : pairedVsBase(trades, rule.k, base(rule), inDev), pt = rule.fam === 'base' ? null : pairedVsBase(trades, rule.k, base(rule), inTest);
    const edge = rule.fam !== 'base' && dv.mean > 0 && dv.t >= 3 && ts.mean > 0 && ts.t >= 3 && pd.mean > 0 && pd.t >= 3 && pt.mean > 0 && pt.t >= 3;
    return { rule, a, dv, ts, pd, pt, edge };
  });
  const top3 = rows.filter((x) => x.rule.fam !== 'base').sort((x, y) => y.dv.mean - x.dv.mean).slice(0, 3);
  const f$ = (x) => (Number.isFinite(x) ? (x < 0 ? '‎−' : '+') + '$' + Math.abs(x * PER_TRADE).toFixed(0) : '—'), fp = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—'), ft = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—');
  const md = [`# איזה סטופ עדיף במניות — ${cal[k0]} → ${cal[kEnd]}`, '', 'פרוטוקול נעול: [`PROTOCOL_v1.0.md`](PROTOCOL_v1.0.md). הרצה אחת. 20 כניסות אקראיות ביום בפתיחה, S&P 500 עם מחזור ≥ 100M$, 10,000$ לעסקה, עלויות מלאות.', '',
    `${trades.length.toLocaleString()} כניסות. פיתוח ${DEV[0]}→2018 · מבחן 2019→. "$ לעסקה" = נטו על 10,000$, פסימי (קובע); אופטימי = גבול עליון.`, '',
    '## 1. כל הכללים', '', '| כלל | $ לעסקה | t | פיתוח | מבחן | אופטימי | הצלחה | סטופ / יעד / זמן | ימים | קפיצה | הפסד מקס׳ | מול בסיס פיתוח (t) | מול בסיס מבחן (t) | יתרון |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const x of rows){
    const r = x.rule, a = x.a, b = r.k === MEIR ? `**${r.he}** (כמו מאיר)` : r.he;
    md.push(`| ${b} | ${f$(a.mean)} | ${ft(a.t)} | ${f$(x.dv.mean)} | ${f$(x.ts.mean)} | ${f$(a.opt)} | ${fp(a.win)} | ${r.fam === 'base' ? '—' : `${fp(a.stop)} / ${fp(a.tgt)} / ${fp(1 - a.stop - a.tgt)}`} | ${a.days.toFixed(1)} | ${fp(a.gaps)} | ${f$(a.worst)} | ${x.pd ? `${f$(x.pd.mean)} (${ft(x.pd.t)})` : '—'} | ${x.pt ? `${f$(x.pt.mean)} (${ft(x.pt.t)})` : '—'} | ${x.edge ? '✅' : '—'} |`);
  }
  md.push('', '## 2. שלושת הטובים בפיתוח — ותוצאתם במבחן', '', '| כלל | פיתוח | מבחן | מבחן מול בסיס (t) |', '|---|---|---|---|');
  for (const x of top3) md.push(`| ${x.rule.he} | ${f$(x.dv.mean)} | ${f$(x.ts.mean)} | ${f$(x.pt.mean)} (${ft(x.pt.t)}) |`);
  const focus = [...new Set([MEIR, 'sym2-H1', ...top3.map((x) => x.rule.k)])], RK = Object.fromEntries(RULES.map((r) => [r.k, r]));
  const slice = (title, keys, pred, label) => {
    md.push('', `## ${title}`, '', `| ${label} | ${focus.map((k) => RK[k].he).join(' | ')} | ${focus.map((k) => `בסיס H${RK[k].H}`).filter((v, i, a) => a.indexOf(v) === i).join(' | ')} |`, `|---|${focus.map(() => '---').join('|')}|${[...new Set(focus.map((k) => RK[k].H))].map(() => '---').join('|')}|`);
    for (const key of keys){
      const cells = focus.map((k) => { const d = ruleStats(trades, k, (t) => pred(t, key) && inDev(t)), s = ruleStats(trades, k, (t) => pred(t, key) && inTest(t)); return `${f$(d.mean)} / ${f$(s.mean)}`; });
      const bases = [...new Set(focus.map((k) => RK[k].H))].map((H) => { const d = ruleStats(trades, `hold-H${H}`, (t) => pred(t, key) && inDev(t)), s = ruleStats(trades, `hold-H${H}`, (t) => pred(t, key) && inTest(t)); return `${f$(d.mean)} / ${f$(s.mean)}`; });
      md.push(`| ${key.he} | ${cells.join(' | ')} | ${bases.join(' | ')} |`);
    }
  };
  md.push('', 'בטבלאות הפילוח: **פיתוח / מבחן**, $ לעסקה (פסימי).');
  slice('3. לפי סקטור', SECTORS.map((e, i) => ({ i, he: `${SECTOR_HE[e]} (${e})` })), (t, x) => t.sec === x.i, 'סקטור');
  slice('4. לפי תנודתיות (ATR14)', ATR_HE.map((he, i) => ({ i, he })), (t, x) => t.atrB === x.i, 'תנודתיות');
  slice('5. לפי פער פתיחה', GAP_HE.map((he, i) => ({ i, he })), (t, x) => t.gapB === x.i, 'פער');
  slice('6. לפי יום בשבוע', [1, 2, 3, 4, 5].map((i) => ({ i, he: `יום ${DOW_HE[i]}` })), (t, x) => t.dow === x.i, 'יום');
  const years = [...new Set(trades.map((t) => t.y))];
  md.push('', '## 7. לפי שנה — $ לעסקה', '', `| כלל | ${years.join(' | ')} |`, `|---|${years.map(() => '---').join('|')}|`);
  for (const k of [...focus, 'hold-H1', 'hold-H5', 'hold-H20']) md.push(`| ${RK[k].he} | ${years.map((y) => f$(ruleStats(trades, k, (t) => t.y === y).mean)).join(' | ')} |`);
  const edges = rows.filter((x) => x.edge);
  md.push('', '## הכרעה', '', edges.length ? `**יש יתרון (לכל היותר INCONCLUSIVE בגלל הטיית שורדים):** ${edges.map((x) => x.rule.he).join(' · ')}.` : '**`FAIL`** — אף סטופ לא יוצר רווח מובהק בכניסה אקראית, גם לא מול החזקה בלי סטופ, בשתי התקופות.');
  writeFileSync(`${OUTDIR}/report.md`, md.join('\n') + '\n');
  writeFileSync(`${OUTDIR}/rules.csv`, ['rule,he,fam,H,n,mean,t,dev,test,opt,win,stop,tgt,days,gaps,worst,vsBaseDev,vsBaseDevT,vsBaseTest,vsBaseTestT,edge', ...rows.map((x) => [x.rule.k, `"${x.rule.he}"`, x.rule.fam, x.rule.H, x.a.n, x.a.mean, x.a.t, x.dv.mean, x.ts.mean, x.a.opt, x.a.win, x.a.stop, x.a.tgt, x.a.days, x.a.gaps, x.a.worst, x.pd?.mean ?? '', x.pd?.t ?? '', x.pt?.mean ?? '', x.pt?.t ?? '', x.edge].join(','))].join('\n') + '\n');
  writeFileSync(`${OUTDIR}/meta.json`, JSON.stringify({ from: cal[k0], to: cal[kEnd], entries: trades.length, stocks: stocks.length, top3: top3.map((x) => x.rule.k), edges: edges.map((x) => x.rule.k) }, null, 1));
  log(`done ${((Date.now() - t0) / 1000).toFixed(0)}s`); console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
