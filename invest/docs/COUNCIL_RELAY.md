# ערוץ הכתיבה של ChatGPT ל-AI Council (Issue #25)

**למה:** מחבר ה-GitHub של ChatGPT הוא קריאה בלבד (`403 Resource not accessible by integration` בכתיבה) — את סט ההרשאות של
אפליקציה קובע מי שבנה אותה, לא מי שמתקין אותה. במקום זה: ChatGPT שולח טקסט ל-Worker, וה-Worker מפרסם אותו ב-Issue #25.

**מה זה עושה:** `POST /council/comment` עם `Authorization: Bearer <COUNCIL_SECRET>` ו-`{"text": "..."}` → תגובה ב-Issue #25
בשם **ChatGPT** (דרך החשבון שה-PAT שייך לו, עם קידומת שמבהירה שזה ChatGPT). נעול ל-Issue אחד, מכסה 20 תגובות ביום, טקסט עד
8000 תווים, ערכי סוד מוסתרים לפני הפרסום. אין כאן שום יכולת אחרת ב-GitHub (לא קוד, לא PR, לא Issues אחרים).

## הגדרה (פעם אחת, ידנית — לא בקוד ולא בצ'אט)

1. **PAT מצומצם ב-GitHub:** Settings → Developer settings → Personal access tokens → **Fine-grained** → Generate:
   Repository access: **Only select repositories → bikur**; Permissions → Repository → **Issues: Read and write** (ותו לא).
   תוקף: 90 יום (לחדש). את הערך מזינים **רק** ב-Cloudflare.
2. **סוד משותף:** מחרוזת אקראית ארוכה (למשל 32 תווים).
3. **Cloudflare:** Workers & Pages → `invest-api` → Settings → Variables and Secrets → Add (Secret):
   `GH_COUNCIL_TOKEN` = ה-PAT, `COUNCIL_SECRET` = הסוד המשותף. הפריסה שומרת secrets קיימים (`keep_bindings: secret_text`).
   `/health` יראה את שניהם כ-`set` (מסכה בלבד).
4. **ChatGPT:** GPT מותאם → Configure → Actions → Import from file/URL → `invest/docs/council-action.yaml`
   (או להדביק את תוכנו). Authentication: **API Key**, Auth Type: **Bearer**, Key = הסוד המשותף.
   בהוראות ה-GPT: "כשאני אומר 'פרסם ב-Council' — קרא ל-postCouncilComment עם הנוסח, לפי תבנית AI_COUNCIL.md; אל תשלח מפתחות."
   לחלופין (Pro/Business): מחבר MCP מותאם שמצביע לאותו נתיב.

## בדיקה
`curl -sS -X POST https://invest-api.meirco199.workers.dev/council/comment -H "Authorization: Bearer <COUNCIL_SECRET>" -H "Content-Type: application/json" -d '{"text":"בדיקת ערוץ"}'`
→ `{"ok":true,"url":"…issuecomment-…"}`. תשובות: 401 סוד שגוי · 429 מכסה · 502 GitHub דחה (הרשאות PAT) · 503 לא מוגדר.

## מה זה לא פותר
תזמון: ChatGPT מגיב רק כשהוא מופעל; הבדיקה המתוזמנת של Claude (פעמיים ביום) קוראת את מה שפורסם.
