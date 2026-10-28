import { isFinishedHouse, lotFront, snapToRoad, type Net, type Spot } from "./people";
import { roadNet } from "./roadNetCache";
import type { Building, RoadGraph } from "./types";

export function makeTripleIdentityCache<A extends object, B extends object, C extends object, V>(
  build: (a: A, b: B, c: C) => V,
): (a: A, b: B, c: C) => V {
  const cache = new WeakMap<A, WeakMap<B, WeakMap<C, V>>>();
  return (a, b, c) => {
    let byB = cache.get(a);
    if (!byB) {
      byB = new WeakMap();
      cache.set(a, byB);
    }
    let byC = byB.get(b);
    if (!byC) {
      byC = new WeakMap();
      byB.set(b, byC);
    }
    const hit = byC.get(c);
    if (hit !== undefined) return hit;
    const value = build(a, b, c);
    byC.set(c, value);
    return value;
  };
}

export interface PreviewHouse {
  id: number;
  x: number;
  y: number;
  spot: Spot;
  people: number;
}

export interface ServicePreviewIndex {
  net: Net;
  houses: PreviewHouse[];
}

const buildIndex = (
  roads: RoadGraph,
  buildings: Record<number, Building>,
  houseResidents: Record<number, number>,
): ServicePreviewIndex => {
  const net = roadNet(roads);
  const houses: PreviewHouse[] = [];
  for (const b of Object.values(buildings)) {
    if (!isFinishedHouse(b)) continue;
    const [x, y] = lotFront(b);
    const spot = snapToRoad(net, x, y);
    if (spot) houses.push({ id: b.id, x, y, spot, people: houseResidents[b.id] ?? 0 });
  }
  return { net, houses };
};

export const servicePreviewIndex = makeTripleIdentityCache(buildIndex);
