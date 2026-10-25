import type maplibregl from "maplibre-gl";
import { effect, signal } from "@preact/signals";
import { covers } from "../sim/services";
import type { Building, ClientState } from "../sim/types";
import { pointInPolygon } from "../sim/zones";
import { buildings, frame, state } from "../simClient";
import type { Frame } from "../world/frame";
import { mixHex, PALETTE } from "../ui/palette";
import { BUILDING_COLORS, overlay, OVERLAY_COLORS, PLACED_COLORS, tool, type Overlay } from "./tools";

const SRC = "buildings";

// Building shown in the info panel.
export const selectedBuilding = signal<number | null>(null);

const ringCache = new Map<number, [number, number][]>();

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

// Buildings as fill-extrusions at real size: finished ones in full colour, those under construction
// pale and growing with progress, planned ones as a dashed outline.
export function attachBuildingLayer(map: maplibregl.Map): void {
  let ready = false;

  const setup = () => {
    map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const byZone = ["match", ["get", "zone"], "res", BUILDING_COLORS.res, "craft", BUILDING_COLORS.craft, BUILDING_COLORS.trade];
    // Placed buildings have a colour of their own per template.
    const placed = ["match", ["get", "template"], ...Object.entries(PLACED_COLORS).flat(), byZone];
    // An overlay tint wins over the building's own colour.
    const color = ["case", ["!=", ["get", "tint"], ""], ["to-color", ["get", "tint"]], placed];
    map.addLayer({
      id: "buildings-active",
      type: "fill-extrusion",
      source: SRC,
      filter: ["==", ["get", "state"], "active"],
      paint: {
        "fill-extrusion-color": color as never,
        "fill-extrusion-height": ["get", "h"],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.95,
      },
    });
    map.addLayer({
      id: "buildings-building",
      type: "fill-extrusion",
      source: SRC,
      filter: ["==", ["get", "state"], "building"],
      paint: {
        "fill-extrusion-color": PALETTE.paperRaised,
        "fill-extrusion-height": ["get", "hp"],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.75,
      },
    });
    map.addLayer({
      id: "buildings-planned-fill",
      type: "fill",
      source: SRC,
      filter: ["==", ["get", "state"], "planned"],
      paint: { "fill-color": PALETTE.paperRaised, "fill-opacity": 0.4 },
    });
    map.addLayer({
      id: "buildings-planned",
      type: "line",
      source: SRC,
      filter: ["==", ["get", "state"], "planned"],
      paint: { "line-color": PALETTE.ink2, "line-width": 1.5, "line-dasharray": [2, 1.5] },
    });
    // Footprint outlines in ink: finished and growing buildings keep an edge on any ground; a house being rebuilt
    // (upgrade) gets a heavier amber one.
    map.addLayer({
      id: "buildings-outline",
      type: "line",
      source: SRC,
      filter: ["in", ["get", "state"], ["literal", ["active", "building"]]],
      paint: {
        "line-color": ["case", ["get", "up"], PALETTE.warn, PALETTE.ink],
        "line-width": ["case", ["get", "up"], 3, 1],
        "line-opacity": ["case", ["get", "up"], 1, 0.55],
      },
    });
    ready = true;

    effect(() => {
      const list = buildings.value;
      const f = frame.value;
      const st = state.value;
      const ov = overlay.value;
      if (!list || !f || !st) return;
      const features: GeoJSON.Feature[] = Object.values(list).map((b) => {
        const progress = b.labor > 0 ? Math.min(1, b.done / b.labor) : 1;
        return {
          type: "Feature",
          properties: {
            id: b.id,
            zone: b.zone,
            template: b.template,
            state: b.state,
            up: !!b.upgrade,
            tint: tintOf(b, ov, st),
            h: b.height,
            hp: Math.max(0.5, b.height * progress),
          },
          geometry: { type: "Polygon", coordinates: [ringOf(b, f)] },
        };
      });
      (map.getSource(SRC) as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
      if (ringCache.size > features.length * 3 + 100) {
        for (const id of ringCache.keys()) if (!(id in list)) ringCache.delete(id);
      }
    });
  };

  // Hit-test footprints ourselves: under the globe projection MapLibre's queryRenderedFeatures
  // returns nothing for fill-extrusion layers.
  const buildingAt = (lng: number, lat: number): number | null => {
    const list = buildings.value;
    const f = frame.value;
    if (!list || !f) return null;
    const [x, y] = f.toLocal(lng, lat);
    for (const b of Object.values(list)) if (pointInPolygon(x, y, b.footprint)) return b.id;
    return null;
  };

  // Click selects a building while no tool is active.
  map.on("click", (e) => {
    if (!ready || tool.value) return;
    selectedBuilding.value = buildingAt(e.lngLat.lng, e.lngLat.lat);
  });
  let pointer = false;
  map.on("mousemove", (e) => {
    const over = ready && !tool.value && buildingAt(e.lngLat.lng, e.lngLat.lat) !== null;
    if (over === pointer) return;
    pointer = over;
    map.getCanvas().style.cursor = over ? "pointer" : "";
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && selectedBuilding.value !== null && !tool.value) selectedBuilding.value = null;
  });

  if (map.isStyleLoaded()) setup();
  else map.once("load", setup);
}
