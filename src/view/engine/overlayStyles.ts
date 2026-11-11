import type { OverlayLayer } from "../../engine/overlay/overlayRaster";
import { PALETTE } from "../../ui/palette";

// How the engine draws the game's tool overlays (view.ts OverlayId): the look of the old map's layers, in their order
// (later on top). Sources are the overlay ids.

const placeColour = (p: Record<string, unknown>) => (p.pending ? PALETTE.warn : p.ok ? PALETTE.ok : PALETTE.bad);
const strokeColour = (p: Record<string, unknown>) => (p.dropped ? PALETTE.pencilFaint : p.kind === "asItWas" ? PALETTE.info : p.kind === "dig" ? PALETTE.warn : PALETTE.ok);

export const TOOL_OVERLAYS: OverlayLayer[] = [
  // red under the bulldozer; a road a drawing tool would rebuild: on a paper halo, green, amber while priced, red when it can't be
  { source: "road-hover", style: { kind: "line", color: PALETTE.paperRaised, widthPx: 10, opacity: 0.8, filter: (p) => p.up === true } },
  { source: "road-hover", style: { kind: "line", color: (p) => (!p.up ? PALETTE.bad : p.ok === null ? PALETTE.warn : p.ok ? PALETTE.ok : PALETTE.bad), widthPx: (p) => (p.up ? 5 : 6), opacity: (p) => (p.up ? 0.95 : 0.75) } },
  // A paper halo under the preview: on the green land its dark green alone hardly reads.
  { source: "road-preview", style: { kind: "line", color: PALETTE.paperRaised, widthPx: 6, opacity: 0.55 } },
  { source: "road-preview", style: { kind: "line", color: (p) => (p.ok ? PALETTE.ok : PALETTE.bad), widthPx: 3, dash: [2, 1.5] } },
  { source: "road-snap", style: { kind: "circle", radiusPx: 6, color: PALETTE.paperRaised, strokeColor: PALETTE.info, strokeWidthPx: 2 } },
  { source: "place-radius", style: { kind: "fill", color: PALETTE.paperRaised, opacity: 0.25 } },
  { source: "place-radius", style: { kind: "line", color: PALETTE.ink2, widthPx: 1.5, dash: [3, 2], opacity: 0.7 } },
  { source: "place-lot", style: { kind: "fill", color: placeColour, opacity: 0.45 } },
  { source: "place-lot", style: { kind: "line", color: placeColour, widthPx: 2 } },
  // A stroke's plan (map/strokeTool.ts): new lots plain, old foundations stronger, "as it was" in the info ink, digs
  // dashed, buildings the player dropped faint; foundations it leaves alone muted and dashed.
  { source: "stroke-skip", style: { kind: "fill", color: PALETTE.pencilFaint, opacity: 0.3 } },
  { source: "stroke-skip", style: { kind: "line", color: PALETTE.pencil, widthPx: 1.5, dash: [2, 2], opacity: 0.8 } },
  { source: "stroke-plan", style: { kind: "fill", color: strokeColour, opacity: (p) => (p.dropped ? 0.08 : p.kind === "lot" ? 0.32 : 0.5) } },
  { source: "stroke-plan", style: { kind: "line", color: PALETTE.paperRaised, widthPx: (p) => (p.hover ? 6 : 4), opacity: 0.6, filter: (p) => !p.dropped } },
  { source: "stroke-plan", style: { kind: "line", color: strokeColour, widthPx: (p) => (p.dropped ? 1 : p.hover ? 3.5 : p.kind === "lot" ? 1.5 : 2.5), opacity: (p) => (p.dropped ? 0.6 : 1), filter: (p) => p.kind !== "dig" } },
  { source: "stroke-plan", style: { kind: "line", color: strokeColour, widthPx: (p) => (p.hover ? 3.5 : 2.5), dash: [2, 1.5], filter: (p) => p.kind === "dig" } },
  { source: "reveal-disc", style: { kind: "fill", color: PALETTE.info, opacity: 0.18 } },
  { source: "reveal-disc", style: { kind: "line", color: PALETTE.info, widthPx: 2, dash: [3, 2] } },
  { source: "follow-target", style: { kind: "circle", radiusPx: 12, color: PALETTE.warn, opacity: 0.12, strokeColor: PALETTE.warn, strokeWidthPx: 2, strokeOpacity: 0.9 } },
];
