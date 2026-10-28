import { buildNet, type Net } from "./people";
import type { RoadGraph } from "./types";

export function makeIdentityCache<K extends object, V>(build: (key: K) => V): (key: K) => V {
  const cache = new WeakMap<K, V>();
  return (key: K) => {
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const value = build(key);
    cache.set(key, value);
    return value;
  };
}

// Road graphs are immutable snapshots on both worker and client sides. Reuse the expensive adjacency/net
// representation for every calculation against the same snapshot; a new graph identity builds a new net.
export const roadNet = makeIdentityCache<RoadGraph, Net>(buildNet);
