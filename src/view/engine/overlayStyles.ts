import type { OverlayLayer } from "../../engine/overlay/overlayRaster";
import { PALETTE } from "../../ui/palette";

// How the engine draws the game's tool overlays (view.ts OverlayId): the look of the MapLibre layers in
// src/view/maplibre/overlays.ts, in the same order (later on top). Sources are the overlay ids.

const placeColour = (p: Record<string, unknown>) => (p.pending ? PALETTE.warn : p.ok ? PALETTE.ok : PALETTE.bad);

export const TOOL_OVERLAYS: OverlayLayer[] = [
  { source: "road-hover", style: { kind: "line", color: PALETTE.bad, widthPx: 6, opacity: 0.75 } },
  { source: "road-preview", style: { kind: "line", color: (p) => (p.ok ? PALETTE.ok : PALETTE.bad), widthPx: 3, dash: [2, 1.5] } },
  { source: "road-snap", style: { kind: "circle", radiusPx: 6, color: PALETTE.paperRaised, strokeColor: PALETTE.info, strokeWidthPx: 2 } },
  { source: "place-radius", style: { kind: "fill", color: PALETTE.paperRaised, opacity: 0.25 } },
  { source: "place-radius", style: { kind: "line", color: PALETTE.ink2, widthPx: 1.5, dash: [3, 2], opacity: 0.7 } },
  { source: "place-lot", style: { kind: "fill", color: placeColour, opacity: 0.45 } },
  { source: "place-lot", style: { kind: "line", color: placeColour, widthPx: 2 } },
  { source: "reveal-disc", style: { kind: "fill", color: PALETTE.info, opacity: 0.18 } },
  { source: "reveal-disc", style: { kind: "line", color: PALETTE.info, widthPx: 2, dash: [3, 2] } },
  { source: "follow-target", style: { kind: "circle", radiusPx: 12, color: PALETTE.warn, opacity: 0.12, strokeColor: PALETTE.warn, strokeWidthPx: 2, strokeOpacity: 0.9 } },
];
