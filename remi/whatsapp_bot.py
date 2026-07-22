"""גרסת הוואטסאפ של רמי — שרת webhook ל-WhatsApp Business Cloud API של Meta.

הרצה: uvicorn whatsapp_bot:app --host 0.0.0.0 --port 8000
(דורש כתובת HTTPS ציבורית — ראה README-whatsapp.md)
"""
import logging
from collections import OrderedDict
from datetime import datetime

import requests
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import BackgroundTasks, FastAPI, Request, Response

import agent
import config
import db

logging.basicConfig(
    format="%(asctime)s %(name)s %(levelname)s %(message)s", level=logging.INFO
)
logger = logging.getLogger(__name__)

GRAPH_URL = f"https://graph.facebook.com/v21.0/{config.WHATSAPP_PHONE_NUMBER_ID}/messages"

app = FastAPI()
scheduler = BackgroundScheduler(timezone=str(config.TZ))

# הגנה מכפילויות: Meta עשויה לשלוח את אותו webhook יותר מפעם אחת
_seen_message_ids: OrderedDict[str, None] = OrderedDict()


def send_whatsapp_message(wa_number: str, text: str) -> None:
    resp = requests.post(
        GRAPH_URL,
        headers={"Authorization": f"Bearer {config.WHATSAPP_TOKEN}"},
        json={
            "messaging_product": "whatsapp",
            "to": wa_number,
            "type": "text",
            "text": {"body": text[:4096]},
        },
        timeout=30,
    )
    if resp.status_code >= 400:
        logger.error("שליחת וואטסאפ נכשלה (%s): %s", resp.status_code, resp.text)
    resp.raise_for_status()


def _send_reminder(reminder_id: int, wa_number: str, text: str) -> None:
    if not db.mark_reminder(reminder_id, "sent"):
        return  # בוטלה בינתיים
    try:
        send_whatsapp_message(wa_number, f"⏰ תזכורת: {text}")
    except Exception:
        # מחוץ לחלון 24 השעות Meta עשויה לדחות הודעה רגילה — ראה README-whatsapp.md
        logger.exception("שליחת תזכורת %s נכשלה", reminder_id)


def schedule_reminder(reminder_id: int, chat_id: int, text: str, due_at: datetime) -> None:
    scheduler.add_job(
        _send_reminder,
        trigger="date",
        run_date=due_at,
        args=[reminder_id, str(chat_id), text],
        id=f"reminder-{reminder_id}",
        replace_existing=True,
    )


def _restore_reminders() -> None:
    now = datetime.now(config.TZ)
    restored = 0
    for r in db.pending_reminders_all():
        due_at = datetime.fromisoformat(r["due_at"])
        if due_at <= now:
            due_at = now  # פוספסה בזמן שהשרת היה כבוי — נשלח מיד
        schedule_reminder(r["id"], r["chat_id"], r["text"], due_at)
        restored += 1
    if restored:
        logger.info("שוחזרו %d תזכורות ממתינות", restored)


@app.on_event("startup")
def on_startup() -> None:
    if not config.WHATSAPP_TOKEN or not config.WHATSAPP_PHONE_NUMBER_ID:
        raise SystemExit("חסרים WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID בקובץ .env")
    if not config.ANTHROPIC_API_KEY:
        raise SystemExit("חסר ANTHROPIC_API_KEY בקובץ .env")
    db.init_db()
    scheduler.start()
    _restore_reminders()
    logger.info("שרת הוואטסאפ עלה")


@app.get("/webhook")
def verify_webhook(request: Request):
    """אימות ה-webhook מול Meta (קורה פעם אחת בהגדרה)."""
    params = request.query_params
    if (
        params.get("hub.mode") == "subscribe"
        and params.get("hub.verify_token") == config.WHATSAPP_VERIFY_TOKEN
    ):
        return Response(content=params.get("hub.challenge", ""), media_type="text/plain")
    return Response(status_code=403)


def _process_message(wa_number: str, text: str) -> None:
    try:
        reply = agent.handle_message(int(wa_number), text, schedule_reminder)
    except Exception:
        logger.exception("שגיאה בעיבוד הודעה")
        reply = "אופס, נתקלתי בשגיאה. נסה שוב עוד רגע."
    try:
        send_whatsapp_message(wa_number, reply)
    except Exception:
        logger.exception("שליחת תשובה נכשלה")


@app.post("/webhook")
async def receive_webhook(request: Request, background_tasks: BackgroundTasks):
    payload = await request.json()
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for msg in value.get("messages", []):
                if msg.get("type") != "text":
                    continue
                msg_id = msg.get("id", "")
                if msg_id in _seen_message_ids:
                    continue
                _seen_message_ids[msg_id] = None
                while len(_seen_message_ids) > 500:
                    _seen_message_ids.popitem(last=False)

                wa_number = msg.get("from", "")
                if config.ALLOWED_WA_NUMBER and wa_number != config.ALLOWED_WA_NUMBER:
                    logger.info("הודעה ממספר לא מורשה: %s", wa_number)
                    continue
                text = msg.get("text", {}).get("body", "").strip()
                if not text:
                    continue
                # מחזירים 200 מיד ל-Meta ומעבדים ברקע
                background_tasks.add_task(_process_message, wa_number, text)
    return {"status": "ok"}
