// מסלול "עמית" בזמן אמת (engine/amit-rules.js): סקאלפ ביטקוין על נרות דקה, רץ ב-cron של ה-Worker (כל 5 דקות) ליד
// דמה "ריזיקות עקרונות". נרות מ-Coinbase (גיבוי Kraken, בלי מפתחות). סימולציה בלבד: אין פקודות, אין ברוקר, אין כסף אמיתי.
// מכסת KV (1,000 כתיבות ביום בתוכנית החינמית): כותבים כשנפתחה/נסגרה עסקה (עד 150 ביום), פעם בשעה (עד 24) ובסיכום היומי (1)
// — כלומר עד ~175 ביום, ותקרה קשיחה של 180 לכל סוגי הכתיבה (גם הרצה ידנית). השמירה השעתית לא נחסמת במכסת האירועים, ולכן
// בריצה שלא נכתבה לא הולך לאיבוד כלום: המצב השמור (לכל היותר בן שעה) + 300 הנרות האחרונים (5 שעות) משחזרים בדיוק את אותו מצב.
// חור אמיתי בנתונים (מקור לא זמין יותר מ-5 שעות) נספר ב-meta.gaps, והדוח מסמן את התוצאות כחלקיות.
// טלגרם: סיכום קריפטו יומי אחד (בערב) לשני מסלולי הדמה — עמית ו"ריזיקות עקרונות" — ולא הודעה על כל עסקה
// (החלטת מאיר, 6/11/2026: "אין צורך בהתראות על הקריפטו מלבד סיכום יום").
import { AMIT, warmAmit, processAmit, amitUnrealized, bands } from '../engine/amit-rules.js';
import { closedBars, parseCoinbase, parseKraken, getJson, sinayDayLines } from './sinay-live.js';
import { SINAY_KEY } from './sinay.js';
import { sendTelegram } from './alerts.js';

export const AMIT_KEY = 'amit:state';
export const AMITBOT_KEY = 'amitbot:report'; // דוח הבוט בחשבון הדמו של Bybit (scripts/bybit-amit-bot.mjs), כל שעתיים
const FEED_ERR_KEY = 'amit:feederr';
export const SAVE_EVERY_MS = 3600e3, MAX_EVENT_WRITES_DAY = 150, MAX_WRITES_DAY = 180, SUMMARY_HOUR_IL = 21;
const STALE_MIN = 20;
const r2 = (x) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
const r4 = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : null);
const usd = (x) => (x < 0 ? '-' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US');

// תאריך ושעה בישראל (לסיכום היומי)
export function ilParts(ms){
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export async function fetchBars1m({ fetchFn = fetch, nowMs = Date.now() } = {}){
  const errors = [];
  const feeds = [
    ['coinbase', 'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60', parseCoinbase],
    ['kraken', 'https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1', parseKraken],
  ];
  for (const [feed, url, parse] of feeds){
    try {
      const bars = closedBars(parse(await getJson(fetchFn, url)), nowMs, AMIT.barMs);
      if (bars.length >= 30) return { bars, feed, errors };
      errors.push(`${feed}: מעט מדי נרות`);
    } catch (e) { errors.push(`${feed}: ${String(e?.message || e).slice(0, 100)}`); }
  }
  return { bars: null, feed: null, errors };
}

// דוח מהבוט (POST /amit/bot, סוד הגשר): נשמר כמו שהוא אחרי בדיקה. תקרת כתיבות: לא יותר מפעם ב-20 דקות, חוץ משינוי מצב עצירה
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);
export function cleanBotReport(b){
  if (!b || typeof b !== 'object' || b.v !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(String(b.day))) throw Object.assign(new Error('דוח בוט לא תקין'), { status: 400 });
  const part = (x) => ({ n: Math.max(0, Math.round(num(x?.n) || 0)), wins: Math.max(0, Math.round(num(x?.wins) || 0)), netUsd: num(x?.netUsd) ?? 0 });
  const pos = b.pos && ['long', 'short'].includes(b.pos.side) ? { side: b.pos.side, size: num(b.pos.size), entry: num(b.pos.entry) } : null;
  return { v: 1, day: b.day, startedAt: typeof b.startedAt === 'string' ? b.startedAt.slice(0, 30) : null, equity: num(b.equity), today: part(b.today), total: part(b.total),
    pos, halt: ['daily', 'stop'].includes(b.halt) ? b.halt : null, lastError: b.lastError ? String(b.lastError).slice(0, 200) : null };
}
export async function recordAmitBot(db, body, { now = new Date() } = {}){
  const rep = cleanBotReport(body), prev = await db.get(AMITBOT_KEY);
  if (prev && prev.halt === rep.halt && now.getTime() - Date.parse(prev.receivedAt) < 20 * 60e3) return { ok: true, saved: false, throttled: true };
  await db.put(AMITBOT_KEY, { ...rep, receivedAt: now.toISOString() });
  return { ok: true, saved: true };
}
export function botLines(rep, nowMs){
  if (!rep) return [];
  const ageH = (nowMs - Date.parse(rep.receivedAt)) / 3600e3;
  return [`🤖 בוט בחשבון הדמו של Bybit (אותם כללים, פקודות אמיתיות על כסף וירטואלי)`,
    rep.today.n ? `היום: ${rep.today.n} עסקאות, ${rep.today.wins} הצלחות, נטו ${usd(rep.today.netUsd)}` : 'היום: לא היו עסקאות',
    `מצטבר: ${rep.total.n} עסקאות, ${rep.total.wins} הצלחות, נטו ${usd(rep.total.netUsd)}${rep.equity ? ` · הון ${Math.round(rep.equity).toLocaleString('en-US')}$` : ''}`,
    ...(rep.halt ? [rep.halt === 'daily' ? '⛔ נעצר היום: מגבלת הפסד יומית (1,000$)' : '⏸️ עצור ידנית'] : []),
    ...(ageH > 3 ? [`⚠️ אין דיווח מהבוט ${Math.round(ageH)} שעות — כנראה לא רץ`] : [])];
}

export function formatSummary(state, day, sinayState = null, botRep = null, nowMs = Date.now()){
  const today = (state.trades || []).filter((t) => t.close && t.close.length && dayOf(t.close) === day);
  const net = today.reduce((x, t) => x + t.net_usd, 0), fees = today.reduce((x, t) => x + t.fees_usd, 0);
  const wins = today.filter((t) => t.net_usd > 0).length, a = state.agg;
  const lines = [`🪙 קריפטו — סיכום יום (דמה, בלי כסף אמיתי)`, `🧪 מסלול עמית (סקאלפ ביטקוין)`,
    today.length ? `היום: ${today.length} עסקאות, ${wins} הצלחות, נטו ${usd(net)} (מזה עמלות ${usd(-fees)})` : 'היום: לא היו עסקאות',
    `מצטבר: ${a.n} עסקאות, ${a.wins} הצלחות, נטו ${usd(a.netUsd)} · עמלות ${usd(-a.feesUsd)}`,
    `חשבון: ${Math.round(AMIT.account + a.netUsd).toLocaleString('en-US')}$ מתוך ${AMIT.account.toLocaleString('en-US')}$ · פוזיציה ${AMIT.notional.toLocaleString('en-US')}$`];
  if (state.pos) lines.push(`פתוח עכשיו: ${state.pos.side === 'long' ? 'לונג' : 'שורט'} מ-${Math.round(state.pos.entry).toLocaleString('en-US')}`);
  const sl = sinayDayLines(sinayState, (iso) => dayOf(iso) === day), bl = botLines(botRep, nowMs);
  return `${lines.join('\n')}${bl.length ? '\n\n' + bl.join('\n') : ''}${sl.length ? '\n\n' + sl.join('\n') : ''}\n\ninvest → 🪙 קריפטו`;
}
const dayOf = (iso) => ilParts(Date.parse(iso)).day;

// ריצה אחת (מ-scheduled של ה-Worker או POST /amit/run)
export async function runAmitLive(ctx, { fetchFn = fetch, now = new Date(), force = false, notify = true } = {}){
  const nowMs = now.getTime();
  const stored = await ctx.db.get(AMIT_KEY);
  const prev = stored?.state?.version === AMIT.version ? stored.state : null;
  if (!force && prev?.last_t && nowMs < Date.parse(prev.last_t) + 2 * AMIT.barMs) return { ok: true, skipped: 'no_new_bar' };
  const { bars, feed, errors } = await fetchBars1m({ fetchFn, nowMs });
  if (!bars){
    if (!(await ctx.db.get(FEED_ERR_KEY))){ await ctx.db.put(FEED_ERR_KEY, { at: now.toISOString(), errors }, { ttl: 3600 }); await ctx.db.logError('amit-live', errors.join(' | ')); }
    return { ok: false, errors };
  }
  const { day, hour } = ilParts(nowMs);
  const meta = stored?.meta && prev ? { ...stored.meta } : { savedAt: null, writesDay: day, writes: 0, gaps: 0, summaryDay: null };
  if (meta.writesDay !== day){ meta.writesDay = day; meta.writes = 0; meta.eventWrites = 0; }
  let state, r = { trades: [], events: [] };
  if (!prev) state = warmAmit(bars);
  else {
    state = JSON.parse(JSON.stringify(prev));
    // חור בנתונים (לא נשמר יותר מ-5 שעות / תקלה במקור): ממשיכים מהנרות שיש, ומתעדים
    if (Date.parse(bars[0][0]) > Date.parse(state.last_t) + AMIT.barMs) meta.gaps += 1;
    r = processAmit(state, bars);
  }
  const summaryDue = notify && hour >= SUMMARY_HOUR_IL && meta.summaryDay !== day && !!prev;
  const moved = r.events.length > 0;
  const hourly = !meta.savedAt || nowMs - Date.parse(meta.savedAt) >= SAVE_EVERY_MS;
  const eventsOk = (meta.eventWrites || 0) < MAX_EVENT_WRITES_DAY;
  const want = force || !prev || summaryDue || hourly || (moved && eventsOk);
  // תקרה קשיחה לכל הכתיבות ביום (חוץ מהשמירה הראשונה של מצב חדש) — גם force, גם שעתית, גם סיכום
  if (!want || (prev && meta.writes >= MAX_WRITES_DAY)) return { ok: true, saved: false, feed, events: r.events.length, capped: (moved && !eventsOk) || !!want };
  let telegram = null;
  if (summaryDue){
    let sinay = null, bot = null; try { sinay = (await ctx.db.get(SINAY_KEY))?.state || null; bot = await ctx.db.get(AMITBOT_KEY); } catch { sinay = sinay || null; }
    telegram = await sendTelegram(ctx.env, formatSummary(state, day, sinay, bot, nowMs)); meta.summaryDay = day;
  }
  if (moved && !(force || summaryDue || hourly)) meta.eventWrites = (meta.eventWrites || 0) + 1;
  meta.savedAt = now.toISOString(); meta.writes += 1;
  await ctx.db.put(AMIT_KEY, { savedAt: meta.savedAt, meta, source: { feed, lastRunAt: now.toISOString(), fallbackErrors: errors.length ? errors : undefined }, state });
  return { ok: true, saved: true, feed, events: r.events.length, newTrades: r.trades.length, telegram };
}

// הדוח למסך: פונקציה טהורה של המצב השמור
export function amitReport(stored, { now = new Date() } = {}){
  const P = AMIT;
  const params = { sym: P.sym, bar: '1 דקה', bands: `בולינגר ${P.bbN}, ${P.bbK}`, slPct: P.slPct, maxMins: P.maxBars, notionalUsd: P.notional, marginUsd: P.margin, accountUsd: P.account, takerPct: P.takerPct, makerPct: P.makerPct };
  const base = { track: 'amit', title: 'מסלול עמית — סקאלפ ביטקוין', version: P.version, paper: true, params,
    disclaimer: 'סימולציה בלבד — בלי כסף אמיתי. הכללים מצילומי המסך של עמית (6/11): כניסה ברצועת בולינגר אחת, יציאה בנגדית, סטופ ועמלות כמו אצלו.' };
  const s = stored?.state;
  if (!s) return { ...base, waiting: true, note: 'ממתין לריצה הראשונה (כל 5 דקות)', equityUsd: P.account, pnlUsd: 0, trades: [], openPosition: null };
  const a = s.agg, mark = s.mark?.[1] ?? null;
  const u = amitUnrealized(s.pos, mark);
  const equity = P.account + a.netUsd + (u ?? 0);
  const losses = a.n - a.wins;
  const avgWin = a.wins ? a.winUsd / a.wins : null, avgLoss = losses ? a.lossUsd / losses : null;
  // אחוז הצלחה שנדרש כדי לא להפסיד, לפי הרווח וההפסד הממוצעים בפועל
  const breakeven = avgWin && avgLoss ? -avgLoss / (avgWin - avgLoss) : null;
  const { day } = ilParts(now.getTime());
  const today = (s.trades || []).filter((t) => dayOf(t.close) === day);
  const ageMin = s.last_t ? (now.getTime() - Date.parse(s.last_t)) / 60e3 : null;
  return {
    ...base, start: s.start, lastBar: s.last_t, mark, feed: stored.source?.feed || null, lastRunAt: stored.source?.lastRunAt || null,
    stale: Number.isFinite(ageMin) && ageMin > STALE_MIN + 60, ageMinutes: r2(ageMin), gaps: stored.meta?.gaps || 0, partial: (stored.meta?.gaps || 0) > 0,
    equityUsd: r2(equity), pnlUsd: r2(equity - P.account), pnlPct: r4((equity - P.account) / P.account),
    realizedUsd: r2(a.netUsd), unrealizedUsd: r2(u), grossUsd: r2(a.grossUsd), feesUsd: r2(a.feesUsd),
    stats: { trades: a.n, wins: a.wins, losses, winRate: a.n ? r4(a.wins / a.n) : null, avgWinUsd: r2(avgWin), avgLossUsd: r2(avgLoss), breakevenWinRate: r4(breakeven), maxDrawdownUsd: r2(-a.maxDdUsd), target: 50 },
    today: { trades: today.length, wins: today.filter((t) => t.net_usd > 0).length, netUsd: r2(today.reduce((x, t) => x + t.net_usd, 0)) },
    openPosition: s.pos ? { side: s.pos.side, entry: r2(s.pos.entry), target: s.closes?.length >= P.bbN ? r2(s.pos.side === 'long' ? bands(s.closes, P.bbK).up : bands(s.closes, P.bbK).lo) : null, sl: r2(s.pos.sl), start: s.pos.start, mins: s.pos.age, mark, unrealizedUsd: r2(u) } : null,
    trades: (s.trades || []).slice(-50).reverse(),
  };
}
