// Per-frame uniforms shared by every pass. Positions on the GPU are camera-relative metres in ECEF axes: the eye sits
// at the origin, so viewProj holds only the camera rotation and the reversed-Z projection.
struct Frame {
  viewProj: mat4x4f,
  eye: vec4f,     // xyz eye ECEF in f32 (sky and haze only, never for geometry), w eye altitude (m)
  sun: vec4f,     // xyz unit sun direction (ECEF), w sun intensity
  camR: vec4f,    // camera right * tan(half fov x)
  camU: vec4f,    // camera up * tan(half fov y)
  camF: vec4f,    // camera forward, w near plane (m)
  params: vec4f,  // x terrain exaggeration, y LOD tint on/off, z time (s), w what the ground highlights (HIGHLIGHT)
  highlight: vec4f, // rgb its display colour, a its opacity
  shadowProj: mat4x4f, // camera-relative ECEF -> the sun's shadow map clip (shadow/shadowMath.ts shadowMatrix)
  shadowData: vec4f, // x metres per shadow texel, y shadow strength 0..1 (0 = none), z 1 / map size
};

@group(0) @binding(0) var<uniform> frame: Frame;
