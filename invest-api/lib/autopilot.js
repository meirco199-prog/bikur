// הרצת האוטומט על חשבון התרגול: קורא דירוג + משטר + חשבון, מחליט לפי engine/autopilot.js, מבצע דרך PaperBroker,
// ורושם יומן (append-only, מוגבל ל-400 רשומות). פעם ביום לכל היותר אלא אם force.
import { decideOrders, AUTO_RULES } from '../engine/autopilot.js';
import { PaperBroker } from './broker.js';
import { getUniverse, getQuote, latestRankDay, assetMeta } from './analysis.js';
import { round, isNum } from '../engine/util.js';

const JOURNAL_MAX = 400;

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
  const decision = decideOrders({ table, regime, perf, profile, fx, today: day });
  const u = await getUniverse(db, env);
  const nameOf = (s) => { const a = u.find((x) => x.symbol === s); return a?.nameHe || a?.name || s; };
  const entry = { ts: new Date().toISOString(), day, trigger, dry, executed: !dry, profile, rulesVersion: AUTO_RULES.version, regime: regime ? { trend: regime.trend, risk: regime.risk, summary: regime.summary } : null, before: { totalIls: round(perf.totalIls, 0), cashIls: round(perf.cashIls, 0), positions: perf.positions.length }, notes: [...legacyNotes, ...decision.notes], skipped: decision.skipped.slice(0, 12), orders: [] };
  for (const o of decision.orders){
    const rec = { ...o, name: nameOf(o.symbol) };
    if (!dry){
      try {
        const asset = await assetMeta(db, o.symbol);
        let price = o.priceRef, priceSource = { source: 'rank close', asOf: day };
        try { const qt = await getQuote(o.symbol, { ...ctx, asset }); if (qt && !qt.missing && isNum(qt.price) && qt.price > 0){ price = qt.price; priceSource = { source: qt.source, asOf: qt.asOf, stale: !!qt.stale }; } } catch {}
        // שער חי שסוטה מאוד מהסגירה (טעות ספק) — לא סוחרים עליו
        if (Math.abs(price / o.priceRef - 1) > 0.25){ rec.error = `שער חי ${price} רחוק מדי מהסגירה ${o.priceRef} — דילוג`; entry.orders.push(rec); continue; }
        const r = await broker.placeOrder({ symbol: o.symbol, side: o.side, qty: o.qty, price, currency: o.currency || asset.currency || 'USD', fx, reason: `אוטומט: ${o.reason}`, signal: table.find((x) => x.symbol === o.symbol)?.signal || null, snapDate: day, priceSource });
        rec.price = price; rec.priceSource = priceSource; rec.ok = true;
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
