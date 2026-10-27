import type maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import {
  BufferAttribute,
  Camera,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  LessEqualDepth,
  Matrix4,
  Mesh,
  NoBlending,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
} from "three";
import type { WeatherState } from "../sim/weather";
import { TREE_COLORS } from "../ui/palette";
import type { Frame as TownFrame } from "../world/frame";
import type { Box, ForestSource } from "./forest";
import { projectPoints } from "./modelBuffers";
import { rgb } from "./modelGeometry";
import { frameSetter, type ModelLayerOptions } from "./modelLayer";
import { groundAt, loadGround, reliefScale } from "./relief";
import { buildTree, crownAt, TREE_LODS } from "./treeModels";
import { CHUNK, TREE_KINDS, TREE_STRIDE, TREES_FROM_ZOOM } from "./treeScatter";
import { acquireHost, type ThreeHost } from "./three/host";

// The 3D forest (PLAN-3d-world.ru.md stage 4): the trees of forest.ts drawn by three.js inside the map, on the same
// projection and light as the building models (modelLayer.ts frameSetter; each instance's base is projected in float64
// on the CPU into both frames, its tree added in metres). Import only with a dynamic `import()` (it pulls in three.js).
//
// Only what the camera sees: the plane is cut into square chunks (forest.ts CHUNK); each frame picks the chunks under
// the screen (its border unprojected onto the ground, no farther than VIEW_MAX), nearest first, up to MAX_TREES trees.
// A chunk's trees are scattered and projected once and cached; new chunks are built within FRAME_BUDGET ms per frame,
// so moving the camera never stalls on them. Levels of detail per chunk by its distance from the camera: full trees
// near, a few faces farther, and flat crowns for a view from straight above. One instanced mesh per kind and level, its
// instances in one interleaved buffer refilled (not reallocated) as the view changes.
//
// Close up only: below TREES_FROM_ZOOM the forest is the 2D fill alone, and up to GROW_TO the trees grow in. Deciduous
// crowns follow the season (bare in winter), snow lies on the crowns while there is a snowpack, and the trees sway in
// the wind of the weather (westerly, the zonal wind of sim/weather.ts).

export const TREE_LAYER_ID = "forest-trees";
const GROW_TO = TREES_FROM_ZOOM + 1;
const MAX_TREES = 80_000;
const VIEW_MAX = 3000; // m from the camera's ground point
const NEAR = 450; // m from the camera: full trees within
const FLAT_PITCH = 18; // degrees: flatter views get flat crowns
const FRAME_BUDGET = 4; // ms of chunk building per frame
const ASSEMBLE_EVERY = 100; // ms: the instance buffers are refilled at most this often while the view changes
const SINK = 0.3; // m: trunks start below the ground, which our samples follow only closely on slopes
const WIND_DIR: [number, number] = [0.98, 0.2]; // toward the east
const WIND_FULL = 14; // m/s: full sway
const PER = 10; // floats per instance: globe base (3), mercator base (3), size, turn, hash, shade

const VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aCrown;
attribute vec3 iG;
attribute vec3 iM;
attribute vec4 iP; // size, turn, hash, shade
uniform mat4 uG;
uniform mat4 uM;
uniform float uT;
uniform float uTime;
uniform float uGrow;
uniform float uBare;
uniform vec3 uWind; // direction, strength
varying vec3 vN;
varying vec3 vC;
varying float vCrown;
varying float vH;
varying float vHash;
varying float vShade;
varying vec3 vP;
void main() {
  float s = iP.x * uGrow;
  vec3 p = position;
  if (aCrown > 0.5) p.xy *= 1.0 - 0.45 * uBare; // leafless: only the thinner frame of branches
  float c = cos(iP.y), sn = sin(iP.y);
  p = vec3(c * p.x - sn * p.y, sn * p.x + c * p.y, p.z) * s;
  // sway: grows with the square of the height, gusts out of phase from tree to tree
  float gust = 0.35 + 0.65 * sin(uTime * (1.1 + 0.5 * iP.z) + iP.z * 40.0);
  p.xy += uWind.xy * uWind.z * gust * position.z * position.z * s * 0.03;
  vec4 m = uM * vec4(iM + p, 1.0);
  vec4 g = uG * vec4(iG + p, 1.0);
  gl_Position = uT > 0.999 ? g : (uT <= 0.0 ? m : mix(m, g, uT));
  vN = vec3(c * normal.x - sn * normal.y, sn * normal.x + c * normal.y, normal.z);
  vC = aColor;
  vCrown = aCrown;
  vH = position.z;
  vHash = iP.z;
  vShade = iP.w;
  vP = position * iP.x + iP.z * 17.0; // metres in the tree, shifted per tree: holes and snow patches differ
}`;

const FRAG = /* glsl */ `
uniform vec3 uLight;
uniform float uSun;
uniform vec4 uTint;
uniform float uSeasonal;
uniform float uBare;
uniform float uSnow;
uniform vec3 uCrownA;
uniform vec3 uCrownB;
uniform vec3 uBareCol;
uniform vec3 uSnowCol;
uniform vec3 uLeafBase; // the leaf colour the meshes are built with: seasonal crowns keep its light and shade
varying vec3 vN;
varying vec3 vC;
varying float vCrown;
varying float vH;
varying float vHash;
varying float vShade;
varying vec3 vP;
float cell(vec3 p) {
  return fract(sin(dot(floor(p), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}
void main() {
  vec3 col = vC;
  vec3 n = normalize(vN);
  if (vCrown > 0.5) {
    // a leafless crown is a see-through tangle of twigs: most of it is cut away in small cells
    if (uBare > 0.01 && cell(vP * 2.2) < uBare * 0.7) discard;
    if (uSeasonal > 0.5) col = mix(mix(uCrownA, uCrownB, fract(vHash * 7.31)), uBareCol, uBare) * (dot(vC, vec3(1.0)) / dot(uLeafBase, vec3(1.0)));
    col *= vShade * mix(0.7, 1.05, smoothstep(0.1, 1.0, vH)); // darker deep in the crown
    // snow lies in patches on the branches that face up
    float spot = smoothstep(0.35, 0.65, cell(vP * 1.6 + 3.1));
    col = mix(col, uSnowCol, uSnow * smoothstep(0.12, 0.45, n.z) * mix(0.35, 0.95, spot));
  }
  float d = max(dot(n, uLight), 0.0);
  float k = mix(0.55, 1.0, d) * mix(0.88, 1.0, uSun);
  gl_FragColor = vec4(mix(col * k, uTint.rgb, uTint.a), 1.0);
}`;

export interface TreeLayerOptions {
  source: ForestSource;
  frame: ReadonlySignal<TownFrame | null>;
  light?: ModelLayerOptions["light"];
  weather: ReadonlySignal<WeatherState | null>;
}

// One chunk's instances by kind, PER floats each.
interface Chunk {
  i: number;
  j: number;
  kinds: Float32Array[];
}

// A growable interleaved instance buffer behind one mesh.
interface Slot {
  mesh: Mesh;
  buf: InstancedInterleavedBuffer | null;
  count: number;
}

const chunkKey = (i: number, j: number) => `${i},${j}`;
const overlaps = (c: Chunk, b: Box) => (c.i + 1) * CHUNK >= b[0] && c.i * CHUNK <= b[2] && (c.j + 1) * CHUNK >= b[1] && c.j * CHUNK <= b[3];

function pointSegDist(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2));
  return Math.hypot(a[0] + dx * t - px, a[1] + dy * t - py);
}

function inPoly(x: number, y: number, poly: readonly [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function createTreeLayer(map: maplibregl.Map, opts: TreeLayerOptions): maplibregl.CustomLayerInterface {
  let host: ThreeHost | null = null;
  let scene: Scene | null = null;
  const slots: Slot[] = []; // kind * TREE_LODS + lod
  const mats: ShaderMaterial[] = [];
  const stops: (() => void)[] = [];
  const chunks = new Map<string, Chunk>();
  let origin: { lng: number; lat: number } | null = null;
  let shown: string | null = null; // signature of what the buffers hold
  let lastAssemble = 0;
  const camera = new Camera();
  const framer = frameSetter(opts.light);

  const reset = () => {
    chunks.clear();
    shown = null;
  };

  // Scatters and projects one chunk; null while its tiles load.
  const build = (i: number, j: number, tf: TownFrame, o: { lng: number; lat: number }): Chunk | null => {
    const trees = opts.source.chunk(i, j);
    if (!trees) return null;
    const k = reliefScale.peek();
    if (k > 0 && trees.length) {
      const cover: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => tf.toLngLat((i + a) * CHUNK, (j + b) * CHUNK));
      if (cover.some(([a, b]) => groundAt(a, b) === null)) {
        void loadGround(cover).then(() => map.triggerRepaint());
        return null;
      }
    }
    const kinds = TREE_KINDS.map((_, kind) => {
      const base: number[] = [], par: number[] = [];
      for (let t = 0; t < trees.length; t += TREE_STRIDE) {
        if (trees[t + 3] !== kind) continue;
        const x = trees[t], y = trees[t + 1];
        const [a, b] = tf.toLngLat(x, y);
        base.push(x, y, k > 0 ? (groundAt(a, b) ?? 0) * k - SINK : -SINK);
        par.push(trees[t + 2], trees[t + 4], trees[t + 5], 0.85 + 0.3 * ((trees[t + 5] * 13.7) % 1));
      }
      const { g, m } = projectPoints(base, tf.toLngLat, o);
      const n = base.length / 3, out = new Float32Array(n * PER);
      for (let q = 0; q < n; q++) {
        out.set(g.subarray(q * 3, q * 3 + 3), q * PER);
        out.set(m.subarray(q * 3, q * 3 + 3), q * PER + 3);
        for (let r = 0; r < 4; r++) out[q * PER + 6 + r] = par[q * 4 + r];
      }
      return out;
    });
    return { i, j, kinds };
  };

  // The ground under the screen as a polygon in town metres (its border unprojected, cut at VIEW_MAX), and the
  // camera's ground point and height.
  const view = (tf: TownFrame) => {
    const c = map.getCanvas(), w = c.clientWidth, h = c.clientHeight;
    // the camera from the view: MapLibre puts it cameraToCenterDistance (0.5 h / tan(fov / 2) pixels) from the centre
    const centre = map.getCenter();
    const [mx, my] = tf.toLocal(centre.lng, centre.lat);
    const fov = ((map as unknown as { transform?: { fov?: number } }).transform?.fov ?? 36.87) * (Math.PI / 180);
    const mpp = (40075016.686 * Math.cos((centre.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
    const dist = ((0.5 * h) / Math.tan(fov / 2)) * mpp;
    const pitch = (map.getPitch() * Math.PI) / 180, bearing = (map.getBearing() * Math.PI) / 180;
    const back = dist * Math.sin(pitch);
    const cam: [number, number] = [mx - Math.sin(bearing) * back, my - Math.cos(bearing) * back];
    const alt = dist * Math.cos(pitch);
    const border: [number, number][] = [];
    const edge: [number, number][] = [[0, 0], [w / 2, 0], [w, 0], [w, h / 2], [w, h], [w / 2, h], [0, h], [0, h / 2]];
    for (const [sx, sy] of edge) {
      const ll = map.unproject([sx, sy]);
      let [x, y] = tf.toLocal(ll.lng, ll.lat);
      const d = Math.hypot(x - cam[0], y - cam[1]);
      if (!Number.isFinite(d)) continue;
      if (d > VIEW_MAX) (x = cam[0] + ((x - cam[0]) * VIEW_MAX) / d), (y = cam[1] + ((y - cam[1]) * VIEW_MAX) / d);
      border.push([x, y]);
    }
    return { border, cam, alt };
  };

  // Refills the instance buffers from the chosen chunks (a buffer is replaced only when it has to grow).
  const assemble = (chosen: { c: Chunk; lod: number }[]) => {
    const counts = slots.map(() => 0);
    for (const { c, lod } of chosen) c.kinds.forEach((a, kind) => (counts[kind * TREE_LODS + lod] += a.length / PER));
    slots.forEach((s, k) => {
      const geo = s.mesh.geometry as InstancedBufferGeometry;
      if (!s.buf || s.buf.count < counts[k]) {
        s.buf = new InstancedInterleavedBuffer(new Float32Array(Math.max(256, Math.ceil(counts[k] * 1.5)) * PER), PER).setUsage(DynamicDrawUsage);
        geo.setAttribute("iG", new InterleavedBufferAttribute(s.buf, 3, 0));
        geo.setAttribute("iM", new InterleavedBufferAttribute(s.buf, 3, 3));
        geo.setAttribute("iP", new InterleavedBufferAttribute(s.buf, 4, 6));
      }
      s.count = 0;
    });
    for (const { c, lod } of chosen)
      c.kinds.forEach((a, kind) => {
        const s = slots[kind * TREE_LODS + lod];
        (s.buf!.array as Float32Array).set(a, s.count * PER);
        s.count += a.length / PER;
      });
    for (const s of slots) {
      const geo = s.mesh.geometry as InstancedBufferGeometry;
      geo.instanceCount = s.count;
      s.mesh.visible = s.count > 0;
      if (s.buf && s.count) {
        s.buf.clearUpdateRanges();
        s.buf.addUpdateRange(0, s.count * PER);
        s.buf.needsUpdate = true;
      }
    }
  };

  return {
    id: TREE_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(_m, gl) {
      host = acquireHost(map, gl as WebGL2RenderingContext);
      scene = new Scene();
      TREE_KINDS.forEach((kind) => {
        for (let lod = 0; lod < TREE_LODS; lod++) {
          const t = buildTree(kind, lod);
          const geo = new InstancedBufferGeometry();
          geo.setAttribute("position", new BufferAttribute(Float32Array.from(t.positions), 3));
          geo.setAttribute("normal", new BufferAttribute(Float32Array.from(t.normals), 3));
          geo.setAttribute("aColor", new BufferAttribute(Float32Array.from(t.colors), 3));
          geo.setAttribute("aCrown", new BufferAttribute(Float32Array.from(t.crown), 1));
          geo.setIndex(new BufferAttribute(Uint32Array.from(t.indices), 1));
          geo.instanceCount = 0;
          const mat = new ShaderMaterial({
            uniforms: {
              uG: { value: new Matrix4() },
              uM: { value: new Matrix4() },
              uT: { value: 0 },
              uLight: { value: framer.light },
              uSun: { value: 0 },
              uTint: { value: new Vector4() },
              uTime: { value: 0 },
              uGrow: { value: 1 },
              uWind: { value: new Vector3() },
              uSeasonal: { value: kind === "conifer" ? 0 : 1 },
              uBare: { value: 0 },
              uSnow: { value: 0 },
              uCrownA: { value: new Vector3(...rgb(TREE_COLORS.summer)) },
              uCrownB: { value: new Vector3(...rgb(TREE_COLORS.summer)) },
              uBareCol: { value: new Vector3(...rgb(TREE_COLORS.bare)) },
              uSnowCol: { value: new Vector3(...rgb(TREE_COLORS.snow)) },
              uLeafBase: { value: new Vector3(...rgb(TREE_COLORS.summer)) },
            },
            vertexShader: VERT,
            fragmentShader: FRAG,
            side: DoubleSide,
            blending: NoBlending,
            depthTest: true,
            depthWrite: true,
            depthFunc: LessEqualDepth,
          });
          const mesh = Object.assign(new Mesh(geo, mat), { frustumCulled: false, visible: false });
          slots.push({ mesh, buf: null, count: 0 });
          mats.push(mat);
          scene!.add(mesh);
        }
      });
      opts.source.onTile = () => map.triggerRepaint();
      stops.push(
        effect(() => {
          void opts.frame.value;
          void reliefScale.value;
          reset();
          map.triggerRepaint();
        }),
        effect(() => {
          const ch = opts.source.changed.value;
          if (!ch.n) return;
          if (!ch.box) reset();
          else for (const [key, c] of chunks) if (overlaps(c, ch.box)) chunks.delete(key);
          shown = null;
          map.triggerRepaint();
        }),
      );
    },
    onRemove() {
      for (const s of stops) s();
      stops.length = 0;
      opts.source.onTile = null;
      for (const s of slots) s.mesh.geometry.dispose();
      for (const m of mats) m.dispose();
      slots.length = mats.length = 0;
      host?.release();
      host = null;
      scene = null;
      reset();
    },
    render(_gl, args) {
      const tf = opts.frame.peek();
      const zoom = map.getZoom();
      if (!host || !scene || !tf || zoom < TREES_FROM_ZOOM) return;
      const [lng, lat] = tf.toLngLat(0, 0);
      if (!origin || origin.lng !== lng || origin.lat !== lat) {
        origin = { lng, lat };
        reset();
      }
      // the chunks under the screen, nearest the camera first
      const { border, cam, alt } = view(tf);
      if (border.length < 3) return;
      const xs = border.map((p) => p[0]), ys = border.map((p) => p[1]);
      const half = CHUNK * Math.SQRT1_2;
      const seen: { i: number; j: number; d: number }[] = [];
      for (let i = Math.floor((Math.min(...xs) - half) / CHUNK); i <= Math.floor((Math.max(...xs) + half) / CHUNK); i++)
        for (let j = Math.floor((Math.min(...ys) - half) / CHUNK); j <= Math.floor((Math.max(...ys) + half) / CHUNK); j++) {
          const cx = (i + 0.5) * CHUNK, cy = (j + 0.5) * CHUNK;
          if (!inPoly(cx, cy, border) && !border.some((p, k) => pointSegDist(cx, cy, p, border[(k + 1) % border.length]) < half)) continue;
          seen.push({ i, j, d: Math.hypot(cx - cam[0], cy - cam[1], alt) });
        }
      seen.sort((a, b) => a.d - b.d);
      // build what is missing, nearest first, within the frame's budget
      const t0 = performance.now();
      let missing = false;
      for (const s of seen) {
        const key = chunkKey(s.i, s.j);
        if (chunks.has(key)) continue;
        if (performance.now() - t0 > FRAME_BUDGET) {
          missing = true;
          break;
        }
        const c = build(s.i, s.j, tf, origin);
        if (c) chunks.set(key, c);
        else missing = true;
      }
      // what to draw: up to MAX_TREES, each chunk at its level of detail
      const flat = map.getPitch() < FLAT_PITCH;
      const chosen: { c: Chunk; lod: number }[] = [];
      let total = 0;
      for (const s of seen) {
        const c = chunks.get(chunkKey(s.i, s.j));
        if (!c) continue;
        const n = c.kinds.reduce((a, k) => a + k.length / PER, 0);
        if (total + n > MAX_TREES) break;
        total += n;
        chosen.push({ c, lod: flat ? 2 : s.d < NEAR ? 0 : 1 });
      }
      const sig = chosen.map((q) => `${q.c.i},${q.c.j}:${q.lod}`).join(";");
      const now = performance.now();
      if (sig !== shown) {
        if (shown === null || now - lastAssemble > ASSEMBLE_EVERY) {
          assemble(chosen);
          shown = sig;
          lastAssemble = now;
        } else missing = true;
      }
      if (missing) map.triggerRepaint();
      if (!slots.some((s) => s.count > 0)) return;
      // uniforms of this frame
      const clock = opts.light?.clock.peek() ?? 0;
      const crown = crownAt(clock);
      const w = opts.weather.peek();
      const wind = Math.min(1, (w?.now.wind ?? 2) / WIND_FULL);
      const snow = Math.min(1, (w?.snowpack ?? 0) / 0.05);
      const grow = Math.min(1, (zoom - TREES_FROM_ZOOM) / (GROW_TO - TREES_FROM_ZOOM));
      const a = rgb(crown.a), b = rgb(crown.b);
      for (const mat of mats) {
        const u = mat.uniforms;
        framer.set(u, args, host, origin);
        u.uTime.value = performance.now() / 1000;
        u.uGrow.value = grow * grow * (3 - 2 * grow);
        (u.uWind.value as Vector3).set(WIND_DIR[0], WIND_DIR[1], flat ? 0 : wind);
        const seasonal = u.uSeasonal.value > 0.5;
        u.uBare.value = seasonal ? crown.bare : 0;
        (u.uCrownA.value as Vector3).set(a[0] + (b[0] - a[0]) * crown.t, a[1] + (b[1] - a[1]) * crown.t, a[2] + (b[2] - a[2]) * crown.t);
        (u.uCrownB.value as Vector3).set(...b);
        u.uSnow.value = seasonal ? snow * crown.bare * 0.6 : snow;
      }
      host.draw((r) => r.render(scene!, camera));
      if (wind > 0.02 && !flat) map.triggerRepaint(); // the sway moves every frame
    },
  };
}

// Adds the layer just after the building models (or where they would go).
export function attachTreeLayer(map: maplibregl.Map, opts: TreeLayerOptions): () => void {
  const layer = createTreeLayer(map, opts);
  const before = () => ["buildings-outline", "night-tint"].find((id) => map.getLayer(id));
  let disposed = false;
  const add = () => {
    const b = before();
    if (disposed || map.getLayer(TREE_LAYER_ID) || !b) return;
    map.addLayer(layer, b);
    map.off("styledata", add);
  };
  if (before()) add();
  else map.on("styledata", add);
  return () => {
    disposed = true;
    map.off("styledata", add);
    if (map.getLayer(TREE_LAYER_ID)) map.removeLayer(TREE_LAYER_ID);
  };
}
