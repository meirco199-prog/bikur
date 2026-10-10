#!/usr/bin/env bash
# התקנת הגשר לחשבון האמיתי על השרת של בעל הריפו (דרך bridge-install.yml, action=live-install). **מתקין במצב כבוי**: אין LIVE_APPROVAL/LIVE_ARMED_UNTIL,
# לכן הגשר רק קורא ומדווח. הפעלה = action=live-arm שבעל הריפו מריץ בעצמו עם hash המגבלות. מדריך: invest/docs/LIVE_BRIDGE.md
# stdin: שורת export של IB_USER/IB_PASS/BRIDGE_SECRET/WORKER_URL/LIVE_ACCOUNT (הסיסמה לא נכתבת לריפו/ללוג; נשמרת רק בקבצים 600 על השרת).
set -euo pipefail
say(){ printf '\n== %s\n' "$*"; }
: "${IB_USER:?}" "${IB_PASS:?}" "${BRIDGE_SECRET:?}" "${WORKER_URL:?}" "${LIVE_ACCOUNT:?}"
case "$LIVE_ACCOUNT" in U[0-9][0-9][0-9][0-9][0-9]*) ;; *) echo "LIVE_ACCOUNT חייב להיות חשבון אמיתי (U…), לא דמה"; exit 1;; esac
command -v docker >/dev/null && command -v node >/dev/null && id bridge >/dev/null 2>&1 || { echo "הגשר לדמה לא מותקן — הרץ קודם action=install"; exit 1; }
H=$(getent passwd bridge | cut -d: -f6)

say "זיכרון פנוי (Gateway שני = Java+Chrome נוספים; שרת 2GB עלול לא להספיק)"
free -m | sed -n 1,3p
AVAIL=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
if [ "$AVAIL" -lt 700 ]; then echo "⚠️ פנוי ${AVAIL}MB בלבד — Gateway שני עלול להיהרג ב-OOM ולהפיל גם את גשר הדמה. שקול שרת גדול יותר. ממשיך בכל זאת (אפשר action=live-stop)"; fi

say "קבצי הגדרה (600, רק על השרת)"
mkdir -p /etc/bikur-bridge && chmod 700 /etc/bikur-bridge
printf 'IBEAM_ACCOUNT=%s\nIBEAM_PASSWORD=%s\nIBEAM_GATEWAY_BASE_URL=https://localhost:5000\nIBEAM_GATEWAY_STARTUP=90\nIBEAM_LOG_LEVEL=INFO\n' "$IB_USER" "$IB_PASS" > /etc/bikur-bridge/ibeam-live.env
chmod 600 /etc/bikur-bridge/ibeam-live.env
# live.env: כבוי — אין LIVE_APPROVAL ואין LIVE_ARMED_UNTIL. live-arm מוסיף אותם; live-disarm מסיר
printf 'WORKER_URL=%s\nBRIDGE_SECRET=%s\nIBKR_LIVE_GATEWAY=https://localhost:5001/v1/api\nLIVE_ACCOUNT=%s\nINTERVAL_SEC=60\n' "$WORKER_URL" "$BRIDGE_SECRET" "$LIVE_ACCOUNT" > /etc/bikur-bridge/live.env
chmod 640 /etc/bikur-bridge/live.env; chown root:bridge /etc/bikur-bridge/live.env
unset IB_PASS BRIDGE_SECRET

say "קוד הגשר"
sudo -u bridge git -C "$H/bikur" pull -q

say "IBeam חי: Gateway נפרד על localhost:5001 (פנימי 5000), כניסה לחשבון האמיתי"
docker pull -q voyz/ibeam:latest >/dev/null
docker rm -f ibeam-live >/dev/null 2>&1 || true
docker run -d --name ibeam-live --env-file /etc/bikur-bridge/ibeam-live.env -p 127.0.0.1:5001:5000 --restart unless-stopped voyz/ibeam:latest >/dev/null

say "שירות הגשר החי"
cat > /etc/systemd/system/bikur-live-bridge.service <<EOF
[Unit]
Description=bikur IBKR LIVE bridge (disarmed unless live.env carries a valid approval)
After=network-online.target docker.service
[Service]
User=bridge
WorkingDirectory=$H/bikur
EnvironmentFile=/etc/bikur-bridge/live.env
ExecStart=/usr/bin/node invest-api/scripts/ibkr-live-bridge.mjs
Restart=always
RestartSec=30
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable -q --now bikur-live-bridge && systemctl restart bikur-live-bridge

say "ממתין להתחברות (עד 3 דקות). חשבון אמיתי דורש אישור IB Key בטלפון — אשר כשההתראה מגיעה"
ok=""; for i in $(seq 1 36); do sleep 5; if curl -sk -X POST https://localhost:5001/v1/api/iserver/auth/status 2>/dev/null | grep -q '"authenticated":true'; then ok=1; break; fi; done
if [ -n "$ok" ]; then echo "✅ ה-Gateway החי מחובר"; else echo "⚠️ עדיין לא מחובר (ייתכן שממתין לאישור IB Key). לוג IBeam (בלי סיסמאות):"; docker logs --tail 30 ibeam-live 2>&1 | sed -E 's/(password|passwd)[^ ]*/[REDACTED]/Ig'; fi
systemctl is-active bikur-live-bridge | sed 's/^/live bridge service: /'
echo "מצב: כבוי (disarmed) — לא נשלחות פקודות עד live-arm"
