#!/usr/bin/env node
// דולר-שקל לפי נאסד"ק — מחקר בלבד (אין פקודות, אין כסף). פרוטוקול נעול: invest/docs/research/usdils-nq/PROTOCOL_v1.0.md. הרצה אחת.
// שימוש: node invest-api/scripts/research-usdils-nq.mjs --outdir invest/docs/research/usdils-nq
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const log = (...a) => console.error(...a), H = 3600e3, DAY = 86400e3, WEEK = 7 * DAY;
export const COST = 0.02, COSTS = [0, 0.02, 0.05], SEED = 20261124, REPS = 5000;
export const VARIANTS = Object.freeze([0, 0.5].flatMap((th) => ['a', 'b', 'c'].map((h) => ({ k: `th${th}-${h}`, th, h,
  he: `${th ? `אות מעל ${th}%` : 'רק כיוון'} · יציאה ${h === 'a' ? '10:00 ניו יורק' : h === 'b' ? '16:00 ניו יורק (סגירה)' : '09:00 למחרת'}` }))));

// ---------- זמנים ----------
const parts = (t, tz) => Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
const offset = (t, tz) => { const p = parts(t, tz); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(t / 60e3) * 60e3; };
// שעון קיר באזור זמן → מילישניות UTC
export function zoned(y, mo, d, h, mi, tz){
  let t = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 3; i++) t = Date.UTC(y, mo - 1, d, h, mi) - offset(t, tz);
  return t;
}
const ymd = (t, tz) => { const p = parts(t, tz); return { y: +p.year, mo: +p.month, d: +p.day, wd: p.weekday }; };
const isWeekday = (wd) => !['Sat', 'Sun'].includes(wd);

// ---------- מחיר בזמן T: סגירת הנר האחרון שהסתיים עד T, לכל היותר maxStale לפני ----------
// series: { t: [התחלת נר, ms], c: [סגירה] } ממוין; אורך נר = 1 שעה
export function priceAt(s, T, maxStale = 2 * H){
  let lo = 0, hi = s.t.length - 1, k = -1;
  while (lo <= hi){ const m = (lo + hi) >> 1; if (s.t[m] + H <= T){ k = m; lo = m + 1; } else hi = m - 1; }
  if (k < 0 || T - (s.t[k] + H) > maxStale) return null;
  return s.c[k];
}

// ---------- ימים: אות, כניסה ויציאות ----------
export function buildDays(nq, fx){
  const out = [], first = Math.max(nq.t[0], fx.t[0]), last = Math.min(nq.t.at(-1), fx.t.at(-1));
  for (let day = Math.floor(first / DAY) * DAY + DAY; day <= last; day += DAY){
    const il = ymd(day + 12 * H, 'Asia/Jerusalem'); if (!isWeekday(il.wd)) continue;
    const M = zoned(il.y, il.mo, il.d, 9, 0, 'Asia/Jerusalem');
    // הסגירה האחרונה בארה"ב לפני M
    let C = null;
    for (let b = 1; b <= 5 && C == null; b++){
      const u = ymd(M - b * DAY, 'America/New_York'); if (!isWeekday(u.wd)) continue;
      const c = zoned(u.y, u.mo, u.d, 16, 0, 'America/New_York'); if (c < M && priceAt(nq, c, 3 * H) != null) C = c;
    }
    if (C == null) continue;
    const nqC = priceAt(nq, C, 3 * H), nqM = priceAt(nq, M), fxC = priceAt(fx, C, 3 * H), fxM = priceAt(fx, M);
    if (![nqC, nqM, fxC, fxM].every((x) => x > 0)) continue;
    const ny = ymd(M, 'America/New_York');
    const Ea = zoned(ny.y, ny.mo, ny.d, 10, 0, 'America/New_York'), Eb = zoned(ny.y, ny.mo, ny.d, 16, 0, 'America/New_York');
    let Ec = null; for (let b = 1; b <= 4 && Ec == null; b++){ const n = ymd(M + b * DAY, 'Asia/Jerusalem'); if (isWeekday(n.wd)) Ec = zoned(n.y, n.mo, n.d, 9, 0, 'Asia/Jerusalem'); }
    const ex = { a: priceAt(fx, Ea), b: priceAt(fx, Eb), c: Ec != null ? priceAt(fx, Ec) : null };
    const nqx = { a: priceAt(nq, Ea), b: priceAt(nq, Eb), c: Ec != null ? priceAt(nq, Ec) : null };
    out.push({ t: M, S: nqM / nqC - 1, fxOvernight: fxM / fxC - 1, fxM, ex, nqM, nqx });
  }
  return out;
}

// ---------- גרסה → עסקאות. sg = +1 קנייה של דולר (נאסד"ק ירד), −1 מכירה ----------
export function trades(days, v){
  const out = [];
  for (const d of days){
    const th = v.th / 100; if (!(Math.abs(d.S) > th) || d.S === 0) continue;
    const px = d.ex[v.h]; if (!(px > 0)) continue;
    const sg = d.S < 0 ? 1 : -1, r = sg * (px / d.fxM - 1) * 100;
    out.push({ t: d.t, sg, gross: r });
  }
  return out;
}
const net = (x, c) => x.gross - 2 * c;
export function rng(seed){ let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let x = s; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
export function stats(tr, c = COST){
  const v = tr.map((x) => net(x, c)), n = v.length, m = n ? v.reduce((a, b) => a + b, 0) / n : NaN;
  const sd = n > 1 ? Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1)) : NaN;
  return { n, mean: m, t: n > 1 && sd > 0 ? m / (sd / Math.sqrt(n)) : NaN, hit: n ? v.filter((x) => x > 0).length / n : NaN, sum: v.reduce((a, b) => a + b, 0) };
}
export function blockBoot(tr, c = COST, reps = REPS, seed = SEED){
  const wk = new Map(); for (const x of tr){ const w = Math.floor(x.t / WEEK); const b = wk.get(w) || { s: 0, n: 0 }; b.s += net(x, c); b.n++; wk.set(w, b); }
  const B = [...wk.values()], R = rng(seed), m = [];
  if (B.length < 5) return { lo: NaN, hi: NaN };
  for (let r = 0; r < reps; r++){ let s = 0, n = 0; for (let i = 0; i < B.length; i++){ const b = B[Math.floor(R() * B.length)]; s += b.s; n += b.n; } m.push(s / n); }
  m.sort((a, b) => a - b); return { lo: m[Math.floor(0.025 * reps)], hi: m[Math.floor(0.975 * reps)] };
}
export function corr(a, b){
  const n = Math.min(a.length, b.length); if (n < 3) return NaN;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < n; i++){ sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
}
export function decide(tr, split){
  const s = stats(tr), h1 = stats(tr.filter((x) => x.t < split)), h2 = stats(tr.filter((x) => x.t >= split)), b = blockBoot(tr);
  const c1 = h1.mean > 0 && h2.mean > 0, c2 = s.t >= 3, c3 = b.lo > 0;
  return { s, h1, h2, b, c1, c2, c3, pass: c1 && c2 && c3 };
}

// ---------- נתונים ----------
async function get(url){ for (let i = 0; i < 4; i++){ try { const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }); if (r.ok) return await r.text(); log(url, r.status); } catch (e) { log(url, e.message); } await new Promise((r) => setTimeout(r, 2000 * (i + 1))); } return null; }
async function yahoo(sym, interval, p1){
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${Math.floor(Date.now() / 1000)}&interval=${interval}`);
  const r = JSON.parse(j).chart.result[0], q = r.indicators.quote[0], t = [], c = [];
  (r.timestamp || []).forEach((ts, i) => { if (q.close[i] > 0){ t.push(ts * 1000); c.push(q.close[i]); } });
  return { t, c };
}

const fp = (x, d = 3) => (Number.isFinite(x) ? `${x >= 0 ? '+' : '‎−'}${Math.abs(x).toFixed(d)}%` : '—');
const ft = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—'), fpc = (x) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '—');

async function main(){
  const OUTDIR = arg('--outdir', 'invest/docs/research/usdils-nq'), now = Math.floor(Date.now() / 1000);
  const nq = await yahoo('NQ=F', '60m', now - 729 * 86400), fx = await yahoo('ILS=X', '60m', now - 729 * 86400);
  log(`NQ=F: ${nq.t.length} נרות, ILS=X: ${fx.t.length} נרות`);
  if (nq.t.length < 3000 || fx.t.length < 3000) throw new Error('חסרים נתונים שעתיים');
  const days = buildDays(nq, fx), split = days[Math.floor(days.length / 2)].t;
  const md = ['# דולר-שקל לפי נאסד"ק — בדיקה לאחור', '', `פרוטוקול נעול: [\`PROTOCOL_v1.0.md\`](PROTOCOL_v1.0.md). הרצה אחת. נתונים שעתיים מ-Yahoo: ${new Date(days[0].t).toISOString().slice(0, 10)} → ${new Date(days.at(-1).t).toISOString().slice(0, 10)}, ${days.length} ימים. חצי שני מ-${new Date(split).toISOString().slice(0, 10)}. עלות ראשית: ${COST}% לכל צד.`, ''];
  // תיאור
  const dn = days.filter((d) => d.nqx.b > 0 && d.ex.b > 0);
  md.push('## 1. תיאור (לא להכרעה)', '',
    `- **בלילה (מהסגירה בארה"ב עד 09:00 בישראל):** מתאם בין החוזים על נאסד"ק לדולר-שקל = **${ft(corr(days.map((d) => d.S), days.map((d) => d.fxOvernight)))}** (${days.length} ימים). שלילי = כשנאסד"ק יורד הדולר עולה — באותן שעות.`,
    `- **ביום (09:00 בישראל עד הסגירה בארה"ב):** מתאם = **${ft(corr(dn.map((d) => d.nqx.b / d.nqM - 1), dn.map((d) => d.ex.b / d.fxM - 1)))}** (${dn.length} ימים).`,
    `- **האות של הבוקר מול התנועה של הדולר מכאן והלאה (עד הסגירה בארה"ב):** מתאם = **${ft(corr(dn.map((d) => d.S), dn.map((d) => d.ex.b / d.fxM - 1)))}** — זה מה שקובע אם אפשר להרוויח.`);
  // יומי ארוך
  try {
    const p1 = Math.floor(Date.parse('2010-01-01') / 1000), nd = await yahoo('^NDX', '1d', p1), id = await yahoo('ILS=X', '1d', p1);
    const key = (t) => new Date(t).toISOString().slice(0, 10), mi = new Map(id.t.map((t, i) => [key(t), id.c[i]]));
    const rows = []; for (let i = 1; i < nd.t.length; i++){ const a = mi.get(key(nd.t[i])), b = mi.get(key(nd.t[i - 1])); if (a > 0 && b > 0) rows.push({ y: +key(nd.t[i]).slice(0, 4), n: nd.c[i] / nd.c[i - 1] - 1, f: a / b - 1 }); }
    const years = [...new Set(rows.map((r) => r.y))];
    md.push(`- **יומי 2010 → היום (נאסד"ק 100 מול דולר-שקל, אותו תאריך; שעות סגירה שונות):** מתאם כולל ${ft(corr(rows.map((r) => r.n), rows.map((r) => r.f)))} (${rows.length} ימים). לפי שנה: ` +
      years.map((y) => { const r = rows.filter((x) => x.y === y); return `${y}: ${ft(corr(r.map((x) => x.n), r.map((x) => x.f)))}`; }).join(' · ') + '.');
  } catch (e) { md.push(`- יומי ארוך: לא זמין (${e.message}).`); }
  // גרסאות
  md.push('', '## 2. הגרסאות (ההכרעה)', '', '| גרסה | עסקאות | ממוצע לעסקה (נטו) | הצלחה | t | חצי 1 | חצי 2 | בר-סמך 95% (שבועות) | בלי עלויות | עלות 0.05% | קנייה בלבד | מכירה בלבד | עובדת |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const res = [];
  for (const v of VARIANTS){
    const tr = trades(days, v), d = decide(tr, split), z = stats(tr, 0), x5 = stats(tr, 0.05), L = stats(tr.filter((x) => x.sg > 0)), S = stats(tr.filter((x) => x.sg < 0));
    res.push({ k: v.k, ...d });
    md.push(`| ${v.he} | ${d.s.n} | ${fp(d.s.mean)} | ${fpc(d.s.hit)} | ${ft(d.s.t)} | ${fp(d.h1.mean)} | ${fp(d.h2.mean)} | ${fp(d.b.lo)} … ${fp(d.b.hi)} | ${fp(z.mean)} | ${fp(x5.mean)} | ${fp(L.mean)} (${L.n}) | ${fp(S.mean)} (${S.n}) | ${d.pass ? '✅' : '—'} |`);
  }
  const ok = res.filter((r) => r.pass);
  md.push('', '## 3. הכרעה', '', ok.length ? `**מועמדות:** ${ok.map((r) => VARIANTS.find((v) => v.k === r.k).he).join(', ')} — לבדיקה קדימה בלבד, בלי כסף.` : '**`FAIL`** — אף גרסה לא עומדת בקריטריון (חיובי בשני החצאים, t ≥ 3, בר-סמך מעל 0).');
  mkdirSync(OUTDIR, { recursive: true });
  writeFileSync(join(OUTDIR, 'report.md'), md.join('\n') + '\n');
  writeFileSync(join(OUTDIR, 'results.json'), JSON.stringify({ days: days.length, from: days[0].t, to: days.at(-1).t, split, res }, null, 1));
  console.log(md.join('\n'));
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main().catch((e) => { console.error(e); process.exit(1); });
