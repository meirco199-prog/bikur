# רמי בוואטסאפ 💬

אותו עוזר אישי (תזכורות, משימות, יומן גוגל, Gmail, שיחה חופשית) — דרך וואטסאפ, באמצעות ה-**WhatsApp Business Cloud API הרשמי של Meta**.

## חשוב להבין לפני שמתחילים

בשונה מטלגרם, בוואטסאפ אין "בוטים" חינמיים:

1. **צריך מספר טלפון ייעודי לבוט** — מספר שלא מחובר כרגע לוואטסאפ (לא המספר האישי שלך). בשלב הפיתוח Meta נותנת **מספר בדיקה חינם** שעובד מיד — מספיק בשביל להתחיל.
2. **צריך שרת עם כתובת HTTPS ציבורית** — וואטסאפ שולחת את ההודעות אליך (webhook), היא לא נותנת "למשוך" אותן כמו טלגרם. לבדיקות מקומיות אפשר ngrok; לשימוש אמיתי צריך שרת (Railway/Render/שרת ענן).
3. **חלון 24 שעות**: הבוט יכול לענות חופשי במשך 24 שעות מההודעה האחרונה **שלך**. תזכורת שנקבעה ליותר מ-24 שעות אחרי ההודעה האחרונה עלולה להידחות ע"י Meta, אלא אם מאשרים Message Template (תבנית) — ראה בסוף. מי שמדבר עם הבוט כל יום כמעט לא ירגיש בזה.
4. **עלויות**: מאז יולי 2025 שיחות שירות (המשתמש פנה ראשון) הן חינם. תבניות Utility למשלוח יזום (תזכורות מחוץ לחלון) עולות אגורות בודדות להודעה.

## שלב 1: הקמת האפליקציה ב-Meta (חד-פעמי, ~15 דקות)

1. היכנס ל-[developers.facebook.com](https://developers.facebook.com) והתחבר עם חשבון הפייסבוק שלך.
2. **My Apps → Create App** → בחר Use case: **Other** → סוג: **Business** → תן שם (למשל "Remi").
3. במסך האפליקציה, מצא את **WhatsApp** ולחץ **Set up**. אם יתבקש — צור Meta Business Account.
4. היכנס ל-**WhatsApp → API Setup**. שם תמצא:
   - **Temporary access token** — טוקן זמני (תקף 24 שעות, מספיק לבדיקות)
   - **Phone number ID** — העתק אותו (זה לא מספר הטלפון עצמו!)
   - **מספר בדיקה** (Test number) שממנו הבוט ישלח
5. באותו מסך, תחת **To**, הוסף את המספר האישי שלך כנמען מורשה (Meta תשלח לך קוד אימות בוואטסאפ).

מלא ב-`.env`:
```
WHATSAPP_TOKEN=<הטוקן>
WHATSAPP_PHONE_NUMBER_ID=<ה-Phone number ID>
WHATSAPP_VERIFY_TOKEN=<מחרוזת סודית שאתה ממציא, למשל remi-2026-secret>
ALLOWED_WA_NUMBER=9725XXXXXXXX   # המספר שלך, בלי + ובלי 0 מוביל
```

## שלב 2: הרצת השרת

```bash
cd remi
source venv/bin/activate
pip install -r requirements.txt
uvicorn whatsapp_bot:app --host 0.0.0.0 --port 8000
```

לבדיקה מקומית, בטרמינל נוסף:
```bash
ngrok http 8000
```
העתק את כתובת ה-HTTPS ש-ngrok נותן (למשל `https://abc123.ngrok.io`).

## שלב 3: חיבור ה-Webhook

1. ב-Meta: **WhatsApp → Configuration → Webhook → Edit**
2. **Callback URL**: `https://<הכתובת-שלך>/webhook`
3. **Verify token**: אותה מחרוזת ששמת ב-`WHATSAPP_VERIFY_TOKEN`
4. לחץ **Verify and save** — אם השרת רץ, זה יעבור מיד.
5. תחת **Webhook fields** לחץ **Manage** ועשה Subscribe ל-**messages**.

זהו! שלח "היי" מהוואטסאפ שלך למספר הבדיקה — רמי יענה 🎉

## שלב 4: מעבר לשימוש קבוע (כשתרצה)

- **טוקן קבוע**: הטוקן הזמני פג אחרי 24 שעות. צור טוקן קבוע: Meta Business Suite → **Settings → Users → System users** → צור System User → הענק לו את האפליקציה → Generate token עם הרשאות `whatsapp_business_messaging` + `whatsapp_business_management`.
- **מספר אמיתי**: ב-**API Setup → Add phone number** הוסף מספר ייעודי (כרטיס SIM חדש/מספר וירטואלי שלא היה בוואטסאפ). יידרש אימות SMS.
- **שרת קבוע**: פרוס את `whatsapp_bot.py` על Railway / Render / שרת ענן, ועדכן את כתובת ה-Webhook ב-Meta לכתובת הקבועה.
- **תזכורות מחוץ לחלון 24 השעות**: צור Message Template מסוג Utility (למשל: "תזכורת: {{1}}") תחת WhatsApp → Message Templates, חכה לאישור של Meta, ואז אפשר לעדכן את `_send_reminder` לשלוח תבנית כשהודעה רגילה נדחית. אם תגיע לשלב הזה — תגיד לי ואוסיף את זה.

## מה רץ איפה

| קובץ | תפקיד |
|---|---|
| `whatsapp_bot.py` | שרת ה-webhook + שליחת הודעות + תזמון תזכורות |
| `agent.py`, `db.py`, `google_services.py` | משותפים לגרסת הטלגרם — אותו מוח בדיוק |

אפשר להריץ את גרסת הטלגרם וגרסת הוואטסאפ במקביל — הם חולקים את אותו מסד נתונים, אבל ההיסטוריה נפרדת לכל צ'אט.
