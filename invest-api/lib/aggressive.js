// מסלול אגרסיבי (תיק צל): רץ כל לילה אחרי מודל הצל, על שורות מודל C, בלי פקודות. מפתחות: aggr:state, aggr:equity, aggr:journal.
import { decideAggressive, applyFills, newAggrState, aggrMetrics, markToMarket, sectorExposure, AGGR_RULES } from '../engine/aggressive.js';
import { latestRankDay, getQuote, assetMeta } from './analysis.js';
import { inTradingWindow, nyClock } from './autopilot.js';
import { isNum, round } from '../engine/util.js';

export async function runAggressive(ctx, { day = null, force = false, reset = false } = {}){
  const { db } = ctx;
  day = day || (await latestRankDay(db));
  if (!day) return { ran: false, reason: 'אין דירוג עדיין' };
  if (reset){ const old = await db.get('aggr:state'); if (old) await db.put(`aggr:archive:${Date.now()}`, { state: old, equity: await db.get('aggr:equity'), journal: await db.get('aggr:journal') }); await db.delete('aggr:state'); await db.delete('aggr:equity'); await db.delete('aggr:journal'); }
  const shadow = await db.get(`shadow:${day}`);
  if (!shadow?.rows?.length) return { ran: false, reason: `מודל הצל עוד לא רץ ל-${day}` };
  let state = (await db.get('aggr:state')) || newAggrState(AGGR_RULES.initialIls, day);
  if (state.lastDay === day && !force) return { ran: false, reason: `כבר רץ היום (${day})`, totalIls: state.lastTotalIls ?? null };
  if (state.lastDay && state.lastDay > day) return { ran: false, reason: `המצב כבר מעודכן ליום מאוחר יותר (${state.lastDay})` };
  const rank = await db.get(`rank:${day}`);
  const spyPrice = rank?.table?.find((r) => r.symbol === 'SPY')?.price ?? null;
  const fx = (await db.get('fx:USDILS'))?.rate || 3.7;
  const regime = (await db.get(`regime:${day}`)) || null;
  // לילה: החלטה בלבד (על סגירות). המילוי — למחרת בחלון ניו יורק לפי ציטוט חי (executeAggressive). פקודות ישנות שלא בוצעו מתבטלות.
  const cancelled = (state.pending?.orders || []).filter((o) => !o.filled).length;
  const r = decideAggressive({ state, rows: shadow.rows, spyPrice, regime, fx, day });
  r.state.pending = r.orders.length ? { day, decidedAt: new Date().toISOString(), orders: r.orders.map((o) => ({ ...o, filled: false })), model: AGGR_RULES.model, variant: shadow.models?.D?.variant || null } : null;
  r.state.lastTotalIls = r.totalIls; r.state.variant = shadow.models?.D?.variant || null;
  if (cancelled) r.notes.push(`${cancelled} פקודות מאתמול לא בוצעו (אין ציטוט בחלון) ובוטלו`);
  await db.put('aggr:state', r.state);
  const eq = (await db.get('aggr:equity')) || [];
  const i = eq.findIndex((e) => e[0] === day); const row = [day, r.totalIls, spyPrice, r.state.variant];
  if (i >= 0) eq[i] = row; else eq.push(row);
  await db.put('aggr:equity', eq.sort((a, b) => a[0].localeCompare(b[0])).slice(-2000));
  return { ran: true, day, reset, model: AGGR_RULES.model, variant: r.state.variant, totalIls: r.totalIls, cashIls: r.cashIls, positions: r.positions.length, exposure: r.exposure, pending: r.orders, notes: r.notes };
}

// ביצוע הפקודות הממתינות בחלון המסחר בניו יורק (09:40–15:45 ET) לפי ציטוט חי; SPY נרשם באותה נקודת זמן כנקודת ייחוס למדד.
// נקרא מה-cron כל 5 דקות (זול כשאין ממתינות) ומהגיבוי ב-GitHub. פקודה בלי ציטוט טרי נשארת ממתינה עד סוף החלון.
export async function executeAggressive(ctx, { force = false } = {}){
  const { db, env } = ctx;
  const state = await db.get('aggr:state');
  const pend = state?.pending;
  if (!pend?.orders?.length) return { ran: false, reason: 'אין פקודות ממתינות' };
  const gate = env.AUTO_ANY_TIME !== '1' && !force;
  if (gate && !inTradingWindow()) return { ran: false, reason: `מחוץ לחלון הביצוע (${nyClock().text})`, pendingCount: pend.orders.filter((o) => !o.filled).length };
  const today = new Date().toISOString().slice(0, 10);
  if (pend.day > today) return { ran: false, reason: 'הפקודות מיום עתידי' };
  const fx = (await db.get('fx:USDILS'))?.rate || 3.7;
  const fills = []; const skipped = [];
  const quoteOf = async (sym) => { try { const q = await getQuote(sym, { ...ctx, asset: await assetMeta(db, sym) }); return q && !q.missing && isNum(q.price) && q.price > 0 && !q.stale && q.isMarketOpen !== false ? q : null; } catch { return null; } };
  for (const o of pend.orders){
    if (o.filled) continue;
    const q = await quoteOf(o.symbol);
    if (!q){ skipped.push({ symbol: o.symbol, reason: 'אין ציטוט חי/טרי — ממתין' }); continue; }
    fills.push({ ...o, price: q.price, quoteAsOf: q.asOf || null, fillKind: 'live-quote' });
    o.filled = true; o.fillPrice = q.price; o.filledAt = new Date().toISOString();
  }
  let spyRefSet = false;
  if (!isNum(state.spyRef) && fills.length){ const q = await quoteOf('SPY'); if (q){ state.spyRef = q.price; state.spyRefAt = q.asOf || new Date().toISOString(); spyRefSet = true; } }
  if (!fills.length) return { ran: false, reason: 'אין ציטוטים לאף פקודה עדיין', skipped };
  const a = applyFills(state, fills, { fx, day: today });
  a.state.pending = pend.orders.every((o) => o.filled) ? null : pend;
  await db.put('aggr:state', a.state);
  const j = (await db.get('aggr:journal')) || []; j.push(...a.trades); await db.put('aggr:journal', j.slice(-400));
  return { ran: true, day: today, filled: a.trades, skipped, spyRefSet, cashIls: round(a.state.cashIls, 0) };
}

export async function aggrReport(db){
  const state = await db.get('aggr:state');
  const equity = (await db.get('aggr:equity')) || [];
  const journal = (await db.get('aggr:journal')) || [];
  if (!state) return { missing: true, reason: 'המסלול האגרסיבי עוד לא רץ', rules: AGGR_RULES };
  const day = state.lastDay;
  const rank = day ? await db.get(`rank:${day}`) : null;
  const priceOf = (s) => rank?.table?.find((r) => r.symbol === s)?.price ?? null;
  const fx = (await db.get('fx:USDILS'))?.rate || 3.7;
  const mtm = markToMarket(state, priceOf, fx);
  const metrics = aggrMetrics(equity, state.initialIls, state.spyRef ?? null);
  const stocksIls = mtm.rows.filter((x) => !x.core).reduce((s, x) => s + x.valueIls, 0);
  return { day, model: AGGR_RULES.model, initialIls: state.initialIls, totalIls: round(mtm.totalIls, 0), cashIls: round(state.cashIls, 0), stocksShare: round(stocksIls / mtm.totalIls, 3), exposure: mtm.exposure, sectors: sectorExposure(mtm.rows, mtm.totalIls), positions: mtm.rows.sort((a, b) => b.valueIls - a.valueIls), stats: state.stats, metrics, spyRef: state.spyRef ?? null, spyRefAt: state.spyRefAt ?? null, variant: state.variant ?? null, pending: state.pending || null, equity: equity.slice(-120), trades: journal.slice(-30).reverse(), rules: AGGR_RULES, cooldown: state.cooldown || {} };
}
export const _isNum = isNum;
