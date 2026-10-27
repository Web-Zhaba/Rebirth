import type maplibregl from "maplibre-gl";
import { computed, effect, signal, type ReadonlySignal } from "@preact/signals";
import { ROAD_KINDS } from "../sim/roads";
import { pointInPolygon } from "../sim/zones";
import type { Clearing } from "../sim/types";
import type { WeatherState } from "../sim/weather";
import { buildings, city, frame, roads, state, zones } from "../simClient";
import type { Frame } from "../world/frame";
import { lngLatToTile } from "../world/mercator";
import { NATURE_MAXZOOM } from "../world/nature";
import { getLandTile } from "../world/tiles";
import type { ModelLayerOptions } from "./modelLayer";
import type { XY } from "./modelGeometry";
import { CHUNK, scatterTrees, TREES_FROM_ZOOM, type ForestPoly } from "./treeScatter";
import { mercatorToLngLat } from "./three/frame";

// Main-chunk side of the 3D forest (PLAN-3d-world.ru.md stage 4): the trees of any square chunk of the plane, from the
// forest polygons of the landcover tiles under it (the same tiles the game reads its land from) less what stands in
// their way near the town. The three.js layer (treeLayer.ts) picks the chunks the camera sees and loads with the first
// close view.

export const FOREST_RANGE = 25_000; // m from the founding point: no trees beyond (the town frame is local)
const SPACING = 9; // m between trees
const CELL = 4; // m, occupancy grid of houses, roads and lots
const PROGRESS_STEPS = 10; // a clearing under way fells its trees in this many steps

export type Box = [number, number, number, number];

export interface ForestSource {
  // Trees of chunk (i, j), covering [i, i + 1) x [j, j + 1) chunks of town metres (treeScatter.ts records); null while
  // its landcover tiles load (`onTile` is called as each arrives).
  chunk(i: number, j: number): Float32Array | null;
  onTile: (() => void) | null;
  // Bumps when what stands in the way of trees changes; box: where chunks need building again (null: everywhere).
  changed: ReadonlySignal<{ n: number; box: Box | null }>;
  dispose(): void;
}

// ---- Forest polygons per landcover tile, in town metres ----

const N = 2 ** NATURE_MAXZOOM;
const tiles = new Map<string, ForestPoly[]>();
const pending = new Set<string>();
let tilesFor: Frame | null = null;

function loadTile(f: Frame, tx: number, ty: number, done: () => void): void {
  const key = `${tx}/${ty}`;
  if (pending.has(key)) return;
  pending.add(key);
  void getLandTile(((tx % N) + N) % N, ty)
    .then(
      (tile) => {
        const out: ForestPoly[] = [];
        for (const p of tile.land) {
          if (p.cls !== "wood") continue;
          const rings = p.rings.map((r) => {
            const ring: XY[] = [];
            for (let i = 0; i + 1 < r.length; i += 2) {
              const ll = mercatorToLngLat((tx + r[i] / tile.extent) / N, (ty + r[i + 1] / tile.extent) / N);
              ring.push(f.toLocal(ll.lng, ll.lat));
            }
            return ring;
          });
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const r of rings) for (const [x, y] of r) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
          out.push({ bbox: [x0, y0, x1, y1], rings });
        }
        return out;
      },
      () => [] as ForestPoly[],
    )
    .then((list) => {
      if (tilesFor !== f) return;
      tiles.set(key, list);
      pending.delete(key);
      done();
    });
}

// ---- What stands in the way of trees near the town ----

const clearings = computed(() => state.value?.clearings ?? []);
// Changes that move trees: clearing progress in steps, the lots of houses, the roads, the zone cells and fields.
const blockSig = computed(() => {
  const c = clearings.value.map((q) => `${q.id}:${Math.floor((q.done / Math.max(q.labor, 1e-9)) * PROGRESS_STEPS)}`).join(",");
  const b = Object.keys(buildings.value ?? {}).join(",");
  const r = Object.keys(roads.value?.edges ?? {}).join(",");
  return `${c}|${b}|${r}|${zones.value?.rev ?? 0}`;
});

interface Blocker {
  test: (x: number, y: number, h: number) => boolean;
  box: Box | null; // everything it blocks lies in here
}

// An occupancy grid of houses, roads, zone lots and fields, plus clearings by progress.
function makeBlocker(): Blocker {
  const cells = new Set<number>();
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (x: number, y: number, r: number) => {
    box[0] = Math.min(box[0], x - r);
    box[1] = Math.min(box[1], y - r);
    box[2] = Math.max(box[2], x + r);
    box[3] = Math.max(box[3], y + r);
  };
  const key = (i: number, j: number) => i * 100003 + j;
  const mark = (x: number, y: number, r: number) => {
    grow(x, y, r);
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
  const polys: { pts: [number, number][]; share: number; bb: Box }[] = [
    ...(zones.value?.fields ?? []).map((f) => ({ pts: f.pts, share: 1 })),
    ...clearings.value.map((c: Clearing) => ({ pts: c.pts, share: Math.floor((c.done / Math.max(c.labor, 1e-9)) * PROGRESS_STEPS) / PROGRESS_STEPS })),
  ]
    .filter((p) => p.share > 0)
    .map((p) => {
      const xs = p.pts.map((q) => q[0]), ys = p.pts.map((q) => q[1]);
      const bb: Box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      grow((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, Math.max(bb[2] - bb[0], bb[3] - bb[1]) / 2);
      return { ...p, bb };
    });
  return {
    box: box[0] <= box[2] ? box : null,
    test: (x, y, h) => {
      if (cells.has(key(Math.floor(x / CELL), Math.floor(y / CELL)))) return true;
      return polys.some((p) => h < p.share && x >= p.bb[0] && x <= p.bb[2] && y >= p.bb[1] && y <= p.bb[3] && pointInPolygon(x, y, p.pts));
    },
  };
}

const union = (a: Box | null, b: Box | null): Box | null => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);

function createSource(f: Frame, lat: number): ForestSource {
  let blocker = makeBlocker();
  const changed = signal<{ n: number; box: Box | null }>({ n: 0, box: null });
  let first = true;
  const stop = effect(() => {
    void blockSig.value;
    if (first) return void (first = false);
    const next = makeBlocker();
    const box = union(blocker.box, next.box);
    blocker = next;
    changed.value = { n: changed.peek().n + 1, box };
  });
  const src: ForestSource = {
    onTile: null,
    changed,
    dispose: stop,
    chunk(i, j) {
      const x0 = i * CHUNK, y0 = j * CHUNK, x1 = x0 + CHUNK, y1 = y0 + CHUNK;
      if (Math.hypot((x0 + x1) / 2, (y0 + y1) / 2) > FOREST_RANGE) return new Float32Array(0);
      const [la, pa] = f.toLngLat(x0, y1), [lb, pb] = f.toLngLat(x1, y0);
      const a = lngLatToTile(la, pa, NATURE_MAXZOOM), b = lngLatToTile(lb, pb, NATURE_MAXZOOM);
      const polys: ForestPoly[] = [];
      let ready = true;
      for (let tx = Math.floor(a.x); tx <= Math.floor(b.x); tx++)
        for (let ty = Math.floor(a.y); ty <= Math.floor(b.y); ty++) {
          const list = tiles.get(`${tx}/${ty}`);
          if (list) polys.push(...list);
          else {
            ready = false;
            loadTile(f, tx, ty, () => src.onTile?.());
          }
        }
      if (!ready) return null;
      return scatterTrees({ forests: polys, rect: [x0, y0, x1, y1], spacing: SPACING, lat, blocked: blocker.test });
    },
  };
  return src;
}

export interface ForestOptions {
  light?: ModelLayerOptions["light"];
  weather: ReadonlySignal<WeatherState | null>;
}

// Loads the tree layer with the first close view of a founded town; a new town starts it over.
export function attachForest(map: maplibregl.Map, opts: ForestOptions): void {
  let loadedFor: Frame | null = null;
  let detach: (() => void) | null = null;
  let source: ForestSource | null = null;
  const check = () => {
    const f = frame.peek(), c = city.peek();
    if (loadedFor && loadedFor !== f) {
      detach?.();
      source?.dispose();
      detach = null;
      source = null;
      loadedFor = null;
    }
    if (loadedFor || !f || !c || map.getZoom() < TREES_FROM_ZOOM) return;
    loadedFor = f;
    tiles.clear();
    pending.clear();
    tilesFor = f;
    const src = (source = createSource(f, c.lat));
    void import("./treeLayer").then((m) => {
      if (loadedFor === f) detach = m.attachTreeLayer(map, { source: src, frame, light: opts.light, weather: opts.weather });
    });
  };
  map.on("zoomend", check);
  effect(() => {
    void frame.value;
    check();
  });
}
