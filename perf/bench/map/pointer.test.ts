// What one pointermove or one drag frame costs in the interactive tools — the per-event work of roadTool.ts, and the hit
// index the building layer queries.
//
// The composite below replays the exact call sequence of roadTool.ts `onMove` (roadTool.ts:760-830) with the real
// functions; the overlay writes it makes are timed as the geometry the engine builds from them
// (src/engine/overlay/geometry.ts `buildLayer`, the only CPU part of `overlay.setData`, overlayRaster.ts:127).
//
//   npx vitest run perf/bench/map/pointer.test.ts --reporter=verbose
import { expect, it } from "vitest";
import { arc, footprints, median, ms, polyline, sample, snakeGraph, table, timeIt } from "./lib";
import { makeFrame } from "../../../src/world/frame";
import { addRoad, distToEdge, snapPoint } from "../../../src/sim/roads";
import { roadChains } from "../../../src/map/roadChains";
import { buildBuildingSpatialIndex, buildingSpatialCandidates } from "../../../src/map/buildingHitIndex";
import { buildLayer, type OverlayStyle } from "../../../src/engine/overlay/geometry";
import { arcPath } from "../../../src/map/curve";
import type { RoadGraph } from "../../../src/sim/types";
import type { FeatureCollection } from "geojson";

const f = makeFrame(59.12, 37.9);
const SNAP_PX = 12; // roadTool.ts:23

// The two line styles of the road preview, and the circle of the snap marker (view/engine/overlayStyles.ts:15-17).
const PREVIEW: OverlayStyle[] = [
  { kind: "line", color: "#faf7ef", widthPx: 6, opacity: 0.55 },
  { kind: "line", color: "#4b8f42", widthPx: 3, dash: [2, 1.5] },
];
const SNAP: OverlayStyle = { kind: "circle", radiusPx: 6, color: "#faf7ef", strokeColor: "#3a6ea5", strokeWidthPx: 2 };

const lineFc = (pts: readonly [number, number][]): FeatureCollection => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { ok: true }, geometry: { type: "LineString", coordinates: pts.map(([x, y]) => f.toLngLat(x, y)) } }],
});
const pointFc = (p: [number, number]): FeatureCollection => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: f.toLngLat(p[0], p[1]) } }],
});

// roadTool.ts:325-341 `nearestEdge`: every edge of the graph, `distToEdge` each, to find the one under the cursor.
function nearestEdge(g: RoadGraph, x: number, y: number, tol: number): number | null {
  let best = tol;
  let id: number | null = null;
  for (const e of Object.values(g.edges)) {
    const d = distToEdge(g, e, x, y);
    if (d <= best) {
      best = d;
      id = e.id;
    }
  }
  return id;
}

it("snapPoint: one per pointermove (sim/roads.ts:87)", () => {
  const rows: (string | number)[][] = [];
  for (const n of [50, 200, 500, 1000]) {
    const g = snakeGraph(n);
    // a cursor 3 m off the road: the node scan misses, the edge scan hits (the common case while drawing)
    const [x, y] = [200.5, 3];
    const s = sample(() => snapPoint(g, { x, y }, SNAP_PX * 0.6), 11, 3);
    rows.push([n, Object.keys(g.nodes).length, ms(s.med), ms(s.p90)]);
  }
  console.log("\n### snapPoint — called 2-3× per pointermove (roadTool.ts:262 resolve, sim/roads.ts:87)\n");
  console.log(table(["edges", "nodes", "median ms", "p90 ms"], rows));
  expect(rows.length).toBe(4);
});

it("nearestEdge: the whole-graph scan of the hover", () => {
  const rows: (string | number)[][] = [];
  for (const n of [50, 200, 500, 1000]) {
    const g = snakeGraph(n);
    const s = sample(() => nearestEdge(g, 200.5, 3, 8), 11, 3);
    rows.push([n, ms(s.med), ms(s.p90)]);
  }
  console.log("\n### nearestEdge — the bulldozer hover and the upgrade hover (roadTool.ts:325, called by onMove roadTool.ts:812)\n");
  console.log(table(["edges", "median ms", "p90 ms"], rows));
  expect(rows.length).toBe(4);
});

it("addRoad preview: the validation the tool runs on every move (sim/roads.ts:208)", () => {
  const rows: (string | number)[][] = [];
  for (const n of [50, 200, 500, 1000]) {
    const g = snakeGraph(n);
    const seg: [number, number][] = [
      [200.5, 3],
      [240.5, 3],
    ];
    const s = sample(() => addRoad(g, seg, "dirt", 1, [12]), 11, 3);
    rows.push([n, `2 pts`, ms(s.med), ms(s.p90)]);
  }
  console.log("\n### addRoad on a straight 2-point preview (showPath roadTool.ts:352 → addRoad; cloneGraph + 2-3 passes over every edge)\n");
  console.log(table(["edges", "line", "median ms", "p90 ms"], rows));

  // The expensive case: the preview runs along and across the roads already drawn, so nearly every segment is split
  // and every split rescans the whole edge set (sim/roads.ts:270-300).
  const rows2: (string | number)[][] = [];
  for (const n of [200, 500, 1000]) {
    const g = snakeGraph(n);
    for (const k of [60, 200, 400]) {
      const pts = arc(k, 300);
      const labor = Array<number>(pts.length - 1).fill(12);
      const s = sample(() => addRoad(g, pts as [number, number][], "dirt", 1, labor), 5, 1);
      const verdict = addRoad(g, pts as [number, number][], "dirt", 1, labor);
      rows2.push([n, k, ms(s.med), ms(s.p90), verdict.ok ? "accepted" : `rejected at once: ${verdict.reason}`]);
    }
  }
  console.log("\n### addRoad on a curved preview lying over the drawn roads (arcPath curve.ts:60, MAX_PIECES = 400)\n");
  console.log(table(["edges", "points", "median ms", "p90 ms", "verdict"], rows2));
  expect(rows.length + rows2.length).toBe(13);
}, 120_000);

it("overlay setData: the geometry the engine rebuilds for each write", () => {
  const rows: (string | number)[][] = [];
  for (const n of [2, 60, 500]) {
    const pts = polyline(Math.max(1, n - 1));
    const fc = lineFc(pts);
    for (const style of PREVIEW) {
      const s = sample(() => buildLayer(fc, style, [2_000_000, 7_000_000]), 11, 3);
      rows.push([`line ${n} pts`, `${style.kind} px${(style as { widthPx?: number }).widthPx}`, ms(s.med)]);
    }
  }
  const p = pointFc([200, 3]);
  rows.push(["snap point", "circle", ms(sample(() => buildLayer(p, SNAP, [2_000_000, 7_000_000]), 11, 3).med)]);
  console.log("\n### buildLayer — one overlay source; every setData frees its GPU buffers and re-rasterises 3× 2048² (overlayRaster.ts:127-139)\n");
  console.log(table(["data", "style", "median ms"], rows));
  expect(rows.length).toBe(7);
});

it("the whole per-move cost of roadTool.onMove (drawing, a start point set)", () => {
  const rows: (string | number)[][] = [];
  for (const n of [50, 200, 500, 1000]) {
    const g = snakeGraph(n);
    const start: [number, number] = [200, 0];
    const anchorMp = 0.6; // m per px at zoom 15: tol = 12 px
    const tol = SNAP_PX * anchorMp;
    const move = () => {
      // aim() → resolve() → snapPoint (roadTool.ts:262, 296)
      const snap = snapPoint(g, { x: 200.5, y: 3 }, tol);
      // setSnap → overlay("road-snap").setData(...) (roadTool.ts:275-282)
      const snapFc = pointFc([snap.x, snap.y]);
      buildLayer(snapFc, SNAP, [2_000_000, 7_000_000]);
      // showPath: drawPreview → overlay("road-preview").setData (roadTool.ts:206-228)
      const pts: [number, number][] = [start, [snap.x, snap.y]];
      const fc = lineFc(pts);
      for (const st of PREVIEW) buildLayer(fc, st, [2_000_000, 7_000_000]);
      // showPath: addRoad for the local verdict (roadTool.ts:372)
      const local = addRoad(g, pts, "dirt", 1, [1]);
      // requestCost is throttled to one call per 120 ms (roadTool.ts:24, 300-322): not per move
      return local.ok;
    };
    const s = sample(move, 9, 3);
    rows.push([n, ms(s.med), ms(s.p90)]);
  }
  console.log("\n### roadTool.onMove while drawing a straight segment (snapPoint + 3 overlay geometries + addRoad)\n");
  console.log(table(["edges", "median ms/move", "p90 ms"], rows));
  console.log("\nbudget: 4-6 ms per event at 60 fps (16.7 ms/frame, the tools share it with the renderer).\n");
  expect(rows.length).toBe(4);
});

it("the whole per-move cost of roadTool.onMove (no start: the upgrade hover)", () => {
  const rows: (string | number)[][] = [];
  for (const n of [50, 200, 500, 1000]) {
    const g = snakeGraph(n);
    const tol = SNAP_PX * 0.6;
    const move = () => {
      const snap = snapPoint(g, { x: 200.5, y: 3 }, tol);
      const snapFc = pointFc([snap.x, snap.y]);
      buildLayer(snapFc, SNAP, [2_000_000, 7_000_000]);
      // upgradeRunAt → nearestEdge (roadTool.ts:390, 325)
      const id = nearestEdge(g, 200.5, 3, tol);
      // runAt → roadChains cached by graph identity (roadTool.ts:139-158): a miss rebuilds the whole chain set
      const chains = roadChains(g, () => "built");
      return id !== null && chains.length > 0;
    };
    const s = sample(move, 9, 3);
    rows.push([n, ms(s.med), ms(s.p90)]);
  }
  console.log("\n### roadTool.onMove over a road with no chain started (snapPoint + overlay + nearestEdge + roadChains on a cache miss)\n");
  console.log(table(["edges", "median ms/move", "p90 ms"], rows));
  expect(rows.length).toBe(4);
});

it("buildingHitIndex: build and query at 100/500/1000 buildings", () => {
  const rows: (string | number)[][] = [];
  for (const n of [100, 500, 1000]) {
    const shapes = footprints(n).map((fp, i) => ({ id: i, footprint: fp }));
    const sb = sample(() => buildBuildingSpatialIndex(shapes), 7, 2);
    const index = buildBuildingSpatialIndex(shapes);
    const sq = sample(() => buildingSpatialCandidates(index, 145, 145), 11, 2);
    rows.push([n, ms(sb.med), ms(sq.med)]);
  }
  console.log("\n### buildingHitIndex (map/buildingHitIndex.ts:15, :41) — built once per change of `buildingSet` (view/layers/buildings.ts:24-30), queried per pointermove (:174)\n");
  console.log(table(["buildings", "build median ms", "query median ms"], rows));

  // the linear scan the index replaced, for scale: pointInPolygon over every footprint
  const shapes = footprints(1000).map((fp, i) => ({ id: i, footprint: fp }));
  const linear = () =>
    shapes.reduce((hit, s) => {
      const r = s.footprint;
      let inside = false;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [xi, yi] = r[i];
        const [xj, yj] = r[j];
        if (yi > 145 !== yj > 145 && 145 < ((xj - xi) * (145 - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return hit + (inside ? 1 : 0);
    }, 0);
  console.log(`linear scan of 1000 footprints: ${ms(median(timeIt(linear, 7, 2)))} ms/query (what the index avoids)`);
  expect(rows.length).toBe(3);
});

it("arc mode: the bend recomputed and validated on every move (curve.ts:60 → roadTool.ts:346)", () => {
  const rows: (string | number)[][] = [];
  // a chord 600 m long bent through a point near its middle: the arc's radius shrinks with the bend, and the resampler
  // caps one arc at MAX_PIECES = 400 points (curve.ts:12)
  const bends: [string, [number, number]][] = [
    ["shallow (r≈3 km)", [300, 60]],
    ["medium (r≈600 m)", [300, 160]],
    ["tight (r≈200 m)", [300, 320]],
  ];
  for (const [name, c] of bends) {
    const arcPts = arcPath([0, 0], c, [600, 0]);
    const sArc = sample(() => arcPath([0, 0], c, [600, 0]), 7, 2);
    rows.push([name, arcPts.length, ms(sArc.med), "—"]);
  }
  console.log("\n### arcPath alone (curve.ts:60)\n");
  console.log(table(["bend", "points", "median ms", "—"], rows));

  const rows2: (string | number)[][] = [];
  for (const edges of [200, 500, 1000]) {
    const g = snakeGraph(edges);
    for (const [name, c] of bends) {
      const pts = arcPath([0, 0], c, [600, 0]) as [number, number][];
      const labor = Array<number>(pts.length - 1).fill(12);
      const s = sample(() => addRoad(g, pts, "dirt", 1, labor), 5, 1);
      rows2.push([edges, name, pts.length, ms(s.med), ms(s.p90)]);
    }
  }
  console.log("\n### addRoad on the bent arc — the whole per-move validation of arc mode (roadTool.ts:346 → :372)\n");
  console.log(table(["edges", "bend", "points", "median ms", "p90 ms"], rows2));
  expect(rows.length + rows2.length).toBe(12);
}, 120_000);

it("arc mode: the whole per-move cost (arcPath + preview geometry + addRoad)", () => {
  const rows: (string | number)[][] = [];
  for (const n of [200, 500, 1000]) {
    const g = snakeGraph(n);
    const tol = SNAP_PX * 0.6;
    const start: [number, number] = [0, 0];
    const end: [number, number] = [600, 0];
    const move = () => {
      // roadTool.ts:346: the cursor bends the arc between two fixed ends
      const pts = arcPath(start, [300, 160], end) as [number, number][];
      // setSnap is skipped in arc mode (roadTool.ts:341), the preview is drawn (showPath → drawPreview)
      const fc = lineFc(pts);
      for (const st of PREVIEW) buildLayer(fc, st, [2_000_000, 7_000_000]);
      // roadTool.ts:372: addRoad validates the arc locally on every move
      const local = addRoad(g, pts, "dirt", 1, Array<number>(pts.length - 1).fill(1));
      return local.ok;
    };
    const s = sample(move, 7, 2);
    const pts = arcPath(start, [300, 160], end);
    rows.push([n, pts.length, ms(s.med), ms(s.p90)]);
  }
  console.log("\n### arc mode, one pointermove: a 470 m arc bent through the cursor (roadTool.ts:336-348)\n");
  console.log(table(["edges", "arc points", "median ms/move", "p90 ms"], rows));
  console.log("\nbudget: 4-6 ms per event.\n");
  expect(rows.length).toBe(3);
}, 120_000);
