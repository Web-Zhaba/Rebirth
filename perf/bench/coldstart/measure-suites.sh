#!/bin/bash
# One full `npx vitest run` (wall time + per-file durations via the json reporter) and one `npm run pace`.
# Both are timed with date +%s%3N. Other agents share this machine's CPU, so absolute numbers are inflated;
# the numbers below are one run each, not a median.
cd "$(dirname "$0")/../../.." || exit 1
OUT=perf/bench/coldstart/raw-suites.txt
: > "$OUT"
now() { date +%s%3N; }

s=$(now)
npx vitest run --reporter=verbose --reporter=json --outputFile.json=perf/bench/coldstart/vitest.json \
  > perf/bench/coldstart/vitest-verbose.log 2>&1
rc=$?
e=$(now)
echo "vitest run (all) $((e-s)) ms exit=$rc" >> "$OUT"

s=$(now)
npm run pace > perf/bench/coldstart/pace.log 2>&1
rc=$?
e=$(now)
echo "npm run pace $((e-s)) ms exit=$rc" >> "$OUT"
echo DONE >> "$OUT"
