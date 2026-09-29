#!/usr/bin/env node
// הגשר בין הסוכן (Worker) לחשבון הדמה של IBKR. רץ על מחשב/שרת עם Client Portal Gateway מחובר (התחברות פעם אחת בדפדפן, משתמש הדמה + IB Key).
// מצב "מראה": מושך מה-Worker את הפקודות שהסימולציה החליטה, שולח אותן כפקודות שוק לדמה בשעות המסחר, ומדווח חזרה מילויים/יתרה/פוזיציות.
// אין כאן סיסמאות. סודות: BRIDGE_SECRET (אותו ערך ב-Cloudflare Worker) — מגיע ממשתני סביבה בלבד.
// שימוש: WORKER_URL=... BRIDGE_SECRET=... node invest-api/scripts/ibkr-bridge.mjs [--once] [--check] [--dry-run]
// מדריך התקנה: invest/docs/IBKR_BRIDGE.md
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { IbkrClient } from '../lib/ibkr-client.js';
import { toIbkrOrder, normalizeBrokerOrder, clipExitToHeld } from '../engine/ibkr-map.js';
import { nyParts } from '../engine/session.js';

const args = new Set(process.argv.slice(2));
const ONCE = args.has('--once'), CHECK = args.has('--check'), DRY = args.has('--dry-run') || process.env.DRY_RUN === '1';
const W = (process.env.WORKER_URL || 'https://invest-api.meirco199.workers.dev').replace(/\/$/, '');
const SECRET = process.env.BRIDGE_SECRET || '';
const GW = process.env.IBKR_GATEWAY || 'https://localhost:5000/v1/api';
const ACCT_ENV = process.env.IBKR_ACCOUNT || '';
const INTERVAL = Math.max(20, Number(process.env.INTERVAL_SEC) || 60);
const STATE_FILE = process.env.BRIDGE_STATE || `${process.env.HOME || '.'}/.bikur-bridge/state.json`;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// ה-Gateway מגיש HTTPS עם תעודה עצמית על localhost בלבד — מכבים אימות תעודה רק עבורו
if (/^https:\/\/(localhost|127\.0\.0\.1)[:/]/.test(GW) && process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

function loadState(){ try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { sent: {}, conids: {} }; } }
function saveState(s){ try { mkdirSync(STATE_FILE.replace(/\/[^/]+$/, ''), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s, null, 1)); } catch (e) { log('שמירת מצב נכשלה:', e.message); } }

async function worker(path, { method = 'GET', body } = {}){
  const sep = path.includes('?') ? '&' : '?';
  const r = await fetch(`${W}${path}${sep}secret=${encodeURIComponent(SECRET)}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Worker ${path} → ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// חלון שליחה: ימי חול, 09:31–15:50 שעון ניו יורק (פקודות שוק בלבד; לא בפתיחה עצמה ולא בדקות האחרונות)
export function inSendWindow(now = new Date()){ const p = nyParts(now); const m = p.h * 60 + p.mi; return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(p.weekday) && m >= 9 * 60 + 31 && m <= 15 * 60 + 50; }
export const nyDay = (now = new Date()) => { const p = nyParts(now); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };

async function tick(ib, state){
  const errors = [];
  await ib.tickle().catch(() => {});
  const auth = await ib.authStatus();
  if (!auth.authenticated){
    log('ה-Gateway לא מחובר — פתח בדפדפן', GW.replace(/\/v1\/api$/, ''), 'והתחבר עם משתמש הדמה');
    await worker('/agent/broker/fills', { method: 'POST', body: { day: nyDay(), status: { authenticated: false }, errors: ['gateway not authenticated'] } }).catch((e) => log(e.message));
    return;
  }
  const accts = await ib.accounts(); const acct = ACCT_ENV || accts[0]; if (!acct) throw new Error('אין חשבון ב-Gateway (התחברת עם משתמש הדמה?)');
  if (!/^DU/i.test(acct) && !process.env.ALLOW_LIVE_ACCOUNT){ throw new Error(`החשבון ${acct} לא נראה כחשבון דמה (DU...). הגשר מסרב לעבוד מול חשבון אמיתי.`); }
  const pend = await worker('/agent/broker/pending');
  const sentNow = [];
  if (pend.killSwitch){
    log('kill switch דולק:', pend.killReason || '', '— מבטל פקודות פתוחות ולא שולח חדשות');
    if (!DRY) await ib.cancelAll(acct).catch((e) => errors.push('cancelAll: ' + e.message));
  } else if (!inSendWindow()){
    log('מחוץ לחלון השליחה (09:31–15:50 ניו יורק) — רק מדווח');
  } else {
    const today = nyDay();
    // סדר: פקודות הסשן, יציאות, ואז סנכרון חד-פעמי של פוזיציות קיימות (החלטת בעל הריפו 29/9)
    const todo = [...(pend.orders || []).filter((o) => pend.day && pend.day < today), ...(pend.exits || []), ...(pend.sync || [])].filter((o) => !o.sent && !state.sent[o.clientOrderId]);
    // יציאות וסנכרון נבדקים מול מה שהדמה מחזיק בפועל (פוזיציה שנפתחה בסימולציה לפני חיבור הגשר לא קיימת בדמה — מכירה שלה הייתה פותחת שורט;
    // סנכרון לא נשלח שוב אם הדמה כבר מחזיק)
    const needHeld = todo.some((o) => o.kind === 'stop' || o.kind === 'liquidation' || o.kind === 'sync');
    const held = needHeld ? await ib.positions(acct).catch((e) => { errors.push('positions: ' + e.message); return null; }) : [];
    const skip = (o, reason) => { log('דילוג', o.symbol, reason); state.sent[o.clientOrderId] = { skipped: reason, at: new Date().toISOString() }; sentNow.push({ clientOrderId: o.clientOrderId, orderId: null, symbol: o.symbol, side: o.side, qty: 0, skipped: reason }); saveState(state); };
    for (const o of todo){
      try {
        const c = state.conids[o.symbol] || (await ib.resolveConid(o.symbol, today)); state.conids[o.symbol] = c;
        let qty = o.qty;
        const heldQty = () => held.filter((p) => Number(p.conid) === Number(c.conid)).reduce((a, p) => a + (Number(p.qty) || 0), 0);
        if (o.kind === 'stop' || o.kind === 'liquidation'){
          if (!held) throw new Error('לא ניתן לקרוא פוזיציות מהדמה — היציאה תנוסה בסבב הבא');
          const clip = clipExitToHeld(o, heldQty());
          if (!clip.ok){ skip(o, clip.reason); continue; }
          if (clip.reason) log(o.symbol, clip.reason);
          qty = clip.qty;
        } else if (o.kind === 'sync'){
          if (!held) throw new Error('לא ניתן לקרוא פוזיציות מהדמה — הסנכרון ינוסה בסבב הבא');
          const h = heldQty(), want = o.side === 'buy' ? o.qty : -o.qty;
          if ((want > 0 && h >= want) || (want < 0 && h <= want)){ skip(o, `הדמה כבר מחזיק ${h} ${o.symbol} — סנכרון מיותר`); continue; }
        }
        const b = toIbkrOrder({ order: { ...o, qty }, conid: c.conid, acctId: acct });
        if (!b.ok){ log('דילוג', o.symbol, b.reason); state.sent[o.clientOrderId] = { skipped: b.reason, at: new Date().toISOString() }; sentNow.push({ clientOrderId: o.clientOrderId, orderId: null, symbol: o.symbol, side: o.side, qty: 0, skipped: b.reason }); continue; }
        if (DRY){ log('DRY', JSON.stringify(b.order)); continue; }
        const r = await ib.placeOrder(acct, b.order);
        log('נשלח', b.order.side, b.order.quantity, o.symbol, '→', r.orderId, r.status || '');
        state.sent[o.clientOrderId] = { orderId: r.orderId, at: new Date().toISOString() };
        sentNow.push({ clientOrderId: o.clientOrderId, orderId: r.orderId, at: state.sent[o.clientOrderId].at, symbol: o.symbol, side: o.side, qty: b.order.quantity });
      } catch (e) { log('שגיאה', o.symbol, e.message); errors.push(`${o.symbol}: ${e.message.slice(0, 160)}`); }
      saveState(state);
    }
  }
  // דיווח: פקודות/מילויים של הפקודות שלנו (לפי cOID), יתרה, פוזיציות
  const ours = new Set(Object.keys(state.sent));
  const orders = (await ib.orders().catch((e) => { errors.push('orders: ' + e.message); return []; })).map(normalizeBrokerOrder).filter((o) => o.clientOrderId && ours.has(o.clientOrderId));
  const account = await ib.summary(acct).catch((e) => { errors.push('summary: ' + e.message); return null; });
  const positions = await ib.positions(acct).catch((e) => { errors.push('positions: ' + e.message); return []; });
  const rep = await worker('/agent/broker/fills', { method: 'POST', body: { day: nyDay(), status: { authenticated: true, account: acct }, sent: sentNow, fills: orders, account, positions, errors } });
  log('דווח:', JSON.stringify(rep).slice(0, 200));
}

async function main(){
  if (!SECRET && !CHECK){ console.error('חסר BRIDGE_SECRET (אותו ערך כמו ב-Cloudflare Worker). ראה invest/docs/IBKR_BRIDGE.md'); process.exit(1); }
  const ib = new IbkrClient({ base: GW, log });
  if (CHECK){ const a = await ib.authStatus(); console.log(JSON.stringify({ gateway: GW, ...a, accounts: a.authenticated ? await ib.accounts().catch(() => []) : [] }, null, 1)); return; }
  const state = loadState();
  log('גשר IBKR (מצב מראה) →', W, '| gateway', GW, DRY ? '| DRY RUN' : '');
  for (;;){
    try { await tick(ib, state); } catch (e) { log('tick נכשל:', e.message); }
    if (ONCE) break;
    await new Promise((r) => setTimeout(r, INTERVAL * 1000));
  }
}
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
