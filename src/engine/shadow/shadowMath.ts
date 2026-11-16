import { cross, dot, normalize, type Vec3 } from "../geo/ellipsoid";
import type { Mat4 } from "../camera/projection";

// The sun's shadow as cascades: orthographic maps around slices of the view's depth, the
// nearest finest (shadow/shadowMap.ts). Each cascade is a sphere around its slice, so turning the camera does not
// change its size; the radius moves in coarse steps and the centre snaps to whole texels in absolute ECEF, so panning
// and zooming do not make the edges shimmer either. A map's content depends only on its snapped frame; the matrix the
// GPU uses is rebuilt from it every frame against the eye, so positions stay camera-relative (f64 here, f32 on the
// GPU) like everything else in the engine.

export const MAX_CASCADES = 4;
export const SHADOW_FADE = { near: 900, far: 2600 }; // m above the ground on a 2048 map: full shadows below, none above
const FULL_SIZE = 2048; // a smaller map carries its texels half as far
const CASTER_REACH = 600; // m the map's depth reaches towards the sun beyond its sphere: a tree or a roof there casts in
const LAMBDA = 0.9; // the splits' mix of logarithmic (1, even texels on screen) and even depth (0)
const MIN_START = 20; // m: where the first cascade starts at the nearest
const TALLEST = 60; // m: what stands on the ground can come this much nearer the eye than the ground itself
const RADIUS_STEPS = 8; // radius steps per doubling
const SHIFT_TEXELS = 0.25; // texels a 20 m caster's shadow may slide with the sun before its cascade is re-rendered
const CASTER_HEIGHT = 20;
const LOW_SUN = Math.sin((3 * Math.PI) / 180) ** 2;

export interface ShadowFrame {
  right: Vec3; // light axes (ECEF): right, up, and fwd from the sun towards the ground
  up: Vec3;
  fwd: Vec3;
  origin: Vec3; // the snapped centre of the box (absolute ECEF, m)
  radius: number; // half-extent of the map (m)
  depth: number; // metres of depth the map covers, centred on the origin
  texel: number; // metres per texel
}

export interface Slice {
  depth: number; // the sphere's centre, along the view axis (m)
  radius: number;
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

// Where the first cascade starts (view depth, m): the nearest ground the bottom of the view can see, less what stands
// on it, so no map is spent on the air between the eye and the ground. `down` is how steeply the bottom edge of the
// view looks down: the drop per metre of depth along it.
export function shadowStart(eyeAboveGround: number, down: number, near: number, far: number): number {
  const ground = down > 1e-3 ? (0.7 * Math.max(0, eyeAboveGround - TALLEST)) / down : 0;
  return Math.min(far * 0.4, Math.max(MIN_START, near, ground));
}

// The view depths the cascades split at, from `start` to `far`: count + 1 of them.
export function cascadeSplits(start: number, far: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    out.push(LAMBDA * start * (far / start) ** t + (1 - LAMBDA) * (start + (far - start) * t));
  }
  return out;
}

// The smallest sphere around the slice of the view between depths a and b (tanX, tanY: the half fields of view).
export function sliceSphere(a: number, b: number, tanX: number, tanY: number): Slice {
  const k2 = tanX * tanX + tanY * tanY;
  const depth = Math.min(b, ((a + b) * (1 + k2)) / 2);
  return { depth, radius: Math.sqrt((b - depth) ** 2 + b * b * k2) };
}

// The radius a cascade keeps: whole steps of RADIUS_STEPS per doubling, and the one it had while that still covers the
// slice and is not more than a step too big. A camera that moves a little keeps its texels as they are.
export function steadyRadius(want: number, prev: number): number {
  if (prev >= want && prev <= want * 2 ** (1.5 / RADIUS_STEPS)) return prev;
  return 2 ** (Math.ceil(Math.log2(want) * RADIUS_STEPS) / RADIUS_STEPS);
}

// How far (rad) the sun may move before a cascade with `texel` (m) must be re-rendered: a CASTER_HEIGHT caster's shadow
// moves by about h / sin^2(elevation) per radian, so the tolerance shrinks as the sun gets low. `sunUp` is the sine of
// the sun's elevation.
export function sunTolerance(texel: number, sunUp: number): number {
  return (SHIFT_TEXELS * texel * Math.max(sunUp * sunUp, LOW_SUN)) / CASTER_HEIGHT;
}

// The light frame for `sun` (unit ECEF towards the sun) around `centre`, snapped to whole texels of a `size` map. Its
// depth covers the sphere and CASTER_REACH more towards the sun.
export function shadowFrame(sun: Vec3, centre: Vec3, radius: number, size: number): ShadowFrame {
  const fwd: Vec3 = [-sun[0], -sun[1], -sun[2]];
  const ref: Vec3 = Math.abs(fwd[2]) < 0.99 ? [0, 0, 1] : [1, 0, 0];
  const right = normalize(cross(ref, fwd));
  const up = cross(fwd, right);
  const texel = (2 * radius) / size;
  const su = Math.round(dot(centre, right) / texel) * texel;
  const sv = Math.round(dot(centre, up) / texel) * texel;
  const sf = Math.round(dot(centre, fwd) / (16 * texel)) * 16 * texel - CASTER_REACH / 2; // depth: coarser steps, it only shifts the range
  const origin: Vec3 = [0, 1, 2].map((i) => right[i] * su + up[i] * sv + fwd[i] * sf) as Vec3;
  return { right, up, fwd, origin, radius, depth: 2 * radius + CASTER_REACH, texel };
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

// What a cascade was last rendered from: the frame, the sun, the casters' versions and the view the casters were
// culled for. A still camera and a still (or slow enough) sun cost nothing.
export class ShadowCache {
  private last: number[] = [];
  version = 0;

  matches(inputs: readonly number[]): boolean {
    const l = this.last;
    return l.length === inputs.length && inputs.every((v, i) => v === l[i]);
  }

  store(inputs: readonly number[]): void {
    this.last = [...inputs];
    this.version++;
  }

  // Forget the last render (the map's texture was replaced): the next frame re-renders.
  reset(): void {
    this.last = [];
  }
}
