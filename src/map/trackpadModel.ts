export type WheelIntent = "pan" | "zoom";

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
}

export function wheelIntent(e: WheelLike): WheelIntent {
  if (e.ctrlKey) return "zoom";
  if (e.deltaMode !== 0) return "zoom";
  const ax = Math.abs(e.deltaX);
  const ay = Math.abs(e.deltaY);
  if (ax > 0.5) return "pan";
  return ay < 60 ? "pan" : "zoom";
}

export function trackpadPanDelta(e: Pick<WheelLike, "deltaX" | "deltaY">): [number, number] {
  return [e.deltaX, e.deltaY];
}
