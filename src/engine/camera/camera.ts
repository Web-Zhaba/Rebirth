import { cross, ecefToGeodetic, enuAt, geodeticToEcef, madd, normalize, scale, add, type Vec3 } from "../geo/ellipsoid";
import { multiply, perspectiveReversedInfinite, viewRotation, type Mat4 } from "./projection";

// Camera without zoom (docs/PLAN-engine.md section 3.5): a target on the ground, the eye's distance to it, heading and
// pitch. The same state works from orbit to street level; only the derived near plane and LOD change.

export const FOV_Y_DEG = 36.87; // MapLibre's, so benchmark scenes frame the same view (src/bench/scenes.ts)
export const MAX_PITCH = 80;
export const MIN_DISTANCE = 5;
export const MAX_DISTANCE = 40_000_000;

export interface CameraState {
  lat: number;
  lng: number;
  h: number; // target height above the ellipsoid (m, as drawn: exaggerated terrain)
  distance: number; // eye to target (m)
  heading: number; // deg clockwise from north
  pitch: number; // deg, 0 = straight down
  fovY: number; // deg
}

export function defaultCamera(): CameraState {
  return { lat: 47.27, lng: 11.4, h: 0, distance: 12_000_000, heading: 0, pitch: 0, fovY: FOV_Y_DEG };
}

// Everything a frame needs from the camera, in f64. `eye` is the only absolute position; draw code subtracts it.
export interface CameraView {
  eye: Vec3;
  target: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  eyeAlt: number; // eye height above the ellipsoid
  eyeAboveGround: number; // above the drawn terrain under the eye (or the ellipsoid if unknown)
  near: number;
  aspect: number;
  tanHalfY: number;
  viewportH: number; // CSS px, for screen-space error
  view: Mat4; // rotation only
  proj: Mat4;
  viewProj: Mat4;
}

const RAD = Math.PI / 180;

export function clampState(s: CameraState): void {
  s.pitch = Math.max(0, Math.min(MAX_PITCH, s.pitch));
  s.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, s.distance));
  s.lat = Math.max(-85, Math.min(85, s.lat));
  s.lng = ((((s.lng + 180) % 360) + 360) % 360) - 180;
  s.heading = ((s.heading % 360) + 360) % 360;
}

// Eye and camera axes in ECEF. Pitch tilts the eye back from above the target towards the heading's opposite side.
export function cameraAxes(s: CameraState): { eye: Vec3; target: Vec3; right: Vec3; up: Vec3; forward: Vec3 } {
  const target = geodeticToEcef(s.lat, s.lng, s.h);
  const enu = enuAt(s.lat, s.lng);
  const sh = Math.sin(s.heading * RAD);
  const ch = Math.cos(s.heading * RAD);
  const sp = Math.sin(s.pitch * RAD);
  const cp = Math.cos(s.pitch * RAD);
  const fh = add(scale(enu.east, sh), scale(enu.north, ch)); // horizontal look direction
  const forward = normalize(add(scale(fh, sp), scale(enu.up, -cp)));
  const right = add(scale(enu.east, ch), scale(enu.north, -sh));
  const up = cross(right, forward);
  const eye = madd(target, forward, -s.distance);
  return { eye, target, right, up, forward };
}

// The least height of the eye over the drawn ground under it (m).
export const EYE_CLEARANCE = 2;

// Tilts the camera up (less pitch) until the eye clears the drawn ground under it: on a slope rising behind the target
// a pitched eye would otherwise sit inside the hill. Looking straight down the eye is `distance` (>= MIN_DISTANCE) above
// the target, so pitch 0 always clears.
export function liftEyeAboveGround(s: CameraState, groundAt: (lat: number, lng: number) => number | null): void {
  const clear = (pitch: number): boolean => {
    const g = ecefToGeodetic(cameraAxes({ ...s, pitch }).eye);
    const ground = groundAt(g.lat, g.lng);
    return ground === null || g.h - ground >= EYE_CLEARANCE;
  };
  if (s.pitch <= 0 || clear(s.pitch)) return;
  let lo = 0;
  let hi = s.pitch;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    if (clear(mid)) lo = mid;
    else hi = mid;
  }
  s.pitch = lo;
}

// Adaptive near plane: a small fraction of the height above ground keeps reversed-Z precision where the eye is,
// never below 0.1 m so street level still resolves.
export function nearPlane(eyeAboveGround: number): number {
  return Math.max(0.1, 0.02 * Math.max(0, eyeAboveGround));
}

export function buildView(s: CameraState, widthPx: number, heightPx: number, groundAt: (lat: number, lng: number) => number | null): CameraView {
  const a = cameraAxes(s);
  const g = ecefToGeodetic(a.eye);
  const ground = groundAt(g.lat, g.lng) ?? 0;
  const eyeAboveGround = g.h - ground;
  const near = nearPlane(eyeAboveGround);
  const aspect = widthPx / Math.max(1, heightPx);
  const fov = s.fovY * RAD;
  const view = viewRotation(a.right, a.up, a.forward);
  const proj = perspectiveReversedInfinite(fov, aspect, near);
  return {
    ...a,
    eyeAlt: g.h,
    eyeAboveGround,
    near,
    aspect,
    tanHalfY: Math.tan(fov / 2),
    viewportH: heightPx,
    view,
    proj,
    viewProj: multiply(proj, view),
  };
}

// Ray direction (ECEF, unit) through a point in normalised device coordinates (-1..1, y up).
export function rayDir(v: CameraView, ndcX: number, ndcY: number): Vec3 {
  const x = ndcX * v.tanHalfY * v.aspect;
  const y = ndcY * v.tanHalfY;
  return normalize([
    v.forward[0] + v.right[0] * x + v.up[0] * y,
    v.forward[1] + v.right[1] * x + v.up[1] * y,
    v.forward[2] + v.right[2] * x + v.up[2] * y,
  ]);
}

// First hit of a ray with a sphere around the earth's centre, or null.
export function raySphere(o: Vec3, d: Vec3, radius: number): number | null {
  const b = o[0] * d[0] + o[1] * d[1] + o[2] * d[2];
  const c = o[0] * o[0] + o[1] * o[1] + o[2] * o[2] - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t > 0 ? t : null;
}
