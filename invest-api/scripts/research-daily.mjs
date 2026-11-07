#!/usr/bin/env node
// שיטות קריפטו ארוכות טווח (engine/research-daily.js) על נרות יומיים מ-2016 — מחקר בלבד, בלי פקודות ובלי מפתחות.
// מקורות ציבוריים (נגישים מ-GitHub Actions): נרות יומיים של Coinbase, Funding שעתי של Hyperliquid (מ-2023).
// שימוש: node invest-api/scripts/research-daily.mjs [--start 2016-01-01] [--end 2026-11-07] [--data d.json.gz] [--out r.md] [--show-test]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { align, strategies, runDaily, runCarry, dstats, dscore, DCOST } from '../engine/research-daily.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const START = Date.parse(`${arg('--start', '2016-01-01')}T00:00:00Z`), END = Date.parse(`${arg('--end', '2026-11-07')}T00:00:00Z`);
const DATA = arg('--data', ''), OUT = arg('--out', ''), SHOW_TEST = process.argv.includes('--show-test');
const UNIVERSE = ['BTC', 'ETH', 'LTC', 'BCH', 'LINK', 'XLM', 'ETC', 'ADA', 'SOL', 'DOGE', 'AVAX', 'DOT', 'UNI', 'ATOM', 'XRP', 'AAVE', 'FIL', 'ALGO', 'XTZ', 'ZEC'];
const DAY = 86400e3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (...a) => console.error(...a);
const UA = { 'User-Agent': 'bikur-research/1.0 (backtest)', Accept: 'application/json' };
async function getJson(url, init = {}, tries = 5){
  for (let k = 0; k < tries; k++){
    try { const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) } }); if (r.status === 429){ await sleep(2000 * (k + 1)); continue; } if (r.status === 404) return null; if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (k === tries - 1) throw e; await sleep(1000 * (k + 1)); }
  }
}
async function daily(coin){
  const out = new Map(), step = 300 * DAY;
  for (let s = START; s < END; s += step){
    const e = Math.min(s + step, END), j = await getJson(`https://api.exchange.coinbase.com/products/${coin}-USD/candles?granularity=86400&start=${new Date(s).toISOString()}&end=${new Date(e).toISOString()}`);
    if (j === null) return null;
    for (const r of j || []){ const t = r[0] * 1000; if (t >= START && t < END) out.set(t, { t, o: +r[3], h: +r[2], l: +r[1], c: +r[4] }); }
    await sleep(150);
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}
async function funding(coin){
  const out = new Map(); let s = Math.max(START, Date.parse('2023-01-01T00:00:00Z'));
  while (s < END){
    const j = await getJson('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'fundingHistory', coin, startTime: s, endTime: END }) });
    if (!Array.isArray(j) || !j.length) break;
    for (const f of j){ const d = Math.floor(f.time / DAY) * DAY; out.set(d, (out.get(d) || 0) + Number(f.fundingRate)); }
    const last = j.at(-1).time; if (last < s) break; s = last + 1; await sleep(200);
  }
  return [...out];
}
async function load(){
  if (DATA && existsSync(DATA)) return JSON.parse(gunzipSync(readFileSync(DATA)));
  const d = { bars: {}, funding: {} };
  for (const c of UNIVERSE){ try { const b = await daily(c); if (b && b.length > 200){ d.bars[c] = b; log(`${c}: ${b.length} ימים מ-${new Date(b[0].t).toISOString().slice(0, 10)}`); } else log(`${c}: אין ב-Coinbase`); } catch (e) { log(`${c}: ${e.message}`); } }
  for (const c of Object.keys(d.bars)){ try { d.funding[c] = await funding(c); } catch { d.funding[c] = []; } }
  if (DATA) writeFileSync(DATA, gzipSync(JSON.stringify(d)));
  return d;
}

const iso = (t) => new Date(t).toISOString().slice(0, 10), pct = (x) => (x == null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
const fs = (x) => (x == null ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2)), fci = (c) => (c ? `[${fs(c[0])}, ${fs(c[1])}]` : '—');

async function main(){
  const d = await load(), A = align(d.bars), F = {};
  for (const [c, rows] of Object.entries(d.funding)) F[c] = new Map(rows);
  const days = A.days, D = days.length, at = (k) => days[Math.min(D - 1, Math.floor(D * k))];
  const P = { train: { from: days[0], to: at(0.6) }, val: { from: at(0.6), to: at(0.8) }, test: { from: at(0.8), to: days.at(-1) + DAY }, dev: { from: days[0], to: at(0.8) } };
  const S = strategies(A.coins), res = new Map();
  for (const s of S){
    const r = runDaily(A, s, { funding: F }), r15 = runDaily(A, s, { funding: F, costMult: 1.5 }), r2 = runDaily(A, s, { funding: F, costMult: 2 });
    res.set(s.id, { s, series: r.series, entries: r.entries, st: Object.fromEntries(Object.entries(P).map(([k, p]) => [k, dstats(r.series, p)])),
      c15: dstats(r15.series, SHOW_TEST ? P.test : P.val), c2: dstats(r2.series, SHOW_TEST ? P.test : P.val),
      byYear: Object.fromEntries([...new Set(days.map((t) => new Date(t).getUTCFullYear()))].map((y) => [y, dstats(r.series, { from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) })])) });
  }
  // Walk-Forward: 3 שנים בחירה → שנה בדיקה, על תקופת הפיתוח בלבד
  const folds = []; for (let t = days[0] + 3 * 365 * DAY; t + 365 * DAY <= P.dev.to + 1; t += 365 * DAY) folds.push({ train: { from: t - 3 * 365 * DAY, to: t }, test: { from: t, to: t + 365 * DAY } });
  const families = [...new Set(S.map((s) => s.family))].filter((f) => f !== 'bench');
  const report = [];
  for (const fam of families){
    const cands = [...res.values()].filter((r) => r.s.family === fam);
    const best = cands.map((r) => ({ r, sc: dscore(r.st.train) })).filter((x) => x.sc !== null).sort((a, b) => b.sc - a.sc)[0]?.r || cands[0];
    const oos = [], picks = [];
    for (const f of folds){ const p = cands.map((r) => ({ r, sc: dscore(dstats(r.series, f.train)) })).filter((x) => x.sc !== null).sort((a, b) => b.sc - a.sc)[0]; if (!p){ picks.push('—'); continue; } picks.push(p.r.s.id); oos.push(...p.r.series.filter((x) => x.t >= f.test.from && x.t < f.test.to)); }
    const wf = dstats(oos), t = best.st;
    let v;
    if (!(t.train.ci && t.train.ci[0] > 0)) v = ['❌ נכשלה', 'שארפ באימון לא מובהק (הגבול התחתון ≤ 0)'];
    else if (!(t.val.sharpe > 0) || !(wf.sharpe > 0)) v = ['❌ נכשלה', 'לא החזיקה באימות / Walk-Forward'];
    else if (!SHOW_TEST) v = ['⏳ עברה אימון ואימות', 'תקופת המבחן לא נפתחה'];
    else if (!(t.test.sharpe > 0)) v = ['❌ נכשלה', 'הפסידה בתקופת המבחן'];
    else if (t.test.ci[0] > 0 && best.c15.sharpe > 0) v = ['✅ מרוויחה בביטחון', 'מבחן חיובי, גבול תחתון חיובי, שורדת עלויות ×1.5'];
    else v = ['🟡 מבטיחה, לא מובהקת', 'מבחן חיובי, טווח הביטחון כולל אפס'];
    report.push({ fam, best, wf, picks, v });
  }
  // גביית Funding (Hyperliquid, מ-2023)
  const fcoins = Object.keys(F).filter((c) => F[c].size > 100), fdays = [...new Set(fcoins.flatMap((c) => [...F[c].keys()]))].sort((a, b) => a - b);
  const carry = [0.0001, 0.0002, 0.0005].map((thr) => { const r = runCarry(F, fcoins, fdays, { thr }); return { thr, all: dstats(r.series), byYear: Object.fromEntries([2023, 2024, 2025, 2026].map((y) => [y, dstats(r.series, { from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) })])), c2: dstats(runCarry(F, fcoins, fdays, { thr, costMult: 2 }).series) }; });

  const L = [];
  L.push(`# שיטות קריפטו ארוכות טווח — נרות יומיים, ${iso(days[0])} → ${iso(days.at(-1))}, ${A.coins.length} מטבעות`);
  L.push(`מטבעות: ${A.coins.join(', ')}. אימון ${iso(P.train.from)}→${iso(P.train.to)} · אימות →${iso(P.val.to)} · מבחן →${iso(P.test.to - DAY)} ${SHOW_TEST ? '(**נפתח**)' : '(🔒 מוסתר)'} · Walk-Forward: ${folds.length} קפלים (3 שנים → שנה).`);
  L.push(`עלויות: ספוט ${DCOST.spotBps}bp, חוזה ${DCOST.perpBps}bp, החלקה ${JSON.stringify(DCOST.slipBps)}/אחרים ${DCOST.slipOther}bp לכל צד; Funding לחוזים (Hyperliquid מ-2023, לפני כן לונג משלם ${DCOST.longFundBpsDay}bp ליום). בלי מינוף.`);
  L.push('⚠️ הטיית שורדים: רשימת המטבעות נבחרה היום (מטבעות שקיימים ב-Coinbase ב-2026). מטבעות שקרסו ונמחקו לא בפנים — זה מחמיא לשיטות לונג.', '');
  L.push('## השוואה: קנה והחזק');
  L.push('| | תקופה | תשואה שנתית | שארפ [95%] | ירידה מקס׳ |', '|---|---|---|---|---|');
  for (const id of ['BH-BTC', 'BH-EW']) for (const [pn, p] of [['אימון', 'train'], ['אימות', 'val'], ['מבחן', 'test']]){ const s = res.get(id).st[p]; if (p === 'test' && !SHOW_TEST) continue; L.push(`| ${id} | ${pn} | ${pct(s.cagr)} | ${fs(s.sharpe)} ${fci(s.ci)} | ${pct(-s.maxDD)} |`); }
  L.push('', '## נציג כל משפחה (נבחר לפי אימון: הגבול התחתון של שארפ)');
  L.push('| משפחה | גרסה | תקופה | תשואה שנתית | שארפ [95%] | ירידה מקס׳ | חשיפה ממוצעת | מחזור שנתי | עלויות (מצטבר) |', '|---|---|---|---|---|---|---|---|---|');
  for (const x of report) for (const [pn, p] of [['אימון', 'train'], ['אימות', 'val'], ['מבחן', 'test']]){
    const s = x.best.st[p]; if (p === 'test' && !SHOW_TEST){ L.push(`| ${x.fam} | \`${x.best.s.id}\` | מבחן | 🔒 | | | | | |`); continue; }
    L.push(`| ${x.fam} | \`${x.best.s.id}\` | ${pn} | ${pct(s.cagr)} | ${fs(s.sharpe)} ${fci(s.ci)} | ${pct(-s.maxDD)} | ${pct(s.exposure)} | ${s.turnYr} | ${pct(-s.costTotal)} |`);
  }
  L.push('', '## פסיקה');
  L.push('| משפחה | גרסה | Walk-Forward (מחוץ למדגם) | עלויות ×1.5 / ×2 (' + (SHOW_TEST ? 'מבחן' : 'אימות') + ') | פסיקה | למה |', '|---|---|---|---|---|---|');
  for (const x of report) L.push(`| ${x.fam} | \`${x.best.s.id}\` | שארפ ${fs(x.wf.sharpe)} ${fci(x.wf.ci)}, ${pct(x.wf.cagr)}/שנה | ${fs(x.best.c15.sharpe)} / ${fs(x.best.c2.sharpe)} | ${x.v[0]} | ${x.v[1]} |`);
  L.push('', '## לפי שנה — תשואה (שארפ) של הנציגים מול קנה והחזק');
  const years = Object.keys(res.get('BH-BTC').byYear).filter((y) => res.get('BH-BTC').byYear[y].n >= 30 && (SHOW_TEST || Date.UTC(+y, 0, 1) < P.test.from));
  L.push('| גרסה | ' + years.join(' | ') + ' |', '|---|' + years.map(() => '---').join('|') + '|');
  for (const id of ['BH-BTC', 'BH-EW', ...report.map((x) => x.best.s.id)]){ const r = res.get(id); L.push(`| \`${id}\` | ` + years.map((y) => { const s = r.byYear[y]; return s.n >= 30 ? `${pct(s.total)} (${fs(s.sharpe)})` : '—'; }).join(' | ') + ' |'); }
  L.push('', `## גביית Funding (Hyperliquid, ${fcoins.length} מטבעות, ${fdays.length ? iso(fdays[0]) : '—'} →) — ספוט לונג + חוזה שורט`);
  L.push('| סף כניסה (ליום) | תשואה שנתית | שארפ [95%] | ירידה מקס׳ | חשיפה | עלויות ×2: שארפ | ' + [2023, 2024, 2025, 2026].join(' | ') + ' |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const c of carry) L.push(`| ${(c.thr * 100).toFixed(2)}% (${(c.thr * 365 * 100).toFixed(0)}%/שנה) | ${pct(c.all.cagr)} | ${fs(c.all.sharpe)} ${fci(c.all.ci)} | ${pct(-c.all.maxDD)} | ${pct(c.all.exposure)} | ${fs(c.c2.sharpe)} | ` + [2023, 2024, 2025, 2026].map((y) => (c.byYear[y].n >= 30 ? pct(c.byYear[y].total) : '—')).join(' | ') + ' |');
  L.push('', 'הערה: התשואה היא על הנוציונל של רגל אחת; ההון בפועל גדול יותר (ספוט + בטחונות לחוזה). הפרש ספוט/חוזה לא נמדד.');
  L.push('', '## כל הגרסאות (אימון / אימות' + (SHOW_TEST ? ' / מבחן' : '') + ') — שארפ');
  L.push('| גרסה | משפחה | אימון | אימות |' + (SHOW_TEST ? ' מבחן |' : ''), '|---|---|---|---|' + (SHOW_TEST ? '---|' : ''));
  for (const r of [...res.values()].sort((a, b) => (b.st.train.ci?.[0] ?? -9) - (a.st.train.ci?.[0] ?? -9))) L.push(`| \`${r.s.id}\` | ${r.s.family} | ${fs(r.st.train.sharpe)} ${fci(r.st.train.ci)} | ${fs(r.st.val.sharpe)} |` + (SHOW_TEST ? ` ${fs(r.st.test.sharpe)} |` : ''));
  // בדיקת עמידות (רק כשהמבחן פתוח): בלי כל מטבע בתורו — האם התוצאה תלויה במטבע אחד (הטיית שורדים / מזל)?
  if (SHOW_TEST){
    L.push('', '## עמידות: תקופת המבחן בלי כל מטבע בתורו (לגרסאות שעברו / מבטיחות)');
    L.push('| גרסה | שארפ מלא | שארפ מינימלי (בלי…) | תשואה שנתית מינימלית | רק BTC+ETH |', '|---|---|---|---|---|');
    for (const x of report.filter((y) => /✅|🟡/.test(y.v[0]))){
      const needsBtc = /f200|BTC/.test(x.best.s.id); // המסנן נשען על BTC — לא מוציאים אותו
      const loo = A.coins.filter((c) => !(needsBtc && c === 'BTC')).map((c) => { const bars = Object.fromEntries(Object.entries(d.bars).filter(([k]) => k !== c)), A2 = align(bars), s2 = strategies(A2.coins).find((q) => q.id === x.best.s.id); return { c, st: s2 ? dstats(runDaily(A2, s2, { funding: F }).series, P.test) : null }; }).filter((q) => q.st && q.st.sharpe !== null);
      const worst = loo.sort((a, b) => a.st.sharpe - b.st.sharpe)[0], minC = loo.reduce((m, q) => Math.min(m, q.st.cagr), Infinity);
      const majors = Object.fromEntries(Object.entries(d.bars).filter(([k]) => k === 'BTC' || k === 'ETH')), A3 = align(majors), s3 = strategies(A3.coins).find((q) => q.id === x.best.s.id);
      const m3 = s3 ? dstats(runDaily(A3, s3, { funding: F }).series, P.test) : null;
      L.push(`| \`${x.best.s.id}\` | ${fs(x.best.st.test.sharpe)} | ${fs(worst?.st.sharpe)} (בלי ${worst?.c}) | ${pct(minC)} | ${m3 ? `${fs(m3.sharpe)}, ${pct(m3.cagr)}` : '—'} |`);
    }
  }
  L.push('', '## Walk-Forward — מה נבחר בכל קפל');
  for (const x of report) L.push(`- **${x.fam}**: ` + x.picks.map((p, i) => `${iso(folds[i].test.from).slice(0, 4)}: \`${p}\``).join(' · '));
  const md = L.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md);
}
main().catch((e) => { console.error(e); process.exit(1); });
