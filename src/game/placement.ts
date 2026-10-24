// Pure can-build rules; callers supply terrain info for the cell and its ring-1 neighbours.
import { gridDisk } from "h3-js";
import type { CellInfo } from "../world/cells";
import { BUILDINGS, HUT_LANDS, QUARRY_MIN_SLOPE, RESOURCES, WELL_FORBIDDEN_LANDS, WELL_RADIUS, type BuildingType } from "./defs";
import { buildCost, type EconomyState } from "./sim";

export interface PlaceContext {
  info: CellInfo;
  neighbours: CellInfo[]; // ring 1
  state: EconomyState;
}

export type CanBuild = { ok: true } | { ok: false; reason: string };

const no = (reason: string): CanBuild => ({ ok: false, reason });

const RESOURCE_REASON = { food: "Не хватает еды", wood: "Не хватает дерева", stone: "Не хватает камня" };

function hasWaterAccess({ info, neighbours, state }: PlaceContext): boolean {
  if ([info, ...neighbours].some((i) => i.landShares.water > 0 || i.river)) return true;
  return gridDisk(info.cell, WELL_RADIUS).some((c) => state.buildings[c]?.type === "well");
}

function landReason(type: BuildingType, info: CellInfo): string | null {
  switch (type) {
    case "hut":
      if (!(HUT_LANDS as readonly string[]).includes(info.land)) return "Нужен луг, лес или песок";
      return info.steep ? "Слишком круто" : null;
    case "farm":
      if (info.land !== "meadow") return "Нужен луг";
      return info.steep ? "Слишком круто" : null;
    case "lumber":
      return info.land === "forest" ? null : "Нужен лес";
    case "quarry":
      if (info.land === "wetland") return "Нельзя копать на болоте";
      return info.land === "rock" || info.slope >= QUARRY_MIN_SLOPE ? null : "Нужны скалы или склон";
    case "well":
      return (WELL_FORBIDDEN_LANDS as readonly string[]).includes(info.land) ? "Нельзя копать здесь" : null;
    default:
      return null;
  }
}

export function canBuild(type: BuildingType, ctx: PlaceContext): CanBuild {
  const { info, state } = ctx;
  if (!BUILDINGS[type].buildable) return no("Нельзя построить");
  if (info.land === "water") return no("Нельзя строить на воде");
  if (state.buildings[info.cell]) return no("Клетка занята");
  if (!gridDisk(info.cell, 1).some((c) => c !== info.cell && state.buildings[c])) return no("Нужно строить рядом с поселением");
  const lr = landReason(type, info);
  if (lr) return no(lr);
  if (type === "hut" && !hasWaterAccess(ctx)) return no("Нет воды рядом");
  const cost = buildCost(type, state);
  for (const r of RESOURCES) if (state[r] < cost[r]) return no(RESOURCE_REASON[r]);
  return { ok: true };
}
