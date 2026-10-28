import type * as maplibregl from "maplibre-gl";
import { trackpadPanDelta, wheelIntent } from "./trackpadModel";

// Browsers report two-finger trackpad scrolling as small pixel-based wheel deltas.
// MapLibre treats wheel primarily as zoom, so intercept only gestures that look like trackpad scrolling.
// Ctrl+wheel is left untouched because Chromium uses it for pinch-to-zoom.
export function attachTrackpadGestures(map: maplibregl.Map): () => void {
  const canvas = map.getCanvas();
  const onWheel = (e: WheelEvent) => {
    if (wheelIntent(e) !== "pan") return;
    e.preventDefault();
    e.stopPropagation();
    map.panBy(trackpadPanDelta(e), { duration: 0 });
  };
  canvas.addEventListener("wheel", onWheel, { passive: false, capture: true });
  return () => canvas.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
}
