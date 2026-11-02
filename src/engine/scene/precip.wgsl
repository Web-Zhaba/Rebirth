#include "frame"

// Rain and snow (scene/precip.ts): particles in a box of air around the eye, positions from the instance index and
// the time alone, so nothing lives on the CPU. The box is scaled with the camera distance and carried with the eye
// (like the old 2D overlay over the screen), and the particles are depth-tested against the scene. Rain is a thin
// streak along its fall, snow a soft flake drifting in the wind.

struct Precip {
  e: vec4f,     // east, north and up at the camera target
  n: vec4f,
  u: vec4f,
  box: vec4f,   // x box edge (m), y time (s), z 1 = snow, w opacity 0..1
  wind: vec4f,  // xy horizontal drift per metre of fall (east, north)
  col: vec4f,   // rgb colour (display space)
};

@group(1) @binding(0) var<uniform> precip: Precip;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) q: vec2f, // across the quad -1..1
  @location(1) a: f32,
};

fn hash3(i: u32) -> vec3f {
  var h = vec3u(i * 1664525u + 1013904223u, i * 22695477u + 1u, i * 1103515245u + 12345u);
  h = (h ^ (h >> vec3u(16u))) * 0x45d9f3bu;
  h = h ^ (h >> vec3u(16u));
  return vec3f(h & vec3u(0xffffu)) / 65535.0;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  let corners = array(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 0.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = corners[vi];
  let B = precip.box.x;
  let t = precip.box.y;
  let snow = precip.box.z > 0.5;
  let s = hash3(ii);
  let s2 = hash3(ii + 7919u);
  // fall speed in box edges per second: about the old overlay's 0.3..0.6 screen heights a second for rain
  let speed = select(0.3 + 0.3 * s2.x, (0.3 + 0.3 * s2.x) * 0.22, snow);
  let fall = fract(s.z + t * speed);           // 0 at the top of the box .. 1 at the bottom
  let drop = fall * B;                         // metres fallen since the top
  var x = s.x * B + precip.wind.x * drop;
  var y = s.y * B + precip.wind.y * drop;
  if (snow) {
    let ph = s2.y * 6.2831;
    x += sin(t * (0.8 + 0.6 * s2.z) + ph) * 0.012 * B;
    y += cos(t * (0.7 + 0.5 * s2.y) + ph) * 0.012 * B;
  }
  // wrap into the box, centred a little ahead of the eye so fewer particles are spent behind it
  let centre = frame.camF.xyz * (0.3 * B);
  let lx = (fract(x / B) - 0.5) * B;
  let ly = (fract(y / B) - 0.5) * B;
  let lz = (0.5 - fall) * B;
  let p = centre + precip.e.xyz * lx + precip.n.xyz * ly + precip.u.xyz * lz;

  var w: vec3f;
  if (snow) {
    let size = B * (0.001 + 0.0008 * s2.z); // a few pixels at the box's middle distance, like the old 0.8..2.2 px
    let r = normalize(frame.camR.xyz);
    let up = normalize(frame.camU.xyz);
    w = p + (r * c.x + up * (c.y * 2.0 - 1.0)) * size;
  } else {
    let dir = normalize(precip.wind.x * precip.e.xyz + precip.wind.y * precip.n.xyz - precip.u.xyz);
    let len = B * (0.004 + 0.005 * s2.z); // the old 6..16 px streaks
    let side = normalize(cross(dir, p)) * (B * 0.00035);
    w = p - dir * (len * c.y) + side * c.x;
  }
  // nothing right at the eye (huge streaks) and a soft edge of the box
  let d = length(p);
  let edge = max(max(abs(lx), abs(ly)), abs(lz)) / (0.5 * B);
  var o: VsOut;
  o.pos = frame.viewProj * vec4f(w, 1.0);
  o.q = vec2f(c.x, c.y * 2.0 - 1.0);
  o.a = precip.box.w * smoothstep(0.06 * B, 0.15 * B, d) * (1.0 - smoothstep(0.75, 1.0, edge)) * (0.6 + 0.4 * s2.x);
  return o;
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4f {
  var a = v.a;
  if (precip.box.z > 0.5) {
    a *= 1.0 - smoothstep(0.4, 1.0, length(v.q));
  } else {
    a *= 1.0 - abs(v.q.x);
  }
  if (a < 0.003) {
    discard;
  }
  return vec4f(precip.col.rgb * a * precip.col.a, a * precip.col.a);
}
