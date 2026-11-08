// סכימת האסטרטגיה: אימות, נרמול וברירות מחדל + הסבר בעברית של "מה בדיוק ייבדק" (דרישות 4, 12).
// ה-AI (nlp.js / Worker) מייצר JSON בפורמט הזה; המנוע הדטרמיניסטי (simulate.js) הוא היחיד שמחשב.
import { normalizeNode, describe } from './rules.js';
import { FEATURES, featureParams, featureLabel } from './features.js';

export const ENTRY_TIMINGS = { next_open: 'קנייה בפתיחת יום המסחר הבא (ברירת מחדל, ריאלי)', next_close: 'קנייה בסגירת יום המסחר הבא (פקודת MOC)', same_close: 'קנייה בסגירת יום האות (מניח שהאות חושב לפני הסגירה — אופטימי, מסומן)', limit: 'פקודת Limit למחרת ביחס לסגירת יום האות', stop: 'קנייה אחרי פריצה/תנועה נוספת (Stop-entry) ביחס לסגירת יום האות', delay: 'קנייה בפתיחה אחרי מספר ימים מהאות' };
export const EXIT_TYPES = ['time', 'take_profit', 'stop_loss', 'trailing_stop', 'condition', 'rank_exit', 'opposite_signal'];
export const SIZING_MODES = { equal: 'חלוקה שווה בין המקומות בתיק', fixed: 'סכום קבוע לכל עסקה', pct: 'אחוז מההון לכל עסקה', inverse_vol: 'משקל הפוך לתנודתיות', rank: 'משקל לפי דירוג (גבוה יותר למדורג ראשון)', market_cap: 'משקל לפי שווי שוק (דורש נתוני point-in-time)' };
export const COST_PRESETS = {
  ibkr_fixed: { model: 'ibkr_fixed', perShare: 0.005, minPerOrder: 1, maxPctOfTrade: 0.01, bps: 0, slippageBps: 5, spreadBps: 0, regulatorySell: true, shortBorrowAnnualPct: 1, marginAnnualPct: 6, dividends: true },
  bps: { model: 'bps', perShare: 0, minPerOrder: 0, maxPctOfTrade: 1, bps: 10, slippageBps: 5, spreadBps: 0, regulatorySell: false, shortBorrowAnnualPct: 1, marginAnnualPct: 6, dividends: true },
  none: { model: 'none', perShare: 0, minPerOrder: 0, maxPctOfTrade: 1, bps: 0, slippageBps: 0, spreadBps: 0, regulatorySell: false, shortBorrowAnnualPct: 0, marginAnnualPct: 0, dividends: true },
};
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const num = (v, d, path, { min = -Infinity, max = Infinity, int = false } = {}) => { if (v === undefined || v === null || v === '') return d; const n = +v; if (!Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) throw new Error(`${path}: ערך לא תקין (${v})`); return n; };
const pctIn = (v, d, path) => { const n = num(v, d, path); if (n === null) return null; return Math.abs(n) > 1.5 ? n / 100 : n; }; // 8 → 8% ; 0.08 → 8%

export function normalizeSpec(input){
  if (!input || typeof input !== 'object') throw new Error('אסטרטגיה חסרה');
  const spec = { id: input.id || null, name: String(input.name || 'אסטרטגיה ללא שם').slice(0, 120), description: String(input.description || '').slice(0, 2000), version: num(input.version, 1, 'version', { min: 1, int: true }) };
  const u = input.universe || {};
  spec.universe = { type: ['index', 'list'].includes(u.type) ? u.type : (u.symbols?.length ? 'list' : 'index'), index: u.index || 'sp500', symbols: (u.symbols || []).map((s) => String(s).toUpperCase().trim()).filter(Boolean), pointInTime: u.pointInTime !== false, exclude: (u.exclude || []).map((s) => String(s).toUpperCase()), filters: {} };
  const f = u.filters || {};
  spec.universe.filters = { minPrice: num(f.minPrice, 5, 'universe.filters.minPrice', { min: 0 }), maxPrice: num(f.maxPrice, null, 'universe.filters.maxPrice', { min: 0 }), minDollarVol: num(f.minDollarVol, 20e6, 'universe.filters.minDollarVol', { min: 0 }), minBars: num(f.minBars, 60, 'universe.filters.minBars', { min: 1, int: true }), sectors: (f.sectors || []).map(String), excludeSectors: (f.excludeSectors || []).map(String) };
  if (spec.universe.type === 'list' && !spec.universe.symbols.length) throw new Error('universe: רשימת סימבולים ריקה');
  const p = input.period || {};
  for (const k of ['from', 'to']) if (p[k] && !ISO.test(p[k])) throw new Error(`period.${k}: תאריך בפורמט YYYY-MM-DD`);
  spec.period = { from: p.from || null, to: p.to || null, weekdays: p.weekdays ? p.weekdays.map((x) => num(x, null, 'period.weekdays', { min: 0, max: 6, int: true })) : null, months: p.months ? p.months.map((x) => num(x, null, 'period.months', { min: 1, max: 12, int: true })) : null, regime: ['all', 'bull', 'bear'].includes(p.regime) ? p.regime : 'all', regimeSymbol: p.regimeSymbol || 'SPY', regimeSma: num(p.regimeSma, 200, 'period.regimeSma', { min: 2, int: true }) };
  if (spec.period.from && spec.period.to && spec.period.from >= spec.period.to) throw new Error('period: תאריך ההתחלה חייב להיות לפני הסיום');
  const sg = input.signal || {};
  spec.signal = { direction: sg.direction === 'short' ? 'short' : 'long', conditions: sg.conditions ? normalizeNode(sg.conditions, 'signal.conditions') : null, rank: null };
  if (sg.rank){ if (!FEATURES[sg.rank.feature]) throw new Error(`signal.rank: מאפיין לא מוכר "${sg.rank.feature}"`); spec.signal.rank = { feature: sg.rank.feature, params: featureParams(sg.rank.feature, sg.rank.params || {}), order: sg.rank.order === 'desc' ? 'desc' : 'asc', top: num(sg.rank.top, 10, 'signal.rank.top', { min: 1, max: 500, int: true }) }; }
  if (!spec.signal.conditions && !spec.signal.rank) throw new Error('signal: חייב תנאי כניסה או דירוג');
  const e = input.entry || {};
  spec.entry = { timing: ENTRY_TIMINGS[e.timing] ? e.timing : 'next_open', delayDays: num(e.delayDays, 0, 'entry.delayDays', { min: 0, max: 60, int: true }), limitPct: pctIn(e.limitPct, -0.01, 'entry.limitPct'), stopPct: pctIn(e.stopPct, 0.01, 'entry.stopPct'), validDays: num(e.validDays, 1, 'entry.validDays', { min: 1, max: 30, int: true }) };
  if (spec.entry.timing === 'delay' && spec.entry.delayDays < 1) spec.entry.delayDays = 1;
  const x = input.exit || {};
  const rules = (x.rules || []).map((r, i) => {
    const path = `exit.rules[${i}]`; if (!EXIT_TYPES.includes(r.type)) throw new Error(`${path}: סוג יציאה לא מוכר "${r.type}"`);
    const out = { type: r.type, at: r.at === 'open' || r.at === 'next_open' ? (r.type === 'time' ? 'open' : 'next_open') : 'close' };
    if (r.type === 'time') out.days = num(r.days, 1, path + '.days', { min: 1, max: 100000, int: true }); // 100000 = "החזק לנצח" (Buy & Hold)
    if (['take_profit', 'stop_loss', 'trailing_stop'].includes(r.type)){ out.pct = Math.abs(pctIn(r.pct, 0.05, path + '.pct')); if (!(out.pct > 0)) throw new Error(`${path}: אחוז חייב להיות חיובי`); }
    if (r.type === 'condition'){ if (!r.conditions) throw new Error(`${path}: חסר conditions`); out.conditions = normalizeNode(r.conditions, path + '.conditions'); }
    return out;
  });
  if (!rules.length) rules.push({ type: 'time', days: 1, at: 'close' });
  if (rules.some((r) => r.type === 'rank_exit') && !spec.signal.rank) throw new Error('exit rank_exit דורש דירוג (signal.rank)');
  spec.exit = { rules, gapModel: 'conservative', maxHoldDays: num(x.maxHoldDays, null, 'exit.maxHoldDays', { min: 1, int: true }) };
  const s = input.sizing || {};
  spec.sizing = { capital: num(s.capital, 50000, 'sizing.capital', { min: 100 }), mode: SIZING_MODES[s.mode] ? s.mode : 'equal', amount: num(s.amount, 5000, 'sizing.amount', { min: 1 }), pct: pctIn(s.pct, 0.1, 'sizing.pct'), maxPositions: num(s.maxPositions, spec.signal.rank?.top || 10, 'sizing.maxPositions', { min: 1, max: 1000, int: true }), leverage: num(s.leverage, 1, 'sizing.leverage', { min: 0.1, max: 10 }), maxPerSymbolPct: pctIn(s.maxPerSymbolPct, 1, 'sizing.maxPerSymbolPct'), maxPerSectorPct: pctIn(s.maxPerSectorPct, 1, 'sizing.maxPerSectorPct'), dailyLossLimitPct: s.dailyLossLimitPct ? Math.abs(pctIn(s.dailyLossLimitPct, null, 'sizing.dailyLossLimitPct')) : null, maxTradesPerDay: num(s.maxTradesPerDay, null, 'sizing.maxTradesPerDay', { min: 1, int: true }), reinvest: s.reinvest !== false, unlimited: !!s.unlimited, fractional: !!s.fractional, volLookback: num(s.volLookback, 20, 'sizing.volLookback', { min: 2, int: true }) };
  const c = input.costs || {}; const preset = COST_PRESETS[c.model] || COST_PRESETS.ibkr_fixed;
  spec.costs = { ...preset }; for (const k of Object.keys(preset)) if (c[k] !== undefined && k !== 'model') spec.costs[k] = typeof preset[k] === 'boolean' ? !!c[k] : num(c[k], preset[k], `costs.${k}`, { min: 0 });
  spec.benchmarks = (input.benchmarks || ['SPY', 'QQQ']).map((b) => String(b).toUpperCase()).slice(0, 4);
  spec.params = input.params && typeof input.params === 'object' ? input.params : {}; // הגדרות אופטימיזציה: { שם: { path, values:[…] } }
  return spec;
}

// הסבר בעברית — מוצג לפני ההרצה: נכסים, תנאים, מתי האות, מתי הביצוע, יציאה, גודל (דרישה 12)
export function explainSpec(input){
  const s = normalizeSpec(input), out = [];
  const u = s.universe, f = u.filters;
  out.push({ title: 'אילו נכסים ייבדקו', lines: [u.type === 'list' ? `רשימה: ${u.symbols.join(', ')}` : `חברות ${u.index.toUpperCase()} ${u.pointInTime ? 'לפי ההרכב ההיסטורי של כל יום (point-in-time)' : 'לפי ההרכב הנוכחי (אזהרה: הטיית שורדים)'}`, `מסננים: מחיר ≥ ${f.minPrice}$${f.maxPrice ? ` ו-≤ ${f.maxPrice}$` : ''}, מחזור דולרי ממוצע 20 יום ≥ ${(f.minDollarVol / 1e6).toFixed(0)}M$, לפחות ${f.minBars} נרות היסטוריה${f.sectors.length ? `, סקטורים: ${f.sectors.join(', ')}` : ''}${f.excludeSectors.length ? `, ללא: ${f.excludeSectors.join(', ')}` : ''}${u.exclude.length ? `, מוחרגים: ${u.exclude.join(', ')}` : ''}`] });
  const per = [];
  per.push(`${s.period.from || 'תחילת הנתונים'} → ${s.period.to || 'סוף הנתונים'}`);
  if (s.period.weekdays) per.push(`רק בימים: ${s.period.weekdays.map((d) => ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'][d]).join(', ')}`);
  if (s.period.months) per.push(`רק בחודשים: ${s.period.months.join(', ')}`);
  if (s.period.regime !== 'all') per.push(`רק כש-${s.period.regimeSymbol} ${s.period.regime === 'bull' ? 'מעל' : 'מתחת'} לממוצע ${s.period.regimeSma} (שוק ${s.period.regime === 'bull' ? 'עולה' : 'יורד'})`);
  out.push({ title: 'תקופה', lines: per });
  const sig = [];
  if (s.signal.conditions) sig.push(describe(s.signal.conditions));
  if (s.signal.rank) sig.push(`דירוג: ${featureLabel(s.signal.rank.feature, s.signal.rank.params)} — ${s.signal.rank.top} ה${s.signal.rank.order === 'asc' ? 'נמוכות' : 'גבוהות'} ביותר`);
  sig.push(`כיוון: ${s.signal.direction === 'short' ? 'שורט (מכירה בחסר)' : 'לונג (קנייה)'}`);
  out.push({ title: 'מתי נוצר אות', lines: ['האות מחושב בסיום יום המסחר t מנתונים עד הסגירה של t בלבד (אין look-ahead)', ...sig] });
  const en = [ENTRY_TIMINGS[s.entry.timing]];
  if (s.entry.timing === 'limit') en.push(`מחיר ה-Limit: סגירת יום האות ${s.entry.limitPct >= 0 ? '+' : ''}${(s.entry.limitPct * 100).toFixed(1)}%, בתוקף ${s.entry.validDays} ימים; מתמלא רק אם המחיר נגע בו`);
  if (s.entry.timing === 'stop') en.push(`כניסה רק אם המחיר עובר את סגירת יום האות ב-${(s.entry.stopPct * 100).toFixed(1)}%, בתוקף ${s.entry.validDays} ימים`);
  if (s.entry.timing === 'delay') en.push(`המתנה של ${s.entry.delayDays} ימי מסחר מהאות, ואז קנייה בפתיחה`);
  out.push({ title: 'מתי מתבצעת העסקה', lines: en });
  const exitLine = (r) => { switch (r.type){
    case 'time': return r.at === 'open' ? `בפתיחה, ${r.days} ימי מסחר אחרי יום הכניסה` : `בסגירה של יום המסחר ה-${r.days} (כניסה בפתיחה נספרת כיום 1 — days=1 = קנייה בפתיחה ומכירה בסגירה של אותו יום)`;
    case 'take_profit': return `רווח של ${(r.pct * 100).toFixed(1)}% (מחיר יעד; בפער מעבר ליעד — במחיר הפתיחה)`;
    case 'stop_loss': return `הפסד של ${(r.pct * 100).toFixed(1)}% (סטופ; בפער מתחת לסטופ — במחיר הפתיחה, גרוע יותר)`;
    case 'trailing_stop': return `סטופ נגרר ${(r.pct * 100).toFixed(1)}% מהשיא מאז הכניסה`;
    case 'condition': return `תנאי:\n${describe(r.conditions)} — ביצוע ב${r.at === 'close' ? 'סגירה של אותו יום' : 'פתיחה למחרת'}`;
    case 'rank_exit': return `המניה יצאה מהדירוג — ביצוע ב${r.at === 'close' ? 'סגירה' : 'פתיחה למחרת'}`;
    default: return `אות הפוך — ביצוע ב${r.at === 'close' ? 'סגירה' : 'פתיחה למחרת'}`; } };
  const ex = s.exit.rules.map(exitLine);
  out.push({ title: 'תנאי מכירה (הראשון שמתקיים קובע)', lines: [...ex, 'נר שנגע גם ביעד וגם בסטופ → מניחים שהסטופ קרה קודם (שמרני)', 'מניה שנמחקה מהמסחר → יציאה כפויה בסגירה האחרונה הידועה'] });
  const z = s.sizing;
  out.push({ title: 'גודל הפוזיציה', lines: [`הון התחלתי ${z.capital.toLocaleString('en-US')}$ · ${SIZING_MODES[z.mode]}${z.mode === 'equal' ? ` (עד ${z.maxPositions} מקומות → ${(z.capital * z.leverage / z.maxPositions).toLocaleString('en-US', { maximumFractionDigits: 0 })}$ לעסקה בתחילת הדרך)` : z.mode === 'fixed' ? ` (${z.amount}$)` : z.mode === 'pct' ? ` (${(z.pct * 100).toFixed(1)}%)` : ''}`, `מינוף ${z.leverage}× · עד ${z.maxPositions} פוזיציות · ${z.unlimited ? '⚠ מצב מחקר: סכום קבוע בלי מגבלת הון (ההון יכול להיות שלילי — לא חשבון אמיתי)' : z.reinvest ? 'רווחים מושקעים מחדש' : 'סכום קבוע, בלי השקעה חוזרת (עד שהמזומן נגמר)'} · ${z.fractional ? 'שברי מניות' : 'מניות שלמות'}${z.maxPerSymbolPct < 1 ? ` · עד ${(z.maxPerSymbolPct * 100).toFixed(0)}% למניה` : ''}${z.maxPerSectorPct < 1 ? ` · עד ${(z.maxPerSectorPct * 100).toFixed(0)}% לסקטור` : ''}${z.dailyLossLimitPct ? ` · מגבלת הפסד יומי ${(z.dailyLossLimitPct * 100).toFixed(1)}% (חיסול בסגירה)` : ''}${z.maxTradesPerDay ? ` · עד ${z.maxTradesPerDay} עסקאות ביום` : ''}`] });
  const c = s.costs;
  out.push({ title: 'עלויות והנחות ביצוע', lines: [c.model === 'none' ? 'ללא עלויות (לא ריאלי — להשוואה בלבד)' : c.model === 'ibkr_fixed' ? `עמלה ${c.perShare}$ למניה, מינימום ${c.minPerOrder}$, מקסימום ${(c.maxPctOfTrade * 100).toFixed(1)}% מהעסקה${c.regulatorySell ? ' + עמלות רגולטור במכירה' : ''}` : `עמלה ${c.bps} נ"ב לכל צד`, `החלקה ${c.slippageBps} נ"ב לכל צד${c.spreadBps ? ` + חצי מרווח ${c.spreadBps / 2} נ"ב` : ''} · השאלה בשורט ${c.shortBorrowAnnualPct}% לשנה · ריבית מרג'ין ${c.marginAnnualPct}% לשנה · דיבידנדים ${c.dividends ? 'נזקפים (לונג מקבל, שורט משלם)' : 'לא נכללים'}`, 'ביצוע בפתיחה/בסגירה הרשמיות; לא מניחים נזילות מעבר לנר (גודל פקודה מול מחזור מוצג בדוח)'] });
  return { spec: s, sections: out };
}
