# חיבור ChatGPT ל-AI Council: `postCouncilComment` ככלי בשיחה של מאיר

**המטרה:** בשיחת ChatGPT להגיד "תשלח לקלוד את הבדיקה של Food", ו-ChatGPT יקרא בעצמו ל-
`postCouncilComment({ project: "food", type: "security", title, body, source: "gpt-audit" })` — בלי להעתיק הודעות ובלי
גישת כתיבה של ChatGPT ל-GitHub. **שום דבר חדש בצד השרת:** ה-endpoint `POST /council/comment` והסכימה
[`invest/docs/council-action.yaml`](../../invest/docs/council-action.yaml) כבר קיימים ופרוסים; מה שחסר הוא בצד ChatGPT בלבד.

## הדרך המומלצת: connector בשיחה רגילה (Developer mode, MCP) — בלי GPT מותאם

ה-Worker מגיש עכשיו את אותם כלים גם כשרת MCP: `POST https://invest-api.meirco199.workers.dev/council/mcp` (JSON-RPC, Streamable
HTTP; תומך גם ב-2026-07-28 עם `server/discover` וגם ב-`initialize` הישן). זו עטיפה בלבד מעל `POST /council/comment` והנתיבים
הקיימים — אותו מפתח, אותה מכסה, אותו relay. אחרי החיבור, **בכל שיחה רגילה** של ChatGPT "תשלח לקלוד…" קורא ל-`postCouncilComment`.

**מה מאיר עושה (פעם אחת, ~2 דקות):**
1. ChatGPT → **Settings** → **Apps & Connectors** (או **Connectors**) → **Advanced settings** → הפעל **Developer mode**.
2. באותו מסך → **Create** (custom connector): **Name:** `AI Council` · **Description:** `שליחת משימות ל-Claude ומעקב אחריהן` ·
   **MCP Server URL:** `https://invest-api.meirco199.workers.dev/council/mcp/<המפתח המשותף>` (המפתח מהאפליקציה: invest → הגדרות →
   ערוץ ה-Council → "הצג מפתח" → "העתק"; מדביקים אותו בסוף ה-URL) · **Authentication:** `No authentication` → **Create**.
   (אם הדיאלוג מציע `API key`/Bearer — אפשר במקום זה URL בלי המפתח, `…/council/mcp`, והמפתח בשדה ה-API key.)
3. ChatGPT מבצע discovery ומציג את 5 הכלים (`postCouncilComment`, `getCouncilTasks`, `getCouncilProjects`, `getCouncilThread`,
   `getCouncilStatus`). אם מופיעה שגיאה: `401` = מפתח שגוי ב-URL; `503` = המפתח טרם נוצר באפליקציה.
4. בשיחה חדשה: **+** → **More** / **Developer mode** → סמן **AI Council**. ואז: "מה הפרויקטים ב-Council?" → ChatGPT מבקש אישור
   להפעיל את הכלי → מחזיר invest, food, english. כלי כתיבה (`postCouncilComment`) מבקש אישור לפני כל שליחה (אפשר "Always allow").

**אבטחה:** ה-URL מכיל את המפתח המשותף — לא לשתף אותו ולא להדביק בשום מקום אחר; "צור מפתח חדש" באפליקציה מבטל אותו מיד.
המפתח מאפשר רק מה שהערוץ מאפשר ממילא (20 הודעות ביום ל-Issues של הפרויקטים, וקריאה שלהן). `CRON_SECRET` לא מעורב.

## החלופה: GPT מותאם עם Action (הדרך הישנה, עדיין עובדת)

### למה ChatGPT "לא רואה" את הכלי בלי אחת משתי הדרכים
1. **Actions חיים רק בתוך GPT מותאם (Custom GPT).** בשיחה רגילה עם ChatGPT אין Actions בכלל. ה-GPT "AI Council" שהוגדר ב-22/9
   הוא המקום היחיד שבו `postCouncilComment` קיים — וצריך לדבר איתו (או לקרוא לו עם `@` מתוך שיחה רגילה, ראה למטה).
2. **הסכימה שיובאה ב-22/9 היא גרסה 1** (שדה `text` בלבד, Issue #25 בלבד). כדי ש-ChatGPT יכיר את `project/type/title/body/source`
   ואת `getCouncilTasks`/`getCouncilProjects`, צריך לייבא מחדש את הסכימה מה-URL — ה-GPT לא מתעדכן לבד כשהקובץ בריפו משתנה.

### חיבור ה-Action ל-GPT מותאם (פעם אחת, ~3 דקות)
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
8. **אזהרה:** ה-GPT מחזיק את המפתח המשותף. **לעולם לא לשתף/לפרסם את ה-GPT (Anyone with a link / GPT Store) עם המפתח הזה** — כל מי
   שמשתמש ב-GPT יכול לשלוח הודעות ל-Council בשם ChatGPT. אם בכל זאת משתפים: קודם החלף מפתח באפליקציה ("צור מפתח חדש") והזן את
   החדש רק ב-GPT פרטי, או הסר את המפתח משדה Authentication ב-GPT המשותף.

### הוראות ל-GPT (להדביק ב-Instructions)
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

### שימוש ב-GPT מותאם מתוך שיחה רגילה
בכל שיחה ב-ChatGPT (web): להקליד `@` בתיבת ההודעה → לבחור **AI Council** → לכתוב "תשלח לקלוד את הבדיקה של Food: …".
ההודעה הזו נשלחת ל-GPT עם ה-Actions שלו, עם ההקשר של השיחה. זו הדרך היחידה ש-Actions עובדים בשיחה רגילה.

## איך נוודא שזה עובד (שתי הדרכים)
1. **בעורך ה-GPT:** 5 הפעולות מופיעות מתחת ל-Schema, ו-**Test** על `getCouncilProjects` מחזיר `projects: [invest, food, english]`.
2. **בשיחה עם ה-GPT (או `@AI Council`):** "מה הפרויקטים ב-Council?" → ChatGPT מבקש אישור להפעיל את הפעולה (Allow / Always
   allow) → מציג invest, food, english.
3. **שליחה אמיתית:** "תשלח לקלוד בדיקה ל-food: הודעת בדיקה מהשיחה של מאיר" → ChatGPT קורא ל-`postCouncilComment` ומחזיר
   `id: cm_…`, `status: QUEUED`. תוך ~20 דק' (או Actions → "AI Council relay" → Run workflow) ההודעה מופיעה ב-
   [Issue #98](https://github.com/meirco199-prog/bikur/issues/98) (ה-Issue הקבוע של food לפי `projects.json`) עם `source: gpt-audit`; ה-Routine של Claude מסמנת `RECEIVED` ואז
   `DONE`/`REJECTED`/`PR_OPEN`; ו-"מה קרה עם המשימה?" → `getCouncilTasks` מראה את הסטטוס.
4. **תאימות:** Council ההשקעות לא השתנה — "פרסם ב-Council: …" בלי project ממשיך להגיע ל-Issue #25.

## מה לא נדרש / מה לא נבנה
- לא Plugin (הוסר מ-ChatGPT) ולא relay חדש. ה-MCP endpoint (`/council/mcp`) הוא עטיפת JSON-RPC דקה מעל הנתיבים הקיימים
  (בדיקות: `invest-api/tests/worker.test.mjs`, "MCP (/council/mcp)").
- לא נדרש שום סוד חדש: המפתח המשותף של הערוץ הוא מה שנכנס ל-Action. `CRON_SECRET` נשאר בצד GitHub Actions בלבד.
