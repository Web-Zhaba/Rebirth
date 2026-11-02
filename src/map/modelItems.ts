import { signal } from "@preact/signals";
import { BUILDINGS } from "../sim/buildings";
import { isRoadKind } from "../sim/roads";
import { TOWN_COLORS } from "../ui/palette";
import { buildHeritageModel } from "./heritageModels";
import type { Light } from "./life";
import { buildScaffold, type Model, type XY } from "./modelGeometry";
import { drapeRoad, seatBridge, seatBuilding, type Ground } from "./groundSeat";
import { buildRoadModel } from "./roadModels";
import { buildJunctionModel, type RoadJunction } from "./roadJunctions";
import { buildTownModel } from "./townModels";

// The town's models (view/engine/models.ts draws them): what to
// draw (ModelItem), the model of each item on flat ground or seated on the relief, the cache key of everything that
// shapes it, its window lights and the chimneys smoke rises from. No three.js here.

const PROGRESS_STEPS = 24; // progress < 1 is quantised, so a slowly growing site does not rebuild its model every tick

// A building to draw: ring in town-local metres, height in metres, progress 0..1 (below 1 the building-site look: log
// walls as high as the progress allows, corner posts at full height).
// - heritage: a restored old building; kind is its OSM class (the `cls` of src/sim/heritage.ts), height its eaves.
// - town: one of the town's own; kind is the template (src/sim/buildings.ts), height the template's (after an upgrade).
// - road: a built road chain; ring is its centre line (not closed), kind its RoadKind, height unused.
// - junction: the apron where built chains meet (roadJunctions.ts); ring is the node, `junction` its arms, kind the
//   dominant arm's RoadKind.
export interface ModelItem {
  id: string | number;
  ring: XY[];
  height: number;
  kind: string;
  progress: number;
  style: "heritage" | "town" | "road" | "junction";
  level?: number; // town: 2 for a rebuilt house
  front?: XY | null; // town: unit vector towards the street (the door side)
  tint?: string; // town: overlay colour, "" or absent for none
  upgrading?: boolean; // town: a rebuild in progress
  lamp?: Light["kind"]; // lit in the evening like this (sim/life.ts lights), absent: dark
  junction?: RoadJunction; // junction: the arms meeting at ring[0]
  ends?: [boolean, boolean]; // road: its first/last node is a junction (no round joint there)
}

// Model of an item. Unfinished: the building site.
// Points every 1 km over the items' bounds, padded: their DEM tiles (about 10 km wide) cover every model vertex.
export function coverOf(items: readonly { ring: readonly XY[] }[]): XY[] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const it of items) for (const [x, y] of it.ring) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
  if (!(x1 >= x0)) return [];
  const pad = 60, step = 1000, out: XY[] = [];
  for (let x = x0 - pad; ; x += step) {
    const cx = Math.min(x, x1 + pad);
    for (let y = y0 - pad; ; y += step) {
      out.push([cx, Math.min(y, y1 + pad)]);
      if (y >= y1 + pad) break;
    }
    if (x >= x1 + pad) break;
  }
  return out;
}

const BRIDGES = new Set(["footbridge", "bridge", "stonebridge"]);
const PLINTH = TOWN_COLORS.stone[1];

// An item's model on the relief (ground: town metres -> exaggerated ground height; null: flat ground).
export function seatedModelOf(it: ModelItem, ground: Ground | null): Model {
  const m = modelOf(it);
  if (!ground) return m;
  if (it.style === "junction") return drapeRoad(m, ground);
  if (it.style !== "road") return seatBuilding(m, it.ring, ground, PLINTH);
  return BRIDGES.has(it.kind) ? seatBridge(m, it.ring, ground) : drapeRoad(m, ground);
}

export function modelOf(it: ModelItem): Model {
  // the road items always give a junction item its arms; the style alone cannot carry them
  if (it.style === "junction") return buildJunctionModel(it.junction!);
  if (it.style === "road") return buildRoadModel(it.ring, isRoadKind(it.kind) ? it.kind : "path", { start: it.ends?.[0], end: it.ends?.[1] });
  if (it.progress < 1) return buildScaffold(it.ring, it.height, it.progress);
  if (it.style === "heritage") return buildHeritageModel(it.ring, it.height, it.kind);
  return buildTownModel(it.ring, it.height, it.kind, { level: it.level, front: it.front, tint: it.tint || null, upgrading: it.upgrading });
}

// A chimney top of a finished building (Model.smoke), town-local metres with the ground under it: where the smoke
// rises (view/engine/smoke.ts). lamp: the building is lived in or worked in (the item's lamp).
export interface Emitter {
  id: string | number;
  kind: string;
  style: ModelItem["style"];
  lamp?: Light["kind"];
  x: number;
  y: number;
  z: number;
}
export const modelEmitters = signal<Emitter[]>([]);
if (import.meta.env.DEV) Object.assign(window, { modelEmitters }); // devtools: modelEmitters.value = [...] to try the smoke

const LAMP_CODE: Record<Light["kind"], number> = { house: 1, work: 2, tavern: 3 };
// Lamp attribute of an item: its kind plus a seed from its id in 0..1 (which of its windows are lit).
export function lampOf(it: ModelItem): number {
  if (!it.lamp) return 0;
  let h = 7;
  for (const ch of String(it.id)) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return LAMP_CODE[it.lamp] + (h % 997) / 1000;
}

export const quantise = (p: number): number => (p >= 1 ? 1 : Math.min(PROGRESS_STEPS - 1, Math.max(0, Math.floor((Number.isFinite(p) ? p : 0) * PROGRESS_STEPS))) / PROGRESS_STEPS);
const armKey = (j: RoadJunction): string => j.arms.map((a) => `${a.kind}:${a.hw}:${a.dir[0]},${a.dir[1]}:${a.len}`).join(";");
// Everything that shapes an item's model (its id is not: two identical buildings share a model).
export const keyOf = (it: ModelItem, p: number, k: number): string => {
  const ring = `${it.ring.map((q) => `${q[0]},${q[1]}`).join(";")}|${k}`;
  if (it.style === "road") return `road|${it.kind}|${it.ends?.map((e) => (e ? 1 : 0)).join("") ?? ""}|${ring}`;
  if (it.style === "junction") return `junction|${it.junction ? armKey(it.junction) : ""}|${ring}`;
  if (p < 1) return `site|${it.height}|${p}|${ring}`;
  const f = it.front ? `${it.front[0].toFixed(3)},${it.front[1].toFixed(3)}` : "";
  return `${it.style}|${it.kind}|${it.height}|${it.level ?? 1}|${f}|${it.tint ?? ""}|${it.upgrading ? 1 : 0}|${lampOf(it)}|${ring}`;
};


// Debug switch (localStorage "debug3dModels" = "1", dev): every model kind side by side around the town centre, the
// town templates in rows, the restored kinds below, a few building sites, each road and bridge kind. Scale via
// localStorage "debug3dModelsScale" (at 40 the set reads at globe zooms). In dev `window.modelItems` is the item signal
// for hand-made lists.
const rect = (cx: number, cy: number, w: number, d: number, rot = 0): XY[] => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as XY[]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
};
const DEMO_K = (() => {
  try {
    return Number(localStorage.getItem("debug3dModelsScale")) || 1;
  } catch {
    return 1;
  }
})();
const scaled = (ring: XY[]): XY[] => ring.map(([x, y]) => [x * DEMO_K, y * DEMO_K]);

export function demoModelItems(): ModelItem[] {
  const out: ModelItem[] = [];
  let id = 1;
  // town templates: the street runs along y = 0 between the two rows, doors face it
  const templates = Object.values(BUILDINGS).filter((t) => t.id !== "restored");
  templates.forEach((t, i) => {
    const row = i % 2 === 0 ? 1 : -1;
    const x = -100 + Math.floor(i / 2) * 16;
    const cy = row * (4 + t.deep / 2);
    out.push({ id: id++, ring: scaled(rect(x, cy, t.along, t.deep)), height: t.height * DEMO_K, kind: t.id, progress: 1, style: "town", front: [0, -row] });
  });
  // a street of houses: same template, different seeds; a rebuilt one, an upgrading one, a tinted one
  for (let k = 0; k < 8; k++) {
    const t = BUILDINGS[k % 3 === 2 ? "izba5" : "izba"];
    out.push({ id: id++, ring: scaled(rect(-100 + k * 11, 30, t.along, t.deep)), height: (t.height + (k === 5 ? 1.5 : 0)) * DEMO_K, kind: t.id, progress: 1, style: "town", front: [0, -1], level: k === 5 ? 2 : 1, upgrading: k === 6, tint: k === 7 ? "#6f8a3a" : "" });
  }
  // building sites
  for (const [k, p] of [0.1, 0.5, 0.9].entries()) out.push({ id: id++, ring: scaled(rect(-12 + k * 11, 30, 6, 7)), height: 5 * DEMO_K, kind: "izba", progress: p, style: "town" });
  // restored kinds
  const heritage: [XY[], number, string][] = [
    [rect(-100, -40, 18, 10), 6, "house"],
    [rect(-75, -40, 14, 11), 8, "place_of_worship"],
    [rect(-50, -40, 16, 9, 0.5), 5, "school"],
    [rect(-20, -40, 30, 12), 4, "station"],
    [rect(10, -40, 10, 10), 8, "castle"],
    [[[25, -50], [45, -50], [45, -42], [37, -42], [37, -28], [25, -28]], 6, "house"],
    [rect(70, -40, 36, 12, 0.3), 8, "place_of_worship"],
  ];
  for (const [ring, h, kind] of heritage) out.push({ id: id++, ring: scaled(ring), height: h * DEMO_K, kind, progress: 1, style: "heritage" });
  // roads: the street between the template rows, a curve, and each bridge kind
  const road = (kind: string, pts: XY[]) => out.push({ id: `r${id++}`, ring: scaled(pts), height: 0, kind, progress: 1, style: "road" });
  road("dirt", [[-110, 0], [110, 0]]);
  road("path", [[-110, 30 - 6], [0, 30 - 6]]);
  road("stone", [[0, 30 - 6], [60, 24], [90, 10], [110, 0]]);
  road("path", Array.from({ length: 13 }, (_, k): XY => [-110 + 14 * Math.cos((k / 12) * Math.PI), -15 - 14 * Math.sin((k / 12) * Math.PI)]));
  road("footbridge", [[-100, -60], [-70, -60]]);
  road("bridge", [[-60, -60], [-25, -64], [5, -60]]);
  road("stonebridge", [[15, -60], [75, -60]]);
  return out;
}

