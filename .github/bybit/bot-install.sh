#!/usr/bin/env bash
# רץ על השרת של בעל הריפו דרך SSH מתוך bybit-bot.yml (stdin: 'bash -s'), אחרי שורת export של BYBIT_KEY/BYBIT_SECRET/BRIDGE_SECRET/WORKER_URL.
# מתקין את בוט עמית לחשבון הדמו של Bybit כשירות systemd (bikur-bybit), תחת המשתמש bridge ומאותו עותק של הריפו כמו גשר IBKR.
# המפתחות נשמרים רק כאן: /etc/bikur-bybit/bot.env (640 root:bridge). פירוט: invest/docs/BYBIT_BOT.md
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
say(){ printf '\n== %s\n' "$*"; }
: "${BYBIT_KEY:?}" "${BYBIT_SECRET:?}" "${WORKER_URL:?}"

say "Node + משתמש + קוד"
apt-get update -qq >/dev/null; apt-get install -y -qq ca-certificates curl git >/dev/null
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1; apt-get install -y -qq nodejs >/dev/null; fi
id bridge >/dev/null 2>&1 || useradd -m -s /bin/bash bridge
H=$(getent passwd bridge | cut -d: -f6)
if [ -d "$H/bikur/.git" ]; then sudo -u bridge git -C "$H/bikur" pull -q; else sudo -u bridge git clone -q --depth 1 https://github.com/meirco199-prog/bikur.git "$H/bikur"; fi
sudo -u bridge git -C "$H/bikur" log --oneline -1

say "מפתחות (רק על השרת הזה)"
mkdir -p /etc/bikur-bybit && chmod 750 /etc/bikur-bybit && chown root:bridge /etc/bikur-bybit
printf 'BYBIT_DEMO_API_KEY=%s\nBYBIT_DEMO_API_SECRET=%s\nWORKER_URL=%s\nBRIDGE_SECRET=%s\n' "$BYBIT_KEY" "$BYBIT_SECRET" "$WORKER_URL" "${BRIDGE_SECRET:-}" > /etc/bikur-bybit/bot.env
chmod 640 /etc/bikur-bybit/bot.env; chown root:bridge /etc/bikur-bybit/bot.env
unset BYBIT_KEY BYBIT_SECRET BRIDGE_SECRET

say "שירותים: bikur-bybit (בוט 1, BTC, דקה) + bikur-bybit2 (בוט 2, ETH, 15 דקות)"
unit(){ # $1 שם השירות, $2 תיאור, $3 הסקריפט
cat > "/etc/systemd/system/$1.service" <<UNIT
[Unit]
Description=$2
After=network-online.target
[Service]
User=bridge
WorkingDirectory=$H/bikur
EnvironmentFile=/etc/bikur-bybit/bot.env
ExecStart=/usr/bin/node invest-api/scripts/$3
Restart=always
RestartSec=30
[Install]
WantedBy=multi-user.target
UNIT
}
unit bikur-bybit "bikur Amit bot 1 (Bybit DEMO account only, BTCUSDT)" bybit-amit-bot.mjs
unit bikur-bybit2 "bikur Amit bot 2 (Bybit DEMO account only, ETHUSDT 15m)" bybit-amit2-bot.mjs
mkdir -p "$H/.bikur-bybit" && chown bridge:bridge "$H/.bikur-bybit"
for s in bybit-amit-bot.mjs bybit-amit2-bot.mjs; do
  sudo -u bridge bash -c "set -a; . /etc/bikur-bybit/bot.env; set +a; cd '$H/bikur' && node invest-api/scripts/$s --check" || { echo "⚠️ בדיקת החיבור ל-Bybit נכשלה ($s) — השירותים לא הופעלו"; exit 1; }
done
systemctl daemon-reload && systemctl enable -q bikur-bybit bikur-bybit2 && systemctl restart bikur-bybit bikur-bybit2
sleep 8
for s in bikur-bybit bikur-bybit2; do systemctl is-active "$s" | sed "s/^/$s: /"; journalctl -u "$s" -n 8 --no-pager; done
