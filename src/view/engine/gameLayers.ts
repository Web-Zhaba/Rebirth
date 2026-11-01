import { effect, type ReadonlySignal } from "@preact/signals";
import type { FeatureCollection } from "geojson";
import type { Engine } from "../../engine/engine";
import type { OverlayLayer } from "../../engine/overlay/overlayRaster";
import { ZONE_COLORS } from "../../map/tools";
import { C } from "../../world/biome";
import { PALETTE } from "../../ui/palette";
import { buildingShapes } from "../layers/buildings";
import { roadLines } from "../layers/roads";
import { clearings, fieldDraftPoints, fieldDraftShape, fields, zoneCells, zoneGrid, zoneHover } from "../layers/zones";
import { mppAtZoom } from "../view";
import { TOOL_OVERLAYS } from "./overlayStyles";

// The game's 2D map on the engine: zones, fields, clearings, roads and lots drawn into the overlay raster from the same
// data the MapLibre layers show (view/layers/*), in their look and order (bottom first), the tool overlays on top.
// Clearing labels and the hatch patterns of zones and fields are not drawn yet.

type P = Record<string, unknown>;

const ZONE_MPP = mppAtZoom(15); // the old zone layers' minzoom

const roadColour = (p: P) =>
  ({ dirt: PALETTE.roadDirt, footbridge: PALETTE.roadBridge, bridge: PALETTE.roadBridge, stone: PALETTE.roadStone, stonebridge: PALETTE.roadStone })[p.kind as string] ?? PALETTE.roadPath;
const roadEdge = (p: P) =>
  ({ dirt: PALETTE.roadDirtEdge, footbridge: PALETTE.roadBridgeEdge, bridge: PALETTE.roadBridgeEdge, stone: PALETTE.roadStoneEdge, stonebridge: PALETTE.roadStoneEdge })[p.kind as string] ??
  PALETTE.roadPathEdge;
const width = (p: P) => Number(p.w ?? 3);
const is = (state: string) => (p: P) => p.state === state;

export const GAME_LAYERS: OverlayLayer[] = [
  { source: "clearings", style: { kind: "fill", color: C.meadow, filter: (p) => p.done === true } },
  { source: "clearings", style: { kind: "line", color: PALETTE.pencil, widthPx: 2, dash: [2, 1.5], filter: (p) => p.done !== true } },
  { source: "fields", style: { kind: "fill", color: PALETTE.warnFill, opacity: 0.7 } },
  { source: "fields", style: { kind: "line", color: PALETTE.warn, widthPx: 1.5 } },
  { source: "zone-cells", maxMpp: ZONE_MPP, style: { kind: "fill", color: (p) => ZONE_COLORS[p.zone as keyof typeof ZONE_COLORS] ?? ZONE_COLORS.trade, opacity: (p) => (p.occ ? 0.14 : 0.34) } },
  { source: "zone-grid", maxMpp: ZONE_MPP, style: { kind: "line", color: PALETTE.ink, widthPx: 0.8, opacity: 0.22 } },
  { source: "zone-hover", maxMpp: ZONE_MPP, style: { kind: "fill", color: PALETTE.paperRaised, opacity: 0.55 } },
  { source: "zone-hover", maxMpp: ZONE_MPP, style: { kind: "line", color: PALETTE.ink, widthPx: 1 } },
  { source: "field-draft", style: { kind: "fill", color: (p) => (p.ok ? PALETTE.warnFill : PALETTE.badFill), opacity: 0.6 } },
  { source: "field-draft", style: { kind: "line", color: (p) => (p.ok ? PALETTE.warn : PALETTE.bad), widthPx: 2, dash: [2, 1.5] } },
  { source: "field-draft-pts", style: { kind: "circle", radiusPx: 4, color: PALETTE.paperRaised, strokeColor: PALETTE.ink, strokeWidthPx: 2 } },
  // Roads at real width (a pixel at least); up close the 3D ribbons (models.ts) lie over the built ones.
  { source: "roads", style: { kind: "line", color: roadEdge, widthM: (p) => width(p) + 1.2, widthPx: 2.5, filter: is("built") } },
  { source: "roads", style: { kind: "line", color: roadColour, widthM: width, widthPx: 1, filter: is("built") } },
  { source: "roads", style: { kind: "line", color: roadColour, widthM: width, widthPx: 1, opacity: (p) => (p.state === "active" ? 0.7 : 0.4), dash: [2, 2], filter: (p) => p.state === "active" || p.state === "waiting" } },
  { source: "roads", style: { kind: "line", color: PALETTE.bad, widthM: width, widthPx: 3, opacity: 0.8, dash: [2, 1.5], filter: is("cut") } },
  // Lots: planned ones dashed; standing ones are 3D models (models.ts), a rebuild in progress is ringed.
  { source: "buildings", style: { kind: "fill", color: PALETTE.paperRaised, opacity: 0.4, filter: is("planned") } },
  { source: "buildings", style: { kind: "line", color: PALETTE.ink2, widthPx: 1.5, dash: [2, 1.5], filter: is("planned") } },
  { source: "buildings", style: { kind: "line", color: PALETTE.warn, widthPx: 3, filter: (p) => p.up === true && (p.state === "active" || p.state === "building") } },
];

const SOURCES: [string, ReadonlySignal<FeatureCollection>][] = [
  ["clearings", clearings],
  ["fields", fields],
  ["zone-cells", zoneCells],
  ["zone-grid", zoneGrid],
  ["zone-hover", zoneHover],
  ["field-draft", fieldDraftShape],
  ["field-draft-pts", fieldDraftPoints],
  ["roads", roadLines],
  ["buildings", buildingShapes],
];

export function attachGameLayers(engine: Engine): void {
  engine.overlay.setLayers([...GAME_LAYERS, ...TOOL_OVERLAYS]);
  for (const [id, data] of SOURCES) effect(() => engine.overlay.setData(id, data.value));
}
