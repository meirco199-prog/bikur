# GPT Reviewer — המהנדס המבקר האוטומטי (AI Council לכל הפרויקטים)

הרחבה של [`AI_COUNCIL.md`](../../AI_COUNCIL.md) מעבר לפלטפורמת ההשקעות: בכל פעם ש-Claude מסיים שינוי (PR או דחיפה ל-`main`),
OpenAI קורא את הדרישה, ה-diff, הקבצים, הבדיקות ומדיניות הפרויקט, ומפרסם סקירה מסווגת ישירות ב-GitHub — בלי שמאיר מעביר
הודעות. Claude בודק כל ממצא מול הקוד (לא מקבל אוטומטית), מתקן או מתנגד עם ראיות, ודוחף; הסקירה רצה שוב. **שני מהנדסים,
בעל הריפו מכריע** — לא "GPT מנהל את Claude".

## הזרימה
```
Claude משנה קוד → PR / push
  → gpt-review.yml (GitHub Actions) → .github/gpt-review/review.mjs
  → אוסף הקשר: כותרת+תיאור, Issue מקושר (#N), diff (בתקציב), קבצים, check runs, בדיקות (test: במדיניות), README, .ai/REVIEW.md
  → OpenAI (פלט JSON מובנה) → תגובה "GPT REVIEW: PASS / BLOCKED / OWNER_DECISION_REQUIRED" ב-PR + תוויות + check
  → BLOCKED: Claude (הסשן שפתח את ה-PR, מנוי ל-PR; או ה-Routine) מאמת, מתקן/מתנגד, דוחף → סבב חדש
  → עד PASS, או עד MAX_REVIEW_ROUNDS (3) סבבים חוסמים → סבב הכרעה: PASS או OWNER_DECISION_REQUIRED למאיר
```

## מה מפעיל סקירה, ומה לא
| אירוע | מה קורה |
|---|---|
| PR נפתח / דחיפה ל-PR / הוצאה מטיוטה | סקירה של ה-head; תגובה ב-PR |
| דחיפה ל-`main` | אם ה-commit הוא מיזוג של PR שכבר נסקר — דילוג. אחרת (דחיפה ישירה): סקירה, תגובה על ה-commit, ואם לא PASS — Issue עם תווית |
| `workflow_dispatch` | `pr_number` לסקירה ידנית; `force=1` לסקור שוב את אותו SHA / אחרי הכרעת בעל הריפו |
| **דילוג** | PR בטיוטה · תווית `skip-gpt-review` · כותרת שמתחילה ב-`ops:` · רק קבצים בינאריים / `.github/invest-ops/` / lock · SHA שכבר נסקר |

## מדיניות לכל פרויקט: `<תיקייה>/.ai/REVIEW.md`
`.ai/REVIEW.md` בשורש חל תמיד; מדיניות פרויקט מתווספת כשקובץ ב-diff נמצא בתיקייתה או בנתיבי `applies_to`. בלי מדיניות — סקירה כללית.
```markdown
---
applies_to: [english-ai/, english-live/]          # נתיבים נוספים שהמדיניות חלה עליהם
test: node --test invest-api/tests/*.test.mjs     # פקודת בדיקות שתורץ ותצורף לסקירה (עד 6 דק')
docs: [invest/docs/ARCHITECTURE.md]               # מסמכים שיצורפו (מקוצרים)
---
# הכללים בשפה חופשית: מה חוסם, מה נדרש, מה אסור
```
קיימות: [`/.ai`](../../.ai/REVIEW.md) (כללי) · [`english`](../../english/.ai/REVIEW.md) · [`food`](../../food/.ai/REVIEW.md) · [`invest-api`](../../invest-api/.ai/REVIEW.md).

## הסקירה
כל ממצא מסווג: `BLOCKER · BUG · SECURITY · REGRESSION · MISSING REQUIREMENT · MISLEADING UI/METRIC · TEST GAP · ARCHITECTURE ·
OPTIONAL IMPROVEMENT`, עם: מה הבעיה, איפה (`קובץ:שורה`), למה, איך לשחזר/להוכיח, מה נדרש. BLOCKER/SECURITY תמיד חוסמים,
OPTIONAL לעולם לא (נאכף בסקריפט, לא רק בפרומפט). בלי ממצא חוסם → **PASS** עם "מה נבדק", "בדיקות/CI" והערות לא חוסמות.
**שערי אישור** (הוצאה כספית, ספק בתשלום, כסף אמיתי, מסחר/מינוף, secrets, מחיקת מידע, ארכיטקטורה בלתי הפיכה, מהות המוצר):
מסומנים `OWNER_APPROVAL_REQUIRED` + תווית `gpt-review:owner-approval` — לא למזג בלי מאיר, גם ב-PASS.

## הצד של Claude (הלולאה בלי מאיר)
1. אחרי פתיחת PR: `subscribe_pr_activity` — התגובה של GPT מגיעה לסשן כאירוע. לא ממזגים לפני שה-check **GPT Review** ירוק.
2. BLOCKED: לכל ממצא — אימות מול הקוד; תגובה אחת ב-PR: **תוקן** (commit + מה שונה) או **לא מסכים** + ראיה; ואז push (סבב חדש).
3. PASS: מיזוג (squash) אם ה-CI ירוק ואין `owner-approval`. OWNER_DECISION/APPROVAL: עוצרים ומסכמים למאיר בשפה פשוטה.
4. גיבוי לסשנים שנסגרו: Routine "GPT Review follow-up" סורק PR-ים פתוחים עם `gpt-review:blocked` שאין בהם תשובה של Claude אחרי הסקירה.
פירוט ההוראות המחייבות: [`CLAUDE.md`](../../CLAUDE.md).

## דשבורד / היסטוריה (בלי UI)
- תוויות על ה-PR: `gpt-review:pass` · `gpt-review:blocked` · `gpt-review:owner-decision` · `gpt-review:owner-approval`.
  רשימות: [PR-ים חסומים](https://github.com/meirco199-prog/bikur/pulls?q=is%3Apr+label%3Agpt-review%3Ablocked) ·
  [ממתינים להכרעה](https://github.com/meirco199-prog/bikur/issues?q=label%3Agpt-review%3Aowner-decision) ·
  [עברו](https://github.com/meirco199-prog/bikur/pulls?q=is%3Apr+label%3Agpt-review%3Apass).
- בכל תגובה: `(סבב n/3)`, סמן `<!-- gpt-review sha=… round=… verdict=… -->` (זה גם מנגנון הדדופליקציה), מודל וטוקנים.
- Actions → "GPT Review": סיכום ריצה (טבלת ממצאים) לכל ריצה; ה-check אדום = BLOCKED / OWNER_DECISION.

## עלויות ומגבלות
- diff עד ~90K תווים (קבצי קוד קודם, עד 14K לקובץ, שורות minified מקוצרות; העודף מופיע ברשימה בלבד), מסמכים עד 5K כל אחד,
  4 סבבים קודמים, 8 תשובות אחרונות. פלט עד 16K טוקנים (כולל חשיבה). אומדן: ~20–40K טוקני קלט לסבב.
- דגם: variable `OPENAI_REVIEW_MODEL` (ברירת מחדל: `OPENAI_MODEL` ואז `gpt-5`); מאמץ: `OPENAI_REVIEW_REASONING` (ברירת מחדל `medium`);
  סבבים: `MAX_REVIEW_ROUNDS` (3). המפתח: `OPENAI_API_KEY` שכבר קיים ב-Actions Secrets — בלעדיו ה-workflow מסיים בשקט.
- ערכי מפתחות מוסתרים לפני פרסום. השרשור לא נשלח כולו: רק סבבים קודמים ותשובות מאז הסקירה הראשונה.

## שימוש בריפו אחר
הריפו הזה ציבורי, אז מספיק workflow אחד בריפו השני (והסקריפט נמשך מכאן בזמן ריצה):
```yaml
name: GPT Review
on:
  pull_request: { types: [opened, synchronize, reopened, ready_for_review] }
  push: { branches: [main] }
permissions: { contents: read, pull-requests: write, issues: write }
jobs:
  review:
    uses: meirco199-prog/bikur/.github/workflows/gpt-review.yml@main
    secrets: inherit          # דורש OPENAI_API_KEY ב-Secrets של הריפו השני
```
מדיניות: `.ai/REVIEW.md` באותו ריפו. בלי — סקירה כללית.

## בדיקות
`node --test .github/gpt-review/review.test.mjs` (רץ ב-CI כשנוגעים בסקריפט).
