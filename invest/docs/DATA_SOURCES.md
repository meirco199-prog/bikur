# מקורות נתונים — DATA_SOURCES.md

עיקרון: **API רשמי/מורשה בלבד, בלי scraping.** לכל נתון נשמרים `source`, `asOf`,
`fetchedAt`, `currency`, `quality`. אם אין נתון — `missing: true`. אף מספר לא מומצא.

## 1. טבלת ספקים (מצב ספטמבר 2026 — יש לוודא מול האתרים לפני רכישה)

| ספק | מה מספק | מפתח | מכסה חינמית | מחיר בתשלום | יתרונות | חסרונות | סטטוס במערכת |
|---|---|---|---|---|---|---|---|
| **Stooq** (stooq.com/q/d/l) | מחירים יומיים OHLCV, היסטוריה של עשרות שנים | אין | — | — | חינם, ארוך | **נמצא בפועל (15.9.2026): מחזיר דף אימות JavaScript לכתובות datacenter (Cloudflare וגם GitHub) — לא שמיש אוטומטית** | מתאם קיים, כבוי (`STOOQ_ENABLED=1` להפעלה) |
| **Twelve Data** | מחירים יומיים (עד 5000 ברים), quote, מדדים עיקריים | `TWELVEDATA_KEY` | 800 קרדיטים/יום, 8/דקה | $29+/חודש | API רשמי יציב, כיסוי ארה"ב מלא, JSON נקי | מכסת דקה נמוכה (המערכת מגבילה ל-7/דקה) | **ראשי למחירים** |
| **Tiingo** | מחירים יומיים מותאמים (adjusted) למניות/ETF בארה"ב | `TIINGO_KEY` | ~1000/יום, 50/שעה | $10+/חודש | איכות נתונים גבוהה, adjusted | אין מדדים | גיבוי למחירים |
| **Alpha Vantage** | TIME_SERIES_DAILY (מלא), OVERVIEW (P/E, PEG, EV/EBITDA, ROE, יעד אנליסטים + ספירת דירוגים), EARNINGS, NEWS_SENTIMENT (ציון סנטימנט לכל ידיעה), INSIDER_TRANSACTIONS, ETF_PROFILE (החזקות), TOP_GAINERS_LOSERS | `ALPHAVANTAGE_KEY` | **25 קריאות/יום** | $50/חודש (75/דקה) | רחב מאוד, כולל סנטימנט וחדשות ממקורות מזוהים | מכסה זעירה; חייב תקציב יומי | גיבוי מחירים; ראשי ל-ETF holdings, insider, סנטימנט חדשות |
| **Finnhub** | quote (כמעט real-time), profile2, metric (basic financials), recommendation trends (Strong Buy…Sell לפי חודש), company-news, insider-transactions, earnings calendar, peers, symbol lists | `FINNHUB_KEY` | 60 קריאות/דקה | $50+/חודש | מהיר, קונצנזוס אנליסטים חינם, חדשות חברה | candles ו-price targets בתשלום; חינם = ארה"ב בלבד | ראשי ל-quote, קונצנזוס, חדשות, insider, earnings |
| **Financial Modeling Prep** | screener (סינון universe!), profile, ratios, key-metrics, income/balance/cashflow, analyst-estimates, price-target-consensus, ETF holdings, historical EOD | `FMP_KEY` | 250 קריאות/יום, ארה"ב, 5 שנות היסטוריה | $22–$99/חודש | ה-screener היחיד החינמי הסביר; יחסים מחושבים | חלק מהנקודות עברו לתשלום ללא הודעה — המתאם מטפל ב-402/403 כ-missing | ראשי ל-**Market Screening**, תחזיות EPS/Revenue |
| **SEC EDGAR** (data.sec.gov) | `companyfacts` (XBRL: הכנסות, רווח, EPS, מזומן, חוב, מניות — **עם תאריך הגשה `filed`**), `submissions` (10-K/10-Q/8-K/Form 4 עם תאריכים), `company_tickers.json` | אין (חובה User-Agent עם אימייל) | 10 בקשות/שנייה | — | **רשמי, ראשוני, point-in-time** — מאפשר As-Of בלי look-ahead | ארה"ב בלבד; תגיות XBRL לא אחידות בין חברות (יש מיפוי נפילה בקוד) | **ראשי לפונדמנטלס היסטוריים ואירועי דיווח** |
| **FRED** (St. Louis Fed) | DGS10, DGS2, T10Y2Y, DFF/FEDFUNDS, CPIAUCSL, VIXCLS, BAMLH0A0HYM2 (מרווח HY), DEXISUS (USD/ILS), DCOILWTICO, UNRATE, DTWEXBGS | `FRED_KEY` (חינם) | 120/דקה | — | רשמי, יציב, היסטוריה מלאה | פיגור של יום | **ראשי למאקרו** |
| **בנק ישראל** (boi.org.il/PublicApi) | שער יציג USD/ILS, EUR/ILS, ריבית בנק ישראל | אין | סביר | — | רשמי | ממשק משתנה מדי פעם | ראשי ל-USD/ILS יציג; FRED גיבוי |
| **EODHD** | מחירים+פונדמנטלס לבורסת ת"א (`.TA`), מדדים TA35/TA125 | `EODHD_KEY` | 20 קריאות/יום (דמו מוגבל) | ~$20–$80/חודש | כיסוי ת"א אמיתי | בתשלום | מתאם מוכן; **לא פעיל בלי מפתח** |
| **TASE Data Hub** | נתוני הבורסה הרשמיים | הרשמה | לפי הסכם | לפי הסכם | רשמי | תהליך הרשמה, תיעוד חלקי | מתועד בלבד |
| **FINRA Query API** | Short interest דו-שבועי | הרשמה חינמית | מוגבל | — | רשמי | לא בזמן אמת | מתועד; Missing Data ב-MVP |
| **Workers AI / Anthropic** | שכבת ה-AI (סיכום, שאלות על נתוני המערכת) | binding / `ANTHROPIC_API_KEY` | Workers AI: 10k neurons/יום | לפי שימוש | מקומי ב-Cloudflare | Llama פחות מדויק מ-Claude | Workers AI ברירת מחדל; Claude אם יש מפתח |

**לא בשימוש בכוונה:** Yahoo Finance (API לא רשמי, מנוגד לתנאי שימוש), Google Finance, CNN Fear&Greed (endpoint לא רשמי — במקומו מחושב מדד סנטימנט מקומי שקוף מ-VIX/רוחב/מרווחי אשראי/מומנטום).

## 2. מיפוי נתון → ספקים לפי עדיפות

| נתון | 1 | 2 | 3 | הערות |
|---|---|---|---|---|
| מחירים יומיים | Twelve Data | Tiingo | FMP / Alpha Vantage | ת"א: EODHD בלבד; Stooq חסום |
| מחיר אחרון / שינוי יומי | Finnhub quote | סגירה אחרונה מ-Stooq (מסומן "סגירה") | | |
| פרופיל חברה (ענף, מדינה, שווי שוק) | FMP | Finnhub | Alpha Vantage OVERVIEW | |
| דוחות (Revenue, NI, EPS, FCF, חוב, מזומן) היסטוריים | **EDGAR** | FMP statements | | EDGAR = point-in-time |
| יחסים (P/E, PEG, EV/EBITDA, ROE…) | מחושב ב-engine מ-EDGAR+מחיר | FMP ratios | AV OVERVIEW | ערך מחושב מסומן `derived` |
| תחזיות EPS/Revenue | FMP analyst-estimates | AV OVERVIEW (Forward PE בלבד) | | |
| קונצנזוס אנליסטים (ספירה) | Finnhub recommendation | AV OVERVIEW | FMP | |
| יעדי מחיר | FMP price-target-consensus | AV OVERVIEW (ממוצע בלבד) | | Finnhub — בתשלום |
| חדשות | Finnhub company-news | AV NEWS_SENTIMENT | EDGAR 8-K (אירוע ראשוני) | dedup ב-engine/news.js |
| Insider | Finnhub | AV INSIDER_TRANSACTIONS | EDGAR Form 4 (submissions) | |
| ETF holdings | AV ETF_PROFILE | FMP etf-holdings | | flows — לא זמין חינם |
| Earnings date | Finnhub earnings calendar | AV EARNINGS | | |
| מאקרו/ריבית/אינפלציה/אג"ח/VIX/HY spread | FRED | | | |
| USD/ILS | בנק ישראל | FRED DEXISUS | | |
| Short interest, 13F | — | | | Missing Data (FINRA/EDGAR 13F — שלב 2) |
| Screening | FMP screener | universe סטטי (engine/universe.js) + AV TOP_GAINERS_LOSERS | | |

## 3. תקציב יומי (חינם) — כמה המערכת צורכת

| ספק | מכסה | שימוש cron יומי (universe של ~80 נכסים) | הערה |
|---|---|---|---|
| Stooq | — | 80 (מחירים) + 8 מדדים | פעם ביום |
| Finnhub | 86,400/יום | ~80 quote + ~80 news + ~40 recommendation + ~20 earnings | הרבה מתחת למכסה |
| FMP | 250 | ~1 screener + ~30 profile/ratios (פונדמנטלס מרוענן פעם בשבוע, מסובב) | `budget.js` עוצר ב-230 |
| Alpha Vantage | 25 | ~5 ETF_PROFILE + ~10 NEWS_SENTIMENT + ~5 OVERVIEW (סבב שבועי) | `budget.js` עוצר ב-24 |
| EDGAR | 864k | ~80 companyfacts (אחת לשבוע לכל נכס) + submissions | |
| FRED | — | ~12 סדרות | |

## 4. איכות נתונים (`quality`)

- `1.0` — מקור ראשוני רשמי (EDGAR, FRED, BOI) או Finnhub quote בזמן מסחר.
- `0.8` — ספק מסחרי מוסדר (FMP, AV, Finnhub) עם `asOf` ≤ יום מסחר אחד.
- `0.6` — Stooq / נתון נגזר (derived) / `asOf` בן 2–7 ימים.
- `0.3` — stale מעל 7 ימים (מוצג באזהרה, לא נכנס לציון כשיש חלופה).
- `0` — missing.

`confidence` של ציון/סיגנל = ממוצע משוקלל של `quality` הרכיבים × כיסוי הרכיבים.
