// מנוע Backtest: ביצוע ב-Open של היום הבא, עלויות+slippage, מדדים, Walk-Forward.
// אינדיקטורים מחושבים מראש — כולם אחוריים (causal), ולכן זהים לחישוב על prefix (נבדק ב-tests).
// Backtest אינו תחזית. ראו invest/docs/BACKTESTING_RULES.md.
import { isNum, round, mean, std, cagr, yearsBetween, rowsUntil } from './util.js';
import { closes, highs, lows, volumes, sma, rsi, macd, bollinger, atr, rollingMax, rollingMin, annualizedVol } from './indicators.js';
import { computeScore } from './scoring.js';
import { deriveSignal } from './signals.js';
import { asOf, computeMetrics } from './fundamentals.js';

export const DEFAULT_COSTS = { commission: 0.001, slippage: 0.0005 };

export const STRATEGIES = {
  buyhold: { label: 'Buy & Hold', params: {}, grid: [{}] },
  trend: { label: 'מגמה (מעל SMA ארוך + SMA50 מעליו)', params: { long: 200 }, grid: [{ long: 150 }, { long: 200 }, { long: 250 }] },
  momentum: { label: 'מומנטום 12−1', params: { rsiMax: 75 }, grid: [{ rsiMax: 70 }, { rsiMax: 75 }, { rsiMax: 80 }] },
  meanrev: { label: 'חזרה לממוצע (RSI נמוך מעל SMA200)', params: { rsiBuy: 30, rsiSell: 55, maxHold: 20 }, grid: [{ rsiBuy: 25, rsiSell: 55, maxHold: 20 }, { rsiBuy: 30, rsiSell: 55, maxHold: 20 }, { rsiBuy: 35, rsiSell: 60, maxHold: 30 }] },
  signal: { label: 'סיגנל המערכת (BUY↔SELL/REDUCE + stop)', params: { minBuy: 'BUY' }, grid: [{ minBuy: 'BUY' }, { minBuy: 'STRONG BUY' }] },
};

export function precompute(rows){
  const c = closes(rows), h = highs(rows), l = lows(rows), v = volumes(rows);
  const m = macd(c), bb = bollinger(c, 20, 2);
  return {
    rows, c, h, l, v, n: rows.length,
    sma20: sma(c, 20), sma50: sma(c, 50), sma100: sma(c, 100), sma150: sma(c, 150), sma200: sma(c, 200), sma250: sma(c, 250),
    rsi: rsi(c, 14), macd: m, bb, atr: atr(rows, 14), vol20: sma(v, 20),
    hi252: rollingMax(h, 252), lo252: rollingMin(l, 252), hi20: rollingMax(h, 20), lo20: rollingMin(l, 20),
  };
}

// snapshot טכני "רזה" ליום i מהמערכים המחושבים מראש (אותה סמנטיקה כמו technicalSnapshot)
export function snapshotAt(p, i){
  const price = p.c[i];
  const ret = (n) => (i - n >= 0 && p.c[i - n] ? price / p.c[i - n] - 1 : null);
  let trendScore = 0;
  if (isNum(p.sma50[i]) && price > p.sma50[i]) trendScore += 25;
  if (isNum(p.sma100[i]) && price > p.sma100[i]) trendScore += 25;
  if (isNum(p.sma200[i]) && price > p.sma200[i]) trendScore += 25;
  if (isNum(p.sma50[i]) && isNum(p.sma200[i]) && p.sma50[i] > p.sma200[i]) trendScore += 25;
  const events = [];
  const cross = (a, b, days) => { for (let k = Math.max(1, i - days + 1); k <= i; k++) if (isNum(a[k]) && isNum(b[k]) && isNum(a[k - 1]) && isNum(b[k - 1]) && a[k - 1] <= b[k - 1] && a[k] > b[k]) return true; return false; };
  if (cross(p.sma50, p.sma200, 10)) events.push({ id: 'golden_cross', tone: 'pos', label: 'Golden Cross' });
  if (cross(p.sma200, p.sma50, 10)) events.push({ id: 'death_cross', tone: 'neg', label: 'Death Cross' });
  if (isNum(p.rsi[i]) && p.rsi[i] > 70) events.push({ id: 'overbought', tone: 'neg', label: 'Overbought' });
  if (isNum(p.rsi[i]) && p.rsi[i] < 30) events.push({ id: 'oversold', tone: 'mixed', label: 'Oversold' });
  const hh = p.macd.hist;
  if (i >= 5 && isNum(hh[i]) && isNum(hh[i - 5]) && hh[i] > 0 && hh[i] - hh[i - 5] > 0) events.push({ id: 'momentum_accel', tone: 'pos', label: 'מומנטום מתחזק' });
  const relVol = isNum(p.vol20[i]) && p.vol20[i] > 0 ? p.v[i] / p.vol20[i] : null;
  const breakout = i > 0 && isNum(p.hi20[i - 1]) && price > p.hi20[i - 1] && isNum(relVol) && relVol > 1.5;
  const win = p.c.slice(Math.max(0, i - 251), i + 1);
  let peak = -Infinity, maxDD = 0;
  for (const x of win){ peak = Math.max(peak, x); maxDD = Math.min(maxDD, x / peak - 1); }
  const sup = isNum(p.lo20[i]) ? [{ level: p.lo20[i] }] : [];
  return {
    date: p.rows[i][0], price, bars: i + 1,
    sma: { s20: p.sma20[i], s50: p.sma50[i], s100: p.sma100[i], s200: p.sma200[i] }, rsi: p.rsi[i],
    macd: { line: p.macd.line[i], signal: p.macd.signal[i], hist: hh[i] }, bb: { pctB: p.bb.pctB[i] ?? 0.5 }, atr: p.atr[i], atrPct: isNum(p.atr[i]) ? p.atr[i] / price : null,
    high52: p.hi252[i], low52: p.lo252[i], distFromHigh52: isNum(p.hi252[i]) ? price / p.hi252[i] - 1 : null,
    momentum: { r1m: ret(21), r3m: ret(63), r6m: ret(126), r12m: ret(252), r12_1: i - 252 >= 0 && p.c[i - 252] ? p.c[i - 21] / p.c[i - 252] - 1 : null },
    vol1y: i >= 252 ? annualizedVol(p.c.slice(i - 252, i + 1)) : null, vol6m: i >= 126 ? annualizedVol(p.c.slice(i - 126, i + 1), 126) : null,
    maxDrawdown1y: maxDD, trendScore, trend: trendScore >= 75 ? 'עולה' : trendScore >= 50 ? 'עולה-חלש' : trendScore >= 25 ? 'יורד-חלש' : 'יורד',
    supports: sup, resistances: i > 0 && isNum(p.hi20[i - 1]) ? [{ level: p.hi20[i - 1] }] : [], breakout, events, relVol,
  };
}

// פונקציית החלטה לכל אסטרטגיה: מחזירה 'long' | 'flat' לפי המידע עד i בלבד
function decide(strategy, params, p, i, state, ctx){
  const c = p.c[i];
  switch (strategy){
    case 'buyhold': return 'long';
    case 'trend': {
      const L = p['sma' + (params.long || 200)] || p.sma200;
      if (!isNum(L[i]) || !isNum(p.sma50[i])) return 'flat';
      return state.pos ? (c > L[i] ? 'long' : 'flat') : (c > L[i] && p.sma50[i] > L[i] ? 'long' : 'flat');
    }
    case 'momentum': {
      if (i < 252) return 'flat';
      const m = p.c[i - 21] / p.c[i - 252] - 1;
      if (state.pos) return m > 0 ? 'long' : 'flat';
      return m > 0 && isNum(p.rsi[i]) && p.rsi[i] < (params.rsiMax || 75) ? 'long' : 'flat';
    }
    case 'meanrev': {
      if (!isNum(p.sma200[i]) || !isNum(p.rsi[i])) return 'flat';
      if (state.pos){
        if (p.rsi[i] > (params.rsiSell || 55) || i - state.entryIdx >= (params.maxHold || 20)) return 'flat';
        return 'long';
      }
      return p.rsi[i] < (params.rsiBuy || 30) && p.bb.pctB[i] < 0 && c > p.sma200[i] ? 'long' : 'flat';
    }
    case 'signal': {
      if (i < 200) return 'flat';
      const every = 5;
      if (!state.cache || i - state.cacheIdx >= every){
        const t = snapshotAt(p, i);
        let metrics = null, fair = null;
        if (ctx.facts){
          const f = asOf(ctx.facts, p.rows[i][0]);
          metrics = computeMetrics(f, { price: c });
        }
        const score = computeScore({ metrics, technical: t, fair, profile: ctx.profile, regime: null, riskExtras: { currency: ctx.profile?.currency || 'USD', baseCurrency: 'USD' } }, ctx.weights);
        const sig = deriveSignal({ score, technical: t, fair, regime: null, profile: ctx.profile, price: c });
        state.cache = { sig, t }; state.cacheIdx = i;
      }
      const { sig } = state.cache;
      const buyOk = params.minBuy === 'STRONG BUY' ? sig.label === 'STRONG BUY' : (sig.label === 'BUY' || sig.label === 'STRONG BUY');
      if (state.pos){
        if (sig.label === 'SELL' || sig.label === 'REDUCE') return 'flat';
        if (isNum(state.stop) && c < state.stop) return 'flat';
        return 'long';
      }
      return buyOk ? 'long' : 'flat';
    }
    default: return 'flat';
  }
}

export function simulate({ rows, strategy = 'trend', params = {}, costs = DEFAULT_COSTS, start = null, end = null, ctx = {}, initial = 100000 }){
  const all = rows;
  const p = precompute(all);
  // חלון ההרצה — האינדיקטורים כבר "מחוממים" מהיסטוריה קודמת (אין look-ahead: כולם אחוריים)
  let i0 = 0, i1 = all.length - 1;
  if (start){ i0 = all.findIndex((r) => r[0] >= start); if (i0 < 0) return { error: 'תאריך התחלה אחרי סוף הנתונים' }; }
  if (end){ const e = rowsUntil(all, end).length - 1; if (e >= 0) i1 = e; }
  const state = { pos: 0, entryIdx: -1, entryPrice: null, stop: null, cash: initial, cache: null, cacheIdx: -1, peak: null };
  const trades = [], equity = [];
  const commission = costs.commission ?? 0.001, slip = costs.slippage ?? 0.0005;
  let pendingOrder = null; // {side} מבוצע ב-Open של הבר הבא
  for (let i = i0; i <= i1; i++){
    const r = all[i];
    // 1. ביצוע פקודה שהוחלטה אתמול, במחיר הפתיחה של היום
    if (pendingOrder){
      const px = r[1];
      if (pendingOrder.side === 'buy' && !state.pos){
        const fill = px * (1 + slip);
        const qty = (state.cash * (1 - commission)) / fill;
        state.pos = qty; state.cash = 0; state.entryIdx = i; state.entryPrice = fill; state.peak = fill;
        state.stop = isNum(p.atr[i - 1]) ? fill - 2.5 * p.atr[i - 1] : null;
        trades.push({ entryDate: r[0], entryPrice: round(fill, 4), qty: round(qty, 4), reason: pendingOrder.reason });
      } else if (pendingOrder.side === 'sell' && state.pos){
        const fill = px * (1 - slip);
        const proceeds = state.pos * fill * (1 - commission);
        const t = trades[trades.length - 1];
        t.exitDate = r[0]; t.exitPrice = round(fill, 4); t.pnl = round(proceeds - state.pos * state.entryPrice, 2); t.pnlPct = round(fill / state.entryPrice - 1, 4); t.bars = i - state.entryIdx; t.exitReason = pendingOrder.reason;
        state.cash = proceeds; state.pos = 0; state.stop = null;
      }
      pendingOrder = null;
    }
    // 2. שווי בסוף היום
    if (state.pos && isNum(state.peak)){ state.peak = Math.max(state.peak, r[4]); if (isNum(p.atr[i]) && strategy === 'signal') state.stop = Math.max(state.stop ?? -Infinity, state.peak - 3 * p.atr[i]); }
    const eq = state.cash + state.pos * r[4];
    equity.push([r[0], round(eq, 2)]);
    // 3. החלטה על סמך מידע עד סוף היום i → פקודה למחר
    if (i === i1) break;
    const want = decide(strategy, params, p, i, state, ctx);
    if (want === 'long' && !state.pos) pendingOrder = { side: 'buy', reason: strategy };
    else if (want === 'flat' && state.pos) pendingOrder = { side: 'sell', reason: strategy === 'signal' && isNum(state.stop) && r[4] < state.stop ? 'stop' : strategy };
  }
  // פוזיציה פתוחה בסוף — מסומנת, לא נסגרת (mark-to-market)
  const open = state.pos ? { ...trades[trades.length - 1], open: true, markPrice: all[i1][4], pnlPct: round(all[i1][4] / state.entryPrice - 1, 4) } : null;
  if (open) trades[trades.length - 1] = open;
  const bh = buyHoldEquity(all.slice(i0, i1 + 1), initial, costs);
  return { strategy, params, costs, from: all[i0][0], to: all[i1][0], equity, trades, metrics: metrics(equity, trades, ctx.rf), buyHold: { equity: bh, metrics: metrics(bh, [], ctx.rf) }, note: 'Backtest אינו תחזית. ביצוע ב-Open של היום העוקב, כולל עמלה ו-slippage.', survivorshipNote: 'נכס בודד — הטיית שרידות לא נשללת (הנכס נבחר בידיעה שהוא קיים היום).' };
}

export function buyHoldEquity(rows, initial = 100000, costs = DEFAULT_COSTS){
  if (!rows.length) return [];
  const fill = rows[0][1] * (1 + (costs.slippage ?? 0));
  const qty = (initial * (1 - (costs.commission ?? 0))) / fill;
  return rows.map((r) => [r[0], round(qty * r[4], 2)]);
}

export function metrics(equity, trades = [], rf = 0){
  if (!equity || equity.length < 2) return null;
  const v = equity.map((e) => e[1]);
  const rets = [];
  for (let i = 1; i < v.length; i++) rets.push(v[i] / v[i - 1] - 1);
  const years = yearsBetween(equity[0][0], equity[equity.length - 1][0]) || (v.length / 252);
  const total = v[v.length - 1] / v[0] - 1;
  const vol = std(rets) * Math.sqrt(252);
  const meanR = mean(rets) * 252;
  const rfr = isNum(rf) ? rf : 0;
  const downside = std(rets.filter((r) => r < 0)) * Math.sqrt(252);
  let peak = v[0], maxDD = 0, ddStart = 0, ddLen = 0, curStart = 0;
  for (let i = 0; i < v.length; i++){
    if (v[i] >= peak){ peak = v[i]; curStart = i; }
    const dd = v[i] / peak - 1;
    if (dd < maxDD){ maxDD = dd; ddStart = curStart; ddLen = i - curStart; }
  }
  const closed = trades.filter((t) => isNum(t.pnl));
  const wins = closed.filter((t) => t.pnl > 0), losses = closed.filter((t) => t.pnl <= 0);
  const gp = wins.reduce((s, t) => s + t.pnl, 0), gl = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const c = cagr(v[v.length - 1], v[0], years);
  return {
    cagr: round(c, 4), totalReturn: round(total, 4), volatility: round(vol, 4),
    sharpe: vol ? round((meanR - rfr) / vol, 2) : null, sortino: downside ? round((meanR - rfr) / downside, 2) : null,
    maxDrawdown: round(maxDD, 4), maxDrawdownDays: ddLen, maxDrawdownStart: equity[ddStart]?.[0],
    calmar: maxDD ? round(c / Math.abs(maxDD), 2) : null,
    trades: closed.length + (trades.some((t) => t.open) ? 1 : 0), closedTrades: closed.length,
    winRate: closed.length ? round(wins.length / closed.length, 3) : null,
    profitFactor: gl ? round(gp / gl, 2) : (gp ? Infinity : null),
    avgTradePct: closed.length ? round(mean(closed.map((t) => t.pnlPct)), 4) : null,
    bestTradePct: closed.length ? round(Math.max(...closed.map((t) => t.pnlPct)), 4) : null,
    worstTradePct: closed.length ? round(Math.min(...closed.map((t) => t.pnlPct)), 4) : null,
    exposure: trades.length ? round(trades.reduce((s, t) => s + (t.bars || 0), 0) / v.length, 3) : (equity.length ? 1 : 0),
    years: round(years, 2), rf: rfr,
  };
}

// תקופות שוק סטנדרטיות (מסומנות "אין נתונים" אם ההיסטוריה קצרה)
export const PERIODS = [
  { id: 'gfc', label: 'משבר 2007–2009', start: '2007-10-01', end: '2009-12-31' },
  { id: 'bull', label: 'שוק שור 2010–2019', start: '2010-01-01', end: '2019-12-31' },
  { id: 'covid', label: 'קורונה 2020', start: '2020-01-01', end: '2020-12-31' },
  { id: 'rates', label: 'ריבית 2022', start: '2022-01-01', end: '2022-12-31' },
  { id: 'recent', label: '2023–היום', start: '2023-01-01', end: null },
];

export function multiPeriod(args){
  return PERIODS.map((pd) => {
    const has = args.rows.length && args.rows[0][0] <= pd.start && (!pd.end || args.rows[args.rows.length - 1][0] >= pd.end);
    if (!has) return { ...pd, missing: true, reason: 'אין נתונים לתקופה' };
    const r = simulate({ ...args, start: pd.start, end: pd.end });
    return { ...pd, metrics: r.metrics, buyHold: r.buyHold.metrics, trades: r.trades.length };
  });
}

// Walk-Forward: IS→OOS מתגלגל; בחירה על IS לפי Sharpe בלבד; דיווח OOS משורשר.
export function walkForward({ rows, strategy, isYears = 3, oosYears = 1, costs = DEFAULT_COSTS, ctx = {}, grid = null }){
  const g = grid || STRATEGIES[strategy]?.grid || [{}];
  const first = rows[0][0], last = rows[rows.length - 1][0];
  const windows = [];
  let isStart = first;
  for (;;){
    const isEnd = addYears(isStart, isYears), oosEnd = addYears(isEnd, oosYears);
    if (isEnd >= last) break;
    windows.push({ isStart, isEnd, oosStart: isEnd, oosEnd: oosEnd > last ? last : oosEnd });
    isStart = addYears(isStart, oosYears);
  }
  if (!windows.length) return { error: `נדרשות לפחות ${isYears + 1} שנות נתונים ל-Walk-Forward` };
  const results = [];
  let oosEquity = [], scale = 1;
  for (const w of windows){
    let best = null;
    for (const params of g){
      const r = simulate({ rows, strategy, params, costs, start: w.isStart, end: w.isEnd, ctx });
      const sh = r.metrics?.sharpe ?? -Infinity;
      if (!best || sh > best.sharpe) best = { params, sharpe: sh, metrics: r.metrics };
    }
    const oos = simulate({ rows, strategy, params: best.params, costs, start: w.oosStart, end: w.oosEnd, ctx });
    // שרשור עקומת ההון (נורמליזציה לרציפות)
    const base = oos.equity[0]?.[1] || 1;
    const seg = oos.equity.map(([d, e]) => [d, round((e / base) * scale * 100000, 2)]);
    if (oosEquity.length && seg.length && seg[0][0] === oosEquity[oosEquity.length - 1][0]) seg.shift();
    oosEquity = oosEquity.concat(seg);
    scale = oosEquity.length ? oosEquity[oosEquity.length - 1][1] / 100000 : scale;
    results.push({ window: w, chosen: best.params, inSample: best.metrics, outOfSample: oos.metrics, oosTrades: oos.trades.length });
  }
  const chosenKeys = results.map((r) => JSON.stringify(r.chosen));
  const distinct = new Set(chosenKeys).size;
  return {
    strategy, windows: results, oosEquity, oosMetrics: metrics(oosEquity, []),
    stability: { distinctParamSets: distinct, windows: results.length, label: distinct <= Math.max(1, Math.ceil(results.length / 2)) ? 'יציב' : 'לא יציב — הפרמטר הנבחר קופץ בין חלונות' },
    note: 'התוצאה = OOS משורשר בלבד. In-sample מוצג להשוואה ואינו תוצאה.',
  };
}

function addYears(iso, n){ const d = new Date(iso + 'T00:00:00Z'); d.setUTCFullYear(d.getUTCFullYear() + n); return d.toISOString().slice(0, 10); }

// תשואות קדימה מנקודת זמן (ל-As-Of): 1/3/6/12 חודשים
export function forwardReturns(rows, date){
  const i = rowsUntil(rows, date).length - 1;
  if (i < 0) return null;
  const base = rows[i][4];
  const out = {};
  for (const [k, days] of [['m1', 21], ['m3', 63], ['m6', 126], ['m12', 252]]){
    const j = i + days;
    out[k] = j < rows.length ? { ret: round(rows[j][4] / base - 1, 4), date: rows[j][0] } : null;
  }
  return { base, baseDate: rows[i][0], ...out };
}
