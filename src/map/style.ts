import type { StyleSpecification } from "maplibre-gl";

const C = {
  meadow: "#dfe6c3",
  grass: "#d3e0b4",
  forest: "#a3c088",
  wetland: "#b9d3a6",
  sand: "#eadfb4",
  rock: "#cfc9b8",
  ice: "#f2f6f8",
  water: "#9fc9dc",
};

const OMT_URL = "https://tiles.openfreemap.org/planet";
const OMT_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>';
const NATURE_MAXZOOM = 12;

// Grass subclasses that are wild vegetation; lawns, flowerbeds, parks, gardens and
// sports grounds are man-made and would outline the old city.
const WILD_GRASS = ["grassland", "meadow", "scrub", "heath", "fell", "tundra", "wet_meadow"];

// Rewilded Earth: only terrain and nature; built-up land is plain meadow.
export function rewildedStyle(): StyleSpecification {
  return {
    version: 8,
    projection: { type: "globe" },
    sources: {
      terrain: {
        type: "raster-dem",
        tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
        encoding: "terrarium",
        tileSize: 256,
        // Higher zooms carry building/canopy heights (surface model) and would draw
        // a ghost of today's city; overzooming z11 keeps only the landform.
        maxzoom: 11,
        attribution: "Terrain: Mapzen, AWS Open Data",
      },
      omt: {
        type: "vector",
        url: OMT_URL,
        attribution: OMT_ATTRIBUTION,
      },
      // Same tiles capped at a low zoom: generalized geometry drops lawns, courtyards
      // and park alleys, so nature reads as overgrown instead of tracing the city.
      nature: {
        type: "vector",
        url: OMT_URL,
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
          ["in", ["get", "class"], ["literal", ["wood", "wetland", "sand", "rock", "ice"]]],
          ["all", ["==", ["get", "class"], "grass"], ["in", ["get", "subclass"], ["literal", WILD_GRASS]]],
        ],
        paint: {
          "fill-color": [
            "match",
            ["get", "class"],
            "wood", C.forest,
            "grass", C.grass,
            "wetland", C.wetland,
            "sand", C.sand,
            "rock", C.rock,
            "ice", C.ice,
            C.meadow,
          ],
        },
      },
      {
        id: "hillshade",
        type: "hillshade",
        source: "terrain",
        paint: {
          "hillshade-exaggeration": 0.6,
          "hillshade-shadow-color": "#5b6350",
          "hillshade-highlight-color": "#ffffff",
          "hillshade-accent-color": "#7a8468",
        },
      },
      {
        id: "water",
        type: "fill",
        source: "nature",
        "source-layer": "water",
        filter: [
          "all",
          ["!", ["in", ["get", "class"], ["literal", ["swimming_pool", "dock"]]]],
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
          ["in", ["get", "class"], ["literal", ["river", "stream"]]],
          ["!=", ["get", "brunnel"], "tunnel"],
        ],
        paint: {
          "line-color": C.water,
          "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 8, 0.6, 14, 3, 18, 12],
        },
      },
    ],
  };
}
