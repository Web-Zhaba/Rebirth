// Per-test-file durations from the json reporter of one full `npx vitest run`.
// Run: node perf/bench/coldstart/top-files.mjs [perf/bench/coldstart/vitest.json]
import { readFileSync } from "node:fs";
const r = JSON.parse(readFileSync(process.argv[2] ?? "perf/bench/coldstart/vitest.json", "utf8"));
const files = r.testResults.map((f) => ({
  path: f.name.replace(/^.*Rebirth[\/]/, "").replaceAll("\\", "/"),
  ms: (f.endTime - f.startTime),
  tests: f.assertionResults.length,
  cpu: (f.assertionResults.reduce((a, t) => a + (t.duration ?? 0), 0)),
}));
files.sort((a, b) => b.ms - a.ms);
console.log(`files: ${files.length}  wall(ms, reporter): ${r.startTime ? "-" : "-"}`);
console.log("  file ms  (sum of test ms)   tests  path");
for (const f of files.slice(0, 15)) console.log(`${String(f.ms).padStart(7)}  (${String(Math.round(f.cpu)).padStart(6)})       ${String(f.tests).padStart(4)}  ${f.path}`);
const bench = files.filter((f) => f.path.startsWith("perf/"));
console.log(`\nperf/bench files swept into the default include: ${bench.length}`);
for (const f of bench) console.log(`  ${f.ms} ms  ${f.path}`);
const total = files.reduce((a, f) => a + f.ms, 0);
console.log(`\nsum of per-file ms: ${total} (files run in parallel; compare with the wall time)`);
