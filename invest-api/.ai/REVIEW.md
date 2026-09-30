---
applies_to: [invest/, .github/workflows/tick-invest.yml, .github/workflows/entry-940.yml, .github/workflows/deploy-invest-api.yml]
test: node --test invest-api/tests/*.test.mjs
docs: [invest/docs/ARCHITECTURE.md, invest/docs/SECURITY.md]
---
# מדיניות סקירה — פלטפורמת ההשקעות (invest/, invest-api/)

חלים גם כללי `AI_COUNCIL.md` (כללי העבודה, סעיפים 1–10). כאן חשבון תרגול/דמה — לא כסף אמיתי.

- **אין שינוי משקלים / מגבלות סיכון / מודל בחירה / ספים / יקום** בלי נימוק מתועד ב-`AI_COUNCIL.md` ואישור בעל הריפו.
  שינוי כזה ב-diff בלי נושא AI_COUNCIL מתאים = BLOCKER + `owner_gates`.
- **קבצי CODEOWNERS** (`engine/risk-limits.js`, `tracks.js`, `aggressive.js`, `autopilot.js`, `trading-policy.js`,
  `order-gate.js`, `agent-sim-policy.js`, `tests/risk-limits-lock.test.mjs`, `tests/order-gate.test.mjs`): כל נגיעה = `owner_gates`.
- **כסף אמיתי / מינוף אמיתי / שינוי ספק בתשלום / מנוי**: לעולם לא בהחלטת המודלים — `owner_gates`.
- **שער הפקודות דטרמיניסטי**: פקודה לברוקר (גם דמה) עוברת את `order-gate` ואת מגבלות הסיכון; עקיפה = SECURITY.
- **KV write quota**: לולאות שכותבות ל-KV מוגבלות (התוכנית החינמית); כתיבה לא מתוקצבת בנתיב cron = BUG.
- **הבדיקות** (`node --test invest-api/tests/*.test.mjs`) חייבות לעבור; לוגיקה חדשה במנוע בלי בדיקה = TEST GAP חוסם.
- **סודות**: `CRON_SECRET`/`APP_TOKEN`/מפתחות ספקים לא מופיעים בקוד, בתיעוד, בלוגים או ב-`/health` (ראה `DB.redact`).
- **דוחות ומספרים למשתמש** (שווי, רווח/הפסד, נקודת התחלה): מחושבים מנתונים אמיתיים ועם תאריך/שער נכונים; אחרת MISLEADING UI/METRIC.
