export type ContextLayer = "forest" | "water" | "quarry" | "ruins" | null;

export function contextLayerForTool(tool: string | null): ContextLayer {
  if (tool === "clearing" || tool === "woodcutter" || tool === "forager") return "forest";
  if (tool === "fisher") return "water";
  if (tool === "quarry") return "quarry";
  if (tool === "dig" || tool === "restore") return "ruins";
  return null;
}

export type CursorKind = "" | "crosshair" | "not-allowed";
export function placementCursor(active: boolean, verdict: "ok" | "bad" | "pending" | "none"): CursorKind {
  if (!active) return "";
  if (verdict === "bad" || verdict === "none") return "not-allowed";
  return "crosshair";
}
