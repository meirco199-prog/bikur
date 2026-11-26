#!/usr/bin/env bash
# רץ על השרת של בעל הריפו דרך SSH מתוך trader.yml, אחרי שורת export של הסודות. מתקין את עוזר המסחר (invest/docs/TRADER.md):
# שירות systemd ‏bikur-trader (קריאה בלבד), Caddy עם HTTPS אוטומטי לכתובת <ip>.sslip.io, ושולח למאיר בטלגרם את קישור הגישה.
# סודות נשמרים רק כאן: /etc/bikur-trader/trader.env (640 root:bridge). שום ערך (טוקן, כתובת) לא מודפס ללוג — הלוג של Actions ציבורי.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
say(){ printf '\n== %s\n' "$*"; }
: "${ALPACA_KEY_ID:?}" "${ALPACA_SECRET_KEY:?}" "${WORKER_URL:?}"
MASK='s/[0-9a-f]{32,}/***/g; s/U[0-9]{6,}/U***/g; s/[0-9]{1,3}(\.[0-9]{1,3}){3}/x.x.x.x/g'
send_link(){
  H=$(getent passwd bridge | cut -d: -f6); IP=$(curl -s4 --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}'); HOST="$(echo "$IP" | tr . -).sslip.io"
  TK=$(sudo -u bridge bash -c "cd '$H/bikur' && TRADER_DIR='$H/.bikur-trader' TRADER_PORT=8789 node invest-api/scripts/trader-assistant.mjs --link" | sed -n 's/^TOKEN=//p')
  BODY=$(python3 -c 'import json,sys; print(json.dumps({"text": "📈 עוזר המסחר מותקן. הקישור האישי שלך (אל תעביר אותו לאיש):\nhttps://"+sys.argv[1]+"/?k="+sys.argv[2]+"\nפתח אותו בטלפון ושמור למסך הבית."}))' "$HOST" "$TK")
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'content-type: application/json' --data "$BODY" "$WORKER_URL/notify?secret=$CRON_SECRET")
  echo "טלגרם: $code"; unset TK BODY
}
if [ "${LINK_ONLY:-0}" = "1" ]; then send_link; exit 0; fi

say "Node + משתמש + קוד"
apt-get update -qq >/dev/null; apt-get install -y -qq ca-certificates curl git >/dev/null
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1; apt-get install -y -qq nodejs >/dev/null; fi
id bridge >/dev/null 2>&1 || useradd -m -s /bin/bash bridge
H=$(getent passwd bridge | cut -d: -f6)
if [ -d "$H/bikur/.git" ]; then sudo -u bridge git -C "$H/bikur" pull -q; else sudo -u bridge git clone -q --depth 1 https://github.com/meirco199-prog/bikur.git "$H/bikur"; fi
sudo -u bridge git -C "$H/bikur" log --oneline -1

say "סודות (רק על השרת הזה)"
mkdir -p /etc/bikur-trader && chmod 750 /etc/bikur-trader && chown root:bridge /etc/bikur-trader
{
  printf 'ALPACA_KEY_ID=%s\nALPACA_SECRET_KEY=%s\nWORKER_URL=%s\nCRON_SECRET=%s\nTRADER_PORT=8787\n' "$ALPACA_KEY_ID" "$ALPACA_SECRET_KEY" "$WORKER_URL" "${CRON_SECRET:-}"
  for k in CO PR; do for v in TOKEN ACTIVITY TRADES; do n="IBKR_FLEX_${v}_${k}"; [ -n "${!n:-}" ] && printf '%s=%s\n' "$n" "${!n}"; done; done
} > /etc/bikur-trader/trader.env
chmod 640 /etc/bikur-trader/trader.env; chown root:bridge /etc/bikur-trader/trader.env
# מפתח פרטי להעברה השעתית מ-IBKR (נוצר פעם אחת, לא יוצא מהשרת); המפתח הציבורי לא סודי ומודפס כדי להגדיר את המשימה השעתית
PUB=$(cd "$H/bikur" && node invest-api/scripts/trader-push.mjs --keygen /etc/bikur-trader/push.key)
chmod 640 /etc/bikur-trader/push.key; chown root:bridge /etc/bikur-trader/push.key
echo 'TRADER_PUSH_KEY=/etc/bikur-trader/push.key' >> /etc/bikur-trader/trader.env
echo "מפתח ציבורי להעברה מ-IBKR (לא סודי): $PUB"
echo "חשבונות עם מפתח Flex: $(grep -c '^IBKR_FLEX_TOKEN_' /etc/bikur-trader/trader.env || true)"

say "שירות bikur-trader"
cat > /etc/systemd/system/bikur-trader.service <<UNIT
[Unit]
Description=bikur personal trading assistant (READ-ONLY: IBKR Flex + market data, no orders)
After=network-online.target
[Service]
User=bridge
WorkingDirectory=$H/bikur
EnvironmentFile=/etc/bikur-trader/trader.env
Environment=TRADER_DIR=$H/.bikur-trader
ExecStart=/usr/bin/node invest-api/scripts/trader-assistant.mjs
Restart=always
RestartSec=20
[Install]
WantedBy=multi-user.target
UNIT
mkdir -p "$H/.bikur-trader" && chown bridge:bridge "$H/.bikur-trader"
sudo -u bridge bash -c "set -a; . /etc/bikur-trader/trader.env; set +a; cd '$H/bikur' && TRADER_DIR='$H/.bikur-trader' TRADER_PORT=8788 node invest-api/scripts/trader-assistant.mjs --check" || { echo "⚠️ הבדיקה נכשלה (לוח המסחר של Alpaca) — השירות לא הופעל"; exit 1; }
systemctl daemon-reload && systemctl enable -q bikur-trader && systemctl restart bikur-trader

say "HTTPS (Caddy, אישור אוטומטי)"
IP=$(curl -s4 --max-time 10 https://api.ipify.org || hostname -I | awk '{print $1}')
HOST="$(echo "$IP" | tr . -).sslip.io"
command -v caddy >/dev/null || apt-get install -y -qq caddy >/dev/null
printf '%s {\n  encode gzip\n  reverse_proxy 127.0.0.1:8787\n}\n' "$HOST" > /etc/caddy/Caddyfile
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; fi
systemctl enable -q caddy && systemctl restart caddy
sleep 8; systemctl is-active bikur-trader caddy | paste -sd' '
journalctl -u bikur-trader -n 6 --no-pager | sed -E "$MASK"

say "קישור הגישה — נשלח בטלגרם בלבד"
if [ -n "${CRON_SECRET:-}" ]; then send_link; fi
