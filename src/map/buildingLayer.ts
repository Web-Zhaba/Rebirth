import type maplibregl from "maplibre-gl";
import type { ExpressionSpecification } from "maplibre-gl";
import type { Feature, FeatureCollection, Point, Polygon } from "geojson";
import { effect } from "@preact/signals";
import { cellToBoundary, cellToLatLng } from "h3-js";
import { BUILDING_TYPES, BUILDINGS } from "../game/defs";
import type { PlacedBuilding } from "../game/sim";
import { economy } from "../game/state";

const SRC = "buildings";
const ICON_PX = 64;

function emojiImage(emoji: string): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ICON_PX;
  const ctx = canvas.getContext("2d")!;
  ctx.font = `${ICON_PX * 0.75}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(emoji, ICON_PX / 2, ICON_PX / 2 + 3);
  return ctx.getImageData(0, 0, ICON_PX, ICON_PX);
}

function toData(buildings: Record<string, PlacedBuilding>): { hexes: FeatureCollection<Polygon>; icons: FeatureCollection<Point> } {
  const hexes: Feature<Polygon>[] = [];
  const icons: Feature<Point>[] = [];
  for (const [cell, b] of Object.entries(buildings)) {
    const ring = cellToBoundary(cell, true);
    ring.push(ring[0]);
    hexes.push({ type: "Feature", properties: { type: b.type }, geometry: { type: "Polygon", coordinates: [ring] } });
    const [lat, lng] = cellToLatLng(cell);
    icons.push({ type: "Feature", properties: { type: b.type }, geometry: { type: "Point", coordinates: [lng, lat] } });
  }
  return { hexes: { type: "FeatureCollection", features: hexes }, icons: { type: "FeatureCollection", features: icons } };
}

const EMPTY = { type: "FeatureCollection", features: [] } as const;

// Draws every building as a coloured hex plus an emoji icon; re-renders when the building set changes.
export function attachBuildingLayer(map: maplibregl.Map): void {
  let ready = false;
  let last: Record<string, PlacedBuilding> | null = null;

  const render = () => {
    // Read the signal before any early return, or the effect never subscribes to it.
    const b = economy.value?.buildings ?? null;
    if (!ready || b === last) return;
    last = b;
    const data = b ? toData(b) : { hexes: EMPTY, icons: EMPTY };
    (map.getSource(`${SRC}-hex`) as maplibregl.GeoJSONSource | undefined)?.setData(data.hexes as FeatureCollection);
    (map.getSource(`${SRC}-icon`) as maplibregl.GeoJSONSource | undefined)?.setData(data.icons as FeatureCollection);
  };

  const init = () => {
    for (const t of BUILDING_TYPES) map.addImage(`bld-${t}`, emojiImage(BUILDINGS[t].emoji), { pixelRatio: 2 });
    // Stay under the hover outline if it already exists.
    const before = map.getLayer("cell-hover-line") ? "cell-hover-line" : undefined;
    map.addSource(`${SRC}-hex`, { type: "geojson", data: EMPTY as unknown as FeatureCollection });
    map.addSource(`${SRC}-icon`, { type: "geojson", data: EMPTY as unknown as FeatureCollection });
    const colors = BUILDING_TYPES.flatMap((t) => [t, BUILDINGS[t].color]);
    map.addLayer(
      {
        id: `${SRC}-fill`,
        type: "fill",
        source: `${SRC}-hex`,
        paint: { "fill-color": ["match", ["get", "type"], ...colors, "#000000"] as unknown as ExpressionSpecification, "fill-opacity": 0.55 },
      },
      before,
    );
    map.addLayer(
      {
        id: `${SRC}-icons`,
        type: "symbol",
        source: `${SRC}-icon`,
        layout: {
          "icon-image": ["concat", "bld-", ["get", "type"]],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
          "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.3, 14, 0.8, 17, 1.6],
        },
      },
      before,
    );
    ready = true;
    render();
  };

  // isStyleLoaded() is also false while tiles stream in, so wait for "idle" like the other layers.
  if (map.isStyleLoaded()) init();
  else map.once("idle", init);
  effect(render);
}
