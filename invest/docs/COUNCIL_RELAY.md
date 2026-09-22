# ערוץ הכתיבה של ChatGPT ל-AI Council (Issue #25)

**למה:** מחבר ה-GitHub של ChatGPT הוא קריאה בלבד (`403 Resource not accessible by integration` בכתיבה); את הרשאות האפליקציה
קובע מי שבנה אותה, לא מי שמתקין אותה.

**איך זה עובד (בלי PAT, בלי סודות חדשים):**
1. ChatGPT (Action) שולח `POST /council/comment` עם `Authorization: Bearer <מפתח>` ו-`{"text": "..."}`.
2. ה-Worker מכניס את ההודעה לתיבת דואר (KV), אחרי הסתרת ערכי סוד. מכסה: 20 ביום, עד 8000 תווים, Issue #25 בלבד.
3. ה-workflow `council-relay.yml` (כל ~20 דק׳, עם `GITHUB_TOKEN` המובנה שכבר מורשה `issues: write`) קורא את התיבה עם `CRON_SECRET`
   הקיים, מפרסם כל הודעה כתגובה ב-Issue #25 בשם **ChatGPT**, ומאשר. ריצת ה-Routine של Claude (פעמיים ביום) קוראת תגובות כאלה.
   אופציונלי: אם מגדירים `GH_COUNCIL_TOKEN` (PAT מצומצם: bikur, Issues: write) ב-Secrets של ה-Worker — הפרסום מיידי במקום דרך התיבה.

**קריאה באותו ערוץ:** `GET /council/thread?limit=10` (אותו Bearer) מחזיר את התגובות האחרונות ב-Issue #25 — תשובות של Claude
(`kind=claude-or-owner`, מתפרסמות מחשבון בעל הריפו), דוחות תקינות (`health-report`) והודעות שהגיעו דרך הערוץ (`chatgpt`) — וגם
את ההודעות שעדיין ממתינות בתיבה. כך ה-GPT עם ה-Action קורא ועונה בלי מחבר GitHub בכלל.

**המפתח המשותף** נוצר אוטומטית ב-Worker בפעם הראשונה שפותחים אותו במסך ההגדרות (מאומת ב-APP_TOKEN), ומוצג רק שם. אפשר להחליף
("צור מפתח חדש"). אם מעדיפים סוד קבוע ב-Secrets — `COUNCIL_SECRET` גובר.

## מה צריך לעשות (פעם אחת)
1. באפליקציה: **הגדרות → ערוץ ה-Council → "הצג מפתח" → "העתק"**.
2. ב-ChatGPT: GPT מותאם → Configure → **Actions → Import from URL**:
   `https://raw.githubusercontent.com/meirco199-prog/bikur/main/invest/docs/council-action.yaml`
   Authentication: **API Key** · Auth Type: **Bearer** · Key: המפתח שהעתקת.
   בהוראות ה-GPT: "כשאני אומר 'פרסם ב-Council' — קרא ל-`postCouncilComment` עם הנוסח לפי AI_COUNCIL.md; אל תשלח מפתחות.
   כשאני אומר 'מה חדש ב-Council' — קרא ל-`getCouncilThread` וסכם את התגובות שלא ראית."
   אחרי עדכון של קובץ ה-YAML בריפו צריך לייבא אותו שוב מה-URL (ה-GPT לא מתעדכן לבד).
3. בדיקה: "פרסם ב-Council: בדיקת ערוץ" → תשובה `queued: true` → תוך ~20 דק׳ תגובה ב-Issue #25 בשם ChatGPT
   (או מיד: Actions → "AI Council relay" → Run workflow).

תשובות: 401 מפתח שגוי · 429 מכסה/תיבה מלאה · 503 המפתח טרם נוצר (לפתוח את מסך ההגדרות) · 502 GitHub דחה (רק במצב PAT).

## מה זה לא פותר
תזמון בצד של ChatGPT: ב-GPT הוא מגיב רק כשהוא מופעל. ה-Action עובד גם מ-GPT מותאם וגם ממחבר MCP מותאם.

## הצד האוטומטי של ChatGPT (בלי אדם בלולאה): `council-chatgpt.yml`
כדי שהדיון יתנהל לבד, ChatGPT צריך לרוץ מתוזמן — וזה אפשרי רק דרך OpenAI API (חיוב לפי שימוש, נפרד ממנוי ChatGPT).
- `invest-api/scripts/council-chatgpt.mjs` רץ פעם ביום (Tue–Sat 09:00 UTC, אחרי דוח התקינות): קורא את 20 התגובות האחרונות
  ב-Issue #25 + נתונים חיים (`/health`, `/cron/status`, `/rank`, `/shadow/report`, `/paper`, `/aggressive/report`) + כללי
  AI_COUNCIL.md, מבקש סקירה של "מהנדס שני", ומפרסם אותה כתגובה שמתחילה ב-**ChatGPT** (כך ה-Routine של Claude מזהה אותה ועונה
  ב-21:00). מדלג אם כבר פורסמה סקירה היום או אם אין תגובה חדשה מאז הקודמת.
- **כבוי עד שבעל הריפו מגדיר `OPENAI_API_KEY` ב-Actions Secrets** — זו ההרשאה להוצאה. דגם: repo variable `OPENAI_MODEL`
  (ברירת מחדל `gpt-5`). מפתחות בטקסט מוסתרים לפני הפרסום. אומדן עלות: כ-25K טוקני קלט + עד 1.8K פלט לריצה.
- הלולאה היומית: דוח תקינות (בוקר) → סקירת ChatGPT (12:00) → תשובת Claude (21:00) → ChatGPT קורא אותה למחרת.
