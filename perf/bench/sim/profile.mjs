// Aggregates a V8 .cpuprofile (node --cpu-prof) into self time per function, with the file and line of its frame.
//   node perf/bench/sim/profile.mjs perf/bench/sim/prof/<file>.cpuprofile [topN] [urlFilter]
import { readFileSync } from "node:fs";

const [, , path, topArg, filter] = process.argv;
const top = Number(topArg ?? 25);
const prof = JSON.parse(readFileSync(path, "utf8"));
const byId = new Map();
for (const n of prof.nodes) byId.set(n.id, n);
const self = new Map();
const samples = prof.samples ?? [];
const deltas = prof.timeDeltas ?? [];
for (let i = 0; i < samples.length; i++) {
  const n = byId.get(samples[i]);
  if (!n) continue;
  const cf = n.callFrame;
  if (filter && !(cf.url ?? "").includes(filter)) continue;
  const key = `${cf.functionName || "(anonymous)"} ${(cf.url ?? "").replace(/^.*[\\/](src|perf)[\\/]/, "$1/")}:${cf.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + (deltas[i] ?? 0));
}
const total = [...self.values()].reduce((a, b) => a + b, 0);
const rows = [...self].sort((a, b) => b[1] - a[1]).slice(0, top);
console.log(`sampled ${(total / 1000).toFixed(0)} ms of ${filter ?? "all code"} (${samples.length} samples)`);
console.log("| self ms | share | function |");
console.log("| --- | --- | --- |");
for (const [k, us] of rows) console.log(`| ${(us / 1000).toFixed(1)} | ${((us / total) * 100).toFixed(1)} % | ${k} |`);
