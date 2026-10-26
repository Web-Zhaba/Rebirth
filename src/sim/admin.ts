import { advanceClearings } from "./growth";
import { nextEra as nextEraOf, researchAll } from "./research";
import { refreshServices } from "./coverage";
import { syncPeople } from "./people";
import { isCleared } from "./clearing";
import { UPGRADE } from "./buildings";
import { completeRestorations } from "./restore";
import type { Building, RoadGraph, SimState } from "./types";

// Admin panel: cheats on the simulation. Nothing here is reachable from play, only from the admin panel's commands.
export const ADMIN = {
  maxRadius: 600, // m, one reveal
  maxReveals: 500, // discs kept in finds.revealed
  grant: 1000, // of each good, per press
};

export type AdminOp =
  | { k: "free"; on: boolean } // session mode: whatever is started finishes at once, without materials
  | { k: "finish" } // finish everything under way now
  | { k: "stock" }
  | { k: "unlock" } // every tech researched
  | { k: "era" } // the next era at once
  | { k: "reveal"; x: number; y: number; r: number }; // reveal the buried old city in a disc

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const buildingDone = (b: Building): boolean => b.state === "active" && !b.upgrade;

function finishRoads(g: RoadGraph): RoadGraph {
  let edges = g.edges;
  for (const e of Object.values(g.edges)) {
    if (e.done >= e.labor) continue;
    if (edges === g.edges) edges = { ...g.edges };
    edges[e.id] = { ...e, done: e.labor };
  }
  return edges === g.edges ? g : { ...g, edges };
}

function finishBuildings(all: Record<number, Building>): Record<number, Building> {
  let out = all;
  for (const b of Object.values(all)) {
    if (buildingDone(b)) continue;
    if (out === all) out = { ...all };
    if (b.state === "active") {
      const { upgrade: _u, ...rest } = b;
      out[b.id] = { ...rest, level: 2, height: b.height + UPGRADE.height };
    } else {
      out[b.id] = { ...b, paid: true, done: b.labor, state: "active" };
    }
  }
  return out;
}

// Completes every road, building, upgrade and clearing under way. Returns the same state when nothing was.
export function finishAll(s: SimState): SimState {
  const roads = finishRoads(s.roads);
  const buildings = finishBuildings(s.buildings);
  const open = new Map(s.clearings.filter((c) => !isCleared(c)).map((c) => [c.id, c.labor - c.done]));
  if (roads === s.roads && buildings === s.buildings && open.size === 0) return s;
  const cleared = advanceClearings({ ...s, roads, buildings }, open);
  return refreshServices(syncPeople(completeRestorations(cleared)));
}

export const grantStock = (s: SimState): SimState => ({
  ...s,
  stock: { food: s.stock.food + ADMIN.grant, logs: s.stock.logs + ADMIN.grant, planks: s.stock.planks + ADMIN.grant, stone: s.stock.stone + ADMIN.grant, wares: s.stock.wares + ADMIN.grant },
});

export const unlockAll = (s: SimState): SimState => researchAll(s);
export const nextEra = (s: SimState): SimState => nextEraOf(s);

export type AdminResult = { ok: true; sim: SimState } | { ok: false; reason: string };

// A disc of the old city revealed at once. Its id comes from the building counter so it never meets a real dig site.
export function reveal(s: SimState, x: unknown, y: unknown, r: unknown): AdminResult {
  if (!finite(x) || !finite(y) || !finite(r) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6 || r <= 0 || r > ADMIN.maxRadius) return { ok: false, reason: "Некорректный круг" };
  const revealed = [...s.finds.revealed, { digId: s.nextBuildingId, x, y, r }].slice(-ADMIN.maxReveals);
  return { ok: true, sim: { ...s, nextBuildingId: s.nextBuildingId + 1, finds: { ...s.finds, revealed } } };
}
