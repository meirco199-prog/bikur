// הסוכן האוטונומי הרב-נכסי (סימולציית IBKR): מתזמר את המחזור היומי — תמחור היקום → מילוי פקודות מאתמול בפתיחת היום →
// עצירות → שערוך לסגירה, ריבית, חיסול margin → סריקת הזדמנויות → גודל לפי סיכון → שער הפקודות → פקודות ממתינות למחר.
// מפתחות KV: agent:state, agent:equity, agent:journal, agent:pending, agent:opps:<day>, agent:scan:<day>, agent:kill.
// אין look-ahead: החלטה בסגירת סשן S, מילוי בפתיחת הסשן הבא (כשהבר שלו קיים). מודל שפה לא נוגע בשום שלב כאן.
import { AGENT_INSTRUMENTS, instrumentOf, priceSymbolOf } from '../engine/instruments.js';
import { newAccount, fill, valuation, markToMarket, accrue, liquidateIfNeeded, stopExits, simMetrics } from '../engine/margin-sim.js';
import { scanOpportunities, sizeByRisk, STRATEGIES } from '../engine/opportunities.js';
import { AGENT_SIM_POLICY } from '../engine/agent-sim-policy.js';
import { gateOrder, policyHash, haltState } from '../engine/order-gate.js';
import { lastSessionClose, isNonTradingDay } from '../engine/session.js';
import { fetchWithFallback } from '../providers/registry.js';
import { cached, TTL } from './cache.js';
import { DB } from './db.js';
import { round, isNum, uid } from '../engine/util.js';

const JOURNAL_MAX = 600, EQUITY_MAX = 2000, OPPS_KEEP = 40;
const dayOf = (rows, day) => { let r = null; for (const x of rows){ if (x[0] <= day) r = x; else break; } return r; };
const nextDayRow = (rows, day) => rows.find((x) => x[0] > day) || null;

// מחירים למכשיר: אותו מטמון px: כמו שאר המערכת; קריפטו/מט"ח — רק Twelve Data (סימבול ממופה). מחזיר {rows, stale, missing}
export async function agentPrices(inst, ctx){
  const sym = priceSymbolOf(inst), base = instrumentOf(sym) || inst;
  const asset = { symbol: sym, currency: 'USD', type: base.class === 'crypto' ? 'crypto' : base.class === 'fx' ? 'fx' : 'etf', twelvedata: base.twelvedata || sym };
  const c = { ...ctx, asset };
  return cached(ctx.db, `px:${sym}`, TTL.prices, async (ex) => {
    const from = ex?.rows?.length ? ex.rows[ex.rows.length - 1][0].slice(0, 4) + '-01-01' : undefined;
    return fetchWithFallback('prices', sym, { from }, c, base.providersOnly ? { only: base.providersOnly } : {});
  }, { merge: (old, fresh) => ({ ...fresh, rows: DB.mergeRows(old.rows, fresh.rows) }) });
}

export async function agentPolicy(db){
  const kill = await db.get('agent:kill');
  return kill?.on ? { ...AGENT_SIM_POLICY, killSwitch: true, killReason: kill.reason || null, killAt: kill.at || null } : AGENT_SIM_POLICY;
}

/**
 * runAgent — צעד אחד של המחזור היומי. batch = כמה מכשירים לתמחר מחדש בקריאה אחת (מכסת Twelve Data: ~7/דקה).
 * מחזיר { phase: 'pricing' | 'done' | 'skipped', ... }. קריאה חוזרת באותו יום ממשיכה מאותה נקודה.
 */
export async function runAgent(ctx, { day = null, force = false, reset = false, batch = 6, now = new Date() } = {}){
  const { db } = ctx;
  const policy = await agentPolicy(db);
  const fx = (await db.get('fx:USDILS'))?.rate || 3.7;
  day = day || lastSessionClose(now).date;
  if (reset){
    const old = await db.get('agent:state');
    if (old) await db.put(`agent:archive:${Date.now()}`, { state: old, equity: await db.get('agent:equity'), journal: await db.get('agent:journal'), pending: await db.get('agent:pending') });
    for (const k of ['agent:state', 'agent:equity', 'agent:journal', 'agent:pending']) await db.delete(k);
  }
  let state = await db.get('agent:state');
  if (!state){ state = newAccount(round(policy.capitalIls / fx, 2), day); state.fxAtStart = fx; state.capitalIls = policy.capitalIls; }
  if (state.lastDay === day && !force) return { phase: 'skipped', reason: `כבר רץ לסשן ${day}`, day };
  if (state.lastDay && state.lastDay > day && !force) return { phase: 'skipped', reason: `המצב כבר מעודכן ל-${state.lastDay}`, day };

  // שלב 1 — תמחור (באצ'ים): כל מכשיר צריך סדרה שמכסה את יום ההחלטה
  const scanKey = `agent:scan:${day}`;
  const scan = (await db.get(scanKey)) || { day, done: {}, missing: {}, startedAt: new Date().toISOString() };
  const priceSyms = [...new Set(AGENT_INSTRUMENTS.map(priceSymbolOf))];
  let fetched = 0;
  for (const sym of priceSyms){
    if (scan.done[sym] || scan.missing[sym]) continue;
    const inst = instrumentOf(sym);
    const before = (await db.get(`px:${sym}`))?.fetchedAt || null;   // קריאה לספק נספרת רק אם המטמון באמת התרענן (מכסת דקה של Twelve Data)
    const r = await agentPrices(inst, ctx);
    if (!r || r.missing || !r.rows?.length){ scan.missing[sym] = r?.reason || 'אין נתונים'; continue; }
    scan.done[sym] = r.rows[r.rows.length - 1][0]; // ייתכן שאין עדיין בר של היום אצל הספק — ממשיכים עם מה שיש; הסגירה החסרה נאכפת בשער (requireFreshData)
    if (r.fetchedAt !== before) fetched++;
    if (fetched >= batch) break;
  }
  const left = priceSyms.filter((s) => !scan.done[s] && !scan.missing[s]).length;
  await db.put(scanKey, scan, { ttl: 3 * 86400 });
  if (left > 0) return { phase: 'pricing', day, left, priced: Object.keys(scan.done).length, missing: Object.keys(scan.missing).length };

  // שלב 2 — סדרות עד יום ההחלטה
  const series = [], rowsBySym = {};
  for (const inst of AGENT_INSTRUMENTS){
    const psym = priceSymbolOf(inst); if (scan.missing[psym]) continue;
    const r = await db.get(`px:${psym}`); const rows = (r?.rows || []).filter((x) => x[0] <= day && isNum(x[4]));
    if (!rows.length) continue;
    rowsBySym[inst.symbol] = rows; series.push({ inst, rows });
  }
  const closeRow = (sym) => dayOf(rowsBySym[sym] || [], day);
  const priceOf = (sym) => { const r = closeRow(sym); return r && r[0] === day ? r[4] : (r ? r[4] : null); };
  const freshOf = (sym) => { const r = closeRow(sym); return r ? r[0] : null; };
  const highOf = (sym) => { const r = closeRow(sym); return r && r[0] === day ? r[2] : null; };
  const lowOf = (sym) => { const r = closeRow(sym); return r && r[0] === day ? r[3] : null; };
  const openOf = (sym) => { const r = closeRow(sym); return r && r[0] === day ? r[1] : null; };
  const spy = priceOf('SPY');
  const journal = (await db.get('agent:journal')) || [];
  const log = (e) => journal.push({ id: uid('ag_'), at: new Date().toISOString(), day, ...e });

  // שלב 3 — מילוי פקודות שהוחלטו בסשן הקודם, בפתיחת היום (שער שוב: המצב השתנה מאז ההחלטה)
  const pending = (await db.get('agent:pending')) || { day: null, orders: [] };
  const fills = [], rejected = [];
  const equityBefore = valuation(state, priceOf, instrumentOf);
  const sentToday = [];
  for (const o of pending.orders || []){
    const inst = instrumentOf(o.symbol); const px = openOf(o.symbol);
    if (!inst || !isNum(px)){ rejected.push({ ...o, reasons: ['אין מחיר פתיחה ליום המילוי'] }); continue; }
    const v = valuation(state, priceOf, instrumentOf);
    const g = gateOrder({ order: toGateOrder(o, inst, px, fx, day), policy, account: toGateAccount(state, v, fx, day, equityBefore), positions: toGatePositions(v, fx), capabilities: capabilities(), journal: sentToday, now });
    if (!g.allowed){ rejected.push({ ...o, reasons: g.reasons }); log({ kind: 'reject', symbol: o.symbol, side: o.side, strategy: o.strategy, reasons: g.reasons, stage: 'fill' }); continue; }
    const f = fill(state, { symbol: o.symbol, side: o.side, qty: o.qty, price: px, day, strategy: o.strategy, sector: inst.sector, stop: o.stop, reason: o.reason }, inst);
    sentToday.push({ clientOrderId: g.clientOrderId, symbol: o.symbol, side: o.side }); fills.push({ ...f, clientOrderId: g.clientOrderId, decidedDay: pending.day, decisionPrice: o.price, gapPct: o.price ? round(px / o.price - 1, 4) : null });
    log({ kind: 'fill', ...f, clientOrderId: g.clientOrderId, decidedDay: pending.day, decisionPrice: o.price });
  }
  // שלב 4 — עצירות (על הנמוך/הגבוה של היום), שערוך לסגירה, ריבית/השאלה, חיסול margin
  const stops = stopExits(state, { lowOf, highOf, priceOf }, instrumentOf, day); stops.forEach((s) => log({ kind: 'stop', ...s }));
  const days = state.lastDay ? Math.max(1, Math.round((Date.parse(day) - Date.parse(state.lastDay)) / 86400000)) : 0;
  const v1 = markToMarket(state, priceOf, instrumentOf, day, { highOf, lowOf });
  const acc = accrue(state, v1, instrumentOf, days);
  const liq = liquidateIfNeeded(state, priceOf, instrumentOf, day); liq.forEach((l) => log({ kind: 'liquidation', ...l }));
  const v = valuation(state, priceOf, instrumentOf);
  const dayPnl = round(v.equityUsd - equityBefore.equityUsd, 2);
  state.dayPnlUsd = dayPnl;

  // שלב 5 — סריקת הזדמנויות על כל היקום, גודל לפי סיכון, שער הפקודות → פקודות למחר
  const regime = (await db.get(`regime:${day}`)) || (await db.get(`regime:${(await db.get('cron:state'))?.day || ''}`)) || null;
  const scanRes = scanOpportunities({ series, regime, day });
  const halt = haltState({ policy, account: toGateAccount(state, v, fx, day, equityBefore) });
  const orders = [], gateLog = [];
  const held = new Set(Object.keys(state.positions));
  for (const c of scanRes.candidates){
    if (c.needsResearch || c.conflict) continue;
    const inst = instrumentOf(c.symbol);
    if (held.has(c.symbol)) continue; // פוזיציה קיימת: יציאה רק בעצירה/אינוולידציה (v1)
    if (c.side === 'short' && !inst.shortable) continue;
    if (freshOf(c.symbol) !== day){ gateLog.push({ symbol: c.symbol, side: c.side, strategy: c.strategy, reasons: [`אין סגירה של ${day} (יש עד ${freshOf(c.symbol)})`] }); continue; }
    const qty = sizeByRisk({ equityUsd: v.equityUsd, riskPct: STRATEGIES[c.strategy].riskPct, price: c.price, stop: c.stop, units: inst.units, maxNotionalUsd: v.equityUsd * policy.maxTradeShare * 0.98 / Math.abs(inst.leverage || 1) });
    if (!(qty > 0)){ gateLog.push({ symbol: c.symbol, side: c.side, strategy: c.strategy, reasons: ['גודל פוזיציה קטן מדי לפי תקציב הסיכון'] }); continue; }
    const o = { symbol: c.symbol, side: c.side === 'long' ? 'buy' : 'short', qty, price: c.price, stop: c.stop, strategy: c.strategy, score: c.score, reason: `${STRATEGIES[c.strategy].label} · ${c.invalidation}`, evidence: c.evidence, horizonDays: c.horizonDays };
    const acct = toGateAccount(state, v, fx, day, equityBefore);
    const g = gateOrder({ order: toGateOrder(o, inst, c.price, fx, day), policy, account: acct, positions: [...toGatePositions(v, fx), ...orders.map((x) => ({ symbol: x.symbol, class: instrumentOf(x.symbol).class, sector: instrumentOf(x.symbol).sector, strategy: x.strategy, qty: x.side === 'buy' ? x.qty : -x.qty, valueIls: x.qty * x.price * instrumentOf(x.symbol).units * Math.abs(instrumentOf(x.symbol).leverage || 1) * fx, pnlIls: 0 }))], capabilities: capabilities(), journal: [...sentToday, ...orders.map((x) => ({ clientOrderId: x.clientOrderId }))], now });
    if (g.allowed){ orders.push({ ...o, clientOrderId: g.clientOrderId, notionalUsd: round(g.notionalIls / fx, 2) }); }
    else gateLog.push({ symbol: c.symbol, side: c.side, strategy: c.strategy, score: c.score, reasons: g.reasons });
    if (orders.length >= policy.maxOrdersPerDay) break;
  }
  await db.put('agent:pending', { day, decidedAt: new Date().toISOString(), orders });
  await db.put(`agent:opps:${day}`, { day, scanned: scanRes.scanned, skipped: scanRes.skipped, summary: scanRes.summary, candidates: scanRes.candidates.slice(0, OPPS_KEEP), gateLog, halt, regime: regime?.summary || null }, { ttl: 14 * 86400 });
  // שלב 6 — שמירה: מצב, שורת שווי יומית, יומן
  const equity = ((await db.get('agent:equity')) || []).filter((r) => r[0] !== day);
  equity.push([day, round(v.equityUsd * fx, 0), spy, { equityUsd: v.equityUsd, leverage: v.leverage, byClass: v.byClass, cashUsd: v.cashUsd, fx }]);
  equity.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  await db.put('agent:equity', equity.slice(-EQUITY_MAX));
  log({ kind: 'day', equityUsd: v.equityUsd, dayPnlUsd: dayPnl, leverage: v.leverage, fills: fills.length, stops: stops.length, liquidations: liq.length, interestUsd: acc.interestUsd, borrowUsd: acc.borrowUsd, candidates: scanRes.candidates.length, ordersForTomorrow: orders.length, halted: halt.halted ? halt.reasons : null });
  await db.put('agent:journal', journal.slice(-JOURNAL_MAX));
  await db.put('agent:state', state);
  return { phase: 'done', day, equityUsd: v.equityUsd, equityIls: round(v.equityUsd * fx, 0), dayPnlUsd: dayPnl, leverage: v.leverage, positions: v.positions.length, fills: fills.length, rejectedFills: rejected.length, stops: stops.length, liquidations: liq.length, interestUsd: acc.interestUsd, borrowUsd: acc.borrowUsd, scanned: scanRes.scanned, candidates: scanRes.summary, ordersForTomorrow: orders.map((o) => `${o.side} ${o.qty} ${o.symbol} (${o.strategy}, ${o.score})`), gateRejections: gateLog.length, halted: halt.halted ? halt.reasons : null, killSwitch: !!policy.killSwitch };
}

// --- המרות לשער הפקודות (השער עובד בשקלים; הסימולציה בדולר) ---
const capabilities = () => ({ tradable: new Set(AGENT_INSTRUMENTS.map((i) => i.symbol)), classes: new Set(AGENT_INSTRUMENTS.map((i) => i.class)), exchanges: null });
function toGateOrder(o, inst, price, fx, day){
  const lev = Math.abs(inst.leverage || 1);
  return { symbol: o.symbol, class: inst.class, side: o.side, qty: o.qty, priceRef: price, notionalIls: o.qty * price * inst.units * fx, currency: 'USD', strategy: o.strategy, sector: inst.sector, exchange: inst.exchange, exposureMultiplier: lev, worstCaseLossIls: (o.side === 'buy' && inst.class !== 'future' && lev === 1) ? o.qty * price * inst.units * fx : null, day, decisionVersion: 1, quoteAsOf: day, marketOpen: inst.session === '24x7' || !isNonTradingDay(day), allowAddToLoser: false };
}
function toGateAccount(state, v, fx, day, before){
  return { equityIls: v.equityUsd * fx, cashIls: v.cashUsd * fx, grossExposureIls: v.effectiveGrossUsd * fx, dayPnlIls: (isNum(state.dayPnlUsd) ? state.dayPnlUsd : (v.equityUsd - (before?.equityUsd ?? v.equityUsd))) * fx, hwmIls: (state.hwmUsd || v.equityUsd) * fx, availableFundsIls: v.availableFundsUsd * fx, maintenanceMarginIls: v.maintUsd * fx, reconciliationOk: true };
}
const toGatePositions = (v, fx) => v.positions.map((p) => ({ symbol: p.symbol, class: p.class, sector: p.sector, strategy: p.strategy, qty: p.qty, valueIls: p.exposureUsd * fx, pnlIls: p.pnlUsd * fx }));

// דוח ציבורי: מצב החשבון בסגירה האחרונה, פוזיציות, חשיפות, פקודות ממתינות, הזדמנויות אחרונות, דחיות השער, מדיניות
export async function agentReport(db){
  const state = await db.get('agent:state');
  const policy = await agentPolicy(db);
  const fx = (await db.get('fx:USDILS'))?.rate || 3.7;
  const equity = (await db.get('agent:equity')) || [];
  const base = { policy: { version: policy.version, mode: policy.mode, hash: policyHash(AGENT_SIM_POLICY), killSwitch: !!policy.killSwitch, killReason: policy.killReason || null, capitalIls: policy.capitalIls, leverage: policy.leverage, shorting: policy.shorting, allowedClasses: policy.allowedClasses, maxDailyLoss: policy.maxDailyLoss, maxDrawdown: policy.maxDrawdown, maxTradeShare: policy.maxTradeShare, maxAssetShare: policy.maxAssetShare, maxClassShare: policy.maxClassShare, maxOrdersPerDay: policy.maxOrdersPerDay }, strategies: Object.fromEntries(Object.entries(STRATEGIES).map(([k, s]) => [k, { label: s.label, horizonDays: s.horizonDays, riskPct: s.riskPct }])), universe: { count: AGENT_INSTRUMENTS.length, byClass: AGENT_INSTRUMENTS.reduce((m, i) => ({ ...m, [i.class]: (m[i.class] || 0) + 1 }), {}) } };
  if (!state) return { missing: true, reason: 'הסוכן עוד לא רץ', ...base };
  const day = state.lastDay;
  const priceOf = (sym) => state.positions[sym]?.lastMark ?? null;
  const v = valuation(state, priceOf, instrumentOf);
  const opps = day ? await db.get(`agent:opps:${day}`) : null;
  const pending = (await db.get('agent:pending')) || { orders: [] };
  const journal = (await db.get('agent:journal')) || [];
  const initialUsd = state.initialUsd;
  const eqUsd = equity.map((r) => [r[0], r[3]?.equityUsd ?? r[1] / (r[3]?.fx || fx), r[2]]);
  const metrics = simMetrics(eqUsd, initialUsd, null);
  const fxNow = fx;
  return { ...base, day, sessionDate: day, fx: fxNow, initialUsd, initialIls: state.capitalIls || policy.capitalIls, equityUsd: v.equityUsd, totalIls: round(v.equityUsd * fxNow, 0), pnlUsd: round(v.equityUsd - initialUsd, 2), pnlIls: round((v.equityUsd - initialUsd) * fxNow, 0), pnlPct: initialUsd ? round(v.equityUsd / initialUsd - 1, 4) : null, dayPnlUsd: state.dayPnlUsd ?? null, dayPnlIls: isNum(state.dayPnlUsd) ? round(state.dayPnlUsd * fxNow, 0) : null, cashUsd: v.cashUsd, marginLoanUsd: v.marginLoanUsd, leverage: v.leverage, grossUsd: v.grossUsd, effectiveGrossUsd: v.effectiveGrossUsd, maintUsd: v.maintUsd, excessLiquidityUsd: v.excessLiquidityUsd, availableFundsUsd: v.availableFundsUsd, unrealizedUsd: v.unrealizedUsd, realizedUsd: state.realizedUsd, feesUsd: state.feesUsd, interestUsd: state.interestUsd, borrowUsd: state.borrowUsd, liquidations: state.liquidations, trades: state.trades, wins: state.wins, losses: state.losses, hwmUsd: state.hwmUsd, exposure: { byClass: v.byClass, byStrategy: v.byStrategy, bySector: v.bySector, longUsd: v.longUsd, shortUsd: v.shortUsd }, positions: v.positions, pending: { day: pending.day || null, orders: pending.orders || [] }, opportunities: opps ? { day: opps.day, scanned: opps.scanned, summary: opps.summary, regime: opps.regime, candidates: opps.candidates, gateLog: opps.gateLog, halt: opps.halt, skipped: opps.skipped } : null, equity, metrics, journal: journal.slice(-60).reverse(), activeStrategies: [...new Set(v.positions.map((p) => p.strategy).filter(Boolean))], halted: opps?.halt?.halted ? opps.halt.reasons : null };
}

export async function setKill(db, { on, reason = null }){
  if (on) await db.put('agent:kill', { on: true, reason, at: new Date().toISOString() }); else await db.delete('agent:kill');
  return { ok: true, killSwitch: !!on, reason };
}
