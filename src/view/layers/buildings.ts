import { computed, signal, type ReadonlySignal } from "@preact/signals";
import type { Feature, FeatureCollection } from "geojson";
import { covers } from "../../sim/services";
import type { Building, ClientState } from "../../sim/types";
import { pointInPolygon } from "../../sim/zones";
import { buildings, buildingSet, frame, lifeLights, state } from "../../simClient";
import type { Frame } from "../../world/frame";
import { mixHex } from "../../ui/palette";
import type { ModelItem } from "../../map/modelItems";
import { overlay, OVERLAY_COLORS, tool, type Overlay } from "../../map/tools";
import { buildBuildingSpatialIndex, buildingSpatialCandidates, type BuildingSpatialIndex } from "../../map/buildingHitIndex";
import type { View } from "../view";

// Buildings on the map: the model items (finished ones and building sites, the engine's models), the footprints as GeoJSON (planned lots, outlines) and picking a building with the pointer.

// Building shown in the info panel.
export const selectedBuilding = signal<number | null>(null);

const ringCache = new Map<number, [number, number][]>();

let hitIndexFor = "";
let hitIndex: BuildingSpatialIndex = buildBuildingSpatialIndex([]);

function hitIndexOf(list: Record<number, Building>): BuildingSpatialIndex {
  const sig = buildingSet.peek();
  if (sig !== hitIndexFor) {
    hitIndexFor = sig;
    hitIndex = buildBuildingSpatialIndex(Object.values(list));
  }
  return hitIndex;
}

function ringOf(b: Building, f: Frame): [number, number][] {
  const hit = ringCache.get(b.id);
  if (hit) return hit;
  const pts = b.footprint.map(([x, y]) => f.toLngLat(x, y));
  const ring = [...pts, pts[0]];
  ringCache.set(b.id, ring);
  return ring;
}

const { good: GOOD, mid: MID, bad: BAD, neutral: NEUTRAL } = OVERLAY_COLORS;
// 0 (bad) .. 1 (good): red through yellow to green.
const gradient = (t: number): string => (t < 0.5 ? mixHex(BAD, MID, t * 2) : mixHex(MID, GOOD, (t - 0.5) * 2));

// Overlay colour of a finished house ("" = keep its own colour).
function tintOf(b: Building, ov: Overlay, st: ClientState): string {
  if (ov === "none" || ov === "traffic" || b.zone !== "res" || b.state !== "active") return "";
  if (ov === "value") return gradient((st.landValue[b.id] ?? 0) / 100);
  if (ov === "mood") {
    const m = st.houseMood[b.id];
    return m === undefined ? NEUTRAL : gradient(m / 100);
  }
  return covers(st.coverage[b.id], ov) ? GOOD : BAD;
}

// Unit vector from a lot towards its road (the door side): the opposite of growth.ts `away`.
const towardsRoad = (b: Building): [number, number] => [Math.sin(b.lot.angle) * b.side, -Math.cos(b.lot.angle) * b.side];

// What the model layer draws of the buildings: every one that is not just planned. A restored old building is drawn by its OSM class.
// The same list comes back while nothing visible changed, so the layer does not rebuild every tick.
let lastItems: ModelItem[] = [];
const itemSig = (i: ModelItem): string => `${i.id}|${i.kind}|${i.height}|${i.progress >= 1 ? 1 : Math.floor(i.progress * 24)}|${i.level ?? 1}|${i.tint ?? ""}|${i.upgrading ? 1 : 0}|${i.lamp ?? ""}`;
export const buildingItems: ReadonlySignal<ModelItem[]> = computed(() => {
  const st = state.value;
  const ov = overlay.value;
  if (!st) return lastItems;
  // which buildings light up in the evening, and how (sim/life.ts)
  const lamps = new Map(lifeLights.value.map((l) => [l.id, l.kind]));
  const out: ModelItem[] = [];
  for (const b of Object.values(st.buildings)) {
    if (b.state === "planned") continue;
    const progress = b.state === "active" ? 1 : b.labor > 0 ? Math.min(1, b.done / b.labor) : 0;
    if (b.siteId) {
      const site = st.finds.foundations.find((f) => f.id === b.siteId);
      out.push({ id: b.id, ring: b.footprint, height: b.height, kind: site?.cls ?? "", progress, style: "heritage", lamp: lamps.get(b.id) });
    } else
      out.push({ id: b.id, ring: b.footprint, height: b.height, kind: b.template, progress, style: "town", level: b.level, front: towardsRoad(b), tint: tintOf(b, ov, st), upgrading: !!b.upgrade, lamp: lamps.get(b.id) });
  }
  if (out.length !== lastItems.length || out.some((it, k) => itemSig(it) !== itemSig(lastItems[k]))) lastItems = out;
  return lastItems;
});

// Footprints in lng/lat with `state` and `up` (upgrading).
export const buildingShapes: ReadonlySignal<FeatureCollection> = computed(() => {
  const list = buildings.value;
  const f = frame.value;
  if (!list || !f) return { type: "FeatureCollection", features: [] };
  const features: Feature[] = Object.values(list).map((b) => ({
    type: "Feature",
    properties: { id: b.id, state: b.state, up: !!b.upgrade },
    geometry: { type: "Polygon", coordinates: [ringOf(b, f)] },
  }));
  if (ringCache.size > features.length * 3 + 100) {
    for (const id of ringCache.keys()) if (!(id in list)) ringCache.delete(id);
  }
  return { type: "FeatureCollection", features };
});

// Hit-test footprints in the town frame (an index, not the renderer: neither renderer can be asked reliably).
function buildingAt(lng: number, lat: number): number | null {
  const list = buildings.value;
  const f = frame.value;
  if (!list || !f) return null;
  const [x, y] = f.toLocal(lng, lat);
  const index = hitIndexOf(list);
  for (const id of buildingSpatialCandidates(index, x, y)) {
    const b = list[id];
    if (b && pointInPolygon(x, y, b.footprint)) return b.id;
  }
  return null;
}

// Click selects a building while no tool is active; the pointer shows over one; Escape lets go.
export function attachBuildingPick(view: View): void {
  view.on("click", (e) => {
    if (tool.value) return;
    selectedBuilding.value = buildingAt(e.lngLat[0], e.lngLat[1]);
  });
  let pointer = false;
  view.on("pointermove", (e) => {
    const over = !tool.value && buildingAt(e.lngLat[0], e.lngLat[1]) !== null;
    if (over === pointer) return;
    pointer = over;
    view.canvas.style.cursor = over ? "pointer" : "";
  });
  view.canvas.addEventListener("pointerleave", () => {
    pointer = false;
    if (!tool.value) view.canvas.style.cursor = "";
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selectedBuilding.value !== null && !tool.value) selectedBuilding.value = null;
  });
}
