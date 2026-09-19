// מסלול אגרסיבי — תיק צל (סימולציה בלבד, בלי פקודות אמיתיות ובלי חשבון התרגול). פונקציה טהורה: מצב + שורות מודל הצל → מצב חדש + עסקאות.
// המטרה: למדוד אם בחירה ריכוזית לפי מומנטום/צמיחה/ריוויזיות (מודל C) עם יציאה מהירה מייצרת תשואה עודפת על SPY, ובאיזה מחיר
// (drawdown, תנודתיות). לא רודף אחרי יעד תשואה: הכללים קבועים, והתוצאה נמדדת.
import { isNum, round } from './util.js';

export const AGGR_RULES = Object.freeze({
  version: 1, initialIls: 200000,
  core: 'SPY', coreWeight: 0.20,        // ליבה קטנה, לא נמכרת
  stocksWeight: 0.75, cashReserve: 0.05,
  maxPositions: 10, positionWeight: 0.075, maxSector: 0.40, maxBuysPerDay: 5,
  model: 'D', buyActions: ['STRONG BUY', 'BUY'], sellActions: ['SELL'],
  stopPct: 0.12, trailPct: 0.15,       // עצירה מהכניסה 12%; עצירה נגררת 15% מהשיא
  bearStocksTarget: 0.25,              // שוק דובי: מוכרים את החלשות עד שהמניות ≤ 25% מהתיק, אין קניות
  riskOffOnlyStrong: true,             // Risk Off: קניות רק לקנייה חזקה
  slippage: 0.001, feeIls: 4,          // מחיר סגירה + החלקה 10 נ"ב + עמלה קבועה
  coreDriftPct: 0.05,                  // משלימים ליבה כשהיא מתחת ל-20% × (1 − 5%)
  cooldownDays: 7,                     // אחרי מכירה: לא קונים את אותו נייר שוב בתוך שבוע (מונע פינג-פונג סביב עצירה)
  lookThrough: true,                   // חשיפה ענפית כוללת את מה שבתוך SPY (משקלי ענף משוערים, לא מדויקים ליום)
});
// משקלי ענף משוערים של S&P 500 (GICS, 2025–2026). קירוב מתועד: FMP חינמי לא מספק החזקות; לעדכן כשיש מקור. סכום = 1.
export const SPY_SECTOR_WEIGHTS = Object.freeze({ 'Information Technology': 0.33, Financials: 0.135, 'Consumer Discretionary': 0.105, 'Communication Services': 0.095, 'Health Care': 0.095, Industrials: 0.085, 'Consumer Staples': 0.055, Energy: 0.03, Utilities: 0.025, 'Real Estate': 0.02, Materials: 0.02 });
const SECTOR_ALIAS = { Technology: 'Information Technology', 'Information Technology': 'Information Technology', Healthcare: 'Health Care', 'Health Care': 'Health Care', 'Financial Services': 'Financials', Financials: 'Financials', 'Consumer Cyclical': 'Consumer Discretionary', 'Consumer Discretionary': 'Consumer Discretionary', 'Consumer Defensive': 'Consumer Staples', 'Consumer Staples': 'Consumer Staples', 'Basic Materials': 'Materials', Materials: 'Materials', 'Communication Services': 'Communication Services', Industrials: 'Industrials', Utilities: 'Utilities', Energy: 'Energy', 'Real Estate': 'Real Estate' };
export const normalizeSector = (s) => SECTOR_ALIAS[s] || s || 'Unknown';
// חשיפה ענפית look-through: מניות ישירות + SPY × משקל הענף במדד
export function sectorExposure(rows, totalIls, rules = AGGR_RULES){
  const out = {};
  for (const x of rows){
    if (x.core){ if (rules.lookThrough) for (const [sec, w] of Object.entries(SPY_SECTOR_WEIGHTS)) out[sec] = (out[sec] || 0) + x.valueIls * w; }
    else { const sec = normalizeSector(x.sector); out[sec] = (out[sec] || 0) + x.valueIls; }
  }
  return Object.entries(out).map(([sector, ils]) => ({ sector, ils: round(ils, 0), share: totalIls ? round(ils / totalIls, 3) : 0 })).sort((a, b) => b.ils - a.ils);
}

export function newAggrState(initialIls = AGGR_RULES.initialIls, day = null){ return { version: AGGR_RULES.version, initialIls, cashIls: initialIls, positions: {}, cooldown: {}, lastDay: null, createdDay: day, stats: { trades: 0, wins: 0, losses: 0, feesIls: 0 } }; }

const usd = (p, fx) => p * fx;
export function markToMarket(state, priceOf, fx){
  let value = 0; const rows = [];
  for (const [sym, p] of Object.entries(state.positions)){ const px = priceOf(sym) ?? p.last ?? p.entry; const v = p.qty * usd(px, fx); value += v; rows.push({ symbol: sym, qty: p.qty, price: px, valueIls: round(v, 0), pnlPct: round(px / p.entry - 1, 4), sector: p.sector || null, core: sym === AGGR_RULES.core, entry: round(p.entry, 4), high: round(p.high || p.entry, 4), openedDay: p.openedDay || null, entryScore: p.entryScore ?? null, entryAction: p.entryAction || null, entryFactors: p.entryFactors || null, stopLevel: round(p.entry * (1 - AGGR_RULES.stopPct), 2), trailLevel: round((p.high || p.entry) * (1 - AGGR_RULES.trailPct), 2) }); }
  const total = state.cashIls + value;
  const etfIls = rows.filter((x) => x.core).reduce((s, x) => s + x.valueIls, 0), stocksIls = value - etfIls;
  // חשיפה: מניות בודדות, קרן (SPY), מזומן, וסך חשיפה מנייתית (מניות + קרן) — כל אחד בנפרד, בלי לבלבל
  const exposure = { stocksIls: round(stocksIls, 0), etfIls: round(etfIls, 0), cashIls: round(state.cashIls, 0), equityIls: round(value, 0), stocksShare: total ? round(stocksIls / total, 3) : 0, etfShare: total ? round(etfIls / total, 3) : 0, cashShare: total ? round(state.cashIls / total, 3) : 0, equityShare: total ? round(value / total, 3) : 0 };
  return { valueIls: value, totalIls: total, rows, exposure };
}

// מחיר מילוי היפותטי: ההחלטה נוצרת בלילה על סגירות; הביצוע למחרת ב-09:40 ניו יורק לפי ציטוט חי (lib/aggressive.js executeAggressive).
// decideAggressive = החלטה בלבד (פקודות עם מחיר החלטה); applyFills = רישום מילויים במחיר בפועל (+החלקה +עמלה).
export function decideAggressive({ state, rows = [], spyPrice = null, regime = null, fx = 3.7, day, rules = AGGR_RULES }){
  const st = JSON.parse(JSON.stringify(state));
  const orders = []; const notes = [];
  const bySym = new Map(rows.map((r) => [r.symbol, r]));
  const priceOf = (s) => (s === rules.core ? spyPrice : bySym.get(s)?.price ?? null);
  const bear = regime?.trend === 'Bear Trend', riskOff = regime?.risk === 'Risk Off';
  // 1. עדכון שיאים ומחירים אחרונים (סגירות)
  for (const [sym, p] of Object.entries(st.positions)){ const px = priceOf(sym); if (isNum(px)){ p.high = Math.max(p.high || px, px); p.last = px; } }
  let mtm = markToMarket(st, priceOf, fx);
  const pendingSell = new Set();
  const sell = (sym, qty, px, reason) => { orders.push({ side: 'sell', symbol: sym, qty, decisionPrice: round(px, 4), reason, sector: st.positions[sym]?.sector || null }); pendingSell.add(sym); };
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
    if (why) sell(sym, p.qty, px, why);
  }
  // מצב "אחרי המכירות" להערכת תקציב (המילוי בפועל מחר)
  const after = JSON.parse(JSON.stringify(st));
  for (const o of orders) if (o.side === 'sell'){ const p = after.positions[o.symbol]; if (p){ after.cashIls += o.qty * usd(o.decisionPrice, fx); delete after.positions[o.symbol]; } }
  mtm = markToMarket(after, priceOf, fx);
  // 3. שוק דובי: מקטינים מניות עד היעד, החלשות קודם (לפי ציון המודל)
  if (bear){
    const stockRows = mtm.rows.filter((x) => !x.core).sort((a, b) => (bySym.get(a.symbol)?.[rules.model] ?? 0) - (bySym.get(b.symbol)?.[rules.model] ?? 0));
    let stocksVal = stockRows.reduce((s, x) => s + x.valueIls, 0);
    for (const x of stockRows){ if (stocksVal <= mtm.totalIls * rules.bearStocksTarget) break; sell(x.symbol, x.qty, x.price, `שוק דובי — הקטנת מניות ל-${Math.round(rules.bearStocksTarget * 100)}% מהתיק`); after.cashIls += x.valueIls; delete after.positions[x.symbol]; stocksVal -= x.valueIls; }
    notes.push('שוק דובי: אין קניות חדשות של מניות');
  }
  mtm = markToMarket(after, priceOf, fx);
  const buy = (sym, qty, px, reason, sector, meta = {}) => { orders.push({ side: 'buy', symbol: sym, qty, decisionPrice: round(px, 4), reason, sector, ...meta }); const cost = qty * usd(px, fx) * (1 + rules.slippage) + rules.feeIls; after.cashIls -= cost; const p = after.positions[sym] || { qty: 0, entry: px, high: px, sector }; p.qty += qty; after.positions[sym] = p; };
  // 4. ליבה: SPY עד 20% (השלמה כשנופלת מתחת ליעד פחות סחיפה)
  if (isNum(spyPrice) && spyPrice > 0){
    const coreVal = mtm.rows.find((x) => x.core)?.valueIls || 0;
    const target = mtm.totalIls * rules.coreWeight;
    if (coreVal < target * (1 - rules.coreDriftPct)){ const qty = Math.floor((target - coreVal) / usd(spyPrice, fx)); const cost = qty * usd(spyPrice, fx) * (1 + rules.slippage) + rules.feeIls; if (qty >= 1 && cost <= after.cashIls - mtm.totalIls * rules.cashReserve * 0.5) buy(rules.core, qty, spyPrice, `ליבה ${Math.round(rules.coreWeight * 100)}% SPY`, 'core'); }
  } else notes.push('אין מחיר SPY היום — הליבה לא עודכנה');
  // 5. קניות: מועמדות לפי המודל, ריכוז: עד 10 פוזיציות של 7.5%, ענף ≤ 40% look-through
  if (!bear){
    const held = new Set(Object.keys(after.positions));
    const cool = (s) => { const d = st.cooldown?.[s]; return d && day && (Date.parse(day) - Date.parse(d)) / 86400000 < rules.cooldownDays; };
    for (const [s2, d] of Object.entries(st.cooldown || {})) if (day && (Date.parse(day) - Date.parse(d)) / 86400000 >= rules.cooldownDays) delete st.cooldown[s2];
    let cands = rows.filter((r) => r['eligible' + rules.model] !== false && r.eligible !== false && isNum(r[rules.model]) && rules.buyActions.includes(r['act' + rules.model]) && !held.has(r.symbol) && !pendingSell.has(r.symbol) && !cool(r.symbol) && isNum(r.price) && r.price > 0).sort((a, b) => b[rules.model] - a[rules.model]);
    if (riskOff && rules.riskOffOnlyStrong){ cands = cands.filter((r) => r['act' + rules.model] === 'STRONG BUY'); notes.push('בריחה מסיכון: קניות רק לקנייה חזקה'); }
    let buys = 0;
    const sectorVal = (sec) => { const m = markToMarket(after, priceOf, fx); return sectorExposure(m.rows, m.totalIls, rules).find((e) => e.sector === normalizeSector(sec))?.ils || 0; };
    for (const r of cands){
      if (buys >= rules.maxBuysPerDay) break;
      const nPos = Object.keys(after.positions).filter((s2) => s2 !== rules.core).length;
      if (nPos >= rules.maxPositions){ notes.push(`מלא: ${rules.maxPositions} פוזיציות`); break; }
      const m2 = markToMarket(after, priceOf, fx); const total = m2.totalIls;
      const stocksVal = m2.rows.filter((x) => !x.core).reduce((s2, x) => s2 + x.valueIls, 0);
      if (stocksVal >= total * rules.stocksWeight) { notes.push('תקציב המניות מלא'); break; }
      if (r.sector && sectorVal(r.sector) + total * rules.positionWeight > total * rules.maxSector){ notes.push(`${r.symbol}: ענף ${normalizeSector(r.sector)} כבר ב-${Math.round(sectorVal(r.sector) / total * 100)}% (כולל look-through של SPY) — מעל 40%`); continue; }
      const budget = Math.min(total * rules.positionWeight, after.cashIls - total * rules.cashReserve);
      const qty = Math.floor(budget / (usd(r.price, fx) * (1 + rules.slippage)));
      if (qty < 1) continue;
      buy(r.symbol, qty, r.price, `מודל ${rules.model}: ${r['act' + rules.model]} (ציון ${r[rules.model]})`, r.sector || null, { score: r[rules.model], action: r['act' + rules.model], model: rules.model, pct: r.pct ? { momentum: r.pct.momentum ?? null, growth: r.pct.growth ?? null, quality: r.pct.quality ?? null, risk: r.pct.risk ?? null } : null });
      buys++;
    }
  }
  st.lastDay = day;
  const closeMtm = markToMarket(st, priceOf, fx);
  return { state: st, orders, notes, totalIls: round(closeMtm.totalIls, 0), cashIls: round(st.cashIls, 0), positions: closeMtm.rows, exposure: closeMtm.exposure, sectors: sectorExposure(closeMtm.rows, closeMtm.totalIls, rules) };
}

// רישום מילויים: fills = [{side, symbol, qty, price (ציטוט/מחיר בפועל לפני החלקה), decisionPrice, reason, sector, quoteAsOf, fillKind}]
export function applyFills(state, fills = [], { fx = 3.7, day, rules = AGGR_RULES } = {}){
  const st = JSON.parse(JSON.stringify(state));
  const trades = [];
  for (const f of fills){
    const fill = f.side === 'buy' ? f.price * (1 + rules.slippage) : f.price * (1 - rules.slippage);
    const ils = f.qty * usd(fill, fx);
    const gapPct = isNum(f.decisionPrice) && f.decisionPrice > 0 ? round(f.price / f.decisionPrice - 1, 4) : null;
    const base = { day, side: f.side, symbol: f.symbol, qty: f.qty, price: round(fill, 4), quotePrice: round(f.price, 4), decisionPrice: f.decisionPrice ?? null, gapPct, quoteAsOf: f.quoteAsOf || null, fillKind: f.fillKind || 'live-quote', ils: round(ils, 0), reason: f.reason };
    if (f.side === 'buy'){
      st.cashIls -= ils + rules.feeIls;
      const p = st.positions[f.symbol] || { qty: 0, entry: fill, high: fill, openedDay: day, sector: f.sector || null, entryScore: f.score ?? null, entryAction: f.action || null, entryModel: f.model || null, entryFactors: f.pct || null, entryReason: f.reason || null };
      const newQty = p.qty + f.qty; p.entry = (p.entry * p.qty + fill * f.qty) / newQty; p.qty = newQty; p.high = Math.max(p.high, fill); p.last = fill; st.positions[f.symbol] = p;
      trades.push(base);
    } else {
      const p = st.positions[f.symbol]; if (!p) continue;
      const qty = Math.min(f.qty, p.qty); const pnl = qty * usd(fill - p.entry, fx);
      st.cashIls += qty * usd(fill, fx) - rules.feeIls; p.qty -= qty; if (p.qty <= 0) delete st.positions[f.symbol];
      if (f.symbol !== rules.core){ st.stats.trades++; if (pnl >= 0) st.stats.wins++; else st.stats.losses++; st.cooldown = st.cooldown || {}; st.cooldown[f.symbol] = day; }
      trades.push({ ...base, qty, pnlIls: round(pnl, 0) });
    }
    st.stats.feesIls += rules.feeIls;
  }
  return { state: st, trades };
}

// נוחות/בדיקות: החלטה + מילוי מיידי במחיר ההחלטה (fillKind 'decision-close'). בפרודקשן המילוי הוא למחרת לפי ציטוט חי.
export function stepAggressive(args){
  const d = decideAggressive(args);
  const a = applyFills(d.state, d.orders.map((o) => ({ ...o, price: o.decisionPrice, fillKind: 'decision-close' })), { fx: args.fx, day: args.day, rules: args.rules });
  const rules = args.rules || AGGR_RULES; const bySym = new Map((args.rows || []).map((r) => [r.symbol, r]));
  const priceOf = (s) => (s === rules.core ? args.spyPrice : bySym.get(s)?.price ?? null);
  const m = markToMarket(a.state, priceOf, args.fx || 3.7);
  return { state: a.state, trades: a.trades, notes: d.notes, totalIls: round(m.totalIls, 0), cashIls: round(a.state.cashIls, 0), positions: m.rows, exposure: m.exposure, sectors: sectorExposure(m.rows, m.totalIls, rules) };
}

// מדדי ביצוע מעקומת הון [[day, totalIls, spyPrice]]
// spyRef: מחיר SPY ברגע המילוי הראשון (09:40) — נקודת ההתחלה של המדד, אותה נקודת זמן כמו התיק
export function aggrMetrics(equity = [], initialIls = AGGR_RULES.initialIls, spyRef = null){
  if (!equity.length) return null;
  const first = equity[0], last = equity[equity.length - 1];
  const ret = last[1] / initialIls - 1;
  const spyBase = isNum(spyRef) && spyRef > 0 ? spyRef : first[2];
  const spyRet = isNum(spyBase) && isNum(last[2]) && spyBase > 0 ? last[2] / spyBase - 1 : null;
  let peak = -Infinity, maxDD = 0; const rets = [];
  for (let i = 0; i < equity.length; i++){ const v = equity[i][1]; peak = Math.max(peak, v); maxDD = Math.min(maxDD, v / peak - 1); if (i) rets.push(v / equity[i - 1][1] - 1); }
  const m = rets.length ? rets.reduce((s, x) => s + x, 0) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1)) : null;
  return { days: equity.length, from: first[0], to: last[0], totalReturn: round(ret, 4), spyReturn: spyRet === null ? null : round(spyRet, 4), excess: spyRet === null ? null : round(ret - spyRet, 4), maxDrawdown: round(maxDD, 4), volAnnual: sd === null ? null : round(sd * Math.sqrt(252), 4) };
}
