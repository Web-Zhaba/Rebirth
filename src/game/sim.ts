// Pure economy simulation: no DOM, no fetch, no clock. One fixed 1 s step drives both live play and offline catch-up.
import type { CellInfo } from "../world/cells";
import {
  BUILDINGS,
  COST_GROWTH,
  EAT_RATE,
  GROWTH_RATE,
  MIN_POP,
  OFFLINE_CAP_MS,
  RESOURCES,
  START,
  STARVE_RATE,
  STEP_MS,
  YIELD,
  type BuildingType,
  type Resource,
} from "./defs";

export interface PlacedBuilding {
  type: BuildingType;
  mult: number;
}

export interface EconomyState {
  time: number; // epoch ms simulated up to
  food: number;
  wood: number;
  stone: number;
  pop: number;
  buildings: Record<string, PlacedBuilding>; // by H3 cell
}

export interface Rates {
  food: number; // net per second
  wood: number;
  stone: number;
  housing: number;
  workersNeeded: number;
  staffing: number; // 0..1
}

export function initialEconomy(centreCell: string, now: number): EconomyState {
  return { time: now, ...START, buildings: { [centreCell]: { type: "camp", mult: 1 } } };
}

export function countOf(s: EconomyState, type: BuildingType): number {
  let n = 0;
  for (const b of Object.values(s.buildings)) if (b.type === type) n++;
  return n;
}

export function buildCost(type: BuildingType, s: EconomyState): Record<Resource, number> {
  const k = Math.pow(COST_GROWTH, countOf(s, type));
  const out = { food: 0, wood: 0, stone: 0 };
  for (const r of RESOURCES) {
    const base = BUILDINGS[type].cost[r] ?? 0;
    out[r] = base === 0 ? 0 : Math.ceil(base * k - 1e-9);
  }
  return out;
}

// Yield multiplier from the cell's terrain; computed once at build time and stored.
export function yieldMult(type: BuildingType, info: CellInfo): number {
  switch (type) {
    case "farm": {
      const y = YIELD.farm;
      return y.base + y.meadow * info.landShares.meadow + (info.river ? y.river : 0);
    }
    case "lumber": {
      const y = YIELD.lumber;
      return y.base + y.forest * info.landShares.forest;
    }
    case "quarry": {
      const y = YIELD.quarry;
      return Math.min(y.max, y.base + info.slope / y.slopeDiv) + y.rock * info.landShares.rock;
    }
    default:
      return 1;
  }
}

// Per-second output of one building at the given staffing (unstaffed buildings ignore it).
export function buildingOutput(b: PlacedBuilding, staffing: number): Partial<Record<Resource, number>> {
  const def = BUILDINGS[b.type];
  const k = b.mult * (def.workers > 0 ? staffing : 1);
  const out: Partial<Record<Resource, number>> = {};
  for (const r of RESOURCES) {
    const rate = def.rates[r];
    if (rate) out[r] = rate * k;
  }
  return out;
}

export function rates(s: EconomyState): Rates {
  let housing = 0;
  let workersNeeded = 0;
  const list = Object.values(s.buildings);
  for (const b of list) {
    housing += BUILDINGS[b.type].housing;
    workersNeeded += BUILDINGS[b.type].workers;
  }
  const staffing = workersNeeded === 0 ? 1 : Math.min(1, Math.floor(s.pop) / workersNeeded);
  const net = { food: -EAT_RATE * s.pop, wood: 0, stone: 0 };
  for (const b of list) {
    const out = buildingOutput(b, staffing);
    for (const r of RESOURCES) net[r] += out[r] ?? 0;
  }
  return { ...net, housing, workersNeeded, staffing };
}

// Exactly one 1-second step; returns a new object and leaves the input untouched.
export function step(s: EconomyState): EconomyState {
  const r = rates(s);
  let pop = s.pop;
  if (s.food > 0 && pop < r.housing) pop = Math.min(r.housing, pop + GROWTH_RATE);
  else if (s.food === 0 && r.food < 0) pop = Math.max(MIN_POP, pop - STARVE_RATE);
  return {
    time: s.time + STEP_MS,
    food: Math.max(0, s.food + r.food),
    wood: Math.max(0, s.wood + r.wood),
    stone: Math.max(0, s.stone + r.stone),
    pop,
    buildings: s.buildings,
  };
}

// Runs whole 1 s steps up to now, dropping anything older than maxMs (offline cap).
export function advanceTo(s: EconomyState, now: number, maxMs = OFFLINE_CAP_MS): EconomyState {
  let cur = s;
  if (now - cur.time > maxMs) cur = { ...cur, time: now - maxMs };
  while (cur.time + STEP_MS <= now) cur = step(cur);
  return cur;
}

// Pays the cost and adds the building; assumes canBuild already said ok.
export function build(s: EconomyState, type: BuildingType, cell: string, info: CellInfo): EconomyState {
  const cost = buildCost(type, s);
  return {
    ...s,
    food: s.food - cost.food,
    wood: s.wood - cost.wood,
    stone: s.stone - cost.stone,
    buildings: { ...s.buildings, [cell]: { type, mult: yieldMult(type, info) } },
  };
}
