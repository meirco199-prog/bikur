import os
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ALLOWED_USER_ID = os.environ.get("ALLOWED_USER_ID", "").strip()
ASSISTANT_NAME = os.environ.get("ASSISTANT_NAME", "רמי")
TIMEZONE_NAME = os.environ.get("TIMEZONE", "Asia/Jerusalem")
TZ = ZoneInfo(TIMEZONE_NAME)

DB_PATH = BASE_DIR / "remi.db"
GOOGLE_CREDENTIALS_PATH = BASE_DIR / "credentials.json"
GOOGLE_TOKEN_PATH = BASE_DIR / "token.json"

# הרשאות גוגל: יומן מלא, מייל בקריאה + יצירת טיוטות בלבד (הבוט לא שולח מיילים)
GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
]

# --- WhatsApp (Meta Cloud API) ---
WHATSAPP_TOKEN = os.environ.get("WHATSAPP_TOKEN", "")
WHATSAPP_PHONE_NUMBER_ID = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "")
# מחרוזת סודית שאתה ממציא — אותה מזינים גם במסך ה-Webhook של Meta
WHATSAPP_VERIFY_TOKEN = os.environ.get("WHATSAPP_VERIFY_TOKEN", "remi-verify")
# מספר הוואטסאפ שלך בפורמט בינלאומי בלי + (למשל 972501234567). ריק = פתוח לכולם
ALLOWED_WA_NUMBER = os.environ.get("ALLOWED_WA_NUMBER", "").strip()

MODEL = "claude-opus-4-8"

# כמה הודעות אחרונות לשמור בהקשר השיחה
HISTORY_LIMIT = 40
