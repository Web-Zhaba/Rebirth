export type WheelIntent = "camera" | "zoom";

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  wheelDeltaX?: number; // legacy, Chromium and Safari: 120 per notch of a mouse wheel
  wheelDeltaY?: number;
}

const NOTCH = 120;

// Pixel-mode wheel events with small deltas are how desktop browsers expose two-finger
// trackpad movement. Pinch-to-zoom arrives with Ctrl/Meta and must stay a zoom.
export function wheelIntent(e: WheelLike): WheelIntent {
  if (e.ctrlKey || e.metaKey) return "zoom";
  if (e.deltaMode !== 0) return "zoom";
  // Where the legacy delta is there, it tells the devices apart better than the pixel delta, which page zoom and
  // high-resolution wheels scale: a mouse notch is a multiple of 120, a trackpad's scroll exactly -3 x the pixel delta.
  const wx = e.wheelDeltaX ?? 0;
  const wy = e.wheelDeltaY ?? 0;
  if (wy !== 0 && wx === 0 && wy % NOTCH === 0) return "zoom";
  if ((wx !== 0 || wy !== 0) && Math.abs(wx + 3 * e.deltaX) <= 1 && Math.abs(wy + 3 * e.deltaY) <= 1) return "camera";
  const ax = Math.abs(e.deltaX);
  const ay = Math.abs(e.deltaY);
  if (ax > 0.5) return "camera";
  return ay > 0 && ay < 50 ? "camera" : "zoom";
}

// Events closer together than this belong to one gesture.
export const WHEEL_GESTURE_MS = 200;

export interface WheelGesture {
  intent: WheelIntent;
  at: number; // ms, the gesture's latest event
}

// One gesture keeps the intent of its first event: a fast trackpad swipe passes 50 px an event mid-way and must not
// turn into a zoom there. A pinch (Ctrl/Meta) is always a zoom.
export function gestureIntent(prev: WheelGesture | null, e: WheelLike, now: number): WheelGesture {
  const intent = e.ctrlKey || e.metaKey ? "zoom" : prev && now - prev.at < WHEEL_GESTURE_MS ? prev.intent : wheelIntent(e);
  return { intent, at: now };
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
