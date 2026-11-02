// A cheap stand-in for the atmosphere LUTs of a later milestone: an exponential Rayleigh-like layer with a little grey
// haze. Extinction and in-scatter both come from the optical depth of the view segment, so the same function gives
// the blue sky from the ground, aerial perspective on far ridges and the bright rim around the planet from orbit.

const ATMO_SCALE_H = 8000.0;                               // m
const BETA = vec3f(5.8e-6, 13.5e-6, 33.1e-6);              // per m at sea level
const HAZE = 1.0e-6;                                       // grey, per m at sea level
const SKY_LIGHT = 1.4;
const SPACE = vec3f(0.002, 0.003, 0.008);

fn airDensity(h: f32) -> f32 {
  return exp(-max(h, 0.0) / ATMO_SCALE_H);
}

// Density-weighted length of a straight segment of length d between altitudes h0 and h1, for a flat layered
// atmosphere; capped near the horizontal, where the earth's curvature bounds the real path (~600 km at sea level).
fn opticalDepth(d: f32, h0: f32, h1: f32) -> f32 {
  let r0 = airDensity(h0);
  let r1 = airDensity(h1);
  let dh = abs(h0 - h1);
  var od = d * r0;
  if (dh > 1.0) {
    od = d * ATMO_SCALE_H * abs(r0 - r1) / dh;
  }
  return min(od, 600000.0 * max(r0, r1));
}

// Light reaching the scattering air: fades out across the terminator.
fn sunLightAt(up: vec3f) -> f32 {
  return smoothstep(-0.12, 0.2, dot(up, frame.sun.xyz));
}

fn applyAir(c: vec3f, od: f32, light: f32) -> vec3f {
  let t = exp(-(BETA + vec3f(HAZE)) * od);
  return c * t + SKY_LIGHT * light * (vec3f(1.0) - t);
}

fn toneMap(c: vec3f) -> vec3f {
  let m = vec3f(1.0) - exp(-c * 1.2);
  return pow(m, vec3f(1.0 / 2.2));
}
