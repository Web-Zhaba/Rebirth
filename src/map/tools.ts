import { signal } from "@preact/signals";
import type { RoadKind, ZoneType } from "../sim/types";

export type RoadTool = RoadKind | "bulldoze";
export type BrushTool = ZoneType | "clear"; // paints a zone, or clears it
export type ZoneTool = BrushTool | "field";
export type PlaceTool = "gumno" | "woodcutter" | "sawpit" | "quarry" | "fisher" | "barn";
export type Tool = RoadTool | ZoneTool | PlaceTool;

export const isRoadTool = (t: Tool): t is RoadTool => t === "path" || t === "dirt" || t === "bulldoze";
export const isBrushTool = (t: Tool): t is BrushTool => t === "res" || t === "craft" || t === "trade" || t === "clear";
export const PLACE_TOOLS: PlaceTool[] = ["gumno", "woodcutter", "sawpit", "quarry", "fisher", "barn"];
export const isPlaceTool = (t: Tool): t is PlaceTool => (PLACE_TOOLS as string[]).includes(t);

// One tool at a time across the toolbar; null = none (the map pans normally).
export const tool = signal<Tool | null>(null);
// Brief message about a rejected action, shown by the toolbar.
export const toolMsg = signal<string | null>(null);

let msgTimer = 0;
export function flash(text: string): void {
  toolMsg.value = text;
  clearTimeout(msgTimer);
  msgTimer = window.setTimeout(() => (toolMsg.value = null), 3500);
}

export const MIN_ZONE_ZOOM = 15;

const EQUATOR_M = 40075016.686;
// Meters of ground per screen pixel (MapLibre uses 512 px tiles).
export const mapMpp = (lat: number, zoom: number) => (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

export const ZONE_COLORS: Record<ZoneType, string> = { res: "#6fb35a", craft: "#d99a3b", trade: "#4f8fd0" };

export const BUILDING_COLORS: Record<ZoneType, string> = { res: "#9b7653", craft: "#7f7466", trade: "#a8784f" };

// Colours of player-placed buildings, per template.
export const PLACED_COLORS: Record<PlaceTool, string> = {
  gumno: "#c2a24f",
  woodcutter: "#5f7f45",
  sawpit: "#b98a55",
  quarry: "#8d9096",
  fisher: "#4f86a8",
  barn: "#a2573f",
};

// Radius (m) of the terrain around a lot that matters to a placed building.
export const SITE_RADIUS: Partial<Record<PlaceTool, number>> = { woodcutter: 150, fisher: 100, quarry: 50 };
