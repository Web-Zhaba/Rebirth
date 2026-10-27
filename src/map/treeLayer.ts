import type maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import { BufferAttribute, Camera, DoubleSide, InstancedBufferAttribute, InstancedBufferGeometry, LessEqualDepth, Matrix4, Mesh, NoBlending, Scene, ShaderMaterial, Vector3, Vector4 } from "three";
import { calendar, DAYS_PER_SEASON } from "../sim/clock";
import type { WeatherState } from "../sim/weather";
import { TREE_COLORS } from "../ui/palette";
import type { Frame as TownFrame } from "../world/frame";
import { projectPoints } from "./modelBuffers";
import { rgb } from "./modelGeometry";
import { frameSetter, type ModelLayerOptions } from "./modelLayer";
import { groundAt, loadGround, reliefScale } from "./relief";
import { buildTree } from "./treeModels";
import { TREE_KINDS, TREE_STRIDE } from "./treeScatter";
import { acquireHost, type ThreeHost } from "./three/host";

// The 3D forest around the town (PLAN-3d-world.ru.md stage 4): the trees of forest.ts drawn by three.js inside the map,
// one instanced mesh per kind of tree, on the same projection and light as the building models (modelLayer.ts
// frameSetter; each instance's base is projected in float64 on the CPU into both frames, its tree added in metres).
// Import only with a dynamic `import()` (it pulls in three.js).
//
// Close up only: below GROW_FROM the forest is the 2D fill alone, and up to GROW_TO the trees grow in. Deciduous
// crowns follow the season (bare in winter), snow lies on the crowns while there is a snowpack, and the trees sway in
// the wind of the weather (westerly, the zonal wind of sim/weather.ts).

export const TREE_LAYER_ID = "forest-trees";
const GROW_FROM = 13.6;
const GROW_TO = 14.6;
const SINK = 0.3; // m: trunks start below the ground, which our samples follow only closely on slopes
const WIND_DIR: [number, number] = [0.98, 0.2]; // toward the east
const WIND_FULL = 14; // m/s: full sway

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
    if (uSeasonal > 0.5) col = mix(mix(uCrownA, uCrownB, fract(vHash * 7.31)), uBareCol, uBare);
    col *= vShade * mix(0.7, 1.05, smoothstep(0.1, 1.0, vH)); // darker deep in the crown
    // snow lies in patches on the branches that face up
    float spot = smoothstep(0.35, 0.65, cell(vP * 1.6 + 3.1));
    col = mix(col, uSnowCol, uSnow * smoothstep(0.12, 0.45, n.z) * mix(0.35, 0.95, spot));
  }
  float d = max(dot(n, uLight), 0.0);
  float k = mix(0.55, 1.0, d) * mix(0.88, 1.0, uSun);
  gl_FragColor = vec4(mix(col * k, uTint.rgb, uTint.a), 1.0);
}`;

// Deciduous crowns at a point of the year: two colours (mixed per tree) and how bare they are.
export function crownAt(gameMinutes: number): { a: string; b: string; t: number; bare: number } {
  const cal = calendar(gameMinutes);
  const f = cal.season + (cal.dayOfSeason - 1 + cal.hour / 24) / DAYS_PER_SEASON; // 0 spring .. 4
  const C = TREE_COLORS;
  const ramp = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));
  if (f < 1.2) return { a: C.spring, b: C.summer, t: ramp(f, 0.5, 1.2), bare: 1 - ramp(f, 0, 0.5) };
  if (f < 2) return { a: C.summer, b: C.summer, t: 0, bare: 0 };
  if (f < 2.3) return { a: C.summer, b: C.autumn, t: ramp(f, 2, 2.3), bare: 0 };
  return { a: C.autumn, b: C.autumnLate, t: 1, bare: ramp(f, 2.75, 3.1) };
}

export interface TreeLayerOptions {
  trees: ReadonlySignal<Float32Array | null>;
  frame: ReadonlySignal<TownFrame | null>;
  light?: ModelLayerOptions["light"];
  weather: ReadonlySignal<WeatherState | null>;
  radius: number; // m around the founding point that has trees (forest.ts)
}

export function createTreeLayer(map: maplibregl.Map, opts: TreeLayerOptions): maplibregl.CustomLayerInterface {
  let host: ThreeHost | null = null;
  let scene: Scene | null = null;
  const meshes: Mesh[] = [];
  const mats: ShaderMaterial[] = [];
  let stop: (() => void) | null = null;
  let dirty = true;
  let origin: { lng: number; lat: number } | null = null;
  const camera = new Camera();
  const framer = frameSetter(opts.light);
  const models = TREE_KINDS.map(buildTree);

  // Instances of each kind: base projected into both frames, on the ground of the relief.
  const rebuild = () => {
    const tf = opts.frame.peek(), trees = opts.trees.peek();
    if (!tf || !trees || !meshes.length) return;
    const [lng, lat] = tf.toLngLat(0, 0);
    origin = { lng, lat };
    const k = reliefScale.peek();
    if (k > 0) {
      const pad = opts.radius + 60, cover: [number, number][] = [];
      for (let x = -pad; x <= pad; x += 500) for (let y = -pad; y <= pad; y += 500) cover.push(tf.toLngLat(x, y));
      if (cover.some(([a, b]) => groundAt(a, b) === null)) {
        void loadGround(cover).then(() => {
          dirty = true;
          map.triggerRepaint();
        });
        dirty = false;
        return;
      }
    }
    TREE_KINDS.forEach((_, kind) => {
      const base: number[] = [], par: number[] = [];
      for (let i = 0; i < trees.length; i += TREE_STRIDE) {
        if (trees[i + 3] !== kind) continue;
        const x = trees[i], y = trees[i + 1];
        const [a, b] = tf.toLngLat(x, y);
        base.push(x, y, k > 0 ? (groundAt(a, b) ?? 0) * k - SINK : -SINK);
        par.push(trees[i + 2], trees[i + 4], trees[i + 5], 0.85 + 0.3 * ((trees[i + 5] * 13.7) % 1));
      }
      const { g, m } = projectPoints(base, tf.toLngLat, origin!);
      const geo = meshes[kind].geometry as InstancedBufferGeometry;
      geo.setAttribute("iG", new InstancedBufferAttribute(g, 3));
      geo.setAttribute("iM", new InstancedBufferAttribute(m, 3));
      geo.setAttribute("iP", new InstancedBufferAttribute(Float32Array.from(par), 4));
      geo.instanceCount = base.length / 3;
      meshes[kind].visible = base.length > 0;
    });
    dirty = false;
  };

  return {
    id: TREE_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(_m, gl) {
      host = acquireHost(map, gl as WebGL2RenderingContext);
      scene = new Scene();
      TREE_KINDS.forEach((kind, i) => {
        const t = models[i];
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
        meshes.push(mesh);
        mats.push(mat);
        scene!.add(mesh);
      });
      dirty = true;
      stop = effect(() => {
        void opts.trees.value;
        void opts.frame.value;
        void reliefScale.value;
        dirty = true;
        map.triggerRepaint();
      });
    },
    onRemove() {
      stop?.();
      stop = null;
      for (const m of meshes) m.geometry.dispose();
      for (const m of mats) m.dispose();
      meshes.length = mats.length = 0;
      host?.release();
      host = null;
      scene = null;
    },
    render(_gl, args) {
      if (!host || !scene) return;
      const zoom = map.getZoom();
      if (zoom < GROW_FROM) return;
      if (dirty) rebuild();
      if (!origin || !meshes.some((m) => m.visible)) return;
      const clock = opts.light?.clock.peek() ?? 0;
      const crown = crownAt(clock);
      const w = opts.weather.peek();
      const wind = Math.min(1, (w?.now.wind ?? 2) / WIND_FULL);
      const snow = Math.min(1, (w?.snowpack ?? 0) / 0.05);
      const grow = Math.min(1, (zoom - GROW_FROM) / (GROW_TO - GROW_FROM));
      const a = rgb(crown.a), b = rgb(crown.b);
      for (const mat of mats) {
        const u = mat.uniforms;
        framer.set(u, args, host, origin);
        u.uTime.value = performance.now() / 1000;
        u.uGrow.value = grow * grow * (3 - 2 * grow);
        (u.uWind.value as Vector3).set(WIND_DIR[0], WIND_DIR[1], wind);
        const seasonal = u.uSeasonal.value > 0.5;
        u.uBare.value = seasonal ? crown.bare : 0;
        (u.uCrownA.value as Vector3).set(a[0] + (b[0] - a[0]) * crown.t, a[1] + (b[1] - a[1]) * crown.t, a[2] + (b[2] - a[2]) * crown.t);
        (u.uCrownB.value as Vector3).set(...b);
        u.uSnow.value = seasonal ? snow * crown.bare * 0.6 : snow;
      }
      host.draw((r) => r.render(scene!, camera));
      if (wind > 0.02) map.triggerRepaint(); // the sway moves every frame
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
