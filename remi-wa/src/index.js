// רמי — עוזר אישי חינמי בוואטסאפ.
// מתחבר לחשבון הוואטסאפ שלך דרך פרוטוקול WhatsApp Web (סריקת QR חד-פעמית)
// ועונה לך בצ'אט "הודעות לעצמי". בלי מנוי, בלי API בתשלום, בלי מספר נוסף.

process.env.TZ = process.env.TZ || 'Asia/Jerusalem';

import baileys, { useMultiFileAuthState, DisconnectReason, jidNormalizedUser } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleMessage, morningBrief, HELP, fmtTime } from './bot.js';
import * as store from './store.js';

const makeWASocket = baileys.default ?? baileys;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, '..', 'auth');

// תו בלתי-נראה שמסמן הודעות שהבוט עצמו שלח (מונע לולאה בצ'אט לעצמי)
const BOT_MARK = '​';
// שעת סיכום הבוקר (אפשר לשנות עם BRIEF_HOUR=7 וכו', או BRIEF_HOUR=off לביטול)
const BRIEF_HOUR = process.env.BRIEF_HOUR === 'off' ? null : parseInt(process.env.BRIEF_HOUR || '8', 10);
// אופציונלי: מספר נוסף שמורשה לדבר עם הבוט (למשל אם הבוט רץ על מספר שני)
const ALLOWED_NUMBER = (process.env.ALLOWED_NUMBER || '').replace(/\D/g, '');

let sock = null;
let selfJid = null;
const sentByBot = new Set();

function extractText(msg) {
  const m = msg.message;
  if (!m) return null;
  return m.conversation
    || m.extendedTextMessage?.text
    || m.imageMessage?.caption
    || null;
}

async function reply(jid, text) {
  const sent = await sock.sendMessage(jid, { text: BOT_MARK + text });
  if (sent?.key?.id) {
    sentByBot.add(sent.key.id);
    if (sentByBot.size > 500) sentByBot.delete(sentByBot.values().next().value);
  }
}

async function onMessage(msg) {
  const text = extractText(msg);
  if (!text || text.startsWith(BOT_MARK)) return;
  if (msg.key.id && sentByBot.has(msg.key.id)) return;

  const jid = jidNormalizedUser(msg.key.remoteJid || '');
  const isSelfChat = msg.key.fromMe && jid === selfJid;
  const senderNumber = jid.split('@')[0];
  const isAllowed = ALLOWED_NUMBER && senderNumber === ALLOWED_NUMBER && !msg.key.fromMe;
  if (!isSelfChat && !isAllowed) return; // מתעלם מכל שאר הצ'אטים — פרטיות מלאה

  try {
    const answer = handleMessage(text);
    await reply(jid, answer);
  } catch (err) {
    console.error('שגיאה בטיפול בהודעה:', err);
    await reply(jid, 'אופס, משהו השתבש 😅 נסה שוב.');
  }
}

function targetJid() {
  return ALLOWED_NUMBER ? ALLOWED_NUMBER + '@s.whatsapp.net' : selfJid;
}

// בודק כל 20 שניות אם יש תזכורות שהגיע זמנן + סיכום בוקר
function startScheduler() {
  setInterval(async () => {
    if (!sock || !selfJid) return;
    const now = Date.now();

    for (const r of store.dueReminders(now)) {
      try {
        await reply(targetJid(), `⏰ *תזכורת:* ${r.text}` + (r.recurringDaily ? '\n(תזכורת יומית — תחזור מחר)' : ''));
        store.markReminderFired(r.id, now);
      } catch (err) {
        console.error('שגיאה בשליחת תזכורת:', err);
      }
    }

    if (BRIEF_HOUR !== null) {
      const d = new Date();
      const todayStr = d.toDateString();
      if (d.getHours() === BRIEF_HOUR && store.getLastBriefDate() !== todayStr) {
        store.setLastBriefDate(todayStr);
        const brief = morningBrief(d);
        if (brief) {
          try { await reply(targetJid(), brief); } catch (err) { console.error('שגיאה בסיכום בוקר:', err); }
        }
      }
    }

    store.pruneOldEvents(now);
  }, 20000);
}

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    syncFullHistory: false,
    markOnlineOnConnect: false, // כדי שההתראות בטלפון ימשיכו לעבוד כרגיל
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 סרוק את הקוד עם וואטסאפ בטלפון:');
      console.log('   וואטסאפ ← הגדרות ← מכשירים מקושרים ← קישור מכשיר\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      selfJid = jidNormalizedUser(sock.user.id);
      console.log(`✅ מחובר! (${selfJid.split('@')[0]})`);
      console.log('💬 פתח בוואטסאפ את הצ\'אט עם עצמך ("הודעות לעצמי") וכתוב "עזרה".');
      if (ALLOWED_NUMBER) console.log(`👤 גם המספר ${ALLOWED_NUMBER} מורשה לדבר עם הבוט.`);
      if (BRIEF_HOUR !== null) console.log(`🌅 סיכום בוקר יומי בשעה ${String(BRIEF_HOUR).padStart(2, '0')}:00.`);
    }
    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('❌ נותקת מוואטסאפ. מחק את התיקייה auth/ והפעל מחדש כדי לסרוק QR חדש.');
        process.exit(1);
      }
      console.log('🔄 החיבור נפל, מתחבר מחדש...');
      setTimeout(connect, 3000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) await onMessage(msg);
  });
}

console.log('🤖 רמי — עוזר אישי בוואטסאפ (חינמי, רץ אצלך)');
connect().then(startScheduler).catch(err => {
  console.error('שגיאת התחברות:', err);
  process.exit(1);
});
