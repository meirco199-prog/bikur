# חיבור הסוכן לחשבון הדמה של IBKR (הגשר)

מצב **מראה (mirror)**: הסימולציה הפנימית (`invest/docs/AUTONOMOUS_AGENT.md`) ממשיכה להחליט ולמלא בעצמה; הגשר שולח את אותן פקודות
לחשבון הדמה (Paper) של IBKR ומדווח חזרה מילויים, יתרה ופוזיציות. ה-Worker משווה מילוי-מול-מילוי (`/agent/broker`).
זה ניסוי מדידה, לא מצב live: אין כסף אמיתי, המדיניות לא משתנה, והגשר **מסרב** לעבוד מול חשבון שאינו דמה (מזהה שלא מתחיל ב-`DU`).

## למה צריך גשר בכלל

IBKR לא מאפשרים לתוכנה בענן להתחבר ישירות לחשבון. ה-API שלהם (Client Portal Web API) עובד רק דרך **Gateway** — תוכנת Java קטנה
שרצה על מחשב, ומישהו נכנס בה פעם אחת בדפדפן עם משתמש הדמה ומאשר ב-IB Key. אחרי זה הגשר שלנו מדבר עם ה-Gateway על אותו מחשב.
לכן צריך מחשב שדולק בשעות המסחר בניו יורק (16:30–23:00 שעון ישראל): שרת קטן בענן, או המחשב הביתי.

## מה צריך (פעם אחת)

1. **חשבון דמה פעיל** ב-IBKR עם משתמש משלו (`invest/docs/AUTONOMOUS_AGENT.md#ibkr`), והרשאות מסחר שביקשת בחשבון האמיתי
   (מניות/ETF, אופציות, חוזים, מט"ח, קריפטו — הדמה יורש אותן).
2. **מחשב שדולק**: Ubuntu/Debian (שרת ענן זול) או Windows/Mac ביתי. נדרש Java 8+ ו-Node 22.
3. **סוד משותף** `BRIDGE_SECRET`: ערך אקראי ארוך שבעל הריפו מייצר ומזין **פעמיים** — ב-Cloudflare (Worker → Settings → Variables → Secret)
   ובקובץ הסביבה על המחשב של הגשר. אין לכתוב אותו בריפו או בצ'אט.

## התקנה על שרת לינוקס

```bash
sudo apt-get update && sudo apt-get install -y default-jre unzip git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
# Client Portal Gateway של IBKR (קישור רשמי: https://www.interactivebrokers.com/en/trading/ib-api.php → "Client Portal API")
mkdir -p ~/ibkr && cd ~/ibkr && curl -fsSL -o cpgw.zip https://download2.interactivebrokers.com/portal/clientportal.gw.zip && unzip -q cpgw.zip
git clone https://github.com/meirco199-prog/bikur.git ~/bikur
```

הפעלת ה-Gateway (נשאר רץ; מאזין ב-https://localhost:5000):

```bash
cd ~/ibkr && ./bin/run.sh root/conf.yaml
```

**התחברות פעם אחת**: מהמחשב שלך פותחים מנהרה `ssh -L 5000:localhost:5000 user@server` ואז בדפדפן `https://localhost:5000`
(אזהרת תעודה עצמית — לאשר), נכנסים עם **משתמש הדמה** ומאשרים ב-IB Key. הסשן חי כל עוד ה-Gateway רץ; הגשר שולח `tickle` כל דקה.
אחרי ~24 שעות IBKR מנתקים סשן — יש להתחבר שוב (הדוח ב-`/agent/broker` מראה `authenticated:false` וההתראה היומית תציין זאת).

קובץ סביבה `~/.bikur-bridge/env` (הרשאות `chmod 600`):

```
WORKER_URL=https://invest-api.meirco199.workers.dev
BRIDGE_SECRET=<הערך שהזנת ב-Cloudflare>
IBKR_GATEWAY=https://localhost:5000/v1/api
# IBKR_ACCOUNT=DU1234567   # לא חובה: ברירת המחדל = החשבון הראשון ב-Gateway
```

בדיקה והרצה:

```bash
cd ~/bikur && set -a && . ~/.bikur-bridge/env && set +a
node invest-api/scripts/ibkr-bridge.mjs --check      # מצב ה-Gateway וחשבונות
node invest-api/scripts/ibkr-bridge.mjs --once --dry-run   # מה היה נשלח, בלי לשלוח
node invest-api/scripts/ibkr-bridge.mjs              # לולאה: כל 60 שניות
```

שירות systemd (רץ אוטומטית אחרי אתחול): `/etc/systemd/system/bikur-bridge.service`

```
[Unit]
Description=bikur IBKR paper bridge
After=network-online.target
[Service]
User=<user>
WorkingDirectory=/home/<user>/bikur
EnvironmentFile=/home/<user>/.bikur-bridge/env
ExecStart=/usr/bin/node invest-api/scripts/ibkr-bridge.mjs
Restart=always
RestartSec=30
[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now bikur-bridge` · לוג: `journalctl -u bikur-bridge -f` · עדכון קוד: `cd ~/bikur && git pull && sudo systemctl restart bikur-bridge`.
ל-Gateway עצמו כדאי שירות דומה (`ExecStart=/home/<user>/ibkr/bin/run.sh root/conf.yaml`, `WorkingDirectory=/home/<user>/ibkr`).

## מה הגשר עושה בכל סבב (דקה)

1. `tickle` + בדיקת סשן. לא מחובר → מדווח ל-Worker ומחכה.
2. מוודא שהחשבון הוא דמה (`DU…`). אחרת עוצר.
3. מושך `GET /agent/broker/pending`: הפקודות שהסימולציה החליטה בסגירת הסשן הקודם + יציאות (עצירות/חיסולים) של היום האחרון.
4. **kill switch** דולק (`/agent/kill`) → מבטל פקודות פתוחות בדמה ולא שולח חדשות.
5. בחלון 09:31–15:50 שעון ניו יורק בלבד: לכל פקודה שטרם נשלחה — פותר `conid` (חוזה קרוב לחוזים עתידיים), ממיר לפקודת **שוק, DAY**,
   כמות **שלמה** למניות/ETF/חוזים (IBKR לא מקבל שורט חלקי; 260.43 → 260), 6 ספרות לקריפטו/מט"ח; `cOID` = `clientOrderId` של השער
   (אידמפוטנטי — אותה פקודה לא נשלחת פעמיים גם אחרי ריסטארט: מצב מקומי ב-`~/.bikur-bridge/state.json` + סימון ב-Worker).
6. **יציאות** (עצירה/חיסול) נשלחות רק אם הדמה באמת מחזיק את הפוזיציה, ובכמות המוחזקת לכל היותר: פוזיציה שהסימולציה פתחה
   **לפני** חיבור הגשר לא קיימת בדמה, ו"מכירה" שלה הייתה פותחת שורט. יציאה כזו נרשמת כדילוג (`skipped`) ומופיעה בדוח.
7. מדווח `POST /agent/broker/fills`: פקודות/מילויים שלנו (לפי `cOID`), יתרה (`netliquidation`, מזומן, נזילות עודפת), פוזיציות, שגיאות.

## מה רואים

- `GET /agent/broker` (ציבורי): מחובר/לא, החשבון, יתרת הדמה, פוזיציות, מילויים והשוואה לסימולציה: לכל פקודה `simPrice` מול `brokerPrice`
  ו-`slipPct` (חיובי = הברוקר יקר יותר לנו), סטטוס `filled/partial/missing`, ופקודות שיש בברוקר ולא בסימולציה (`extraBroker`).
- הגשר מעתיק רק פקודות **חדשות** מהרגע שהתחבר (28/9). פוזיציות שהסימולציה פתחה לפני כן לא מועתקות אוטומטית — לכן הדמה
  יכול להיראות ריק בזמן שהסוכן באפליקציה מחזיק פוזיציות. **סנכרון חד-פעמי** (החלטת בעל הריפו 29/9: "כן"): פקודת ops
  `broker-sync <ts>` → `POST /agent/broker/sync` (סוד ה-cron בלבד) מצלמת את הפוזיציות הפתוחות של הסוכן כפקודות פתיחה לדמה
  (שוק, במחירי היום — לא במחירי הכניסה של הסימולציה); הגשר שולח אותן בחלון המסחר הבא, פעם אחת (מזהה `agent:sync:<יום>:<סימבול>:<צד>`),
  ומדלג אם הדמה כבר מחזיק. ההשוואה (`slipPct`) לפקודות האלה היא מול הסימון האחרון בסימולציה. `broker-sync <ts> off` מבטל בקשה שטרם נשלחה.
  הדוח `/agent/broker` מציג `sync: {total, sent, skipped}`.
- `sizeRatio`: יחס גודל הדמה (מיליון $ כברירת מחדל) לסימולציה (66 אלף $). כדי שההשוואה תהיה הוגנת אפשר לאפס את הדמה לסכום דומה:
  כניסה עם **משתמש הדמה** (לא האמיתי) → Settings → Reset Paper Trading Account. בעל הריפו איפס ל-66,000$ ב-29/9 (בתוקף מיום המסחר הבא).
  בזמן הכניסה של בעל הריפו לדמה כדאי לעצור את הגשר (`bridge-install` action=stop, אחר כך restart) — אחרת הם מנתקים זה את זה.
- **יומן עסקאות למאיר** (בקשתו 29/9): הבדיקה היומית (Routine של Claude, אחרי חלון השליחה) מדווחת בצ'אט על כל עסקה בדמה — מה נקנה/נמכר,
  כמה כסף, למה (האסטרטגיה והראיות מההחלטה), תוצאה מצטברת לכל פוזיציה, ודעת ChatGPT.
- **ChatGPT מעורב בכל עסקה**: הסקירה היומית שלו (`council-chatgpt.yml`, בוקר, גם ביום שני) מקבלת את `agent/broker` ואת הפקודות הממתינות,
  ופותחת בכותרת "עסקאות הדמה — דעת ChatGPT": מסכים/לא מסכים לכל פקודה ממתינה, והערות על הפוזיציות הפתוחות. דעה שנייה בלבד — לא עוצרת פקודות.

## מה עדיין לא (בכוונה)

- **לא** מצב live ולא מסחר בכסף אמיתי בגשר הזה (גשר חי נפרד, כבוי כברירת מחדל: `invest/docs/LIVE_BRIDGE.md`): דורש `approval` חתום על hash המדיניות (`engine/order-gate.js`) והחלטה מתועדת (AI_COUNCIL).
- **לא** מילוי לפי הברוקר: הסימולציה עדיין המקור לאמת. אחרי 10–15 ימי השוואה (החלקה, מילויים חסרים, margin בפועל) נדון אם לעבור
  ל-"מקור אמת = דמה" — זה שינוי ארכיטקטורה שמאיר מחליט עליו.
- **לא** נתוני שוק חיים מ-IBKR: המחירים לסימולציה ממשיכים מ-Twelve Data. הדמה ממלא לפי המחיר שלו (מעוכב או חי לפי מנוי החשבון).
- אופציות: אין עדיין ביקום הסוכן.

## אבטחה

- אין סיסמאות בשום מקום בקוד: ההתחברות ל-Gateway ידנית בדפדפן עם IB Key. הגשר יודע רק לדבר עם `localhost:5000`.
- `BRIDGE_SECRET` מאשר רק שני מסלולים (`pending` לקריאה, `fills` לכתיבת דיווח). הוא לא מאפשר להריץ את הסוכן, לשנות מדיניות או לכבות kill switch.
- הגשר עוצר אם החשבון אינו `DU…` (דמה), ואין עקיפה במשתנה סביבה (`scripts/paper-guard.mjs`, נבדק ב-`tests/paper-guard.test.mjs`). מסחר בחשבון אמיתי הוא החלטה נפרדת של בעל הריפו (approval עם hash ב-`order-gate.js`), לא משהו שהגשר הזה עושה.
- `NODE_TLS_REJECT_UNAUTHORIZED=0` מופעל אוטומטית רק כשה-Gateway הוא `localhost` (תעודה עצמית). לא לכוון את הגשר ל-Gateway מרוחק.

## אופציות (קנייה בלבד, החלטת בעל הריפו 8/10)

הסוכן קונה call/put על ETF (פרופיל aggressive; `engine/options.js`). הגשר משקף אותן לדמה כפקודות **LMT** על חוזה אמיתי:
1. הסימבול הפנימי `<UNDER>-<YYYYMMDD>-<C|P>-<strike>` → conid של הבסיס (STK) → `GET /iserver/secdef/strikes` → `GET /iserver/secdef/info` ובחירה לפי תאריך הפקיעה המדויק (info מחזיר גם שבועיות). strike שאינו נסחר → הקרוב ביותר עד 1.5% (נרשם ביומן הגשר), אחרת דילוג.
2. ציטוט `GET /iserver/marketdata/snapshot` (קריאה ראשונה "מחממת", השנייה עם נתונים). **קנייה ב-ask, מכירה ב-bid.** קנייה שה-ask שלה גבוה ממחיר המודל ביותר מ-40% נדחית; אין ציטוט → הפקודה לא מסומנת כנשלחה וינוסה בסבב הבא.
3. תקרה קשיחה: פרמיה של פקודת קנייה אחת ≤ 15,000$ (`OPTION_MAX_NOTIONAL_USD`). רק `DU…` (`paper-guard.mjs`).
4. יציאות (`stop` על 50% פרמיה, `option-exit` לפני פקיעה) נשלחות רק אם הדמה מחזיק את החוזה (אותו כלל כמו בשאר המכשירים), ב-bid.
5. **המחיר בסימולציה הוא Black-Scholes** והמילוי בדמה הוא ציטוט אמיתי — ההפרש מופיע ב-`reconcile.avgSlipPct` ואינו "טעות", אלא מדידה של דיוק המודל.
בדיקות: `tests/ibkr.test.mjs`, `tests/options.test.mjs`. בדיקות קריאה בלבד מול החשבון: ops `options` ו-`optprobe` ב-`bridge-install.yml`.
