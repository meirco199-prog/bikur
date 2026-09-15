// הערכת שווי בכמה שיטות → טווח Fair Value ו-Margin of Safety. אף שיטה לא מחזירה "מספר מדויק".
import { isNum, round, quantile, median, clamp } from './util.js';
import { peHistory } from './fundamentals.js';

// DCF פשוט ושקוף: FCF/share, צמיחה דועכת ל-3% לאורך 10 שנים, טרמינל 3%.
export function dcf({ fcfPerShare, growth, discount, years = 10, terminal = 0.03 }){
  if (!isNum(fcfPerShare) || fcfPerShare <= 0 || !isNum(discount) || discount <= terminal) return null;
  const g0 = clamp(isNum(growth) ? growth : 0.05, -0.1, 0.2);
  let pv = 0, f = fcfPerShare;
  for (let t = 1; t <= years; t++){
    const g = g0 + (terminal - g0) * ((t - 1) / (years - 1));
    f *= 1 + g;
    pv += f / Math.pow(1 + discount, t);
  }
  const tv = (f * (1 + terminal)) / (discount - terminal);
  pv += tv / Math.pow(1 + discount, years);
  return pv;
}

// שער היוון: תשואת אג"ח 10 שנים + פרמיית סיכון 5% + התאמת בטא, חתוך 8–12%
export function discountRate({ dgs10, beta }){
  const rf = isNum(dgs10) ? dgs10 / 100 : 0.04;
  const b = isNum(beta) ? clamp(beta, 0.6, 1.8) : 1;
  return clamp(rf + 0.05 * b, 0.08, 0.12);
}

export function fairValue({ metrics, rows, facts, peers, macro, price }){
  const methods = [];
  const m = metrics || {};
  if (!m || m.missing || !isNum(price)) return { missing: true, reason: 'אין פונדמנטלס או מחיר' };

  // 1. Multiples היסטוריים — P/E 5 שנים (אחוזון 25–75) × EPS
  if (facts && rows && isNum(m.eps) && m.eps > 0){
    const hist = peHistory(facts, rows.slice(-252 * 5)).map((x) => x[1]).filter((v) => v > 0 && v < 200);
    if (hist.length >= 40){
      const lo = quantile(hist, 0.25), hi = quantile(hist, 0.75);
      methods.push({ id: 'historical_pe', label: 'P/E היסטורי (5 שנים, אחוזון 25–75)', low: lo * m.eps, high: hi * m.eps, detail: `P/E ${round(lo, 1)}–${round(hi, 1)} × EPS ${round(m.eps, 2)}`, kind: 'FACT+MODEL' });
    }
  }
  // 1b. P/S היסטורי — למניות ללא רווח
  if (rows && isNum(m.ps) && m.ps > 0 && isNum(m.revenue) && isNum(m.shares) && m.shares > 0){
    const rps = m.revenue / m.shares;
    const closes = rows.slice(-252 * 5).map((r) => r[4]);
    if (closes.length >= 252){
      // מקורב: יחס P/S היסטורי ≈ מחיר/ RPS נוכחי (ההכנסות משתנות לאט) — מסומן כקירוב
      const psHist = closes.filter((_, i) => i % 5 === 0).map((c) => c / rps);
      const lo = quantile(psHist, 0.25), hi = quantile(psHist, 0.75);
      if (!methods.length) methods.push({ id: 'historical_ps', label: 'P/S היסטורי (קירוב, 5 שנים)', low: lo * rps, high: hi * rps, detail: `P/S ${round(lo, 1)}–${round(hi, 1)} × הכנסה למניה ${round(rps, 2)}`, kind: 'MODEL' });
    }
  }
  // 2. DCF
  if (isNum(m.fcf) && m.fcf > 0 && isNum(m.shares) && m.shares > 0){
    const fps = m.fcf / m.shares;
    const g = isNum(m.fcfGrowth3y) ? m.fcfGrowth3y : (isNum(m.revenueCagr3y) ? m.revenueCagr3y : 0.05);
    const r = discountRate({ dgs10: macro?.dgs10, beta: m.beta });
    const lo = dcf({ fcfPerShare: fps, growth: Math.min(g, 0.2), discount: r + 0.01 });
    const hi = dcf({ fcfPerShare: fps, growth: Math.min(g, 0.2), discount: r - 0.01 });
    if (isNum(lo) && isNum(hi)) methods.push({ id: 'dcf', label: 'DCF (10 שנים, צמיחה דועכת ל-3%)', low: lo, high: hi, detail: `FCF/מניה ${round(fps, 2)}, צמיחה התחלתית ${round(Math.min(g, 0.2) * 100, 0)}%, היוון ${round((r - 0.01) * 100, 1)}–${round((r + 0.01) * 100, 1)}%`, kind: 'MODEL' });
  }
  // 3. Peer comparison
  if (peers && peers.length && isNum(m.eps) && m.eps > 0){
    const pes = peers.map((p) => p.pe).filter((v) => isNum(v) && v > 0 && v < 150);
    if (pes.length >= 3){
      const md = median(pes);
      methods.push({ id: 'peers', label: `P/E חציוני של ${pes.length} עמיתים ±20%`, low: md * 0.8 * m.eps, high: md * 1.2 * m.eps, detail: `P/E עמיתים ${round(md, 1)}`, kind: 'FACT+MODEL' });
    }
  }
  if (!methods.length) return { missing: true, reason: 'אין מספיק נתונים לאף שיטת הערכה (נדרש EPS/FCF חיובי או היסטוריה)', methods };
  const low = median(methods.map((x) => x.low)), high = median(methods.map((x) => x.high));
  const lo2 = Math.min(low, high), hi2 = Math.max(low, high);
  const mid = (lo2 + hi2) / 2;
  return {
    low: round(lo2, 2), high: round(hi2, 2), mid: round(mid, 2),
    marginOfSafety: round(lo2 / price - 1, 4), upsideToMid: round(mid / price - 1, 4),
    methods: methods.map((x) => ({ ...x, low: round(x.low, 2), high: round(x.high, 2) })),
    price, note: 'טווח מודל, לא תחזית. שיטות שונות = הנחות שונות.',
  };
}
