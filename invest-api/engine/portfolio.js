// Portfolio Builder: 4 פרופילים, אילוצים גלויים, בחירה עם קנס קורלציה, משקלים לפי inverse-vol × ציון.
import { isNum, round, mean, correlation } from './util.js';
import { alignedReturns, portfolioRisk } from './risk.js';

export const PROFILES = {
  conservative: { label: 'שמרני', sleeves: { coreEquity: 0.25, stocks: 0.10, bonds: 0.45, gold: 0.10, cash: 0.10 }, maxPosition: 0.08, maxEtfPosition: 0.35, maxSector: 0.25, maxStocks: 4, minScore: 60, maxVol: 0.30 },
  balanced: { label: 'מאוזן', sleeves: { coreEquity: 0.35, stocks: 0.25, bonds: 0.30, gold: 0.05, cash: 0.05 }, maxPosition: 0.10, maxEtfPosition: 0.35, maxSector: 0.30, maxStocks: 6, minScore: 60, maxVol: 0.45 },
  growth: { label: 'צמיחה', sleeves: { coreEquity: 0.35, stocks: 0.45, bonds: 0.12, gold: 0.03, cash: 0.05 }, maxPosition: 0.12, maxEtfPosition: 0.30, maxSector: 0.35, maxStocks: 8, minScore: 58, maxVol: 0.60 },
  aggressive: { label: 'אגרסיבי', sleeves: { coreEquity: 0.25, stocks: 0.70, bonds: 0, gold: 0, cash: 0.05 }, maxPosition: 0.15, maxEtfPosition: 0.25, maxSector: 0.40, maxStocks: 10, minScore: 55, maxVol: 0.80 },
};

// בחירה חמדנית עם קנס קורלציה: ציון − λ·קורלציה ממוצעת לנבחרים, אילוצי ענף ומספר
export function selectDiversified(cands, { max, maxSector, lambda = 25, returnsMap }){
  const picked = [];
  const sectorW = {};
  const pool = cands.slice().sort((a, b) => b.score - a.score);
  while (picked.length < max && pool.length){
    let best = null, bestAdj = -Infinity;
    for (const c of pool){
      const corrs = picked.map((p) => (returnsMap?.[c.symbol] && returnsMap?.[p.symbol] ? correlation(returnsMap[c.symbol], returnsMap[p.symbol]) : null)).filter(isNum);
      const avgC = corrs.length ? mean(corrs) : 0;
      const adj = c.score - lambda * Math.max(0, avgC);
      if (adj > bestAdj){ bestAdj = adj; best = { c, avgC }; }
    }
    if (!best) break;
    pool.splice(pool.indexOf(best.c), 1);
    const sec = best.c.sector || 'אחר';
    if ((sectorW[sec] || 0) + 1 > Math.max(1, Math.floor(max * maxSector * 2))) continue; // הגבלת מספר לענף
    sectorW[sec] = (sectorW[sec] || 0) + 1;
    picked.push({ ...best.c, avgCorrToPicked: round(best.avgC, 2) });
  }
  return picked;
}

// משקלים בתוך sleeve: inverse-vol × (0.5 + score/100), חתוך ל-maxPosition ומנורמל
function sleeveWeights(items, budget, maxPos){
  if (!items.length || budget <= 0) return { items: [], leftover: budget > 0 && !items.length ? budget : 0 };
  const raw = items.map((it) => ((isNum(it.vol) && it.vol > 0 ? 1 / it.vol : 1 / 0.25) * (0.5 + (it.score || 60) / 100)));
  let w = raw.map((r) => (r / raw.reduce((s, x) => s + x, 0)) * budget);
  // חיתוך איטרטיבי ל-maxPos
  for (let k = 0; k < 5; k++){
    const over = w.map((x) => Math.max(0, x - maxPos));
    const excess = over.reduce((s, x) => s + x, 0);
    if (excess < 1e-6) break;
    w = w.map((x) => Math.min(x, maxPos));
    const free = w.map((x, i) => (x < maxPos ? raw[i] : 0));
    const fsum = free.reduce((s, x) => s + x, 0);
    if (!fsum) break;
    w = w.map((x, i) => x + (free[i] / fsum) * excess);
  }
  const placed = w.reduce((s, x) => s + x, 0);
  return { items: items.map((it, i) => ({ ...it, weight: w[i] })), leftover: Math.max(0, budget - placed) };
}

/**
 * candidates: [{symbol, name, score, signal, type:'stock'|'etf', assetClass:'equity'|'bond'|'gold'|'cash', role:'core'|'satellite'|'bond'|'gold',
 *   sector, country, currency, vol, maxDD, beta, pe, techBeta}]
 * seriesMap: {sym: rows}  (לקורלציה ולסיכון)
 */
export function buildPortfolios({ candidates, seriesMap = {}, sizeIls = 200000, usdils = null, benchRows = null, profiles = PROFILES, constraintsOverride = {} }){
  const aligned = alignedReturns(Object.fromEntries(candidates.filter((c) => seriesMap[c.symbol]).map((c) => [c.symbol, seriesMap[c.symbol]])), 252);
  const R = aligned.returns;
  const out = {};
  for (const [id, prof0] of Object.entries(profiles)){
    const prof = { ...prof0, ...(constraintsOverride[id] || {}) };
    const eligible = candidates.filter((c) => !c.avoid && (!isNum(c.vol) || c.vol <= prof.maxVol));
    const core = eligible.filter((c) => c.role === 'core' && c.assetClass === 'equity').sort((a, b) => b.score - a.score).slice(0, 3);
    const stocks = selectDiversified(eligible.filter((c) => c.role === 'satellite' && c.assetClass === 'equity' && c.score >= prof.minScore && ['STRONG BUY', 'BUY', 'WATCH'].includes(c.signal)), { max: prof.maxStocks, maxSector: prof.maxSector, returnsMap: R });
    const bonds = eligible.filter((c) => c.assetClass === 'bond').sort((a, b) => b.score - a.score).slice(0, 2);
    const gold = eligible.filter((c) => c.assetClass === 'gold').slice(0, 1);
    const s = prof.sleeves;
    // sleeve ריק → תקציבו עובר למזומן (שקוף)
    let cash = s.cash;
    const parts = [];
    // max position: למניה בודדת prof.maxPosition; ל-ETF רחב/אג"ח/זהב (מפוזרים מטבעם) prof.maxEtfPosition
    const push = (items, budget, cap) => { if (!items.length){ cash += budget; return; } const r = sleeveWeights(items, budget, cap); parts.push(...r.items); cash += r.leftover; };
    push(core, s.coreEquity, prof.maxEtfPosition); push(stocks, s.stocks, prof.maxPosition); push(bonds, s.bonds, prof.maxEtfPosition); push(gold, s.gold, prof.maxEtfPosition);
    // אילוץ ענף על משקל: אם ענף חורג — מקטינים פרופורציונלית ומעבירים למזומן
    const secW = {};
    for (const p of parts) if (p.assetClass === 'equity' && p.role === 'satellite') secW[p.sector || 'אחר'] = (secW[p.sector || 'אחר'] || 0) + p.weight;
    for (const [sec, w] of Object.entries(secW)) if (w > prof.maxSector){ const f = prof.maxSector / w; for (const p of parts) if (p.role === 'satellite' && (p.sector || 'אחר') === sec){ cash += p.weight * (1 - f); p.weight *= f; } }
    const positions = parts.map((p) => ({
      symbol: p.symbol, name: p.name, type: p.type, assetClass: p.assetClass, role: p.role, sector: p.sector || (p.assetClass === 'equity' ? 'רב-ענפי' : p.assetClass), country: p.country || 'US', currency: p.currency || 'USD',
      weight: round(p.weight, 4), ils: Math.round(p.weight * sizeIls), usd: usdils ? Math.round((p.weight * sizeIls) / usdils) : null,
      score: p.score, signal: p.signal, vol: p.vol, maxDD: p.maxDD, beta: p.beta, pe: p.pe, techBeta: p.techBeta, avgCorrToPicked: p.avgCorrToPicked ?? null, why: p.why || null,
    }));
    positions.push({ symbol: 'CASH', name: 'מזומן / פק"מ שקלי', type: 'cash', assetClass: 'cash', role: 'cash', sector: 'מזומן', country: 'IL', currency: 'ILS', weight: round(cash, 4), ils: Math.round(cash * sizeIls), usd: null });
    const weights = Object.fromEntries(positions.filter((p) => p.symbol !== 'CASH').map((p) => [p.symbol, p.weight]));
    const meta = Object.fromEntries(positions.map((p) => [p.symbol, { sector: p.sector, country: p.country, currency: p.currency, assetClass: p.assetClass }]));
    const risk = portfolioRisk({ weights, seriesMap, meta, benchRows });
    // הוספת מזומן לחשיפות (0 תנודתיות)
    const exposure = { sector: {}, geo: {}, currency: {}, assetClass: {} };
    for (const p of positions){ exposure.sector[p.sector] = round((exposure.sector[p.sector] || 0) + p.weight, 4); exposure.geo[p.country] = round((exposure.geo[p.country] || 0) + p.weight, 4); exposure.currency[p.currency] = round((exposure.currency[p.currency] || 0) + p.weight, 4); exposure.assetClass[p.assetClass] = round((exposure.assetClass[p.assetClass] || 0) + p.weight, 4); }
    const investedShare = 1 - cash;
    out[id] = {
      id, label: prof.label, sizeIls, positions, exposure,
      risk: risk.missing ? risk : { ...risk, volatility: round(risk.volatility * investedShare, 4), maxDrawdown: round(risk.maxDrawdown * investedShare, 4), beta: round((risk.beta || 0) * investedShare, 2), note: 'מדדי הסיכון מוכפלים בחלק המושקע (מזומן = 0)' },
      constraints: { maxPosition: prof.maxPosition, maxEtfPosition: prof.maxEtfPosition, maxSector: prof.maxSector, maxStocks: prof.maxStocks, minScore: prof.minScore, maxVol: prof.maxVol, sleeves: s },
      method: 'ליבה: ETF רחבים לפי ציון; לוויין: בחירה חמדנית ציון−25×קורלציה; משקל = inverse-vol × (0.5+ציון/100), חתוך ל-max position; ענף חורג → מזומן.',
    };
  }
  return { sizeIls, usdils, profiles: out, kind: 'MODEL RECOMMENDATION', note: 'לא ייעוץ השקעות. אילוצים ומתודולוגיה גלויים; שנה משקלים בהגדרות.' };
}
