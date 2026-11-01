import { computed, effect, type ReadonlySignal } from "@preact/signals";
import type { FeatureCollection } from "geojson";
import type { Engine } from "../../engine/engine";
import { OVERLAY_PATTERN } from "../../engine/overlay/geometry";
import type { OverlayLayer } from "../../engine/overlay/overlayRaster";
import { TRAFFIC_STOPS, ZONE_COLORS } from "../../map/tools";
import { C } from "../../world/biome";
import { mixHex, PALETTE } from "../../ui/palette";
import { buildingShapes } from "../layers/buildings";
import { campArea, cityPoint } from "../layers/city";
import { serviceReach } from "../layers/reach";
import { ruinFloors, ruinHints, ruinStreets, ruinTyped, ruinWalls } from "../layers/ruins";
import { roadTraffic } from "../layers/traffic";
import { ruinsAutoShown, ruinsShown } from "../ruinsShown";
import { roadLines } from "../layers/roads";
import { clearings, fieldDraftPoints, fieldDraftShape, fields, zoneCells, zoneGrid, zoneHover } from "../layers/zones";
import { mppAtZoom } from "../view";
import { TOOL_OVERLAYS } from "./overlayStyles";

// The game's 2D map on the engine: zones, fields, clearings, roads and lots drawn into the overlay raster from the same
// data the MapLibre layers show (view/layers/*), in their look and order (bottom first), the tool overlays on top.
// Their text (clearing percents, names of the old city) is DOM over the canvas: gameLabels.ts.

type P = Record<string, unknown>;

const ZONE_MPP = mppAtZoom(15); // the old zone layers' minzoom

const roadColour = (p: P) =>
  ({ dirt: PALETTE.roadDirt, footbridge: PALETTE.roadBridge, bridge: PALETTE.roadBridge, stone: PALETTE.roadStone, stonebridge: PALETTE.roadStone })[p.kind as string] ?? PALETTE.roadPath;
const roadEdge = (p: P) =>
  ({ dirt: PALETTE.roadDirtEdge, footbridge: PALETTE.roadBridgeEdge, bridge: PALETTE.roadBridgeEdge, stone: PALETTE.roadStoneEdge, stonebridge: PALETTE.roadStoneEdge })[p.kind as string] ??
  PALETTE.roadPathEdge;
const width = (p: P) => Number(p.w ?? 3);

// The traffic ramp of the old layer (tools.ts TRAFFIC_STOPS), interpolated linearly by commuters per day.
function trafficRamp(n: number): { color: string; width: number } {
  const s = TRAFFIC_STOPS;
  if (n <= s[0].n) return s[0];
  for (let i = 1; i < s.length; i++)
    if (n <= s[i].n) {
      const t = (n - s[i - 1].n) / (s[i].n - s[i - 1].n);
      return { color: mixHex(s[i - 1].color, s[i].color, t), width: s[i - 1].width + (s[i].width - s[i - 1].width) * t };
    }
  return s[s.length - 1];
}
const is = (state: string) => (p: P) => p.state === state;

const z = mppAtZoom;
// The hatches of the old fill-pattern images (map/patterns.ts): ink at 55 %, residential dots, craft diagonals, trade
// cross-hatch (the fallback, as in the old match expression), field furrows.
const PATTERN_INK = 0.55;
const ZONE_PATTERN: Record<string, number> = { res: OVERLAY_PATTERN.res, craft: OVERLAY_PATTERN.craft, trade: OVERLAY_PATTERN.trade };
const ruinState = (p: P) => String(p.s ?? "");

export const GAME_LAYERS: OverlayLayer[] = [
  // The buried old city under everything of the new town (the old layers' look). Its broken walls stand in 3D from the
// same gate (models.ts), its names are DOM text (gameLabels.ts).
  { source: "ruins-floors", maxMpp: z(13), style: { kind: "fill", color: PALETTE.pencilFaint, opacity: 0.28 } },
  {
    source: "ruins-typed",
    maxMpp: z(13),
    style: { kind: "fill", color: (p) => String(p.c), opacity: (p) => ({ restored: 0.12, restoring: 0.3, lost: 0.2 })[ruinState(p)] ?? (p.dim === 1 ? 0.2 : 0.5) },
  },
  { source: "ruins-streets", maxMpp: z(12), style: { kind: "line", color: (p) => (p.bridge ? PALETTE.pencil : PALETTE.warn), widthM: (p) => Number(p.w), widthPx: 1, opacity: (p) => (p.bridge ? 0.6 : 0.3) } },
  { source: "ruins-walls", maxMpp: z(14), style: { kind: "line", color: PALETTE.pencil, widthPx: 1.2, opacity: 0.85, filter: (p) => p.thin === 1 } },
  {
    source: "ruins-typed",
    maxMpp: z(13),
    style: {
      kind: "line",
      color: (p) => String(p.c),
      widthPx: (p) => ({ restoring: 3.5, restored: 1 })[ruinState(p)] ?? 2,
      opacity: (p) => (ruinState(p) === "lost" ? 0.45 : p.dim === 1 ? 0.5 : 0.95),
    },
  },
  { source: "ruins-hints", maxMpp: z(14), style: { kind: "circle", radiusPx: 4, color: PALETTE.pencilFaint, opacity: 0.35, strokeColor: PALETTE.pencilFaint, strokeWidthPx: 1, strokeOpacity: 0.5 } },
  { source: "clearings", style: { kind: "fill", color: C.meadow, filter: (p) => p.done === true } },
  { source: "clearings", style: { kind: "line", color: PALETTE.pencil, widthPx: 2, dash: [2, 1.5], filter: (p) => p.done !== true } },
  { source: "fields", style: { kind: "fill", color: PALETTE.warnFill, opacity: 0.7 } },
  { source: "fields", style: { kind: "fill", color: PALETTE.ink, opacity: PATTERN_INK, pattern: OVERLAY_PATTERN.field } },
  { source: "fields", style: { kind: "line", color: PALETTE.warn, widthPx: 1.5 } },
  { source: "zone-cells", maxMpp: ZONE_MPP, style: { kind: "fill", color: (p) => ZONE_COLORS[p.zone as keyof typeof ZONE_COLORS] ?? ZONE_COLORS.trade, opacity: (p) => (p.occ ? 0.14 : 0.34) } },
  { source: "zone-cells", maxMpp: ZONE_MPP, style: { kind: "fill", color: PALETTE.ink, opacity: (p) => PATTERN_INK * (p.occ ? 0.5 : 1), pattern: (p) => ZONE_PATTERN[p.zone as string] ?? OVERLAY_PATTERN.trade } },
  { source: "zone-grid", maxMpp: ZONE_MPP, style: { kind: "line", color: PALETTE.ink, widthPx: 0.8, opacity: 0.22 } },
  { source: "zone-hover", maxMpp: ZONE_MPP, style: { kind: "fill", color: PALETTE.paperRaised, opacity: 0.55 } },
  { source: "zone-hover", maxMpp: ZONE_MPP, style: { kind: "line", color: PALETTE.ink, widthPx: 1 } },
  { source: "field-draft", style: { kind: "fill", color: (p) => (p.ok ? PALETTE.warnFill : PALETTE.badFill), opacity: 0.6 } },
  { source: "field-draft", style: { kind: "line", color: (p) => (p.ok ? PALETTE.warn : PALETTE.bad), widthPx: 2, dash: [2, 1.5] } },
  { source: "field-draft-pts", style: { kind: "circle", radiusPx: 4, color: PALETTE.paperRaised, strokeColor: PALETTE.ink, strokeWidthPx: 2 } },
  // The camp area roads must start from, until the first road is built.
  { source: "camp", maxMpp: mppAtZoom(14), style: { kind: "fill", color: PALETTE.warn, opacity: 0.12 } },
  { source: "camp", maxMpp: mppAtZoom(14), style: { kind: "line", color: PALETTE.warn, widthPx: 1.5, dash: [3, 2] } },
  // Roads at real width (a pixel at least); up close the 3D ribbons (models.ts) lie over the built ones.
  { source: "roads", style: { kind: "line", color: roadEdge, widthM: (p) => width(p) + 1.2, widthPx: 2.5, filter: is("built") } },
  { source: "roads", style: { kind: "line", color: roadColour, widthM: width, widthPx: 1, filter: is("built") } },
  { source: "roads", style: { kind: "line", color: roadColour, widthM: width, widthPx: 1, opacity: (p) => (p.state === "active" ? 0.7 : 0.4), dash: [2, 2], filter: (p) => p.state === "active" || p.state === "waiting" } },
  { source: "roads", style: { kind: "line", color: PALETTE.bad, widthM: width, widthPx: 3, opacity: 0.8, dash: [2, 1.5], filter: is("cut") } },
  // Lots: planned ones dashed; standing ones are 3D models (models.ts), a rebuild in progress is ringed.
  { source: "buildings", style: { kind: "fill", color: PALETTE.paperRaised, opacity: 0.4, filter: is("planned") } },
  { source: "buildings", style: { kind: "line", color: PALETTE.ink2, widthPx: 1.5, dash: [2, 1.5], filter: is("planned") } },
  { source: "buildings", style: { kind: "line", color: PALETTE.warn, widthPx: 3, filter: (p) => p.up === true && (p.state === "active" || p.state === "building") } },
  { source: "road-traffic", style: { kind: "line", color: (p) => trafficRamp(Number(p.n)).color, widthPx: (p) => trafficRamp(Number(p.n)).width, opacity: 0.9 } },
  // What a service reaches, over a paper casing; the founding point on top.
  { source: "service-reach", style: { kind: "line", color: PALETTE.paperRaised, widthPx: 8 } },
  { source: "service-reach", style: { kind: "line", color: (p) => String(p.color ?? PALETTE.info), widthPx: 5, opacity: 0.9 } },
  { source: "city", style: { kind: "circle", radiusPx: 7, color: PALETTE.warn, strokeColor: PALETTE.paperRaised, strokeWidthPx: 2 } },
];

const NONE: FeatureCollection = { type: "FeatureCollection", features: [] };
// The old city shows while the player keeps it on, or while a dig needs it (ruinsShown.ts).
const shownRuins = (data: ReadonlySignal<FeatureCollection>): ReadonlySignal<FeatureCollection> => computed(() => (ruinsShown.value || ruinsAutoShown.value ? data.value : NONE));

const SOURCES: [string, ReadonlySignal<FeatureCollection>][] = [
  ["ruins-floors", shownRuins(ruinFloors)],
  ["ruins-typed", shownRuins(ruinTyped)],
  ["ruins-streets", shownRuins(ruinStreets)],
  ["ruins-walls", shownRuins(ruinWalls)],
  ["ruins-hints", shownRuins(ruinHints)],
  ["clearings", clearings],
  ["fields", fields],
  ["zone-cells", zoneCells],
  ["zone-grid", zoneGrid],
  ["zone-hover", zoneHover],
  ["field-draft", fieldDraftShape],
  ["field-draft-pts", fieldDraftPoints],
  ["roads", roadLines],
  ["buildings", buildingShapes],
  ["camp", campArea],
  ["service-reach", serviceReach],
  ["road-traffic", roadTraffic],
  ["city", cityPoint],
];

export function attachGameLayers(engine: Engine): void {
  engine.overlay.setLayers([...GAME_LAYERS, ...TOOL_OVERLAYS]);
  for (const [id, data] of SOURCES) effect(() => engine.overlay.setData(id, data.value));
}
