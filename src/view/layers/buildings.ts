import { computed, signal, type ReadonlySignal } from "@preact/signals";
import { BUILDINGS } from "../../sim/buildings";
import type { Feature, FeatureCollection } from "geojson";
import { covers } from "../../sim/services";
import type { Building, ClientState, FoundFoundation } from "../../sim/types";
import { pointInPolygon } from "../../sim/zones";
import { buildings, buildingSet, city, frame, lifeLights, state } from "../../simClient";
import type { Frame } from "../../world/frame";
import { mixHex } from "../../ui/palette";
import type { ModelItem } from "../../map/modelItems";
import { lastTool, overlay, OVERLAY_COLORS, tool, toolOfTemplate, type Overlay } from "../../map/tools";
import { pickTool } from "../../map/toolPick";
import { shouldRepeatTool } from "../../ui/inputModel";
import { buildBuildingSpatialIndex, buildingSpatialCandidates, type BuildingSpatialIndex } from "../../map/buildingHitIndex";
import { progressStep, sameKey, type ItemKey } from "./itemMemo";
import type { View } from "../view";
import { selectedBuilding } from "../selection";

// Buildings on the map: the model items (finished ones and building sites, the engine's models), the footprints as GeoJSON (planned lots, outlines) and picking a building with the pointer.

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

// Unit vector from a lot towards its road (the door side): the opposite of growth.ts `away`; towards its door when it has one.
const towardsRoad = (b: Building): [number, number] => {
  if (b.door) {
    const dx = b.door[0] - b.lot.cx;
    const dy = b.door[1] - b.lot.cy;
    const l = Math.hypot(dx, dy);
    if (l > 1e-6) return [dx / l, dy / l];
  }
  return [Math.sin(b.lot.angle) * b.side, -Math.cos(b.lot.angle) * b.side];
};

// What the model layer draws of the buildings: every one that is not just planned. A restored old building is drawn by its OSM class.
// The same list comes back while nothing visible changed, so the layer does not rebuild every tick.
let lastItems: ModelItem[] = [];
// The foundations of the finds by id: a heritage building looked its site up by scanning them all, on every snapshot.
let findsFor: ClientState["finds"] | null = null;
let foundationsById = new Map<string, FoundFoundation>();
function foundationsOf(finds: ClientState["finds"]): Map<string, FoundFoundation> {
  if (finds !== findsFor) {
    findsFor = finds;
    foundationsById = new Map(finds.foundations.map((f) => [f.id, f]));
  }
  return foundationsById;
}
// What each item was made of (itemMemo.ts decides whether that is still the same picture). An untouched building is
// the same object in the next snapshot (sim/delta.ts sends only what changed), so its item comes back instead of being
// built again.
const itemMemos = new Map<number, { key: ItemKey; item: ModelItem }>();
export const buildingItems: ReadonlySignal<ModelItem[]> = computed(() => {
  const st = state.value;
  const ov = overlay.value;
  if (!st) return lastItems;
  // which buildings light up in the evening, and how (sim/life.ts)
  const lamps = new Map(lifeLights.value.map((l) => [l.id, l.kind]));
  const flag = city.value?.flag;
  const foundations = foundationsOf(st.finds);
  const out: ModelItem[] = [];
  let changed = false;
  for (const b of Object.values(st.buildings)) {
    if (b.state === "planned" || BUILDINGS[b.template]?.workSite) continue; // a foundation dig draws on the ruins layer
    const progress = b.state === "active" ? 1 : b.labor > 0 ? Math.min(1, b.done / b.labor) : 0;
    const lamp = lamps.get(b.id);
    // an old building brought back as it was, or kept as a monument, is drawn as the old one
    const heritage = !!(b.foundationId && (b.asItWas || BUILDINGS[b.template]?.monument));
    const flies = !heritage && progress === 1 && BUILDINGS[b.template]?.seat ? flag : undefined;
    const key: ItemKey = {
      building: b,
      finds: st.finds,
      overlay: ov,
      lamp,
      flag: flies,
      tint: heritage ? "" : tintOf(b, ov, st),
      step: progressStep(progress),
    };
    const memo = itemMemos.get(b.id);
    if (memo && sameKey(memo.key, key)) {
      out.push(memo.item);
      continue;
    }
    const item: ModelItem = heritage
      ? { id: b.id, ring: b.footprint, height: b.height, kind: foundations.get(b.foundationId!)?.cls ?? "", progress, style: "heritage", lamp }
      : { id: b.id, ring: b.footprint, height: b.height, kind: b.template, progress, style: "town", level: b.level, front: towardsRoad(b), tint: key.tint, upgrading: !!b.upgrade, lamp, flag: flies };
    itemMemos.set(b.id, { key, item });
    out.push(item);
    changed = true;
  }
  if (changed || out.length !== lastItems.length) lastItems = out;
  // memos of buildings that are gone, once they outnumber the living ones
  if (itemMemos.size > lastItems.length * 2 + 64) for (const id of itemMemos.keys()) if (!(id in st.buildings)) itemMemos.delete(id);
  return lastItems;
});

// Footprints in lng/lat with `state` and `up` (upgrading). The same collection comes back while none of that changed:
// work on a site moves its progress every tick, and the overlay is not drawn again for it.
const NO_SHAPES: FeatureCollection = { type: "FeatureCollection", features: [] };
let shapes = NO_SHAPES;
let shapesFrame: Frame | null = null;
let shapesSig = "";
export const buildingShapes: ReadonlySignal<FeatureCollection> = computed(() => {
  const list = buildings.value;
  const f = frame.value;
  if (!list || !f) return NO_SHAPES;
  let sig = "";
  for (const b of Object.values(list)) sig += `${b.id}:${b.state}:${b.upgrade ? 1 : 0},`;
  if (f === shapesFrame && sig === shapesSig) return shapes;
  shapesFrame = f;
  shapesSig = sig;
  const features: Feature[] = Object.values(list).map((b) => ({
    type: "Feature",
    properties: { id: b.id, state: b.state, up: !!b.upgrade },
    geometry: { type: "Polygon", coordinates: [ringOf(b, f)] },
  }));
  if (ringCache.size > features.length * 3 + 100) {
    for (const id of ringCache.keys()) if (!(id in list)) ringCache.delete(id);
  }
  shapes = { type: "FeatureCollection", features };
  return shapes;
});

// Hit-test footprints in the town frame (an index, not the renderer: neither renderer can be asked reliably).
// `slop` (m): a miss also tries points that far around, nearer ring first, so a fingertip beside a house still finds it.
const TOUCH_SLOP_PX = 16;
const MAX_SLOP_M = 15;
const PROBES = 8;
function buildingAt(lng: number, lat: number, slop = 0): number | null {
  const list = buildings.value;
  const f = frame.value;
  if (!list || !f) return null;
  const [x, y] = f.toLocal(lng, lat);
  const index = hitIndexOf(list);
  const at = (px: number, py: number): number | null => {
    for (const id of buildingSpatialCandidates(index, px, py)) {
      const b = list[id];
      if (b && pointInPolygon(px, py, b.footprint)) return b.id;
    }
    return null;
  };
  const hit = at(x, y);
  if (hit !== null || slop <= 0) return hit;
  for (const r of [slop / 2, slop]) {
    for (let k = 0; k < PROBES; k++) {
      const a = (k / PROBES) * Math.PI * 2;
      const near = at(x + r * Math.cos(a), y + r * Math.sin(a));
      if (near !== null) return near;
    }
  }
  return null;
}

// Click selects a building while no tool is active; the pointer shows over one; Escape lets go.
export function attachBuildingPick(view: View): void {
  view.on("click", (e) => {
    if (tool.value || e.original.defaultPrevented) return; // a resident took the click (view/engine/life.ts)
    const slop = e.pointerType === "touch" ? Math.min(MAX_SLOP_M, TOUCH_SLOP_PX * view.metersPerPixel()) : 0;
    selectedBuilding.value = buildingAt(e.lngLat[0], e.lngLat[1], slop);
  });
  // Middle click: the pipette, the tool and kind of the building or plan under the pointer; over open ground, the last
  // tool again.
  view.on("pointerdown", (e) => {
    if (e.original.button !== 1 || !e.isPrimary) return;
    const id = buildingAt(e.lngLat[0], e.lngLat[1]);
    const b = id === null ? undefined : buildings.peek()?.[id];
    const pick = b ? toolOfTemplate(b.template) : null;
    if (pick) {
      e.original.preventDefault();
      pickTool(pick.tool, pick.variant);
    } else if (shouldRepeatTool(1, tool.peek(), lastTool.peek())) {
      e.original.preventDefault();
      tool.value = lastTool.peek();
    }
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
