#!/usr/bin/env node
// בוט 2 של מסלול עמית — חשבון הדמו של Bybit, ETHUSDT, נרות 15 דקות (engine/amit2-exec.js). רץ כשירות bikur-bybit2 על השרת,
// לצד בוט 1 (BTCUSDT). מטבע אחר = אין התנגשות: ב-Bybit פוזיציה אחת לכל מטבע בחשבון, וכל בוט נוגע רק במטבע שלו.
// כסף וירטואלי בלבד: הכתובת קבועה ל-api-demo. אותם מפתחות, אותו STOP (~/.bikur-bybit/STOP עוצר את שני הבוטים). פירוט: invest/docs/BYBIT_BOT.md
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { sign, summarize } from '../engine/amit-exec.js';
import { BOT2, decide2, closedBars15, ilDay, dailyHalt } from '../engine/amit2-exec.js';

const KEY = process.env.BYBIT_DEMO_API_KEY || '', SECRET = process.env.BYBIT_DEMO_API_SECRET || '';
const W = (process.env.WORKER_URL || 'https://invest-api.meirco199.workers.dev').replace(/\/$/, '');
const REPORT_SECRET = process.env.BRIDGE_SECRET || '';
const HOME = process.env.HOME || '.';
const STATE_FILE = process.env.BOT2_STATE || `${HOME}/.bikur-bybit/state2.json`;
const STOP_FILE = process.env.BOT_STOP || `${HOME}/.bikur-bybit/STOP`;
const POLL_MS = 5000, PNL_EVERY_MS = 60e3, REPORT_EVERY_MS = 2 * 3600e3, RW = '10000';
const log = (...a) => console.log(new Date().toISOString().slice(5, 19), ...a);
const C = { category: BOT2.category, symbol: BOT2.symbol };

function loadState(){ try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { startedAt: new Date().toISOString(), trades: [], trade: null, lastBarT: 0, haltDay: null, lastReportMs: 0 }; } }
function saveState(s){ try { mkdirSync(STATE_FILE.replace(/\/[^/]+$/, ''), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) { log('שמירת מצב נכשלה:', e.message); } }

async function bybit(method, path, params = {}){
  const ts = Date.now(), qs = method === 'GET' ? new URLSearchParams(params).toString() : '', body = method === 'GET' ? '' : JSON.stringify(params);
  const r = await fetch(`${BOT2.base}${path}${qs ? '?' + qs : ''}`, { method, headers: { 'Content-Type': 'application/json', 'X-BAPI-API-KEY': KEY, 'X-BAPI-TIMESTAMP': String(ts), 'X-BAPI-RECV-WINDOW': RW, 'X-BAPI-SIGN': sign(SECRET, ts, KEY, RW, method === 'GET' ? qs : body) }, body: body || undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { throw new Error(`${path} → HTTP ${r.status} ${t.slice(0, 120)}`); }
  if (j.retCode !== 0){ const e = new Error(`${path} → ${j.retCode} ${j.retMsg}`); e.code = j.retCode; throw e; }
  return j.result;
}

async function snapshotPos(){
  const p = (await bybit('GET', '/v5/position/list', C)).list?.[0];
  if (!p || !(Number(p.size) > 0)) return null;
  return { side: p.side === 'Buy' ? 'long' : 'short', size: p.size, entry: Number(p.avgPrice), mark: Number(p.markPrice), sl: Number(p.stopLoss) || null, tp: Number(p.takeProfit) || null, unrealized: Number(p.unrealisedPnl) || 0 };
}

async function syncTrades(state){
  const start = Math.max(Date.parse(state.startedAt) || 0, Date.now() - 7 * 86400e3);
  const list = (await bybit('GET', '/v5/position/closed-pnl', { ...C, startTime: String(start), limit: '100' })).list || [];
  const seen = new Set(state.trades.map((x) => x.id));
  for (const x of list){
    if (seen.has(x.orderId)) continue;
    state.trades.push({ id: x.orderId, t: Number(x.updatedTime || x.createdTime), pnl: Number(x.closedPnl) || 0, side: x.side === 'Sell' ? 'long' : 'short', entry: Number(x.avgEntryPrice), exit: Number(x.avgExitPrice) });
    log('עסקה נסגרה:', x.side === 'Sell' ? 'לונג' : 'שורט', x.avgEntryPrice, '→', x.avgExitPrice, 'נטו', x.closedPnl);
  }
  state.trades.sort((a, b) => a.t - b.t);
  if (state.trades.length > 2000) state.trades = state.trades.slice(-2000);
}

async function report(state, extra){
  if (!REPORT_SECRET) return;
  let equity = null; try { equity = Number((await bybit('GET', '/v5/account/wallet-balance', { accountType: 'UNIFIED' })).list?.[0]?.totalEquity); } catch {}
  const body = summarize(state.trades, { day: ilDay(Date.now()), equity, startedAt: state.startedAt, ...extra });
  try {
    const r = await fetch(`${W}/amit/bot?bot=2&secret=${encodeURIComponent(REPORT_SECRET)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'bikur-bybit-bot2' }, body: JSON.stringify(body) });
    log('דיווח:', r.status); state.lastReportMs = Date.now();
  } catch (e) { log('דיווח נכשל:', e.message); }
}

async function exec(a, pos, state, nowMs){
  if (a.type === 'skip'){ log('אות בלי כניסה:', a.side || '', a.why); return; }
  if (a.type === 'cancelAll') return bybit('POST', '/v5/order/cancel-all', C);
  if (a.type === 'close'){ if (!pos) return; log('סגירה בשוק:', a.why); return bybit('POST', '/v5/order/create', { ...C, side: pos.side === 'long' ? 'Sell' : 'Buy', orderType: 'Market', qty: String(pos.size), reduceOnly: true, positionIdx: 0 }); }
  if (a.type === 'moveSl'){ log('סטופ למחיר הכניסה:', a.price); await bybit('POST', '/v5/position/trading-stop', { ...C, stopLoss: a.price, tpslMode: 'Full', slTriggerBy: 'LastPrice', positionIdx: 0 }); state.trade = { ...(state.trade || {}), be: true }; return; }
  if (a.type === 'open'){
    const s = a.signal;
    log('כניסה:', s.side === 'long' ? 'לונג' : 'שורט', a.order.qty, 'ETH · סטופ', a.order.stopLoss, `(${s.stopPct.toFixed(2)}%)`, '· יעד', a.order.takeProfit, `(רווח/סיכון ${s.rr.toFixed(2)})`);
    await bybit('POST', '/v5/order/create', { ...C, positionIdx: 0, ...a.order });
    state.trade = { side: s.side, tp: s.tp, sl: s.sl, be: false, sinceMs: nowMs, signalT: s.t };
  }
}

export async function tick(state, mem){
  const now = Date.now(), day = ilDay(now);
  const pos = await snapshotPos();
  if (pos && !state.trade){ state.trade = { side: pos.side, tp: pos.tp, sl: pos.sl, be: false, sinceMs: now }; log('פוזיציה קיימת אומצה:', pos.side, pos.size, '@', pos.entry); }
  if (!pos && state.trade){ state.trade = null; mem.pnlAt = 0; }
  if (now - (mem.pnlAt || 0) >= PNL_EVERY_MS){ await syncTrades(state); mem.pnlAt = now; }
  const realizedToday = state.trades.filter((x) => ilDay(x.t) === day).reduce((s, x) => s + x.pnl, 0);
  if (state.haltDay !== day && dailyHalt(realizedToday, pos?.unrealized, BOT2)){ state.haltDay = day; log('⛔ מגבלת הפסד יומית — עוצרים עד מחר'); mem.reportNow = true; }
  const halt = existsSync(STOP_FILE) ? 'stop' : state.haltDay === day ? 'daily' : null;
  if (halt !== mem.lastHalt){ mem.lastHalt = halt; mem.reportNow = true; log(halt ? `מצב עצירה: ${halt}` : 'פעיל'); }
  let newBar = false;
  const slot = Math.floor(now / BOT2.barMs);
  if (slot !== mem.klineSlot && now % BOT2.barMs >= 3000){
    const r = await fetch(`${BOT2.market}/v5/market/kline?category=linear&symbol=${BOT2.symbol}&interval=15&limit=30`, { headers: { 'User-Agent': 'bikur-bybit-bot2' } });
    mem.bars = closedBars15(await r.json(), now); mem.klineSlot = slot;
    const lastT = mem.bars.at(-1)?.t || 0;
    if (lastT > state.lastBarT){ newBar = true; state.lastBarT = lastT; }
  }
  const snap = { pos: pos ? { ...pos, sinceMs: state.trade?.sinceMs || now } : null, trade: state.trade, bars: mem.bars || [], newBar, halt, nowMs: now };
  for (const a of decide2(snap, BOT2)){ try { await exec(a, pos, state, now); } catch (e) { mem.lastError = e.message; log('פעולה נכשלה:', a.type, e.message); } }
  saveState(state);
  if (mem.reportNow || now - (state.lastReportMs || 0) >= REPORT_EVERY_MS){ mem.reportNow = false; await report(state, { pos, halt, lastError: mem.lastError }); saveState(state); }
}

async function main(){
  if (!KEY || !SECRET){ console.error('חסרים BYBIT_DEMO_API_KEY / BYBIT_DEMO_API_SECRET'); process.exit(1); }
  if (!BOT2.base.includes('api-demo.')){ console.error('הבוט רץ רק מול חשבון הדמו'); process.exit(1); }
  const state = loadState(), mem = {};
  log('בוט 2 של עמית (Bybit דמו) —', BOT2.symbol, '15 דק׳ · סיכון', BOT2.riskUsd, '$ לעסקה · מגבלה יומית', BOT2.dailyLossUsd, '$');
  await bybit('POST', '/v5/position/set-leverage', { ...C, buyLeverage: String(BOT2.leverage), sellLeverage: String(BOT2.leverage) }).catch((e) => { if (e.code !== 110043) log('מינוף:', e.message); });
  if (process.argv.includes('--check')){ console.log(JSON.stringify({ ok: true, pos: await snapshotPos() })); return; }
  for (;;){
    try { await tick(state, mem); } catch (e) { mem.lastError = e.message; log('tick נכשל:', e.message); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
