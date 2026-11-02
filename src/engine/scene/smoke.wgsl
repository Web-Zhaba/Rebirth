#include "frame"

// Chimney smoke (scene/smoke.ts): a WGSL port of the old smoke layer. One instance per chimney
// near the eye, PUFFS camera-facing puffs each, every puff's life a pure function of the time, its index and the
// chimney's hash: it rises, swells, bends downwind and fades. Chimneys are metres in the town origin's east/north/up
// frame; `smoke.rel` is the origin minus the eye.

struct Smoke {
  rel: vec4f,   // xyz origin - eye (m)
  e: vec4f,
  n: vec4f,
  u: vec4f,
  str: vec4f,   // xyz how hard homes, furnaces and taverns smoke now (0..1), w time (s)
  wind: vec4f,  // xy wind direction (east/north), z wind speed (m/s), w distance where the smoke is gone (m)
  look: vec4f,  // x sun strength 0..1, y how lit the place is (day 1 .. night 0)
};

@group(1) @binding(0) var<uniform> smoke: Smoke;

const PUFFS = ${PUFFS}u;
const LIFE = ${LIFE}.0;
const RISE = ${RISE}.0;
const NIGHT = vec3f(0.13, 0.16, 0.24); // townMesh.wgsl: the old map's dusk blue

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) q: vec2f,
  @location(1) a: f32,
  @location(2) age: f32,
  @location(3) seed: f32,
};

fn hash11(x: f32) -> f32 {
  return fract(sin(x * 12.9898) * 43758.5453);
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @location(0) at: vec4f, @location(1) par: vec2f) -> VsOut {
  let corners = array(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let q = corners[vi % 6u];
  let k = f32(vi / 6u);
  let kind = u32(at.w + 0.5);
  let str = select(select(smoke.str.z, smoke.str.y, kind == 1u), smoke.str.x, kind == 0u);
  let alive = clamp(str * f32(PUFFS) - k, 0.0, 1.0);
  let base = smoke.rel.xyz + smoke.e.xyz * at.x + smoke.n.xyz * at.y + smoke.u.xyz * at.z;
  let far = smoke.wind.w;
  let vis = alive * (1.0 - smoothstep(far * 0.75, far, length(base)));
  let cyc = smoke.str.w / LIFE + fract(k * 0.6180339 + par.x);
  let t = fract(cyc);
  let seed = hash11(floor(cyc) * 7.13 + k * 3.7 + par.x * 91.0);
  let age = t * LIFE;
  let rise = RISE * (1.0 - pow(1.0 - t, 1.6));
  let speed = 0.5 + smoke.wind.z;
  let dir = smoke.wind.xy;
  let across = vec2f(-dir.y, dir.x);
  let bend = pow(t, 1.35) * LIFE * 0.4 * speed;
  let sway = sin(age * 1.6 + seed * 6.2831) * (0.15 + 1.1 * t) * (0.5 + 0.5 * seed);
  let off = vec3f(dir * bend + across * sway, 0.2 + rise);
  let rad = select(0.0, par.y * (0.5 + 2.6 * pow(t, 0.7)) * mix(0.6, 1.0, str), vis > 0.002);
  let c = base + smoke.e.xyz * off.x + smoke.n.xyz * off.y + smoke.u.xyz * off.z;
  let U = smoke.u.xyz;
  let F = normalize(-c);
  var R = cross(U, F);
  R = select(smoke.e.xyz, normalize(R), length(R) > 1e-4);
  let V = cross(F, R);
  var o: VsOut;
  o.pos = select(vec4f(2.0, 2.0, 2.0, 1.0), frame.viewProj * vec4f(c + (R * q.x + V * q.y) * rad, 1.0), rad > 0.0);
  o.q = q;
  o.age = t;
  o.seed = seed;
  o.a = vis * smoothstep(0.0, 0.08, t) * pow(1.0 - t, 1.3) * mix(0.45, 0.8, str);
  return o;
}

fn h2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

fn vnoise2(p: vec2f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2f(1.0, 0.0)), f.x), mix(h2(i + vec2f(0.0, 1.0)), h2(i + vec2f(1.0, 1.0)), f.x), f.y);
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4f {
  let r = length(v.q);
  if (r > 1.0 || v.a < 0.002) {
    discard;
  }
  let np = v.q * 1.8 + vec2f(v.seed * 31.0, v.seed * 17.0 + v.age * 1.5);
  let n = 0.6 * vnoise2(np) + 0.4 * vnoise2(np * 2.3 + 5.0);
  let a = (1.0 - smoothstep(0.25, 0.95, r + (n - 0.5) * 0.55)) * v.a;
  if (a < 0.003) {
    discard;
  }
  var col = mix(vec3f(0.58, 0.59, 0.61), vec3f(0.93, 0.93, 0.92), smoothstep(0.0, 0.7, v.age));
  col *= (0.78 + 0.22 * smoke.look.x) * (0.9 + 0.1 * v.q.y) * (0.9 + 0.2 * n);
  col *= mix(NIGHT, vec3f(1.0), smoke.look.y);
  return vec4f(col * a, a);
}
