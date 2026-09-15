# סכימת נתונים — DATABASE_SCHEMA.md

מימוש: **Cloudflare KV** (namespace `invest`). לכל מפתח מתועד המבנה, ה-TTL
ומדיניות הדריסה. סעיף 3 נותן סכימת SQL שקולה ל-D1/Postgres — אותה סכימה
לוגית, למקרה של הגירה. הכלל החשוב ביותר: **snapshots הם append-only.**

## 1. מפתחות KV

### 1.1 נתוני שוק (מטמון ספקים, ניתן לרענון)

| מפתח | ערך | TTL | דריסה |
|---|---|---|---|
| `px:{SYM}` | `{symbol, currency, source, asOf, fetchedAt, quality, rows:[[date,o,h,l,c,v]…]}` ממוין עולה; עד 25 שנים | 20h | כן (מיזוג: שורות חדשות נוספות, ישנות לא נמחקות) |
| `quote:{SYM}` | `{price, change, changePct, high, low, open, prevClose, asOf, source, quality}` | 15m | כן |
| `profile:{SYM}` | `{name, exchange, type: stock/etf/fund/index/bond, sector, industry, country, currency, marketCap, sharesOut, description, source, asOf}` | 7d | כן |
| `facts:{SYM}` | EDGAR מנורמל: `{cik, series:{Revenue:[{end, val, filed, form, fy, fp}], NetIncome:[…], EPSDiluted, OCF, Capex, Cash, LongTermDebt, TotalDebt, Equity, Shares, EBIT, DA, Dividends}}` | 7d | כן (מיזוג) |
| `ratios:{SYM}` | יחסים מספק (FMP/AV): `{pe, fwdPe, peg, ps, evEbitda, roe, roic, margins…, source, asOf, quality}` | 7d | כן |
| `est:{SYM}` | תחזיות אנליסטים: `{eps:{fy1,fy2}, revenue:{fy1,fy2}, source, asOf}` | 7d | כן |
| `analyst:{SYM}` | `{strongBuy, buy, hold, sell, strongSell, total, period, targets:{avg, median, high, low, n}, changes:[…], source, asOf}` | 24h | כן — **וגם** נכתב ל-`hist:analyst:{SYM}:{YYYY-MM}` (append) |
| `news:{SYM}` | `[{id, title, url, publisher, publishedAt, summary, sentiment:{score, label, method}, events:[…], cluster:{size, sources:[…]}, primary:bool}]` עד 60 אחרונים | 6h | מיזוג לפי id; פריטים לא נמחקים 90 יום |
| `insider:{SYM}` | `[{name, role, type: buy/sell, shares, price, date, filedAt, source}]` | 24h | מיזוג |
| `etf:{SYM}` | `{holdings:[{symbol, name, weight}], sectors:[…], expense, aum, source, asOf}` | 7d | כן |
| `earn:{SYM}` | `{next: date|null, last:[{date, epsActual, epsEst, surprisePct}], source, asOf}` | 24h | כן |
| `macro:{SERIES}` | `{series, title, units, rows:[[date, value]…], source:'FRED', asOf}` | 12h | מיזוג |
| `fx:USDILS` | `{rate, asOf, source:'BOI'/'FRED', rows:[[date, rate]…]}` | 12h | מיזוג |

### 1.2 תוצרי המודל (append-only — "מה המערכת ידעה/המליצה בתאריך X")

| מפתח | ערך | דריסה |
|---|---|---|
| `snap:{YYYY-MM-DD}:{SYM}` | `{date, symbol, price, score:{total, components:{fundamental:{value, weight, reasons[]}, …}, coverage, confidence, weightsVersion}, signal:{label, entryZone, invalidation, stop, targets, upside, downside, rr, horizon, confidence, why[], noSignalReason?}, tech:{…}, risk:{…}, dataAsOf:{prices, facts, news, analyst}}` | **לעולם לא** (`putIfAbsent`) |
| `rank:{YYYY-MM-DD}` | `{date, universeSize, categories:{bestOverall:[sym…], bestValue, bestGrowth, bestMomentum, bestEtf, lowestRisk, breakout, oversold, avoid}, table:[{symbol, score, signal, …}]}` | לעולם לא |
| `regime:{YYYY-MM-DD}` | `{date, risk:'RiskOn'/'Neutral'/'RiskOff', trend:'Bull'/'Correction'/'Bear', rules:[{id, passed, value, threshold, desc}], inputs:{spx, ndq, rut, vix, dgs10, dgs2, hy, usdils…}, fearGreed:{value, components}}` | לעולם לא |
| `reco:{YYYY-MM-DD}` | `{date, size, profiles:{conservative:{positions:[{symbol, weight, ils, currency, sector, country}], risk:{vol, maxDD, beta}, exposure:{sector, geo, currency}}, balanced, growth, aggressive}, constraints, method}` | לעולם לא |
| `alerts:log:{YYYY-MM-DD}` | `[{id, ts, ruleId, symbol, type, what, why, changed, channels:{telegram:ok/err, email, browser}, dedupKey}]` | append |
| `hist:analyst:{SYM}:{YYYY-MM}` | snapshot חודשי של קונצנזוס | append |
| `idx:snapdays` | רשימת ימים שיש להם snapshots (לניווט As-Of) | append |

### 1.3 נתוני משתמש

| מפתח | ערך |
|---|---|
| `user:settings` | `{weights:{…}, portfolioSize:200000, baseCurrency:'ILS', maxPosition, maxSector, alertChannels, tz}` |
| `user:watchlist` | `[{symbol, addedAt, note, tags[]}]` |
| `user:alerts:rules` | `[{id, symbol|'*', type, params, channels[], cooldownH, enabled, createdAt}]` |
| `alerts:state:{dedupKey}` | `{lastSentAt}` — למניעת spam (TTL = cooldown) |
| `paper:trades` | `[{id, symbol, side, qty, price, date, reason, signalAtEntry, snapDate, exitPrice?, exitDate?, exitReason?, pnl?, pnlPct?}]` |
| `paper:equity` | `[[date, equity, benchmark]…]` — עקומת הון יומית (append ב-cron) |

### 1.4 תפעול

| מפתח | ערך |
|---|---|
| `meta:universe` | `[{symbol, name, type, exchange, sector, country, currency, origin:'seed'/'screener'/'watchlist', addedAt}]` |
| `budget:{provider}:{YYYY-MM-DD}` | מונה קריאות (TTL 48h) |
| `log:err` | טבעת 200 שגיאות `[{ts, where, msg}]` |
| `cron:last` | `{startedAt, finishedAt, ok, symbolsDone, errors}` |
| `rl:{ip}:{minute}` | מונה rate-limit (TTL 2m) |

## 2. עקרונות

1. **Append-only לתוצרי מודל** — `db.putIfAbsent` מסרב לכתוב אם המפתח קיים. תיקון באג במודל לא משכתב עבר; הוא יוצר `weightsVersion` חדש וה-UI מציג באיזו גרסה חושב כל snapshot.
2. **מקור + חותמת לכל בלוק** — אין ערך בלי `source` ו-`asOf`. ה-UI מציג "עודכן: …" ליד כל בלוק.
3. **מיזוג ולא החלפה** למחירים/חדשות/עובדות: שורות ישנות לא נעלמות כשספק מחזיר טווח קצר.
4. **מכסת כתיבות (Workers Free: 1,000 KV put/יום — נמדד בפועל 15.9.2026)**: כל המונים במפתח `budget:{day}` אחד עם flush בסוף בקשה; `cron:state` נכתב רק כשיש שינוי; בעיבוד היומי לא נמשכים quote וחדשות לנכסים שאינם ברשימת המעקב. אומדן יומי: ~120 snapshots + ~117 מחירים + ~60 cron + ~30 מונים + ~20 דוחות/חדשות ≈ 350. `/health` מציג `kvWriteLimitHit` אם KV דחה כתיבה.
5. **מגבלת KV**: ערך ≤ 25MB — `px` של 25 שנים ≈ 6,300 שורות ≈ 350KB. חדשות מוגבלות ל-60 פריטים.
5. **Eventual consistency**: KV עלול להחזיר גרסה ישנה עד ~60 שניות; קריטי רק לכתיבות משתמש — הלקוח מציג אופטימית ומאמת.

## 3. סכימה SQL שקולה (ל-D1/Postgres בעתיד)

```sql
CREATE TABLE assets (symbol TEXT PRIMARY KEY, name TEXT, type TEXT, exchange TEXT, sector TEXT,
  industry TEXT, country TEXT, currency TEXT, origin TEXT, added_at TEXT);
CREATE TABLE prices (symbol TEXT, date TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL,
  source TEXT, fetched_at TEXT, PRIMARY KEY(symbol, date));
CREATE TABLE facts (symbol TEXT, metric TEXT, period_end TEXT, value REAL, filed TEXT, form TEXT,
  fy INTEGER, fp TEXT, source TEXT, PRIMARY KEY(symbol, metric, period_end, filed));
CREATE TABLE ratios (symbol TEXT, as_of TEXT, payload TEXT, source TEXT, quality REAL, PRIMARY KEY(symbol, as_of));
CREATE TABLE analyst (symbol TEXT, as_of TEXT, strong_buy INT, buy INT, hold INT, sell INT, strong_sell INT,
  target_avg REAL, target_median REAL, target_high REAL, target_low REAL, target_n INT, source TEXT, PRIMARY KEY(symbol, as_of));
CREATE TABLE news (id TEXT PRIMARY KEY, symbol TEXT, title TEXT, url TEXT, publisher TEXT, published_at TEXT,
  sentiment REAL, events TEXT, cluster_size INT, primary_src INTEGER, source TEXT);
CREATE TABLE macro (series TEXT, date TEXT, value REAL, source TEXT, PRIMARY KEY(series, date));
CREATE TABLE snapshots (date TEXT, symbol TEXT, price REAL, score REAL, signal TEXT, confidence REAL,
  weights_version TEXT, payload TEXT, PRIMARY KEY(date, symbol));           -- INSERT OR IGNORE only
CREATE TABLE rankings (date TEXT PRIMARY KEY, payload TEXT);
CREATE TABLE regimes  (date TEXT PRIMARY KEY, risk TEXT, trend TEXT, payload TEXT);
CREATE TABLE recommendations (date TEXT PRIMARY KEY, size REAL, payload TEXT);
CREATE TABLE alerts_log (id TEXT PRIMARY KEY, ts TEXT, rule_id TEXT, symbol TEXT, type TEXT, what TEXT, why TEXT,
  changed TEXT, channels TEXT, dedup_key TEXT);
CREATE TABLE alert_rules (id TEXT PRIMARY KEY, symbol TEXT, type TEXT, params TEXT, channels TEXT, cooldown_h INT, enabled INT);
CREATE TABLE watchlist (symbol TEXT PRIMARY KEY, added_at TEXT, note TEXT, tags TEXT);
CREATE TABLE paper_trades (id TEXT PRIMARY KEY, symbol TEXT, side TEXT, qty REAL, price REAL, date TEXT, reason TEXT,
  signal_at_entry TEXT, snap_date TEXT, exit_price REAL, exit_date TEXT, exit_reason TEXT, pnl REAL, pnl_pct REAL);
CREATE TABLE paper_equity (date TEXT PRIMARY KEY, equity REAL, benchmark REAL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX idx_snapshots_symbol ON snapshots(symbol, date);
CREATE INDEX idx_news_symbol ON news(symbol, published_at);
```
