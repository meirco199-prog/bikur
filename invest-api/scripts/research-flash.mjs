#!/usr/bin/env node
// קנייה בקריסות חדות (engine/research.js, FLASH_BASES) על שנתיים של נרות 5 דקות, ~26 מטבעות ב-Coinbase (כולל קטנים ותנודתיים).
// מחקר בלבד — אין פקודות ואין מפתחות. שימוש: node --max-old-space-size=6144 invest-api/scripts/research-flash.mjs
//   [--end 2026-11-07] [--days 730] [--data flash.json.gz] [--out r.md] [--show-test]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { prepare, signals, execute, stats, score, verdict, FLASH_BASES, COST } from '../engine/research.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const END = Date.parse(`${arg('--end', '2026-11-07')}T00:00:00Z`), DAYS = Number(arg('--days', 730)), START = END - DAYS * 86400e3;
const DATA = arg('--data', ''), OUT = arg('--out', ''), SHOW_TEST = process.argv.includes('--show-test'), BASE = 5, DAY = 86400e3;
const UNIVERSE = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE', 'AVAX', 'LINK', 'DOT', 'UNI', 'AAVE', 'LTC', 'NEAR', 'APT', 'ARB', 'OP', 'SUI', 'SHIB', 'PEPE', 'BONK', 'WIF', 'SEI', 'INJ', 'RENDER', 'FET', 'TIA'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (...a) => console.error(...a);
const UA = { 'User-Agent': 'bikur-research/1.0 (backtest)', Accept: 'application/json' };
async function getJson(url, init = {}, tries = 6){
  for (let k = 0; k < tries; k++){
    try { const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) } }); if (r.status === 404) return null; if (r.status === 429){ await sleep(2000 * (k + 1)); continue; } if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (k === tries - 1) throw e; await sleep(1000 * (k + 1)); }
  }
}
async function coinbase(coin){
  const out = new Map(), step = 300 * BASE * 60e3;
  for (let s = START; s < END; s += step){
    const e = Math.min(s + step, END), j = await getJson(`https://api.exchange.coinbase.com/products/${coin}-USD/candles?granularity=${BASE * 60}&start=${new Date(s).toISOString()}&end=${new Date(e).toISOString()}`);
    if (j === null) return null;
    for (const r of j || []){ const t = r[0] * 1000; if (t >= START && t < END) out.set(t, [t, +r[3], +r[2], +r[1], +r[4], +r[5] * +r[4]]); }
    await sleep(110);
  }
  return [...out.values()].sort((a, b) => a[0] - b[0]);
}
async function funding(coin){
  const out = []; let s = START;
  while (s < END){
    const j = await getJson('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'fundingHistory', coin: coin === 'SHIB' || coin === 'PEPE' || coin === 'BONK' ? 'k' + coin : coin, startTime: s, endTime: END }) });
    if (!Array.isArray(j) || !j.length) break;
    for (const f of j) out.push([f.time, Number(f.fundingRate)]);
    const last = j.at(-1).time; if (last < s) break; s = last + 1; await sleep(150);
  }
  return out;
}
async function load(){
  if (DATA && existsSync(DATA)) return JSON.parse(gunzipSync(readFileSync(DATA)));
  const d = { bars: {}, funding: {} };
  for (let i = 0; i < UNIVERSE.length; i += 3){
    await Promise.all(UNIVERSE.slice(i, i + 3).map(async (c) => { try { const b = await coinbase(c); if (b && b.length > 1000){ d.bars[c] = b; log(`${c}: ${b.length} נרות 5 דק׳ מ-${new Date(b[0][0]).toISOString().slice(0, 10)}`); } else log(`${c}: אין ב-Coinbase`); } catch (e) { log(`${c}: ${e.message}`); } }));
  }
  for (const c of Object.keys(d.bars)){ try { d.funding[c] = await funding(c); } catch { d.funding[c] = []; } }
  if (DATA) writeFileSync(DATA, gzipSync(JSON.stringify(d)));
  return d;
}
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const fmt$ = (x) => (x == null || !Number.isFinite(x) ? '—' : (x < 0 ? '−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US'));
const fR = (x) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(3)), fCI = (c) => (c ? `[${fR(c[0])}, ${fR(c[1])}]` : '—');

async function main(){
  const d = await load(), coins = Object.keys(d.bars), ctx = {}, fund = {};
  for (const c of coins){ ctx[c] = prepare(d.bars[c].map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] })), { baseMin: BASE }); fund[c] = (d.funding[c] || []).map(([t, rate]) => ({ t, rate })); }
  if (ctx.BTC) for (const c of coins) ctx[c].btc = ctx.BTC;
  delete d.bars;
  const at = (k) => START + Math.round(DAYS * k) * DAY;
  const P = { train: { from: START, to: at(0.6) }, val: { from: at(0.6), to: at(0.8) }, test: { from: at(0.8), to: END }, dev: { from: START, to: at(0.8) } };
  const st = (tr, p, x = {}) => stats(tr, { ...p, coins, ...x }), SC = { minTrades: 30 };
  const run = (b, risk = {}) => coins.flatMap((c) => execute(ctx[c], signals(ctx[c], b), { coin: c, funding: fund[c], risk: { maxStopPct: 25, ...risk } }));
  const res = FLASH_BASES.map((b) => { const tr = run(b); return { b, tr, s: Object.fromEntries(Object.entries(P).map(([k, p]) => [k, st(tr, p)])) }; });
  // Walk-Forward: 240 ימי בחירה → 60 ימי בדיקה, בתוך תקופת הפיתוח
  const folds = []; for (let t = START + 240 * DAY; t + 30 * DAY <= P.dev.to; t += 60 * DAY) folds.push({ train: { from: t - 240 * DAY, to: t }, test: { from: t, to: Math.min(t + 60 * DAY, P.dev.to) } });
  const oos = [], picks = [];
  for (const f of folds){ const p = res.map((r) => ({ r, sc: score(st(r.tr, f.train), SC) })).filter((x) => x.sc !== null).sort((a, b) => b.sc - a.sc)[0]; if (!p){ picks.push('—'); continue; } picks.push(p.r.b.id); oos.push(...p.r.tr.filter((x) => x.tEntry >= f.test.from && x.tEntry < f.test.to)); }
  const wf = st(oos, { from: folds[0]?.test.from, to: folds.at(-1)?.test.to });
  const ranked = res.map((r) => ({ r, sc: score(r.s.train, SC) })).sort((a, b) => (b.sc ?? -9) - (a.sc ?? -9));
  const best = ranked[0].r, ev = SHOW_TEST ? P.test : P.val;
  const v = verdict({ train: best.s.train, val: best.s.val, test: SHOW_TEST ? best.s.test : null, wf, cost15: st(best.tr, ev, { costMult: 1.5 }) });
  const L = [];
  L.push(`# קנייה בקריסות חדות — ${DAYS} ימים, נרות 5 דק׳, ${coins.length} מטבעות, ${iso(START)} → ${iso(END)}`);
  L.push(`מטבעות: ${coins.join(', ')}. אימון →${iso(P.train.to)} · אימות →${iso(P.val.to)} · מבחן →${iso(END)} ${SHOW_TEST ? '(**נפתח**)' : '(🔒 מוסתר)'} · Walk-Forward ${folds.length} קפלים (240→60 ימים).`);
  L.push(`עלויות כמו במחקר הראשי (עמלות ${COST.makerBps}/${COST.takerBps}bp, מרווח, החלקה, Funding). סיכון 400$ לעסקה. לונג בלבד. אירוע: שפל ≥ drop% מתחת לשיא n הנרות הקודמים, נפח ≥ ×3.`, '');
  L.push('## כל הגרסאות — תקופת הפיתוח (אימון+אימות)');
  L.push('| גרסה | עסקאות | הצלחה | ברוטו R [95%] | נטו R [95%] | נטו | PF | מטבעות ברווח | אימון: נטו R [95%] | אימות: נטו |', '|---|---|---|---|---|---|---|---|---|---|');
  for (const { r } of ranked){ const s = r.s.dev; L.push(`| \`${r.b.id}\` | ${s.n} | ${s.winRate ?? '—'}% | ${fR(s.expRGross)} ${fCI(s.ciRGross)} | ${fR(s.expR)} ${fCI(s.ciR)} | ${fmt$(s.net)} | ${s.pf === Infinity ? '∞' : s.pf ?? '—'} | ${s.coinsPos}/${coins.length} | ${fR(r.s.train.expR)} ${fCI(r.s.train.ciR)} | ${fmt$(r.s.val.net)} |`); }
  L.push('', `## הנבחרת לפי אימון: \`${best.b.id}\``);
  L.push('| תקופה | עסקאות | הצלחה | ברוטו | עמלות | מרווח+החלקה | Funding | נטו | נטו R [95%] | PF | ירידה מקס׳ |', '|---|---|---|---|---|---|---|---|---|---|---|');
  for (const [pn, p] of [['אימון', 'train'], ['אימות', 'val'], ['מבחן', 'test']]){ if (p === 'test' && !SHOW_TEST){ L.push('| מבחן | 🔒 | | | | | | | | | |'); continue; } const s = best.s[p]; L.push(`| ${pn} | ${s.n} | ${s.winRate ?? '—'}% | ${fmt$(s.gross)} | ${fmt$(-s.fees)} | ${fmt$(-s.spreadSlip)} | ${fmt$(-s.funding)} | **${fmt$(s.net)}** | ${fR(s.expR)} ${fCI(s.ciR)} | ${s.pf === Infinity ? '∞' : s.pf ?? '—'} | ${fmt$(-s.maxDD)} |`); }
  L.push('', `Walk-Forward (מחוץ למדגם): ${wf.n} עסקאות, ${fmt$(wf.net)}, R ${fR(wf.expR)} ${fCI(wf.ciR)} · נבחר בכל קפל: ${picks.map((p) => `\`${p}\``).join(' · ')}`);
  L.push('', `**פסיקה:** ${v.level === 'pass' ? '✅ מרוויחה בביטחון' : v.level === 'promising' ? '🟡 מבטיחה, לא מובהקת' : v.level === 'pending' ? '⏳ עברה אימון ואימות' : '❌ נכשלה'} — ${v.why}`);
  const s0 = best.s[SHOW_TEST ? 'test' : 'dev'];
  L.push('', `## לפי מטבע (${SHOW_TEST ? 'מבחן' : 'פיתוח'}) — הנבחרת`, '| מטבע | נטו |', '|---|---|', ...Object.entries(s0.byCoin).sort((a, b) => b[1] - a[1]).map(([c, x]) => `| ${c} | ${fmt$(x)} |`));
  if (SHOW_TEST){
    const loo = coins.map((c) => ({ c, s: st(best.tr.filter((x) => x.coin !== c), P.test) })).sort((a, b) => a.s.net - b.s.net)[0];
    L.push('', `**עמידות (מבחן):** בלי ${loo.c} — ${loo.s.n} עסקאות, ${fmt$(loo.s.net)}, R ${fR(loo.s.expR)} ${fCI(loo.s.ciR)}.`);
  }
  // כמה פעמים המחיר חזר? כל האירועים (גרסת reclaim, יעד חצי) — הסתברות להגיע ליעד לפני הסטופ
  const ev2 = res.filter((r) => r.b.mode === 'reclaim' && r.b.target === 'half').map((r) => { const s = r.s.dev; return `| n${r.b.n} · ${r.b.drop}% | ${s.n} | ${r.tr.filter((x) => x.tEntry < P.dev.to && x.why === 'יעד').length} | ${r.tr.filter((x) => x.tEntry < P.dev.to && /סטופ/.test(x.why)).length} | ${r.tr.filter((x) => x.tEntry < P.dev.to && x.why === 'זמן').length} |`; });
  L.push('', '## כמה פעמים המחיר חזר? (כניסה אחרי נר היפוך, יעד = חצי מהנפילה, תקופת הפיתוח)', '| אירוע | עסקאות | הגיע ליעד | נעצר בסטופ | יציאת זמן (24 שעות) |', '|---|---|---|---|---|', ...ev2);
  const md = L.join('\n'); console.log(md); if (OUT) writeFileSync(OUT, md);
}
main().catch((e) => { console.error(e); process.exit(1); });
