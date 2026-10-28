import type * as maplibregl from "maplibre-gl";
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
import { terrainSurfaceAt, terrainSurfaceRevision } from "./terrainSurface";
import {
  clearTreeCollisionChunks,
  removeTreeCollisionChunk,
  setTreeCollisionChunk,
  type NatureObstacle,
} from "./natureCollision";
import { WIND_DIR } from "./weatherMath";
import {
  forest3dOn,
  motionTime,
  showWhile,
} from "./graphicsSettings";
import { bakeImpostor, IMPOSTOR_STEP, IMPOSTOR_VIEWS, impostorQuad, treeGeometry, type Impostor } from "./treeImpostor";
import { buildTree, crownAt, grassAt, KIND_INFO, leafOf, reedAt, TREE_LODS } from "./treeModels";
import { CHUNK, keepAt, MIN_KEEP, thinReach, TREE_KINDS, TREE_STRIDE, TREES_FROM_ZOOM } from "./treeScatter";
import { chunksInView } from "./chunkView";
import { eyeOf, frustumPlanes } from "./three/frame";
import { acquireHost, type ThreeHost } from "./three/host";

export const TREE_LAYER_ID = "forest-trees";
const GROW_TO = TREES_FROM_ZOOM + 1;
const MAX_TREES = 80_000;
const MAX_CHUNKS = 3000;
const TALL = 12;
const MIN_PX = 1.5;
const FAR_CAP = 12_000;
const FADE_FROM = 0.85;
const REACH_STEP = 1.15;
const SLOPE = 120;
const NEAR = 450;
const FLAT_PITCH = 18;
const FRAME_BUDGET = 4;
const ASSEMBLE_EVERY = 100;
const SINK = 0.3;
const WIND_FULL = 14;
const DETAIL_CAP = 2000;
const DETAIL_NEAR = 60;
const PER = 10;

const VERT = /* glsl */ `
#ifndef IMPOSTOR
attribute vec3 aColor;
attribute float aCrown;
varying vec3 vC;
varying float vCrown;
varying float vH;
varying vec3 vP;
#else
uniform float uRadius;
varying vec2 vUV;
varying vec3 vR;
varying vec3 vU;
varying float vFlip;
#endif
attribute vec3 iG;
attribute vec3 iM;
attribute vec4 iP;
uniform mat4 uG;
uniform mat4 uM;
uniform float uT;
uniform float uTime;
uniform float uGrow;
uniform float uBare;
uniform vec3 uWind;
uniform vec3 uEye;
uniform float uReach;
uniform float uFar;
varying vec3 vN;
varying float vHash;
varying float vShade;
void main() {
  float dist = length(iM - uEye);
  float keep = clamp(uReach / dist, ${MIN_KEEP}, 1.0);
  float s = iP.x * uGrow * min(2.0, pow(keep, -0.3)) * (1.0 - smoothstep(uFar * ${FADE_FROM}, uFar, dist));
  float gust = 0.35 + 0.65 * sin(uTime * (1.1 + 0.5 * iP.z) + iP.z * 40.0);
#ifdef IMPOSTOR
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
  if (aCrown > 0.5) p.xy *= 1.0 - 0.45 * uBare;
  float c = cos(iP.y), sn = sin(iP.y);
  p = vec3(c * p.x - sn * p.y, sn * p.x + c * p.y, p.z) * s;
  p.xy += uWind.xy * uWind.z * gust * position.z * position.z * s * 0.03;
  vN = vec3(c * normal.x - sn * normal.y, sn * normal.x + c * normal.y, normal.z);
  vC = aColor;
  vCrown = aCrown;
  vH = position.z;
  vP = position * iP.x + iP.z * 17.0;
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
uniform vec3 uLeafBase;
varying vec3 vN;
varying float vHash;
varying float vShade;
#ifndef IMPOSTOR
varying vec3 vC;
varying float vCrown;
varying float vH;
varying vec3 vP;
#else
uniform sampler2D uColor;
uniform sampler2D uData;
varying vec2 vUV;
varying vec3 vR;
varying vec3 vU;
varying float vFlip;
#endif
float cell(vec3 p) {
  return fract(sin(dot(floor(p), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
}
vec3 shade(vec3 col, vec3 n, float crown, float h, float spot) {
  if (crown > 0.5) {
    if (uSeasonal > 0.5) col = mix(mix(uCrownA, uCrownB, fract(vHash * 7.31)), uBareCol, uBare) * (dot(col, vec3(1.0)) / dot(uLeafBase, vec3(1.0)));
    col *= vShade * mix(0.7, 1.05, smoothstep(0.1, 1.0, h));
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
  float cover = clamp((a.a - 0.5) / max(fwidth(a.a), 1e-4) + 0.5, 0.0, 1.0) * (1.0 - crown * uBare * 0.7);
  if (cover < 0.01) discard;
  vec2 nv = (t.xy * 2.0 - 1.0) * vec2(vFlip, 1.0);
  vec3 n = normalize(vR * nv.x + vU * nv.y + vN * sqrt(max(0.0, 1.0 - dot(nv, nv))));
  gl_FragColor = vec4(shade(a.rgb, n, crown, t.z, 0.5), cover);
#else
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

interface Chunk {
  i: number;
  j: number;
  kinds: Float32Array[];
  n: number;
  lod: number;
  seen: number;
  stale: boolean;
  obstacles: NatureObstacle[];
}

interface Slot {
  mesh: Mesh;
  buf: InstancedInterleavedBuffer | null;
  count: number;
}

const chunkKey = (i: number, j: number) => `${i},${j}`;
const coordKey = (x: number, y: number) => ((Math.round(x) & 0xffff) << 16) | (Math.round(y) & 0xffff);
const isTree = TREE_KINDS.map((kind) => KIND_INFO[kind].tall > 5);
const overlaps = (c: Chunk, b: Box) => (c.i + 1) * CHUNK >= b[0] && c.i * CHUNK <= b[2] && (c.j + 1) * CHUNK >= b[1] && c.j * CHUNK <= b[3];

export function createTreeLayer(map: maplibregl.Map, opts: TreeLayerOptions): maplibregl.CustomLayerInterface {
  let host: ThreeHost | null = null;
  let scene: Scene | null = null;
  const slots: Slot[] = [];
  const mats: ShaderMaterial[] = [];
  const stops: (() => void)[] = [];
  const chunks = new Map<string, Chunk>();
  const centreCache = new Map<number, [number, number, number]>();
  let origin: { lng: number; lat: number } | null = null;
  let shown: string | null = null;
  let lastAssemble = 0;
  let reach = Infinity;
  let farNow = 0;
  let frameNo = 0;
  let rebuilt = 0;
  const camera = new Camera();
  const framer = frameSetter(opts.light);
  let impostors: Impostor[] | null = null;
  let unRestore: (() => void) | null = null;

  const reset = () => {
    chunks.clear();
    centreCache.clear();
    clearTreeCollisionChunks();
    shown = null;
  };

  const build = (i: number, j: number, tf: TownFrame, o: { lng: number; lat: number }): Chunk | null => {
    const trees = opts.source.chunk(i, j);
    if (!trees) return null;
    const k = reliefScale.peek();
    if (k > 0 && trees.length) {
      const cover: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([a, b]) => tf.toLngLat((i + a) * CHUNK, (j + b) * CHUNK));
      if (cover.some(([a, b]) => terrainSurfaceAt(a, b, tf) === null)) {
        void loadGround(cover).then(() => map.triggerRepaint());
        return null;
      }
    }
    const obstacles: NatureObstacle[] = [];

    if (k > 0) {
      for (let t = 0; t < trees.length; t += TREE_STRIDE) {
        const kind = trees[t + 3] | 0;
        if (!isTree[kind]) continue;

        const x = trees[t];
        const y = trees[t + 1];
        const size = trees[t + 2];
        const [lng, lat] = tf.toLngLat(x, y);
        const surface = terrainSurfaceAt(lng, lat, tf);

        if (surface === null) {
          void loadGround([[lng, lat]]).then(() => map.triggerRepaint());
          return null;
        }

        obstacles.push({
          x,
          y,
          base: surface * k - SINK,
          height: Math.max(2, size * 1.05),
          radius: Math.max(1.2, size * (kind === 0 ? 0.28 : 0.36)),
        });
      }
    }

    const kinds = TREE_KINDS.map((_, kind) => {
      const base: number[] = [], par: number[] = [];
      const order: number[] = [];
      for (let t = 0; t < trees.length; t += TREE_STRIDE) if (trees[t + 3] === kind) order.push(t);
      order.sort((a, b) => trees[a + 5] - trees[b + 5]);
      for (const t of order) {
        const x = trees[t], y = trees[t + 1];
        const [a, b] = tf.toLngLat(x, y);
        base.push(x, y, k > 0 ? (terrainSurfaceAt(a, b, tf) ?? groundAt(a, b) ?? 0) * k - SINK : -SINK);
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
    return {
      i,
      j,
      kinds,
      n: kinds.reduce((a, q, kind) => a + (isTree[kind] ? q.length / PER : 0), 0),
      lod: -1,
      seen: 0,
      stale: false,
      obstacles,
    };
  };

  const taken = (a: Float32Array, keep: number) => Math.round((a.length / PER) * keep);
  const assemble = (chosen: { c: Chunk; lods: number[]; keep: number }[]) => {
    const counts = slots.map(() => 0);
    for (const { c, lods, keep } of chosen) c.kinds.forEach((a, kind) => lods[kind] >= 0 && (counts[kind * TREE_LODS + lods[kind]] += taken(a, isTree[kind] ? keep : 1)));
    slots.forEach((s, k) => {
      if (!s.buf || s.buf.count < counts[k]) {
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

  if (import.meta.env.DEV) {
    Object.assign(window, {
      treeStats: () => ({
        drawn: slots.reduce((a, q) => a + q.count, 0),
        byKind: Object.fromEntries(TREE_KINDS.map((k, i) => [k, slots.slice(i * TREE_LODS, (i + 1) * TREE_LODS).reduce((a, q) => a + q.count, 0)])),
        byLod: [0, 1, 2].map((l) => slots.filter((_, k) => k % TREE_LODS === l).reduce((a, q) => a + q.count, 0)),
        reach,
        far: farNow,
        chunks: chunks.size,
        rebuilt,
      }),
    });
  }

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
        impostors = null;
        map.triggerRepaint();
      });
      stops.push(
        effect(() => {
          void opts.frame.value;
          reset();
          map.triggerRepaint();
        }),
        effect(() => {
          void reliefScale.value;
          for (const c of chunks.values()) c.stale = true;
          centreCache.clear();
          map.triggerRepaint();
        }),
        effect(() => {
          void terrainSurfaceRevision.value;
          for (const c of chunks.values()) c.stale = true;
          centreCache.clear();
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

      if (
        !host ||
        !scene ||
        !tf ||
        zoom < TREES_FROM_ZOOM
      ) {
        return;
      }

      const [lng, lat] =
        tf.toLngLat(
          0,
          0,
        );

      if (
        !origin ||
        origin.lng !== lng ||
        origin.lat !== lat
      ) {
        origin = {
          lng,
          lat,
        };

        reset();
      }

      const M = framer.mercator(
        args,
        host,
        origin,
      );

      const eye = eyeOf(M);

      if (!eye) return;

      const planes =
        frustumPlanes(M);

      const merc =
        mercatorLocal(origin);

      const [elng, elat] =
        merc.from(
          eye[0],
          eye[1],
        );

      const [ex, ey] =
        tf.toLocal(
          elng,
          elat,
        );

      const fov =
        (
          (
            map as unknown as {
              transform?: {
                fov?: number;
              };
            }
          ).transform?.fov ??
          36.87
        ) *
        (Math.PI / 180);

      const farOf = (
        tall: number,
      ) =>
        (
          tall *
          0.5 *
          map.getCanvas().clientHeight
        ) /
        Math.tan(fov / 2) /
        MIN_PX;

      const far = Math.min(
        FAR_CAP,
        farOf(TALL),
      );

      const farK =
        TREE_KINDS.map(
          (kind, k) =>
            isTree[k]
              ? far
              : Math.min(
                  DETAIL_CAP,
                  farOf(
                    KIND_INFO[kind].tall,
                  ),
                ),
        );

      farNow = far;

      const k =
        reliefScale.peek();

      const under =
        k > 0
          ? (
              terrainSurfaceAt(
                elng,
                elat,
                tf,
              ) ?? groundAt(elng, elat) ?? 0
            ) * k
          : 0;

      const centre = (
        x: number,
        y: number,
        out: [
          number,
          number,
          number,
        ],
      ): void => {
        const key =
          coordKey(
            x,
            y,
          );

        let pos =
          centreCache.get(key);

        if (!pos) {
          const [clng, clat] =
            tf.toLngLat(
              x,
              y,
            );

          const g =
            k > 0
              ? terrainSurfaceAt(
                  clng,
                  clat,
                  tf,
                ) ?? groundAt(clng, clat)
              : 0;

          const m =
            merc.to(
              clng,
              clat,
            );

          pos = [
            m[0],
            m[1],
            g === null
              ? under
              : g * k,
          ];

          centreCache.set(
            key,
            pos,
          );
        }

        out[0] = pos[0];
        out[1] = pos[1];
        out[2] = pos[2];
      };

      const seen =
        chunksInView({
          planes,
          eye,
          at: [
            ex,
            ey,
          ],
          far,
          size: CHUNK,
          rise: TALL,
          slope: SLOPE,
          centre,
        });

      const t0 =
        performance.now();

      let missing = false;

      for (const s of seen) {
        const key =
          chunkKey(
            s.i,
            s.j,
          );

        const was =
          chunks.get(key);

        if (
          was &&
          !was.stale
        ) {
          continue;
        }

        if (
          performance.now() -
            t0 >
          FRAME_BUDGET
        ) {
          missing = true;
          break;
        }

        const c = build(
          s.i,
          s.j,
          tf,
          origin,
        );

        if (!c) {
          missing = true;
        } else {
          if (was) {
            c.lod = was.lod;
            rebuilt++;
          }

          chunks.set(
            key,
            c,
          );
          setTreeCollisionChunk(c.i, c.j, c.obstacles);
        }
      }

      frameNo++;

      const flat =
        map.getPitch() <
        FLAT_PITCH;

      const ready: {
        c: Chunk;
        lod: number;
        d: number;
        n: number;
      }[] = [];

      for (const s of seen) {
        const c =
          chunks.get(
            chunkKey(
              s.i,
              s.j,
            ),
          );

        if (!c) continue;

        c.seen =
          frameNo;

        const lod = flat
          ? 2
          : c.lod === 0
            ? s.d <
              NEAR * 1.2
              ? 0
              : 1
            : s.d < NEAR
              ? 0
              : 1;

        c.lod = lod;

        ready.push({
          c,
          lod,
          d: s.d,
          n: c.n,
        });
      }

      const want =
        thinReach(
          ready,
          MAX_TREES,
          NEAR,
        );

      const step = (
        r: number,
      ) =>
        REACH_STEP **
        Math.floor(
          Math.log(r) /
            Math.log(
              REACH_STEP,
            ),
        );

      if (want < reach) {
        reach =
          step(want);
      } else if (
        want >=
        reach *
          REACH_STEP *
          REACH_STEP
      ) {
        reach =
          want === Infinity
            ? Infinity
            : step(want) /
              REACH_STEP;
      }

      const detailLod = (
        d: number,
      ) =>
        flat
          ? 2
          : d <
              DETAIL_NEAR
            ? 0
            : 1;

      const chosen =
        ready.map((r) => ({
          c: r.c,

          lods:
            TREE_KINDS.map(
              (_, k) =>
                isTree[k]
                  ? r.lod
                  : r.d <
                      farK[k]
                    ? detailLod(
                        r.d,
                      )
                    : -1,
            ),

          keep:
            r.d < NEAR
              ? 1
              : Math.floor(
                  keepAt(
                    r.d,
                    reach,
                  ) * 16,
                ) / 16,
        }));

      if (
        chunks.size >
        MAX_CHUNKS
      ) {
        for (
          const [key, c]
          of chunks
        ) {
          if (
            frameNo -
              c.seen >
            600
          ) {
            chunks.delete(key);
            removeTreeCollisionChunk(c.i, c.j);
          }
        }
      }

      const sig =
        `${rebuilt}|` +
        chosen
          .map(
            (q) =>
              `${q.c.i},${q.c.j}:${q.lods.join(",")}:${q.keep}`,
          )
          .join(";");

      const now =
        performance.now();

      if (sig !== shown) {
        if (
          shown === null ||
          now -
            lastAssemble >
            ASSEMBLE_EVERY
        ) {
          assemble(chosen);

          shown = sig;

          lastAssemble =
            now;
        } else {
          missing = true;
        }
      }

      // Unlike decorative animation, this is finite pending work.
      // Continue immediately until all visible chunks are ready.
      if (missing) {
        map.triggerRepaint();
      }

      if (
        !slots.some(
          (s) =>
            s.count > 0,
        )
      ) {
        return;
      }

      if (!impostors) {
        const baked =
          host.draw((r) =>
            TREE_KINDS.map(
              (kind) =>
                bakeImpostor(
                  r,
                  buildTree(
                    kind,
                    0,
                  ),
                ),
            ),
          );

        if (!baked) return;

        impostors = baked;

        baked.forEach(
          (q, kind) => {
            const u =
              mats[
                kind *
                  TREE_LODS +
                  1
              ].uniforms;

            u.uColor.value =
              q.color;

            u.uData.value =
              q.data;

            u.uRadius.value =
              q.radius;
          },
        );
      }

      const clock =
        opts.light?.clock.peek() ??
        0;

      const crown =
        crownAt(clock);

      const reed =
        reedAt(clock);

      const grass =
        grassAt(clock);

      const w =
        opts.weather.peek();

      const wind =
        Math.min(
          1,
          (w?.now.wind ?? 2) /
            WIND_FULL,
        );

      const snow =
        Math.min(
          1,
          (w?.snowpack ?? 0) /
            0.05,
        );

      const grow =
        Math.min(
          1,
          (zoom -
            TREES_FROM_ZOOM) /
            (
              GROW_TO -
              TREES_FROM_ZOOM
            ),
        );

      const leafCols = [
        rgb(crown.a),
        rgb(crown.b),
        crown.t,
      ] as const;

      const reedCols = [
        rgb(reed.a),
        rgb(reed.b),
        reed.t,
      ] as const;

      const grassCols = [
        rgb(grass.a),
        rgb(grass.b),
        grass.t,
      ] as const;

      mats.forEach(
        (mat, m) => {
          const kind =
            Math.floor(
              m / TREE_LODS,
            );

          const info =
            KIND_INFO[
              TREE_KINDS[
                kind
              ]
            ];

          const u =
            mat.uniforms;

          framer.set(
            u,
            args,
            host!,
            origin!,
          );

          u.uTime.value =
            motionTime();

          (
            u.uEye.value as Vector3
          ).set(...eye);

          u.uReach.value =
            isTree[kind]
              ? Math.min(
                  reach,
                  1e9,
                )
              : 1e9;

          u.uFar.value =
            farK[kind];

          u.uGrow.value =
            grow *
            grow *
            (3 - 2 * grow);

          (
            u.uWind.value as Vector3
          ).set(
            WIND_DIR[0],
            WIND_DIR[1],
            flat
              ? 0
              : wind *
                info.sway,
          );

          const [a, b, t] =
            info.season ===
            "reed"
              ? reedCols
              : info.season ===
                  "grass"
                ? grassCols
                : leafCols;

          u.uBare.value =
            info.season ===
            "leaf"
              ? crown.bare
              : 0;

          (
            u.uCrownA
              .value as Vector3
          ).set(
            a[0] +
              (
                b[0] -
                a[0]
              ) *
                t,
            a[1] +
              (
                b[1] -
                a[1]
              ) *
                t,
            a[2] +
              (
                b[2] -
                a[2]
              ) *
                t,
          );

          (
            u.uCrownB
              .value as Vector3
          ).set(...b);

          u.uSnow.value =
            info.season ===
            "leaf"
              ? snow *
                crown.bare *
                0.6
              : info.season ===
                  "reed"
                ? snow * 0.4
                : snow;
        },
      );

      host.draw((r) => {
        const color =
          r.state.buffers.color;

        r
          .getContext()
          .colorMask(
            true,
            true,
            true,
            false,
          );

        color.setLocked(true);

        r.render(
          scene!,
          camera,
        );

        color.setLocked(false);
      });
    },
  };
}

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