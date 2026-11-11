#include "frame"

// The light on what stands on the ground (docs/PLAN-graphics.md G2): buildings, roads, residents, trees. Their colours
// are display colours shaded flat, so the light is a display-space multiplier: a cool fill from the open sky on what
// faces up, a warm one from the ground on what faces down, and the sun on top, warming as it nears the horizon. In the
// sun's shadow only the fills are left, which is what turns a shadow ink blue.

const SKY_FILL = vec3f(0.50, 0.55, 0.66);
const GROUND_FILL = vec3f(0.52, 0.48, 0.42);
const SUN_HIGH = vec3f(1.0, 0.93, 0.80);  // with the sky's fill a sunlit roof comes out white
const SUN_LOW = vec3f(1.0, 0.72, 0.46);
const SUN_GAIN = 0.55;
const MOON = vec3f(0.92);

// How far the sun's light has warmed over a place whose up is `up` (unit ECEF): 0 at the horizon .. 1 high.
fn sunHeight(up: vec3f) -> f32 {
  return smoothstep(0.02, 0.42, dot(up, frame.sun.xyz));
}

// The sun's colour there, for display-space shading.
fn sunTint(up: vec3f) -> vec3f {
  return mix(SUN_LOW, SUN_HIGH, sunHeight(up));
}

// The same warmth for what is lit in linear space (the ground): white when the sun is high.
fn sunTintLinear(up: vec3f) -> vec3f {
  return mix(vec3f(1.0, 0.60, 0.34), vec3f(1.0), sunHeight(up));
}

// The multiplier of a display colour: `nz` the normal's share of up, `d` the sun's cosine on the surface (0 when it
// faces away), `s` how lit by the sun the point is (shadow.wgsl sunShadow), `strength` the sun's 0..1 (below the
// horizon the direction is a fixed moonlight and so is its colour), `up` the place's up.
fn modelLight(nz: f32, d: f32, s: f32, strength: f32, up: vec3f) -> vec3f {
  let fill = mix(GROUND_FILL, SKY_FILL, 0.5 + 0.5 * nz);
  let sun = mix(MOON, sunTint(up), strength);
  return (fill + sun * (SUN_GAIN * d * s)) * mix(0.88, 1.0, strength);
}
