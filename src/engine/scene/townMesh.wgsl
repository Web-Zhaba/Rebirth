#include "frame"
#include "atmosphere"

// The town's models (scene/townMesh.ts): a WGSL port of the three.js model layer's shaders (map/modelLayer.ts). Vertices
// are metres in the east/north/up frame of the town origin; `model.rel` is the origin minus the eye (f64 on the CPU), so
// positions stay camera-relative like everything else. Facade codes (modelGeometry.ts PATTERN) paint windows, doors,
// log courses, boards and shingle rows on the buildings and the surfaces of roads; the lamp pass adds the lit windows.

struct Model {
  rel: vec4f,     // xyz origin - eye (m)
  e: vec4f,       // origin's east, north and up axes (ECEF)
  n: vec4f,
  u: vec4f,
  light: vec4f,   // xyz light direction in the origin's frame, w sun strength 0..1 (clouds/shadowMath sunStrength)
  params: vec4f,  // x snow cover 0..1, y how lit the place is (day 1 .. night 0), zw unused
  lamp: vec4f,    // xyz how bright house, work and tavern lights are now
  snowCol: vec4f,
};

@group(1) @binding(0) var<uniform> model: Model;

const NIGHT = vec3f(0.13, 0.16, 0.24);

struct VsIn {
  @location(0) pos: vec3f,
  @location(1) normal: vec3f,
  @location(2) colour: vec3f,
  @location(3) facade: vec4f,
  @location(4) z: f32,
  @location(5) lamp: f32,
};

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) n: vec3f,
  @location(1) c: vec3f,
  @location(2) f: vec4f,
  @location(3) z: f32,
  @location(4) xy: vec2f,
  @location(5) lamp: f32,
};

@vertex
fn vs(v: VsIn) -> VsOut {
  let rel = model.rel.xyz + model.e.xyz * v.pos.x + model.n.xyz * v.pos.y + model.u.xyz * v.pos.z;
  var o: VsOut;
  o.pos = frame.viewProj * vec4f(rel, 1.0);
  o.n = v.normal;
  o.c = v.colour;
  o.f = v.facade;
  o.z = v.z; // height above the model's own ground (Model.lift), what facades are laid out by
  o.xy = v.pos.xy; // metres east and north of the origin, for patterns laid out in world space
  o.lamp = v.lamp;
  return o;
}

// Grid of windows on a wall: columns centred on the wall, one row per floor below the eaves. aw, az: pixel footprint in
// metres along s and z; once windows get that small the grid turns into its average coverage. Returns (cover, id).
fn windows(s: f32, len: f32, z: f32, top: f32, aw: f32, az: f32, floorH: f32, sill: f32, wh: f32, ww: f32, sp: f32) -> vec2f {
  let n = select(0.0, floor((len - 1.4 - ww) / sp) + 1.0, len >= ww + 1.4);
  let fl = floor(z / floorH);
  if (n < 1.0 || fl * floorH + sill + wh > top - 0.25) {
    return vec2f(0.0);
  }
  let start = (len - (n - 1.0) * sp) * 0.5;
  let c = clamp(floor((s - start) / sp + 0.5), 0.0, n - 1.0);
  let id = fl * 31.0 + c;
  let dx = abs(s - start - c * sp);
  let zl = z - fl * floorH;
  let mx = 1.0 - smoothstep(ww * 0.5 - aw, ww * 0.5 + aw, dx);
  let mz = smoothstep(sill - az, sill + az, zl) * (1.0 - smoothstep(sill + wh - az, sill + wh + az, zl));
  let far = smoothstep(0.25, 0.6, max(aw / ww, az / wh));
  return vec2f(mix(mx * mz, 0.7 * ww * wh / (sp * floorH), far), id);
}

// Window grid of a facade: floor height, sill, window height, width (xyzw) and spacing (w of the second, 0: none).
fn grid(p: i32, f: vec4f) -> array<vec4f, 2> {
  switch p {
    case 1: { return array(vec4f(3.0, 0.9, 1.25, 1.0), vec4f(2.6)); }
    case 2: { return array(vec4f(3.8, 1.0, 2.0, 1.3), vec4f(3.0)); }
    case 3: { return array(vec4f(100.0, 2.2, clamp(f.z - 3.4, 1.4, 4.0), 0.9), vec4f(3.4)); }
    case 5: { return array(vec4f(4.5, 2.0, 1.6, 2.4), vec4f(3.4)); }
    case 6: { return array(vec4f(3.5, 1.2, 1.3, 0.55), vec4f(2.2)); }
    case 9: { return array(vec4f(3.0, 0.9, 1.0, 0.85), vec4f(2.4)); }
    default: { return array(vec4f(0.0), vec4f(0.0)); }
  }
}

// A door at the middle of the wall (dk 1 door, 2 gate): no windows next to it on the ground floor.
fn nearDoor(dk: i32, z: f32, f: vec4f) -> bool {
  let dw = select(1.0, 2.6, dk == 2);
  let dh = select(2.0, 2.5, dk == 2);
  return dk > 0 && abs(f.x - f.y * 0.5) < dw * 0.5 + 0.6 && z < dh + 0.4;
}

fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

// Smooth value noise 0..1, for the patches the snow lies in.
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  var f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2f(1.0, 0.0)), f.x), mix(hash2(i + vec2f(0.0, 1.0)), hash2(i + vec2f(1.0, 1.0)), f.x), f.y);
}

// Dark seams every "period" metres of x, gone once they get thinner than a pixel.
fn seams(x: f32, ax: f32, period: f32) -> f32 {
  let f = fract(x / period);
  return smoothstep(0.8, 0.9, f) * (1.0 - smoothstep(0.2, 0.5, ax / period));
}

fn doorway(dx: f32, z: f32, aw: f32, az: f32, w: f32, h: f32) -> f32 {
  return (1.0 - smoothstep(w * 0.5 - aw, w * 0.5 + aw, dx)) * (1.0 - smoothstep(h - az, h + az, z));
}

// Cobble joints in world space, so neighbouring surfaces (a junction apron) line up.
fn cobbles(xy: vec2f, axy: f32) -> f32 {
  var q = xy / 0.42;
  q.x += 0.5 * (floor(q.y) - 2.0 * floor(floor(q.y) / 2.0));
  let f = abs(fract(q) - 0.5);
  return 0.22 * smoothstep(0.36, 0.47, max(f.x, f.y)) * (1.0 - smoothstep(0.15, 0.5, axy / 0.42));
}

// Two wheel ruts at 27 % of the half width either side of the centre line.
fn ruts(f: vec4f, ay: f32) -> f32 {
  let r = abs(abs(f.y) - abs(f.z) * 0.27);
  return 0.14 * (1.0 - smoothstep(0.18, 0.38 + ay, r));
}

fn road(c0: vec3f, code: i32, f: vec4f, z: f32, xy: vec2f, aw: f32, ay: f32, az: f32, axy: f32) -> vec3f {
  var col = c0;
  let w = abs(f.z);
  let e = abs(f.y) / max(w * 0.5, 1e-3); // 0 on the centre line, 1 at the edge
  if (code == 30) {
    return col * mix(1.0, 0.8, smoothstep(0.5, 1.0, e));
  }
  if (code >= 35) {
    // junction aprons (roadJunctions.ts): f.x is the place in the shoulder band of the nearest road reaching it
    col *= 1.0 - 0.22 * smoothstep(0.0, 1.0, clamp(f.x, 0.0, 1.0));
    if (code == 35) {
      col *= 1.0 - ruts(f, ay);
    } else if (code == 36) {
      col *= 1.0 - cobbles(xy, axy);
    }
    return col;
  }
  col *= mix(1.0, 0.78, smoothstep(0.82, 1.0, e));
  if (code == 31 && f.z > 0.0) {
    col *= 1.0 - ruts(f, ay);
  } else if (code == 32) {
    col *= 1.0 - cobbles(xy, axy);
  } else if (code == 33) {
    col *= 1.0 - 0.24 * seams(f.x, aw, 0.3);
  } else if (code == 34) {
    let course = floor(z / 0.5);
    col *= 1.0 - 0.2 * max(seams(z, az, 0.5), seams(f.x + 0.6 * (course - 2.0 * floor(course / 2.0)), aw, 1.2));
  }
  return col;
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4f {
  let z = v.z;
  // derivatives first: they need uniform control flow
  let aw = max(fwidth(v.f.x), 1e-4);
  let az = max(fwidth(z), 1e-4);
  let ay = max(fwidth(v.f.y), 1e-4);
  let axy = max(max(fwidth(v.xy.x), fwidth(v.xy.y)), 1e-4);
  let code = i32(v.f.w + 0.5);
  let dk = select(0, code / 10, code < 30); // 1 door, 2 gate
  let p = code - dk * 10;
  var col = v.c;
  if (code >= 30) {
    col = road(v.c, code, v.f, z, v.xy, aw, ay, az, axy);
  }
  let g = grid(p, v.f);
  let sp = g[1].x;
  if (p == 9 || p == 4) {
    col *= 1.0 - 0.2 * seams(z, az, select(0.32, 0.3, p == 9));
  } else if (p == 7) {
    col *= 1.0 - 0.12 * seams(z, az, 0.42);
  } else if (p == 8) {
    col *= 1.0 - 0.16 * seams(v.f.x, aw, 0.28);
  }
  if (sp > 0.0 && !nearDoor(dk, z, v.f)) {
    // glass inside a light frame 0.1 m wide
    let glass = windows(v.f.x, v.f.y, z, v.f.z, aw, az, g[0].x, g[0].y, g[0].z, g[0].w, sp).x;
    let fr = windows(v.f.x, v.f.y, z, v.f.z, aw, az, g[0].x, g[0].y - 0.1, g[0].z + 0.2, g[0].w + 0.2, sp).x;
    col = mix(col, mix(col, vec3f(0.95, 0.92, 0.84), 0.6), max(fr - glass, 0.0));
    col = mix(col, vec3f(0.22, 0.25, 0.28), glass);
  }
  if (dk > 0) {
    let dw = select(1.0, 2.6, dk == 2);
    let dh = select(2.0, 2.5, dk == 2);
    let dx = abs(v.f.x - v.f.y * 0.5);
    let leaf = doorway(dx, z, aw, az, dw, dh);
    let fr = doorway(dx, z, aw, az, dw + 0.24, dh + 0.12);
    var wood = vec3f(0.30, 0.22, 0.15);
    if (dk == 2) {
      wood *= 1.0 - 0.35 * (1.0 - smoothstep(0.03, 0.06 + aw, dx)); // the seam between the two leaves
    }
    col = mix(col, mix(col, vec3f(0.95, 0.92, 0.84), 0.5), max(fr - leaf, 0.0));
    col = mix(col, wood, leaf);
  }
  let n = normalize(v.n);
  let snow = model.params.x;
  if (snow > 0.0) {
    // snow lies on what faces up; a thin snowpack is patchy, a thick one closes up; roads keep less of it (trodden)
    let up = smoothstep(0.12, 0.45, n.z);
    let blotch = 0.55 * vnoise(v.xy * 0.9) + 0.3 * vnoise(v.xy * 2.7 + 7.0) + 0.15 * hash2(floor(v.xy * 5.0));
    let lim = 1.0 - snow * 1.3;
    let a = up * smoothstep(lim, lim + 0.25, blotch) * mix(0.35, 0.95, snow);
    col = mix(col, model.snowCol.rgb, a * select(1.0, 0.5, code >= 30));
  }
  let d = max(dot(n, model.light.xyz), 0.0);
  var k = mix(0.55, 1.0, d) * mix(0.88, 1.0, model.light.w);
  if (abs(n.z) < 0.5) {
    k *= mix(0.78, 1.0, smoothstep(0.0, 2.5, z)); // walls darken towards the ground
  }
  // The old map's dusk-blue night tint, as a dimming by how lit the place is (the ground goes dark the same way).
  return vec4f(col * k * mix(NIGHT, vec3f(1.0), model.params.y), 1.0);
}

// Window light: only the glass of lit buildings, added on top (blending one, one). Each window of a building is lit or
// not by a hash of the window and the building's seed, so a house never shows every window lit.
@fragment
fn lampFs(v: VsOut) -> @location(0) vec4f {
  let z = v.z;
  let aw = max(fwidth(v.f.x), 1e-4);
  let az = max(fwidth(z), 1e-4);
  let kind = floor(v.lamp + 0.01);
  let on = select(select(select(model.lamp.z, model.lamp.y, kind < 2.5), model.lamp.x, kind < 1.5), 0.0, kind < 0.5);
  let code = i32(v.f.w + 0.5);
  let dk = select(0, code / 10, code < 30);
  let p = code - dk * 10;
  let g = grid(p, v.f);
  let sp = g[1].x;
  if (on < 0.01 || sp <= 0.0 || code >= 30 || nearDoor(dk, z, v.f)) {
    discard;
  }
  let w = windows(v.f.x, v.f.y, z, v.f.z, aw, az, g[0].x, g[0].y, g[0].z, g[0].w, sp);
  let share = select(select(1.0, 0.85, kind < 2.5), 0.65, kind < 1.5);
  let h = fract(sin(w.y * 12.9898 + fract(v.lamp) * 311.7 + v.f.y * 7.13) * 43758.5453);
  let a = w.x * on * step(h, share);
  if (a < 0.01) {
    discard;
  }
  return vec4f(vec3f(1.0, 0.72, 0.38) * a, 0.0);
}
