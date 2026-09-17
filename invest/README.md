# Invest — פלטפורמת מחקר, דירוג ומעקב השקעות

**כתובת:** `/invest/` (GitHub Pages) · **API:** `https://invest-api.meirco199.workers.dev` (Cloudflare Worker)

מערכת אישית לניתוח שיטתי של מניות, ETF, אג"ח ומדדים: סריקה, ניתוח פונדמנטלי וטכני, חדשות
וסנטימנט, קונצנזוס אנליסטים, ציון 0–100 מוסבר, סיגנלים עם רמות, Backtest ו-Walk-Forward,
מצב As-Of היסטורי, בניית תיק של 200,000 ₪ בארבעה פרופילים, Paper Trading, התראות ועוזר AI.

> לא ייעוץ השקעות. כל ציון/סיגנל הוא תוצר מודל (MODEL SIGNAL) מנתונים עם מקור וחותמת זמן.
> חסר = "Missing Data". אף מספר לא מומצא. Backtest אינו תחזית.

## תיעוד
| מסמך | תוכן |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | שכבות, החלטות, זרימות, אבטחה, מצבי חישוב |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | ספקי הנתונים, מחיר/מכסות/יתרונות/חסרונות, מיפוי נתון→ספק, איכות |
| [docs/DATABASE_SCHEMA.md](docs/DATABASE_SCHEMA.md) | מפתחות KV, append-only, סכימת SQL שקולה |
| [docs/SIGNAL_MODEL.md](docs/SIGNAL_MODEL.md) | בדיוק איך מחושב הציון והסיגנל |
| [docs/BACKTESTING_RULES.md](docs/BACKTESTING_RULES.md) | מניעת look-ahead/leakage, עלויות, walk-forward, As-Of |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | שלבים, מה הושלם, ביצוע פקודות בברוקר (שלב 3) |

## הפעלה ראשונה (חד-פעמי)
1. **הפריסה אוטומטית** בדחיפה ל-`main` (`.github/workflows/deploy-invest-api.yml` יוצר KV `invest`, binding ל-Workers AI, cron).
2. ב-Cloudflare → Workers & Pages → `invest-api` → Settings → Variables and Secrets, הוסף:
   - `APP_TOKEN` — סיסמה שלך לכתיבה (רשימת מעקב, paper, התראות, הגדרות, עיבוד).
   - `TWELVEDATA_KEY` (**חובה למחירים** — חינם, twelvedata.com), `FINNHUB_KEY`, `FRED_KEY` (חינם), `FMP_KEY`, `ALPHAVANTAGE_KEY` — ראו DATA_SOURCES.md. אפשר גם להדביק את המפתחות במסך ההגדרות של האפליקציה במקום בדשבורד.
   - אופציונלי: `EODHD_KEY` (ת"א), `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`, `RESEND_KEY` + `ALERT_EMAIL`, `ANTHROPIC_API_KEY` (אחרת Workers AI), `EDGAR_UA` (User-Agent עם אימייל ל-SEC), `CRON_BATCH`.
3. פתח `/invest/#/settings`, הזן את כתובת ה-API ואת `APP_TOKEN`, ולחץ **"עיבוד יומי בדפדפן ושמירה"** (או המתן ל-cron).

## תוכנית Cloudflare — חשוב
ניתוח נכס עולה ~20–100ms CPU. **Workers Free מוגבל ל-10ms CPU לקריאה**, ולכן:
- **Workers Paid ($5/חודש)** — ה-cron מנתח לבד את כל ה-universe מדי יום (הגדר `CRON_BATCH=40`), שולח התראות ל-Telegram/Email גם כשהאפליקציה סגורה. זו ההמלצה.
- **Free** — ה-API מגיש נתונים (מחירים/דוחות/חדשות במטמון), והניתוח רץ **בדפדפן** מאותו קוד (`invest-api/engine/`): דף הנכס נופל אוטומטית לחישוב מקומי, ו"עיבוד יומי בדפדפן" בהגדרות שומר snapshots/דירוג/תיקים ל-DB (append-only) ומפעיל התראות. KV חינמי: 1,000 כתיבות/יום — מספיק ל-universe של ~120 נכסים.

## מבנה
```
invest/            פרונט (ES Modules, בלי build)
  js/core/         api, store(IndexedDB), util, compute(Web Worker)
  js/ui/           chart (SVG), components
  js/screens/      14 מסכים
  js/engine-worker.js  מריץ את ה-engine בדפדפן
invest-api/        Cloudflare Worker
  engine/          מנוע אנליטי טהור — משותף ל-Worker ולדפדפן
  providers/       Stooq, Finnhub, FMP, Alpha Vantage, FRED, EDGAR, בנק ישראל, EODHD + registry
  lib/             db(KV), cache, budget, analysis, alerts, broker, ai, http
  tests/           node --test (engine + worker עם ספקים מדומים) + e2e (Playwright)
```

## בדיקות
```
node --test invest-api/tests/*.test.mjs                     # 67 בדיקות
node invest-api/tests/e2e/mock-server.mjs &                 # API מדומה (ספקים מדומים, KV בזיכרון)
python3 -m http.server 8000 &                                # הגשת הריפו
node invest-api/tests/e2e/e2e.mjs                            # Chromium: כל מסך + פעולות
```

## אוטומט לחשבון התרגול
המערכת מנהלת את חשבון התרגול לבד לפי כללים גלויים (קנייה בשלבים, מכירה לפי סיגנל/עצירת הפסד, אין קניות בשוק דובי). פרטים: [docs/AUTOPILOT.md](docs/AUTOPILOT.md).


## מודל הצל והמסלול האגרסיבי
מודל ציון חדש רץ כל לילה במקביל לישן בלי לסחור, ונמדד מולו (תשואות 1/5/20/60 יום, מונוטוניות, IC, התפלגות ציונים). במקביל רץ תיק צל אגרסיבי (ריכוזי, לפי מודל C) שנמדד מול SPY. פירוט: `docs/SHADOW_MODEL.md`. כרטיסים במסך "היום".

## יקום: כל ה-S&P 500
הרשימה מוויקיפדיה; הניתוח הלילי של 500 החברות רץ ב-GitHub Actions (`invest-api/scripts/nightly-sp500.mjs`) ונשמר ב-KV ב-16 מסמכים ליום (`lib/snapstore.js`).
