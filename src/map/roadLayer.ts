import type maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { ROAD_KINDS, workableEdges } from "../sim/roads";
import { city, frame, roads } from "../simClient";

const SRC = "roads";
const EQUATOR_M = 40075016.686;

const BUILT_COLOR = ["match", ["get", "kind"], "dirt", "#a88a5a", "#c8b48a"];
const CASING_COLOR = ["match", ["get", "kind"], "dirt", "#6f5a38", "#a89870"];

// Width in px of `meters` of ground at zoom z (MapLibre uses 512 px tiles), at least 1 px,
// plus `extra` px. Integer-zoom stops keep the exponential interpolation exact.
function realWidth(k: number, extra = 0): maplibregl.ExpressionSpecification {
  const stops: unknown[] = [];
  for (let z = 8; z <= 22; z++) stops.push(z, ["+", ["max", 1, ["*", ["get", "w"], k * 2 ** z]], extra]);
  return ["interpolate", ["exponential", 2], ["zoom"], ...stops] as maplibregl.ExpressionSpecification;
}

// Roads as lines at real width; planned and waiting edges are dashed and faded.
export function attachRoadLayer(map: maplibregl.Map): void {
  let styled = false;

  const addLayers = (lat: number) => {
    const k = 512 / (EQUATOR_M * Math.cos((lat * Math.PI) / 180));
    map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    const common = { source: SRC, layout: { "line-cap": "butt", "line-join": "round" } } as const;
    map.addLayer({
      ...common,
      id: "roads-casing",
      type: "line",
      filter: ["==", ["get", "state"], "built"],
      paint: { "line-color": CASING_COLOR as never, "line-width": realWidth(k, 1.5) },
    });
    map.addLayer({
      ...common,
      id: "roads-built",
      type: "line",
      filter: ["==", ["get", "state"], "built"],
      paint: { "line-color": BUILT_COLOR as never, "line-width": realWidth(k) },
    });
    map.addLayer({
      ...common,
      id: "roads-planned",
      type: "line",
      filter: ["!=", ["get", "state"], "built"],
      paint: {
        "line-color": BUILT_COLOR as never,
        "line-width": realWidth(k),
        "line-opacity": ["match", ["get", "state"], "active", 0.5, 0.28],
        "line-dasharray": [2, 2],
      },
    });
    styled = true;
  };

  const apply = () => {
    const c = city.value;
    const f = frame.value;
    const g = roads.value;
    if (!c || !f || !g) return;
    if (!styled) addLayers(c.lat); // one city per page load
    const active = new Set(workableEdges(g));
    const features: GeoJSON.Feature[] = Object.values(g.edges).map((e) => {
      const a = g.nodes[e.a];
      const b = g.nodes[e.b];
      const built = e.done >= e.labor;
      return {
        type: "Feature",
        properties: {
          id: e.id,
          kind: e.kind,
          w: ROAD_KINDS[e.kind].width,
          state: built ? "built" : active.has(e.id) ? "active" : "waiting",
          progress: e.labor > 0 ? e.done / e.labor : 1,
        },
        geometry: { type: "LineString", coordinates: [f.toLngLat(a.x, a.y), f.toLngLat(b.x, b.y)] },
      };
    });
    (map.getSource(SRC) as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
  };

  const run = () => effect(apply);
  if (map.isStyleLoaded()) run();
  else map.once("load", run);
}
