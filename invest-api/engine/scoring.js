// Investment Score 0–100. מחושב בקוד בלבד. כל רכיב מחזיר {value, weight, reasons[], missing?, quality}.
// הנוסחאות מתועדות ב-invest/docs/SIGNAL_MODEL.md — כל שינוי כאן חייב להתעדכן שם.
import { isNum, ramp, round, mean, percentileRank, hashStr, clamp, daysBetween } from './util.js';
import { peHistory } from './fundamentals.js';

export const DEFAULT_WEIGHTS = { fundamental: 12, valuation: 15, growth: 12, quality: 10, technical: 12, momentum: 10, analyst: 8, sentiment: 6, macro: 7, risk: 8 };
export const COMPONENT_LABELS = { fundamental: 'פונדמנטלי', valuation: 'הערכת שווי', growth: 'צמיחה', quality: 'איכות', technical: 'טכני', momentum: 'מומנטום', analyst: 'אנליסטים', sentiment: 'סנטימנט/חדשות', macro: 'מאקרו', risk: 'סיכון' };

export function weightsVersion(w){ return hashStr(JSON.stringify(Object.entries(w).sort())); }

const pct = (x) => (isNum(x) ? `${round(x * 100, 1)}%` : '—');
const sub = (label, x, worst, best, fmt = pct) => {
  const v = ramp(x, worst, best);
  return v === null ? null : { label, value: v, raw: x, text: `${label}: ${fmt(x)} → ${v}` };
};
function combine(subs, extra = []){
  const ok = subs.filter(Boolean);
  if (!ok.length) return null;
  const v = mean(ok.map((s) => s.value * (s.w || 1))) / mean(ok.map((s) => s.w || 1));
  return { value: Math.round(clamp(v, 0, 100)), reasons: [...ok.map((s) => s.text), ...extra], subs: ok };
}

// ---------- רכיבים ----------
export function scoreFundamental(m, profile){
  if (!m || m.missing){
    if (profile?.type === 'etf' && (isNum(profile.expense) || isNum(profile.aum))){
      return withMeta(combine([sub('Expense ratio', profile.expense, 0.01, 0.0003), sub('AUM', profile.aum, 5e7, 5e9, (x) => `$${round(x / 1e9, 2)}B`)]), 'etf');
    }
    return { missing: true, reason: m?.reason || 'אין פונדמנטלס' };
  }
  const subs = [
    sub('Net margin', m.netMargin, -0.10, 0.25), sub('FCF margin', m.fcfMargin, -0.05, 0.20),
    sub('ROE', m.roe, 0, 0.25), sub('ROIC', m.roic, 0, 0.20),
    sub('Net Debt/EBITDA', m.netDebtToEbitda, 4, -1, (x) => round(x, 2)),
    sub('Interest coverage', m.interestCoverage, 1, 10, (x) => `x${round(x, 1)}`),
  ];
  return withMeta(combine(subs), m.source);
}
function withMeta(c, source){ return c ? { ...c, source } : { missing: true, reason: 'אין תת-מדדים זמינים' }; }

export function scoreValuation(m, { fair, peHist, peers } = {}){
  if (!m || m.missing) return { missing: true, reason: 'אין פונדמנטלס' };
  const subs = [];
  if (peHist && peHist.length >= 40 && isNum(m.pe)){
    const pr = percentileRank(peHist, m.pe);
    subs.push({ label: 'P/E מול היסטוריה', value: 100 - pr, raw: pr, text: `P/E ${round(m.pe, 1)} באחוזון ${pr} של 5 שנים → ${100 - pr}` });
  }
  if (peers && peers.length >= 3 && isNum(m.pe)){
    const pes = peers.map((p) => p.pe).filter((v) => isNum(v) && v > 0 && v < 150);
    if (pes.length >= 3){ const md = mean(pes); subs.push(sub('P/E מול עמיתים', m.pe / md - 1, 0.5, -0.4)); }
  }
  if (m.peNegative) subs.push({ label: 'P/E', value: 20, raw: null, text: 'רווח שלילי — P/E לא מוגדר → 20' });
  subs.push(sub('EV/EBITDA', m.evEbitda, 25, 6, (x) => round(x, 1)));
  subs.push(sub('P/S', m.ps, 15, 1, (x) => round(x, 1)));
  subs.push(sub('PEG', m.peg, 3, 0.8, (x) => round(x, 2)));
  subs.push(sub('FCF yield', m.fcfYield, 0, 0.08));
  if (fair && !fair.missing) subs.push({ ...sub('Margin of Safety', fair.marginOfSafety, -0.3, 0.3), w: 2 });
  return withMeta(combine(subs, fair && !fair.missing ? [`Fair Value ${fair.low}–${fair.high} מול מחיר ${fair.price}`] : []), m.source);
}

export function scoreGrowth(m, est){
  if (!m || m.missing) return { missing: true, reason: 'אין פונדמנטלס' };
  const subs = [
    sub('צמיחת הכנסות YoY', m.revenueGrowth, -0.10, 0.30), sub('CAGR הכנסות 3 שנים', m.revenueCagr3y, 0, 0.25),
    sub('צמיחת EPS YoY', m.epsGrowth, -0.20, 0.40), sub('צמיחת FCF 3 שנים', m.fcfGrowth3y, -0.10, 0.30),
  ];
  const extra = [];
  if (est && isNum(est.eps?.fy1) && isNum(est.eps?.fy2) && est.eps.fy1 > 0){
    const s = sub('תחזית EPS (FY2/FY1) [ESTIMATE]', est.eps.fy2 / est.eps.fy1 - 1, -0.10, 0.25);
    if (s) subs.push(s);
  }
  const c = combine(subs, extra);
  if (!c) return { missing: true, reason: 'אין נתוני צמיחה' };
  if (isNum(m.revenueDeclines5y) && m.revenueDeclines5y >= 2){ c.value = Math.max(0, c.value - 15); c.reasons.push(`קנס עקביות: ${m.revenueDeclines5y} שנות ירידה בהכנסות מתוך 4 → −15`); }
  return withMeta(c, m.source);
}

export function scoreQuality(m){
  if (!m || m.missing) return { missing: true, reason: 'אין פונדמנטלס' };
  const subs = [
    sub('ROIC ממוצע 3 שנים', m.roicAvg3y ?? m.roic, 0, 0.20), sub('המרת רווח למזומן (FCF/NI)', m.cashConversion, 0.3, 1.2, (x) => round(x, 2)),
    sub('יציבות מרווח גולמי (σ 5 שנים)', m.grossMarginStd5y, 0.08, 0.01), sub('Net Debt/Equity', m.netDebtToEquity, 1.5, 0, (x) => round(x, 2)),
    sub('דילול מניות (3 שנים)', m.dilution3y, 0.05, -0.02),
  ];
  if (isNum(m.dividendGrowth5y)) subs.push({ ...sub('צמיחת דיבידנד 5 שנים', m.dividendGrowth5y, 0, 0.10), w: 0.5 });
  return withMeta(combine(subs), m.source);
}

export function scoreTechnical(t){
  if (!t || t.missing) return { missing: true, reason: t?.reason || 'אין נתוני מחיר' };
  if (!isNum(t.sma.s200)) return { missing: true, reason: 'פחות מ-200 ימי מסחר' };
  const subs = [
    { label: 'מגמה (מיקום מול SMA50/100/200 + 50>200)', value: t.trendScore, text: `מגמה ${t.trend}: ${t.trendScore}/100` },
    sub('מרחק משיא 52 שבועות', t.distFromHigh52, -0.40, -0.03),
    { label: 'Bollinger %B', value: t.bb.pctB < 0 ? 40 : t.bb.pctB > 1 ? 45 : t.bb.pctB >= 0.2 && t.bb.pctB <= 0.8 ? 70 : 60, text: `Bollinger %B ${round(t.bb.pctB, 2)}` },
    sub('ATR% (תנודתיות יומית)', t.atrPct, 0.06, 0.015),
  ];
  const c = combine(subs);
  if (t.breakout){ c.value = Math.min(100, c.value + 15); c.reasons.push('פריצה מעל התנגדות 20 ימים במחזור גבוה → +15'); }
  c.events = t.events;
  c.reasons.push(...t.events.map((e) => `אירוע: ${e.label}`));
  return { ...c, source: 'prices' };
}

export function scoreMomentum(t){
  if (!t || t.missing) return { missing: true, reason: 'אין נתוני מחיר' };
  const m = t.momentum;
  const subs = [
    sub('מומנטום 12−1 חודשים', m.r12_1, -0.30, 0.60), sub('תשואה 6 חודשים', m.r6m, -0.25, 0.40), sub('תשואה 3 חודשים', m.r3m, -0.15, 0.25),
    isNum(m.r1m) ? { ...sub('תשואה חודש', m.r1m, -0.12, 0.15), w: 0.5 } : null,
    isNum(m.r6m) && isNum(t.vol6m) && t.vol6m > 0 ? sub('תשואה 6 חודשים מותאמת סיכון', m.r6m / t.vol6m, -1, 2, (x) => round(x, 2)) : null,
  ];
  if (isNum(t.rsi)){
    const r = t.rsi;
    const v = r >= 45 && r <= 65 ? 80 : r >= 30 && r < 45 ? 55 : r > 65 && r <= 75 ? 60 : r > 75 ? 35 : 40;
    subs.push({ label: 'RSI', value: v, text: `RSI ${round(r, 0)} → ${v}` });
  }
  const c = combine(subs);
  if (!c) return { missing: true, reason: 'אין מספיק היסטוריה למומנטום' };
  if (isNum(t.macd.hist) && t.macd.hist > 0 && t.events.some((e) => e.id === 'momentum_accel')){ c.value = Math.min(100, c.value + 10); c.reasons.push('MACD histogram חיובי ועולה → +10'); }
  return { ...c, source: 'prices' };
}

export function scoreAnalyst(a){
  if (!a || a.missing || !isNum(a.total) || a.total === 0) return { missing: true, reason: 'אין קונצנזוס אנליסטים' };
  const n = a.total;
  const avg = (5 * (a.strongBuy || 0) + 4 * (a.buy || 0) + 3 * (a.hold || 0) + 2 * (a.sell || 0) + 1 * (a.strongSell || 0)) / n;
  const subs = [sub('קונצנזוס (1=Strong Sell … 5=Strong Buy)', avg, 2, 4.5, (x) => round(x, 2))];
  if (a.targets && isNum(a.targets.median) && isNum(a.price) && a.price > 0) subs.push(sub('Upside ליעד חציוני', a.targets.median / a.price - 1, -0.20, 0.40));
  else if (a.targets && isNum(a.targets.avg) && isNum(a.price) && a.price > 0) subs.push(sub('Upside ליעד ממוצע', a.targets.avg / a.price - 1, -0.20, 0.40));
  const c = combine(subs, [`${n} אנליסטים: ${a.strongBuy || 0} SB / ${a.buy || 0} B / ${a.hold || 0} H / ${a.sell || 0} S / ${a.strongSell || 0} SS [ANALYST OPINION]`]);
  if (n < 5){ c.value = Math.round(c.value * 0.6); c.reasons.push(`מדגם קטן (${n} אנליסטים) → ×0.6`); }
  if (isNum(a.trendDelta)){ const d = clamp(a.trendDelta * 5, -10, 10); c.value = clamp(c.value + d, 0, 100); c.reasons.push(`שינוי בחודש האחרון ב-Buy+StrongBuy: ${a.trendDelta > 0 ? '+' : ''}${a.trendDelta} → ${round(d, 0)}`); }
  return { ...c, source: a.source, kind: 'ANALYST OPINION' };
}

export function scoreSentiment(s){
  if (!s || s.missing) return { missing: true, reason: s?.reason || 'אין חדשות' };
  return { value: s.value, reasons: s.reasons, source: 'news', count: s.count };
}

export function scoreMacro(regime, profile, t){
  if (!regime || regime.risk === 'לא ידוע') return { missing: true, reason: 'אין סיווג משטר' };
  const beta = isNum(profile?.beta) ? profile.beta : (isNum(t?.beta) ? t.beta : 1);
  const sector = (profile?.sector || '').toLowerCase();
  const defensive = /utilit|staple|health|consumer defensive/.test(sector) || /treasury|bond|gold/.test((profile?.name || '').toLowerCase()) || profile?.assetClass === 'bond' || profile?.assetClass === 'gold';
  const longBond = profile?.assetClass === 'bond' && /long|20\+|tlt/i.test(profile?.name || profile?.symbol || '');
  let v, why;
  if (regime.risk === 'Risk On'){ v = beta > 1 && !defensive ? 75 : defensive ? 55 : longBond ? 45 : 65; why = `Risk On: ${beta > 1 ? 'בטא גבוהה נהנית' : defensive ? 'הגנתי פחות מועדף' : 'ניטרלי'}`; }
  else if (regime.risk === 'Risk Off'){ v = defensive ? 75 : beta > 1.3 ? 30 : 45; why = `Risk Off: ${defensive ? 'הגנתי מועדף' : beta > 1.3 ? 'בטא גבוהה נפגעת' : 'ניטרלי-שלילי'}`; }
  else { v = 58; why = 'Neutral: אין הטיה'; }
  const reasons = [`${regime.summary}`, why];
  if (isNum(regime.inputs?.curve) && regime.inputs.curve < 0 && /bank|financial|small/.test(sector + ' ' + (profile?.name || '').toLowerCase())){ v -= 10; reasons.push('עקום תשואות הפוך: בנקים/small caps −10'); }
  if (isNum(regime.inputs?.usdilsChange3m) && regime.inputs.usdilsChange3m < -0.05 && (profile?.currency || 'USD') === 'USD'){ v -= 5; reasons.push('השקל התחזק >5% ב-3 חודשים: נכס דולרי −5 למשקיע שקלי'); }
  return { value: clamp(Math.round(v), 0, 100), reasons, source: 'regime' };
}

export function scoreRisk(t, m, { earningsInDays, currency = 'USD', baseCurrency = 'ILS', avgDollarVolume, beta, gapRate } = {}){
  if (!t || t.missing) return { missing: true, reason: 'אין נתוני מחיר' };
  const subs = [
    sub('תנודתיות שנתית', t.vol1y, 0.60, 0.15), sub('Max drawdown שנה', t.maxDrawdown1y, -0.60, -0.10),
    isNum(beta) ? sub('בטא', beta, 2, 0.7, (x) => round(x, 2)) : null,
    isNum(avgDollarVolume) ? sub('נזילות (מחזור $ יומי)', avgDollarVolume, 2e6, 5e7, (x) => `$${round(x / 1e6, 1)}M`) : null,
    isNum(gapRate) ? sub('Gap risk (ימים עם |gap|>5%)', gapRate, 0.05, 0) : null,
  ];
  const c = combine(subs);
  if (!c) return { missing: true, reason: 'אין מדדי סיכון' };
  if (isNum(earningsInDays) && earningsInDays >= 0 && earningsInDays <= 7){ c.value = Math.max(0, c.value - 15); c.reasons.push(`דוח רבעוני בעוד ${earningsInDays} ימים → −15 (Earnings risk)`); }
  if (m && !m.missing && ((isNum(m.netDebtToEbitda) && m.netDebtToEbitda > 4) || (isNum(m.fcf) && m.fcf < 0 && m.history?.fcf?.length >= 2 && m.history.fcf.slice(-2).every((x) => x[1] < 0)))){ c.value = Math.max(0, c.value - 15); c.reasons.push('מינוף גבוה (Net Debt/EBITDA>4) או FCF שלילי שנתיים → −15'); }
  if (currency !== baseCurrency){ c.value = Math.max(0, c.value - 5); c.reasons.push(`סיכון מטבע: הנכס ב-${currency}, התיק ב-${baseCurrency} → −5`); }
  return { ...c, source: 'prices+fundamentals' };
}

// ---------- ציון כולל ----------
export function computeScore(inputs, weights = DEFAULT_WEIGHTS){
  const { metrics, technical, fair, peHist, peers, estimates, analyst, sentiment, regime, profile, riskExtras, quality = {} } = inputs;
  const comps = {
    fundamental: scoreFundamental(metrics, profile), valuation: scoreValuation(metrics, { fair, peHist, peers }), growth: scoreGrowth(metrics, estimates),
    quality: scoreQuality(metrics), technical: scoreTechnical(technical), momentum: scoreMomentum(technical), analyst: scoreAnalyst(analyst),
    sentiment: scoreSentiment(sentiment), macro: scoreMacro(regime, profile, technical), risk: scoreRisk(technical, metrics, riskExtras || {}),
  };
  let wsum = 0, total = 0, qsum = 0;
  const out = {};
  for (const [k, w] of Object.entries(weights)){
    const c = comps[k];
    if (!c) continue;
    const q = c.missing ? 0 : (quality[k] ?? 0.8);
    out[k] = { ...c, weight: w, quality: q, label: COMPONENT_LABELS[k] };
    if (!c.missing){ wsum += w; total += c.value * w; qsum += q * w; }
  }
  const W = Object.values(weights).reduce((s, x) => s + x, 0) || 100;
  const coverage = round(wsum / W, 3);
  const dataQuality = wsum ? round(qsum / wsum, 3) : 0;
  const confidence = round(coverage * dataQuality, 3);
  return {
    total: wsum ? Math.round(total / wsum) : null, coverage, dataQuality, confidence,
    confidenceLabel: confidence < 0.5 ? 'נמוך' : confidence < 0.75 ? 'בינוני' : 'גבוה',
    components: out, weightsVersion: weightsVersion(weights), weights,
    missing: Object.entries(out).filter(([, c]) => c.missing).map(([k, c]) => ({ component: k, label: COMPONENT_LABELS[k], reason: c.reason })),
  };
}
