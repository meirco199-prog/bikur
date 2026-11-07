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
| [docs/SHADOW_MODEL.md](docs/SHADOW_MODEL.md) | מודלי הציון המקבילים (A/B/C/D/DF) ומדידתם מול הישן |
| [docs/TRACKS.md](docs/TRACKS.md) | חמישה מסלולי השקעה מקבילים (regB/regC/אגרסיבי B + שתי קבוצות ביקורת), מדדי ייחוס שקליים |
| [docs/STOPS.md](docs/STOPS.md) | סקירת סיכון gap/תוך-יומי בעצירות הנוכחיות + הצעת עיצוב לעצירות ברוקר אמיתיות ב-IBKR |
| [docs/SECURITY.md](docs/SECURITY.md) | CRON_SECRET כ-secret_text, נעילת מנוע הסיכון (CODEOWNERS + בדיקת נעילה) |

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
node --test invest-api/tests/*.test.mjs                     # 152 בדיקות
node invest-api/tests/e2e/mock-server.mjs &                 # API מדומה (ספקים מדומים, KV בזיכרון)
python3 -m http.server 8000 &                                # הגשת הריפו
node invest-api/tests/e2e/e2e.mjs                            # Chromium: כל מסך + פעולות
```

## אוטומט לחשבון התרגול
המערכת מנהלת את חשבון התרגול לבד לפי כללים גלויים (קנייה בשלבים, מכירה לפי סיגנל/עצירת הפסד, אין קניות בשוק דובי). פרטים: [docs/AUTOPILOT.md](docs/AUTOPILOT.md).


## מודל הצל וחמישה מסלולי השקעה מקבילים
מודל ציון חדש רץ כל לילה במקביל לישן בלי לסחור, ונמדד מולו (תשואות 1/5/20/60 יום, מונוטוניות, IC, התפלגות ציונים). במקביל רצות חמש סימולציות תיק (חשבון התרגול המאוזן והמסלול האגרסיבי הקיימים כקבוצות ביקורת, ושלושה מסלולי צל חדשים — regB, regC, אגרסיבי B), כולן מול אותם מדדי ייחוס שקליים. פירוט: `docs/SHADOW_MODEL.md`, `docs/TRACKS.md`. כרטיסים במסך "היום", השוואה מלאה ב-`#/tracks`.

## 🪙 קריפטו — דמה 200K$ (Issue #189)
המסך הייעודי לקריפטו (`#/crypto`, גם דף הפתיחה של האפליקציה ולשונית 🪙 בסרגל התחתון) — ניסוי הדמה של שיטת "ריזיקות עקרונות"
(amit.sinay) על BTC/ETH/LTC/BCH. **סימולציה בלבד — בלי כסף אמיתי, בלי פקודות לברוקר. הכללים קפואים ב-[Issue #189](https://github.com/meirco199-prog/bikur/issues/189)**.

- **המנוע רץ בתוך ה-Worker** (`invest-api/engine/sinay-rules.js`, העתקה 1:1 של `paper.py` — בדיקת התאמה בתו מול fixture שנוצר
  בפייתון: `invest-api/tests/sinay-live.test.mjs`). ה-cron (כל 5 דקות) מריץ את `lib/sinay-live.js`, שעובד רק כשנסגר נר 15
  דקות חדש: נרות מ-Coinbase (API ציבורי, בלי מפתח; גיבוי Kraken) → עיבוד → KV `sinay:state` (≤96 כתיבות ביום) → **בלי
  התראה על כל אירוע** (החלטת מאיר, 6/11/2026) — המסלול מופיע בסיכום הקריפטו היומי בטלגרם אחרי 21:00 (יחד עם מסלול עמית).
  הרצה ידנית: `POST /sinay/run` (סוד ה-cron).
- **המסך:** "מה קורה עכשיו" לכל מטבע במילים פשוטות (מחכים לדשדוש / דשדוש פעיל + רמות / בעסקה + יעד וסטופ), "בדרך לכסף אמיתי"
  (50 עסקאות, רווח נטו, ירידה מקסימלית — הצעה למדידה; ההחלטה של בעל הריפו), עקומת שווי, דשדושים פעילים ויומן עסקאות.
- **חשבון:** 200,000$, 50,000$ לכל מטבע, בלי מינוף, כניסה בשלישים, עמלה 0.05% לכל צד.
- **היסטוריה:** עד 5/11/2026 הסימולציה רצה מחוץ לריפו כל 6 שעות על נרות IBKR (Paxos) ופרסמה את המצב בתגובה ב-Issue #189
  (`sinay-sync.yml` → `POST /sinay/ingest`). מאז שהמנוע ב-Worker כתב פעם אחת, הקליטה מה-Issue **לא דורסת** אותו (`ignored`).
- **בדיקות:** `invest-api/tests/sinay.test.mjs`, `invest-api/tests/sinay-live.test.mjs`.

### 🧪 מסלול עמית — סקאלפ ביטקוין על נרות דקה (6/11/2026)
מסלול דמה שני על אותו מסך, **לצד** "ריזיקות עקרונות" (לא במקומו): מבחן לשיטת המסחר המהירה שעמית מראה ב-Bybit. סימולציה בלבד.
- **הכללים** (מצילומי המסך שלו, `invest-api/engine/amit-rules.js`): רצועות בולינגר (20, 2) על נרות דקה, מחושבות מהסגירות
  שלפני הנר. נגיעה ברצועה התחתונה → לונג במחיר הרצועה, בעליונה → שורט (רק אחרי סגירה בתוך הרצועות). יציאה: נגיעה ברצועה
  הנגדית, סטופ −0.22% (נבדק ראשון, גם בנר הכניסה), או אחרי 60 דקות. פוזיציה 190,000$ (כמו בסרטון), בטחון 5,000$, חשבון
  20,000$. עמלות כמו בדוח שלו: 0.014% לפקודה מוגבלת, 0.035% לפקודה מיידית.
- **ריצה:** `lib/amit-live.js` מה-cron (כל 5 דקות) — נרות דקה מ-Coinbase (גיבוי Kraken), KV `amit:state`. נכתב רק בעסקה
  חדשה/סגורה (עד 150 ביום), פעם בשעה (עד 24) ובסיכום היומי — עד ~175 ביום, ותקרה קשיחה של 180 לכל סוגי הכתיבה. השמירה
  השעתית ממשיכה גם כשמכסת האירועים מלאה, ולכן ריצה שלא נכתבה משוחזרת בדיוק מהמצב השמור (לכל היותר בן שעה) + 5 שעות נרות.
  חור אמיתי בנתונים (מקור לא זמין יותר מ-5 שעות) נספר, והמסך מסמן את התוצאות כחלקיות.
  **בוט בחשבון הדמו של Bybit** (אותם כללים, פקודות אמיתיות על כסף וירטואלי, מגבלת הפסד יומית 1,000$): [`docs/BYBIT_BOT.md`](docs/BYBIT_BOT.md).
  טלגרם: סיכום קריפטו יומי אחד אחרי 21:00 — לשני מסלולי הדמה (עמית + "ריזיקות עקרונות"), בלי הודעה על כל עסקה. דוח: `GET /amit`; הרצה ידנית: `POST /amit/run` (סוד ה-cron).
- **בדיקות:** `invest-api/tests/amit.test.mjs`. שינוי כלל = גרסה חדשה, לא שינוי שקט.

## יקום: כל ה-S&P 500
הרשימה מוויקיפדיה; הניתוח הלילי של 500 החברות רץ ב-GitHub Actions (`invest-api/scripts/nightly-sp500.mjs`) ונשמר ב-KV ב-16 מסמכים ליום (`lib/snapstore.js`).
