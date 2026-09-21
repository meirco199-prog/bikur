// מסלולי השוואה (תיקי צל) — הרצה: החלטה בלילה (אחרי הדירוג ומודל הצל), מילוי לפי מחירי 09:40 ניו יורק (entry940:{day}),
// שורת הון יומית בסגירה, מדדי ייחוס שקליים, והשוואה מרכזית. מפתחות: track:{id}:* (מצב, הון, יומן, ממתינות) — מופרדים לחלוטין
// מחשבון התרגול (paper:*) ומהמסלול האגרסיבי הקיים (aggr:*). שום דבר כאן לא שולח פקודות לברוקר.
import { TRACKS, TRACK_IDS, BENCHMARKS, INITIAL_ILS, FILL_SLIPPAGE, TRACKS_VERSION, decideAggressiveB, preflight, benchStart, benchValue, trackMetrics, returnBetween, selectionAlpha, bucketOf, CORE_ETFS } from '../engine/tracks.js';
import { decideOrders } from '../engine/autopilot.js';
import { applyFills, markToMarket, newAggrState, sectorExposure, aggrMetrics } from '../engine/aggressive.js';
import { nyTimeIso } from '../engine/session.js';
import { PaperBroker } from './broker.js';
import { latestRankDay, getPrices, assetMeta } from './analysis.js';
import { isNum, round } from '../engine/util.js';

const KEY = (id, k) => `track:${id}:${k}`;
const JOURNAL_MAX = 400;

async function meta(db, id){ return (await db.get(KEY(id, 'meta'))) || null; }
async function ensureMeta(db, id, day){
  let m = await meta(db, id);
  if (!m){ m = { id, version: TRACKS_VERSION, startDay: day, createdAt: new Date().toISOString(), initialIls: INITIAL_ILS, rules: TRACKS[id].kind === 'aggressive' ? TRACKS[id].rules : { profile: TRACKS[id].profile, limits: TRACKS[id].limits, rules: TRACKS[id].rules } }; await db.put(KEY(id, 'meta'), m); }
  return m;
}
const brokerOf = (db, id) => new PaperBroker(db, { prefix: KEY(id, 'paper:') });
async function pushJournal(db, id, entry){ const j = (await db.get(KEY(id, 'journal'))) || []; j.push(entry); await db.put(KEY(id, 'journal'), j.slice(-JOURNAL_MAX)); }

async function allocationSnapshot(db, id, table, fx){
  const broker = brokerOf(db, id);
  const priceOf = (s) => table.find((r) => r.symbol === s)?.price ?? null;
  const perf = await broker.performance(priceOf, fx);
  const buckets = { stocks: 0, etf: 0, bonds: 0, gold: 0 };
  for (const p of perf.positions) buckets[bucketOf(p.symbol, table)] += p.valueIls ?? p.costIls ?? 0;
  const total = perf.totalIls;
  const exposure = { stocksIls: round(buckets.stocks, 0), etfIls: round(buckets.etf, 0), bondsIls: round(buckets.bonds, 0), goldIls: round(buckets.gold, 0), cashIls: round(perf.cashIls, 0), equityIls: round(buckets.stocks + buckets.etf, 0), stocksShare: total ? round(buckets.stocks / total, 3) : 0, etfShare: total ? round(buckets.etf / total, 3) : 0, bondsShare: total ? round(buckets.bonds / total, 3) : 0, goldShare: total ? round(buckets.gold / total, 3) : 0, cashShare: total ? round(perf.cashIls / total, 3) : 0, equityShare: total ? round((buckets.stocks + buckets.etf) / total, 3) : 0 };
  return { broker, perf: { ...perf, stocksIls: buckets.stocks }, exposure };
}
async function putEquityRow(db, id, row){
  const eq = (await db.get(KEY(id, 'equity'))) || [];
  const i = eq.findIndex((e) => e.day === row.day); if (i >= 0) eq[i] = row; else eq.push(row);
  await db.put(KEY(id, 'equity'), eq.sort((a, b) => a.day.localeCompare(b.day)).slice(-2000));
}

// ---------- לילה: החלטה (על סגירות היום) + שורת הון ----------
export async function runTracksDecide(ctx, { day = null, force = false } = {}){
  const { db } = ctx;
  day = day || (await latestRankDay(db));
  if (!day) return { ran: false, reason: 'אין דירוג עדיין' };
  const rank = await db.get(`rank:${day}`); if (!rank?.table?.length) return { ran: false, reason: `אין טבלת דירוג ל-${day}` };
  const shadow = await db.get(`shadow:${day}`);
  const regime = (await db.get(`regime:${day}`)) || null;
  const fx = (await db.get('fx:USDILS'))?.rate || 3.7;
  const table = rank.table; const spyPrice = table.find((r) => r.symbol === 'SPY')?.price ?? null;
  const out = { ran: true, day, tracks: {} };
  for (const id of TRACK_IDS){
    const T = TRACKS[id];
    try {
      const m = await ensureMeta(db, id, day);
      const pend = await db.get(KEY(id, 'pending'));
      if (pend?.day === day && !force){ out.tracks[id] = { skipped: 'כבר הוחלט היום' }; continue; }
      const cancelled = pend && !pend.filled ? pend.orders.length : 0;
      if (T.kind === 'allocation'){
        const { perf, exposure } = await allocationSnapshot(db, id, table, fx);
        const d = decideOrders({ table, regime, perf, profile: T.profile, fx, today: day, buysToday: 0, boughtToday: [], rules: T.rules, limits: T.limits });
        const orders = d.orders.map((o) => ({ ...o, decisionPrice: o.priceRef }));
        const pending = { track: id, day, decidedAt: new Date().toISOString(), orders, filled: false, notes: d.notes, skipped: d.skipped.slice(0, 12), fx };
        await db.put(KEY(id, 'pending'), pending);
        await putEquityRow(db, id, { day, total: round(perf.totalIls, 2), fx, ...exposure, source: 'close' });
        await pushJournal(db, id, { ts: new Date().toISOString(), day, type: 'decide', orders: orders.map((o) => `${o.side} ${o.qty} ${o.symbol} — ${o.reason}`), notes: d.notes, cancelled, totalIls: round(perf.totalIls, 0), cashIls: round(perf.cashIls, 0), exposure });
        out.tracks[id] = { orders: orders.length, totalIls: round(perf.totalIls, 0), equityShare: exposure.equityShare, cancelled };
      } else {
        if (!shadow?.rows?.length){ out.tracks[id] = { skipped: 'מודל הצל עוד לא רץ' }; continue; }
        let state = (await db.get(KEY(id, 'state'))) || { ...newAggrState(INITIAL_ILS, day), track: id };
        if (state.track && state.track !== id){ out.tracks[id] = { error: 'mixing' }; continue; }
        if (state.lastDay === day && !force){ out.tracks[id] = { skipped: 'כבר הוחלט היום' }; continue; }
        const r = decideAggressiveB({ state, rows: shadow.rows, spyPrice, regime, fx, day, rules: T.rules });
        r.state.track = id; r.state.variant = shadow.models?.DF?.variant || null; r.state.lastTotalIls = r.totalIls;
        const pending = { track: id, day, decidedAt: new Date().toISOString(), orders: r.orders.map((o) => ({ ...o, filled: false })), filled: false, notes: r.notes, projectedExposure: r.projectedExposure, fx };
        await db.put(KEY(id, 'state'), r.state);
        await db.put(KEY(id, 'pending'), pending);
        await putEquityRow(db, id, { day, total: round(r.totalIls, 2), fx, stocksIls: r.exposure.stocksIls, etfIls: r.exposure.etfIls, cashIls: r.exposure.cashIls, equityIls: r.exposure.equityIls, stocksShare: r.exposure.stocksShare, etfShare: r.exposure.etfShare, cashShare: r.exposure.cashShare, equityShare: r.exposure.equityShare, variant: r.state.variant, source: 'close' });
        await pushJournal(db, id, { ts: new Date().toISOString(), day, type: 'decide', orders: r.orders.map((o) => `${o.side} ${o.qty} ${o.symbol} — ${o.reason}`), notes: r.notes, cancelled, totalIls: r.totalIls, cashIls: r.cashIls, exposure: r.exposure, qualifying: r.state.qualifyingToday });
        out.tracks[id] = { orders: r.orders.length, totalIls: r.totalIls, equityShare: r.exposure.equityShare, qualifying: r.state.qualifyingToday, cancelled };
      }
      void m;
    } catch (e) { out.tracks[id] = { error: e.message }; await db.logError?.(`track:${id}`, e.message); }
  }
  // מדדי ייחוס: שורת הון יומית באותה סגירה ובאותו שער
  for (const bid of Object.keys(BENCHMARKS)){
    const b = await db.get(`bench:${bid}`); if (!b) continue;
    const v = benchValue(b, spyPrice, fx); if (v === null) continue;
    await putEquityRow(db, `bench-${bid}`, { day, total: v, fx, spy: spyPrice, equityShare: BENCHMARKS[bid].share, cashIls: b.cashIls, source: 'close' });
  }
  return out;
}

// ---------- מילוי לפי מחירי 09:40 של אותו יום (entry940:{day}) ----------
// נקרא כשהמחירים נקלטים (POST /ingest/entry) ומה-workflow. אידמפוטנטי: פקודות שכבר בוצעו לא יבוצעו שוב.
export async function runTracksFill(ctx, { day = null } = {}){
  const { db } = ctx;
  const out = { ran: true, tracks: {} };
  for (const id of TRACK_IDS){
    const T = TRACKS[id];
    try {
      const pending = await db.get(KEY(id, 'pending'));
      if (!pending || pending.filled){ out.tracks[id] = { skipped: pending ? 'כבר בוצע' : 'אין ממתינות' }; continue; }
      const fillDay = day || pending.day;
      const priceDoc = await db.get(`entry940:${fillDay}`);
      const fx = (await db.get('fx:USDILS'))?.rate || pending.fx || 3.7;
      const at = nyTimeIso(fillDay, 9, 40);
      const rank = await db.get(`rank:${pending.day}`); const table = rank?.table || [];
      if (!pending.orders.length){ pending.filled = true; pending.filledAt = new Date().toISOString(); await db.put(KEY(id, 'pending'), pending); out.tracks[id] = { filled: 0 }; continue; }
      let state = null, perf = null;
      if (T.kind === 'aggressive') state = await db.get(KEY(id, 'state'));
      else perf = (await allocationSnapshot(db, id, table, fx)).perf;
      const pf = preflight({ track: T, pending, priceDoc, fillDay, state, perf, fx });
      // מחיר חסר לנייר בודד (למשל לא נסחר ב-09:40) לא חוסם את כל היום — אותו נייר נשאר ממתין ומתבטל בהחלטה הבאה
      const blocking = pf.violations.filter((v) => !['partial-price'].includes(v.code));
      if (blocking.length){ await pushJournal(db, id, { ts: new Date().toISOString(), day: fillDay, type: 'preflight-block', violations: blocking }); out.tracks[id] = { blocked: blocking.map((v) => v.code) }; continue; }
      const px = priceDoc.prices; const fills = []; const skipped = [];
      if (T.kind === 'aggressive'){
        for (const o of pending.orders){ if (o.filled) continue; const p = px[o.symbol]; if (!isNum(p) || p <= 0){ skipped.push({ symbol: o.symbol, reason: 'אין מחיר 09:40' }); continue; } fills.push({ ...o, price: p, quoteAsOf: at, fillKind: 'entry940' }); o.filled = true; o.fillPrice = p; o.filledAt = at; }
        if (fills.length){
          const a = applyFills(state, fills, { fx, day: fillDay, rules: T.rules });
          if (!isNum(state.spyRef) && isNum(px.SPY)){ a.state.spyRef = px.SPY; a.state.spyRefAt = at; }
          a.state.track = id;
          if (a.state.cashIls < -1){ await pushJournal(db, id, { ts: new Date().toISOString(), day: fillDay, type: 'preflight-block', violations: [{ code: 'negative-cash-after', detail: `מזומן ${round(a.state.cashIls, 0)}` }] }); out.tracks[id] = { blocked: ['negative-cash-after'] }; continue; }
          await db.put(KEY(id, 'state'), a.state);
          const j = (await db.get(KEY(id, 'journal'))) || []; j.push({ ts: new Date().toISOString(), day: fillDay, type: 'fill', trades: a.trades, skipped }); await db.put(KEY(id, 'journal'), j.slice(-JOURNAL_MAX));
        }
      } else {
        const broker = brokerOf(db, id); const trades = [];
        for (const o of pending.orders){
          if (o.filled) continue; const p = px[o.symbol]; if (!isNum(p) || p <= 0){ skipped.push({ symbol: o.symbol, reason: 'אין מחיר 09:40' }); continue; }
          const fill = round(o.side === 'buy' ? p * (1 + FILL_SLIPPAGE) : p * (1 - FILL_SLIPPAGE), 4);
          try {
            const r = await broker.placeOrder({ symbol: o.symbol, side: o.side, qty: o.qty, price: fill, currency: o.currency || 'USD', fx, reason: `מסלול ${T.label}: ${o.reason}`, signal: table.find((x) => x.symbol === o.symbol)?.signal || null, snapDate: pending.day, priceSource: { source: 'entry940', asOf: at, decisionPrice: o.decisionPrice, gapPct: isNum(o.decisionPrice) && o.decisionPrice > 0 ? round(p / o.decisionPrice - 1, 4) : null }, at });
            o.filled = true; o.fillPrice = fill; o.filledAt = at;
            trades.push({ side: o.side, symbol: o.symbol, qty: o.qty, price: fill, quotePrice: p, decisionPrice: o.decisionPrice, gapPct: isNum(o.decisionPrice) && o.decisionPrice > 0 ? round(p / o.decisionPrice - 1, 4) : null, feeIls: o.side === 'buy' ? r.trade.feeIls : null, ils: o.side === 'buy' ? r.trade.costIls : r.proceedsIls, pnlIls: o.side === 'sell' ? round(r.closed.reduce((s, x) => s + (x.pnlIls || 0), 0), 0) : null, reason: o.reason, day: fillDay, fillKind: 'entry940' });
          } catch (e) { skipped.push({ symbol: o.symbol, reason: e.message }); }
        }
        await pushJournal(db, id, { ts: new Date().toISOString(), day: fillDay, type: 'fill', trades, skipped });
        fills.push(...trades);
      }
      pending.filled = pending.orders.every((o) => o.filled) || skipped.length === 0; pending.filledAt = new Date().toISOString(); pending.skipped = skipped;
      await db.put(KEY(id, 'pending'), pending);
      out.tracks[id] = { filled: fills.length, skipped: skipped.length };
      // מדדי ייחוס: נפתחים ביום המילוי הראשון של המסלולים, באותו מחיר 09:40 של SPY
      for (const bid of Object.keys(BENCHMARKS)) if (!(await db.get(`bench:${bid}`)) && isNum(px.SPY)){ const b = benchStart({ id: bid, day: fillDay, price940: px.SPY, fx }); if (b) await db.put(`bench:${bid}`, b); }
    } catch (e) { out.tracks[id] = { error: e.message }; await db.logError?.(`track-fill:${id}`, e.message); }
  }
  return out;
}

// ---------- דוחות ----------
export async function trackReport(db, id){
  const T = TRACKS[id]; if (!T) return { missing: true, reason: 'מסלול לא קיים' };
  const m = await meta(db, id);
  const equity = (await db.get(KEY(id, 'equity'))) || [];
  const journal = (await db.get(KEY(id, 'journal'))) || [];
  const pending = await db.get(KEY(id, 'pending'));
  const day = await latestRankDay(db); const rank = day ? await db.get(`rank:${day}`) : null; const table = rank?.table || [];
  const fx = (await db.get('fx:USDILS'))?.rate || 3.7;
  const base = { id, kind: T.kind, label: T.label, desc: T.desc, benchmark: T.benchmark, startDay: m?.startDay || null, initialIls: INITIAL_ILS, rules: T.kind === 'aggressive' ? T.rules : { profile: T.profile, limits: T.limits, rules: { riskBudget: T.rules.riskBudget, tranches: T.rules.tranches, maxBuysPerRun: T.rules.maxBuysPerRun, minCoverage: T.rules.minCoverage } }, metrics: trackMetrics(equity, INITIAL_ILS), equity: equity.slice(-250), pending, journal: journal.slice(-40).reverse() };
  if (!m) return { ...base, missing: true, reason: 'המסלול עוד לא התחיל' };
  if (T.kind === 'aggressive'){
    const state = await db.get(KEY(id, 'state')); if (!state) return { ...base, missing: true };
    const priceOf = (s) => table.find((r) => r.symbol === s)?.price ?? null;
    const mtm = markToMarket(state, priceOf, fx);
    return { ...base, totalIls: round(mtm.totalIls, 0), cashIls: round(state.cashIls, 0), exposure: mtm.exposure, sectors: sectorExposure(mtm.rows, mtm.totalIls, T.rules), positions: mtm.rows.sort((a, b) => b.valueIls - a.valueIls), stats: state.stats, spyRef: state.spyRef ?? null, variant: state.variant ?? null, trades: journal.filter((j) => j.type === 'fill').flatMap((j) => j.trades || []).slice(-30).reverse(), costs: { feesIls: round(state.stats.feesIls, 0), trades: state.stats.trades } };
  }
  const { perf, exposure } = await allocationSnapshot(db, id, table, fx);
  const core = table.find((r) => r.symbol === 'VTI');
  let selection = { ils: null, lots: 0 };
  try {
    const px = await getPrices('VTI', { db, env: {}, asset: await assetMeta(db, 'VTI') }).catch(() => null);
    const rows = px?.rows || [];
    const at = (iso) => { const d = String(iso).slice(0, 10); let last = null; for (const r of rows){ if (r[0] <= d) last = r[4]; else break; } return last; };
    const lots = perf.open.concat(perf.closed).filter((l) => bucketOf(l.symbol, table) === 'stocks').map((l) => ({ symbol: l.symbol, costIls: l.costIls, pnlIls: l.exitDate ? l.pnlIls : (isNum(perf.positions.find((p) => p.symbol === l.symbol)?.current) ? round(l.qty * perf.positions.find((p) => p.symbol === l.symbol).current * fx - l.costIls, 2) : null), date: l.date, exitDate: l.exitDate || null }));
    selection = selectionAlpha(lots, at, core?.price ?? null);
  } catch {}
  return { ...base, totalIls: round(perf.totalIls, 0), cashIls: round(perf.cashIls, 0), exposure, positions: perf.positions.map((p) => ({ ...p, bucket: bucketOf(p.symbol, table) })), trades: journal.filter((j) => j.type === 'fill').flatMap((j) => j.trades || []).slice(-30).reverse(), costs: { feesIls: round(perf.commissionsIls, 0), trades: perf.trades }, selection, targets: T.profile.sleeves };
}

// השוואה מרכזית: חמשת המסלולים + מדדי ייחוס שקליים, תקופה משותפת, ומדדים לכל אחד
export async function tracksCompare(db){
  const day = await latestRankDay(db); const rank = day ? await db.get(`rank:${day}`) : null; const table = rank?.table || [];
  const fx = (await db.get('fx:USDILS'))?.rate || 3.7;
  const spyNow = table.find((r) => r.symbol === 'SPY')?.price ?? null;
  const items = [];
  // 1. חשבון התרגול המאוזן (הקיים): [day, total, spy]
  {
    const broker = new PaperBroker(db);
    const priceOf = (s) => table.find((r) => r.symbol === s)?.price ?? null;
    const perf = await broker.performance(priceOf, fx);
    const eq = (perf.equity || []).map((e) => ({ day: e[0], total: e[1], fx: null, spy: e[2] }));
    const buckets = { stocks: 0, etf: 0, bonds: 0, gold: 0 }; for (const p of perf.positions) buckets[bucketOf(p.symbol, table)] += p.valueIls ?? p.costIls ?? 0;
    const total = perf.totalIls;
    items.push({ id: 'paper', label: 'מאוזן (חשבון התרגול)', kind: 'allocation', control: true, benchmark: 'spy', startDay: (perf.account?.createdAt || '').slice(0, 10) || null, initialIls: perf.account?.initialIls || INITIAL_ILS, totalIls: round(total, 0), cashIls: round(perf.cashIls, 0), exposure: { stocksShare: total ? round(buckets.stocks / total, 3) : 0, etfShare: total ? round(buckets.etf / total, 3) : 0, bondsShare: total ? round(buckets.bonds / total, 3) : 0, goldShare: total ? round(buckets.gold / total, 3) : 0, cashShare: total ? round(perf.cashIls / total, 3) : 0, equityShare: total ? round((buckets.stocks + buckets.etf) / total, 3) : 0 }, metrics: { ...(trackMetrics(eq, perf.baseIls || perf.account?.initialIls || INITIAL_ILS) || {}), totalReturn: perf.pnlPct }, costs: { feesIls: round(perf.commissionsIls, 0), trades: perf.trades }, equity: eq, targets: { coreEquity: 0.5, stocks: 0.2, bonds: 0.2, gold: 0.05, cash: 0.05 }, note: 'קבוצת ביקורת — לא משתנה' });
  }
  // 2. המסלול האגרסיבי הקיים: [day, total, spy, variant, exposure?]
  {
    const state = await db.get('aggr:state'); const eqRaw = (await db.get('aggr:equity')) || [];
    if (state){
      const priceOf = (s) => table.find((r) => r.symbol === s)?.price ?? null;
      const mtm = markToMarket(state, priceOf, fx);
      const eq = eqRaw.map((e) => ({ day: e[0], total: e[1], fx: null, spy: e[2], variant: e[3], ...(e[4] || {}) }));
      const am = aggrMetrics(eqRaw, state.initialIls, state.spyRef ?? null);
      items.push({ id: 'aggr', label: 'אגרסיבי (מודל D)', kind: 'aggressive', control: true, benchmark: 'spy95', startDay: state.createdDay || eqRaw[0]?.[0] || null, initialIls: state.initialIls, totalIls: round(mtm.totalIls, 0), cashIls: round(state.cashIls, 0), exposure: mtm.exposure, metrics: { ...(trackMetrics(eq, state.initialIls) || {}), spyReturnUsd: am?.spyReturn ?? null }, costs: { feesIls: round(state.stats.feesIls, 0), trades: state.stats.trades }, equity: eq, note: 'קבוצת ביקורת — לא משתנה', variant: state.variant });
    }
  }
  // 3. המסלולים החדשים
  for (const id of TRACK_IDS){
    const r = await trackReport(db, id);
    items.push({ id, label: r.label, kind: r.kind, control: false, benchmark: r.benchmark, startDay: r.startDay, initialIls: INITIAL_ILS, totalIls: r.totalIls ?? INITIAL_ILS, cashIls: r.cashIls ?? INITIAL_ILS, exposure: r.exposure || null, metrics: r.metrics, costs: r.costs || { feesIls: 0, trades: 0 }, equity: r.equity || [], selection: r.selection || null, targets: r.targets || null, desc: r.desc, missing: !!r.missing, pending: r.pending ? { day: r.pending.day, orders: r.pending.orders.length, filled: r.pending.filled } : null });
  }
  // מדדי ייחוס
  const benchmarks = {};
  for (const bid of Object.keys(BENCHMARKS)){
    const b = await db.get(`bench:${bid}`); const eq = (await db.get(KEY(`bench-${bid}`, 'equity'))) || [];
    benchmarks[bid] = { id: bid, label: BENCHMARKS[bid].label, startDay: b?.startDay || null, initialIls: INITIAL_ILS, totalIls: b ? benchValue(b, spyNow, fx) : null, metrics: b ? trackMetrics(eq, INITIAL_ILS) : null, equity: eq, entry: b ? { price: b.entryPrice, fx: b.entryFx, feeIls: b.feeIls, qty: b.qty } : null, missing: !b };
  }
  // עודף מול המדד: רק על אותה תקופה ואותו מטבע (שקלים); תקופה משותפת = מתאריך ההתחלה המאוחר ביותר
  const starts = items.filter((i) => i.startDay).map((i) => i.startDay); const commonFrom = starts.length ? starts.sort().pop() : null;
  for (const it of items){
    const b = benchmarks[it.benchmark];
    const bRows = b?.equity || [];
    it.excess = { own: null, common: null, benchLabel: b?.label || null, period: { from: it.startDay, to: day } };
    if (it.equity.length >= 2 && bRows.length >= 2){
      const from = it.equity[0].day;
      const bOwn = returnBetween(bRows, from, day); const tOwn = returnBetween(it.equity, from, day);
      it.excess.own = isNum(bOwn) && isNum(tOwn) ? round(tOwn - bOwn, 4) : null;
      if (commonFrom){ const bc = returnBetween(bRows, commonFrom, day), tc = returnBetween(it.equity, commonFrom, day); it.excess.common = isNum(bc) && isNum(tc) ? round(tc - bc, 4) : null; it.excess.commonReturn = tc; }
      if (bRows[0].day > from) it.excess.note = `המדד התחיל ב-${bRows[0].day}, המסלול ב-${from} — העודף מחושב מהתאריך המאוחר`;
    }
    it.equity = it.equity.slice(-250);
  }
  const notes = [];
  if (new Set(starts).size > 1) notes.push(`תאריכי התחלה שונים (${[...new Set(starts)].sort().join(', ')}) — התשואות מתחילת כל מסלול אינן ברות השוואה ישירה; ראו "תקופה משותפת"`);
  const minDays = Math.min(...items.map((i) => i.equity.length));
  if (minDays < 20) notes.push(`מדגם קטן: ${minDays} ימי מדידה בלבד למסלול הקצר — לא מסיקים מסקנות לפני 20 יום, ובאמת רק אחרי 60`);
  return { asOf: day, fx, spyNow, commonFrom, items, benchmarks, notes, version: TRACKS_VERSION };
}
