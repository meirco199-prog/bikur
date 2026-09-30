#!/usr/bin/env bash
# בדיקות דפדפן (Playwright headless) מול mock של ה-Workers. דורש: node ≥ 22, `npm i playwright` (חד-פעמי, בתיקייה זו או גלובלית)
# וכרומיום של Playwright (או CHROMIUM=/path/to/chromium). מריצים מהשורש: english/tests/browser/run.sh
set -u
cd "$(dirname "$0")/../../.."
export SHOTS="${SHOTS:-/tmp/english-shots}"; mkdir -p "$SHOTS"
python3 -m http.server 8901 >/dev/null 2>&1 & STATIC=$!
trap 'kill $STATIC 2>/dev/null; kill $MOCK 2>/dev/null' EXIT
fail=0
run_mode(){ # $1 = LIVE_MODE, rest = tests
  local mode=$1; shift
  LIVE_MODE=$mode node english/tests/browser/mock-ai.mjs >/dev/null 2>&1 & MOCK=$!; sleep 1
  for t in "$@"; do
    echo "=== $t (LIVE_MODE=$mode)"
    out=$(timeout 300 node "english/tests/browser/$t" 2>&1); echo "$out" | grep -v "^OK\|OK$\|OK (" ; echo "$out" | grep -v ERR_TUNNEL_CONNECTION_FAILED | grep -q "FAIL" && fail=1
  done
  kill $MOCK 2>/dev/null; wait $MOCK 2>/dev/null
}
run_mode off course-test.mjs c1-test.mjs reminder-test.mjs fallback-test.mjs classroom-test.mjs barge-test.mjs memory-test.mjs
run_mode on realtime-test.mjs realtime-course-test.mjs
SDP_FAIL=1 run_mode on realtime-fail-test.mjs
[ $fail = 0 ] && echo "ALL BROWSER TESTS PASSED" || { echo "SOME BROWSER TESTS FAILED"; exit 1; }
