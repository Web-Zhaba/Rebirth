#include "frame"

// Dots on the ground (scene/dots.ts): walkers and carts as discs of a fixed screen size facing the camera, the evening
// glows of lit buildings as soft discs lying on the ground. Positions are metres in the east/north/up frame of the town
// origin, made camera-relative with `dots.rel` like the town's models.

struct Dots {
  rel: vec4f, // xyz origin - eye (m), w CSS px per clip unit (viewport height / 2)
  e: vec4f,
  n: vec4f,
  u: vec4f,
  vp: vec4f,  // x viewport aspect (w / h)
};

@group(1) @binding(0) var<uniform> dots: Dots;

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) q: vec2f,                      // -1..1 across the quad, scaled so 1 is the outer radius
  @location(1) @interpolate(flat) fill: vec4f,
  @location(2) @interpolate(flat) stroke: vec4f,
  @location(3) @interpolate(flat) shape: vec4f, // x inner radius share (stroke inside it), y blur share, z ground (1) or screen (0)
};

fn unpack(bits: f32) -> vec4f {
  let c = unpack4x8unorm(bitcast<u32>(bits));
  return vec4f(c.rgb * c.a, c.a); // premultiplied, display space (dots are a map, like the old circles)
}

// Instance: centre xyz (m), size (px for screen dots, m for ground ones), fill bits, stroke bits, stroke px, flags
// (x: 1 ground disc; blur share in the fraction).
@vertex
fn vs(@builtin(vertex_index) vi: u32, @location(0) c: vec4f, @location(1) colours: vec2f, @location(2) more: vec2f) -> VsOut {
  let corner = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  let ground = more.y >= 1.0;
  let blur = fract(more.y);
  let centre = dots.rel.xyz + dots.e.xyz * c.x + dots.n.xyz * c.y + dots.u.xyz * c.z;
  var o: VsOut;
  if (ground) {
    let r = c.w;
    o.pos = frame.viewProj * vec4f(centre + (dots.e.xyz * corner.x + dots.n.xyz * corner.y) * r, 1.0);
    o.shape = vec4f(1.0, blur, 1.0, 0.0);
  } else {
    let r = c.w + more.x * 0.5 + 1.0; // room for the stroke and the antialiased edge
    let clip = frame.viewProj * vec4f(centre, 1.0);
    let px = vec2f(r / (dots.rel.w * dots.vp.x), r / dots.rel.w); // CSS px -> clip units at w = 1
    o.pos = clip + vec4f(corner * px * clip.w, 0.0, 0.0);
    o.shape = vec4f(c.w / r, more.x / r, 0.0, 1.0 / r);
  }
  o.q = corner;
  o.fill = unpack(colours.x);
  o.stroke = unpack(colours.y);
  return o;
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4f {
  let d = length(v.q);
  if (v.shape.z > 0.5) {
    // a glow: full in the middle, fading out over the blur share of the radius
    let a = 1.0 - smoothstep(1.0 - v.shape.y, 1.0, d);
    if (a <= 0.0) {
      discard;
    }
    return v.fill * a;
  }
  let aa = v.shape.w; // one px in quad units
  let r = v.shape.x;
  let sw = v.shape.y;
  let inside = clamp((r - d) / aa + 0.5, 0.0, 1.0);
  var c = v.fill * inside;
  if (sw > 0.0) {
    let ring = clamp((sw * 0.5 - abs(d - r)) / aa + 0.5, 0.0, 1.0);
    c = v.stroke * ring + c * (1.0 - v.stroke.a * ring);
  }
  if (c.a <= 0.0) {
    discard;
  }
  return c;
}
