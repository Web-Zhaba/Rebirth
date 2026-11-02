#include "frame"
#include "weather"

// The water surface (scene/water.ts): a WGSL port of the old 3D water. Vertices are metres in the
// town origin's east/north/up frame; `water.rel` is the origin minus the eye. The wind ripples it (calm water is a
// mirror), rivers carry the ripples along their flow, the sky reflects with the angle, the sun and the moon glint, the
// shallows lighten and the shore is rimmed, rain rings it, piers of bridges get foam and a wake, and the ground's
// weather (sky/weather.wgsl groundWeather) freezes it and lays snow on the ice. Colours are display colours like the
// models'; nights dim to the old dusk blue. The far edge and the camera coming down fade it into the terrain's water.

struct Water {
  rel: vec4f,     // xyz origin - eye (m)
  e: vec4f,
  n: vec4f,
  u: vec4f,
  eye: vec4f,     // xyz eye in the origin's frame (m), w time (s)
  light: vec4f,   // xyz the models' light in the origin's frame, w sun strength 0..1
  sun: vec4f,     // xyz sun direction in the origin's frame, w how lit the place is (day 1 .. night 0)
  wind: vec4f,    // xy wind direction, z ripple strength, w rain 0..1
  fade: vec4f,    // x far (m), y fade-in 0..1, z steam 0..1, w piers
  sky: vec4f,     // rgb the sky overhead
  horizon: vec4f, // rgb the sky at the horizon
  piers: array<vec4f, ${PIERS}>, // xy origin-frame metres, z how far the foam ring reaches
};

@group(1) @binding(0) var<uniform> water: Water;

const SHORE_CAP = 60.0; // map/waterMesh.ts
const STEAM_LIFT = 0.8; // m above the water: the sheet of steam
const NIGHT = vec3f(0.13, 0.16, 0.24); // townMesh.wgsl: the old map's dusk blue
const DEEP = vec3f(${DEEP});
const SHALLOW = vec3f(${SHALLOW});
const FOAM = vec3f(${FOAM});
const GROUND_TONE = vec3f(${GROUND_TONE});
const FOREST_TONE = vec3f(${FOREST_TONE});

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) m: vec3f,     // origin-frame metres
  @location(1) rel: vec3f,   // camera-relative (m), unlifted
  @location(2) shore: f32,
  @location(3) flow: vec2f,
  @location(4) tone: f32,
};

fn place(at: vec3f, shore: f32, flow: vec2f, tone: f32, up: f32) -> VsOut {
  let a = at + vec3f(0.0, 0.0, up);
  // pulled a little toward the camera along its ray: drawn over the ground it lies on, at the same place on the screen
  let toEye = water.eye.xyz - a;
  let d = max(length(toEye), 1.0);
  let p = a + toEye * (min(d * 0.002, 25.0) / d);
  var o: VsOut;
  o.pos = frame.viewProj * vec4f(water.rel.xyz + water.e.xyz * p.x + water.n.xyz * p.y + water.u.xyz * p.z, 1.0);
  o.m = a;
  o.rel = water.rel.xyz + water.e.xyz * a.x + water.n.xyz * a.y + water.u.xyz * a.z;
  o.shore = shore;
  o.flow = flow;
  o.tone = tone;
  return o;
}

@vertex
fn vs(@location(0) at: vec3f, @location(1) shore: f32, @location(2) flow: vec2f, @location(3) tone: f32) -> VsOut {
  return place(at, shore, flow, tone, 0.0);
}

@vertex
fn vsSteam(@location(0) at: vec3f, @location(1) shore: f32, @location(2) flow: vec2f, @location(3) tone: f32) -> VsOut {
  return place(at, shore, flow, tone, STEAM_LIFT);
}

fn wmod(x: vec2f, y: f32) -> vec2f {
  return x - y * floor(x / y);
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(wmod(p, 1024.0), vec2f(127.1, 311.7))) * 43758.5453);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x), u.y);
}

// The slope of the wind ripples at p (m): a few waves about the wind and some noise, each faded out before it gets
// finer than a pixel (fw: metres per pixel), so the far water does not sparkle.
fn ripples(p: vec2f, t: f32, fw: f32) -> vec2f {
  let wd = water.wind.xy;
  var g = vec2f(0.0);
  for (var k = 0; k < 4; k++) {
    let fk = f32(k);
    let len = 7.0 / (1.0 + fk * 0.9);
    let a = (fk - 1.5) * 0.5;
    let dir = vec2f(wd.x * cos(a) - wd.y * sin(a), wd.x * sin(a) + wd.y * cos(a));
    let kw = 6.2832 / len;
    let fade = clamp(1.5 - fw * 4.0 / len, 0.0, 1.0);
    g += dir * cos(dot(dir, p) * kw - t * sqrt(9.8 * kw) + fk * 1.7) * 0.07 * fade;
  }
  let q = p * 0.7 + wd * t * 0.4;
  let fade = clamp(1.5 - fw * 4.0, 0.0, 1.0);
  let n0 = noise(q);
  g += vec2f(noise(q + vec2f(0.2, 0.0)) - n0, noise(q + vec2f(0.0, 0.2)) - n0) * 0.6 * fade;
  return g;
}

// Long, slow swells and gusts of wind on the water (tens of metres): seen from afar, the sky's light shifts on them.
fn swells(p: vec2f, t: f32) -> vec2f {
  let q = p * 0.012 + water.wind.xy * t * 0.01;
  let n0 = noise(q);
  let n1 = noise(q * 2.3 + 5.1);
  return vec2f(
    noise(q + vec2f(0.05, 0.0)) - n0 + (noise(q * 2.3 + 5.1 + vec2f(0.05, 0.0)) - n1) * 0.5,
    noise(q + vec2f(0.0, 0.05)) - n0 + (noise(q * 2.3 + 5.1 + vec2f(0.0, 0.05)) - n1) * 0.5,
  ) * 0.9;
}

// Rings of raindrops (a little larger than life, to be seen from above): one a cell at a time, spreading and fading.
fn rain(p: vec2f, t: f32, fw: f32) -> vec2f {
  var g = vec2f(0.0);
  for (var k = 0; k < 2; k++) {
    let q = p + f32(k) * vec2f(1.7, 2.9);
    let c = floor(q / 3.5);
    let o = (c + 0.25 + 0.5 * vec2f(hash(c + 3.1), hash(c + 7.7))) * 3.5;
    let age = fract(t * 0.7 + hash(c + f32(k) * 11.0));
    let dv = q - o;
    let r = length(dv);
    g += dv / max(r, 1e-3) * exp(-pow((r - age * 1.6) * 8.0, 2.0)) * (1.0 - age) * 0.7;
  }
  return g * clamp(1.5 - fw * 3.0, 0.0, 1.0);
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4f {
  // derivatives first: they need uniform control flow
  let fw = length(fwidth(v.m.xy));
  let foot = length(fwidth(v.rel));
  let t = water.eye.w;
  let dist = length(water.eye.xyz - v.m);
  let gw = groundWeather(v.rel, v.m.z);
  let iced = gw.z;
  let snow = gw.x;
  let open = 1.0 - iced;
  // rivers: the ripples carried along the flow, two phases crossfaded so they never stretch
  var g: vec2f;
  if (dot(v.flow, v.flow) > 1e-4) {
    let ph = fract(t * 0.15);
    g = mix(ripples(v.m.xy - v.flow * ph * 5.0, t, fw), ripples(v.m.xy - v.flow * fract(ph + 0.5) * 5.0 + 3.7, t, fw), abs(2.0 * ph - 1.0));
  } else {
    g = ripples(v.m.xy, t, fw);
  }
  g =(g * water.wind.z + swells(v.m.xy, t) * (0.4 + water.wind.z) + rain(v.m.xy, t, fw) * water.wind.w) * open;
  let n = normalize(vec3f(-g, 1.0));
  let toEye = normalize(water.eye.xyz - v.m);
  let fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, toEye), 0.0), 5.0);
  let r = reflect(-toEye, n);
  var sky = mix(water.horizon.rgb, water.sky.rgb, smoothstep(0.0, 0.5, r.z));
  let sunStr = water.light.w;
  let snowCol = weather.snowCol.rgb;
  // the shore in the reflection: its tone as a streak that fades out from the shore, longer at a low view, shaken by
  // the ripples, only on calm open water (tone < 0: no shore data, as on the ribbons of streams)
  let calm = (1.0 - smoothstep(0.2, 0.75, water.wind.z)) * (1.0 - water.wind.w) * open * step(-0.01, v.tone);
  if (calm > 0.0) {
    let reach = 5.0 + 28.0 * pow(1.0 - clamp(toEye.z, 0.0, 1.0), 2.0);
    let sd = max(v.shore + dot(g, vec2f(1.0, 0.6)) * 30.0, 0.0);
    let streak = exp(-sd / reach) * (1.0 - smoothstep(30.0, 60.0, v.shore)) * (0.7 + 0.3 * noise(vec2f(v.m.x + v.m.y, v.m.x - v.m.y) * 0.9 + g * 20.0));
    var shoreCol = mix(GROUND_TONE, FOREST_TONE, clamp(v.tone, 0.0, 1.0));
    shoreCol = mix(shoreCol, snowCol * 0.8, snow * 0.7) * mix(0.25, 1.0, sunStr);
    sky = mix(sky, shoreCol, streak * calm * 0.5);
  }
  // the body of the water: light in the shallows, deep away from the shore, a little lit by the sun
  let body = mix(SHALLOW, DEEP, smoothstep(0.0, SHORE_CAP, v.shore)) * mix(0.9, 1.04, max(dot(n, water.light.xyz), 0.0)) * mix(0.9, 1.0, sunStr);
  var col = mix(body, sky, fres * (1.0 - 0.35 * water.wind.w)); // rain roughens the water: a duller reflection
  // glints: the sun, and by night the moon (opposite it)
  let sd = water.sun.xyz;
  let s = max(dot(r, sd), 0.0);
  col += vec3f(1.0, 0.95, 0.85) * (pow(s, 400.0) * 3.0 + pow(s, 40.0) * 0.12) * sunStr * smoothstep(-0.02, 0.1, sd.z) * open;
  col += vec3f(0.75, 0.8, 0.9) * pow(max(dot(r, -sd), 0.0), 600.0) * 1.2 * (1.0 - sunStr) * smoothstep(0.02, 0.15, -sd.z) * open;
  // a light rim along the shore, broken up
  let rim = 1.0 - smoothstep(0.3, 2.5, v.shore + noise(v.m.xy * 0.35 + t * 0.15) * 1.6);
  col = mix(col, FOAM, rim * 0.65 * open);
  // foam around the piers of bridges: a ring hugging each, and a streaky wake downstream along the flow
  var pf = 0.0;
  let count = i32(water.fade.w);
  for (var q = 0; q < ${PIERS}; q++) {
    if (q >= count) {
      break;
    }
    let pier = water.piers[q].xyz;
    let dv = v.m.xy - pier.xy;
    let pr = pier.z;
    let reachw = pr * 7.0 + 6.0;
    let d2 = dot(dv, dv);
    if (d2 > reachw * reachw) {
      continue;
    }
    let jag = noise(v.m.xy * 0.9 + t * 0.6) * 0.8;
    let rr = sqrt(d2);
    // an annulus about the pier (the pier itself stands in the middle of it), broken into flecks
    let ringf = smoothstep(pr * 0.45, pr * 0.95, rr) * (1.0 - smoothstep(pr + 0.2, pr + 1.2 + jag, rr)) * smoothstep(0.25, 0.6, noise(v.m.xy * 2.3 + t * 0.4) + 0.35);
    var wake = 0.0;
    let sp = length(v.flow);
    if (sp > 0.05) {
      let fd = v.flow / sp;
      let along = dot(dv, fd);
      let across = dot(dv, vec2f(-fd.y, fd.x));
      let wd = pr * (0.9 + along * 0.12);
      let wb = step(0.0, along) * exp(-across * across / (wd * wd)) * exp(-along / (pr * 4.0 + 2.0));
      let streaks = noise(vec2f(across * 1.6, along * 0.5 - t * (0.8 + sp * 1.5)));
      wake = wb * smoothstep(0.35, 0.75, streaks + wb * 0.35);
    }
    pf = max(pf, max(ringf * 0.8, wake * 0.7));
  }
  col = mix(col, FOAM, pf * (1.0 - smoothstep(150.0, 450.0, dist)) * open);
  // ice: pale, cracked, under patches of snow
  var ice = weather.iceCol.rgb * mix(0.86, 1.0, noise(v.m.xy * 0.04)) * (1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.04, abs(noise(v.m.xy * 0.06) - 0.5))) * clamp(1.5 - fw * 2.0, 0.0, 1.0));
  ice = mix(ice, snowCol, snow * smoothstep(0.25, 0.75, noise(v.m.xy * 0.12) + snow * 0.6));
  ice = mix(ice * mix(0.78, 1.0, max(water.light.z, 0.0)) * mix(0.85, 1.0, sunStr), sky, fres * 0.2);
  col = mix(col, ice, iced);
  col *= mix(NIGHT, vec3f(1.0), water.sun.w) * cloudDim(cloudShade(v.rel, water.u.xyz, foot));
  // into the terrain's own water: while the camera comes down, and toward the far edge
  let a = water.fade.y * (1.0 - smoothstep(water.fade.x * 0.7, water.fade.x, dist));
  return vec4f(col * a, a);
}

fn fbm(p0: vec2f, oct: i32) -> f32 {
  var p = p0;
  var s = 0.0;
  var a = 0.5;
  var tot = 0.0;
  for (var k = 0; k < 3; k++) {
    if (k >= oct) {
      break;
    }
    s += a * noise(p);
    tot += a;
    p = p * 2.03 + vec2f(17.1, 9.3);
    a *= 0.5;
  }
  return s / tot;
}

// Steam: domain-warped fbm in metres, stretched along the wind and carried by it (and by a river's flow), thicker at
// the shore, thin looking straight down (it is a 2D sheet), fewer octaves with distance.
@fragment
fn fsSteam(v: VsOut) -> @location(0) vec4f {
  let t = water.eye.w;
  let wd = water.wind.xy;
  let dist = length(water.eye.xyz - v.m);
  let reach = min(water.fade.x * 0.6, 9000.0);
  let fadeFar = 1.0 - smoothstep(reach * 0.5, reach, dist);
  let fadeNear = smoothstep(2.0, 25.0, dist);
  let vz = abs(water.eye.z - v.m.z) / max(dist, 1.0);
  let looking = mix(0.3, 1.0, pow(1.0 - vz, 1.5)); // thicker along the surface than straight down
  let river = dot(v.flow, v.flow) > 1e-4;
  let vel = wd * (0.3 + water.wind.z * 1.5) + v.flow * 0.5; // m/s
  let p = v.m.xy - vel * t;
  let q = vec2f(dot(p, wd) * 0.5, dot(p, vec2f(-wd.y, wd.x))) / 14.0; // stretched along the wind
  let oct = select(select(1, 2, dist < 2500.0), 3, dist < 350.0);
  let w = vec2f(fbm(q * 0.8 + vec2f(0.0, t * 0.02), oct), fbm(q * 0.8 + vec2f(5.2, 1.3) - t * 0.015, oct));
  let n = fbm(q + (w - 0.5) * 2.2, oct); // curling
  let wisp = smoothstep(0.34, 0.68, n);
  let clumps = mix(0.4, 1.0, smoothstep(0.25, 0.7, noise(v.m.xy * 0.004 + 3.0))); // bare stretches between banks of steam
  let shoreK = select(mix(0.55, 1.0, 1.0 - smoothstep(0.0, 50.0, v.shore)), 1.0, river);
  let lip = 0.5 + 0.5 * smoothstep(0.0, 3.0, v.shore);
  let sunStr = water.light.w;
  var a = (0.2 + 0.8 * wisp) * wisp * clumps * shoreK * lip * looking * water.fade.z * fadeFar * fadeNear * water.fade.y * 0.85;
  a *= mix(0.35, 1.0, sunStr); // by night it is barely there
  var col = mix(vec3f(0.86, 0.9, 0.95), water.horizon.rgb * 1.15, 0.45);
  let warm = (1.0 - smoothstep(0.02, 0.4, water.sun.z)) * sunStr; // lit from the side at sunrise
  col = mix(col, vec3f(1.0, 0.8, 0.62), warm * 0.55) * mix(0.4, 1.0, sunStr) * (0.9 + 0.2 * wisp);
  col *= mix(NIGHT, vec3f(1.0), water.sun.w);
  return vec4f(col * a, a); // premultiplied
}
