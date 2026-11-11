#!/usr/bin/env node
// מחקר: "המפגרות בסקטור שעולה" (בקשת מאיר, 11/11/2026). מחקר בלבד — אין כסף, אין פקודות.
// השאלה, במילים של מאיר: "אם יש עלייה בסקטור מסוים, ולא כולם עולים ... האם נכון לשים את הכסף על מניות שלא עלו בכלל או שירדו
// ביום שהסקטור עולה?" — כמו בבוקר של 11/11, כשמניות הטכנולוגיה עלו 2%–7% ורק מעטות נשארו במקום או ירדו.
//
// נתונים: אותו מקור כמו research-xsec.mjs — Yahoo Finance (יומי, מתואם לפיצולים ודיבידנדים), הרכב S&P 500 היסטורי
//   (github.com/fja05680/sp500 + ויקיפדיה), 11 קרנות הסקטור של SPDR. 2007 → היום. מניות שנמחקו ואין להן מחירים חסרות (הטיית שורדים;
//   הכיסוי מודפס לכל שנה). הטיה כזו מיטיבה דווקא עם קניית מפגרות — לכן ההשוואה העיקרית היא מול בחירה אקראית מאותו סקטור באותו יום.
// סקטור לכל מניה: לפי המתאם הגבוה ביותר של התשואה העודפת שלה (מעל SPY) עם התשואה העודפת של קרן הסקטור, ב-252 הימים שלפני כל שנה
//   (בלי מידע עתידי; מחושב מחדש כל שנה; רק קרנות שכבר קיימות). התאמה ל-GICS הנוכחי (ויקיפדיה) מודפסת כבדיקת שפיות.
// האות (ביום k, מנתוני סגירה של k בלבד): קרן הסקטור עלתה ≥ θ (0.5% / 1% / 2%), ובסקטור יש לפחות 8 מניות זכאיות.
//   בחירה מתוך המניות של הסקטורים שעלו:
//     FELL — מניות שירדו ביום k (הכי הרבה קודם) · LAG — התשואה הנמוכה ביחס לקרן (ירדו או עלו מעט) · LEAD — המובילות (ההפך)
//     RAND — בחירה אקראית מאותם סקטורים באותו יום (קבוצת הביקורת: "כמה מגיע בלי שום בחירה").
//   ביקורות נוספות: ANY-LAG — המפגרות בסקטור בכל יום (בלי תנאי עלייה) — כדי לבדוק אם תנאי "הסקטור עולה" מוסיף משהו על היפוך קצר
//   רגיל; DN100-LAG — המפגרות בסקטור שירד 1%+.
// כניסה: (א) בפתיחה של k+1 (מציאותי — כמו research-xsec); (ב) בסגירה של k (פקודת MOC, בהנחה שהאות ידוע דקות לפני הסגירה —
//   אופטימי). יציאה: בסגירה של k+H, ‏H ∈ {1, 2, 5, 10}.
// מדדים: (1) מחקר אירועים — תשואה עודפת לכל יום אות, מול הממוצע השווה של כל המניות בסקטורים שעלו (אותה כניסה ויציאה), אחרי
//   עלויות, עם t לפי ימים; (2) תיק של 50,000$ (simulate של research-xsec: עמלות IBKR, חצי מרווח לפי מחזור, H תיקי-משנה מדורגים).
// חלוקה: פיתוח 2008–2018, מבחן 2019 → היום (כמו research-xsec).
// הכרעה (נקבעה מראש): FELL/LAG "עובדת" רק אם בכניסה מציאותית (פתיחה) ואחרי עלויות — התשואה העודפת מול ממוצע הסקטור חיובית עם
//   t ≥ 2 גם בפיתוח וגם במבחן, ובתיק — CAGR גבוה מבחירה אקראית (RAND) גם בפיתוח וגם במבחן.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { universes, daily, build, dayIso, simulate, stats, TOPK, inIv, halfSpread } from './research-xsec.mjs';

const START_USD = 50000, SIG_START = '2008-01-02', DEV_END = '2018-12-31', MINM = 8, MIN_ADV = 1e7;
const log = (...a) => console.error(...a);
export const SECT = ['XLB', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLU', 'XLV', 'XLY', 'XLRE', 'XLC'];
export const SECT_HE = { XLB: 'חומרים', XLE: 'אנרגיה', XLF: 'פיננסים', XLI: 'תעשייה', XLK: 'טכנולוגיה', XLP: 'צריכה בסיסית', XLU: 'תשתיות', XLV: 'בריאות', XLY: 'צריכה מחזורית', XLRE: 'נדל״ן', XLC: 'תקשורת' };
const GICS = { 'Information Technology': 'XLK', 'Health Care': 'XLV', Financials: 'XLF', 'Consumer Discretionary': 'XLY', 'Communication Services': 'XLC', Industrials: 'XLI', 'Consumer Staples': 'XLP', Energy: 'XLE', Utilities: 'XLU', 'Real Estate': 'XLRE', Materials: 'XLB' };

// ---------- GICS מוויקיפדיה (רק לבדיקת שפיות של שיוך הסקטורים) ----------
const strip = (h) => h.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#160;|&nbsp;/g, ' ').trim();
export function parseGics(html){
  const out = new Map(), i = html.indexOf('id="constituents"'), t = i >= 0 ? html.slice(i, html.indexOf('</table>', i)) : html;
  for (const row of t.split('<tr').slice(1)){
    const c = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => strip(m[1]));
    const sym = c.find((x) => /^[A-Z]{1,5}([.\-][A-Z]{1,2})?$/.test(x)), sec = c.map((x) => GICS[x]).find(Boolean);
    if (sym && sec) out.set(sym.replace('.', '-'), sec);
  }
  return out;
}

// ---------- שיוך סקטור לפי מתאם (בלי מידע עתידי) ----------
// xs: תשואות עודפות של המניה; es: לכל קרן — תשואות עודפות באותם ימים (NaN = חסר). מחזיר אינדקס הקרן או -1
export function bestSector(xs, es, minN = 200, minCorr = 0.15){
  let best = -1, bc = minCorr;
  es.forEach((e, j) => {
    if (!e) return; let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < xs.length; i++){ const x = xs[i], y = e[i]; if (!Number.isFinite(x) || !Number.isFinite(y)) continue; n += 1; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; }
    if (n < minN) return; const cov = sxy / n - (sx / n) * (sy / n), vx = sxx / n - (sx / n) ** 2, vy = syy / n - (sy / n) ** 2;
    const c = vx > 0 && vy > 0 ? cov / Math.sqrt(vx * vy) : 0; if (c > bc){ bc = c; best = j; }
  });
  return best;
}
const r1 = (C, k) => (C[k] > 0 && C[k - 1] > 0 ? C[k] / C[k - 1] - 1 : NaN);
// לכל מניה ושנה: אינדקס סקטור (ב-SECT) או -1. החלון: 252 ימי המסחר שלפני היום הראשון של השנה
export function assignSectors(Xs, E, spy, cal){
  const L = cal.length, years = [...new Set(cal.map((d) => d.slice(0, 4)))], out = Xs.map(() => ({}));
  for (const y of years){
    const k1 = cal.findIndex((d) => d.slice(0, 4) === y), k0 = k1 - 252; if (k0 < 1) continue;
    const spyR = []; for (let k = k0; k < k1; k++) spyR.push(r1(spy.C, k));
    const es = SECT.map((s) => { const X = E[s]; if (!X) return null; const a = []; let ok = 0; for (let q = 0; q < spyR.length; q++){ const r = r1(X.C, k0 + q) - spyR[q]; a.push(r); if (Number.isFinite(r)) ok += 1; } return ok >= 200 ? a : null; });
    Xs.forEach((X, i) => { const xs = []; for (let q = 0; q < spyR.length; q++) xs.push(r1(X.C, k0 + q) - spyR[q]); out[i][y] = bestSector(xs, es); });
  }
  void L; return out;
}

// ---------- גרסאות ובחירה ----------
export function variants(){
  const V = [];
  for (const th of [0.005, 0.01, 0.02]) for (const pick of ['FELL', 'LAG', 'LEAD', 'RAND']) V.push({ id: `UP${Math.round(th * 1e4)}-${pick}`, cond: 'up', th, pick });
  V.push({ id: 'ANY-LAG', cond: 'any', th: 0, pick: 'LAG' }, { id: 'ANY-RAND', cond: 'any', th: 0, pick: 'RAND' }, { id: 'DN100-LAG', cond: 'down', th: 0.01, pick: 'LAG' });
  return V;
}
export const condKey = (v) => `${v.cond}${Math.round(v.th * 1e4)}`;
const hash = (si, k) => { let h = (si * 2654435761 + k * 40503) >>> 0; h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0; return h / 4294967296; };
// members: [{si, r, rel}] (r = תשואת היום, rel = r פחות תשואת קרן הסקטור). מחזיר עד n אינדקסים, הטוב ראשון
export function pickIn(members, pick, k, n = TOPK){
  const score = (m) => (pick === 'FELL' ? (m.r < 0 ? -m.r : NaN) : pick === 'LAG' ? -m.rel : pick === 'LEAD' ? m.rel : hash(m.si, k));
  return members.map((m) => ({ si: m.si, s: score(m) })).filter((x) => Number.isFinite(x.s)).sort((a, b) => b.s - a.s || a.si - b.si).slice(0, n).map((x) => x.si);
}
export function qualifies(v, rS){ return v.cond === 'any' ? Number.isFinite(rS) : v.cond === 'up' ? rS >= v.th : rS <= -v.th; }

// ---------- מחקר אירועים ----------
// תשואה מכניסה (סגירת k או פתיחת k+1) עד סגירת k+H (אם המניה נמחקה באמצע — הסגירה האחרונה שיש)
export function tradeRet(X, k, H, entry){
  const px = entry === 'close' ? X.C[k] : X.O[k + 1]; if (!(px > 0)) return NaN;
  for (let j = k + H; j > k; j--) if (X.C[j] > 0) return X.C[j] / px - 1;
  return NaN;
}
export function events(ctx, top, members, { N, H, entry, net = true }){
  const { L, cal, X, adv, k0, kDev } = ctx, pos = START_USD / (N * H), acc = { dev: [], test: [] }, yr = {};
  for (let k = k0; k + H < L; k++){
    const picks = []; for (let q = 0; q < TOPK && picks.length < N; q++){ const si = top[k * TOPK + q]; if (si < 0) break; picks.push(si); }
    const M = members[k]; if (!picks.length || !M || !M.length) continue;
    let s = 0, n = 0;
    for (const si of picks){ const r = tradeRet(X[si], k, H, entry); if (!Number.isFinite(r)) continue; const px = entry === 'close' ? X[si].C[k] : X[si].O[k + 1]; const c = net ? 2 * halfSpread(adv[si][k]) + 2 * Math.max(1 / pos, 0.005 / px) : 0; s += r - c; n += 1; }
    let b = 0, nb = 0; for (const si of M){ const r = tradeRet(X[si], k, H, entry); if (Number.isFinite(r)){ b += r; nb += 1; } }
    if (!n || !nb) continue;
    const ex = s / n - b / nb; (k <= kDev ? acc.dev : acc.test).push(ex); (yr[cal[k].slice(0, 4)] ||= []).push(ex);
  }
  const sum = (a) => { const n = a.length, m = n ? a.reduce((x, y) => x + y, 0) / n : 0, sd = n > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (n - 1)) : 0; return { n, mean: m, t: sd > 0 ? (m / sd) * Math.sqrt(n) : 0, hit: n ? a.filter((x) => x > 0).length / n : 0 }; };
  // ימים חופפים (H>1) מנפחים את t — מתקנים בגס לפי √H
  const fix = (o) => ({ ...o, t: o.t / Math.sqrt(H) });
  return { dev: fix(sum(acc.dev)), test: fix(sum(acc.test)), all: fix(sum([...acc.dev, ...acc.test])), yr: Object.fromEntries(Object.entries(yr).map(([y, a]) => [y, sum(a).mean])) };
}

// ---------- ראשי ----------
async function main(){
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUTDIR = arg('--outdir', 'sector-laggards-out'), CACHE = arg('--cache', ''), t0 = Date.now();
  mkdirSync(OUTDIR, { recursive: true });
  let U, raw, gicsArr = [];
  if (CACHE && existsSync(CACHE)) ({ U, raw, gicsArr } = JSON.parse(readFileSync(CACHE, 'utf8')));
  else {
    U = await universes();
    const h = await fetch('https://en.wikipedia.org/wiki/List_of_S%26P_500_companies', { headers: { 'User-Agent': 'Mozilla/5.0 (research backtest)' } }).then((r) => r.text()).catch(() => '');
    gicsArr = [...parseGics(h)];
    const hist = Object.entries(U.iv500).filter(([, ivs]) => ivs.some(([, b]) => b === null || b >= '2007-01-01')).map(([s]) => s).filter((s) => /^[A-Z]{1,5}(-[A-Z]{1,2})?$/.test(s));
    const syms = [...new Set(['SPY', ...SECT, ...U.sp500, ...hist])];
    log(`fetching ${syms.length} symbols`); raw = {}; const q = [...syms];
    await Promise.all(Array.from({ length: 8 }, async () => { for (let s; (s = q.shift());){ const b = await daily(s); if (b) raw[s] = b; await new Promise((r) => setTimeout(r, 60)); } }));
    log(`loaded ${Object.keys(raw).length}/${syms.length} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (!raw.SPY || !raw.XLK) throw new Error('אין נתוני SPY / XLK');
    if (CACHE) try { writeFileSync(CACHE, JSON.stringify({ U, raw, gicsArr })); } catch (e) { log('cache not saved: ' + e.message); }
  }
  const gics = new Map(gicsArr);
  const calT = raw.SPY.t, cal = Array.from(calT, dayIso), L = cal.length, S = build(raw, calT); raw = null;
  const ETFS = new Set(['SPY', ...SECT]), syms = Object.keys(S).filter((s) => !ETFS.has(s)), Xs = syms.map((s) => S[s]);
  const E = Object.fromEntries(SECT.filter((s) => S[s]).map((s) => [s, S[s]]));
  // מחזור דולרי ממוצע 20 יום (k−20..k−1)
  const adv = Xs.map((X) => { const a = new Float32Array(L).fill(NaN); for (let k = 20; k < L; k++){ let s = 0, n = 0; for (let j = k - 20; j < k; j++) if (X.DV[j] >= 0){ s += X.DV[j]; n += 1; } if (n >= 15) a[k] = s / n; } return a; });
  const sec = assignSectors(Xs, E, S.SPY, cal);
  const k0 = cal.findIndex((d) => d >= SIG_START), kDev = cal.findIndex((d) => d > DEV_END) - 1;
  const ctx = { L, cal, X: Xs, I: adv.map((a) => ({ adv: a })), adv, k0, kDev };
  log(`calendar ${cal[0]} → ${cal.at(-1)}; ${syms.length} stocks; sectors assigned ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // בדיקת שפיות: התאמה ל-GICS הנוכחי (שנה אחרונה, מניות שבהרכב היום)
  const yLast = cal.at(-1).slice(0, 4); let agree = 0, cmp = 0;
  syms.forEach((s, i) => { const g = gics.get(s), a = sec[i][yLast]; if (!g || a < 0 || !E[g]) return; cmp += 1; if (SECT[a] === g) agree += 1; });

  // לכל יום: חברי הסקטורים לפי תנאי, והבחירה לכל גרסה
  const V = variants(), keys = [...new Set(V.map(condKey))];
  const members = Object.fromEntries(keys.map((c) => [c, new Array(L)])), tops = Object.fromEntries(V.map((v) => [v.id, new Int32Array(L * TOPK).fill(-1)]));
  const perSec = {}; for (const s of SECT) perSec[s] = { fell: new Int32Array(L * TOPK).fill(-1), rand: new Int32Array(L * TOPK).fill(-1), mem: new Array(L) };
  const coverage = {}, sigDays = Object.fromEntries(keys.map((c) => [c, 0]));
  for (let k = k0; k < L; k++){
    const y = cal[k].slice(0, 4), d = cal[k], groups = {};
    for (let i = 0; i < Xs.length; i++){
      const X = Xs[i], e = sec[i][y]; if (!(e >= 0)) continue; if (!inIv(U.iv500[syms[i]], d)) continue;
      if (!(X.CR[k - 1] > 5 && adv[i][k] >= MIN_ADV)) continue; const r = r1(X.C, k); if (!Number.isFinite(r)) continue;
      const s = SECT[e], rS = r1(E[s].C, k); if (!Number.isFinite(rS)) continue; (groups[s] ||= { rS, m: [] }).m.push({ si: i, r, rel: r - rS });
    }
    if (d.endsWith('-07-01') || (d.slice(5, 7) === '07' && !coverage[y])) coverage[y] = Object.values(groups).reduce((a, g) => a + g.m.length, 0);
    for (const v of V){
      const ck = condKey(v), M = []; for (const g of Object.values(groups)) if (g.m.length >= MINM && qualifies(v, g.rS)) M.push(...g.m);
      if (!members[ck][k]) { members[ck][k] = Int32Array.from(M.map((m) => m.si)); if (M.length) sigDays[ck] += 1; }
      const p = pickIn(M, v.pick, k); const T = tops[v.id]; p.forEach((si, q) => { T[k * TOPK + q] = si; });
    }
    for (const [s, g] of Object.entries(groups)){ if (g.m.length < MINM || !(g.rS >= 0.01)) continue; const P = perSec[s]; P.mem[k] = Int32Array.from(g.m.map((m) => m.si)); pickIn(g.m, 'FELL', k).forEach((si, q) => { P.fell[k * TOPK + q] = si; }); pickIn(g.m, 'RAND', k).forEach((si, q) => { P.rand[k * TOPK + q] = si; }); }
  }
  log(`signals built ${((Date.now() - t0) / 1000).toFixed(0)}s; days: ${JSON.stringify(sigDays)}`);

  // מחקר אירועים + תיק
  const Ns = [3, 5, 10], Hs = [1, 2, 5, 10], rows = [], y0 = cal[k0].slice(0, 4), yD = DEV_END.slice(0, 4), yT = String(Number(yD) + 1), yE = cal.at(-1).slice(0, 4);
  for (const v of V) for (const N of Ns) for (const H of Hs){
    const M = members[condKey(v)], T = tops[v.id];
    const evO = events(ctx, T, M, { N, H, entry: 'open' }), evC = events(ctx, T, M, { N, H, entry: 'close' }), evCg = events(ctx, T, M, { N, H, entry: 'close', net: false });
    const pf = simulate(ctx, T, { N, H, side: 'L', off: 1, cost: 'net' });
    rows.push({ v, N, H, evO, evC, evCg, pf, dev: stats(pf.yr, y0, yD), test: stats(pf.yr, yT, yE), all: stats(pf.yr, y0, yE) });
  }
  const spyYr = {}; for (let t = k0 + 1; t < L; t++){ const r = S.SPY.C[t] / S.SPY.C[t - 1] - 1, Y = (spyYr[cal[t].slice(0, 4)] ||= { n: 0, s: 0, s2: 0, g: 1 }); Y.n += 1; Y.s += r; Y.s2 += r * r; Y.g *= 1 + r; }
  const spy = { dev: stats(spyYr, y0, yD), test: stats(spyYr, yT, yE), all: stats(spyYr, y0, yE) };
  const rndOf = (r) => rows.find((x) => x.v.cond === r.v.cond && x.v.th === r.v.th && x.v.pick === 'RAND' && x.N === r.N && x.H === r.H);
  for (const r of rows){ const b = rndOf(r); r.rnd = b; r.pass = ['FELL', 'LAG'].includes(r.v.pick) && r.v.cond === 'up' && r.evO.dev.mean > 0 && r.evO.dev.t >= 2 && r.evO.test.mean > 0 && r.evO.test.t >= 2 && b && r.dev.cagr > b.dev.cagr && r.test.cagr > b.test.cagr; }

  // לפי סקטור: θ=1%, מניות שירדו, 3 מניות
  const secRows = [];
  for (const s of SECT){ const P = perSec[s]; if (!E[s]) continue; for (const H of [1, 5]){ const a = events(ctx, P.fell, P.mem, { N: 3, H, entry: 'open' }), b = events(ctx, P.fell, P.mem, { N: 3, H, entry: 'close' }); secRows.push({ s, H, a, b, days: P.mem.filter((x) => x && x.length).length }); } }

  // ---------- פלט ----------
  const pct = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%` : '—'), f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—'), f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
  const HE = { FELL: 'שירדו ביום שהסקטור עלה', LAG: 'עלו הכי פחות (או ירדו) ביחס לסקטור', LEAD: 'המובילות (עלו הכי הרבה)', RAND: 'אקראיות מאותם סקטורים' };
  const vHe = (v) => (v.cond === 'up' ? `סקטור עלה ${pct(v.th, 1)}+ · ${HE[v.pick]}` : v.cond === 'any' ? `כל יום (בלי תנאי) · ${HE[v.pick]}` : `סקטור ירד ${pct(v.th, 1)}+ · ${HE[v.pick]}`);
  const md = [], T = (h, rs) => { md.push(`| ${h.join(' | ')} |`, `|${h.map(() => '---').join('|')}|`, ...rs.map((x) => `| ${x.join(' | ')} |`), ''); };
  const nPass = rows.filter((r) => r.pass).length, nCand = rows.filter((r) => ['FELL', 'LAG'].includes(r.v.pick) && r.v.cond === 'up').length;
  md.push(`# המפגרות בסקטור שעולה — בדיקה לאחור (${cal[k0]} → ${cal.at(-1)})`, '',
    `**השאלה:** ביום שסקטור עולה, אבל לא כל המניות בו עולות — האם כדאי לקנות את אלה שירדו או עלו הכי מעט?`, '',
    `**הכרעה (נקבעה מראש):** ${nPass ? `✅ ${nPass} מתוך ${nCand} תצורות עברו` : `❌ אף אחת מ-${nCand} התצורות לא עברה`} — תשואה עודפת חיובית מול ממוצע הסקטור עם t ≥ 2 בפיתוח ובמבחן (כניסה בפתיחה, אחרי עלויות), ותיק טוב מבחירה אקראית באותם ימים, בשתי התקופות.`, '',
    `- **נתונים:** Yahoo Finance, הרכב S&P 500 היסטורי (${U.memSrc || 'ויקיפדיה'}), ${syms.length} מניות, 11 קרנות SPDR. מניות במחיר > 5$ ומחזור ≥ 10 מיליון$ ביום.`,
    `- **שיוך סקטור:** לפי מתאם לקרן הסקטור בשנה הקודמת (בלי מידע עתידי). התאמה ל-GICS הנוכחי: ${cmp ? `${agree}/${cmp} (${Math.round(agree / cmp * 100)}%)` : '—'}.`,
    `- **פיתוח:** ${cal[k0]} → ${cal[kDev]} · **מבחן:** ${cal[kDev + 1]} → ${cal.at(-1)}.`,
    `- **ימים עם אות:** ${Object.entries(sigDays).map(([c, n]) => `${c}: ${n}`).join(' · ')} (מתוך ${L - k0}).`,
    '- **"עודף"** = תשואת המניות שנבחרו פחות הממוצע של כל המניות בסקטורים שעלו באותו יום, באותה כניסה ויציאה. אחרי עלויות = פחות חצי מרווח לפי מחזור + עמלת IBKR, בכניסה וביציאה. t מתוקן לחפיפה (÷√H).', '');
  md.push('## 1. התשובה הקצרה — 5 מניות, כניסה בפתיחה של מחר (מציאותי), אחרי עלויות', 'עודף ממוצע לכל יום אות מול ממוצע הסקטור · (t) · אחוז הימים שבהם ניצחו את הסקטור', '');
  const evCell = (e) => `${pct(e.mean)} (t ${f1(e.t)}) · ${Math.round(e.hit * 100)}%`;
  T(['גרסה', 'H', 'פיתוח 2008–2018', 'מבחן 2019→', 'כל התקופה'], rows.filter((r) => r.N === 5 && [1, 2, 5, 10].includes(r.H)).map((r) => [vHe(r.v), r.H, evCell(r.evO.dev), evCell(r.evO.test), evCell(r.evO.all)]));
  md.push('## 2. אותו דבר עם קנייה בסגירה של היום (אופטימי — כמו לקנות לפני הסגירה / במסחר הלילי)', '');
  T(['גרסה', 'H', 'פיתוח — לפני עלויות', 'פיתוח — אחרי', 'מבחן — לפני עלויות', 'מבחן — אחרי'], rows.filter((r) => r.N === 5 && [1, 5].includes(r.H)).map((r) => [vHe(r.v), r.H, pct(r.evCg.dev.mean), evCell(r.evC.dev), pct(r.evCg.test.mean), evCell(r.evC.test)]));
  md.push('## 3. תיק של 50,000$ (כניסה בפתיחה, עלויות מלאות) — מול בחירה אקראית באותם ימים ומול SPY', `SPY: פיתוח ${pct(spy.dev.cagr, 1)} בשנה / שארפ ${f2(spy.dev.sharpe)} · מבחן ${pct(spy.test.cagr, 1)} / ${f2(spy.test.sharpe)}`, '');
  T(['גרסה', 'N', 'H', 'פיתוח CAGR / שארפ / ירידה', 'מבחן CAGR / שארפ / ירידה', 'אקראי: פיתוח / מבחן', 'עסקאות / הצלחה', 'עבר'], rows.filter((r) => r.v.cond === 'up' && r.v.pick !== 'RAND' && r.N === 5 || r.pass).map((r) => [vHe(r.v), r.N, r.H, `${pct(r.dev.cagr, 1)} / ${f2(r.dev.sharpe)} / ${pct(-r.pf.dd.dev, 0)}`, `${pct(r.test.cagr, 1)} / ${f2(r.test.sharpe)} / ${pct(-r.pf.dd.test, 0)}`, r.rnd ? `${pct(r.rnd.dev.cagr, 1)} / ${pct(r.rnd.test.cagr, 1)}` : '—', `${r.pf.trades.toLocaleString('en-US')} / ${Math.round(r.pf.trades ? r.pf.wins / r.pf.trades * 100 : 0)}%`, r.pass ? '✅' : '❌']));
  md.push('## 4. לפי סקטור — הסקטור עלה 1%+, קונים את 3 שירדו הכי הרבה (עודף מול ממוצע הסקטור, אחרי עלויות)', '');
  T(['סקטור', 'ימים', 'H', 'פתיחה — פיתוח', 'פתיחה — מבחן', 'סגירה — פיתוח', 'סגירה — מבחן'], secRows.map((x) => [`${SECT_HE[x.s]} (${x.s})`, x.days, x.H, evCell(x.a.dev), evCell(x.a.test), evCell(x.b.dev), evCell(x.b.test)]));
  const years = [...new Set(cal.slice(k0).map((d) => d.slice(0, 4)))], show = rows.filter((r) => r.N === 5 && r.H === 1 && ['UP100-FELL', 'UP100-LAG', 'UP100-LEAD', 'ANY-LAG'].includes(r.v.id));
  md.push('## 5. לפי שנה — עודף ממוצע ליום אות (5 מניות, יום אחד, כניסה בפתיחה, אחרי עלויות)', '');
  T(['גרסה', ...years], show.map((r) => [r.v.id, ...years.map((y) => pct(r.evO.yr[y], 2))]));
  md.push('## כיסוי (מניות זכאיות עם סקטור, באמצע השנה)', ''); T(['שנה', ...Object.keys(coverage)], [['מניות', ...Object.values(coverage)]]);
  md.push('## מגבלות', '- הטיית שורדים: חלק מהמניות שנמחקו מ-S&P 500 (פשיטות רגל, מיזוגים) חסרות ב-Yahoo. זה מיטיב עם קניית מפגרות — לכן ההשוואה העיקרית היא מול ממוצע הסקטור ומול בחירה אקראית מאותם ימים, שסובלים מאותה הטיה.',
    '- שיוך סקטור לפי מתאם, לא GICS היסטורי. קרנות XLRE ‏(2015) ו-XLC ‏(2018) לא קיימות לפני כן — המניות שלהן משויכות לקרן הקרובה.',
    '- מסחר לילי ומחירים תוך-יומיים לא נבדקו (נתונים יומיים בלבד). "סגירה" היא קירוב אופטימי לקנייה סמוך לסגירה.',
    `- נבדקו ${rows.length} תצורות — תוצאה בודדת עם t ≈ 2 יכולה להיות מקרית. לכן הדרישה: גם פיתוח וגם מבחן, וגם מול אקראי.`, '', `זמן ריצה: ${((Date.now() - t0) / 60000).toFixed(1)} דקות.`);
  writeFileSync(`${OUTDIR}/report.md`, md.join('\n'));
  const csv = [['id', 'cond', 'th', 'pick', 'N', 'H', 'ev_open_dev', 't_dev', 'ev_open_test', 't_test', 'ev_close_dev', 'ev_close_test', 'ev_close_gross_test', 'pf_dev_cagr', 'pf_dev_sharpe', 'pf_test_cagr', 'pf_test_sharpe', 'pf_test_mdd', 'rnd_dev_cagr', 'rnd_test_cagr', 'trades', 'pass'].join(',')];
  for (const r of rows) csv.push([r.v.id, r.v.cond, r.v.th, r.v.pick, r.N, r.H, r.evO.dev.mean, r.evO.dev.t, r.evO.test.mean, r.evO.test.t, r.evC.dev.mean, r.evC.test.mean, r.evCg.test.mean, r.dev.cagr, r.dev.sharpe, r.test.cagr, r.test.sharpe, r.pf.dd.test, r.rnd?.dev.cagr ?? '', r.rnd?.test.cagr ?? '', r.pf.trades, r.pass ? 1 : 0].map((x) => (typeof x === 'number' ? +x.toFixed(5) : x)).join(','));
  writeFileSync(`${OUTDIR}/results.csv`, csv.join('\n'));
  writeFileSync(`${OUTDIR}/meta.json`, JSON.stringify({ generated: new Date().toISOString(), calendar: [cal[0], cal.at(-1)], dev: [cal[k0], cal[kDev]], test: [cal[kDev + 1], cal.at(-1)], stocks: syms.length, gics_agreement: [agree, cmp], signal_days: sigDays, coverage, configs: rows.length, passed: nPass }, null, 1));
  console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
