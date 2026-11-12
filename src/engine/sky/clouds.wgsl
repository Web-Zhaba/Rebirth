#include "frame"
#include "weather"

// Volumetric clouds of the globe views: a WGSL port of the old cloud layer (map/clouds/cloudShaders.ts MARCH_FRAG and
// COMPOSITE_FRAG). The march runs into a low-resolution target only when the picture changed
// (sky/clouds.ts); the composite lays it over the frame, premultiplied, times the zoom fade.
//
// Frame: the cube's unit sphere (X to 90°E, Y north, Z to 0°E 0°N), the ellipsoid scaled to radius 1 (an ECEF point
// p is (p / (a, a, b)).yzx), altitudes exaggerated like the old globe view. Structure of `march`:
//   1. ray from the eye, clipped to the shell [rBase, rTop] and cut by the planet
//   2. cloudDensity(): cube cover remapped by the base noise x height profile (sheet / tower / anvil), eroded by detail
//   3. shaftDensity(): precipitation column below the base, the same noise stretched down to the ground
//   4. opticalDepthToSun(): short march toward the sun, planetShadow(): ray-sphere test with a soft terminator
//   5. shade(): palette grading (lit / ink-blue shade / night dusk / warm terminator / rain pencil / snow ice) + lightning
//   6. coarse steps in empty air, fine steps inside, early exit under 0.02 transmittance, IGN jitter

struct Clouds {
  shell: vec4f,   // x rBase, y rTop, z fade (1 far out .. 0 close: the deck dissolves), w orbit (whole-globe views)
  march: vec4f,   // x steps, y light steps, z detail erosion on, w flashes
  texel: vec4f,   // xy 1 / target size (composite)
  flash: array<vec4f, ${FLASH_MAX}>, // xyz cube-frame direction of a strike, w intensity
};

// The march pipeline binds 0 and 1, the composite 0, 2 and 3 (the target cannot be bound while it is drawn into).
@group(1) @binding(0) var<uniform> clouds: Clouds;
@group(1) @binding(1) var detailNoise: texture_3d<f32>;
@group(1) @binding(2) var marched: texture_2d<f32>;
@group(1) @binding(3) var marchSampler: sampler;

const MAX_STEPS = ${MAX_STEPS};
const MAX_LIGHT = ${MAX_LIGHT};
const PI = 3.14159265;
const WGS_A = 6378137.0;
const WGS_B = 6356752.314245;
const SIGMA_CLOUD = 2400.0;   // extinction per unit length at density 1
const SIGMA_SHAFT = 1500.0;
const BASE_SCALE = 5.0;       // noise tiles per unit length: one base tile is about 1270 km, its cells about 320 km
const DETAIL_SCALE = 40.0;    // detail tile about 160 km
const SHAPE_MEAN = 0.60;      // measured mean / spread of 0.45 R + 0.3 G + 0.25 B of the base volume
const SHAPE_SPREAD = 0.12;
const DETAIL_MEAN = 0.48;     // same for 0.6 R + 0.3 G + 0.1 B of the detail volume
const DETAIL_SPREAD = 0.19;

const LIT = ${LIT};
const SHADE = ${SHADE};
const NIGHT = ${NIGHT};       // night clouds sit close to the map's own value instead of being ink
const WARM = ${WARM};
const RAIN = ${RAIN};
const ICE = ${ICE};

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

fn toCube(p: vec3f) -> vec3f {
  return (p / vec3f(WGS_A, WGS_A, WGS_B)).yzx;
}

// interleaved gradient noise (Jimenez): needs no texture, static for a static camera
fn ign(p: vec2f) -> f32 {
  return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715))));
}

fn cubeWeather(d: vec3f) -> vec4f {
  let a = textureSampleLevel(cubeA, weatherSampler, d, 0.0);
  return mix(a, textureSampleLevel(cubeB, weatherSampler, d, 0.0), weather.off0.w);
}

// ---- wind drift: two noise layers rotated about the polar axis, cross-faded every layer period (bounded shear) ----

fn zonalDeg(absSinLat: f32) -> f32 {
  // weather.ts zonal(): trades inside 24 degrees, westerlies beyond 36; sin(24) = 0.4067, sin(36) = 0.5878
  return weather.wind.y + (weather.wind.x - weather.wind.y) * smoothstep(0.4067, 0.5878, absSinLat);
}

// layer k: age in days (x) and weight (y); the two weights satisfy w0^2 + w1^2 = 1
fn layerPhase(k: f32) -> vec2f {
  let P = weather.wind.z;
  let shifted = weather.wind.w + k * 0.5 * P;
  let tau = shifted - floor(shifted / P) * P;
  return vec2f(tau, sin(PI * tau / P));
}

// Noise lookup for layer k at p: rotated west by the drift so the pattern moves east.
fn noiseCoord(p: vec3f, tau: f32, k: f32) -> vec3f {
  let q = rotPolar(p, radians(zonalDeg(abs(p.y / length(p))) * tau)); // the old spinY(p, -a)
  return q + k * vec3f(0.37, 0.61, 0.23);
}

// ---- density ----

fn heightProfile(h: f32, typ: f32, precip: f32, top: f32) -> f32 {
  let sheet = smoothstep(0.0, 0.12, h) * (1.0 - smoothstep(0.2, 0.42, h)); // sheets: low and thin
  let tower = smoothstep(0.0, 0.1, h) * (1.0 - smoothstep(top - 0.32, top, h)); // towers: tops climb with rain
  return mix(sheet, tower, smoothstep(0.25, 0.7, typ));
}

// w: the mixed cube value; fine = erode with the detail noise; ph0, ph1: the layer phases
fn cloudDensity(p: vec3f, h: f32, w: vec4f, fine: bool, ph0: vec2f, ph1: vec2f) -> f32 {
  let typ = w.g;
  let precip = w.b;
  if (w.r < 0.08) {
    return 0.0;
  }
  let orbit = clouds.shell.w;
  let top = 0.5 + 0.5 * typ * (0.35 + 0.65 * precip);
  let scale = BASE_SCALE * (1.0 - 0.45 * orbit);
  let b0 = textureSampleLevel(baseNoise, weatherSampler, noiseCoord(p, ph0.x, 0.0) * scale, 0.0).rgb;
  let b1 = textureSampleLevel(baseNoise, weatherSampler, noiseCoord(p, ph1.x, 1.0) * scale, 0.0).rgb;
  let shapeN = (ph0.y * (0.45 * b0.x + 0.3 * b0.y + 0.25 * b0.z - SHAPE_MEAN) + ph1.y * (0.45 * b1.x + 0.3 * b1.y + 0.25 * b1.z - SHAPE_MEAN)) / SHAPE_SPREAD;

  // the noise also lifts and lowers the cloud top, so a solid overcast still has relief to shade
  let prof = heightProfile(h - shapeN * 0.13, typ, precip, top);
  if (prof < 0.01) {
    return 0.0;
  }
  // anvil: towers with rain spread sideways under their top
  let anvil = smoothstep(0.55, 0.85, typ) * smoothstep(0.35, 0.8, precip) * smoothstep(top - 0.3, top - 0.12, h) * (1.0 - smoothstep(top - 0.05, top, h));
  // close views: cover plus noise (cumulus puffs)
  let close = smoothstep(0.3, 1.3, w.r - 0.05 + shapeN * 0.28 + anvil * 0.35);
  // orbit views (Nubis remap): cover near 1 fills in to a deck, mid cover breaks into a cumulus field, low cover
  // leaves a few small cells; the cube cover decides the large features.
  let s = clamp(0.5 + shapeN * 0.28 + anvil * 0.2, 0.0, 1.0);
  let cov = clamp(w.r * 1.08, 0.0, 1.0);
  var deck = clamp((s - (1.0 - cov)) / max(cov, 0.06), 0.0, 1.0);
  deck = deck * deck * (3.0 - 2.0 * deck);
  deck = max(deck, 0.62 * smoothstep(0.78, 0.97, w.r) * (0.75 + 0.25 * s)); // overcast: a continuous sheet
  var dens = mix(close, deck, orbit) * prof;
  // Zoom dissolve: approaching the deck, the thin parts go first and only the dense cores are left.
  let cut = (1.0 - clouds.shell.z) * 0.7;
  dens = (dens - cut) / max(1.0 - cut, 0.001);
  if (dens <= 0.0) {
    return 0.0;
  }
  if (fine && clouds.march.z > 0.5) {
    let a = textureSampleLevel(detailNoise, weatherSampler, noiseCoord(p, ph0.x, 0.0) * DETAIL_SCALE, 0.0).rgb;
    let b = textureSampleLevel(detailNoise, weatherSampler, noiseCoord(p, ph1.x, 1.0) * DETAIL_SCALE, 0.0).rgb;
    let n0 = 0.6 * a.r + 0.3 * a.g + 0.1 * a.b;
    let n1 = 0.6 * b.r + 0.3 * b.g + 0.1 * b.b;
    let detailN = (ph0.y * (n0 - DETAIL_MEAN) + ph1.y * (n1 - DETAIL_MEAN)) / DETAIL_SPREAD;
    let erode = clamp(0.32 - detailN * 0.32, 0.0, 0.75) * (0.7 + 0.5 * h) * mix(1.0, 0.3, orbit);
    dens = clamp((dens - erode) / (1.0 - erode), 0.0, 1.0);
  }
  return dens;
}

// Precipitation column under a precipitating cloud: the density of the cloud base above it, fading toward the ground.
fn shaftDensity(d: vec3f, r: f32, w: vec4f, ph0: vec2f, ph1: vec2f) -> f32 {
  if (w.b < 0.04 || w.r < 0.3) {
    return 0.0;
  }
  let rBase = clouds.shell.x;
  let hl = (r - 1.0) / (rBase - 1.0);
  let base = cloudDensity(d * rBase, 0.14, w, false, ph0, ph1);
  if (base <= 0.0) {
    return 0.0;
  }
  // streaks: fine noise that depends on the direction only, so it is stretched all the way down
  let streak = textureSampleLevel(detailNoise, weatherSampler, noiseCoord(d, ph0.x, 0.0) * 90.0, 0.0).r;
  return base * smoothstep(0.04, 0.4, w.b) * mix(0.35, 1.0, hl) * (0.55 + 0.9 * streak) * 0.55;
}

// ---- light ----

fn opticalDepthToSun(p: vec3f, sun: vec3f, ph0: vec2f, ph1: vec2f) -> f32 {
  let rBase = clouds.shell.x;
  let rTop = clouds.shell.y;
  var od = 0.0;
  var ls = 0.0016;
  var pp = p;
  let n = i32(clouds.march.y);
  for (var j = 0; j < MAX_LIGHT; j++) {
    if (j >= n) {
      break;
    }
    pp += sun * (ls * 0.5);
    let r = length(pp);
    if (r > rTop) {
      break;
    }
    if (r > rBase) {
      let d = pp / r;
      od += cloudDensity(pp, (r - rBase) / (rTop - rBase), cubeWeather(d), false, ph0, ph1) * ls * SIGMA_CLOUD;
    }
    pp += sun * (ls * 0.5);
    ls *= 1.6;
  }
  return od;
}

// 1 where the sun reaches p, 0 inside the planet's shadow cylinder, soft across the terminator
fn planetShadow(p: vec3f, sun: vec3f) -> f32 {
  let s = dot(p, sun);
  let perp = length(p - sun * s);
  return mix(smoothstep(0.97, 1.035, perp), 1.0, smoothstep(0.0, 0.08, s));
}

fn hgPhase(g: f32, c: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

// Colour of the scattered light in a sample: tone 0..1 picks ink-blue shade -> lit paper, then grading.
fn shade(d: vec3f, sun: vec3f, h: f32, w: vec4f, sunE: f32, vis: f32, amb: f32) -> vec3f {
  let day = smoothstep(-0.3, 0.3, dot(d, sun));
  let tone = clamp(sunE + amb * (0.4 + 0.6 * day), 0.0, 1.0);
  let shadeC = mix(NIGHT, SHADE, vis); // twilight: the shade fades to the night grey instead of going ink-dark
  var col = mix(shadeC, LIT, smoothstep(0.05, 0.85, tone));
  col = mix(NIGHT * (0.84 + 0.12 * h + 0.22 * tone), col, vis);
  // soft warm band along the terminator, on the lit side
  let bx = (dot(d, sun) - 0.06) / 0.11;
  col = mix(col, WARM * (0.85 + 0.6 * tone), exp(-bx * bx) * 0.32 * vis * tone);
  // rain is greyer and darker, snow is cool white
  let wet = smoothstep(0.08, 0.55, w.b);
  let lum = dot(col, vec3f(0.3, 0.59, 0.11));
  col = mix(col, mix(vec3f(lum) * vec3f(0.86, 0.9, 0.97), RAIN * (0.75 + 0.55 * tone), 0.25) * mix(0.85, 1.0, vis), wet * 0.6);
  let snow = wet * (1.0 - smoothstep(-1.0, 3.0, w.a * 80.0 - 40.0));
  col = mix(col, ICE * vec3f(0.93, 0.97, 1.0) * mix(0.35, 1.0, tone * vis + 0.25), snow * 0.65);
  return col;
}

fn lightning(p: vec3f, d: vec3f, sun: vec3f) -> vec3f {
  let count = i32(clouds.march.w);
  if (count == 0) {
    return vec3f(0.0);
  }
  let boost = mix(0.1, 2.2, 1.0 - smoothstep(-0.15, 0.2, dot(d, sun)));
  let rMid = clouds.shell.x + 0.4 * (clouds.shell.y - clouds.shell.x);
  var e = 0.0;
  for (var f = 0; f < ${FLASH_MAX}; f++) {
    if (f >= count) {
      break;
    }
    let dv = p - clouds.flash[f].xyz * rMid;
    e += clouds.flash[f].w * exp(-dot(dv, dv) / (2.0 * 0.016 * 0.016));
  }
  return vec3f(0.55, 0.7, 1.0) * e * boost * 0.7;
}

@fragment
fn march(v: VsOut) -> @location(0) vec4f {
  let rBase = clouds.shell.x;
  let rTop = clouds.shell.y;
  let n = toCube(frame.eye.xyz);
  let rd = normalize(toCube(frame.camF.xyz + frame.camR.xyz * v.ndc.x + frame.camU.xyz * v.ndc.y));
  let sun = normalize(frame.sun.xyz.yzx);

  // clip the ray to the shell and to the planet
  let b = dot(n, rd);
  let q = n - rd * b; // closest approach: well conditioned near the limb
  let q2 = dot(q, q);
  let dTop = rTop * rTop - q2;
  if (dTop <= 0.0) {
    return vec4f(0.0);
  }
  let sq = sqrt(dTop);
  let tA = max(-b - sq, 0.0);
  var tB = -b + sq;
  let dPl = 1.0 - q2;
  if (dPl > 0.0) {
    let tp = -b - sqrt(dPl);
    if (tp > 0.0) {
      tB = min(tB, tp);
    }
  }
  let len = tB - tA;
  if (len <= 0.0) {
    return vec4f(0.0);
  }

  let ph0 = layerPhase(0.0);
  let ph1 = layerPhase(1.0);
  let steps = i32(clouds.march.x);
  let dtF = clamp(len / (0.6 * clouds.march.x), 0.0003, 0.0035); // capped: long grazing rays would stair-step
  var t = tA + dtF * (0.2 + 0.6 * ign(v.pos.xy));
  var T = 1.0;
  var col = vec3f(0.0);
  let cosView = dot(rd, sun);
  let phase = 0.7 + 0.3 * min(4.0 * PI * mix(hgPhase(-0.3, cosView), hgPhase(0.6, cosView), 0.35), 4.0);

  for (var i = 0; i < MAX_STEPS; i++) {
    if (i >= steps || t >= tB || T < 0.02) {
      break;
    }
    let p = n + rd * t;
    let r = length(p);
    let d = p / r;
    let w = cubeWeather(d);
    let inCloud = r >= rBase;
    var h = (r - 1.0) / (rBase - 1.0);
    var dens = 0.0;
    if (inCloud) {
      h = (r - rBase) / (rTop - rBase);
      dens = cloudDensity(p, h, w, true, ph0, ph1);
    } else {
      dens = shaftDensity(d, r, w, ph0, ph1);
    }
    if (dens <= 0.001) {
      t += dtF * 1.6; // empty air: coarse step
      continue;
    }
    let vis = planetShadow(p, sun);
    var sunE = 0.0;
    var amb = 0.4;
    if (inCloud) {
      var od = 1e3;
      if (vis > 0.0) {
        od = opticalDepthToSun(p, sun, ph0, ph1);
      }
      let lightT = max(exp(-od * 0.5), 0.5 * exp(-od * 0.08)); // multiple scattering: light dies slower than the view
      let powder = mix(1.0, 1.0 - exp(-dens * 5.0), 0.5);
      sunE = vis * lightT * phase * 0.95 * powder;
      amb = mix(0.14, 0.52, h);
    } else {
      sunE = vis * 0.5 * phase * 0.6;
    }
    var c = shade(d, sun, select(0.0, h, inCloud), w, sunE, vis, amb);
    if (!inCloud) {
      // shafts: grey for rain, white for snow
      let snow = 1.0 - smoothstep(-1.0, 3.0, w.a * 80.0 - 40.0);
      c = mix(mix(RAIN * 1.15, c, 0.35), ICE, snow * 0.7) * mix(0.5, 1.0, vis);
    }
    c += lightning(p, d, sun) * select(0.25, 1.0, inCloud);
    let ext = dens * select(SIGMA_SHAFT, SIGMA_CLOUD, inCloud) * dtF;
    let a = (1.0 - exp(-ext)) * mix(0.6, 1.0, vis); // night clouds are thinner: less contrast against the lit map
    col += T * a * c;
    T *= 1.0 - a;
    t += dtF;
  }
  return vec4f(col, 1.0 - T);
}

// Composite: five bilinear taps of the premultiplied target (the low-resolution grain and stair steps blur out) times
// the fade; the density dissolve does most of the work, the alpha only lets the last cores go.
@fragment
fn composite(v: VsOut) -> @location(0) vec4f {
  let uv = vec2f(v.ndc.x * 0.5 + 0.5, 0.5 - v.ndc.y * 0.5);
  let e = clouds.texel.xy * 0.8;
  var c = textureSampleLevel(marched, marchSampler, uv, 0.0) * 0.36;
  c += textureSampleLevel(marched, marchSampler, uv + vec2f(e.x, e.y), 0.0) * 0.16;
  c += textureSampleLevel(marched, marchSampler, uv + vec2f(-e.x, e.y), 0.0) * 0.16;
  c += textureSampleLevel(marched, marchSampler, uv + vec2f(e.x, -e.y), 0.0) * 0.16;
  c += textureSampleLevel(marched, marchSampler, uv + vec2f(-e.x, -e.y), 0.0) * 0.16;
  return c * smoothstep(0.02, 0.35, clouds.shell.z);
}
