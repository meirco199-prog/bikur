// הרצת האוטומט על חשבון התרגול: קורא דירוג + משטר + חשבון, מחליט לפי engine/autopilot.js, מבצע דרך PaperBroker,
// ורושם יומן (append-only, מוגבל ל-400 רשומות). פעם ביום לכל היותר אלא אם force.
import { decideOrders, AUTO_RULES } from '../engine/autopilot.js';
import { PaperBroker } from './broker.js';
import { getUniverse, getQuote, latestRankDay, assetMeta } from './analysis.js';
import { round, isNum } from '../engine/util.js';

const JOURNAL_MAX = 400;

// חלון ביצוע: שעות המסחר הרגילות בניו יורק (09:40–15:45 ET, ב'–ו'), מחושב לפי אזור הזמן America/New_York ולא לפי שעון ישראל
export function nyClock(now = new Date()){
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  const h = +get('hour') % 24, m = +get('minute');
  return { weekday: get('weekday'), minutes: h * 60 + m, text: `${get('weekday')} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} ET` };
}
export function inTradingWindow(now = new Date(), { start = 9 * 60 + 40, end = 15 * 60 + 45 } = {}){
  const c = nyClock(now);
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(c.weekday) && c.minutes >= start && c.minutes <= end;
}

export async function autoStatus(db){
  const st = (await db.get('user:settings')) || {};
  const journal = (await db.get('auto:journal')) || [];
  return { enabled: st.autopilot !== false, profile: st.riskProfile || 'balanced', last: journal[journal.length - 1] || null, journal: journal.slice(-40).reverse(), rules: AUTO_RULES };
}

export async function runAutopilot(ctx, { dry = false, force = false, trigger = 'manual' } = {}){
  const { db, env } = ctx;
  const st = (await db.get('user:settings')) || {};
  if (st.autopilot === false && !force) return { ran: false, reason: 'האוטומט כבוי בהגדרות' };
  const day = await latestRankDay(db);
  if (!day) return { ran: false, reason: 'אין דירוג עדיין' };
  const journal = (await db.get('auto:journal')) || [];
  const already = journal.find((j) => j.day === day && j.executed && (j.rulesVersion || 1) === AUTO_RULES.version);
  if (already && !force && !dry) return { ran: false, reason: `כבר רץ היום (${day})`, last: already };
  // ביצוע רק בשעות המסחר הרגילות בניו יורק (לא overnight); AUTO_ANY_TIME=1 רק לבדיקות
  const gate = env.AUTO_ANY_TIME !== '1' && !dry;
  if (gate && !inTradingWindow()) return { ran: false, reason: `מחוץ לשעות המסחר בניו יורק (${nyClock().text}) — הביצוע בחלון 09:40–15:45 ET`, deferred: true };
  if (gate){ // חג/שוק סגור לפי הספק: SPY חייב להיות פתוח
    try { const spy = await getQuote('SPY', { ...ctx, asset: await assetMeta(db, 'SPY') }); if (spy && spy.isMarketOpen === false) return { ran: false, reason: 'השוק האמריקאי סגור לפי הספק (חג?) — מנסים שוב במחזור הבא', deferred: true }; } catch {}
  }
  const rank = await db.get(`rank:${day}`);
  const regime = (await db.get(`regime:${day}`)) || null;
  const fxDoc = await db.get('fx:USDILS'); const fx = fxDoc?.rate || 3.7;
  const broker = new PaperBroker(db);
  const legacyNotes = [];
  if (!dry){ // מצב ירושה: קניות מלפני מגבלת המזומן (מזומן שלילי) — החשבון לא לגיטימי, מאפסים פעם אחת עם ארכוב
    const acc = await broker.account(st.portfolioSize || 200000);
    if (acc.cashIls < 0){ await broker.reset(acc.initialIls || st.portfolioSize || 200000); legacyNotes.push(`החשבון אופס ל-${Math.round(acc.initialIls || 200000).toLocaleString('en-US')} ₪: היו בו קניות מלפני מגבלת המזומן (מזומן שלילי). הרישומים הישנים נשמרו בארכיון.`); }
  }
  const table = rank?.table || [];
  const priceOf = (s) => table.find((r) => r.symbol === s)?.price ?? null;
  const perf = await broker.performance(priceOf, fx);
  const profile = st.riskProfile || 'balanced';
  const buysToday = journal.filter((j) => j.day === day && j.executed).reduce((n, j) => n + (j.orders || []).filter((o) => o.side === 'buy' && o.ok).length, 0);
  const boughtToday = [...new Set(journal.filter((j) => j.day === day && j.executed).flatMap((j) => (j.orders || []).filter((o) => o.side === 'buy' && o.ok).map((o) => o.symbol)))];
  const decision = decideOrders({ table, regime, perf, profile, fx, today: day, buysToday, boughtToday });
  const u = await getUniverse(db, env);
  const nameOf = (s) => { const a = u.find((x) => x.symbol === s); return a?.nameHe || a?.name || s; };
  const entry = { ts: new Date().toISOString(), day, trigger, dry, executed: !dry, profile, rulesVersion: AUTO_RULES.version, regime: regime ? { trend: regime.trend, risk: regime.risk, summary: regime.summary } : null, before: { totalIls: round(perf.totalIls, 0), cashIls: round(perf.cashIls, 0), positions: perf.positions.length }, notes: [...legacyNotes, ...decision.notes], skipped: decision.skipped.slice(0, 12), orders: [] };
  for (const o of decision.orders){
    const rec = { ...o, name: nameOf(o.symbol) };
    if (!dry){
      try {
        const asset = await assetMeta(db, o.symbol);
        let price = o.priceRef, priceSource = { source: 'rank close', asOf: day };
        let qt = null;
        try { qt = await getQuote(o.symbol, { ...ctx, asset }); if (qt && !qt.missing && isNum(qt.price) && qt.price > 0){ price = qt.price; priceSource = { source: qt.source, asOf: qt.asOf, stale: !!qt.stale, marketOpen: qt.isMarketOpen ?? null }; } } catch {}
        // fail-closed: בלי שער חי מהיום (או שער ישן/שוק סגור) לא מבצעים
        if (gate && (!qt || qt.missing || qt.stale || qt.isMarketOpen === false)){ rec.error = !qt || qt.missing ? 'אין שער חי — לא מבצעים (fail-closed)' : qt.isMarketOpen === false ? 'השוק סגור לנייר הזה' : 'שער ישן — לא מבצעים'; entry.orders.push(rec); continue; }
        // שער חי שסוטה מאוד מהסגירה (טעות ספק) — לא סוחרים עליו
        if (Math.abs(price / o.priceRef - 1) > 0.25){ rec.error = `שער חי ${price} רחוק מדי מהסגירה ${o.priceRef} — דילוג`; entry.orders.push(rec); continue; }
        // סימולציה פנימית (לא ברוקר): מילוי במחיר הספק + החלקה שמרנית של 5 נקודות בסיס. נרשמים בנפרד: מחיר ההחלטה (סגירה
        // שעליה נוצר הסיגנל), מחיר השליחה (ציטוט), מחיר המילוי, וההחלקה — כדי שבחיבור לברוקר אמיתי יהיה למה להשוות.
        const SLIP = 0.0005;
        const fill = round(o.side === 'buy' ? price * (1 + SLIP) : price * (1 - SLIP), 4);
        const r = await broker.placeOrder({ symbol: o.symbol, side: o.side, qty: o.qty, price: fill, currency: o.currency || asset.currency || 'USD', fx, reason: `אוטומט: ${o.reason}`, signal: table.find((x) => x.symbol === o.symbol)?.signal || null, snapDate: day, priceSource });
        rec.price = fill; rec.priceSource = priceSource; rec.ok = true;
        rec.execution = { venue: 'simulated', decisionPrice: o.priceRef, submittedPrice: price, fillPrice: fill, slippagePct: SLIP, slippageIls: round(o.qty * Math.abs(fill - price) * (o.currency === 'ILS' ? 1 : fx), 2), quoteAsOf: qt?.asOf || null, marketOpen: qt?.isMarketOpen ?? null, orderType: 'market (simulated)', bid: null, ask: null, spread: null, fillLatencyMs: 0, partial: false };
        if (o.side === 'buy') rec.costIls = r.trade.costIls; else { rec.proceedsIls = r.proceedsIls; rec.pnlIls = round(r.closed.reduce((s, x) => s + (x.pnlIls || 0), 0), 0); }
      } catch (e) { rec.error = e.message; }
    }
    entry.orders.push(rec);
  }
  if (!dry){
    const after = await broker.performance(priceOf, fx);
    entry.after = { totalIls: round(after.totalIls, 0), cashIls: round(after.cashIls, 0), positions: after.positions.length };
    journal.push(entry);
    await db.put('auto:journal', journal.slice(-JOURNAL_MAX));
  }
  return { ran: true, day, ...entry, rules: decision.rules };
}
