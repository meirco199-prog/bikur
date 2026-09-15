# כללי Backtesting — BACKTESTING_RULES.md

מימוש: `invest-api/engine/backtest.js`. רץ בדפדפן (CPU) על נתונים שה-Worker מספק.
**Backtest אינו תחזית.** כל מסך backtest נושא את הכיתוב הזה.

## 1. מניעת הטיות

| הטיה | כלל | איך נאכף בקוד |
|---|---|---|
| **Look-ahead** | בכל יום t משתמשים רק בברים ≤ t; ביצוע רק ב-**Open של t+1** | `simulate()` מחשב אינדיקטורים על `rows.slice(0, i+1)` (אינקרמנטלי), פקודה מבוצעת ב-`rows[i+1].open` |
| Look-ahead בפונדמנטלס | עובדה נכנסת רק מתאריך ההגשה `filed`, לא מתאריך סוף התקופה | `fundamentals.asOf(facts, date)` מסנן `filed ≤ date` |
| Data leakage | פרמטרים נבחרים על In-Sample בלבד; Out-of-Sample לא נוגע בבחירה | `walkForward()` מפצל, בוחר על IS, מודד על OOS בלבד |
| Survivorship | ה-universe נלקח מ-`meta:universe` כפי שנשמר בתאריך ההתחלה (כולל נכסים שנמחקו אחר כך אם קיימים); Backtest של נכס בודד מסומן "single asset — survivorship לא נשלל" | דגל `survivorshipNote` בתוצאה |
| Overfitting | אסור להריץ אופטימיזציה על כל ההיסטוריה ולהציג אותה כתוצאה; רק WF-OOS מוצג כ"תוצאה"; IS מוצג באפור עם הכיתוב "in-sample" | ה-UI מציג OOS ראשון |

## 2. עלויות
- עמלה: 0.10% לכל צד (ברירת מחדל; ניתן לשינוי). ברוקר ישראלי למניות חו"ל ≈ 0.08–0.2%.
- Slippage: 0.05% לכל צד + חצי מ-gap אם הביצוע ב-Open.
- ILS: תשואה מוצגת גם ב-ILS לפי USD/ILS יומי (FRED DEXISUS) כשמבוקש.

## 3. אסטרטגיות מובנות (כולן ניתנות לבדיקה, אותו מנוע)
1. **Signal strategy** — קנייה כשהסיגנל ≥ BUY, יציאה ב-SELL/REDUCE או stop/trailing. משתמש בציון מלא כשיש פונדמנטלס point-in-time (EDGAR), אחרת בציון Technical+Momentum+Risk בלבד (מסומן).
2. **Trend** — מעל SMA200 ו-SMA50>SMA200; יציאה מתחת SMA200.
3. **Momentum 12-1** — כניסה כשמומנטום 12-1 > 0 ו-RSI < 75; יציאה כשמומנטום < 0.
4. **Mean reversion** — RSI<30 ו-%B<0 ו-מעל SMA200 → קנייה; יציאה RSI>55 או 20 ימים.
5. **Buy & Hold** — ייחוס.

## 4. מדדים (`metrics()`)
CAGR, Total Return, Annualized Vol (√252), Sharpe (Rf = ממוצע DGS3MO/ FRED, או 0 אם חסר — מסומן), Sortino, Max Drawdown (+ משך), Win Rate, Profit Factor, Number of Trades, Exposure %, Avg trade, Best/Worst trade, Calmar. תמיד ליד Buy&Hold של אותו נכס ו-Benchmark (SPY / QQQ / IWM / AGG לפי סוג).

## 5. תקופות
Backtest מוצג לפחות על: 2007–2009 (משבר), 2010–2019 (שוק שור), 2020 (קורונה), 2022 (ריבית), 2023–היום. אם אין היסטוריה מספיקה — התקופה מסומנת "אין נתונים".

## 6. Walk-Forward
- חלונות: IS 3 שנים → OOS 1 שנה, גלגול שנתי (ניתן לשינוי).
- גריד פרמטרים קטן ומוגדר מראש (למשל SMA 150/200/250, RSI 25/30/35) — אין חיפוש חופשי.
- בחירה על IS לפי Sharpe בלבד; דיווח OOS משורשר = "תוצאת WF".
- מדד יציבות: פיזור הפרמטר הנבחר בין חלונות; אם הוא קופץ — אזהרת "לא יציב".

## 7. As-Of Mode (`/asof`)
- הקלט: תאריך D. המערכת מחשבת ציון+סיגנל+דירוג+תיק על נתונים ≤ D בלבד (מחירים, עובדות לפי `filed`, חדשות לפי `publishedAt`, מאקרו לפי תאריך התצפית). אנליסטים/סנטימנט-ספק: **missing** (אין point-in-time) → coverage יורד ומוצג.
- ההשוואה: תשואה בפועל 1/3/6/12 חודשים אחרי D לכל נכס ולתיק, מול benchmark. הכול מחושב ממחירים, ללא התאמות ידניות.
- אם ל-D יש snapshot אמיתי (`snap:D:*`), מוצג לצידו "מה נשמר בפועל" — הוכחה שהמודל לא שונה בדיעבד.
