// מפתחות ספקים: Secrets של ה-Worker (env) גוברים; אחרת KV (cfg:keys) שמוזן דרך האפליקציה (POST /keys, מאומת).
// המפתחות לעולם לא מוחזרים ללקוח — רק מסכה. אימות: APP_TOKEN (secret) או sha256 (APP_TOKEN_SHA256, לא סודי).
export const KEY_NAMES = ['TWELVEDATA_KEY', 'TIINGO_KEY', 'FINNHUB_KEY', 'FMP_KEY', 'ALPHAVANTAGE_KEY', 'FRED_KEY', 'EODHD_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'RESEND_KEY', 'ALERT_EMAIL', 'ANTHROPIC_API_KEY', 'EDGAR_UA', 'CRON_BATCH', 'STOOQ_ENABLED'];
export const KEY_LABELS = { TWELVEDATA_KEY: 'Twelve Data (מחירים יומיים + quote) — חינם 800/יום', TIINGO_KEY: 'Tiingo (מחירים יומיים) — חינם', FINNHUB_KEY: 'Finnhub (quote, אנליסטים, חדשות) — חינם', FRED_KEY: 'FRED (מאקרו, VIX, ריבית) — חינם', ALPHAVANTAGE_KEY: 'Alpha Vantage (סנטימנט, ETF, insider) — חינם 25/יום', FMP_KEY: 'FMP (screener, תחזיות, יעדי מחיר) — חינם 250/יום', EODHD_KEY: 'EODHD (בורסת ת"א) — בתשלום', TELEGRAM_BOT_TOKEN: 'Telegram bot token', TELEGRAM_CHAT_ID: 'Telegram chat id', RESEND_KEY: 'Resend (אימייל) API key', ALERT_EMAIL: 'כתובת אימייל להתראות', ANTHROPIC_API_KEY: 'Anthropic API key (עוזר AI; אחרת Workers AI)', EDGAR_UA: 'User-Agent ל-SEC (שם + אימייל)', CRON_BATCH: 'נכסים לכל הפעלת cron', STOOQ_ENABLED: 'Stooq (1 = מופעל; חסום לרוב מ-Cloudflare)' };

export async function resolveEnv(env, db){
  const stored = (await db.get('cfg:keys')) || {};
  const out = { ...env };
  for (const k of KEY_NAMES) if (!out[k] && stored[k]) out[k] = stored[k];
  return out;
}
export const mask = (v) => (v ? (String(v).length > 8 ? String(v).slice(0, 3) + '…' + String(v).slice(-3) : '•••') : '');
export async function keysStatus(env, db){
  const stored = (await db.get('cfg:keys')) || {};
  return KEY_NAMES.map((k) => ({ name: k, label: KEY_LABELS[k], set: !!(env[k] || stored[k]), source: env[k] ? 'secret' : stored[k] ? 'app' : null, masked: mask(env[k] || stored[k]) }));
}
export async function setKey(db, name, value){
  if (!KEY_NAMES.includes(name)) throw new Error('שם מפתח לא מוכר');
  const stored = (await db.get('cfg:keys')) || {};
  const v = String(value || '').trim();
  if (v) stored[name] = v.slice(0, 500); else delete stored[name];
  await db.put('cfg:keys', stored);
}
export async function sha256Hex(s){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function isAuthed(req, env){
  const h = req.headers.get('Authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (env.APP_TOKEN) return tok === env.APP_TOKEN;
  if (env.APP_TOKEN_SHA256) return !!tok && (await sha256Hex(tok)) === String(env.APP_TOKEN_SHA256).toLowerCase();
  return true; // לא הוגדר טוקן כלל → פתוח (מוצג כאזהרה ב-/health)
}
