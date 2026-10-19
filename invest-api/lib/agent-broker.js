// צד ה-Worker של חיבור הסוכן לחשבון הדמה של IBKR, במצב "מראה" (mirror): הסימולציה ממשיכה להחליט ולמלא בעצמה;
// הגשר (scripts/ibkr-bridge.mjs) מושך את אותן פקודות, שולח אותן לדמה, ומדווח חזרה מילויים/יתרה/פוזיציות.
// כאן: מה לשלוח (pending + יציאות), רישום מה שחזר, והשוואה (reconcile) מול מילויי הסימולציה. אין שינוי מדיניות ואין מצב live.
// מפתחות KV: agent:broker:sent (מה כבר נשלח), agent:broker:<day> (מילויים/חשבון/השוואה ליום), agent:broker:latest,
// agent:broker:sync (סנכרון חד-פעמי של פוזיציות קיימות לדמה — החלטת בעל הריפו 29/9), agent:broker:cleanup (סגירה חד-פעמית של פוזיציות יתומות).
import { reconcileFills } from '../engine/ibkr-map.js';
import { instrumentOf } from '../engine/instruments.js';
import { registerAgentStocks } from './agent-stocks.js';
import { isOptionSymbol, parseOptionSymbol } from '../engine/options.js';
import { round, isNum } from '../engine/util.js';
import { UNWIND_KIND } from './agent.js';

const notOpt = (o) => !isOptionSymbol(o?.symbol);   // סנכרון חד-פעמי של פוזיציות קיימות לא כולל אופציות (הן נשלחות רק כפקודות מהסוכן)
const EXIT_KINDS = ['stop', 'liquidation', 'option-exit', UNWIND_KIND];
// סגירות של פוזיציה יתומה נשלחות לגשר כ-kind=stop: הגשר שכבר רץ על השרת חותך יציאת stop למה שהדמה מחזיק בפועל (clipExitToHeld) —
// כך גם גשר שלא עודכן לא יכול לפתוח שורט מסגירה כזו. orphan=true מסמן אותן בדוח/ביומן של הגשר.
const forBridge = (o) => (o.kind === UNWIND_KIND || o.kind === 'orphan' ? { ...o, kind: 'stop', orphan: true } : o);
const exitId = (j) => `agent:${j.day}:exit:${j.symbol}:${j.side}:${String(j.id || '').slice(-6)}`;

const syncId = (day, p) => `agent:sync:${day}:${p.symbol}:${p.side}`;

/**
 * סנכרון חד-פעמי (החלטת בעל הריפו 29/9: "כן"): הדמה קיבל רק פקודות מאז חיבור הגשר, אז הפוזיציות שהסימולציה פתחה לפני כן
 * לא קיימות בו. הבקשה מצלמת את הפוזיציות הפתוחות של הסוכן כפקודות פתיחה לדמה (שוק, במחירי היום — לא במחירי הכניסה של הסימולציה),
 * והגשר שולח אותן בחלון המסחר הבא, פעם אחת (מזהה קבוע → אידמפוטנטי; מדלג אם הדמה כבר מחזיק). price = הסימון האחרון בסימולציה, לצורך ההשוואה.
 * off → ביטול הבקשה (מה שכבר נשלח לא מתבטל).
 */
export async function requestBrokerSync(db, { day = null, off = false } = {}){
  if (off){ await db.delete('agent:broker:sync'); return { ok: true, off: true }; }
  const state = await db.get('agent:state');
  await registerAgentStocks(db, { state });
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? day : new Date().toISOString().slice(0, 10);
  const orders = Object.entries(state?.positions || {}).filter(([symbol]) => !isOptionSymbol(symbol)).map(([symbol, p]) => {   // אופציות: סימולציה בלבד (שלב א'), לא נשלחות לדמה
    const qty = Math.abs(Number(p.qty) || 0); if (!(qty > 0) || !instrumentOf(symbol)) return null;
    const side = Number(p.qty) > 0 ? 'buy' : 'short';
    return { clientOrderId: syncId(d, { symbol, side }), symbol, side, qty, price: p.lastMark ?? p.avg ?? null, simAvg: p.avg ?? null, strategy: p.strategy || null, kind: 'sync', day: d, reason: 'סנכרון פוזיציה קיימת לדמה' };
  }).filter(Boolean);
  const rec = { day: d, requestedAt: new Date().toISOString(), orders };
  await db.put('agent:broker:sync', rec);
  return { ok: true, day: d, count: orders.length, orders: orders.map((o) => `${o.side} ${o.qty} ${o.symbol}`) };
}

/** מה הגשר צריך לשלוח: פקודות שהוחלטו לסשן הבא + יציאות (עצירות/חיסולים) של היום האחרון + סנכרון חד-פעמי, עם סימון מה כבר נשלח */
export async function brokerPending(db){
  const pending = (await db.get('agent:pending')) || { day: null, orders: [] };
  const sent = (await db.get('agent:broker:sent')) || {};
  const state = await db.get('agent:state');
  await registerAgentStocks(db, { state, pending }); // מניות: הגשר מקבל class=stock ב-inst ורושם אותן אצלו
  const kill = await db.get('agent:kill');
  const journal = (await db.get('agent:journal')) || [];
  const sync = (await db.get('agent:broker:sync')) || null;
  const lastDay = state?.lastDay || null;
  const exits = journal.filter((j) => EXIT_KINDS.includes(j.kind) && j.day === lastDay).map((j) => ({ clientOrderId: exitId(j), symbol: j.symbol, side: j.side, qty: j.qty, price: j.price, reason: j.reason || j.kind, kind: j.kind, day: j.day }));
  const cleanup = (await db.get('agent:broker:cleanup'))?.orders || [];   // סגירה חד-פעמית של יתומות (requestOrphanCleanup)
  const optInst = (symbol) => { const p = parseOptionSymbol(symbol); return p ? { class: 'option', units: 100, option: p } : null; };   // אופציה: הבסיס/פקיעה/strike לגשר
  const mark = (o) => ({ ...o, inst: optInst(o.symbol) || (instrumentOf(o.symbol) ? { class: instrumentOf(o.symbol).class, units: instrumentOf(o.symbol).units } : null), sent: sent[o.clientOrderId] || null });
  const eqSeries = (await db.get('agent:equity')) || [];
  const simEquityUsd = eqSeries.length ? (eqSeries[eqSeries.length - 1]?.[3]?.equityUsd ?? null) : null;   // גודל הסימולציה: הגשר החי מתאים לפיו את גודל הפקודות
  return { mode: 'mirror', simEquityUsd, day: pending.day || null, decidedAt: pending.decidedAt || null, lastDay, killSwitch: !!kill?.on, killReason: kill?.reason || null, orders: (pending.orders || []).map(mark), exits: [...exits, ...cleanup].map(forBridge).map(mark), sync: (sync?.orders || []).filter(notOpt).map(mark), syncDay: sync?.day || null, sentCount: Object.keys(sent).length };
}

/**
 * דיווח מהגשר: { day, status:{authenticated, account}, sent:[{clientOrderId, orderId, at, symbol, side, qty}], fills:[normalizeBrokerOrder], account, positions, errors:[] }
 * שומר את היום, מסמן sent, ומשווה מול מילויי הסימולציה של אותו יום.
 */
export async function recordBroker(db, body = {}){
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body.day || '')) ? body.day : new Date().toISOString().slice(0, 10);
  const sent = (await db.get('agent:broker:sent')) || {};
  for (const s of body.sent || []){ if (s?.clientOrderId) sent[s.clientOrderId] = { orderId: s.orderId || null, at: s.at || new Date().toISOString(), day, symbol: s.symbol || null, side: s.side || null, qty: s.qty ?? null, ...(s.skipped ? { skipped: s.skipped } : {}) }; }
  const keep = Object.entries(sent).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 400); // לא לגדול לנצח
  await db.put('agent:broker:sent', Object.fromEntries(keep));
  const prev = (await db.get(`agent:broker:${day}`)) || { day, fills: [], errors: [] };
  const fillsById = new Map((prev.fills || []).map((f) => [f.clientOrderId || f.orderId, f]));
  for (const f of body.fills || []){ const k = f.clientOrderId || f.orderId; if (k) fillsById.set(k, { ...(fillsById.get(k) || {}), ...f }); }
  const fills = [...fillsById.values()];
  const journal = (await db.get('agent:journal')) || [];
  const simFills = journal.filter((j) => j.kind === 'fill' && j.day === day && j.clientOrderId).map((j) => ({ clientOrderId: j.clientOrderId, symbol: j.symbol, side: j.side, qty: j.qty, price: j.price }));
  const simExits = journal.filter((j) => EXIT_KINDS.includes(j.kind) && j.day === day).map((j) => ({ clientOrderId: exitId(j), symbol: j.symbol, side: j.side, qty: j.qty, price: j.price }));
  const sync = (await db.get('agent:broker:sync')) || null; // פקודות סנכרון: ההשוואה מול הסימון האחרון בסימולציה (לא מול מחיר כניסה ישן)
  const simSync = (sync?.orders || []).filter((o) => sent[o.clientOrderId]?.day === day).map((o) => ({ clientOrderId: o.clientOrderId, symbol: o.symbol, side: o.side, qty: o.qty, price: o.price }));
  const cleanup = ((await db.get('agent:broker:cleanup'))?.orders || []).filter((o) => sent[o.clientOrderId]?.day === day).map((o) => ({ clientOrderId: o.clientOrderId, symbol: o.symbol, side: o.side, qty: o.qty, price: null }));
  const reconcile = reconcileFills([...simFills, ...simExits, ...simSync, ...cleanup], fills);
  const rec = { day, updatedAt: new Date().toISOString(), status: body.status || prev.status || null, account: body.account || prev.account || null, positions: Array.isArray(body.positions) ? body.positions : (prev.positions || []), fills, errors: [...(prev.errors || []), ...(body.errors || [])].slice(-30), reconcile };
  await db.put(`agent:broker:${day}`, rec, { ttl: 60 * 86400 });
  await db.put('agent:broker:latest', { day, updatedAt: rec.updatedAt, authenticated: !!body.status?.authenticated, account: body.status?.account || null });
  return { ok: true, day, sent: Object.keys(sent).length, fills: fills.length, reconcile: reconcile.summary };
}

/** דוח ציבורי: מצב הגשר, היום האחרון שדווח, השוואה, וגודל החשבון בדמה מול הסימולציה */
export async function brokerReport(db){
  const latest = await db.get('agent:broker:latest');
  if (!latest) return { missing: true, reason: 'הגשר ל-IBKR עוד לא דיווח (ראה invest/docs/IBKR_BRIDGE.md)', mode: 'mirror' };
  const rec = (await db.get(`agent:broker:${latest.day}`)) || null;
  const state = await db.get('agent:state');
  const staleMin = latest.updatedAt ? Math.round((Date.now() - Date.parse(latest.updatedAt)) / 60000) : null;
  const acct = rec?.account || null;
  const sync = (await db.get('agent:broker:sync')) || null; const sent = (await db.get('agent:broker:sent')) || {};
  const syncInfo = sync ? { day: sync.day, requestedAt: sync.requestedAt, total: (sync.orders || []).length, sent: (sync.orders || []).filter((o) => sent[o.clientOrderId] && !sent[o.clientOrderId].skipped).length, skipped: (sync.orders || []).filter((o) => sent[o.clientOrderId]?.skipped).length } : null;
  const orphans = rec ? (await findOrphans(db, { positions: rec.positions, state, sent })).orphans : [];
  return { mode: 'mirror', day: latest.day, updatedAt: latest.updatedAt, staleMinutes: staleMin, authenticated: !!latest.authenticated, account: latest.account || null, broker: acct, simEquityUsd: null, sync: syncInfo, orphans, positions: rec?.positions || [], fills: rec?.fills || [], reconcile: rec?.reconcile || null, errors: rec?.errors || [], sizeRatio: acct && isNum(acct.netLiquidationUsd) && state?.initialUsd ? round(acct.netLiquidationUsd / state.initialUsd, 2) : null };
}

/**
 * פוזיציות יתומות: מה שהדמה מחזיק מעבר למה שהסימולציה (מקור האמת) מחזיקה + פקודות שהגשר כבר שלח והסימולציה תמלא הלילה.
 * רק מניות/ETF (STK) שהסוכן עצמו שלח עליהן פקודה (agent:broker:sent) — לא נוגעים בנייר שלא הגיע מהסוכן. סימבול עם פקודה/יציאה
 * שעוד לא נשלחה היום מסומן inFlight ולא נסגר (הזרימה הרגילה מטפלת בו; אפשר לבקש שוב אחר כך).
 * excess חיובי = לונג עודף (sell), שלילי = שורט עודף (cover). כמויות שלמות כמו בגשר (ibkrQty מעגל למטה).
 */
export async function findOrphans(db, { positions = null, state = null, sent = null, pending = null } = {}){
  const latest = await db.get('agent:broker:latest');
  const rec = positions ? null : (latest ? await db.get(`agent:broker:${latest.day}`) : null);
  const pos = positions || rec?.positions || [];
  const st = state || (await db.get('agent:state')) || { positions: {} };
  const snt = sent || (await db.get('agent:broker:sent')) || {};
  const pend = pending || (await db.get('agent:pending')) || { orders: [] };
  const journal = (await db.get('agent:journal')) || [];
  const isSent = (id) => !!(snt[id] && !snt[id].skipped);
  const bySymSent = new Set(Object.values(snt).filter((s) => s && !s.skipped && s.symbol).map((s) => s.symbol));
  const signedFloor = (q) => Math.sign(q) * Math.floor(Math.abs(q) + 1e-9);
  const expected = {}, inFlight = new Set();
  for (const [sym, p] of Object.entries(st.positions || {})) if (!isOptionSymbol(sym)) expected[sym] = (expected[sym] || 0) + signedFloor(Number(p.qty) || 0);
  for (const o of pend.orders || []){
    if (isOptionSymbol(o.symbol)) continue;
    if (isSent(o.clientOrderId)) expected[o.symbol] = (expected[o.symbol] || 0) + signedFloor((o.side === 'buy' ? 1 : -1) * (Number(o.qty) || 0));
    else inFlight.add(o.symbol);
  }
  const lastDay = st.lastDay || null;
  for (const j of journal) if (EXIT_KINDS.includes(j.kind) && j.day === lastDay && !isSent(exitId(j))) inFlight.add(j.symbol);
  const orphans = [];
  for (const p of pos){
    if (p?.secType && p.secType !== 'STK') continue;
    const sym = p?.symbol, q = Number(p?.qty) || 0;
    if (!sym || !q || isOptionSymbol(sym) || !bySymSent.has(sym)) continue;
    const exp = expected[sym] || 0;
    // עודף באותו כיוון, או כל הפוזיציה כשהכיוון הפוך / הסימולציה לא מחזיקה
    const excess = Math.sign(q) === Math.sign(exp) ? (Math.abs(q) > Math.abs(exp) ? q - exp : 0) : q;
    if (!excess) continue;
    orphans.push({ symbol: sym, brokerQty: q, simQty: round(Number(st.positions?.[sym]?.qty) || 0, 4), expectedQty: exp, excess, side: excess > 0 ? 'sell' : 'cover', qty: Math.abs(excess), inFlight: inFlight.has(sym) });
  }
  return { day: latest?.day || null, updatedAt: latest?.updatedAt || null, orphans };
}

/**
 * סגירה חד-פעמית של הפוזיציות היתומות שכבר בדמה (ops: broker-orphans <ts> [off]). הגשר שולח אותן בחלון המסחר הבא, פעם אחת
 * (מזהה קבוע agent:orphan:<יום>:<סימבול>:<צד>), כפקודת יציאה שנחתכת למה שמוחזק. inFlight לא נכלל. off → ביטול מה שטרם נשלח.
 */
export async function requestOrphanCleanup(db, { day = null, off = false } = {}){
  if (off){ await db.delete('agent:broker:cleanup'); return { ok: true, off: true }; }
  const f = await findOrphans(db);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? day : new Date().toISOString().slice(0, 10);
  const orders = f.orphans.filter((o) => !o.inFlight).map((o) => ({ clientOrderId: `agent:orphan:${d}:${o.symbol}:${o.side}`, symbol: o.symbol, side: o.side, qty: o.qty, price: null, kind: 'orphan', day: d, reason: `פוזיציה יתומה: בדמה ${o.brokerQty}, בסימולציה ${o.simQty} — סגירת ההפרש` }));
  await db.put('agent:broker:cleanup', { day: d, requestedAt: new Date().toISOString(), brokerDay: f.day, orders });
  return { ok: true, day: d, brokerDay: f.day, count: orders.length, orders: orders.map((o) => `${o.side} ${o.qty} ${o.symbol}`), skippedInFlight: f.orphans.filter((o) => o.inFlight).map((o) => o.symbol) };
}
