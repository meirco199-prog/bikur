# אבטחה: סודות ונעילת מנוע הסיכון — SECURITY.md

מסמך זה מתעד שני תיקונים שבוצעו כהכנה לפני מעבר לכסף אמיתי (IBKR), בעקבות ביקורת קוד שזיהתה אותם. **שניהם תיקוני
תשתית/מדידה ואבטחה — לא שינויי אסטרטגיה.** אין להפעיל מסחר בכסף אמיתי לפני אימות עצמאי (לא על ידי הסוכן שביצע את
התיקון) ששניהם אכן פעילים.

## 1. CRON_SECRET הוצא מ-`invest-api/config.json`

### מה היה הבעיה
`invest-api/config.json` הוא קובץ **ציבורי** בריפו — הוא נקרא בפריסה ונכנס ל-Worker כ-`plain_text` bindings (בכוונה,
עבור הגדרות שאינן סוד: `APP_TOKEN_SHA256`, `EDGAR_UA`, `CRON_BATCH`). `CRON_SECRET` היה בקובץ הזה — כלומר **הערך
המלא שלו היה גלוי לכל מי שקורא את הריפו הציבורי**, כולל בהיסטוריית ה-git. `CRON_SECRET` משמש כדי שקריאות מ-GitHub
Actions ל-endpoints תפעוליים (`/cron/run`, `/aggressive/run`, `/tracks/run`, `/shadow/run` ועוד) יעברו בלי טוקן
המשתמש המלא (`APP_TOKEN`) — אבל מי שיודע את הסוד יכול היה לקרוא לאותם endpoints בעצמו.

### מה תוקן
1. **הוסר** מ-`invest-api/config.json` — הערך הישן (`invest-tick-2c85f4f730fb`) **נחשב חשוף ולא ישמש שוב** (הוא
   כבר בהיסטוריית git הציבורית לצמיתות, גם אחרי ההסרה מהקובץ הנוכחי — הסרה מהעתיד לא מוחקת עבר).
2. **נוצר ערך חדש** (רוטציה אמיתית, לא שימוש חוזר בערך הישן).
3. **`.github/workflows/tick-invest.yml`** ו-**`entry-940.yml`**: במקום לקרוא את הסוד מ-`config.json`, קוראים
   אותו עכשיו מ-`${{ secrets.CRON_SECRET }}` — GitHub Actions repository secret (לא קובץ בריפו). אם הוא חסר,
   ה-workflow נכשל עם הודעת שגיאה ברורה במקום להיכשל בשקט.
4. **`.github/workflows/deploy-invest-api.yml`**: שלב חדש ("Set CRON_SECRET as a Cloudflare secret") שולח את הערך
   מ-`secrets.CRON_SECRET` (GitHub) ל-Cloudflare Worker כ-`secret_text` binding (לא `plain_text`) — אותו מנגנון
   שכבר קיים למפתחות הספקים האמיתיים (`FINNHUB_KEY` וכו', ראו `keep_bindings` בקובץ). ל-Worker (`worker.js`) אין
   שום שינוי קוד — הוא קורא `env.CRON_SECRET` בדיוק כמו קודם, בין אם הבינדינג הוא `plain_text` או `secret_text`.

### פעולה נדרשת מבעל הריפו (חד-פעמי, לא ניתן לביצוע על ידי הסוכן)
**חובה להוסיף Repository Secret בשם `CRON_SECRET`** (Settings → Secrets and variables → Actions → New repository
secret) בריפו `meirco199-prog/bikur`, לפני/מיד אחרי המיזוג הזה — אחרת:
- הפריסה הבאה (`deploy-invest-api.yml`) תיכשל בכוונה (fail-closed) עם שגיאה ברורה, במקום לפרוס Worker בלי הגנה על
  ה-cron endpoints.
- `tick-invest.yml` / `entry-940.yml` ייכשלו גם הם בבירור, במקום להיכשל בשקט או לשלוח בקשות לא מאומתות.

הערך לשימוש (נוצר בזמן התיקון הזה, לא הערך הישן שדלף):
```
invest-tick-d1c1d61b1635cb000afafaedfe2525cb34384217
```
אחרי שהוא מוגדר כ-Repository Secret, כל ה-workflows יעבדו אוטומטית בפעם הבאה שהם ירוצו — אין צורך בפעולה נוספת.
מומלץ להחליף גם ערך זה בעתיד (רוטציה תקופתית) כשנוח — זה רק דורש עדכון ה-Secret ב-GitHub; לא צריך לשנות קוד.

## 2. נעילה טכנית של מנוע הסיכון (RISK_LIMITS ומגבלות סיכון נלוות)

### מה הבעיה
`invest-api/engine/risk-limits.js` (ומקביליו: `TRACK_LIMITS_C` ב-`engine/tracks.js`, `AGGR_RULES` ב-`engine/aggressive.js`,
חלקי `AUTO_RULES` ב-`engine/autopilot.js`) הם **מנוע הסיכון הקשיח** — הגבולות שאף לוגיקת מסחר לא אמורה לחצות, לכסף
תרגול היום ולכסף אמיתי בעתיד. `Object.freeze()` (כבר קיים) מונע שינוי **בזמן ריצה**, אבל לא מונע משום דבר — כולל
סוכן AI שממשיך לכתוב קוד בריפו הזה — לשנות את **הערכים בקוד המקור** בפשטות, בלי ביקורת נפרדת.

### מה תוקן עכשיו
1. **`.github/CODEOWNERS`** — קובץ חדש שמסמן את הקבצים הקריטיים לסיכון (`engine/risk-limits.js`, `engine/tracks.js`,
   `engine/aggressive.js`, `engine/autopilot.js`, וקובץ הנעילה הבא) כדורשים סקירה של בעל הריפו.
2. **`invest-api/tests/risk-limits-lock.test.mjs`** — בדיקת "נעילה" שממש את הערכים הנוכחיים של כל מגבלות הסיכון
   (מבנה מלא, לא רק כמה שדות). שינוי בערך כלשהו **שובר את הבדיקה הזו**, וה-CI (`deploy-invest-api.yml`, job `test`)
   רץ *לפני* כל פריסה (`deploy: needs: test`) — כלומר **שינוי שקט בערכי הסיכון לא יגיע לפרודקשן בלי שהבדיקה נכשלת
   במפורש** ומונעת את הפריסה האוטומטית. שינוי מכוון ולגיטימי דורש לעדכן גם את קובץ הבדיקה — כך שהוא תמיד מופיע
   בדיף כשינוי גלוי, לא שינוי מוסתר בתוך קובץ אחר.

### המגבלה החשובה — מה זה *לא* פותר
**CODEOWNERS לבדו לא חוסם push ישיר ל-`main`.** GitHub אוכף אותו רק דרך "Require review from Code Owners" בהגדרת
Branch Protection על הענף — וזו **פעולה ידנית** ב-GitHub (Settings → Branches → `main` → Require a pull request
before merging + Require review from Code Owners), **שאין לסוכן כלי לבצע מרחוק** בסביבת העבודה הזו. עד שההגדרה הזו
תופעל ידנית:
- CODEOWNERS משמש כתיעוד כוונה וכ"רשימת בעלים" למעקב, אבל **לא אוכף חסימה טכנית**.
- **בדיקת הנעילה (`risk-limits-lock.test.mjs`) היא ההגנה הטכנית האמיתית שכבר פעילה עכשיו** — כי היא חלק מ-CI
  שכבר רץ לפני כל פריסה, בלי תלות בהגדרות Branch Protection.

### המלצה לפני כסף אמיתי
1. להפעיל ידנית Branch Protection על `main` עם "Require pull request" + "Require review from Code Owners" —
   כדי שגם שינוי שכן עובר את בדיקת הנעילה (כי עודכנו שני הקבצים יחד) עדיין יעצור לביקורת אנושית.
2. לוודא ש-CRON_SECRET (סעיף 1) פעיל ומאומת עצמאית.
3. לוודא שההצעה לעצירות אצל ברוקר אמיתי (`STOPS.md`) מיושמת, לא רק מתועדת, לפני חיבור IBKR עם כסף אמיתי.

**שני התיקונים בעמוד הזה הם תיקוני תשתית/אבטחה בלבד — הם לא שינו שום ערך סיכון, שום כלל קנייה/מכירה, ושום התנהגות
של אף מסלול.** אין להפעיל מסחר בכסף אמיתי על סמך התיקונים האלה בלבד, ובלי אימות עצמאי שהם אכן פעילים (Repository
Secret קיים, Branch Protection מופעל).
