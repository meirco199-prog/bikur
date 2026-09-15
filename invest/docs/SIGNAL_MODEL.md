# מודל הציון והסיגנל — SIGNAL_MODEL.md

מימוש: `invest-api/engine/scoring.js`, `engine/signals.js`. הציון מחושב **בקוד בלבד**
מתוך נתונים; ה-LLM לעולם לא נוגע בו. כל רכיב מחזיר `{value 0-100, weight, reasons[], missing?}`
כך שה-UI יכול להציג "למה בדיוק" לכל נקודה.

## 1. עשרה רכיבים ומשקלים (ניתנים לשינוי ב-`user:settings.weights`)

| רכיב | משקל ברירת מחדל | מקורות | מה נמדד |
|---|---|---|---|
| Fundamental | 12 | EDGAR / FMP | רווחיות ומצב מאזן נוכחי |
| Valuation | 15 | מחושב + FMP/AV | זול/יקר מול היסטוריה, עמיתים וטווח Fair Value |
| Growth | 12 | EDGAR / FMP estimates | צמיחת הכנסות/EPS בפועל + תחזית |
| Quality | 10 | EDGAR | יציבות, ROIC, המרת רווח למזומן, מינוף |
| Technical | 12 | מחירים | מבנה מגמה, מיקום מול ממוצעים, תמיכה/התנגדות |
| Momentum | 10 | מחירים | תשואות 1/3/6/12 חודשים מותאמות סיכון, RSI, MACD |
| Analyst | 8 | Finnhub / FMP / AV | קונצנזוס + upside ליעד + כיוון שינויים |
| Sentiment | 6 | חדשות (AV/Finnhub) | סנטימנט משוקלל למקור ראשוני, אירועים מהותיים |
| Macro | 7 | regime | התאמת הנכס למשטר השוק הנוכחי |
| Risk | 8 | מחירים + פונדמנטלס | תנודתיות, drawdown, בטא, נזילות, gap, מינוף, earnings קרוב |
| **סה"כ** | **100** | | |

`weightsVersion` = hash של המשקלים — נשמר בכל snapshot.

### כיסוי וביטחון
- רכיב חסר → `missing`. המשקלים מנורמלים מחדש על הרכיבים הזמינים.
- `coverage` = סכום משקלי הרכיבים הזמינים / 100.
- אם `coverage < 0.5` או Technical חסר → **NO SIGNAL** (מוצג ציון חלקי בלבד, עם סימון).
- `confidence` = coverage × ממוצע משוקלל של `quality` הנתונים (0–1) → "נמוך" <0.5, "בינוני" <0.75, "גבוה".

## 2. נוסחאות הרכיבים

כל תת-מדד ממופה ל-0–100 בפונקציה חלקה `ramp(x, worst, best)` (ליניארי בין קצוות, חתוך).
רכיב = ממוצע של תת-מדדיו הזמינים (משקל שווה אלא אם צוין).

### 2.1 Fundamental (מצב נוכחי)
- Net margin: ramp(−10%, 25%)
- FCF margin (FCF/Revenue): ramp(−5%, 20%)
- ROE: ramp(0, 25%); ROIC: ramp(0, 20%)
- Net Debt/EBITDA: ramp(4, −1) (הפוך: מזומן נטו = 100)
- Interest coverage (EBIT/ריבית) כשקיים: ramp(1, 10)
- ל-ETF: אין פונדמנטלס → הרכיב מחושב מ-`expense ratio` (ramp 1%→0.03%) ו-AUM (ramp $50M→$5B) אם זמינים, אחרת missing.

### 2.2 Valuation
- P/E מול היסטוריית 5 שנים של החברה: percentile של ה-P/E הנוכחי בתוך ההיסטוריה → score = 100 − percentile.
- P/E מול ממוצע עמיתים (Finnhub peers / אותו sector ב-universe): ramp(+50% מעל, −40% מתחת).
- EV/EBITDA: ramp(25, 6). P/S: ramp(15, 1) (למניות צמיחה P/S>15 = 0).
- PEG: ramp(3, 0.8).
- FCF yield: ramp(0%, 8%).
- **Fair Value Range** (`engine/valuation.js`): שלוש שיטות, כל אחת מחזירה טווח:
  1. Multiples — EPS × טווח P/E היסטורי (percentile 25–75 של 5 שנים); Revenue/share × טווח P/S.
  2. DCF — FCF/share, צמיחה = min(צמיחת 3 שנים, 20%) דועכת ליניארית ל-3% ב-10 שנים, WACC = 10y + ERP 5% + βadj (8–12%), terminal 3%; טווח = WACC ±1%.
  3. Peer — EPS × חציון P/E עמיתים ±20%.
  Fair Value Range = [חציון תחתונים, חציון עליונים]. Margin of Safety = (FV_low − price)/price.
- MoS score: ramp(−30%, +30%).
- ל-ETF/מדד: Valuation = P/E של המדד מול ממוצע 10 שנים אם זמין (מ-FMP) אחרת missing.

### 2.3 Growth
- Revenue growth TTM YoY: ramp(−10%, 30%); 3Y CAGR: ramp(0, 25%)
- EPS growth TTM YoY: ramp(−20%, 40%)
- FCF growth 3Y: ramp(−10%, 30%)
- תחזית EPS FY2/FY1 − 1 (אם יש): ramp(−10%, 25%) — מסומן ESTIMATE
- קנס עקביות: אם ≥2 מתוך 4 השנים האחרונות ירידה בהכנסות → −15.

### 2.4 Quality
- ROIC ממוצע 3 שנים: ramp(0, 20%)
- Cash conversion (FCF/Net Income) : ramp(0.3, 1.2)
- Gross margin stability (סטיית תקן 5 שנים): ramp(8pp, 1pp)
- Net Debt/Equity: ramp(1.5, 0)
- Dilution (צמיחת מניות 3Y): ramp(+5%/שנה, −2%/שנה)
- Dividend growth 5Y (אם משלמת): ramp(0, 10%) — משקל חצי

### 2.5 Technical (מבנה, לא אות בודד)
- מיקום מול SMA: +25 לכל אחד מ-SMA50/100/200 שהמחיר מעליו, +25 אם SMA50>SMA200 → 0–100 ("trend score")
- מרחק מ-52w high: ramp(−40%, −3%) (קרוב לשיא = חזק; מעל −3% לא מוסיף)
- Bollinger %B: ניטרלי 0.2–0.8 = 70; <0 = 40 (oversold — לא אוטומטית טוב); >1 = 45
- ATR% (ATR14/מחיר): ramp(6%, 1.5%) — תנודתיות גבוהה מורידה
- מחיר מעל התנגדות 20 ימים עם RelVol>1.5 (breakout) → +15 בונוס (חתוך ל-100)
- זיהוי אירועים (מדווחים ב-`events`, לא משנים ציון לבד): Golden/Death Cross (חיתוך SMA50/200 ב-10 ימים האחרונים), Overbought (RSI>70), Oversold (RSI<30), Volume breakout (RelVol>2 ו-|שינוי|>2%), Trend reversal (חיתוך מחיר/SMA50 עם MACD histogram מחליף סימן), Momentum accel/decel (שיפוע MACD histogram 5 ימים).

### 2.6 Momentum
- 12-1 momentum (תשואה 12 חודשים ללא החודש האחרון): ramp(−30%, +60%)
- 6M: ramp(−25%, +40%); 3M: ramp(−15%, +25%); 1M: ramp(−12%, +15%) (משקל חצי)
- Risk-adjusted: תשואה 6M / vol 6M: ramp(−1, 2)
- RSI14: 45–65 = 80; 30–45 = 55; 65–75 = 60; >75 = 35; <30 = 40
- MACD histogram > 0 ועולה: +10

### 2.7 Analyst
- ציון קונצנזוס: (5·SB + 4·B + 3·H + 2·S + 1·SS)/N → ramp(2, 4.5)
- Upside ליעד חציוני: ramp(−20%, +40%)
- קנס ביטחון: N<5 → הרכיב ×0.6 (מסומן "מדגם קטן")
- שינוי בחודש האחרון (SB+B עלה/ירד): ±10
- **מסומן תמיד ANALYST OPINION.**

### 2.8 Sentiment
- ציון = ממוצע משוקלל של סנטימנט ידיעות 14 ימים (משקל = weight מקור × dcay(גיל)); מקור ראשוני (EDGAR 8-K, הודעת חברה, Reuters/AP/Bloomberg/WSJ/FT) = 1.0, אחר = 0.5, אגרגטור = 0.3
- כפילויות: אשכול ידיעות דומות (Jaccard כותרות ≥0.6 או אותו URL קנוני) נספר פעם אחת בעוצמת המקור הטוב ביותר.
- אירועים: earnings beat +, miss −, guidance raise/cut ±, upgrade/downgrade ±, lawsuit/regulatory −, acquisition (target) +, product launch + קטן.
- score = 50 + 50·sentiment (sentiment ב-[−1,1]); אם <3 ידיעות ב-30 יום → missing.

### 2.9 Macro (התאמה למשטר)
- Risk On: מניות צמיחה/בטא>1 = 75, defensives = 55, אג"ח ארוך = 45
- Neutral: כולם 55–60
- Risk Off: defensives/אג"ח ממשלתי/זהב = 75, בטא>1.3 = 30, אחרים 45
- מודיפייר עקום תשואות הפוך (T10Y2Y<0): בנקים/small caps −10; USD/ILS: אם ILS מתחזק 5%+ ב-3 חודשים — נכסי USD −5 למשקיע שקלי (נזכר גם ב-Risk).

### 2.10 Risk (גבוה = בטוח)
- Vol שנתי: ramp(60%, 15%); Max DD שנה: ramp(−60%, −10%); Beta: ramp(2, 0.7)
- נזילות (מחזור $ יומי ממוצע 20 ימים): ramp($2M, $50M)
- Gap risk: שיעור ימים עם |gap|>5% בשנה: ramp(5%, 0%)
- Earnings בתוך 7 ימים: −15
- Net Debt/EBITDA>4 או FCF שלילי 2 שנים: −15
- מטבע: לנכס USD עבור משקיע ILS — −5 (מדווח, לא מעניש קשה)

## 3. מציון לסיגנל (`engine/signals.js`)

תנאים מצטברים — כולם גלויים ב-`why[]`:

| סיגנל | תנאי |
|---|---|
| **STRONG BUY** | score ≥ 75, confidence ≥ 0.6, Technical ≥ 55, Risk ≥ 40, MoS ≥ 10% (או ל-ETF: Momentum ≥ 60), regime ≠ RiskOff-Bear |
| **BUY** | score ≥ 65, confidence ≥ 0.5, Technical ≥ 45, Risk ≥ 30 |
| **WATCH** | score ≥ 55 או (score ≥ 50 ו-oversold ו-Fundamental ≥ 60) |
| **HOLD** | 40 ≤ score < 55 |
| **REDUCE** | score < 40 או (Risk < 25 ו-Technical < 40) או Death Cross טרי עם Momentum < 40 |
| **SELL** | score < 30 או (מחיר < invalidation ו-Momentum < 35) |
| **NO SIGNAL** | coverage < 0.5, או אין מחירים 200 ימים, או confidence < 0.35 |

הסבר "WHY?": 5 סיבות בעד = 5 תת-המדדים הטובים ביותר; 5 סיכונים = 5 הגרועים + אירועי סיכון; "מה ישנה את ההמלצה" = לכל תנאי בטבלה, המרחק ממנו; "נתונים שעלולים לסתור" = רכיבים חסרים/stale/ESTIMATE/ANALYST OPINION.

### רמות
- **Entry Zone**: [max(support20, SMA50·0.98) … min(price·1.02, SMA20·1.03)] כשהמגמה חיובית; ב-oversold: [low20 … SMA20]. אם המחיר מעל הטווח — "המתן לחזרה".
- **Invalidation**: min(support50, SMA200·0.97) ל-BUY; מחיר סגירה מתחתיו = התזה נשברה.
- **Stop**: max(invalidation, price − 2.5·ATR14). Trailing: 3·ATR מהשיא מאז הכניסה.
- **Target Range**: [min(FV_low, resistance52w) … FV_high]; ל-ETF: מחיר·(1+ תשואת מומנטום 12M ×0.5) ±ATR.
- Upside = target_mid/price − 1; Downside = stop/price − 1; R/R = Upside/|Downside|. R/R < 1.5 → הסיגנל יורד דרגה אחת (מדווח).
- **Time Horizon**: STRONG BUY/BUY עם Valuation דומיננטי = 6–18 חודשים; מומנטום דומיננטי = 1–4 חודשים; ETF = 12+ חודשים.

## 4. מה הציון **לא** עושה
- לא מבטיח תשואה; הוא דירוג יחסי בתוך universe נתון.
- לא מייצר תחזית מחיר; Fair Value הוא טווח מודל.
- לא מתעדכן רטרואקטיבית: snapshot של יום X נשאר כפי שחושב ביום X.
