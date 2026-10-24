import { signal } from "@preact/signals";
import type { RoadKind, ServiceId, ZoneType } from "../sim/types";

export type RoadTool = RoadKind | "bulldoze";
export type BrushTool = ZoneType | "clear"; // paints a zone, or clears it
export type ZoneTool = BrushTool | "field";
export type PlaceTool = "gumno" | "woodcutter" | "sawpit" | "quarry" | "fisher" | "barn" | ServiceId;
export type Tool = RoadTool | ZoneTool | PlaceTool;

export const isRoadTool = (t: Tool): t is RoadTool => t === "path" || t === "dirt" || t === "bulldoze";
export const isBrushTool = (t: Tool): t is BrushTool => t === "res" || t === "craft" || t === "trade" || t === "clear";
export const PLACE_TOOLS: PlaceTool[] = ["gumno", "woodcutter", "sawpit", "quarry", "fisher", "barn", "well", "market", "chapel", "school", "healer"];
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
  well: "#5aa0c8",
  market: "#d08a3c",
  chapel: "#9a78bd",
  school: "#4aa583",
  healer: "#cf5d57",
};

// Map overlay: houses tinted by coverage of one service, or by a value; or roads by commuter traffic.
export type Overlay = "none" | ServiceId | "value" | "mood" | "traffic";
export const OVERLAYS: { id: Overlay; label: string }[] = [
  { id: "none", label: "нет" },
  { id: "well", label: "вода (колодец)" },
  { id: "market", label: "рынок" },
  { id: "chapel", label: "часовня" },
  { id: "school", label: "школа" },
  { id: "healer", label: "лекарь" },
  { id: "value", label: "стоимость земли" },
  { id: "mood", label: "настроение" },
  { id: "traffic", label: "движение" },
];
export const overlay = signal<Overlay>("none");
// Traffic overlay ramp: commuters per road edge per day -> colour and line width (px); also the HUD legend.
export const TRAFFIC_STOPS: { n: number; color: string; width: number }[] = [
  { n: 1, color: "#f3e08a", width: 3 },
  { n: 5, color: "#f0b24a", width: 5 },
  { n: 15, color: "#e0662f", width: 8 },
  { n: 40, color: "#a8231c", width: 11 },
];

// Reach of the service being placed: where its lot front would be, and how far it serves (m).
export const placeReach = signal<{ x: number; y: number; range: number; color: string } | null>(null);

// Radius (m) of the terrain around a lot that matters to a placed building.
export const SITE_RADIUS: Partial<Record<PlaceTool, number>> = { woodcutter: 150, fisher: 100, quarry: 50 };
