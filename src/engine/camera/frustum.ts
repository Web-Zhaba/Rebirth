import type { Vec3 } from "../geo/ellipsoid";
import type { CameraView } from "./camera";

export type Plane = [number, number, number, number];

// The view's side planes through the eye and its near plane, eye-relative, normals inward.
export function frustumPlanes(v: CameraView): Plane[] {
  const tx = v.tanHalfY * v.aspect;
  const ty = v.tanHalfY;
  const plane = (a: Vec3, s: number, b: Vec3): Plane => {
    const p: Vec3 = [a[0] * s + b[0], a[1] * s + b[1], a[2] * s + b[2]];
    const l = Math.hypot(p[0], p[1], p[2]);
    return [p[0] / l, p[1] / l, p[2] / l, 0];
  };
  const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
  return [plane(v.forward, tx, v.right), plane(v.forward, tx, neg(v.right)), plane(v.forward, ty, v.up), plane(v.forward, ty, neg(v.up)), [...v.forward, -v.near]];
}

// Whether a sphere (eye-relative centre) reaches into the planes.
export function sphereInView(planes: readonly Plane[], c: Readonly<Vec3>, r: number): boolean {
  for (const p of planes) if (p[0] * c[0] + p[1] * c[1] + p[2] * c[2] + p[3] < -r) return false;
  return true;
}
