// סימולציית חשבון margin בסגנון IBKR ("תוכנת דמה"): מזומן בדולר, פוזיציות לונג/שורט, חוזים עם סילוק יומי, דרישות margin
// (initial/maintenance), נזילות עודפת, ריבית על הלוואת margin, עלות השאלה לשורט, וחיסול כפוי כשהנזילות העודפת שלילית.
// פונקציות טהורות על אובייקט state (בלי KV/רשת). כל הסכומים בדולר; ההמרה לשקל נעשית בדיווח בלבד.
import { commissionUsd, slippageRate, marginInterestAnnual } from './instruments.js';
import { round, isNum } from './util.js';

export const SIM_VERSION = 1;
export function newAccount(initialUsd, day = null){
  return { version: SIM_VERSION, initialUsd, cashUsd: initialUsd, positions: {}, hwmUsd: initialUsd, lastDay: null, createdDay: day, realizedUsd: 0, feesUsd: 0, interestUsd: 0, borrowUsd: 0, liquidations: 0, trades: 0, wins: 0, losses: 0 };
}

const sideDelta = (side, qty) => (side === 'buy' || side === 'cover' ? Math.abs(qty) : -Math.abs(qty));
const units = (inst) => inst?.units || 1;

// ביצוע פקודה במחיר נתון (כולל slippage ועמלה). מחזיר את הפרטים לרישום ביומן. side: buy | sell | short | cover
export function fill(state, { symbol, side, qty, price, day, strategy = null, sector = null, stop = null, reason = null }, inst){
  if (!inst) throw new Error(`מכשיר לא מוכר: ${symbol}`);
  if (!(qty > 0) || !(price > 0)) throw new Error('כמות/מחיר לא תקינים');
  const delta = sideDelta(side, qty);
  const slip = slippageRate(inst);
  const px = round(price * (delta > 0 ? 1 + slip : 1 - slip), 6);
  const fee = round(commissionUsd(inst, qty, px), 2);
  const u = units(inst);
  const pos = state.positions[symbol] || { qty: 0, avg: 0, class: inst.class, sector: sector || inst.sector, strategy, openedDay: day, lastMark: px, high: px, low: px, stop: stop ?? null };
  let realized = 0;
  const sameDir = pos.qty === 0 || Math.sign(pos.qty) === Math.sign(delta);
  if (sameDir){
    const newQty = pos.qty + delta;
    pos.avg = newQty !== 0 ? (pos.avg * Math.abs(pos.qty) + px * Math.abs(delta)) / Math.abs(newQty) : 0;
    pos.qty = newQty;
    if (pos.qty !== 0 && !state.positions[symbol]){ pos.openedDay = day; pos.strategy = strategy; pos.stop = stop ?? null; pos.high = px; pos.low = px; }
  } else {
    // הקטנה/סגירה/היפוך: קודם סוגרים מול הממוצע
    const closeQty = Math.min(Math.abs(delta), Math.abs(pos.qty)) * Math.sign(pos.qty);
    realized = (px - pos.avg) * closeQty * u;
    const remaining = pos.qty - closeQty;
    const flip = Math.abs(delta) - Math.abs(closeQty);
    if (flip > 0){ pos.qty = Math.sign(delta) * flip; pos.avg = px; pos.openedDay = day; pos.strategy = strategy; pos.stop = stop ?? null; pos.high = px; pos.low = px; }
    else pos.qty = remaining;
    if (closeQty !== 0){ state.trades += 1; if (realized > 0) state.wins += 1; else if (realized < 0) state.losses += 1; }
  }
  // מזומן: מכשיר עם סילוק יומי (חוזה) לא מזיז מזומן בפתיחה — רק P&L מסולק יומית; אחרת שווי הפקודה יוצא/נכנס
  if (inst.settle === 'daily'){ state.cashUsd += realized - fee; }
  else { state.cashUsd += -delta * px * u - fee; }
  pos.lastMark = px; if (stop !== null && stop !== undefined) pos.stop = stop;
  state.realizedUsd = round(state.realizedUsd + realized, 2); state.feesUsd = round(state.feesUsd + fee, 2); state.cashUsd = round(state.cashUsd, 2);
  if (pos.qty === 0) delete state.positions[symbol]; else state.positions[symbol] = pos;
  return { symbol, side, qty, price: px, refPrice: price, feeUsd: fee, realizedUsd: round(realized, 2), notionalUsd: round(qty * px * u, 2), day, strategy, reason, posQty: pos.qty };
}

// שערוך: שווי, חשיפה, דרישות margin, נזילות עודפת, מינוף. priceOf(symbol) = מחיר סגירה של המכשיר (לחוזה — של ה-proxy)
export function valuation(state, priceOf, instrumentOf){
  const rows = []; let longMv = 0, shortMv = 0, maint = 0, initial = 0, unrealized = 0, futuresPnl = 0;
  const byClass = {}, byStrategy = {}, bySector = {};
  for (const [sym, p] of Object.entries(state.positions)){
    const inst = instrumentOf(sym); if (!inst) continue;
    const px = priceOf(sym); const mark = isNum(px) ? px : p.lastMark;
    const u = units(inst), notional = Math.abs(p.qty) * mark * u, short = p.qty < 0;
    const m = inst.margin, mr = short ? (m.shortMaint ?? m.maint) : m.maint, ir = short ? (m.shortInitial ?? m.initial) : m.initial;
    const pnl = (mark - p.avg) * p.qty * u;
    if (inst.settle === 'daily') futuresPnl += (mark - p.lastMark) * p.qty * u; // טרם סולק (יסולק ב-markToMarket)
    else if (short) shortMv += notional; else longMv += notional;
    maint += notional * mr; initial += notional * ir; unrealized += pnl;
    const eff = notional * Math.abs(inst.leverage || 1);
    byClass[inst.class] = (byClass[inst.class] || 0) + eff; if (p.strategy) byStrategy[p.strategy] = (byStrategy[p.strategy] || 0) + eff; const sec = p.sector || inst.sector; if (sec) bySector[sec] = (bySector[sec] || 0) + eff;
    rows.push({ symbol: sym, name: inst.name, nameHe: inst.nameHe, class: inst.class, sector: sec, strategy: p.strategy || null, qty: p.qty, side: short ? 'short' : 'long', avg: round(p.avg, 4), price: round(mark, 4), stale: !isNum(px), units: u, notionalUsd: round(notional, 2), exposureUsd: round(eff, 2), pnlUsd: round(pnl, 2), pnlPct: p.avg ? round((mark / p.avg - 1) * Math.sign(p.qty), 4) : null, openedDay: p.openedDay, stop: p.stop ?? null, high: round(p.high ?? p.avg, 4), low: round(p.low ?? p.avg, 4), leverage: inst.leverage || 1, maintUsd: round(notional * mr, 2) });
  }
  const equity = state.cashUsd + longMv - shortMv + futuresPnl;
  const gross = longMv + shortMv + rows.filter((r) => r.class === 'future').reduce((s, r) => s + r.notionalUsd, 0);
  const effGross = Object.values(byClass).reduce((s, v) => s + v, 0);
  const excess = equity - maint, available = equity - initial;
  return { equityUsd: round(equity, 2), cashUsd: round(state.cashUsd, 2), longUsd: round(longMv, 2), shortUsd: round(shortMv, 2), grossUsd: round(gross, 2), effectiveGrossUsd: round(effGross, 2), leverage: equity > 0 ? round(effGross / equity, 3) : null, maintUsd: round(maint, 2), initialUsd: round(initial, 2), excessLiquidityUsd: round(excess, 2), availableFundsUsd: round(available, 2), unrealizedUsd: round(unrealized, 2), marginLoanUsd: round(Math.max(0, -state.cashUsd), 2), byClass: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, round(v, 2)])), byStrategy: Object.fromEntries(Object.entries(byStrategy).map(([k, v]) => [k, round(v, 2)])), bySector: Object.fromEntries(Object.entries(bySector).map(([k, v]) => [k, round(v, 2)])), positions: rows.sort((a, b) => b.exposureUsd - a.exposureUsd) };
}

// סוף יום: סילוק יומי לחוזים, עדכון high/low, שיא (HWM). מחזיר את השערוך אחרי הסילוק
export function markToMarket(state, priceOf, instrumentOf, day, { highOf = null, lowOf = null } = {}){
  for (const [sym, p] of Object.entries(state.positions)){
    const inst = instrumentOf(sym); if (!inst) continue;
    const px = priceOf(sym); if (!isNum(px)) continue;
    if (inst.settle === 'daily'){ const settle = (px - p.lastMark) * p.qty * units(inst); state.cashUsd = round(state.cashUsd + settle, 2); state.realizedUsd = round(state.realizedUsd + settle, 2); }
    p.lastMark = px;
    const h = highOf ? highOf(sym) : null, l = lowOf ? lowOf(sym) : null;
    p.high = Math.max(p.high ?? px, isNum(h) ? h : px, px); p.low = Math.min(p.low ?? px, isNum(l) ? l : px, px);
  }
  const v = valuation(state, priceOf, instrumentOf);
  state.hwmUsd = Math.max(state.hwmUsd || 0, v.equityUsd); state.lastDay = day;
  return v;
}

// ריבית margin על הלוואה (מזומן שלילי) ועלות השאלה על שורט, לפי ימים קלנדריים (IBKR מחשב יומית על יתרת הלילה)
export function accrue(state, v, instrumentOf, days = 1){
  if (!(days > 0)) return { interestUsd: 0, borrowUsd: 0 };
  const loan = Math.max(0, -state.cashUsd);
  const interest = round(loan * marginInterestAnnual() / 360 * days, 2);
  let borrow = 0;
  for (const r of v.positions){ if (r.side === 'short' && r.class !== 'future' && r.class !== 'fx'){ const inst = instrumentOf(r.symbol); borrow += r.notionalUsd * (inst?.borrowFee || 0) / 360 * days; } }
  borrow = round(borrow, 2);
  state.cashUsd = round(state.cashUsd - interest - borrow, 2); state.interestUsd = round(state.interestUsd + interest, 2); state.borrowUsd = round(state.borrowUsd + borrow, 2);
  return { interestUsd: interest, borrowUsd: borrow };
}

// חיסול כפוי: כל עוד הנזילות העודפת שלילית — סוגרים את הפוזיציה עם דרישת ה-margin הגדולה ביותר (IBKR סוגר בלי התראה)
export function liquidateIfNeeded(state, priceOf, instrumentOf, day, { maxSteps = 20 } = {}){
  const actions = [];
  for (let i = 0; i < maxSteps; i++){
    const v = valuation(state, priceOf, instrumentOf);
    if (v.excessLiquidityUsd >= 0 || !v.positions.length) break;
    const worst = v.positions.slice().sort((a, b) => b.maintUsd - a.maintUsd)[0];
    const inst = instrumentOf(worst.symbol); const px = priceOf(worst.symbol) ?? worst.price;
    const f = fill(state, { symbol: worst.symbol, side: worst.side === 'short' ? 'cover' : 'sell', qty: Math.abs(worst.qty), price: px * (worst.side === 'short' ? 1.005 : 0.995), day, reason: `חיסול כפוי: נזילות עודפת ${v.excessLiquidityUsd}$` }, inst);
    state.liquidations += 1; actions.push({ ...f, forced: true });
  }
  return actions;
}

// עצירות: לונג — הנמוך של היום מתחת ל-stop; שורט — הגבוה מעליו. סגירה במחיר ה-stop עם slippage
export function stopExits(state, { lowOf, highOf, priceOf }, instrumentOf, day){
  const out = [];
  for (const [sym, p] of Object.entries(state.positions)){
    if (!isNum(p.stop)) continue;
    const inst = instrumentOf(sym); if (!inst) continue;
    const lo = lowOf(sym), hi = highOf(sym), px = priceOf(sym);
    if (p.qty > 0 && isNum(lo) && lo <= p.stop){ out.push(fill(state, { symbol: sym, side: 'sell', qty: p.qty, price: Math.min(p.stop, isNum(px) ? px : p.stop), day, reason: `עצירה ${round(p.stop, 4)} (נמוך ${round(lo, 4)})` }, inst)); }
    else if (p.qty < 0 && isNum(hi) && hi >= p.stop){ out.push(fill(state, { symbol: sym, side: 'cover', qty: -p.qty, price: Math.max(p.stop, isNum(px) ? px : p.stop), day, reason: `עצירה ${round(p.stop, 4)} (גבוה ${round(hi, 4)})` }, inst)); }
  }
  return out;
}

// מדדי ביצוע על סדרת שווי [[day, equityUsd, spy]] — תשואה, מול SPY, ירידה מרבית, תנודתיות שנתית
export function simMetrics(equity = [], initialUsd, spyRef = null){
  if (!equity.length) return null;
  const first = equity[0], last = equity[equity.length - 1];
  const ret = last[1] / initialUsd - 1;
  const spyBase = isNum(spyRef) && spyRef > 0 ? spyRef : first[2];
  const spyRet = isNum(spyBase) && isNum(last[2]) && spyBase > 0 ? last[2] / spyBase - 1 : null;
  let peak = -Infinity, maxDD = 0; const rets = [];
  for (let i = 0; i < equity.length; i++){ const e = equity[i][1]; peak = Math.max(peak, e); maxDD = Math.max(maxDD, peak > 0 ? 1 - e / peak : 0); if (i > 0 && equity[i - 1][1] > 0) rets.push(e / equity[i - 1][1] - 1); }
  const mean = rets.length ? rets.reduce((s, x) => s + x, 0) / rets.length : 0;
  const vol = rets.length > 1 ? Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / (rets.length - 1)) * Math.sqrt(252) : 0;
  return { days: equity.length, from: first[0], to: last[0], totalReturn: round(ret, 4), spyReturn: spyRet === null ? null : round(spyRet, 4), excess: spyRet === null ? null : round(ret - spyRet, 4), maxDrawdown: round(maxDD, 4), volAnnual: round(vol, 4) };
}
