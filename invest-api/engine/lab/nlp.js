// מחקר AI (דרישה 12): תרגום בקשה בשפה חופשית (עברית/אנגלית) ל-spec מובנה.
// שני מסלולים: (א) מפענח חוקים דטרמיניסטי מקומי — בלי רשת, מכסה את הניסוחים הנפוצים; (ב) LLM דרך ה-Worker (buildPrompt + parseModelJson)
// שמחזיר JSON בלבד, שעובר normalizeSpec. בשני המסלולים ה-AI לא מחשב כלום ולא ממציא נתונים — רק מנסח spec, והמנוע מריץ.
import { normalizeSpec, explainSpec } from './schema.js';
import { FEATURES } from './features.js';

const num = (s) => { if (!s) return null; const v = parseFloat(String(s).replace(/,/g, '')); return Number.isFinite(v) ? v : null; };
const HE_NUM = { אחת: 1, אחד: 1, שתיים: 2, שניים: 2, שני: 2, שתי: 2, שלוש: 3, שלושה: 3, ארבע: 4, ארבעה: 4, חמש: 5, חמישה: 5, שש: 6, שישה: 6, שבע: 7, שבעה: 7, שמונה: 8, תשע: 9, תשעה: 9, עשר: 10, עשרה: 10, עשרים: 20, שלושים: 30, חמישים: 50, מאה: 100, one: 1, two: 2, three: 3, four: 4, five: 5, ten: 10, twenty: 20 };
const wordNum = (w) => (w === undefined ? null : HE_NUM[w] ?? num(w));
const NUMW = '(\\d+(?:[.,]\\d+)?|אחת|אחד|שתיים|שניים|שני|שתי|שלוש|שלושה|ארבע|ארבעה|חמש|חמישה|שש|שישה|שבע|שבעה|שמונה|תשע|תשעה|עשר|עשרה|עשרים|שלושים|חמישים|מאה|one|two|three|four|five|ten|twenty)';
const DAYS_RE = new RegExp(`${NUMW}\\s*(?:ימי המסחר|ימי מסחר|הימים|ימים|יום|days?|trading days)`, 'i');

export function parseFreeText(text){
  const t = ' ' + String(text || '').replace(/\s+/g, ' ').trim() + ' ', notes = [];
  if (t.trim().length < 8) throw new Error('הבקשה קצרה מדי — תאר אילו מניות, איזה תנאי, מתי לקנות, מתי למכור וכמה להשקיע');
  const spec = { name: text.slice(0, 80), description: text, universe: { type: 'index', index: 'sp500', pointInTime: true, filters: {} }, period: {}, signal: { direction: /שורט|short|מכירה בחסר/i.test(t) ? 'short' : 'long' }, entry: {}, exit: { rules: [] }, sizing: {}, benchmarks: ['SPY', 'QQQ'] };
  // יקום
  if (/נאסד"?ק|nasdaq/i.test(t)){ spec.universe.index = 'nasdaq100'; notes.push('יקום Nasdaq 100 — ייבדק רק אם הרכב היסטורי שלו קיים במערך הנתונים; אחרת ייחסם'); }
  else if (/ראסל|russell/i.test(t)){ spec.universe.index = 'russell2000'; notes.push('יקום Russell 2000 — דורש נתונים שאינם במערך החינמי; ייחסם אם חסר'); }
  else if (/קריפטו|crypto|ביטקוין|bitcoin/i.test(t)){ spec.universe = { type: 'list', symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'ADA-USD', 'BNB-USD', 'DOGE-USD'], filters: { minPrice: 0, minDollarVol: 0, minBars: 30 } }; spec.costs = { model: 'bps', bps: 10, slippageBps: 10 }; spec.benchmarks = ['BTC-USD']; }
  else if (/etf/i.test(t) && /סקטור|sector/i.test(t)) spec.universe = { type: 'list', symbols: ['XLK', 'XLF', 'XLV', 'XLE', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC'], filters: { minPrice: 1, minDollarVol: 0, minBars: 130 } };
  const syms = [...t.matchAll(/\b([A-Z]{2,5})\b/g)].map((m) => m[1]).filter((s) => !['AND', 'OR', 'NOT', 'RSI', 'MACD', 'SMA', 'EMA', 'ATR', 'ADX', 'VWAP', 'ETF', 'USD', 'SP', 'MOC'].includes(s));
  if (syms.length && /(?:מניות|רק|only|symbols?|tickers?)\s*(?:[:：]|של)?\s*[A-Z]/.test(t)) spec.universe = { type: 'list', symbols: [...new Set(syms)], filters: { minPrice: 0, minDollarVol: 0, minBars: 30 } };
  // חלון התשואה / כיוון הדירוג
  const dm = t.match(new RegExp(`(?:ב|in |over |last |האחרונים?|האחרונות?)\\s*${NUMW}?\\s*(?:ימי המסחר|ימי מסחר|הימים|ימים|days?)\\s*(?:האחרונים|האחרונות)?`, 'i')) || t.match(/(יומיים|שלושת הימים|שבוע|week|חודש|month)/i);
  let days = 1;
  if (dm){ const w = dm[0]; days = /יומיים/.test(w) ? 2 : /שלושת/.test(w) ? 3 : /שבוע|week/i.test(w) ? 5 : /חודש|month/i.test(w) ? 21 : wordNum(dm[1]) ?? 1; }
  if (/אתמול|yesterday|ביום האחרון|יום אחד/i.test(t) && !dm) days = 1;
  const losers = /ירד|נפל|losers?|dropped|fell|הפסיד|יורד/i.test(t), gainers = /עלו|עלה|gainers?|rose|gained|עול/i.test(t);
  const topM = t.match(new RegExp(`${NUMW}\\s*(?:ה?מניות|stocks?|ה?מטבעות|coins?|etf)`, 'i'));
  const top = wordNum(topM?.[1]) ?? 10;
  const conds = [];
  const pctDrop = t.match(/(?:ירדו|ירד|נפלו|dropped|fell)[^.%]{0,30}?(?:יותר מ|מעל|more than|over|above)[-\s]*(\d+(?:\.\d+)?)\s*%/i), pctUp = t.match(/(?:עלו|עלה|rose|gained)[^.%]{0,30}?(?:יותר מ|מעל|more than|over)[-\s]*(\d+(?:\.\d+)?)\s*%/i);
  if (pctDrop) conds.push({ feature: 'ret', params: { days }, op: '<', value: -num(pctDrop[1]) / 100 });
  if (pctUp) conds.push({ feature: 'ret', params: { days }, op: '>', value: num(pctUp[1]) / 100 });
  const streak = t.match(new RegExp(`${NUMW}\\s*(?:ימים|ימי)\\s*(?:ברצף|רצופים)`, 'i')) || t.match(/(\d+)\s*(?:consecutive|in a row)/i);
  if (streak){ const n = wordNum(streak[1]) ?? 3; conds.push({ feature: 'streak', op: losers && !gainers ? '<=' : '>=', value: losers && !gainers ? -n : n }); }
  const rsiM = t.match(/rsi\s*(?:\((\d+)\))?\s*(?:(?:נמוך|קטן|מתחת|below|under|less than)\s*(?:מ|ל)?-?\s*(\d+)|(?:גבוה|מעל|above|over|greater than)\s*(?:מ|ל)?-?\s*(\d+))/i);
  if (rsiM) conds.push({ feature: 'rsi', params: { n: rsiM[1] ? +rsiM[1] : 14 }, op: rsiM[2] ? '<' : '>', value: +(rsiM[2] || rsiM[3]) });
  const volM = t.match(/מחזור[^.]{0,40}?(?:גבוה|מעל|יותר)[^.]{0,20}?(?:פי\s*(\d+(?:\.\d+)?))?\s*(?:מה?ממוצע|מהרגיל)/i) || t.match(/volume[^.]{0,30}?(\d+(?:\.\d+)?)?x?\s*(?:the )?average/i);
  if (volM) conds.push({ feature: 'rel_vol', params: { n: 20 }, op: '>', value: volM[1] ? +volM[1] : 1 });
  if (/מעל (?:ל)?ממוצע 200|above (?:the )?200/i.test(t)) conds.push({ feature: 'price_vs_sma', params: { n: 200 }, op: '>', value: 0 });
  if (/מתחת (?:ל)?ממוצע 200|below (?:the )?200/i.test(t)) conds.push({ feature: 'price_vs_sma', params: { n: 200 }, op: '<', value: 0 });
  if (/שיא (?:היסטורי|52|שנתי)|52[- ]week high|all[- ]time high/i.test(t)) conds.push({ feature: 'new_high', params: { n: 252 }, op: '==', value: 1 });
  if (/שפל (?:52|שנתי|תקופתי)|52[- ]week low/i.test(t)) conds.push({ feature: 'new_low', params: { n: 252 }, op: '==', value: 1 });
  if (conds.length) spec.signal.conditions = { all: conds };
  if (/הכי הרבה|most|ביותר|top|highest|lowest|הגבוה|הנמוך|biggest/i.test(t) || !conds.length){ spec.signal.rank = { feature: 'ret', params: { days }, order: losers && !gainers ? 'asc' : 'desc', top }; }
  if (!spec.signal.rank && conds.length) spec.signal.rank = { feature: conds[0].feature, params: conds[0].params || {}, order: conds[0].op === '<' || conds[0].op === '<=' ? 'asc' : 'desc', top };
  // כניסה
  if (/בפתיחה|at (?:the )?open|next open/i.test(t)) spec.entry.timing = 'next_open';
  else if (/בסגירה של אותו יום|same close|בסגירת יום האות/i.test(t)) spec.entry.timing = 'same_close';
  else if (/בסגירה|at (?:the )?close|moc/i.test(t) && /קנ|buy|כנס|enter/i.test(t) && !/מכור בסגירה|sell at close/i.test(t)) spec.entry.timing = 'next_close';
  const lim = t.match(/limit[^.]{0,20}?(\d+(?:\.\d+)?)\s*%|לימיט[^.]{0,20}?(\d+(?:\.\d+)?)\s*%/i); if (lim){ spec.entry.timing = 'limit'; spec.entry.limitPct = -(+(lim[1] || lim[2])) / 100; }
  const delay = t.match(new RegExp(`(?:אחרי|after)\\s*${NUMW}\\s*(?:ימים|יום|days?)\\s*(?:מהאות|מהופעת|from (?:the )?signal)`, 'i')); if (delay){ spec.entry.timing = 'delay'; spec.entry.delayDays = wordNum(delay[1]); }
  // יציאה
  const sellPart = t.split(/מכור|מכירה|תמכור|sell|exit|צא/i).slice(1).join(' ');
  const tpM = t.match(/(?:רווח|profit|take profit|יעד)\s*(?:של)?\s*(\d+(?:\.\d+)?)\s*%/i), slM = t.match(/(?:הפסד|סטופ|stop(?: loss)?|loss)\s*(?:של)?\s*(\d+(?:\.\d+)?)\s*%/i), trM = t.match(/(?:trailing|נגרר)\s*(?:stop|סטופ)?\s*(?:של)?\s*(\d+(?:\.\d+)?)\s*%/i);
  if (slM) spec.exit.rules.push({ type: 'stop_loss', pct: +slM[1] / 100 });
  if (tpM) spec.exit.rules.push({ type: 'take_profit', pct: +tpM[1] / 100 });
  if (trM) spec.exit.rules.push({ type: 'trailing_stop', pct: +trM[1] / 100 });
  const rsiExit = sellPart.match(/rsi[^.]{0,20}?(\d+)/i); if (rsiExit) spec.exit.rules.push({ type: 'condition', at: 'next_open', conditions: { feature: 'rsi', params: { n: 14 }, op: spec.signal.direction === 'long' ? '>' : '<', value: +rsiExit[1] } });
  if (/יוצאת מהדירוג|leaves the (?:ranking|list)|out of the top/i.test(t)) spec.exit.rules.push({ type: 'rank_exit', at: 'next_open' });
  if (/אות הפוך|opposite signal/i.test(t)) spec.exit.rules.push({ type: 'opposite_signal', at: 'next_open' });
  const hold = sellPart.match(DAYS_RE) || sellPart.match(/(יומיים|שלושה ימים|שבוע|week)/i);
  if (/(?:בסוף|בסיום) (?:אותו )?(?:ה)?יום|end of (?:the )?(?:same )?day|same day/i.test(sellPart)) spec.exit.rules.push({ type: 'time', days: 1, at: 'close' });
  else if (hold){ const w = hold[0]; const n = /יומיים/.test(w) ? 2 : /שלושה/.test(w) ? 3 : /שבוע|week/i.test(w) ? 5 : wordNum(hold[1]) ?? 1; spec.exit.rules.push({ type: 'time', days: n + (spec.entry.timing === 'next_open' || !spec.entry.timing ? 1 : 0), at: 'close' }); notes.push(`"מכירה לאחר ${n} ימים" פורש כמכירה בסגירה של יום המסחר ה-${n + 1} מהכניסה בפתיחה (יום הכניסה נספר)`); }
  else if (/למחרת|next day|tomorrow/i.test(sellPart)) spec.exit.rules.push({ type: 'time', days: 2, at: 'close' });
  if (!spec.exit.rules.some((r) => ['time', 'condition', 'rank_exit', 'opposite_signal'].includes(r.type))){ spec.exit.rules.push({ type: 'time', days: 1, at: 'close' }); notes.push('לא צוין מועד מכירה — ברירת מחדל: סגירת יום הכניסה'); }
  // הון
  const cap = t.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*(?:k|K|אלף)?\s*(?:\$|דולר|usd)/i) || t.match(/\$\s*(\d{1,3}(?:,\d{3})+|\d+)\s*(k|K)?/);
  if (cap){ let v = num(cap[1]); if (/k|אלף/i.test(cap[0]) && v < 1000) v *= 1000; spec.sizing.capital = v; }
  spec.sizing.maxPositions = top;
  if (/מינוף\s*(\d+(?:\.\d+)?)|leverage\s*(\d+(?:\.\d+)?)/i.test(t)){ const m = t.match(/מינוף\s*(\d+(?:\.\d+)?)|leverage\s*(\d+(?:\.\d+)?)/i); spec.sizing.leverage = +(m[1] || m[2]); }
  // תקופה
  const yrs = [...t.matchAll(/\b(19|20)(\d{2})\b/g)].map((m) => m[0]); if (yrs.length >= 2){ spec.period.from = `${yrs[0]}-01-01`; spec.period.to = `${yrs[yrs.length - 1]}-12-31`; } else if (yrs.length === 1 && /מ-?\s*(19|20)\d{2}|since|from/i.test(t)) spec.period.from = `${yrs[0]}-01-01`;
  const yearsBack = t.match(new RegExp(`${NUMW}\\s*(?:השנים האחרונות|שנים אחרונות|years?)`, 'i')); if (yearsBack && !yrs.length){ const n = wordNum(yearsBack[1]); const now = new Date(); spec.period.from = `${now.getUTCFullYear() - n}-01-01`; }
  if (/שוק עולה|bull/i.test(t)) spec.period.regime = 'bull'; if (/שוק יורד|bear/i.test(t)) spec.period.regime = 'bear';
  const normalized = normalizeSpec(spec);
  return { spec: normalized, notes, explanation: explainSpec(normalized).sections, parser: 'rules' };
}

// הנחיה ל-LLM: הסכימה המדויקת + דוגמאות; הפלט חייב להיות JSON בלבד
export function buildPrompt(text){
  const features = Object.entries(FEATURES).map(([k, v]) => `${k}${Object.keys(v.params).length ? `(${Object.entries(v.params).map(([a, b]) => `${a}=${b}`).join(',')})` : ''}: ${v.label(v.params)}`).join('\n');
  const system = `אתה מתרגם בקשות בשפה חופשית ל-JSON של אסטרטגיית השקעה עבור מנוע Backtesting דטרמיניסטי. אתה לא מחשב תוצאות, לא ממציא נתונים ולא נותן ייעוץ.
החזר JSON בלבד (ללא טקסט מסביב) במבנה:
{"name":str,"description":str,
 "universe":{"type":"index"|"list","index":"sp500","symbols":[...],"pointInTime":true,"filters":{"minPrice":5,"minDollarVol":20000000,"minBars":60,"sectors":[],"excludeSectors":[]}},
 "period":{"from":"YYYY-MM-DD"|null,"to":null,"weekdays":null|[1..5],"months":null|[1..12],"regime":"all"|"bull"|"bear"},
 "signal":{"direction":"long"|"short","conditions":{"all":[{"feature":str,"params":{},"op":"<"|"<="|">"|">="|"=="|"between"|"cross_above"|"cross_below"|"top_pct"|"bottom_pct"|"top_n"|"bottom_n","value":number|[a,b]|{"feature":str,"params":{},"mult":number}}]} | null,
            "rank":{"feature":str,"params":{},"order":"asc"|"desc","top":N} | null},
 "entry":{"timing":"next_open"|"next_close"|"same_close"|"limit"|"stop"|"delay","delayDays":0,"limitPct":-0.01,"stopPct":0.01,"validDays":1},
 "exit":{"rules":[{"type":"time","days":N,"at":"close"|"open"},{"type":"take_profit","pct":0.05},{"type":"stop_loss","pct":0.05},{"type":"trailing_stop","pct":0.08},{"type":"condition","at":"next_open"|"close","conditions":{...}},{"type":"rank_exit"},{"type":"opposite_signal"}]},
 "sizing":{"capital":50000,"mode":"equal"|"fixed"|"pct"|"inverse_vol"|"rank"|"market_cap","amount":5000,"pct":0.1,"maxPositions":10,"leverage":1,"maxPerSymbolPct":1,"maxPerSectorPct":1,"dailyLossLimitPct":null,"maxTradesPerDay":null,"reinvest":true},
 "costs":{"model":"ibkr_fixed"|"bps"|"none"},
 "notes":[str]}
כללים: אחוזים כשברים (8% → 0.08; ירידה → שלילי). "מכירה בסוף אותו יום" עם כניסה בפתיחה = time days=1 at close; "מכירה לאחר N ימים" עם כניסה בפתיחה = days=N+1.
"המניות שירדו הכי הרבה" = rank ret(days) order asc; "שעלו הכי הרבה" = desc. אל תניח קנייה במחיר הסגירה של יום האות אלא אם נאמר במפורש (ואז timing=same_close).
מה שלא נאמר — השאר ברירת מחדל והוסף הערה ב-notes. אם הבקשה דורשת נתון שאין (דוחות, אנליסטים, נאסד"ק היסטורי) — כתוב זאת ב-notes ואל תמציא תחליף שקט.
מאפיינים זמינים:\n${features}`;
  return { system, user: `בקשה: ${text}` };
}
export function parseModelJson(raw){
  const m = String(raw || '').match(/\{[\s\S]*\}/); if (!m) throw new Error('המודל לא החזיר JSON');
  const j = JSON.parse(m[0]); const notes = Array.isArray(j.notes) ? j.notes.map(String) : []; delete j.notes;
  const spec = normalizeSpec(j);
  return { spec, notes, explanation: explainSpec(spec).sections, parser: 'llm' };
}
