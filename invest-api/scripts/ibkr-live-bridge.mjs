#!/usr/bin/env node
// גשר לחשבון האמיתי של IBKR (מאיר, 10/10/2026: "תכין גשר לאמיתי"). **כבוי כברירת מחדל**: בלי LIVE_ACCOUNT + LIVE_APPROVAL (hash המגבלות) + LIVE_ARMED_UNTIL
// בתוקף הוא רק קורא את החשבון ומדווח — לא שולח פקודה. מגבלות: engine/live-limits.js (CODEOWNERS). מדריך: invest/docs/LIVE_BRIDGE.md.
// עיקרון: הסימולציה מחליטה (כמו בדמה), הגשר מתאים לגודל החשבון, מעביר כל פקודה בשער החי, ושולח LMT בלבד על ציטוט בזמן אמת.
// הגשר הזה נפרד מגשר הדמה (ibkr-bridge.mjs, שמסרב לחשבון שאינו DU): Gateway נפרד (פורט 5001), state נפרד, ודיווח נפרד ל-/agent/live/report (פרטי).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { IbkrClient } from '../lib/ibkr-client.js';
import { normalizeBrokerOrder } from '../engine/ibkr-map.js';
import { instrumentOf } from '../engine/instruments.js';
import { nyParts } from '../engine/session.js';
import { LIVE_LIMITS, liveHash, checkArming, assertLiveAccount, scaleQty, liveLimitPrice, gateLiveOrder, stopOuts, liveOrderBody } from '../engine/live-limits.js';

const nyDay = (now = new Date()) => { const p = nyParts(now); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
// חלון שליחה: ימי חול 09:35–15:45 שעון ניו יורק (לא בפתיחה ולא בסגירה)
export function inLiveWindow(now = new Date()){ const p = nyParts(now); const m = p.h * 60 + p.mi; return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(p.weekday) && m >= 9 * 60 + 35 && m <= 15 * 60 + 45; }
const mask = (a) => (a ? `${String(a).slice(0, 1)}…${String(a).slice(-3)}` : null);

/**
 * סבב אחד. תלויות מוזרקות לבדיקות: ib (IbkrClient), worker(path, opts), env, now, killFile() → bool, log.
 * מחזיר את הדיווח שנשלח ל-Worker. state משתנה במקום (הקורא שומר אותו).
 */
export async function liveTick({ ib, state, worker, env = {}, now = new Date(), killFile = () => false, log = () => {}, dry = false }){
  const errors = [], sentNow = [], skipped = [];
  const day = nyDay(now);
  state.sent ||= {}; state.conids ||= {};
  await ib.tickle().catch(() => {});
  const auth = await ib.authStatus();
  if (!auth.authenticated){
    const rep = { day, at: now.toISOString(), authenticated: false, armed: false, errors: ['gateway not authenticated — נדרשת התחברות/אישור IB Key'], limitsHash: liveHash() };
    await postReport(rep, { state, worker, now, log });
    return rep;
  }
  if (!/^U\d{5,}$/i.test(String(env.LIVE_ACCOUNT || ''))){   // לא הוגדר חשבון אמיתי מאושר → לא נוגעים באף חשבון
    const rep = { day, at: now.toISOString(), authenticated: true, mode: 'unconfigured', armed: false, armReasons: ['LIVE_ACCOUNT לא הוגדר'], limitsHash: liveHash(), errors: [] };
    await postReport(rep, { state, worker, now, log });
    return rep;
  }
  const accts = await ib.accounts();
  const acct = accts.find((a) => String(a).toUpperCase() === String(env.LIVE_ACCOUNT || '').toUpperCase());
  assertLiveAccount(acct, env.LIVE_ACCOUNT);   // זורק אם החשבון המחובר שונה מהמאושר (או דמה)
  const summary = await ib.summary(acct);
  const positions = (await ib.positions(acct)).filter((p) => p.qty).map((p) => ({ ...p, symbol: String(p.symbol || '').toUpperCase(), valueUsd: p.marketValueUsd }));
  const equity = Number(summary.netLiquidationUsd), cash = Number(summary.cashUsd);
  if (state.day !== day){ state.day = day; state.dayStartEquityUsd = equity; state.opensToday = 0; }
  state.hwmUsd = Math.max(Number(state.hwmUsd) || 0, equity || 0);
  const account = { equityUsd: equity, cashUsd: cash, dayStartEquityUsd: state.dayStartEquityUsd, hwmUsd: state.hwmUsd };

  const pend = await worker('/agent/broker/pending');
  const killed = !!pend.killSwitch || killFile();
  const arming = checkArming({ env, now });
  let mode = 'disarmed';
  if (killed){
    mode = 'killed';
    log('kill switch — מבטל פקודות פתוחות ולא שולח חדשות');
    // מבטלים רק פקודות שהגשר עצמו שלח (cOID ב-state.sent) — לא פקודות ידניות של בעל החשבון — וגם כשהגשר לא מופעל (פקודה שנשארה מהפעלה קודמת)
    if (!dry){
      try {
        const mine = new Set(Object.keys(state.sent));
        const open = (await ib.orders()).map(normalizeBrokerOrder).filter((o) => o.clientOrderId && mine.has(o.clientOrderId) && /submitted|presubmitted|pending/i.test(o.status || ''));
        for (const o of open) await ib.cancel(acct, o.orderId).catch((e) => errors.push(`cancel ${o.orderId}: ${e.message.slice(0, 80)}`));
        if (open.length) log('בוטלו', open.length, 'פקודות פתוחות של הגשר');
      } catch (e) { errors.push('cancel: ' + e.message.slice(0, 120)); }
    }
  } else if (!arming.armed){ log('כבוי (לא מופעל):', arming.reasons.join(' | ')); }
  else if (!inLiveWindow(now)){ mode = 'armed-outside-window'; }
  else {
    mode = 'armed';
    const simEq = Number(pend.simEquityUsd);
    const base = Math.min(equity, LIVE_LIMITS.approvedCapitalUsd);
    const plan = [];
    const heldQty = (sym) => positions.filter((p) => p.symbol === sym).reduce((s, p) => s + p.qty, 0);
    // 1) עצירת הפסד מקומית — ללא תלות בסימולציה
    for (const s of stopOuts(positions)) plan.push({ id: `live:${day}:stop:${s.symbol}`, symbol: s.symbol, side: 'sell', qty: s.qty, why: `עצירת הפסד ${s.lossPct}% (גשר)` });
    // 2) יציאות הסימולציה (עצירה/חיסול) — סוגרים את כל מה שמוחזק חי בסימול הזה
    for (const o of pend.exits || []) if (o.side === 'sell' && heldQty(o.symbol) > 0) plan.push({ id: `live:${day}:exit:${o.clientOrderId}`, symbol: o.symbol, side: 'sell', qty: heldQty(o.symbol), why: `יציאת סימולציה (${o.kind})` });
    // 3) פקודות הסימולציה לסשן: קנייה מותאמת לגודל החשבון; מכירה = סגירת הפוזיציה החיה. שורט/cover/אופציות/לא-ETF נדחים בשער
    for (const o of (pend.orders || []).filter((x) => pend.day && pend.day < day)){
      if (o.side === 'buy') plan.push({ id: `live:${o.clientOrderId}`, symbol: o.symbol, side: 'buy', simOrder: o, why: o.reason || o.strategy || 'סימולציה' });
      else if (o.side === 'sell' && heldQty(o.symbol) > 0) plan.push({ id: `live:${o.clientOrderId}`, symbol: o.symbol, side: 'sell', qty: heldQty(o.symbol), why: 'סגירה לפי הסימולציה' });
      else plan.push({ id: `live:${o.clientOrderId}`, symbol: o.symbol, side: o.side, qty: o.qty, simOrder: o, why: o.reason || '' });
    }
    const markSkip = (p, reason) => { log('דילוג', p.symbol, reason); state.sent[p.id] = { skipped: reason, at: now.toISOString() }; skipped.push({ id: p.id, symbol: p.symbol, side: p.side, reason }); };
    for (const p of plan){
      if (state.sent[p.id]) continue;
      try {
        if (p.side !== 'buy' && p.side !== 'sell'){ markSkip(p, `צד ${p.side} לא מאושר (long בלבד)`); continue; }
        const inst = instrumentOf(p.symbol);
        if (!inst || inst.class !== 'etf'){ markSkip(p, 'לא ETF מאושר'); continue; }
        let c = state.conids[p.symbol]; if (!c){ c = await ib.resolveConid(p.symbol, day); state.conids[p.symbol] = c; }
        const qt = await ib.quote(c.conid);
        const lim = liveLimitPrice({ side: p.side, bid: qt.bid, ask: qt.ask, availability: qt.availability });
        if (!lim.ok){ if (lim.retry){ errors.push(`${p.symbol}: ${lim.reason} — ינוסה בסבב הבא`); continue; } markSkip(p, lim.reason); continue; }
        let qty = p.qty;
        if (p.side === 'buy'){
          qty = scaleQty({ simQty: p.simOrder.qty, simPrice: p.simOrder.price, simEquityUsd: simEq, liveBaseUsd: base, livePrice: lim.price, units: inst.units || 1 });
          if (!(qty > 0)){ markSkip(p, `בגודל החשבון (${Math.round(base)}$) הפקודה מתעגלת ל-0 יחידות`); continue; }
        }
        const g = gateLiveOrder({ order: { symbol: p.symbol, side: p.side, qty, price: lim.price }, account, positions, state });
        if (!g.allowed){ markSkip(p, g.reasons.join(' · ')); continue; }
        const body = liveOrderBody({ acctId: acct, conid: c.conid, side: p.side, qty, price: lim.price, cOID: p.id });
        if (dry){ log('DRY', JSON.stringify(body)); continue; }
        // cOID דטרמיניסטי: IBKR דוחה כפילות באותו מזהה — ניסיון חוזר אחרי ניתוק לא ישלח פקודה שנייה
        const r = await ib.placeOrder(acct, body);
        log('נשלח', body.side, body.quantity, p.symbol, '@', body.price, '→', r.orderId, r.status || '');
        state.sent[p.id] = { orderId: r.orderId, at: now.toISOString(), symbol: p.symbol, side: p.side, qty };
        sentNow.push({ id: p.id, orderId: r.orderId, symbol: p.symbol, side: p.side, qty, limit: body.price, why: p.why });
        if (p.side === 'buy'){   // מעדכנים מקומית כדי שהפקודה הבאה באותו סבב תיבדק מול המצב החדש
          state.opensToday = (state.opensToday || 0) + 1; account.cashUsd -= qty * lim.price;
          positions.push({ symbol: p.symbol, qty, valueUsd: qty * lim.price, marketValueUsd: qty * lim.price, avgPrice: lim.price, marketPrice: lim.price });
        } else { account.cashUsd += qty * lim.price; for (const x of positions) if (x.symbol === p.symbol) x.qty = 0; }
      } catch (e) { log('שגיאה', p.symbol, e.message); errors.push(`${p.symbol}: ${e.message.slice(0, 160)}`); }
    }
  }
  const ours = new Set(Object.keys(state.sent));
  const fills = (await ib.orders().catch((e) => { errors.push('orders: ' + e.message); return []; })).map(normalizeBrokerOrder).filter((o) => o.clientOrderId && ours.has(o.clientOrderId));
  const unrealizedUsd = positions.reduce((s, p) => s + (Number(p.unrealizedUsd) || 0), 0);
  const rep = { day, at: now.toISOString(), authenticated: true, account: mask(acct), mode, armed: arming.armed, armReasons: arming.armed ? [] : arming.reasons, killed, limitsHash: liveHash(),
    summary: { equityUsd: equity, cashUsd: cash, unrealizedUsd: Math.round(unrealizedUsd * 100) / 100, dayStartEquityUsd: state.dayStartEquityUsd, hwmUsd: state.hwmUsd, opensToday: state.opensToday || 0 },
    positions: positions.filter((p) => p.qty > 0).map((p) => ({ symbol: p.symbol, qty: p.qty, avgPrice: p.avgPrice, marketPrice: p.marketPrice, unrealizedUsd: p.unrealizedUsd })), sent: sentNow, skipped, fills, errors };
  await postReport(rep, { state, worker, now, log });
  return rep;
}

// דיווח ל-Worker בלי להציף את ה-KV (2 כתיבות לדיווח): שולחים רק כשהמצב השתנה, כשיש פקודות/דילוגים/שגיאות, או אחת ל-5 דקות (מופעל) / 10 דקות (כבוי)
async function postReport(rep, { state, worker, now, log }){
  const sig = JSON.stringify([rep.mode, rep.armed, rep.killed, rep.authenticated, (rep.errors || []).join('|').slice(0, 300)]);   // אותה שגיאה שחוזרת כל דקה לא נחשבת שינוי
  const eventful = (rep.sent?.length || 0) + (rep.skipped?.length || 0) > 0;
  const every = (rep.armed ? 5 : 10) * 60000;
  if (!eventful && state.lastSig === sig && state.lastReportAt && now.getTime() - Date.parse(state.lastReportAt) < every) return;
  state.lastSig = sig; state.lastReportAt = now.toISOString();
  await worker('/agent/live/report', { method: 'POST', body: rep }).catch((e) => log('דיווח נכשל:', e.message));
}

async function main(){
  const args = new Set(process.argv.slice(2));
  const ONCE = args.has('--once'), DRY = args.has('--dry-run') || process.env.DRY_RUN === '1';
  const W = (process.env.WORKER_URL || 'https://invest-api.meirco199.workers.dev').replace(/\/$/, '');
  const SECRET = process.env.BRIDGE_SECRET || '';
  const GW = process.env.IBKR_LIVE_GATEWAY || 'https://localhost:5001/v1/api';
  const INTERVAL = Math.max(30, Number(process.env.INTERVAL_SEC) || 60);
  const STATE_FILE = process.env.LIVE_STATE || `${process.env.HOME || '.'}/.bikur-bridge/live-state.json`;
  // בתיקיית הבית של משתמש הגשר: /etc/bikur-bridge סגורה (700, root) ולכן ה-process של הגשר לא יכול לראות קובץ שם (נמצא ב-10/10: LIVE_OFF קיים והגשר התעלם ממנו)
  const KILL_FILE = process.env.LIVE_KILL_FILE || `${process.env.HOME || '.'}/.bikur-bridge/LIVE_OFF`;
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
  if (!SECRET){ console.error('חסר BRIDGE_SECRET'); process.exit(1); }
  if (/^https:\/\/(localhost|127\.0\.0\.1)[:/]/.test(GW) && process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const loadState = () => { try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { sent: {}, conids: {} }; } };
  const saveState = (s) => { try { mkdirSync(STATE_FILE.replace(/\/[^/]+$/, ''), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s, null, 1)); } catch (e) { log('שמירת מצב נכשלה:', e.message); } };
  const worker = async (path, { method = 'GET', body } = {}) => {
    const r = await fetch(`${W}${path}${path.includes('?') ? '&' : '?'}secret=${encodeURIComponent(SECRET)}`, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Worker ${path} → ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    return j;
  };
  const ib = new IbkrClient({ base: GW, log });
  const env = { LIVE_ACCOUNT: process.env.LIVE_ACCOUNT, LIVE_APPROVAL: process.env.LIVE_APPROVAL, LIVE_ARMED_UNTIL: process.env.LIVE_ARMED_UNTIL };
  const state = loadState();
  log('גשר IBKR לחשבון אמיתי →', W, '| gateway', GW, '| hash מגבלות', liveHash(), DRY ? '| DRY RUN' : '');
  for (;;){
    try { await liveTick({ ib, state, worker, env, killFile: () => existsSync(KILL_FILE), log, dry: DRY }); } catch (e) { log('tick נכשל:', e.message); }
    saveState(state);
    if (ONCE) break;
    await new Promise((r) => setTimeout(r, INTERVAL * 1000));
  }
}
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
