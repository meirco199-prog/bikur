#!/usr/bin/env bash
# בדיקה לקריאה בלבד: האם חשבון הדמה של IBKR מוכן לאופציות? (סוגי הנכסים המותרים בחשבון + האם יש שרשרת אופציות ל-SPY).
# רץ על השרת מול ה-Client Portal Gateway ב-localhost. לא שולח פקודות, לא משנה כלום, לא מדפיס סיסמאות.
set +e
B=https://localhost:5000/v1/api
echo "=== סטטוס התחברות"
curl -sk -X POST "$B/iserver/auth/status" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("authenticated:", d.get("authenticated"), "connected:", d.get("connected"))' 2>&1
echo "=== סוגי נכסים מותרים בחשבון (allowedAssetTypes)"
curl -sk "$B/iserver/accounts" | python3 -c '
import json, sys
d = json.load(sys.stdin)
f = d.get("allowFeatures") or {}
print("allowedAssetTypes:", f.get("allowedAssetTypes"))
print("allowCrypto:", f.get("allowCrypto"), "· allowFXConv:", f.get("allowFXConv"))
print("accounts:", [a for a in (d.get("accounts") or [])][:3])
' 2>&1
echo "=== SPY: האם קיימת שרשרת אופציות (section OPT)"
curl -sk -X POST -H 'Content-Type: application/json' -d '{"symbol":"SPY","name":false,"secType":"STK"}' "$B/iserver/secdef/search" | python3 -c '
import json, sys
d = json.load(sys.stdin)
d = d if isinstance(d, list) else []
for r in d[:3]:
    secs = [s.get("secType") for s in (r.get("sections") or [])]
    print(r.get("symbol"), r.get("conid"), "sections:", secs, "· OPT:", "OPT" in secs)
if not d:
    print("אין תשובה מ-secdef/search")
' 2>&1
true
