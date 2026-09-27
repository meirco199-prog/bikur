// צד ה-Worker של חיבור הסוכן לחשבון הדמה של IBKR, במצב "מראה" (mirror): הסימולציה ממשיכה להחליט ולמלא בעצמה;
// הגשר (scripts/ibkr-bridge.mjs) מושך את אותן פקודות, שולח אותן לדמה, ומדווח חזרה מילויים/יתרה/פוזיציות.
// כאן: מה לשלוח (pending + יציאות), רישום מה שחזר, והשוואה (reconcile) מול מילויי הסימולציה. אין שינוי מדיניות ואין מצב live.
// מפתחות KV: agent:broker:sent (מה כבר נשלח), agent:broker:<day> (מילויים/חשבון/השוואה ליום), agent:broker:latest.
import { reconcileFills } from '../engine/ibkr-map.js';
import { instrumentOf } from '../engine/instruments.js';
import { round, isNum } from '../engine/util.js';

const exitId = (j) => `agent:${j.day}:exit:${j.symbol}:${j.side}:${String(j.id || '').slice(-6)}`;

/** מה הגשר צריך לשלוח: פקודות שהוחלטו לסשן הבא + יציאות (עצירות/חיסולים) של היום האחרון, עם סימון מה כבר נשלח */
export async function brokerPending(db){
  const pending = (await db.get('agent:pending')) || { day: null, orders: [] };
  const sent = (await db.get('agent:broker:sent')) || {};
  const state = await db.get('agent:state');
  const kill = await db.get('agent:kill');
  const journal = (await db.get('agent:journal')) || [];
  const lastDay = state?.lastDay || null;
  const exits = journal.filter((j) => (j.kind === 'stop' || j.kind === 'liquidation') && j.day === lastDay).map((j) => ({ clientOrderId: exitId(j), symbol: j.symbol, side: j.side, qty: j.qty, price: j.price, reason: j.reason || j.kind, kind: j.kind, day: j.day }));
  const mark = (o) => ({ ...o, inst: instrumentOf(o.symbol) ? { class: instrumentOf(o.symbol).class, units: instrumentOf(o.symbol).units } : null, sent: sent[o.clientOrderId] || null });
  return { mode: 'mirror', day: pending.day || null, decidedAt: pending.decidedAt || null, lastDay, killSwitch: !!kill?.on, killReason: kill?.reason || null, orders: (pending.orders || []).map(mark), exits: exits.map(mark), sentCount: Object.keys(sent).length };
}

/**
 * דיווח מהגשר: { day, status:{authenticated, account}, sent:[{clientOrderId, orderId, at, symbol, side, qty}], fills:[normalizeBrokerOrder], account, positions, errors:[] }
 * שומר את היום, מסמן sent, ומשווה מול מילויי הסימולציה של אותו יום.
 */
export async function recordBroker(db, body = {}){
  const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body.day || '')) ? body.day : new Date().toISOString().slice(0, 10);
  const sent = (await db.get('agent:broker:sent')) || {};
  for (const s of body.sent || []){ if (s?.clientOrderId) sent[s.clientOrderId] = { orderId: s.orderId || null, at: s.at || new Date().toISOString(), day, symbol: s.symbol || null, side: s.side || null, qty: s.qty ?? null }; }
  const keep = Object.entries(sent).sort((a, b) => String(b[1].at).localeCompare(String(a[1].at))).slice(0, 400); // לא לגדול לנצח
  await db.put('agent:broker:sent', Object.fromEntries(keep));
  const prev = (await db.get(`agent:broker:${day}`)) || { day, fills: [], errors: [] };
  const fillsById = new Map((prev.fills || []).map((f) => [f.clientOrderId || f.orderId, f]));
  for (const f of body.fills || []){ const k = f.clientOrderId || f.orderId; if (k) fillsById.set(k, { ...(fillsById.get(k) || {}), ...f }); }
  const fills = [...fillsById.values()];
  const journal = (await db.get('agent:journal')) || [];
  const simFills = journal.filter((j) => j.kind === 'fill' && j.day === day && j.clientOrderId).map((j) => ({ clientOrderId: j.clientOrderId, symbol: j.symbol, side: j.side, qty: j.qty, price: j.price }));
  const simExits = journal.filter((j) => (j.kind === 'stop' || j.kind === 'liquidation') && j.day === day).map((j) => ({ clientOrderId: exitId(j), symbol: j.symbol, side: j.side, qty: j.qty, price: j.price }));
  const reconcile = reconcileFills([...simFills, ...simExits], fills);
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
  return { mode: 'mirror', day: latest.day, updatedAt: latest.updatedAt, staleMinutes: staleMin, authenticated: !!latest.authenticated, account: latest.account || null, broker: acct, simEquityUsd: null, positions: rec?.positions || [], fills: rec?.fills || [], reconcile: rec?.reconcile || null, errors: rec?.errors || [], sizeRatio: acct && isNum(acct.netLiquidationUsd) && state?.initialUsd ? round(acct.netLiquidationUsd / state.initialUsd, 2) : null };
}
