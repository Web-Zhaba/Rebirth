import { lockReason } from "../sim/tech";
import type { RoadKind } from "../sim/types";
import { state } from "../simClient";
import { flash, isMaterialTool, isPlaceTool, PLACE_VARIANTS, placeVariant, roadMaterial, tool, type Tool } from "./tools";

// Why a tool (or one kind of it: a template, a road kind) is closed, or null. Before the town is loaded nothing is.
export function lockOf(t: Tool, kind?: string): string | null {
  const progress = state.peek()?.progress;
  if (!progress) return null;
  return (kind ? lockReason({ progress }, kind) : null) ?? lockReason({ progress }, t);
}

// Picks a tool with one of its kinds (a building template of a placement tool, the road kind of a material tool), as
// the pipette, the search line and the recent keys do. A closed one is refused with its reason; false then.
export function pickTool(t: Tool, kind?: string): boolean {
  const lock = lockOf(t, kind);
  if (lock) {
    flash(lock);
    return false;
  }
  if (kind && isPlaceTool(t) && PLACE_VARIANTS[t]?.some((v) => v.id === kind)) placeVariant.value = { ...placeVariant.value, [t]: kind };
  if (kind && isMaterialTool(t)) roadMaterial.value = { ...roadMaterial.value, [t]: kind as RoadKind };
  tool.value = t;
  return true;
}
