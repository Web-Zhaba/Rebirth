#include "frame"

// 1 m checker cube for the precision check: a content chunk in miniature. Its origin is f64 on the CPU; the shader
// gets origin - eye (f32) and the ENU basis, and places local ENU metres with them, as N4 content chunks will.

struct Cube {
  rel: vec4f,    // xyz origin - eye (m), w edge (m)
  east: vec4f,
  north: vec4f,
  up: vec4f,
};

@group(1) @binding(0) var<uniform> cube: Cube;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) local: vec3f,
  @location(1) @interpolate(flat) face: u32,
};

const CORNERS = array<vec3f, 8>(
  vec3f(-0.5, -0.5, 0.0), vec3f(0.5, -0.5, 0.0), vec3f(0.5, 0.5, 0.0), vec3f(-0.5, 0.5, 0.0),
  vec3f(-0.5, -0.5, 1.0), vec3f(0.5, -0.5, 1.0), vec3f(0.5, 0.5, 1.0), vec3f(-0.5, 0.5, 1.0),
);
const FACES = array<u32, 36>(
  0u, 2u, 1u, 0u, 3u, 2u,  // bottom
  4u, 5u, 6u, 4u, 6u, 7u,  // top
  0u, 1u, 5u, 0u, 5u, 4u,  // south
  2u, 3u, 7u, 2u, 7u, 6u,  // north
  1u, 2u, 6u, 1u, 6u, 5u,  // east
  3u, 0u, 4u, 3u, 4u, 7u,  // west
);

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
  let l = CORNERS[FACES[i]] * cube.rel.w;
  let rel = cube.rel.xyz + cube.east.xyz * l.x + cube.north.xyz * l.y + cube.up.xyz * l.z;
  var o: VsOut;
  o.pos = frame.viewProj * vec4f(rel, 1.0);
  o.local = l / cube.rel.w;
  o.face = i / 6u;
  return o;
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4f {
  // Step inside the face before flooring: the face's own coordinate sits exactly on a checker boundary.
  let normals = array<vec3f, 6>(vec3f(0, 0, -1), vec3f(0, 0, 1), vec3f(0, -1, 0), vec3f(0, 1, 0), vec3f(1, 0, 0), vec3f(-1, 0, 0));
  let q = floor((v.local - normals[v.face] * 0.01) * 4.0);
  let check = (i32(q.x) + i32(q.y) + i32(q.z)) & 1;
  let shade = array<f32, 6>(0.45, 1.0, 0.7, 0.6, 0.85, 0.55)[v.face];
  let base = select(vec3f(0.9, 0.15, 0.1), vec3f(0.95, 0.95, 0.9), check == 1);
  return vec4f(pow(base * shade, vec3f(1.0 / 2.2)), 1.0);
}
