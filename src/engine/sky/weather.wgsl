#include "frame"

// Weather in the shading model: the weather cube pair and the base noise of the clouds
// (map/clouds: built by the cloud worker), and the town's weather on the ground. Bound in group 0 beside the frame, so
// every surface reads the same clouds: their shadows at the real world position, snow, ice and wet ground.
//
// The cube is in the old MapLibre unit-sphere frame (X to 90°E, Y north, Z to 0°E 0°N): an ECEF direction d is d.yzx
// there. Its texels: R cover, G type (sheet .. tower), B precipitation, A sea-level temperature (T + 40) / 80.

struct Weather {
  drift: vec4f,   // x, y weights of the two drifting noise layers (w0^2 + w1^2 = 1), z, w their ages (game days)
  off0: vec4f,    // xyz tile offset of noise layer 0, w share of cube B (the next interval)
  off1: vec4f,    // xyz tile offset of noise layer 1, w cloud shadows on (1) / off or not loaded (0)
  wind: vec4f,    // x westerlies, y trades (degrees of longitude per game day), z layer period (days), w game days
  shadow: vec4f,   // x height the shadows are cast from (m), y their drift (degrees per game day)
  ground: vec4f,  // the town's ground: x snow 0..1, y wetness 0..1, z ice on water 0..1, w 1 = the cube's climate elsewhere
  town: vec4f,    // xyz eye - town origin (m, subtracted in f64), w 1 = a town exists
  townE: vec4f,   // xyz the town origin's east axis, w the ground cover's scale fade (0 on the globe views)
  townN: vec4f,   // xyz its north axis
  snowCol: vec4f, // rgb snow (sRGB)
  iceCol: vec4f,  // rgb ice (sRGB)
};

@group(0) @binding(1) var<uniform> weather: Weather;
@group(0) @binding(2) var cubeA: texture_cube<f32>;
@group(0) @binding(3) var cubeB: texture_cube<f32>;
@group(0) @binding(4) var baseNoise: texture_3d<f32>;
@group(0) @binding(5) var weatherSampler: sampler;

const EARTH_R = ${EARTH_R};
const NOISE_TILE = ${NOISE_TILE};
const SHADOW_MAX = ${SHADOW_MAX};
const OVERCAST_MAX = ${OVERCAST_MAX};
const SUN_OFF = ${SUN_OFF};
const SUN_FULL = ${SUN_FULL};
const SHADOW_DUSK = ${SHADOW_DUSK}; // the old shadow layer multiplied the map towards the palette's dusk
const TOWN_NEAR = ${TOWN_NEAR};
const TOWN_FAR = ${TOWN_FAR};
const SHADOW_NOISE_MEAN = 0.48; // base volume G (Worley fbm from 4 cells per tile): mean 0.48, 5..95 % = 0.29..0.68
const SHADOW_STRETCH = 2.2;     // widen it to about 0.1..0.9 so the patches have contrast

fn weatherAt(ecefDir: vec3f) -> vec4f {
  let d = ecefDir.yzx;
  let a = textureSampleLevel(cubeA, weatherSampler, d, 0.0);
  if (weather.off0.w <= 0.001) {
    return a;
  }
  return mix(a, textureSampleLevel(cubeB, weatherSampler, d, 0.0), weather.off0.w);
}

// Rotation about the polar axis of the cube's frame (+Y), eastward positive.
fn rotPolar(v: vec3f, a: f32) -> vec3f {
  let c = cos(a);
  let s = sin(a);
  return vec3f(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

// How much the clouds darken a ground point (the old cloudShadows layer, map/clouds/shadowShaders.ts): 0 in the open,
// up to SHADOW_MAX under a cumulus patch plus OVERCAST_MAX under a thick deck. The point under the cloud that shades it
// lies towards the sun, height / tan(elevation) away. `rel` is camera-relative, `up` its up, `foot` the ground width
// of a pixel there (m): patches smaller than a few pixels give way to their mean.
fn cloudShade(rel: vec3f, up: vec3f, foot: f32) -> f32 {
  if (weather.off1.w <= 0.0) {
    return 0.0;
  }
  let sinEl = dot(up, frame.sun.xyz);
  let sun = smoothstep(SUN_OFF, SUN_FULL, sinEl);
  if (sun <= 0.0) {
    return 0.0;
  }
  let tanEl = sinEl * inverseSqrt(max(1.0 - sinEl * sinEl, 1e-6));
  let tang = normalize(frame.sun.xyz - sinEl * up);
  let q = frame.eye.xyz + rel + tang * (weather.shadow.x / tanEl);
  let n = normalize(q);
  let c = weatherAt(n);
  let cover = c.r;
  if (cover < 0.03) {
    return 0.0;
  }
  let d = n.yzx;
  let drift = radians(weather.shadow.y);
  let p0 = rotPolar(d, -drift * weather.drift.z) * (EARTH_R / NOISE_TILE) + weather.off0.xyz;
  let p1 = rotPolar(d, -drift * weather.drift.w) * (EARTH_R / NOISE_TILE) + weather.off1.xyz;
  var nv = 0.5 + weather.drift.x * (textureSampleLevel(baseNoise, weatherSampler, p0, 0.0).g - SHADOW_NOISE_MEAN)
    + weather.drift.y * (textureSampleLevel(baseNoise, weatherSampler, p1, 0.0).g - SHADOW_NOISE_MEAN);
  nv = clamp(0.5 + (nv - 0.5) * SHADOW_STRETCH, 0.0, 1.0);
  let detail = 1.0 - smoothstep(NOISE_TILE / 16.0, NOISE_TILE / 6.0, foot);
  let th = 1.0 - cover;
  let pat = (detail * smoothstep(th - 0.12, th + 0.12, nv) + (1.0 - detail) * cover) * smoothstep(0.05, 0.3, cover);
  let thick = smoothstep(0.45, 0.95, cover);
  return min(1.0, sun * (SHADOW_MAX * c.g * pat + OVERCAST_MAX * thick));
}

// The darkening as a multiplier of a display-space colour, the way the old layer blended it over the map.
fn cloudDim(a: f32) -> vec3f {
  return vec3f(1.0) - a * (vec3f(1.0) - SHADOW_DUSK);
}

fn srgbToLinear(c: vec3f) -> vec3f {
  return pow(c, vec3f(2.2));
}

// Town east/north metres of a camera-relative point: the frame the town's models are built in, so snow patches run on
// from the roads onto the ground.
fn townXY(rel: vec3f) -> vec2f {
  let p = weather.town.xyz + rel;
  return vec2f(dot(p, weather.townE.xyz), dot(p, weather.townN.xyz));
}

// Weather on the ground (x snow 0..1, y wetness, z ice on water) at a camera-relative point at altM metres: the
// town's own sim state near the town, the weather cube's climate from TOWN_FAR on (view/engine/townWeather.ts
// climateGround mirrors it), nothing on the globe views (the clouds' stage, not a white ball of snow).
fn groundWeather(rel: vec3f, altM: f32) -> vec3f {
  let fade = weather.townE.w;
  if (fade <= 0.0) {
    return vec3f(0.0);
  }
  let own = weather.ground.xyz;
  if (weather.ground.w <= 0.0) {
    return own * fade; // no cube yet: the town's weather everywhere
  }
  var k = 0.0;
  if (weather.town.w > 0.0) {
    k = 1.0 - smoothstep(TOWN_NEAR, TOWN_FAR, length(weather.town.xyz + rel));
  }
  var local = own;
  if (k < 1.0) {
    let c = weatherAt(normalize(frame.eye.xyz + rel));
    let t = c.a * 80.0 - 40.0 - 0.0065 * altM;
    let falling = smoothstep(0.03, 0.4, c.b);
    local = vec3f(1.0 - smoothstep(-6.0, 1.0, t), falling * smoothstep(0.0, 2.0, t), 1.0 - smoothstep(-10.0, -2.0, t));
  }
  return mix(local, own, k) * fade;
}

fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

// Smooth value noise 0..1.
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2f(1.0, 0.0)), f.x), mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0, 1.0)), f.x), f.y);
}

// Snow lying at town point xy on a surface `upness` 0..1 (how much it faces up), for snow cover `amount` 0..1: a thin
// snowpack is patchy, a thick one closes up. Once a pixel spans more than a few patches (`foot`, m) the patches give
// way to the share of ground they cover, so the far ground does not sparkle.
fn snowShare(xy: vec2f, upness: f32, amount: f32, foot: f32) -> f32 {
  if (amount <= 0.0) {
    return 0.0;
  }
  let lim = 1.0 - amount * 1.3;
  let far = smoothstep(0.4, 3.0, foot);
  var cover = smoothstep(lim - 0.15, lim + 0.4, 0.5);
  if (far < 1.0) {
    let blotch = 0.55 * vnoise(xy * 0.9) + 0.3 * vnoise(xy * 2.7 + 7.0) + 0.15 * hash2(floor(xy * 5.0));
    cover = mix(smoothstep(lim, lim + 0.25, blotch), cover, far);
  }
  return upness * cover * mix(0.35, 0.95, amount);
}
