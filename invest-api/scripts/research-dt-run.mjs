#!/usr/bin/env node
// מחקר מסחר יומי (פרוטוקול v1.1): הרצת האסטרטגיות על נתוני המטמון הפרטי → רשומות לכל אות → ניתוח → דוח מצטבר בלבד לריפו.
// --phase run1 : פיתוח + אימות (2018–2024). תקופת המבחן לא נטענת בכלל.
// --phase final --cands <json> : המבחן הסופי (פעם אחת) למועמדות שתועדו ב-commit לפני ההרצה, כולל Walk-Forward.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import * as E from '../engine/daytrading.js';
import { analyze } from './research-dt-analyze.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', join(process.env.HOME || '.', 'dtdata'));
const OUT = arg('--outdir', 'invest/docs/research/daytrading/results');
const PHASE = arg('--phase', 'run1');
const LAST_KEY = 20261013, RUN1_LAST = 20241231;
const log = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);

export function loadMinute(file){
  const buf = readFileSync(file), n = buf.length / 24;
  const m = { t: new Float64Array(n), o: new Float64Array(n), h: new Float64Array(n), l: new Float64Array(n), c: new Float64Array(n), v: new Float64Array(n) };
  for (let i = 0; i < n; i++){ const p = i * 24; m.t[i] = buf.readInt32LE(p) * 60; m.o[i] = buf.readFloatLE(p + 4); m.h[i] = buf.readFloatLE(p + 8); m.l[i] = buf.readFloatLE(p + 12); m.c[i] = buf.readFloatLE(p + 16); m.v[i] = buf.readFloatLE(p + 20); }
  return m;
}

// מצב QQQ לכל יום: מעל MA20 (אתמול), תשואת 50 יום (משטר), ו-VWAP לפי סוף כל נר 5 דקות
function qqqContext(){
  const m = loadMinute(join(DATA, 'minute', 'QQQ.bin')), daily = JSON.parse(readFileSync(join(DATA, 'daily', 'QQQ.json'), 'utf8'));
  const days = E.splitDays(m, E.nyDayKey, E.nyOpenOf), dIdx = new Map(daily.map((d, i) => [d.key, i])), ctx = new Map();
  for (const d of days){
    const j = dIdx.get(d.key); if (j == null || j < 51) continue;
    const dc = E.dailyCtx(daily, j), r50 = daily[j - 1].c / daily[j - 51].c - 1;
    const b5 = E.bars5(m, d); let pv = 0, vv = 0; const vw = new Map();
    for (const b of b5){ pv += b.tpv; vv += b.v; vw.set(b.end, { vwap: vv > 0 ? pv / vv : NaN, c: b.c }); }
    ctx.set(d.key, { aboveMa20: dc.aboveMa20, regime: r50 > 0.05 ? 'up' : r50 < -0.05 ? 'down' : 'flat', vw });
  }
  return ctx;
}

const FEATS = ['aboveMa20', 'aboveMa50', 'ma20Rising', 'aboveVwap', 'rvol', 'qqqAboveMa20', 'qqqAboveVwap', 'regime', 'medRangeBps', 'avgMinVol', 'atr5', 'entry', 'stopS'];
const REG = { up: 1, flat: 0, down: -1 };
const KIND = { stop: 0, target: 1, eod: 2, time: 3, protect: 4 };

// רשומה לכל אות: {s, sym, key, start, tEntry, f:{...}, v: Float32Array(variants × 6)} — v: [stop, netF, netV, gross, holdMin, kind]
export function runSymbol(sym, years, q, variants, { maxKey = RUN1_LAST, startsAll = true, keepBase = new Set([0]) } = {}){
  const m = loadMinute(join(DATA, 'minute', sym + '.bin')), daily = JSON.parse(readFileSync(join(DATA, 'daily', sym + '.json'), 'utf8'));
  const days = E.splitDays(m, E.nyDayKey, E.nyOpenOf), dIdx = new Map(daily.map((d, i) => [d.key, i]));
  const st = E.indState(), cumHist = [], recs = [];
  // פרוטוקול v1.1 סעיף 1: יום עם יותר מ-5% דקות חסרות → בלי מסחר באותו יום; מניה-שנה עם יותר מ-20% ימים כאלה → מושמטת
  const shortDay = (d) => (d.i1 - d.i0) < 0.95 * (d.close - d.open) / 60;
  const yrs = new Set(years), dq = {};
  for (const Y of years){ const ds = days.filter((d) => Math.floor(d.key / 10000) === Y); const sh = ds.filter(shortDay).length; dq[Y] = { days: ds.length, short: sh }; if (!ds.length || sh / ds.length > 0.2) yrs.delete(Y); }
  runSymbol.dq[sym] = dq;
  const inYears = (key) => yrs.has(Math.floor(key / 10000)) && key <= maxKey;
  for (let di = 0; di < days.length; di++){
    const d = days[di], b5 = E.bars5(m, d);
    const ind = b5.map((b) => E.indUpdate(st, b));
    let pv = 0, vv = 0; const vwap = [], cum = new Float64Array(80).fill(NaN); let cv = 0;
    for (let i = 0; i < b5.length; i++){ pv += b5[i].tpv; vv += b5[i].v; vwap.push(vv > 0 ? pv / vv : NaN); cv += b5[i].v; if (b5[i].k < 80) cum[b5[i].k] = cv; }
    const rvol = b5.map((b) => { const xs = cumHist.map((h) => h[b.k]).filter(Number.isFinite); return xs.length >= 10 ? cum[b.k] / (xs.reduce((a, x) => a + x, 0) / xs.length) : NaN; });
    // מילוי הצטברות לנרות חסרים לפני שמירה להיסטוריה
    for (let k = 1; k < 80; k++) if (!Number.isFinite(cum[k]) && Number.isFinite(cum[k - 1])) cum[k] = cum[k - 1];
    const j = dIdx.get(d.key), dc = j != null ? E.dailyCtx(daily, j) : null, qc = q.get(d.key);
    const trade = inYears(d.key) && !shortDay(d) && dc && qc && ind.length && ind[ind.length - 1].warm && b5.length >= 20;
    if (trade){
      const sig = E.signals(b5, ind, vwap, rvol, dc, d.open);
      const lastEntry = Math.min(d.open + 5.5 * 3600, d.close - 1800);
      for (let s = 0; s < E.STRATS.length; s++){
        const list = sig[E.STRATS[s]];
        for (const [sname, sOff] of E.START_TIMES){
          if (!startsAll && sname !== '1000') continue;
          const t0 = d.open + sOff;
          const g = list.find((x) => x.fixedTime ? b5[x.i].end === t0 : b5[x.i].end >= t0);
          if (!g || b5[g.i].end > lastEntry) continue;
          let iE = b5[g.i].i1; while (iE < d.i1 && m.t[iE] < b5[g.i].end) iE++;
          if (iE >= d.i1) continue;
          const entry = m.o[iE], atr = ind[g.i].atr, stopS = E.normStop(entry, g.stop, atr, 's');
          if (stopS == null || !(atr > 0)) continue;
          let rs = [], vs = 0; for (let k = Math.max(d.i0, iE - 30); k < iE; k++){ rs.push((m.h[k] - m.l[k]) / m.c[k] * 1e4); vs += m.v[k]; }
          rs.sort((a, b) => a - b);
          const medR = rs.length ? rs[Math.floor(rs.length / 2)] : 10, avgV = rs.length ? vs / rs.length : 1;
          const qv = qc.vw.get(b5[g.i].end);
          const f = { aboveMa20: +dc.aboveMa20, aboveMa50: +dc.aboveMa50, ma20Rising: +dc.ma20Rising, aboveVwap: +(b5[g.i].c > vwap[g.i]), rvol: rvol[g.i],
            qqqAboveMa20: +qc.aboveMa20, qqqAboveVwap: qv ? +(qv.c > qv.vwap) : NaN, regime: REG[qc.regime], medRangeBps: medR, avgMinVol: avgV, atr5: atr, entry, stopS };
          const vlist = sname === '1000' ? variants : [variants[0]];
          const v = new Float32Array(vlist.length * 6).fill(NaN);
          let base = null; const bases = {};
          vlist.forEach(([, cfg], vi) => {
            const stop = cfg.stop === 's' ? stopS : E.normStop(entry, g.stop, atr, cfg.stop);
            if (stop == null) return;
            const r = E.simulateExit(m, days, di, iE, entry, stop, atr, cfg);
            const sh = E.researchShares(entry, stop);
            const netF = E.pnlUsd(entry, r.fills, sh, E.fixedBps()), netV = E.pnlUsd(entry, r.fills, sh, E.varBps(medR, avgV, sh)), gross = E.pnlUsd(entry, r.fills, sh, { entry: 0, exit: 0 }) + E.commission(sh, entry) + r.fills.reduce((a, [fr, px]) => a + E.commission(Math.floor(sh * fr + 1e-9), px), 0);
            v.set([stop, netF, netV, gross, (r.tExit - m.t[iE]) / 60, KIND[r.kind]], vi * 6);
            if (keepBase.has(vi)){ bases[vi] = { stop, g: r.fills.reduce((a, [fr, px]) => a + fr * px, 0) - entry, xm: r.fills.reduce((a, [fr, px, mk]) => a + (mk ? fr * px : 0), 0), nOrd: 1 + r.fills.length, tExit: r.tExit }; if (vi === 0) base = bases[0]; }
          });
          if (!base) continue;
          recs.push({ s, sym, key: d.key, start: sname, tEntry: m.t[iE], f, v, bases });
        }
      }
    }
    cumHist.push(cum); if (cumHist.length > 20) cumHist.shift();
  }
  return recs;
}

runSymbol.dq = {};
async function main(){
  mkdirSync(OUT, { recursive: true });
  const universe = JSON.parse(readFileSync(join(DATA, 'universe.json'), 'utf8'));
  const q = qqqContext(); log('QQQ days', q.size);
  const symYears = {};
  for (const [Y, list] of Object.entries(universe)) for (const s of list) (symYears[s] ||= new Set()).add(Number(Y));
  const maxKey = PHASE === 'final' ? LAST_KEY : RUN1_LAST;
  const cands = PHASE === 'final' ? JSON.parse(readFileSync(arg('--cands'), 'utf8')).cands : [];
  const variants = [...E.VARIANTS, ...cands.map((c) => [c.name, Object.freeze({ ...E.VARIANTS[0][1], ...c.cfg })])];
  const keepBase = new Set([0, ...cands.map((_, i) => E.VARIANTS.length + i)]);
  const recs = [];
  for (const [s, ys] of Object.entries(symYears)){
    if (!existsSync(join(DATA, 'minute', s + '.bin'))){ log('missing', s); continue; }
    const r = runSymbol(s, ys, q, variants, { maxKey, startsAll: PHASE !== 'final', keepBase });
    recs.push(...r); log(s, [...ys].join(','), 'signals', r.length, 'total', recs.length);
  }
  const res = analyze(recs, variants.map((x) => x[0]), { phase: PHASE, universe, cands, dq: runSymbol.dq });
  writeFileSync(join(OUT, `${PHASE}.json`), JSON.stringify(res.json, null, 1));
  writeFileSync(join(OUT, `${PHASE}.md`), res.md);
  console.log(res.md.slice(0, 4000));
}
if (process.argv[1] && process.argv[1].endsWith('research-dt-run.mjs')) main().catch((e) => { console.error(e); process.exit(1); });
