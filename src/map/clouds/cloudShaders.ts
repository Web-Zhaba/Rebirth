import { PALETTE } from "../../ui/palette";
import { FLASH_MAX } from "./lightning";

// GLSL of the volumetric clouds (PLAN-clouds.md section 5). Plain three ShaderMaterial sources (no glslVersion: three
// prefixes `#version 300 es`, maps `gl_FragColor` / `texture2D`, and declares `precision highp sampler3D / samplerCube`).
// Everything samples with textureLod: implicit derivatives inside the data-dependent loops would not compile on ANGLE.
//
// Frame: MapLibre unit sphere (radius 1 = planet, +Y north, +Z toward 0E 0N); see frame.ts.
// Structure of MARCH_FRAG:
//   1. ray from inverse(mainMatrix), clipped to the shell [uRBase, uRTop] and cut by the planet
//   2. density():    cube cover remapped by the base noise x height profile (sheet / tower / anvil), eroded by detail noise
//   3. shaftDensity(): precipitation column below the base, the same noise stretched down to the ground
//   4. lightOptDepth(): short march toward the sun, planetShadow(): ray-sphere test with a soft terminator
//   5. shade(): palette grading (lit / ink-blue shade / night dusk / warn terminator / rain pencil / snow ice) + lightning
//   6. main(): coarse steps in empty air, fine steps inside, early exit under 0.02 transmittance, IGN jitter

export const MAX_MARCH_STEPS = 80;
export const MAX_LIGHT_STEPS = 6;

const vec3 = (hex: string) => {
  const c = (i: number) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4);
  return `vec3(${c(1)}, ${c(3)}, ${c(5)})`;
};

// Palette greys: ink-blue is `info` pulled toward `ink` and desaturated; computed here so the GLSL stays plain.
const mixHex = (a: string, b: string, t: number): number[] => {
  const p = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [1, 3, 5].map((i) => p(a, i) * (1 - t) + p(b, i) * t);
};
const inkBlue = (() => {
  const m = mixHex(PALETTE.info, PALETTE.ink, 0.35);
  const l = 0.3 * m[0] + 0.59 * m[1] + 0.11 * m[2];
  return m.map((v) => v * 0.6 + l * 0.4);
})();
const glslVec3 = (v: number[]) => `vec3(${v.map((x) => x.toFixed(4)).join(", ")})`;

export const FULLSCREEN_VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const MARCH_FRAG = /* glsl */ `
precision highp float;
precision highp int;

#define MAX_STEPS ${MAX_MARCH_STEPS}
#define MAX_LIGHT ${MAX_LIGHT_STEPS}
#define MAX_FLASH ${FLASH_MAX}

uniform mat4 uInv;              // inverse(main matrix), unit sphere -> clip
uniform vec3 uSun;              // unit vector toward the sun
uniform samplerCube uCubeA;     // weather cube: R cover, G type, B precip, A sea-level temperature (T + 40) / 80
uniform samplerCube uCubeB;
uniform float uMix;             // 0 = A, 1 = B
uniform highp sampler3D uBase;  // 64^3: R perlin-worley, G/B worley fbm
uniform highp sampler3D uDetail;// 32^3 worley fbm
uniform float uDetailOn;        // 1 = erode the edges with the detail noise
uniform vec3 uWind;             // degrees of longitude per game day: x westerlies, y trades, z layer period (days)
uniform float uDays;            // game days
uniform float uRBase;           // shell radii, planet = 1
uniform float uRTop;
uniform int uSteps;
uniform int uLightSteps;
uniform vec4 uFlash[MAX_FLASH]; // xyz direction of a lightning strike, w intensity
uniform int uFlashCount;
uniform float uOrbit;           // 1 on the whole-globe views, 0 from zoom ~3.4: large systems come from the cube, noise only at edges

varying vec2 vNdc;

const float PI = 3.14159265;
const float SIGMA_CLOUD = 2400.0;   // extinction per unit length at density 1
const float SIGMA_SHAFT = 1500.0;
const float BASE_SCALE = 5.0;       // noise tiles per unit length: one base tile is about 1270 km, its cells about 320 km
const float DETAIL_SCALE = 40.0;    // detail tile about 160 km
const float SHAPE_MEAN = 0.60;      // measured mean / spread of 0.45 R + 0.3 G + 0.25 B of the base volume
const float SHAPE_SPREAD = 0.12;
const float DETAIL_MEAN = 0.48;     // same for 0.6 R + 0.3 G + 0.1 B of the detail volume
const float DETAIL_SPREAD = 0.19;

const vec3 LIT = ${vec3(PALETTE.paperRaised)};
const vec3 SHADE = ${glslVec3(inkBlue)};
// night clouds: dusk pulled most of the way toward paper, so they sit close to the map's own value instead of being ink
const vec3 NIGHT = mix(${vec3(PALETTE.dusk)}, ${vec3(PALETTE.paperRaised)}, 0.74);
const vec3 WARM = ${vec3(PALETTE.warn)};
const vec3 RAIN = ${vec3(PALETTE.pencil)};
const vec3 ICE = ${vec3(PALETTE.mapIce)};

float sstep(float a, float b, float x) {
  float t = clamp((x - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

// interleaved gradient noise (Jimenez): needs no texture, static for a static camera
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

vec3 unproj(vec2 ndc, float z) {
  vec4 p = uInv * vec4(ndc, z, 1.0);
  return p.xyz / p.w;
}

vec4 weather(vec3 d) {
  return mix(textureLod(uCubeA, d, 0.0), textureLod(uCubeB, d, 0.0), uMix);
}

// ---- wind drift: two noise layers rotated about the polar axis, cross-faded every layerDays (bounded shear) ----

float zonalDeg(float absSinLat) {
  // weather.ts zonal(): trades inside 24 degrees, westerlies beyond 36; sin(24) = 0.4067, sin(36) = 0.5878
  return uWind.y + (uWind.x - uWind.y) * sstep(0.4067, 0.5878, absSinLat);
}

vec3 spinY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c);
}

// phase k in {0, 1}: age of the layer in days and its weight; the two weights satisfy w0^2 + w1^2 = 1
void layerPhase(int k, out float tau, out float w) {
  float P = uWind.z;
  float shifted = uDays + float(k) * 0.5 * P;
  tau = shifted - floor(shifted / P) * P;
  w = sin(PI * tau / P);
}

// Noise lookup for layer k at point p (unit sphere frame): rotate west by the drift so the pattern moves east.
vec3 noiseCoord(vec3 p, float tau, int k) {
  float a = radians(zonalDeg(abs(p.y / length(p))) * tau);
  vec3 q = spinY(p, -a);
  return q + (k == 0 ? vec3(0.0) : vec3(0.37, 0.61, 0.23));
}

// ---- density ----

float heightProfile(float h, float type, float precip, float top) {
  // sheets: low and thin
  float sheet = sstep(0.0, 0.12, h) * (1.0 - sstep(0.2, 0.42, h));
  // towers: tall, tops climb with precipitation
  float tower = sstep(0.0, 0.1, h) * (1.0 - sstep(top - 0.32, top, h));
  return mix(sheet, tower, sstep(0.25, 0.7, type));
}

// cover (0..1) is already the mixed cube value; fine = erode with the detail noise
float cloudDensity(vec3 p, vec3 d, float h, vec4 w, bool fine, float t0, float w0, float t1, float w1) {
  float type = w.g;
  float precip = w.b;
  if (w.r < 0.08) return 0.0;
  float top = 0.5 + 0.5 * type * (0.35 + 0.65 * precip);

  vec3 b0 = textureLod(uBase, noiseCoord(p, t0, 0) * BASE_SCALE * (1.0 - 0.45 * uOrbit), 0.0).rgb;
  vec3 b1 = textureLod(uBase, noiseCoord(p, t1, 1) * BASE_SCALE * (1.0 - 0.45 * uOrbit), 0.0).rgb;
  float shapeN = (w0 * (0.45 * b0.x + 0.3 * b0.y + 0.25 * b0.z - SHAPE_MEAN) + w1 * (0.45 * b1.x + 0.3 * b1.y + 0.25 * b1.z - SHAPE_MEAN)) / SHAPE_SPREAD; // about -1.5 .. 1.5

  // the noise also lifts and lowers the cloud top, so a solid overcast still has relief to shade
  float prof = heightProfile(h - shapeN * 0.13, type, precip, top);
  if (prof < 0.01) return 0.0;

  // anvil: towers with rain spread sideways under their top
  float anvil = sstep(0.55, 0.85, type) * sstep(0.35, 0.8, precip) * sstep(top - 0.3, top - 0.12, h) * (1.0 - sstep(top - 0.05, top, h));

  // close views: cover plus noise (cumulus puffs)
  float v = w.r - 0.05 + shapeN * 0.28 + anvil * 0.35;
  float close = sstep(0.3, 1.3, v);
  // orbit views (Nubis remap): shape = remap(noise, 1 - cover, 1, 0, 1). Cover near 1 fills in to a deck, mid cover
  // breaks into a cumulus field, low cover leaves a few small cells; the cube cover decides the large features.
  float s = clamp(0.5 + shapeN * 0.28 + anvil * 0.2, 0.0, 1.0);
  float cov = clamp(w.r * 1.08, 0.0, 1.0);
  float deck = clamp((s - (1.0 - cov)) / max(cov, 0.06), 0.0, 1.0);
  deck = deck * deck * (3.0 - 2.0 * deck);
  deck = max(deck, 0.62 * sstep(0.78, 0.97, w.r) * (0.75 + 0.25 * s));   // overcast: a continuous sheet with soft relief
  float dens = mix(close, deck, uOrbit) * prof;
  if (dens <= 0.0) return 0.0;

  if (fine && uDetailOn > 0.5) {
    vec3 c0 = noiseCoord(p, t0, 0) * DETAIL_SCALE;
    vec3 c1 = noiseCoord(p, t1, 1) * DETAIL_SCALE;
    vec3 a = textureLod(uDetail, c0, 0.0).rgb;
    vec3 b = textureLod(uDetail, c1, 0.0).rgb;
    float n0 = 0.6 * a.r + 0.3 * a.g + 0.1 * a.b;
    float n1 = 0.6 * b.r + 0.3 * b.g + 0.1 * b.b;
    float detailN = (w0 * (n0 - DETAIL_MEAN) + w1 * (n1 - DETAIL_MEAN)) / DETAIL_SPREAD;   // about -1.5 .. 1.5
    float erode = clamp(0.32 - detailN * 0.32, 0.0, 0.75) * (0.7 + 0.5 * h) * mix(1.0, 0.3, uOrbit);
    dens = clamp((dens - erode) / (1.0 - erode), 0.0, 1.0);
  }
  return dens;
}

// Precipitation column under a precipitating cloud: the density of the cloud base above it, fading toward the ground.
float shaftDensity(vec3 d, float r, vec4 w, float t0, float w0, float t1, float w1) {
  if (w.b < 0.04 || w.r < 0.3) return 0.0;
  float hl = (r - 1.0) / (uRBase - 1.0);
  vec3 above = d * uRBase;
  float base = cloudDensity(above, d, 0.14, w, false, t0, w0, t1, w1);
  if (base <= 0.0) return 0.0;
  // streaks: fine noise that depends on the direction only, so it is stretched all the way down
  vec3 sc = noiseCoord(d, t0, 0) * 90.0;
  float streak = textureLod(uDetail, sc, 0.0).r;
  return base * sstep(0.04, 0.4, w.b) * mix(0.35, 1.0, hl) * (0.55 + 0.9 * streak) * 0.55;
}

// ---- light ----

float opticalDepthToSun(vec3 p, float t0, float w0, float t1, float w1) {
  float od = 0.0;
  float ls = 0.0016;
  vec3 pp = p;
  for (int j = 0; j < MAX_LIGHT; j++) {
    if (j >= uLightSteps) break;
    pp += uSun * (ls * 0.5);
    float r = length(pp);
    if (r > uRTop) break;
    if (r > uRBase) {
      vec3 d = pp / r;
      vec4 w = weather(d);
      float h = (r - uRBase) / (uRTop - uRBase);
      od += cloudDensity(pp, d, h, w, false, t0, w0, t1, w1) * ls * SIGMA_CLOUD;
    }
    pp += uSun * (ls * 0.5);
    ls *= 1.6;
  }
  return od;
}

// 1 where the sun reaches p, 0 inside the planet's shadow cylinder, soft across the terminator
float planetShadow(vec3 p) {
  float s = dot(p, uSun);
  float perp = length(p - uSun * s);
  // continuous across s = 0 (a hard switch there left a visible vertical seam on the terminator)
  return mix(sstep(0.97, 1.035, perp), 1.0, sstep(0.0, 0.08, s));
}

float hgPhase(float g, float c) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

// Colour of the scattered light in a sample: tone 0..1 picks ink-blue shade -> lit paper, then grading.
vec3 shade(vec3 d, float h, vec4 w, float sunE, float vis, float amb, float cosView) {
  float day = sstep(-0.3, 0.3, dot(d, uSun));
  float tone = clamp(sunE + amb * (0.4 + 0.6 * day), 0.0, 1.0);
  vec3 shadeC = mix(NIGHT, SHADE, vis);   // twilight: the shade colour fades to the night grey instead of going ink-dark
  vec3 col = mix(shadeC, LIT, sstep(0.05, 0.85, tone));
  // night: the dusk colour, fading in with the planet's shadow
  col = mix(NIGHT * (0.84 + 0.12 * h + 0.22 * tone), col, vis);
  // soft warm band along the terminator, on the lit side
  float bx = (dot(d, uSun) - 0.06) / 0.11;
  float band = exp(-bx * bx);
  col = mix(col, WARM * (0.85 + 0.6 * tone), band * 0.32 * vis * tone);
  // rain is greyer and darker, snow is cool white
  float wet = sstep(0.08, 0.55, w.b);
  float lum = dot(col, vec3(0.3, 0.59, 0.11));
  col = mix(col, mix(vec3(lum) * vec3(0.86, 0.9, 0.97), RAIN * (0.75 + 0.55 * tone), 0.25) * mix(0.85, 1.0, vis), wet * 0.6);
  float temp = w.a * 80.0 - 40.0;
  float snow = wet * (1.0 - sstep(-1.0, 3.0, temp));
  col = mix(col, ICE * vec3(0.93, 0.97, 1.0) * mix(0.35, 1.0, tone * vis + 0.25), snow * 0.65);
  return col;
}

vec3 lightning(vec3 p, vec3 d) {
  if (uFlashCount == 0) return vec3(0.0);
  float night = 1.0 - sstep(-0.15, 0.2, dot(d, uSun));
  float boost = mix(0.1, 2.2, night);
  float e = 0.0;
  for (int f = 0; f < MAX_FLASH; f++) {
    if (f >= uFlashCount) break;
    vec3 c = uFlash[f].xyz * (uRBase + 0.4 * (uRTop - uRBase));
    vec3 dv = p - c;
    e += uFlash[f].w * exp(-dot(dv, dv) / (2.0 * 0.016 * 0.016));
  }
  return vec3(0.55, 0.7, 1.0) * e * boost * 0.7;
}

void main() {
  vec3 n = unproj(vNdc, -1.0);
  vec3 f = unproj(vNdc, 1.0);
  vec3 rd = normalize(f - n);

  // clip the ray to the shell and to the planet
  float b = dot(n, rd);
  vec3 q = n - rd * b;                         // closest approach: well conditioned near the limb
  float q2 = dot(q, q);
  float dTop = uRTop * uRTop - q2;
  if (dTop <= 0.0) { gl_FragColor = vec4(0.0); return; }
  float sq = sqrt(dTop);
  float tA = max(-b - sq, 0.0);
  float tB = -b + sq;
  float dPl = 1.0 - q2;
  if (dPl > 0.0) {
    float tp = -b - sqrt(dPl);
    if (tp > 0.0) tB = min(tB, tp);
  }
  float len = tB - tA;
  if (len <= 0.0) { gl_FragColor = vec4(0.0); return; }

  float t0, w0, t1, w1;
  layerPhase(0, t0, w0);
  layerPhase(1, t1, w1);

  float dtF = clamp(len / (0.6 * float(uSteps)), 0.0003, 0.0035);   // capped: long grazing rays would stair-step in big strides
  float t = tA + dtF * (0.2 + 0.6 * ign(gl_FragCoord.xy));
  float T = 1.0;
  vec3 col = vec3(0.0);
  float cosView = dot(rd, uSun);
  float phase = 0.7 + 0.3 * min(4.0 * PI * mix(hgPhase(-0.3, cosView), hgPhase(0.6, cosView), 0.35), 4.0);

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps || t >= tB || T < 0.02) break;
    vec3 p = n + rd * t;
    float r = length(p);
    vec3 d = p / r;
    vec4 w = weather(d);

    bool inCloud = r >= uRBase;
    float h = inCloud ? (r - uRBase) / (uRTop - uRBase) : (r - 1.0) / (uRBase - 1.0);
    float dens = inCloud ? cloudDensity(p, d, h, w, true, t0, w0, t1, w1) : shaftDensity(d, r, w, t0, w0, t1, w1);
    if (dens <= 0.001) {
      t += dtF * 1.6;            // empty air: coarse step
      continue;
    }

    float vis = planetShadow(p);
    float sunE = 0.0;
    float amb;
    if (inCloud) {
      float od = vis > 0.0 ? opticalDepthToSun(p, t0, w0, t1, w1) : 1e3;
      float lightT = max(exp(-od * 0.5), 0.5 * exp(-od * 0.08));   // light extinguishes slower than the view ray: multiple scattering
      float powder = mix(1.0, 1.0 - exp(-dens * 5.0), 0.5);
      sunE = vis * lightT * phase * 0.95 * powder;
      amb = mix(0.14, 0.52, h);
    } else {
      sunE = vis * 0.5 * phase * 0.6;
      amb = 0.4;
    }
    vec3 c = shade(d, inCloud ? h : 0.0, w, sunE, vis, amb, cosView);
    if (!inCloud) {
      // shafts: grey for rain, white for snow
      float temp = w.a * 80.0 - 40.0;
      float snow = 1.0 - sstep(-1.0, 3.0, temp);
      c = mix(mix(RAIN * 1.15, c, 0.35), ICE, snow * 0.7) * mix(0.5, 1.0, vis);
    }
    c += lightning(p, d) * (inCloud ? 1.0 : 0.25);

    float sig = inCloud ? SIGMA_CLOUD : SIGMA_SHAFT;
    float ext = dens * sig * dtF;
    float a = (1.0 - exp(-ext)) * mix(0.6, 1.0, vis);   // night clouds are thinner: less contrast against the lit map
    col += T * a * c;
    T *= 1.0 - a;
    t += dtF;
  }
  gl_FragColor = vec4(col, 1.0 - T);
}`;

// Composite: the premultiplied render target (bilinear) times the zoom fade, blended ONE / ONE_MINUS_SRC_ALPHA.
export const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tMap;
uniform float uFade;
uniform vec2 uTexel;   // 1 / target size
varying vec2 vNdc;
void main() {
  // bilinear fetches of the premultiplied target, five of them: the half-resolution grain and stair steps blur out
  vec2 uv = vNdc * 0.5 + 0.5;
  vec4 c = texture2D(tMap, uv) * 0.36;
  c += texture2D(tMap, uv + uTexel * vec2(0.8, 0.8)) * 0.16;
  c += texture2D(tMap, uv + uTexel * vec2(-0.8, 0.8)) * 0.16;
  c += texture2D(tMap, uv + uTexel * vec2(0.8, -0.8)) * 0.16;
  c += texture2D(tMap, uv + uTexel * vec2(-0.8, -0.8)) * 0.16;
  gl_FragColor = c * uFade;
}`;
