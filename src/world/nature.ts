// Rules shared by the rendered map (map/style.ts) and the cell analysis (world/*),
// so what the player sees is exactly what the game uses.

export const OMT_TILEJSON_URL = "https://tiles.openfreemap.org/planet";
export const TERRAIN_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";

// Terrain DEM zoom: higher zooms carry building/canopy heights.
export const TERRAIN_ZOOM = 11;
// Land cover and water polygons come from tiles generalized at this zoom.
export const NATURE_MAXZOOM = 12;
// Streams only exist in high-zoom tiles.
export const WATERWAY_ZOOM = 14;

export const LANDCOVER_CLASSES = ["wood", "wetland", "sand", "rock", "ice"];

// Grass subclasses that are wild vegetation; lawns, flowerbeds, parks, gardens and
// sports grounds are man-made and would outline the old city.
export const WILD_GRASS = ["grassland", "meadow", "scrub", "heath", "fell", "tundra", "wet_meadow"];

export const WATER_EXCLUDED_CLASSES = ["swimming_pool", "dock"];
export const WATERWAY_CLASSES = ["river", "stream"];

type Props = Record<string, unknown>;

export function isNatureLandcover(p: Props): boolean {
  const cls = p.class;
  if (typeof cls !== "string") return false;
  if (LANDCOVER_CLASSES.includes(cls)) return true;
  return cls === "grass" && typeof p.subclass === "string" && WILD_GRASS.includes(p.subclass);
}

export function isNatureWater(p: Props): boolean {
  return !(typeof p.class === "string" && WATER_EXCLUDED_CLASSES.includes(p.class)) && p.brunnel !== "tunnel";
}

export function isNatureWaterway(p: Props): boolean {
  return typeof p.class === "string" && WATERWAY_CLASSES.includes(p.class) && p.brunnel !== "tunnel";
}
