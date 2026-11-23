#!/bin/bash
# Wall-time measurement for the build: 1 warmup tsc, 3 measured tsc, 2 measured vite build.
# Wall time comes from date +%s%N (monotonic enough for multi-second work); CPU contention from
# parallel agents in this checkout is not controlled for and is reported alongside.
cd "$(dirname "$0")/../../.." || exit 1
OUT=perf/bench/coldstart/raw-times.txt
: > "$OUT"
now() { date +%s%3N; }

echo "# warmup tsc" >> "$OUT"
npx tsc --noEmit > perf/bench/coldstart/tsc-warmup.log 2>&1
echo "warmup tsc exit=$?" >> "$OUT"

for i in 1 2 3; do
  s=$(now); npx tsc --noEmit > perf/bench/coldstart/tsc-$i.log 2>&1; rc=$?; e=$(now)
  echo "tsc run$i $((e-s)) ms exit=$rc" >> "$OUT"
done

for i in 1 2; do
  s=$(now); rm -rf dist; npx vite build > perf/bench/coldstart/build-$i.log 2>&1; rc=$?; e=$(now)
  echo "vite build run$i $((e-s)) ms exit=$rc" >> "$OUT"
  du -sb dist >> "$OUT" 2>/dev/null
done
echo "DONE" >> "$OUT"
