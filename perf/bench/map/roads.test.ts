// Road chains and their 3D models: what the road layer costs when the graph changes (src/view/layers/roads.ts) and what
// one chain's mesh costs (src/map/roadModels.ts, src/map/roadJunctions.ts).
//
//   npx vitest run perf/bench/map/roads.test.ts --reporter=verbose
import { expect, it } from "vitest";
import { starGraph, snakeGraph, polyline, ring, sample, ms, median, table, timeIt, ROAD_KINDS } from "./lib";
import { roadChains } from "../../../src/map/roadChains";
import { buildRoadModel } from "../../../src/map/roadModels";
import { buildJunctionModel, roadJunctions, junctionOutline } from "../../../src/map/roadJunctions";
import type { ModelItem } from "../../../src/map/modelItems";
import type { RoadGraph } from "../../../src/sim/types";

const built = () => "built" as const;

// view/layers/roads.ts:52-58 `itemSig`, copied verbatim: the string the road layer rebuilds from every chain on every
// recompute of `roadItems`.
const itemSig = (l: readonly ModelItem[]) =>
  l
    .map(
      (i) =>
        `${i.kind}:${i.ring.map((p) => p.join(",")).join(";")}${i.ends ? `${i.ends[0] ? 1 : 0}${i.ends[1] ? 1 : 0}` : ""}${i.junction ? `@${i.junction.arms.map((a) => `${a.kind},${a.hw},${a.dir[0]},${a.dir[1]},${a.len}`).join(";")}` : ""}`,
    )
    .join("|");

// A graph of a grown town: the snake plus a stub road off every 5th node, so it has branches and junctions.
function townGraph(segments: number, len = 40): RoadGraph {
  const g = snakeGraph(segments, len);
  const stubs = Math.floor(segments / 5);
  for (let k = 0; k < stubs; k++) {
    const nodeId = 2 + k * 5;
    const n = g.nodes[nodeId];
    if (!n) continue;
    const id = g.nextId++;
    g.nodes[id] = { id, x: n.x, y: n.y - 25 };
    const labor = ROAD_KINDS.dirt.labor * 25;
    g.edges[id] = { id, a: nodeId, b: id, kind: "dirt", length: 25, labor, done: labor };
  }
  return g;
}

// The model items the road layer would produce for a graph (view/layers/roads.ts:60-85), without the signals.
function roadItemsOf(g: RoadGraph): ModelItem[] {
  const chains = roadChains(g, built);
  const junctions = roadJunctions(g, () => true);
  const nodes = new Set(junctions.map((j) => j.node));
  const out: ModelItem[] = chains
    .filter((ch) => ch.state === "built")
    .map((ch) => ({
      id: `road${ch.id}`,
      ring: ch.nodes.map((id): [number, number] => [g.nodes[id].x, g.nodes[id].y]),
      height: 0,
      kind: ch.kind,
      progress: 1,
      style: "road" as const,
      ends: [nodes.has(ch.nodes[0]), nodes.has(ch.nodes[ch.nodes.length - 1])] as [boolean, boolean],
    }));
  for (const j of junctions) out.push({ id: `junction${j.node}`, ring: [j.p], height: 0, kind: j.arms[0].kind, progress: 1, style: "junction", junction: j });
  return out;
}

it("road chains: roadChains at 50/200/500 segments", () => {
  const rows: (string | number)[][] = [];
  for (const n of [50, 200, 500]) {
    const g = snakeGraph(n);
    const s = sample(() => roadChains(g, built), 9, 2);
    const chains = roadChains(g, built);
    rows.push([n, Object.keys(g.edges).length, chains.length, ms(s.med), ms(s.p90)]);
  }
  console.log("\n### roadChains (map/roadChains.ts:19), one graph changed\n");
  console.log(table(["segments", "edges", "chains", "median ms", "p90 ms"], rows));
  expect(rows.length).toBe(3);
});

it("road chains: buildRoadModel per chain kind at 50/200/500 segments", () => {
  const rows: (string | number)[][] = [];
  for (const n of [50, 200, 500]) {
    const pts = polyline(n);
    for (const kind of ["dirt", "stone"] as const) {
      const s = sample(() => buildRoadModel(pts, kind), 7, 2);
      const m = buildRoadModel(pts, kind);
      rows.push([n, kind, m.positions.length / 3, m.indices.length / 3, ms(s.med), ms(s.p90)]);
    }
  }
  console.log("\n### buildRoadModel (map/roadModels.ts:255) — one ground chain\n");
  console.log(table(["segments", "kind", "vertices", "triangles", "median ms", "p90 ms"], rows));
  expect(rows.length).toBe(6);
});

it("road chains: bridges (the heavy models) at 50/200/500 segments", () => {
  const rows: (string | number)[][] = [];
  for (const n of [50, 200, 500]) {
    const pts = polyline(n);
    for (const kind of ["footbridge", "bridge", "stonebridge"] as const) {
      const s = sample(() => buildRoadModel(pts, kind), 3, 1);
      const m = buildRoadModel(pts, kind);
      rows.push([n, kind, m.positions.length / 3, ms(s.med)]);
    }
  }
  console.log("\n### buildRoadModel — bridges (resampled every 0.4-0.5 m). A 50-segment row is a 2 km bridge; 200 and 500\n### are far past anything the game lays, kept only to bound the cost of a long chain.\n");
  console.log(table(["segments", "kind", "vertices", "median ms"], rows));
  expect(rows.length).toBe(9);
}, 240_000);

it("junctions: roadJunctions + buildJunctionModel", () => {
  const rows: (string | number)[][] = [];
  for (const edges of [50, 200, 500]) {
    const g = townGraph(edges);
    const sj = sample(() => roadJunctions(g, () => true), 9, 2);
    const js = roadJunctions(g, () => true);
    // all the aprons of the graph, i.e. what the model layer builds once per graph change (view/engine/models.ts:103)
    const all = sample(() => js.reduce((n, j) => n + buildJunctionModel(j).indices.length, 0), 5, 1);
    rows.push([edges, `${js.length} junctions`, `${ms(sj.med)} + ${ms(all.med)} ms (all aprons)`]);
  }
  for (const arms of [2, 3, 4, 6]) {
    const g = starGraph(arms, 30, arms === 2 ? "path" : "dirt");
    const js = roadJunctions(g, () => true);
    if (js.length === 0) continue;
    const s = sample(() => buildJunctionModel(js[0]), 9, 2);
    const m = buildJunctionModel(js[0]);
    rows.push([`star ${arms}`, `${js.length} apron`, `${m.indices.length / 3} tri, ${ms(s.med)} ms`]);
  }
  console.log("\n### junctions (map/roadJunctions.ts:60, :160)\n");
  console.log(table(["graph", "junctions", "cost"], rows));
  expect(rows.length).toBeGreaterThan(3);
});

it("road layer recompute: itemSig + keyOf over all chains", async () => {
  // map/modelItems.ts touches `window` in a DEV block, so it is loaded after a stub (its `keyOf` is the real one).
  (globalThis as unknown as { window: unknown }).window ??= globalThis;
  const { keyOf } = await import("../../../src/map/modelItems");
  const rows: (string | number)[][] = [];
  for (const n of [50, 200, 500]) {
    const g = townGraph(n);
    const items = roadItemsOf(g);
    const sig = sample(() => itemSig(items), 9, 2);
    const keys = sample(
      () => {
        const cache = new Map<string, number>();
        for (const it of items) cache.set(keyOf(it, 1, 4), 1);
        return cache.size;
      },
      9,
      2,
    );
    rows.push([n, items.length, itemSig(items).length, ms(sig.med), ms(keys.med)]);
  }
  console.log("\n### what one recompute of the road layer costs (view/layers/roads.ts:52-85, map/modelItems.ts:112)\n");
  console.log(table(["segments", "model items", "sig chars", "itemSig median ms", "keyOf for all median ms"], rows));
  expect(rows.length).toBe(3);
});

it("the graph fixture is the same one the polygons of roadOutline use", () => {
  // sanity: a star of 3 arms makes exactly one junction, so the junction rows above are not measuring an empty list
  const js = roadJunctions(starGraph(3, 30, "dirt"), () => true);
  expect(js.length).toBe(1);
  expect(junctionOutline(js[0]).length).toBe(96);
  expect(median(timeIt(() => roadChains(snakeGraph(50), built), 3, 1))).toBeGreaterThan(0);
  expect(ring(4, 10).length).toBe(4);
});

it("one snapshot with a changed road graph: the whole road layer", () => {
  const rows: (string | number)[][] = [];
  for (const n of [50, 200, 500]) {
    const g = townGraph(n);
    const whole = () => {
      // view/layers/roads.ts:31-38 chains, :64-85 items, then view/engine/models.ts:103-140 one model per item
      const items = roadItemsOf(g);
      itemSig(items);
      let tris = 0;
      for (const it of items) {
        const m = it.style === "junction" && it.junction ? buildJunctionModel(it.junction) : buildRoadModel(it.ring, it.kind as never, { start: it.ends?.[0], end: it.ends?.[1] });
        tris += m.indices.length / 3;
      }
      return tris;
    };
    const s = sample(whole, 5, 1);
    const items = roadItemsOf(g);
    const roads = items.filter((i) => i.style === "road").length;
    const junctions = items.length - roads;
    rows.push([n, roads, junctions, ms(s.med), ms(s.p90)]);
  }
  console.log("\n### roadChains + roadJunctions + itemSig + every mesh, i.e. one snapshot that changed the graph\n");
  console.log(table(["edges", "road items", "junction aprons", "median ms", "p90 ms"], rows));
  expect(rows.length).toBe(3);
}, 240_000);
