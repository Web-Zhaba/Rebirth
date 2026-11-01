#include "frame"
#include "atmosphere"

// Globe terrain: one instanced draw, an instance per selected quadtree node. Node i's chunk-table entry carries its
// origin relative to the eye (f64 subtraction on the CPU, stored f32), its vertex slot and its height page.

struct Node {
  rel: vec4f,   // xyz node origin - eye (m), w skirt depth (m)
  uv: vec4f,    // xy page uv of the node's corner, z uv scale, w page texel size at the equator (m)
  info: vec4u,  // x page layer (NO_PAGE = none), y vertex slot, z node zoom, w unused
};

@group(1) @binding(0) var<storage, read> nodes: array<Node>;
@group(1) @binding(1) var<storage, read> verts: array<vec4f>; // per slot: GRID_VERTS x (position, up)
@group(1) @binding(2) var heights: texture_2d_array<f32>;

const GRID: u32 = ${GRID}u;
const GRID_VERTS: u32 = GRID * GRID;
const NO_PAGE: u32 = 0xffffffffu;
const DEM: f32 = 256.0;

// Bilinear height from a bordered page, centre convention: line-by-line copy of bake/terrarium.ts samplePage.
fn pageHeight(layer: u32, uv: vec2f) -> f32 {
  let p = uv * DEM + 0.5;
  let i0 = clamp(vec2i(floor(p)), vec2i(0), vec2i(256));
  let f = clamp(p - vec2f(i0), vec2f(0.0), vec2f(1.0));
  let l = i32(layer);
  let a = textureLoad(heights, i0, l, 0).r;
  let b = textureLoad(heights, i0 + vec2i(1, 0), l, 0).r;
  let c = textureLoad(heights, i0 + vec2i(0, 1), l, 0).r;
  let d = textureLoad(heights, i0 + vec2i(1, 1), l, 0).r;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

fn skirtSource(k: u32) -> u32 {
  let e = k / GRID;
  let t = k % GRID;
  switch e {
    case 0u: { return t; }
    case 1u: { return t * GRID + GRID - 1u; }
    case 2u: { return (GRID - 1u) * GRID + t; }
    default: { return t * GRID; }
  }
}

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) uv: vec2f,
  @location(2) up: vec3f,
  @location(3) @interpolate(flat) layer: u32,
  @location(4) @interpolate(flat) texM: f32,
  @location(5) @interpolate(flat) zoom: u32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  let node = nodes[ii];
  var g = vi;
  var skirt = 0.0;
  if (vi >= GRID_VERTS) {
    g = skirtSource(vi - GRID_VERTS);
    skirt = 1.0;
  }
  let i = g % GRID;
  let j = g / GRID;
  let base = (node.info.y * GRID_VERTS + g) * 2u;
  let local = verts[base].xyz;
  let up = verts[base + 1u].xyz;
  let uv = node.uv.xy + vec2f(f32(i), f32(j)) * (node.uv.z / f32(GRID - 1u));
  var h = 0.0;
  if (node.info.x != NO_PAGE) {
    h = max(pageHeight(node.info.x, uv), 0.0) * frame.params.x; // sea surface until water gets its own mesh (N3)
  }
  // Same order as frame/chunkTable.ts shaderRelative: (origin - eye) + local, then the height along the normal.
  let rel = node.rel.xyz + local + up * (h - skirt * node.rel.w);
  var o: VsOut;
  o.pos = frame.viewProj * vec4f(rel, 1.0);
  o.rel = rel;
  o.uv = uv;
  o.up = up;
  o.layer = node.info.x;
  o.texM = node.uv.w;
  o.zoom = node.info.z;
  return o;
}

fn lodTint(z: u32) -> vec3f {
  let k = f32(z % 6u) / 6.0;
  return 0.5 + 0.5 * cos(6.2831 * (k + vec3f(0.0, 0.33, 0.67)));
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4f {
  let up = normalize(v.up);
  var n = up;
  var h = 0.0;
  var slope = 0.0;
  if (v.layer != NO_PAGE) {
    h = pageHeight(v.layer, v.uv);
    let d = 1.0 / DEM;
    let hw = max(pageHeight(v.layer, v.uv - vec2f(d, 0.0)), 0.0);
    let he = max(pageHeight(v.layer, v.uv + vec2f(d, 0.0)), 0.0);
    let hn = max(pageHeight(v.layer, v.uv - vec2f(0.0, d)), 0.0);
    let hs = max(pageHeight(v.layer, v.uv + vec2f(0.0, d)), 0.0);
    let cosLat = max(length(up.xy), 0.01);
    let span = 2.0 * v.texM * cosLat;
    let gx = (he - hw) / span; // dh/d(east)
    let gy = (hn - hs) / span; // dh/d(north): page v grows south
    slope = degrees(atan(length(vec2f(gx, gy))));
    let east = normalize(vec3f(-up.y, up.x, 0.0));
    let north = cross(up, east);
    let ex = frame.params.x;
    n = normalize(up - east * gx * ex - north * gy * ex);
  }

  // Albedo by height and slope (real metres, not exaggerated): lowland green, dry uplands, rock, snow, sea.
  var albedo = vec3f(0.16, 0.27, 0.10);
  albedo = mix(albedo, vec3f(0.30, 0.29, 0.19), smoothstep(600.0, 1800.0, h));
  albedo = mix(albedo, vec3f(0.33, 0.31, 0.29), smoothstep(28.0, 42.0, slope));
  albedo = mix(albedo, vec3f(0.85, 0.88, 0.92), smoothstep(2300.0, 2700.0, h) * (1.0 - smoothstep(45.0, 60.0, slope)));
  if (v.layer != NO_PAGE && h <= 0.0) {
    albedo = vec3f(0.015, 0.05, 0.11);
    n = up;
  }
  if (frame.params.y > 0.5) {
    albedo = mix(albedo, lodTint(v.zoom) * 0.5, 0.6);
  }

  let light = sunLightAt(up);
  let sun = frame.sun.w * max(dot(n, frame.sun.xyz), 0.0);
  let sky = 0.35 * (0.6 + 0.4 * dot(n, up)) * vec3f(0.55, 0.65, 0.85);
  var c = albedo * (vec3f(sun) + sky) * light;

  let alt = max(h, 0.0) * frame.params.x;
  c = applyAir(c, opticalDepth(length(v.rel), frame.eye.w, alt), light);
  return vec4f(toneMap(c), 1.0);
}
