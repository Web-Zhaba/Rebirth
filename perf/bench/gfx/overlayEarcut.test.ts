// earcut triangulation and the overlay geometry builder (src/engine/overlay/geometry.ts, engine/overlay/overlayRaster.ts).
//
// Why it matters: every overlay layer's fill is earcut-triangulated on the CPU (geometry.ts:93), and a data change
// drops that layer's cache entries (overlayRaster.ts:130-140), so the 2048 x 2048 level set is drawn again with
// freshly built vertex buffers. A field drawn, a road built, a lot cut: one rebuild of the sources named in
// view/engine/gameLayers.ts (16 sources, 34 layers, GAME_LAYERS at gameLayers.ts:49-105).
import earcut from "earcut";
import { buildLayer, packColor, type OverlayStyle } from "../../../src/engine/overlay/geometry";
import { describe, expect, it } from "vitest";
import { flat, measure, ring, rng, table } from "./util";

// lng/lat around a point of the alps (the game's town), from town metres.
const LNG0 = 11.4;
const LAT0 = 47.27;
const toLngLat = (p: [number, number]): [number, number] => [LNG0 + p[0] / 78_000, LAT0 + p[1] / 111_000];

function polys(count: number, verts: number, radius: number, seed = 1) {
  const rnd = rng(seed);
  const features = [];
  for (let i = 0; i < count; i++) {
    const cx = radius * 4 * (rnd() - 0.5);
    const cy = radius * 4 * (rnd() - 0.5);
    const r = ring(verts, radius * (0.3 + 0.7 * rnd()), cx, cy, rnd).map(toLngLat);
    features.push({ type: "Feature", properties: { kind: i }, geometry: { type: "Polygon", coordinates: [[...r, r[0]]] } });
  }
  return { type: "FeatureCollection", features } as never;
}

function lines(count: number, verts: number, radius: number, seed = 2) {
  const rnd = rng(seed);
  const features = [];
  for (let i = 0; i < count; i++) {
    const pts: [number, number][] = [];
    let x = radius * 4 * (rnd() - 0.5);
    let y = radius * 4 * (rnd() - 0.5);
    for (let k = 0; k < verts; k++) {
      pts.push(toLngLat([x, y]));
      x += (rnd() - 0.5) * radius;
      y += (rnd() - 0.5) * radius;
    }
    features.push({ type: "Feature", properties: { kind: "stone", w: 4 }, geometry: { type: "LineString", coordinates: pts } });
  }
  return { type: "FeatureCollection", features } as never;
}

function points(count: number, radius: number, seed = 3) {
  const rnd = rng(seed);
  const features = [];
  for (let i = 0; i < count; i++) {
    features.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: toLngLat([radius * 4 * (rnd() - 0.5), radius * 4 * (rnd() - 0.5)]) } });
  }
  return { type: "FeatureCollection", features } as never;
}

const FILL: OverlayStyle = { kind: "fill", color: "#cc8844", opacity: 0.5 };
const LINE: OverlayStyle = { kind: "line", color: "#333333", widthPx: 1.5, widthM: (p) => Number(p.w ?? 3), dash: [2, 1.5] };
const CIRCLE: OverlayStyle = { kind: "circle", radiusPx: 4, color: "#c9b48a", strokeColor: "#222", strokeWidthPx: 1 };
// The anchor only shifts coordinates, so (0, 0) is fine for timing.
const ANCHOR: [number, number] = [0, 0];

describe("earcut on realistic rings", () => {
  it("triangulates lots, blocks, fields and forests", () => {
    const vecs: [string, number[], number[]][] = [
      ["lot 4 verts", flat(ring(4, 6)), []],
      ["block 32 verts", flat(ring(32, 40)), []],
      ["field 128 verts", flat(ring(128, 60)), []],
      ["field 512 verts", flat(ring(512, 90)), []],
      ["forest 2000 verts", flat(ring(2000, 400)), []],
      ["forest 2000 + hole 800", flat(ring(2000, 400)), flat(ring(800, 80))],
    ];
    for (const [name, data, hole] of vecs) {
      const holes = hole.length ? [data.length / 2] : [];
      const both = hole.length ? [...data, ...hole] : data;
      const tris = earcut(both, holes, 2).length / 3;
      measure(`earcut ${name}`, () => void earcut(both, holes, 2), { reps: 200, note: `${data.length / 2} verts -> ${tris} tris` });
      expect(tris).toBeGreaterThan(0);
    }
    table("earcut (one polygon)", "budget: 16.6 ms a frame at 60 fps; a fill layer is re-earcut only when its data changes.");
  });

  it("builds whole overlay layers", () => {
    const cases: [string, never, OverlayStyle][] = [
      ["40 lots x 32 verts (fill)", polys(40, 32, 40), FILL],
      ["120 fields x 128 verts (fill)", polys(120, 128, 60), FILL],
      ["600 lots x 8 verts (fill)", polys(600, 8, 30), FILL],
      ["1 clearing x 4000 verts (fill)", polys(1, 4000, 300), FILL],
      ["400 roads x 6 pts (line)", lines(400, 6, 120), LINE],
      ["2000 points (circle)", points(2000, 200), CIRCLE],
    ];
    let verts = 0;
    for (const [name, data, style] of cases) {
      measure(
        `buildLayer ${name}`,
        () => {
          const g = buildLayer(data, style, ANCHOR);
          verts = g.fills.length + g.lines.length + g.circles.length;
        },
        { reps: 5 },
      );
      expect(verts).toBeGreaterThan(0);
    }
    measure(
      "buildLayer all six together",
      () => {
        for (const [, data, style] of cases) buildLayer(data, style, ANCHOR);
      },
      { reps: 3 },
    );
    measure("packColor (once per feature)", () => void packColor("#cc8844", 0.5), { reps: 2000 });
    table(
      "overlay geometry (one layer build = one data change)",
      "code: geometry.ts:93 earcut per polygon; overlayRaster.ts:130 frees that source's buffers on setData, so the next overlay.update() re-rasterises every level that is dirty.",
    );
  });
});
