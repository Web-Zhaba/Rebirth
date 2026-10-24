// Building and balance data. Pure numbers and names only; rules live in sim.ts / placement.ts.

export type Resource = "food" | "wood" | "stone";
export const RESOURCES: Resource[] = ["food", "wood", "stone"];

export const BUILDING_TYPES = ["camp", "hut", "farm", "lumber", "quarry", "well"] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export interface BuildingDef {
  name: string;
  emoji: string;
  color: string;
  buildable: boolean; // false: placed automatically (camp)
  cost: Partial<Record<Resource, number>>; // base cost, scaled by COST_GROWTH per built copy
  housing: number;
  rates: Partial<Record<Resource, number>>; // per second at mult 1 and full staffing
  workers: number;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  camp: { name: "Лагерь", emoji: "🔥", color: "#e0a050", buildable: false, cost: {}, housing: 5, rates: { food: 0.4, wood: 0.2 }, workers: 0 },
  hut: { name: "Хижина", emoji: "🏠", color: "#b5835a", buildable: true, cost: { wood: 15 }, housing: 4, rates: {}, workers: 0 },
  farm: { name: "Ферма", emoji: "🌾", color: "#d8c030", buildable: true, cost: { wood: 20 }, housing: 0, rates: { food: 0.6 }, workers: 2 },
  lumber: { name: "Лесоруб", emoji: "🪓", color: "#3f7a34", buildable: true, cost: { wood: 15, food: 10 }, housing: 0, rates: { wood: 0.5 }, workers: 2 },
  quarry: { name: "Каменоломня", emoji: "⛏️", color: "#7a7468", buildable: true, cost: { wood: 40, food: 20 }, housing: 0, rates: { stone: 0.3 }, workers: 3 },
  well: { name: "Колодец", emoji: "💧", color: "#3f86b8", buildable: true, cost: { wood: 25 }, housing: 0, rates: {}, workers: 0 },
};

// Types offered in the build menu, in display order.
export const BUILDABLE_TYPES: BuildingType[] = BUILDING_TYPES.filter((t) => BUILDINGS[t].buildable);

// Land each building accepts (CellInfo.land); undefined means any non-water land, see placement.ts.
export const HUT_LANDS = ["meadow", "forest", "sand"] as const;
export const WELL_FORBIDDEN_LANDS = ["water", "wetland"] as const;

// Yield multiplier coefficients, applied once at build time from the cell's CellInfo.
export const YIELD = {
  farm: { base: 0.7, meadow: 0.6, river: 0.3 },
  lumber: { base: 0.5, forest: 1.0 },
  quarry: { base: 0.5, slopeDiv: 16, max: 2, rock: 0.5 },
};

export const QUARRY_MIN_SLOPE = 6; // degrees; below this a quarry needs rock
export const WELL_RADIUS = 2; // rings
export const COST_GROWTH = 1.15;

export const EAT_RATE = 0.1; // food/s per person
export const GROWTH_RATE = 0.05; // pop/s
export const STARVE_RATE = 0.02; // pop/s
export const MIN_POP = 1;

export const STEP_MS = 1000;
export const OFFLINE_CAP_MS = 24 * 3600 * 1000;
export const OFFLINE_REPORT_MIN_MS = 60 * 1000;

export const START = { food: 20, wood: 20, stone: 0, pop: 3 };
export const MAX_MULT = 5;
