import type * as maplibregl from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { PALETTE } from "../../ui/palette";
import type { Overlay, OverlayId } from "../view";

// The game's overlays as GeoJSON sources and layers. Each id is one source of the same name; a group is added together,
// in order, the first time one of its members gets something to draw (so the layers sit above everything added before).

type Spec = { layers: object[]; beforeId?: string };

const PLACE_COLOR = ["case", ["get", "pending"], PALETTE.warn, ["get", "ok"], PALETTE.ok, PALETTE.bad];

const SPECS: Record<OverlayId, Spec> = {
  "road-hover": {
    layers: [{ id: "road-hover", type: "line", source: "road-hover", paint: { "line-color": PALETTE.bad, "line-width": 6, "line-opacity": 0.75 } }],
  },
  "road-preview": {
    layers: [
      {
        id: "road-preview",
        type: "line",
        source: "road-preview",
        paint: { "line-color": ["case", ["get", "ok"], PALETTE.ok, PALETTE.bad], "line-width": 3, "line-dasharray": [2, 1.5] },
      },
    ],
  },
  "road-snap": {
    layers: [
      {
        id: "road-snap",
        type: "circle",
        source: "road-snap",
        paint: { "circle-radius": 6, "circle-color": PALETTE.paperRaised, "circle-stroke-color": PALETTE.info, "circle-stroke-width": 2 },
      },
    ],
  },
  "place-radius": {
    layers: [
      { id: "place-radius-fill", type: "fill", source: "place-radius", paint: { "fill-color": PALETTE.paperRaised, "fill-opacity": 0.25 } },
      { id: "place-radius-line", type: "line", source: "place-radius", paint: { "line-color": PALETTE.ink2, "line-width": 1.5, "line-dasharray": [3, 2], "line-opacity": 0.7 } },
    ],
  },
  "place-lot": {
    layers: [
      { id: "place-lot-fill", type: "fill", source: "place-lot", paint: { "fill-color": PLACE_COLOR, "fill-opacity": 0.45 } },
      { id: "place-lot-line", type: "line", source: "place-lot", paint: { "line-color": PLACE_COLOR, "line-width": 2 } },
    ],
  },
  "reveal-disc": {
    layers: [
      { id: "reveal-disc-fill", type: "fill", source: "reveal-disc", paint: { "fill-color": PALETTE.info, "fill-opacity": 0.18 } },
      { id: "reveal-disc-line", type: "line", source: "reveal-disc", paint: { "line-color": PALETTE.info, "line-width": 2, "line-dasharray": [3, 2] } },
    ],
  },
  "follow-target": {
    beforeId: "life-walkers",
    layers: [
      {
        id: "follow-target",
        type: "circle",
        source: "follow-target",
        paint: {
          "circle-radius": 12,
          "circle-color": PALETTE.warn,
          "circle-opacity": 0.12,
          "circle-stroke-color": PALETTE.warn,
          "circle-stroke-width": 2,
          "circle-stroke-opacity": 0.9,
          "circle-pitch-alignment": "map",
        },
      },
    ],
  },
};

// Overlays added together so their layers keep this order.
const GROUPS: OverlayId[][] = [["road-hover", "road-preview", "road-snap"], ["place-radius", "place-lot"], ["reveal-disc"], ["follow-target"]];
const groupOf = (id: OverlayId) => GROUPS.find((g) => g.includes(id))!;

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

export function createOverlays(map: maplibregl.Map): (id: OverlayId) => Overlay {
  const latest = new Map<OverlayId, FeatureCollection>();
  const source = (id: OverlayId) => map.getSource(id) as maplibregl.GeoJSONSource | undefined;

  // Adds the group of `id` when it is missing; false while the style is not ready.
  const ensure = (id: OverlayId): boolean => {
    if (source(id)) return true;
    if (!map.isStyleLoaded()) return false;
    for (const member of groupOf(id)) {
      if (source(member)) continue;
      map.addSource(member, { type: "geojson", data: latest.get(member) ?? EMPTY });
      const { layers, beforeId } = SPECS[member];
      for (const layer of layers) map.addLayer(layer as never, beforeId && map.getLayer(beforeId) ? beforeId : undefined);
    }
    return true;
  };

  // The style may be swapped or finish loading later: add what has something to show, keep the data of what exists.
  const sync = () => {
    for (const [id, data] of latest) {
      if (source(id) || data.features.length === 0) continue; // present (and current), or nothing to show
      ensure(id); // creates the group with the latest data of each member
    }
  };
  map.on("styledata", sync);
  map.on("load", sync);

  const cache = new Map<OverlayId, Overlay>();
  return (id) => {
    let o = cache.get(id);
    if (!o) {
      o = {
        setData(data) {
          latest.set(id, data);
          if (data.features.length === 0 && !source(id)) return; // nothing to clear yet
          if (ensure(id)) source(id)?.setData(data);
        },
      };
      cache.set(id, o);
    }
    return o;
  };
}
