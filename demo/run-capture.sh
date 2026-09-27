#!/bin/bash
# demo/run-capture.sh — capture every page in batches on a small machine.
# Restarts `next dev` between batches so the dev server's memory never grows
# past the sandbox limit. Resumable (demo/shots/manifest.json).
#   demo/run-capture.sh [batch_size] [script=capture.mjs]   e.g. demo/run-capture.sh 8 extract-regions.mjs
set -u
cd "$(dirname "$0")/.."
BATCH=${1:-10}
SCRIPT=${2:-capture.mjs}
TOOLS=${TOOLS:-/home/user/demo-tools}   # where playwright-core / pg / ws are installed
OUT=${OUT:-$PWD/demo/shots}
export CHROME=${CHROME:-/usr/bin/chromium}

# NOTE: `pgrep -f '^pattern'` (anchored) so the pattern never matches this script itself
kill_next() { pgrep -f "^next-server|/\.bin/next dev|^npm exec next" | xargs -r kill 2>/dev/null; sleep 2; }
kill_chrome() { pgrep -f "^/usr/bin/chromium" | xargs -r kill 2>/dev/null; }

start_next() {
  kill_next
  (NODE_OPTIONS=--max-old-space-size=600 setsid nohup npx next dev -p 3000 > /home/user/next.log 2>&1 < /dev/null &)
  for _ in $(seq 1 30); do curl -s -o /dev/null --max-time 5 http://localhost:3000/login && return 0; sleep 2; done
  return 1
}

cp demo/capture.mjs demo/extract-regions.mjs demo/explore-states.mjs "$TOOLS/"
for round in $(seq 1 40); do
  start_next || { echo "next dev did not come up"; exit 1; }
  echo "=== batch $round ==="
  (cd "$TOOLS" && timeout 900 node "$SCRIPT" --out "$OUT" --limit "$BATCH")
  rc=$?
  kill_chrome
  [ $rc -eq 0 ] && break          # all done
  [ $rc -ne 3 ] && echo "batch exited with $rc (retrying)"
done
kill_next
echo "capture finished"
