import { radiiAt, type Geodetic } from "../geo/ellipsoid";
import { clampState, type CameraState } from "./camera";

// Camera moves as pure state transforms. Grab-pan and zoom-about-a-point share one solver: shift the target until the
// ray through a pixel hits a given ground point again.

const RAD = Math.PI / 180;

// Ground point under a pixel for a camera state (callers build the view from `s` and march the terrain).
export type PickFn = (s: CameraState, px: number, py: number) => Geodetic | null;

const wrapLng = (d: number): number => (d > 180 ? d - 360 : d < -180 ? d + 360 : d);

// Move s.lat/s.lng so that the pixel (px, py) shows the ground point `grab`. A translation of the camera over the
// ground moves the point under a pixel by about the same amount, so the fixed-point iteration converges in a step or
// two on flat ground and in a few on the globe. Where the ground under the pixel runs faster than the target (pitched
// views, slopes) a full step overshoots; the step from the best state is then halved until it gets closer. Returns false
// when the pixel never saw the ground or the error did not at least halve (the camera is left at the best state found).
export function solveGrab(s: CameraState, grab: { lat: number; lng: number }, px: number, py: number, pick: PickFn, maxIter = 8, tolDeg = 1e-9): boolean {
  let best = { lat: s.lat, lng: s.lng };
  let bestErr = Infinity;
  let firstErr = Infinity;
  let step = { lat: 0, lng: 0 };
  for (let i = 0; i < maxIter; i++) {
    const q = pick(s, px, py);
    if (!q) break;
    const dLat = grab.lat - q.lat;
    const dLng = wrapLng(grab.lng - q.lng);
    const err = Math.hypot(dLat, dLng * Math.cos(q.lat * RAD));
    if (i === 0) firstErr = err;
    if (err < bestErr) {
      bestErr = err;
      best = { lat: s.lat, lng: s.lng };
      if (err < tolDeg) return true;
      step = { lat: dLat, lng: dLng };
    } else step = { lat: step.lat * 0.5, lng: step.lng * 0.5 };
    s.lat = best.lat + step.lat;
    s.lng = best.lng + step.lng;
    clampState(s);
  }
  s.lat = best.lat;
  s.lng = best.lng;
  return bestErr < Infinity && bestErr <= 0.5 * firstErr;
}

// Scale the distance by `factor` and keep the ground point `grab` under the pixel.
export function zoomAbout(s: CameraState, factor: number, grab: { lat: number; lng: number } | null, px: number, py: number, pick: PickFn): void {
  s.distance *= factor;
  clampState(s);
  if (grab) solveGrab(s, grab, px, py, pick);
}

const PAN_PROBE = 8; // px: panAboutCentre measures the centre's scale over this much and applies it to the whole step

// Drag-pan by a pixel delta at the scale of the screen centre. Holding the ground under the cursor instead runs away
// on a pitched view, where towards the horizon a pixel covers ever more ground and the same hand motion flings the
// camera; the centre's scale is the same wherever the drag started. It is measured over a few pixels and applied
// linearly, so a fast flick is not measured further up towards the horizon either.
export function panAboutCentre(s: CameraState, dxPx: number, dyPx: number, widthPx: number, heightPx: number, pick: PickFn): void {
  const len = Math.hypot(dxPx, dyPx);
  if (len === 0) return;
  const k = Math.min(1, PAN_PROBE / len);
  const cx = widthPx / 2;
  const cy = heightPx / 2;
  const lat = s.lat;
  const lng = s.lng;
  const g = pick(s, cx, cy);
  if (!g || !solveGrab(s, g, cx + dxPx * k, cy + dyPx * k, pick)) {
    panByPixels(s, dxPx, dyPx, heightPx);
    return;
  }
  s.lat = lat + (s.lat - lat) / k;
  s.lng = lng + wrapLng(s.lng - lng) / k;
  clampState(s);
}

// Fallback pan when no ground is under the cursor: move the target by a screen-space drag using metres per pixel at the
// target. Pitch stretches the ground along the view direction, hence the 1/cos.
export function panByPixels(s: CameraState, dxPx: number, dyPx: number, viewportH: number): void {
  const mpp = (2 * s.distance * Math.tan((s.fovY * RAD) / 2)) / viewportH;
  const along = (dyPx * mpp) / Math.max(0.3, Math.cos(s.pitch * RAD));
  const across = -dxPx * mpp;
  const sh = Math.sin(s.heading * RAD);
  const ch = Math.cos(s.heading * RAD);
  const dE = across * ch + along * sh;
  const dN = -across * sh + along * ch;
  const r = radiiAt(s.lat);
  // Far out, a drag can ask for more than a hemisphere; cap the step so the globe never jumps.
  const maxRad = 0.5;
  s.lat += Math.max(-maxRad, Math.min(maxRad, dN / r.m)) / RAD;
  s.lng += Math.max(-maxRad, Math.min(maxRad, dE / (r.n * Math.max(0.05, Math.cos(s.lat * RAD))))) / RAD;
  clampState(s);
}

// MapLibre's mouse rotate: 0.8 deg of bearing per pixel across, 0.5 deg of pitch per pixel up.
export const ROTATE_DEG_PER_PX = 0.8;
export const PITCH_DEG_PER_PX = 0.5;

export function rotateByPixels(s: CameraState, dxPx: number, dyPx: number): void {
  s.heading += dxPx * ROTATE_DEG_PER_PX;
  s.pitch -= dyPx * PITCH_DEG_PER_PX;
  clampState(s);
}
