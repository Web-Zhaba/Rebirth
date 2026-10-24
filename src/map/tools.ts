import { signal } from "@preact/signals";
import type { RoadKind, ZoneType } from "../sim/types";

export type RoadTool = RoadKind | "bulldoze";
export type BrushTool = ZoneType | "clear"; // paints a zone, or clears it
export type ZoneTool = BrushTool | "field";
export type Tool = RoadTool | ZoneTool;

export const isRoadTool = (t: Tool): t is RoadTool => t === "path" || t === "dirt" || t === "bulldoze";
export const isBrushTool = (t: Tool): t is BrushTool => t === "res" || t === "craft" || t === "trade" || t === "clear";

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
