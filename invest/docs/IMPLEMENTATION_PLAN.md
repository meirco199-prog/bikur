# תוכנית יישום — IMPLEMENTATION_PLAN.md

## שלב 0 — תכנון (הושלם)
- [x] סריקת הריפו: אין build, Workers נפרסים ב-Actions, סודות `CF_API_TOKEN` קיימים.
- [x] ARCHITECTURE / DATA_SOURCES / DATABASE_SCHEMA / SIGNAL_MODEL / BACKTESTING_RULES.

## שלב 1 — MVP (הושלם בקומיט הזה)
| רכיב | קובץ | בדיקה |
|---|---|---|
| Engine: indicators | `invest-api/engine/indicators.js` | `tests/indicators.test.mjs` (SMA/EMA/RSI/MACD/BB/ATR מול ערכים ידועים) |
| Engine: fundamentals point-in-time + valuation | `engine/fundamentals.js`, `engine/valuation.js` | `tests/fundamentals.test.mjs` |
| Engine: scoring, signals, regime | `engine/scoring.js`, `engine/signals.js`, `engine/regime.js` | `tests/scoring.test.mjs` |
| Engine: backtest + walk-forward | `engine/backtest.js` | `tests/backtest.test.mjs` (אין look-ahead: שינוי בר עתידי לא משנה טרייד) |
| Engine: portfolio, risk, news dedup | `engine/portfolio.js`, `engine/risk.js`, `engine/news.js` | `tests/portfolio.test.mjs`, `tests/news.test.mjs` |
| Worker: providers, cache, budget, routes, cron, alerts, AI | `invest-api/worker.js`, `providers/*`, `lib/*` | `tests/worker.test.mjs` (KV מדומה + fetch מדומה) |
| Deploy | `.github/workflows/deploy-invest-api.yml` | יוצר KV `invest`, cron, subdomain |
| Frontend: 14 מסכים | `invest/js/screens/*` | `tests/e2e/e2e.mjs` (Playwright/Chromium מול `mock-server.mjs`): 16 תרחישים — כל מסך, לשוניות דף הנכס, backtest+walk-forward, As-Of, paper order, כלל התראה, שאלה ל-AI, עיבוד בדפדפן ושמירה. 0 שגיאות קונסול |
| מצב חישוב בדפדפן | `engine/pipeline.js`, `POST /snapshots`, `engine-worker.js` | worker.test + e2e (settings) |

### מה אומת ומה לא (בכנות)
- **אומת:** כל הלוגיקה (67 בדיקות יחידה), ה-Worker מקצה לקצה עם ספקים מדומים, והממשק בדפדפן אמיתי.
- **לא אומת (אין רשת בסביבת הפיתוח):** פורמטי התשובה האמיתיים של הספקים. המתאמים נכתבו לפי התיעוד הרשמי
  ומטפלים בשגיאות/שדות חסרים כ-Missing Data, אך ייתכנו סטיות (במיוחד ב-FMP "stable" וב-Alpha Vantage). `/health`
  מציג `recentErrors` — זה המקום הראשון לבדוק אחרי הזנת המפתחות.
- **לא אומת:** העלאת Worker רב-מודולי דרך ה-API של Cloudflare (ה-workflow משתמש בחלקי multipart בשמות הנתיבים,
  כפי ש-wrangler עושה). אם הפריסה נכשלת, הלוג ב-Actions יראה את תשובת Cloudflare.

מסכים ב-MVP: Dashboard, Search, Asset (פונדמנטלס/טכני/חדשות/אנליסטים/ציון/WHY), Watchlist, Opportunities, Portfolio 200k, Signals, Regime, Backtest, As-Of, Paper Trading, Alerts, Assistant, Settings.

## שלב 2 — לאחר הפעלה עם מפתחות אמיתיים
- [ ] להזין `FINNHUB_KEY`, `FMP_KEY`, `ALPHAVANTAGE_KEY`, `FRED_KEY`, `APP_TOKEN` (ו-Telegram) כ-Secrets ב-Worker (`/health` מראה מה חסר).
- [ ] ולידציה של מיפוי XBRL מול 20 חברות (תגיות חריגות → `facts.js` mapping).
- [ ] Web Push (Worker נפרד, כמו `english-push`).
- [ ] הרחבת universe דרך FMP screener לפי פילטרים שמורים; Short interest (FINRA), 13F.
- [ ] הגירה ל-D1 אם היקף ה-snapshots יעבור ~100k מפתחות.

## שלב 3 — ביצוע פקודות (בקשת המשתמש: "שהאפליקציה תבצע קנייה/מכירה")
**מה אפשרי באופן חוקי ובטוח:** רק דרך API רשמי של ברוקר שמאפשר זאת בהסכם.
- **Interactive Brokers** — יש חשבונות ללקוחות ישראלים, מסחר בארה"ב ובת"א, API רשמי (Client Portal Web API / TWS API). זו הדרך המקצועית. דורש Gateway שרץ על מחשב/שרת של המשתמש (לא ניתן מ-Cloudflare Worker ישירות) או IBKR OAuth (לחשבונות עם אישור).
- **Alpaca / Tradier** — API מצוין אך פתיחת חשבון מישראל מוגבלת.
- **ברוקרים ישראליים (מיטב, IBI, אקסלנס, פסגות, בנקים)** — אין API ציבורי. "השתלטות" על ה-API הפנימי של האפליקציה שלהם (reverse-engineering, שימוש בטוקנים של הסשן) מנוגדת לתנאי השימוש, עלולה לחסום את החשבון, ואין לה SLA — **לא נבנה.**

תכנון: `invest-api/lib/broker.js` מגדיר ממשק `{ getPositions, getCash, placeOrder, cancel, getOrders }`.
מומש כעת `PaperBroker` (התיק הווירטואלי). `IbkrBroker` ייכתב כשתהיה סביבת Gateway. כללי בטיחות שלא ישתנו:
1. ברירת מחדל: **אישור ידני** לכל פקודה (כפתור "אשר" עם סיכום); מצב אוטומטי רק לפקודות Limit קטנות ממגבלת סכום יומית.
2. מגבלות: max order, max daily turnover, לא לסחור ב-15 הדקות הראשונות, לא בסמוך ל-earnings בלי אישור.
3. Kill switch ב-`user:settings.trading.enabled`.
4. יומן פקודות append-only (`orders:log`).

## תהליך לכל שלב
1. כתיבה → `node --test invest-api/tests` → תיקון → Playwright על הפרונט → תיקון → קומיט → מיזוג ל-main.
