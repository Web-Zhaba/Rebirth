import { play } from "../ui/sound";
import { effect, signal } from "@preact/signals";
import { mixHex, MAP_ONLY, PALETTE, PLACED_BUILDING_COLORS } from "../ui/palette";
import type { RoadKind, ServiceId } from "../sim/types";
import { shouldRepeatTool } from "../ui/inputModel";
import { storedChoice } from "../ui/preferenceModel";
import { mppAtZoom, type View } from "../view/view";
import { L } from "../i18n";

// Road tools; a tool plus its material (see roadMaterial) picks the sim RoadKind. restore: rebuild a revealed old street as a whole.
export type RoadTool = "path" | "dirt" | "footbridge" | "bridge" | "bulldoze" | "restore";
// How a road segment is drawn: dragged straight between two points, or an arc through a bend point.
export type RoadMode = "straight" | "arc";
// Outlines drawn on the land (map/landTool.ts).
export type LandTool = "field" | "clearing";
// Laid in strokes along roads (map/strokeTool.ts, sim/stroke.ts): houses, workshops and shops, as variants of three tools.
export type StrokeTool = "house" | "workshop" | "shop";
export type PlaceTool = StrokeTool | "gumno" | "woodcutter" | "sawpit" | "quarry" | "fisher" | "garden" | "hunter" | "forager" | "orchard" | "apiary" | "barn" | "cellar" | "dig" | "restored" | "museum" | "townhall" | ServiceId;
export type Tool = RoadTool | LandTool | PlaceTool;

export const isRoadTool = (t: Tool): t is RoadTool => t === "bulldoze" || t === "restore" || t === "path" || t === "dirt" || t === "footbridge" || t === "bridge";
export const isLandTool = (t: Tool): t is LandTool => t === "field" || t === "clearing";
export const STROKE_TOOLS: StrokeTool[] = ["house", "workshop", "shop"];
export const isStrokeTool = (t: Tool | null): t is StrokeTool => t === "house" || t === "workshop" || t === "shop";
export const PLACE_TOOLS: PlaceTool[] = [...STROKE_TOOLS, "gumno", "woodcutter", "sawpit", "quarry", "fisher", "garden", "hunter", "forager", "orchard", "apiary", "barn", "cellar", "dig", "restored", "museum", "well", "market", "chapel", "school", "healer", "townhall"];
export const isPlaceTool = (t: Tool): t is PlaceTool => (PLACE_TOOLS as string[]).includes(t);

// One tool at a time across the toolbar; null = none (the map pans normally).
export const tool = signal<Tool | null>(null);
export const lastTool = signal<Tool | null>(null);
effect(() => {
  const current = tool.value;
  if (current) lastTool.value = current;
});

export function attachToolRepeat(view: View): void {
  view.canvas.addEventListener("pointerdown", (e: PointerEvent) => {
    if (!e.isPrimary || !shouldRepeatTool(e.button, tool.peek(), lastTool.peek())) return;
    e.preventDefault();
    tool.value = lastTool.peek();
  });
}
// Road drawing mode, shared by every road kind; kept between tools.
export const roadMode = signal<RoadMode>("straight");
export const ROAD_MODES: { id: RoadMode; label: string; title: string }[] = [
  { id: "straight", label: L("Прямая", "Straight"), title: L("Прямая: протяните от начала до конца", "Straight: drag from start to end") },
  { id: "arc", label: L("Дуга", "Curve"), title: L("Дуга: протяните начало и конец, затем движение мышью задаёт изгиб", "Curve: drag start and end, then move the mouse to set the bend") },
];
// Material of the road and bridge tools (tech upgrades change a tool, they do not add one): the sim kind each draws.
export type MaterialTool = "dirt" | "bridge";
export const ROAD_MATERIALS: Record<MaterialTool, { id: RoadKind; label: string; title: string }[]> = {
  dirt: [
    { id: "dirt", label: L("Грунт", "Dirt"), title: L("Грунтовая дорога", "Dirt road") },
    { id: "stone", label: L("Камень", "Stone"), title: L("Каменная дорога", "Stone road") },
  ],
  bridge: [
    { id: "bridge", label: L("Свайный", "Pile"), title: L("Свайный мост", "Pile bridge") },
    { id: "stonebridge", label: L("Каменный", "Stone"), title: L("Каменный мост", "Stone bridge") },
  ],
};
export const roadMaterial = signal<Record<MaterialTool, RoadKind>>({ dirt: "dirt", bridge: "bridge" });
export const isMaterialTool = (t: Tool): t is MaterialTool => t === "dirt" || t === "bridge";
// The sim road kind a tool draws, or null for the bulldozer, the restore tool and non-road tools.
export function roadKindOf(t: Tool | null, material: Record<MaterialTool, RoadKind> = roadMaterial.value): RoadKind | null {
  if (t === "path" || t === "footbridge") return t;
  return t && isMaterialTool(t) ? material[t] : null;
}
// Kinds of building one placement tool puts down, picked with a switch (new buildings come as variants of a tool, not
// as tools of their own): the storehouse (docs/PLAN-balance.md B4) and the administration (B7). The first is the default.
export interface PlaceVariant {
  id: string; // template
  label: string;
  title: string;
}
export const PLACE_VARIANTS: Partial<Record<PlaceTool, PlaceVariant[]>> = {
  house: [
    { id: "izba", label: L("Дом", "House"), title: L("Дом на одну семью", "A house for one family") },
    { id: "izba5", label: L("Большой", "Large"), title: L("Большой дом на две семьи", "A large house for two families") },
  ],
  workshop: [
    { id: "weaver", label: L("Ткацкая", "Weaving"), title: L("Ткацкая мастерская: одежда", "Weaving workshop: clothing") },
    { id: "pottery", label: L("Гончарня", "Pottery"), title: L("Гончарня: посуда", "Pottery: dishes") },
    { id: "carpentry", label: L("Столярная", "Carpentry"), title: L("Столярная мастерская: утварь из досок", "Carpentry workshop: furnishings from planks") },
    { id: "smithy", label: L("Кузница", "Smithy"), title: L("Кузница: инструменты", "Smithy: tools") },
  ],
  shop: [
    { id: "shop", label: L("Магазин", "Shop"), title: L("Магазин: раздаёт товары по домам", "Shop: hands goods out to the houses") },
    { id: "tavern", label: L("Таверна", "Tavern"), title: L("Таверна: вечерний отдых", "Tavern: evening rest") },
  ],
  barn: [
    { id: "barn", label: L("Еда", "Food"), title: L("Амбар: зерно и припасы", "Barn: grain and provisions") },
    { id: "logyard", label: L("Лес", "Timber"), title: L("Склад леса: брёвна и доски", "Timber yard: logs and planks") },
    { id: "stoneyard", label: L("Камень", "Stone"), title: L("Склад камня", "Stone yard") },
    { id: "warehouse", label: L("Товары", "Goods"), title: L("Товарный склад: одежда, посуда, утварь, инструменты", "Warehouse: clothing, dishes, furnishings, tools") },
  ],
  townhall: [
    { id: "townhall", label: L("Ратуша", "Town hall"), title: L("Ратуша: одна на город", "Town hall: one per town") },
    { id: "office", label: L("Управа", "Office"), title: L("Районная управа", "District office") },
  ],
};
export const placeVariant = signal<Partial<Record<PlaceTool, string>>>({});
// The template a placement tool puts down: the kind chosen for it, or its first kind, or the tool itself.
export const placeTemplate = (t: PlaceTool, chosen: Partial<Record<PlaceTool, string>> = placeVariant.value): string => chosen[t] ?? PLACE_VARIANTS[t]?.[0].id ?? t;

// A stroke takes only old foundations and leaves the gaps empty (G); kept between sessions.
const ONLY_FOUNDATIONS_STORE = "rebirth.stroke.onlyFoundations";
const readOnlyFoundations = (): boolean => {
  try {
    return localStorage.getItem(ONLY_FOUNDATIONS_STORE) === "1";
  } catch {
    return false;
  }
};
export const onlyFoundations = signal(readOnlyFoundations());
export function setOnlyFoundations(on: boolean): void {
  onlyFoundations.value = on;
  try {
    localStorage.setItem(ONLY_FOUNDATIONS_STORE, on ? "1" : "0");
  } catch {
    /* ignore */
  }
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

// Drawing is allowed only when the map is closer than these (metres per pixel; the zoom they were set at is noted).
export const BUILD_MAX_MPP = mppAtZoom(15); // old MIN_ZONE_ZOOM 15
export const ROAD_MAX_MPP = mppAtZoom(14); // old MIN_ROAD_ZOOM 14

// Drawing and placement tools own map input; Space temporarily gives panning back to the camera.
let panOff = false;
let spaceHeld = false;
export const setSpacePan = (on: boolean): void => {
  spaceHeld = on;
};
export function panLockedForTool(t: Tool | null, mpp: number, temporaryPan = false): boolean {
  if (!t || temporaryPan) return false;
  if (isRoadTool(t)) return mpp <= ROAD_MAX_MPP;
  return (isLandTool(t) || isPlaceTool(t)) && mpp <= BUILD_MAX_MPP;
}

export function syncPan(view: View): void {
  const want = panLockedForTool(tool.value, view.metersPerPixel(), spaceHeld);
  if (want === panOff) return;
  panOff = want;
  view.setPanEnabled(!want);
}

// Colours of player-placed buildings, per template.
export const PLACED_COLORS: Record<PlaceTool, string> = PLACED_BUILDING_COLORS;

// Map overlay: houses tinted by coverage of one service, or by a value; or roads by commuter traffic.
export type Overlay = "none" | ServiceId | "value" | "mood" | "traffic";
export const OVERLAYS: { id: Overlay; label: string }[] = [
  { id: "none", label: L("нет", "none") },
  { id: "well", label: L("вода (колодец)", "water (well)") },
  { id: "market", label: L("рынок", "market") },
  { id: "chapel", label: L("храм", "temple") },
  { id: "school", label: L("школа", "school") },
  { id: "healer", label: L("лечебница", "infirmary") },
  { id: "value", label: L("стоимость земли", "land value") },
  { id: "mood", label: L("настроение", "mood") },
  { id: "traffic", label: L("движение", "traffic") },
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

const SERVICE_OVERLAY_TOOLS: readonly ServiceId[] = ["well", "market", "chapel", "school", "healer"];
export const serviceOverlayForTool = (t: Tool | null): ServiceId | null =>
  t && (SERVICE_OVERLAY_TOOLS as readonly string[]).includes(t) ? (t as ServiceId) : null;

// A service tool shows its coverage overlay while it is active; the overlay the player chose comes back after it.
let hadAutomaticLayer = false;
effect(() => {
  const service = serviceOverlayForTool(tool.value);
  if (service) {
    hadAutomaticLayer = true;
    overlay.value = service;
  } else if (hadAutomaticLayer) {
    hadAutomaticLayer = false;
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
