import type maplibregl from "maplibre-gl";
import type { ReadonlySignal } from "@preact/signals";
import { effect, signal } from "@preact/signals";
import { BufferAttribute, BufferGeometry, Camera, DoubleSide, LessEqualDepth, Matrix4, Mesh, NoBlending, Scene, ShaderMaterial, Vector3 } from "three";
import { sunDirection } from "../sim/weather";
import { BUILDINGS } from "../sim/buildings";
import type { Frame as TownFrame } from "../world/frame";
import { sunLocal, sunStrength } from "./clouds/shadowMath";
import { buildHeritageModel } from "./heritageModels";
import { mergePacked, projectModel, type Packed } from "./modelBuffers";
import { buildScaffold, type Model, type XY } from "./modelGeometry";
import { buildTownModel } from "./townModels";
import { EARTH_RADIUS_M, localFrame, lngLatToMercator, mercatorLocalMatrix, metresPerMercator, weatherToSphere } from "./three/frame";
import { acquireHost, type ThreeHost } from "./three/host";

// Every building of the town drawn by three.js inside the MapLibre map: the town's own (townModels.ts) and restored old
// ones (heritageModels.ts), finished or under construction. Import this file only with a dynamic `import()` (it pulls in
// three.js); main.ts builds the item list, buildingLayer.ts keeps the 2D parts (planned lots, outlines) and the clicks.
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
// Lighting: faces are shaded by the sun direction (sim/weather sunDirection, in the town's east/north/up frame) like the
// fill-extrusions' default light: unlit faces at about half brightness. With the sun down (or no clock given) a fixed
// fallback direction is used, slightly dimmer; the night tint layer above darkens everything else. Walls darken towards
// the ground. Windows, doors, log courses, boards and shingle rows are painted from each vertex's facade code
// (modelGeometry.ts PATTERN) and fade to their average tone once they shrink to a few pixels, so distant towns do not shimmer.

export const MODEL_LAYER_ID = "building-models";
const R = EARTH_RADIUS_M;
const PROGRESS_STEPS = 24; // progress < 1 is quantised, so a slowly growing site does not rebuild its model every tick
const FALLBACK_LIGHT: [number, number, number] = [-0.45, -0.55, 0.7];

// A building to draw: ring in town-local metres, height in metres, progress 0..1 (below 1 the building-site look: log
// walls as high as the progress allows, corner posts at full height).
// - heritage: a restored old building; kind is its OSM class (the `cls` of src/sim/heritage.ts), height its eaves.
// - town: one of the town's own; kind is the template (src/sim/buildings.ts), height the template's (after an upgrade).
export interface ModelItem {
  id: string | number;
  ring: XY[];
  height: number;
  kind: string;
  progress: number;
  style: "heritage" | "town";
  level?: number; // town: 2 for a rebuilt house
  front?: XY | null; // town: unit vector towards the street (the door side)
  tint?: string; // town: overlay colour, "" or absent for none
  upgrading?: boolean; // town: a rebuild in progress
}

export interface ModelLayerOptions {
  items: ReadonlySignal<ModelItem[]>;
  frame: ReadonlySignal<TownFrame | null>;
  // Sun for the lighting: game minutes and the climate phase of the weather site. Omitted: fixed light.
  light?: { clock: ReadonlySignal<number>; phase: ReadonlySignal<number | null> };
  // Layer to insert before (default "buildings-outline", else "night-tint").
  beforeId?: string;
}

const VERT = /* glsl */ `
attribute vec3 aMerc;
attribute vec3 aColor;
attribute vec4 aFacade;
uniform mat4 uG;
uniform mat4 uM;
uniform float uT;
varying vec3 vN;
varying vec3 vC;
varying vec4 vF;
varying float vZ;
void main() {
  vec4 m = uM * vec4(aMerc, 1.0);
  vec4 g = uG * vec4(position, 1.0);
  // MapLibre's interpolateProjectionFor3D: mercator -> globe by the projection transition
  gl_Position = uT > 0.999 ? g : (uT <= 0.0 ? m : mix(m, g, uT));
  vN = normal;
  vC = aColor;
  vF = aFacade;
  vZ = aMerc.z; // height above the ground in metres
}`;

// Facade codes (modelGeometry.ts PATTERN): 1 house, 2 hall, 3 worship, 4 log courses, 5 wide, 6 tower, 7 roof rows,
// 8 boards, 9 log cabin; + 10 a door, + 20 a gate at the middle of the wall.
const FRAG = /* glsl */ `
uniform vec3 uLight;
uniform float uSun;
varying vec3 vN;
varying vec3 vC;
varying vec4 vF;
varying float vZ;

// Grid of windows on a wall: columns centred on the wall, one row per floor below the eaves. aw, az: pixel footprint in
// metres along s and z; once windows get that small the grid turns into its average coverage.
float windows(float s, float len, float z, float top, float aw, float az, float floorH, float sill, float wh, float ww, float sp) {
  float n = len >= ww + 1.4 ? floor((len - 1.4 - ww) / sp) + 1.0 : 0.0;
  float fl = floor(z / floorH);
  if (n < 1.0 || fl * floorH + sill + wh > top - 0.25) return 0.0;
  float start = (len - (n - 1.0) * sp) * 0.5;
  float c = clamp(floor((s - start) / sp + 0.5), 0.0, n - 1.0);
  float dx = abs(s - start - c * sp);
  float zl = z - fl * floorH;
  float mx = 1.0 - smoothstep(ww * 0.5 - aw, ww * 0.5 + aw, dx);
  float mz = smoothstep(sill - az, sill + az, zl) * (1.0 - smoothstep(sill + wh - az, sill + wh + az, zl));
  float far = smoothstep(0.25, 0.6, max(aw / ww, az / wh));
  return mix(mx * mz, 0.7 * ww * wh / (sp * floorH), far);
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

void main() {
  float z = vZ;
  float aw = max(fwidth(vF.x), 1e-4), az = max(fwidth(z), 1e-4); // outside any branch: derivatives need uniform flow
  int code = int(vF.w + 0.5);
  int dk = code / 10; // 1 door, 2 gate
  int p = code - dk * 10;
  vec3 col = vC;
  // window grid per facade: floor height, sill, window height, width, spacing (metres)
  vec4 g = vec4(0.0);
  float sp = 0.0;
  if (p == 1) { g = vec4(3.0, 0.9, 1.25, 1.0); sp = 2.6; }
  else if (p == 2) { g = vec4(3.8, 1.0, 2.0, 1.3); sp = 3.0; }
  else if (p == 3) { g = vec4(100.0, 2.2, clamp(vF.z - 3.4, 1.4, 4.0), 0.9); sp = 3.4; }
  else if (p == 5) { g = vec4(4.5, 2.0, 1.6, 2.4); sp = 3.4; }
  else if (p == 6) { g = vec4(3.5, 1.2, 1.3, 0.55); sp = 2.2; }
  else if (p == 9) { g = vec4(3.0, 0.9, 1.0, 0.85); sp = 2.4; col *= 1.0 - 0.2 * seams(z, az, 0.3); }
  else if (p == 4) col *= 1.0 - 0.2 * seams(z, az, 0.32);
  else if (p == 7) col *= 1.0 - 0.12 * seams(z, az, 0.42);
  else if (p == 8) col *= 1.0 - 0.16 * seams(vF.x, aw, 0.28);
  // a door at the middle of the wall: no windows next to it on the ground floor
  float dw = dk == 2 ? 2.6 : 1.0, dh = dk == 2 ? 2.5 : 2.0;
  float dx = abs(vF.x - vF.y * 0.5);
  bool nearDoor = dk > 0 && dx < dw * 0.5 + 0.6 && z < dh + 0.4;
  if (sp > 0.0 && !nearDoor) {
    // glass inside a light frame 0.1 m wide
    float glass = windows(vF.x, vF.y, z, vF.z, aw, az, g.x, g.y, g.z, g.w, sp);
    float frame = windows(vF.x, vF.y, z, vF.z, aw, az, g.x, g.y - 0.1, g.z + 0.2, g.w + 0.2, sp);
    col = mix(col, mix(col, vec3(0.95, 0.92, 0.84), 0.6), max(frame - glass, 0.0));
    col = mix(col, vec3(0.22, 0.25, 0.28), glass);
  }
  if (dk > 0) {
    float leaf = doorway(dx, z, aw, az, dw, dh);
    float frame = doorway(dx, z, aw, az, dw + 0.24, dh + 0.12);
    vec3 wood = vec3(0.30, 0.22, 0.15);
    if (dk == 2) wood *= 1.0 - 0.35 * (1.0 - smoothstep(0.03, 0.06 + aw, dx)); // the seam between the two leaves
    col = mix(col, mix(col, vec3(0.95, 0.92, 0.84), 0.5), max(frame - leaf, 0.0));
    col = mix(col, wood, leaf);
  }
  vec3 n = normalize(vN);
  float d = max(dot(n, uLight), 0.0);
  float k = mix(0.55, 1.0, d) * mix(0.88, 1.0, uSun);
  if (abs(n.z) < 0.5) k *= mix(0.78, 1.0, smoothstep(0.0, 2.5, z)); // walls darken towards the ground
  gl_FragColor = vec4(col * k, 1.0);
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

// Model of an item. Unfinished: the building site.
export function modelOf(it: ModelItem): Model {
  if (it.progress < 1) return buildScaffold(it.ring, it.height, it.progress);
  if (it.style === "heritage") return buildHeritageModel(it.ring, it.height, it.kind);
  return buildTownModel(it.ring, it.height, it.kind, { level: it.level, front: it.front, tint: it.tint || null, upgrading: it.upgrading });
}

const quantise = (p: number): number => (p >= 1 ? 1 : Math.min(PROGRESS_STEPS - 1, Math.max(0, Math.floor((Number.isFinite(p) ? p : 0) * PROGRESS_STEPS))) / PROGRESS_STEPS);
// Everything that shapes an item's model (its id is not: two identical buildings share a model).
const keyOf = (it: ModelItem, p: number): string => {
  const ring = it.ring.map((q) => `${q[0]},${q[1]}`).join(";");
  if (p < 1) return `site|${it.height}|${p}|${ring}`;
  const f = it.front ? `${it.front[0].toFixed(3)},${it.front[1].toFixed(3)}` : "";
  return `${it.style}|${it.kind}|${it.height}|${it.level ?? 1}|${f}|${it.tint ?? ""}|${it.upgrading ? 1 : 0}|${ring}`;
};

export type ModelLayer = maplibregl.CustomLayerInterface;

export function createModelLayer(map: maplibregl.Map, opts: ModelLayerOptions): ModelLayer {
  let host: ThreeHost | null = null;
  let scene: Scene | null = null;
  let mesh: Mesh | null = null;
  let mat: ShaderMaterial | null = null;
  let stop: (() => void) | null = null;
  let dirty = true;
  let origin: { lng: number; lat: number } | null = null; // the layer origin the packs were projected for
  const cache = new Map<string, Packed>();
  const camera = new Camera();
  const lg = new Float64Array(16);
  const g64 = new Float64Array(16);
  const light = new Vector3(...norm3(FALLBACK_LIGHT));

  const fill = (b: Packed) => {
    if (!mesh) return;
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(b.g, 3));
    geo.setAttribute("aMerc", new BufferAttribute(b.m, 3));
    geo.setAttribute("normal", new BufferAttribute(b.n, 3));
    geo.setAttribute("aColor", new BufferAttribute(b.c, 3));
    geo.setAttribute("aFacade", new BufferAttribute(b.f, 4));
    geo.setIndex(new BufferAttribute(b.i, 1));
    mesh.geometry.dispose();
    mesh.geometry = geo;
    mesh.visible = b.i.length > 0;
  };

  // Rebuilds the merged mesh; runs once per change of the item list (or the town frame), never per frame.
  const rebuild = () => {
    const tf = opts.frame.peek();
    if (!mesh || !tf) return;
    const [lng, lat] = tf.toLngLat(0, 0);
    if (!origin || origin.lng !== lng || origin.lat !== lat) cache.clear();
    origin = { lng, lat };
    const used = new Set<string>();
    const packs: Packed[] = [];
    for (const it of opts.items.peek()) {
      const p = quantise(it.progress);
      const key = keyOf(it, p);
      used.add(key);
      let pack = cache.get(key);
      if (!pack) cache.set(key, (pack = projectModel(modelOf({ ...it, progress: p }), tf.toLngLat, origin)));
      packs.push(pack);
    }
    for (const k of [...cache.keys()]) if (!used.has(k)) cache.delete(k);
    fill(mergePacked(packs));
    dirty = false;
  };

  const layer: ModelLayer = {
    id: MODEL_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(_m, gl) {
      host = acquireHost(map, gl as WebGL2RenderingContext);
      mat = new ShaderMaterial({
        uniforms: { uG: { value: new Matrix4() }, uM: { value: new Matrix4() }, uT: { value: 0 }, uLight: { value: light }, uSun: { value: 0 } },
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
      dirty = true;
      stop = effect(() => {
        void opts.items.value;
        void opts.frame.value;
        dirty = true;
        map.triggerRepaint();
      });
    },
    onRemove() {
      stop?.();
      stop = null;
      mesh?.geometry.dispose();
      mat?.dispose();
      host?.release();
      host = null;
      scene = mesh = mat = null;
      cache.clear();
    },
    render(_gl, args) {
      if (!host || !scene || !mesh || !mat) return;
      if (dirty) rebuild();
      if (!origin || !mesh.visible) return;
      const o = origin;
      const fr = host.frame(args.defaultProjectionData);
      // mercator: local metres -> clip through the fallback (always the mercator matrix)
      const s = metresPerMercator(o.lat);
      const um = Float32Array.from(mercatorLocalMatrix(fr.fallback, lngLatToMercator(o.lng, o.lat), s));
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
      const lt = opts.light;
      const phase = lt?.phase.peek();
      if (lt && phase !== null && phase !== undefined) {
        const sl = sunLocal(weatherToSphere(sunDirection(lt.clock.peek(), phase)), f);
        sun = sunStrength(sl.sinElev);
        if (sun > 0) {
          const d = norm3([sl.east, sl.north, Math.max(sl.sinElev, 0.05)]);
          const fb = norm3(FALLBACK_LIGHT);
          light.set(...norm3([fb[0] + (d[0] - fb[0]) * sun, fb[1] + (d[1] - fb[1]) * sun, fb[2] + (d[2] - fb[2]) * sun]));
        }
      }
      const u = mat.uniforms;
      (u.uM.value as Matrix4).fromArray(um);
      (u.uG.value as Matrix4).fromArray(ug);
      u.uT.value = fr.transition;
      u.uSun.value = sun;
      host.draw((r) => r.render(scene!, camera));
    },
  };
  return layer;
}

// Adds the layer to the map once the style has the layer it goes before ("buildings-outline", else "night-tint").
// Returns a function that detaches it.
export function attachModelLayer(map: maplibregl.Map, opts: ModelLayerOptions): () => void {
  const layer = createModelLayer(map, opts);
  const before = () => (opts.beforeId ? [opts.beforeId] : ["buildings-outline", "night-tint"]).find((id) => map.getLayer(id));
  let disposed = false;
  const add = () => {
    const b = before();
    if (disposed || map.getLayer(MODEL_LAYER_ID) || !b) return;
    map.addLayer(layer, b);
    map.off("styledata", add);
  };
  if (before()) add();
  else map.on("styledata", add);
  return () => {
    disposed = true;
    map.off("styledata", add);
    if (map.getLayer(MODEL_LAYER_ID)) map.removeLayer(MODEL_LAYER_ID);
  };
}

// ---- Debug switch: localStorage "debug3dModels" = "1" (main.ts imports this file only then, in dev) ----

// Every model kind side by side around the town centre: the town templates in rows, the restored kinds below, a few
// building sites. Scale via localStorage "debug3dModelsScale" (at 40 the set reads at globe zooms). In dev
// `window.modelItems` is the item signal for hand-made lists.
const rect = (cx: number, cy: number, w: number, d: number, rot = 0): XY[] => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as XY[]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
};
const DEMO_K = (() => {
  try {
    return Number(localStorage.getItem("debug3dModelsScale")) || 1;
  } catch {
    return 1;
  }
})();
const scaled = (ring: XY[]): XY[] => ring.map(([x, y]) => [x * DEMO_K, y * DEMO_K]);

function demoItems(): ModelItem[] {
  const out: ModelItem[] = [];
  let id = 1;
  // town templates: the street runs along y = 0 between the two rows, doors face it
  const templates = Object.values(BUILDINGS).filter((t) => t.id !== "restored");
  templates.forEach((t, i) => {
    const row = i % 2 === 0 ? 1 : -1;
    const x = -100 + Math.floor(i / 2) * 16;
    const cy = row * (4 + t.deep / 2);
    out.push({ id: id++, ring: scaled(rect(x, cy, t.along, t.deep)), height: t.height * DEMO_K, kind: t.id, progress: 1, style: "town", front: [0, -row] });
  });
  // a street of houses: same template, different seeds; a rebuilt one, an upgrading one, a tinted one
  for (let k = 0; k < 8; k++) {
    const t = BUILDINGS[k % 3 === 2 ? "izba5" : "izba"];
    out.push({ id: id++, ring: scaled(rect(-100 + k * 11, 30, t.along, t.deep)), height: (t.height + (k === 5 ? 1.5 : 0)) * DEMO_K, kind: t.id, progress: 1, style: "town", front: [0, -1], level: k === 5 ? 2 : 1, upgrading: k === 6, tint: k === 7 ? "#6f8a3a" : "" });
  }
  // building sites
  for (const [k, p] of [0.1, 0.5, 0.9].entries()) out.push({ id: id++, ring: scaled(rect(-12 + k * 11, 30, 6, 7)), height: 5 * DEMO_K, kind: "izba", progress: p, style: "town" });
  // restored kinds
  const heritage: [XY[], number, string][] = [
    [rect(-100, -40, 18, 10), 6, "house"],
    [rect(-75, -40, 14, 11), 8, "place_of_worship"],
    [rect(-50, -40, 16, 9, 0.5), 5, "school"],
    [rect(-20, -40, 30, 12), 4, "station"],
    [rect(10, -40, 10, 10), 8, "castle"],
    [[[25, -50], [45, -50], [45, -42], [37, -42], [37, -28], [25, -28]], 6, "house"],
    [rect(70, -40, 36, 12, 0.3), 8, "place_of_worship"],
  ];
  for (const [ring, h, kind] of heritage) out.push({ id: id++, ring: scaled(ring), height: h * DEMO_K, kind, progress: 1, style: "heritage" });
  return out;
}

export function attachModelDebug(map: maplibregl.Map, deps: { frame: ReadonlySignal<TownFrame | null>; light?: ModelLayerOptions["light"] }): void {
  const items = signal<ModelItem[]>(demoItems());
  attachModelLayer(map, { items, frame: deps.frame, light: deps.light });
  if (import.meta.env.DEV) Object.assign(window, { modelItems: items });
}
