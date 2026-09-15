// Market Regime Engine — סיווג מצב שוק לפי כללים גלויים בלבד.
// קלט: rows של מדדים (SPX/NDQ/RUT/TA35), סדרות מאקרו [[date,value]], רוחב שוק.
import { isNum, round, rowsUntil } from './util.js';
import { closes, sma, rsi } from './indicators.js';

function lastVal(series, date){
  if (!series || !series.length) return null;
  const rows = date ? rowsUntil(series, date) : series;
  return rows.length ? rows[rows.length - 1][1] : null;
}
function valAgo(series, date, days){
  if (!series || !series.length) return null;
  const rows = date ? rowsUntil(series, date) : series;
  const i = rows.length - 1 - days;
  return i >= 0 ? rows[i][1] : null;
}

function indexState(rows, date){
  const r = date ? rowsUntil(rows, date) : rows;
  if (!r || r.length < 200) return null;
  const c = closes(r), i = c.length - 1;
  const s50 = sma(c, 50)[i], s200 = sma(c, 200)[i];
  const hi = Math.max(...c.slice(-252));
  return { price: c[i], sma50: s50, sma200: s200, aboveSma200: c[i] > s200, sma50AboveSma200: s50 > s200, drawdownFromHigh: c[i] / hi - 1, ret1m: i >= 21 ? c[i] / c[i - 21] - 1 : null, ret3m: i >= 63 ? c[i] / c[i - 63] - 1 : null, rsi: rsi(c, 14)[i], date: r[i][0] };
}

export function classifyRegime({ indices = {}, macro = {}, breadth = null, date = null } = {}){
  const spx = indices.SPX ? indexState(indices.SPX, date) : null;
  const ndq = indices.NDQ ? indexState(indices.NDQ, date) : null;
  const rut = indices.RUT ? indexState(indices.RUT, date) : null;
  const ta = indices.TA35 ? indexState(indices.TA35, date) : null;
  const vix = lastVal(macro.VIXCLS, date);
  const vix1m = valAgo(macro.VIXCLS, date, 21);
  const dgs10 = lastVal(macro.DGS10, date), dgs2 = lastVal(macro.DGS2, date);
  const curve = isNum(dgs10) && isNum(dgs2) ? dgs10 - dgs2 : lastVal(macro.T10Y2Y, date);
  const hy = lastVal(macro.BAMLH0A0HYM2, date), hy3m = valAgo(macro.BAMLH0A0HYM2, date, 63);
  const fed = lastVal(macro.FEDFUNDS, date) ?? lastVal(macro.DFF, date);
  const cpi = macro.CPIAUCSL, cpiNow = lastVal(cpi, date), cpiYr = valAgo(cpi, date, 12);
  const inflation = isNum(cpiNow) && isNum(cpiYr) ? cpiNow / cpiYr - 1 : null;
  const usdils = lastVal(macro.USDILS, date), usdils3m = valAgo(macro.USDILS, date, 63);
  const oil = lastVal(macro.DCOILWTICO, date);
  const dgs10_3m = valAgo(macro.DGS10, date, 63);

  const rules = [];
  const add = (id, desc, passed, value, threshold, dir) => rules.push({ id, desc, passed: passed === null ? null : !!passed, value: isNum(value) ? round(value, 3) : value ?? null, threshold, dir });

  // ---- Trend (מבנה מחיר של S&P 500) ----
  add('spx_above_200', 'S&P 500 מעל ממוצע 200 יום', spx ? spx.aboveSma200 : null, spx?.price, spx?.sma200, 'bull');
  add('spx_50_over_200', 'ממוצע 50 מעל ממוצע 200 (S&P 500)', spx ? spx.sma50AboveSma200 : null, spx?.sma50, spx?.sma200, 'bull');
  add('spx_dd_lt_10', 'S&P 500 פחות מ-10% מהשיא השנתי', spx ? spx.drawdownFromHigh > -0.10 : null, spx?.drawdownFromHigh, -0.10, 'bull');
  add('spx_dd_gt_20', 'S&P 500 יותר מ-20% מתחת לשיא (שוק דובי)', spx ? spx.drawdownFromHigh <= -0.20 : null, spx?.drawdownFromHigh, -0.20, 'bear');
  add('ndq_above_200', 'Nasdaq מעל ממוצע 200 יום', ndq ? ndq.aboveSma200 : null, ndq?.price, ndq?.sma200, 'bull');
  add('rut_above_200', 'Russell 2000 מעל ממוצע 200 יום (רוחב)', rut ? rut.aboveSma200 : null, rut?.price, rut?.sma200, 'bull');
  add('breadth_gt_50', 'יותר מ-50% מנכסי ה-universe מעל ממוצע 200', isNum(breadth) ? breadth > 0.5 : null, breadth, 0.5, 'bull');

  // ---- Risk appetite ----
  add('vix_lt_20', 'VIX מתחת ל-20', isNum(vix) ? vix < 20 : null, vix, 20, 'riskon');
  add('vix_gt_30', 'VIX מעל 30 (לחץ)', isNum(vix) ? vix > 30 : null, vix, 30, 'riskoff');
  add('vix_falling', 'VIX נמוך מלפני חודש', isNum(vix) && isNum(vix1m) ? vix < vix1m : null, vix, vix1m, 'riskon');
  add('hy_lt_4', 'מרווח HY מתחת ל-4%', isNum(hy) ? hy < 4 : null, hy, 4, 'riskon');
  add('hy_widening', 'מרווח HY התרחב ב-1% ב-3 חודשים', isNum(hy) && isNum(hy3m) ? hy - hy3m > 1 : null, isNum(hy) && isNum(hy3m) ? hy - hy3m : null, 1, 'riskoff');
  add('curve_positive', 'עקום תשואות חיובי (10y−2y > 0)', isNum(curve) ? curve > 0 : null, curve, 0, 'riskon');
  add('rates_rising', 'תשואת 10 שנים עלתה >0.5% ב-3 חודשים', isNum(dgs10) && isNum(dgs10_3m) ? dgs10 - dgs10_3m > 0.5 : null, isNum(dgs10) && isNum(dgs10_3m) ? dgs10 - dgs10_3m : null, 0.5, 'riskoff');
  add('inflation_lt_4', 'אינפלציה שנתית (CPI) מתחת ל-4%', isNum(inflation) ? inflation < 0.04 : null, inflation, 0.04, 'riskon');
  add('spx_ret3m_pos', 'תשואת S&P 500 ב-3 חודשים חיובית', spx && isNum(spx.ret3m) ? spx.ret3m > 0 : null, spx?.ret3m, 0, 'riskon');

  const avail = (dir) => rules.filter((r) => r.dir === dir && r.passed !== null);
  const cnt = (dir) => avail(dir).filter((r) => r.passed).length;
  // Trend
  let trend = 'לא ידוע';
  if (spx){
    if (rules.find((r) => r.id === 'spx_dd_gt_20').passed || (!spx.aboveSma200 && !spx.sma50AboveSma200 && spx.drawdownFromHigh < -0.12)) trend = 'Bear Trend';
    else if (spx.aboveSma200 && spx.sma50AboveSma200 && spx.drawdownFromHigh > -0.10) trend = 'Bull Trend';
    else trend = 'Correction';
  }
  // Risk: ניקוד riskon פחות riskoff
  const onN = avail('riskon').length, offN = avail('riskoff').length;
  const onScore = onN ? cnt('riskon') / onN : null;
  const offScore = offN ? cnt('riskoff') / offN : null;
  let risk = 'לא ידוע', riskScore = null;
  if (onScore !== null){
    riskScore = round(onScore - (offScore ?? 0), 3);
    risk = riskScore >= 0.5 && (offScore ?? 0) < 0.34 ? 'Risk On' : riskScore <= 0.1 || (offScore ?? 0) >= 0.5 ? 'Risk Off' : 'Neutral';
  }

  // Fear & Greed מקומי (0–100): VIX (25%), מומנטום SPX מול SMA200 (25%), רוחב (20%), HY (15%), RSI SPX (15%)
  const fg = [];
  if (isNum(vix)) fg.push({ id: 'vix', w: 0.25, v: Math.max(0, Math.min(100, 100 - (vix - 10) * (100 / 30))) , desc: `VIX ${round(vix, 1)}` });
  if (spx && isNum(spx.sma200)) fg.push({ id: 'spx_vs_200', w: 0.25, v: Math.max(0, Math.min(100, 50 + (spx.price / spx.sma200 - 1) * 500)), desc: `S&P מול SMA200: ${round((spx.price / spx.sma200 - 1) * 100, 1)}%` });
  if (isNum(breadth)) fg.push({ id: 'breadth', w: 0.2, v: breadth * 100, desc: `רוחב: ${round(breadth * 100, 0)}% מעל SMA200` });
  if (isNum(hy)) fg.push({ id: 'hy', w: 0.15, v: Math.max(0, Math.min(100, 100 - (hy - 2.5) * (100 / 5))), desc: `מרווח HY ${round(hy, 2)}%` });
  if (spx && isNum(spx.rsi)) fg.push({ id: 'rsi', w: 0.15, v: spx.rsi, desc: `RSI S&P ${round(spx.rsi, 0)}` });
  const wsum = fg.reduce((s, x) => s + x.w, 0);
  const fearGreed = wsum ? { value: Math.round(fg.reduce((s, x) => s + x.v * x.w, 0) / wsum), components: fg.map((x) => ({ id: x.id, value: Math.round(x.v), weight: x.w, desc: x.desc })), label: null } : null;
  if (fearGreed) fearGreed.label = fearGreed.value < 25 ? 'פחד קיצוני' : fearGreed.value < 45 ? 'פחד' : fearGreed.value < 55 ? 'ניטרלי' : fearGreed.value < 75 ? 'חמדנות' : 'חמדנות קיצונית';

  return {
    date: date || spx?.date || null, risk, riskScore, trend, rules, fearGreed,
    inputs: {
      spx, ndq, rut, ta35: ta, vix, dgs10, dgs2, curve, hy, fedFunds: fed, inflation, usdils, usdilsChange3m: isNum(usdils) && isNum(usdils3m) ? usdils / usdils3m - 1 : null, oil,
    },
    summary: `${trend} · ${risk}` + (fearGreed ? ` · Fear&Greed ${fearGreed.value} (${fearGreed.label})` : ''),
    method: 'כללים גלויים: ראו rules[]; Fear&Greed מקומי מחושב מ-VIX/מגמה/רוחב/HY/RSI — לא מדד CNN.',
  };
}
