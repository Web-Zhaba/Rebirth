// Impostor bake (scene/treeAtlas.ts): one tree model seen orthographically from the south at an elevation, written as
// the unlit vertex colour with coverage in alpha (`color`) and the normal in the view (xy, z toward the camera), the
// height in the tree and the crown flag (`data`), so the forest shader lights, recolours and snows a baked tree like a
// real one. Then the mip chain, a box filter level by level.

struct Bake {
  right: vec4f, // view right (tree metres)
  up: vec4f,    // view up
  fwd: vec4f,   // view direction, away from the camera
  mid: vec4f,   // xyz the point the view turns about, w half side of the view
};

@group(0) @binding(0) var<uniform> bake: Bake;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) c: vec3f,
  @location(1) n: vec3f,
  @location(2) h: f32,
  @location(3) crown: f32,
};

@vertex
fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) c: vec3f, @location(3) crown: f32) -> VsOut {
  let d = p - bake.mid.xyz;
  let r = bake.mid.w;
  var o: VsOut;
  o.pos = vec4f(dot(d, bake.right.xyz) / r, dot(d, bake.up.xyz) / r, 0.5 + 0.5 * dot(d, bake.fwd.xyz) / r, 1.0);
  o.c = c;
  o.n = vec3f(dot(n, bake.right.xyz), dot(n, bake.up.xyz), -dot(n, bake.fwd.xyz));
  o.h = p.z;
  o.crown = crown;
  return o;
}

struct Targets {
  @location(0) color: vec4f,
  @location(1) data: vec4f,
};

@fragment
fn fs(v: VsOut) -> Targets {
  var n = normalize(v.n);
  if (n.z < 0.0) {
    n = -n; // the inside of an open crown, seen through its rim
  }
  var t: Targets;
  t.color = vec4f(v.c, 1.0);
  t.data = vec4f(n.xy * 0.5 + 0.5, v.h, v.crown);
  return t;
}

// Mips: the level above, sampled at the middle of each 2 x 2 block.
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var smp: sampler;

struct MipOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn mipVs(@builtin(vertex_index) i: u32) -> MipOut {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); // a triangle over the whole target
  var o: MipOut;
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}

@fragment
fn mipFs(v: MipOut) -> @location(0) vec4f {
  return textureSample(src, smp, v.uv);
}
