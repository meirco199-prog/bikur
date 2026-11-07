#!/usr/bin/env node
// מסגרת הניסויים של מסלול עמית (engine/research.js) על שנה של נרות דקה, 5 מטבעות. מחקר בלבד — אין פקודות ואין מפתחות.
// מקורות ציבוריים בלי מפתח (נגישים מ-GitHub Actions): נרות Coinbase (כולל מחזור), Funding שעתי מ-Hyperliquid (קירוב ל-Bybit).
// שימוש: node --max-old-space-size=6144 invest-api/scripts/research-backtest.mjs [--end 2026-11-07] [--days 365]
//          [--data research-data.json.gz] [--out report.md] [--json summary.json] [--show-test]
// פרוטוקול: תקופת המבחן (20% האחרונים) מוסתרת כברירת מחדל. ריצה עם --show-test נעשית פעם אחת, בסוף, בלי לשנות קוד אחריה.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { prepare, signals, execute, stats, score, greedyFilters, verdict, BASES, FILTERS, COST, RISK, TF_MIN } from '../engine/research.js';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const END = Date.parse(`${arg('--end', '2026-11-07')}T00:00:00Z`), DAYS = Math.min(2000, Math.max(30, Number(arg('--days', 365))));
// --base 5: נרות בסיס של 5 דקות (בדיקה של שנים; רק אסטרטגיות של 15 דקות ומעלה). --min-trades: מינימום עסקאות לבחירה
const BASE = Number(arg('--base', 1)), MIN_TRADES = Number(arg('--min-trades', 60));
const DATA = arg('--data', ''), OUT = arg('--out', ''), JSON_OUT = arg('--json', ''), SHOW_TEST = process.argv.includes('--show-test');
const COINS = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA'], DAY = 86400e3, START = END - DAYS * DAY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'bikur-research/1.0 (backtest)', Accept: 'application/json' };
const log = (...a) => console.error(...a);

async function getJson(url, init = {}, tries = 6){
  for (let k = 0; k < tries; k++){
    try { const r = await fetch(url, { ...init, headers: { ...UA, ...(init.headers || {}) } }); if (r.status === 429){ await sleep(2000 * (k + 1)); continue; } if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
    catch (e) { if (k === tries - 1) throw e; await sleep(1000 * (k + 1)); }
  }
}
async function coinbase(coin){
  const out = new Map(), step = 300 * BASE * 60e3;
  for (let s = START; s < END; s += step){
    const e = Math.min(s + step, END);
    const j = await getJson(`https://api.exchange.coinbase.com/products/${coin}-USD/candles?granularity=${BASE * 60}&start=${new Date(s).toISOString()}&end=${new Date(e).toISOString()}`);
    for (const r of j || []){ const t = r[0] * 1000; if (t >= START && t < END) out.set(t, [t, +r[3], +r[2], +r[1], +r[4], +r[5] * +r[4]]); } // t,o,h,l,c, מחזור בדולרים
    await sleep(110);
  }
  return [...out.values()].sort((a, b) => a[0] - b[0]);
}
async function funding(coin){
  const out = []; let s = START;
  while (s < END){
    const j = await getJson('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'fundingHistory', coin, startTime: s, endTime: END }) });
    if (!Array.isArray(j) || !j.length) break;
    for (const f of j) out.push([f.time, Number(f.fundingRate)]);
    const last = j.at(-1).time; if (last < s) break; s = last + 1; await sleep(200);
  }
  return out;
}
async function loadData(){
  if (DATA && existsSync(DATA)){ log(`נתונים מהמטמון: ${DATA}`); return JSON.parse(gunzipSync(readFileSync(DATA))); }
  const d = { start: START, end: END, bars: {}, funding: {} };
  for (let i = 0; i < COINS.length; i += 2){
    await Promise.all(COINS.slice(i, i + 2).map(async (c) => { d.bars[c] = await coinbase(c); log(`${c}: ${d.bars[c].length} נרות של ${BASE} דק׳ (${(d.bars[c].length / (DAYS * 1440 / BASE) * 100).toFixed(1)}%)`); }));
  }
  for (const c of COINS){ try { d.funding[c] = await funding(c); log(`${c}: ${d.funding[c].length} רשומות Funding`); } catch (e) { d.funding[c] = []; log(`${c}: Funding לא זמין (${e.message}) — עלות קבועה ${COST.fundingBpsPer8h}bp ל-8 שעות`); } }
  if (DATA) writeFileSync(DATA, gzipSync(JSON.stringify(d)));
  return d;
}

// ---------- תקופות ----------
const dayAt = (k) => START + Math.round(DAYS * k) * DAY;
const P = { train: { from: START, to: dayAt(0.6) }, val: { from: dayAt(0.6), to: dayAt(0.8) }, test: { from: dayAt(0.8), to: END }, dev: { from: START, to: dayAt(0.8) } };
const FOLD_TRAIN = Math.round(DAYS * 0.33), FOLD_TEST = Math.round(DAYS * 0.082); // שנה: 120/30 ימים; 5 שנים: 603/150
const folds = []; for (let d = FOLD_TRAIN; START + (d + 1) * DAY <= P.dev.to; d += FOLD_TEST) folds.push({ train: { from: START + (d - FOLD_TRAIN) * DAY, to: START + d * DAY }, test: { from: START + d * DAY, to: Math.min(START + (d + FOLD_TEST) * DAY, P.dev.to) } });
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// ---------- הרצה ----------
const fmt$ = (x) => (x == null || !Number.isFinite(x) ? '—' : (x < 0 ? '−' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US'));
const fR = (x) => (x == null || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(3));
const fCI = (c) => (c ? `[${fR(c[0])}, ${fR(c[1])}]` : '—');
const fPF = (x) => (x === Infinity ? '∞' : x ?? '—');

async function main(){
  const d = await loadData(), ctx = {}, fund = {};
  for (const c of COINS){
    ctx[c] = prepare(d.bars[c].map((r) => ({ t: r[0], o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] })), { baseMin: BASE });
    fund[c] = (d.funding[c] || []).map(([t, rate]) => ({ t, rate }));
  }
  for (const c of COINS) ctx[c].btc = ctx.BTC; // מסנן מגמת ביטקוין
  delete d.bars;
  const fundingSrc = COINS.every((c) => fund[c].length > 100) ? 'Hyperliquid (שעתי)' : `קבוע ${COST.fundingBpsPer8h}bp/8h לחלק מהמטבעות`;
  const run = (base, filters = [], risk) => COINS.flatMap((c) => execute(ctx[c], signals(ctx[c], base), { coin: c, filters, funding: fund[c], risk }));
  const st = (trades, p, extra = {}) => stats(trades, { ...p, coins: COINS, ...extra });

  // 1. כל הבסיסים בלי מסנן (עסקאות נשמרות) + כל מסנן יחיד (סטטיסטיקה בלבד, הרצה מדויקת)
  const res = new Map(); // key → { base, filters, trades?, s: {train, val, test, dev} }
  const t0 = Date.now();
  const SCORE = { minTrades: MIN_TRADES }, sc = (x) => score(x, SCORE);
  const RUN_BASES = BASES.filter((b) => TF_MIN[b.tf] >= 3 * BASE || TF_MIN[b.tf] === 1 && BASE === 1); // על נרות 5 דק׳: רק 15 דק׳ ומעלה
  for (const b of RUN_BASES){
    for (const F of [[], ...FILTERS.map((f) => [f])]){
      const tr = run(b, F), key = F.length ? `${b.id}+${F.join('+')}` : b.id;
      res.set(key, { key, base: b, filters: F, trades: F.length ? null : tr, s: { train: st(tr, P.train), val: st(tr, P.val), test: st(tr, P.test), dev: st(tr, P.dev) } });
    }
    log(`${b.id}: ${res.get(b.id).s.dev.n} עסקאות בפיתוח (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  const baseTrades = (id) => res.get(id).trades;

  // 2. קבוצות הניסוי ובחירת נציג לפי נתוני אימון בלבד
  const keysWhere = (pred) => [...res.values()].filter(pred).map((r) => r.key);
  const isExp = (r, ...e) => e.includes(r.base.exp);
  const groups = [
    { id: 'E1', name: 'קבוצות ביקורת (הבוטים המקוריים)', keys: ['C1-bot1', 'C2-bot2'].filter((k) => res.has(k)), fixed: true },
    { id: 'E3', name: 'גרסאות 5 ו-15 דקות', keys: keysWhere((r) => isExp(r, 3) && !r.filters.length) },
    { id: 'E4', name: 'גרסת שעה (+ תיקון אחרי תנופה)', keys: keysWhere((r) => isExp(r, 4) && !r.filters.length) },
    { id: 'E5', name: 'רק בכיוון המגמה (1H + 4H)', keys: keysWhere((r) => isExp(r, 3, 4, 9) && r.filters.join() === 'trend') },
    { id: 'E6', name: 'מסנני ATR / תנודתיות / נפח / נזילות / שעות', keys: keysWhere((r) => isExp(r, 3, 4, 9) && r.filters.length === 1 && ['atr', 'vol', 'rvol', 'liq', 'sess'].includes(r.filters[0])) },
    { id: 'E7', name: 'סטופ מבני + יעדים 1.5R/2R/3R', keys: keysWhere((r) => isExp(r, 7) && !r.filters.length) },
    { id: 'E9', name: 'טווח גבוה (1h/4h) + סטופ רחב 2%/3%', keys: keysWhere((r) => isExp(r, 9) && !r.filters.length) },
    { id: 'E10', name: 'כניסה מדורגת 1:2:3 בפקודות ממתינות', keys: keysWhere((r) => isExp(r, 10) && !r.filters.length) },
    { id: 'E11', name: 'מסנני מפגש: נפח ×2, EMA50/200/VWAP, מגמת ביטקוין', keys: keysWhere((r) => isExp(r, 3, 4, 9, 10, 12) && r.filters.length === 1 && ['rvol2', 'conf', 'btc'].includes(r.filters[0])) },
    { id: 'E12', name: 'כניסה ממתינה בלבד, עד 3 ביום, מימוש חלקי + ריצה', keys: keysWhere((r) => isExp(r, 12) && !r.filters.length) },
    { id: 'T', name: 'שיטות מגמה ארוכות טווח (לא מעמית)', keys: keysWhere((r) => isExp(r, 20) && !r.filters.length) },
    { id: 'X', name: 'השוואה: פריצה (לא מעמית)', keys: keysWhere((r) => isExp(r, 0) && r.filters.length <= 1 && (!r.filters.length || r.filters[0] === 'trend')) },
  ];
  const pickBest = (keys) => {
    const scored = keys.map((k) => ({ k, sc: sc(res.get(k).s.train) })).filter((x) => x.sc !== null).sort((a, b) => b.sc - a.sc);
    if (scored.length) return { key: scored[0].k, ok: true };
    const fb = keys.filter((k) => res.get(k).s.train.n >= Math.min(30, MIN_TRADES)).sort((a, b) => (res.get(b).s.train.ciR?.[0] ?? -9) - (res.get(a).s.train.ciR?.[0] ?? -9));
    return { key: fb[0] || keys[0], ok: false };
  };
  // 3. ניסוי 8: בוט סלקטיבי — מסננים נבחרים בחמדנות על האימון לכל בסיס, ואז הבסיס עם הציון הגבוה; הרצה מדויקת של הצירוף
  const AMIT_BASES = RUN_BASES.filter((b) => ![1, 0, 20].includes(b.exp)); // הסלקטיבי: רק גרסאות של עמית (לא ביקורת, לא השוואה)
  const sel = AMIT_BASES.map((b) => ({ b, g: greedyFilters(baseTrades(b.id), { ...P.train, coins: COINS }, SCORE) })).filter((x) => x.g.score !== null).sort((a, b) => b.g.score - a.g.score);
  if (sel.length){
    const { b, g } = sel[0], tr = run(b, g.filters), key = `${b.id}+${g.filters.join('+') || 'בלי מסנן'}`;
    res.set(key, { key, base: b, filters: g.filters, trades: tr, s: { train: st(tr, P.train), val: st(tr, P.val), test: st(tr, P.test), dev: st(tr, P.dev) } });
    groups.push({ id: 'E8', name: 'בוט סלקטיבי (מסננים שהוכיחו שיפור באימון)', keys: [key], fixed: true });
  } else groups.push({ id: 'E8', name: 'בוט סלקטיבי', keys: [], fixed: true, none: `אף צירוף לא עמד בתנאי המינימום באימון (${MIN_TRADES} עסקאות, 3/5 מטבעות)` });

  // 4. Walk-Forward על תקופת הפיתוח: בכל קפל בוחרים (בסיס + מסננים חמדניים) לפי 120 ימי אימון, ומודדים ב-30 הימים שאחריהם.
  //    לכל קבוצה בנפרד (בתוך מועמדי הקבוצה), ולתהליך הסלקטיבי כולו. קירוב: מסנן = תת-קבוצה של עסקאות הבסיס.
  const subset = (key) => { const r = res.get(key); const bt = baseTrades(r.base.id); return r.filters.length ? bt.filter((x) => r.filters.every((f) => x.feat[f])) : bt; };
  const wfFor = (cands) => {
    const oos = [], picks = [];
    for (const f of folds){
      const ss = cands.map((c) => ({ c, sc: sc(st(c.trades, f.train)) })).filter((x) => x.sc !== null).sort((a, b) => b.sc - a.sc);
      if (!ss.length){ picks.push('—'); continue; }
      picks.push(ss[0].c.key); oos.push(...ss[0].c.trades.filter((x) => x.tEntry >= f.test.from && x.tEntry < f.test.to));
    }
    return { st: st(oos, { from: folds[0]?.test.from, to: folds.at(-1)?.test.to }), picks };
  };
  const wf = {};
  for (const g of groups){
    if (g.id === 'E8'){
      const cands = AMIT_BASES.map((b) => ({ key: b.id, trades: baseTrades(b.id) }));
      // סלקטיבי: בכל קפל — מסננים חמדניים לכל בסיס על אימון הקפל
      const oos = [], picks = [];
      for (const f of folds){
        const s = cands.map((c) => ({ c, g: greedyFilters(c.trades, { ...f.train, coins: COINS }, SCORE) })).filter((x) => x.g.score !== null).sort((a, b) => b.g.score - a.g.score);
        if (!s.length){ picks.push('—'); continue; }
        const { c, g: gg } = s[0]; picks.push(`${c.key}+${gg.filters.join('+') || '∅'}`);
        oos.push(...c.trades.filter((x) => gg.filters.every((ff) => x.feat[ff]) && x.tEntry >= f.test.from && x.tEntry < f.test.to));
      }
      wf.E8 = { st: st(oos, { from: folds[0]?.test.from, to: folds.at(-1)?.test.to }), picks };
    } else if (g.fixed){ // ביקורת: אין בחירה — אותה גרסה בחלונות הבדיקה של הקפלים
      for (const k of g.keys){
        const tr = res.get(k).trades.filter((x) => folds.some((f) => x.tEntry >= f.test.from && x.tEntry < f.test.to));
        wf[`${g.id}:${k}`] = { st: st(tr, { from: folds[0]?.test.from, to: folds.at(-1)?.test.to }), picks: folds.map(() => k) };
      }
    } else wf[g.id] = wfFor(g.keys.map((k) => ({ key: k, trades: subset(k) })));
  }

  // 5. נציגי הקבוצות + פסיקה
  const finals = [];
  for (const g of groups){
    const keys = g.fixed ? g.keys : [pickBest(g.keys).key];
    for (const k of keys){
      if (!k) continue;
      const r = res.get(k), tr = r.trades || run(r.base, r.filters);
      r.trades = tr;
      const cost15 = st(tr, SHOW_TEST ? P.test : P.val, { costMult: 1.5 }), cost2 = st(tr, SHOW_TEST ? P.test : P.val, { costMult: 2 });
      const w = (wf[`${g.id}:${k}`] || wf[g.id])?.st;
      const v = verdict({ train: r.s.train, val: r.s.val, test: SHOW_TEST ? r.s.test : null, wf: w, cost15 });
      finals.push({ g, key: k, r, v, cost15, cost2, wf: w, ok: g.fixed ? true : pickBest(g.keys).ok });
    }
  }
  // 6. סיכון מוקטן (200$ / 100$), אותן גרסאות
  const evalP = SHOW_TEST ? P.test : P.val;
  for (const f of finals){ f.risk = [400, 200, 100].map((rk) => ({ rk, s: rk === 400 ? st(f.r.trades, evalP) : st(run(f.r.base, f.r.filters, { riskUsd: rk }), evalP) })); }
  // 7. תנאי שוק: מגמת BTC (תשואת 7 ימים) ותנודתיות יומית של המטבע (שלישונים לפי האימון)
  const dailyClose = (c) => { const m = new Map(); for (const b of ctx[c].m1) m.set(Math.floor(b.t / DAY), b.c); return m; };
  const btcD = dailyClose('BTC'), regimeOf = (t) => { const dd = Math.floor(t / DAY), a = btcD.get(dd - 1), b0 = btcD.get(dd - 8); if (!a || !b0) return 'לא ידוע'; const r = a / b0 - 1; return r > 0.05 ? 'BTC עולה' : r < -0.05 ? 'BTC יורד' : 'BTC מדשדש'; };
  const dayRange = {}; for (const c of COINS){ const m = new Map(); for (const b of ctx[c].m1){ const k = Math.floor(b.t / DAY), x = m.get(k) || { h: -Infinity, l: Infinity }; x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); m.set(k, x); } dayRange[c] = new Map([...m].map(([k, x]) => [k, (x.h - x.l) / x.l * 100])); }
  const volThr = {}; for (const c of COINS){ const v = [...dayRange[c]].filter(([k]) => k * DAY >= P.train.from && k * DAY < P.train.to).map(([, x]) => x).sort((a, b) => a - b); volThr[c] = [v[Math.floor(v.length / 3)], v[Math.floor(2 * v.length / 3)]]; }
  const volOf = (x) => { const r = dayRange[x.coin].get(Math.floor(x.tEntry / DAY) - 1); if (r === undefined) return 'לא ידוע'; return r < volThr[x.coin][0] ? 'תנודתיות נמוכה' : r < volThr[x.coin][1] ? 'תנודתיות בינונית' : 'תנודתיות גבוהה'; };
  const regP = SHOW_TEST ? { from: START, to: END } : P.dev;
  for (const f of finals){
    const by = {}; for (const x of f.r.trades){ if (x.tEntry < regP.from || x.tEntry >= regP.to) continue; for (const k of [regimeOf(x.tEntry), volOf(x)]) (by[k] ||= []).push(x); }
    f.regimes = Object.fromEntries(Object.entries(by).map(([k, v]) => [k, stats(v, {})]));
  }

  // ---------- דוח ----------
  const L = [];
  const C1 = res.get('C1-bot1')?.s, C2 = res.get('C2-bot2')?.s;
  L.push(`# מסגרת ניסויים — מסלול עמית: ${DAYS} ימים (נרות בסיס ${BASE} דק׳), ${COINS.join('/')}, ${iso(START)} → ${iso(END)}`);
  L.push(`אימון ${iso(P.train.from)}→${iso(P.train.to)} · אימות ${iso(P.val.from)}→${iso(P.val.to)} · מבחן ${iso(P.test.from)}→${iso(P.test.to)} ${SHOW_TEST ? '(**נפתח**)' : '(🔒 מוסתר)'} · Walk-Forward: ${folds.length} קפלים של ${FOLD_TRAIN} ימי אימון → ${FOLD_TEST} ימי בדיקה.`);
  L.push(`עלויות: עמלות ${COST.makerBps}/${COST.takerBps}bp (ממתינה/מיידית), חצי מרווח ${JSON.stringify(COST.halfSpreadBps)}bp, החלקה ${JSON.stringify(COST.slipBps)}bp, Funding: ${fundingSrc}. מילוי ממתינה: חציה ב-${COST.penBps}bp, עד ${COST.partRate * 100}% ממחזור הדקה, מינימום ${COST.minFill * 100}%. סיכון ${RISK.riskUsd}$ לעסקה, חשיפה עד ${RISK.maxNotional.toLocaleString('en-US')}$ (בלי הגדלת מינוף).`, '');
  L.push('## 0. שער: האם לאסטרטגיה המקורית יש תוחלת חיובית לפני עלויות?');
  L.push('| ביקורת | תקופה | עסקאות | תוחלת ברוטו (R) | טווח 95% | תוחלת נטו (R) | טווח 95% |', '|---|---|---|---|---|---|---|');
  for (const [nm, s] of [['בוט 1', C1], ['בוט 2', C2]].filter((x) => x[1])) for (const [pn, p] of [['אימון', 'train'], ['פיתוח (אימון+אימות)', 'dev'], ...(SHOW_TEST ? [['מבחן', 'test']] : [])]) L.push(`| ${nm} | ${pn} | ${s[p].n} | ${fR(s[p].expRGross)} | ${fCI(s[p].ciRGross)} | ${fR(s[p].expR)} | ${fCI(s[p].ciR)} |`);
  const gate = (s) => (s.dev.ciRGross && s.dev.ciRGross[1] < 0 ? 'שלילית בביטחון — אין יתרון גם לפני עלויות' : s.dev.ciRGross && s.dev.ciRGross[0] > 0 ? 'חיובית בביטחון לפני עלויות' : 'לא מובהקת — לא ניתן לשלול אפס');
  L.push('', `${C1 ? `**בוט 1:** ${gate(C1)}. ` : '**בוט 1:** לא נבדק בריצה הזו (נרות בסיס של 5 דקות). '}**בוט 2:** ${gate(C2)}. (R = רווח/הפסד ביחס לסיכון של העסקה; ‎−1R = סטופ מלא.)`, '');

  L.push('**הניסויים:** ' + groups.map((g) => `${g.id} — ${g.name}`).join(' · '), '');
  L.push(`## 1. נציג כל ניסוי (נבחר לפי אימון בלבד: הגבול התחתון של תוחלת נטו ב-R, מינימום ${MIN_TRADES} עסקאות, רווח ב-3/5 מטבעות)`);
  const head = '| ניסוי | גרסה | תקופה | עסקאות | הצלחה | ברוטו | עמלות | מרווח+החלקה | Funding | **נטו** | תוחלת $ | תוחלת R [95%] | PF | ירידה מקס׳ | נטו ליום [95%] |';
  L.push(head, '|' + '---|'.repeat(15));
  for (const f of finals){
    for (const [pn, p] of [['אימון', 'train'], ['אימות', 'val'], ['מבחן', 'test']]){
      const s = f.r.s[p];
      if (p === 'test' && !SHOW_TEST){ L.push(`| ${f.g.id} | \`${f.key}\` | מבחן | 🔒 | | | | | | | | | | | |`); continue; }
      L.push(`| ${f.g.id} | \`${f.key}\`${f.ok ? '' : ' ⚠️'} | ${pn} | ${s.n} | ${s.winRate ?? '—'}% | ${fmt$(s.gross)} | ${fmt$(-s.fees)} | ${fmt$(-s.spreadSlip)} | ${fmt$(-s.funding)} | **${fmt$(s.net)}** | ${fmt$(s.exp)} | ${fR(s.expR)} ${fCI(s.ciR)} | ${fPF(s.pf)} | ${fmt$(-s.maxDD)} | ${fmt$(s.perDay)} ${s.ciDay ? `[${fmt$(s.ciDay[0])}, ${fmt$(s.ciDay[1])}]` : ''} |`);
    }
  }
  L.push('', '⚠️ = אף גרסה בקבוצה לא עמדה בתנאי המינימום באימון; מוצגת הטובה ביותר לפי הגבול התחתון.', '');
  L.push('## 2. פסיקה');
  L.push('| ניסוי | גרסה | Walk-Forward (מחוץ למדגם) | פסיקה | למה |', '|---|---|---|---|---|');
  const icon = { pass: '✅ מרוויחה בביטחון', promising: '🟡 מבטיחה, לא מובהקת', pending: '⏳ עברה אימון ואימות', fail: '❌ נכשלה' };
  for (const f of finals){ const w = f.wf; L.push(`| ${f.g.id} | \`${f.key}\` | ${w ? `${w.n} עסק׳, ${fmt$(w.net)}, R ${fR(w.expR)} ${fCI(w.ciR)}` : '—'} | ${icon[f.v.level]} | ${f.v.why} |`); }
  for (const g of groups) if (g.none) L.push(`| ${g.id} | — | — | ❌ נכשלה | ${g.none} |`);
  L.push('');
  L.push(`## 3. רגישות לעלויות (${SHOW_TEST ? 'מבחן' : 'אימות'})`);
  L.push('| גרסה | לפני עלויות | עמלות עמית/VIP (1.4/3.5bp) | עלויות ×1 | ×1.5 | ×2 | מכפיל איזון (אימון) |', '|---|---|---|---|---|---|---|');
  for (const f of finals){ const s1 = f.r.s[SHOW_TEST ? 'test' : 'val'], vip = st(f.r.trades, SHOW_TEST ? P.test : P.val, { feeTier: { maker: 1.4, taker: 3.5 } }); L.push(`| \`${f.key}\` | ${fmt$(s1.gross)} | ${fmt$(vip.net)} | ${fmt$(s1.net)} | ${fmt$(f.cost15.net)} | ${fmt$(f.cost2.net)} | ${f.r.s.train.breakEvenCost ?? '—'} |`); }
  L.push('', 'מכפיל איזון = פי כמה העלויות (עמלות+מרווח+החלקה) יכולות להיות ביחס לנוכחיות עד שהגרסה מתאזנת. מתחת ל-1 = מפסידה; שלילי = מפסידה גם בלי עלויות.');
  L.push('', `## 4. סיכון מוקטן לעסקה (${SHOW_TEST ? 'מבחן' : 'אימות'}) — אותו מינוף מקסימלי, עסקאות קטנות יותר`);
  L.push('| גרסה | 400$: נטו / R / PF / ירידה | 200$ | 100$ |', '|---|---|---|---|');
  for (const f of finals) L.push(`| \`${f.key}\` | ` + f.risk.map(({ s }) => `${fmt$(s.net)} / ${fR(s.expR)} / ${fPF(s.pf)} / ${fmt$(-s.maxDD)}`).join(' | ') + ' |');
  L.push('', `## 5. תנאי שוק (${SHOW_TEST ? 'כל השנה' : 'תקופת הפיתוח'}) — תוחלת נטו ב-R (עסקאות)`);
  const regK = ['BTC עולה', 'BTC מדשדש', 'BTC יורד', 'תנודתיות נמוכה', 'תנודתיות בינונית', 'תנודתיות גבוהה'];
  L.push('| גרסה | ' + regK.join(' | ') + ' |', '|---|' + regK.map(() => '---').join('|') + '|');
  for (const f of finals) L.push(`| \`${f.key}\` | ` + regK.map((k) => { const s = f.regimes[k]; return s ? `${fR(s.expR)} (${s.n})` : '—'; }).join(' | ') + ' |');
  L.push('', '## 6. כל הגרסאות באימון (מיון לפי הגבול התחתון של תוחלת נטו ב-R)');
  const all = [...res.values()].map((r) => ({ r, s: r.s.train })).sort((a, b) => (b.s.ciR?.[0] ?? -9) - (a.s.ciR?.[0] ?? -9));
  const posLB = all.filter((x) => x.s.ciR && x.s.ciR[0] > 0).length, posG = all.filter((x) => x.s.ciRGross && x.s.ciRGross[0] > 0).length;
  L.push(`נבדקו ${all.length} צירופים. גבול תחתון חיובי נטו: **${posLB}**; לפני עלויות: **${posG}**. במקרה בלבד צפויים כ-${Math.round(all.length * 0.025)} (2.5%).`, '');
  L.push('| גרסה | עסקאות | ברוטו R [95%] | נטו R [95%] | נטו | PF | מטבעות ברווח | אימות: נטו / R |', '|---|---|---|---|---|---|---|---|');
  for (const { r, s } of all) L.push(`| \`${r.key}\` | ${s.n} | ${fR(s.expRGross)} ${fCI(s.ciRGross)} | ${fR(s.expR)} ${fCI(s.ciR)} | ${fmt$(s.net)} | ${fPF(s.pf)} | ${s.coinsPos}/5 | ${fmt$(r.s.val.net)} / ${fR(r.s.val.expR)} |`);
  L.push('', '## 7. Walk-Forward — מה נבחר בכל קפל');
  for (const g of groups) if (wf[g.id]) L.push(`- **${g.id}**: ${wf[g.id].picks.map((p, i) => `${iso(folds[i].test.from)}: \`${p}\``).join(' · ')}`);
  const md = L.join('\n');
  console.log(md);
  if (OUT) writeFileSync(OUT, md);
  if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify({ start: START, end: END, periods: P, folds, showTest: SHOW_TEST, cost: COST, risk: RISK,
    results: [...res.values()].map((r) => ({ key: r.key, filters: r.filters, base: r.base.id, s: SHOW_TEST ? r.s : { ...r.s, test: null } })),
    finals: finals.map((f) => ({ group: f.g.id, key: f.key, verdict: f.v, wf: f.wf, risk: f.risk, regimes: f.regimes })) }, null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
