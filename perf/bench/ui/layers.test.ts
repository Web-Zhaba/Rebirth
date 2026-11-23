// What one snapshot costs the map layers: every computed of src/view/layers/ rebuilt from the snapshot the worker just
// posted, plus the old city (world data) they draw over.
// Run: npx vitest run perf/bench/ui/layers.test.ts --reporter=verbose
import { it } from "vitest";
import "./stubs"; // before anything that imports src/simClient
import type { ClientState } from "../../../src/sim/types";
import { applyDelta } from "../../../src/sim/delta";
import { median, time } from "./fixture";
import { loadFixture } from "./fixture";
import { client, setState } from "./signals";
import { oldWorld } from "../../../src/map/excavation";
import { typedFoundations, hintSpots } from "../../../src/map/heritageSpots";
import { overlay } from "../../../src/map/tools";
import type { OldWorld } from "../../../src/world/oldworld";

const now = (): number => performance.now();

/** An old city of the size a z14 tile extract gives: foundations, old streets, places, finds. */
function oldCity(seed = 99): OldWorld {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const ring = (x: number, y: number): [number, number][] => {
    const n = 4 + Math.floor(rand() * 5);
    const out: [number, number][] = [];
    for (let k = 0; k < n; k++) out.push([x + Math.cos((k / n) * 2 * Math.PI) * 8, y + Math.sin((k / n) * 2 * Math.PI) * 6]);
    return out;
  };
  const foundations = Array.from({ length: 300 }, (_, i) => ({ id: `f${i}`, ring: ring(rand() * 2000, rand() * 2000), area: 60 + rand() * 200, height: rand() > 0.5 ? 3 + rand() * 15 : undefined }));
  const streets = Array.from({ length: 120 }, (_, i) => ({
    id: `s${i}`,
    cls: ["residential", "service", "tertiary", "footway"][i % 4],
    name: `Старая улица ${i}`,
    pts: Array.from({ length: 4 + Math.floor(rand() * 12) }, () => [rand() * 2000, rand() * 2000] as [number, number]),
    ...(i % 7 === 0 ? { bridge: true as const } : {}),
  }));
  const pois = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, name: `Место ${i}`, cls: i % 3 ? "historic" : "building", subclass: i % 2 ? "manor" : "temple", x: rand() * 2000, y: rand() * 2000 }));
  const spots = pois.slice(0, 20).map((p) => ({ id: p.id, name: p.name, cls: p.cls, subclass: p.subclass, x: p.x, y: p.y }));
  const features = Array.from({ length: 120 }, (_, i) => ({ id: `fe${i}`, kind: (["seeds", "parts", "rails", "bucket", "number", "sign"] as const)[i % 6], x: rand() * 2000, y: rand() * 2000, name: `Находка ${i}` }));
  return { foundations, streets, pois, spots, features };
}

interface Layer {
  group: string;
  name: string;
  read: () => unknown;
}

async function layers(): Promise<Layer[]> {
  const land = await import("../../../src/view/layers/land");
  const city = await import("../../../src/view/layers/city");
  const roads = await import("../../../src/view/layers/roads");
  const buildings = await import("../../../src/view/layers/buildings");
  const traffic = await import("../../../src/view/layers/traffic");
  const ruins = await import("../../../src/view/layers/ruins");
  return [
    { group: "land", name: "fields", read: () => land.fields.value },
    { group: "land", name: "clearings", read: () => land.clearings.value },
    { group: "land", name: "clearingLabels", read: () => land.clearingLabels.value },
    { group: "city", name: "cityPoint", read: () => city.cityPoint.value },
    { group: "city", name: "campArea", read: () => city.campArea.value },
    { group: "roads", name: "roadItems", read: () => roads.roadItems.value },
    { group: "roads", name: "roadLines", read: () => roads.roadLines.value },
    { group: "buildings", name: "buildingItems", read: () => buildings.buildingItems.value },
    { group: "buildings", name: "buildingShapes", read: () => buildings.buildingShapes.value },
    { group: "traffic", name: "roadTraffic (overlay off)", read: () => traffic.roadTraffic.value },
    { group: "ruins", name: "ruinGhosts", read: () => ruins.ruinGhosts.value },
    { group: "ruins", name: "ruinWalls", read: () => ruins.ruinWalls.value },
    { group: "ruins", name: "ruinFloors", read: () => ruins.ruinFloors.value },
    { group: "ruins", name: "ruinStreets", read: () => ruins.ruinStreets.value },
    { group: "ruins", name: "ruinTyped", read: () => ruins.ruinTyped.value },
    { group: "ruins", name: "ruinTypedNames", read: () => ruins.ruinTypedNames.value },
    { group: "ruins", name: "ruinPois", read: () => ruins.ruinPois.value },
    { group: "ruins", name: "ruinHints", read: () => ruins.ruinHints.value },
    { group: "ruins", name: "restoredStreets", read: () => ruins.restoredStreets.value },
  ];
}

it("one snapshot through every layer", async () => {
  const f = await loadFixture();
  const { client: c } = await client();
  const list = await layers();
  // The old city the client keeps from the world data (see oldCity): the ruins layers draw it.
  oldWorld.value = oldCity();
  typedFoundations.value = f.state.finds.foundations.filter((x) => x.cls).map((x) => ({ id: x.id, ring: x.ring, area: x.area, digId: 0, cls: x.cls!, name: x.name, domain: "town" as const }));
  hintSpots.value = oldWorld.value.pois.slice(0, 10).map((p) => ({ x: p.x, y: p.y }));

  // 1. Cold: the town arrives in the "loaded" message and nothing is built yet.
  const cold: { name: string; ms: number }[] = [];
  await setState(f);
  for (const l of list) {
    const t0 = now();
    l.read();
    cold.push({ name: `${l.group}.${l.name}`, ms: now() - t0 });
  }
  const coldTotal = cold.reduce((n, x) => n + x.ms, 0);

  // 2. Steady state: 160 consecutive snapshots, as the worker posts them four times a second.
  const perLayer = new Map<string, number[]>();
  const perSnapshot: number[] = [];
  let prev = c.state.value!;
  for (const d of f.deltas) {
    const m = d as { sim: Parameters<typeof applyDelta>[1] & { zones?: ClientState["zones"] } };
    prev = { ...applyDelta(prev, m.sim), zones: m.zones ?? prev.zones };
    c.state.value = prev;
    let total = 0;
    for (const l of list) {
      const t0 = now();
      l.read();
      const ms = now() - t0;
      total += ms;
      const arr = perLayer.get(`${l.group}.${l.name}`) ?? [];
      arr.push(ms);
      perLayer.set(`${l.group}.${l.name}`, arr);
    }
    perSnapshot.push(total);
  }

  console.log("cold build (the 'loaded' message), ms per layer:");
  for (const x of cold.sort((a, b) => b.ms - a.ms)) console.log(`  ${x.name.padEnd(34)} ${x.ms.toFixed(4)}`);
  console.log(`  ${"TOTAL".padEnd(34)} ${coldTotal.toFixed(3)} ms`);

  console.log("\nsteady state over 160 snapshots, ms per snapshot:");
  const rows = [...perLayer.entries()].map(([name, ms]) => ({ name, median: median(ms), max: Math.max(...ms), sum: ms.reduce((a, b) => a + b, 0) })).sort((a, b) => b.sum - a.sum);
  console.log(`  ${"layer".padEnd(34)} ${"median".padStart(10)} ${"max".padStart(10)} ${"mean".padStart(10)}`);
  for (const r of rows) console.log(`  ${r.name.padEnd(34)} ${r.median.toFixed(4).padStart(10)} ${r.max.toFixed(4).padStart(10)} ${(r.sum / 160).toFixed(4).padStart(10)}`);
  const byGroup = new Map<string, number>();
  for (const [name, ms] of perLayer) byGroup.set(name.split(".")[0], (byGroup.get(name.split(".")[0]) ?? 0) + ms.reduce((a, b) => a + b, 0) / ms.length);
  console.log("\nby group, ms per snapshot (mean):");
  for (const [g, ms] of [...byGroup.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${g.padEnd(12)} ${ms.toFixed(4)}`);
  console.log(`\n  TOTAL per snapshot: median ${median(perSnapshot).toFixed(3)} ms, mean ${(perSnapshot.reduce((a, b) => a + b, 0) / perSnapshot.length).toFixed(3)} ms, max ${Math.max(...perSnapshot).toFixed(3)} ms`);
  console.log(`  at 4 snapshots a second that is ${(median(perSnapshot) * 4).toFixed(2)} ms/s of the main thread`);

  // 3. The traffic overlay on: every built edge becomes a line.
  overlay.value = "traffic";
  const trafficLayer = (await import("../../../src/view/layers/traffic")).roadTraffic;
  c.state.value = { ...prev };
  const t0 = now();
  trafficLayer.value;
  console.log(`\ntraffic overlay switched on: ${(now() - t0).toFixed(3)} ms for the rebuild, then ${time("roadTraffic per snapshot", () => { c.state.value = { ...c.state.value! }; trafficLayer.value; }, { samples: 9 }).median.toFixed(3)} ms per snapshot`);
  overlay.value = "none";
}, 300000);

it("the ruins layers' data: why the first frame costs 9 ms", async () => {
  const f = await loadFixture();
  const items = await import("../../../src/sim/items");
  const lots = await import("../../../src/sim/foundationLots");
  const finds = f.state.finds;
  // A fresh finds object (the arrays are the same): the catalogue cache (src/sim/items.ts:89-92) misses.
  const cold = { ...finds, pois: [...finds.pois], features: [...finds.features], streets: [...finds.streets], foundations: [...finds.foundations] };
  const t0 = performance.now();
  const list = items.catalogue({ finds: cold });
  const coldMs = performance.now() - t0;
  const t1 = performance.now();
  items.catalogue({ finds: cold });
  const warmMs = performance.now() - t1;
  const t2 = performance.now();
  items.foundIds({ finds: cold });
  const foundMs = performance.now() - t2;
  const t3 = performance.now();
  lots.foundationIndex(cold.foundations);
  const indexMs = performance.now() - t3;
  console.log(`catalogue (cold, ${list.length} items from ${cold.features.length} features, ${cold.pois.length} places, ${cold.streets.length} streets): ${coldMs.toFixed(2)} ms; the same call again (cache hit): ${warmMs.toFixed(4)} ms`);
  console.log(`foundIds on the same input: ${foundMs.toFixed(2)} ms; foundationIndex(foundations): ${indexMs.toFixed(2)} ms`);
  // The first call also pays for the JIT: repeat with fresh objects to see the real recompute cost.
  const runs: string[] = [];
  for (let k = 0; k < 6; k++) {
    const fresh = { ...finds, pois: [...finds.pois], features: [...finds.features], streets: [...finds.streets], foundations: [...finds.foundations] };
    const t = performance.now();
    items.catalogue({ finds: fresh });
    runs.push((performance.now() - t).toFixed(2));
  }
  console.log(`catalogue, six fresh recomputes (ms): ${runs.join(", ")}`);
}, 300000);

it("badges: the once-a-second scan of the town", async () => {
  const f = await loadFixture();
  const { badgeFor } = await import("../../../src/map/badgeModel");
  const list = Object.values(f.state.buildings);
  const t = time("badgeFor × every building (481)", () => {
    let n = 0;
    for (const b of list) if (badgeFor(b, null, f.state.levers)) n++;
    return n;
  }, { samples: 9 });
  console.log(`badgeFor over the whole town: ${t.median.toFixed(4)} ms (badges.ts scans up to MAX=24 shown, but still walks every building when few are in view)`);
}, 300000);
