# רמי — עוזר אישי AI בטלגרם 🤖

עוזר אישי בסגנון Remi שרץ בטלגרם, מבוסס על Claude (Anthropic). מדברים איתו בשפה חופשית בעברית והוא יודע:

- ⏰ **תזכורות** — "תזכיר לי מחר ב-9 להתקשר ללקוח" (התזכורת נשלחת אליך בטלגרם בזמן)
- 📋 **משימות** — "תוסיף משימה: לשלם ארנונה", "מה יש לי ברשימה?"
- 📅 **יומן גוגל** — "מה יש לי מחר?", "קבע פגישה עם דני ביום רביעי ב-14:00"
- 📧 **Gmail** — "יש מיילים חדשים חשובים?", "תכין טיוטת תשובה ל..." (הבוט יוצר טיוטות בלבד ולא שולח מיילים)
- 💬 **שיחה חופשית** — שאלות, ניסוחים, תרגומים, רעיונות

---

## התקנה

דרישות: Python 3.11 ומעלה.

### 1. התקנת התלויות

```bash
cd remi
python -m venv venv
source venv/bin/activate        # ב-Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 2. יצירת בוט בטלגרם (2 דקות)

1. פתח בטלגרם את [@BotFather](https://t.me/BotFather)
2. שלח `/newbot`, תן שם (למשל "רמי") ושם משתמש (חייב להסתיים ב-`bot`, למשל `meir_remi_bot`)
3. העתק את הטוקן שתקבל

### 3. מפתח API של Anthropic

1. היכנס ל-[platform.claude.com](https://platform.claude.com)
2. צור API Key והעתק אותו (שים לב: השימוש בתשלום לפי צריכה)

### 4. קובץ הגדרות

```bash
cp .env.example .env
```

ערוך את `.env` ומלא:
- `TELEGRAM_BOT_TOKEN` — הטוקן מ-BotFather
- `ANTHROPIC_API_KEY` — המפתח מ-Anthropic
- `ALLOWED_USER_ID` — **מומלץ מאוד**: מזהה המשתמש שלך בטלגרם, כדי שרק אתה תוכל להשתמש בבוט. שלח הודעה ל-[@userinfobot](https://t.me/userinfobot) כדי לגלות אותו.

### 5. חיבור יומן גוגל ו-Gmail (אופציונלי אבל שווה)

1. היכנס ל-[Google Cloud Console](https://console.cloud.google.com)
2. צור פרויקט חדש
3. תחת **APIs & Services → Library** הפעל את **Google Calendar API** ואת **Gmail API**
4. תחת **APIs & Services → OAuth consent screen** הגדר מסך הסכמה (User Type: External, והוסף את המייל שלך כ-Test user)
5. תחת **APIs & Services → Credentials** צור **OAuth client ID** מסוג **Desktop app**
6. הורד את קובץ ה-JSON ושמור אותו בתיקיית `remi` בשם `credentials.json`
7. הרץ פעם אחת:

```bash
python google_auth.py
```

ייפתח דפדפן — אשר את הגישה, וייווצר `token.json`. זהו, מחובר.

בלי השלב הזה הבוט עדיין עובד מצוין — תזכורות, משימות ושיחה חופשית — פשוט בלי יומן ומייל.

### 6. הרצה

```bash
python bot.py
```

פתח את הבוט בטלגרם, שלח `/start` ותתחיל לדבר איתו 🎉

---

## הרצה קבועה (שהבוט יעבוד גם כשהמחשב סגור)

הבוט צריך לרוץ על מחשב/שרת דלוק. אפשרויות:

- **שרת קטן בענן** — למשל Hetzner / DigitalOcean / Oracle Cloud Free Tier. מריצים שם עם `systemd` או `tmux`.
- **Raspberry Pi** בבית.
- **Railway / Render** — פריסה מהירה בלי לנהל שרת.

דוגמת יחידת systemd (`/etc/systemd/system/remi.service`):

```ini
[Unit]
Description=Remi Telegram Assistant
After=network.target

[Service]
WorkingDirectory=/opt/remi
ExecStart=/opt/remi/venv/bin/python bot.py
Restart=always

[Install]
WantedBy=multi-user.target
```

---

## פקודות

| פקודה | מה עושה |
|---|---|
| `/start` | הודעת פתיחה והסבר |
| `/reset` | איפוס היסטוריית השיחה |

## אבטחה ופרטיות

- הגדר `ALLOWED_USER_ID` כדי שרק אתה תוכל לדבר עם הבוט.
- `token.json` ו-`credentials.json` נותנים גישה לחשבון הגוגל שלך — אל תעלה אותם לגיט (יש `.gitignore`).
- הבוט **לא שולח מיילים** — רק יוצר טיוטות שאתה מאשר ושולח בעצמך.
- ההיסטוריה, התזכורות והמשימות נשמרות מקומית בקובץ `remi.db` (SQLite).

## מבנה הקוד

| קובץ | תפקיד |
|---|---|
| `bot.py` | בוט הטלגרם — נקודת הכניסה, תזמון תזכורות |
| `agent.py` | המוח — Claude עם לולאת כלים (tool use) |
| `db.py` | SQLite: היסטוריה, תזכורות, משימות |
| `google_services.py` | חיבור ל-Google Calendar ו-Gmail |
| `google_auth.py` | סקריפט חד-פעמי לחיבור חשבון גוגל |
| `config.py` | טעינת הגדרות מ-`.env` |
