import { cellToChildren, cellToLatLng } from "h3-js";
import { LANDS, landAt, nearRiver, type Land } from "./landcover";
import { terrainAt } from "./terrain";

export const STEEP_SLOPE_DEG = 12;
const SAMPLE_RES = 11; // 49 children of a res-9 cell

export interface CellInfo {
  cell: string;
  land: Land;
  landShares: Record<Land, number>;
  elevation: number; // mean, m
  elevMin: number;
  elevMax: number;
  slope: number; // mean of sample slopes, degrees
  steep: boolean;
  river: boolean;
}

// Water if it covers at least half the cell, otherwise the most common other land.
export function dominantLand(shares: Record<Land, number>): Land {
  if (shares.water >= 0.5) return "water";
  let best: Land = "meadow";
  let bestShare = -1;
  for (const l of LANDS) {
    if (l !== "water" && shares[l] > bestShare) {
      best = l;
      bestShare = shares[l];
    }
  }
  return best;
}

async function compute(cell: string): Promise<CellInfo> {
  const points = cellToChildren(cell, SAMPLE_RES).map((c) => cellToLatLng(c));
  const samples = await Promise.all(
    points.map(async ([lat, lng]) => {
      const [land, river, terrain] = await Promise.all([landAt(lng, lat), nearRiver(lng, lat), terrainAt(lng, lat)]);
      return { land, river, ...terrain };
    }),
  );
  const n = samples.length;
  const landShares = Object.fromEntries(LANDS.map((l) => [l, 0])) as Record<Land, number>;
  let sumElev = 0;
  let sumSlope = 0;
  let elevMin = Infinity;
  let elevMax = -Infinity;
  for (const s of samples) {
    landShares[s.land] += 1 / n;
    sumElev += s.elevation;
    sumSlope += s.slope;
    elevMin = Math.min(elevMin, s.elevation);
    elevMax = Math.max(elevMax, s.elevation);
  }
  const slope = sumSlope / n;
  return {
    cell,
    land: dominantLand(landShares),
    landShares,
    elevation: sumElev / n,
    elevMin,
    elevMax,
    slope,
    steep: slope >= STEEP_SLOPE_DEG,
    river: samples.some((s) => s.river),
  };
}

const cache = new Map<string, Promise<CellInfo>>();

export function analyzeCell(cell: string): Promise<CellInfo> {
  let p = cache.get(cell);
  if (!p) {
    p = compute(cell);
    cache.set(cell, p);
    p.catch(() => {
      if (cache.get(cell) === p) cache.delete(cell);
    });
  }
  return p;
}
