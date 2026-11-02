// Pure scale and pointer maths of the engine View backend (no DOM, no GPU).

// Metres per CSS pixel at the camera target for an eye distance: the vertical field of view spans the canvas height.
export function distanceToMpp(distance: number, fovYDeg: number, heightPx: number): number {
  return (2 * distance * Math.tan((fovYDeg * Math.PI) / 360)) / Math.max(1, heightPx);
}

export function mppToDistance(mpp: number, fovYDeg: number, heightPx: number): number {
  return (mpp * Math.max(1, heightPx)) / (2 * Math.tan((fovYDeg * Math.PI) / 360));
}

// MapLibre's click tolerance: a press that moved this far (CSS px) is a drag, not a click.
export const CLICK_TOLERANCE = 3;

export function isClick(down: readonly [number, number] | null, up: readonly [number, number], tolerance = CLICK_TOLERANCE): boolean {
  if (!down) return true; // no press seen (a synthetic click): let it through
  return Math.hypot(up[0] - down[0], up[1] - down[1]) <= tolerance;
}

// CSS transform that puts a marker element's anchor on a screen point: the pin's tip is its bottom-centre, a custom
// element is centred on the point.
export type MarkerAnchor = "bottom" | "center";
export function markerTransform(x: number, y: number, anchor: MarkerAnchor): string {
  return `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, ${anchor === "bottom" ? "-100%" : "-50%"})`;
}
