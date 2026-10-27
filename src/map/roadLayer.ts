import type maplibregl from "maplibre-gl";
import { computed, effect, type ReadonlySignal } from "@preact/signals";
import { cutOffEdges, ROAD_KINDS, workableEdges } from "../sim/roads";
import type { ModelItem } from "./modelLayer";
import { roadChains, type RoadChain, type RoadState } from "./roadChains";
import { PALETTE } from "../ui/palette";
import { city, frame, roads, stock } from "../simClient";

const SRC = "roads";
const EQUATOR_M = 40075016.686;
// Built roads are three.js models (roadModels.ts); their lines stay only while zoomed out, where a real-width ribbon
// would be thinner than a pixel.
const LINES_MAX_ZOOM = 16;

const BUILT_COLOR = ["match", ["get", "kind"], "dirt", PALETTE.roadDirt, "footbridge", PALETTE.roadBridge, "bridge", PALETTE.roadBridge, "stone", PALETTE.roadStone, "stonebridge", PALETTE.roadStone, PALETTE.roadPath];
const CUT_COLOR = PALETTE.bad; // roads no work party can reach
const CASING_COLOR = ["match", ["get", "kind"], "dirt", PALETTE.roadDirtEdge, "footbridge", PALETTE.roadBridgeEdge, "bridge", PALETTE.roadBridgeEdge, "stone", PALETTE.roadStoneEdge, "stonebridge", PALETTE.roadStoneEdge, PALETTE.roadPathEdge];

// Width in px of `meters` of ground at zoom z (MapLibre uses 512 px tiles), at least 1 px,
// plus `extra` px. Integer-zoom stops keep the exponential interpolation exact.
function realWidth(k: number, extra = 0): maplibregl.ExpressionSpecification {
  const stops: unknown[] = [];
  for (let z = 8; z <= 22; z++) stops.push(z, ["+", ["max", 1, ["*", ["get", "w"], k * 2 ** z]], extra]);
  return ["interpolate", ["exponential", 2], ["zoom"], ...stops] as maplibregl.ExpressionSpecification;
}

// Chains of the road graph by kind and state. Edges short of stone are not workable: they show as waiting. The stock is
// only watched while some edge owes stone.
const chains = computed<RoadChain[] | null>(() => {
  const g = roads.value;
  if (!g) return null;
  const st = Object.values(g.edges).some((e) => e.stone) ? stock.value : null;
  const active = new Set(workableEdges(g, st ?? undefined));
  const cut = cutOffEdges(g);
  const stateOf = (e: { id: number; done: number; labor: number }): RoadState =>
    e.done >= e.labor ? "built" : active.has(e.id) ? "active" : cut.has(e.id) ? "cut" : "waiting";
  return roadChains(g, stateOf);
});

// What the model layer draws of the roads: every built chain. The same list comes back while no built chain changed.
let lastItems: ModelItem[] = [];
const itemSig = (l: readonly ModelItem[]) => l.map((i) => `${i.kind}:${i.ring.map((p) => p.join(",")).join(";")}`).join("|");
export const roadItems: ReadonlySignal<ModelItem[]> = computed(() => {
  const list = chains.value;
  const g = roads.value;
  if (!list || !g) return lastItems;
  const out: ModelItem[] = list
    .filter((ch) => ch.state === "built")
    .map((ch) => ({ id: `road${ch.id}`, ring: ch.nodes.map((id): [number, number] => [g.nodes[id].x, g.nodes[id].y]), height: 0, kind: ch.kind, progress: 1, style: "road" }));
  if (itemSig(out) !== itemSig(lastItems)) lastItems = out;
  return lastItems;
});

// Roads as lines at real width: built ones while zoomed out (closer, the three.js models draw them), planned and waiting
// edges dashed and faded, cut-off ones red.
// The layers the ground of the town (roads, the camp) goes under, whichever exist yet: the buildings and the night, so
// the layers that load later find it in place.
export const UNDER_BUILDINGS = ["buildings-planned-fill", "building-models", "buildings-outline", "weather-snow", "night-tint"];

export function attachRoadLayer(map: maplibregl.Map): void {
  let styled = false;

  const addLayers = (lat: number) => {
    const k = 512 / (EQUATOR_M * Math.cos((lat * Math.PI) / 180));
    map.addSource(SRC, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    // Round caps fill the joint where two chains meet; round joins smooth every bend inside a chain.
    const common = { source: SRC, layout: { "line-cap": "round", "line-join": "round" } } as const;
    const before = UNDER_BUILDINGS.find((id) => map.getLayer(id));
    map.addLayer({
      ...common,
      id: "roads-casing",
      type: "line",
      maxzoom: LINES_MAX_ZOOM,
      filter: ["==", ["get", "state"], "built"],
      paint: { "line-color": CASING_COLOR as never, "line-width": realWidth(k, 1.5) },
    }, before);
    map.addLayer({
      ...common,
      id: "roads-built",
      type: "line",
      maxzoom: LINES_MAX_ZOOM,
      filter: ["==", ["get", "state"], "built"],
      paint: { "line-color": BUILT_COLOR as never, "line-width": realWidth(k) },
    }, before);
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
    }, before);
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
    }, before);
    styled = true;
  };

  const apply = () => {
    const c = city.value;
    const f = frame.value;
    const g = roads.value;
    const list = chains.value;
    if (!c || !f || !g || !list) return;
    if (!styled) addLayers(c.lat); // one city per page load
    const features: GeoJSON.Feature[] = list.map((ch) => ({
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
