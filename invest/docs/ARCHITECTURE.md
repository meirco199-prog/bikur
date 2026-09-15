# ארכיטקטורה — פלטפורמת מחקר השקעות (`/invest/`)

> מסמך זה נכתב לפני שנכתבה שורת קוד אחת, ומעודכן עם כל החלטה ארכיטקטונית.
> החלטות סומנו ב-**[החלטה]** יחד עם הנימוק, כדי שאפשר יהיה לערער עליהן בדיעבד.

## 1. אילוצי הריפו שקובעים את הסטאק

| אילוץ (מ-`CLAUDE.md`) | השלכה |
|---|---|
| בלי build, בלי npm | ES Modules טהורים בדפדפן; אין TypeScript, אין bundler, אין ספריות חיצוניות (גם הגרפים נכתבו ב-SVG בעצמנו) |
| בלי מפתחות בצד הלקוח | כל קריאה לספק נתונים עוברת דרך Cloudflare Worker; המפתחות ב-Secrets של ה-Worker בלבד |
| פריסה מ-`main` ל-GitHub Pages + Actions → Cloudflare | הפרונט ב-`invest/`, ה-Worker ב-`invest-api/`, workflow חדש `deploy-invest-api.yml` שמקים לבד KV + Cron |
| עברית ו-RTL | כל הממשק והתיעוד בעברית; שמות שדות/קוד באנגלית |

**[החלטה] Cloudflare Workers + KV ולא שרת Node/Postgres.** הריפו כבר פורס Workers
באותה דרך (english-ai, english-push, remi), הסודות כבר קיימים, אין תשתית לתחזק,
ותוכנית החינם מספיקה ל-cron יומי + עשרות אלפי קריאות. המחיר: אין SQL. הפתרון:
מודל מפתחות KV מתועד ב-`DATABASE_SCHEMA.md` יחד עם סכימת SQL מקבילה ל-D1,
כך שהמעבר עתידי ל-D1 הוא החלפת מודול `lib/db.js` בלבד.

**[החלטה] מנוע אנליטיקה משותף (`invest-api/engine/`) שרץ גם ב-Worker וגם בדפדפן.**
אותם קבצים בדיוק: ה-Worker מייבא אותם (`./engine/x.js`) והדפדפן מייבא אותם
(`../invest-api/engine/x.js` — GitHub Pages מגיש את כל הריפו). כך:
- הציון היומי נחתם ב-Worker (cron) ונשמר ללא דריסה — "מה המערכת המליצה בתאריך X".
- Backtest ו-As-Of, שהם כבדי CPU, רצים בדפדפן (ל-Worker בתוכנית החינם יש ~10ms CPU לבקשה).
- אין שתי גרסאות של אותה נוסחה.

## 2. שכבות

```
┌──────────────────────────────────────────────────────────────────────┐
│ FRONTEND  invest/js/screens/*   מסכים בלבד. לא מחשבים ציון.           │
│           invest/js/ui/*        גרפים SVG, רכיבים                      │
│           invest/js/core/api.js לקוח API + מטמון + מצב offline          │
├──────────────────────────────────────────────────────────────────────┤
│ ENGINE    invest-api/engine/*   פונקציות טהורות, דטרמיניסטיות, נבדקות   │
│   indicators  fundamentals  valuation  scoring  signals  regime        │
│   backtest    portfolio     risk       news     universe  util          │
├──────────────────────────────────────────────────────────────────────┤
│ API       invest-api/worker.js  ניתוב, אימות, rate-limit, לוגים, cron   │
│ INGEST    invest-api/providers/*  מתאם לכל ספק, מאחורי ממשק אחיד       │
│ DB        invest-api/lib/db.js   סכימת מפתחות KV + snapshot בלתי-נדרס  │
│ ALERTS    invest-api/lib/alerts.js  כללים, cooldown, Telegram/Email     │
│ AI        invest-api/lib/ai.js   RAG על נתוני המערכת בלבד              │
└──────────────────────────────────────────────────────────────────────┘
```

### ממשק ספק נתונים (abstraction layer)

כל ספק מממש תת-קבוצה מהמתודות הבאות ומחזיר תמיד את אותו מבנה, כולל
`source`, `asOf` (חותמת זמן של הנתון), `fetchedAt`, `currency`, `quality` (0-1):

```js
{ id, priority, supports: ['prices','quote','profile','fundamentals','analyst',
                           'news','insider','etf','macro','fx','screener','earnings'],
  prices(symbol, {from}), quote(symbol), profile(symbol), fundamentals(symbol),
  analyst(symbol), news(symbol,{from}), insider(symbol), etf(symbol),
  macro(seriesId), fx(pair), screener(filters), earnings(symbol) }
```

`providers/registry.js` בוחר ספק לפי עדיפות ותקציב יומי; אם ספק נופל (שגיאה /
מכסה / timeout) עוברים לבא בתור, והתשובה מסמנת `source` בפועל. אם אף ספק לא
ענה — מוחזר `{ missing: true, reason }` ולעולם לא מספר מומצא או ישן בשקט.

### מטמון ותקציב

- כל תשובת ספק נשמרת ב-KV עם TTL לפי סוג (מחירים יומיים: עד 18:00 ET; פונדמנטלס: 7 ימים; חדשות: 6 שעות; מאקרו: 12 שעות).
- `lib/budget.js` סופר קריאות לכל ספק ליום (KV) ומסרב לחרוג מהמכסה החינמית — כך המערכת לא "נשברת" באמצע היום.
- Stale data מוחזר **רק** עם דגל `stale: true` ו-`asOf` ישן, והממשק מציג זאת בכתום.

## 3. זרימות עיקריות

**Cron יומי (23:30 UTC, אחרי סגירת ארה"ב):**
1. רענון מאקרו (FRED, BOI) → `regime` נשמר ל-`regime:{date}`.
2. לכל נכס ב-universe הפעיל (watchlist + מועמדי screener + מדדים): מחירים, פונדמנטלס (אם פג), חדשות.
3. חישוב ציון+סיגנל ב-engine → `snap:{date}:{sym}` (כתיבה רק אם לא קיים).
4. דירוג → `rank:{date}`; תיקים מומלצים → `reco:{date}`.
5. הרצת כללי התראה → שליחה + `alerts:log:{date}`.

**בקשת דף נכס:** הפרונט קורא `/asset/:sym` (מאוחד: מחירים+פונדמנטלס+חדשות+אנליסטים+snapshot אחרון); כל בלוק עם `source/asOf/quality` משלו.

**As-Of:** הפרונט מבקש `/asof/:sym?date=` ; ה-Worker חותך מחירים ≤ date, עובדות
EDGAR לפי `filed ≤ date`, חדשות לפי `published ≤ date`, ומסמן אנליסטים/סנטימנט
כ-"לא זמין נקודתית" (אין לנו היסטוריה של קונצנזוס). החישוב עצמו זהה למסלול החי.

## 4. אבטחה

- Secrets: `FINNHUB_KEY`, `FMP_KEY`, `ALPHAVANTAGE_KEY`, `FRED_KEY`, `EODHD_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `RESEND_KEY`, `ALERT_EMAIL`, `APP_TOKEN`, `ANTHROPIC_API_KEY` (אופציונלי) — רק ב-Worker.
- כל endpoint שכותב (watchlist, paper, alerts, settings, refresh) דורש `Authorization: Bearer APP_TOKEN`. קריאה פתוחה (אין בה סודות).
- Rate limit: 60 בקשות/דקה ל-IP (זיכרון + KV), 10/דקה ל-`/ai/*`.
- Validation: סימבולים `^[A-Z0-9.^\-]{1,12}$`, תאריכים ISO, מספרים בטווח.
- Logging: `log:err` טבעת של 200 שגיאות אחרונות, נחשף ב-`/health`.

## 5. מה לא נבנה ולמה (ראו IMPLEMENTATION_PLAN.md)

- **TASE ישירות**: אין API חינמי מורשה למחירי ת"א. יש מתאם EODHD (בתשלום) מוכן, ועד אז חשיפה לישראל דרך ADR ו-ETF (EIS). TA-35/TA-125 מוצגים כ-Missing Data אם אין מפתח.
- **Short interest / 13F**: אין מקור חינמי אמין עם API; מוצג Missing Data, מתאם FINRA מתועד.
- **Web Push**: התראות בדפדפן עובדות כשהאפליקציה פתוחה (Notification API); Push אמיתי דורש Worker נוסף כמו `english-push` — שלב 2.
