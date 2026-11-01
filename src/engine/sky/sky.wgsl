#include "frame"
#include "atmosphere"
#include "weather"

// Sky behind the terrain: a fullscreen triangle at depth 0 (reversed-Z infinity), drawn after the terrain with
// `greater-equal` so it only fills untouched pixels. Rays that still hit the ellipsoid there (polar caps above the
// mercator limit, nodes not loaded yet) get a plain lit sea so holes read as ocean, not as sky. Under a thick cloud
// deck the sky near the ground turns grey and the sun goes; on a clear night the stars come out.

const WGS_A = 6378137.0;
const WGS_B = 6356752.314245;
const ATMO_TOP = 100000.0;
const STAR_CELLS = 420.0; // star grid cells per unit of direction: about 0.14 degrees, a star a pixel or two wide

// A sparse field of stars fixed to the earth's axes (the sky turns with the clock's sun, not the stars; close enough).
fn stars(d: vec3f) -> f32 {
  let p = d * STAR_CELLS;
  let cell = floor(p);
  let h = fract(sin(dot(cell, vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
  if (h < 0.985) {
    return 0.0;
  }
  let jit = fract(vec3f(h * 17.31, h * 31.7, h * 53.9));
  let r = length(p - cell - 0.2 - 0.6 * jit);
  let bright = pow((h - 0.985) / 0.015, 3.0);
  return (1.0 - smoothstep(0.08, 0.3, r)) * (0.15 + 2.5 * bright);
}

// How grey the sky is from the eye: the cloud cover over it while it is below the deck.
fn overcast() -> f32 {
  if (weather.off1.w <= 0.0) {
    return 0.0;
  }
  let cover = weatherAt(normalize(frame.eye.xyz)).r;
  return smoothstep(0.45, 0.95, cover) * (1.0 - smoothstep(2500.0, 12000.0, frame.eye.w));
}

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  var o: VsOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.ndc = p;
  return o;
}

// Entry/exit distances of a ray with a sphere around the earth's centre (x > y when missed).
fn sphereSpan(o: vec3f, d: vec3f, r: f32) -> vec2f {
  let b = dot(o, d);
  let c = dot(o, o) - r * r;
  let disc = b * b - c;
  if (disc < 0.0) {
    return vec2f(1.0, -1.0);
  }
  let s = sqrt(disc);
  return vec2f(-b - s, -b + s);
}

// First hit with the ellipsoid: scale z so it becomes a sphere of radius a (t is unchanged by the scaling).
fn ellipsoidHit(o: vec3f, d: vec3f) -> f32 {
  let k = WGS_A / WGS_B;
  let os = vec3f(o.xy, o.z * k);
  let ds = vec3f(d.xy, d.z * k);
  let a = dot(ds, ds);
  let b = dot(os, ds);
  let c = dot(os, os) - WGS_A * WGS_A;
  let disc = b * b - a * c;
  if (disc < 0.0) {
    return -1.0;
  }
  return (-b - sqrt(disc)) / a;
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4f {
  let d = normalize(frame.camF.xyz + frame.camR.xyz * v.ndc.x + frame.camU.xyz * v.ndc.y);
  let o = frame.eye.xyz;
  let ground = length(o) - frame.eye.w; // earth radius under the eye
  let top = ground + ATMO_TOP;
  let span = sphereSpan(o, d, top);
  let hit = ellipsoidHit(o, d);
  var t0 = max(span.x, 0.0);
  var t1 = span.y;
  if (hit > 0.0) {
    t1 = min(t1, hit);
  }

  var c = SPACE;
  var od = 0.0;
  var light = 0.0;
  if (t1 > t0) {
    // March the in-atmosphere part of the ray: 12 steps are plenty for an exponential layer.
    let steps = 12;
    let dt = (t1 - t0) / f32(steps);
    for (var s = 0; s < steps; s++) {
      let p = o + d * (t0 + (f32(s) + 0.5) * dt);
      od += airDensity(length(p) - ground) * dt;
    }
    light = sunLightAt(normalize(o + d * (0.5 * (t0 + t1))));
  }
  if (hit > 0.0) {
    let p = o + d * hit;
    let n = normalize(vec3f(p.xy, p.z * (WGS_A / WGS_B) * (WGS_A / WGS_B)));
    let sea = vec3f(0.015, 0.05, 0.11) * (frame.sun.w * max(dot(n, frame.sun.xyz), 0.0) + 0.2) * sunLightAt(n);
    c = sea;
  } else {
    let sunDisc = smoothstep(0.9995, 0.9999, dot(d, frame.sun.xyz));
    c += (vec3f(20.0) * sunDisc + vec3f(stars(d))) * exp(-(BETA + vec3f(HAZE)) * od);
  }
  c = applyAir(c, od, light);
  let grey = overcast();
  if (grey > 0.0 && hit <= 0.0) {
    // a flat, slightly cool grey of the sky's own brightness: the sun and the stars are behind the deck
    let lum = dot(applyAir(SPACE, od, light), vec3f(0.3, 0.59, 0.11));
    c = mix(c, vec3f(lum) * vec3f(0.9, 0.94, 1.0) * 0.85, 0.85 * grey);
  }
  return vec4f(toneMap(c), 1.0);
}
