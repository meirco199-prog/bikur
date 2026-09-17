// מסלול אגרסיבי — תיק צל (סימולציה בלבד, בלי פקודות אמיתיות ובלי חשבון התרגול). פונקציה טהורה: מצב + שורות מודל הצל → מצב חדש + עסקאות.
// המטרה: למדוד אם בחירה ריכוזית לפי מומנטום/צמיחה/ריוויזיות (מודל C) עם יציאה מהירה מייצרת תשואה עודפת על SPY, ובאיזה מחיר
// (drawdown, תנודתיות). לא רודף אחרי יעד תשואה: הכללים קבועים, והתוצאה נמדדת.
import { isNum, round } from './util.js';

export const AGGR_RULES = Object.freeze({
  version: 1, initialIls: 200000,
  core: 'SPY', coreWeight: 0.20,        // ליבה קטנה, לא נמכרת
  stocksWeight: 0.75, cashReserve: 0.05,
  maxPositions: 10, positionWeight: 0.075, maxSector: 0.40, maxBuysPerDay: 5,
  model: 'C', buyActions: ['STRONG BUY', 'BUY'], sellActions: ['SELL'],
  stopPct: 0.12, trailPct: 0.15,       // עצירה מהכניסה 12%; עצירה נגררת 15% מהשיא
  bearStocksTarget: 0.25,              // שוק דובי: מוכרים את החלשות עד שהמניות ≤ 25% מהתיק, אין קניות
  riskOffOnlyStrong: true,             // Risk Off: קניות רק לקנייה חזקה
  slippage: 0.001, feeIls: 4,          // מחיר סגירה + החלקה 10 נ"ב + עמלה קבועה
  coreDriftPct: 0.05,                  // משלימים ליבה כשהיא מתחת ל-20% × (1 − 5%)
  cooldownDays: 7,                     // אחרי מכירה: לא קונים את אותו נייר שוב בתוך שבוע (מונע פינג-פונג סביב עצירה)
});

export function newAggrState(initialIls = AGGR_RULES.initialIls, day = null){ return { version: AGGR_RULES.version, initialIls, cashIls: initialIls, positions: {}, cooldown: {}, lastDay: null, createdDay: day, stats: { trades: 0, wins: 0, losses: 0, feesIls: 0 } }; }

const usd = (p, fx) => p * fx;
export function markToMarket(state, priceOf, fx){
  let value = 0; const rows = [];
  for (const [sym, p] of Object.entries(state.positions)){ const px = priceOf(sym) ?? p.last ?? p.entry; const v = p.qty * usd(px, fx); value += v; rows.push({ symbol: sym, qty: p.qty, price: px, valueIls: round(v, 0), pnlPct: round(px / p.entry - 1, 4), sector: p.sector || null, core: sym === AGGR_RULES.core }); }
  return { valueIls: value, totalIls: state.cashIls + value, rows };
}

// יום אחד: rows = שורות מודל הצל (symbol, sector, price, C, actC, eligible), spyPrice = מחיר SPY היום
export function stepAggressive({ state, rows = [], spyPrice = null, regime = null, fx = 3.7, day, rules = AGGR_RULES }){
  const st = JSON.parse(JSON.stringify(state));
  const trades = []; const notes = [];
  const bySym = new Map(rows.map((r) => [r.symbol, r]));
  const priceOf = (s) => (s === rules.core ? spyPrice : bySym.get(s)?.price ?? null);
  const bear = regime?.trend === 'Bear Trend', riskOff = regime?.risk === 'Risk Off';
  const trade = (side, sym, qty, px, reason, sector = null) => {
    const fill = side === 'buy' ? px * (1 + rules.slippage) : px * (1 - rules.slippage);
    const ils = qty * usd(fill, fx);
    if (side === 'buy'){ st.cashIls -= ils + rules.feeIls; const p = st.positions[sym] || { qty: 0, entry: fill, high: fill, openedDay: day, sector }; const newQty = p.qty + qty; p.entry = (p.entry * p.qty + fill * qty) / newQty; p.qty = newQty; p.high = Math.max(p.high, fill); p.last = fill; st.positions[sym] = p; }
    else { const p = st.positions[sym]; const pnl = qty * usd(fill - p.entry, fx); st.cashIls += ils - rules.feeIls; p.qty -= qty; if (p.qty <= 0) delete st.positions[sym]; if (sym !== rules.core){ st.cooldown = st.cooldown || {}; st.cooldown[sym] = day; } if (sym !== rules.core){ st.stats.trades++; if (pnl >= 0) st.stats.wins++; else st.stats.losses++; } trades.push({ day, side, symbol: sym, qty, price: round(fill, 4), ils: round(ils, 0), pnlIls: round(pnl, 0), reason }); st.stats.feesIls += rules.feeIls; return; }
    st.stats.feesIls += rules.feeIls;
    trades.push({ day, side, symbol: sym, qty, price: round(fill, 4), ils: round(ils, 0), reason });
  };
  // 1. עדכון שיאים ומחירים אחרונים
  for (const [sym, p] of Object.entries(st.positions)){ const px = priceOf(sym); if (isNum(px)){ p.high = Math.max(p.high || px, px); p.last = px; } }
  let mtm = markToMarket(st, priceOf, fx);
  // 2. מכירות מניות: סיגנל מכירה / עצירה / עצירה נגררת / נייר שנעלם מהיקום
  for (const [sym, p] of Object.entries(st.positions)){
    if (sym === rules.core) continue;
    const r = bySym.get(sym); const px = priceOf(sym);
    if (!isNum(px)){ notes.push(`${sym}: אין מחיר היום — נשאר`); continue; }
    let why = null;
    if (r && rules.sellActions.includes(r['act' + rules.model])) why = `סיגנל מכירה במודל ${rules.model} (ציון ${r[rules.model]})`;
    else if (px <= p.entry * (1 - rules.stopPct)) why = `עצירת הפסד ${Math.round(rules.stopPct * 100)}% מהכניסה`;
    else if (px <= p.high * (1 - rules.trailPct)) why = `עצירה נגררת ${Math.round(rules.trailPct * 100)}% מהשיא (${round(p.high, 2)})`;
    else if (!r) why = 'הנייר יצא מהיקום המנותח';
    if (why) trade('sell', sym, p.qty, px, why);
  }
  mtm = markToMarket(st, priceOf, fx);
  // 3. שוק דובי: מקטינים מניות עד היעד, החלשות קודם (לפי ציון C)
  if (bear){
    const stockRows = mtm.rows.filter((x) => !x.core).sort((a, b) => (bySym.get(a.symbol)?.[rules.model] ?? 0) - (bySym.get(b.symbol)?.[rules.model] ?? 0));
    let stocksVal = stockRows.reduce((s, x) => s + x.valueIls, 0);
    for (const x of stockRows){ if (stocksVal <= mtm.totalIls * rules.bearStocksTarget) break; trade('sell', x.symbol, x.qty, x.price, `שוק דובי — הקטנת מניות ל-${Math.round(rules.bearStocksTarget * 100)}% מהתיק`); stocksVal -= x.valueIls; }
    notes.push('שוק דובי: אין קניות חדשות של מניות');
  }
  mtm = markToMarket(st, priceOf, fx);
  // 4. ליבה: SPY עד 20% (השלמה כשנופלת מתחת ליעד פחות סחיפה)
  if (isNum(spyPrice) && spyPrice > 0){
    const coreVal = mtm.rows.find((x) => x.core)?.valueIls || 0;
    const target = mtm.totalIls * rules.coreWeight;
    if (coreVal < target * (1 - rules.coreDriftPct)){ const qty = Math.floor((target - coreVal) / usd(spyPrice, fx)); const cost = qty * usd(spyPrice, fx) * (1 + rules.slippage) + rules.feeIls; if (qty >= 1 && cost <= st.cashIls - mtm.totalIls * rules.cashReserve * 0.5) trade('buy', rules.core, qty, spyPrice, `ליבה ${Math.round(rules.coreWeight * 100)}% SPY`, 'core'); }
  } else notes.push('אין מחיר SPY היום — הליבה לא עודכנה');
  mtm = markToMarket(st, priceOf, fx);
  // 5. קניות: מועמדות לפי מודל C, ריכוז: עד 10 פוזיציות של 7.5%, ענף ≤ 40%
  if (!bear){
    const held = new Set(Object.keys(st.positions));
    const cool = (s) => { const d = st.cooldown?.[s]; return d && day && (Date.parse(day) - Date.parse(d)) / 86400000 < rules.cooldownDays; };
    for (const [s, d] of Object.entries(st.cooldown || {})) if (day && (Date.parse(day) - Date.parse(d)) / 86400000 >= rules.cooldownDays) delete st.cooldown[s];
    let cands = rows.filter((r) => r.eligible !== false && isNum(r[rules.model]) && rules.buyActions.includes(r['act' + rules.model]) && !held.has(r.symbol) && !cool(r.symbol) && isNum(r.price) && r.price > 0).sort((a, b) => b[rules.model] - a[rules.model]);
    if (riskOff && rules.riskOffOnlyStrong){ cands = cands.filter((r) => r['act' + rules.model] === 'STRONG BUY'); notes.push('בריחה מסיכון: קניות רק לקנייה חזקה'); }
    let buys = 0;
    const sectorVal = (sec) => markToMarket(st, priceOf, fx).rows.filter((x) => !x.core && x.sector === sec).reduce((s, x) => s + x.valueIls, 0);
    for (const r of cands){
      if (buys >= rules.maxBuysPerDay) break;
      const nPos = Object.keys(st.positions).filter((s) => s !== rules.core).length;
      if (nPos >= rules.maxPositions){ notes.push(`מלא: ${rules.maxPositions} פוזיציות`); break; }
      const total = markToMarket(st, priceOf, fx).totalIls;
      const stocksVal = markToMarket(st, priceOf, fx).rows.filter((x) => !x.core).reduce((s, x) => s + x.valueIls, 0);
      if (stocksVal >= total * rules.stocksWeight) { notes.push('תקציב המניות מלא'); break; }
      if (r.sector && sectorVal(r.sector) + total * rules.positionWeight > total * rules.maxSector * (stocksVal / Math.max(total * rules.stocksWeight, 1) || 1) && sectorVal(r.sector) >= total * rules.maxSector * rules.stocksWeight) continue;
      const budget = Math.min(total * rules.positionWeight, st.cashIls - total * rules.cashReserve);
      const qty = Math.floor(budget / (usd(r.price, fx) * (1 + rules.slippage)));
      if (qty < 1) continue;
      trade('buy', r.symbol, qty, r.price, `מודל ${rules.model}: ${r['act' + rules.model]} (ציון ${r[rules.model]})`, r.sector || null);
      buys++;
    }
  }
  st.lastDay = day;
  const finalMtm = markToMarket(st, priceOf, fx);
  return { state: st, trades, notes, totalIls: round(finalMtm.totalIls, 0), cashIls: round(st.cashIls, 0), positions: finalMtm.rows };
}

// מדדי ביצוע מעקומת הון [[day, totalIls, spyPrice]]
export function aggrMetrics(equity = [], initialIls = AGGR_RULES.initialIls){
  if (!equity.length) return null;
  const first = equity[0], last = equity[equity.length - 1];
  const ret = last[1] / initialIls - 1;
  const spyRet = isNum(first[2]) && isNum(last[2]) && first[2] > 0 ? last[2] / first[2] - 1 : null;
  let peak = -Infinity, maxDD = 0; const rets = [];
  for (let i = 0; i < equity.length; i++){ const v = equity[i][1]; peak = Math.max(peak, v); maxDD = Math.min(maxDD, v / peak - 1); if (i) rets.push(v / equity[i - 1][1] - 1); }
  const m = rets.length ? rets.reduce((s, x) => s + x, 0) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1)) : null;
  return { days: equity.length, from: first[0], to: last[0], totalReturn: round(ret, 4), spyReturn: spyRet === null ? null : round(spyRet, 4), excess: spyRet === null ? null : round(ret - spyRet, 4), maxDrawdown: round(maxDD, 4), volAnnual: sd === null ? null : round(sd * Math.sqrt(252), 4) };
}
