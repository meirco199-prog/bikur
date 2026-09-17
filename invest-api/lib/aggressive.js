// מסלול אגרסיבי (תיק צל): רץ כל לילה אחרי מודל הצל, על שורות מודל C, בלי פקודות. מפתחות: aggr:state, aggr:equity, aggr:journal.
import { stepAggressive, newAggrState, aggrMetrics, markToMarket, AGGR_RULES } from '../engine/aggressive.js';
import { latestRankDay } from './analysis.js';
import { isNum, round } from '../engine/util.js';

export async function runAggressive(ctx, { day = null, force = false } = {}){
  const { db } = ctx;
  day = day || (await latestRankDay(db));
  if (!day) return { ran: false, reason: 'אין דירוג עדיין' };
  const shadow = await db.get(`shadow:${day}`);
  if (!shadow?.rows?.length) return { ran: false, reason: `מודל הצל עוד לא רץ ל-${day}` };
  let state = (await db.get('aggr:state')) || newAggrState(AGGR_RULES.initialIls, day);
  if (state.lastDay === day && !force) return { ran: false, reason: `כבר רץ היום (${day})`, totalIls: state.lastTotalIls ?? null };
  if (state.lastDay && state.lastDay > day) return { ran: false, reason: `המצב כבר מעודכן ליום מאוחר יותר (${state.lastDay})` };
  const rank = await db.get(`rank:${day}`);
  const spyPrice = rank?.table?.find((r) => r.symbol === 'SPY')?.price ?? null;
  const fx = (await db.get('fx:USDILS'))?.rate || 3.7;
  const regime = (await db.get(`regime:${day}`)) || null;
  const r = stepAggressive({ state, rows: shadow.rows, spyPrice, regime, fx, day });
  r.state.lastTotalIls = r.totalIls;
  await db.put('aggr:state', r.state);
  const eq = (await db.get('aggr:equity')) || [];
  const i = eq.findIndex((e) => e[0] === day); const row = [day, r.totalIls, spyPrice];
  if (i >= 0) eq[i] = row; else eq.push(row);
  await db.put('aggr:equity', eq.sort((a, b) => a[0].localeCompare(b[0])).slice(-2000));
  if (r.trades.length){ const j = (await db.get('aggr:journal')) || []; j.push(...r.trades); await db.put('aggr:journal', j.slice(-400)); }
  return { ran: true, day, totalIls: r.totalIls, cashIls: r.cashIls, positions: r.positions.length, trades: r.trades, notes: r.notes };
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
  const metrics = aggrMetrics(equity, state.initialIls);
  const stocksIls = mtm.rows.filter((x) => !x.core).reduce((s, x) => s + x.valueIls, 0);
  return { day, initialIls: state.initialIls, totalIls: round(mtm.totalIls, 0), cashIls: round(state.cashIls, 0), stocksShare: round(stocksIls / mtm.totalIls, 3), positions: mtm.rows.sort((a, b) => b.valueIls - a.valueIls), stats: state.stats, metrics, equity: equity.slice(-120), trades: journal.slice(-30).reverse(), rules: AGGR_RULES, cooldown: state.cooldown || {} };
}
export const _isNum = isNum;
