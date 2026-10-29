export type WheelIntent = "camera" | "zoom";

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

// Pixel-mode wheel events with small deltas are how desktop browsers expose two-finger
// trackpad movement. Pinch-to-zoom arrives with Ctrl/Meta and must stay with MapLibre.
export function wheelIntent(e: WheelLike): WheelIntent {
  if (e.ctrlKey || e.metaKey) return "zoom";
  if (e.deltaMode !== 0) return "zoom";
  const ax = Math.abs(e.deltaX);
  const ay = Math.abs(e.deltaY);
  if (ax > 0.5) return "camera";
  return ay > 0 && ay < 50 ? "camera" : "zoom";
}

export interface CameraDelta {
  bearing: number;
  pitch: number;
}

// Horizontal two-finger movement rotates the camera, vertical movement changes pitch.
// Clamp spikes from browser/driver gesture hand-off so one event cannot flip the view.
export function trackpadCameraDelta(e: Pick<WheelLike, "deltaX" | "deltaY">): CameraDelta {
  const clamp = (n: number) => Math.max(-80, Math.min(80, n));
  return {
    bearing: clamp(e.deltaX) * 0.18,
    pitch: clamp(e.deltaY) * 0.12,
  };
}
