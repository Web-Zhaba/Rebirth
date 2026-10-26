import { landAt } from "../world/landcover";
import { terrainAt } from "../world/terrain";
import type { ElevationSampler, TerrainSampler } from "./handler";

// Real terrain lookup for the worker: land type and slope at a local point.
export const worldSampler: TerrainSampler = async (frame, x, y) => {
  const [lng, lat] = frame.toLngLat(x, y);
  const [land, t] = await Promise.all([landAt(lng, lat), terrainAt(lng, lat)]);
  return { land, slope: t.slope };
};

export const worldElevation: ElevationSampler = async (lng, lat) => (await terrainAt(lng, lat)).elevation;
