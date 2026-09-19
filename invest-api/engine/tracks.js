// מסלולי השוואה (תיקי צל) — פונקציות טהורות. שלושה מסלולים חדשים לצד חשבון התרגול המאוזן והמסלול האגרסיבי הקיים:
//   regB  = רגיל B: 60% VTI, 20% מניות נבחרות, 10% אג"ח, 5% זהב, 5% מזומן (80% מניות) — אותו מנוע החלטה כמו החשבון המאוזן, מצב נפרד.
//   regC  = רגיל C: 40% VTI, 40% מניות נבחרות, 10% אג"ח, 5% זהב, 5% מזומן — תקציב מניות כפול, עם מגבלות סיכון משלו (TRACK_LIMITS_C),
//           לא עוקף את RISK_LIMITS של חשבון התרגול ולא חולק איתו מצב.
//   aggrB = אגרסיבי B: חשיפה מנייתית 70%–95% לפי מצב השוק ואיכות האותות (מודל DF המסונן); SPY 20%–70% משלים כשאין מספיק אותות
//           איכותיים; בשוק דובי / בריחה מסיכון / תקלת נתונים אין השלמה — הרצפה היא יעד, לא כפייה. בלי מינוף, שורטים או אופציות.
// כל המסלולים: 200,000 ₪, אותם נתוני שוק (דירוג הלילה), אותה נקודת ביצוע (09:40 ניו יורק למחרת), אותם עמלות/החלקה/שער.
// שום מסלול לא שולח פקודות לברוקר ולא נוגע בחשבון התרגול.
import { isNum, round } from './util.js';
import { decideOrders, AUTO_RULES } from './autopilot.js';
import { decideAggressive, applyFills, markToMarket, AGGR_RULES } from './aggressive.js';
import { RISK_LIMITS } from './risk-limits.js';
import { commissionIls } from '../lib/broker.js';
import { isExpectedFillDay } from './session.js';

export const TRACKS_VERSION = 1;
export const INITIAL_ILS = 200000;
export const FILL_SLIPPAGE = 0.0005; // כמו האוטומט: 5 נקודות בסיס על מחיר 09:40

// מגבלות קשיחות למסלול C בלבד (תקציב מניות 40%): גדולות מ-RISK_LIMITS של החשבון המאוזן, אבל פרופורציונליות ולא פרוצות
export const TRACK_LIMITS_C = Object.freeze({
  maxActiveShare: 0.40, maxPositionShare: 0.08, maxOpenRisk: 0.05, maxSectorOpenRisk: 0.02, maxBuysPerDay: 3,
  leverage: false, shortSelling: false, options: false, requireEarningsDateLive: true, allowedTypes: Object.freeze(['stock', 'etf']),
});

export const TRACKS = Object.freeze({
  regB: Object.freeze({
    id: 'regB', kind: 'allocation', label: 'רגיל B', benchmark: 'spy',
    desc: '60% VTI · 20% מניות נבחרות · 10% אג"ח · 5% זהב · 5% מזומן (80% מניות)',
    profile: Object.freeze({ label: 'רגיל B', sleeves: Object.freeze({ coreEquity: 0.60, stocks: 0.20, bonds: 0.10, gold: 0.05, cash: 0.05 }), maxPosition: 0.10, maxEtfPosition: 0.65, maxSector: 0.30, maxStocks: 6, minScore: 60, maxVol: 0.45 }),
    limits: RISK_LIMITS, rules: AUTO_RULES,
  }),
  regC: Object.freeze({
    id: 'regC', kind: 'allocation', label: 'רגיל C', benchmark: 'spy',
    desc: '40% VTI · 40% מניות נבחרות · 10% אג"ח · 5% זהב · 5% מזומן (80% מניות, אקטיבי יותר)',
    profile: Object.freeze({ label: 'רגיל C', sleeves: Object.freeze({ coreEquity: 0.40, stocks: 0.40, bonds: 0.10, gold: 0.05, cash: 0.05 }), maxPosition: 0.08, maxEtfPosition: 0.45, maxSector: 0.30, maxStocks: 10, minScore: 62, maxVol: 0.45 }),
    limits: TRACK_LIMITS_C, rules: Object.freeze({ ...AUTO_RULES, maxBuysPerRun: 3 }),
  }),
  aggrB: Object.freeze({
    id: 'aggrB', kind: 'aggressive', label: 'אגרסיבי B', benchmark: 'spy95',
    desc: '70%–95% מניות לפי מצב השוק ואיכות האותות (מודל DF); SPY 20%–70% · מניות עד 75% · בלי קניות כפויות',
    rules: Object.freeze({ ...AGGR_RULES, version: 1, model: 'DF', equityFloor: 0.70, coreMax: 0.70 }),
  }),
});
export const TRACK_IDS = Object.keys(TRACKS);

// סיווג החזקה לדלי הקצאה (ליבה מנייתית/אג"ח/זהב/מניה בודדת) לפי שורת הדירוג — משמש גם למסלולי הקצאה וגם לפירוק חשבון התרגול
export const CORE_ETFS = Object.freeze(new Set(['SPY', 'VTI', 'VOO', 'BND', 'AGG', 'IEF', 'GLD', 'IAU', 'QQQ']));
export function bucketOf(sym, table){
  const r = table.find((x) => x.symbol === sym);
  if (r?.assetClass === 'bond') return 'bonds'; if (r?.assetClass === 'gold') return 'gold';
  if (CORE_ETFS.has(sym) || r?.role === 'core' || (r?.type === 'etf' && r?.assetClass === 'equity')) return 'etf';
  return 'stocks';
}

// ---------- אגרסיבי B ----------
// שלב מקדים: אם יש אותות כשירים אבל אין מזומן — מוכרים SPY שמעל ליבת 20% כדי לממן (בחירת מניות היא המטרה, לא החזקת מדד).
// שלב סופי: במשטר בריא (לא דובי, לא Risk Off) ובחשיפה מתחת לרצפה — משלימים SPY עד 70% (לא מניות). אחרת נשארים במזומן.
export function decideAggressiveB({ state, rows = [], spyPrice = null, regime = null, fx = 3.7, day, rules = TRACKS.aggrB.rules }){
  const bear = regime?.trend === 'Bear Trend', riskOff = regime?.risk === 'Risk Off';
  const bySym = new Map(rows.map((r) => [r.symbol, r]));
  const priceOf = (s) => (s === rules.core ? spyPrice : bySym.get(s)?.price ?? null);
  const usd = (p) => p * fx;
  const st0 = JSON.parse(JSON.stringify(state));
  const pre = []; const notes = [];
  const mtm0 = markToMarket(st0, priceOf, fx);
  const held = new Set(Object.keys(st0.positions));
  const cool = (s) => { const d = st0.cooldown?.[s]; return d && day && (Date.parse(day) - Date.parse(d)) / 86400000 < rules.cooldownDays; };
  const qualifying = rows.filter((r) => r['eligible' + rules.model] !== false && isNum(r[rules.model]) && rules.buyActions.includes(r['act' + rules.model]) && (!riskOff || r['act' + rules.model] === 'STRONG BUY') && !held.has(r.symbol) && !cool(r.symbol) && isNum(r.price) && r.price > 0);
  // preSellQty/coreSnapshot: המכירה המקדימה מוחלת על st0 רק בשביל לתת ל-decideAggressive לראות את המזומן שיתפנה
  // (כדי שגודל הקניות המחושב יתאים) — היא עדיין הזמנה ב-pending בלבד, לא ביצוע. בלי הביטול בהמשך, ה-state
  // המוחזר (שנשמר ל-KV לפני המילוי בפועל) היה "מבצע" אותה כבר עכשיו, ואז applyFills במילוי האמיתי למחרת היה
  // מבצע אותה שוב — כמות ה-SPY יורדת פעמיים והמזומן עולה פעמיים על אותה מכירה בפועל אחת.
  let preSellQty = 0, coreSnapshot = null;
  if (!bear && isNum(spyPrice) && spyPrice > 0 && qualifying.length){
    const nPos = Object.keys(st0.positions).filter((s) => s !== rules.core).length;
    const want = Math.max(0, Math.min(qualifying.length, rules.maxPositions - nPos, rules.maxBuysPerDay));
    const need = want * mtm0.totalIls * rules.positionWeight;
    const avail = st0.cashIls - mtm0.totalIls * rules.cashReserve;
    const spyVal = mtm0.rows.find((x) => x.core)?.valueIls || 0;
    const spyExcess = spyVal - mtm0.totalIls * rules.coreWeight;
    if (need > avail && spyExcess > 0){
      const qty = Math.min(st0.positions[rules.core]?.qty || 0, Math.floor(Math.min(need - avail, spyExcess) / usd(spyPrice)));
      if (qty >= 1){
        preSellQty = qty; coreSnapshot = { ...st0.positions[rules.core] };
        pre.push({ side: 'sell', symbol: rules.core, qty, decisionPrice: round(spyPrice, 4), reason: `מימון ${want} קניות איכותיות מהליבה: SPY מעל 20% (${Math.round(spyVal / mtm0.totalIls * 100)}%)`, sector: 'core' });
        st0.cashIls += qty * usd(spyPrice) * (1 - rules.slippage) - rules.feeIls;
        const p = st0.positions[rules.core]; p.qty -= qty; if (p.qty <= 0) delete st0.positions[rules.core];
        notes.push(`SPY: נמכרו ${qty} יחידות מעל הליבה כדי לממן מניות שעברו את הסינון`);
      }
    }
  }
  const d = decideAggressive({ state: st0, rows, spyPrice, regime, fx, day, rules });
  // מבטלים כאן את האפקט הכספי של המכירה המקדימה מה-state המוחזר (ראה הערה למעלה) — היא נשארת רק בתוך orders/pending,
  // ותבוצע פעם אחת בלבד, בפועל, כשה-pending הזו תתמלא (applyFills) למחרת ב-09:40.
  if (preSellQty > 0){
    d.state.cashIls -= preSellQty * usd(spyPrice) * (1 - rules.slippage) - rules.feeIls;
    const p = d.state.positions[rules.core];
    if (p) p.qty += preSellQty; else d.state.positions[rules.core] = { ...coreSnapshot, qty: preSellQty };
  }
  const orders = [...pre, ...d.orders];
  // חשיפה צפויה אחרי כל הפקודות (מילוי במחיר ההחלטה — קירוב)
  const projected = applyFills(d.state, orders.map((o) => ({ ...o, price: o.decisionPrice, fillKind: 'projection' })), { fx, day, rules }).state;
  const pm = markToMarket(projected, priceOf, fx);
  let floorNote = null;
  if (!bear && !riskOff && isNum(spyPrice) && spyPrice > 0 && pm.exposure.equityShare < rules.equityFloor){
    const spyShare = pm.exposure.etfShare;
    const roomToCoreMax = Math.max(0, rules.coreMax - spyShare) * pm.totalIls;
    const gapIls = (rules.equityFloor - pm.exposure.equityShare) * pm.totalIls;
    const cashRoom = projected.cashIls - pm.totalIls * rules.cashReserve;
    const ils = Math.min(gapIls, roomToCoreMax, cashRoom);
    const qty = Math.floor(ils / (usd(spyPrice) * (1 + rules.slippage)));
    if (qty >= 1){
      orders.push({ side: 'buy', symbol: rules.core, qty, decisionPrice: round(spyPrice, 4), reason: `השלמה לרצפת חשיפה ${Math.round(rules.equityFloor * 100)}% דרך SPY (רק ${qualifying.length} אותות שעברו את הסינון)`, sector: 'core' });
      floorNote = `חשיפה צפויה ${Math.round(pm.exposure.equityShare * 100)}% < רצפה — משלימים ב-SPY, לא במניות`;
    } else floorNote = `חשיפה ${Math.round(pm.exposure.equityShare * 100)}% מתחת לרצפה, אבל אין מזומן פנוי/מקום בליבה להשלמה`;
  } else if (pm.exposure.equityShare < rules.equityFloor) floorNote = bear ? 'שוק דובי: הרצפה 70% לא נאכפת — נשארים במזומן' : riskOff ? 'בריחה מסיכון: אין השלמת חשיפה' : null;
  if (floorNote) notes.push(floorNote);
  d.state.qualifyingToday = qualifying.length;
  // חשיפה צפויה סופית: כוללת גם את פקודת השלמת הרצפה (אם נוספה) — לא רק את המצב שלפניה
  const finalProjected = markToMarket(applyFills(d.state, orders.map((o) => ({ ...o, price: o.decisionPrice, fillKind: 'projection' })), { fx, day, rules }).state, priceOf, fx).exposure;
  return { ...d, orders, notes: [...notes, ...d.notes], projectedExposure: finalProjected };
}

// ---------- בדיקות תקינות לפני מילוי ----------
// מחזיר { ok, violations: [{ code, detail }] }. כל הפרה חוסמת את המילוי ונרשמת ביומן — עדיף לא לבצע מאשר לבצע לא נכון.
export function preflight({ track, pending, priceDoc, fillDay, state = null, perf = null, fx = 3.7, alreadyFilled = false }){
  const v = [];
  const add = (code, detail) => v.push({ code, detail });
  if (!pending) add('no-pending', 'אין פקודות ממתינות');
  else {
    if (pending.track && pending.track !== track.id) add('mixing', `פקודות של ${pending.track} הגיעו למסלול ${track.id}`);
    // בדרך כלל fillDay חייב להיות בדיוק pending.day (העיבוד הלילי מתייג לפי היום שבו הוא רץ, לפני 09:40 של אותו יום).
    // חריגה מותרת רק כשsignalDay עצמו סוף שבוע/חג (nightly-sp500.mjs מתייג לפי today() גולמי, בלי לוח חגים) —
    // אז ה-fillDay האמיתי (entry940, שמתויג לפי הבר האמיתי) הוא יום המסחר הבא, לא אותו יום. ראה session.js.
    if (!isExpectedFillDay(pending.day, fillDay)) add('stale-day', `הפקודות ליום ${pending.day}, המילוי ליום ${fillDay}`);
    if (alreadyFilled || pending.filled) add('double-execution', `הפקודות ליום ${pending.day} כבר בוצעו`);
  }
  if (!priceDoc || priceDoc.day !== fillDay) add('stale-price', `אין מחירי 09:40 ליום ${fillDay}${priceDoc?.day ? ` (יש ל-${priceDoc.day})` : ''}`);
  else if ((priceDoc.count || 0) < 400) add('partial-price', `רק ${priceDoc.count} מחירי 09:40 — נאסף חלקית`);
  if (!isNum(fx) || fx < 2.5 || fx > 6) add('fx', `שער דולר לא סביר: ${fx}`);
  if (pending?.orders?.length && priceDoc?.prices){
    // מזומן: סך הקניות (כולל עמלה משוערת) לא יעלה על המזומן + המכירות; אין מינוף, אין מזומן שלילי
    const px = priceDoc.prices;
    let cash = state ? state.cashIls : (perf?.cashIls ?? 0);
    const total = state ? markToMarket(state, (s) => px[s] ?? null, fx).totalIls : (perf?.totalIls ?? 0);
    const cost = (o) => { const p = px[o.symbol]; if (!isNum(p)) return 0; const ils = o.qty * p * fx; return o.side === 'buy' ? ils * (1 + FILL_SLIPPAGE) + (track.kind === 'aggressive' ? track.rules.feeIls : commissionIls(o.qty, p, fx)) : -(ils * (1 - FILL_SLIPPAGE)); };
    const sells = pending.orders.filter((o) => o.side === 'sell').reduce((s, o) => s + cost(o), 0);
    const buys = pending.orders.filter((o) => o.side === 'buy').reduce((s, o) => s + cost(o), 0);
    if (cash - sells + 0 < buys && buys > 0) add('negative-cash', `קניות ${Math.round(buys).toLocaleString('en-US')} ₪ > מזומן ${Math.round(cash - sells).toLocaleString('en-US')} ₪ (אחרי מכירות)`);
    // תקציב: מניות בודדות אחרי הקניות לא יעלו על התקרה של המסלול (בקירוב מחיר 09:40)
    const cap = track.kind === 'aggressive' ? track.rules.stocksWeight : Math.min(track.profile.sleeves.stocks, track.limits.maxActiveShare);
    if (total > 0){
      const stocksNow = state ? markToMarket(state, (s) => px[s] ?? null, fx).rows.filter((x) => !x.core).reduce((s, x) => s + x.valueIls, 0) : (perf?.stocksIls ?? 0);
      const stocksAfter = stocksNow + pending.orders.filter((o) => !o.core && o.sector !== 'core' && !['SPY', 'VTI', 'VOO', 'BND', 'AGG', 'IEF', 'GLD', 'IAU'].includes(o.symbol)).reduce((s, o) => s + (o.side === 'buy' ? 1 : -1) * o.qty * (px[o.symbol] || 0) * fx, 0);
      if (stocksAfter > total * cap * 1.03) add('budget', `מניות בודדות אחרי הקניות ${Math.round(stocksAfter / total * 100)}% > תקרה ${Math.round(cap * 100)}%`);
    }
    for (const o of pending.orders) if (o.side === 'buy' && (!isNum(o.qty) || o.qty <= 0 || Math.floor(o.qty) !== o.qty)) add('qty', `${o.symbol}: כמות לא תקינה ${o.qty}`);
  }
  return { ok: v.length === 0, violations: v };
}

// ---------- מדדי ייחוס שקליים ----------
// spy: כל 200,000 ₪ ב-SPY ב-09:40 של יום ההתחלה (החלקה + עמלה כמו התיקים); spy95: 95% SPY + 5% מזומן (כמו רצפת המזומן של המסלולים)
export const BENCHMARKS = Object.freeze({ spy: { label: 'SPY (₪)', share: 1 }, spy95: { label: '95% SPY + 5% מזומן (₪)', share: 0.95 } });
export function benchStart({ id, day, price940, fx, initialIls = INITIAL_ILS }){
  const b = BENCHMARKS[id]; if (!b || !isNum(price940) || price940 <= 0 || !isNum(fx)) return null;
  const fill = price940 * (1 + FILL_SLIPPAGE);
  const budget = initialIls * b.share;
  const qty = Math.floor(budget / (fill * fx));
  const fee = commissionIls(qty, fill, fx);
  const cost = qty * fill * fx + fee;
  return { id, label: b.label, startDay: day, initialIls, qty, entryPrice: round(fill, 4), entryFx: fx, feeIls: fee, cashIls: round(initialIls - cost, 2), fillKind: 'entry940' };
}
export function benchValue(bench, spyClose, fx){ if (!bench || !isNum(spyClose)) return null; return round(bench.qty * spyClose * fx + bench.cashIls, 2); }

// ---------- מדדי ביצוע ----------
// rows: [{ day, total, fx, ... }] ממוינים. תשואה, ירידה מקסימלית, תנודתיות שנתית, תרומת המטבע (fx now/fx0) ותשואה במונחי דולר
export function trackMetrics(rows = [], initialIls = INITIAL_ILS){
  if (!rows.length) return null;
  const first = rows[0], last = rows[rows.length - 1];
  const ret = last.total / initialIls - 1;
  let peak = -Infinity, maxDD = 0; const rets = [];
  for (let i = 0; i < rows.length; i++){ const v = rows[i].total; peak = Math.max(peak, v); maxDD = Math.min(maxDD, v / peak - 1); if (i) rets.push(v / rows[i - 1].total - 1); }
  const m = rets.length ? rets.reduce((s, x) => s + x, 0) / rets.length : 0;
  const sd = rets.length > 1 ? Math.sqrt(rets.reduce((s, x) => s + (x - m) ** 2, 0) / (rets.length - 1)) : null;
  const fx0 = first.fx, fxN = last.fx;
  const fxContribution = isNum(fx0) && isNum(fxN) && fx0 > 0 ? round(fxN / fx0 - 1, 4) : null;
  const retUsd = isNum(fx0) && isNum(fxN) && fx0 > 0 ? round((last.total / fxN) / (initialIls / fx0) - 1, 4) : null;
  return { days: rows.length, from: first.day, to: last.day, totalReturn: round(ret, 4), dailyReturn: rets.length ? round(rets[rets.length - 1], 4) : null, maxDrawdown: round(maxDD, 4), volAnnual: sd === null ? null : round(sd * Math.sqrt(252), 4), fxContribution, returnUsdTerms: retUsd, small: rows.length < 20 };
}
// תשואה בין שני תאריכים מתוך שורות הון (הראשונה ≥ from, האחרונה ≤ to)
export function returnBetween(rows = [], from, to){
  const r = rows.filter((x) => (!from || x.day >= from) && (!to || x.day <= to));
  if (r.length < 2) return null;
  return round(r[r.length - 1].total / r[0].total - 1, 4);
}
// תרומת בחירת המניות (מסלולי הקצאה): לכל רישום קנייה של מניה בודדת — הרווח שלה פחות מה שאותו כסף היה עושה בקרן הליבה באותה תקופה
// lots: [{ symbol, costIls, pnlIls, date, exitDate }] (רק לא-ליבה); corePriceAt(dateIso) → מחיר קרן הליבה בסגירה הקרובה
export function selectionAlpha(lots = [], corePriceAt, coreNow){
  let alpha = 0, n = 0;
  for (const l of lots){
    const c0 = corePriceAt(l.date); const c1 = l.exitDate ? corePriceAt(l.exitDate) : coreNow;
    if (!isNum(c0) || !isNum(c1) || c0 <= 0 || !isNum(l.pnlIls) || !isNum(l.costIls)) continue;
    alpha += l.pnlIls - l.costIls * (c1 / c0 - 1); n++;
  }
  return n ? { ils: round(alpha, 0), lots: n } : { ils: null, lots: 0 };
}
