import type * as maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import { ruinsAutoShown, ruinsShown } from "../view/ruinsShown";
import { ruinFloors, ruinHints, ruinPois, ruinStreets, ruinTyped, ruinTypedNames, ruinWalls } from "../view/layers/ruins";
import { mixHex, PALETTE, TREE_COLORS } from "../ui/palette";
import type { Frame } from "../world/frame";

const SRC_WALLS = "ruins-walls";
const SRC_FLOORS = "ruins-floors";
const SRC_STREETS = "ruins-streets";
const SRC_POIS = "ruins-pois";
const SRC_TYPED = "ruins-typed";
const SRC_TYPED_NAMES = "ruins-typed-labels";
const SRC_HINTS = "ruins-hints";
const RUIN_LAYERS = [
  "ruins-floor",
  "ruins-typed-fill",
  "ruins-streets",
  "ruins-outline",
  "ruins-typed-outline",
  "ruins-walls",
  "ruins-hints",
  "ruins-street-names",
  "ruins-typed-names",
  "ruins-poi-names",
];
const EQUATOR_M = 40075016.686;
const FONT = ["Noto Sans Regular"];

const empty = (): GeoJSON.FeatureCollection => ({ type: "FeatureCollection", features: [] });

// Width in px of `meters` of ground at zoom z (512 px tiles), at least 1 px.
function realWidth(k: number): maplibregl.ExpressionSpecification {
  const stops: unknown[] = [];
  for (let z = 8; z <= 22; z++) stops.push(z, ["max", 1, ["*", ["get", "w"], k * 2 ** z]]);
  return ["interpolate", ["exponential", 2], ["zoom"], ...stops] as maplibregl.ExpressionSpecification;
}


// The buried old city as ruins: low stone walls over foundations, faint ochre dashed streets, names.
// The data is view/layers/ruins.ts (shared with the engine); picking an old building is its attachSitePick.
export function attachRuinsLayer(map: maplibregl.Map, frame: ReadonlySignal<Frame | null>): () => void {
  let ready = false;
  let disposed = false;

  const applyShown = () => {
    for (const id of RUIN_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", ruinsShown.peek() || ruinsAutoShown.peek() ? "visible" : "none");
  };

  const setup = (lat: number) => {
    const k = 512 / (EQUATOR_M * Math.cos((lat * Math.PI) / 180));
    for (const id of [SRC_WALLS, SRC_FLOORS, SRC_STREETS, SRC_POIS, SRC_TYPED, SRC_TYPED_NAMES, SRC_HINTS]) map.addSource(id, { type: "geojson", data: empty() });
    const beneath = map.getLayer("roads-casing") ? "roads-casing" : undefined;
    map.addLayer(
      { id: "ruins-floor", type: "fill", source: SRC_FLOORS, minzoom: 13, paint: { "fill-color": PALETTE.pencilFaint, "fill-opacity": 0.28 } },
      beneath,
    );
    // Notable buildings: floor in the colour of their domain.
    map.addLayer(
      { id: "ruins-typed-fill", type: "fill", source: SRC_TYPED, minzoom: 13, paint: { "fill-color": ["get", "c"], "fill-opacity": ["match", ["get", "s"], "restored", 0.12, "restoring", 0.3, "lost", 0.2, ["case", ["==", ["get", "dim"], 1], 0.2, 0.5]] } },
      beneath,
    );
    map.addLayer(
      {
        id: "ruins-streets",
        type: "line",
        source: SRC_STREETS,
        minzoom: 12,
        layout: { "line-cap": "butt", "line-join": "round" },
        // Solid and faint: at real width, dashes read as rows of small houses.
        // Old bridges darker and stronger, so a dig shows where a bridge will come back.
        paint: {
          "line-color": ["case", ["get", "bridge"], PALETTE.pencil, PALETTE.warn],
          "line-width": realWidth(k),
          "line-opacity": ["case", ["get", "bridge"], 0.6, 0.3],
        },
      },
      beneath,
    );
    // Foundations too thin to inset: outline only.
    map.addLayer(
      {
        id: "ruins-outline",
        type: "line",
        source: SRC_WALLS,
        minzoom: 14,
        filter: ["==", ["get", "thin"], 1],
        paint: { "line-color": PALETTE.pencil, "line-width": 1.2, "line-opacity": 0.85 },
      },
      beneath,
    );
    map.addLayer(
      {
        id: "ruins-typed-outline",
        type: "line",
        source: SRC_TYPED,
        minzoom: 13,
        layout: { "line-join": "round" },
        paint: { "line-color": ["get", "c"], "line-width": ["match", ["get", "s"], "restoring", 3.5, "restored", 1, 2], "line-opacity": ["match", ["get", "s"], "lost", 0.45, ["case", ["==", ["get", "dim"], 1], 0.5, 0.95]] },
      },
      beneath,
    );
    map.addLayer(
      {
        id: "ruins-walls",
        type: "fill-extrusion",
        source: SRC_WALLS,
        minzoom: 14,
        filter: ["==", ["get", "thin"], 0],
        paint: {
          // weathered stone, the lowest pieces grown over with moss
          "fill-extrusion-color": ["interpolate", ["linear"], ["get", "h"], 0.1, mixHex(PALETTE.pencilFaint, TREE_COLORS.summer, 0.45), 1, PALETTE.pencilFaint, 2.5, mixHex(PALETTE.pencilFaint, TREE_COLORS.stone, 0.5)],
          "fill-extrusion-height": ["get", "h"],
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.95,
          "fill-extrusion-vertical-gradient": true,
        },
      },
      beneath,
    );
    // Hints: faint unnamed spots just beyond a dig, no type and no domain colour.
    map.addLayer(
      {
        id: "ruins-hints",
        type: "circle",
        source: SRC_HINTS,
        minzoom: 14,
        paint: {
          "circle-radius": 4,
          "circle-color": PALETTE.pencilFaint,
          "circle-opacity": 0.35,
          "circle-stroke-color": PALETTE.pencilFaint,
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.5,
        },
      },
      beneath,
    );
    map.addLayer(
      {
        id: "ruins-street-names",
        type: "symbol",
        source: SRC_STREETS,
        minzoom: 15,
        filter: ["has", "name"],
        layout: {
          "symbol-placement": "line",
          "text-field": ["get", "name"],
          "text-font": FONT,
          "text-size": 11,
          "text-letter-spacing": 0.05,
        },
        paint: { "text-color": PALETTE.ink2, "text-halo-color": PALETTE.paperRaised, "text-halo-width": 1.5 },
      },
      beneath,
    );
    map.addLayer(
      {
        id: "ruins-typed-names",
        type: "symbol",
        source: SRC_TYPED_NAMES,
        minzoom: 15,
        layout: {
          "text-field": ["get", "name"],
          "text-font": FONT,
          "text-size": 12,
          "text-max-width": 8,
          "text-anchor": "center",
        },
        paint: { "text-color": PALETTE.ink, "text-halo-color": PALETTE.paperRaised, "text-halo-width": 1.5 },
      },
      beneath,
    );
    map.addLayer(
      {
        id: "ruins-poi-names",
        type: "symbol",
        source: SRC_POIS,
        minzoom: 15,
        layout: {
          "text-field": ["get", "name"],
          "text-font": FONT,
          "text-size": 11,
          "text-max-width": 8,
          "text-anchor": "top",
          "text-offset": [0, 0.4],
        },
        paint: { "text-color": PALETTE.ink, "text-halo-color": PALETTE.paperRaised, "text-halo-width": 1.5 },
      },
      beneath,
    );
    ready = true;
    applyShown();
  };

  const SOURCES: [string, ReadonlySignal<GeoJSON.FeatureCollection>][] = [
    [SRC_WALLS, ruinWalls],
    [SRC_FLOORS, ruinFloors],
    [SRC_STREETS, ruinStreets],
    [SRC_POIS, ruinPois],
    [SRC_TYPED, ruinTyped],
    [SRC_TYPED_NAMES, ruinTypedNames],
    [SRC_HINTS, ruinHints],
  ];
  const stops: (() => void)[] = [];
  const run = () => {
    if (disposed) return;
    stops.push(
      effect(() => {
        const f = frame.value;
        if (!f || disposed) return;
        if (!ready) setup(f.toLngLat(0, 0)[1]);
      }),
      ...SOURCES.map(([id, data]) =>
        effect(() => {
          const d = data.value;
          if (ready) (map.getSource(id) as maplibregl.GeoJSONSource).setData(d);
        }),
      ),
      effect(() => {
        void ruinsShown.value;
        void ruinsAutoShown.value;
        applyShown();
      }),
    );
  };
  if (map.isStyleLoaded()) run();
  else map.once("load", run);

  return () => {
    disposed = true;
    for (const stop of stops) stop();
  };
}
