#!/usr/bin/env node
// בוט 3 של מסלול עמית — שיטת הקורס (engine/amit3-exec.js) בחשבון הדמו של Bybit, 8 מטבעות, נרות דקה. רץ כשירות bikur-bybit3 על השרת.
// כסף וירטואלי בלבד: הכתובת קבועה ל-api-demo. לא נוגע ב-ETHUSDT (בוט 2). אותם מפתחות; STOP (כל הבוטים) או STOP3 (רק בוט 3) → ביטול
// הפקודות שלו וסגירת הפוזיציות שלו. בנוסף: שומר כל נר דקה סגור מ-Bybit (~/.bikur-bybit/bars3/<SYM>.csv) — כדי להריץ אחר כך את כל
// הגרסאות (הגרסה ה"מזוקקת", כניסה אחת וכו') על אותם נתונים בדיוק. פירוט: invest/docs/BYBIT_BOT.md
// כל פעולה מול הברוקר (כניסה, מנה, מימוש, סגירה, הזזת סטופ, ביטול) עוברת קודם את שער הפקודות (engine/amit3-gate.js → order-gate).
import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { sign, ilDay } from '../engine/amit-exec.js';
import { BOT3, klines, liveSignal, planEntry, manage } from '../engine/amit3-exec.js';
import { gate3, linkId3 } from '../engine/amit3-gate.js';

const KEY = process.env.BYBIT_DEMO_API_KEY || '', SECRET = process.env.BYBIT_DEMO_API_SECRET || '';
const HOME = process.env.HOME || '.', DIR = `${HOME}/.bikur-bybit`, STATE_FILE = `${DIR}/state3.json`, BARS = `${DIR}/bars3`;
const STOP_FILES = [`${DIR}/STOP`, `${DIR}/STOP3`], RW = '10000', POLL_MS = 5000;
const log = (...a) => console.log(new Date().toISOString().slice(5, 19), ...a);
const SYMS = Object.keys(BOT3.coins).map((c) => `${c}USDT`), coinOf = (s) => s.replace(/USDT$/, '');

function loadState(){ try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { startedAt: new Date().toISOString(), trades: [], open: {}, lastSeen: {}, haltDay: null }; } }
function saveState(s){ try { mkdirSync(DIR, { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) { log('שמירת מצב נכשלה:', e.message); } }

async function bybit(method, path, params = {}){
  const ts = Date.now(), qs = method === 'GET' ? new URLSearchParams(params).toString() : '', body = method === 'GET' ? '' : JSON.stringify(params);
  const r = await fetch(`${BOT3.base}${path}${qs ? '?' + qs : ''}`, { method, headers: { 'Content-Type': 'application/json', 'X-BAPI-API-KEY': KEY, 'X-BAPI-TIMESTAMP': String(ts), 'X-BAPI-RECV-WINDOW': RW, 'X-BAPI-SIGN': sign(SECRET, ts, KEY, RW, method === 'GET' ? qs : body) }, body: body || undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { throw new Error(`${path} → HTTP ${r.status} ${t.slice(0, 120)}`); }
  if (j.retCode !== 0){ const e = new Error(`${path} → ${j.retCode} ${j.retMsg}`); e.code = j.retCode; throw e; }
  return j.result;
}
async function market(path, params){
  const r = await fetch(`${BOT3.market}${path}?${new URLSearchParams(params)}`, { headers: { 'User-Agent': 'bikur-bybit-bot3' } });
  const j = await r.json(); if (j.retCode !== 0) throw new Error(`${path} → ${j.retCode} ${j.retMsg}`); return j.result;
}
async function history(sym, minutes){
  const out = new Map(); let end = Date.now();
  for (let got = 0; got < minutes; ){
    const list = (await market('/v5/market/kline', { category: 'linear', symbol: sym, interval: '1', end: String(end), limit: '1000' })).list || [];
    if (!list.length) break;
    for (const b of klines(list, Date.now())) out.set(b.t, b);
    got += list.length; end = Number(list.at(-1)[0]) - 1; await new Promise((r) => setTimeout(r, 120));
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}
// שער הפקודות: כל פעולה → gate3 (order-gate) → רק אם מותר, שולחים; כל החלטה נרשמת ביומן היומי (גם דחייה)
let ENV = null;
async function gated(req, call){
  const g = gate3(req, ENV);
  const day = new Date(ENV.now).toISOString().slice(0, 10);
  if (ENV.state.journalDay !== day){ ENV.state.journalDay = day; ENV.state.journal = []; }
  if (!g.allowed){ log(req.sym, `⛔ השער דחה ${req.side} ${req.qty} (${req.id}):`, g.reasons.join(' · ')); return null; }
  const r = await call(g.clientOrderId);
  if (!req.cancel) ENV.state.journal.push({ clientOrderId: g.clientOrderId, t: ENV.now, sym: req.sym, side: req.side, qty: req.qty, reducing: g.reducing }); // ביטולים לא נספרים במכסה
  ENV.journal = ENV.state.journal;
  return r;
}

async function positions(){
  const out = {};
  for (const p of (await bybit('GET', '/v5/position/list', { category: 'linear', settleCoin: 'USDT' })).list || []) if (SYMS.includes(p.symbol) && Number(p.size) > 0) out[p.symbol] = { size: Number(p.size), avg: Number(p.avgPrice), side: p.side, unrealized: Number(p.unrealisedPnl) || 0 };
  return out;
}
async function cancelPending(sym){
  const list = (await bybit('GET', '/v5/order/realtime', { category: 'linear', symbol: sym })).list || [];
  for (const o of list) if ((o.orderLinkId || '').startsWith(`${BOT3.tag}-`))
    await gated({ sym, side: 'sell', qty: Number(o.qty) || 0, price: Number(o.price) || 1, id: `${o.orderLinkId}-c`, cancel: true }, () => bybit('POST', '/v5/order/cancel', { category: 'linear', symbol: sym, orderId: o.orderId })).catch((e) => log(sym, 'ביטול נכשל:', e.message));
}
async function closeAll(sym, pos, why, tag = 'x'){
  await cancelPending(sym);
  if (pos?.size > 0){ log(sym, 'סגירה בשוק:', why); await gated({ sym, side: 'sell', qty: pos.size, price: pos.avg, id: linkId3(sym, ENV.now, tag) }, (id) => bybit('POST', '/v5/order/create', { category: 'linear', symbol: sym, side: 'Sell', orderType: 'Market', qty: String(pos.size), reduceOnly: true, positionIdx: 0, orderLinkId: id })); }
}
async function syncClosed(state){
  const start = Math.max(Date.parse(state.startedAt) || 0, Date.now() - 7 * 86400e3), seen = new Set(state.trades.map((x) => x.id));
  for (const sym of SYMS){
    const list = (await bybit('GET', '/v5/position/closed-pnl', { category: 'linear', symbol: sym, startTime: String(start), limit: '100' })).list || [];
    for (const x of list){ if (seen.has(x.orderId)) continue; state.trades.push({ id: x.orderId, sym, t: Number(x.updatedTime || x.createdTime), pnl: Number(x.closedPnl) || 0, entry: Number(x.avgEntryPrice), exit: Number(x.avgExitPrice), qty: Number(x.qty) }); log(sym, 'סגירה חלקית/מלאה:', x.avgEntryPrice, '→', x.avgExitPrice, 'נטו', x.closedPnl); }
    await new Promise((r) => setTimeout(r, 80));
  }
  state.trades.sort((a, b) => a.t - b.t); if (state.trades.length > 5000) state.trades = state.trades.slice(-5000);
}
export function summary(state){
  const by = {}; let net = 0; for (const x of state.trades){ net += x.pnl; (by[x.sym] ||= { n: 0, pnl: 0 }).n++; by[x.sym].pnl += x.pnl; }
  return { startedAt: state.startedAt, fills: state.trades.length, net: Math.round(net * 100) / 100, bySymbol: by, open: Object.keys(state.open) };
}

async function main(){
  if (!KEY || !SECRET){ console.error('חסרים BYBIT_DEMO_API_KEY / BYBIT_DEMO_API_SECRET'); process.exit(1); }
  if (!BOT3.base.includes('api-demo.')){ console.error('הבוט רץ רק מול חשבון הדמו'); process.exit(1); }
  if (process.argv.includes('--summary')){ console.log(JSON.stringify(summary(loadState()), null, 1)); return; }
  const state = loadState(), mem = { bars: {}, inst: {}, slot: 0 };
  mkdirSync(BARS, { recursive: true });
  for (const sym of SYMS){
    const it = (await market('/v5/market/instruments-info', { category: 'linear', symbol: sym })).list?.[0];
    if (!it || it.status !== 'Trading'){ log(sym, 'לא נסחר ב-Bybit — מדלגים'); continue; }
    mem.inst[sym] = { qtyStep: Number(it.lotSizeFilter.qtyStep), minQty: Number(it.lotSizeFilter.minOrderQty), tick: Number(it.priceFilter.tickSize) };
    await bybit('POST', '/v5/position/set-leverage', { category: 'linear', symbol: sym, buyLeverage: String(BOT3.leverage), sellLeverage: String(BOT3.leverage) }).catch((e) => { if (e.code !== 110043) log(sym, 'מינוף:', e.message); });
    mem.bars[sym] = await history(sym, BOT3.historyMin); log(sym, 'היסטוריה:', mem.bars[sym].length, 'נרות דקה');
  }
  if (process.argv.includes('--check')){ console.log(JSON.stringify({ ok: true, symbols: Object.keys(mem.inst), positions: await positions() })); return; }
  log('בוט 3 של עמית (Bybit דמו) — שיטת הקורס, 30-60-90 ·', Object.keys(mem.inst).join(', '), '· סיכון', BOT3.riskUsd, '$ לעסקה · מגבלה יומית', BOT3.dailyLossUsd, '$');
  for (;;){
    try { await tick(state, mem); } catch (e) { log('tick נכשל:', e.message); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

async function tick(state, mem){
  const now = Date.now(), slot = Math.floor(now / 60e3);
  if (slot === mem.slot || now % 60e3 < 3000) return;    // פעם בדקה, 3 שניות אחרי סגירת הנר
  mem.slot = slot;
  const stop = STOP_FILES.some((f) => existsSync(f)), day = ilDay(now);
  const pos = await positions();
  const w = (await bybit('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' })).list?.[0] || {};
  const equity = Number(w.totalEquity) || 0, available = Number(w.totalAvailableBalance) || 0;
  state.hwm = Math.max(state.hwm || 0, equity);
  ENV = { now, equity, available, hwm: state.hwm, positions: pos, dayPnl: 0, journal: state.journalDay === new Date(now).toISOString().slice(0, 10) ? state.journal || [] : [], state };
  if (stop){ for (const sym of Object.keys(mem.inst)) if (pos[sym] || state.open[sym]){ await closeAll(sym, pos[sym], 'STOP', 'k'); delete state.open[sym]; } saveState(state); if (!mem.stopLogged){ log('מצב עצירה (STOP)'); mem.stopLogged = true; } return; }
  mem.stopLogged = false;
  if (now - (mem.pnlAt || 0) > 5 * 60e3){ await syncClosed(state); mem.pnlAt = now; }
  const today = state.trades.filter((x) => ilDay(x.t) === day).reduce((s, x) => s + x.pnl, 0) + Object.values(pos).reduce((s, p) => s + p.unrealized, 0);
  ENV.dayPnl = today;
  if (state.haltDay !== day && today <= -BOT3.dailyLossUsd){ state.haltDay = day; log('⛔ מגבלת הפסד יומית — סוגרים ועוצרים עד מחר'); for (const sym of Object.keys(mem.inst)){ await closeAll(sym, pos[sym], 'מגבלה יומית', 'd'); delete state.open[sym]; } }
  for (const sym of Object.keys(mem.inst)){
    try {
      const fresh = klines((await market('/v5/market/kline', { category: 'linear', symbol: sym, interval: '1', limit: '5' })).list, now);
      const bars = mem.bars[sym], lastT = bars.at(-1)?.t || 0;
      for (const b of fresh) if (b.t > lastT){ bars.push(b); appendFileSync(`${BARS}/${sym}.csv`, `${b.t},${b.o},${b.h},${b.l},${b.c},${b.v}\n`); }
      while (bars.length > BOT3.historyMin) bars.shift();
      const cat = BOT3.coins[coinOf(sym)], { signal, ctx } = liveSignal(bars, cat, state.lastSeen[sym] || 0), inst = mem.inst[sym];
      const tr = state.open[sym];
      if (tr){
        if (pos[sym]) tr.filled = true;
        for (const a of manage(tr, pos[sym], ctx, now, inst)){
          if (a.type === 'cancelPending') await cancelPending(sym);
          else if (a.type === 'reduce'){ log(sym, 'מימוש:', a.why, a.qty); await gated({ sym, side: 'sell', qty: a.qty, price: pos[sym].avg, id: linkId3(sym, tr.signalT, 'r') }, (id) => bybit('POST', '/v5/order/create', { category: 'linear', symbol: sym, side: 'Sell', orderType: 'Market', qty: String(a.qty), reduceOnly: true, positionIdx: 0, orderLinkId: id })); }
          else if (a.type === 'moveSl'){ log(sym, 'סטופ לכניסה:', a.price); await gated({ sym, side: 'sell', qty: pos[sym].size, price: a.price, id: linkId3(sym, tr.signalT, 's') }, () => bybit('POST', '/v5/position/trading-stop', { category: 'linear', symbol: sym, stopLoss: String(a.price), tpslMode: 'Full', slTriggerBy: 'LastPrice', positionIdx: 0 })); }
          else if (a.type === 'phase'){ tr.phase = a.phase; tr.runner = a.runner; }
          else if (a.type === 'closeAll'){ await closeAll(sym, pos[sym], a.why, 't'); delete state.open[sym]; }
          else if (a.type === 'done'){ log(sym, 'עסקה הסתיימה:', a.why); delete state.open[sym]; }
        }
      } else if (signal && !pos[sym] && state.haltDay !== day){
        state.lastSeen[sym] = signal.t;
        const p = planEntry(signal, inst);
        if (!p){ log(sym, 'טריגר בלי כניסה (מנה מתחת למינימום או גאומטריה לא תקינה)'); continue; }
        log(sym, 'כניסה (30-60-90):', p.qty.join(' / '), '· מחירים', p.px.map((x) => x.toPrecision(6)).join(' / '), '· סטופ', p.stop, '· עוגן', p.anchor.toPrecision(6), '· אזור', p.zone.join('–') + '%');
        // הפסד מקסימלי של כל מנה עד הסטופ — לשער (unboundedLoss=false); מנות 60/90 הן חלק מהתוכנית שנקבעה לפני הכניסה (addToPlan)
        const worst = (k) => p.qty[k] * (p.px[k] - p.stop);
        const e1 = await gated({ sym, side: 'buy', qty: p.qty[0], price: p.px[0], id: linkId3(sym, p.signalT, 'e1'), worstLoss: worst(0) }, (id) => bybit('POST', '/v5/order/create', { category: 'linear', symbol: sym, side: 'Buy', orderType: 'Market', qty: String(p.qty[0]), positionIdx: 0, stopLoss: String(p.stop), tpslMode: 'Full', slTriggerBy: 'LastPrice', orderLinkId: id }));
        if (!e1) continue;
        for (const k of [1, 2]) await gated({ sym, side: 'buy', qty: p.qty[k], price: p.px[k], id: linkId3(sym, p.signalT, `e${k + 1}`), worstLoss: worst(k), addToPlan: true }, (id) => bybit('POST', '/v5/order/create', { category: 'linear', symbol: sym, side: 'Buy', orderType: 'Limit', qty: String(p.qty[k]), price: String(p.px[k]), timeInForce: 'PostOnly', positionIdx: 0, orderLinkId: id })).catch((e) => log(sym, `מנה ${k + 1} נדחתה:`, e.message));
        state.open[sym] = { phase: 0, entryT: now, zone: p.zone, stop: p.stop, px: p.px, qty: p.qty, filled: false, signalT: p.signalT };
      }
    } catch (e) { log(sym, 'שגיאה:', e.message); }
  }
  saveState(state);
}
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
