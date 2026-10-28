import { play } from "../ui/sound";
import type * as maplibregl from "maplibre-gl";
import { effect, signal } from "@preact/signals";
import { BUILDING_ZONE_COLORS, mixHex, MAP_ONLY, PALETTE, PLACED_BUILDING_COLORS } from "../ui/palette";
import type { RoadKind, ServiceId, ZoneType } from "../sim/types";
import { shouldRepeatTool } from "../ui/inputModel";
import { storedChoice } from "../ui/preferenceModel";

// Road tools; a tool plus its material (see roadMaterial) picks the sim RoadKind. restore: rebuild a revealed old street as a whole.
export type RoadTool = "path" | "dirt" | "footbridge" | "bridge" | "bulldoze" | "restore";
// How a road segment is drawn: dragged straight between two points, or an arc through a bend point.
export type RoadMode = "straight" | "arc";
export type BrushTool = ZoneType | "clear"; // paints a zone, or clears it
export type ZoneTool = BrushTool | "field" | "clearing";
export type PlaceTool = "gumno" | "woodcutter" | "sawpit" | "quarry" | "fisher" | "garden" | "hunter" | "forager" | "orchard" | "apiary" | "barn" | "cellar" | "dig" | ServiceId;
export type Tool = RoadTool | ZoneTool | PlaceTool;

export const isRoadTool = (t: Tool): t is RoadTool => t === "bulldoze" || t === "restore" || t === "path" || t === "dirt" || t === "footbridge" || t === "bridge";
export const isBrushTool = (t: Tool): t is BrushTool => t === "res" || t === "craft" || t === "trade" || t === "clear";
export const PLACE_TOOLS: PlaceTool[] = ["gumno", "woodcutter", "sawpit", "quarry", "fisher", "garden", "hunter", "forager", "orchard", "apiary", "barn", "cellar", "dig", "well", "market", "chapel", "school", "healer"];
export const isPlaceTool = (t: Tool): t is PlaceTool => (PLACE_TOOLS as string[]).includes(t);

// One tool at a time across the toolbar; null = none (the map pans normally).
export const tool = signal<Tool | null>(null);
export const lastTool = signal<Tool | null>(null);
effect(() => {
  const current = tool.value;
  if (current) lastTool.value = current;
});

export function attachToolRepeat(map: maplibregl.Map): void {
  map.getCanvas().addEventListener("mousedown", (e) => {
    if (!shouldRepeatTool(e.button, tool.peek(), lastTool.peek())) return;
    e.preventDefault();
    tool.value = lastTool.peek();
  });
}
// Road drawing mode, shared by every road kind; kept between tools.
export const roadMode = signal<RoadMode>("straight");
export const ROAD_MODES: { id: RoadMode; label: string; title: string }[] = [
  { id: "straight", label: "Прямая", title: "Прямая: протяните от начала до конца" },
  { id: "arc", label: "Дуга", title: "Дуга: протяните начало и конец, затем движение мышью задаёт изгиб" },
];
// Material of the road and bridge tools (tech upgrades change a tool, they do not add one): the sim kind each draws.
export type MaterialTool = "dirt" | "bridge";
export const ROAD_MATERIALS: Record<MaterialTool, { id: RoadKind; label: string; title: string }[]> = {
  dirt: [
    { id: "dirt", label: "Грунт", title: "Грунтовая дорога" },
    { id: "stone", label: "Камень", title: "Каменная дорога" },
  ],
  bridge: [
    { id: "bridge", label: "Свайный", title: "Свайный мост" },
    { id: "stonebridge", label: "Каменный", title: "Каменный мост" },
  ],
};
export const roadMaterial = signal<Record<MaterialTool, RoadKind>>({ dirt: "dirt", bridge: "bridge" });
export const isMaterialTool = (t: Tool): t is MaterialTool => t === "dirt" || t === "bridge";
// The sim road kind a tool draws, or null for the bulldozer, the restore tool and non-road tools.
export function roadKindOf(t: Tool | null, material: Record<MaterialTool, RoadKind> = roadMaterial.value): RoadKind | null {
  if (t === "path" || t === "footbridge") return t;
  return t && isMaterialTool(t) ? material[t] : null;
}
// Brief message about a rejected action, shown by the toolbar.
export const toolMsg = signal<string | null>(null);

let msgTimer = 0;
export function flash(text: string): void {
  play("error");
  toolMsg.value = text;
  clearTimeout(msgTimer);
  msgTimer = window.setTimeout(() => (toolMsg.value = null), 3500);
}

export const MIN_ZONE_ZOOM = 15;
export const MIN_ROAD_ZOOM = 14;

// Drawing tools own the drag: the map must not pan under them (Space pans temporarily).
let panOff = false;
let spaceHeld = false;
export const setSpacePan = (on: boolean): void => {
  spaceHeld = on;
};
export function syncPan(map: maplibregl.Map): void {
  const t = tool.value;
  const zoom = map.getZoom();
  const want = !!t && !spaceHeld && (isRoadTool(t) ? zoom >= MIN_ROAD_ZOOM : isBrushTool(t) ? zoom >= MIN_ZONE_ZOOM : false);
  if (want === panOff) return;
  panOff = want;
  if (want) map.dragPan.disable();
  else map.dragPan.enable();
}

const EQUATOR_M = 40075016.686;
// Meters of ground per screen pixel (MapLibre uses 512 px tiles).
export const mapMpp = (lat: number, zoom: number) => (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);

export const ZONE_COLORS: Record<ZoneType, string> = { res: PALETTE.ok, craft: PALETTE.warn, trade: PALETTE.info };

export const BUILDING_COLORS: Record<ZoneType, string> = BUILDING_ZONE_COLORS;

// Colours of player-placed buildings, per template.
export const PLACED_COLORS: Record<PlaceTool, string> = PLACED_BUILDING_COLORS;

// Map overlay: houses tinted by coverage of one service, or by a value; or roads by commuter traffic.
export type Overlay = "none" | ServiceId | "value" | "mood" | "traffic";
export const OVERLAYS: { id: Overlay; label: string }[] = [
  { id: "none", label: "нет" },
  { id: "well", label: "вода (колодец)" },
  { id: "market", label: "рынок" },
  { id: "chapel", label: "храм" },
  { id: "school", label: "школа" },
  { id: "healer", label: "лечебница" },
  { id: "value", label: "стоимость земли" },
  { id: "mood", label: "настроение" },
  { id: "traffic", label: "движение" },
];
const OVERLAY_STORE = "rebirth.layers.overlay";
const OVERLAY_IDS = OVERLAYS.map((o) => o.id);
const readOverlay = (): Overlay => {
  try {
    return storedChoice(localStorage.getItem(OVERLAY_STORE), OVERLAY_IDS, "none");
  } catch {
    return "none";
  }
};
export const manualOverlay = signal<Overlay>(readOverlay());
export const overlay = signal<Overlay>(manualOverlay.peek());

export function setManualOverlay(id: Overlay): void {
  manualOverlay.value = id;
  overlay.value = id;
  try {
    localStorage.setItem(OVERLAY_STORE, id);
  } catch {
    /* ignore */
  }
}

// Zoning is a separate map layer: hidden during normal play, available manually from the layer menu,
// and temporarily enabled while a zoning brush is active.
const ZONES_STORE = "rebirth.layers.zones";
const readZonesShown = (): boolean => {
  try {
    return localStorage.getItem(ZONES_STORE) === "1";
  } catch {
    return false;
  }
};
export const manualZonesShown = signal(readZonesShown());
export const zonesShown = signal(manualZonesShown.peek());

export function setManualZonesShown(on: boolean): void {
  manualZonesShown.value = on;
  zonesShown.value = on;
  try {
    localStorage.setItem(ZONES_STORE, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

const SERVICE_OVERLAY_TOOLS: readonly ServiceId[] = ["well", "market", "chapel", "school", "healer"];
export const serviceOverlayForTool = (t: Tool | null): ServiceId | null =>
  t && (SERVICE_OVERLAY_TOOLS as readonly string[]).includes(t) ? (t as ServiceId) : null;

// Tools may temporarily own a map layer. Only layers enabled by a tool are reset when that mode ends;
// manually selected layers otherwise stay exactly as the player left them.
let hadAutomaticLayer = false;
effect(() => {
  const t = tool.value;
  const service = serviceOverlayForTool(t);
  const zoning = !!t && isBrushTool(t);
  if (service || zoning) {
    hadAutomaticLayer = true;
    zonesShown.value = zoning;
    overlay.value = service ?? "none";
  } else if (hadAutomaticLayer) {
    hadAutomaticLayer = false;
    zonesShown.value = manualZonesShown.peek();
    overlay.value = manualOverlay.peek();
  }
});

// House tints of the overlays: covered / not covered, and the bad-mid-good ramp of the value and mood layers; also the legend keys.
export const OVERLAY_COLORS = { good: PALETTE.ok, mid: PALETTE.warn, bad: PALETTE.bad, neutral: PALETTE.pencilFaint };
// Traffic overlay ramp: commuters per road edge per day -> colour and line width (px); also the HUD legend.
export const TRAFFIC_STOPS: { n: number; color: string; width: number }[] = [
  { n: 1, color: mixHex(PALETTE.warnFill, PALETTE.warn, 0.5), width: 3 },
  { n: 5, color: PALETTE.warn, width: 5 },
  { n: 15, color: PALETTE.bad, width: 8 },
  { n: 40, color: MAP_ONLY.badDeep, width: 11 },
];

// Reach of the service being placed: where its lot front would be, and how far it serves (m).
export const placeReach = signal<{ x: number; y: number; range: number; color: string } | null>(null);

// Radius (m) of the terrain around a lot that matters to a placed building.
export const SITE_RADIUS: Partial<Record<PlaceTool, number>> = { woodcutter: 150, fisher: 100, forager: 150 };
