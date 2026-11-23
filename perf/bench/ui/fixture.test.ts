// Prints the town the other benchmarks measure (builds it if perf/bench/ui/.fixture.json is missing) and checks that it
// looks like a real save.
// Run: npx vitest run perf/bench/ui/fixture.test.ts --reporter=verbose
import { expect, it } from "vitest";
import { loadFixture } from "./fixture";

it("fixture: a town shaped like a mid-game save", async () => {
  const t0 = performance.now();
  const f = await loadFixture();
  const ms = performance.now() - t0;
  const meta = f.meta as Record<string, number | Record<string, number>>;
  console.log(`fixture ready in ${Math.round(ms)} ms (the town itself is cached in .fixture.json after the first run)`);
  console.log("buildings", meta.buildings, "active", meta.active, "residents", meta.residents, "road edges", meta.edges, "fields", meta.fields, "digs", meta.digs);
  console.log("chronicle", meta.chronicle, "history rows", meta.historyRows, "techs", meta.techs, "zones cells", meta.cells);
  console.log("finds", meta.finds, "articles", f.state.articles.length);
  console.log("snapshot bytes as JSON", meta.bytes, "; snapshot messages kept for the replay:", f.deltas.length);
  console.log("commands the town's builder could not place:", (meta as unknown as { failures: string[] }).failures.length);
  expect(Number(meta.buildings)).toBeGreaterThan(200);
  expect(Number(meta.residents)).toBeGreaterThan(100);
}, 300000);
