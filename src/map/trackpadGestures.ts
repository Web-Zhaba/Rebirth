import type * as maplibregl from "maplibre-gl";
import { trackpadCameraDelta, wheelIntent } from "./trackpadModel";

const MAX_PITCH = 75;
const clampPitch = (pitch: number): number => Math.max(0, Math.min(MAX_PITCH, pitch));

// Two-finger trackpad movement rotates the camera horizontally and tilts it vertically.
// Pinch-to-zoom and all mouse camera controls are left to MapLibre unchanged.
export function attachTrackpadGestures(map: maplibregl.Map): () => void {
  const canvas = map.getCanvas();

  const onWheel = (e: WheelEvent) => {
    if (wheelIntent(e) !== "camera") return;
    e.preventDefault();
    e.stopPropagation();
    const d = trackpadCameraDelta(e);
    map.jumpTo({
      bearing: map.getBearing() + d.bearing,
      pitch: clampPitch(map.getPitch() + d.pitch),
    });
  };

  canvas.addEventListener("wheel", onWheel, { passive: false, capture: true });
  return () => canvas.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
}
