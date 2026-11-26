#!/usr/bin/env node
// מחקר "יתרון מאירועים" (פרוטוקול v1.0): H1 + H2 על נתוני המטמון הפרטי → דוח מצטבר בלבד לריפו.
// --phase run1: פיתוח + אימות (עד 2024). --phase final --cands <json>: המבחן הסופי, פעם אחת, למועמדות שתועדו ב-commit לפני ההרצה.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as X from '../engine/event-edge.js';
import { nyOpenOf, nyDayKey } from '../engine/daytrading.js';
import { metrics, holm } from './research-dt-analyze.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', join(process.env.HOME || '.', 'eedata'));
const OUT = arg('--outdir', 'invest/docs/research/event-edge/results');
const PHASE = arg('--phase', 'run1');
const MAXKEY = PHASE === 'final' ? 20261013 : 20241231;
const period = (k) => k <= 20221231 ? 'dev' : k <= 20241231 ? 'val' : 'test';
const NOTIONAL = 20000;
const log = (...a) => console.error(...a);

const dcache = new Map();
const daily = (s) => { if (!dcache.has(s)){ const f = join(DATA, 'daily', s + '.json'); dcache.set(s, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : []); } return dcache.get(s); };
const toM = (rows) => ({ t: rows.map((x) => x[0]), o: rows.map((x) => x[1]), c: rows.map((x) => x[4]) });
const session = (m) => { const open = nyOpenOf(m.t[0]), last = m.t[m.t.length - 1] + 60; return { open, close: last <= open + 3.5 * 3600 + 900 ? open + 3.5 * 3600 : open + 6.5 * 3600 }; };

// משטר שוק לפי QQQ (50 ימי מסחר עד אתמול)
const qd = daily('QQQ'), regime = new Map();
for (let i = 51; i < qd.length; i++){ const r = qd[i - 1].c / qd[i - 51].c - 1; regime.set(qd[i].key, r > 0.05 ? 'up' : r < -0.05 ? 'down' : 'flat'); }

function runH1(){
  const cal = JSON.parse(readFileSync(join(DATA, 'earnings.json'), 'utf8'));
  const evCache = new Map(), ev = (key) => { if (!evCache.has(key)){ const f = join(DATA, 'ev', key + '.json'); evCache.set(key, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null); } return evCache.get(key); };
  const out = Object.fromEntries(X.H1_GRID.map((v) => [v.k, []])); let events = 0, withMin = 0, explicitN = 0;
  for (const e of cal){
    const sur = X.surprise(e.eps, e.f); if (sur == null) continue;
    const d = daily(e.s); if (d.length < 2) continue;
    const r = X.reactionDay(d, e.d, e.time); if (!r) continue;
    const R = d[r.idx]; if (R.key > MAXKEY || R.key < 20180101) continue;
    events++;
    const day = ev(R.key), rows = day?.[e.s]; if (!rows || rows.length < 30) continue;
    withMin++; if (r.explicit) explicitN++;
    const m = toM(rows), ss = session(m);
    for (const v of X.H1_GRID){
      const t = X.h1Trade({ sur, prevClose: d[r.idx - 1].c, m, open: ss.open, close: ss.close }, v); if (!t) continue;
      const p = X.tradePnl(t.entry, t.exit, t.side, NOTIONAL), p2 = X.tradePnl(t.entry, t.exit, t.side, NOTIONAL, 2);
      if (!p) continue;
      out[v.k].push({ key: R.key, s: e.s, side: t.side, pnl: p.net, gross: p.gross, net2: p2.net, ret: p.net / NOTIONAL, explicit: r.explicit, sur, regime: regime.get(R.key) });
    }
  }
  return { out, events, withMin, explicitN };
}

function runH2(sym){
  const rows = JSON.parse(readFileSync(join(DATA, sym + '_m.json'), 'utf8')), d = daily(sym), dIdx = new Map(d.map((x, i) => [x.key, i]));
  const byDay = new Map(); for (const r of rows){ const k = nyDayKey(r[0]); (byDay.get(k) || byDay.set(k, []).get(k)).push(r); }
  const out = Object.fromEntries(X.H2_GRID.map((v) => [v.k, []]));
  for (const [key, rs] of byDay){
    if (key < 20180101 || key > MAXKEY) continue;
    const j = dIdx.get(key); if (!(j >= 1)) continue;
    const m = toM(rs), ss = session(m);
    for (const v of X.H2_GRID){
      const t = X.h2Trade({ m, open: ss.open, close: ss.close, prevClose: d[j - 1].c }, v); if (!t) continue;
      const p = X.tradePnl(t.entry, t.exit, t.side, NOTIONAL), p2 = X.tradePnl(t.entry, t.exit, t.side, NOTIONAL, 2);
      if (!p) continue;
      out[v.k].push({ key, side: t.side, pnl: p.net, gross: p.gross, net2: p2.net, ret: p.net / NOTIONAL, regime: regime.get(key) });
    }
  }
  return out;
}

// ברמת החשבון: H1 — עד 5 פוזיציות של 20% ביום (עדיפות להפתעה הגדולה); H2 — 100% בעסקה. ריבית דריבית, בלי מינוף.
function account(trades, { perPos = 0.2, maxPos = 5 } = {}){
  const byDay = new Map(); for (const t of trades) (byDay.get(t.key) || byDay.set(t.key, []).get(t.key)).push(t);
  let eq = 1, peak = 1, mdd = 0; const rets = [];
  for (const k of [...byDay.keys()].sort((a, b) => a - b)){
    const ts = byDay.get(k).sort((a, b) => Math.abs(b.sur || 0) - Math.abs(a.sur || 0)).slice(0, maxPos);
    const r = ts.reduce((a, t) => a + perPos * t.ret, 0); eq *= 1 + r; rets.push(r); peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1);
  }
  const keys = [...byDay.keys()]; const yrs = keys.length ? (Math.max(...keys) - Math.min(...keys)) / 10000 + 1 : 1;
  const mean = rets.reduce((a, x) => a + x, 0) / Math.max(1, rets.length);
  return { total: eq - 1, cagr: eq ** (1 / Math.max(1, Math.round(yrs))) - 1, mdd, days: rets.length, mean };
}

const fmt$ = (x) => !Number.isFinite(x) ? '—' : (x < 0 ? '‎−' : '+') + Math.abs(Math.round(x)).toLocaleString('en-US') + '$';
const f2 = (x) => Number.isFinite(x) ? x.toFixed(2) : (x === Infinity ? '∞' : '—');
const pct = (x) => Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—';
const pv = (x) => !Number.isFinite(x) ? '—' : x < 0.001 ? '<0.001' : x.toFixed(3);
const M = (ts, f = 'pnl', boot = 0) => metrics(ts.map((t) => ({ key: t.key, pnl: t[f] })), { boot });
const row = (m) => m.n ? `${m.n} | ${(m.win * 100).toFixed(0)}% | ${fmt$(m.exp)} | ${f2(m.pf)} | ${f2(m.t)}` : '0 | — | — | — | —';

async function main(){
  mkdirSync(OUT, { recursive: true });
  const md = [`# מחקר "יתרון מאירועים" — ${PHASE === 'run1' ? 'הרצה 1: פיתוח 2018–2022 ואימות 2023–2024' : 'הרצה סופית'}`, '', 'פרוטוקול v1.0. עסקה של 20,000$, עמלה בתמחור הקבוע × 1.3, מרווח + החלקה 3.5 נ"ב לכל צד. אחרי עלויות, אלא אם צוין.', ''];
  const json = { phase: PHASE };
  // ---- H1 ----
  const h1 = runH1(); json.h1meta = { events: h1.events, withMinute: h1.withMin, explicit: h1.explicitN };
  md.push('## H1 — סחף ביום התגובה לדוח', '', `אירועים עם EPS ותחזית ויום תגובה עד הסוף: ${h1.events.toLocaleString('en-US')}. עם פער ≥ 1% ונרות דקה: ${h1.withMin.toLocaleString('en-US')} (שעה מפורשת: ${h1.explicitN.toLocaleString('en-US')}).`, '',
    '| גרסה | צד | פיתוח: עסקאות | הצלחה | תוחלת | PF | t | אימות: עסקאות | הצלחה | תוחלת | PF | t | פיתוח לפני עלויות |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const h1rows = [];
  for (const v of X.H1_GRID) for (const side of [1, -1]){
    const ts = h1.out[v.k].filter((t) => t.side === side), dv = ts.filter((t) => period(t.key) === 'dev'), vl = ts.filter((t) => period(t.key) === 'val');
    const r = { k: v.k, side, dev: M(dv, 'pnl', side > 0 ? 5000 : 0), val: M(vl), devGross: M(dv, 'gross'), valGross: M(vl, 'gross'), dev2: M(dv, 'net2'), devExplicit: M(dv.filter((t) => t.explicit)), valExplicit: M(vl.filter((t) => t.explicit)), reg: Object.fromEntries(['up', 'flat', 'down'].map((g) => [g, M(ts.filter((t) => t.regime === g && period(t.key) !== 'test'))])), acct: { dev: account(dv), val: account(vl) } };
    h1rows.push(r);
    md.push(`| ${v.k} | ${side > 0 ? 'לונג' : 'שורט (דיווח)'} | ${row(r.dev)} | ${row(r.val)} | ${fmt$(r.devGross.exp)} |`);
  }
  json.h1 = h1rows;
  const h1best = h1rows.filter((r) => r.side > 0 && r.dev.n >= 100).sort((a, b) => b.dev.t - a.dev.t)[0];
  // ---- H2 ----
  md.push('', '## H2 — מומנטום תוך-יומי של השוק (חצי השעה הראשונה → חצי השעה האחרונה)', '', '| נכס | גרסה | צד | פיתוח: עסקאות | הצלחה | תוחלת | PF | t | אימות: עסקאות | הצלחה | תוחלת | PF | t | פיתוח לפני עלויות |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const h2rows = [];
  for (const sym of ['SPY', 'QQQ']){
    const o = runH2(sym);
    for (const v of X.H2_GRID) for (const side of [1, -1]){
      const ts = o[v.k].filter((t) => t.side === side), dv = ts.filter((t) => period(t.key) === 'dev'), vl = ts.filter((t) => period(t.key) === 'val');
      const r = { sym, k: v.k, side, dev: M(dv, 'pnl', side > 0 ? 5000 : 0), val: M(vl), devGross: M(dv, 'gross'), valGross: M(vl, 'gross'), dev2: M(dv, 'net2'), reg: Object.fromEntries(['up', 'flat', 'down'].map((g) => [g, M(ts.filter((t) => t.regime === g && period(t.key) !== 'test'))])), acct: { dev: account(dv, { perPos: 1, maxPos: 1 }), val: account(vl, { perPos: 1, maxPos: 1 }) } };
      h2rows.push(r);
      md.push(`| ${sym} | ${v.k} | ${side > 0 ? 'לונג' : 'שורט (דיווח)'} | ${row(r.dev)} | ${row(r.val)} | ${fmt$(r.devGross.exp)} |`);
    }
  }
  json.h2 = h2rows;
  const h2best = h2rows.filter((r) => r.side > 0).sort((a, b) => b.dev.t - a.dev.t)[0];
  // ---- בחירה ----
  const cands = [h1best && { h: 'H1', ...h1best }, h2best && { h: 'H2', ...h2best }].filter(Boolean);
  const adj = holm(cands.map((c) => c.dev.pBoot ?? 1)); cands.forEach((c, i) => { c.pHolm = adj[i]; });
  json.selected = cands.map((c) => ({ h: c.h, sym: c.sym, k: c.k, devT: c.dev.t, pBoot: c.dev.pBoot, pHolm: c.pHolm, valExp: c.val.exp, valPf: c.val.pf }));
  md.push('', '## הבחירה (לונג בלבד, t הגבוה בפיתוח) ואישור באימות', '', '| השערה | גרסה | פיתוח: תוחלת / PF / t | p (bootstrap) | p אחרי Holm | אימות: עסקאות / תוחלת / PF | עלויות כפולות (פיתוח): PF | לפי משטר (פיתוח+אימות): עלייה / דשדוש / ירידה | ברמת החשבון: פיתוח / אימות (תשואה כוללת, ירידה מקס\') |', '|---|---|---|---|---|---|---|---|---|');
  for (const c of cands) md.push(`| ${c.h}${c.sym ? ' ' + c.sym : ''} | ${c.k} | ${fmt$(c.dev.exp)} / ${f2(c.dev.pf)} / ${f2(c.dev.t)} | ${pv(c.dev.pBoot)} | ${pv(c.pHolm)} | ${c.val.n} / ${fmt$(c.val.exp)} / ${f2(c.val.pf)} | ${f2(c.dev2.pf)} | ${['up', 'flat', 'down'].map((g) => `${fmt$(c.reg[g].exp)} (${c.reg[g].n})`).join(' / ')} | ${pct(c.acct.dev.total)}, ${pct(c.acct.dev.mdd)} / ${pct(c.acct.val.total)}, ${pct(c.acct.val.mdd)} |`);
  if (h1best) md.push('', `H1 רק על אירועים עם שעת פרסום מפורשת (${h1best.k}): פיתוח ${row(h1best.devExplicit)} · אימות ${row(h1best.valExplicit)}.`);
  const go = cands.filter((c) => c.dev.exp > 0 && c.dev.pf >= 1.1 && c.val.exp > 0 && c.val.pf >= 1.1);
  json.goToTest = go.map((c) => c.h);
  md.push('', `**מועמדות למבחן הסופי (חיוביות ו-PF ≥ 1.1 גם בפיתוח וגם באימות):** ${go.length ? go.map((c) => `${c.h} ${c.sym || ''} ${c.k}`).join(', ') : '**אין — המבחן לא נפתח.**'}`);
  writeFileSync(join(OUT, `${PHASE}.json`), JSON.stringify(json, null, 1));
  writeFileSync(join(OUT, `${PHASE}.md`), md.join('\n') + '\n');
  console.log(md.join('\n').slice(0, 3000));
}
main().catch((e) => { console.error(e); process.exit(1); });
