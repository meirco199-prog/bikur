#!/usr/bin/env bash
# שער הנתונים בלבד (PROTOCOL_v1.1 §3): הורדה בזרימה של קובצי הדגימה החינמיים של Tardis (היום הראשון בחודש, Deribit OPTIONS)
# וסינון אופציות BTC הפוכות (סימול שמתחיל ב-"BTC-") סביב 12:00–12:05 UTC. בלי מסחר, בלי Backtest, בלי מפתח.
# לכל מכשיר נשמרת השורה האחרונה עד 12:00 ועד 12:05 (לפי local_timestamp), ומספר העדכונים בחלון 11:55–12:10.
# הקובץ ממוין לפי local_timestamp, ולכן הזרימה נעצרת אחרי 12:10 (לא מורידים את שאר היום).
# שימוש: extract.sh YYYY-MM OUTDIR
set -uo pipefail
M="$1"; OUT="$2"; Y="${M%-*}"; MO="${M#*-}"; mkdir -p "$OUT/$M"
day0=$(date -u -d "$M-01T00:00:00Z" +%s)
S=$(( (day0 + 11*3600 + 55*60) * 1000000 )); T0=$(( (day0 + 12*3600) * 1000000 )); T5=$(( (day0 + 12*3600 + 5*60) * 1000000 )); E=$(( (day0 + 12*3600 + 10*60) * 1000000 ))
for DS in options_chain book_snapshot_25 quotes; do
  URL="https://datasets.tardis.dev/v1/deribit/$DS/$Y/$MO/01/OPTIONS.csv.gz"; P="$OUT/$M/$DS"
  t=$(date +%s)
  # הגנה מתקיעה: בשתי הריצות הראשונות (15/11) קובץ בודד (למשל 2024-12 quotes, 2025-09 ו-2026-09 book_snapshot_25) נתקע עד ביטול,
  # בעוד שכל השאר הסתיימו ב-1–3 דקות. לכן כל ניסיון נהרג בכוח אחרי 10 דקות (כל קבוצת התהליכים: curl, gzip, awk), עד 3 ניסיונות.
  # אם awk כבר הגיע ל-12:10 וכתב את הקבצים לפני שהצינור נתקע — הניסיון נחשב תקין.
  for try in 1 2 3; do
  rm -f "$P.meta"
  timeout -k 15 600 bash -c 'curl -sS --fail -L --connect-timeout 30 --speed-limit 20000 --speed-time 90 --max-time 600 "$0" 2>"$1.curl.err" | gzip -dc 2>/dev/null | awk -F, -v S=$2 -v T0=$3 -v T5=$4 -v E=$5 -v P="$1" '"'"'
    NR==1 { hdr=$0; next }
    { ts=$4+0; rows++; if (ts<prev) inv++; prev=ts }
    ts>E { done=1; exit }
    index($2,"BTC-")!=1 { next }
    { nb++; if (ts<=T0) a[$2]=$0; if (ts<=T5) b[$2]=$0; if (ts>=S) w[$2]++ }
    END {
      f1=P".t1200.csv"; f2=P".t1205.csv"; f3=P".win.csv"
      print hdr > f1; for (k in a) print a[k] > f1
      print hdr > f2; for (k in b) print b[k] > f2
      print "symbol,updates_1155_1210" > f3; for (k in w) print k","w[k] > f3
      printf "rows_read=%d\nrows_btc=%d\nreached_1210=%d\nlast_local_ts=%s\nts_inversions=%d\n", rows, nb, done, ts, inv > P".meta"
    }'"'"'' "$URL" "$P" "$S" "$T0" "$T5" "$E"
  echo "timeout_rc=$?" > "$P.rc"
  grep -qs "reached_1210=1" "$P.meta" && break
  echo "ניסיון $try נכשל ($(cat "$P.rc")): $(head -c 200 "$P.curl.err")"
  done
  [ -f "$P.meta" ] || echo "reached_1210=0" > "$P.meta"
  echo "attempts=$try" >> "$P.meta"
  echo "seconds=$(( $(date +%s) - t ))" >> "$P.meta"; echo "url=$URL" >> "$P.meta"
  echo "$M $DS: $(tr '\n' ' ' < "$P.meta")"
done
# trades (ביקורת בלבד): כל עסקאות אופציות BTC של היום
URL="https://datasets.tardis.dev/v1/deribit/trades/$Y/$MO/01/OPTIONS.csv.gz"; P="$OUT/$M/trades"
timeout -k 15 900 bash -c 'curl -sS --fail -L --connect-timeout 30 --speed-limit 20000 --speed-time 90 --max-time 880 "$0" 2>"$1.curl.err" | gzip -dc 2>/dev/null | awk -F, '"'"'NR==1 || index($2,"BTC-")==1'"'"' | gzip > "$1.btc.csv.gz"' "$URL" "$P" || echo "$M trades: נקטע ($?)"
echo "$M trades: $(gzip -dc "$P.btc.csv.gz" | wc -l) rows (כולל כותרת)"
