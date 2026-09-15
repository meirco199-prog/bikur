// מציון לסיגנל, עם רמות (entry/invalidation/stop/target), R/R ואופק. כל תנאי מוסבר ב-why.
import { isNum, round, clamp } from './util.js';

export const SIGNALS = ['STRONG BUY', 'BUY', 'WATCH', 'HOLD', 'REDUCE', 'SELL', 'NO SIGNAL'];
const ORDER = { 'STRONG BUY': 0, BUY: 1, WATCH: 2, HOLD: 3, REDUCE: 4, SELL: 5 };
const downgrade = (s) => (s in ORDER && ORDER[s] < 5 ? Object.keys(ORDER)[ORDER[s] + 1] : s);

export function levels({ technical: t, fair, isEtf, price }){
  if (!t || t.missing || !isNum(price)) return null;
  const s20 = t.sma.s20, s50 = t.sma.s50, s200 = t.sma.s200, atr = t.atr;
  const sup = t.supports?.[0]?.level, sup2 = t.supports?.[1]?.level, res = t.resistances?.[0]?.level;
  const oversold = isNum(t.rsi) && t.rsi < 30;
  let entryLow, entryHigh;
  if (oversold){ entryLow = isNum(t.low52) ? Math.max(t.low52, price * 0.9) : price * 0.93; entryHigh = isNum(s20) ? s20 : price * 1.02; }
  else {
    entryLow = Math.max(isNum(sup) ? sup : price * 0.93, isNum(s50) ? s50 * 0.98 : price * 0.95);
    entryHigh = Math.min(price * 1.02, isNum(s20) ? s20 * 1.03 : price * 1.02);
  }
  if (entryLow > entryHigh) [entryLow, entryHigh] = [entryHigh, entryLow];
  const invalidation = Math.min(isNum(sup2) ? sup2 : (isNum(sup) ? sup * 0.97 : price * 0.85), isNum(s200) ? s200 * 0.97 : price * 0.85);
  const stop = isNum(atr) ? Math.max(invalidation, price - 2.5 * atr) : invalidation;
  let targetLow, targetHigh, targetBasis;
  if (!isEtf && fair && !fair.missing && fair.high > price){
    targetLow = Math.min(fair.low > price ? fair.low : fair.mid, isNum(res) ? res : Infinity, isNum(t.high52) && t.high52 > price ? t.high52 : Infinity);
    if (!isFinite(targetLow) || targetLow <= price) targetLow = Math.max(price * 1.05, fair.mid);
    targetHigh = Math.max(fair.high, targetLow); targetBasis = 'Fair Value + התנגדות/שיא 52 שבועות';
  } else {
    const mom = isNum(t.momentum?.r12m) ? clamp(t.momentum.r12m * 0.5, -0.1, 0.4) : 0.08;
    targetLow = Math.max(price * (1 + mom) - (atr || 0), price * 1.03); targetHigh = price * (1 + mom) + (atr || 0) * 2; targetBasis = isEtf ? 'המשך מומנטום 12 חודשים ×0.5 ± ATR (ETF)' : 'מומנטום ± ATR (אין Fair Value)';
    if (targetHigh <= targetLow) targetHigh = targetLow * 1.05;
  }
  const mid = (targetLow + targetHigh) / 2;
  const upside = mid / price - 1, downside = stop / price - 1;
  return {
    entryZone: [round(entryLow, 2), round(entryHigh, 2)], inEntryZone: price >= entryLow && price <= entryHigh, aboveEntry: price > entryHigh,
    invalidation: round(invalidation, 2), stop: round(stop, 2), trailingStop: isNum(atr) ? round(3 * atr, 2) : null,
    targets: [round(targetLow, 2), round(targetHigh, 2)], targetBasis,
    upside: round(upside, 4), downside: round(downside, 4), rr: downside < 0 ? round(upside / Math.abs(downside), 2) : null,
  };
}

export function deriveSignal({ score, technical: t, fair, regime, profile, price, earningsInDays, minBars = 200 }){
  const why = [], risks = [], changeIf = [], contradict = [];
  const isEtf = profile?.type === 'etf' || profile?.type === 'index' || profile?.type === 'fund';
  const c = score?.components || {};
  const val = (k) => (c[k] && !c[k].missing ? c[k].value : null);
  const lv = levels({ technical: t, fair, isEtf, price });

  // NO SIGNAL
  const noSignal = (reason) => ({ label: 'NO SIGNAL', noSignalReason: reason, why: [reason], risks, changeIf: ['השלמת נתונים חסרים: ' + (score?.missing || []).map((m) => m.label).join(', ')], contradict, levels: lv, confidence: score?.confidence ?? 0, confidenceLabel: score?.confidenceLabel, horizon: null, price });
  if (!t || t.missing || !isNum(t.sma?.s200) || (t.bars || 0) < minBars) return noSignal(`אין 200 ימי מסחר (יש ${t?.bars || 0})`);
  if (!score || score.total === null || score.coverage < 0.5) return noSignal(`כיסוי נתונים ${Math.round((score?.coverage || 0) * 100)}% < 50%`);
  if (score.confidence < 0.35) return noSignal(`ביטחון ${score.confidence} < 0.35`);

  const s = score.total, conf = score.confidence, tech = val('technical'), risk = val('risk'), mom = val('momentum'), fund = val('fundamental');
  const mos = fair && !fair.missing ? fair.marginOfSafety : null;
  const oversold = t.events.some((e) => e.id === 'oversold');
  const deathCross = t.events.some((e) => e.id === 'death_cross');
  const bearRiskOff = regime && regime.risk === 'Risk Off' && regime.trend === 'Bear Trend';
  const belowInvalidation = lv && price < lv.invalidation;

  let label;
  const cond = (ok, text) => { (ok ? why : changeIf).push(text); return ok; };
  if (s < 30 || (belowInvalidation && isNum(mom) && mom < 35)){ label = 'SELL'; why.push(s < 30 ? `ציון ${s} < 30` : `מחיר ${price} מתחת לרמת ביטול ${lv.invalidation} ומומנטום ${mom} < 35`); }
  else if (s < 40 || (isNum(risk) && risk < 25 && isNum(tech) && tech < 40) || (deathCross && isNum(mom) && mom < 40)){ label = 'REDUCE'; why.push(s < 40 ? `ציון ${s} < 40` : deathCross ? `Death Cross טרי ומומנטום ${mom} < 40` : `סיכון ${risk} < 25 וטכני ${tech} < 40`); }
  else {
    const sb = [cond(s >= 75, `ציון ${s} ≥ 75`), cond(conf >= 0.6, `ביטחון ${conf} ≥ 0.6`), cond(isNum(tech) && tech >= 55, `טכני ${tech} ≥ 55`), cond(isNum(risk) && risk >= 40, `סיכון ${risk} ≥ 40`),
      cond(isEtf ? isNum(mom) && mom >= 60 : isNum(mos) && mos >= 0.10, isEtf ? `מומנטום ${mom} ≥ 60 (ETF)` : `Margin of Safety ${isNum(mos) ? round(mos * 100, 0) + '%' : '—'} ≥ 10%`), cond(!bearRiskOff, 'המשטר אינו Bear+RiskOff')].every(Boolean);
    if (sb) label = 'STRONG BUY';
    else {
      why.length = 0; changeIf.length = 0;
      const b = [cond(s >= 65, `ציון ${s} ≥ 65`), cond(conf >= 0.5, `ביטחון ${conf} ≥ 0.5`), cond(isNum(tech) && tech >= 45, `טכני ${tech} ≥ 45`), cond(isNum(risk) && risk >= 30, `סיכון ${risk} ≥ 30`)].every(Boolean);
      if (b){ label = 'BUY'; changeIf.unshift(`ל-STRONG BUY: ציון ≥ 75 (כעת ${s}), ביטחון ≥ 0.6, MoS ≥ 10%`); }
      else if (s >= 55 || (s >= 50 && oversold && isNum(fund) && fund >= 60)){ label = 'WATCH'; why.length = 0; why.push(s >= 55 ? `ציון ${s} ≥ 55 אך לא כל תנאי BUY מתקיימים` : `ציון ${s}, oversold ופונדמנטלי ${fund} ≥ 60`); }
      else { label = 'HOLD'; why.length = 0; why.push(`ציון ${s} בטווח 40–55`); changeIf.length = 0; changeIf.push(`ל-WATCH: ציון ≥ 55; ל-REDUCE: ציון < 40`); }
    }
  }
  // R/R
  if (lv && isNum(lv.rr) && lv.rr < 1.5 && (label === 'STRONG BUY' || label === 'BUY')){ const old = label; label = downgrade(label); why.push(`R/R ${lv.rr} < 1.5 → ירידה מ-${old} ל-${label}`); }

  // 5 בעד / 5 סיכונים מתוך תת-המדדים
  const allSubs = Object.entries(c).filter(([, v]) => !v.missing).flatMap(([k, v]) => (v.subs || [{ label: v.label, value: v.value, text: v.reasons?.[0] || v.label }]).map((x) => ({ ...x, comp: v.label })));
  const top = allSubs.slice().sort((a, b) => b.value - a.value).slice(0, 5).map((x) => `${x.comp}: ${x.text}`);
  const bottom = allSubs.slice().sort((a, b) => a.value - b.value).slice(0, 5).map((x) => `${x.comp}: ${x.text}`);
  risks.push(...bottom, ...t.events.filter((e) => e.tone === 'neg').map((e) => `אירוע טכני: ${e.label}`));
  if (isNum(earningsInDays) && earningsInDays >= 0 && earningsInDays <= 14) risks.push(`דוח רבעוני בעוד ${earningsInDays} ימים — סיכון gap`);
  contradict.push(...(score.missing || []).map((m) => `חסר: ${m.label} (${m.reason})`));
  for (const [k, v] of Object.entries(c)){
    if (v.missing) continue;
    if (v.kind === 'ANALYST OPINION') contradict.push('רכיב האנליסטים הוא דעה, לא עובדה');
    if (v.quality < 0.6) contradict.push(`${v.label}: איכות נתונים נמוכה (${v.quality})`);
  }
  if (fair && !fair.missing) contradict.push(`Fair Value תלוי בהנחות המודל (${fair.methods.map((m) => m.label).join('; ')})`);

  // אופק
  const valDominant = isNum(val('valuation')) && val('valuation') >= (mom ?? 0);
  const horizon = isEtf ? '12+ חודשים' : (label === 'STRONG BUY' || label === 'BUY') ? (valDominant ? '6–18 חודשים' : '1–4 חודשים') : label === 'WATCH' ? 'המתנה לאישור' : '—';
  return {
    label, score: s, confidence: conf, confidenceLabel: score.confidenceLabel, price, levels: lv, horizon,
    why, top5: top, risks: risks.slice(0, 7), changeIf, contradict,
    entryNote: lv ? (lv.inEntryZone ? 'המחיר באזור הכניסה' : lv.aboveEntry ? 'המחיר מעל אזור הכניסה — עדיף להמתין לחזרה' : 'המחיר מתחת לאזור הכניסה — בדוק אם התמיכה נשברה') : null,
    kind: 'MODEL SIGNAL',
  };
}
