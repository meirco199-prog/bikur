// מדדי ביצוע וסיכון + פילוחים (דרישה 7). קלט: תוצאת simulate(). טהור.
import { mean, std } from '../util.js';

const sum = (a) => a.reduce((x, y) => x + y, 0);
const rnd = (x, d = 4) => (Number.isFinite(x) ? +x.toFixed(d) : null);
// תשואות יומיות: רגיל = יחסית להון של אתמול; additiveBase (מצב מחקר, הון קבוע) = שינוי בדולרים חלקי ההון הקבוע — נכון גם כשההון המצטבר שלילי
export function dailyReturns(equity, additiveBase = null){ const r = []; for (let i = 1; i < equity.length; i++){ const a = equity[i - 1][1], b = equity[i][1]; r.push(additiveBase ? (b - a) / additiveBase : a > 0 ? b / a - 1 : 0); } return r; }
export function drawdownSeries(equity, additiveBase = null){ let peak = -Infinity; return equity.map((e) => { peak = Math.max(peak, e[1]); return [e[0], additiveBase ? (e[1] - peak) / additiveBase : peak > 0 ? e[1] / peak - 1 : 0]; }); }
export function maxDrawdown(equity, additiveBase = null){
  if (additiveBase){ // ירידה בדולרים מהשיא חלקי ההון הקבוע
    let peak = -Infinity, peakI = 0, maxDD = 0, ddStart = null, trough = null, ddEnd = null, longest = 0, curStart = null, troughI = -1;
    for (let i = 0; i < equity.length; i++){ const v = equity[i][1]; if (v >= peak){ if (curStart !== null){ longest = Math.max(longest, i - curStart); curStart = null; } if (troughI >= 0 && ddEnd === null && ddStart === equity[peakI]?.[0]) ddEnd = equity[i][0]; peak = v; peakI = i; } else { if (curStart === null) curStart = peakI; const dd = (v - peak) / additiveBase; if (dd < maxDD){ maxDD = dd; ddStart = equity[peakI][0]; trough = equity[i][0]; troughI = i; ddEnd = null; } } }
    if (curStart !== null) longest = Math.max(longest, equity.length - 1 - curStart);
    return { maxDD: rnd(maxDD), peakDate: ddStart, troughDate: trough, recoveryDate: ddEnd, recoveryDays: ddEnd && troughI >= 0 ? equity.findIndex((e) => e[0] === ddEnd) - troughI : null, longestDrawdownDays: longest, recovered: !!ddEnd };
  }
  let peak = -Infinity, peakI = 0, maxDD = 0, ddStart = null, ddEnd = null, trough = null, longest = 0, curStart = null, recovery = null;
  for (let i = 0; i < equity.length; i++){
    const v = equity[i][1];
    if (v >= peak){ if (curStart !== null){ longest = Math.max(longest, i - curStart); curStart = null; } peak = v; peakI = i; }
    else { if (curStart === null) curStart = peakI; const dd = v / peak - 1; if (dd < maxDD){ maxDD = dd; ddStart = equity[peakI][0]; trough = equity[i][0]; ddEnd = null; } }
    if (maxDD < 0 && ddEnd === null && trough && equity[i][0] > trough && v >= peakOf(equity, ddStart)) ddEnd = equity[i][0];
  }
  if (curStart !== null) longest = Math.max(longest, equity.length - 1 - curStart);
  if (ddStart && ddEnd){ const a = equity.findIndex((e) => e[0] === trough), b = equity.findIndex((e) => e[0] === ddEnd); recovery = b - a; }
  return { maxDD: rnd(maxDD), peakDate: ddStart, troughDate: trough, recoveryDate: ddEnd, recoveryDays: recovery, longestDrawdownDays: longest, recovered: !!ddEnd };
}
const peakOf = (equity, date) => equity.find((e) => e[0] === date)?.[1] ?? Infinity;
const years = (equity) => { if (equity.length < 2) return 0; const a = new Date(equity[0][0]), b = new Date(equity[equity.length - 1][0]); return Math.max(1 / 365, (b - a) / 86400000 / 365.25); };
export function quantile(sorted, q){ if (!sorted.length) return null; const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo); }

export function seriesMetrics(equity, { rf = 0, additiveBase = null } = {}){
  if (!equity || equity.length < 2) return null;
  const r = dailyReturns(equity, additiveBase), n = r.length, yrs = years(equity), start = equity[0][1], end = equity[equity.length - 1][1];
  const m = mean(r), sd = std(r), downside = Math.sqrt(sum(r.filter((x) => x < 0).map((x) => x * x)) / Math.max(1, n));
  const cagr = additiveBase ? null : start > 0 && end > 0 && yrs > 0 ? Math.pow(end / start, 1 / yrs) - 1 : null;
  const dd = maxDrawdown(equity, additiveBase), rfd = rf / 252;
  const sorted = r.slice().sort((a, b) => a - b), var95 = quantile(sorted, 0.05), cvar = sorted.length ? mean(sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.05)))) : null;
  let streak = 0, maxStreak = 0; for (const x of r){ streak = x < 0 ? streak + 1 : 0; maxStreak = Math.max(maxStreak, streak); }
  return { start, end, additive: !!additiveBase, totalReturn: rnd(additiveBase ? (end - start) / additiveBase : end / start - 1), pnl: rnd(end - start, 2), cagr: rnd(cagr), avgAnnual: rnd(m * 252), years: rnd(yrs, 2), annVol: rnd(sd * Math.sqrt(252)), sharpe: sd > 0 ? rnd((m - rfd) / sd * Math.sqrt(252), 3) : null, sortino: downside > 0 ? rnd((m - rfd) / downside * Math.sqrt(252), 3) : null, calmar: dd.maxDD < 0 && (additiveBase ? m * 252 : cagr) !== null ? rnd((additiveBase ? m * 252 : cagr) / -dd.maxDD, 3) : null, ...dd, var95: rnd(var95), cvar95: rnd(cvar), maxLosingDays: maxStreak, bestDay: rnd(sorted[sorted.length - 1]), worstDay: rnd(sorted[0]), positiveDays: rnd(r.filter((x) => x > 0).length / Math.max(1, n)), days: n };
}

export function tradeMetrics(trades){
  if (!trades?.length) return { count: 0 };
  const p = trades.map((t) => t.pnl), pct = trades.map((t) => t.pnlPct), wins = trades.filter((t) => t.pnl > 0), losses = trades.filter((t) => t.pnl <= 0);
  const gw = sum(wins.map((t) => t.pnl)), gl = -sum(losses.map((t) => t.pnl));
  let streak = 0, maxStreak = 0, wstreak = 0, maxW = 0; for (const t of trades){ if (t.pnl <= 0){ streak++; wstreak = 0; } else { wstreak++; streak = 0; } maxStreak = Math.max(maxStreak, streak); maxW = Math.max(maxW, wstreak); }
  const costs = sum(trades.map((t) => t.costs?.total || 0));
  return { count: trades.length, winRate: rnd(wins.length / trades.length), avgWin: wins.length ? rnd(mean(wins.map((t) => t.pnl)), 2) : null, avgLoss: losses.length ? rnd(mean(losses.map((t) => t.pnl)), 2) : null, avgWinPct: wins.length ? rnd(mean(wins.map((t) => t.pnlPct))) : null, avgLossPct: losses.length ? rnd(mean(losses.map((t) => t.pnlPct))) : null, avgTrade: rnd(mean(p), 2), avgTradePct: rnd(mean(pct)), medianTradePct: rnd(quantile(pct.slice().sort((a, b) => a - b), 0.5)), profitFactor: gl > 0 ? rnd(gw / gl, 3) : (gw > 0 ? Infinity : null), expectancy: rnd(mean(p), 2), expectancyPct: rnd(mean(pct)), payoff: wins.length && losses.length ? rnd(mean(wins.map((t) => t.pnlPct)) / -mean(losses.map((t) => t.pnlPct)), 3) : null, best: rnd(Math.max(...pct)), worst: rnd(Math.min(...pct)), maxLosingStreak: maxStreak, maxWinningStreak: maxW, grossProfit: rnd(gw, 2), grossLoss: rnd(-gl, 2), netPnl: rnd(sum(p), 2), totalCosts: rnd(costs, 2), avgHoldDays: rnd(mean(trades.map((t) => t.holdDays)), 1), avgMfe: rnd(mean(trades.map((t) => t.mfe ?? 0))), avgMae: rnd(mean(trades.map((t) => t.mae ?? 0))), maxParticipation: rnd(Math.max(0, ...trades.map((t) => t.participation || 0)), 5), highParticipation: trades.filter((t) => (t.participation || 0) > 0.01).length, exitReasons: countBy(trades, (t) => t.exitReason) };
}
const countBy = (arr, f) => { const m = {}; for (const x of arr){ const k = f(x) ?? '—'; m[k] = (m[k] || 0) + 1; } return m; };

// פילוח עסקאות לפי מפתח → {key: {count, winRate, avgPct, pnl}}
export function groupTrades(trades, keyFn, order = null){
  const g = {};
  for (const t of trades){ const k = keyFn(t); if (k === null || k === undefined) continue; (g[k] ||= { count: 0, wins: 0, pnl: 0, pct: 0 }); const x = g[k]; x.count++; if (t.pnl > 0) x.wins++; x.pnl += t.pnl; x.pct += t.pnlPct; }
  const rows = Object.entries(g).map(([key, x]) => ({ key, count: x.count, winRate: rnd(x.wins / x.count), avgPct: rnd(x.pct / x.count), pnl: rnd(x.pnl, 2) }));
  if (order) rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)); else rows.sort((a, b) => (isNaN(+a.key) ? a.key.localeCompare(b.key) : +a.key - +b.key));
  return rows;
}
const WD = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
export function breakdowns(trades){
  const wd = (iso) => WD[new Date(iso + 'T00:00:00Z').getUTCDay()];
  const holdBucket = (d) => (d <= 1 ? '1' : d <= 2 ? '2' : d <= 3 ? '3' : d <= 5 ? '4–5' : d <= 10 ? '6–10' : d <= 20 ? '11–20' : d <= 60 ? '21–60' : '60+');
  return { byWeekday: groupTrades(trades, (t) => wd(t.entryDate), WD), byMonth: groupTrades(trades, (t) => +t.entryDate.slice(5, 7)), byYear: groupTrades(trades, (t) => t.entryDate.slice(0, 4)), bySector: groupTrades(trades, (t) => t.sector || 'לא ידוע'), byHold: groupTrades(trades, (t) => holdBucket(t.holdDays), ['1', '2', '3', '4–5', '6–10', '11–20', '21–60', '60+']), byExit: groupTrades(trades, (t) => t.exitReason), bySymbol: groupTrades(trades, (t) => t.symbol).sort((a, b) => b.pnl - a.pnl) };
}
// תשואות לפי חודש {YYYY-MM: ret} ולפי שנה + Heatmap [{year, months:[12]}]
export function periodicReturns(equity, additiveBase = null){
  const ret = (end, start) => (additiveBase ? (end - start) / additiveBase : start > 0 ? end / start - 1 : null);
  const monthly = {}, yearly = {}; let lastM = null, lastY = null, mStart = null, yStart = null;
  for (const [d, v] of equity){ const ym = d.slice(0, 7), y = d.slice(0, 4); if (ym !== lastM){ if (lastM) monthly[lastM] = rnd(ret(mPrev, mStart)); mStart = prevVal(equity, d) ?? v; lastM = ym; } if (y !== lastY){ if (lastY) yearly[lastY] = rnd(ret(yPrev, yStart)); yStart = prevVal(equity, d) ?? v; lastY = y; } var mPrev = v, yPrev = v; }
  if (lastM) monthly[lastM] = rnd(ret(mPrev, mStart)); if (lastY) yearly[lastY] = rnd(ret(yPrev, yStart));
  const yearsList = [...new Set(Object.keys(monthly).map((k) => k.slice(0, 4)))].sort();
  const heatmap = yearsList.map((y) => ({ year: y, months: Array.from({ length: 12 }, (_, i) => monthly[`${y}-${String(i + 1).padStart(2, '0')}`] ?? null), total: yearly[y] ?? null }));
  return { monthly, yearly, heatmap };
}
const prevVal = (equity, d) => { let p = null; for (const e of equity){ if (e[0] >= d) break; p = e[1]; } return p; };
export function histogram(values, bins = 20){ if (!values.length) return []; const lo = Math.min(...values), hi = Math.max(...values); const w = (hi - lo) / bins || 1; const out = Array.from({ length: bins }, (_, i) => ({ from: rnd(lo + i * w), to: rnd(lo + (i + 1) * w), count: 0 })); for (const v of values){ const i = Math.min(bins - 1, Math.floor((v - lo) / w)); out[i].count++; } return out; }
// אלפא/בטא/קורלציה יומיים מול ייחוס
// יחסית לייחוס. במצב מחקר (additiveBase) תשואות האסטרטגיה הן Δ$/הון קבוע ואילו הייחוס מכפלי — בטא/אלפא/עודף היו תלויים בגודל ההון (ממצא GPT #235) ולכן מוחזרים null; קורלציה אינה תלויה בסקלה ונשארת
export function relative(equity, bench, additiveBase = null){ if (!bench || bench.length !== equity.length) return null; const a = dailyReturns(equity, additiveBase), b = dailyReturns(bench);
  if (additiveBase){ const ma = mean(a), mb = mean(b); let cov = 0, va = 0, vb = 0; for (let i = 0; i < a.length; i++){ cov += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return { beta: null, alphaAnnual: null, correlation: va > 0 && vb > 0 ? rnd(cov / Math.sqrt(va * vb), 3) : null, excessReturn: null, additive: true, note: 'מצב מחקר: בטא/אלפא/עודף לא מחושבים (יחידות שונות — Δ$ על הון קבוע מול תשואה מכפלית); קורלציה בלבד' }; } const ma = mean(a), mb = mean(b); let cov = 0, vb = 0, va = 0; for (let i = 0; i < a.length; i++){ cov += (a[i] - ma) * (b[i] - mb); vb += (b[i] - mb) ** 2; va += (a[i] - ma) ** 2; } const beta = vb > 0 ? cov / vb : null; return { beta: rnd(beta, 3), alphaAnnual: beta !== null ? rnd((ma - beta * mb) * 252) : null, correlation: va > 0 && vb > 0 ? rnd(cov / Math.sqrt(va * vb), 3) : null, excessReturn: rnd(equity[equity.length - 1][1] / equity[0][1] - bench[bench.length - 1][1] / bench[0][1]) }; }

// החבילה המלאה לדשבורד
export function analyze(result, { rf = 0 } = {}){
  if (!result || result.error) return result;
  const base = result.spec?.sizing?.unlimited ? result.capital : null; // מצב מחקר: הכול יחסית להון הקבוע
  const series = seriesMetrics(result.equity, { rf, additiveBase: base }), trades = tradeMetrics(result.trades);
  const exposure = result.equity.map((e) => (base ? Math.abs(e[1] - e[2]) / base : e[3])), inMarket = result.equity.filter((e) => e[4] > 0).length;
  const benchmarks = {}; for (const [b, eq] of Object.entries(result.benchmarks || {})) benchmarks[b] = eq ? { metrics: seriesMetrics(eq, { rf }), relative: relative(result.equity, eq, base) } : null;
  return { series: { ...series, avgExposure: rnd(mean(exposure)), timeInMarket: rnd(inMarket / Math.max(1, result.equity.length)) }, trades, breakdowns: breakdowns(result.trades), periodic: periodicReturns(result.equity, base), histogram: histogram(result.trades.map((t) => t.pnlPct)), drawdown: drawdownSeries(result.equity, base), benchmarks, costs: result.totals, coverage: result.coverage, gaps: result.gaps, assumptions: result.assumptions, limited: result.limited, skipped: result.skipped };
}
