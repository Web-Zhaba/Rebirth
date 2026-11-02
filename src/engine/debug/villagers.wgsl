// Villager figures of the preview page: flat-shaded, per-vertex display colour, one directional light and a flat ambient
// term. The game draws them with the town's shaders (scene/townMesh.wgsl).

struct Scene {
  viewProj: mat4x4f,
  light: vec4f, // xyz: direction towards the light, w: ambient share
};

@group(0) @binding(0) var<uniform> scene: Scene;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) nrm: vec3f,
  @location(1) col: vec3f,
};

@vertex
fn vs(@location(0) p: vec3f, @location(1) n: vec3f, @location(2) c: vec3f) -> VsOut {
  var o: VsOut;
  o.pos = scene.viewProj * vec4f(p, 1.0);
  o.nrm = n;
  o.col = c;
  return o;
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4f {
  let n = normalize(v.nrm);
  let diffuse = max(dot(n, normalize(scene.light.xyz)), 0.0);
  let lit = v.col * (scene.light.w + (1.0 - scene.light.w) * diffuse);
  return vec4f(lit, 1.0);
}
