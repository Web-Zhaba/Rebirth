// GPU tree scatter (scene/forest.ts): one thread per candidate of the tiles chosen this frame
// (scene/forestTiles.ts). A candidate is a jittered cell of a web-mercator tile's grid; it grows when the cover page's
// class under it carries its kind (world/forestMix.ts), the game mask does not block it (clearings, lots, roads, zones,
// fields; ruins add bushes and stones), the distance keeps it, it lies inside the view and inside its kind's reach. The
// survivors are appended, camera-relative, to their (kind, level of detail) slot; `finalize` turns the counts into the
// instance counts of the indirect draws. A candidate in view is also tested against the Hi-Z of this frame's occluders
// (frame/hiz.ts: terrain and buildings, drawn before this pass): behind a ridge or a house, it is not drawn. How many
// the frustum and the occlusion took is counted per workgroup, then once into `counts` 12 and 13, for the stats.

struct Job {
  corner: vec3f, // the tile's north-west corner at height 0, relative to the eye (ECEF m)
  start: u32,    // first candidate index of the job
  east: vec3f,   // across the tile, u 0 -> 1
  cols: u32,     // candidates per row at this stride
  south: vec3f,  // down the tile, v 0 -> 1
  grid: u32,     // candidates per side at full density
  stride: u32,
  group: u32,    // 0 trees, 1 bush, 2 reed, 3 boulder
  seed: u32,
  hLayer: u32,   // height page layer (NO_PAGE: none)
  cLayer: u32,   // cover page layer
  p0: u32,
  p1: u32,
  p2: u32,
  hPage: vec4f,  // tile uv -> height page uv: xy offset, z scale
  cPage: vec4f,  // tile uv -> cover page uv
  mask: vec4f,   // tile uv -> game mask uv: xy offset, zw scale (0: the mask does not reach the tile)
  misc: vec4f,   // x conifer share, y birch share, z the stride's base keep
};

struct Scatter {
  planes: array<vec4f, 5>, // view frustum (sides and near), eye-relative: inside when dot(n, p) + w >= -radius
  up: vec4f,               // w candidates in all
  dims: vec4u,             // x jobs, y threads per dispatch row
  far: vec4f,              // reach per group (m)
  reach: vec4f,            // x full-density reach of trees, y of details, z grow 0..1, w terrain exaggeration
  near: vec4f,             // x trees drawn as models within, y details within, z sink below the ground (m)
  slots: array<vec4u, 12>, // per (kind, lod): x first instance, y capacity
  cover: array<vec4f, 17>, // per cover id: tree (0/1), bush, reed, boulder shares
  ruin: vec4f,             // shares the ruins add: y bush, z reed, w boulder
  sizes: array<vec4f, 4>,  // trees: base size of conifer, broadleaf, birch; details: x lo, y hi, z max share
  viewProj: mat4x4f,       // the frame's, eye-relative
  occl: vec4f,             // x near plane (m), y tan half fov x, z tan half fov y, w Hi-Z levels (0: no occlusion test)
  hizSize: vec4f,          // xy Hi-Z level 0 size (texels)
};

@group(0) @binding(0) var<uniform> sc: Scatter;
@group(0) @binding(1) var<storage, read> jobs: array<Job>;
@group(0) @binding(2) var<storage, read_write> instances: array<vec4f>; // 2 per instance
@group(0) @binding(3) var<storage, read_write> counts: array<atomic<u32>, 16>; // 12 slots, frustum, occluded
@group(0) @binding(4) var<storage, read_write> args: array<u32>; // 5 per slot (drawIndexedIndirect / drawIndirect)
@group(0) @binding(5) var heights: texture_2d_array<f32>;
@group(0) @binding(6) var cover: texture_2d_array<u32>;
@group(0) @binding(7) var gameMask: texture_2d<f32>;
@group(0) @binding(8) var hiz: texture_2d<f32>;

const NO_PAGE = 0xffffffffu;
const DEM = 256.0;
const TAU = 6.2831853;
const MIN_KEEP = 1.0 / 16.0;
const REJECTED = 0u;
const FRUSTUM = 1u;
const OCCLUDED = 2u;
const DRAWN = 3u;

var<workgroup> wgFrustum: atomic<u32>;
var<workgroup> wgOccluded: atomic<u32>;

fn mixu(x: u32) -> u32 {
  var h = x;
  h ^= h >> 16u;
  h *= 0x7feb352du;
  h ^= h >> 15u;
  h *= 0x846ca68bu;
  h ^= h >> 16u;
  return h;
}

// 0..1 from the tile seed, the cell and a salt.
fn rnd(seed: u32, i: u32, j: u32, salt: u32) -> f32 {
  return f32(mixu(seed ^ mixu(i ^ mixu(j ^ mixu(salt)))) >> 8u) / 16777216.0;
}

// Bilinear height from a bordered page (terrain.wgsl pageHeight).
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

// Screen bounds (ndc) of a sphere along one axis: `a` its centre's view-space offset on that axis, `w` its depth, `t`
// the tangent of the half field of view there. Exact: the planes through the eye and that axis' perpendicular that
// touch the sphere (the plain r / w under-reaches on the outer side off-axis).
fn sphereSpan(a: f32, w: f32, r: f32, t: f32) -> vec2f {
  let s = r * sqrt(max(a * a + w * w - r * r, 0.0));
  let d = (w * w - r * r) * t;
  return vec2f((a * w - s) / d, (a * w + s) / d);
}

fn visible(c: vec3f, r: f32) -> bool {
  for (var k = 0; k < 5; k++) {
    if (dot(sc.planes[k].xyz, c) + sc.planes[k].w < -r) {
      return false;
    }
  }
  return true;
}

// Hidden behind this frame's occluders: the sphere's nearest depth is farther than the farthest depth the Hi-Z holds
// over the square it covers on screen (reversed Z, so farther is smaller).
fn occluded(c: vec3f, r: f32) -> bool {
  let levels = u32(sc.occl.w);
  if (levels == 0u) {
    return false;
  }
  let clip = sc.viewProj * vec4f(c, 1.0);
  let w = clip.w;
  if (w - r <= sc.occl.x) {
    return false; // reaches the near plane
  }
  // clip.xy is the view-space offset over the tangent of the half fov (projection.ts)
  let sx = sphereSpan(clip.x * sc.occl.y, w, r, sc.occl.y);
  let sy = sphereSpan(clip.y * sc.occl.z, w, r, sc.occl.z);
  let size0 = sc.hizSize.xy;
  let lo = vec2f(sx.x, -sy.y) * 0.5 + 0.5; // uv, y down
  let hi = vec2f(sx.y, -sy.x) * 0.5 + 0.5;
  let p0 = vec2u(clamp(floor(lo * size0), vec2f(0.0), size0 - 1.0));
  let p1 = vec2u(clamp(floor(hi * size0), vec2f(0.0), size0 - 1.0));
  let span = max(p1.x - p0.x, p1.y - p0.y);
  let level = min(select(firstLeadingBit(span - 1u) + 1u, 0u, span <= 1u), levels - 1u); // ceil(log2(span)): 2 x 2 texels there
  let last = textureDimensions(hiz, level) - 1u;
  let a = min(p0 >> vec2u(level), last);
  let b = min(p1 >> vec2u(level), last);
  let far = min(min(textureLoad(hiz, a, level).r, textureLoad(hiz, vec2u(b.x, a.y), level).r), min(textureLoad(hiz, vec2u(a.x, b.y), level).r, textureLoad(hiz, b, level).r));
  return sc.occl.x / (w - r) < far;
}

@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let status = candidate(gid.y * sc.dims.y + gid.x);
  if (status == FRUSTUM) {
    atomicAdd(&wgFrustum, 1u);
  } else if (status == OCCLUDED) {
    atomicAdd(&wgOccluded, 1u);
  }
  workgroupBarrier();
  if (lid == 0u) {
    let f = atomicLoad(&wgFrustum);
    let o = atomicLoad(&wgOccluded);
    if (f > 0u) {
      atomicAdd(&counts[12], f);
    }
    if (o > 0u) {
      atomicAdd(&counts[13], o);
    }
  }
}

fn candidate(idx: u32) -> u32 {
  if (f32(idx) >= sc.up.w) {
    return REJECTED;
  }
  // the job holding this candidate: the last one starting at or before it
  var lo = 0u;
  var hi = sc.dims.x;
  while (hi - lo > 1u) {
    let mid = (lo + hi) / 2u;
    if (jobs[mid].start <= idx) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  let job = jobs[lo];
  let k = idx - job.start;
  let ci = (k % job.cols) * job.stride;
  let cj = (k / job.cols) * job.stride;
  if (ci >= job.grid || cj >= job.grid) {
    return REJECTED;
  }
  let g = job.group;
  let s = g * 16u;
  let seed = job.seed;
  // details: most cells hold nothing, rejected before any texture is read
  let h0 = rnd(seed, ci, cj, s + 2u);
  if (g > 0u && h0 >= sc.sizes[g].z) {
    return REJECTED;
  }
  let uv = (vec2f(f32(ci), f32(cj)) + vec2f(rnd(seed, ci, cj, s), rnd(seed, ci, cj, s + 1u))) / f32(job.grid);

  let cuv = job.cPage.xy + uv * job.cPage.z;
  let id = min(textureLoad(cover, vec2i(min(floor(cuv * 256.0), vec2f(255.0))), i32(job.cLayer), 0).r, 16u);
  var block = 0.0;
  var ruin = 0.0;
  if (job.mask.z > 0.0) {
    let muv = job.mask.xy + uv * job.mask.zw;
    if (all(muv >= vec2f(0.0)) && all(muv < vec2f(1.0))) {
      let m = textureLoad(gameMask, vec2i(muv * vec2f(textureDimensions(gameMask))), 0);
      block = m.r;
      ruin = m.g;
    }
  }
  var h = 0.0;
  if (g == 0u) {
    if (sc.cover[id].x < 0.5) {
      return REJECTED;
    }
    h = rnd(seed, ci, cj, 3u);
    if (h < block) {
      return REJECTED;
    }
  } else {
    let share = sc.cover[id][g] + ruin * sc.ruin[g];
    if (h0 >= share || h0 < block) {
      return REJECTED;
    }
    h = rnd(seed, ci, cj, s + 5u);
  }

  var ground = 0.0;
  if (job.hLayer != NO_PAGE) {
    ground = max(pageHeight(job.hLayer, job.hPage.xy + uv * job.hPage.z), 0.0) * sc.reach.w;
  }
  // the tile's own up (east x south points down): the target's leans by the distance to it, metres at mountain heights
  let up = normalize(cross(job.south, job.east));
  let p = job.corner + job.east * uv.x + job.south * uv.y + up * (ground - sc.near.z);
  let d = length(p);
  let far = sc.far[g];
  if (d > far) {
    return REJECTED;
  }
  // thinning with distance beyond the full-density reach, against the share the stride already took
  let reach = select(sc.reach.y, sc.reach.x, g == 0u);
  let keep = clamp(reach / d, MIN_KEEP, 1.0);
  if (rnd(seed, ci, cj, s + 7u) >= keep / job.misc.z) {
    return REJECTED;
  }
  let fade = 1.0 - smoothstep(far * 0.85, far, d);
  var kind = 3u + g - 1u;
  var size = 0.0;
  if (g == 0u) {
    let r = rnd(seed, ci, cj, 4u);
    kind = select(select(1u, 2u, r < job.misc.x + job.misc.y * (1.0 - job.misc.x)), 0u, r < job.misc.x);
    // the survivors of a thinned forest grow a little, so it does not look sparse from afar
    size = sc.sizes[0][kind] * (0.6 + 0.6 * rnd(seed, ci, cj, 5u)) * min(2.0, pow(keep, -0.3));
  } else {
    let t = rnd(seed, ci, cj, s + 3u);
    size = mix(sc.sizes[g].x, sc.sizes[g].y, t * t);
  }
  size *= sc.reach.z * fade;
  if (size < 0.05) {
    return REJECTED;
  }
  let centre = p + up * (0.5 * size);
  if (!visible(centre, 0.75 * size)) {
    return FRUSTUM;
  }
  if (occluded(centre, 0.75 * size)) {
    return OCCLUDED;
  }
  let lod = select(1u, 0u, d < select(sc.near.y, sc.near.x, g == 0u));
  let slot = kind * 2u + lod;
  let n = atomicAdd(&counts[slot], 1u);
  if (n >= sc.slots[slot].y) {
    return DRAWN; // over the slot's capacity: counted, not stored
  }
  let at = (sc.slots[slot].x + n) * 2u;
  instances[at] = vec4f(p, size);
  instances[at + 1u] = vec4f(rnd(seed, ci, cj, s + 6u) * TAU, h, 0.85 + 0.3 * fract(h * 13.7), f32(kind));
  return DRAWN;
}

// The appended counts, clamped to each slot's capacity, as the instance counts of the indirect draws.
@compute @workgroup_size(16)
fn finalize(@builtin(local_invocation_index) i: u32) {
  if (i < 12u) {
    args[i * 5u + 1u] = min(atomicLoad(&counts[i]), sc.slots[i].y);
  }
}
