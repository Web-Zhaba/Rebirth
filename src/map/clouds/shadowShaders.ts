import { DRIFT_DEG, NOISE_TILE_M, OVERCAST_MAX, SHADOW_MAX, SUN_FULL_DEG, SUN_OFF_DEG } from "./shadowMath";
import { EARTH_RADIUS_M } from "../three/frame";

// GLSL of the ground-shadow layer. The maths mirrors shadowMath.ts (offset, drift, darkening); keep them in step.
// three prepends `#version 300 es`, the precision lines and the texture2D/textureCube -> texture and gl_FragColor aliases.

const f = (x: number) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

export const SHADOW_VERT = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

export const SHADOW_FRAG = /* glsl */ `
precision highp float;
uniform mat4 uInv;        // mercator: inverse of the local metre matrix
uniform vec3 uCam;        // globe: camera position and the double-precision ray basis (see rayBasis in shadowMath.ts)
uniform vec3 uRayA;
uniform vec3 uRayB;
uniform vec3 uRayC;
uniform float uCamC;      // |cam|^2 - 1, from doubles
uniform float uMode;      // 0 globe, 1 mercator
uniform vec3 uSun;        // unit vector to the sun, MapLibre frame
uniform float uHeight;    // metres the shadow-casting cloud sits at (zoom-faded exaggeration applied)
uniform samplerCube tCubeA;
uniform samplerCube tCubeB;
uniform float uMix;
uniform sampler3D tBase;
uniform vec2 uW;          // normalised drift weights
uniform vec2 uTau;        // drift days of the two layers
uniform vec3 uOff0;       // tile offsets
uniform vec3 uOff1;
uniform vec3 uDusk;
uniform float uBoost;     // dev knob (layer.boost), 1 in production
// mercator mode: local frame at the origin (east, north in metres from the origin)
uniform vec3 uO;
uniform vec3 uE;          // east unit vector * (true-metre factor / R)
uniform vec3 uN;
uniform vec2 uSunOff;     // metres towards the sun, local east/north
uniform float uSunMerc;   // sun strength at the origin
uniform vec3 uF0;         // layer 0 noise coordinate of the origin, tile units
uniform vec3 uE0;         // layer 0 d(noise coordinate)/d(east metre), tile units
uniform vec3 uN0;
uniform vec3 uF1;
uniform vec3 uE1;
uniform vec3 uN1;
varying vec2 vNdc;

const float R = ${f(EARTH_RADIUS_M)};
const float TILE = ${f(NOISE_TILE_M)};
const float RAD = 0.017453292519943295;
const float SUN_OFF = ${Math.sin((SUN_OFF_DEG * Math.PI) / 180)};
const float SUN_FULL = ${Math.sin((SUN_FULL_DEG * Math.PI) / 180)};
const float DRIFT = ${f(DRIFT_DEG)};
const float SHADOW_MAX = ${f(SHADOW_MAX)};
const float OVERCAST_MAX = ${f(OVERCAST_MAX)};
const float NOISE_MEAN = 0.48; // base volume G (Worley fbm from 4 cells per tile): mean 0.48, 5..95% = 0.29..0.68
const float STRETCH = 2.2;    // widen it to about 0.1..0.9 so the patches have contrast

vec3 unproj(mat4 inv, vec2 ndc, float z) {
  vec4 p = inv * vec4(ndc, z, 1.0);
  return p.xyz / p.w;
}

vec3 rotPolar(vec3 v, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}

void main() {
  vec3 d;      // unit direction of the shadow-casting point
  vec3 p0;     // noise coordinates, tile units
  vec3 p1;
  float sun;
  float detail = 1.0;
  if (uMode < 0.5) {
    vec3 n = uCam;
    vec3 rd = normalize(uRayA + vNdc.x * uRayB + vNdc.y * uRayC);
    float b = dot(n, rd);
    float disc = b * b - uCamC;
    if (disc < 0.0) { gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); return; }
    float t = -b - sqrt(disc);
    if (t < 0.0) { gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); return; }
    vec3 g = normalize(n + rd * t);
    detail = 1.0 - smoothstep(TILE / 16.0, TILE / 6.0, length(fwidth(g)) * R);
    float sinEl = dot(g, uSun);
    sun = smoothstep(SUN_OFF, SUN_FULL, sinEl);
    if (sun <= 0.0) { gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); return; }
    float tanEl = sinEl * inversesqrt(max(1.0 - sinEl * sinEl, 1e-6));
    float delta = uHeight / tanEl / R;
    vec3 tang = normalize(uSun - sinEl * g);
    d = normalize(g * cos(delta) + tang * sin(delta));
    p0 = rotPolar(d, -DRIFT * uTau.x * RAD) * (R / TILE) + uOff0;
    p1 = rotPolar(d, -DRIFT * uTau.y * RAD) * (R / TILE) + uOff1;
  } else {
    vec3 n = unproj(uInv, vNdc, -1.0);
    vec3 fp = unproj(uInv, vNdc, 1.0);
    float tz = -n.z / (fp.z - n.z);
    if (tz < 0.0 || tz > 1.0) { gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); return; }
    vec2 q = (n + (fp - n) * tz).xy + uSunOff;
    sun = uSunMerc;
    d = normalize(uO + q.x * uE + q.y * uN);
    p0 = uF0 + q.x * uE0 + q.y * uN0;
    p1 = uF1 + q.x * uE1 + q.y * uN1;
  }
  vec4 c = textureCube(tCubeA, d);
  if (uMix > 0.001) c = mix(c, textureCube(tCubeB, d), uMix);
  float cover = c.r;
  float type = c.g;
  if (cover < 0.03) { gl_FragColor = vec4(1.0, 1.0, 1.0, 1.0); return; }
  float nv = 0.5 + uW.x * (texture(tBase, p0).g - NOISE_MEAN) + uW.y * (texture(tBase, p1).g - NOISE_MEAN);
  nv = clamp(0.5 + (nv - 0.5) * STRETCH, 0.0, 1.0);
  float th = 1.0 - cover;
  float pat = (detail * smoothstep(th - 0.12, th + 0.12, nv) + (1.0 - detail) * cover) * smoothstep(0.05, 0.3, cover);
  float thick = smoothstep(0.45, 0.95, cover);
  float a = min(1.0, uBoost * sun * (SHADOW_MAX * type * pat + OVERCAST_MAX * thick));
  // Multiply towards dusk: dst * (1 - a * (1 - dusk)); blended as DstColor / Zero.
  gl_FragColor = vec4(1.0 - a * (1.0 - uDusk), 1.0);
}`;
