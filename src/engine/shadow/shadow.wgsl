#include "frame"

// Object shadows: one local depth map around the camera target, rendered from the sun
// (shadow/shadowMap.ts). A receiver multiplies only its direct-sun term by sunShadow, so shadows keep the sky light and
// their colour (frame/light.wgsl modelLight for what stands on the ground); shadowInk tints the shaded part of the
// farm fields' flat ramp towards ink blue. Bound in group 0 beside the frame, so every receiver samples the same map.

@group(0) @binding(6) var shadowMap: texture_depth_2d;
@group(0) @binding(7) var shadowCompare: sampler_comparison;

const SHADOW_INK = vec3f(0.84, 0.89, 1.0);

// How lit a camera-relative point with normal `n` (ECEF) is by the sun: 1 in the open, 0 in full shadow. The point is
// pushed off its surface along the normal (more where the sun grazes it) and towards the sun, by a texel or so, so a
// surface does not shadow itself in stripes. PCF 3x3 over the hardware's 2x2 comparison filter, weighted as a tent so
// an edge ramps evenly instead of in three steps; the shadows fade out towards the map's edge and with
// frame.shadowData.y (the camera's height, the sun at the horizon).
fn sunShadow(rel: vec3f, n: vec3f) -> f32 {
  let fade = frame.shadowData.y;
  if (fade <= 0.0) {
    return 1.0;
  }
  let texel = frame.shadowData.x;
  let cosSun = clamp(dot(n, frame.sun.xyz), 0.0, 1.0);
  let p = rel + n * (texel * (0.7 + 1.5 * sqrt(1.0 - cosSun * cosSun))) + frame.sun.xyz * (texel * 0.6);
  let c = frame.shadowProj * vec4f(p, 1.0);
  let edge = max(abs(c.x), abs(c.y));
  if (edge >= 1.0 || c.z <= 0.0 || c.z >= 1.0) {
    return 1.0;
  }
  let uv = vec2f(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
  let du = frame.shadowData.z; // 1 / map size
  var sum = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let w = f32((2 - abs(dx)) * (2 - abs(dy)));
      sum += w * textureSampleCompareLevel(shadowMap, shadowCompare, uv + vec2f(f32(dx), f32(dy)) * du, c.z);
    }
  }
  return mix(1.0, sum / 16.0, fade * (1.0 - smoothstep(0.8, 1.0, edge)));
}

// The ink-blue cast of a shadow on a surface lit by a flat 0.55..1 ramp: `s` from sunShadow, `d` the unshadowed sun
// term (only what the sun would light turns blue in shadow; faces turned away stay as they were).
fn shadowInk(s: f32, d: f32) -> vec3f {
  return mix(vec3f(1.0), SHADOW_INK, (1.0 - s) * d);
}
