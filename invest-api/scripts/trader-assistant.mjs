#!/usr/bin/env node
// עוזר המסחר האישי של מאיר (invest/docs/TRADER.md) — שירות על השרת, קריאה בלבד. אין בו שום קריאה שמבצעת פקודה.
// כל דקה בשעות הבורסה בפועל (כולל מסחר מוקדם ומאוחר, חגים, ימים מקוצרים — לפי לוח המסחר של Alpaca):
//   מחירים (Alpaca IEX, זמן אמת) → פוזיציות (IBKR Flex: פוזיציות של אתמול + ביצועים של היום) → מדדים, המלצות ניהול סיכון → התראות בטלגרם
//   (דרך POST /notify של ה-Worker). אחרי הסגירה: יומן, ניתוח טעויות, חלופות יציאה; ביום המסחר האחרון בשבוע — סיכום שבועי.
// מסך לטלפון: http://127.0.0.1:PORT (מאחורי Caddy עם HTTPS), מוגן בטוקן אקראי שנוצר בשרת ונשלח למאיר בטלגרם בלבד.
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as T from '../engine/trader.js';
import { decrypt as pushDecrypt } from '../engine/trader-push.js';

const E = process.env, HOME = E.HOME || '.';
const DIR = E.TRADER_DIR || join(HOME, '.bikur-trader'); mkdirSync(DIR, { recursive: true });
const PORT = Number(E.TRADER_PORT || 8787);
const AH = { 'APCA-API-KEY-ID': E.ALPACA_KEY_ID || '', 'APCA-API-SECRET-KEY': E.ALPACA_SECRET_KEY || '' };
const ACCTS = ['CO', 'PR'].map((k) => ({ k, name: k === 'CO' ? 'חברה' : 'פרטי', token: E[`IBKR_FLEX_TOKEN_${k}`], qAct: E[`IBKR_FLEX_ACTIVITY_${k}`], qTrd: E[`IBKR_FLEX_TRADES_${k}`] })).filter((a) => a.token && (a.qAct || a.qTrd));
const log = (...a) => console.log(new Date().toISOString().slice(0, 19), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nyo = (t) => T.nyOffsetSec(t);
const now = () => Math.floor(Date.now() / 1000);

// ---------- מצב (קובץ אחד, כתיבה אטומית) ----------
const SF = join(DIR, 'state.json');
const S = existsSync(SF) ? JSON.parse(readFileSync(SF, 'utf8')) : {};
const fresh = !S.token; S.token ||= randomBytes(24).toString('hex');
S.cls ||= {}; S.audit ||= []; S.watch ||= []; S.sent ||= {}; S.peak ||= {}; S.rec ||= {}; S.journal ||= []; S.reviews ||= []; S.spike ||= {};
const save = () => { writeFileSync(SF + '.tmp', JSON.stringify(S)); renameSync(SF + '.tmp', SF); };
if (fresh) save(); // פקודות --check/--link לא דורסות את המצב של השירות הרץ

// ---------- רשת ----------
async function get(url, headers = {}, type = 'json'){
  for (let i = 0; i < 3; i++){
    try { const r = await fetch(url, { headers: { 'User-Agent': 'bikur-trader', ...headers } }); if (r.status === 429 || r.status >= 500){ await sleep(2000 * (i + 1)); continue; } if (!r.ok) return null; return type === 'json' ? await r.json() : await r.text(); }
    catch { await sleep(1500 * (i + 1)); }
  }
  return null;
}
async function notify(text){
  if (!E.WORKER_URL || !E.CRON_SECRET) return log('notify (לא מוגדר):', text);
  try { const r = await fetch(`${E.WORKER_URL}/notify?secret=${encodeURIComponent(E.CRON_SECRET)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '📈 עוזר המסחר\n' + text }) }); log('notify', r.status); }
  catch (e){ log('notify error', e.message); }
}

// ---------- לוח המסחר (Alpaca) ----------
let CAL = [], calAt = 0;
async function calendar(){
  if (Date.now() - calAt < 6 * 3600e3 && CAL.length) return CAL;
  const d0 = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10), d1 = new Date(Date.now() + 21 * 864e5).toISOString().slice(0, 10);
  const c = await get(`https://paper-api.alpaca.markets/v2/calendar?start=${d0}&end=${d1}`, AH);
  if (Array.isArray(c)){ CAL = c; calAt = Date.now(); }
  return CAL;
}

// ---------- IBKR Flex (קריאה בלבד) ----------
const FLEX = 'https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService';
async function flex(token, q){
  const a = await get(`${FLEX}/SendRequest?t=${token}&q=${q}&v=3`, {}, 'text'); if (!a) return null;
  const ref = (a.match(/<ReferenceCode>(\d+)<\/ReferenceCode>/) || [])[1]; if (!ref){ log('flex SendRequest:', a.slice(0, 160).replace(/\s+/g, ' ')); return null; }
  for (let i = 0; i < 8; i++){
    await sleep(3000 + i * 2000);
    const x = await get(`${FLEX}/GetStatement?t=${token}&q=${ref}&v=3`, {}, 'text');
    if (x && !/<ErrorCode>1019<\/ErrorCode>|in progress/i.test(x)) return /<FlexStatement/.test(x) ? x : (log('flex GetStatement:', x.slice(0, 160).replace(/\s+/g, ' ')), null);
  }
  return null;
}
let MORNING = { at: null, acc: {} }, TRADES = { at: 0, list: [] }; const ACCT_NAME = {};
async function refreshMorning(dateKey){
  if (MORNING.at === dateKey) return;
  const acc = {};
  for (const A of ACCTS){ if (!A.qAct) continue; const x = await flex(A.token, A.qAct); if (x){ const r = T.flexPositions(x); for (const id of Object.keys(r)) ACCT_NAME[id] = A.name; Object.assign(acc, r); } }
  if (Object.keys(acc).length){ MORNING = { at: dateKey, acc }; log('positions (Flex):', Object.entries(acc).map(([k, v]) => `${ACCT_NAME[k] || '?'}:${v.positions.length}`).join(' ')); }
}
async function refreshTrades(){
  if (now() - TRADES.at < 180) return; TRADES.at = now();
  const list = [];
  for (const A of ACCTS){ if (!A.qTrd) continue; const x = await flex(A.token, A.qTrd); if (x){ const r = T.flexTrades(x, nyo); for (const t of r) ACCT_NAME[t.acct] ||= A.name; list.push(...r); } }
  if (list.length || !TRADES.list.length) TRADES.list = list;
}

// ---------- העברה שעתית מ-IBKR (חלופה ל-Flex): קובץ מוצפן שמגיע דרך trader.yml (פעולה push) ----------
// משמש רק כשאין מפתחות Flex. תמונת מצב ישנה מ-PUSH_STALE לא מפעילה התראות על פוזיציות (אולי כבר נמכרו).
const PF = join(DIR, 'push.in'), PUSH_STALE = 150 * 60;
Object.assign(ACCT_NAME, { PR: 'פרטי', CO: 'חברה' });
function ingestPush(){
  if (!E.TRADER_PUSH_KEY || !existsSync(PF)) return;
  try {
    const snap = pushDecrypt(readFileSync(PF, 'utf8'), readFileSync(E.TRADER_PUSH_KEY, 'utf8'));
    if (!T.validSnapshot(snap)) log('push: מבנה לא תקין');
    else if (snap.at > now() + 300 || snap.at <= (S.push?.at || 0)) log('push: ישן או עתידי — לא נקלט');
    else { S.fx ||= {}; for (const [id, A] of Object.entries(snap.accounts)) if (A.usdRate) S.fx[id] = A.usdRate; S.push = snap; save(); log('push:', Object.entries(snap.accounts).map(([k, v]) => `${ACCT_NAME[k]}:${v.positions.length}`).join(' ')); }
  } catch (e){ log('push נדחה:', e.message); }
  try { renameSync(PF, PF + '.done'); } catch {}
}

// ---------- מחירים ונרות (Alpaca, IEX — זמן אמת בחשבון החינמי) ----------
const DATA = 'https://data.alpaca.markets';
async function snapshots(syms){ if (!syms.length) return {}; const j = await get(`${DATA}/v2/stocks/snapshots?symbols=${syms.map(encodeURIComponent).join(',')}&feed=iex`, AH); return j || {}; }
async function bars(sym, startIso, tf = '1Min', feed = 'iex'){
  const out = []; let tok = null;
  do { const j = await get(`${DATA}/v2/stocks/bars?symbols=${encodeURIComponent(sym)}&timeframe=${tf}&start=${startIso}&limit=10000&feed=${feed}${tok ? '&page_token=' + tok : ''}`, AH); if (!j) break; for (const b of j.bars?.[sym] || []) out.push({ t: Date.parse(b.t) / 1000, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }); tok = j.next_page_token; } while (tok);
  return out;
}
const DCACHE = new Map();
async function daily(sym){
  const c = DCACHE.get(sym); if (c && Date.now() - c.at < 6 * 3600e3) return c.d;
  const d = await bars(sym, new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10), '1Day', 'sip');
  const today = new Date(Date.now() + nyo(now()) * 1000).toISOString().slice(0, 10);
  const prior = d.filter((b) => new Date((b.t + 6 * 3600) * 1000).toISOString().slice(0, 10) < today);
  DCACHE.set(sym, { at: Date.now(), d: prior }); return prior;
}
let NEWS = { at: 0, items: {} }, EARN = { at: 0, list: [] };
async function news(syms){
  if (Date.now() - NEWS.at < 10 * 60e3 || !syms.length) return; NEWS.at = Date.now();
  const j = await get(`${DATA}/v1beta1/news?symbols=${syms.map(encodeURIComponent).join(',')}&limit=50`, AH); const items = {};
  for (const n of j?.news || []) for (const s of n.symbols) if (syms.includes(s)) (items[s] ||= []).length < 3 && items[s].push({ t: n.created_at, h: n.headline, url: /^https?:\/\//i.test(n.url || '') ? n.url : null });
  NEWS.items = items;
}
async function earnings(syms){
  if (Date.now() - EARN.at < 12 * 3600e3 || !syms.length) return; EARN.at = Date.now(); const list = [];
  for (let k = 0; k < 14; k++){
    const d = new Date(Date.now() + k * 864e5); if ([0, 6].includes(d.getUTCDay())) continue;
    const ds = d.toISOString().slice(0, 10), j = await get(`https://api.nasdaq.com/api/calendar/earnings?date=${ds}`, { Accept: 'application/json' });
    for (const r of j?.data?.rows || []) if (syms.includes(r.symbol)) list.push({ sym: r.symbol, date: ds, time: r.time === 'time-pre-market' ? 'לפני הפתיחה' : r.time === 'time-after-hours' ? 'אחרי הסגירה' : 'שעה לא ידועה', forecast: r.epsForecast });
    await sleep(500);
  }
  EARN.list = list;
}

// ---------- מחזור ----------
let VIEW = { updated: null, phase: null, positions: [], watch: [], navByAcct: {}, dayPnl: 0, alerts: [], news: {}, earnings: [], configured: { alpaca: !!E.ALPACA_KEY_ID, flex: ACCTS.map((a) => a.name), push: !!E.TRADER_PUSH_KEY } };
const keyOf = (p) => `${p.acct}|${p.sym}`;
async function cycle(){
  const t = now(), cal = await calendar(), ph = T.marketPhase(cal, t, nyo);
  const dateKey = ph.date;
  let live, pushStale = false;
  if (ACCTS.length){ await refreshMorning(dateKey); if (ph.phase !== 'closed') await refreshTrades(); live = T.livePositions(MORNING.acc, TRADES.list.filter((x) => new Date((x.t + nyo(x.t)) * 1000).toISOString().slice(0, 10) === dateKey)); }
  else {
    ingestPush();
    if (S.push){
      const r = T.snapshotLive(S.push, dateKey, nyo); live = r.positions; TRADES.list = S.push.trades; pushStale = t - S.push.at > PUSH_STALE;
      MORNING.acc = Object.fromEntries(Object.entries(S.push.accounts).map(([id, A]) => [id, { ...A, usdRate: A.usdRate || S.fx?.[id] || (A.currency === 'USD' ? 1 : null) }]));
    } else live = [];
  }
  const syms = [...new Set([...live.map((p) => p.sym), ...S.watch])];
  const snap = ph.phase === 'closed' && VIEW.updated ? null : await snapshots(syms);
  await news(syms); await earnings(syms);
  const navByAcct = {}; for (const [id, A] of Object.entries(MORNING.acc)) navByAcct[id] = A.nav == null ? null : A.usdRate ? A.nav / A.usdRate : (A.currency && A.currency !== 'USD' ? null : A.nav);
  const positions = [];
  for (const p of live){
    const sn = snap?.[p.sym], last = sn?.latestTrade?.p ?? VIEW.positions.find((x) => keyOf(x) === keyOf(p))?.last ?? null;
    const k = keyOf(p), cls = S.cls[k] || (p.openedToday ? 'day' : 'swing');
    if (last != null){ S.peak[k] = Math.max(S.peak[k] ?? last, last); }
    let rec = S.rec[k];
    if (!rec || rec.entry !== p.avg || rec.cls !== cls){
      const d = await daily(p.sym), tr = T.dailyTrend(d), b = p.entryT ? await bars(p.sym, new Date((p.entryT - 3 * 3600) * 1000).toISOString()) : [];
      const st = b.length ? T.intradayStats(b.filter((x) => x.t <= (p.entryT || t)), ph.openT || 0) : null;
      rec = S.rec[k] = { cls, entry: p.avg, at: t, ...T.recommend({ cls, entry: p.avg, atr5: st?.atr5, atrD: tr?.atrD, nav: navByAcct[p.acct] }) };
      if (p.openedToday && !S.spike[k]){ const sp = T.spikeAtEntry(st); if (sp) S.spike[k] = sp; }
    }
    positions.push({ ...p, cls, last, peak: S.peak[k], rec, spike: S.spike[k] || null, acctName: ACCT_NAME[p.acct] || p.acct, pnl: last != null && p.avg != null ? (last - p.avg) * p.qty : null });
  }
  // רווח יומי (הערכה): פתוחות — מחיר עכשיו מול סגירת אתמול או מחיר הכניסה; ממומש — מכירות היום מול קניות היום או סגירת אתמול
  let dayPnl = 0;
  for (const p of positions){ const sn = snap?.[p.sym], pc = sn?.prevDailyBar?.c; if (p.last == null) continue; dayPnl += (p.openedToday || pc == null ? p.last - p.avg : p.last - pc) * p.qty; }
  { const today = TRADES.list.filter((x) => new Date((x.t + nyo(x.t)) * 1000).toISOString().slice(0, 10) === dateKey), buys = new Map();
    for (const x of today){ const k = `${x.acct}|${x.sym}`;
      if (x.side === 'BUY'){ const b = buys.get(k) || []; b.push({ q: x.qty, p: x.price }); buys.set(k, b); continue; }
      let q = x.qty; const b = buys.get(k) || [];
      while (q > 0 && b.length){ const u = Math.min(q, b[0].q); dayPnl += (x.price - b[0].p) * u; b[0].q -= u; q -= u; if (b[0].q <= 0) b.shift(); }
      if (q > 0){ const pc = snap?.[x.sym]?.prevDailyBar?.c; if (pc) dayPnl += (x.price - pc) * q; } } }
  const watch = [];
  for (const s of S.watch){
    const sn = snap?.[s], d = await daily(s), tr = T.dailyTrend(d);
    watch.push({ sym: s, last: sn?.latestTrade?.p ?? null, chg: sn?.latestTrade?.p && sn?.prevDailyBar?.c ? sn.latestTrade.p / sn.prevDailyBar.c - 1 : null, above20: tr?.above20, above50: tr?.above50, ma20Up: tr?.ma20Up, atrD: tr?.atrD, vwap: sn?.dailyBar?.vw ?? null });
  }
  const st = { positions, navByAcct, dayPnl, phase: ph, now: t };
  const fired = ph.phase === 'closed' || pushStale ? [] : T.alerts(st);
  for (const a of fired) if (!S.sent[a.key]){ S.sent[a.key] = t; await notify(a.text); }
  for (const [k, v] of Object.entries(S.sent)) if (t - v > 10 * 86400) delete S.sent[k]; // שניות — 10 ימים
  VIEW = { ...VIEW, updated: t, phase: ph, positions, pushAt: S.push?.at || null, pushStale, watch, navByAcct, dayPnl, alerts: fired.map((a) => a.text), news: NEWS.items, earnings: EARN.list };
  // אחרי הסגירה: סיכום יומי (פעם אחת)
  // בהעברה השעתית — מחכים לתמונת מצב שנלקחה אחרי הסגירה, כדי שהסיכום יכלול את כל הביצועים של היום
  const reviewReady = ACCTS.length || (S.push && S.push.at >= ph.closeT);
  if (ph.phase === 'post' && reviewReady && !S.reviews.find((r) => r.date === dateKey)) await dailyReview(dateKey, ph, positions);
  save();
}

// ---------- סיכום יומי ושבועי ----------
async function dailyReview(dateKey, ph, positions){
  const tr = TRADES.list.filter((x) => new Date((x.t + nyo(x.t)) * 1000).toISOString().slice(0, 10) === dateKey);
  const trips = [], open = new Map();
  for (const x of tr){
    const k = `${x.acct}|${x.sym}`;
    if (x.side === 'BUY'){ (open.get(k) || open.set(k, []).get(k)).push({ ...x, left: x.qty }); continue; }
    let q = x.qty; const lots = open.get(k) || [];
    while (q > 0 && lots.length){ const l = lots[0], u = Math.min(q, l.left); l.left -= u; q -= u; if (l.left <= 0) lots.shift();
      const cls = S.cls[k] || 'day', peak = S.peak[k], R = S.rec[k]?.R;
      const b = await bars(x.sym, new Date((l.t - 300) * 1000).toISOString());
      trips.push({ sym: x.sym, acct: x.acct, cls, entry: l.price, exit: x.price, qty: u, entryT: l.t, exitT: x.t, pnl: (x.price - l.price) * u - (l.commission + x.commission) * u / Math.max(u, x.qty), peakRet: peak ? peak / l.price - 1 : 0, spike: S.spike[k] || null, overnight: false, sizePct: u * l.price / ((Object.values(VIEW.navByAcct).reduce((a, v) => a + (v || 0), 0)) || Infinity), alt: R ? T.exitAlternatives({ entry: l.price, entryT: l.t, exit: x.price, R, bars: b, closeT: ph.closeT }) : null });
    }
    if (q > 0) trips.push({ sym: x.sym, acct: x.acct, cls: S.cls[k] || 'swing', entry: S.rec[k]?.entry ?? null, exit: x.price, qty: q, entryT: null, exitT: x.t, pnl: S.rec[k]?.entry ? (x.price - S.rec[k].entry) * q : 0, peakRet: 0, overnight: true });
  }
  const heldDay = positions.filter((p) => p.cls === 'day');
  const m = T.mistakes(trips.concat(heldDay.map((p) => ({ cls: 'day', overnight: true, pnl: p.pnl || 0, peakRet: 0 }))));
  const pnl = trips.reduce((a, t) => a + t.pnl, 0), wins = trips.filter((t) => t.pnl > 0).length;
  const alt = trips.filter((t) => t.alt); const avg = (f) => alt.length ? alt.reduce((a, t) => a + t.alt[f] * t.entry * t.qty, 0) : null;
  const rv = { date: dateKey, trades: trips.length, pnl, wins, mistakes: m, alt: alt.length ? { actual: avg('actual'), system: avg('system'), eod: avg('eod'), be1: avg('be1'), trail15: avg('trail15') } : null, heldDay: heldDay.map((p) => p.sym) };
  S.reviews.push(rv); S.journal.push(...trips.map((t) => ({ ...t, date: dateKey }))); S.reviews = S.reviews.slice(-120); S.journal = S.journal.slice(-2000);
  const f$ = (x) => x == null ? '—' : (x < 0 ? '‎−' : '+') + Math.abs(Math.round(x)).toLocaleString('en-US') + '$';
  const lines = [`📒 סיכום יום ${dateKey}`, `עסקאות שנסגרו: ${trips.length} (${wins} ברווח), ממומש: ${f$(pnl)}`];
  if (heldDay.length) lines.push(`⚠️ עסקאות יומיות שנשארו פתוחות: ${heldDay.map((p) => p.sym).join(', ')}`);
  for (const c of m) lines.push(`• ${c.name}: ${c.n} (${f$(c.pnl)})`);
  if (rv.alt) lines.push(`יציאות: בפועל ${f$(rv.alt.actual)} · לפי המערכת ${f$(rv.alt.system)} · סוף יום ${f$(rv.alt.eod)} · סטופ לכניסה אחרי ‎+1% ${f$(rv.alt.be1)} · נגרר 1.5% ${f$(rv.alt.trail15)}`);
  lines.push('(ההשוואה תיאורית — אין הוכחה סטטיסטית שהשיטה של המערכת עדיפה)');
  await notify(lines.join('\n'));
  // שבועי: ביום המסחר האחרון בשבוע
  const nextDay = CAL.find((d) => d.date > dateKey);
  if (nextDay && new Date(nextDay.date).getUTCDay() <= new Date(dateKey).getUTCDay()){
    const wk = S.reviews.slice(-5), tot = wk.reduce((a, r) => a + r.pnl, 0), n = wk.reduce((a, r) => a + r.trades, 0);
    const all = {}; for (const r of wk) for (const c of r.mistakes) { all[c.name] ||= { n: 0, pnl: 0 }; all[c.name].n += c.n; all[c.name].pnl += c.pnl; }
    await notify([`📊 סיכום שבועי (${wk[0]?.date} – ${dateKey})`, `עסקאות: ${n}, ממומש: ${f$(tot)}`, ...Object.entries(all).sort((a, b) => a[1].pnl - b[1].pnl).map(([k, v]) => `• ${k}: ${v.n} (${f$(v.pnl)})`)].join('\n'));
  }
}

// ---------- מסך ו-API ----------
const PAGE = readFileSync(new URL('./trader-ui.html', import.meta.url), 'utf8');
const okToken = (k) => { if (!k) return false; const a = Buffer.from(String(k)), b = Buffer.from(S.token); return a.length === b.length && timingSafeEqual(a, b); };
const body = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => { s += c; if (s.length > 1e4) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });
if (process.argv.includes('--check')){ const c = await calendar(); log('calendar days', c.length, 'flex accounts', ACCTS.map((a) => a.name).join(',') || 'אין', 'push key', !!E.TRADER_PUSH_KEY && existsSync(E.TRADER_PUSH_KEY), 'alpaca', !!E.ALPACA_KEY_ID); process.exit(c.length ? 0 : 1); }
if (process.argv.includes('--link')){ console.log(`TOKEN=${S.token}`); process.exit(0); }
createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'), ck = (req.headers.cookie || '').match(/tk=([a-f0-9]+)/)?.[1], k = u.searchParams.get('k') || ck || req.headers['x-token'];
  const send = (code, data, type = 'application/json; charset=utf-8', extra = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', ...extra }); res.end(typeof data === 'string' ? data : JSON.stringify(data)); };
  if (!okToken(k)) return send(401, 'נדרש קישור גישה', 'text/plain; charset=utf-8');
  if (u.pathname === '/') return send(200, PAGE, 'text/html; charset=utf-8', u.searchParams.get('k') ? { 'set-cookie': `tk=${k}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Strict` } : {});
  if (u.pathname === '/api/state') return send(200, { ...VIEW, cls: S.cls, audit: S.audit.slice(-50), reviews: S.reviews.slice(-20), journal: S.journal.slice(-100) });
  if (req.method === 'POST' && u.pathname === '/api/class'){
    const b = await body(req); const key = `${b.acct}|${b.sym}`;
    if (!T.CLASSES.includes(b.cls) || !b.sym) return send(400, { error: 'סיווג לא תקין' });
    S.audit.push({ t: now(), key, from: S.cls[key] || null, to: b.cls }); S.cls[key] = b.cls; delete S.rec[key]; save(); return send(200, { ok: true });
  }
  if (req.method === 'POST' && u.pathname === '/api/watch'){
    const b = await body(req); const s = String(b.sym || '').toUpperCase().replace(/[^A-Z.]/g, '').slice(0, 8); if (!s) return send(400, { error: 'סימול' });
    S.watch = b.op === 'del' ? S.watch.filter((x) => x !== s) : [...new Set([...S.watch, s])].slice(0, 30); save(); return send(200, { ok: true, watch: S.watch });
  }
  if (req.method === 'POST' && u.pathname === '/api/calc'){
    const b = await body(req); const sym = String(b.sym || '').toUpperCase().replace(/[^A-Z.]/g, ''); const cls = T.CLASSES.includes(b.cls) ? b.cls : 'day';
    const sn = (await snapshots([sym]))[sym], entry = Number(b.entry) || sn?.latestTrade?.p, d = await daily(sym), tr = T.dailyTrend(d);
    const bb = await bars(sym, new Date((now() - 4 * 3600) * 1000).toISOString()), st = bb.length ? T.intradayStats(bb, VIEW.phase?.openT || 0) : null;
    const nav = b.acct && VIEW.navByAcct[b.acct] ? VIEW.navByAcct[b.acct] : Object.values(VIEW.navByAcct).reduce((a, x) => a + (x || 0), 0) || Number(b.nav) || null;
    let rec = T.recommend({ cls, entry, atr5: st?.atr5, atrD: tr?.atrD, nav });
    if (Number(b.stop) > 0 && Number(b.stop) < entry && nav){ const dist = entry - Number(b.stop); rec = { ...rec, stop: Number(b.stop), R: dist, target: entry + (cls === 'day' ? 2 : 3) * dist, shares: Math.floor(Math.min(T.RULES.riskPct * nav / dist, T.RULES.capPct * nav / entry)), note: 'סטופ שלך; גודל לפי 0.5% סיכון ותקרה 20%' }; rec.maxLoss = rec.shares * dist; }
    const checks = { trend: tr ? { above20: tr.above20, above50: tr.above50, ma20Up: tr.ma20Up } : null, spike: T.spikeAtEntry(st), vsVwap: st?.vsVwap, earnings: EARN.list.find((e) => e.sym === sym) || null };
    return send(200, { sym, entry, cls, rec, checks, disclaimer: 'המלצת ניהול סיכון — לא איתות רווחי. לא הוכח יתרון סטטיסטי.' });
  }
  send(404, { error: 'not found' });
}).listen(PORT, '127.0.0.1', () => log('dashboard on', PORT));

// ---------- הפעלה ----------
log('start', 'accounts:', ACCTS.map((a) => a.name).join(',') || (E.TRADER_PUSH_KEY ? 'העברה שעתית מ-IBKR' : 'אין חיבור לחשבונות עדיין'));
for (;;){
  try { await cycle(); } catch (e){ log('cycle error', e.stack || e.message); }
  const ph = VIEW.phase?.phase; await sleep(ph && ph !== 'closed' ? 60e3 : 5 * 60e3);
}
