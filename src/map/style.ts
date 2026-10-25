import type { ExpressionSpecification, StyleSpecification } from "maplibre-gl";
import {
  LANDCOVER_CLASSES,
  NATURE_MAXZOOM,
  OMT_TILEJSON_URL,
  TERRAIN_URL,
  TERRAIN_ZOOM,
  WATERWAY_CLASSES,
  WATER_EXCLUDED_CLASSES,
  WILD_GRASS,
} from "../world/nature";
import { MAP_ONLY, PALETTE } from "../ui/palette";

// Atlas palette (ui/palette.ts): paper land, ink-blue water, muted green forest.
export const C = {
  meadow: PALETTE.mapLand,
  grass: PALETTE.mapGrass,
  forest: PALETTE.mapForest,
  forestDeep: PALETTE.mapForestDeep,
  woodLight: PALETTE.mapWoodLight,
  scrub: PALETTE.mapScrub,
  heath: PALETTE.mapHeath,
  fell: PALETTE.mapFell,
  wetland: PALETTE.mapWetland,
  bog: PALETTE.mapBog,
  farm: PALETTE.mapFarm,
  sand: PALETTE.mapSand,
  beach: PALETTE.mapBeach,
  shore: PALETTE.mapShore,
  rock: PALETTE.mapRock,
  ice: PALETTE.mapIce,
  water: PALETTE.mapWater,
};

export const MEADOW_COLOR = C.meadow;
export const PLACE_LABELS_LAYER = "place-labels";

// Landcover the map draws: the game's classes plus farmland, which the game counts as meadow.
const DRAWN_LANDCOVER = [...LANDCOVER_CLASSES, "farmland"];

// Colour by "class/subclass" from the tiles; a class without a listed subclass falls back to its class colour.
const BIOME_FILL: [string, string][] = [
  ["wood/forest", C.forest],
  ["wood/wood", C.woodLight],
  ["grass/grassland", C.grass],
  ["grass/meadow", C.grass],
  ["grass/scrub", C.scrub],
  ["grass/heath", C.heath],
  ["grass/fell", C.fell],
  ["wetland/wetland", C.wetland],
  ["wetland/bog", C.bog],
  ["wetland/swamp", C.bog],
  ["farmland/farmland", C.farm],
  ["farmland/orchard", C.farm],
  ["farmland/vineyard", C.farm],
  ["sand/beach", C.beach],
  ["sand/sand", C.sand],
  ["rock/bare_rock", C.rock],
  ["rock/scree", C.rock],
];
const CLASS_FILL: [string, string][] = [
  ["wood", C.forest],
  ["grass", C.grass],
  ["wetland", C.wetland],
  ["farmland", C.farm],
  ["sand", C.sand],
  ["rock", C.rock],
  ["ice", C.ice],
];
const biomeFill = (): ExpressionSpecification =>
  [
    "match",
    ["concat", ["get", "class"], "/", ["to-string", ["coalesce", ["get", "subclass"], ""]]],
    ...BIOME_FILL.flat(),
    ["match", ["get", "class"], ...CLASS_FILL.flat(), C.meadow],
  ] as unknown as ExpressionSpecification; // the match spec types its labels too narrowly for a list built at runtime

const OMT_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>';

// Rewilded Earth: only terrain and nature; built-up land is plain meadow.
export function rewildedStyle(): StyleSpecification {
  return {
    version: 8,
    projection: { type: "globe" },
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      terrain: {
        type: "raster-dem",
        tiles: [TERRAIN_URL],
        encoding: "terrarium",
        tileSize: 256,
        // Higher zooms carry building/canopy heights (surface model) and would draw
        // a ghost of today's city; overzooming z11 keeps only the landform.
        maxzoom: TERRAIN_ZOOM,
        attribution: "Terrain: Mapzen, AWS Open Data",
      },
      omt: {
        type: "vector",
        url: OMT_TILEJSON_URL,
        attribution: OMT_ATTRIBUTION,
      },
      // Same tiles capped at a low zoom: generalized geometry drops lawns, courtyards
      // and park alleys, so nature reads as overgrown instead of tracing the city.
      nature: {
        type: "vector",
        url: OMT_TILEJSON_URL,
        maxzoom: NATURE_MAXZOOM,
        attribution: OMT_ATTRIBUTION,
      },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": C.meadow } },
      {
        id: "landcover",
        type: "fill",
        source: "nature",
        "source-layer": "landcover",
        filter: [
          "any",
          ["in", ["get", "class"], ["literal", DRAWN_LANDCOVER]],
          ["all", ["==", ["get", "class"], "grass"], ["in", ["get", "subclass"], ["literal", WILD_GRASS]]],
        ],
        paint: { "fill-color": biomeFill() },
      },
      // A darker band just inside the edge of dense forest: the edge reads as a gradient, not a hard line.
      {
        id: "forest-edge",
        type: "line",
        source: "nature",
        "source-layer": "landcover",
        filter: ["all", ["==", ["get", "class"], "wood"], ["==", ["get", "subclass"], "forest"]],
        paint: {
          "line-color": C.forestDeep,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 3, 12, 8],
          "line-blur": 3,
          "line-opacity": 0.6,
        },
      },
      {
        id: "hillshade",
        type: "hillshade",
        source: "terrain",
        paint: {
          "hillshade-exaggeration": 0.5,
          "hillshade-shadow-color": MAP_ONLY.hillShadow,
          "hillshade-highlight-color": PALETTE.paperRaised,
          "hillshade-accent-color": MAP_ONLY.hillAccent,
        },
      },
      // A sand band around the water, drawn under the water fill so only its outer half shows: the shore fades out.
      {
        id: "shore",
        type: "line",
        source: "nature",
        "source-layer": "water",
        filter: ["all", ["!", ["in", ["get", "class"], ["literal", WATER_EXCLUDED_CLASSES]]], ["!=", ["get", "brunnel"], "tunnel"]],
        paint: {
          "line-color": C.shore,
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 4, 12, 12],
          "line-blur": 4,
        },
      },
      {
        id: "water",
        type: "fill",
        source: "nature",
        "source-layer": "water",
        filter: [
          "all",
          ["!", ["in", ["get", "class"], ["literal", WATER_EXCLUDED_CLASSES]]],
          ["!=", ["get", "brunnel"], "tunnel"],
        ],
        paint: { "fill-color": C.water },
      },
      {
        id: "waterway",
        type: "line",
        source: "omt",
        "source-layer": "waterway",
        filter: [
          "all",
          ["in", ["get", "class"], ["literal", WATERWAY_CLASSES]],
          ["!=", ["get", "brunnel"], "tunnel"],
        ],
        paint: {
          "line-color": C.water,
          "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 8, 0.6, 14, 3, 18, 12],
        },
      },
      // Names of the old towns and villages, faint like pencil notes in an atlas, to find a place by.
      // Hidden by default; placeLabels.ts switches it.
      {
        id: PLACE_LABELS_LAYER,
        type: "symbol",
        source: "omt",
        "source-layer": "place",
        filter: ["in", ["get", "class"], ["literal", ["city", "town", "village", "hamlet"]]],
        layout: {
          visibility: "none",
          "text-field": ["coalesce", ["get", "name:ru"], ["get", "name"]],
          "text-font": ["Noto Sans Italic"],
          "text-size": ["match", ["get", "class"], "city", 15, "town", 13.5, "village", 12, 11],
          "symbol-sort-key": ["coalesce", ["get", "rank"], 99],
          "text-max-width": 8,
          "text-padding": 4,
        },
        paint: {
          "text-color": PALETTE.ink2,
          "text-opacity": 0.75,
          "text-halo-color": PALETTE.paperRaised,
          "text-halo-width": 1.4,
        },
      },
    ],
  };
}
