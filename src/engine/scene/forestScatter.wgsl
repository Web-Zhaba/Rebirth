// GPU tree scatter (scene/forest.ts, docs/PLAN-engine.md N5): one thread per candidate of the tiles chosen this frame
// (scene/forestTiles.ts). A candidate is a jittered cell of a web-mercator tile's grid; it grows when the cover page's
// class under it carries its kind (world/forestMix.ts), the game mask does not block it (clearings, lots, roads, zones,
// fields; ruins add bushes and stones), the distance keeps it, it lies inside the view and inside its kind's reach. The
// survivors are appended, camera-relative, to their (kind, level of detail) slot; `finalize` turns the counts into the
// instance counts of the indirect draws.

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
  up: vec4f,               // xyz unit up at the target, w candidates in all
  dims: vec4u,             // x jobs, y threads per dispatch row
  far: vec4f,              // reach per group (m)
  reach: vec4f,            // x full-density reach of trees, y of details, z grow 0..1, w terrain exaggeration
  near: vec4f,             // x trees drawn as models within, y details within, z sink below the ground (m)
  slots: array<vec4u, 12>, // per (kind, lod): x first instance, y capacity
  cover: array<vec4f, 17>, // per cover id: tree (0/1), bush, reed, boulder shares
  ruin: vec4f,             // shares the ruins add: y bush, z reed, w boulder
  sizes: array<vec4f, 4>,  // trees: base size of conifer, broadleaf, birch; details: x lo, y hi, z max share
};

@group(0) @binding(0) var<uniform> sc: Scatter;
@group(0) @binding(1) var<storage, read> jobs: array<Job>;
@group(0) @binding(2) var<storage, read_write> instances: array<vec4f>; // 2 per instance
@group(0) @binding(3) var<storage, read_write> counts: array<atomic<u32>, 12>;
@group(0) @binding(4) var<storage, read_write> args: array<u32>; // 5 per slot (drawIndexedIndirect / drawIndirect)
@group(0) @binding(5) var heights: texture_2d_array<f32>;
@group(0) @binding(6) var cover: texture_2d_array<u32>;
@group(0) @binding(7) var gameMask: texture_2d<f32>;

const NO_PAGE = 0xffffffffu;
const DEM = 256.0;
const TAU = 6.2831853;
const MIN_KEEP = 1.0 / 16.0;

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

fn visible(c: vec3f, r: f32) -> bool {
  for (var k = 0; k < 5; k++) {
    if (dot(sc.planes[k].xyz, c) + sc.planes[k].w < -r) {
      return false;
    }
  }
  return true;
}

@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.y * sc.dims.y + gid.x;
  if (f32(idx) >= sc.up.w) {
    return;
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
    return;
  }
  let g = job.group;
  let s = g * 16u;
  let seed = job.seed;
  // details: most cells hold nothing, rejected before any texture is read
  let h0 = rnd(seed, ci, cj, s + 2u);
  if (g > 0u && h0 >= sc.sizes[g].z) {
    return;
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
      return;
    }
    h = rnd(seed, ci, cj, 3u);
    if (h < block) {
      return;
    }
  } else {
    let share = sc.cover[id][g] + ruin * sc.ruin[g];
    if (h0 >= share || h0 < block) {
      return;
    }
    h = rnd(seed, ci, cj, s + 5u);
  }

  var ground = 0.0;
  if (job.hLayer != NO_PAGE) {
    ground = max(pageHeight(job.hLayer, job.hPage.xy + uv * job.hPage.z), 0.0) * sc.reach.w;
  }
  let p = job.corner + job.east * uv.x + job.south * uv.y + sc.up.xyz * (ground - sc.near.z);
  let d = length(p);
  let far = sc.far[g];
  if (d > far) {
    return;
  }
  // thinning with distance beyond the full-density reach, against the share the stride already took
  let reach = select(sc.reach.y, sc.reach.x, g == 0u);
  let keep = clamp(reach / d, MIN_KEEP, 1.0);
  if (rnd(seed, ci, cj, s + 7u) >= keep / job.misc.z) {
    return;
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
  if (size < 0.05 || !visible(p + sc.up.xyz * (0.5 * size), 0.75 * size)) {
    return;
  }
  let lod = select(1u, 0u, d < select(sc.near.y, sc.near.x, g == 0u));
  let slot = kind * 2u + lod;
  let n = atomicAdd(&counts[slot], 1u);
  if (n >= sc.slots[slot].y) {
    return;
  }
  let at = (sc.slots[slot].x + n) * 2u;
  instances[at] = vec4f(p, size);
  instances[at + 1u] = vec4f(rnd(seed, ci, cj, s + 6u) * TAU, h, 0.85 + 0.3 * fract(h * 13.7), f32(kind));
}

// The appended counts, clamped to each slot's capacity, as the instance counts of the indirect draws.
@compute @workgroup_size(16)
fn finalize(@builtin(local_invocation_index) i: u32) {
  if (i < 12u) {
    args[i * 5u + 1u] = min(atomicLoad(&counts[i]), sc.slots[i].y);
  }
}
