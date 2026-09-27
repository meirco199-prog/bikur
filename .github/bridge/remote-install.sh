#!/usr/bin/env bash
# רץ על השרת של בעל הריפו דרך SSH מתוך bridge-install.yml (stdin: 'bash -s'), אחרי שורת export של IB_USER/IB_PASS/BRIDGE_SECRET/WORKER_URL.
# מתקין Docker+Node+git, IBeam (IBKR Client Portal Gateway עם התחברות אוטומטית לחשבון הדמה) ואת הגשר כשירות. ראה invest/docs/IBKR_BRIDGE.md
# אושר ע"י בעל הריפו (27/9: "תתקין לבד") — הרשאות ב-.claude/settings.json.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
say(){ printf '\n== %s\n' "$*"; }
: "${IB_USER:?}" "${IB_PASS:?}" "${BRIDGE_SECRET:?}" "${WORKER_URL:?}"

say "חבילות"
apt-get update -qq >/dev/null; apt-get install -y -qq ca-certificates curl git ufw >/dev/null
command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh >/dev/null 2>&1
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1; apt-get install -y -qq nodejs >/dev/null; fi
id bridge >/dev/null 2>&1 || useradd -m -s /bin/bash bridge
H=$(getent passwd bridge | cut -d: -f6)

say "קבצי הגדרה (הרשאות 600, רק על השרת הזה)"
mkdir -p /etc/bikur-bridge && chmod 700 /etc/bikur-bridge
printf 'IBEAM_ACCOUNT=%s\nIBEAM_PASSWORD=%s\nIBEAM_GATEWAY_BASE_URL=https://localhost:5000\nIBEAM_LOG_LEVEL=INFO\n' "$IB_USER" "$IB_PASS" > /etc/bikur-bridge/ibeam.env
chmod 600 /etc/bikur-bridge/ibeam.env
printf 'WORKER_URL=%s\nBRIDGE_SECRET=%s\nIBKR_GATEWAY=https://localhost:5000/v1/api\nINTERVAL_SEC=60\n' "$WORKER_URL" "$BRIDGE_SECRET" > /etc/bikur-bridge/bridge.env
chmod 640 /etc/bikur-bridge/bridge.env; chown root:bridge /etc/bikur-bridge/bridge.env
unset IB_PASS BRIDGE_SECRET

say "קוד הגשר"
if [ -d "$H/bikur/.git" ]; then sudo -u bridge git -C "$H/bikur" pull -q; else sudo -u bridge git clone -q --depth 1 https://github.com/meirco199-prog/bikur.git "$H/bikur"; fi

say "IBeam: Gateway + התחברות אוטומטית לדמה (מאזין ל-localhost:5000 בלבד)"
docker pull -q voyz/ibeam:latest >/dev/null
docker rm -f ibeam >/dev/null 2>&1 || true
docker run -d --name ibeam --env-file /etc/bikur-bridge/ibeam.env -p 127.0.0.1:5000:5000 --restart unless-stopped voyz/ibeam:latest >/dev/null

say "שירות הגשר"
cat > /etc/systemd/system/bikur-bridge.service <<EOF
[Unit]
Description=bikur IBKR paper bridge (mirror mode)
After=network-online.target docker.service
[Service]
User=bridge
WorkingDirectory=$H/bikur
EnvironmentFile=/etc/bikur-bridge/bridge.env
ExecStart=/usr/bin/node invest-api/scripts/ibkr-bridge.mjs
Restart=always
RestartSec=30
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable -q --now bikur-bridge && systemctl restart bikur-bridge

say "חומת אש: רק SSH פתוח"
ufw --force reset >/dev/null; ufw default deny incoming >/dev/null; ufw default allow outgoing >/dev/null; ufw allow OpenSSH >/dev/null; ufw --force enable >/dev/null

say "ממתין להתחברות ל-IBKR (עד 3 דקות)"
ok=""; for i in $(seq 1 36); do sleep 5; if curl -sk -X POST https://localhost:5000/v1/api/iserver/auth/status 2>/dev/null | grep -q '"authenticated":true'; then ok=1; break; fi; done
if [ -n "$ok" ]; then echo "✅ ה-Gateway מחובר לחשבון הדמה"; else echo "⚠️ עדיין לא מחובר. לוג IBeam (בלי סיסמאות):"; docker logs --tail 30 ibeam 2>&1 | sed -E 's/(password|passwd)[^ ]*/[REDACTED]/Ig'; fi
systemctl is-active bikur-bridge | sed 's/^/bridge service: /'
