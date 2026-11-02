import { ecefToGeodetic, madd, WGS84_A, type Geodetic, type Vec3 } from "../geo/ellipsoid";
import { raySphere } from "./camera";

// Ground under a ray: march by the height above the drawn terrain, then bisect the crossing. A step is the height above
// ground over how fast the ray descends plus the steepest rise we allow the ground (MAX_SLOPE), so it cannot jump a
// slope that steep; grazing rays at street level stay exact while rays from orbit cost a few dozen samples.

const TOP = WGS84_A + 15_000; // above the highest exaggerated peak: rays start here when the eye is higher
const MIN_STEP = 0.25; // m
const MAX_STEPS = 4000;
const MAX_SLOPE = 1; // rise per metre the march guards against (exaggerated hillsides rarely pass 45 deg)

export function pickGround(eye: Readonly<Vec3>, dir: Readonly<Vec3>, groundAt: (lat: number, lng: number) => number | null, maxDist = 2e7): Geodetic | null {
  let t = 0;
  const r2 = eye[0] * eye[0] + eye[1] * eye[1] + eye[2] * eye[2];
  if (r2 > TOP * TOP) {
    const enter = raySphere(eye as Vec3, dir as Vec3, TOP);
    if (enter === null) return null;
    t = enter;
  }
  const above = (s: number): { g: Geodetic; d: number } => {
    const g = ecefToGeodetic(madd(eye, dir, s));
    return { g, d: g.h - (groundAt(g.lat, g.lng) ?? 0) };
  };
  let prev = t;
  let cur = above(t);
  if (cur.d <= 0) return cur.g; // eye at or under the ground
  for (let i = 0; i < MAX_STEPS && t < maxDist; i++) {
    prev = t;
    const p = madd(eye, dir, t);
    const sink = -(dir[0] * p[0] + dir[1] * p[1] + dir[2] * p[2]) / Math.hypot(p[0], p[1], p[2]);
    t += Math.max(MIN_STEP, cur.d / (Math.max(0, sink) + MAX_SLOPE));
    const next = above(t);
    if (next.d <= 0) {
      // Bisect between the last point above and the first below.
      let lo = prev;
      let hi = t;
      let hit = next.g;
      for (let j = 0; j < 30 && hi - lo > 0.01; j++) {
        const mid = (lo + hi) / 2;
        const m = above(mid);
        if (m.d > 0) lo = mid;
        else {
          hi = mid;
          hit = m.g;
        }
      }
      return hit;
    }
    if (next.d > cur.d && next.g.h > TOP - WGS84_A) return null; // climbing out into space: the ray missed the planet
    cur = next;
  }
  return null;
}
