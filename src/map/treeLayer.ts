import type maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import {
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
import { mercatorLocal, projectPoints } from "./modelBuffers";
import { rgb } from "./modelGeometry";
import { frameSetter, type ModelLayerOptions } from "./modelLayer";
import { groundAt, loadGround, reliefScale } from "./relief";
import { WIND_DIR } from "./weatherMath";
import { forest3dOn, motionOn, motionTime, showWhile } from "./graphicsSettings";
import { bakeImpostor, IMPOSTOR_STEP, IMPOSTOR_VIEWS, impostorQuad, treeGeometry, type Impostor } from "./treeImpostor";
import { buildTree, crownAt, KIND_INFO, leafOf, reedAt, TREE_LODS } from "./treeModels";
import { CHUNK, keepAt, MIN_KEEP, thinReach, TREE_KINDS, TREE_STRIDE, TREES_FROM_ZOOM } from "./treeScatter";
import { chunksInView } from "./chunkView";
import { eyeOf, frustumPlanes } from "./three/frame";
import { acquireHost, type ThreeHost } from "./three/host";

// The 3D forest (PLAN-3d-world.ru.md stage 4): the trees of forest.ts drawn by three.js inside the map, on the same
// projection and light as the building models (modelLayer.ts frameSetter; each instance's base is projected in float64
// on the CPU into both frames, its tree added in metres). Import only with a dynamic `import()` (it pulls in three.js).
//
// Only what the camera sees: the plane is cut into square chunks (forest.ts CHUNK); each frame picks the chunks inside
// the camera's frustum (tested against its matrix, which holds on the relief too, where the sky has no ground point),
// as far as a typical tree stays MIN_PX tall on the screen. Past MAX_TREES the far ones are thinned with distance and
// their trees drawn a little bigger, and the last stretch before the far edge fades the trees out.
// A chunk's trees are scattered and projected once and cached; new chunks are built within FRAME_BUDGET ms per frame,
// so moving the camera never stalls on them. Levels of detail per chunk by its distance from the camera: full trees
// near, impostors of them farther (treeImpostor.ts: quads facing the camera with the baked tree on them), and flat
// crowns for a view from straight above. One instanced mesh per kind and level, its
// instances in one interleaved buffer refilled (not reallocated) as the view changes.
//
// Close up only: below TREES_FROM_ZOOM the forest is the 2D fill alone, and up to GROW_TO the trees grow in. Deciduous
// crowns follow the season (bare in winter), snow lies on the crowns while there is a snowpack, and the trees sway in
// the wind of the weather (westerly, the zonal wind of sim/weather.ts).
//
// The small details of stage 6 (bushes, reeds, boulders: treeScatter.ts DETAIL_KINDS) ride in the same chunks and
// meshes, each kind drawn as far as its own typical height stays MIN_PX tall (treeModels.ts KIND_INFO), at most
// DETAIL_CAP: full near, impostors beyond DETAIL_NEAR. They are few against the trees and never thinned.

export const TREE_LAYER_ID = "forest-trees";
const GROW_TO = TREES_FROM_ZOOM + 1;
const MAX_TREES = 80_000; // drawn at once; past it the far chunks are thinned
const MAX_CHUNKS = 3000; // cached; beyond it chunks unseen for a while are dropped
const TALL = 12; // m, a typical tree: sets how far trees are drawn
const MIN_PX = 1.5; // farther than a typical tree is this tall on the screen, there are no trees
const FAR_CAP = 12_000; // m from the camera at most
const FADE_FROM = 0.85; // share of the far edge where the trees start to shrink away
const REACH_STEP = 1.15; // the thinning reach moves in these steps, so the drawn set does not shimmer
const SLOPE = 120; // m: how much the relief may rise or fall within a chunk or under an unknown chunk (exaggerated)
const NEAR = 450; // m from the camera: full trees within
const FLAT_PITCH = 18; // degrees: flatter views get flat crowns
const FRAME_BUDGET = 4; // ms of chunk building per frame
const ASSEMBLE_EVERY = 100; // ms: the instance buffers are refilled at most this often while the view changes
const SINK = 0.3; // m: trunks start below the ground, which our samples follow only closely on slopes
const WIND_FULL = 14; // m/s: full sway
const DETAIL_CAP = 2000; // m from the camera at most for the details
const DETAIL_NEAR = 60; // m: full details within
const PER = 10; // floats per instance: globe base (3), mercator base (3), size, turn, hash, shade

// Level 1 is built with IMPOSTOR defined: a quad (treeImpostor.ts) instead of the tree's mesh.
const VERT = /* glsl */ `
#ifndef IMPOSTOR
attribute vec3 aColor;
attribute float aCrown;
varying vec3 vC;
varying float vCrown;
varying float vH;
varying vec3 vP;
#else
uniform float uRadius; // half the side of a baked view, in tree heights
varying vec2 vUV;
varying vec3 vR;
varying vec3 vU;
varying float vFlip;
#endif
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
uniform vec3 uEye; // camera in the mercator frame
uniform float uReach; // the far thinning (treeScatter.ts keepAt)
uniform float uFar;
varying vec3 vN;
varying float vHash;
varying float vShade;
void main() {
  // thinned far trees are drawn bigger, so the forest keeps its cover; past FADE_FROM they shrink away
  float dist = length(iM - uEye);
  float keep = clamp(uReach / dist, ${MIN_KEEP}, 1.0);
  float s = iP.x * uGrow * min(2.0, pow(keep, -0.3)) * (1.0 - smoothstep(uFar * ${FADE_FROM}, uFar, dist));
  // sway: grows with the square of the height, gusts out of phase from tree to tree
  float gust = 0.35 + 0.65 * sin(uTime * (1.1 + 0.5 * iP.z) + iP.z * 40.0);
#ifdef IMPOSTOR
  // a quad facing the camera about the tree's middle, showing the baked view nearest the camera's elevation (with an
  // offset per tree, so the forest passes from one view to the next gradually), mirrored for half the trees
  vec3 F = normalize(uEye - iM - vec3(0.0, 0.0, 0.5 * s));
  vec3 R = cross(vec3(0.0, 0.0, 1.0), F);
  R = length(R) > 1e-4 ? normalize(R) : vec3(1.0, 0.0, 0.0);
  vec3 U = cross(F, R);
  float view = clamp(floor(degrees(asin(clamp(F.z, 0.0, 1.0))) / ${IMPOSTOR_STEP}.0 + fract(iP.z * 5.37)), 0.0, ${IMPOSTOR_VIEWS - 1}.0);
  vFlip = fract(iP.z * 3.1) < 0.5 ? -1.0 : 1.0;
  vec2 q = position.xy;
  vUV = vec2((view + 0.5 + 0.5 * q.x * vFlip) / ${IMPOSTOR_VIEWS}.0, 0.5 + 0.5 * q.y);
  vec3 p = ((R * q.x + U * q.y) * uRadius + vec3(0.0, 0.0, 0.5)) * s;
  float h = clamp(0.5 + q.y * uRadius, 0.0, 1.0);
  p.xy += uWind.xy * uWind.z * gust * h * h * s * 0.03;
  vN = F;
  vR = R;
  vU = U;
#else
  vec3 p = position;
  if (aCrown > 0.5) p.xy *= 1.0 - 0.45 * uBare; // leafless: only the thinner frame of branches
  float c = cos(iP.y), sn = sin(iP.y);
  p = vec3(c * p.x - sn * p.y, sn * p.x + c * p.y, p.z) * s;
  p.xy += uWind.xy * uWind.z * gust * position.z * position.z * s * 0.03;
  vN = vec3(c * normal.x - sn * normal.y, sn * normal.x + c * normal.y, normal.z);
  vC = aColor;
  vCrown = aCrown;
  vH = position.z;
  vP = position * iP.x + iP.z * 17.0; // metres in the tree, shifted per tree: holes and snow patches differ
#endif
  vec4 m = uM * vec4(iM + p, 1.0);
  vec4 g = uG * vec4(iG + p, 1.0);
  gl_Position = uT > 0.999 ? g : (uT <= 0.0 ? m : mix(m, g, uT));
  vHash = iP.z;
  vShade = iP.w;
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
varying float vHash;
varying float vShade;
#ifndef IMPOSTOR
varying vec3 vC;
varying float vCrown;
varying float vH;
varying vec3 vP;
#else
uniform sampler2D uColor; // treeImpostor.ts
uniform sampler2D uData;
varying vec2 vUV;
varying vec3 vR;
varying vec3 vU;
varying float vFlip;
#endif
float cell(vec3 p) {
  return fract(sin(dot(floor(p), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}
// A point of a tree: col its colour as built, crown 1 on the foliage, h its height in the tree (0..1), spot how thick
// the snow lies there.
vec3 shade(vec3 col, vec3 n, float crown, float h, float spot) {
  if (crown > 0.5) {
    if (uSeasonal > 0.5) col = mix(mix(uCrownA, uCrownB, fract(vHash * 7.31)), uBareCol, uBare) * (dot(col, vec3(1.0)) / dot(uLeafBase, vec3(1.0)));
    col *= vShade * mix(0.7, 1.05, smoothstep(0.1, 1.0, h)); // darker deep in the crown
    // snow lies on the branches that face up
    col = mix(col, uSnowCol, uSnow * smoothstep(0.12, 0.45, n.z) * mix(0.35, 0.95, spot));
  }
  float d = max(dot(n, uLight), 0.0);
  float k = mix(0.55, 1.0, d) * mix(0.88, 1.0, uSun);
  return mix(col * k, uTint.rgb, uTint.a);
}
void main() {
#ifdef IMPOSTOR
  vec4 a = texture2D(uColor, vUV);
  vec4 t = texture2D(uData, vUV);
  float crown = step(0.5, t.a);
  // the coverage kept sharp at any size (alphaToCoverage turns it into MSAA samples); a leafless crown is see-through
  float cover = clamp((a.a - 0.5) / max(fwidth(a.a), 1e-4) + 0.5, 0.0, 1.0) * (1.0 - crown * uBare * 0.7);
  if (cover < 0.01) discard;
  vec2 nv = (t.xy * 2.0 - 1.0) * vec2(vFlip, 1.0);
  vec3 n = normalize(vR * nv.x + vU * nv.y + vN * sqrt(max(0.0, 1.0 - dot(nv, nv))));
  gl_FragColor = vec4(shade(a.rgb, n, crown, t.z, 0.5), cover);
#else
  // a leafless crown is a see-through tangle of twigs: most of it is cut away in small cells; snow lies in patches
  if (vCrown > 0.5 && uBare > 0.01 && cell(vP * 2.2) < uBare * 0.7) discard;
  gl_FragColor = vec4(shade(vC, normalize(vN), vCrown, vH, smoothstep(0.35, 0.65, cell(vP * 1.6 + 3.1))), 1.0);
#endif
}`;

export interface TreeLayerOptions {
  source: ForestSource;
  frame: ReadonlySignal<TownFrame | null>;
  light?: ModelLayerOptions["light"];
  weather: ReadonlySignal<WeatherState | null>;
}

// One chunk's instances by kind, PER floats each, in hash order (treeScatter.ts).
interface Chunk {
  i: number;
  j: number;
  kinds: Float32Array[];
  n: number; // trees in all (the details are not thinned and do not count)
  lod: number; // the level it was last drawn at (levels switch with some slack, so they do not flicker)
  seen: number; // frame it was last under the screen
  stale: boolean; // what it stands on changed: built again when in view, drawn as it was until then
}

// A growable interleaved instance buffer behind one mesh.
interface Slot {
  mesh: Mesh;
  buf: InstancedInterleavedBuffer | null;
  count: number;
}

const chunkKey = (i: number, j: number) => `${i},${j}`;
const isTree = TREE_KINDS.map((kind) => KIND_INFO[kind].tall > 5);
const overlaps = (c: Chunk, b: Box) => (c.i + 1) * CHUNK >= b[0] && c.i * CHUNK <= b[2] && (c.j + 1) * CHUNK >= b[1] && c.j * CHUNK <= b[3];

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
  let reach = Infinity; // the far thinning now (treeScatter.ts thinReach)
  let farNow = 0;
  let frameNo = 0;
  let rebuilt = 0; // chunks built again in place: part of what the buffers hold
  const camera = new Camera();
  const framer = frameSetter(opts.light);
  let impostors: Impostor[] | null = null; // by kind; baked in the first render (and again after a lost context)
  let unRestore: (() => void) | null = null;

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
      // by hash: any prefix is an even thinning of the chunk, and a thinner prefix keeps the trees of a thicker one
      const order: number[] = [];
      for (let t = 0; t < trees.length; t += TREE_STRIDE) if (trees[t + 3] === kind) order.push(t);
      order.sort((a, b) => trees[a + 5] - trees[b + 5]);
      for (const t of order) {
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
    return { i, j, kinds, n: kinds.reduce((a, q, kind) => a + (isTree[kind] ? q.length / PER : 0), 0), lod: -1, seen: 0, stale: false };
  };

  // Refills the instance buffers from the chosen chunks (a buffer is replaced only when it has to grow). lods: per kind,
  // the level the chunk draws it at, -1 not at all.
  const taken = (a: Float32Array, keep: number) => Math.round((a.length / PER) * keep);
  const assemble = (chosen: { c: Chunk; lods: number[]; keep: number }[]) => {
    const counts = slots.map(() => 0);
    for (const { c, lods, keep } of chosen) c.kinds.forEach((a, kind) => lods[kind] >= 0 && (counts[kind * TREE_LODS + lods[kind]] += taken(a, isTree[kind] ? keep : 1)));
    slots.forEach((s, k) => {
      if (!s.buf || s.buf.count < counts[k]) {
        // a new geometry, not new attributes on the old one: three keeps the instance limit of the first binding
        const old = s.mesh.geometry as InstancedBufferGeometry;
        const geo = new InstancedBufferGeometry();
        for (const [name, attr] of Object.entries(old.attributes)) if (!(attr instanceof InterleavedBufferAttribute)) geo.setAttribute(name, attr);
        geo.setIndex(old.getIndex());
        s.buf = new InstancedInterleavedBuffer(new Float32Array(Math.max(256, Math.ceil(counts[k] * 1.5)) * PER), PER).setUsage(DynamicDrawUsage);
        geo.setAttribute("iG", new InterleavedBufferAttribute(s.buf, 3, 0));
        geo.setAttribute("iM", new InterleavedBufferAttribute(s.buf, 3, 3));
        geo.setAttribute("iP", new InterleavedBufferAttribute(s.buf, 4, 6));
        s.mesh.geometry = geo;
        old.dispose();
      }
      s.count = 0;
    });
    for (const { c, lods, keep } of chosen)
      c.kinds.forEach((a, kind) => {
        if (lods[kind] < 0) return;
        const s = slots[kind * TREE_LODS + lods[kind]], n = taken(a, isTree[kind] ? keep : 1);
        (s.buf!.array as Float32Array).set(a.subarray(0, n * PER), s.count * PER);
        s.count += n;
      });
    for (const s of slots) {
      const geo = s.mesh.geometry as InstancedBufferGeometry;
      geo.instanceCount = s.count;
      s.mesh.visible = s.count > 0;
      if (s.buf && s.count) s.buf.needsUpdate = true;
    }
  };

  // devtools: what is drawn now
  if (import.meta.env.DEV) Object.assign(window, { treeStats: () => ({ drawn: slots.reduce((a, q) => a + q.count, 0), byLod: [0, 1, 2].map((l) => slots.filter((_, k) => k % TREE_LODS === l).reduce((a, q) => a + q.count, 0)), reach, far: farNow, chunks: chunks.size, rebuilt }) });

  return {
    id: TREE_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(_m, gl) {
      host = acquireHost(map, gl as WebGL2RenderingContext);
      scene = new Scene();
      TREE_KINDS.forEach((kind) => {
        for (let lod = 0; lod < TREE_LODS; lod++) {
          const imp = lod === 1;
          const geo = imp ? impostorQuad() : treeGeometry(buildTree(kind, lod as 0 | 2), new InstancedBufferGeometry());
          geo.instanceCount = 0;
          const mat = new ShaderMaterial({
            defines: imp ? { IMPOSTOR: "" } : {},
            uniforms: {
              ...(imp && { uColor: { value: null }, uData: { value: null }, uRadius: { value: 0 } }),
              uG: { value: new Matrix4() },
              uM: { value: new Matrix4() },
              uT: { value: 0 },
              uLight: { value: framer.light },
              uSun: { value: 0 },
              uTint: { value: new Vector4() },
              uTime: { value: 0 },
              uGrow: { value: 1 },
              uWind: { value: new Vector3() },
              uEye: { value: new Vector3() },
              uReach: { value: 1e9 },
              uFar: { value: 1e9 },
              uSeasonal: { value: KIND_INFO[kind].season ? 1 : 0 },
              uBare: { value: 0 },
              uSnow: { value: 0 },
              uCrownA: { value: new Vector3(...rgb(TREE_COLORS.summer)) },
              uCrownB: { value: new Vector3(...rgb(TREE_COLORS.summer)) },
              uBareCol: { value: new Vector3(...rgb(TREE_COLORS.bare)) },
              uSnowCol: { value: new Vector3(...rgb(TREE_COLORS.snow)) },
              uLeafBase: { value: new Vector3(...rgb(leafOf(kind))) },
            },
            vertexShader: VERT,
            fragmentShader: FRAG,
            side: DoubleSide,
            blending: NoBlending,
            alphaToCoverage: imp,
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
      unRestore = host.onRestore(() => {
        impostors = null; // their textures went with the context
        map.triggerRepaint();
      });
      stops.push(
        effect(() => {
          void opts.frame.value;
          reset();
          map.triggerRepaint();
        }),
        // new ground or new obstacles: the old trees stay until their chunk is built again, so nothing blinks
        effect(() => {
          void reliefScale.value;
          for (const c of chunks.values()) c.stale = true;
          map.triggerRepaint();
        }),
        effect(() => {
          const ch = opts.source.changed.value;
          if (!ch.n) return;
          for (const c of chunks.values()) if (!ch.box || overlaps(c, ch.box)) c.stale = true;
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
      impostors?.forEach((q) => q.dispose());
      impostors = null;
      unRestore?.();
      unRestore = null;
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
      // the chunks in the frustum, nearest the camera first; all in the mercator frame of the models (metres)
      const M = framer.mercator(args, host, origin);
      const eye = eyeOf(M);
      if (!eye) return;
      const planes = frustumPlanes(M);
      const merc = mercatorLocal(origin);
      const [elng, elat] = merc.from(eye[0], eye[1]);
      const [ex, ey] = tf.toLocal(elng, elat);
      const fov = ((map as unknown as { transform?: { fov?: number } }).transform?.fov ?? 36.87) * (Math.PI / 180);
      const farOf = (tall: number) => (tall * 0.5 * map.getCanvas().clientHeight) / Math.tan(fov / 2) / MIN_PX;
      const far = Math.min(FAR_CAP, farOf(TALL));
      const farK = TREE_KINDS.map((kind, k) => (isTree[k] ? far : Math.min(DETAIL_CAP, farOf(KIND_INFO[kind].tall))));
      farNow = far;
      const k = reliefScale.peek();
      const under = k > 0 ? (groundAt(elng, elat) ?? 0) * k : 0;
      const centre = (x: number, y: number): [number, number, number] => {
        const [lng, lat] = tf.toLngLat(x, y);
        const g = k > 0 ? groundAt(lng, lat) : 0;
        return [...merc.to(lng, lat), g === null ? under : g * k];
      };
      const seen = chunksInView({ planes, eye, at: [ex, ey], far, size: CHUNK, rise: TALL, slope: SLOPE, centre });
      // build what is missing, nearest first, within the frame's budget
      const t0 = performance.now();
      let missing = false;
      for (const s of seen) {
        const key = chunkKey(s.i, s.j), was = chunks.get(key);
        if (was && !was.stale) continue;
        if (performance.now() - t0 > FRAME_BUDGET) {
          missing = true;
          break;
        }
        const c = build(s.i, s.j, tf, origin);
        if (!c) missing = true;
        else {
          if (was) (c.lod = was.lod, rebuilt++);
          chunks.set(key, c);
        }
      }
      // what to draw: every chunk in view at its level of detail; past MAX_TREES the far ones keep a share falling with
      // distance (treeScatter.ts thinReach), the reach moving in steps and with slack so the set does not shimmer
      frameNo++;
      const flat = map.getPitch() < FLAT_PITCH;
      const ready: { c: Chunk; lod: number; d: number; n: number }[] = [];
      for (const s of seen) {
        const c = chunks.get(chunkKey(s.i, s.j));
        if (!c) continue;
        c.seen = frameNo;
        const lod = flat ? 2 : c.lod === 0 ? (s.d < NEAR * 1.2 ? 0 : 1) : s.d < NEAR ? 0 : 1;
        c.lod = lod;
        ready.push({ c, lod, d: s.d, n: c.n });
      }
      const want = thinReach(ready, MAX_TREES, NEAR);
      const step = (r: number) => REACH_STEP ** Math.floor(Math.log(r) / Math.log(REACH_STEP));
      if (want < reach) reach = step(want);
      else if (want >= reach * REACH_STEP * REACH_STEP) reach = want === Infinity ? Infinity : step(want) / REACH_STEP;
      const detailLod = (d: number) => (flat ? 2 : d < DETAIL_NEAR ? 0 : 1);
      const chosen = ready.map((r) => ({
        c: r.c,
        lods: TREE_KINDS.map((_, k) => (isTree[k] ? r.lod : r.d < farK[k] ? detailLod(r.d) : -1)),
        keep: r.d < NEAR ? 1 : Math.floor(keepAt(r.d, reach) * 16) / 16,
      }));
      // forget chunks long out of sight
      if (chunks.size > MAX_CHUNKS) for (const [key, c] of chunks) if (frameNo - c.seen > 600) chunks.delete(key);
      const sig = `${rebuilt}|` + chosen.map((q) => `${q.c.i},${q.c.j}:${q.lods.join(",")}:${q.keep}`).join(";");
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
      if (!impostors) {
        const baked = host.draw((r) => TREE_KINDS.map((kind) => bakeImpostor(r, buildTree(kind, 0))));
        if (!baked) return;
        impostors = baked;
        baked.forEach((q, kind) => {
          const u = mats[kind * TREE_LODS + 1].uniforms;
          u.uColor.value = q.color;
          u.uData.value = q.data;
          u.uRadius.value = q.radius;
        });
      }
      // uniforms of this frame
      const clock = opts.light?.clock.peek() ?? 0;
      const crown = crownAt(clock), reed = reedAt(clock);
      const w = opts.weather.peek();
      const wind = Math.min(1, (w?.now.wind ?? 2) / WIND_FULL);
      const snow = Math.min(1, (w?.snowpack ?? 0) / 0.05);
      const grow = Math.min(1, (zoom - TREES_FROM_ZOOM) / (GROW_TO - TREES_FROM_ZOOM));
      const leafCols = [rgb(crown.a), rgb(crown.b), crown.t] as const, reedCols = [rgb(reed.a), rgb(reed.b), reed.t] as const;
      mats.forEach((mat, m) => {
        const kind = Math.floor(m / TREE_LODS), info = KIND_INFO[TREE_KINDS[kind]];
        const u = mat.uniforms;
        framer.set(u, args, host!, origin!);
        u.uTime.value = motionTime();
        (u.uEye.value as Vector3).set(...eye);
        u.uReach.value = isTree[kind] ? Math.min(reach, 1e9) : 1e9;
        u.uFar.value = farK[kind];
        u.uGrow.value = grow * grow * (3 - 2 * grow);
        (u.uWind.value as Vector3).set(WIND_DIR[0], WIND_DIR[1], flat ? 0 : wind * info.sway);
        // seasonal crowns: leaves mix two colours and drop in the winter, letting the snow through to the twigs;
        // reeds turn to straw and keep standing, a little snow caught in them
        const [a, b, t] = info.season === "reed" ? reedCols : leafCols;
        u.uBare.value = info.season === "leaf" ? crown.bare : 0;
        (u.uCrownA.value as Vector3).set(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
        (u.uCrownB.value as Vector3).set(...b);
        u.uSnow.value = info.season === "leaf" ? snow * crown.bare * 0.6 : info.season === "reed" ? snow * 0.4 : snow;
      });
      host.draw((r) => {
        // the impostors write their coverage to the alpha (alphaToCoverage): keep it off the canvas, which stays opaque
        const color = r.state.buffers.color;
        r.getContext().colorMask(true, true, true, false);
        color.setLocked(true);
        r.render(scene!, camera);
        color.setLocked(false);
      });
      if (wind > 0.02 && !flat && motionOn.peek()) map.triggerRepaint(); // the sway moves every frame
    },
  };
}

// Adds the layer just after the building models (or where they would go).
export function attachTreeLayer(map: maplibregl.Map, opts: TreeLayerOptions): () => void {
  const layer = createTreeLayer(map, opts);
  const before = () => ["buildings-outline", "night-tint"].find((id) => map.getLayer(id));
  let disposed = false;
  let stopShow: (() => void) | null = null;
  const add = () => {
    const b = before();
    if (disposed || map.getLayer(TREE_LAYER_ID) || !b) return;
    map.addLayer(layer, b);
    map.off("styledata", add);
    stopShow = showWhile(map, TREE_LAYER_ID, forest3dOn);
  };
  if (before()) add();
  else map.on("styledata", add);
  return () => {
    disposed = true;
    stopShow?.();
    map.off("styledata", add);
    if (map.getLayer(TREE_LAYER_ID)) map.removeLayer(TREE_LAYER_ID);
  };
}
