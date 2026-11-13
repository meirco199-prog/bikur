#!/usr/bin/env node
// אבחון הירידה של 52% במומנטום המשודרג, 7 מנות (בקשת מאיר 13/11/2026: "קודם אבחון מספרי של ה-52%, ורק אחר כך דמו").
// אבחון בלבד — אין כאן כלל חדש ואין כיוונון. אותה הרצה בדיוק כמו בסעיף 6 של research-xs-ra.mjs (xsRiskAdj, 7 מנות, 50 מטבעות, עלויות מלאות).
// 1. אפיזודות הירידה (שיא → שפל → התאוששות), והירידה הגדולה בתקופת האימות: חודש-חודש, חשיפה, תרומת כל מטבע.
// 2. האם המסנן אשם: אותו תזמון בדיוק (BTC מעל ממוצע 100 ביום ההחלפה של כל מנה) אבל רק BTC במקום המטבעות — "המסנן לבד".
//    ההפרש בין השיטה לבין "המסנן לבד" = מה שהמטבעות עשו. יציאות וכניסות של המסנן: כמה BTC כבר ירד/עלה עד שהמסנן הגיב.
// 3. MAE/MFE: לכל החזקה (מנה × מטבע, מהקנייה עד המכירה) — הירידה הגדולה ביותר נגדנו והעלייה הגדולה ביותר בדרך (לפי סגירות),
//    וחלוקת ההפסדים: "לא היה ברווח" (MFE < 5%) מול "היה ברווח של 10%+ והתהפך" — הספים נקבעו לפני ההרצה.
// שימוש: node invest-api/scripts/research-xs-ra-dd.mjs --data xsra-data.json.gz [--out report.md] [--json r.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { align, runDaily, dstats, xsRiskAdj, combineSleeves, XSRA } from '../engine/research-daily.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', 'xsra-data.json.gz'), OUT = arg('--out', ''), JOUT = arg('--json', '');
const DAY = 86400e3, DOWS = [0, 1, 2, 3, 4, 5, 6];
const d0 = JSON.parse(gunzipSync(readFileSync(DATA)));
for (const bars of Object.values(d0.bars)) for (const b of bars){ const lo = Math.min(b.o, b.c); if (b.l < 0.1 * lo) b.l = lo; }
const A = align(d0.bars), K = A.coins.length, iB = A.coins.indexOf('BTC'), D = A.days.length;
const iso = (t) => new Date(t).toISOString().slice(0, 10), ym = (t) => iso(t).slice(0, 7);
const pct = (x) => (x == null || !Number.isFinite(x) ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
const od = A.days.filter((t) => t < Date.UTC(2026, 10, 7)), at = (k) => od[Math.floor(od.length * k)];
const VAL = { from: at(0.6), to: at(0.8) };
const sma = (a, n, d) => { if (d < n - 1) return NaN; let s = 0; for (let i = d - n + 1; i <= d; i++){ if (!Number.isFinite(a[i])) return NaN; s += a[i]; } return s / n; };

// ---- השיטה (7 מנות) עם עקבות משקלות, ו"המסנן לבד" (BTC 100% כשהמסנן מאפשר, באותם ימי החלפה) ----
const sleeves = DOWS.map((w) => runDaily(A, xsRiskAdj(A.coins, { dow: w }), { drift: true, trace: true }).series);
const filterOnly = (dow) => ({ id: `F-${dow}`, weights: (AA, d, st) => {
  const reb = new Date(AA.days[d]).getUTCDay() === dow; if (st.w && !reb) return st.w;
  const w = new Array(K).fill(0); if (AA.C[iB][d] > sma(AA.C[iB], XSRA.smaMacro, d)) w[iB] = 1; return (st.w = w); } });
const fSleeves = DOWS.map((w) => runDaily(A, filterOnly(w), { drift: true }).series);
const strat = combineSleeves(sleeves), fonly = combineSleeves(fSleeves), btc = runDaily(A, { id: 'BH', weights: (AA, d) => A.coins.map((_, k) => (k === iB && Number.isFinite(AA.C[k][d]) ? 1 : 0)) }).series;
const eqOf = (sr) => { let e = 1; return sr.map((x) => (e *= 1 + x.net)); };
const E = eqOf(strat), EF = eqOf(fonly), EB = eqOf(btc), T = strat.map((x) => x.t);

// ---- 1. אפיזודות ירידה ----
function episodes(eq, t){
  const out = []; let pk = 0;
  for (let i = 1; i <= eq.length; i++){
    if (i === eq.length || eq[i] >= eq[pk]){
      if (i - pk > 1){ let tr = pk; for (let j = pk; j < i; j++) if (eq[j] < eq[tr]) tr = j; const depth = 1 - eq[tr] / eq[pk]; if (depth > 0.2) out.push({ peak: t[pk], trough: t[tr], rec: i < eq.length ? t[i] : null, depth, pi: pk, ti: tr }); }
      pk = i;
    }
  }
  return out.sort((a, b) => b.depth - a.depth);
}
const L = ['# אבחון הירידה של 52% — מומנטום משודרג, 7 מנות (50 מטבעות, עלויות מלאות)', '',
  'אבחון בלבד: אותה הרצה כמו בסעיף 6 של `research/xs-ra/report.md`, בלי כלל חדש ובלי כיוונון. "המסנן לבד" = אותו תזמון בדיוק (BTC מעל ממוצע 100 ביום ההחלפה של כל מנה), אבל מחזיקים רק BTC במקום המטבעות — ההפרש ביניהם הוא מה שהמטבעות עצמם עשו.', ''];
const eps = episodes(E, T);
L.push('## 1. הירידות הגדולות (מעל 20%), 2016–2026', '', '| שיא | שפל | עומק | ימים עד השפל | התאוששות | BTC באותו שיא→שפל | "המסנן לבד" באותו שיא→שפל |', '|---|---|---|---|---|---|---|');
for (const e of eps.slice(0, 8)) L.push(`| ${iso(e.peak)} | ${iso(e.trough)} | **${pct(-e.depth)}** | ${Math.round((e.trough - e.peak) / DAY)} | ${e.rec ? iso(e.rec) : 'עוד לא'} | ${pct(EB[e.ti] / EB[e.pi] - 1)} | ${pct(EF[e.ti] / EF[e.pi] - 1)} |`);
// הירידה הגדולה ביותר בתוך תקופת האימות (כמו ב-dstats: מתחילת התקופה)
const vi = T.map((t, i) => [t, i]).filter(([t]) => t >= VAL.from && t < VAL.to).map(([, i]) => i);
let vpk = vi[0], best = { depth: 0 };
for (const i of vi){ if (E[i] > E[vpk]) vpk = i; const dd = 1 - E[i] / E[vpk]; if (dd > best.depth) best = { depth: dd, pi: vpk, ti: i }; }
const ep = best, P0 = T[ep.pi], P1 = T[ep.ti];
let rec = null; for (let i = ep.ti; i < E.length; i++) if (E[i] >= E[ep.pi]){ rec = T[i]; break; }
L.push('', `## 2. הירידה בתקופת האימות: ${pct(-ep.depth)} — שיא ${iso(P0)}, שפל ${iso(P1)} (${Math.round((P1 - P0) / DAY)} ימים), התאוששות ${rec ? iso(rec) : 'עוד לא'}`, '');
L.push(`באותו שיא→שפל: **BTC ${pct(EB[ep.ti] / EB[ep.pi] - 1)}**, **"המסנן לבד" ${pct(EF[ep.ti] / EF[ep.pi] - 1)}**, השיטה ${pct(E[ep.ti] / E[ep.pi] - 1)}.`, '');
// חודש-חודש
const share = (i) => { const eqS = sleeves.map((s) => { let e = 1 / 7; for (let j = 0; j < i; j++) e *= 1 + s[j].net; return e; }); const tot = eqS.reduce((a, b) => a + b, 0); return eqS.map((x) => x / tot); };
const contrib = {}, monthly = {};
let shares = share(ep.pi);
for (let i = ep.pi + 1; i <= ep.ti; i++){
  const di = i + 1, m = ym(T[i]); monthly[m] ||= { s: 1, f: 1, b: 1, exp: 0, n: 0, alt: 0, btcW: 0, cash: 0 };
  const mm = monthly[m]; mm.s *= 1 + strat[i].net; mm.f *= 1 + fonly[i].net; mm.b *= 1 + btc[i].net; mm.exp += strat[i].exp; mm.n += 1; if (strat[i].exp < 0.01) mm.cash += 1;
  for (let j = 0; j < 7; j++){ const w = sleeves[j][i].w; for (let k = 0; k < K; k++) if (w[k]){ const g = A.C[k][di] / A.C[k][di - 1] - 1; if (Number.isFinite(g)){ contrib[A.coins[k]] = (contrib[A.coins[k]] || 0) + shares[j] * w[k] * g; } if (k === iB) mm.btcW += shares[j] * w[k]; else mm.alt += shares[j] * w[k]; } }
  shares = shares.map((x, j) => x * (1 + sleeves[j][i].net)); const tot = shares.reduce((a, b) => a + b, 0); shares = shares.map((x) => x / tot);
}
L.push('| חודש | השיטה | "המסנן לבד" | BTC | חשיפה ממוצעת | מזה מטבעות (לא BTC) | מזה BTC | ימים במזומן |', '|---|---|---|---|---|---|---|---|');
for (const [m, x] of Object.entries(monthly)) L.push(`| ${m} | ${pct(x.s - 1)} | ${pct(x.f - 1)} | ${pct(x.b - 1)} | ${Math.round(x.exp / x.n * 100)}% | ${Math.round(x.alt / x.n * 100)}% | ${Math.round(x.btcW / x.n * 100)}% | ${x.cash} |`);
const ce = Object.entries(contrib).sort((a, b) => a[1] - b[1]), totC = ce.reduce((a, [, v]) => a + v, 0);
L.push('', `**תרומת כל מטבע לירידה** (סכום תרומות יומיות, נקודות אחוז מההון; סך הכול ${pct(totC)}):`, '',
  '| הכי מזיקים | | הכי מועילים | |', '|---|---|---|---|');
const neg = ce.slice(0, 10), posi = ce.slice(-5).reverse();
for (let i = 0; i < Math.max(neg.length, posi.length); i++) L.push(`| ${neg[i] ? neg[i][0] : ''} | ${neg[i] ? pct(neg[i][1]) : ''} | ${posi[i] ? posi[i][0] : ''} | ${posi[i] ? pct(posi[i][1]) : ''} |`);
const altLoss = ce.filter(([c]) => c !== 'BTC').reduce((a, [, v]) => a + v, 0), btcPart = contrib.BTC || 0;
L.push('', `- מטבעות (לא BTC): ${pct(altLoss)} · BTC עצמו: ${pct(btcPart)}.`);

// ---- 3. המסנן: מתי הגיב ----
const flips = []; let prev = null;
for (let d = XSRA.smaMacro; d < D; d++){ const on = A.C[iB][d] > sma(A.C[iB], XSRA.smaMacro, d); if (prev !== null && on !== prev) flips.push({ d, on }); prev = on; }
L.push('', '## 3. המסנן (BTC מול ממוצע 100) — מתי הגיב, בתקופת האימות ובירידה', '',
  '| תאריך | מה קרה | BTC מהשיא של 60 הימים שלפני (ביציאה) / מהשפל (בכניסה) |', '|---|---|---|');
const win = (d) => A.days[d] >= VAL.from - 30 * DAY && A.days[d] < VAL.to;
let nf = 0;
for (const f of flips.filter((x) => win(x.d))){
  const look = A.C[iB].slice(Math.max(0, f.d - 60), f.d + 1), x = A.C[iB][f.d];
  const ref = f.on ? Math.min(...look) : Math.max(...look);
  L.push(`| ${iso(A.days[f.d])} | ${f.on ? 'כניסה (BTC עלה מעל הממוצע)' : 'יציאה למזומן (BTC ירד מתחת)'} | ${pct(x / ref - 1)} |`); nf += 1;
}
L.push('', `- ${nf} שינויי מצב של המסנן בתקופה. כל מנה בודקת את המסנן רק ביום ההחלפה שלה — כלומר עד 6 ימים של עיכוב נוסף.`);

// ---- 4. MAE / MFE לכל החזקה ----
const trades = [];
for (let j = 0; j < 7; j++){
  const s = sleeves[j], open = new Map();
  for (let i = 0; i < s.length; i++){
    const di = i + 1, w = s[i].w;
    for (let k = 0; k < K; k++){
      const held = w[k] > 0;
      if (held && !open.has(k)) open.set(k, { k, sleeve: j, i0: i, entry: A.O[k][di], lo: Infinity, hi: -Infinity });
      if (held){ const t = open.get(k), c = A.C[k][di]; if (Number.isFinite(c)){ t.lo = Math.min(t.lo, c); t.hi = Math.max(t.hi, c); } }
      if (!held && open.has(k)){ const t = open.get(k); open.delete(k); const ex = Number.isFinite(A.O[k][di]) ? A.O[k][di] : A.C[k][di - 1];
        trades.push({ coin: A.coins[k], sleeve: j, from: T[t.i0], to: T[i], days: i - t.i0, ret: ex / t.entry - 1, mae: Math.min(0, t.lo / t.entry - 1), mfe: Math.max(0, t.hi / t.entry - 1) }); }
    }
  }
}
const summ = (arr, lab) => {
  const n = arr.length, w = arr.filter((t) => t.ret > 0).length, losers = arr.filter((t) => t.ret < 0);
  const never = losers.filter((t) => t.mfe < 0.05), gave = losers.filter((t) => t.mfe >= 0.10), med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
  const sumL = losers.reduce((a, t) => a + t.ret, 0);
  return `| ${lab} | ${n} | ${n ? Math.round(w / n * 100) : 0}% | ${pct(med(arr.map((t) => t.ret)))} | ${pct(med(arr.map((t) => t.mae)))} | ${pct(med(losers.map((t) => t.mae)))} | ${losers.length ? Math.round(never.length / losers.length * 100) : 0}% (${losers.length ? Math.round(never.reduce((a, t) => a + t.ret, 0) / sumL * 100) : 0}% מההפסד) | ${losers.length ? Math.round(gave.length / losers.length * 100) : 0}% (${losers.length ? Math.round(gave.reduce((a, t) => a + t.ret, 0) / sumL * 100) : 0}% מההפסד) |`;
};
const inEp = trades.filter((t) => t.to > P0 && t.from < P1), inVal = trades.filter((t) => t.from >= VAL.from && t.from < VAL.to);
L.push('', '## 4. כמה כל החזקה ירדה נגדנו לפני שנמכרה (MAE) ועלתה בדרך (MFE)', '',
  'החזקה = מנה × מטבע, מהקנייה עד המכירה (מחיר פתיחה; הירידה/העלייה בדרך לפי סגירות). "לא היה ברווח" = הפסידה ולא עלתה בדרך יותר מ-5%; "התהפכה" = הפסידה אחרי שהייתה ברווח של 10% ומעלה (ספים שנקבעו לפני ההרצה).', '',
  '| קבוצה | החזקות | הצלחה | חציון תוצאה | חציון MAE | חציון MAE בהפסדות | הפסדות "לא היה ברווח" | הפסדות "התהפכה" |', '|---|---|---|---|---|---|---|---|');
L.push(summ(trades, 'כל 2016–2026'), summ(inVal, 'נפתחו בתקופת האימות'), summ(inEp, `בתוך הירידה (${iso(P0)}→${iso(P1)})`));
L.push('', `**15 ההחזקות הגרועות בתוך הירידה:**`, '', '| מטבע | מנה | קנייה | מכירה | ימים | תוצאה | MAE | MFE |', '|---|---|---|---|---|---|---|---|');
for (const t of inEp.slice().sort((a, b) => a.ret - b.ret).slice(0, 15)) L.push(`| ${t.coin} | ${t.sleeve} | ${iso(t.from)} | ${iso(t.to)} | ${t.days} | ${pct(t.ret)} | ${pct(t.mae)} | ${pct(t.mfe)} |`);

// ---- 5. סיכום מספרי ----
const vs = dstats(strat, VAL), vf = dstats(fonly, VAL), vb = dstats(btc, VAL);
L.push('', '## 5. תקופת האימות כולה — השיטה מול "המסנן לבד" מול BTC', '', '| | תשואה שנתית | שארפ | ירידה מקס׳ | חשיפה |', '|---|---|---|---|---|');
for (const [lab, s] of [['השיטה (7 מנות)', vs], ['"המסנן לבד" (רק BTC, אותו תזמון)', vf], ['BTC קנה והחזק', vb]]) L.push(`| ${lab} | ${pct(s.cagr)} | ${s.sharpe?.toFixed(2)} | ${pct(-s.maxDD)} | ${Math.round(s.exposure * 100)}% |`);
const res = { episode: { peak: iso(P0), trough: iso(P1), depth: ep.depth, rec: rec ? iso(rec) : null, btc: EB[ep.ti] / EB[ep.pi] - 1, filterOnly: EF[ep.ti] / EF[ep.pi] - 1 }, monthly, contrib, val: { strat: vs, filterOnly: vf, btc: vb }, trades: trades.length };
const md = L.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md); if (JOUT) writeFileSync(JOUT, JSON.stringify(res, null, 1));
