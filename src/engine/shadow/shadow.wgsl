#include "frame"

// Object shadows: cascaded depth maps along the view, rendered from the sun (shadow/shadowMap.ts).
// A receiver multiplies only its direct-sun term by sunShadow, so shadows keep the sky light and their colour
// (frame/light.wgsl modelLight for what stands on the ground); shadowInk tints the shaded part of the farm fields' flat
// ramp towards ink blue. Bound in group 0 beside the frame, so every receiver samples the same maps.

@group(0) @binding(6) var shadowMap: texture_depth_2d_array;
@group(0) @binding(7) var shadowCompare: sampler_comparison;

const SHADOW_INK = vec3f(0.84, 0.89, 1.0);
const HAND_OVER = 0.85; // share of a cascade's half-width where it starts handing over to the next

// A point pushed off its surface along the normal (more where the sun grazes it, `graze`) and towards the sun, by about
// a texel of cascade `i`, so a surface does not shadow itself in stripes: its clip position in that cascade.
fn shadowClip(i: i32, rel: vec3f, n: vec3f, graze: f32) -> vec3f {
  let texel = frame.shadowTexel[i];
  let p = rel + n * (texel * (0.7 + 1.5 * graze)) + frame.sun.xyz * (texel * 0.6);
  return (frame.shadowProj[i] * vec4f(p, 1.0)).xyz;
}

// PCF 3x3 over the hardware's 2x2 comparison filter, weighted as a tent so an edge ramps evenly instead of in steps.
fn shadowPcf(i: i32, c: vec3f) -> f32 {
  let uv = vec2f(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5);
  let du = frame.shadowData.z; // 1 / map size
  var sum = 0.0;
  for (var dy = -1; dy <= 1; dy++) {
    for (var dx = -1; dx <= 1; dx++) {
      let w = f32((2 - abs(dx)) * (2 - abs(dy)));
      sum += w * textureSampleCompareLevel(shadowMap, shadowCompare, uv + vec2f(f32(dx), f32(dy)) * du, i, c.z);
    }
  }
  return sum / 16.0;
}

fn inCascade(c: vec3f, limit: f32) -> bool {
  return max(abs(c.x), abs(c.y)) < limit && c.z > 0.0 && c.z < 1.0;
}

// How lit a camera-relative point with normal `n` (ECEF) is by the sun: 1 in the open, 0 in full shadow. The finest
// cascade whose map holds the point answers; towards its edge it blends into the next one (past the last: into no
// shadow). The shadows fade out towards frame.shadowData.w from the eye and with frame.shadowData.y (the camera's
// height, the sun at the horizon).
fn sunShadow(rel: vec3f, n: vec3f) -> f32 {
  let far = frame.shadowData.w;
  let strength = frame.shadowData.y * (1.0 - smoothstep(0.8 * far, far, length(rel)));
  if (strength <= 0.0) {
    return 1.0;
  }
  let cosSun = clamp(dot(n, frame.sun.xyz), 0.0, 1.0);
  let graze = sqrt(1.0 - cosSun * cosSun);
  let count = i32(frame.shadowData.x);
  let limit = 1.0 - 6.0 * frame.shadowData.z; // the filter's taps stay inside the map
  for (var i = 0; i < count; i++) {
    let c = shadowClip(i, rel, n, graze);
    if (!inCascade(c, limit)) {
      continue;
    }
    var s = shadowPcf(i, c);
    let hand = smoothstep(HAND_OVER * limit, limit, max(abs(c.x), abs(c.y)));
    if (hand > 0.0) {
      var next = 1.0;
      if (i + 1 < count) {
        let c2 = shadowClip(i + 1, rel, n, graze);
        if (inCascade(c2, limit)) {
          next = shadowPcf(i + 1, c2);
        }
      }
      s = mix(s, next, hand);
    }
    return mix(1.0, s, strength);
  }
  return 1.0;
}

// The ink-blue cast of a shadow on a surface lit by a flat 0.55..1 ramp: `s` from sunShadow, `d` the unshadowed sun
// term (only what the sun would light turns blue in shadow; faces turned away stay as they were).
fn shadowInk(s: f32, d: f32) -> vec3f {
  return mix(vec3f(1.0), SHADOW_INK, (1.0 - s) * d);
}
