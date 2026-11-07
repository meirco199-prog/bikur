#!/usr/bin/env node
// שיטות קריפטו קצרות טווח (engine/research-hourly.js) על נרות שעה מ-2019 — מחקר בלבד, בלי פקודות ובלי מפתחות.
// מקורות ציבוריים (נגישים מ-GitHub Actions): נרות שעה של Coinbase, Funding שעתי של Hyperliquid (מ-2023).
// שימוש: node invest-api/scripts/research-hourly.mjs [--start 2019-01-01] [--end 2026-11-07] [--data h.json.gz] [--out r.md] [--show-test]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { alignH, strategies, runBars, recost, hstats, tstats, HCOST, HOUR } from '../engine/research-hourly.js';
import { dstats, dscore } from '../engine/research-daily.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const START = Date.parse(`${arg('--start', '2019-01-01')}T00:00:00Z`), END = Date.parse(`${arg('--end', '2026-11-07')}T00:00:00Z`);
const DATA = arg('--data', ''), OUT = arg('--out', ''), SHOW_TEST = process.argv.includes('--show-test');
const UNIVERSE = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'LINK', 'LTC', 'AVAX', 'DOT', 'BCH', 'UNI', 'ATOM', 'AAVE', 'ETC', 'XLM'];
const DAY = 86400e3, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (...a) => console.error(...a);
const UA = { 'User-Agent': 'bikur-research/1.0 (backtest)', Accept: 'application/json' };
async function getJson(url, init = {}, tries = 6){
  for (let k = 0; k < tries; k++){
    try { const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) } }); if (r.status === 429){ await sleep(2000 * (k + 1)); continue; } if (r.status === 404) return null; if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (k === tries - 1) throw e; await sleep(1000 * (k + 1)); }
  }
}
// נרות שעה: 300 לבקשה; [t,o,h,l,c,v]
async function hourly(coin){
  const out = new Map(), step = 300 * HOUR;
  for (let s = START; s < END; s += step){
    const e = Math.min(s + step, END), j = await getJson(`https://api.exchange.coinbase.com/products/${coin}-USD/candles?granularity=3600&start=${new Date(s).toISOString()}&end=${new Date(e).toISOString()}`);
    if (j === null) return null;
    for (const r of j || []){ const t = r[0] * 1000; if (t >= START && t < END) out.set(t, [t, +r[3], +r[2], +r[1], +r[4], +r[5]]); }
    await sleep(120);
  }
  return [...out.values()].sort((a, b) => a[0] - b[0]);
}
async function funding(coin){
  const out = new Map(); let s = Math.max(START, Date.parse('2023-01-01T00:00:00Z'));
  while (s < END){
    const j = await getJson('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'fundingHistory', coin, startTime: s, endTime: END }) });
    if (!Array.isArray(j) || !j.length) break;
    for (const f of j){ const h = Math.floor(f.time / HOUR) * HOUR; out.set(h, (out.get(h) || 0) + Number(f.fundingRate)); }
    const last = j.at(-1).time; if (last < s) break; s = last + 1; await sleep(200);
  }
  return [...out];
}
async function load(){
  if (DATA && existsSync(DATA)) return JSON.parse(gunzipSync(readFileSync(DATA)));
  const d = { bars: {}, funding: {} }, q = [...UNIVERSE];
  const worker = async () => { for (let c; (c = q.shift());){ try { const b = await hourly(c); if (b && b.length > 24 * 200){ d.bars[c] = b; log(`${c}: ${b.length} שעות מ-${new Date(b[0][0]).toISOString().slice(0, 10)}`); } else log(`${c}: אין ב-Coinbase`); } catch (e) { log(`${c}: ${e.message}`); } } };
  await Promise.all([worker(), worker(), worker()]);
  for (const c of Object.keys(d.bars)){ try { d.funding[c] = await funding(c); } catch { d.funding[c] = []; } }
  if (DATA) writeFileSync(DATA, gzipSync(JSON.stringify(d)));
  return d;
}
const toBars = (rows) => rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v }));

const iso = (t) => new Date(t).toISOString().slice(0, 10), pct = (x) => (x == null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(1)}%`);
const fs = (x) => (x == null ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(2)), fci = (c) => (c ? `[${fs(c[0])}, ${fs(c[1])}]` : '—');
const bp = (x) => (x == null ? '—' : `${x >= 0 ? '+' : '−'}${Math.abs(x).toFixed(1)}`);

async function main(){
  const d = await load(), byCoin = Object.fromEntries(Object.entries(d.bars).map(([c, r]) => [c, toBars(r)])), A = alignH(byCoin), F = {};
  for (const [c, rows] of Object.entries(d.funding)) F[c] = new Map(rows);
  const days = [...new Set(A.T.map((t) => Math.floor(t / DAY) * DAY))], D = days.length, at = (k) => days[Math.min(D - 1, Math.floor(D * k))];
  const P = { train: { from: days[0], to: at(0.6) }, val: { from: at(0.6), to: at(0.8) }, test: { from: at(0.8), to: days.at(-1) + DAY }, dev: { from: days[0], to: at(0.8) } };
  const OOS = SHOW_TEST ? P.test : P.val;
  const S = strategies(A, F), res = new Map(), t0 = Date.now();
  for (const s of S){
    const { daily, trades } = runBars(A, s, { funding: F });
    const mk = recost(daily, { bpsPerTurn: HCOST.makerBps });
    res.set(s.id, { s, daily, ts: Object.fromEntries(Object.entries(P).map(([k, p]) => [k, tstats(trades, p)])), st: Object.fromEntries(Object.entries(P).map(([k, p]) => [k, dstats(daily, p)])), hs: Object.fromEntries(Object.entries(P).map(([k, p]) => [k, hstats(daily, p)])),
      c15: dstats(recost(daily, { mult: 1.5 }), OOS), c2: dstats(recost(daily, { mult: 2 }), OOS), maker: dstats(mk, OOS), makerTrain: dstats(mk, P.train), gross: dstats(daily.map((x) => ({ ...x, net: x.gross })), OOS),
      byYear: Object.fromEntries([...new Set(days.map((t) => new Date(t).getUTCFullYear()))].map((y) => [y, dstats(daily, { from: Date.UTC(y, 0, 1), to: Date.UTC(y + 1, 0, 1) })])) });
  }
  log(`${S.length} גרסאות ב-${Math.round((Date.now() - t0) / 1000)} שניות`);
  // Walk-Forward: 3 שנים בחירה → שנה בדיקה, על תקופת הפיתוח בלבד
  const folds = []; for (let t = days[0] + 3 * 365 * DAY; t + 365 * DAY <= P.dev.to + 1; t += 365 * DAY) folds.push({ train: { from: t - 3 * 365 * DAY, to: t }, test: { from: t, to: t + 365 * DAY } });
  const families = [...new Set(S.map((s) => s.family))].filter((f) => f !== 'bench');
  const report = [];
  for (const fam of families){
    const cands = [...res.values()].filter((r) => r.s.family === fam);
    const best = cands.map((r) => ({ r, sc: dscore(r.st.train) })).filter((x) => x.sc !== null).sort((a, b) => b.sc - a.sc)[0]?.r || cands.sort((a, b) => (b.st.train.sharpe ?? -9) - (a.st.train.sharpe ?? -9))[0];
    const oos = [], picks = [];
    for (const f of folds){ const p = cands.map((r) => ({ r, sc: dscore(dstats(r.daily, f.train)) })).filter((x) => x.sc !== null).sort((a, b) => b.sc - a.sc)[0]; if (!p){ picks.push('—'); continue; } picks.push(p.r.s.id); oos.push(...p.r.daily.filter((x) => x.t >= f.test.from && x.t < f.test.to)); }
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

  const L = [], oosName = SHOW_TEST ? 'מבחן' : 'אימות';
  L.push(`# שיטות קריפטו קצרות טווח — נרות שעה, ${iso(days[0])} → ${iso(days.at(-1))}, ${A.coins.length} מטבעות, ${S.length} גרסאות`);
  L.push(`מטבעות: ${A.coins.join(', ')}. אימון ${iso(P.train.from)}→${iso(P.train.to)} · אימות →${iso(P.val.to)} · מבחן →${iso(P.test.to - DAY)} ${SHOW_TEST ? '(**נפתח**)' : '(🔒 מוסתר)'} · Walk-Forward: ${folds.length} קפלים (3 שנים → שנה).`);
  L.push(`ביצוע: ההחלטה בסגירת נר שעה, הביצוע בפתיחת הנר הבא. חוזה: Taker ${HCOST.perpBps}bp + החלקה ${JSON.stringify(HCOST.slipBps)}/אחרים ${HCOST.slipOther}bp לכל צד; Funding שעתי של Hyperliquid (מ-2023, לפני כן לונג משלם ${HCOST.longFundBpsDay}bp ליום). בלי מינוף.`);
  L.push(`תרחיש Maker (אופטימי — מניח שכל פקודה מתמלאת כ-Maker בלי החלקה): ${HCOST.makerBps}bp לכל צד. נתונים שגויים שתוקנו: ${A.fixed.length ? A.fixed.map((f) => `${f.coin} ${new Date(f.t).toISOString().slice(0, 13)} ${f.field} ${f.from}→${f.to}`).join(' · ') : '—'}.`);
  L.push('⚠️ הטיית שורדים: רשימת המטבעות נבחרה היום. "רווח גולמי למחזור" = כמה השיטה מרוויחה לפני עלויות על כל 100% של תיק שמתחלף; העלות לכל צד היא 7.5–10.5bp.', '');
  L.push('## השוואה: קנה והחזק');
  L.push('| | תקופה | תשואה שנתית | שארפ [95%] | ירידה מקס׳ |', '|---|---|---|---|---|');
  for (const id of ['BH-BTC', 'BH-EW']) for (const [pn, p] of [['אימון', 'train'], ['אימות', 'val'], ['מבחן', 'test']]){ if (p === 'test' && !SHOW_TEST) continue; const s = res.get(id).st[p]; L.push(`| ${id} | ${pn} | ${pct(s.cagr)} | ${fs(s.sharpe)} ${fci(s.ci)} | ${pct(-s.maxDD)} |`); }
  L.push('', '## נציג כל משפחה (נבחר לפי אימון: הגבול התחתון של שארפ)');
  L.push('| משפחה | גרסה | תקופה | תשואה שנתית | שארפ [95%] | ירידה מקס׳ | זמן בשוק | כניסות בשנה | רווח גולמי למחזור (bp) | עלויות (מצטבר) |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const x of report) for (const [pn, p] of [['אימון', 'train'], ['אימות', 'val'], ['מבחן', 'test']]){
    if (p === 'test' && !SHOW_TEST){ L.push(`| ${x.fam} | \`${x.best.s.id}\` | מבחן | 🔒 | | | | | | |`); continue; }
    const s = x.best.st[p], h = x.best.hs[p];
    L.push(`| ${x.fam} | \`${x.best.s.id}\` | ${pn} | ${pct(s.cagr)} | ${fs(s.sharpe)} ${fci(s.ci)} | ${pct(-s.maxDD)} | ${pct(h.exposure)} | ${h.entriesYr} | ${bp(h.edgeBps)} | ${pct(-s.costTotal)} |`);
  }
  L.push('', '## עסקאות — נציג כל משפחה (אחרי עמלות, החלקה ו-Funding; באחוזים מגודל הפוזיציה)');
  L.push('| גרסה | תקופה | עסקאות | ביום (לכל מטבע) | הצלחה | Profit Factor | תוחלת לעסקה | רווח ממוצע | הפסד ממוצע | החזקה ממוצעת (שעות) |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const x of report) for (const [pn, p] of [['אימון', 'train'], ['אימות', 'val'], ['מבחן', 'test']]){
    if (p === 'test' && !SHOW_TEST) continue;
    const q = x.best.ts[p], days_ = x.best.st[p].n || 1, nc = x.best.s.id.includes('-BE') ? 2 : A.coins.length;
    L.push(`| \`${x.best.s.id}\` | ${pn} | ${q.n} | ${q.n ? (q.n / days_ / nc).toFixed(2) : '—'} | ${q.n ? pct(q.winRate) : '—'} | ${q.pf ?? '—'} | ${q.n ? `${q.expPct >= 0 ? '+' : '−'}${Math.abs(q.expPct).toFixed(2)}%` : '—'} | ${q.avgWinPct != null ? `+${q.avgWinPct.toFixed(2)}%` : '—'} | ${q.avgLossPct != null ? `−${Math.abs(q.avgLossPct).toFixed(2)}%` : '—'} | ${q.avgBars ?? '—'} |`);
  }
  L.push('', '## פסיקה');
  L.push(`| משפחה | גרסה | Walk-Forward (מחוץ למדגם) | ${oosName}: לפני עלויות / עלויות ×1.5 / ×2 / Maker (שארפ) | פסיקה | למה |`, '|---|---|---|---|---|---|');
  for (const x of report) L.push(`| ${x.fam} | \`${x.best.s.id}\` | שארפ ${fs(x.wf.sharpe)} ${fci(x.wf.ci)}, ${pct(x.wf.cagr)}/שנה | ${fs(x.best.gross.sharpe)} / ${fs(x.best.c15.sharpe)} / ${fs(x.best.c2.sharpe)} / ${fs(x.best.maker.sharpe)} | ${x.v[0]} | ${x.v[1]} |`);
  L.push('', '## לפי שנה — תשואה (שארפ) של הנציגים מול קנה והחזק');
  const years = Object.keys(res.get('BH-BTC').byYear).filter((y) => res.get('BH-BTC').byYear[y].n >= 30 && (SHOW_TEST || Date.UTC(+y, 0, 1) < P.test.from));
  L.push('| גרסה | ' + years.join(' | ') + ' |', '|---|' + years.map(() => '---').join('|') + '|');
  for (const id of ['BH-BTC', 'BH-EW', ...report.map((x) => x.best.s.id)]){ const r = res.get(id); L.push(`| \`${id}\` | ` + years.map((y) => { const s = r.byYear[y]; return s && s.n >= 30 ? `${pct(s.total)} (${fs(s.sharpe)})` : '—'; }).join(' | ') + ' |'); }
  L.push('', `## כל הגרסאות — שארפ אחרי עלויות (אימון / אימות${SHOW_TEST ? ' / מבחן' : ''}), שארפ באימון לפני עלויות ועם Maker, ורווח גולמי למחזור באימון`);
  L.push(`| גרסה | משפחה | אימון | אימות |${SHOW_TEST ? ' מבחן |' : ''} אימון לפני עלויות | אימון Maker | גולמי/מחזור (bp) | כניסות בשנה |`, `|---|---|---|---|${SHOW_TEST ? '---|' : ''}---|---|---|---|`);
  for (const r of [...res.values()].sort((a, b) => (b.st.train.ci?.[0] ?? -9) - (a.st.train.ci?.[0] ?? -9))){
    const g = dstats(r.daily.map((x) => ({ ...x, net: x.gross })), P.train);
    L.push(`| \`${r.s.id}\` | ${r.s.family} | ${fs(r.st.train.sharpe)} ${fci(r.st.train.ci)} | ${fs(r.st.val.sharpe)} |${SHOW_TEST ? ` ${fs(r.st.test.sharpe)} |` : ''} ${fs(g.sharpe)} | ${fs(r.makerTrain.sharpe)} | ${bp(r.hs.train.edgeBps)} | ${r.hs.train.entriesYr} |`);
  }
  if (SHOW_TEST){
    L.push('', '## עמידות: תקופת המבחן בלי כל מטבע בתורו (לגרסאות שעברו / מבטיחות)');
    L.push('| גרסה | שארפ מלא | שארפ מינימלי (בלי…) | תשואה שנתית מינימלית |', '|---|---|---|---|');
    for (const x of report.filter((y) => /✅|🟡/.test(y.v[0]))){
      const needsBtc = /f200|BTC|-BE/.test(x.best.s.id);
      const loo = A.coins.filter((c) => !(needsBtc && (c === 'BTC' || c === 'ETH'))).map((c) => { const A2 = alignH(Object.fromEntries(Object.entries(byCoin).filter(([k]) => k !== c))), s2 = strategies(A2, F).find((q) => q.id === x.best.s.id); return { c, st: s2 ? dstats(runBars(A2, s2, { funding: F }).daily, P.test) : null }; }).filter((q) => q.st && q.st.sharpe !== null);
      const worst = loo.sort((a, b) => a.st.sharpe - b.st.sharpe)[0], minC = loo.reduce((m, q) => Math.min(m, q.st.cagr), Infinity);
      L.push(`| \`${x.best.s.id}\` | ${fs(x.best.st.test.sharpe)} | ${fs(worst?.st.sharpe)} (בלי ${worst?.c}) | ${pct(minC)} |`);
    }
  }
  L.push('', '## Walk-Forward — מה נבחר בכל קפל');
  for (const x of report) L.push(`- **${x.fam}**: ` + x.picks.map((p, i) => `${iso(folds[i].test.from).slice(0, 4)}: \`${p}\``).join(' · '));
  const md = L.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md);
}
main().catch((e) => { console.error(e); process.exit(1); });
