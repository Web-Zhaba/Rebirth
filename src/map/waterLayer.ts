import type * as maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  DoubleSide,
  LessEqualDepth,
  Matrix4,
  Mesh,
  NoBlending,
  NormalBlending,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import { calendar } from "../sim/clock";
import { roads as roadGraph } from "../simClient";
import type { WeatherState } from "../sim/weather";
import { mixHex, PALETTE } from "../ui/palette";
import type { Frame as TownFrame } from "../world/frame";
import { pointInRings } from "../world/landcover";
import { lngLatToTile, metersPerPixel } from "../world/mercator";
import { NATURE_MAXZOOM, WATERWAY_HALF_M, WATERWAY_ZOOM } from "../world/nature";
import { getLandTile, getWaterwayTile } from "../world/tiles";
import { chunksInView } from "./chunkView";
import {
  motionOn,
  motionTime,
  requestMapAnimation,
  showWhile,
  water3dOn,
} from "./graphicsSettings";
import { roadChains } from "./roadChains";
import { mercatorLocal, projectPoints } from "./modelBuffers";
import { rgb, type XY } from "./modelGeometry";
import { frameSetter, type ModelLayerOptions } from "./modelLayer";
import { groundAt, loadGround, reliefScale, skyColours } from "./relief";
import { eyeOf, frustumPlanes, mercatorToLngLat } from "./three/frame";
import { acquireHost, type ThreeHost } from "./three/host";
import {
  bridgePiers,
  buildWaterChunk,
  FLOW_REACH,
  nearestPiers,
  realShores,
  runsOutside,
  SHORE_CAP,
  steamStrength,
  tileWater,
  type Box,
  type Pier,
  type TileWater,
  type Waterway,
} from "./waterMesh";
import { iceOpacity, snowOpacity, weatherCoverVisibility, WIND_DIR } from "./weatherMath";
import { weatherMapOn } from "./weatherSettings";

// The 3D water (PLAN-3d-world.ru.md stage 5): the water polygons of the landcover tiles (the same the 2D water fill
// and the game read) and the streams of the waterway tiles, drawn by three.js over the 2D water, which stays under it
// and beyond its reach. Import only with a dynamic `import()` (it pulls in three.js).
//
// The surface lies in square chunks built one by one on a grid of cells, finer near the camera (waterMesh.ts). Large
// water polygons stay on their own smooth water plane and share MapLibre's 3D depth buffer with terrain. On relief a
// lake or river polygon is level at
// its shores: the DEM holds the bed of the large ones (a reservoir shows its drowned river channel), so the surface
// takes the median height of its own shore around each corner of the chunk grid, between them bilinear (no steps
// between chunks, a gentle slope along a river; a pond above a reservoir keeps its own level), and never below the
// ground geometry; terrain above the computed water surface simply occludes it. Streams follow the rendered terrain
// along their line. The shader ripples it with the wind (calm water is a mirror), lets the rivers flow along their lines,
// reflects the sky with the angle (Fresnel), glints with the sun and the moon, lightens the shallows and edges the
// shore, rings with the rain, freezes and takes the snow with the weather, and fades into the flat water of the map at
// its far edge and as it comes in with the zoom.
//
// Two small extras: foam and a wake around the piers of built bridges (bridgePiers: the nearest PIERS of them to the
// camera go to the shader as a uniform array; the foam ring hugs the pier and a streaky wake runs downstream along the
// local flow), and a cheap stand-in for the reflection of the shore: the shore's tone (forest or ground, a vertex
// attribute read from the landcover behind the shore) as a streak in the sky's reflection, fading with the distance
// from the shore, wobbling with the ripples, strongest in calm water, off under rain, wind and ice.

export const WATER_LAYER_ID = "water-3d";
export const WATER_FROM_ZOOM = 13; // closer than this the water is 3D
const WATER_FULL_ZOOM = 13.6; // from here it no longer fades into the flat water
const SIZE = 800; // m, side of a chunk
const CELLS = [20, 40, 160, 800]; // m per level of detail, nearest first (dividing SIZE: chunks of a level meet vertex to vertex)
const LEVEL_TO = [1200, 4000, 12_000]; // m from the camera: the farthest each level reaches
const FAR_CAP = 30_000; // m: no 3D water beyond
const RANGE = 150_000; // m from the founding point, as the forest (float32 offsets from the town stay at about a centimetre)
const SLOPE = 120; // m: the relief within a chunk or under an unknown chunk (exaggerated)
const LIFT = 0.06; // m above the computed water plane: only enough to avoid z-fighting
const LEVEL_REACH = [1200, 3000, 8000]; // m around a grid corner to find the shore that sets its water level, nearest first
const LEVEL_SAMPLES = 400; // shore points per corner at most
const MAX_WATER_LEVEL_DELTA = 18; // m: reject pathological DEM/shore outliers that would create spikes
const FRAME_BUDGET = 4; // ms of chunk building per frame
const MAX_CHUNKS = 1500; // cached; beyond it chunks unseen for a while are dropped
const RIVER: Record<string, { half: number; speed: number }> = { river: { half: WATERWAY_HALF_M, speed: 1 }, stream: { half: 2.5, speed: 0.6 } };
const WIND_FULL = 10; // m/s: full ripples
const RAIN_FULL = 4; // mm/h: rings everywhere
const PIERS = 32; // piers the shader takes at most (the nearest to the camera)
const PIER_REACH = 500; // m from the camera: farther the foam is faded out anyway
const TONES: Record<string, number> = { wood: 1, wetland: 0.6, rock: 0.3 }; // landcover class -> tone of the shore reflection
const TONE_PROBE_M = 25; // m: how far from a shore segment its land is looked at

const VERT = /* glsl */ `
attribute vec3 aG;
attribute vec3 aM;
attribute float aShore;
attribute vec2 aFlow;
attribute float aTone;
uniform mat4 uG;
uniform mat4 uM;
uniform float uT;
varying vec3 vM;
varying float vShore;
varying vec2 vFlow;
varying float vTone;
void main() {
  vec4 m = uM * vec4(aM, 1.0);
  vec4 g = uG * vec4(aG, 1.0);
  gl_Position = uT > 0.999 ? g : (uT <= 0.0 ? m : mix(m, g, uT));
  vM = aM;
  vShore = aShore;
  vFlow = aFlow;
  vTone = aTone;
}`;

const STEAM_LIFT = 0.8; // m above the water: the sheet of steam

// Steam: the same chunk geometry as a sheet lifted above the water and toward the camera the same way.
const STEAM_VERT = /* glsl */ `
attribute vec3 aG;
attribute vec3 aM;
attribute float aShore;
attribute vec2 aFlow;
uniform mat4 uG;
uniform mat4 uM;
uniform float uT;
varying vec3 vM;
varying float vShore;
varying vec2 vFlow;
void main() {
  vec3 up = vec3(0.0, 0.0, ${STEAM_LIFT.toFixed(2)});
  vec4 m = uM * vec4(aM + up, 1.0);
  vec4 g = uG * vec4(aG + up, 1.0);
  gl_Position = uT > 0.999 ? g : (uT <= 0.0 ? m : mix(m, g, uT));
  vM = aM + up;
  vShore = aShore;
  vFlow = aFlow;
}`;

// Wisps: domain-warped fbm in world metres, stretched along the wind and carried by it (and by a river's flow),
// thicker at the shore, thin looking straight down (it is a 2D sheet), fewer octaves with distance.
const STEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uEye;
uniform vec3 uSunDir;
uniform float uSun;
uniform vec4 uTint;
uniform vec2 uWindDir;
uniform float uWind;
uniform float uFar;
uniform float uIn;
uniform vec3 uHorizon;
uniform float uSteam;
varying vec3 vM;
varying float vShore;
varying vec2 vFlow;
float hash(vec2 p) {
  return fract(sin(dot(mod(p, 1024.0), vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p, int oct) {
  float s = 0.0, a = 0.5, tot = 0.0;
  for (int k = 0; k < 3; k++) {
    if (k >= oct) break;
    s += a * noise(p);
    tot += a;
    p = p * 2.03 + vec2(17.1, 9.3);
    a *= 0.5;
  }
  return s / tot;
}
void main() {
  float dist = length(uEye - vM);
  float reach = min(uFar * 0.6, 9000.0);
  float fadeFar = 1.0 - smoothstep(reach * 0.5, reach, dist);
  float fadeNear = smoothstep(2.0, 25.0, dist);
  float vz = abs(uEye.z - vM.z) / max(dist, 1.0);
  float looking = mix(0.3, 1.0, pow(1.0 - vz, 1.5)); // thicker along the surface than straight down
  bool river = dot(vFlow, vFlow) > 1e-4;
  vec2 vel = uWindDir * (0.3 + uWind * 1.5) + vFlow * 0.5; // m/s
  vec2 p = vM.xy - vel * uTime;
  vec2 q = vec2(dot(p, uWindDir) * 0.5, dot(p, vec2(-uWindDir.y, uWindDir.x))) / 14.0; // stretched along the wind
  int oct = dist < 350.0 ? 3 : (dist < 2500.0 ? 2 : 1);
  vec2 w = vec2(fbm(q * 0.8 + vec2(0.0, uTime * 0.02), oct), fbm(q * 0.8 + vec2(5.2, 1.3) - uTime * 0.015, oct));
  float n = fbm(q + (w - 0.5) * 2.2, oct); // curling
  float wisp = smoothstep(0.34, 0.68, n);
  float clumps = mix(0.4, 1.0, smoothstep(0.25, 0.7, noise(vM.xy * 0.004 + 3.0))); // bare stretches between banks of steam
  float shoreK = river ? 1.0 : mix(0.55, 1.0, 1.0 - smoothstep(0.0, 50.0, vShore));
  float lip = 0.5 + 0.5 * smoothstep(0.0, 3.0, vShore);
  float a = (0.2 + 0.8 * wisp) * wisp * clumps * shoreK * lip * looking * uSteam * fadeFar * fadeNear * uIn * 0.85;
  a *= mix(0.35, 1.0, uSun); // by night it is barely there
  vec3 col = mix(vec3(0.86, 0.9, 0.95), uHorizon * 1.15, 0.45);
  float warm = (1.0 - smoothstep(0.02, 0.4, uSunDir.z)) * uSun; // lit from the side at sunrise
  col = mix(col, vec3(1.0, 0.8, 0.62), warm * 0.55) * mix(0.4, 1.0, uSun) * (0.9 + 0.2 * wisp);
  col = mix(col, uTint.rgb, uTint.a);
  gl_FragColor = vec4(col * a, a); // premultiplied
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uEye;
uniform vec3 uLight;
uniform vec3 uSunDir;
uniform float uSun;
uniform vec4 uTint;
uniform vec2 uWindDir;
uniform float uWind;
uniform float uRain;
uniform float uIce;
uniform float uSnow;
uniform float uFar;
uniform float uIn;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uIceCol;
uniform vec3 uSnowCol;
uniform vec3 uFlat;
uniform vec3 uSky;
uniform vec3 uHorizon;
uniform vec3 uGroundTone;
uniform vec3 uForestTone;
uniform vec3 uPiers[${PIERS}];
uniform int uPierN;
varying vec3 vM;
varying float vShore;
varying vec2 vFlow;
varying float vTone;
float hash(vec2 p) {
  return fract(sin(dot(mod(p, 1024.0), vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// The slope of the wind ripples at p (m): a few waves about the wind and some noise, each faded out before it gets
// finer than a pixel (fw: metres per pixel), so the far water does not sparkle.
vec2 ripples(vec2 p, float t, float fw) {
  vec2 g = vec2(0.0);
  for (int k = 0; k < 4; k++) {
    float fk = float(k);
    float len = 7.0 / (1.0 + fk * 0.9);
    float a = (fk - 1.5) * 0.5;
    vec2 dir = vec2(uWindDir.x * cos(a) - uWindDir.y * sin(a), uWindDir.x * sin(a) + uWindDir.y * cos(a));
    float kw = 6.2832 / len;
    float fade = clamp(1.5 - fw * 4.0 / len, 0.0, 1.0);
    g += dir * cos(dot(dir, p) * kw - t * sqrt(9.8 * kw) + fk * 1.7) * 0.07 * fade;
  }
  vec2 q = p * 0.7 + uWindDir * t * 0.4;
  float fade = clamp(1.5 - fw * 4.0, 0.0, 1.0);
  float n0 = noise(q);
  g += vec2(noise(q + vec2(0.2, 0.0)) - n0, noise(q + vec2(0.0, 0.2)) - n0) * 0.6 * fade;
  return g;
}
// Long, slow swells and gusts of wind on the water (tens of metres): seen from afar, the sky's light shifts on them.
vec2 swells(vec2 p, float t) {
  vec2 side = vec2(-uWindDir.y, uWindDir.x);
  float a = sin(dot(p, uWindDir) * 0.035 - t * 0.34);
  float b = sin(dot(p, normalize(uWindDir + side * 0.55)) * 0.022 - t * 0.21 + 1.7);
  return (uWindDir * a + side * b * 0.45) * 0.022;
}
// Rings of raindrops (a little larger than life, to be seen from above): one a cell at a time, spreading and fading.
vec2 rain(vec2 p, float t, float fw) {
  vec2 g = vec2(0.0);
  for (int k = 0; k < 2; k++) {
    vec2 q = p + float(k) * vec2(1.7, 2.9);
    vec2 c = floor(q / 3.5);
    vec2 o = (c + 0.25 + 0.5 * vec2(hash(c + 3.1), hash(c + 7.7))) * 3.5;
    float age = fract(t * 0.7 + hash(c + float(k) * 11.0));
    vec2 dv = q - o;
    float r = length(dv);
    g += dv / max(r, 1e-3) * exp(-pow((r - age * 1.6) * 8.0, 2.0)) * (1.0 - age) * 0.7;
  }
  return g * clamp(1.5 - fw * 3.0, 0.0, 1.0);
}
void main() {
  float dist = length(uEye - vM);
  float fw = length(fwidth(vM.xy));
  float open = 1.0 - uIce;
  // rivers: the ripples carried along the flow, two phases crossfaded so they never stretch
  vec2 g;
  if (dot(vFlow, vFlow) > 1e-4) {
    float ph = fract(uTime * 0.15), w = abs(2.0 * ph - 1.0);
    g = mix(ripples(vM.xy - vFlow * ph * 5.0, uTime, fw), ripples(vM.xy - vFlow * fract(ph + 0.5) * 5.0 + 3.7, uTime, fw), w);
  } else g = ripples(vM.xy, uTime, fw);
  vec2 smallWaves = g * uWind;
  vec2 longWaves = swells(vM.xy, uTime) * (0.25 + uWind * 0.35);
  vec2 rainWaves = rain(vM.xy, uTime, fw) * uRain;
  g = (smallWaves + longWaves + rainWaves) * open;
  vec3 n = normalize(vec3(-g, 1.0));
  vec3 v = normalize(uEye - vM);
  float fres = 0.03 + 0.30 * pow(1.0 - max(dot(n, v), 0.0), 4.0);
  vec3 r = reflect(-v, n);
  vec3 sky = mix(uHorizon, uSky, smoothstep(0.0, 0.5, r.z)) * 0.92;
  // the shore in the reflection: its tone as a streak that fades out from the shore, longer at a low view, shaken by
  // the ripples, only on calm open water (vTone < 0: no shore data, as on the ribbons of streams)
  float calm = (1.0 - smoothstep(0.2, 0.75, uWind)) * (1.0 - uRain) * open * step(-0.01, vTone);
  if (calm > 0.0) {
    float reach = 5.0 + 28.0 * pow(1.0 - clamp(v.z, 0.0, 1.0), 2.0);
    float sd = max(vShore + dot(g, vec2(1.0, 0.6)) * 30.0, 0.0);
    float streak = exp(-sd / reach) * (1.0 - smoothstep(30.0, 60.0, vShore)) * (0.7 + 0.3 * noise(vec2(vM.x + vM.y, vM.x - vM.y) * 0.9 + g * 20.0));
    vec3 shoreCol = mix(uGroundTone, uForestTone, clamp(vTone, 0.0, 1.0));
    shoreCol = mix(shoreCol, uSnowCol * 0.8, uSnow * 0.7) * mix(0.25, 1.0, uSun);
    sky = mix(sky, shoreCol, streak * calm * 0.18);
  }
  // the body of the water: light in the shallows, deep away from the shore, a little lit by the sun
  vec3 body = mix(uShallow, uDeep, smoothstep(0.0, ${SHORE_CAP}.0, vShore)) * mix(0.9, 1.04, max(dot(n, uLight), 0.0)) * mix(0.9, 1.0, uSun);
  vec3 col = mix(body, sky, fres * (1.0 - 0.55 * uRain)); // restrained stylised reflection
  // glints: the sun, and by night the moon (opposite it)
  float s = max(dot(r, uSunDir), 0.0);
  col += vec3(1.0, 0.95, 0.85) * (pow(s, 400.0) * 3.0 + pow(s, 40.0) * 0.12) * uSun * smoothstep(-0.02, 0.1, uSunDir.z) * open;
  col += vec3(0.75, 0.8, 0.9) * pow(max(dot(r, -uSunDir), 0.0), 600.0) * 1.2 * (1.0 - uSun) * smoothstep(0.02, 0.15, -uSunDir.z) * open;
  // a light rim along the shore, broken up
  float rim = 1.0 - smoothstep(0.3, 2.5, vShore + noise(vM.xy * 0.35 + uTime * 0.15) * 1.6);
  col = mix(col, uFoam, rim * 0.65 * open);
  // foam around the piers of bridges: a ring hugging each, and a streaky wake downstream along the flow
  float pf = 0.0;
  for (int q = 0; q < ${PIERS}; q++) {
    if (q >= uPierN) break;
    vec3 pier = uPiers[q];
    vec2 dv = vM.xy - pier.xy;
    float pr = pier.z, reachw = pr * 7.0 + 6.0, d2 = dot(dv, dv);
    if (d2 > reachw * reachw) continue;
    float jag = noise(vM.xy * 0.9 + uTime * 0.6) * 0.8;
    float rr = sqrt(d2);
    // an annulus about the pier (the pier itself stands in the middle of it), broken into flecks
    float ringf = smoothstep(pr * 0.45, pr * 0.95, rr) * (1.0 - smoothstep(pr + 0.2, pr + 1.2 + jag, rr)) * smoothstep(0.25, 0.6, noise(vM.xy * 2.3 + uTime * 0.4) + 0.35);
    float wake = 0.0, sp = length(vFlow);
    if (sp > 0.05) {
      vec2 fd = vFlow / sp;
      float along = dot(dv, fd), across = dot(dv, vec2(-fd.y, fd.x));
      float wd = pr * (0.9 + along * 0.12);
      float body = step(0.0, along) * exp(-across * across / (wd * wd)) * exp(-along / (pr * 4.0 + 2.0));
      float streaks = noise(vec2(across * 1.6, along * 0.5 - uTime * (0.8 + sp * 1.5)));
      wake = body * smoothstep(0.35, 0.75, streaks + body * 0.35);
    }
    pf = max(pf, max(ringf * 0.8, wake * 0.7));
  }
  col = mix(col, uFoam, pf * (1.0 - smoothstep(150.0, 450.0, dist)) * open);
  // ice: pale, cracked, under patches of snow
  vec3 ice = uIceCol * mix(0.86, 1.0, noise(vM.xy * 0.04)) * (1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.04, abs(noise(vM.xy * 0.06) - 0.5))) * clamp(1.5 - fw * 2.0, 0.0, 1.0));
  ice = mix(ice, uSnowCol, uSnow * smoothstep(0.25, 0.75, noise(vM.xy * 0.12) + uSnow * 0.6));
  ice = mix(ice * mix(0.78, 1.0, max(uLight.z, 0.0)) * mix(0.85, 1.0, uSun), sky, fres * 0.2);
  col = mix(col, ice, uIce);
  // into the flat water of the map: while the zoom brings the 3D water in, and toward its far edge
  col = mix(col, uFlat, max(1.0 - uIn, smoothstep(uFar * 0.7, uFar, dist)));
  gl_FragColor = vec4(mix(col, uTint.rgb, uTint.a), 1.0);
}`;

export interface WaterLayerOptions {
  frame: ReadonlySignal<TownFrame | null>;
  light?: ModelLayerOptions["light"];
  weather: ReadonlySignal<WeatherState | null>;
}

interface Chunk {
  mesh: Mesh | null; // null: no water in it
  steam?: Mesh; // the sheet of steam over it: shares its geometry
  seen: number;
  stale: boolean;
}

const N12 = 2 ** NATURE_MAXZOOM, N14 = 2 ** WATERWAY_ZOOM;

export function createWaterLayer(map: maplibregl.Map, opts: WaterLayerOptions): maplibregl.CustomLayerInterface {
  let host: ThreeHost | null = null;
  let scene: Scene | null = null;
  let mat: ShaderMaterial | null = null;
  let steamMat: ShaderMaterial | null = null;
  let steamNow = 0; // strength of the steam this frame
  let steamForce: number | null = null; // devtools override
  let origin: { lng: number; lat: number } | null = null;
  let tilesFor: TownFrame | null = null;
  let frameNo = 0;
  const stops: (() => void)[] = [];
  const chunks = new Map<string, Chunk>(); // "i,j,level"
  const shown = new Set<Mesh>();
  // tiles in town metres
  const land = new Map<string, (TileWater & { boxes: Box[]; classes: string[] }) | null>(); // null while loading
  const ways = new Map<string, Waterway[] | null>();
  const levels = new Map<string, number>(); // water level (DEM metres) of a polygon at a grid corner
  const camera = new Camera();
  let piers: Pier[] = []; // the piers of all built bridges, town metres (rebuilt when the roads change)
  const framer = frameSetter(opts.light);

  const reset = () => {
    for (const c of chunks.values()) c.mesh?.geometry.dispose();
    for (const c of chunks.values()) if (c.mesh) scene?.remove(c.mesh);
    for (const c of chunks.values()) if (c.steam) scene?.remove(c.steam);
    chunks.clear();
    shown.clear();
  };

  // A tile of each kind, loaded on demand; undefined/null until it is in.
  const landTile = (tf: TownFrame, x: number, y: number) => {
    const key = `${x}/${y}`;
    if (!land.has(key)) {
      land.set(key, null);
      void getLandTile(((x % N12) + N12) % N12, y)
        .then(
          (t) => {
            const toLocal = (tx: number, ty: number): XY => {
              const ll = mercatorToLngLat((x + tx / t.extent) / N12, (y + ty / t.extent) / N12);
              return tf.toLocal(ll.lng, ll.lat);
            };
            // what the land is behind a shore: the landcover polygon under a probe point
            const tone = (px: number, py: number): number => {
              for (const q of t.land) if (px >= q.bbox[0] && px <= q.bbox[2] && py >= q.bbox[1] && py <= q.bbox[3] && pointInRings(px, py, q.rings)) return TONES[q.cls] ?? 0;
              return 0;
            };
            const probe = TONE_PROBE_M / ((metersPerPixel(tf.toLngLat(0, 0)[1], NATURE_MAXZOOM) * 256) / t.extent);
            const w = tileWater(t.water, t.extent, toLocal, tone, probe);
            const boxes = w.pieces.map((p): Box => {
              let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
              for (const [a, b] of p) (x0 = Math.min(x0, a)), (y0 = Math.min(y0, b)), (x1 = Math.max(x1, a)), (y1 = Math.max(y1, b));
              return [x0, y0, x1, y1];
            });
            return { ...w, boxes, classes: t.water.map((p) => p.cls) };
          },
          () => ({ pieces: [], shores: [], pieceOf: [], shoreOf: [], tones: [], boxes: [], classes: [] }),
        )
        .then((w) => {
          if (tilesFor !== tf) return;
          land.set(key, w);
          map.triggerRepaint();
        });
    }
    return land.get(key);
  };
  const wayTile = (tf: TownFrame, x: number, y: number) => {
    const key = `${x}/${y}`;
    if (!ways.has(key)) {
      ways.set(key, null);
      void getWaterwayTile(((x % N14) + N14) % N14, y)
        .then(
          (t) => {
            const out: Waterway[] = [];
            const local = (tx: number, ty: number): XY => {
              const ll = mercatorToLngLat((x + tx / t.extent) / N14, (y + ty / t.extent) / N14);
              return tf.toLocal(ll.lng, ll.lat);
            };
            for (const l of t.lines) {
              const kind = RIVER[l.cls] ?? RIVER.stream;
              // each segment belongs to the tile holding its middle: the tiles overlap at their edges
              let run: XY[] = [];
              for (let i = 0; i + 3 < l.pts.length; i += 2) {
                const mx = (l.pts[i] + l.pts[i + 2]) / 2, my = (l.pts[i + 1] + l.pts[i + 3]) / 2;
                if (mx >= 0 && mx < t.extent && my >= 0 && my < t.extent) {
                  if (!run.length) run.push(local(l.pts[i], l.pts[i + 1]));
                  run.push(local(l.pts[i + 2], l.pts[i + 3]));
                } else if (run.length) {
                  out.push({ pts: run, ...kind });
                  run = [];
                }
              }
              if (run.length) out.push({ pts: run, ...kind });
            }
            return out;
          },
          () => [] as Waterway[],
        )
        .then((w) => {
          if (tilesFor !== tf) return;
          ways.set(key, w);
          map.triggerRepaint();
        });
    }
    return ways.get(key);
  };
  // The tiles of zoom z under a box of town metres.
  const tilesUnder = (tf: TownFrame, b: Box, z: number): [number, number][] => {
    const corners = [tf.toLngLat(b[0], b[1]), tf.toLngLat(b[2], b[1]), tf.toLngLat(b[0], b[3]), tf.toLngLat(b[2], b[3])].map(([lng, lat]) => lngLatToTile(lng, lat, z));
    const xs = corners.map((c) => Math.floor(c.x)), ys = corners.map((c) => Math.floor(c.y));
    const out: [number, number][] = [];
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) for (let y = Math.min(...ys); y <= Math.max(...ys); y++) out.push([x, y]);
    return out;
  };

  // The median ground height at some shore points (town metres); null while the ground loads.
  const median = (tf: TownFrame, pts: XY[]): number | null => {
    const step = Math.ceil(pts.length / LEVEL_SAMPLES);
    const sample = pts.filter((_, q) => q % step === 0).map(([x, y]) => tf.toLngLat(x, y));
    const hs = sample.map(([a, b]) => groundAt(a, b));
    if (hs.some((h) => h === null)) {
      void loadGround(sample).then(() => map.triggerRepaint());
      return null;
    }
    (hs as number[]).sort((a, b) => a - b);
    return hs[hs.length >> 1]!;
  };
  // One stable level per water polygon. Water is a surface, not a terrain decal:
  // lakes do not tilt independently in every render chunk. Prefer the polygon's
  // own shoreline elevations; for tile-interior pieces with no shore, use the
  // DEM at the polygon centroid (Terrarium normally stores the water-surface height).
  const levelOfPolygon = (
    tf: TownFrame,
    tile: string,
    poly: number,
  ): number | null => {
    const key = `${tile}:${poly}`;
    const had = levels.get(key);
    if (had !== undefined) return had;

    const own = land.get(tile)!;
    const pts: XY[] = [];

    for (let k = 0; k < own.shores.length; k += 4) {
      if (own.shoreOf[k / 4] === poly) {
        pts.push([own.shores[k], own.shores[k + 1]]);
      }
    }

    let level: number | null = null;

    if (pts.length) {
      level = median(tf, pts);
    } else {
      const pieces = own.pieces.filter((_, i) => own.pieceOf[i] === poly);
      let sx = 0;
      let sy = 0;
      let n = 0;

      for (const piece of pieces) {
        for (const [x, y] of piece) {
          sx += x;
          sy += y;
          n++;
        }
      }

      if (n > 0) {
        const [lng, lat] = tf.toLngLat(sx / n, sy / n);
        level = groundAt(lng, lat);

        if (level === null) {
          void loadGround([[lng, lat]]).then(() => map.triggerRepaint());
        }
      }
    }

    if (level !== null) {
      // Small DEM noise between neighbouring vector-tile fragments should not
      // become a visible step in an otherwise calm lake.
      level = Math.round(level * 2) / 2;
      levels.set(key, level);
    }

    return level;
  };

  // Builds one chunk at a level; null while its tiles or its ground load.
  const build = (i: number, j: number, level: number, tf: TownFrame, o: { lng: number; lat: number }): Chunk | null => {
    const box: Box = [i * SIZE, j * SIZE, (i + 1) * SIZE, (j + 1) * SIZE];
    const grow = (m: number): Box => [box[0] - m, box[1] - m, box[2] + m, box[3] + m];
    const lt = tilesUnder(tf, grow(FLOW_REACH), NATURE_MAXZOOM).map(([x, y]) => landTile(tf, x, y));
    const wt = tilesUnder(tf, grow(FLOW_REACH), WATERWAY_ZOOM).map(([x, y]) => wayTile(tf, x, y));
    if (lt.some((t) => !t) || wt.some((t) => !t)) return null;
    const pieces: XY[][] = [], boxes: Box[] = [], owners: { tile: string; poly: number; cls: string }[] = [];
    const lk = tilesUnder(tf, grow(FLOW_REACH), NATURE_MAXZOOM).map(([x, y]) => `${x}/${y}`);
    lt.forEach((t, q) =>
      t!.pieces.forEach((p, k) => {
        const b = t!.boxes[k];
        if (b[2] < box[0] - FLOW_REACH || b[0] > box[2] + FLOW_REACH || b[3] < box[1] - FLOW_REACH || b[1] > box[3] + FLOW_REACH) return;
        pieces.push(p);
        boxes.push(b);
        owners.push({ tile: lk[q], poly: t!.pieceOf[k], cls: t!.classes[t!.pieceOf[k]] ?? "" });
      }),
    );
    const shores = lt.flatMap((t) => t!.shores);
    const allTones = lt.flatMap((t) => t!.tones);
    const rivers = wt.flatMap((t) => t!);
    if (!pieces.length && !rivers.length) return { mesh: null, seen: 0, stale: false };
    const inside = (x: number, y: number) => pieces.some((p, q) => x >= boxes[q][0] && x <= boxes[q][2] && y >= boxes[q][1] && y <= boxes[q][3] && inConvex(p, x, y));
    const ribbons = rivers.flatMap((w) => runsOutside(w, inside));
    const nearTones: number[] = [];
    const near = realShores(shores, grow(SHORE_CAP), inside, allTones, nearTones);
    const c = buildWaterChunk(pieces, near, rivers, ribbons, box, CELLS[level], nearTones);
    const n = c.xy.length / 2;
    if (!n) return { mesh: null, seen: 0, stale: false };
    // heights: the polygons level with their shores, the ribbons on the ground under their line
    const k = reliefScale.peek();
    const base = new Float64Array(n * 3);
    for (let v = 0; v < n; v++) (base[v * 3] = c.xy[v * 2]), (base[v * 3 + 1] = c.xy[v * 2 + 1]), (base[v * 3 + 2] = LIFT);
    if (k > 0) {
      // Large water polygons are water surfaces, not terrain decals.
      // Their height comes only from surrounding shore levels; terrain above the
      // surface hides the water through the shared 3D depth buffer.
      const polygonLevels = new Map<number, number>();

      for (const pi of new Set(c.piece.slice(0, c.ribbons))) {
        const owner = owners[pi];
        if (!owner) continue;

        const { tile, poly, cls } = owner;

        if (cls === "ocean") {
          polygonLevels.set(pi, 0);
          continue;
        }

        const waterLevel = levelOfPolygon(tf, tile, poly);
        if (waterLevel === null) return null;

        polygonLevels.set(pi, waterLevel);
      }

      for (let v = 0; v < c.ribbons; v++) {
        const waterLevel = polygonLevels.get(c.piece[v]);
        if (waterLevel === undefined) continue;
        base[v * 3 + 2] += waterLevel * k;
      }

      // Line-only rivers and streams follow the same Terrarium DEM as our
      // landscape mesh. There is deliberately no MapLibre terrain height path.
      const centres: [number, number][] = [];
      for (let v = c.ribbons + 1; v < n; v += 3) {
        centres.push(tf.toLngLat(c.xy[v * 2], c.xy[v * 2 + 1]));
      }

      const riverHeights = centres.map(([lng, lat]) => {
        const raw = groundAt(lng, lat);
        return raw === null ? null : raw * k;
      });

      if (riverHeights.some((h) => h === null)) {
        void loadGround(centres).then(() => map.triggerRepaint());
        return null;
      }

      riverHeights.forEach((h, q) => {
        for (let r = 0; r < 3; r++) {
          base[(c.ribbons + q * 3 + r) * 3 + 2] += h!;
        }
      });
    }
    const { g, m } = projectPoints(base, tf.toLngLat, o);
    const geo = new BufferGeometry();
    geo.setAttribute("aG", new BufferAttribute(g, 3));
    geo.setAttribute("aM", new BufferAttribute(m, 3));
    geo.setAttribute("aShore", new BufferAttribute(Float32Array.from(c.shore), 1));
    geo.setAttribute("aFlow", new BufferAttribute(Float32Array.from(c.flow), 2));
    geo.setAttribute("aTone", new BufferAttribute(Float32Array.from(c.tone), 1));
    geo.setIndex(new BufferAttribute(n > 65535 ? Uint32Array.from(c.index) : Uint16Array.from(c.index), 1));
    const mesh = Object.assign(new Mesh(geo, mat!), { frustumCulled: false, visible: false });
    scene!.add(mesh);
    const steam = Object.assign(new Mesh(geo, steamMat!), { frustumCulled: false, visible: false, renderOrder: 1 });
    scene!.add(steam);
    return { mesh, steam, seen: 0, stale: false };
  };

  // devtools: what is drawn now
  if (import.meta.env.DEV) Object.assign(window, { waterMat: () => mat, waterStats: () => ({ shown: shown.size, chunks: chunks.size, tiles: land.size + ways.size, tris: [...shown].reduce((a, q) => a + (q.geometry.index?.count ?? 0) / 3, 0) }) });

  // devtools: the steam strength now; waterSteamForce(v) sets it for a look, null gives it back to the weather
  if (import.meta.env.DEV) Object.assign(window, { waterSteam: () => steamNow, waterSteamForce: (v: number | null) => ((steamForce = v), map.triggerRepaint()) });

  // Is there water at a town point, as far as the loaded tiles know (an unloaded tile counts as water)?
  const waterAt = (tf: TownFrame, x: number, y: number): boolean => {
    const [tx, ty] = tilesUnder(tf, [x, y, x, y], NATURE_MAXZOOM)[0];
    const t = land.get(`${tx}/${ty}`);
    if (!t) return true;
    return t.pieces.some((p, k) => x >= t.boxes[k][0] && x <= t.boxes[k][2] && y >= t.boxes[k][1] && y <= t.boxes[k][3] && inConvex(p, x, y));
  };
  // the built bridges of the road graph -> their piers
  const setPiers = (g: NonNullable<typeof roadGraph.value> | null) => {
    piers = [];
    if (!g) return;
    for (const ch of roadChains(g, (e) => (e.done >= e.labor ? "built" : "waiting"))) {
      if (ch.state !== "built" || (ch.kind !== "bridge" && ch.kind !== "stonebridge")) continue;
      const pts = ch.nodes.flatMap((n) => (g.nodes[n] ? [[g.nodes[n].x, g.nodes[n].y] as XY] : []));
      if (pts.length > 1) piers.push(...bridgePiers(pts, ch.kind));
    }
  };

  // devtools: waterPiers([{ x, y, r }]) puts test piers (town metres) in place of the roads' until the roads change
  if (import.meta.env.DEV) Object.assign(window, { waterPiers: (list: Pier[]) => ((piers = list), map.triggerRepaint(), piers.length) });

  const colour = (hex: string, k = 1) => new Vector3(...rgb(hex).map((v) => Math.min(1, v * k)));

  return {
    id: WATER_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(_m, gl) {
      host = acquireHost(map, gl as WebGL2RenderingContext);
      scene = new Scene();
      mat = new ShaderMaterial({
        uniforms: {
          uG: { value: new Matrix4() },
          uM: { value: new Matrix4() },
          uT: { value: 0 },
          uLight: { value: framer.light },
          uSunDir: { value: framer.sun },
          uSun: { value: 0 },
          uTint: { value: new Vector4() },
          uTime: { value: 0 },
          uEye: { value: new Vector3() },
          uWindDir: { value: new Vector2(...WIND_DIR).normalize() },
          uWind: { value: 0 },
          uRain: { value: 0 },
          uIce: { value: 0 },
          uSnow: { value: 0 },
          uFar: { value: FAR_CAP },
          uIn: { value: 1 },
          uDeep: { value: colour(PALETTE.mapWater, 0.86) },
          uShallow: { value: colour(mixHex(PALETTE.mapWater, PALETTE.mapShore, 0.35), 1.05) },
          uFoam: { value: colour(PALETTE.paperRaised) },
          uIceCol: { value: colour(PALETTE.mapIce) },
          uSnowCol: { value: colour(PALETTE.paperRaised) },
          uFlat: { value: colour(PALETTE.mapWater) },
          uSky: { value: new Vector3() },
          uHorizon: { value: new Vector3() },
          uGroundTone: { value: colour(PALETTE.mapGrass, 0.55) },
          uForestTone: { value: colour(PALETTE.mapForestDeep, 0.3) },
          uPiers: { value: Array.from({ length: PIERS }, () => new Vector3()) },
          uPierN: { value: 0 },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: DoubleSide, // the pieces wind either way
        blending: NoBlending,
        depthTest: true,
        depthWrite: true,
        depthFunc: LessEqualDepth,
      });
      const share = ["uG", "uM", "uT", "uSunDir", "uSun", "uTint", "uTime", "uEye", "uWindDir", "uWind", "uFar", "uIn", "uHorizon"];
      steamMat = new ShaderMaterial({
        uniforms: { ...Object.fromEntries(share.map((k) => [k, mat!.uniforms[k]])), uSteam: { value: 0 } }, // the water's own uniform objects: set once a frame
        vertexShader: STEAM_VERT,
        fragmentShader: STEAM_FRAG,
        side: DoubleSide,
        transparent: true,
        blending: NormalBlending,
        premultipliedAlpha: true, // (ONE, ONE_MINUS_SRC_ALPHA)
        depthTest: true,
        depthWrite: false,
        depthFunc: LessEqualDepth,
      });
      stops.push(
        effect(() => {
          void opts.frame.value;
          reset();
          land.clear();
          ways.clear();
          levels.clear();
          tilesFor = opts.frame.peek();
          map.triggerRepaint();
        }),
        effect(() => {
          setPiers(roadGraph.value);
          map.triggerRepaint();
        }),
        // new ground: the old water stays until its chunk is built again
        effect(() => {
          void reliefScale.value;
          for (const c of chunks.values()) c.stale = true;
          map.triggerRepaint();
        }),
      );
    },
    onRemove() {
      for (const s of stops) s();
      stops.length = 0;
      reset();
      mat?.dispose();
      steamMat?.dispose();
      mat = null;
      steamMat = null;
      host?.release();
      host = null;
      scene = null;
    },
    render(_gl, args) {
    const tf = opts.frame.peek();
    const zoom = map.getZoom();

    if (
      !host ||
      !scene ||
      !mat ||
      !steamMat ||
      !tf ||
      zoom < WATER_FROM_ZOOM
    ) {
      return;
    }

    const [lng, lat] = tf.toLngLat(0, 0);

    if (!origin || origin.lng !== lng || origin.lat !== lat) {
      origin = { lng, lat };
      reset();
    }

    const M = framer.mercator(args, host, origin);
    const eye = eyeOf(M);

    if (!eye) return;

    const clock = opts.light?.clock.peek() ?? 0;
    const cal = calendar(clock);
    const w = opts.weather.peek();

    const cover = weatherMapOn.peek() && w ? 1 : 0;

    const ice = cover
      ? Math.min(1, iceOpacity(w!.ice) / 0.55)
      : 0;

    steamNow =
      steamForce ??
      (w
        ? steamStrength(
            w.now.temp,
            cal.hour + cal.minute / 60,
            w.now.wind,
            w.now.cloud,
            w.now.snow ? 0 : w.now.precip,
            ice,
          )
        : 0);

    const steamOn = steamNow > 0.003;

    const merc = mercatorLocal(origin);
    const [elng, elat] = merc.from(eye[0], eye[1]);

    const k = reliefScale.peek();

    const under =
      k > 0
        ? (groundAt(elng, elat) ?? 0) * k
        : 0;

    const centre = (
      x: number,
      y: number,
      out: [number, number, number],
    ): void => {
      const [a, b] = tf.toLngLat(x, y);
      const g = k > 0 ? groundAt(a, b) : 0;
      const m = merc.to(a, b);

      out[0] = m[0];
      out[1] = m[1];
      out[2] = g === null ? under : g * k;
    };

    const hereLocal = tf.toLocal(elng, elat);

    const seen = chunksInView({
      planes: frustumPlanes(M),
      eye,
      at: hereLocal,
      far: FAR_CAP,
      size: SIZE,
      rise: 0,
      slope: SLOPE,
      centre,
    });

    seen.sort((a, b) => a.d - b.d);

    // Each chunk at its level, built nearest first within the budget.
    // Until then any level of it already built is used as a stand-in.
    frameNo++;

    const t0 = performance.now();

    let missing = false;

    const want = new Set<Mesh>();

    for (const s of seen) {
      if (
        Math.hypot(
          (s.i + 0.5) * SIZE,
          (s.j + 0.5) * SIZE,
        ) > RANGE
      ) {
        continue;
      }

      const near = LEVEL_TO.findIndex((d) => s.d < d);

      const level =
        near < 0
          ? CELLS.length - 1
          : near;

      const key = `${s.i},${s.j},${level}`;

      let c = chunks.get(key);

      if (!c || c.stale) {
        const built =
          performance.now() - t0 < FRAME_BUDGET
            ? build(
                s.i,
                s.j,
                level,
                tf,
                origin,
              )
            : null;

        if (built) {
          if (c?.mesh) {
            scene.remove(c.mesh);
            c.mesh.geometry.dispose();
            shown.delete(c.mesh);
          }

          chunks.set(
            key,
            (c = built),
          );
        } else {
          missing = true;
        }
      }

      if (!c || c.stale) {
        // A stand-in: what this chunk showed before, at any level.
        for (
          let l = 0;
          l < CELLS.length && !c?.mesh;
          l++
        ) {
          const other = chunks.get(
            `${s.i},${s.j},${l}`,
          );

          if (other?.mesh) {
            c = other;
          }
        }
      }

      if (c) {
        c.seen = frameNo;

        if (c.mesh) {
          want.add(c.mesh);
        }

        if (c.steam) {
          c.steam.visible = steamOn;
        }
      }
    }

    for (const m of shown) {
      if (!want.has(m)) {
        m.visible = false;
      }
    }

    for (const c of chunks.values()) {
      if (
        c.steam &&
        (!c.mesh || !want.has(c.mesh))
      ) {
        c.steam.visible = false;
      }
    }

    for (const m of want) {
      m.visible = true;
    }

    shown.clear();

    for (const m of want) {
      shown.add(m);
    }

    if (chunks.size > MAX_CHUNKS) {
      for (const [key, c] of chunks) {
        if (frameNo - c.seen > 600) {
          if (c.mesh) {
            scene.remove(c.mesh);
            c.mesh.geometry.dispose();
          }

          chunks.delete(key);
        }
      }
    }

    // Chunk building is finite work and should continue immediately
    // until the visible set is ready.
    if (missing) {
      map.triggerRepaint();
    }

    if (!want.size) return;

    // Uniforms of this frame.
    const u = mat.uniforms;

    framer.set(
      u,
      args,
      host,
      origin,
    );

    (u.uEye.value as Vector3).set(
      ...eye,
    );

    u.uTime.value = motionTime();

    const sky = skyColours(
      cal.hour + cal.minute / 60,
    );

    (u.uSky.value as Vector3).set(
      ...rgb(sky.sky),
    );

    (u.uHorizon.value as Vector3).set(
      ...rgb(sky.horizon),
    );

    u.uWind.value = Math.max(
      0.12,
      Math.min(
        1.2,
        (w?.now.wind ?? 3) / WIND_FULL,
      ),
    );

    u.uRain.value =
      w && !w.now.snow
        ? Math.min(
            1,
            w.now.precip / RAIN_FULL,
          )
        : 0;

    u.uIce.value = ice;

    u.uSnow.value = cover
      ? snowOpacity(w!.snowpack) /
        snowOpacity(1)
      : 0;

    const flat = rgb(PALETTE.mapWater);
    const pale = rgb(PALETTE.mapIce);

    const fi = cover
      ? iceOpacity(w!.ice) *
        weatherCoverVisibility(zoom)
      : 0;

    (u.uFlat.value as Vector3).set(
      flat[0] +
        (pale[0] - flat[0]) * fi,
      flat[1] +
        (pale[1] - flat[1]) * fi,
      flat[2] +
        (pale[2] - flat[2]) * fi,
    );

    const t = Math.min(
      1,
      (zoom - WATER_FROM_ZOOM) /
        (WATER_FULL_ZOOM - WATER_FROM_ZOOM),
    );

    u.uIn.value =
      t * t * (3 - 2 * t);

    steamMat.uniforms.uSteam.value =
      steamNow;

    // The nearest piers that stand in water.
    const here = tf.toLocal(
      elng,
      elat,
    );

    const list = nearestPiers(
      piers,
      here[0],
      here[1],
      PIERS * 2,
      PIER_REACH,
    )
      .filter((q) =>
        waterAt(
          tf,
          q.x,
          q.y,
        ),
      )
      .slice(
        0,
        PIERS,
      );

    list.forEach((q, n) => {
      (
        u.uPiers.value as Vector3[]
      )[n].set(
        q.x,
        q.y,
        q.r,
      );
    });

    u.uPierN.value = list.length;

    host.draw((r) => {
      r.render(
        scene!,
        camera,
      );
    });

    // Do not force MapLibre to redraw at display refresh rate.
    // All decorative map effects share one ~30 FPS scheduler.
    if (motionOn.peek()) {
      requestMapAnimation(map);
    }
  },
  };
}

function inConvex(p: XY[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    const c = Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]));
    if (!c) continue;
    if (!sign) sign = c;
    else if (c !== sign) return false;
  }
  return true;
}

// Adds the layer over the weather on the water (ice, the snow veil), under the haze and the night tint.
export function attachWaterLayer(map: maplibregl.Map, opts: WaterLayerOptions): () => void {
  const layer = createWaterLayer(map, opts);
  const before = () => ["weather-haze", "night-tint"].find((id) => map.getLayer(id));
  let disposed = false;
  let stopShow: (() => void) | null = null;
  const add = () => {
    const b = before();
    if (disposed || map.getLayer(WATER_LAYER_ID) || !b) return;
    map.addLayer(layer, b);
    map.off("styledata", add);
    stopShow = showWhile(map, WATER_LAYER_ID, water3dOn);
  };
  if (before()) add();
  else map.on("styledata", add);
  return () => {
    disposed = true;
    stopShow?.();
    map.off("styledata", add);
    if (map.getLayer(WATER_LAYER_ID)) map.removeLayer(WATER_LAYER_ID);
  };
}
