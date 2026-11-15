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
  curl -sS --fail -L --retry 3 "$URL" 2>"$P.curl.err" | gzip -dc 2>/dev/null | awk -F, -v S=$S -v T0=$T0 -v T5=$T5 -v E=$E -v P="$P" '
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
    }'
  echo "seconds=$(( $(date +%s) - t ))" >> "$P.meta"; echo "url=$URL" >> "$P.meta"
  echo "$M $DS: $(tr '\n' ' ' < "$P.meta")"
done
# trades (ביקורת בלבד): כל עסקאות אופציות BTC של היום
URL="https://datasets.tardis.dev/v1/deribit/trades/$Y/$MO/01/OPTIONS.csv.gz"; P="$OUT/$M/trades"
curl -sS --fail -L --retry 3 "$URL" 2>"$P.curl.err" | gzip -dc 2>/dev/null | awk -F, 'NR==1 || index($2,"BTC-")==1' | gzip > "$P.btc.csv.gz"
echo "$M trades: $(gzip -dc "$P.btc.csv.gz" | wc -l) rows (כולל כותרת)"
