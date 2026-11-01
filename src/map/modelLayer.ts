import type * as maplibregl from "maplibre-gl";
import type { ReadonlySignal } from "@preact/signals";
import { effect, signal } from "@preact/signals";
import { BufferAttribute, BufferGeometry, Camera, CustomBlending, DoubleSide, LessEqualDepth, Matrix4, Mesh, NoBlending, OneFactor, Scene, ShaderMaterial, Vector3, Vector4 } from "three";
import { calendar, START_MINUTE_OF_DAY } from "../sim/clock";
import { sunDirection, type WeatherState } from "../sim/weather";
import { TREE_COLORS } from "../ui/palette";
import type { Frame as TownFrame } from "../world/frame";
import { sunLocal, sunStrength } from "./clouds/shadowMath";
import { lightOpacity, type Light } from "./lifeLayer";
import { nightTint } from "./nightLayer";
import { coverOf, demoModelItems, keyOf, lampOf, modelEmitters, quantise, seatedModelOf, type Emitter, type ModelItem } from "./modelItems";

export type { ModelItem } from "./modelItems";
import { mergePacked, projectModel, type Packed } from "./modelBuffers";
import { rgb, type XY } from "./modelGeometry";
import type { Ground } from "./groundSeat";
import { groundAt, loadGround, reliefScale } from "./relief";
import { EARTH_RADIUS_M, localFrame, lngLatToMercator, mercatorLocalMatrix, metresPerMercator, weatherToSphere } from "./three/frame";
import { acquireHost, type ThreeHost } from "./three/host";
import { snowOpacity } from "./weatherMath";
import { weatherMapOn } from "./weatherSettings";

// Every building and built road of the town drawn by three.js inside the MapLibre map: the town's own buildings
// (townModels.ts), restored old ones (heritageModels.ts), finished or under construction, and built roads and bridges
// (roadModels.ts). Import this file only with a dynamic `import()` (it pulls in three.js); models.ts attaches it with the
// item lists of buildingLayer.ts and roadLayer.ts, which keep the 2D parts (planned lots and roads, outlines) and the clicks.
//
// One custom layer with `renderingMode: "3d"`: MapLibre sets its 3D depth mode (shared depth buffer with fill-extrusion,
// LEQUAL, read-write, 3D depth range) before `render`, and the material keeps depth test on, so meshes and the remaining
// fill-extrusions (ruins) occlude each other per pixel.
//
// GL-state contract (host.draw resets three's state, so the material states everything it needs): one opaque mesh,
// NoBlending, depth test LEQUAL + write, DoubleSide. The layer takes the place the building fill-extrusions had (before
// "buildings-outline"), so what used to draw over buildings still does, and the dusk tint and cloud shadows darken it.
//
// Buffers: each item's model is built and projected once (modelBuffers.ts) and cached by everything that shapes it; a
// change of the list re-projects only the changed items and merges the packs.
//
// Projection: each vertex is stored twice, in a globe tangent frame and in a mercator frame, both in metres relative to
// the layer origin and computed in float64 on the CPU from the vertex's lng/lat:
// - globe: exact tangent coordinates of the point (R + h) * unit(lng, lat) about the origin, so the map to the unit sphere
//   is affine: sphere = o + (E e + N n + U o) / R. Matrix = main * that, in float64 per frame.
// - mercator: east = dLng * R cos(lat0), north = R cos(lat0) * (ymerc(lat) - ymerc(lat0)), up = h, through
//   mercatorLocalMatrix(fallback, ...) (the same helper the shadow layer uses).
// The vertex shader mixes the two clip positions with `projectionTransition`, exactly like MapLibre's
// interpolateProjectionFor3D does for fill-extrusion, so depth values agree through the projection transition.
//
// Window light: a second layer (LAMP_LAYER_ID) above the night tint draws the same mesh again with only the glass of lit
// buildings, added on top (ONE, ONE), depth test LEQUAL against the first pass, no depth write. Above the tint, so the
// dusk does not dim the windows; the same hours as the ground glows of lifeLayer.ts.
//
// Lighting: faces are shaded by the sun direction (sim/weather sunDirection, in the town's east/north/up frame) like the
// fill-extrusions' default light: unlit faces at about half brightness. With the sun down (or no clock given) a fixed
// fallback direction is used, slightly dimmer; the night tint layer above darkens everything else. Walls darken towards
// the ground. Windows, doors, log courses, boards and shingle rows are painted from each vertex's facade code
// (modelGeometry.ts PATTERN) and fade to their average tone once they shrink to a few pixels, so distant towns do not shimmer.

export const MODEL_LAYER_ID = "building-models";
export const LAMP_LAYER_ID = "building-lamps";
const R = EARTH_RADIUS_M;
const FALLBACK_LIGHT: [number, number, number] = [-0.45, -0.55, 0.7];

export interface ModelLayerOptions {
  items: ReadonlySignal<ModelItem[]>;
  frame: ReadonlySignal<TownFrame | null>;
  // Sun for the lighting: game minutes and the climate phase of the weather site. Omitted: fixed light.
  light?: { clock: ReadonlySignal<number>; phase: ReadonlySignal<number | null> };
  // Weather for the snow on up-facing surfaces (roofs, ledges, flat tops); omitted: no snow.
  weather?: ReadonlySignal<WeatherState | null>;
  // Layer to insert before (default "buildings-outline", else "night-tint").
  beforeId?: string;
}

const VERT = /* glsl */ `
attribute vec3 aMerc;
attribute vec3 aColor;
attribute vec4 aFacade;
attribute float aLamp;
attribute float aZ;
uniform mat4 uG;
uniform mat4 uM;
uniform float uT;
varying vec3 vN;
varying vec3 vC;
varying vec4 vF;
varying float vZ;
varying vec2 vXY;
varying float vLamp;
void main() {
  vec4 m = uM * vec4(aMerc, 1.0);
  vec4 g = uG * vec4(position, 1.0);
  // MapLibre's interpolateProjectionFor3D: mercator -> globe by the projection transition
  gl_Position = uT > 0.999 ? g : (uT <= 0.0 ? m : mix(m, g, uT));
  vN = normal;
  vC = aColor;
  vF = aFacade;
  vZ = aZ; // height above the model's own ground in metres (on the relief aMerc.z also has the ground)
  vXY = aMerc.xy; // metres east and north of the origin, for patterns laid out in world space
  vLamp = aLamp;
}`;

// Facade codes (modelGeometry.ts PATTERN): 1 house, 2 hall, 3 worship, 4 log courses, 5 wide, 6 tower, 7 roof rows,
// 8 boards, 9 log cabin; + 10 a door, + 20 a gate at the middle of the wall. Roads (roadModels.ts) from 30: 30 track, 31
// ruts, 32 cobbles, 33 plank deck, 34 ashlar; there the facade is (s along, offset across, width, code). 35..37 are the
// junction aprons (roadJunctions.ts): ruts, cobbles and a plain surface, with the shoulder band in the s field.
// Shared by the surface pass (FRAG) and the window-light pass (LAMP_FRAG).
const COMMON = /* glsl */ `
varying vec3 vN;
varying vec3 vC;
varying vec4 vF;
varying float vZ;
varying vec2 vXY;
varying float vLamp;

// Grid of windows on a wall: columns centred on the wall, one row per floor below the eaves. aw, az: pixel footprint in
// metres along s and z; once windows get that small the grid turns into its average coverage. id: which window (floor
// and column) the point belongs to.
float windows(float s, float len, float z, float top, float aw, float az, float floorH, float sill, float wh, float ww, float sp, out float id) {
  float n = len >= ww + 1.4 ? floor((len - 1.4 - ww) / sp) + 1.0 : 0.0;
  float fl = floor(z / floorH);
  id = 0.0;
  if (n < 1.0 || fl * floorH + sill + wh > top - 0.25) return 0.0;
  float start = (len - (n - 1.0) * sp) * 0.5;
  float c = clamp(floor((s - start) / sp + 0.5), 0.0, n - 1.0);
  id = fl * 31.0 + c;
  float dx = abs(s - start - c * sp);
  float zl = z - fl * floorH;
  float mx = 1.0 - smoothstep(ww * 0.5 - aw, ww * 0.5 + aw, dx);
  float mz = smoothstep(sill - az, sill + az, zl) * (1.0 - smoothstep(sill + wh - az, sill + wh + az, zl));
  float far = smoothstep(0.25, 0.6, max(aw / ww, az / wh));
  return mix(mx * mz, 0.7 * ww * wh / (sp * floorH), far);
}

// Window grid of a facade: floor height, sill, window height, width (g) and spacing (sp, 0: no windows).
void grid(int p, out vec4 g, out float sp) {
  g = vec4(0.0);
  sp = 0.0;
  if (p == 1) { g = vec4(3.0, 0.9, 1.25, 1.0); sp = 2.6; }
  else if (p == 2) { g = vec4(3.8, 1.0, 2.0, 1.3); sp = 3.0; }
  else if (p == 3) { g = vec4(100.0, 2.2, clamp(vF.z - 3.4, 1.4, 4.0), 0.9); sp = 3.4; }
  else if (p == 5) { g = vec4(4.5, 2.0, 1.6, 2.4); sp = 3.4; }
  else if (p == 6) { g = vec4(3.5, 1.2, 1.3, 0.55); sp = 2.2; }
  else if (p == 9) { g = vec4(3.0, 0.9, 1.0, 0.85); sp = 2.4; }
}

// A door at the middle of the wall (dk 1 door, 2 gate): no windows next to it on the ground floor.
bool nearDoor(int dk, float z) {
  float dw = dk == 2 ? 2.6 : 1.0, dh = dk == 2 ? 2.5 : 2.0;
  return dk > 0 && abs(vF.x - vF.y * 0.5) < dw * 0.5 + 0.6 && z < dh + 0.4;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uLight;
uniform float uSun;
uniform vec4 uTint; // the night tint (nightLayer.ts) where it cannot reach us: on the relief it is draped on the ground
uniform float uSnow; // snow cover 0..1: the snowpack of the weather, same signal as the 2D fill and the trees
uniform vec3 uSnowCol;
${COMMON}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// Smooth value noise 0..1, for the patches the snow lies in.
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), f.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), f.x), f.y);
}

// Dark seams every "period" metres of x (log courses and shingle rows along the height, boards along the wall), gone
// once they get thinner than a pixel.
float seams(float x, float ax, float period) {
  float f = fract(x / period);
  return smoothstep(0.8, 0.9, f) * (1.0 - smoothstep(0.2, 0.5, ax / period));
}

// A rectangle w wide from the ground to h at the middle of the wall, anti-aliased.
float doorway(float dx, float z, float aw, float az, float w, float h) {
  return (1.0 - smoothstep(w * 0.5 - aw, w * 0.5 + aw, dx)) * (1.0 - smoothstep(h - az, h + az, z));
}

// Cobble joints in world space, so neighbouring surfaces (a junction apron, roadJunctions.ts) line up.
float cobbles(float axy) {
  vec2 q = vXY / 0.42;
  q.x += 0.5 * mod(floor(q.y), 2.0);
  vec2 f = abs(fract(q) - 0.5);
  return 0.22 * smoothstep(0.36, 0.47, max(f.x, f.y)) * (1.0 - smoothstep(0.15, 0.5, axy / 0.42));
}

// Two wheel ruts at 27 % of the half width either side of the centre line.
float ruts(float ay) {
  float r = abs(abs(vF.y) - abs(vF.z) * 0.27);
  return 0.14 * (1.0 - smoothstep(0.18, 0.38 + ay, r));
}

// Road surface: darker edges, then the pattern of its code.
vec3 road(vec3 col, int code, float z, float aw, float ay, float az, float axy) {
  float w = abs(vF.z);
  float e = abs(vF.y) / max(w * 0.5, 1e-3); // 0 on the centre line, 1 at the edge
  if (code == 30) return col * mix(1.0, 0.8, smoothstep(0.5, 1.0, e));
  if (code >= 35) {
    // Junction aprons (roadJunctions.ts): vF.x is where the point sits in the shoulder band of the nearest road that
    // reaches it, 0..1, so the same falloff runs along the apron's rim and stops at a mouth; vF.yz hold the through
    // road's offset and width, which line the ruts up with its ribbons.
    col *= 1.0 - 0.22 * smoothstep(0.0, 1.0, clamp(vF.x, 0.0, 1.0));
    if (code == 35) col *= 1.0 - ruts(ay);
    else if (code == 36) col *= 1.0 - cobbles(axy);
    return col;
  }
  col *= mix(1.0, 0.78, smoothstep(0.82, 1.0, e));
  if (code == 31 && vF.z > 0.0) col *= 1.0 - ruts(ay);
  else if (code == 32) col *= 1.0 - cobbles(axy);
  else if (code == 33) col *= 1.0 - 0.24 * seams(vF.x, aw, 0.3);
  else if (code == 34) {
    float course = floor(z / 0.5);
    col *= 1.0 - 0.2 * max(seams(z, az, 0.5), seams(vF.x + 0.6 * mod(course, 2.0), aw, 1.2));
  }
  return col;
}

void main() {
  float z = vZ;
  // outside any branch: derivatives need uniform flow
  float aw = max(fwidth(vF.x), 1e-4), az = max(fwidth(z), 1e-4), ay = max(fwidth(vF.y), 1e-4);
  float axy = max(max(fwidth(vXY.x), fwidth(vXY.y)), 1e-4);
  int code = int(vF.w + 0.5);
  int dk = code < 30 ? code / 10 : 0; // 1 door, 2 gate
  int p = code - dk * 10;
  vec3 col = code >= 30 ? road(vC, code, z, aw, ay, az, axy) : vC;
  vec4 g;
  float sp;
  grid(p, g, sp);
  if (p == 9 || p == 4) col *= 1.0 - 0.2 * seams(z, az, p == 9 ? 0.3 : 0.32);
  else if (p == 7) col *= 1.0 - 0.12 * seams(z, az, 0.42);
  else if (p == 8) col *= 1.0 - 0.16 * seams(vF.x, aw, 0.28);
  if (sp > 0.0 && !nearDoor(dk, z)) {
    // glass inside a light frame 0.1 m wide
    float id;
    float glass = windows(vF.x, vF.y, z, vF.z, aw, az, g.x, g.y, g.z, g.w, sp, id);
    float frame = windows(vF.x, vF.y, z, vF.z, aw, az, g.x, g.y - 0.1, g.z + 0.2, g.w + 0.2, sp, id);
    col = mix(col, mix(col, vec3(0.95, 0.92, 0.84), 0.6), max(frame - glass, 0.0));
    col = mix(col, vec3(0.22, 0.25, 0.28), glass);
  }
  if (dk > 0) {
    float dw = dk == 2 ? 2.6 : 1.0, dh = dk == 2 ? 2.5 : 2.0;
    float dx = abs(vF.x - vF.y * 0.5);
    float leaf = doorway(dx, z, aw, az, dw, dh);
    float frame = doorway(dx, z, aw, az, dw + 0.24, dh + 0.12);
    vec3 wood = vec3(0.30, 0.22, 0.15);
    if (dk == 2) wood *= 1.0 - 0.35 * (1.0 - smoothstep(0.03, 0.06 + aw, dx)); // the seam between the two leaves
    col = mix(col, mix(col, vec3(0.95, 0.92, 0.84), 0.5), max(frame - leaf, 0.0));
    col = mix(col, wood, leaf);
  }
  vec3 n = normalize(vN);
  if (uSnow > 0.0) {
    // snow lies on what faces up (walls stay clean, and with them the windows); a thin snowpack is patchy, a thick one
    // closes up. Roads keep less of it (trodden).
    float up = smoothstep(0.12, 0.45, n.z);
    float blotch = 0.55 * vnoise(vXY * 0.9) + 0.3 * vnoise(vXY * 2.7 + 7.0) + 0.15 * hash2(floor(vXY * 5.0));
    float lim = 1.0 - uSnow * 1.3;
    float a = up * smoothstep(lim, lim + 0.25, blotch) * mix(0.35, 0.95, uSnow);
    col = mix(col, uSnowCol, a * (code >= 30 ? 0.5 : 1.0));
  }
  float d = max(dot(n, uLight), 0.0);
  float k = mix(0.55, 1.0, d) * mix(0.88, 1.0, uSun);
  if (abs(n.z) < 0.5) k *= mix(0.78, 1.0, smoothstep(0.0, 2.5, z)); // walls darken towards the ground
  gl_FragColor = vec4(mix(col * k, uTint.rgb, uTint.a), 1.0);
}`;

// Window light: only the glass of lit buildings, added on top of what is drawn (blending ONE, ONE). uLamp: how bright
// the house, work and tavern lights are at this hour (lifeLayer.ts lightOpacity). Each window of a building is lit or not
// by a hash of the window and the building's seed, so a house never shows every window lit.
const LAMP_FRAG = /* glsl */ `
uniform vec3 uLamp;
${COMMON}

void main() {
  float z = vZ;
  float aw = max(fwidth(vF.x), 1e-4), az = max(fwidth(z), 1e-4);
  float kind = floor(vLamp + 0.01);
  float on = kind < 0.5 ? 0.0 : kind < 1.5 ? uLamp.x : kind < 2.5 ? uLamp.y : uLamp.z;
  int code = int(vF.w + 0.5);
  int dk = code < 30 ? code / 10 : 0;
  int p = code - dk * 10;
  vec4 g;
  float sp;
  grid(p, g, sp);
  if (on < 0.01 || sp <= 0.0 || code >= 30 || nearDoor(dk, z)) discard;
  float id;
  float glass = windows(vF.x, vF.y, z, vF.z, aw, az, g.x, g.y, g.z, g.w, sp, id);
  float share = kind < 1.5 ? 0.65 : kind < 2.5 ? 0.85 : 1.0;
  float h = fract(sin(id * 12.9898 + fract(vLamp) * 311.7 + vF.y * 7.13) * 43758.5453);
  float a = glass * on * step(h, share);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vec3(1.0, 0.72, 0.38) * a, 0.0);
}`;

function mul4(a: ArrayLike<number>, b: ArrayLike<number>, out = new Float64Array(16)): Float64Array {
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  return out;
}

const norm3 = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

// Matrices, sun and (on the relief) night tint of this frame into a material's uniforms (uM, uG, uT, and uSun / uTint
// when the material has them; `light` is the uLight value). Shared with the tree layer (treeLayer.ts).
export function frameSetter(lt: ModelLayerOptions["light"]): {
  light: Vector3;
  sun: Vector3; // toward the sun itself (below the horizon at night), east/north/up; with set()
  set: (u: ShaderMaterial["uniforms"], args: maplibregl.CustomRenderMethodInput, host: ThreeHost, o: { lng: number; lat: number }) => void;
  // mercator: local metres -> clip through the fallback (always the mercator matrix); float64
  mercator: (args: maplibregl.CustomRenderMethodInput, host: ThreeHost, o: { lng: number; lat: number }) => Float64Array;
} {
  const lg = new Float64Array(16);
  const g64 = new Float64Array(16);
  const light = new Vector3(...norm3(FALLBACK_LIGHT));
  const sunDir = new Vector3(0, 0, 1);
  const mercator = (args: maplibregl.CustomRenderMethodInput, host: ThreeHost, o: { lng: number; lat: number }) =>
    mercatorLocalMatrix(host.frame(args.defaultProjectionData).fallback, lngLatToMercator(o.lng, o.lat), metresPerMercator(o.lat));
  const set = (u: ShaderMaterial["uniforms"], args: maplibregl.CustomRenderMethodInput, host: ThreeHost, o: { lng: number; lat: number }) => {
    const fr = host.frame(args.defaultProjectionData);
    const um = Float32Array.from(mercator(args, host, o));
    // globe: local metres -> unit sphere (affine) -> clip
    const f = localFrame(o.lng, o.lat);
    for (let i = 0; i < 3; i++) {
      lg[i] = f.e[i] / R;
      lg[4 + i] = f.n[i] / R;
      lg[8 + i] = f.o[i] / R;
      lg[12 + i] = f.o[i];
    }
    lg[3] = lg[7] = lg[11] = 0;
    lg[15] = 1;
    const ug = Float32Array.from(mul4(fr.main, lg, g64));
    // sun in the origin's east/north/up frame
    let sun = 1;
    light.set(...norm3(FALLBACK_LIGHT));
    const phase = lt?.phase.peek();
    if (lt && phase !== null && phase !== undefined) {
      const sl = sunLocal(weatherToSphere(sunDirection(lt.clock.peek(), phase)), f);
      sun = sunStrength(sl.sinElev);
      sunDir.set(...norm3([sl.east, sl.north, sl.sinElev]));
      if (sun > 0) {
        const d = norm3([sl.east, sl.north, Math.max(sl.sinElev, 0.05)]);
        const fb = norm3(FALLBACK_LIGHT);
        light.set(...norm3([fb[0] + (d[0] - fb[0]) * sun, fb[1] + (d[1] - fb[1]) * sun, fb[2] + (d[2] - fb[2]) * sun]));
      }
    }
    (u.uM.value as Matrix4).fromArray(um);
    (u.uG.value as Matrix4).fromArray(ug);
    u.uT.value = fr.transition;
    if (u.uSun) u.uSun.value = sun;
    if (u.uTint) {
      // on the relief MapLibre drapes the night tint over the terrain only, so the models tint themselves
      const tint = u.uTint.value as Vector4;
      if (reliefScale.peek() > 0 && lt) {
        const cal = calendar(lt.clock.peek());
        const t = nightTint(cal.hour + cal.minute / 60);
        tint.set(...rgb(t.color), t.opacity);
      } else tint.set(0, 0, 0, 0);
    }
  };
  return { light, sun: sunDir, set, mercator };
}

export type ModelLayer = maplibregl.CustomLayerInterface;

// The model layer and its window-light layer (drawn later, above the night tint); they share the mesh.
export function createModelLayer(map: maplibregl.Map, opts: ModelLayerOptions): { layer: ModelLayer; lamps: ModelLayer } {
  let host: ThreeHost | null = null;
  let scene: Scene | null = null;
  let mesh: Mesh | null = null;
  let mat: ShaderMaterial | null = null;
  // roads: a mesh of their own, drawn first without depth writes; ribbons of two chains overlap at a junction, and
  // with depth writes their equal depths would flip per pixel (flicker)
  let roadScene: Scene | null = null;
  let roadMesh: Mesh | null = null;
  let roadMat: ShaderMaterial | null = null;
  let lampScene: Scene | null = null;
  let lampMesh: Mesh | null = null;
  let lampMat: ShaderMaterial | null = null;
  let stop: (() => void) | null = null;
  let dirty = true;
  let origin: { lng: number; lat: number } | null = null; // the layer origin the packs were projected for
  const cache = new Map<string, Packed>();
  const camera = new Camera();

  const fill = (target: Mesh, b: Packed) => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(b.g, 3));
    geo.setAttribute("aMerc", new BufferAttribute(b.m, 3));
    geo.setAttribute("normal", new BufferAttribute(b.n, 3));
    geo.setAttribute("aColor", new BufferAttribute(b.c, 3));
    geo.setAttribute("aFacade", new BufferAttribute(b.f, 4));
    geo.setAttribute("aLamp", new BufferAttribute(b.l, 1));
    geo.setAttribute("aZ", new BufferAttribute(b.z, 1));
    geo.setIndex(new BufferAttribute(b.i, 1));
    target.geometry.dispose();
    target.geometry = geo;
    target.visible = b.i.length > 0;
    if (target === mesh && lampMesh) lampMesh.geometry = geo;
  };

  // Rebuilds the merged mesh; runs once per change of the item list (or the town frame), never per frame.
  const rebuild = () => {
    const tf = opts.frame.peek();
    if (!mesh || !tf) return;
    const [lng, lat] = tf.toLngLat(0, 0);
    if (!origin || origin.lng !== lng || origin.lat !== lat) cache.clear();
    origin = { lng, lat };
    const items = opts.items.peek();
    // on the relief: wait for the DEM tiles under every item (the last mesh stays meanwhile), then lift the models
    const k = reliefScale.peek();
    let ground: Ground | null = null;
    if (k > 0) {
      const pts = coverOf(items).map(([x, y]) => tf.toLngLat(x, y));
      if (pts.some(([a, b]) => groundAt(a, b) === null)) {
        void loadGround(pts).then(() => {
          dirty = true;
          map.triggerRepaint();
        });
        dirty = false;
        return;
      }
      ground = (x, y) => {
        const [a, b] = tf.toLngLat(x, y);
        return (groundAt(a, b) ?? 0) * k;
      };
    }
    const used = new Set<string>();
    const packs: Packed[] = [], roadPacks: Packed[] = [];
    const smoke: Emitter[] = [];
    for (const it of items) {
      const onRoad = it.style === "road" || it.style === "junction";
      const p = it.style === "road" ? 1 : quantise(it.progress);
      const key = keyOf(it, p, k);
      used.add(key);
      let pack = cache.get(key);
      if (!pack) cache.set(key, (pack = projectModel(seatedModelOf({ ...it, progress: p }, ground), tf.toLngLat, origin, p >= 1 ? lampOf(it) : 0)));
      (onRoad ? roadPacks : packs).push(pack);
      for (const [x, y, z] of pack.smoke ?? []) smoke.push({ id: it.id, kind: it.kind, style: it.style, lamp: it.lamp, x, y, z });
    }
    for (const k of [...cache.keys()]) if (!used.has(k)) cache.delete(k);
    fill(mesh, mergePacked(packs));
    fill(roadMesh!, mergePacked(roadPacks));
    modelEmitters.value = smoke;
    dirty = false;
  };

  const framer = frameSetter(opts.light);
  const light = framer.light;
  const setFrame = (u: ShaderMaterial["uniforms"], args: maplibregl.CustomRenderMethodInput) => {
    if (origin && host) framer.set(u, args, host, origin);
  };

  const layer: ModelLayer = {
    id: MODEL_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(_m, gl) {
      host = acquireHost(map, gl as WebGL2RenderingContext);
      mat = new ShaderMaterial({
        uniforms: { uG: { value: new Matrix4() }, uM: { value: new Matrix4() }, uT: { value: 0 }, uLight: { value: light }, uSun: { value: 0 }, uTint: { value: new Vector4() }, uSnow: { value: 0 }, uSnowCol: { value: new Vector3(...rgb(TREE_COLORS.snow)) } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: DoubleSide,
        blending: NoBlending,
        depthTest: true,
        depthWrite: true,
        depthFunc: LessEqualDepth,
      });
      mesh = Object.assign(new Mesh(new BufferGeometry(), mat), { frustumCulled: false, visible: false });
      scene = new Scene();
      scene.add(mesh);
      roadMat = new ShaderMaterial({
        uniforms: { uG: { value: new Matrix4() }, uM: { value: new Matrix4() }, uT: { value: 0 }, uLight: { value: light }, uSun: { value: 0 }, uTint: { value: new Vector4() }, uSnow: { value: 0 }, uSnowCol: { value: new Vector3(...rgb(TREE_COLORS.snow)) } },
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: DoubleSide,
        blending: NoBlending,
        depthTest: true,
        depthWrite: false,
        depthFunc: LessEqualDepth,
      });
      roadMesh = Object.assign(new Mesh(new BufferGeometry(), roadMat), { frustumCulled: false, visible: false });
      roadScene = new Scene();
      roadScene.add(roadMesh);
      lampMat = new ShaderMaterial({
        uniforms: { uG: { value: new Matrix4() }, uM: { value: new Matrix4() }, uT: { value: 0 }, uLamp: { value: new Vector3() } },
        vertexShader: VERT,
        fragmentShader: LAMP_FRAG,
        side: DoubleSide,
        transparent: true,
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneFactor,
        blendSrcAlpha: OneFactor,
        blendDstAlpha: OneFactor,
        depthTest: true,
        depthWrite: false,
        depthFunc: LessEqualDepth,
      });
      lampMesh = Object.assign(new Mesh(mesh.geometry, lampMat), { frustumCulled: false });
      lampScene = new Scene();
      lampScene.add(lampMesh);
      dirty = true;
      stop = effect(() => {
        void opts.items.value;
        void opts.frame.value;
        void reliefScale.value;
        void opts.weather?.value;
        void weatherMapOn.value;
        dirty = true;
        map.triggerRepaint();
      });
    },
    onRemove() {
      stop?.();
      stop = null;
      mesh?.geometry.dispose();
      mat?.dispose();
      lampMat?.dispose();
      roadMesh?.geometry.dispose();
      roadMat?.dispose();
      lampScene = lampMesh = lampMat = null;
      host?.release();
      host = null;
      scene = mesh = mat = null;
      roadScene = roadMesh = roadMat = null;
      cache.clear();
    },
    render(_gl, args) {
      if (!host || !scene || !mesh || !mat || !roadScene || !roadMesh || !roadMat) return;
      if (dirty) rebuild();
      if (!origin || (!mesh.visible && !roadMesh.visible)) return;
      setFrame(mat.uniforms, args);
      setFrame(roadMat.uniforms, args);
      const w = opts.weather?.peek();
      mat.uniforms.uSnow.value = roadMat.uniforms.uSnow.value = weatherMapOn.peek() && w ? snowOpacity(w.snowpack) / snowOpacity(1) : 0;
      host.draw((r) => {
        r.render(roadScene!, camera);
        r.render(scene!, camera);
      });
    },
  };
  // Window lights: the same mesh, glass only, when some light is on at this hour.
  const lamps: ModelLayer = {
    id: LAMP_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    render(_gl, args) {
      if (!host || !lampScene || !lampMat || !mesh?.visible || !origin || !opts.light) return;
      const minute = (((opts.light.clock.peek() + START_MINUTE_OF_DAY) % 1440) + 1440) % 1440;
      const k = (["house", "work", "tavern"] as const).map((kind) => lightOpacity(kind, minute / 60));
      if (Math.max(...k) < 0.01) return;
      const u = lampMat.uniforms;
      (u.uLamp.value as Vector3).set(k[0], k[1], k[2]);
      setFrame(u, args);
      host.draw((r) => r.render(lampScene!, camera));
    },
  };
  return { layer, lamps };
}

// Adds the layer to the map once the style has the layer it goes before ("buildings-outline", else "night-tint").
// Returns a function that detaches it.
export function attachModelLayer(map: maplibregl.Map, opts: ModelLayerOptions): () => void {
  const { layer, lamps } = createModelLayer(map, opts);
  const before = () => (opts.beforeId ? [opts.beforeId] : ["buildings-outline", "night-tint"]).find((id) => map.getLayer(id));
  let disposed = false;
  const add = () => {
    const b = before();
    if (disposed || map.getLayer(MODEL_LAYER_ID) || !b) return;
    map.addLayer(layer, b);
    // window lights above the night tint, under the ground glows
    map.addLayer(lamps, map.getLayer("life-lights-house") ? "life-lights-house" : undefined);
    map.off("styledata", add);
  };
  if (before()) add();
  else map.on("styledata", add);
  return () => {
    disposed = true;
    map.off("styledata", add);
    if (map.getLayer(MODEL_LAYER_ID)) map.removeLayer(MODEL_LAYER_ID);
    if (map.getLayer(LAMP_LAYER_ID)) map.removeLayer(LAMP_LAYER_ID);
  };
}

// ---- Debug switch: localStorage "debug3dModels" = "1" (main.ts imports this file only then, in dev) ----

export function attachModelDebug(map: maplibregl.Map, deps: { frame: ReadonlySignal<TownFrame | null>; light?: ModelLayerOptions["light"]; weather?: ModelLayerOptions["weather"] }): void {
  const items = signal<ModelItem[]>(demoModelItems());
  attachModelLayer(map, { items, frame: deps.frame, light: deps.light, weather: deps.weather });
  if (import.meta.env.DEV) Object.assign(window, { modelItems: items });
}

