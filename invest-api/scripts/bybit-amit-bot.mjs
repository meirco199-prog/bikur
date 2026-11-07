#!/usr/bin/env node
// בוט מסלול "עמית" בחשבון הדמו של Bybit — רץ כשירות על השרת של בעל הריפו (Bybit חוסמת שרתים בארה"ב; השרת בגרמניה).
// ההחלטות: engine/amit-exec.js (פונקציות טהורות + בדיקות). כאן רק רשת, קובץ מצב ודיווח. כסף וירטואלי בלבד: הכתובת קבועה
// לחשבון הדמו (BOT.base) ואין בקוד הזה דרך לחשבון האמיתי. התקנה/עצירה: .github/workflows/bybit-bot.yml (פירוט: invest/docs/BYBIT_BOT.md).
// env: BYBIT_DEMO_API_KEY, BYBIT_DEMO_API_SECRET, WORKER_URL, BRIDGE_SECRET (לדיווח), BOT_STATE (ברירת מחדל ~/.bikur-bybit/state.json).
// עצירה מיידית: קובץ ~/.bikur-bybit/STOP → מבטל פקודות, סוגר פוזיציה, ולא נכנס לעסקאות עד שהקובץ נמחק.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { BOT, sign, decide, closedKlines, dailyHalt, summarize, ilDay } from '../engine/amit-exec.js';

const KEY = process.env.BYBIT_DEMO_API_KEY || '', SECRET = process.env.BYBIT_DEMO_API_SECRET || '';
const W = (process.env.WORKER_URL || 'https://invest-api.meirco199.workers.dev').replace(/\/$/, '');
const REPORT_SECRET = process.env.BRIDGE_SECRET || '';
const HOME = process.env.HOME || '.';
const STATE_FILE = process.env.BOT_STATE || `${HOME}/.bikur-bybit/state.json`;
const STOP_FILE = process.env.BOT_STOP || `${HOME}/.bikur-bybit/STOP`;
// עצירה של בוט 1 בלבד (7/11/2026, אחרי AI_COUNCIL#30: "אם בוט 1 לא רלוונטי תעצור"): בוט 2 ממשיך
const STOP1_FILE = process.env.BOT_STOP1 || `${HOME}/.bikur-bybit/STOP1`;
const POLL_MS = 5000, PNL_EVERY_MS = 60e3, REPORT_EVERY_MS = 2 * 3600e3, RW = '10000';
const log = (...a) => console.log(new Date().toISOString().slice(5, 19), ...a);

function loadState(){ try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { startedAt: new Date().toISOString(), trades: [], posSinceMs: null, lastBarT: 0, haltDay: null, lastReportMs: 0 }; } }
function saveState(s){ try { mkdirSync(STATE_FILE.replace(/\/[^/]+$/, ''), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(s)); } catch (e) { log('שמירת מצב נכשלה:', e.message); } }

async function bybit(method, path, params = {}){
  const ts = Date.now();
  const qs = method === 'GET' ? new URLSearchParams(params).toString() : '';
  const body = method === 'GET' ? '' : JSON.stringify(params);
  const r = await fetch(`${BOT.base}${path}${qs ? '?' + qs : ''}`, { method, headers: { 'Content-Type': 'application/json', 'X-BAPI-API-KEY': KEY, 'X-BAPI-TIMESTAMP': String(ts), 'X-BAPI-RECV-WINDOW': RW, 'X-BAPI-SIGN': sign(SECRET, ts, KEY, RW, method === 'GET' ? qs : body) }, body: body || undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { throw new Error(`${path} → HTTP ${r.status} ${t.slice(0, 120)}`); }
  if (j.retCode !== 0) { const e = new Error(`${path} → ${j.retCode} ${j.retMsg}`); e.code = j.retCode; throw e; }
  return j.result;
}
const C = { category: BOT.category, symbol: BOT.symbol };

async function snapshotPos(){
  const p = (await bybit('GET', '/v5/position/list', C)).list?.[0];
  if (!p || !(Number(p.size) > 0)) return null;
  return { side: p.side === 'Buy' ? 'long' : 'short', size: p.size, entry: Number(p.avgPrice), unrealized: Number(p.unrealisedPnl) || 0 };
}
const openOrders = async () => (await bybit('GET', '/v5/order/realtime', { ...C, openOnly: '0', limit: '50' })).list || [];

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
    const r = await fetch(`${W}/amit/bot?secret=${encodeURIComponent(REPORT_SECRET)}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'bikur-bybit-bot' }, body: JSON.stringify(body) });
    log('דיווח:', r.status); state.lastReportMs = Date.now();
  } catch (e) { log('דיווח נכשל:', e.message); }
}

async function exec(a, pos){
  if (a.type === 'cancel') return bybit('POST', '/v5/order/cancel', { ...C, orderId: a.orderId }).catch((e) => { if (![110001, 170213].includes(e.code)) throw e; }); // כבר בוצעה/בוטלה
  if (a.type === 'cancelAll') return bybit('POST', '/v5/order/cancel-all', C);
  if (a.type === 'close'){ if (!pos) return; log('סגירה בשוק:', a.why); return bybit('POST', '/v5/order/create', { ...C, side: pos.side === 'long' ? 'Sell' : 'Buy', orderType: 'Market', qty: String(pos.size), reduceOnly: true, positionIdx: 0 }); }
  if (a.type === 'place'){ log('פקודה:', a.order.side, a.order.qty, '@', a.order.price, a.order.reduceOnly ? '(יעד)' : `(כניסה, סטופ ${a.order.stopLoss})`); return bybit('POST', '/v5/order/create', { ...C, positionIdx: 0, ...a.order }); }
}

export async function tick(state, mem){
  const now = Date.now(), day = ilDay(now);
  const pos = await snapshotPos();
  if (pos && !state.posSinceMs){ state.posSinceMs = now; log('נכנסנו:', pos.side === 'long' ? 'לונג' : 'שורט', pos.size, '@', pos.entry); }
  if (!pos && state.posSinceMs){ state.posSinceMs = null; mem.pnlAt = 0; } // יצאנו — לעדכן עסקאות מיד
  if (now - (mem.pnlAt || 0) >= PNL_EVERY_MS){ await syncTrades(state); mem.pnlAt = now; }
  const realizedToday = state.trades.filter((x) => ilDay(x.t) === day).reduce((s, x) => s + x.pnl, 0);
  if (state.haltDay !== day && dailyHalt(realizedToday, pos?.unrealized, BOT)){ state.haltDay = day; log('⛔ מגבלת הפסד יומית — עוצרים עד מחר'); mem.reportNow = true; }
  const halt = existsSync(STOP_FILE) || existsSync(STOP1_FILE) ? 'stop' : state.haltDay === day ? 'daily' : null;
  if (halt !== mem.lastHalt){ mem.lastHalt = halt; mem.reportNow = true; if (halt) log('מצב עצירה:', halt); else log('פעיל'); }
  let closes = mem.closes || [], newBar = false, barT = state.lastBarT;
  const minute = Math.floor(now / 60e3);
  if (minute !== mem.klineMinute && now % 60e3 >= 2000){
    const r = await fetch(`${BOT.market}/v5/market/kline?category=linear&symbol=${BOT.symbol}&interval=1&limit=30`, { headers: { 'User-Agent': 'bikur-bybit-bot' } });
    const bars = closedKlines(await r.json(), now);
    mem.klineMinute = minute; closes = mem.closes = bars.map((b) => b.c);
    const lastT = bars.at(-1)?.t || 0;
    if (lastT > state.lastBarT){ newBar = true; barT = state.lastBarT = lastT; }
  }
  const actions = decide({ pos: pos ? { ...pos, sinceMs: state.posSinceMs } : null, orders: await openOrders(), closes, newBar, halt, nowMs: now, barT }, BOT);
  for (const a of actions){ try { await exec(a, pos); } catch (e) { mem.lastError = e.message; log('פעולה נכשלה:', a.type, e.message); } }
  saveState(state);
  if (mem.reportNow || now - (state.lastReportMs || 0) >= REPORT_EVERY_MS){ mem.reportNow = false; await report(state, { pos, halt, lastError: mem.lastError }); saveState(state); }
}

async function main(){
  if (!KEY || !SECRET){ console.error('חסרים BYBIT_DEMO_API_KEY / BYBIT_DEMO_API_SECRET'); process.exit(1); }
  if (!BOT.base.includes('api-demo.')){ console.error('הבוט רץ רק מול חשבון הדמו'); process.exit(1); }
  const state = loadState(), mem = {};
  log('בוט עמית (Bybit דמו) — ', BOT.symbol, 'פוזיציה', BOT.notional, '$ · סטופ', BOT.slPct, '% · מגבלה יומית', BOT.dailyLossUsd, '$');
  await bybit('POST', '/v5/position/set-leverage', { ...C, buyLeverage: String(BOT.leverage), sellLeverage: String(BOT.leverage) }).catch((e) => { if (e.code !== 110043) log('מינוף:', e.message); });
  if (process.argv.includes('--check')){ const p = await snapshotPos(); console.log(JSON.stringify({ ok: true, pos: p, orders: (await openOrders()).length })); return; }
  for (;;){
    try { await tick(state, mem); } catch (e) { mem.lastError = e.message; log('tick נכשל:', e.message); }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) main().catch((e) => { console.error(e); process.exit(1); });
