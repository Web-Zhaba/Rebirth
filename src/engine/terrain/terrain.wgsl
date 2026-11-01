#include "frame"
#include "atmosphere"
#include "weather"

// Globe terrain: one instanced draw, an instance per selected quadtree node. Node i's chunk-table entry carries its
// origin relative to the eye (f64 subtraction on the CPU, stored f32), its vertex slot, its height page and the page
// its parent would draw with (the geomorph target, terrain/morph.ts).

struct Node {
  rel: vec4f,   // xyz node origin - eye (m), w skirt depth (m)
  uv: vec4f,    // own page: xy uv of the node's corner, z uv scale, w page texel size at the equator (m)
  puv: vec4f,   // the parent's page, same layout
  morph: vec4f, // x base height hb of the vertices (m, as drawn), y cell at the equator x K (0 = never morph), z lo, w hi
  pole: vec3f,  // cap apex (the pole at the cap height) relative to the origin: z > 0 north cap on the top edge,
                // z < 0 south cap on the bottom edge, 0 no cap (z0, never drawn as a leaf, gets the north one only)
  apexH: f32,   // the cap height (m, as drawn)
  info: vec4u,  // x page layer (NO_PAGE = none), y vertex slot, z node zoom, w parent page layer
  drape: vec4f, // drape page (bake/drape.ts): xy uv of the node's corner, z uv scale, w the layer's bits (NO_PAGE = none)
  ov: array<vec4f, 3>, // overlay levels near to far (overlay/overlayRaster.ts): xy the node's corner in level uv, z its
                        // size, w 1 = drawn
};

@group(1) @binding(0) var<storage, read> nodes: array<Node>;
@group(1) @binding(1) var<storage, read> verts: array<vec4f>; // per slot: GRID_VERTS x (position, up)
@group(1) @binding(2) var heights: texture_2d_array<f32>;
@group(1) @binding(3) var drapes: texture_2d_array<f32>;
@group(1) @binding(4) var drapeSampler: sampler;
@group(1) @binding(5) var overlays: texture_2d_array<f32>;

const GRID: u32 = ${GRID}u;
const GRID_VERTS: u32 = GRID * GRID;
const NO_PAGE: u32 = 0xffffffffu;
const DEM: f32 = 256.0;
const NIGHT_AMBIENT = vec3f(0.035, 0.045, 0.08);
// The atlas palette is made for a flat, unlit map: scaled so a mid-morning sun, sky light and the tone map give back
// about the palette colour on flat ground.
const DRAPE_GAIN = 0.6;
// Aerial perspective on the ground is thinned against the sky's: the game wants the town and the next hills crisp and
// in the atlas colours, with haze only building up over tens of kilometres.
const GROUND_AIR = 0.12;
// The game's drawings keep their palette colours like on the old flat map (they are a map, not paint on the ground);
// at night they dim only this far, so a tool preview stays readable.
const OVERLAY_NIGHT = 0.45;
// Snow and ice are brighter than the atlas: they must read white under the same light.
const SNOW_GAIN = 0.8;

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

// Drawn height: exaggerated, sea surface at 0 until water gets its own mesh (N3).
fn drawnHeight(layer: u32, uv: vec2f) -> f32 {
  if (layer == NO_PAGE) {
    return 0.0;
  }
  return max(pageHeight(layer, uv), 0.0) * frame.params.x;
}

fn gridUv(r: vec4f, ij: vec2u) -> vec2f {
  return r.xy + vec2f(ij) * (r.z / f32(GRID - 1u));
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

// Grid vertex ij on the parent's surface, node-local (relative to the origin at base height hb).
fn parentPoint(node: Node, ij: vec2u) -> vec3f {
  let base = (node.info.y * GRID_VERTS + ij.y * GRID + ij.x) * 2u;
  return verts[base].xyz + verts[base + 1u].xyz * (drawnHeight(node.info.w, gridUv(node.puv, ij)) - node.morph.x);
}

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) rel: vec3f,
  @location(1) uv: vec2f,
  @location(2) up: vec3f,
  @location(3) @interpolate(flat) layer: u32,
  @location(4) @interpolate(flat) texM: f32,
  @location(5) @interpolate(flat) zoom: u32,
  @location(6) puv: vec2f,
  @location(7) @interpolate(flat) player: u32,
  @location(8) @interpolate(flat) ptexM: f32,
  @location(9) morph: f32,
  @location(10) cap: f32, // 0 on the edge row, 1 at the pole
  @location(11) capH: f32, // drawn height of the vertex, for the cap's albedo
  @location(12) duv: vec2f,
  @location(13) @interpolate(flat) dlayer: u32,
  @location(14) nl: vec2f, // across the node 0..1: overlay level uv is affine in it, like mercator
  @location(15) @interpolate(flat) node: u32,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  let node = nodes[ii];
  var g = vi;
  var skirt = 0.0;
  var cap = 0u;
  if (vi >= GRID_VERTS) {
    let k = vi - GRID_VERTS;
    g = skirtSource(k);
    skirt = 1.0;
    let e = k / GRID;
    if ((e == 0u && node.pole.z > 0.0) || (e == 2u && node.pole.z < 0.0)) {
      cap = 1u;
    }
  }
  let ij = vec2u(g % GRID, g / GRID);
  let base = (node.info.y * GRID_VERTS + g) * 2u;
  let local = verts[base].xyz;
  let up = verts[base + 1u].xyz;
  let uv = gridUv(node.uv, ij);
  let dh = drawnHeight(node.info.x, uv) - node.morph.x;

  // Same order as frame/chunkTable.ts shaderRelative: (origin - eye) + local, then the height along the normal.
  var rel = node.rel.xyz + local + up * (dh - skirt * node.rel.w);

  // Geomorph towards the parent grid by this vertex's own screen-space error (terrain/morph.ts).
  var m = 0.0;
  if (node.morph.y > 0.0) {
    let err = node.morph.y * length(up.xy) / max(length(rel), 1e-3);
    m = clamp((node.morph.w - err) / (node.morph.w - node.morph.z), 0.0, 1.0);
  }
  if (m > 0.0) {
    let odd = ij & vec2u(1u);
    var a = ij;
    var b = ij;
    if (odd.x == 1u && odd.y == 0u) {
      a = ij - vec2u(1u, 0u);
      b = ij + vec2u(1u, 0u);
    } else if (odd.x == 0u && odd.y == 1u) {
      a = ij - vec2u(0u, 1u);
      b = ij + vec2u(0u, 1u);
    } else if (odd.x == 1u && odd.y == 1u) {
      a = vec2u(ij.x + 1u, ij.y - 1u);
      b = vec2u(ij.x - 1u, ij.y + 1u);
    }
    let goal = 0.5 * (parentPoint(node, a) + parentPoint(node, b));
    rel += m * (goal - (local + up * dh));
  }

  // Polar cap: the north (south) skirt becomes a fan from the edge row to one apex shared by every cap node, so the
  // fans of neighbours close on each other.
  var drawnH = dh + node.morph.x;
  if (cap != 0u) {
    rel = node.rel.xyz + node.pole;
    drawnH = node.apexH;
  }

  var o: VsOut;
  o.pos = frame.viewProj * vec4f(rel, 1.0);
  o.rel = rel;
  o.uv = uv;
  o.up = up;
  o.layer = node.info.x;
  o.texM = node.uv.w;
  o.zoom = node.info.z;
  o.puv = gridUv(node.puv, ij);
  o.player = node.info.w;
  o.ptexM = node.puv.w;
  o.morph = m;
  o.duv = gridUv(node.drape, ij);
  o.dlayer = bitcast<u32>(node.drape.w);
  o.nl = vec2f(ij) / f32(GRID - 1u);
  o.node = ii;
  o.cap = 0.0;
  o.capH = drawnH;
  if (cap != 0u) {
    // The fan repeats the edge row's page uv towards the pole: shade it flat, height from the geometry.
    o.up = vec3f(0.0, 0.0, sign(node.pole.z));
    o.cap = 1.0;
  }
  return o;
}

fn lodTint(z: u32) -> vec3f {
  let k = f32(z % 6u) / 6.0;
  return 0.5 + 0.5 * cos(6.2831 * (k + vec3f(0.0, 0.33, 0.67)));
}

// Raw height (m) and its east/north gradient from a page at uv.
fn surface(layer: u32, uv: vec2f, texM: f32, cosLat: f32) -> vec3f {
  let h = pageHeight(layer, uv);
  let d = 1.0 / DEM;
  let hw = max(pageHeight(layer, uv - vec2f(d, 0.0)), 0.0);
  let he = max(pageHeight(layer, uv + vec2f(d, 0.0)), 0.0);
  let hn = max(pageHeight(layer, uv - vec2f(0.0, d)), 0.0);
  let hs = max(pageHeight(layer, uv + vec2f(0.0, d)), 0.0);
  let span = 2.0 * texM * cosLat;
  return vec3f(h, (he - hw) / span, (hn - hs) / span); // page v grows south
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4f {
  let foot = length(fwidth(v.rel)); // ground width of the pixel (m); derivatives need uniform control flow
  let up = normalize(v.up);
  var n = up;
  var h = 0.0;
  var slope = 0.0;
  if (v.layer != NO_PAGE) {
    let cosLat = max(length(up.xy), 0.01);
    var s = surface(v.layer, v.uv, v.texM, cosLat);
    // Morphing nodes shade towards the parent's page too, so a merge does not pop the lighting either.
    if (v.morph > 0.0 && v.player != v.layer && v.player != NO_PAGE) {
      s = mix(s, surface(v.player, v.puv, v.ptexM, cosLat), v.morph);
    }
    let capK = smoothstep(0.0, 0.05, v.cap);
    s = vec3f(mix(s.x, v.capH / frame.params.x, capK), s.yz * (1.0 - capK));
    h = s.x;
    slope = degrees(atan(length(s.yz)));
    let east = normalize(vec3f(-up.y, up.x, 0.0));
    let north = cross(up, east);
    let ex = frame.params.x;
    n = normalize(up - east * s.y * ex - north * s.z * ex);
  }

  // Albedo by height and slope (real metres, not exaggerated): lowland green, dry uplands, rock, snow, sea.
  var albedo = vec3f(0.16, 0.27, 0.10);
  albedo = mix(albedo, vec3f(0.30, 0.29, 0.19), smoothstep(600.0, 1800.0, h));
  albedo = mix(albedo, vec3f(0.33, 0.31, 0.29), smoothstep(28.0, 42.0, slope));
  albedo = mix(albedo, vec3f(0.85, 0.88, 0.92), smoothstep(2300.0, 2700.0, h) * (1.0 - smoothstep(45.0, 60.0, slope)));
  var water = 0.0;
  if (v.dlayer != NO_PAGE) {
    let d = textureSampleLevel(drapes, drapeSampler, v.duv, i32(v.dlayer), 0.0);
    albedo = d.rgb * DRAPE_GAIN;
    water = d.a;
  } else if (v.layer != NO_PAGE && h <= 0.0) {
    water = 1.0;
    albedo = vec3f(0.015, 0.05, 0.11);
  }
  n = normalize(mix(n, up, water)); // water lies flat whatever the DEM says under it

  // The town's weather on its ground (sky/weather.wgsl): wet earth darkens, snow lies on what is flat enough, ice
  // closes the water.
  let tg = townGround(v.rel);
  if (tg > 0.0) {
    albedo *= 1.0 - 0.3 * weather.ground.y * tg * (1.0 - water);
    let snow = snowShare(townXY(v.rel), smoothstep(0.5, 0.8, dot(n, up)), weather.ground.x * tg, foot) * (1.0 - water);
    albedo = mix(albedo, srgbToLinear(weather.snowCol.rgb) * SNOW_GAIN, snow);
    let ice = 0.8 * smoothstep(0.15, 0.8, weather.ground.z) * tg * water;
    albedo = mix(albedo, srgbToLinear(weather.iceCol.rgb) * SNOW_GAIN, ice);
    water *= 1.0 - ice;
    n = normalize(mix(n, up, ice));
  }

  // The game's drawings (premultiplied, linear): the finest overlay level that covers the point.
  var ov = vec4f(0.0);
  for (var l = 0; l < 3; l++) {
    let lv = nodes[v.node].ov[l];
    let ouv = lv.xy + v.nl * lv.z;
    if (lv.w > 0.0 && all(ouv >= vec2f(0.0)) && all(ouv <= vec2f(1.0))) {
      ov = textureSampleLevel(overlays, drapeSampler, ouv, l, 0.0);
      break;
    }
  }
  water *= 1.0 - ov.a;
  if (frame.params.y > 0.5) {
    // Blends towards the parent level's tint as the vertex morphs: smooth colours mean no pops.
    let tint = mix(lodTint(v.zoom), lodTint(v.zoom + 5u), clamp(v.morph, 0.0, 1.0));
    albedo = mix(albedo, tint * 0.5, 0.6);
  }

  let light = sunLightAt(up);
  let sun = frame.sun.w * max(dot(n, frame.sun.xyz), 0.0);
  let sky = 0.35 * (0.6 + 0.4 * dot(n, up)) * vec3f(0.55, 0.65, 0.85);
  var c = albedo * (vec3f(sun) + sky) * light;
  c += albedo * NIGHT_AMBIENT * (1.0 - light); // moon and starlight: the night side stays readable, not black
  if (water > 0.0) {
    // Sun glint and a sky sheen growing towards grazing angles (Schlick), only on water.
    let view = -normalize(v.rel);
    let hv = normalize(view + frame.sun.xyz);
    let glint = pow(max(dot(n, hv), 0.0), 180.0) * frame.sun.w * 6.0;
    let fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, view), 0.0), 5.0);
    c += water * (vec3f(glint) * light + fres * vec3f(0.35, 0.45, 0.6) * light);
  }

  let alt = max(h, 0.0) * frame.params.x;
  c = applyAir(c, GROUND_AIR * opticalDepth(length(v.rel), frame.eye.w, alt), light);
  var out = toneMap(c) * cloudDim(cloudShade(v.rel, up, foot));
  if (ov.a > 0.0) {
    let paint = pow(ov.rgb / ov.a, vec3f(1.0 / 2.2)) * mix(OVERLAY_NIGHT, 1.0, light);
    out = mix(out, paint, ov.a);
  }
  return vec4f(out, 1.0);
}
