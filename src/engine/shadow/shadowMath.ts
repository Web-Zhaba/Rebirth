import { cross, dot, normalize, type Vec3 } from "../geo/ellipsoid";
import type { Mat4 } from "../camera/projection";

// The sun's orthographic shadow camera (docs/PLAN-shadows.md section 3): one local map around the camera target,
// texel-snapped in absolute ECEF so it does not shimmer while the camera moves. The map's content depends only on the
// snapped frame below; the matrix the GPU uses is rebuilt from it every frame against the eye, so positions stay
// camera-relative (f64 here, f32 on the GPU) like everything else in the engine.

export const SHADOW_FADE = { near: 900, far: 2600 }; // m above the ground on a 2048 map: full shadows below, none above
const FULL_SIZE = 2048; // a smaller map carries its texels half as far
export const SUN_STEP = 0.002; // rad the sun may wander before the map is re-rendered (a 10 m wall's shadow: < 10 cm)

export interface ShadowFrame {
  right: Vec3; // light axes (ECEF): right, up, and fwd from the sun towards the ground
  up: Vec3;
  fwd: Vec3;
  origin: Vec3; // the snapped centre (absolute ECEF, m)
  radius: number; // half-extent of the map (m)
  depth: number; // metres of depth the map covers, centred on the origin
  texel: number; // metres per texel
}

// The map's half-extent by the eye's distance to the target (a tilted view sees ground well beyond its height): steps,
// not a smooth curve, so texels keep their size (and the snapping its grid) while the camera zooms. The widest step
// is only for a full-size map: on a smaller one its texels would be wider than a house's shadow.
export function shadowRadius(distance: number, size = FULL_SIZE): number {
  return distance < 180 ? 200 : distance < 450 ? 400 : distance < 1000 || size < FULL_SIZE ? 800 : 1600;
}

// Shadows dissolve as the camera rises, handing over to the cloud shading, and as the sun reaches the horizon (where
// they would stretch across the whole map). `sunUp` is the sine of the sun's elevation at the target.
export function shadowFade(eyeAboveGround: number, sunUp: number, size = FULL_SIZE): number {
  const k = Math.min(1, size / FULL_SIZE);
  const height = 1 - smoothstep(SHADOW_FADE.near * k, SHADOW_FADE.far * k, eyeAboveGround);
  return height * smoothstep(0.02, 0.08, sunUp);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// The sun direction the map is rendered with: the previous one until the real sun has moved more than SUN_STEP, so a
// running game clock re-renders the map every few frames rather than every frame.
export function steppedSun(prev: Vec3 | null, sun: Vec3): Vec3 {
  return prev && dot(prev, sun) > Math.cos(SUN_STEP) ? prev : sun;
}

// The light frame for `sun` (unit ECEF towards the sun) around `target`, snapped to whole texels of a `size` map.
export function shadowFrame(sun: Vec3, target: Vec3, radius: number, size: number): ShadowFrame {
  const fwd: Vec3 = [-sun[0], -sun[1], -sun[2]];
  const ref: Vec3 = Math.abs(fwd[2]) < 0.99 ? [0, 0, 1] : [1, 0, 0];
  const right = normalize(cross(ref, fwd));
  const up = cross(fwd, right);
  const texel = (2 * radius) / size;
  const su = Math.round(dot(target, right) / texel) * texel;
  const sv = Math.round(dot(target, up) / texel) * texel;
  const sf = Math.round(dot(target, fwd) / (16 * texel)) * 16 * texel; // depth: coarser steps, it only shifts the range
  const origin: Vec3 = [0, 1, 2].map((i) => right[i] * su + up[i] * sv + fwd[i] * sf) as Vec3;
  return { right, up, fwd, origin, radius, depth: 4 * radius, texel };
}

// Camera-relative ECEF (m) -> shadow clip: x, y in -1..1 across the map, z 0 nearest the sun .. 1 farthest. Plain
// (not reversed) depth: the projection is linear, so reversing it would buy no precision.
export function shadowMatrix(f: ShadowFrame, eye: Vec3, out: Mat4 = new Float64Array(16)): Mat4 {
  const sx = 1 / f.radius;
  const sz = 1 / f.depth;
  const rows = [f.right, f.up, f.fwd];
  const scales = [sx, sx, sz];
  const offsets = [0, 0, 0.5];
  // Column-major (WGSL mat4x4f): out[col * 4 + row].
  out.fill(0);
  for (let r = 0; r < 3; r++) {
    const a = rows[r];
    const s = scales[r];
    out[r] = a[0] * s;
    out[4 + r] = a[1] * s;
    out[8 + r] = a[2] * s;
    // (eye - origin) . axis: the eye's place in the light frame, so a camera-relative point maps correctly.
    out[12 + r] = ((eye[0] - f.origin[0]) * a[0] + (eye[1] - f.origin[1]) * a[1] + (eye[2] - f.origin[2]) * a[2]) * s + offsets[r];
  }
  out[15] = 1;
  return out;
}

// Whether a bounding sphere (absolute ECEF) reaches into the map's box: casters outside it are not drawn.
export function shadowCovers(f: ShadowFrame, center: Vec3, radius: number): boolean {
  const d: Vec3 = [center[0] - f.origin[0], center[1] - f.origin[1], center[2] - f.origin[2]];
  return Math.abs(dot(d, f.right)) <= f.radius + radius && Math.abs(dot(d, f.up)) <= f.radius + radius && Math.abs(dot(d, f.fwd)) <= f.depth / 2 + radius;
}

// The map's version (docs/PLAN-shadows.md section 4.2): it is re-rendered only when what it was baked from changed —
// the stepped sun, the snapped frame, the casters' versions or the view the casters were culled for. A still camera
// costs nothing.
export class ShadowCache {
  private last: number[] = [];
  version = 0;

  // True (and bumps the version) when `inputs` differ from those of the last render.
  stale(inputs: readonly number[]): boolean {
    const l = this.last;
    if (l.length === inputs.length && inputs.every((v, i) => v === l[i])) return false;
    this.last = [...inputs];
    this.version++;
    return true;
  }

  // Forget the last render (the map's texture was replaced): the next frame re-renders.
  reset(): void {
    this.last = [];
  }
}
