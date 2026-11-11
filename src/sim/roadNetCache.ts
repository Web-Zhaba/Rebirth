import { makeIdentityCache } from "./memo";
import { buildNet, type Net } from "./people";
import type { RoadGraph } from "./types";

export { makeIdentityCache };

// Road graphs are immutable snapshots on both worker and client sides. Reuse the expensive adjacency/net
// representation for every calculation against the same snapshot; a new graph identity builds a new net.
export const roadNet = makeIdentityCache<RoadGraph, Net>(buildNet);
