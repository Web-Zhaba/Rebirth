import type maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import {
  Camera,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  LessEqualDepth,
  Matrix4,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Scene,
  ShaderMaterial,
  Vector3,
  Vector4,
} from "three";
import { calendar } from "../sim/clock";
import type { WeatherState } from "../sim/weather";
import type { Frame as TownFrame } from "../world/frame";
import { motionOn, motionTime, showWhile, smoke3dOn } from "./graphicsSettings";
import { projectPoints } from "./modelBuffers";
import { frameSetter, modelEmitters, type ModelLayerOptions } from "./modelLayer";
import { smokeKindOf, smokeStrength, type SmokeKind } from "./smokeMath";
import { eyeOf } from "./three/frame";
import { acquireHost, type ThreeHost } from "./three/host";
import { WIND_DIR } from "./weatherMath";

// Smoke from the chimneys (PLAN-3d-world.ru.md stage 7): soft puffs, camera-facing quads with a procedural soft disc,
// born at a chimney top (Model.smoke, carried by modelLayer.ts modelEmitters), rising, widening, bending downwind and
// fading. A puff's whole life is computed in the vertex shader from its emitter, its index and the clock (uTime), so a
// frame costs no CPU work per puff; with the motion setting off the clock stands still and so do the puffs.
// Same projection and light as the building models (frameSetter; the emitters are projected in float64 into the
// globe and mercator frames once, when they change). Import only with a dynamic `import()` (it pulls in three.js).
//
// Which chimneys smoke and how hard is smokeMath.ts: three strengths (home, furnace, tavern) per frame, and the shader
// keeps alive that share of a chimney's PUFFS (a puff's phase is a golden-ratio step of its index, so any prefix is
// spread evenly along the plume). Only the nearest MAX_EMITTERS chimneys within REACH metres of the camera are
// uploaded; the selection is redone when the camera has moved SELECT_STEP metres or the emitters changed.
// Beware GLSL ES 3.0 reserved words in the shaders (patch, sample, common, filter, input, output, active...): a
// compile error hides the layer and the console shows only three's program log.

export const SMOKE_LAYER_ID = "chimney-smoke";
export const SMOKE_FROM_ZOOM = 15.5;
const PUFFS = 12; // per chimney, at full strength
const LIFE = 8; // s, a puff's life
const RISE = 12; // m a puff climbs in its life
const REACH = 650; // m from the camera: chimneys farther are dropped (they fade out from 0.75 of FAR)
const FAR = 600;
const MAX_EMITTERS = 400;
const SELECT_STEP = 30; // m the camera moves before the nearest chimneys are chosen again
const PER = 10; // floats per emitter: globe (3), mercator (3), kind, hash, scale, pad
const SCALE: Record<SmokeKind, number> = { home: 1, furnace: 1.35, tavern: 1.15 };
const KIND_INDEX: Record<SmokeKind, number> = { home: 0, furnace: 1, tavern: 2 };

const VERT = /* glsl */ `
attribute float aN; // the puff, 0..${PUFFS - 1}
attribute vec3 iG;
attribute vec3 iM;
attribute vec4 iP; // kind, hash, scale
uniform mat4 uG;
uniform mat4 uM;
uniform float uT;
uniform float uTime;
uniform vec3 uEye; // camera in the mercator frame
uniform vec3 uS; // strength of home, furnace and tavern chimneys
uniform vec3 uWind; // direction, speed in m/s
uniform float uFar;
varying vec2 vQ;
varying float vA;
varying float vAge;
varying float vSeed;
float hash11(float x) {
  return fract(sin(x * 12.9898) * 43758.5453);
}
void main() {
  float str = iP.x < 0.5 ? uS.x : (iP.x < 1.5 ? uS.y : uS.z);
  // the share of the puffs alive at this strength; the last one of them is faint
  float alive = clamp(str * ${PUFFS}.0 - aN, 0.0, 1.0);
  float dist = length(iM - uEye);
  float vis = alive * (1.0 - smoothstep(uFar * 0.75, uFar, dist));
  // the puff's place in its life: its own phase, a new draw every round
  float cyc = uTime / ${LIFE}.0 + fract(aN * 0.6180339 + iP.y);
  float t = fract(cyc);
  float seed = hash11(floor(cyc) * 7.13 + aN * 3.7 + iP.y * 91.0);
  float age = t * ${LIFE}.0;
  float rise = ${RISE}.0 * (1.0 - pow(1.0 - t, 1.6));
  // downwind: the plume starts upright and leans over; it wanders sideways more the older it is
  float speed = 0.5 + uWind.z;
  vec2 dir = uWind.xy;
  vec2 across = vec2(-dir.y, dir.x);
  float bend = pow(t, 1.35) * ${LIFE}.0 * 0.4 * speed;
  float sway = sin(age * 1.6 + seed * 6.2831) * (0.15 + 1.1 * t) * (0.5 + 0.5 * seed);
  vec3 off = vec3(dir * bend + across * sway, 0.2 + rise);
  float rad = vis > 0.002 ? iP.z * (0.5 + 2.6 * pow(t, 0.7)) * mix(0.6, 1.0, str) : 0.0;
  // a quad facing the camera
  vec3 c = iM + off;
  vec3 F = normalize(uEye - c);
  vec3 R = cross(vec3(0.0, 0.0, 1.0), F);
  R = length(R) > 1e-4 ? normalize(R) : vec3(1.0, 0.0, 0.0);
  vec3 U = cross(F, R);
  vec3 p = off + (R * position.x + U * position.y) * rad;
  vec4 m = uM * vec4(iM + p, 1.0);
  vec4 g = uG * vec4(iG + p, 1.0);
  gl_Position = rad <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : (uT > 0.999 ? g : (uT <= 0.0 ? m : mix(m, g, uT)));
  vQ = position.xy;
  vAge = t;
  vSeed = seed;
  vA = vis * smoothstep(0.0, 0.08, t) * pow(1.0 - t, 1.3) * mix(0.45, 0.8, str);
}`;

const FRAG = /* glsl */ `
uniform float uSun;
uniform vec4 uTint; // the night tint (nightLayer.ts) where it cannot reach us: on the relief it is draped on the ground
varying vec2 vQ;
varying float vA;
varying float vAge;
varying float vSeed;
float h2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float r = length(vQ);
  if (r > 1.0 || vA < 0.002) discard;
  // a soft disc with a ragged edge, the rag drifting with the puff's age
  vec2 np = vQ * 1.8 + vec2(vSeed * 31.0, vSeed * 17.0 + vAge * 1.5);
  float n = 0.6 * vnoise(np) + 0.4 * vnoise(np * 2.3 + 5.0);
  float a = (1.0 - smoothstep(0.25, 0.95, r + (n - 0.5) * 0.55)) * vA;
  if (a < 0.003) discard;
  // grey and dense when young, paler as it thins; lit from above, dim at night (the tint does the rest)
  vec3 col = mix(vec3(0.58, 0.59, 0.61), vec3(0.93, 0.93, 0.92), smoothstep(0.0, 0.7, vAge));
  col *= (0.78 + 0.22 * uSun) * (0.9 + 0.1 * vQ.y) * (0.9 + 0.2 * n);
  col = mix(col, uTint.rgb, uTint.a);
  gl_FragColor = vec4(col * a, a);
}`;

export interface SmokeLayerOptions {
  frame: ReadonlySignal<TownFrame | null>;
  light?: ModelLayerOptions["light"];
  weather: ReadonlySignal<WeatherState | null>;
}

// Deterministic 0..1 from a position (a chimney's phase).
const hashOf = (x: number, y: number) => {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return h - Math.floor(h);
};

export function createSmokeLayer(map: maplibregl.Map, opts: SmokeLayerOptions): maplibregl.CustomLayerInterface {
  let host: ThreeHost | null = null;
  let scene: Scene | null = null;
  let mat: ShaderMaterial | null = null;
  let geo: InstancedBufferGeometry | null = null;
  let buf: InstancedInterleavedBuffer | null = null;
  const stops: (() => void)[] = [];
  const camera = new Camera();
  const framer = frameSetter(opts.light);
  let origin: { lng: number; lat: number } | null = null;
  let all = new Float32Array(0); // every smoking-capable chimney, PER floats each, projected for `origin`
  let stale = true; // the emitters, the frame or the origin changed: `all` is built again
  let picked: [number, number, number] | null = null; // the eye the nearest chimneys were chosen for
  let count = 0; // chimneys uploaded
  const strength: [number, number, number] = [0, 0, 0];
  let hourNow = 0;
  let tempNow = 0;

  // The emitters of the model layer that are in use, projected into both frames.
  const build = (tf: TownFrame, o: { lng: number; lat: number }) => {
    const base: number[] = [], par: number[] = [];
    for (const e of modelEmitters.peek()) {
      const kind = smokeKindOf(e);
      if (!kind) continue;
      base.push(e.x, e.y, e.z);
      par.push(KIND_INDEX[kind], hashOf(e.x, e.y), SCALE[kind], 0);
    }
    const { g, m } = projectPoints(base, tf.toLngLat, o);
    const n = base.length / 3;
    all = new Float32Array(n * PER);
    for (let q = 0; q < n; q++) {
      all.set(g.subarray(q * 3, q * 3 + 3), q * PER);
      all.set(m.subarray(q * 3, q * 3 + 3), q * PER + 3);
      all.set(par.slice(q * 4, q * 4 + 4), q * PER + 6);
    }
    stale = false;
    picked = null;
  };

  // The nearest chimneys within REACH of the eye into the instance buffer.
  const select = (eye: [number, number, number]) => {
    const near: { q: number; d: number }[] = [];
    for (let q = 0; q < all.length / PER; q++) {
      const d = Math.hypot(all[q * PER + 3] - eye[0], all[q * PER + 4] - eye[1], all[q * PER + 5] - eye[2]);
      if (d < REACH) near.push({ q, d });
    }
    near.sort((a, b) => a.d - b.d);
    if (near.length > MAX_EMITTERS) near.length = MAX_EMITTERS;
    const dst = buf!.array as Float32Array;
    near.forEach(({ q }, i) => dst.set(all.subarray(q * PER, (q + 1) * PER), i * PER));
    count = near.length;
    geo!.instanceCount = count;
    buf!.needsUpdate = true;
    picked = eye;
  };

  // devtools: what is drawn now
  if (import.meta.env.DEV)
    Object.assign(window, { smokeStats: () => ({ emitters: all.length / PER, drawn: count, puffs: Math.round(count * PUFFS * Math.max(...strength)), strength: { home: strength[0], furnace: strength[1], tavern: strength[2] }, temp: tempNow, hour: hourNow }) });

  return {
    id: SMOKE_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(_m, gl) {
      host = acquireHost(map, gl as WebGL2RenderingContext);
      scene = new Scene();
      // PUFFS quads in one geometry, instanced per chimney (a fixed capacity: three keeps the instance limit of the first binding)
      geo = new InstancedBufferGeometry();
      const pos: number[] = [], idx: number[] = [], num: number[] = [];
      for (let k = 0; k < PUFFS; k++) {
        pos.push(-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0);
        num.push(k, k, k, k);
        idx.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
      }
      geo.setAttribute("position", new Float32BufferAttribute(pos, 3));
      geo.setAttribute("aN", new Float32BufferAttribute(num, 1));
      geo.setIndex(idx);
      buf = new InstancedInterleavedBuffer(new Float32Array(MAX_EMITTERS * PER), PER).setUsage(DynamicDrawUsage);
      geo.setAttribute("iG", new InterleavedBufferAttribute(buf, 3, 0));
      geo.setAttribute("iM", new InterleavedBufferAttribute(buf, 3, 3));
      geo.setAttribute("iP", new InterleavedBufferAttribute(buf, 4, 6));
      geo.instanceCount = 0;
      mat = new ShaderMaterial({
        uniforms: {
          uG: { value: new Matrix4() },
          uM: { value: new Matrix4() },
          uT: { value: 0 },
          uSun: { value: 0 },
          uTint: { value: new Vector4() },
          uTime: { value: 0 },
          uEye: { value: new Vector3() },
          uS: { value: new Vector3() },
          uWind: { value: new Vector3() },
          uFar: { value: FAR },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: DoubleSide,
        transparent: true,
        // premultiplied, as MapLibre composites; read the depth of the buildings, never write
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendSrcAlpha: OneFactor,
        blendDstAlpha: OneMinusSrcAlphaFactor,
        depthTest: true,
        depthWrite: false,
        depthFunc: LessEqualDepth,
      });
      scene.add(Object.assign(new Mesh(geo, mat), { frustumCulled: false }));
      stops.push(
        effect(() => {
          void opts.frame.value;
          void modelEmitters.value;
          stale = true;
          map.triggerRepaint();
        }),
        // the weather or the hour moved: the strength changes (and a layer that drew nothing must look again)
        effect(() => {
          void opts.weather.value;
          void opts.light?.clock.value;
          if (map.getZoom() >= SMOKE_FROM_ZOOM) map.triggerRepaint();
        }),
      );
    },
    onRemove() {
      for (const s of stops) s();
      stops.length = 0;
      geo?.dispose();
      mat?.dispose();
      host?.release();
      host = null;
      scene = mat = geo = buf = null;
      all = new Float32Array(0);
      count = 0;
      stale = true;
      picked = null;
    },
    render(_gl, args) {
      const tf = opts.frame.peek();
      if (!host || !scene || !mat || !geo || !buf || !tf || map.getZoom() < SMOKE_FROM_ZOOM) return;
      const [lng, lat] = tf.toLngLat(0, 0);
      if (!origin || origin.lng !== lng || origin.lat !== lat) {
        origin = { lng, lat };
        stale = true;
      }
      if (stale) build(tf, origin);
      if (!all.length) return;
      // the strengths of this hour and weather
      const w = opts.weather.peek();
      const cal = calendar(opts.light?.clock.peek() ?? 0);
      hourNow = cal.hour + cal.minute / 60;
      tempNow = w?.now.temp ?? 10;
      const precip = w?.now.precip ?? 0;
      (["home", "furnace", "tavern"] as const).forEach((k, i) => (strength[i] = smokeStrength(k, tempNow, hourNow, precip)));
      count = 0;
      if (Math.max(...strength) <= 0) return;
      const M = framer.mercator(args, host, origin);
      const eye = eyeOf(M);
      if (!eye) return;
      if (!picked || Math.hypot(eye[0] - picked[0], eye[1] - picked[1], eye[2] - picked[2]) > SELECT_STEP) select(eye);
      else count = geo.instanceCount;
      if (!count) return;
      const u = mat.uniforms;
      framer.set(u, args, host, origin);
      u.uTime.value = motionTime();
      (u.uEye.value as Vector3).set(...eye);
      (u.uS.value as Vector3).set(...strength);
      (u.uWind.value as Vector3).set(WIND_DIR[0], WIND_DIR[1], w?.now.wind ?? 2);
      host.draw((r) => r.render(scene!, camera));
      if (motionOn.peek()) map.triggerRepaint(); // the puffs move every frame
    },
  };
}

// Adds the layer just above the building models and the trees (in the group of the 3D layers, before the outlines).
export function attachSmokeLayer(map: maplibregl.Map, opts: SmokeLayerOptions): () => void {
  const layer = createSmokeLayer(map, opts);
  const before = () => ["buildings-outline", "night-tint"].find((id) => map.getLayer(id));
  let disposed = false;
  let stopShow: (() => void) | null = null;
  const add = () => {
    const b = before();
    if (disposed || map.getLayer(SMOKE_LAYER_ID) || !b) return;
    map.addLayer(layer, b);
    map.off("styledata", add);
    stopShow = showWhile(map, SMOKE_LAYER_ID, smoke3dOn);
  };
  if (before()) add();
  else map.on("styledata", add);
  return () => {
    disposed = true;
    stopShow?.();
    map.off("styledata", add);
    if (map.getLayer(SMOKE_LAYER_ID)) map.removeLayer(SMOKE_LAYER_ID);
  };
}
