#!/usr/bin/env node
// מחקר "יתרון מאירועים" — פרוטוקול v1.2: H1 לפי קבוצות נזילות (G500/GMID/GSMALL) × לונג/שורט, עלויות משתנות, שעת דוח לפי מחזור;
// H2 (SPY/QQQ) כמו v1.1. --phase run1: פיתוח + אימות בלבד. פלט מצטבר בלבד.
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
const rd = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const session = (t) => { const open = nyOpenOf(t[0]), last = t[t.length - 1] + 60; return { open, close: last <= open + 3.5 * 3600 + 900 ? open + 3.5 * 3600 : open + 6.5 * 3600 }; };
const qd = rd('daily/QQQ.json'), regime = new Map();
for (let i = 51; i < qd.length; i++){ const r = qd[i - 1].c / qd[i - 51].c - 1; regime.set(qd[i].key, r > 0.05 ? 'up' : r < -0.05 ? 'down' : 'flat'); }

function runH1(){
  const cands = rd('cands.json').filter((e) => e.R && e.R >= 20180101 && e.R <= MAXKEY);
  const out = {}; const evc = new Map(); let used = 0;
  const ev = (k) => { if (!evc.has(k)){ if (evc.size > 40) evc.delete(evc.keys().next().value); const f = join(DATA, 'ev2', k + '.json'); evc.set(k, existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null); } return evc.get(k); };
  cands.sort((a, b) => a.R - b.R);
  for (const e of cands){
    const rows = ev(e.R)?.[e.s]; if (!rows || rows.length < 60) continue;
    const m = { t: rows.map((x) => x[0]), o: rows.map((x) => x[1]), h: rows.map((x) => x[2]), l: rows.map((x) => x[3]), c: rows.map((x) => x[4]), v: rows.map((x) => x[5]) };
    const ss = session(m.t), sur = X.surprise(e.eps, e.f); used++;
    for (const v of X.H1_GRID){
      const t = X.h1Trade2({ sur, prevClose: e.prevClose, m, open: ss.open, close: ss.close }, v); if (!t) continue;
      if (t.side < 0 && X.GROUP_COST[e.g].shortMinPx && t.entry < X.GROUP_COST[e.g].shortMinPx) continue;
      const p = X.tradePnl2(m, t.iE, t.iX, t.side, NOTIONAL, e.g); if (!p) continue;
      const k = `${e.g}|${t.side > 0 ? 'long' : 'short'}|${v.k}`;
      (out[k] ||= []).push({ key: e.R, pnl: p.net, gross: p.gross, net2: p.net2, gret: p.gross / (p.sh * t.entry), regime: regime.get(e.R) });
    }
  }
  return { out, used, cands: cands.length };
}
function runH2(sym){
  const rows = rd(sym + '_m.json'), d = rd('daily/' + sym + '.json'), dIdx = new Map(d.map((x, i) => [x.key, i])), byDay = new Map();
  for (const r of rows){ const k = nyDayKey(r[0]); (byDay.get(k) || byDay.set(k, []).get(k)).push(r); }
  const out = {};
  for (const [key, rs] of byDay){
    if (key < 20180101 || key > MAXKEY) continue; const j = dIdx.get(key); if (!(j >= 1)) continue;
    const m = { t: rs.map((x) => x[0]), o: rs.map((x) => x[1]), c: rs.map((x) => x[4]) }, ss = session(m.t);
    for (const v of X.H2_GRID){
      const t = X.h2Trade({ m, open: ss.open, close: ss.close, prevClose: d[j - 1].c }, v); if (!t) continue;
      const p = X.tradePnl(t.entry, t.exit, t.side, NOTIONAL), p2 = X.tradePnl(t.entry, t.exit, t.side, NOTIONAL, 2); if (!p) continue;
      (out[`${sym}|${t.side > 0 ? 'long' : 'short'}|${v.k}`] ||= []).push({ key, pnl: p.net, gross: p.gross, net2: p2.net, gret: p.gross / (p.sh * t.entry), regime: regime.get(key) });
    }
  }
  return out;
}
const fmt$ = (x) => !Number.isFinite(x) ? '—' : (x < 0 ? '‎−' : '+') + Math.abs(Math.round(x)).toLocaleString('en-US') + '$';
const f2 = (x) => Number.isFinite(x) ? x.toFixed(2) : (x === Infinity ? '∞' : '—');
const pv = (x) => !Number.isFinite(x) ? '—' : x < 0.001 ? '<0.001' : x.toFixed(3);
const gp = (ts) => ts.length ? (ts.reduce((a, t) => a + t.gret, 0) / ts.length * 100).toFixed(2) + '%' : '—';
const M = (ts, f = 'pnl', boot = 0) => metrics(ts.map((t) => ({ key: t.key, pnl: t[f] })), { boot });
const row = (m) => m.n ? `${m.n} | ${(m.win * 100).toFixed(0)}% | ${fmt$(m.exp)} | ${f2(m.pf)} | ${f2(m.t)}` : '0 | — | — | — | —';

function block(md, title, all, keysOrder){
  md.push(`## ${title}`, '', '| קבוצה/נכס | צד | גרסה | פיתוח: עסקאות | הצלחה | תוחלת נטו | PF | t | גולמי לעסקה | אימות: עסקאות | הצלחה | תוחלת נטו | PF | t | גולמי לעסקה |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const rows = [];
  for (const k of keysOrder){
    const ts = all[k] || [], dv = ts.filter((t) => period(t.key) === 'dev'), vl = ts.filter((t) => period(t.key) === 'val');
    const [g, side, v] = k.split('|');
    const r = { k, g, side, v, dev: M(dv, 'pnl', 3000), val: M(vl), devG: dv.length ? dv.reduce((a, t) => a + t.gret, 0) / dv.length : null, valG: vl.length ? vl.reduce((a, t) => a + t.gret, 0) / vl.length : null, dev2: M(dv, 'net2'), reg: Object.fromEntries(['up', 'flat', 'down'].map((x) => [x, M(ts.filter((t) => t.regime === x && period(t.key) !== 'test'))])) };
    rows.push(r);
    md.push(`| ${g} | ${side === 'long' ? 'לונג' : 'שורט'} | ${v} | ${row(r.dev)} | ${gp(dv)} | ${row(r.val)} | ${gp(vl)} |`);
  }
  md.push('');
  return rows;
}
async function main(){
  mkdirSync(OUT, { recursive: true });
  const md = [`# מחקר "יתרון מאירועים" — פרוטוקול v1.2, ${PHASE === 'run1' ? 'הרצה 1: פיתוח 2018–2022 ואימות 2023–2024' : 'הרצה סופית'}`, '',
    'עסקה של 20,000$. H1: עמלה בתמחור הקבוע × 1.3, חצי מרווח + החלקה משתנים לפי נזילות (מינימום לפי קבוצה), עלות השאלה בשורט. H2: מודל v1.0 (3.5 נ"ב לצד). "גולמי לעסקה" = לפני כל העלויות (יעד ≥ 0.15%).', ''];
  const json = { phase: PHASE, protocol: 'v1.2' };
  const audit = existsSync('invest/docs/research/event-edge/results/data-audit-v1.2.json') ? JSON.parse(readFileSync('invest/docs/research/event-edge/results/data-audit-v1.2.json', 'utf8')) : null;
  if (audit) md.push(`**נתונים:** ${audit.events?.toLocaleString('en-US')} אירועים עם EPS ותחזית; ${audit.candidates?.toLocaleString('en-US')} עברו מחיר/נזילות; שעת דוח: ${audit.timing?.amc} אחרי הסגירה, ${audit.timing?.bmo} לפני הפתיחה, ${audit.timing?.undetermined} לא הוכרעו (מושמטים); התאמה לשעה מפורשת: ${audit.timing?.explicitAgree}/${audit.timing?.explicit}.`, '');
  const h1 = runH1(); json.h1meta = { cands: h1.cands, withMinute: h1.used };
  const keys1 = []; for (const g of ['G500', 'GMID', 'GSMALL']) for (const side of ['long', 'short']) for (const v of X.H1_GRID) keys1.push(`${g}|${side}|${v.k}`);
  const r1 = block(md, `H1 — סחף ביום התגובה לדוח (${h1.used.toLocaleString('en-US')} אירועים עם נרות דקה)`, h1.out, keys1);
  const h2o = { ...runH2('SPY'), ...runH2('QQQ') };
  const keys2 = []; for (const s of ['SPY', 'QQQ']) for (const side of ['long', 'short']) for (const v of X.H2_GRID) keys2.push(`${s}|${side}|${v.k}`);
  const r2 = block(md, 'H2 — מומנטום תוך-יומי של השוק', h2o, keys2);
  // בחירה: לכל קבוצה×צד (H1) ולכל נכס×צד (H2) — t הגבוה בפיתוח, לפחות 100 עסקאות
  const pick = (rows) => { const by = new Map(); for (const r of rows){ if (r.dev.n < 100) continue; const k = `${r.g}|${r.side}`; if (!by.has(k) || r.dev.t > by.get(k).dev.t) by.set(k, r); } return [...by.values()]; };
  const cands = [...pick(r1).map((r) => ({ h: 'H1', ...r })), ...pick(r2).map((r) => ({ h: 'H2', ...r }))];
  const adj = holm(cands.map((c) => c.dev.pBoot ?? 1)); cands.forEach((c, i) => { c.pHolm = adj[i]; });
  md.push('## הבחירה (לכל קבוצה/נכס × צד) ואישור באימות', '', '| השערה | קבוצה/נכס | צד | גרסה | פיתוח: תוחלת / PF / t | גולמי פיתוח | p | p אחרי Holm | אימות: עסקאות / תוחלת / PF | גולמי אימות | עלויות כפולות (פיתוח) PF | עלייה / דשדוש / ירידה (תוחלת) | עובר לבדיקת המבחן |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  const go = [];
  for (const c of cands){
    const ok = c.dev.exp > 0 && c.dev.pf >= 1.1 && c.val.exp > 0 && c.val.pf >= 1.1 && c.devG >= 0.0015 && c.valG >= 0.0015;
    if (ok) go.push(c);
    md.push(`| ${c.h} | ${c.g} | ${c.side === 'long' ? 'לונג' : 'שורט'} | ${c.v} | ${fmt$(c.dev.exp)} / ${f2(c.dev.pf)} / ${f2(c.dev.t)} | ${c.devG != null ? (c.devG * 100).toFixed(2) + '%' : '—'} | ${pv(c.dev.pBoot)} | ${pv(c.pHolm)} | ${c.val.n} / ${fmt$(c.val.exp)} / ${f2(c.val.pf)} | ${c.valG != null ? (c.valG * 100).toFixed(2) + '%' : '—'} | ${f2(c.dev2.pf)} | ${['up', 'flat', 'down'].map((x) => fmt$(c.reg[x].exp)).join(' / ')} | ${ok ? '**כן**' : 'לא'} |`);
  }
  md.push('', `**מועמדות למבחן הסופי** (חיובי ו-PF ≥ 1.1 בפיתוח ובאימות, וגולמי ≥ 0.15% בשניהם): ${go.length ? go.map((c) => `${c.h} ${c.g} ${c.side} ${c.v}`).join(', ') : '**אין — המבחן לא נפתח.**'}`);
  json.h1 = r1; json.h2 = r2; json.cands = cands.map(({ h, g, side, v, dev, val, devG, valG, pHolm }) => ({ h, g, side, v, dev, val, devG, valG, pHolm })); json.goToTest = go.map((c) => `${c.h}|${c.g}|${c.side}|${c.v}`);
  writeFileSync(join(OUT, `v1.2-${PHASE}.json`), JSON.stringify(json));
  writeFileSync(join(OUT, `v1.2-${PHASE}.md`), md.join('\n') + '\n');
  console.log(md.slice(-12).join('\n'));
}
main().catch((e) => { console.error(e); process.exit(1); });
