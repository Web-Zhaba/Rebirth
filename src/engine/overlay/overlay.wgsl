// Overlay raster (overlay/overlayRaster.ts): the game's 2D map drawings rendered into a square of web mercator around
// the camera, which the terrain then samples. Positions arrive in mercator metres relative to the geometry's anchor;
// `toUv` maps them into the level square. Lines and circles are distance fields, so they come out antialiased without
// MSAA; fills are plain triangles (the terrain samples the raster bilinearly, which softens their edge).

struct Level {
  toUv: vec4f,   // uv = p * x + yz (anchor - level corner over the side), w texels per side
  scale: vec4f,  // x texels per mercator metre, y texels per screen px, zw unused
};

@group(0) @binding(0) var<uniform> level: Level;

fn uvOf(p: vec2f) -> vec2f {
  return p * level.toUv.x + level.toUv.yz;
}

fn clipOf(uv: vec2f) -> vec4f {
  return vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0);
}

// Packed RGBA8 sRGB colour -> linear, premultiplied (the target is an -srgb format: blending happens in linear).
fn colour(bits: f32) -> vec4f {
  let c = unpack4x8unorm(bitcast<u32>(bits));
  let rgb = pow(c.rgb, vec3f(2.2));
  return vec4f(rgb * c.a, c.a);
}

// ---------- fills ----------

struct FillOut {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) c: vec4f,
  @location(1) px: vec2f,                      // screen px from the anchor (pattern space, fixed to the ground)
  @location(2) @interpolate(flat) pattern: f32,
};

@vertex
fn fillVs(@location(0) p: vec2f, @location(1) bits: f32, @location(2) pattern: f32) -> FillOut {
  var o: FillOut;
  o.pos = clipOf(uvOf(p));
  o.c = colour(bits);
  o.px = p * (level.scale.x / max(level.scale.y, 1e-6)); // mercator metres -> screen px at the drawn scale
  o.pattern = pattern;
  return o;
}

// Hatch patterns of the old map's fill-pattern images (map/patterns.ts), on the same 12 px tile: 1 residential dots,
// 2 craft diagonal hatch, 3 trade cross-hatch, 4 field furrows. `aa` is screen px per texel: edges are antialiased
// over it, and once the 12 px tile gets only a few texels the pattern fades into its average cover (no moire).
const PATTERN_TILE = 12.0;

fn bar(d: f32, halfWidth: f32, aa: f32) -> f32 {
  return clamp((halfWidth - d) / aa + 0.5, 0.0, 1.0);
}

fn patternCover(id: u32, px: vec2f, aa: f32) -> f32 {
  let q = px - floor(px / PATTERN_TILE) * PATTERN_TILE; // 0..12 inside the tile
  var cover = 1.0;
  var mean = 1.0;
  if (id == 1u) {
    // two 1.5 px dots at (3, 3) and (9, 9)
    let d = min(length(q - vec2f(3.0)), length(q - vec2f(9.0)));
    cover = bar(d, 0.85, aa);
    mean = 0.031;
  } else if (id == 2u) {
    // "/" lines through (0, 12) and (12, 0), 1 px wide
    let s = (q.x + q.y) / PATTERN_TILE;
    let d = abs(s - round(s)) * PATTERN_TILE * 0.70710678;
    cover = bar(d, 0.5, aa);
    mean = 0.118;
  } else if (id == 3u) {
    // a cross at 6.5 px, 1 px wide
    let d = min(abs(q.x - 6.5), abs(q.y - 6.5));
    cover = bar(d, 0.5, aa);
    mean = 0.16;
  } else if (id == 4u) {
    // furrows at 2.5 and 8.5 px
    let t = (q.y - 2.5) / 6.0;
    let d = abs(t - round(t)) * 6.0;
    cover = bar(d, 0.5, aa);
    mean = 0.167;
  }
  return mix(cover, mean, clamp((aa - 1.5) / 3.0, 0.0, 1.0));
}

@fragment
fn fillFs(v: FillOut) -> @location(0) vec4f {
  let aa = max(max(fwidth(v.px.x), fwidth(v.px.y)), 1e-3); // derivatives first, in uniform control flow
  let id = u32(round(v.pattern));
  if (id == 0u) {
    return v.c;
  }
  let cover = patternCover(id, v.px, aa);
  if (cover <= 0.0) {
    discard;
  }
  return v.c * cover;
}

// ---------- lines: one quad per segment, a capsule distance field ----------

struct LineOut {
  @builtin(position) pos: vec4f,
  @location(0) t: vec2f,                       // texel position
  @location(1) @interpolate(flat) a: vec2f,    // segment ends, texels
  @location(2) @interpolate(flat) b: vec2f,
  @location(3) @interpolate(flat) hw: f32,     // half width, texels
  @location(4) @interpolate(flat) c: vec4f,
  @location(5) @interpolate(flat) along: f32,  // texels along the line at a
  @location(6) @interpolate(flat) dash: vec2f, // on, off in texels (0: solid)
};

@vertex
fn lineVs(
  @builtin(vertex_index) vi: u32,
  @location(0) ab: vec4f,
  @location(1) w: vec4f, // x along at a (merc m), y width px, z width m, w colour bits
  @location(2) dash: vec2f,
) -> LineOut {
  let n = level.toUv.w;
  let a = uvOf(ab.xy) * n;
  let b = uvOf(ab.zw) * n;
  let width = max(w.y * level.scale.y, w.z * level.scale.x); // w.z is already in mercator metres (geometry.ts)
  let hw = max(width, 1.0) * 0.5;
  var dir = b - a;
  let len = length(dir);
  dir = select(vec2f(1.0, 0.0), dir / max(len, 1e-6), len > 1e-6);
  let nrm = vec2f(-dir.y, dir.x);
  let r = hw + 1.5; // room for the round cap and the antialiased edge
  let corner = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0; // (-1,-1) (1,-1) (-1,1) (1,1)
  let t = select(a, b, corner.x > 0.0) + dir * corner.x * r + nrm * corner.y * r;
  var o: LineOut;
  o.pos = clipOf(t / n);
  o.t = t;
  o.a = a;
  o.b = b;
  o.hw = hw;
  o.c = colour(w.w);
  o.along = w.x * level.scale.x;
  o.dash = dash * max(width, 1.0);
  return o;
}

@fragment
fn lineFs(v: LineOut) -> @location(0) vec4f {
  let ab = v.b - v.a;
  let l2 = dot(ab, ab);
  let h = select(0.0, clamp(dot(v.t - v.a, ab) / l2, 0.0, 1.0), l2 > 1e-8);
  let d = length(v.t - (v.a + ab * h));
  var cover = clamp(v.hw - d + 0.5, 0.0, 1.0);
  if (v.dash.x > 0.0) {
    let s = v.along + h * sqrt(l2);
    let phase = s - floor(s / (v.dash.x + v.dash.y)) * (v.dash.x + v.dash.y);
    cover *= clamp(v.dash.x - phase + 0.5, 0.0, 1.0) * clamp(phase + 0.5, 0.0, 1.0);
  }
  if (cover <= 0.0) {
    discard;
  }
  return v.c * cover;
}

// ---------- circles ----------

struct CircleOut {
  @builtin(position) pos: vec4f,
  @location(0) q: vec2f,                     // offset from the centre, texels
  @location(1) @interpolate(flat) r: f32,    // radius, texels
  @location(2) @interpolate(flat) sw: f32,   // stroke width, texels
  @location(3) @interpolate(flat) fill: vec4f,
  @location(4) @interpolate(flat) stroke: vec4f,
};

@vertex
fn circleVs(@builtin(vertex_index) vi: u32, @location(0) c: vec4f, @location(1) s: vec2f) -> CircleOut {
  // c: centre xy (merc m), radius px, fill bits; s: stroke bits, stroke px
  let n = level.toUv.w;
  let centre = uvOf(c.xy) * n;
  let r = max(c.z * level.scale.y, 1.0);
  let sw = s.y * level.scale.y;
  let e = r + sw * 0.5 + 1.5;
  let corner = vec2f(f32(vi & 1u), f32(vi >> 1u)) * 2.0 - 1.0;
  var o: CircleOut;
  o.q = corner * e;
  o.pos = clipOf((centre + o.q) / n);
  o.r = r;
  o.sw = sw;
  o.fill = colour(c.w);
  o.stroke = colour(s.x);
  return o;
}

@fragment
fn circleFs(v: CircleOut) -> @location(0) vec4f {
  let d = length(v.q);
  let inside = clamp(v.r - d + 0.5, 0.0, 1.0);
  var c = v.fill * inside;
  if (v.sw > 0.0) {
    let ring = clamp(v.sw * 0.5 - abs(d - v.r) + 0.5, 0.0, 1.0);
    c = v.stroke * ring + c * (1.0 - v.stroke.a * ring);
  }
  if (c.a <= 0.0) {
    discard;
  }
  return c;
}
