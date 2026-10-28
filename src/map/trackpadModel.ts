export type WheelIntent = "pan" | "zoom";

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

export function wheelIntent(e: WheelLike): WheelIntent {
  if (e.ctrlKey || e.metaKey) return "zoom";
  if (e.deltaMode !== 0) return "zoom";
  const ax = Math.abs(e.deltaX);
  const ay = Math.abs(e.deltaY);
  if (ax > 0.5) return "pan";
  return ay > 0 && ay < 50 ? "pan" : "zoom";
}

export function trackpadPanDelta(e: Pick<WheelLike, "deltaX" | "deltaY">): [number, number] {
  const clamp = (n: number) => Math.max(-160, Math.min(160, n));
  return [clamp(e.deltaX), clamp(e.deltaY)];
}
