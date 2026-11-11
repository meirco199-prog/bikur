#!/usr/bin/env node
// מחקר המשך: "סקטור עלה משמעותית — לקנות את המדשדשות?" (בקשת מאיר, 11/11/2026). מחקר בלבד — אין כסף, אין פקודות.
// מאיר: "ביקשתי שאם סקטור עלה משמעותית, לא באחוז. נניח כמו היום בטכנולוגיה, ויש כאלה שמדשדשות — האם כדאי לקנות אותן."
// (המחקר הקודם, research-sector-laggards.mjs, בדק סף של 0.5%–2% ואת המניות שירדו / החלשות ביותר.)
//
// נתונים ושיוך סקטור: כמו research-sector-laggards (Yahoo יומי 2007→היום, הרכב S&P 500 היסטורי, 11 קרנות SPDR, שיוך לפי מתאם
//   בשנה הקודמת — בלי מידע עתידי).
// שני סוגי ימים "חזקים":
//   (א) סגירה: קרן הסקטור עלתה ביום ≥ 2% / 3% / 4%, או ≥ פי 2 / פי 3 מהתנודה היומית הרגילה שלה (סטיית תקן 60 יום קודמים).
//       כניסה בפתיחה של מחרת (מציאותי) או בסגירה של אותו יום (אופטימי). יציאה בסגירה של k+H.
//   (ב) פער פתיחה — בדיוק המצב של היום: הסקטור נפתח ≥ 1% / 2% / 3% מעל סגירת אתמול (מה שקרה במסחר הלילי), ובוחרים לפי פער
//       הפתיחה של כל מניה. כניסה בפתיחה של אותו יום (+5bp החלקה), יציאה בסגירה של k+H−1 (H=1 = סגירת אותו יום).
// מה קונים (מתוך הסקטורים שעלו):
//   FLAT — "מדשדשות": זזו פחות מ-0.5% לכל כיוון (הקרובות ל-0 קודם) · FLAT1 — פחות מ-1% · FELL — ירדו · LAG — החלשות ביותר ביחס לקרן
//   LEAD — המובילות (ההפך) · RAND — אקראיות מאותם סקטורים באותו יום (קבוצת הביקורת).
// מדדים והכרעה (נקבעו מראש, כמו במחקר הקודם): עודף מול ממוצע כל המניות בסקטורים שעלו, אחרי עלויות, t ≥ 2 בפיתוח (2008–2018) וגם
//   במבחן (2019→), ותיק טוב מבחירה אקראית באותם ימים בשתי התקופות.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { universes, daily, build, dayIso, simulate, stats, TOPK, inIv, halfSpread } from './research-xsec.mjs';
import { SECT, SECT_HE, parseGics, assignSectors } from './research-sector-laggards.mjs';

const START_USD = 50000, SIG_START = '2008-01-02', DEV_END = '2018-12-31', MINM = 8, MIN_ADV = 1e7, GAP_SLIP = 5e-4;
const log = (...a) => console.error(...a);
const r1 = (C, k) => (C[k] > 0 && C[k - 1] > 0 ? C[k] / C[k - 1] - 1 : NaN);
const gap1 = (X, k) => (X.O[k] > 0 && X.C[k - 1] > 0 ? X.O[k] / X.C[k - 1] - 1 : NaN);

// ---------- גרסאות ----------
export const PICKS = ['FLAT', 'FLAT1', 'FELL', 'LAG', 'LEAD', 'RAND'];
export function variants(){
  const V = [];
  for (const th of [0.02, 0.03, 0.04]) for (const pick of PICKS) V.push({ id: `UP${th * 100}-${pick}`, kind: 'close', cond: 'up', th, pick });
  for (const z of [2, 3]) for (const pick of PICKS) V.push({ id: `Z${z}-${pick}`, kind: 'close', cond: 'z', th: z, pick });
  for (const th of [0.01, 0.02, 0.03]) for (const pick of PICKS) V.push({ id: `GAP${th * 100}-${pick}`, kind: 'gap', cond: 'gap', th, pick });
  return V;
}
export const condKey = (v) => `${v.cond}${v.th}`;
// S: { r, g, z } של קרן הסקטור ביום k
export function qualifies(v, S){ return v.cond === 'up' ? S.r >= v.th : v.cond === 'z' ? S.z >= v.th : v.cond === 'gap' ? S.g >= v.th : false; }
const hash = (si, k) => { let h = (si * 2654435761 + k * 40503) >>> 0; h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0; return h / 4294967296; };
// members: [{si, x, rel}] — x = תשואת היום (או פער הפתיחה בסוג "gap"), rel = x פחות אותו מדד של הקרן
export function pickIn(members, pick, k, n = TOPK){
  const score = (m) => (pick === 'FLAT' ? (Math.abs(m.x) <= 0.005 ? -Math.abs(m.x) : NaN) : pick === 'FLAT1' ? (Math.abs(m.x) <= 0.01 ? -Math.abs(m.x) : NaN)
    : pick === 'FELL' ? (m.x < 0 ? -m.x : NaN) : pick === 'LAG' ? -m.rel : pick === 'LEAD' ? m.rel : hash(m.si, k));
  return members.map((m) => ({ si: m.si, s: score(m) })).filter((x) => Number.isFinite(x.s)).sort((a, b) => b.s - a.s || a.si - b.si).slice(0, n).map((x) => x.si);
}
// כניסה: 'open' = פתיחת k+1 → סגירת k+H · 'close' = סגירת k → סגירת k+H · 'open0' = פתיחת k → סגירת k+H−1
export function tradeRet(X, k, H, entry){
  const px = entry === 'close' ? X.C[k] : entry === 'open' ? X.O[k + 1] : X.O[k]; if (!(px > 0)) return NaN;
  const last = entry === 'open0' ? k + H - 1 : k + H, first = entry === 'open0' ? k : k + 1;
  for (let j = last; j >= first; j--) if (X.C[j] > 0) return X.C[j] / px - 1;
  return NaN;
}
export function events(ctx, top, members, { N, H, entry, net = true }){
  const { L, cal, X, adv, k0, kDev } = ctx, pos = START_USD / (N * H), acc = { dev: [], test: [] }, yr = {}, cnt = [];
  for (let k = k0; k + H < L; k++){
    const picks = []; for (let q = 0; q < TOPK && picks.length < N; q++){ const si = top[k * TOPK + q]; if (si < 0) break; picks.push(si); }
    const M = members[k]; if (!picks.length || !M || !M.length) continue;
    let s = 0, n = 0;
    for (const si of picks){
      const r = tradeRet(X[si], k, H, entry); if (!Number.isFinite(r)) continue;
      const px = entry === 'close' ? X[si].C[k] : entry === 'open' ? X[si].O[k + 1] : X[si].O[k];
      const c = net ? 2 * halfSpread(adv[si][k]) + 2 * Math.max(1 / pos, 0.005 / px) + (entry === 'open0' ? GAP_SLIP : 0) : 0; s += r - c; n += 1;
    }
    let b = 0, nb = 0; for (const si of M){ const r = tradeRet(X[si], k, H, entry); if (Number.isFinite(r)){ b += r; nb += 1; } }
    if (!n || !nb) continue;
    const ex = s / n - b / nb; (k <= kDev ? acc.dev : acc.test).push(ex); (yr[cal[k].slice(0, 4)] ||= []).push(ex); cnt.push(picks.length);
  }
  const sum = (a) => { const n = a.length, m = n ? a.reduce((x, y) => x + y, 0) / n : 0, sd = n > 1 ? Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (n - 1)) : 0; return { n, mean: m, t: sd > 0 ? (m / sd) * Math.sqrt(n) / Math.sqrt(H) : 0, hit: n ? a.filter((x) => x > 0).length / n : 0 }; };
  return { dev: sum(acc.dev), test: sum(acc.test), all: sum([...acc.dev, ...acc.test]), yr: Object.fromEntries(Object.entries(yr).map(([y, a]) => [y, sum(a)])), avgPicks: cnt.length ? cnt.reduce((a, b) => a + b, 0) / cnt.length : 0 };
}

// ---------- ראשי ----------
async function main(){
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const OUTDIR = arg('--outdir', 'sector-strong-out'), CACHE = arg('--cache', ''), t0 = Date.now();
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
  const adv = Xs.map((X) => { const a = new Float32Array(L).fill(NaN); for (let k = 20; k < L; k++){ let s = 0, n = 0; for (let j = k - 20; j < k; j++) if (X.DV[j] >= 0){ s += X.DV[j]; n += 1; } if (n >= 15) a[k] = s / n; } return a; });
  // סטיית תקן יומית של כל קרן: 60 הימים שלפני k (בלי k)
  const sd60 = Object.fromEntries(Object.entries(E).map(([s, X]) => { const a = new Float32Array(L).fill(NaN); for (let k = 61; k < L; k++){ let n = 0, m = 0, q = 0; for (let j = k - 60; j < k; j++){ const r = r1(X.C, j); if (!Number.isFinite(r)) continue; n += 1; m += r; q += r * r; } if (n >= 50) a[k] = Math.sqrt(Math.max(q / n - (m / n) ** 2, 0)); } return [s, a]; }));
  const sec = assignSectors(Xs, E, S.SPY, cal);
  const k0 = cal.findIndex((d) => d >= SIG_START), kDev = cal.findIndex((d) => d > DEV_END) - 1;
  const ctx = { L, cal, X: Xs, I: adv.map((a) => ({ adv: a })), adv, k0, kDev };
  const yLast = cal.at(-1).slice(0, 4); let agree = 0, cmp = 0;
  syms.forEach((s, i) => { const g = gics.get(s), a = sec[i][yLast]; if (!g || a < 0 || !E[g]) return; cmp += 1; if (SECT[a] === g) agree += 1; });

  const V = variants(), keys = [...new Set(V.map(condKey))];
  const members = Object.fromEntries(keys.map((c) => [c, new Array(L)])), tops = Object.fromEntries(V.map((v) => [v.id, new Int32Array(L * TOPK).fill(-1)]));
  const sigDays = Object.fromEntries(keys.map((c) => [c, 0])), flatCnt = Object.fromEntries(keys.map((c) => [c, []]));
  // לפי סקטור (טכנולוגיה במיוחד): UP3 / GAP2, מדשדשות עד 1% ואקראיות
  const perSec = {}; for (const s of SECT) perSec[s] = { up: { flat: new Int32Array(L * TOPK).fill(-1), mem: new Array(L) }, gap: { flat: new Int32Array(L * TOPK).fill(-1), mem: new Array(L) } };
  for (let k = k0; k < L; k++){
    const y = cal[k].slice(0, 4), d = cal[k], groups = {};
    for (let i = 0; i < Xs.length; i++){
      const X = Xs[i], e = sec[i][y]; if (!(e >= 0)) continue; if (!inIv(U.iv500[syms[i]], d)) continue;
      if (!(X.CR[k - 1] > 5 && adv[i][k] >= MIN_ADV)) continue;
      const s = SECT[e], G = (groups[s] ||= { S: { r: r1(E[s].C, k), g: gap1(E[s], k), z: r1(E[s].C, k) / sd60[s][k] }, m: [] });
      G.m.push({ si: i, r: r1(X.C, k), g: gap1(X, k) });
    }
    for (const v of V){
      const ck = condKey(v), M = [];
      for (const G of Object.values(groups)){ if (G.m.length < MINM || !qualifies(v, G.S)) continue; const base = v.kind === 'gap' ? G.S.g : G.S.r; for (const m of G.m){ const x = v.kind === 'gap' ? m.g : m.r; if (Number.isFinite(x)) M.push({ si: m.si, x, rel: x - base }); } }
      if (!members[ck][k]){ members[ck][k] = Int32Array.from(M.map((m) => m.si)); if (M.length){ sigDays[ck] += 1; flatCnt[ck].push(M.filter((m) => Math.abs(m.x) <= 0.01).length / M.length); } }
      pickIn(M, v.pick, k).forEach((si, q) => { tops[v.id][k * TOPK + q] = si; });
    }
    for (const [s, G] of Object.entries(groups)){
      if (G.m.length < MINM) continue;
      for (const [w, ok, f] of [['up', G.S.r >= 0.03, 'r'], ['gap', G.S.g >= 0.02, 'g']]){ if (!ok) continue; const P = perSec[s][w], M = G.m.filter((m) => Number.isFinite(m[f])).map((m) => ({ si: m.si, x: m[f], rel: 0 })); P.mem[k] = Int32Array.from(M.map((m) => m.si)); pickIn(M, 'FLAT1', k).forEach((si, q) => { P.flat[k * TOPK + q] = si; }); }
    }
  }
  log(`signals built ${((Date.now() - t0) / 1000).toFixed(0)}s; days: ${JSON.stringify(sigDays)}`);

  const Ns = [3, 5], Hs = [1, 2, 5, 10], rows = [], y0 = cal[k0].slice(0, 4), yD = DEV_END.slice(0, 4), yT = String(Number(yD) + 1), yE = cal.at(-1).slice(0, 4);
  for (const v of V) for (const N of Ns) for (const H of Hs){
    const M = members[condKey(v)], T = tops[v.id], gapK = v.kind === 'gap';
    const ev = events(ctx, T, M, { N, H, entry: gapK ? 'open0' : 'open' }), evC = gapK ? null : events(ctx, T, M, { N, H, entry: 'close' }), evG = events(ctx, T, M, { N, H, entry: gapK ? 'open0' : 'open', net: false });
    const pf = simulate(ctx, T, { N, H, side: 'L', off: gapK ? 0 : 1, extra: gapK ? GAP_SLIP : 0, cost: 'net' });
    rows.push({ v, N, H, ev, evC, evG, pf, dev: stats(pf.yr, y0, yD), test: stats(pf.yr, yT, yE) });
  }
  const rndOf = (r) => rows.find((x) => x.v.cond === r.v.cond && x.v.th === r.v.th && x.v.pick === 'RAND' && x.N === r.N && x.H === r.H);
  const MAIN = ['FLAT', 'FLAT1', 'FELL', 'LAG'];
  for (const r of rows){ const b = rndOf(r); r.rnd = b; r.pass = MAIN.includes(r.v.pick) && r.ev.dev.mean > 0 && r.ev.dev.t >= 2 && r.ev.test.mean > 0 && r.ev.test.t >= 2 && b && r.dev.cagr > b.dev.cagr && r.test.cagr > b.test.cagr; }
  const spyYr = {}; for (let t = k0 + 1; t < L; t++){ const r = S.SPY.C[t] / S.SPY.C[t - 1] - 1, Y = (spyYr[cal[t].slice(0, 4)] ||= { n: 0, s: 0, s2: 0, g: 1 }); Y.n += 1; Y.s += r; Y.s2 += r * r; Y.g *= 1 + r; }
  const spy = { dev: stats(spyYr, y0, yD), test: stats(spyYr, yT, yE) };
  const secRows = [];
  for (const s of SECT){ if (!E[s]) continue; for (const w of ['up', 'gap']) for (const H of [1, 5]){ const P = perSec[s][w]; const e = events(ctx, P.flat, P.mem, { N: 3, H, entry: w === 'gap' ? 'open0' : 'open' }); secRows.push({ s, w, H, e, days: P.mem.filter((x) => x && x.length).length }); } }

  // ---------- פלט ----------
  const pct = (x, d = 2) => (Number.isFinite(x) ? `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(d)}%` : '—'), f1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : '—'), f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
  const HE = { FLAT: 'מדשדשות (זזו פחות מ-0.5%)', FLAT1: 'מדשדשות (פחות מ-1%)', FELL: 'ירדו', LAG: 'החלשות ביחס לסקטור', LEAD: 'המובילות', RAND: 'אקראיות (ביקורת)' };
  const CHE = (v) => (v.cond === 'up' ? `סקטור עלה ${v.th * 100}%+ ביום` : v.cond === 'z' ? `סקטור עלה פי ${v.th}+ מהתנודה הרגילה` : `סקטור נפתח ${v.th * 100}%+ למעלה (פער)`);
  const cell = (e) => (e.n ? `${pct(e.mean)} (t ${f1(e.t)}) · ${Math.round(e.hit * 100)}% · ${e.n} ימים` : '—');
  const md = [], T = (h, rs) => { md.push(`| ${h.join(' | ')} |`, `|${h.map(() => '---').join('|')}|`, ...rs.map((x) => `| ${x.join(' | ')} |`), ''); };
  const nPass = rows.filter((r) => r.pass).length, nCand = rows.filter((r) => MAIN.includes(r.v.pick)).length;
  md.push(`# סקטור עלה משמעותית — לקנות את המדשדשות? (${cal[k0]} → ${cal.at(-1)})`, '',
    `**הכרעה (נקבעה מראש):** ${nPass ? `✅ ${nPass} מתוך ${nCand} תצורות עברו` : `❌ אף אחת מ-${nCand} התצורות לא עברה`} — עודף חיובי מול ממוצע הסקטור עם t ≥ 2 בפיתוח ובמבחן (כניסה מציאותית, אחרי עלויות) ותיק טוב מבחירה אקראית בשתי התקופות.`, '',
    `- **נתונים:** Yahoo Finance, הרכב S&P 500 היסטורי, ${syms.length} מניות, 11 קרנות SPDR. שיוך סקטור לפי מתאם בשנה הקודמת (התאמה ל-GICS הנוכחי: ${cmp ? Math.round(agree / cmp * 100) : '—'}%).`,
    `- **פיתוח:** ${cal[k0]} → ${cal[kDev]} · **מבחן:** ${cal[kDev + 1]} → ${cal.at(-1)}.`,
    `- **ימי אות:** ${keys.map((c) => `${c}: ${sigDays[c]} (מדשדשות עד 1%: ${pct(flatCnt[c].reduce((a, b) => a + b, 0) / Math.max(flatCnt[c].length, 1), 0)} מהמניות)`).join(' · ')}.`,
    '- **"עודף"** = תשואת המניות שנבחרו פחות ממוצע כל המניות בסקטורים שעלו באותו יום, באותה כניסה ויציאה; אחרי חצי מרווח, עמלת IBKR ו(בפער) 5bp החלקה. בתאים: עודף (t) · אחוז הימים שניצחו · מספר ימים.', '');
  for (const [title, kind, entryNote] of [['## 1. יום חזק (לפי הסגירה) — קונים בפתיחה של מחרת', 'close', ''], ['## 2. פער פתיחה (כמו היום: הסקטור עלה במסחר הלילי) — קונים בפתיחה של אותו יום', 'gap', 'H=1 = מוכרים בסגירה של אותו יום.']]){
    md.push(title, entryNote, '');
    T(['תנאי', 'מה קונים', 'N', 'H', 'פיתוח 2008–2018', 'מבחן 2019→', 'לפני עלויות (הכול)'], rows.filter((r) => r.v.kind === kind && r.N === 3).map((r) => [CHE(r.v), HE[r.v.pick], r.N, r.H, cell(r.ev.dev), cell(r.ev.test), pct(r.evG.all.mean)]));
  }
  md.push('## 3. יום חזק — אותו דבר עם קנייה בסגירה של אותו יום (אופטימי)', '');
  T(['תנאי', 'מה קונים', 'H', 'פיתוח', 'מבחן'], rows.filter((r) => r.v.kind === 'close' && r.N === 3 && [1, 5].includes(r.H)).map((r) => [CHE(r.v), HE[r.v.pick], r.H, cell(r.evC.dev), cell(r.evC.test)]));
  md.push('## 4. לפי סקטור — 3 מדשדשות (פחות מ-1%), אחרי עלויות', '- **יום חזק:** הסקטור עלה 3%+ ביום, קונים בפתיחה של מחרת · **פער:** הסקטור נפתח 2%+ למעלה, קונים בפתיחה של אותו יום', '');
  T(['סקטור', 'סוג', 'ימים', 'H', 'פיתוח', 'מבחן'], secRows.map((x) => [`${SECT_HE[x.s]} (${x.s})`, x.w === 'up' ? 'יום חזק 3%+' : 'פער 2%+', x.days, x.H, cell(x.e.dev), cell(x.e.test)]));
  md.push('## 5. תיק של 50,000$ (רק בימי האות; שאר הזמן מזומן) — מול אקראי ו-SPY', `SPY (קנה והחזק): פיתוח ${pct(spy.dev.cagr, 1)} בשנה · מבחן ${pct(spy.test.cagr, 1)} בשנה`, '');
  T(['תנאי', 'מה קונים', 'N', 'H', 'פיתוח CAGR / שארפ', 'מבחן CAGR / שארפ', 'אקראי: פיתוח / מבחן', 'עסקאות', 'עבר'], rows.filter((r) => r.N === 3 && [1, 5].includes(r.H) && r.v.pick !== 'RAND').map((r) => [CHE(r.v), HE[r.v.pick], r.N, r.H, `${pct(r.dev.cagr, 1)} / ${f2(r.dev.sharpe)}`, `${pct(r.test.cagr, 1)} / ${f2(r.test.sharpe)}`, r.rnd ? `${pct(r.rnd.dev.cagr, 1)} / ${pct(r.rnd.test.cagr, 1)}` : '—', r.pf.trades.toLocaleString('en-US'), r.pass ? '✅' : '❌']));
  md.push('## מגבלות', '- ימים חזקים באמת (3%–4%+) נדירים — עשרות עד מאות ימים ב-19 שנה, ולכן הטעות הסטטיסטית גדולה (ראו t ומספר הימים בכל תא).',
    '- הטיית שורדים (מניות שנמחקו חסרות) — מיטיבה עם קניית חלשות; ההשוואה העיקרית מול ממוצע הסקטור ואקראי באותם ימים.',
    '- פער הפתיחה נמדד מול סגירת אתמול; מחיר הפתיחה בפועל במסחר הלילי / טרום המסחר לא נבדק (נתונים יומיים). שיוך סקטור לפי מתאם, לא GICS היסטורי.',
    `- נבדקו ${rows.length} תצורות.`, '', `זמן ריצה: ${((Date.now() - t0) / 60000).toFixed(1)} דקות.`);
  writeFileSync(`${OUTDIR}/report.md`, md.join('\n'));
  const csv = [['id', 'kind', 'cond', 'th', 'pick', 'N', 'H', 'ev_dev', 't_dev', 'n_dev', 'ev_test', 't_test', 'n_test', 'ev_gross_all', 'pf_dev_cagr', 'pf_test_cagr', 'rnd_dev_cagr', 'rnd_test_cagr', 'pass'].join(',')];
  for (const r of rows) csv.push([r.v.id, r.v.kind, r.v.cond, r.v.th, r.v.pick, r.N, r.H, r.ev.dev.mean, r.ev.dev.t, r.ev.dev.n, r.ev.test.mean, r.ev.test.t, r.ev.test.n, r.evG.all.mean, r.dev.cagr, r.test.cagr, r.rnd?.dev.cagr ?? '', r.rnd?.test.cagr ?? '', r.pass ? 1 : 0].map((x) => (typeof x === 'number' ? +x.toFixed(5) : x)).join(','));
  writeFileSync(`${OUTDIR}/results.csv`, csv.join('\n'));
  writeFileSync(`${OUTDIR}/meta.json`, JSON.stringify({ generated: new Date().toISOString(), calendar: [cal[0], cal.at(-1)], dev: [cal[k0], cal[kDev]], test: [cal[kDev + 1], cal.at(-1)], stocks: syms.length, gics_agreement: [agree, cmp], signal_days: sigDays, configs: rows.length, passed: nPass }, null, 1));
  console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
