#!/usr/bin/env bash
# בדיקה לקריאה בלבד: האם אפשר לפתור חוזה אופציה בחשבון הדמה, לקבל ציטוט, ומה ה-margin של פקודה (what-if, לא נשלחת).
# רץ על השרת מול ה-Client Portal Gateway ב-localhost. **לא שולח פקודה.** לא מדפיס סיסמאות.
set +e
B=https://localhost:5000/v1/api
J='Content-Type: application/json'
ACCT=$(curl -sk "$B/iserver/accounts" | python3 -c 'import json,sys; d=json.load(sys.stdin); a=d.get("accounts") or []; print(a[0] if a else "")' 2>/dev/null)
echo "חשבון: $ACCT"
UND=${UND:-USO}   # הבדיקה של 9/10: למה USO C 147.5 לפקיעה 20/11 לא נמצא
echo "=== 1. secdef/search $UND"
S=$(curl -sk -X POST -H "$J" -d "{\"symbol\":\"$UND\",\"name\":false,\"secType\":\"STK\"}" "$B/iserver/secdef/search")
CONID=$(echo "$S" | python3 -c '
import json,sys
d=json.load(sys.stdin)
for r in d:
    secs=[s.get("secType") for s in (r.get("sections") or [])]
    if "OPT" in secs:
        mo=[s for s in r["sections"] if s.get("secType")=="OPT"][0]
        print(r["conid"], mo.get("months","")); break
' 2>/dev/null)
echo "conid+months: $CONID"
UC=$(echo "$CONID" | cut -d' ' -f1); MONTHS=$(echo "$CONID" | cut -d' ' -f2-)
MONTH=${MONTH:-NOV26}
echo "=== 2. strikes ($MONTH)"
ST=$(curl -sk "$B/iserver/secdef/strikes?conid=$UC&sectype=OPT&month=$MONTH")
echo "$ST" | python3 -c '
import json,sys
d=json.load(sys.stdin); c=d.get("call") or []; p=d.get("put") or []
print("calls:", len(c), "puts:", len(p), "דוגמה:", c[len(c)//2-2:len(c)//2+2])
' 2>&1 | head -5
PX=$(curl -sk "$B/iserver/marketdata/snapshot?conids=$UC&fields=31" >/dev/null; sleep 2; curl -sk "$B/iserver/marketdata/snapshot?conids=$UC&fields=31" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d[0].get("31","") if d else "")' 2>/dev/null)
echo "מחיר $UND (field 31): $PX"
STRIKE=$(echo "$ST" | python3 -c '
import json,sys
px=float("'"${PX//[^0-9.]/}"'" or 0)
d=json.load(sys.stdin); c=d.get("call") or []
print(min(c,key=lambda k:abs(k-px)) if c and px else (c[len(c)//2] if c else ""))
' 2>/dev/null)
echo "strike נבחר: $STRIKE"
echo "=== 3. secdef/info (call ATM)"
I=$(curl -sk "$B/iserver/secdef/info?conid=$UC&sectype=OPT&month=$MONTH&right=C&strike=$STRIKE&exchange=SMART")
echo "$I" | python3 -c '
import json,sys
d=json.load(sys.stdin)
d=d if isinstance(d,list) else [d]
print("חוזים שחזרו:", len(d), "· פקיעות:", sorted({str(r.get("maturityDate")) for r in d}))
for r in d[:4]: print({k:r.get(k) for k in ("conid","symbol","secType","right","strike","maturityDate","multiplier","exchange","desc2")})
' 2>&1 | head -5
OC=$(echo "$I" | python3 -c 'import json,sys; d=json.load(sys.stdin); d=d if isinstance(d,list) else [d]; print(d[0].get("conid","") if d else "")' 2>/dev/null)
echo "conid האופציה: $OC"
[ -n "$OC" ] || { echo "לא נמצא חוזה — מפסיקים"; exit 0; }
echo "=== 4. ציטוט (bid=84 ask=86 last=31 · 6509=זמינות נתונים)"
curl -sk "$B/iserver/marketdata/snapshot?conids=$OC&fields=31,84,86,6509" >/dev/null; sleep 3
curl -sk "$B/iserver/marketdata/snapshot?conids=$OC&fields=31,84,86,6509" | python3 -c '
import json,sys
d=json.load(sys.stdin)
r=d[0] if d else {}
print({k:r.get(k) for k in ("31","84","86","6509")})
' 2>&1 | head -3
echo "=== 5. what-if: BUY 1 LMT (לא נשלח)"
curl -sk -X POST -H "$J" -d "{\"orders\":[{\"conid\":$OC,\"secType\":\"$OC:OPT\",\"orderType\":\"LMT\",\"price\":1.0,\"side\":\"BUY\",\"quantity\":1,\"tif\":\"DAY\"}]}" "$B/iserver/account/$ACCT/orders/whatif" | python3 -c '
import json,sys
d=json.load(sys.stdin)
def pick(x): return {k:(x.get(k) or {}).get("amount") if isinstance(x.get(k),dict) else x.get(k) for k in ("amount","equity","initial","maintenance","position")}
print(pick(d) if isinstance(d,dict) else d)
print("error:", d.get("error") if isinstance(d,dict) else None)
' 2>&1 | head -4
true
