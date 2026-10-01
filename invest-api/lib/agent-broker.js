// צד ה-Worker של חיבור הסוכן לחשבון הדמה של IBKR, במצב "מראה" (mirror): הסימולציה ממשיכה להחליט ולמלא בעצמה;
// הגשר (scripts/ibkr-bridge.mjs) מושך את אותן פקודות, שולח אותן לדמה, ומדווח חזרה מילויים/יתרה/פוזיציות.
// כאן: מה לשלוח (pending + יציאות), רישום מה שחזר, והשוואה (reconcile) מול מילויי הסימולציה. אין שינוי מדיניות ואין מצב live.
// מפתחות KV: agent:broker:sent (מה כבר נשלח), agent:broker:<day> (מילויים/חשבון/השוואה ליום), agent:broker:latest,
// agent:broker:sync (סנכרון חד-פעמי של פוזיציות קיימות לדמה — החלטת בעל הריפו 29/9).
import { reconcileFills } from '../engine/ibkr-map.js';
import { instrumentOf } from '../engine/instruments.js';
import { registerAgentStocks } from './agent-stocks.js';
import { round, isNum } from '../engine/util.js';

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
  const orders = Object.entries(state?.positions || {}).map(([symbol, p]) => {
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
  const exits = journal.filter((j) => (j.kind === 'stop' || j.kind === 'liquidation') && j.day === lastDay).map((j) => ({ clientOrderId: exitId(j), symbol: j.symbol, side: j.side, qty: j.qty, price: j.price, reason: j.reason || j.kind, kind: j.kind, day: j.day }));
  const mark = (o) => ({ ...o, inst: instrumentOf(o.symbol) ? { class: instrumentOf(o.symbol).class, units: instrumentOf(o.symbol).units } : null, sent: sent[o.clientOrderId] || null });
  return { mode: 'mirror', day: pending.day || null, decidedAt: pending.decidedAt || null, lastDay, killSwitch: !!kill?.on, killReason: kill?.reason || null, orders: (pending.orders || []).map(mark), exits: exits.map(mark), sync: (sync?.orders || []).map(mark), syncDay: sync?.day || null, sentCount: Object.keys(sent).length };
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
  const simExits = journal.filter((j) => (j.kind === 'stop' || j.kind === 'liquidation') && j.day === day).map((j) => ({ clientOrderId: exitId(j), symbol: j.symbol, side: j.side, qty: j.qty, price: j.price }));
  const sync = (await db.get('agent:broker:sync')) || null; // פקודות סנכרון: ההשוואה מול הסימון האחרון בסימולציה (לא מול מחיר כניסה ישן)
  const simSync = (sync?.orders || []).filter((o) => sent[o.clientOrderId]?.day === day).map((o) => ({ clientOrderId: o.clientOrderId, symbol: o.symbol, side: o.side, qty: o.qty, price: o.price }));
  const reconcile = reconcileFills([...simFills, ...simExits, ...simSync], fills);
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
  return { mode: 'mirror', day: latest.day, updatedAt: latest.updatedAt, staleMinutes: staleMin, authenticated: !!latest.authenticated, account: latest.account || null, broker: acct, simEquityUsd: null, sync: syncInfo, positions: rec?.positions || [], fills: rec?.fills || [], reconcile: rec?.reconcile || null, errors: rec?.errors || [], sizeRatio: acct && isNum(acct.netLiquidationUsd) && state?.initialUsd ? round(acct.netLiquidationUsd / state.initialUsd, 2) : null };
}
