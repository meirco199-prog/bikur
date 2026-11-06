// דמה קריפטו בזמן אמת: מנוע "ריזיקות עקרונות" (engine/sinay-rules.js, כללים קפואים גרסה 1) רץ בתוך ה-Worker ב-cron.
// כל ~15 דקות (רק כשנסגר נר חדש): נרות 15 דקות מ-API ציבורי (Coinbase, גיבוי Kraken — בלי מפתחות), עיבוד, שמירה ב-KV
// (אותו מפתח sinay:state שמסך "קריפטו" קורא), והתראת טלגרם על כל דשדוש חדש / כניסה / מילוי שליש / יציאה.
// סימולציה בלבד: אין כאן פקודות, אין ברוקר ואין כסף אמיתי.
import { runPaper, BAR_MS, CAT } from '../engine/sinay-rules.js';
import { validateState, sha256, SINAY_KEY, SLOT_USD } from './sinay.js';
import { sendTelegram } from './alerts.js';

export const COINS = Object.keys(CAT);
const UA = { 'User-Agent': 'bikur-invest/1.0 (paper)', Accept: 'application/json' };
const KRAKEN_PAIR = { BTC: 'XBTUSD', ETH: 'ETHUSD', LTC: 'LTCUSD', BCH: 'BCHUSD' };
const FEED_ERR_KEY = 'sinay:feederr';
const iso = (sec) => new Date(sec * 1000).toISOString().replace('.000Z', 'Z');
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

// רק נרות שנסגרו (תחילת הנר + אורך הנר ≤ עכשיו; ברירת מחדל 15 דקות), בסדר עולה, בלי כפילויות, OHLC תקין
export function closedBars(rows, nowMs, barMs = BAR_MS){
  const seen = new Set(), out = [];
  for (const r of rows.slice().sort((a, b) => a[0] - b[0])){
    const [sec, o, h, l, c] = r;
    if (!isNum(sec) || seen.has(sec) || sec * 1000 + barMs > nowMs) continue;
    if (![o, h, l, c].every((x) => isNum(x) && x > 0) || h < l || h < Math.max(o, c) - 1e-9 || l > Math.min(o, c) + 1e-9) continue;
    seen.add(sec); out.push([iso(sec), o, h, l, c]);
  }
  return out;
}

// Coinbase Exchange: [[time, low, high, open, close, volume], ...] מהחדש לישן (עד 300 נרות = 75 שעות)
export function parseCoinbase(j){
  if (!Array.isArray(j)) throw new Error('coinbase: תשובה לא צפויה');
  return j.map((r) => [Number(r[0]), Number(r[3]), Number(r[2]), Number(r[1]), Number(r[4])]);
}
// Kraken: { error: [], result: { <pair>: [[time, open, high, low, close, vwap, volume, count], ...], last } } מהישן לחדש
export function parseKraken(j){
  if (!j || (j.error && j.error.length)) throw new Error('kraken: ' + String(j?.error?.[0] || 'תשובה לא צפויה').slice(0, 80));
  const k = Object.keys(j.result || {}).find((x) => x !== 'last');
  if (!k || !Array.isArray(j.result[k])) throw new Error('kraken: אין נתונים');
  return j.result[k].map((r) => [Number(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4])]);
}

export async function getJson(fetchFn, url){
  const r = await fetchFn(url, { headers: UA });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// מחזיר { bars: {BTC: [...]}, feed, errors }. מקור אחד לכל הריצה (לא מערבבים מקורות בין מטבעות באותה ריצה)
export async function fetchBars({ fetchFn = fetch, nowMs = Date.now() } = {}){
  const errors = [];
  const feeds = [
    ['coinbase', (sym) => `https://api.exchange.coinbase.com/products/${sym}-USD/candles?granularity=900`, parseCoinbase],
    ['kraken', (sym) => `https://api.kraken.com/0/public/OHLC?pair=${KRAKEN_PAIR[sym]}&interval=15`, parseKraken],
  ];
  for (const [feed, url, parse] of feeds){
    try {
      const res = await Promise.all(COINS.map(async (sym) => [sym, closedBars(parse(await getJson(fetchFn, url(sym))), nowMs)]));
      const bars = Object.fromEntries(res);
      if (COINS.every((s) => bars[s].length >= 60)) return { bars, feed, errors };
      errors.push(`${feed}: מעט מדי נרות`);
    } catch (e) { errors.push(`${feed}: ${String(e?.message || e).slice(0, 100)}`); }
  }
  return { bars: null, feed: null, errors };
}

// צריך לרוץ רק כשנסגר נר אחרי האחרון שעובד (last_t = תחילת הנר האחרון שעובד → הנר הבא נסגר ב-last_t + 30 דקות)
export function dueToRun(state, nowMs){
  if (!state?.coins) return true;
  return COINS.some((s) => { const c = state.coins[s]; return !c?.last_t || nowMs >= Date.parse(c.last_t) + 2 * BAR_MS; });
}

// ---------- התראות טלגרם ----------
const DIGITS = { BTC: 0, ETH: 2, LTC: 2, BCH: 2 };
export const fmtPx = (sym, x) => (isNum(x) ? x.toLocaleString('en-US', { minimumFractionDigits: DIGITS[sym] ?? 2, maximumFractionDigits: DIGITS[sym] ?? 2 }) : '—');
const usd = (x) => (x < 0 ? '-' : '+') + '$' + Math.abs(Math.round(x)).toLocaleString('en-US');
const ilTime = (t) => { try { return new Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(t)); } catch { return String(t).slice(5, 16).replace('T', ' '); } };
const SIDE = { short: 'שורט', long: 'לונג' };
const THIRDS = ['⅓', '⅔', '3/3'];

export function formatEvent(ev, { state, nowMs = Date.now() } = {}){
  const P = (x) => fmtPx(ev.sym, x);
  const late = nowMs - Date.parse(ev.t) > 2 * 3600e3 ? ` (באיחור, מ-${ilTime(ev.t)})` : '';
  if (ev.type === 'setup'){
    return [`🪙 ${ev.sym} — דשדוש 12 שעות זוהה${late}`,
      `טווח: ${P(ev.lo)}–${P(ev.hi)} (${ev.widthPct.toFixed(2)}%)`,
      `🔻 שורט אם יעלה: ${ev.short.lv.map((x, i) => `${P(x)} (${THIRDS[i]})`).join(' · ')} · סטופ ${P(ev.short.stop)}`,
      `🔺 לונג אם ירד: ${ev.long.lv.map((x, i) => `${P(x)} (${THIRDS[i]})`).join(' · ')} · סטופ ${P(ev.long.stop)}`,
      `תקף עד ${ilTime(ev.validUntil)}`].join('\n');
  }
  if (ev.type === 'entry'){
    const rest = ev.levels.slice(1).map(P).join(' · ');
    return [`🟢 ${ev.sym}: נכנסנו ל${SIDE[ev.side]} — שליש 1/3 ב-${P(ev.price)}${late}`, `הבאים: ${rest} · סטופ ${P(ev.stop)} · יעד EMA50 ≈ ${P(ev.ema)}`].join('\n');
  }
  if (ev.type === 'fill') return `➕ ${ev.sym}: מילוי שליש ${ev.third}/3 ב-${P(ev.price)} (${SIDE[ev.side]})${late}`;
  if (ev.type === 'exit'){
    const t = ev.trade, pnl = t.net_pct / 100 * SLOT_USD;
    const all = state?.trades || [], tot = all.reduce((x, y) => x + y.net_pct / 100 * SLOT_USD, 0), wins = all.filter((y) => y.net_pct > 0).length;
    return [`${t.net_pct > 0 ? '✅' : '❌'} ${t.sym}: יציאה מ${SIDE[t.side]} (${t.why}) ב-${P(t.exit)}${late}`,
      `${t.net_pct > 0 ? '+' : ''}${t.net_pct.toFixed(2)}% · ${usd(pnl)} על 50K$ (${t.fills}/3 שלישים, כניסה ממוצעת ${P(t.avg)})`,
      `מצטבר: ${all.length} עסקאות, ${wins} הצלחות, ${usd(tot)}`].join('\n');
  }
  return null;
}

export function formatMessage(events, opts){
  const parts = events.map((e) => formatEvent(e, opts)).filter(Boolean);
  if (!parts.length) return null;
  return `📝 דמה קריפטו (בלי כסף אמיתי)\n\n${parts.join('\n\n')}\n\ninvest → 🪙 קריפטו`.slice(0, 3900);
}

// ---------- ריצה אחת (מ-scheduled של ה-Worker) ----------
export async function runSinayLive(ctx, { fetchFn = fetch, now = new Date(), force = false, notify = true } = {}){
  const nowMs = now.getTime();
  const stored = await ctx.db.get(SINAY_KEY);
  const prev = stored?.state || null;
  if (!force && prev && !dueToRun(prev, nowMs)) return { ok: true, skipped: 'no_new_bar' };
  const { bars, feed, errors } = await fetchBars({ fetchFn, nowMs });
  if (!bars){
    // שגיאת מקור נרשמת פעם בשעה לכל היותר (מכסת כתיבות KV)
    if (!(await ctx.db.get(FEED_ERR_KEY))){ await ctx.db.put(FEED_ERR_KEY, { at: now.toISOString(), errors }, { ttl: 3600 }); await ctx.db.logError('sinay-live', errors.join(' | ')); }
    return { ok: false, errors };
  }
  const st = prev ? JSON.parse(JSON.stringify(prev)) : null;
  const r = runPaper(st, bars);
  const state = validateState(r.state);
  const hash = await sha256(JSON.stringify(state));
  if (stored?.hash === hash) return { ok: true, changed: false, feed };
  await ctx.db.put(SINAY_KEY, { hash, receivedAt: now.toISOString(), source: { engine: 'worker', feed, lastRunAt: now.toISOString(), fallbackErrors: errors.length ? errors : undefined }, state });
  let telegram = null;
  if (notify && r.events.length){
    const text = formatMessage(r.events, { state, nowMs });
    if (text) telegram = await sendTelegram(ctx.env, text);
  }
  return { ok: true, changed: true, feed, events: r.events.length, newTrades: r.trades.length, telegram };
}
