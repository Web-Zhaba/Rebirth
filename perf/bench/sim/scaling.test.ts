// Scaling of the worker sim: how the tick and its phases grow with buildings, road edges and residents.
// Two sweeps, each built through the real handler + commands (lib.ts):
//   A) buildings 50 / 200 / 500 / 1000 / 2000, every city grown for the same number of game days;
//   B) residents: 500 buildings, grown for 0 / 20 / 40 / 80 / 160 game days.
//
//   npx vitest run perf/bench/sim/scaling.test.ts --reporter=verbose
//   SIM_SIZES=50,200,500,1000 SIM_GROW=10 npx vitest run perf/bench/sim/scaling.test.ts --reporter=verbose
import { it, expect } from "vitest";
import { makeCity, median, pct, ms, table, timeIt } from "./lib";
import { BASE_TICK } from "../../../src/sim/clock";
import { toSnapshot } from "../../../src/sim/handler";
import { produceStep } from "../../../src/sim/production";
import { productionScales, dailyStep, rebalanceJobs } from "../../../src/sim/people";
import { refreshServices } from "../../../src/sim/coverage";
import type { SimState } from "../../../src/sim/types";

const SIZES = (process.env.SIM_SIZES ?? "50,200,500,1000,2000").split(",").map(Number);
const GROW = Number(process.env.SIM_GROW ?? 10); // game days every city of sweep A is grown for
const TICKS = Number(process.env.SIM_TICKS ?? 96);
const POP_DAYS = (process.env.SIM_POP_DAYS ?? "0,20,40,80,160").split(",").map(Number);
const cold = (s: SimState): SimState => ({ ...s, buildings: { ...s.buildings }, residents: { ...s.residents }, households: { ...s.households }, roads: { ...s.roads } });
const t = (fn: () => unknown, reps = 5) => median(timeIt(fn, reps));

interface Row {
  buildings: number;
  houses: number;
  pop: number;
  households: number;
  edges: number;
  tick: number;
  snap: number;
  prod: number;
  rebal: number;
  cov: number;
  daily: number;
}

async function measure(o: { buildings: number; growDays: number }): Promise<Row> {
  const city = await makeCity({ buildings: o.buildings, growDays: o.growDays, settlersPerDay: 2 });
  city.tick(30); // warm-up: JIT and caches
  const c = city.counts();
  const samples: number[] = [];
  for (let i = 0; i < TICKS; i++) {
    const t0 = performance.now();
    city.tick(1);
    samples.push(performance.now() - t0);
  }
  return {
    buildings: c.buildings,
    houses: c.houses,
    pop: c.residents,
    households: c.households,
    edges: c.edges,
    tick: median(samples),
    snap: t(() => toSnapshot(city.sim()), 7),
    prod: t(() => produceStep(cold(city.sim()), BASE_TICK / 60, productionScales(cold(city.sim()))), 5),
    rebal: t(() => rebalanceJobs(cold(city.sim())), 3),
    cov: t(() => refreshServices(cold(city.sim())), 5),
    daily: t(() => dailyStep(cold(city.sim())), 3),
  };
}

it("scaling with buildings and residents", async () => {
  console.log(`## A. the same grown town (${GROW} game days), more buildings\n`);
  const rows: (string | number)[][] = [];
  const raw: Row[] = [];
  const p95: number[] = [];
  for (const size of SIZES) {
    const r = await measure({ buildings: size, growDays: GROW });
    raw.push(r);
    rows.push([size, r.buildings, r.houses, r.pop, r.households, r.edges, ms(r.tick), ms(r.snap), ms(r.prod), ms(r.rebal), ms(r.cov), ms(r.daily)]);
    p95.push(r.tick);
  }
  console.log(table(["asked", "buildings", "houses", "residents", "households", "edges", "tick median", "toSnapshot", "produceStep", "rebalanceJobs", "refreshServices", "dailyStep"], rows));
  console.log("\n## A2. per-unit cost (flat = linear, rising = superlinear)\n");
  const base = raw[0];
  const per: (string | number)[][] = raw.map((r) => [
    r.buildings,
    r.households,
    r.edges,
    `${((r.tick / r.buildings) * 1000).toFixed(2)} µs/building`,
    r.pop > 0 ? `${((r.tick / r.pop) * 1000).toFixed(2)} µs/resident` : "—",
    `×${(r.tick / base.tick).toFixed(1)}`,
    `×${(r.rebal / Math.max(base.rebal, 1e-6)).toFixed(1)} rebalanceJobs`,
    `×${(r.cov / Math.max(base.cov, 1e-6)).toFixed(1)} refreshServices`,
    `×${(r.snap / Math.max(base.snap, 1e-6)).toFixed(1)} toSnapshot`,
  ]);
  console.log(table(["buildings", "households", "edges", "tick", "tick", "tick vs smallest", "vs smallest", "vs smallest", "vs smallest"], per));

  console.log("\n## B. 500 buildings, grown for more game days (more residents and households)\n");
  const bRows: (string | number)[][] = [];
  const bRaw: Row[] = [];
  for (const days of POP_DAYS) {
    const r = await measure({ buildings: 500, growDays: days });
    bRaw.push(r);
    bRows.push([days, r.pop, r.households, r.buildings, r.edges, ms(r.tick), ms(r.snap), ms(r.prod), ms(r.rebal), ms(r.daily)]);
  }
  console.log(table(["days grown", "residents", "households", "buildings", "edges", "tick median", "toSnapshot", "produceStep", "rebalanceJobs", "dailyStep"], bRows));
  const b0 = bRaw[0];
  console.log("\n## B2. per-resident cost\n");
  console.log(
    table(
      ["residents", "tick", "tick/resident", "rebalanceJobs", "rebalanceJobs/resident", "dailyStep"],
      bRaw.map((r) => [r.pop, ms(r.tick), `${((r.tick / Math.max(r.pop, 1)) * 1000).toFixed(2)} µs`, ms(r.rebal), `${((r.rebal / Math.max(r.pop, 1)) * 1000).toFixed(2)} µs`, ms(r.daily)]),
    ),
  );

  expect(raw.length).toBe(SIZES.length);
  expect(bRaw.length).toBe(POP_DAYS.length);
  expect(raw[raw.length - 1].tick).toBeGreaterThan(raw[0].tick); // a bigger town costs more
  if (bRaw.length > 1) expect(b0.tick).toBeGreaterThan(0);
  void p95;
}, 900_000);
