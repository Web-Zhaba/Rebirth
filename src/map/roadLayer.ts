import type maplibregl from "maplibre-gl";
import { effect } from "@preact/signals";
import { cutOffEdges, ROAD_KINDS, workableEdges } from "../sim/roads";
import { roadChains, type RoadState } from "./roadChains";
import { PALETTE } from "../ui/palette";
import { city, frame, roads } from "../simClient";

const SRC = "roads";
const EQUATOR_M = 40075016.686;

const BUILT_COLOR = ["match", ["get", "kind"], "dirt", PALETTE.roadDirt, "footbridge", PALETTE.roadBridge, "bridge", PALETTE.roadBridge, PALETTE.roadPath];
const CUT_COLOR = PALETTE.bad; // roads no work party can reach
const CASING_COLOR = ["match", ["get", "kind"], "dirt", PALETTE.roadDirtEdge, "footbridge", PALETTE.roadBridgeEdge, "bridge", PALETTE.roadBridgeEdge, PALETTE.roadPathEdge];

// Width in px of `meters` of ground at zoom z (MapLibre uses 512 px tiles), at least 1 px,
// plus `extra` px. Integer-zoom stops keep the exponential interpolation exact.
function realWidth(k: number, extra = 0): maplibregl.ExpressionSpecification {
  const stops: unknown[] = [];
  for (let z = 8; z <= 22; z++) stops.push(z, ["+", ["max", 1, ["*", ["get", "w"], k * 2 ** z]], extra]);
  return ["interpolate", ["exponential", 2], ["zoom"], ...stops] as maplibregl.ExpressionSpecification;
}

// Roads as lines at real width; planned and waiting edges are dashed and faded, cut-off ones red.
export function attachRoadLayer(map: maplibregl.Map): void {
  let styled = false;

  const addLayers = (lat: number) => {
    const k = 512 / (EQUATOR_M * Math.cos((lat * Math.PI) / 180));
    map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    // Round caps fill the joint where two chains meet; round joins smooth every bend inside a chain.
    const common = { source: SRC, layout: { "line-cap": "round", "line-join": "round" } } as const;
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
      filter: ["in", ["get", "state"], ["literal", ["active", "waiting"]]],
      paint: {
        "line-color": BUILT_COLOR as never,
        "line-width": realWidth(k),
        "line-opacity": ["match", ["get", "state"], "active", 0.7, 0.4],
        "line-dasharray": [2, 2],
      },
    });
    // Wider than real so a cut-off road stands out even when zoomed out.
    map.addLayer({
      ...common,
      id: "roads-cut",
      type: "line",
      filter: ["==", ["get", "state"], "cut"],
      paint: {
        "line-color": CUT_COLOR,
        "line-width": realWidth(k, 2),
        "line-opacity": 0.8,
        "line-dasharray": [2, 1.5],
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
    const cut = cutOffEdges(g);
    const stateOf = (e: { id: number; done: number; labor: number }): RoadState =>
      e.done >= e.labor ? "built" : active.has(e.id) ? "active" : cut.has(e.id) ? "cut" : "waiting";
    const features: GeoJSON.Feature[] = roadChains(g, stateOf).map((ch) => ({
      type: "Feature",
      properties: { id: ch.id, kind: ch.kind, w: ROAD_KINDS[ch.kind].width, state: ch.state },
      geometry: {
        type: "LineString",
        coordinates: ch.nodes.map((id) => {
          const n = g.nodes[id];
          return f.toLngLat(n.x, n.y);
        }),
      },
    }));
    (map.getSource(SRC) as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
  };

  const run = () => effect(apply);
  if (map.isStyleLoaded()) run();
  else map.once("load", run);
}
