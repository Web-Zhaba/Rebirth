// Test helpers: terrain fixtures for the pure game rules.
import { gridDisk, latLngToCell } from "h3-js";
import { LANDS, type Land } from "../world/landcover";
import type { CellInfo } from "../world/cells";

export const CENTRE = latLngToCell(50, 15, 9);
export const RING1 = gridDisk(CENTRE, 1).filter((c) => c !== CENTRE);
export const RING2 = gridDisk(CENTRE, 2).filter((c) => !gridDisk(CENTRE, 1).includes(c));

export function info(cell: string, land: Land = "meadow", o: Partial<CellInfo> = {}): CellInfo {
  const landShares = Object.fromEntries(LANDS.map((l) => [l, l === land ? 1 : 0])) as Record<Land, number>;
  return { cell, land, landShares, elevation: 100, elevMin: 95, elevMax: 105, slope: 2, steep: false, river: false, ...o };
}
