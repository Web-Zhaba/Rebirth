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

export const SMOKE_LAYER_ID = "chimney-smoke";
export const SMOKE_FROM_ZOOM = 15.5;
const PUFFS = 12;
const LIFE = 8;
const RISE = 12;
const REACH = 650;
const REACH_SQ = REACH * REACH;
const FAR = 600;
const MAX_EMITTERS = 400;
const SELECT_STEP = 30;
const PER = 10;
const SCALE: Record<SmokeKind, number> = { home: 1, furnace: 1.35, tavern: 1.15 };
const KIND_INDEX: Record<SmokeKind, number> = { home: 0, furnace: 1, tavern: 2 };
const SMOKE_REPAINT_MS = 33; // ~30 FPS для анимации дыма при статичной камере

const VERT = /* glsl */ `
attribute float aN;
attribute vec3 iG;
attribute vec3 iM;
attribute vec4 iP;
uniform mat4 uG;
uniform mat4 uM;
uniform float uT;
uniform float uTime;
uniform vec3 uEye;
uniform vec3 uS;
uniform vec3 uWind;
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
  float alive = clamp(str * ${PUFFS}.0 - aN, 0.0, 1.0);
  float dist = length(iM - uEye);
  float vis = alive * (1.0 - smoothstep(uFar * 0.75, uFar, dist));
  float cyc = uTime / ${LIFE}.0 + fract(aN * 0.6180339 + iP.y);
  float t = fract(cyc);
  float seed = hash11(floor(cyc) * 7.13 + aN * 3.7 + iP.y * 91.0);
  float age = t * ${LIFE}.0;
  float rise = ${RISE}.0 * (1.0 - pow(1.0 - t, 1.6));
  float speed = 0.5 + uWind.z;
  vec2 dir = uWind.xy;
  vec2 across = vec2(-dir.y, dir.x);
  float bend = pow(t, 1.35) * ${LIFE}.0 * 0.4 * speed;
  float sway = sin(age * 1.6 + seed * 6.2831) * (0.15 + 1.1 * t) * (0.5 + 0.5 * seed);
  vec3 off = vec3(dir * bend + across * sway, 0.2 + rise);
  float rad = vis > 0.002 ? iP.z * (0.5 + 2.6 * pow(t, 0.7)) * mix(0.6, 1.0, str) : 0.0;
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
uniform vec4 uTint;
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
  vec2 np = vQ * 1.8 + vec2(vSeed * 31.0, vSeed * 17.0 + vAge * 1.5);
  float n = 0.6 * vnoise(np) + 0.4 * vnoise(np * 2.3 + 5.0);
  float a = (1.0 - smoothstep(0.25, 0.95, r + (n - 0.5) * 0.55)) * vA;
  if (a < 0.003) discard;
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
  let all = new Float32Array(0);
  let stale = true;
  let picked: [number, number, number] | null = null;
  let count = 0;
  let repaintTimer: ReturnType<typeof setTimeout> | null = null;
  const strength: [number, number, number] = [0, 0, 0];
  let hourNow = 0;
  let tempNow = 0;

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
      all[q * PER + 6] = par[q * 4];
      all[q * PER + 7] = par[q * 4 + 1];
      all[q * PER + 8] = par[q * 4 + 2];
      all[q * PER + 9] = par[q * 4 + 3];
    }
    stale = false;
    picked = null;
  };

  const select = (eye: [number, number, number]) => {
    const near: { q: number; d2: number }[] = [];
    const total = all.length / PER;
    for (let q = 0; q < total; q++) {
      const dx = all[q * PER + 3] - eye[0];
      const dy = all[q * PER + 4] - eye[1];
      const dz = all[q * PER + 5] - eye[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < REACH_SQ) near.push({ q, d2 });
    }
    near.sort((a, b) => a.d2 - b.d2);
    if (near.length > MAX_EMITTERS) near.length = MAX_EMITTERS;
    const dst = buf!.array as Float32Array;
    near.forEach(({ q }, i) => dst.set(all.subarray(q * PER, (q + 1) * PER), i * PER));
    count = near.length;
    geo!.instanceCount = count;
    buf!.needsUpdate = true;
    picked = eye;
  };

  if (import.meta.env.DEV)
    Object.assign(window, {
      smokeStats: () => ({
        emitters: all.length / PER,
        drawn: count,
        puffs: Math.round(count * PUFFS * Math.max(...strength)),
        strength: { home: strength[0], furnace: strength[1], tavern: strength[2] },
        temp: tempNow,
        hour: hourNow,
      }),
    });

  return {
    id: SMOKE_LAYER_ID,
    type: "custom",
    renderingMode: "3d",
    onAdd(_m, gl) {
      host = acquireHost(map, gl as WebGL2RenderingContext);
      scene = new Scene();
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
        effect(() => {
          void opts.weather.value;
          void opts.light?.clock.value;
          if (map.getZoom() >= SMOKE_FROM_ZOOM) map.triggerRepaint();
        }),
      );
    },
    onRemove() {
      if (repaintTimer) {
        clearTimeout(repaintTimer);
        repaintTimer = null;
      }
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

      // Троттлинг анимации дыма при статичной камере (~30 FPS): не спамим перерисовку в текущем кадре
      if (motionOn.peek() && !repaintTimer) {
        repaintTimer = setTimeout(() => {
          repaintTimer = null;
          map.triggerRepaint();
        }, SMOKE_REPAINT_MS);
      }
    },
  };
}

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