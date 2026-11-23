// The mesh builders the map layer runs: farm fields, the forest, restored heritage buildings, broken walls, and the
// overlay geometry of a tool preview (the polygon a lot or a stroke plan pushes every frame).
//
//   npx vitest run perf/bench/map/meshes.test.ts --reporter=verbose
import { expect, it } from "vitest";
import { footprints, ms, ring, sample, table } from "./lib";
import { buildFieldMesh } from "../../../src/map/fieldMesh";
import { CHUNK, scatterDetails, scatterTrees, TREE_STRIDE, type ForestPoly } from "../../../src/map/treeScatter";
import { buildHeritageModel } from "../../../src/map/heritageModels";
import { brokenWalls, ruinWallModel } from "../../../src/map/ruinsGeometry";
import { packColor, type OverlayStyle } from "../../../src/engine/overlay/geometry";
import { buildLayer } from "../../../src/engine/overlay/geometry";
import { motionTime, shadowQuality, SHADOW_QUALITIES } from "../../../src/map/graphicsSettings";
import type { FeatureCollection } from "geojson";

// A wood: `n` vertices round a rough circle of radius r, plus its bbox — the input of the scatter (map/treeScatter.ts:14).
function wood(cx: number, cy: number, r: number, n: number, wobble = 0.12): ForestPoly {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + wobble * Math.sin(i * 2.7));
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], rings: [pts] };
}

it("buildFieldMesh: a farm field (map/fieldMesh.ts:47)", () => {
  const rows: (string | number)[][] = [];
  for (const [sides, r] of [
    [4, 60],
    [4, 150],
    [8, 150],
    [24, 150],
  ] as const) {
    const poly = ring(sides, r) as [number, number][];
    const s = sample(() => buildFieldMesh(poly), 7, 2);
    const m = buildFieldMesh(poly);
    rows.push([`${sides} sides, r ${r} m`, `${m.xy.length / 2} verts`, `${m.index.length / 3} tri`, ms(s.med), ms(s.p90)]);
  }
  console.log("\n### buildFieldMesh — once per field when it changes (view/engine/fields.ts)\n");
  console.log(table(["field", "vertices", "triangles", "median ms", "p90 ms"], rows));
  expect(rows.length).toBe(4);
});

it("scatterTrees / scatterDetails: a 1 km square of forest (map/treeScatter.ts:166, :80)", () => {
  const rect: [number, number, number, number] = [0, 0, 1000, 1000];
  const rows: (string | number)[][] = [];
  const blocked = () => false;
  for (const [trees, n] of [
    [1, 120],
    [4, 200],
    [12, 200],
  ] as const) {
    const forests: ForestPoly[] = [];
    for (let k = 0; k < trees; k++) forests.push(wood(500 + Math.cos(k) * 200, 500 + Math.sin(k) * 200, 260, n));
    const s = sample(() => scatterTrees({ forests, rect, spacing: TREE_STRIDE, lat: 59.12, blocked }), 5, 1);
    const out = scatterTrees({ forests, rect, spacing: TREE_STRIDE, lat: 59.12, blocked });
    rows.push([`${trees} woods, ${n} verts`, CHUNK, out.length / 6, ms(s.med)]);
  }
  console.log("\n### scatterTrees — one chunk (200 m) of 1 km², spacing 6 m\n");
  console.log(table(["forest", "chunk m", "trees", "median ms"], rows));

  const polys = [wood(500, 500, 320, 200)];
  const detail = sample(() => scatterDetails({ polys: polys.map((p) => ({ ...p, mix: { bush: { share: 0.25, size: [1, 2] }, boulder: { share: 0.05, size: [1, 3] } } })), rect, blocked }), 5, 1);
  const dOut = scatterDetails({ polys: polys.map((p) => ({ ...p, mix: { bush: { share: 0.25, size: [1, 2] }, boulder: { share: 0.05, size: [1, 3] } } })), rect, blocked });
  console.log(`\n### scatterDetails — same km² with bushes (5 m) and boulders (7 m): ${ms(detail.med)} ms, ${dOut.length / 6} pieces\n`);
  expect(rows.length).toBe(3);
});

it("heritage and ruin models (map/heritageModels.ts:132, map/ruinsGeometry.ts:120, :207)", () => {
  const rows: (string | number)[][] = [];
  const houses: [string, number, number][] = [
    ["house", 12, 9],
    ["place_of_worship", 24, 16],
    ["castle", 40, 30],
    ["station", 60, 24],
  ];
  for (const [kind, w, d] of houses) {
    const outline = [
      [0, 0],
      [w, 1],
      [w + 1, d - 1],
      [1, d],
    ] as [number, number][];
    const s = sample(() => buildHeritageModel(outline, 8, kind, 7), 7, 2);
    const m = buildHeritageModel(outline, 8, kind, 7);
    rows.push([kind, `${w}×${d} m`, `${m.positions.length / 3} verts`, `${m.indices.length / 3} tri`, ms(s.med)]);
  }
  console.log("\n### buildHeritageModel — one restored building (a ring of 4 is the common lot)\n");
  console.log(table(["kind", "ring", "vertices", "triangles", "median ms"], rows));

  const ring20 = ring(20, 12, 10, 10) as [number, number][];
  const s20 = sample(() => buildHeritageModel(ring20, 8, "museum", 3), 7, 2);
  console.log(`a 20-vertex museum ring: ${ms(s20.med)} ms`);

  const ruin = ring(4, 12, 0, 0) as [number, number][];
  const pieces = brokenWalls(ruin, "k1", 6) ?? [];
  const sWall = sample(() => brokenWalls(ruin, "k1", 6), 7, 2);
  const sModel = sample(() => ruinWallModel(pieces, () => 0), 7, 2);
  console.log(`\n### ruin walls — brokenWalls ${ms(sWall.med)} ms (${pieces.length} pieces), ruinWallModel ${ms(sModel.med)} ms\n`);
  expect(pieces.length).toBeGreaterThan(0);
});

it("the overlay geometry of a tool preview with many polygons", () => {
  const style: OverlayStyle[] = [
    { kind: "fill", color: "#4b8f42", opacity: 0.5 },
    { kind: "line", color: "#faf7ef", widthPx: 4, opacity: 0.6 },
  ];
  const rows: (string | number)[][] = [];
  const f = (x: number, y: number): [number, number] => [37.9 + x / 111_320 / 0.5, 59.12 + y / 111_132];
  for (const n of [1, 20, 100]) {
    const fps = footprints(n);
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: fps.map((fp, i) => ({
        type: "Feature",
        properties: { kind: "lot", dropped: false, hover: i === 0 },
        geometry: { type: "Polygon", coordinates: [[...fp.map(([x, y]) => f(x, y)), f(fp[0][0], fp[0][1])]] },
      })),
    };
    for (const st of style) {
      const s = sample(() => buildLayer(fc, st, [2_000_000, 7_000_000]), 7, 2);
      rows.push([`${n} lots`, st.kind, ms(s.med)]);
    }
  }
  console.log("\n### buildLayer over a stroke plan (strokeTool.ts:199-231 pushes the whole plan on every frame)\n");
  console.log(table(["features", "style", "median ms"], rows));
  expect(rows.length).toBe(6);
});

it("graphicsSettings: the per-call locals of the palette helpers", () => {
  // packColor runs per feature per layer on every overlay rebuild (engine/overlay/geometry.ts:51)
  const s = sample(() => {
    let n = 0;
    for (let i = 0; i < 1000; i++) n += packColor("#4b8f42", 0.5);
    return n;
  }, 7, 2);
  const t = sample(() => motionTime(), 7, 2);
  console.log("\n### graphicsSettings (map/graphicsSettings.ts) + the palette helpers it feeds\n");
  console.log(table(["call", "median ms"], [["packColor ×1000", ms(s.med)], ["motionTime ×1", ms(t.med)]]));
  // the palette constants: measured as a plain read of the module's signals, not a computation
  console.log(`shadowQuality = ${shadowQuality.value} of ${SHADOW_QUALITIES.join("/")}`);
  expect(s.med).toBeGreaterThan(0);
});
