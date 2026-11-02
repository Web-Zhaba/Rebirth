import type { Vec3 } from "../../engine/geo/ellipsoid";
import { sunStrength } from "../../map/clouds/shadowMath";

// The light the town's things are shaded with (the old three.js layers' look): the sun in the town frame, blended
// towards a fixed light as it sets, how strong it is, and how lit the place is (the terrain's terminator,
// atmosphere.wgsl sunLightAt).

const FALLBACK_LIGHT: Vec3 = [-0.45, -0.55, 0.7];

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export function townLight(sun: Readonly<Vec3>): { light: Vec3; strength: number; daylight: number } {
  const strength = sunStrength(sun[2]);
  const fb = norm(FALLBACK_LIGHT);
  const d = norm([sun[0], sun[1], Math.max(sun[2], 0.05)]);
  return {
    light: norm([fb[0] + (d[0] - fb[0]) * strength, fb[1] + (d[1] - fb[1]) * strength, fb[2] + (d[2] - fb[2]) * strength]),
    strength,
    daylight: Math.min(1, Math.max(0, (sun[2] + 0.12) / 0.32)),
  };
}
