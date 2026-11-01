// Per-frame uniforms shared by every pass. Positions on the GPU are camera-relative metres in ECEF axes: the eye sits
// at the origin, so viewProj holds only the camera rotation and the reversed-Z projection.
struct Frame {
  viewProj: mat4x4f,
  eye: vec4f,     // xyz eye ECEF in f32 (sky and haze only, never for geometry), w eye altitude (m)
  sun: vec4f,     // xyz unit sun direction (ECEF), w sun intensity
  camR: vec4f,    // camera right * tan(half fov x)
  camU: vec4f,    // camera up * tan(half fov y)
  camF: vec4f,    // camera forward, w near plane (m)
  params: vec4f,  // x terrain exaggeration, y LOD tint on/off, z time (s), w unused
};

@group(0) @binding(0) var<uniform> frame: Frame;
