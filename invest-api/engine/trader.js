// עוזר המסחר האישי (invest/docs/TRADER.md) — לוגיקה טהורה בלבד: שעות הבורסה בפועל, פענוח דוחות Flex של IBKR (קריאה בלבד),
// פוזיציות חיות, מדדים, המלצות ניהול סיכון (לא איתותים רווחיים — אין יתרון מוכח), כללי התראות, יומן וניתוח טעויות, חלופות יציאה.
// בלי רשת ובלי פקודות. השירות (scripts/trader-assistant.mjs) מספק את הנתונים ומבצע את השליחה.

export const RULES = Object.freeze({
  riskPct: 0.005,          // סיכון לעסקה: 0.5% מהשווי של החשבון
  capPct: 0.20,            // תקרת פוזיציה: 20% מהשווי
  dailyLossPct: [0.01, 0.02],
  concentrationPct: [0.20, 0.30],
  giveBackPeakPct: 0.01,   // עסקה שהגיעה ל-+1% וחזרה לאפס
  spikeRunPct: 0.02, spikeVwapPct: 0.01,
  preCloseMin: 20,
  stopAtr: { day: 1.5, swing: 2 }, targetR: { day: 2, swing: 3 },
});
export const CLASSES = Object.freeze(['day', 'swing', 'long']);

// הפרש שעון ניו יורק מ-UTC בשניות (שעון קיץ בארה"ב: מהיום ראשון השני במרץ עד הראשון בנובמבר), לפי צהרי אותו יום
const offCache = new Map();
export function nyOffsetSec(tSec){
  const day = Math.floor(tSec / 86400); let off = offCache.get(day);
  if (off === undefined){
    const y = new Date(day * 86400e3).getUTCFullYear();
    const nthSunday = (mon, n) => { const f = new Date(Date.UTC(y, mon, 1)); return Date.UTC(y, mon, 1 + ((7 - f.getUTCDay()) % 7) + 7 * (n - 1)) / 1000; };
    const start = nthSunday(2, 2) + 7 * 3600, end = nthSunday(10, 1) + 6 * 3600, noon = day * 86400 + 17 * 3600;
    off = noon >= start && noon < end ? -4 * 3600 : -5 * 3600; offCache.set(day, off);
  }
  return off;
}
export const CLASS_HE = Object.freeze({ day: 'מסחר יומי', swing: 'סווינג', long: 'טווח ארוך' });

// ---------- שעות הבורסה (לפי לוח המסחר של Alpaca: תאריך, פתיחה, סגירה; כולל ימים מקוצרים וחגים) ----------
// cal = [{date:'2026-11-27', open:'09:30', close:'13:00', session_open:'0400', session_close:'2000'}]; offsetSec(t) = הפרש ניו יורק מ-UTC
// מחזיר {phase: 'closed'|'pre'|'regular'|'post', openT, closeT, preT, postT, half} לפי הזמן t (שניות)
export function marketPhase(cal, t, nyOffset){
  const loc = new Date((t + nyOffset(t)) * 1000), ds = loc.toISOString().slice(0, 10);
  const day = cal.find((d) => d.date === ds);
  if (!day) return { phase: 'closed', date: ds };
  const at = (hhmm) => { const s = hhmm.replace(':', ''); const base = Date.parse(ds + 'T00:00:00Z') / 1000; const local = base + Number(s.slice(0, 2)) * 3600 + Number(s.slice(2, 4)) * 60; return local - nyOffset(local); };
  const preT = at(day.session_open || '0400'), openT = at(day.open), closeT = at(day.close), postT = at(day.session_close || '2000');
  const half = closeT - openT < 6 * 3600;
  const phase = t < preT ? 'closed' : t < openT ? 'pre' : t < closeT ? 'regular' : t < postT ? 'post' : 'closed';
  return { phase, date: ds, preT, openT, closeT, postT, half };
}

// ---------- IBKR Flex (XML, קריאה בלבד) ----------
// פענוח גנרי: כל תגית עם מאפיינים → {tag, a:{...}}. מספיק למבנה השטוח של Flex.
export function parseFlex(xml){
  const out = []; const re = /<([A-Za-z]+)\s([^<>]*?)\/?>/g; let m;
  while ((m = re.exec(xml))){ const a = {}; for (const x of m[2].matchAll(/([A-Za-z0-9_]+)="([^"]*)"/g)) a[x[1]] = x[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>'); out.push({ tag: m[1], a }); }
  return out;
}
const num = (x) => { const v = Number(String(x ?? '').replace(/,/g, '')); return Number.isFinite(v) ? v : null; };
// "20261126;101530" / "2026-11-26, 10:15:30" / "20261126" → שניות UTC לפי שעון ניו יורק
export function flexTime(s, nyOffset){
  const d = String(s || '').replace(/[^0-9]/g, ''); if (d.length < 8) return null;
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${d.slice(8, 10) || '00'}:${d.slice(10, 12) || '00'}:${d.slice(12, 14) || '00'}Z`;
  const local = Date.parse(iso) / 1000; return local - nyOffset(local);
}
// דוח Activity (יום המסחר הקודם): פוזיציות פתוחות ושווי. מחזיר {accounts:{id:{nav, positions:[{sym, qty, cost, mark, currency}]}}}
export function flexPositions(xml){
  const acc = {};
  for (const { tag, a } of parseFlex(xml)){
    const id = a.accountId; if (!id) continue;
    const A = (acc[id] ||= { nav: null, positions: [], currency: null });
    if (/^OpenPosition$/i.test(tag) && (!a.assetCategory || a.assetCategory === 'STK') && (!a.levelOfDetail || /SUMMARY/i.test(a.levelOfDetail))){
      const qty = num(a.position); if (!qty) continue;
      A.positions.push({ sym: a.symbol, qty, cost: num(a.costBasisPrice), mark: num(a.markPrice), currency: a.currency || 'USD', fx: num(a.fxRateToBase) || 1 });
    }
    if (/^(EquitySummaryByReportDateInBase|EquitySummaryInBase)$/i.test(tag) && num(a.total) != null) A.nav = num(a.total);
    if (/^ChangeInNAV$/i.test(tag) && num(a.endingValue) != null && A.nav == null) A.nav = num(a.endingValue);
    if (a.currency && /^AccountInformation$/i.test(tag)) A.currency = a.currency;
    if (/^ConversionRate$/i.test(tag) && a.fromCurrency === 'USD' && num(a.rate)) A.usdRate = num(a.rate);
  }
  for (const A of Object.values(acc)) if (!A.usdRate){ const u = A.positions.find((p) => p.currency === 'USD' && p.fx); A.usdRate = u ? u.fx : (A.currency === 'USD' ? 1 : null); }
  return acc;
}
// דוח Trade Confirmation (היום): ביצועים. מחזיר [{acct, sym, side, qty, price, t, commission, orderType}]
export function flexTrades(xml, nyOffset){
  const out = [];
  for (const { tag, a } of parseFlex(xml)){
    if (!/^(TradeConfirm|Trade)$/i.test(tag) || (a.assetCategory && a.assetCategory !== 'STK')) continue;
    const qty = Math.abs(num(a.quantity) || 0); if (!qty || !a.symbol) continue;
    const side = /^S/i.test(a.buySell || '') ? 'SELL' : 'BUY';
    out.push({ acct: a.accountId, sym: a.symbol, side, qty, price: num(a.price ?? a.tradePrice), t: flexTime(a.dateTime || a.tradeDate, nyOffset), commission: Math.abs(num(a.commission ?? a.ibCommission) || 0), orderType: a.orderType || '', id: a.tradeID || a.execID || `${a.symbol}-${a.dateTime}-${qty}` });
  }
  return out.sort((x, y) => x.t - y.t);
}
// פוזיציות חיות = פוזיציות של אתמול + הביצועים של היום. ממוצע עלות משוקלל לקניות; entryT = הקנייה הראשונה של הפוזיציה היום
export function livePositions(morning, trades){
  const pos = new Map();
  for (const [acct, A] of Object.entries(morning)) for (const p of A.positions) pos.set(`${acct}|${p.sym}`, { acct, sym: p.sym, qty: p.qty, avg: p.cost, entryT: null, openedToday: false });
  for (const t of trades){
    const k = `${t.acct}|${t.sym}`, p = pos.get(k) || { acct: t.acct, sym: t.sym, qty: 0, avg: null, entryT: null, openedToday: true };
    if (t.side === 'BUY'){ const q = p.qty + t.qty; p.avg = p.qty > 0 && p.avg != null ? (p.avg * p.qty + t.price * t.qty) / q : t.price; if (p.qty <= 0){ p.entryT = t.t; p.openedToday = true; } p.qty = q; }
    else { p.qty -= t.qty; if (p.qty <= 1e-9){ p.qty = 0; } }
    pos.set(k, p);
  }
  return [...pos.values()].filter((p) => p.qty > 0);
}

// ---------- מדדים מנרות ----------
// bars = [{t,o,h,l,c,v}] ממוינים. VWAP מהפתיחה (או מתחילת הנתונים), ATR14 על נרות 5 דקות, ריצה ב-60 דקות
export function intradayStats(bars, openT){
  const day = bars.filter((b) => b.t >= openT);
  let pv = 0, vv = 0; for (const b of day){ pv += (b.h + b.l + b.c) / 3 * b.v; vv += b.v; }
  const vwap = vv > 0 ? pv / vv : null, last = bars.length ? bars[bars.length - 1].c : null;
  const b5 = []; for (const b of bars){ const k = Math.floor(b.t / 300); const x = b5[b5.length - 1]; if (x && x.k === k){ x.h = Math.max(x.h, b.h); x.l = Math.min(x.l, b.l); x.c = b.c; } else b5.push({ k, h: b.h, l: b.l, c: b.c }); }
  let atr5 = null; if (b5.length >= 15){ let s = 0; for (let i = b5.length - 14; i < b5.length; i++) s += Math.max(b5[i].h, b5[i - 1].c) - Math.min(b5[i].l, b5[i - 1].c); atr5 = s / 14; }
  const t60 = last != null ? bars.findLast((b) => b.t <= bars[bars.length - 1].t - 3600) : null;
  return { vwap, last, atr5, run60: t60 ? last / t60.c - 1 : null, vsVwap: vwap ? last / vwap - 1 : null };
}
// מגמה יומית: daily = [{c}] ממוינים, עד אתמול
export function dailyTrend(daily){
  if (daily.length < 51) return null;
  const c = daily.map((d) => d.c), sma = (n, end = c.length) => c.slice(end - n, end).reduce((a, x) => a + x, 0) / n;
  let atr = 0; for (let i = daily.length - 14; i < daily.length; i++) atr += Math.max(daily[i].h, c[i - 1]) - Math.min(daily[i].l, c[i - 1]);
  return { ma20: sma(20), ma50: sma(50), above20: c.at(-1) > sma(20), above50: c.at(-1) > sma(50), ma20Up: sma(20) > sma(20, c.length - 5), atrD: atr / 14, prevClose: c.at(-1) };
}

// ---------- המלצות ניהול סיכון (לא איתות רווחי) ----------
// מחזיר {stop, target, R, shares, maxLoss, note} לסיווג נתון; long = בלי סטופ (רק ריכוז)
export function recommend({ cls, entry, atr5, atrD, nav }){
  if (cls === 'long' || !(entry > 0)) return { stop: null, target: null, shares: null, note: 'השקעה לטווח ארוך — רק מעקב ריכוז' };
  const dist = cls === 'day' ? (atr5 > 0 ? RULES.stopAtr.day * atr5 : null) : (atrD > 0 ? RULES.stopAtr.swing * atrD : null);
  if (!(dist > 0)) return { stop: null, target: null, shares: null, note: 'אין מספיק נתונים לתנודתיות' };
  const stop = entry - dist, target = entry + (cls === 'day' ? RULES.targetR.day : RULES.targetR.swing) * dist;
  const shares = nav > 0 ? Math.max(0, Math.floor(Math.min(RULES.riskPct * nav / dist, RULES.capPct * nav / entry))) : null;
  return { stop, target, R: dist, shares, maxLoss: shares != null ? shares * dist : null, note: `סטופ ${cls === 'day' ? '1.5 × תנודת 5 דקות' : '2 × תנודה יומית'}, יעד ${cls === 'day' ? '2' : '3'}R, סיכון 0.5% מהחשבון` };
}

// ---------- התראות ----------
// state: {positions:[{acct,sym,qty,avg,cls,peak,last,entryT,spike}], navByAcct:{}, dayPnl, phase, now}
// מחזיר [{key, text}] — המפתח מונע כפילות (השירות שומר אילו נשלחו)
export function alerts(s){
  const out = [], navTot = Object.values(s.navByAcct).reduce((a, x) => a + (x || 0), 0), date = s.phase.date;
  const fmt = (x) => (x < 0 ? '‎−' : '+') + Math.abs(Math.round(x)).toLocaleString('en-US') + '$';
  if (navTot > 0) for (const lv of RULES.dailyLossPct) if (s.dayPnl <= -lv * navTot) out.push({ key: `loss${lv}:${date}`, text: `🔴 הפסד יומי ${fmt(s.dayPnl)} (${(s.dayPnl / navTot * 100).toFixed(1)}% משני החשבונות). הכלל: עצירה ב-1%.` });
  const bySym = new Map(); for (const p of s.positions) bySym.set(p.sym, (bySym.get(p.sym) || 0) + p.qty * (p.last ?? p.avg ?? 0) * (p.fx || 1));
  if (navTot > 0) for (const [sym, v] of bySym) for (const lv of RULES.concentrationPct) if (v >= lv * navTot) out.push({ key: `conc${lv}:${sym}:${date}`, text: `🟠 ריכוז: ${sym} = ${(v / navTot * 100).toFixed(0)}% משני החשבונות יחד (תקרה מומלצת ${RULES.capPct * 100}%).` });
  for (const p of s.positions){
    if (p.cls === 'long' || !(p.avg > 0) || p.last == null) continue;
    const peakRet = (p.peak ?? p.last) / p.avg - 1, ret = p.last / p.avg - 1, id = `${p.acct}:${p.sym}:${p.entryT || date}`;
    if (peakRet >= RULES.giveBackPeakPct && ret <= 0) out.push({ key: `giveback:${id}`, text: `🟡 ${p.sym}: הייתה ברווח של ${(peakRet * 100).toFixed(1)}% וחזרה ל-${(ret * 100).toFixed(1)}%. כדאי להחליט עכשיו: לצאת או להזיז סטופ.` });
    if (p.rec?.stop != null && p.last <= p.rec.stop) out.push({ key: `stop:${id}`, text: `🔴 ${p.sym} ירדה מתחת לסטופ המומלץ ${p.rec.stop.toFixed(2)} (עכשיו ${p.last.toFixed(2)}).` });
    if (p.spike) out.push({ key: `spike:${id}`, text: `🟠 ${p.sym}: הכניסה הייתה אחרי זינוק (${p.spike}). לפי ניתוח העסקאות שלך — זה אחד הדפוסים היקרים.` });
  }
  if (s.phase.phase === 'regular' && s.phase.closeT - s.now <= RULES.preCloseMin * 60){
    const day = s.positions.filter((p) => p.cls === 'day');
    if (day.length) out.push({ key: `preclose:${date}`, text: `⏰ ${Math.max(0, Math.round((s.phase.closeT - s.now) / 60))} דקות לסגירה${s.phase.half ? ' (יום מקוצר)' : ''}. עסקאות יומיות פתוחות: ${day.map((p) => p.sym).join(', ')}. הכלל: לא להחזיק עסקה יומית ללילה.` });
  }
  return out;
}
// זיהוי כניסה אחרי זינוק: ריצה ב-60 דקות לפני הכניסה, או מרחק מ-VWAP בזמן הכניסה
export function spikeAtEntry(stats){
  if (!stats) return null;
  if (stats.run60 != null && stats.run60 >= RULES.spikeRunPct) return `עלייה של ${(stats.run60 * 100).toFixed(1)}% בשעה שלפני`;
  if (stats.vsVwap != null && stats.vsVwap >= RULES.spikeVwapPct) return `${(stats.vsVwap * 100).toFixed(1)}% מעל המחיר הממוצע של היום`;
  return null;
}

// ---------- חלופות יציאה (מעקב וירטואלי) ----------
// עסקה שנסגרה: entry, entryT, exit (בפועל), exitT, R (מרחק הסטופ המומלץ), bars אחרי הכניסה עד סוף היום. סדר שמרני: סטופ לפני יעד.
export function exitAlternatives({ entry, entryT, exit, R, bars, closeT }){
  const after = bars.filter((b) => b.t >= entryT && b.t < closeT); if (!after.length || !(R > 0)) return null;
  const sim = (cfg) => { let stop = entry - R, hh = entry; for (const b of after){ if (b.l <= stop) return Math.min(stop, b.o); if (cfg.tR && b.h >= entry + cfg.tR * R + 0.01) return entry + cfg.tR * R; hh = Math.max(hh, b.h); if (cfg.be && hh >= entry * (1 + cfg.be)) stop = Math.max(stop, entry); if (cfg.trail) stop = Math.max(stop, hh * (1 - cfg.trail)); } return after[after.length - 1].c; };
  const r = (px) => px / entry - 1;
  return { actual: r(exit), system: r(sim({ tR: RULES.targetR.day })), eod: r(sim({})), be1: r(sim({ be: 0.01 })), trail15: r(sim({ trail: 0.015 })) };
}

// ---------- יומן וניתוח טעויות ----------
// roundTrips: [{sym, cls, entry, exit, qty, entryT, exitT, pnl, peakRet, spike, overnight, sizePct}]
export function mistakes(trips){
  const sum = (a) => a.reduce((x, t) => x + t.pnl, 0);
  const cat = [
    ['עסקה יומית שהוחזקה ללילה', (t) => t.cls === 'day' && t.overnight],
    ['עסקה שהייתה ברווח של +1% ונסגרה בהפסד', (t) => t.peakRet >= 0.01 && t.pnl < 0],
    ['כניסה אחרי זינוק', (t) => !!t.spike],
    ['פוזיציה מעל 20% מהחשבון', (t) => t.sizePct > 0.2],
  ];
  return cat.map(([name, f]) => { const x = trips.filter(f); return { name, n: x.length, pnl: sum(x) }; }).filter((c) => c.n).sort((a, b) => a.pnl - b.pnl);
}
