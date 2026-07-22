"""המוח של העוזר: לולאת tool-use מול Claude."""
import json
import logging
from datetime import datetime, timedelta

import anthropic

import config
import db
import google_services as gsvc

logger = logging.getLogger(__name__)

client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY or None)

SYSTEM_PROMPT = f"""אתה {config.ASSISTANT_NAME}, עוזר אישי בטלגרם. אתה מדבר עברית טבעית וחברית (ועונה באנגלית אם פונים אליך באנגלית).

היכולות שלך, דרך הכלים שעומדים לרשותך:
- תזכורות: קביעה, הצגה וביטול. תזכורת נשלחת למשתמש בטלגרם בזמן שנקבע.
- משימות: רשימת מטלות פשוטה — הוספה, הצגה, סימון כבוצע, מחיקה.
- יומן גוגל: הצגת אירועים, קביעת פגישות, מחיקת אירועים.
- Gmail: חיפוש וקריאת מיילים, ויצירת טיוטות תשובה (אתה לא שולח מיילים — רק טיוטות, והמשתמש שולח בעצמו).
- שיחה חופשית: שאלות, ניסוחים, רעיונות, תרגומים — בלי כלים.

כללים:
- כשהמשתמש נוקב בזמן יחסי ("עוד שעה", "מחר בבוקר") חשב את הזמן המוחלט לפי השעה הנוכחית שמופיעה למטה. "בבוקר" = 09:00, "בערב" = 20:00, אלא אם צוין אחרת.
- אם זמן או תאריך לא ברורים — שאל שאלה קצרה במקום לנחש.
- אחרי פעולה, אשר בקצרה מה נעשה (כולל התאריך והשעה שנקבעו). בלי הרצאות.
- אל תמציא מידע מהיומן או מהמייל — הצג רק מה שהכלים החזירו.
- פורמט טלגרם: טקסט פשוט, אפשר אימוג'י במידה. בלי Markdown כבד.
- לתזכורות ולאירועי יומן העבר תאריכים בפורמט ISO 8601 עם אזור זמן {config.TIMEZONE_NAME} (למשל 2026-07-21T09:00:00+03:00)."""

TOOLS = [
    {
        "name": "set_reminder",
        "description": "קביעת תזכורת שתישלח למשתמש בטלגרם בזמן נתון. השתמש לבקשות כמו 'תזכיר לי'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "נוסח התזכורת שתישלח למשתמש"},
                "due_at": {"type": "string", "description": "מועד השליחה, ISO 8601 עם אזור זמן"},
            },
            "required": ["text", "due_at"],
        },
    },
    {
        "name": "list_reminders",
        "description": "הצגת כל התזכורות הממתינות של המשתמש.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "cancel_reminder",
        "description": "ביטול תזכורת ממתינה לפי מזהה.",
        "input_schema": {
            "type": "object",
            "properties": {"reminder_id": {"type": "integer"}},
            "required": ["reminder_id"],
        },
    },
    {
        "name": "add_task",
        "description": "הוספת משימה לרשימת המשימות.",
        "input_schema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    },
    {
        "name": "list_tasks",
        "description": "הצגת רשימת המשימות הפתוחות (או כולל בוצעו).",
        "input_schema": {
            "type": "object",
            "properties": {"include_done": {"type": "boolean", "description": "לכלול גם משימות שבוצעו"}},
        },
    },
    {
        "name": "complete_task",
        "description": "סימון משימה כבוצעה לפי מזהה.",
        "input_schema": {
            "type": "object",
            "properties": {"task_id": {"type": "integer"}},
            "required": ["task_id"],
        },
    },
    {
        "name": "delete_task",
        "description": "מחיקת משימה לפי מזהה.",
        "input_schema": {
            "type": "object",
            "properties": {"task_id": {"type": "integer"}},
            "required": ["task_id"],
        },
    },
    {
        "name": "list_calendar_events",
        "description": "הצגת אירועים מיומן הגוגל של המשתמש בטווח תאריכים. השתמש לשאלות כמו 'מה יש לי מחר'.",
        "input_schema": {
            "type": "object",
            "properties": {
                "start": {"type": "string", "description": "תחילת הטווח, ISO 8601 עם אזור זמן"},
                "end": {"type": "string", "description": "סוף הטווח, ISO 8601 עם אזור זמן"},
            },
            "required": ["start", "end"],
        },
    },
    {
        "name": "create_calendar_event",
        "description": "יצירת אירוע ביומן הגוגל של המשתמש.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "start": {"type": "string", "description": "ISO 8601 עם אזור זמן"},
                "end": {"type": "string", "description": "ISO 8601 עם אזור זמן"},
                "description": {"type": "string"},
                "location": {"type": "string"},
            },
            "required": ["title", "start", "end"],
        },
    },
    {
        "name": "delete_calendar_event",
        "description": "מחיקת אירוע מהיומן לפי מזהה. ודא עם המשתמש לפני מחיקה אם יש ספק לאיזה אירוע הכוונה.",
        "input_schema": {
            "type": "object",
            "properties": {"event_id": {"type": "string"}},
            "required": ["event_id"],
        },
    },
    {
        "name": "search_emails",
        "description": "חיפוש מיילים ב-Gmail. query בתחביר החיפוש של Gmail (למשל: is:unread, from:someone@x.com, newer_than:2d).",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "max_results": {"type": "integer", "description": "ברירת מחדל 10"},
            },
            "required": ["query"],
        },
    },
    {
        "name": "read_email",
        "description": "קריאת תוכן מלא של מייל לפי מזהה (מתוצאות search_emails).",
        "input_schema": {
            "type": "object",
            "properties": {"message_id": {"type": "string"}},
            "required": ["message_id"],
        },
    },
    {
        "name": "create_email_draft",
        "description": "יצירת טיוטת מייל ב-Gmail. הטיוטה נשמרת ולא נשלחת — המשתמש שולח בעצמו.",
        "input_schema": {
            "type": "object",
            "properties": {
                "to": {"type": "string"},
                "subject": {"type": "string"},
                "body": {"type": "string"},
            },
            "required": ["to", "subject", "body"],
        },
    },
]

MAX_TOOL_ROUNDS = 12


def _execute_tool(name: str, tool_input: dict, chat_id: int, schedule_reminder) -> str:
    """מריץ כלי ומחזיר תוצאה כמחרוזת JSON. חריגות מטופלות אצל הקורא."""
    if name == "set_reminder":
        due_at = datetime.fromisoformat(tool_input["due_at"])
        if due_at.tzinfo is None:
            due_at = due_at.replace(tzinfo=config.TZ)
        if due_at <= datetime.now(config.TZ):
            return json.dumps({"error": "הזמן שהתקבל כבר עבר"}, ensure_ascii=False)
        reminder_id = db.add_reminder(chat_id, tool_input["text"], due_at.isoformat())
        schedule_reminder(reminder_id, chat_id, tool_input["text"], due_at)
        return json.dumps({"ok": True, "reminder_id": reminder_id, "due_at": due_at.isoformat()}, ensure_ascii=False)

    if name == "list_reminders":
        return json.dumps(db.list_reminders(chat_id), ensure_ascii=False)

    if name == "cancel_reminder":
        ok = db.mark_reminder(tool_input["reminder_id"], "cancelled")
        return json.dumps({"ok": ok} if ok else {"error": "לא נמצאה תזכורת ממתינה עם המזהה הזה"}, ensure_ascii=False)

    if name == "add_task":
        task_id = db.add_task(chat_id, tool_input["text"])
        return json.dumps({"ok": True, "task_id": task_id}, ensure_ascii=False)

    if name == "list_tasks":
        return json.dumps(db.list_tasks(chat_id, tool_input.get("include_done", False)), ensure_ascii=False)

    if name == "complete_task":
        ok = db.set_task_status(chat_id, tool_input["task_id"], "done")
        return json.dumps({"ok": ok} if ok else {"error": "לא נמצאה משימה עם המזהה הזה"}, ensure_ascii=False)

    if name == "delete_task":
        ok = db.delete_task(chat_id, tool_input["task_id"])
        return json.dumps({"ok": ok} if ok else {"error": "לא נמצאה משימה עם המזהה הזה"}, ensure_ascii=False)

    if name == "list_calendar_events":
        return json.dumps(gsvc.list_events(tool_input["start"], tool_input["end"]), ensure_ascii=False)

    if name == "create_calendar_event":
        result = gsvc.create_event(
            tool_input["title"], tool_input["start"], tool_input["end"],
            tool_input.get("description", ""), tool_input.get("location", ""),
        )
        return json.dumps({"ok": True, **result}, ensure_ascii=False)

    if name == "delete_calendar_event":
        gsvc.delete_event(tool_input["event_id"])
        return json.dumps({"ok": True}, ensure_ascii=False)

    if name == "search_emails":
        return json.dumps(
            gsvc.search_emails(tool_input["query"], tool_input.get("max_results", 10)),
            ensure_ascii=False,
        )

    if name == "read_email":
        return json.dumps(gsvc.read_email(tool_input["message_id"]), ensure_ascii=False)

    if name == "create_email_draft":
        result = gsvc.create_draft(tool_input["to"], tool_input["subject"], tool_input["body"])
        return json.dumps({"ok": True, **result}, ensure_ascii=False)

    return json.dumps({"error": f"כלי לא מוכר: {name}"}, ensure_ascii=False)


def handle_message(chat_id: int, user_text: str, schedule_reminder) -> str:
    """מעבד הודעת משתמש ומחזיר את תשובת העוזר.

    schedule_reminder(reminder_id, chat_id, text, due_at) — callback שמתזמן
    את שליחת התזכורת בטלגרם (מסופק ע"י bot.py).
    """
    now = datetime.now(config.TZ)
    time_note = (
        f"[הקשר: השעה כעת {now.strftime('%H:%M')}, "
        f"{now.strftime('%d/%m/%Y')} ({['שני','שלישי','רביעי','חמישי','שישי','שבת','ראשון'][now.weekday()]}), "
        f"אזור זמן {config.TIMEZONE_NAME}]"
    )

    messages = db.get_history(chat_id) + [
        {"role": "user", "content": f"{time_note}\n{user_text}"}
    ]

    response = None
    for _ in range(MAX_TOOL_ROUNDS):
        response = client.messages.create(
            model=config.MODEL,
            max_tokens=16000,
            thinking={"type": "adaptive"},
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        if response.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": response.content})
            continue

        if response.stop_reason != "tool_use":
            break

        messages.append({"role": "assistant", "content": response.content})
        tool_results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            try:
                result = _execute_tool(block.name, block.input, chat_id, schedule_reminder)
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": block.id, "content": result}
                )
            except gsvc.GoogleNotConnected as e:
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": block.id,
                     "content": str(e), "is_error": True}
                )
            except Exception as e:
                logger.exception("Tool %s failed", block.name)
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": block.id,
                     "content": f"שגיאה בהרצת הכלי: {e}", "is_error": True}
                )
        messages.append({"role": "user", "content": tool_results})

    final_text = ""
    if response is not None:
        final_text = "\n".join(
            block.text for block in response.content if block.type == "text"
        ).strip()
    if not final_text:
        final_text = "מצטער, משהו השתבש. נסה שוב."

    db.add_history(chat_id, "user", user_text)
    db.add_history(chat_id, "assistant", final_text)
    return final_text
