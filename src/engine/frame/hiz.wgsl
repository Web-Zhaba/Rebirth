// Hi-Z pyramid (frame/hiz.ts): the farthest depth (reversed Z: the smallest value) over ever larger squares of the
// screen, built from the occluders' multisampled depth of this frame. Level 0 is half the screen: each texel the
// minimum of 2 x 2 pixels times their samples. A level's texel covers 2 x 2 of the level below, and the last one of a
// row or column also the odd texel left over, so mapping a level-0 texel c to level k as min(c >> k, size - 1) always
// lands on a texel that covers it.

@group(0) @binding(0) var depth: texture_depth_multisampled_2d;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var dst: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn first(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (any(id.xy >= size)) {
    return;
  }
  let last = textureDimensions(depth) - 1u;
  let samples = textureNumSamples(depth);
  var m = 1.0;
  for (var d = 0u; d < 4u; d++) {
    let p = min(id.xy * 2u + vec2u(d & 1u, d >> 1u), last);
    for (var s = 0u; s < samples; s++) {
      m = min(m, textureLoad(depth, p, s));
    }
  }
  textureStore(dst, id.xy, vec4f(m, 0.0, 0.0, 0.0));
}

@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(dst);
  if (any(id.xy >= size)) {
    return;
  }
  let below = textureDimensions(src);
  let last = below - 1u;
  // the last texel of a row/column takes the odd one left over below
  let ex = select(1u, 2u, id.x == size.x - 1u && (below.x & 1u) == 1u);
  let ey = select(1u, 2u, id.y == size.y - 1u && (below.y & 1u) == 1u);
  var m = 1.0;
  for (var y = 0u; y <= ey; y++) {
    for (var x = 0u; x <= ex; x++) {
      m = min(m, textureLoad(src, min(id.xy * 2u + vec2u(x, y), last), 0).r);
    }
  }
  textureStore(dst, id.xy, vec4f(m, 0.0, 0.0, 0.0));
}
