#include "frame"

// The forest's trees and small details (scene/forest.ts), drawn from the scatter's instances (forestScatter.wgsl):
// near ones as their models, far ones as impostors facing the camera (scene/treeAtlas.ts), both lit, recoloured with the
// season and snowed like the old tree layer. Instance: camera-relative base (m, ECEF), size (m, the model is 1 high),
// turn, hash, shade, kind. Models are built in east/north/up metres; the axes are the target's (the up of a tree 12 km
// away leans a tenth of a degree from it).

struct Forest {
  e: vec4f,
  n: vec4f,
  u: vec4f,
  light: vec4f,  // xyz light direction (east/north/up), w sun strength 0..1
  params: vec4f, // x how lit the place is (day 1 .. night 0), y time (s), z wind 0..1
  wind: vec4f,   // xy wind direction (east/north)
  bare: vec4f,   // bare-branch colour
  snow: vec4f,   // snow colour
  kinds: array<vec4f, 6>, // x season (0 none, 1 leaves, 2 reeds), y sway, z snow 0..1, w bare 0..1
  colA: array<vec4f, 6>,  // rgb the season's first crown colour, w impostor half side (tree heights)
  colB: array<vec4f, 6>,  // rgb the second (mixed per tree)
  base: array<vec4f, 6>,  // rgb the colour the crown was built with
};

@group(1) @binding(0) var<uniform> forest: Forest;
@group(1) @binding(1) var atlasColor: texture_2d_array<f32>;
@group(1) @binding(2) var atlasData: texture_2d_array<f32>;
@group(1) @binding(3) var atlasSampler: sampler;

const NIGHT = vec3f(0.13, 0.16, 0.24); // townMesh.wgsl: the old map's dusk blue
const VIEWS = ${IMPOSTOR_VIEWS}.0;
const STEP = ${IMPOSTOR_STEP}.0;

fn cell(p: vec3f) -> f32 {
  return fract(sin(dot(floor(p), vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
}

fn gust(hash: f32) -> f32 {
  return 0.35 + 0.65 * sin(forest.params.y * (1.1 + 0.5 * hash) + hash * 40.0);
}

fn toLocal(v: vec3f) -> vec3f {
  return vec3f(dot(v, forest.e.xyz), dot(v, forest.n.xyz), dot(v, forest.u.xyz));
}

// The old layer's shading: seasonal crowns recoloured (keeping their light and shade), darker low in the crown, snow
// on what faces up, then the sun and the night.
fn shade(colIn: vec3f, n: vec3f, crown: f32, h: f32, spot: f32, kind: u32, hash: f32, tone: f32) -> vec3f {
  var col = colIn;
  let kp = forest.kinds[kind];
  if (crown > 0.5) {
    if (kp.x > 0.5) {
      let c = mix(mix(forest.colA[kind].rgb, forest.colB[kind].rgb, fract(hash * 7.31)), forest.bare.rgb, kp.w);
      col = c * (dot(col, vec3f(1.0)) / dot(forest.base[kind].rgb, vec3f(1.0)));
    }
    col *= tone * mix(0.7, 1.05, smoothstep(0.1, 1.0, h));
    col = mix(col, forest.snow.rgb, kp.z * smoothstep(0.12, 0.45, n.z) * mix(0.35, 0.95, spot));
  }
  let d = max(dot(n, forest.light.xyz), 0.0);
  let k = mix(0.55, 1.0, d) * mix(0.88, 1.0, forest.light.w);
  return col * k * mix(NIGHT, vec3f(1.0), forest.params.x);
}

struct Inst {
  @location(4) a: vec4f, // base xyz, size
  @location(5) b: vec4f, // turn, hash, shade, kind
};

struct MeshOut {
  @builtin(position) pos: vec4f,
  @location(0) c: vec3f,
  @location(1) n: vec3f,
  @location(2) p: vec3f, // model position scaled, for the noise of bare twigs and snow
  @location(3) @interpolate(flat) info: vec4f, // x kind, y hash, z shade, w crown
  @location(4) h: f32,
};

@vertex
fn meshVs(@location(0) pos: vec3f, @location(1) nrm: vec3f, @location(2) col: vec3f, @location(3) crown: f32, inst: Inst) -> MeshOut {
  let kind = u32(inst.b.w + 0.5);
  let kp = forest.kinds[kind];
  let s = inst.a.w;
  var p = pos;
  if (crown > 0.5) {
    p = vec3f(p.xy * (1.0 - 0.45 * kp.w), p.z);
  }
  let c = cos(inst.b.x);
  let sn = sin(inst.b.x);
  p = vec3f(c * p.x - sn * p.y, sn * p.x + c * p.y, p.z) * s;
  p = vec3f(p.xy + forest.wind.xy * forest.params.z * kp.y * gust(inst.b.y) * pos.z * pos.z * s * 0.03, p.z);
  let world = inst.a.xyz + forest.e.xyz * p.x + forest.n.xyz * p.y + forest.u.xyz * p.z;
  var o: MeshOut;
  o.pos = frame.viewProj * vec4f(world, 1.0);
  o.c = col;
  o.n = vec3f(c * nrm.x - sn * nrm.y, sn * nrm.x + c * nrm.y, nrm.z);
  o.p = pos * s + inst.b.y * 17.0;
  o.info = vec4f(inst.b.w, inst.b.y, inst.b.z, crown);
  o.h = pos.z;
  return o;
}

@fragment
fn meshFs(v: MeshOut) -> @location(0) vec4f {
  let kind = u32(v.info.x + 0.5);
  let bare = forest.kinds[kind].w;
  if (v.info.w > 0.5 && bare > 0.01 && cell(v.p * 2.2) < bare * 0.7) {
    discard;
  }
  let spot = smoothstep(0.35, 0.65, cell(v.p * 1.6 + 3.1));
  return vec4f(shade(v.c, normalize(v.n), v.info.w, v.h, spot, kind, v.info.y, v.info.z), 1.0);
}

struct ImpOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) f: vec3f, // toward the eye (east/north/up)
  @location(2) r: vec3f, // the quad's right
  @location(3) up: vec3f, // the quad's up
  @location(4) @interpolate(flat) info: vec4f, // x kind, y hash, z shade, w mirrored (-1/1)
};

@vertex
fn impostorVs(@builtin(vertex_index) vi: u32, inst: Inst) -> ImpOut {
  let q = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  let kind = u32(inst.b.w + 0.5);
  let s = inst.a.w;
  let hash = inst.b.y;
  let U = forest.u.xyz;
  let F = normalize(-(inst.a.xyz + U * (0.5 * s)));
  var R = cross(U, F);
  R = select(forest.e.xyz, normalize(R), length(R) > 1e-4);
  let V = cross(F, R);
  let view = clamp(floor(degrees(asin(clamp(dot(F, U), 0.0, 1.0))) / STEP + fract(hash * 5.37)), 0.0, VIEWS - 1.0);
  let flip = select(1.0, -1.0, fract(hash * 3.1) < 0.5);
  let radius = forest.colA[kind].w;
  var p = ((R * q.x + V * q.y) * radius + U * 0.5) * s;
  let h = clamp(0.5 + q.y * radius, 0.0, 1.0);
  let sway = forest.wind.xy * forest.params.z * forest.kinds[kind].y * gust(hash) * h * h * s * 0.03;
  p += forest.e.xyz * sway.x + forest.n.xyz * sway.y;
  var o: ImpOut;
  o.pos = frame.viewProj * vec4f(inst.a.xyz + p, 1.0);
  o.uv = vec2f((view + 0.5 + 0.5 * q.x * flip) / VIEWS, 0.5 - 0.5 * q.y);
  o.f = toLocal(F);
  o.r = toLocal(R);
  o.up = toLocal(V);
  o.info = vec4f(inst.b.w, hash, inst.b.z, flip);
  return o;
}

@fragment
fn impostorFs(v: ImpOut) -> @location(0) vec4f {
  let kind = u32(v.info.x + 0.5);
  let a = textureSample(atlasColor, atlasSampler, v.uv, kind);
  let t = textureSample(atlasData, atlasSampler, v.uv, kind);
  let edge = max(fwidth(a.a), 1e-4);
  let crown = step(0.5, t.a);
  let cover = clamp((a.a - 0.5) / edge + 0.5, 0.0, 1.0) * (1.0 - crown * forest.kinds[kind].w * 0.7);
  if (cover < 0.01) {
    discard;
  }
  let nv = (t.xy * 2.0 - 1.0) * vec2f(v.info.w, 1.0);
  let n = normalize(v.r * nv.x + v.up * nv.y + v.f * sqrt(max(0.0, 1.0 - dot(nv, nv))));
  return vec4f(shade(a.rgb, n, crown, t.z, 0.5, kind, v.info.y, v.info.z), cover);
}
