import type maplibregl from "maplibre-gl";
import { computed, effect, signal } from "@preact/signals";
import { ROAD_KINDS } from "../sim/roads";
import { pointInPolygon } from "../sim/zones";
import type { Clearing } from "../sim/types";
import { buildings, city, frame, roads, state, zones } from "../simClient";
import type { Frame } from "../world/frame";
import { lngLatToTile } from "../world/mercator";
import { NATURE_MAXZOOM } from "../world/nature";
import { getLandTile } from "../world/tiles";
import type { XY } from "./modelGeometry";
import { scatterTrees, type ForestPoly } from "./treeScatter";
import { mercatorToLngLat } from "./three/frame";

// Main-chunk side of the 3D forest (PLAN-3d-world.ru.md stage 4): the forest polygons around the town (the same
// landcover tiles the game reads its land from), what stands in their way, and the scattered trees. The three.js layer
// (treeLayer.ts) loads with the first tree.

export const FOREST_RADIUS = 1500; // m around the founding point
const MAX_TREES = 100_000; // denser forest is thinned evenly (about 6 million triangles at the cap)
const SPACING = 6.5; // m between trees
const CELL = 4; // m, occupancy grid of houses, roads and lots
const PROGRESS_STEPS = 10; // a clearing under way fells its trees in this many steps

// Forest polygons within the radius, in town metres; loaded once per town.
const forests = signal<ForestPoly[] | null>(null);
let loadedFor = "";

async function loadForests(f: Frame): Promise<ForestPoly[]> {
  const n = 2 ** NATURE_MAXZOOM;
  const [x0, y0] = f.toLngLat(-FOREST_RADIUS, FOREST_RADIUS), [x1, y1] = f.toLngLat(FOREST_RADIUS, -FOREST_RADIUS);
  const a = lngLatToTile(x0, y0, NATURE_MAXZOOM), b = lngLatToTile(x1, y1, NATURE_MAXZOOM);
  const out: ForestPoly[] = [];
  const jobs: Promise<void>[] = [];
  for (let tx = Math.floor(a.x); tx <= Math.floor(b.x); tx++)
    for (let ty = Math.floor(a.y); ty <= Math.floor(b.y); ty++)
      jobs.push(
        getLandTile(((tx % n) + n) % n, ty).then((tile) => {
          for (const p of tile.land) {
            if (p.cls !== "wood") continue;
            const rings = p.rings.map((r) => {
              const ring: XY[] = [];
              for (let i = 0; i + 1 < r.length; i += 2) {
                const ll = mercatorToLngLat((tx + r[i] / tile.extent) / n, (ty + r[i + 1] / tile.extent) / n);
                ring.push(f.toLocal(ll.lng, ll.lat));
              }
              return ring;
            });
            const xs = rings.flat().map((q) => q[0]), ys = rings.flat().map((q) => q[1]);
            const bbox: ForestPoly["bbox"] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
            if (bbox[2] < -FOREST_RADIUS || bbox[0] > FOREST_RADIUS || bbox[3] < -FOREST_RADIUS || bbox[1] > FOREST_RADIUS) continue;
            out.push({ bbox, rings });
          }
        }, () => undefined),
      );
  await Promise.all(jobs);
  return out;
}

const clearings = computed(() => state.value?.clearings ?? []);
// Changes that move trees: clearing progress in steps, the lots of houses, the roads, the zone cells and fields.
const blockSig = computed(() => {
  const c = clearings.value.map((q) => `${q.id}:${Math.floor((q.done / Math.max(q.labor, 1e-9)) * PROGRESS_STEPS)}`).join(",");
  const b = Object.keys(buildings.value ?? {}).join(",");
  const r = Object.keys(roads.value?.edges ?? {}).join(",");
  return `${c}|${b}|${r}|${zones.value?.rev ?? 0}`;
});

// Ground with no trees: an occupancy grid of houses, roads, zone lots and fields, plus clearings by progress.
function blocker(): (x: number, y: number, h: number) => boolean {
  const cells = new Set<number>();
  const key = (i: number, j: number) => i * 100003 + j;
  const mark = (x: number, y: number, r: number) => {
    for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((y - r) / CELL); j <= Math.floor((y + r) / CELL); j++) cells.add(key(i, j));
  };
  for (const b of Object.values(buildings.value ?? {})) {
    const { cx, cy, w, d } = b.lot;
    mark(cx, cy, Math.hypot(w, d) / 2 + 2);
  }
  const g = roads.value;
  if (g)
    for (const e of Object.values(g.edges)) {
      const a = g.nodes[e.a], b = g.nodes[e.b];
      if (!a || !b) continue;
      const len = Math.hypot(b.x - a.x, b.y - a.y), r = (ROAD_KINDS[e.kind]?.width ?? 3) / 2 + 2;
      for (let s = 0; s <= len; s += 2) mark(a.x + ((b.x - a.x) * s) / (len || 1), a.y + ((b.y - a.y) * s) / (len || 1), r);
    }
  for (const c of zones.value?.cells ?? []) if (c.zone !== "none") mark(c.cx, c.cy, 6);
  const polys: { pts: [number, number][]; share: number }[] = [
    ...(zones.value?.fields ?? []).map((f) => ({ pts: f.pts, share: 1 })),
    ...clearings.value.map((c: Clearing) => ({ pts: c.pts, share: Math.floor((c.done / Math.max(c.labor, 1e-9)) * PROGRESS_STEPS) / PROGRESS_STEPS })),
  ].filter((p) => p.share > 0);
  const boxes = polys.map((p) => {
    const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });
  return (x, y, h) => {
    if (cells.has(key(Math.floor(x / CELL), Math.floor(y / CELL)))) return true;
    return polys.some((p, i) => h < p.share && x >= boxes[i][0] && x <= boxes[i][2] && y >= boxes[i][1] && y <= boxes[i][3] && pointInPolygon(x, y, p.pts));
  };
}

// The trees (treeScatter.ts records) in town metres; null until the forest polygons are in.
export const forestTrees = computed<Float32Array | null>(() => {
  const list = forests.value, c = city.value;
  void blockSig.value;
  if (!list || !c) return null;
  return scatterTrees({ forests: list, centre: [0, 0], radius: FOREST_RADIUS, spacing: SPACING, lat: c.lat, maxTrees: MAX_TREES, blocked: blocker() });
});

export function attachForest(map: maplibregl.Map, opts: { light?: import("./modelLayer").ModelLayerOptions["light"]; weather: import("@preact/signals").ReadonlySignal<import("../sim/weather").WeatherState | null> }): void {
  effect(() => {
    const f = frame.value, c = city.value;
    if (!f || !c) return;
    const k = `${c.lat},${c.lng}`;
    if (loadedFor === k) return;
    loadedFor = k;
    forests.value = null;
    void loadForests(f).then((list) => {
      if (loadedFor === k) forests.value = list;
    });
  });
  if (import.meta.env.DEV) Object.assign(window, { forestTrees }); // devtools: forestTrees.value.length / 6 trees
  let loading = false;
  const stop = effect(() => {
    if (loading || !forestTrees.value?.length) return;
    loading = true;
    void import("./treeLayer").then((m) => m.attachTreeLayer(map, { trees: forestTrees, frame, light: opts.light, weather: opts.weather, radius: FOREST_RADIUS }));
    queueMicrotask(() => stop());
  });
}
