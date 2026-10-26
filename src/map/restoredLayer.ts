import type maplibregl from "maplibre-gl";
import type { ReadonlySignal } from "@preact/signals";
import { effect, signal } from "@preact/signals";
import { BufferAttribute, BufferGeometry, Camera, CustomBlending, DoubleSide, LessEqualDepth, Matrix4, Mesh, NoBlending, OneFactor, OneMinusSrcAlphaFactor, Scene, ShaderMaterial, Vector3 } from "three";
import { sunDirection } from "../sim/weather";
import type { Building } from "../sim/types";
import type { Frame as TownFrame } from "../world/frame";
import { PALETTE } from "../ui/palette";
import { sunLocal, sunStrength } from "./clouds/shadowMath";
import { buildHeritageModel, buildScaffold, type HeritageModel, type XY } from "./heritageModels";
import { appendModel, emptyBuffers, type Buffers } from "./restoredBuffers";
import { restoredIds } from "./restoredIds";
import { EARTH_RADIUS_M, localFrame, lngLatToMercator, mercatorLocalMatrix, metresPerMercator, weatherToSphere } from "./three/frame";
import { acquireHost, type ThreeHost } from "./three/host";

// Restored old buildings drawn by three.js inside the MapLibre map (PLAN-research.ru.md section 8). Import this file only
// with a dynamic `import()` (it pulls in three.js); restoredIds.ts is the main-chunk side of it.
//
// One custom layer with `renderingMode: "3d"`: MapLibre sets its 3D depth mode (shared depth buffer with fill-extrusion,
// LEQUAL, read-write, 3D depth range) before `render`, and the materials keep depth test on, so meshes and fill-extrusions
// occlude each other per pixel.
//
// GL-state contract (host.draw resets three's state, so each material states everything it needs):
// - finished buildings: one opaque mesh, NoBlending, depth test LEQUAL + write, DoubleSide;
// - buildings under construction: one pale mesh drawn after it, premultiplied blending (ONE, ONE_MINUS_SRC_ALPHA, as
//   MapLibre custom layers composite), depth test on, depth write off.
// The layer is added before "night-tint" (like the cloud shadows), so the dusk tint and the cloud shadows darken it.
//
// Projection: each vertex is stored twice (restoredBuffers.ts), in a globe tangent frame and in a mercator frame, both in
// metres relative to the layer origin and computed in float64 on the CPU from the vertex's lng/lat:
// - globe: exact tangent coordinates of the point (R + h) * unit(lng, lat) about the origin, so the map to the unit sphere
//   is affine: sphere = o + (E e + N n + U o) / R. Matrix = main * that, in float64 per frame.
// - mercator: east = dLng * R cos(lat0), north = R cos(lat0) * (ymerc(lat) - ymerc(lat0)), up = h, through
//   mercatorLocalMatrix(fallback, ...) (the same helper the shadow layer uses).
// The vertex shader mixes the two clip positions with `projectionTransition`, exactly like MapLibre's
// interpolateProjectionFor3D does for fill-extrusion, so depth values agree through the projection transition.
//
// Lighting: faces are shaded by the sun direction (sim/weather sunDirection, in the town's east/north/up frame) like the
// fill-extrusions' default light: unlit faces at about half brightness. With the sun down (or no clock given) a fixed
// fallback direction is used, slightly dimmer; the night tint layer above darkens everything else.

export const RESTORED_LAYER_ID = "restored-buildings";
const R = EARTH_RADIUS_M;
const SCAFFOLD_ALPHA = 0.72;
const PROGRESS_STEPS = 24; // progress < 1 is quantised, so a slowly growing site does not rebuild its model every tick
const FALLBACK_LIGHT: [number, number, number] = [-0.45, -0.55, 0.7];

// A building to draw: ring in town-local metres, eaves height in metres, OSM kind (the `cls` of src/sim/heritage.ts),
// progress 0..1 (below 1 the pale scaffold look: walls only, as high as the progress allows).
export interface RestoredItem {
  id: string | number;
  ring: XY[];
  height: number;
  kind: string;
  progress: number;
}

export interface RestoredOptions {
  items: ReadonlySignal<RestoredItem[]>;
  frame: ReadonlySignal<TownFrame | null>;
  // Sun for the lighting: game minutes and the climate phase of the weather site. Omitted: fixed light.
  light?: { clock: ReadonlySignal<number>; phase: ReadonlySignal<number | null> };
  // Publish the drawn ids to `restoredIds` for buildingLayer (default true).
  publishIds?: boolean;
  // Layer to insert before (default "night-tint").
  beforeId?: string;
}

const VERT = /* glsl */ `
attribute vec3 aMerc;
attribute vec3 aColor;
uniform mat4 uG;
uniform mat4 uM;
uniform float uT;
varying vec3 vN;
varying vec3 vC;
void main() {
  vec4 m = uM * vec4(aMerc, 1.0);
  vec4 g = uG * vec4(position, 1.0);
  // MapLibre's interpolateProjectionFor3D: mercator -> globe by the projection transition
  gl_Position = uT > 0.999 ? g : (uT <= 0.0 ? m : mix(m, g, uT));
  vN = normal;
  vC = aColor;
}`;

const FRAG = /* glsl */ `
uniform vec3 uLight;
uniform float uSun;
uniform float uAlpha;
varying vec3 vN;
varying vec3 vC;
void main() {
  float d = max(dot(normalize(vN), uLight), 0.0);
  float k = mix(0.55, 1.0, d) * mix(0.88, 1.0, uSun);
  gl_FragColor = vec4(vC * k * uAlpha, uAlpha); // premultiplied (alpha 1 for opaque)
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

// Model of an item. Unfinished: scaffold walls only.
export function modelOf(it: RestoredItem): HeritageModel {
  return it.progress >= 1 ? buildHeritageModel(it.ring, it.height, it.kind) : buildScaffold(it.ring, it.height, it.progress);
}

const quantise = (p: number): number => (p >= 1 ? 1 : Math.min(PROGRESS_STEPS - 1, Math.max(0, Math.floor((Number.isFinite(p) ? p : 0) * PROGRESS_STEPS))) / PROGRESS_STEPS);
const keyOf = (it: RestoredItem, p: number): string => `${p >= 1 ? it.kind : "scaffold"}|${it.height}|${p}|${it.ring.map((q) => `${q[0]},${q[1]}`).join(";")}`;

export type RestoredLayer = maplibregl.CustomLayerInterface;

export function createRestoredLayer(map: maplibregl.Map, opts: RestoredOptions): RestoredLayer {
  let host: ThreeHost | null = null;
  let scene: Scene | null = null;
  let done: Mesh | null = null; // finished buildings
  let site: Mesh | null = null; // under construction
  let doneMat: ShaderMaterial | null = null;
  let siteMat: ShaderMaterial | null = null;
  let stop: (() => void) | null = null;
  let dirty = true;
  let origin: { lng: number; lat: number } | null = null; // the layer origin the buffers were built for
  const cache = new Map<string, HeritageModel>();
  const camera = new Camera();
  const lg = new Float64Array(16);
  const g64 = new Float64Array(16);
  const light = new Vector3(...norm3(FALLBACK_LIGHT));

  const fill = (mesh: Mesh, b: Buffers) => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array(b.g), 3));
    geo.setAttribute("aMerc", new BufferAttribute(new Float32Array(b.m), 3));
    geo.setAttribute("normal", new BufferAttribute(new Float32Array(b.n), 3));
    geo.setAttribute("aColor", new BufferAttribute(new Float32Array(b.c), 3));
    geo.setIndex(new BufferAttribute(new Uint32Array(b.i), 1));
    mesh.geometry.dispose();
    mesh.geometry = geo;
    mesh.visible = b.i.length > 0;
  };

  // Rebuilds the merged meshes; runs once per change of the item list (or the town frame), never per frame.
  const rebuild = () => {
    const tf = opts.frame.peek();
    if (!done || !site || !tf) return;
    const [lng, lat] = tf.toLngLat(0, 0);
    origin = { lng, lat };
    const a = emptyBuffers(), b = emptyBuffers();
    const used = new Set<string>();
    for (const it of opts.items.peek()) {
      const p = quantise(it.progress);
      const key = keyOf(it, p);
      used.add(key);
      let model = cache.get(key);
      if (!model) cache.set(key, (model = modelOf({ ...it, progress: p })));
      appendModel(p >= 1 ? a : b, model, tf.toLngLat, origin);
    }
    for (const k of [...cache.keys()]) if (!used.has(k)) cache.delete(k);
    fill(done, a);
    fill(site, b);
    dirty = false;
  };

  const material = (alpha: number, transparent: boolean) =>
    new ShaderMaterial({
      uniforms: { uG: { value: new Matrix4() }, uM: { value: new Matrix4() }, uT: { value: 0 }, uLight: { value: light }, uSun: { value: 0 }, uAlpha: { value: alpha } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: DoubleSide,
      transparent,
      blending: transparent ? CustomBlending : NoBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
      depthTest: true,
      depthWrite: !transparent,
      depthFunc: LessEqualDepth,
    });

  const layer: RestoredLayer = {
    id: RESTORED_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(_m, gl) {
      host = acquireHost(map, gl as WebGL2RenderingContext);
      doneMat = material(1, false);
      siteMat = material(SCAFFOLD_ALPHA, true);
      done = Object.assign(new Mesh(new BufferGeometry(), doneMat), { frustumCulled: false, visible: false });
      site = Object.assign(new Mesh(new BufferGeometry(), siteMat), { frustumCulled: false, visible: false, renderOrder: 1 });
      scene = new Scene();
      scene.add(done, site);
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
      done?.geometry.dispose();
      site?.geometry.dispose();
      doneMat?.dispose();
      siteMat?.dispose();
      host?.release();
      host = null;
      scene = done = site = doneMat = siteMat = null;
      cache.clear();
    },
    render(_gl, args) {
      if (!host || !scene || !done || !site || !doneMat || !siteMat) return;
      if (dirty) rebuild();
      if (!origin || (!done.visible && !site.visible)) return;
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
      for (const m of [doneMat, siteMat]) {
        const u = m.uniforms;
        (u.uM.value as Matrix4).fromArray(um);
        (u.uG.value as Matrix4).fromArray(ug);
        u.uT.value = fr.transition;
        u.uSun.value = sun;
      }
      host.draw((r) => r.render(scene!, camera));
    },
  };
  return layer;
}

// Adds the production layer to the map (before "night-tint" so the dusk tint and cloud shadows darken it) once the style
// has that layer, and publishes the drawn ids for buildingLayer. Returns a function that detaches everything.
export function attachRestoredLayer(map: maplibregl.Map, opts: RestoredOptions): () => void {
  const layer = createRestoredLayer(map, opts);
  const before = opts.beforeId ?? "night-tint";
  let disposed = false;
  const add = () => {
    if (disposed || map.getLayer(RESTORED_LAYER_ID) || !map.getLayer(before)) return;
    map.addLayer(layer, before);
    map.off("styledata", add);
  };
  if (map.getLayer(before)) add();
  else map.on("styledata", add);
  const stopIds =
    opts.publishIds === false
      ? () => {}
      : effect(() => {
          restoredIds.value = new Set(opts.items.value.map((i) => i.id));
        });
  return () => {
    disposed = true;
    map.off("styledata", add);
    stopIds();
    if (opts.publishIds !== false) restoredIds.value = new Set();
    if (map.getLayer(RESTORED_LAYER_ID)) map.removeLayer(RESTORED_LAYER_ID);
  };
}

// ---- Debug switch: localStorage "debug3dRestored" = "1" (main.ts imports this file only then, in dev) ----

const rect = (cx: number, cy: number, w: number, d: number, rot = 0): XY[] => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as XY[]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
};
// Demo scale (localStorage "debug3dRestoredScale"): at 40 the set is 2 km wide, readable at the globe/mercator zooms.
const DEMO_K = (() => {
  try {
    return Number(localStorage.getItem("debug3dRestoredScale")) || 1;
  } catch {
    return 1;
  }
})();
const scaled = (ring: XY[]): XY[] => ring.map(([x, y]) => [x * DEMO_K, y * DEMO_K]);
const demo = (id: number, ring: XY[], height: number, kind: string, progress = 1): RestoredItem => ({ id, ring: scaled(ring), height: height * DEMO_K, kind, progress });
const DEMO_ITEMS: RestoredItem[] = [
  demo(1, rect(0, 0, 18, 10), 6, "house"),
  demo(2, rect(0, -28, 14, 8), 6, "house", 0.5),
  demo(3, rect(-30, 8, 14, 11), 8, "place_of_worship"),
  demo(4, rect(36, 14, 16, 9, 0.5), 5, "school"),
  demo(5, rect(0, 30, 30, 12), 4, "station"),
  demo(6, rect(60, -10, 10, 10), 8, "castle"), // seam test: shares its east wall with the fill-extrusion box below
  demo(7, [[-60, -20], [-40, -20], [-40, -12], [-48, -12], [-48, 2], [-60, 2]], 6, "house"), // concave L
  demo(8, rect(-60, 30, 36, 12, 0.3), 8, "place_of_worship"),
];
// Fill-extrusion neighbours (rings in local metres, height): intersect or stand in front of / behind the meshes.
const DEMO_FE: { ring: XY[]; h: number }[] = [
  { ring: rect(14, 0, 8, 8), h: 22 },
  { ring: rect(0, -18, 40, 3), h: 12 },
  { ring: rect(-26, 8, 10, 4), h: 10 },
  { ring: rect(-30, 22, 16, 10), h: 7 },
  { ring: rect(0, 30, 6, 40), h: 9 },
  { ring: rect(70, -10, 10, 10), h: 8 },
].map((b) => ({ ring: scaled(b.ring), h: b.h * DEMO_K }));
let demoShown: boolean | null = null;
function demoFillExtrusions(map: maplibregl.Map, f: TownFrame | null): void {
  if (!map.getLayer(RESTORED_LAYER_ID) || demoShown === (f !== null)) return;
  demoShown = f !== null;
  if (!map.getSource("restored-demo-fe")) {
    map.addSource("restored-demo-fe", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addLayer({ id: "restored-demo-fe", type: "fill-extrusion", source: "restored-demo-fe", paint: { "fill-extrusion-color": PALETTE.info, "fill-extrusion-height": ["get", "h"], "fill-extrusion-base": 0 } }, RESTORED_LAYER_ID);
  }
  const features: GeoJSON.Feature[] = f
    ? DEMO_FE.map((b) => {
        const pts = b.ring.map(([x, y]) => f.toLngLat(x, y));
        return { type: "Feature", properties: { h: b.h }, geometry: { type: "Polygon", coordinates: [[...pts, pts[0]]] } };
      })
    : [];
  (map.getSource("restored-demo-fe") as maplibregl.GeoJSONSource).setData({ type: "FeatureCollection", features });
}

const DEBUG_KINDS = ["house", "place_of_worship", "station", "school", "castle", "house", "town_hall"];

// Draws the town's finished buildings again as restored models, shifted so they overlap their fill-extrusion twins and
// neighbours (occlusion between the two kinds can be judged by eye), with the kind cycling through DEBUG_KINDS; with no
// finished buildings a fixed demo set of every family is shown instead. Offset (metres) via localStorage
// "debug3dRestoredOffset" = "dx,dy" (default 9,5). In dev `window.restoredItems` is the item signal for hand-made lists.
export function attachRestoredDebug(
  map: maplibregl.Map,
  deps: {
    buildings: ReadonlySignal<Record<number, Building> | null>;
    frame: ReadonlySignal<TownFrame | null>;
    light?: RestoredOptions["light"];
  },
): void {
  const items = signal<RestoredItem[]>([]);
  const offsetRaw = (() => {
    try {
      return localStorage.getItem("debug3dRestoredOffset");
    } catch {
      return null;
    }
  })();
  const [dx, dy] = (offsetRaw ?? "9,5").split(",").map(Number);
  attachRestoredLayer(map, { items, frame: deps.frame, light: deps.light, publishIds: false });
  effect(() => {
    const list = deps.buildings.value;
    const f = deps.frame.value;
    if (!list || !f) return;
    const out: RestoredItem[] = [];
    let n = 0;
    for (const b of Object.values(list))
      if (b.state === "active") out.push({ id: b.id, ring: b.footprint.map(([x, y]) => [x + dx, y + dy] as XY), height: b.height * 1.2, kind: DEBUG_KINDS[n++ % DEBUG_KINDS.length], progress: 1 });
    // No finished buildings yet: a fixed demo set, meshes interleaved with fill-extrusion boxes that intersect them.
    const isDemo = out.length === 0;
    demoFillExtrusions(map, isDemo ? f : null);
    items.value = isDemo ? DEMO_ITEMS : out;
  });
  map.on("styledata", () => demoFillExtrusions(map, items.peek() === DEMO_ITEMS ? deps.frame.peek() : null));
  if (import.meta.env.DEV) Object.assign(window, { restoredItems: items });
}
