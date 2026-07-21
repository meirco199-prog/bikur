"""נקודת הכניסה: בוט הטלגרם. הרצה: python bot.py"""
import asyncio
import logging
from datetime import datetime

from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

import agent
import config
import db

logging.basicConfig(
    format="%(asctime)s %(name)s %(levelname)s %(message)s", level=logging.INFO
)
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


def _allowed(update: Update) -> bool:
    if not config.ALLOWED_USER_ID:
        return True
    return update.effective_user and str(update.effective_user.id) == config.ALLOWED_USER_ID


async def _send_reminder_job(context: ContextTypes.DEFAULT_TYPE) -> None:
    data = context.job.data
    if not db.mark_reminder(data["reminder_id"], "sent"):
        return  # בוטלה בינתיים
    await context.bot.send_message(
        chat_id=data["chat_id"], text=f"⏰ תזכורת: {data['text']}"
    )


def _make_scheduler(application: Application):
    def schedule_reminder(reminder_id: int, chat_id: int, text: str, due_at: datetime) -> None:
        application.job_queue.run_once(
            _send_reminder_job,
            when=due_at,
            data={"reminder_id": reminder_id, "chat_id": chat_id, "text": text},
            name=f"reminder-{reminder_id}",
        )
    return schedule_reminder


async def _restore_reminders(application: Application) -> None:
    """בעליית הבוט: תזמון מחדש של תזכורות ממתינות מה-DB."""
    schedule = _make_scheduler(application)
    now = datetime.now(config.TZ)
    restored = 0
    for r in db.pending_reminders_all():
        due_at = datetime.fromisoformat(r["due_at"])
        if due_at <= now:
            # פוספסה בזמן שהבוט היה כבוי — נשלח מיד
            due_at = now
        schedule(r["id"], r["chat_id"], r["text"], due_at)
        restored += 1
    if restored:
        logger.info("שוחזרו %d תזכורות ממתינות", restored)


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    await update.message.reply_text(
        f"היי! אני {config.ASSISTANT_NAME}, העוזר האישי שלך 👋\n\n"
        "אפשר לבקש ממני בשפה חופשית:\n"
        "⏰ \"תזכיר לי מחר ב-9 להתקשר ללקוח\"\n"
        "📋 \"תוסיף משימה: לשלם ארנונה\"\n"
        "📅 \"מה יש לי ביומן מחר?\"\n"
        "📧 \"יש מיילים חדשים חשובים?\"\n"
        "💬 או סתם לשאול אותי כל דבר.\n\n"
        "פקודות: /reset לאיפוס השיחה"
    )


async def cmd_reset(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update):
        return
    db.clear_history(update.effective_chat.id)
    await update.message.reply_text("איפסתי את השיחה. מתחילים מחדש 🙂")


async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not _allowed(update) or not update.message or not update.message.text:
        return
    chat_id = update.effective_chat.id
    await context.bot.send_chat_action(chat_id=chat_id, action="typing")
    schedule = _make_scheduler(context.application)
    try:
        reply = await asyncio.to_thread(
            agent.handle_message, chat_id, update.message.text, schedule
        )
    except Exception:
        logger.exception("שגיאה בעיבוד הודעה")
        reply = "אופס, נתקלתי בשגיאה. נסה שוב עוד רגע."
    await update.message.reply_text(reply)


def main() -> None:
    if not config.TELEGRAM_BOT_TOKEN:
        raise SystemExit("חסר TELEGRAM_BOT_TOKEN בקובץ .env (ראה .env.example)")
    if not config.ANTHROPIC_API_KEY:
        raise SystemExit("חסר ANTHROPIC_API_KEY בקובץ .env (ראה .env.example)")

    db.init_db()

    application = (
        Application.builder()
        .token(config.TELEGRAM_BOT_TOKEN)
        .post_init(_restore_reminders)
        .build()
    )
    application.add_handler(CommandHandler("start", cmd_start))
    application.add_handler(CommandHandler("reset", cmd_reset))
    application.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_message))

    logger.info("הבוט עולה...")
    application.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
