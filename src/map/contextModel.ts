import { UI } from "../buildings/ui";
import type { BuildingUi } from "../buildings/uiKit";

export type ContextLayer = "forest" | "water" | "quarry" | "ruins" | null;

export function contextLayerForTool(tool: string | null): ContextLayer {
  if (tool === "clearing") return "forest";
  if (tool === "restore") return "ruins";
  return (tool && (UI as Record<string, BuildingUi | undefined>)[tool]?.tool?.context) || null; // a building's tool: its ui.ts
}

export type CursorKind = "" | "crosshair" | "not-allowed";
export function placementCursor(active: boolean, verdict: "ok" | "bad" | "pending" | "none"): CursorKind {
  if (!active) return "";
  if (verdict === "bad" || verdict === "none") return "not-allowed";
  return "crosshair";
}
