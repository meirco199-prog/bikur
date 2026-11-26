// מחקר מסחר יומי (פרוטוקול v1.1): ניתוח הרשומות → טבלאות מצטברות (שלב ב', שלב ג', שילובי מסננים, ברמת החשבון, Walk-Forward).
// פונקציות טהורות; בלי נתוני מחיר גולמיים בפלט.
import { STRATS, VARIANTS, commission } from '../engine/daytrading.js';

export const period = (key) => key <= 20221231 ? 'dev' : key <= 20241231 ? 'val' : 'test';
export const TREND = Object.freeze({ none: () => true, ma20: (f) => f.aboveMa20 === 1, ma50: (f) => f.aboveMa50 === 1, ma20up: (f) => f.ma20Rising === 1 });
const HE_S = { pullback: 'משיכה במגמה', breakout_retest: 'פריצה ובדיקה חוזרת', reversal: 'היפוך עם אישור', orb: 'פריצת טווח הפתיחה', vwap_reclaim: 'חזרה מעל VWAP', momentum_rvol: 'מומנטום ומחזור חריג' };
const HE_T = { none: 'בלי מסנן', ma20: 'מעל MA20', ma50: 'מעל MA50', ma20up: 'MA20 עולה' };
const RISK = 500;

// מדדים לרשימת עסקאות [{key, pnl}]; bootstrap לפי ימי מסחר (חד-צדדי: P(ממוצע ≤ 0))
export function metrics(trades, { boot = 0, seed = 7 } = {}){
  const n = trades.length; if (!n) return { n: 0 };
  let sum = 0, win = 0, gp = 0, gl = 0, sq = 0;
  for (const t of trades){ sum += t.pnl; if (t.pnl > 0){ win++; gp += t.pnl; } else gl -= t.pnl; }
  const mean = sum / n; for (const t of trades) sq += (t.pnl - mean) ** 2;
  const sd = n > 1 ? Math.sqrt(sq / (n - 1)) : 0;
  const out = { n, win: win / n, exp: mean, expR: mean / RISK, pf: gl > 0 ? gp / gl : (gp > 0 ? Infinity : 0), t: sd > 0 ? mean / (sd / Math.sqrt(n)) : 0, sum };
  if (boot > 0){
    const byDay = new Map(); for (const t of trades) byDay.set(t.key, (byDay.get(t.key) || 0) + t.pnl);
    const d = [...byDay.values()], D = d.length; let s = seed, le = 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let b = 0; b < boot; b++){ let tot = 0; for (let i = 0; i < D; i++) tot += d[Math.floor(rnd() * D)]; if (tot <= 0) le++; }
    out.pBoot = (le + 1) / (boot + 1); out.days = D;
  }
  return out;
}
export function holm(ps){ // מחזיר p מתוקנים באותו סדר
  const idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]), m = ps.length, adj = new Array(m); let run = 0;
  idx.forEach(([p, i], r) => { run = Math.max(run, Math.min(1, (m - r) * p)); adj[i] = run; });
  return adj;
}
export function bh(ps){
  const idx = ps.map((p, i) => [p, i]).sort((a, b) => a[0] - b[0]), m = ps.length, adj = new Array(m); let run = 1;
  for (let r = m - 1; r >= 0; r--){ const [p, i] = idx[r]; run = Math.min(run, p * m / (r + 1)); adj[i] = run; }
  return adj;
}
const fmt$ = (x) => !Number.isFinite(x) ? '—' : (x < 0 ? '‎−' : '+') + Math.abs(Math.round(x)).toLocaleString('en-US') + '$';
const f2 = (x) => Number.isFinite(x) ? x.toFixed(2) : (x === Infinity ? '∞' : '—');
const pct = (x) => Number.isFinite(x) ? (x * 100).toFixed(0) + '%' : '—';
const pv = (x) => !Number.isFinite(x) ? '—' : x < 0.001 ? '<0.001' : x.toFixed(3);
const row = (m) => m.n ? `${m.n} | ${pct(m.win)} | ${fmt$(m.exp)} | ${f2(m.expR)} | ${f2(m.pf)} | ${f2(m.t)}` : '0 | — | — | — | — | —';

const val = (r, vi, col) => r.v[vi * 6 + col]; // col: 0 stop, 1 netF, 2 netV, 3 gross, 4 holdMin, 5 kind
const tr = (rs, vi = 0, col = 1) => rs.filter((r) => Number.isFinite(val(r, vi, col))).map((r) => ({ key: r.key, pnl: val(r, vi, col) }));

// ---------- ברמת החשבון ----------
// רשומות עם bases[vi]; חשבון 100K$, בלי מינוף; סיכון riskPct מהשווי; תקרה capPct; עד maxPos; מגבלה יומית: null / 'pct1' / 'two'
export function portfolio(recs, vi, { riskPct = 0.005, capPct = 0.2, maxPos = 5, daily = null, start = 100000 } = {}){
  const ev = recs.filter((r) => r.bases && r.bases[vi]).sort((a, b) => a.tEntry - b.tEntry || (b.f.rvol || 0) - (a.f.rvol || 0));
  let eq = start, cash = start, peak = start, mdd = 0, rejected = 0, taken = 0, expoSum = 0, expoMax = 0;
  const open = [], dayEq = new Map(); let curDay = null, dayStartEq = start, dayPnl = 0, dayLosses = 0;
  const settle = (upTo) => {
    open.sort((a, b) => a.tExit - b.tExit);
    while (open.length && open[0].tExit <= upTo){ const p = open.shift(); cash += p.notional + p.pnl; eq += p.pnl; dayPnl += p.pnl; if (p.pnl < 0) dayLosses++; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); dayEq.set(p.key, eq); }
  };
  for (const r of ev){
    settle(r.tEntry);
    if (r.key !== curDay){ curDay = r.key; dayStartEq = eq; dayPnl = 0; dayLosses = 0; }
    if (daily === 'pct1' && dayPnl <= -0.01 * dayStartEq){ rejected++; continue; }
    if (daily === 'two' && dayLosses >= 2){ rejected++; continue; }
    if (open.length >= maxPos){ rejected++; continue; }
    const b = r.bases[vi], entry = r.f.entry, R = entry - b.stop;
    let sh = Math.floor(Math.min(riskPct * eq / R, capPct * eq / entry, cash / entry));
    if (sh < 1){ rejected++; continue; }
    const bps = 3.5e-4, nEx = Math.max(1, b.nOrd - 1);
    const pnl = sh * b.g - sh * entry * bps - sh * b.xm * bps - commission(sh, entry) - nEx * commission(Math.ceil(sh / nEx), entry);
    const notional = sh * entry; cash -= notional; taken++; const ex = (eq - cash) / eq; expoSum += ex; expoMax = Math.max(expoMax, ex);
    open.push({ tExit: b.tExit, pnl, notional, key: r.key });
  }
  settle(Infinity);
  const keys = [...dayEq.keys()].sort((a, b) => a - b); let prev = start; const rets = [];
  for (const k of keys){ const e = dayEq.get(k); rets.push(e / prev - 1); prev = e; }
  const mean = rets.reduce((a, x) => a + x, 0) / (rets.length || 1), sd = Math.sqrt(rets.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  const yrs = ev.length ? (Math.floor(ev[ev.length - 1].key / 10000) - Math.floor(ev[0].key / 10000) + 1) : 1;
  return { taken, rejected, total: eq / start - 1, cagr: (eq / start) ** (1 / yrs) - 1, mdd, sharpe: sd > 0 ? mean / sd * Math.sqrt(252) : 0, avgExpo: taken ? expoSum / taken : 0, maxExpo: expoMax, years: yrs };
}

// ---------- הניתוח ----------
export function analyze(recs, vnames, { phase = 'run1', universe = {}, cands = [] } = {}){
  const md = [], json = { phase, protocol: 'v1.1', nRecords: recs.length };
  const base = recs.filter((r) => r.start === '1000');
  const by = (s, tf, per) => base.filter((r) => r.s === s && TREND[tf](r.f) && period(r.key) === per);
  md.push(`# מחקר מסחר יומי — ${phase === 'run1' ? 'הרצה 1: פיתוח 2018–2022 ואימות 2023–2024' : 'הרצה סופית: מבחן 01/2025–13/10/2026'}`, '',
    `פרוטוקול v1.1. ${recs.length.toLocaleString('en-US')} אותות. מצב מחקר: סיכון 500$ לעסקה, תקרה 20,000$. כל הסכומים אחרי עמלות IBKR, מרווח והחלקה (מודל קבוע).`, '');
  // ---- שלב ב' ----
  const B = [];
  for (let s = 0; s < STRATS.length; s++) for (const tf of Object.keys(TREND)){
    const dev = metrics(tr(by(s, tf, 'dev')), { boot: 10000 }), v = metrics(tr(by(s, tf, 'val')));
    const reg = {}; for (const [k, x] of [['up', 1], ['flat', 0], ['down', -1]]) reg[k] = metrics(tr(base.filter((r) => r.s === s && TREND[tf](r.f) && r.f.regime === x && period(r.key) !== 'test')));
    const years = {}; for (const r of base.filter((r) => r.s === s && TREND[tf](r.f))){ const y = Math.floor(r.key / 10000); (years[y] ||= []).push({ key: r.key, pnl: val(r, 0, 1) }); }
    const devV = metrics(tr(by(s, tf, 'dev'), 0, 2));
    B.push({ s: STRATS[s], tf, dev, val: v, reg, devVar: devV, years: Object.fromEntries(Object.entries(years).map(([y, a]) => [y, metrics(a)])) });
  }
  const adj = holm(B.map((b) => b.dev.pBoot ?? 1)); B.forEach((b, i) => { b.dev.pHolm = adj[i]; });
  json.stageB = B;
  md.push('## שלב ב\' — שש אסטרטגיות × ארבעה מסנני מגמה (תצורת בסיס: כניסה מ-10:00, סטופ מבני, יעד 2R, סוף יום)', '',
    '| אסטרטגיה | מסנן | פיתוח: עסקאות | הצלחה | תוחלת | R | PF | t | p (bootstrap) | p אחרי Holm | אימות: עסקאות | הצלחה | תוחלת | R | PF | t |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const b of B) md.push(`| ${HE_S[b.s]} | ${HE_T[b.tf]} | ${row(b.dev)} | ${pv(b.dev.pBoot)} | ${pv(b.dev.pHolm)} | ${row(b.val)} |`);
  md.push('', '**לפי משטר שוק (פיתוח + אימות), תוחלת לעסקה ו-PF:**', '', '| אסטרטגיה | מסנן | עלייה | דשדוש | ירידה |', '|---|---|---|---|---|');
  for (const b of B) md.push(`| ${HE_S[b.s]} | ${HE_T[b.tf]} | ${fmt$(b.reg.up.exp)} / ${f2(b.reg.up.pf)} (${b.reg.up.n}) | ${fmt$(b.reg.flat.exp)} / ${f2(b.reg.flat.pf)} (${b.reg.flat.n}) | ${fmt$(b.reg.down.exp)} / ${f2(b.reg.down.pf)} (${b.reg.down.n}) |`);
  // מסנן נכנס רק אם משפר t בפיתוח וגם תוחלת באימות מול אותה אסטרטגיה בלי מסנן
  const pass = B.filter((b) => b.dev.pf >= 1.1 && b.dev.exp > 0 && (b.tf === 'none' || (b.dev.t > B.find((x) => x.s === b.s && x.tf === 'none').dev.t && b.val.exp > B.find((x) => x.s === b.s && x.tf === 'none').val.exp)));
  let sel = [...pass].sort((a, b) => b.dev.t - a.dev.t).slice(0, 3), noBasis = false;
  if (!sel.length){ sel = [...B].sort((a, b) => b.dev.t - a.dev.t).slice(0, 2); noBasis = true; }
  json.selectedForC = sel.map((b) => ({ s: b.s, tf: b.tf })); json.noBasis = noBasis;
  md.push('', `**עברו לשלב ג':** ${sel.map((b) => `${HE_S[b.s]} (${HE_T[b.tf]})`).join(', ')}${noBasis ? ' — **אף צירוף לא עמד ב-PF ≥ 1.1 ותוחלת חיובית בפיתוח; שתי הטובות לפי t, "בלי בסיס"**' : ''}.`, '');
  // ---- שלב ג' ----
  json.stageC = [];
  for (const b of sel){
    const s = STRATS.indexOf(b.s), rsDev = by(s, b.tf, 'dev'), rsVal = by(s, b.tf, 'val');
    md.push(`## שלב ג' — ${HE_S[b.s]} (${HE_T[b.tf]})`, '', '| גרסה | פיתוח: עסקאות | הצלחה | תוחלת | R | PF | t | אימות: תוחלת | PF | מרוויחות הבסיס שהרוויחו פחות | תוחלת מרוויחות הבסיס (בסיס → גרסה) | מפסידות הבסיס שהשתפרו | זמן החזקה חציוני (דק\') |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    const C = [];
    vnames.forEach((vn, vi) => {
      if (phase === 'final' && vi >= VARIANTS.length) return;
      const d = metrics(tr(rsDev, vi)), v = metrics(tr(rsVal, vi));
      const both = rsDev.filter((r) => Number.isFinite(val(r, 0, 1)) && Number.isFinite(val(r, vi, 1)));
      const W = both.filter((r) => val(r, 0, 1) > 0), L = both.filter((r) => val(r, 0, 1) <= 0);
      const hurt = W.length ? W.filter((r) => val(r, vi, 1) < val(r, 0, 1) - 0.5).length / W.length : NaN;
      const wb = W.length ? W.reduce((a, r) => a + val(r, 0, 1), 0) / W.length : NaN, wv = W.length ? W.reduce((a, r) => a + val(r, vi, 1), 0) / W.length : NaN;
      const helped = L.length ? L.filter((r) => val(r, vi, 1) > val(r, 0, 1) + 0.5).length / L.length : NaN;
      const holds = rsDev.map((r) => val(r, vi, 4)).filter(Number.isFinite).sort((a, b) => a - b);
      const row2 = { v: vn, dev: d, val: v, hurtWinners: hurt, winnersBase: wb, winnersVar: wv, helpedLosers: helped, holdMed: holds[Math.floor(holds.length / 2)] };
      C.push(row2);
      md.push(`| ${vn} | ${row(d)} | ${fmt$(v.exp)} | ${f2(v.pf)} | ${pct(hurt)} | ${fmt$(wb)} → ${fmt$(wv)} | ${pct(helped)} | ${Math.round(row2.holdMed ?? NaN)} |`);
    });
    // שעת כניסה
    for (const st of ['0945', '1030']){
      const rs = recs.filter((r) => r.start === st && r.s === s && TREND[b.tf](r.f));
      const d = metrics(tr(rs.filter((r) => period(r.key) === 'dev'))), v = metrics(tr(rs.filter((r) => period(r.key) === 'val')));
      C.push({ v: 'start_' + st, dev: d, val: v }); md.push(`| start_${st} | ${row(d)} | ${fmt$(v.exp)} | ${f2(v.pf)} | | | | |`);
    }
    // עלויות משתנות לבסיס
    const dv = metrics(tr(rsDev, 0, 2)), vv = metrics(tr(rsVal, 0, 2));
    md.push(`| base, עלויות משתנות | ${row(dv)} | ${fmt$(vv.exp)} | ${f2(vv.pf)} | | | | |`, '');
    // בחירה לכל ממד: t הגבוה בפיתוח, לפחות 300 עסקאות
    const dims = { start: ['base', 'start_0945', 'start_1030'], stop: ['base', 'stop_atr1', 'stop_atr1.5', 'stop_atr2'], target: ['base', 'tgt_1R', 'tgt_1.5R', 'tgt_3R', 'tgt_none'],
      protect: ['base', 'be_0.5%', 'be_1%', 'be_1.5%', 'be_2%', 'lock_steps', 'trail_0.5%', 'trail_1%', 'trail_1.5%', 'trail_atr1', 'trail_atr1.5', 'trail_atr2', 'partial_1R'],
      time: ['base', 'time_30m', 'time_1h', 'time_2h', 'time_4h'] };
    const pick = Object.fromEntries(Object.entries(dims).map(([k, opts]) => [k, opts.map((o) => C.find((c) => c.v === o)).filter((c) => c && c.dev.n >= 300).sort((a, b) => b.dev.t - a.dev.t)[0]?.v || 'base']));
    md.push(`**הבחירה לפי t בפיתוח (לפחות 300 עסקאות):** ${Object.entries(pick).map(([k, x]) => `${k}: ${x}`).join(' · ')}. החזקה ללילה היא קבוצת השוואה בלבד.`, '');
    // שילובי מסננים (32)
    const FL = ['aboveMa20', 'aboveVwap', 'rvol15', 'qqqAboveMa20', 'qqqAboveVwap'], test = { aboveMa20: (f) => f.aboveMa20 === 1, aboveVwap: (f) => f.aboveVwap === 1, rvol15: (f) => f.rvol >= 1.5, qqqAboveMa20: (f) => f.qqqAboveMa20 === 1, qqqAboveVwap: (f) => f.qqqAboveVwap === 1 };
    const combos = [];
    for (let mask = 0; mask < 32; mask++){
      const on = FL.filter((_, i) => mask & (1 << i)), ok = (r) => on.every((k) => test[k](r.f));
      const d = metrics(tr(rsDev.filter(ok)), { boot: 2000 }), v = metrics(tr(rsVal.filter(ok)));
      combos.push({ on, dev: d, val: v });
    }
    const q = bh(combos.map((c) => c.dev.pBoot ?? 1)); combos.forEach((c, i) => { c.dev.qBH = q[i]; });
    md.push('**שילובי מסננים בזמן הכניסה — 8 הטובים לפי t בפיתוח (מתוך 32), עם אישור באימות:**', '', '| מסננים | פיתוח: עסקאות | הצלחה | תוחלת | R | PF | t | q (BH) | אימות: עסקאות | תוחלת | PF | עובר אימות |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const c of [...combos].filter((c) => c.dev.n >= 100).sort((a, b) => b.dev.t - a.dev.t).slice(0, 8)) md.push(`| ${c.on.join(' + ') || 'בלי'} | ${row(c.dev)} | ${pv(c.dev.qBH)} | ${c.val.n} | ${fmt$(c.val.exp)} | ${f2(c.val.pf)} | ${c.val.exp > 0 && c.val.pf >= 1.1 ? 'כן' : 'לא'} |`);
    md.push('');
    // ברמת החשבון (בסיס)
    const pf = {}; for (const per of ['dev', 'val']){ const rs = (per === 'dev' ? rsDev : rsVal); pf[per] = portfolio(rs, 0); }
    md.push(`**ברמת החשבון (תצורת בסיס, 100,000$, סיכון 0.5%, תקרה 20%, עד 5 פוזיציות):** פיתוח — תשואה כוללת ${pct(pf.dev.total)}, שנתית ${pct(pf.dev.cagr)}, ירידה מקסימלית ${pct(pf.dev.mdd)}, Sharpe ${f2(pf.dev.sharpe)}, חשיפה ממוצעת ${pct(pf.dev.avgExpo)} (מקסימום ${pct(pf.dev.maxExpo)}), נדחו ${pf.dev.rejected}. אימות — תשואה ${pct(pf.val.total)}, שנתית ${pct(pf.val.cagr)}, ירידה ${pct(pf.val.mdd)}, Sharpe ${f2(pf.val.sharpe)}, נדחו ${pf.val.rejected}.`, '');
    const grid = [];
    for (const riskPct of [0.0025, 0.005, 0.01]) for (const capPct of [0.1, 0.2, 0.3]) for (const daily of [null, 'pct1', 'two']) grid.push({ riskPct, capPct, daily, ...portfolio(rsVal, 0, { riskPct, capPct, daily }) });
    json.stageC.push({ s: b.s, tf: b.tf, variants: C, pick, combos, portfolio: pf, portfolioGridVal: grid });
  }
  // ברמת החשבון לכל אסטרטגיה בבסיס, בלי מסנן
  md.push('## ברמת החשבון — כל אסטרטגיה בתצורת הבסיס, בלי מסנן (100,000$, סיכון 0.5%, תקרה 20%, עד 5 פוזיציות)', '', '| אסטרטגיה | פיתוח: תשואה כוללת | שנתית | ירידה מקס\' | Sharpe | עסקאות | נדחו | אימות: תשואה כוללת | שנתית | ירידה מקס\' | Sharpe |', '|---|---|---|---|---|---|---|---|---|---|---|');
  json.portfolioBase = {};
  for (let s = 0; s < STRATS.length; s++){
    const d = portfolio(by(s, 'none', 'dev'), 0), v = portfolio(by(s, 'none', 'val'), 0); json.portfolioBase[STRATS[s]] = { dev: d, val: v };
    md.push(`| ${HE_S[STRATS[s]]} | ${pct(d.total)} | ${pct(d.cagr)} | ${pct(d.mdd)} | ${f2(d.sharpe)} | ${d.taken} | ${d.rejected} | ${pct(v.total)} | ${pct(v.cagr)} | ${pct(v.mdd)} | ${f2(v.sharpe)} |`);
  }
  md.push('', '_החזקה ללילה ומגבלות זמן — בטבלאות שלב ג\'. כל הנתונים הגולמיים במטמון הפרטי בלבד; כאן רק מדדים מצטברים._');
  // הרצה סופית: מבחן ו-Walk-Forward
  if (phase === 'final' && cands.length){
    json.final = [];
    md.push('', '## המבחן הסופי (נפתח פעם אחת)', '', '| מועמדת | תקופה | עסקאות | הצלחה | תוחלת | R | PF | t | p (bootstrap) |', '|---|---|---|---|---|---|---|---|---|');
    cands.forEach((c, ci) => {
      const vi = VARIANTS.length + ci, s = STRATS.indexOf(c.strategy), flt = (r) => (c.filters || []).every((k) => r.f[k] === 1) && (c.rvolMin == null || r.f.rvol >= c.rvolMin);
      const rs = base.filter((r) => r.s === s && flt(r));
      const res = {};
      for (const per of ['dev', 'val', 'test']) res[per] = metrics(tr(rs.filter((r) => period(r.key) === per), vi), { boot: 10000 });
      const oos = metrics(tr(rs.filter((r) => period(r.key) !== 'dev'), vi), { boot: 10000 });
      const oosVar = metrics(tr(rs.filter((r) => period(r.key) !== 'dev'), vi, 2));
      const pfs = { val: portfolio(rs.filter((r) => period(r.key) === 'val'), vi), test: portfolio(rs.filter((r) => period(r.key) === 'test'), vi) };
      json.final.push({ cand: c, res, oos, oosVar, portfolio: pfs });
      for (const per of ['dev', 'val', 'test']) md.push(`| ${c.name} | ${per} | ${row(res[per])} | ${pv(res[per].pBoot)} |`);
      md.push(`| ${c.name} | מחוץ למדגם | ${row(oos)} | ${pv(oos.pBoot)} |`, `| ${c.name} | מחוץ למדגם, עלויות משתנות | ${row(oosVar)} | |`);
    });
  }
  return { md: md.join('\n') + '\n', json };
}
