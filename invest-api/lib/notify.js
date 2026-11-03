// ערוץ ישיר מ-Claude לטלגרם של בעל הריפו (Issue #196): POST /notify?secret=CRON_SECRET עם {text}.
// מופעל מה-workflow notify-meir.yml (תגובה של בעל הריפו ב-Issue #196 שמתחילה ב-<!-- notify-meir -->), כך ש-Claude לא מחזיק
// אף סוד. השליחה עצמה — אותו קוד של ההתראות (sendTelegram ב-lib/alerts.js). dedupe: אותו טקסט בתוך 10 דקות נשלח פעם אחת.
import { sendTelegram } from './alerts.js';
import { sha256Hex } from './keys.js';

export const NOTIFY_MAX = 1500;
export const NOTIFY_DEDUPE_TTL = 600; // שניות
export const NOTIFY_PREFIX = '🤖 הודעה מ-Claude\n\n';

// תווי בקרה מוסרים (חוץ משורה חדשה וטאב); \r\n → \n; רווחים בקצוות נחתכים
export function cleanText(raw){
  return String(raw).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '').trim();
}

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

export async function notifyOwner(ctx, body){
  if (!body || typeof body.text !== 'string') throw bad('חסר text (מחרוזת)');
  if (body.text.length > NOTIFY_MAX) throw bad(`text ארוך מדי (מקסימום ${NOTIFY_MAX} תווים)`);
  const text = cleanText(body.text);
  if (!text) throw bad('text ריק');
  const key = `notify:dedupe:${await sha256Hex(text)}`;
  if (await ctx.db.get(key)) return { ok: true, telegram: 'skipped_duplicate', duplicate: true };
  const telegram = await sendTelegram(ctx.env, NOTIFY_PREFIX + text);
  // נרשם רק אחרי שליחה מוצלחת — כך ניסיון חוזר אחרי תקלה/הגדרת הטוקן לא נחסם (וגם לא מבזבז כתיבות KV)
  if (telegram === 'ok') await ctx.db.put(key, { at: new Date().toISOString() }, { ttl: NOTIFY_DEDUPE_TTL });
  return { ok: telegram === 'ok', telegram };
}
