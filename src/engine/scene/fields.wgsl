#include "frame"
#include "weather"
#include "shadow"

// The farm fields (scene/fields.ts): a WGSL port of the old 3D fields. Procedural, in metres along
// and across the furrows (the longest edge of the field): ridges every ROW metres with a fake normal lit by the sun,
// faded out before they get finer than a pixel. The season follows the calendar in seasons with a per-field shift of a
// day or two; what the farm really did (the shares sown and harvested) sweeps along the furrows: shoots thickening to a
// dense green and gold, the cut part as stubble, grain left standing when the window closes lodges, ploughed again late
// in autumn. A field no farm works is fallow grass. A headland of grass rims every field. The ground's weather
// (sky/weather.wgsl) lays snow in the furrows first and darkens it when wet; nights dim to the old dusk blue.

struct Fields {
  rel: vec4f,   // xyz origin - eye (m)
  e: vec4f,
  n: vec4f,
  u: vec4f,
  eye: vec4f,   // xyz eye in the origin's frame (m), w day of the year
  light: vec4f, // xyz the models' light in the origin's frame, w sun strength 0..1
  look: vec4f,  // x how lit the place is (day 1 .. night 0), y fade-in 0..1, z far (m)
};

@group(1) @binding(0) var<uniform> fields: Fields;

const ROW = ${ROW}; // m between furrows
const JITTER = ${JITTER}; // days: the span of the per-field shift of the calendar
const SEASON = ${SEASON};
const NIGHT = vec3f(0.13, 0.16, 0.24); // townMesh.wgsl: the old map's dusk blue
const SOIL = vec3f(${SOIL});
const SOIL_DRY = vec3f(${SOIL_DRY});
const SHOOT = vec3f(${SHOOT});
const CROP = vec3f(${CROP});
const RIPE = vec3f(${RIPE});
const STRAW = vec3f(${STRAW});
const STUBBLE = vec3f(${STUBBLE});
const GRASS = vec3f(${GRASS});
const FALLOW = vec3f(${FALLOW});
const FALLOW_DRY = vec3f(${FALLOW_DRY});

struct VsOut {
  @builtin(position) pos: vec4f,
  @location(0) m: vec3f,       // origin-frame metres
  @location(1) rel: vec3f,     // camera-relative (m), unlifted
  @location(2) loc: vec2f,     // the field's own metres
  @location(3) dir: vec2f,
  @location(4) info: vec4f,    // worked (0/1), the field's hash, its extent along the furrows (min, max)
  @location(5) edge: f32,
  @location(6) work: vec2f,    // the farm's real work this year: the share sown, the share of it harvested
};

@vertex
fn vs(@location(0) at: vec3f, @location(1) loc: vec2f, @location(2) dir: vec2f, @location(3) info: vec4f, @location(4) edge: f32, @location(5) work: vec2f) -> VsOut {
  // pulled a little toward the camera along its ray: drawn over the ground it lies on, at the same place on the screen
  let toEye = fields.eye.xyz - at;
  let d = max(length(toEye), 1.0);
  let p = at + toEye * (min(d * 0.002, 25.0) / d);
  var o: VsOut;
  o.pos = frame.viewProj * vec4f(fields.rel.xyz + fields.e.xyz * p.x + fields.n.xyz * p.y + fields.u.xyz * p.z, 1.0);
  o.m = at;
  o.rel = fields.rel.xyz + fields.e.xyz * at.x + fields.n.xyz * at.y + fields.u.xyz * at.z;
  o.loc = loc;
  o.dir = dir;
  o.info = info;
  o.edge = edge;
  o.work = work;
  return o;
}

fn wmod(x: vec2f, y: f32) -> vec2f {
  return x - y * floor(x / y);
}

fn hash(p: vec2f) -> f32 {
  return fract(sin(dot(wmod(p, 1024.0), vec2f(127.1, 311.7))) * 43758.5453);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2f(1.0, 0.0)), u.x), mix(hash(i + vec2f(0.0, 1.0)), hash(i + vec2f(1.0, 1.0)), u.x), u.y);
}

@fragment
fn fs(v: VsOut) -> @location(0) vec4f {
  // derivatives first: they need uniform control flow
  let fw = max(length(fwidth(v.loc)), 1e-3); // metres per pixel
  let foot = length(fwidth(v.rel));
  let dist = length(fields.eye.xyz - v.m);
  let hsh = v.info.y;
  let dir = normalize(v.dir);
  let perp = vec2f(-dir.y, dir.x);
  let along = dot(v.loc, dir);
  let a = dot(v.loc, perp) / ROW;
  let ph = 6.2832 * a;
  let fade = 1.0 - smoothstep(0.2, 0.5, fw / ROW); // the rows fade before they get finer than a pixel
  let ridge = 0.5 + 0.5 * sin(ph); // 0 in the furrow .. 1 on the ridge
  let pp = v.loc + hsh * 97.0;
  let blotch = noise(pp * 0.06) * 0.6 + noise(pp * 0.23) * 0.4;
  let fine = noise(pp * 1.7);
  // the calendar, in seasons, shifted a little for this field
  let u = (fields.eye.w + (hsh - 0.5) * JITTER) / SEASON;
  let dryYear = clamp(smoothstep(1.4, 2.2, u) + smoothstep(2.8, 3.1, u) + (1.0 - smoothstep(0.0, 0.5, u)), 0.0, 1.0);
  // the headland: a strip of grass along the edge, ragged
  let edge = v.edge + (noise(v.loc * 0.4 + hsh * 31.0) - 0.5) * 1.2;
  let hw = 2.0 + 2.0 * fract(hsh * 7.3);
  let headland = 1.0 - smoothstep(hw - 0.5, hw + 0.5, edge);
  let grass = mix(GRASS, FALLOW_DRY, dryYear * 0.7) * (0.86 + 0.28 * fine) * (0.92 + 0.16 * blotch);
  var col: vec3f;
  var amp = 0.0; // how high the ridges stand
  if (v.info.x > 0.5) {
    // ---- a field a farm works ----
    // the real work sweeps along the furrows from one end: sown, then (in autumn) cut
    let span = max(v.info.w - v.info.z, 1.0);
    var uh = (along - v.info.z) / span;
    if (hsh > 0.5) {
      uh = 1.0 - uh;
    }
    uh += (hash(vec2f(floor(a), hsh * 53.0)) - 0.5) * 0.012; // each furrow a little ahead or behind
    let aa = fw / span;
    let sown = v.work.x;
    let harv = v.work.y;
    let sownM = select((1.0 - smoothstep(sown - aa, sown + aa, uh)) * step(0.001, sown), 1.0, sown >= 0.999);
    var cut = select((1.0 - smoothstep(harv - aa, harv + aa, uh)) * step(0.001, harv), 1.0, harv >= 0.999);
    cut *= sownM;
    // the crop grows from the day its part was sown: later parts of the field start later
    let g = smoothstep(0.05 + 0.5 * uh, 1.7, u) * sownM; // the crop's growth
    let cov = clamp(mix(g * 0.55, 1.0, smoothstep(0.55, 1.0, g)), 0.0, 1.0);
    let ripe = smoothstep(1.7, 2.0, u);
    let lost = smoothstep(2.5, 2.62, u) * (1.0 - cut) * sownM; // the window closed on grain still standing: it lodges and rots
    let plough = clamp(smoothstep(2.7, 2.8, u) + smoothstep(3.0, 3.01, u) + (1.0 - smoothstep(-0.1, 0.0, u)), 0.0, 1.0);
    // soil: ridges dried, a little different in patches; ground not sown by midsummer greens with weeds
    var soil = mix(SOIL, SOIL_DRY, ridge * 0.6 * fade + 0.2 * blotch) * (0.9 + 0.2 * blotch);
    soil = mix(soil, grass * 0.9, smoothstep(1.15, 1.9, u) * (1.0 - sownM) * (0.35 + 0.3 * blotch));
    // the crop in rows on the ridges, or covering all of it when dense
    let t = ridge + 0.15 * (fine - 0.5);
    let rows = smoothstep(1.0 - cov * 1.15 - 0.08, 1.0 - cov * 1.15 + 0.08, t) * smoothstep(0.0, 0.05, g);
    var mask = mix(cov * 0.8 * smoothstep(0.0, 0.05, g), rows, fade);
    var crop = mix(SHOOT, CROP, smoothstep(0.1, 0.7, g));
    crop = mix(crop, RIPE, ripe) * (0.88 + 0.24 * blotch) * (0.94 + 0.12 * fine);
    // lost grain: dull dark brown, flattened (the rows blur into a mat)
    crop = mix(crop, STUBBLE * 0.7 * (0.85 + 0.3 * blotch), lost * 0.85);
    mask = mix(mask, max(mask, 0.9), lost);
    let standing = mix(soil, crop, mask);
    // the cut part
    let dash = smoothstep(0.35, 0.65, noise(vec2f(along * 1.4, floor(a) * 7.0)));
    let stubble = mix(STRAW * (0.92 + 0.14 * fine), STUBBLE, ridge * 0.55 * dash * fade + 0.1 * (1.0 - fade)) * (0.9 + 0.16 * blotch);
    col = mix(standing, stubble, cut);
    col = mix(col, soil, plough);
    amp = mix(1.0, 0.45, cov * (1.0 - cut) * (1.0 - plough)) * mix(1.0, 0.5, cut * (1.0 - plough)) * mix(1.0, 0.3, lost * (1.0 - plough));
    col = mix(col, grass, headland);
    amp *= 1.0 - headland;
  } else {
    // ---- fallow: grass and weeds, no rows ----
    col = mix(FALLOW, FALLOW_DRY, dryYear) * (0.84 + 0.32 * blotch) * (0.92 + 0.16 * fine);
    col = mix(col, grass, headland * 0.5);
    col = mix(col, FALLOW_DRY * 1.05, smoothstep(0.62, 0.8, noise(pp * 0.3 + 11.0)) * 0.35);
  }
  // light: the ridges as a fake normal, the furrow bottoms a little darker
  let sunStr = fields.light.w;
  let slope = cos(ph) * 0.75 * amp * fade;
  let n = normalize(vec3f(-perp * slope, 1.0));
  let lit = sunShadow(v.rel, fields.u.xyz);
  let shade = mix(0.55, clamp(dot(n, fields.light.xyz) / max(fields.light.z, 0.25), 0.55, 1.35), lit);
  col *= shadowInk(lit, 1.0) * shade * (1.0 - 0.22 * (1.0 - ridge) * amp * fade) * mix(0.86, 1.0, sunStr);
  // the ground's weather: snow settles in the furrows first and leaves the ridges standing out; wet ground darkens
  let gw = groundWeather(v.rel, v.m.z);
  let thr = 0.5 + 0.5 * sin(ph) * amp * fade;
  let cover = smoothstep(thr * 0.7 - 0.05 + (blotch - 0.5) * 0.25, thr * 0.7 + 0.2 + (blotch - 0.5) * 0.25, gw.x * 1.1);
  col = mix(col, weather.snowCol.rgb * mix(0.9, 1.0, shade * 0.5) * mix(0.86, 1.0, sunStr), cover);
  col *= 1.0 - 0.3 * gw.y * (1.0 - cover);
  col *= mix(NIGHT, vec3f(1.0), fields.look.x) * cloudDim(cloudShade(v.rel, fields.u.xyz, foot));
  let far = fields.look.z;
  let alpha = fields.look.y * (1.0 - smoothstep(far * 0.75, far, dist)) * smoothstep(0.0, 0.8, v.edge + (noise(v.loc * 0.7) - 0.5) * 0.5 + 0.15);
  return vec4f(col * alpha, alpha);
}
