// Where the sim's CPU time actually goes: an in-process V8 sampling profile (node:inspector) taken while the real
// Handler plays many game days on a town built through its commands (lib.ts).
//
//   npx vitest run perf/bench/sim/hotspots.test.ts --reporter=verbose
//   SIM_B=1000 SIM_DAYS=60 SIM_RUNS=30 npx vitest run perf/bench/sim/hotspots.test.ts --reporter=verbose
import { it, expect } from "vitest";
import { Session } from "node:inspector/promises";
import { makeCity, median, ms, table } from "./lib";

const SIZE = Number(process.env.SIM_B ?? 500);
const DAYS = Number(process.env.SIM_DAYS ?? 40);
const RUNS = Number(process.env.SIM_RUNS ?? 24); // game days profiled

interface CallFrame {
  functionName: string;
  url: string;
  lineNumber: number;
}
interface Profile {
  nodes: { id: number; callFrame: CallFrame }[];
  samples: number[];
  timeDeltas: number[];
}

const short = (u: string): string => {
  const m = /[\\/]src[\\/](.*)$/.exec(u);
  return m ? `src/${m[1].replace(/[?#].*$/, "")}` : (u.split("/").pop() ?? u);
};

it("hotspots inside the tick", async () => {
  const city = await makeCity({ buildings: SIZE, growDays: DAYS, settlersPerDay: 2 });
  city.tick(60);
  const c = city.counts();
  console.log(`town: ${c.buildings} buildings, ${c.residents} residents, ${c.households} households, ${c.edges} road edges`);

  const session = new Session();
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.setSamplingInterval", { interval: 100 }); // µs
  await session.post("Profiler.start");
  const t0 = performance.now();
  city.tick(RUNS * 144); // RUNS game days
  const wall = performance.now() - t0;
  const { profile } = (await session.post("Profiler.stop")) as { profile: Profile };
  session.disconnect();

  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map<string, number>();
  for (let i = 0; i < profile.samples.length; i++) {
    const n = byId.get(profile.samples[i]);
    if (!n) continue;
    const cf = n.callFrame;
    const key = `${cf.functionName || "(anonymous)"}|${short(cf.url)}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0));
  }
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const rows = [...self].sort((a, b) => b[1] - a[1]);
  console.log(`\nprofiled ${ms(wall)} ms of wall clock over ${RUNS} game days (${RUNS * 144} ticks); ${(total / 1000).toFixed(0)} ms sampled\n`);

  // everything, and then only the sim's own code (src/), which is what can be changed
  const show = (title: string, filter: (k: string) => boolean, n: number) => {
    const picked = rows.filter(([k]) => filter(k)).slice(0, n);
    const sum = picked.reduce((a, [, v]) => a + v, 0);
    console.log(`\n## ${title}\n`);
    console.log(table(["self ms", "share of the sim's src time", "function | src file:line"], picked.map(([k, v]) => [(v / 1000).toFixed(1), `${((v / total) * 100).toFixed(1)} %`, k.split("|").join(" | ")])));
    void sum;
  };
  show("top 260 self time, all code", () => true, 26);
  show("top 25 of the sim's own code (src/)", (k) => k.includes("|src/"), 25);
  const own = rows.filter(([k]) => k.includes("|src/")).reduce((a, [, v]) => a + v, 0);
  console.log(`\nsim's own code: ${((own / total) * 100).toFixed(1)} % of the sampled time; ${(((total - own) / total) * 100).toFixed(1)} % is V8, GC and the harness`);

  expect(city.counts().buildings).toBeGreaterThan(0);
  void median;

}, 900_000);
