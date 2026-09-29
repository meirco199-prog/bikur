# חיבור ChatGPT ל-AI Council: `postCouncilComment` ככלי בשיחה של מאיר

**המטרה:** בשיחת ChatGPT להגיד "תשלח לקלוד את הבדיקה של Food", ו-ChatGPT יקרא בעצמו ל-
`postCouncilComment({ project: "food", type: "security", title, body, source: "gpt-audit" })` — בלי להעתיק הודעות ובלי
גישת כתיבה של ChatGPT ל-GitHub. **שום דבר חדש בצד השרת:** ה-endpoint `POST /council/comment` והסכימה
[`invest/docs/council-action.yaml`](../../invest/docs/council-action.yaml) כבר קיימים ופרוסים; מה שחסר הוא בצד ChatGPT בלבד.

## למה ChatGPT "לא רואה" את הכלי היום
1. **Actions חיים רק בתוך GPT מותאם (Custom GPT).** בשיחה רגילה עם ChatGPT אין Actions בכלל. ה-GPT "AI Council" שהוגדר ב-22/9
   הוא המקום היחיד שבו `postCouncilComment` קיים — וצריך לדבר איתו (או לקרוא לו עם `@` מתוך שיחה רגילה, ראה למטה).
2. **הסכימה שיובאה ב-22/9 היא גרסה 1** (שדה `text` בלבד, Issue #25 בלבד). כדי ש-ChatGPT יכיר את `project/type/title/body/source`
   ואת `getCouncilTasks`/`getCouncilProjects`, צריך לייבא מחדש את הסכימה מה-URL — ה-GPT לא מתעדכן לבד כשהקובץ בריפו משתנה.

## מה מאיר צריך לעשות (פעם אחת, ~3 דקות) — כן, זה ידני, רק בצד ChatGPT
1. ב-ChatGPT: **GPTs** (בסרגל הצד) → **My GPTs** → ה-GPT "AI Council" → **Edit GPT** (עיפרון) → לשונית **Configure**.
   (אם ה-GPT לא קיים: **Create a GPT** → Configure → Name: `AI Council`.)
2. גלול ל-**Actions** → פתח את ה-Action הקיים (או **Create new action**).
3. **Authentication** (גלגל השיניים ליד Authentication) → **API Key** → **Auth Type: Bearer** → בשדה **API Key** הדבק את המפתח
   המשותף מהאפליקציה: **invest → הגדרות → ערוץ ה-Council → "הצג מפתח" → "העתק"** (אותו מפתח שכבר בשימוש; לא CRON_SECRET,
   ולא סוד מ-GitHub). → **Save**.
4. **Schema** → **Import from URL** → הדבק:
   `https://raw.githubusercontent.com/meirco199-prog/bikur/main/invest/docs/council-action.yaml` → **Import**.
   מתחת ל-Schema צריכות להופיע 5 פעולות: `postCouncilComment`, `getCouncilTasks`, `getCouncilProjects`, `getCouncilStatus`,
   `getCouncilThread`. (זו ההוכחה ש-ChatGPT "רואה" את הכלי.) אם מופיעה שגיאת validation — הסכימה עברה validation של OpenAPI 3.1
   בריפו; לרוב זה URL שגוי או cache — נסה שוב.
5. ליד `getCouncilProjects` לחץ **Test** → אמורה לחזור תשובה `{"ok":true,"projects":["invest","food","english"],…}`.
   תשובה `401` = המפתח בשלב 3 שגוי; `503` = המפתח טרם נוצר (לפתוח את מסך ההגדרות באפליקציה).
6. בלשונית Configure, בשדה **Instructions**, הדבק את הטקסט שבסעיף הבא (מחליף את ההוראות הקודמות). → **Update** / **Save**
   (למעלה מימין) → **Only me**.
7. Privacy policy: לא נדרש כל עוד ה-GPT הוא "Only me".

## הוראות ל-GPT (להדביק ב-Instructions)
```
אתה "AI Council" — המהנדס השני (לצד Claude) בפרויקטים של מאיר בריפו meirco199-prog/bikur. מאיר מכריע.
יש לך Actions לערוץ ה-Council:
- postCouncilComment — שולח משימה/ממצא ל-Claude. חובה: project (invest | food | english — או מה ש-getCouncilProjects מחזיר), type
  (bug | security | test | regression | review | question | proposal | task | note), title (קצר), body (Markdown: מה נמצא, איפה —
  קובץ/שורה, למה זו בעיה, איך לשחזר, מה Claude מתבקש לבדוק), source: "gpt-audit".
- getCouncilTasks — מה קרה לכל משימה (QUEUED → POSTED → RECEIVED → IN_PROGRESS → PR_OPEN → PASS / REJECTED / DONE /
  OWNER_DECISION_REQUIRED / FAILED). getCouncilThread?project= — התגובות האחרונות ב-Issue של הפרויקט. getCouncilProjects — הרשימה.
כללים:
1. כשמאיר אומר "תשלח לקלוד…" / "פרסם ב-Council" / "תעביר ל-Claude" — קרא ל-postCouncilComment. project לפי הנושא: אוכל/תזונאית/
   ילדים → food; אנגלית/שיעור/מורה → english; השקעות/מסחר/דמה → invest. לא ברור → שאל שאלה אחת קצרה.
2. אחרי השליחה: הצג למאיר את ה-id ואת project, ואמור שהמשימה תגיע ל-Issue של הפרויקט תוך ~20 דק' ושאפשר לשאול "מה קרה עם המשימה"
   (getCouncilTasks). תשובה duplicate:true = כבר נשלח — אל תשלח שוב.
3. כשמאיר שואל "מה חדש ב-Council של X" — getCouncilThread עם project=X וסכם את התגובות שלא ראה.
4. הממצאים שלך צריכים ראיה (קובץ/שורה/ריצה). Claude לא מקבל ממצא אוטומטית — הוא בודק ועונה; אי-הסכמה מנומקת היא חלק מהשיטה.
5. לעולם אל תכלול מפתחות, טוקנים או סודות בהודעה. אל תבקש מ-Claude לשנות חוקי תזונה (food) או משקלים/סיכון (invest) — אלה
   החלטות של מאיר; אם זו ההצעה, כתוב זאת במפורש כ"להחלטת מאיר".
```

## שימוש מתוך שיחה רגילה (בלי לפתוח את ה-GPT)
בכל שיחה ב-ChatGPT (web): להקליד `@` בתיבת ההודעה → לבחור **AI Council** → לכתוב "תשלח לקלוד את הבדיקה של Food: …".
ההודעה הזו נשלחת ל-GPT עם ה-Actions שלו, עם ההקשר של השיחה. זו הדרך היחידה ש-Actions עובדים בשיחה רגילה.

## איך נוודא שזה עובד (אחרי החיבור)
1. **בעורך ה-GPT:** 5 הפעולות מופיעות מתחת ל-Schema, ו-**Test** על `getCouncilProjects` מחזיר `projects: [invest, food, english]`.
2. **בשיחה עם ה-GPT (או `@AI Council`):** "מה הפרויקטים ב-Council?" → ChatGPT מבקש אישור להפעיל את הפעולה (Allow / Always
   allow) → מציג invest, food, english.
3. **שליחה אמיתית:** "תשלח לקלוד בדיקה ל-food: הודעת בדיקה מהשיחה של מאיר" → ChatGPT קורא ל-`postCouncilComment` ומחזיר
   `id: cm_…`, `status: QUEUED`. תוך ~20 דק' (או Actions → "AI Council relay" → Run workflow) ההודעה מופיעה ב-
   [Issue #98](https://github.com/meirco199-prog/bikur/issues/98) עם `source: gpt-audit`; ה-Routine של Claude מסמנת `RECEIVED` ואז
   `DONE`/`REJECTED`/`PR_OPEN`; ו-"מה קרה עם המשימה?" → `getCouncilTasks` מראה את הסטטוס.
4. **תאימות:** Council ההשקעות לא השתנה — "פרסם ב-Council: …" בלי project ממשיך להגיע ל-Issue #25.

## מה לא נדרש / מה לא נבנה
- לא Plugin (הוסר מ-ChatGPT), לא MCP connector ולא endpoint חדש. **חלופה עתידית** אם תרצה כלי גם בלי `@`: ChatGPT תומך
  היום ב-MCP connectors ב-Developer mode (Settings → Apps & Connectors → Advanced → Developer mode). זה דורש endpoint MCP חדש
  ב-Worker (`/council/mcp`) שעוטף את אותה לוגיקה — לא נבנה, לפי ההנחיה "אל תבנה endpoint חדש".
- לא נדרש שום סוד חדש: המפתח המשותף של הערוץ הוא מה שנכנס ל-Action. `CRON_SECRET` נשאר בצד GitHub Actions בלבד.
