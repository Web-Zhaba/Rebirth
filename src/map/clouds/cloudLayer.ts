import type maplibregl from "maplibre-gl";
import { effect, type ReadonlySignal } from "@preact/signals";
import {
  BufferAttribute,
  BufferGeometry,
  CustomBlending,
  Matrix4,
  Mesh,
  NoBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  OrthographicCamera,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  type WebGLRenderTarget,
} from "three";
import { sunDirection, TUNING } from "../../sim/weather";
import { DAY_MIN } from "../../sim/time";
import { CLOUD_BASE_M, CLOUD_TOP_M, CUBE_SIZE, FADE_TAU_MS, GLOBE_EXAGGERATION } from "./constants";
import { cloudOpacity, smoothstep, effectiveQuality, MIN_OPACITY, needsMarch, PRESETS, targetSize, FLASH_FRAME_MS, type MadeMarch } from "./cloudQuality";
import { COMPOSITE_FRAG, FULLSCREEN_VERT, MARCH_FRAG } from "./cloudShaders";
import { EARTH_RADIUS_M, lngLatToSphere, transformPoint, weatherToSphere } from "./frame";
import { activeFlashes, FLASH_MAX } from "./lightning";
import { cloudQuality, cloudsOn, type CloudSite } from "./settings";
import { acquireHost, type ThreeHost } from "./three";
import { acquireWeatherTextures, type WeatherTextureSource } from "./weatherTextures";

// The MapLibre custom layer for the volumetric clouds (PLAN-clouds.md section 5). `prerender` ray-marches the shell into
// a low-resolution render target, only when the picture changed (see needsMarch); `render` composites the cached target
// over the map, premultiplied, times the zoom fade. Import this file only through attach.ts (dynamic import).

export const CLOUD_LAYER_ID = "weather-clouds";

// Visual speed of the noise drift relative to the sim wind (the sim field is far larger; full speed would shear the
// small noise into streaks).
const DRIFT_SCALE = 0.08;

// Shell radii on the unit sphere (planet = 1), altitudes exaggerated for the globe view.
const CLOUD_BASE_RADIUS = (CLOUD_BASE_M * GLOBE_EXAGGERATION) / EARTH_RADIUS_M;
const CLOUD_TOP_RADIUS = (CLOUD_TOP_M * GLOBE_EXAGGERATION) / EARTH_RADIUS_M;

export interface CloudOptions {
  clock: ReadonlySignal<number>; // game minutes
  site: ReadonlySignal<CloudSite | null>;
}

function triangle(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  return g;
}

// ---- DEV timing: GPU time per phase with EXT_disjoint_timer_query_webgl2, logged once per second ----
class Series {
  v: number[] = [];
  add(x: number) {
    this.v.push(x);
    if (this.v.length > 240) this.v.shift();
  }
  summary() {
    if (!this.v.length) return null;
    const s = [...this.v].sort((a, b) => a - b);
    return { n: s.length, mean: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3), p95: +s[Math.floor(s.length * 0.95)].toFixed(3), max: +s[s.length - 1].toFixed(3) };
  }
}

interface Timer {
  ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };
  pending: { q: WebGLQuery; s: Series }[];
  active: boolean;
}

export function createCloudLayer(map: maplibregl.Map, opts: CloudOptions): maplibregl.CustomLayerInterface {
  let host: ThreeHost | null = null;
  let tex: WeatherTextureSource | null = null;
  let target: WebGLRenderTarget | null = null;
  let made: MadeMarch | null = null;
  let active = false; // this frame draws the clouds (set by prerender, read by render)
  let fade = 0; // eased zoom fade of this frame (prerender), used by the march and the composite
  let fadeAt = 0;
  let fadeReady = false;
  let lastCam: Vector3 | null = null;
  const lastSun = new Vector3(0, 0, 1);
  let stopEffect: (() => void) | null = null;
  let unsub: (() => void) | null = null;
  let unRestore: (() => void) | null = null;
  let poll = 0;
  let repaintTimer = 0;
  let lastTextures: ReturnType<WeatherTextureSource["update"]> = null;
  const flashes = new Float32Array(FLASH_MAX * 4);
  let flashCount = 0;
  const debug = { testFlash: null as null | [number, number, number], forceFlash: false, sun: null as null | [number, number, number] };

  const ortho = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const tri = triangle();
  let march: ShaderMaterial | null = null;
  let comp: ShaderMaterial | null = null;
  let marchScene: Scene | null = null;
  let compScene: Scene | null = null;

  // dev stats
  const dev = import.meta.env.DEV;
  const gpu = { march: new Series(), comp: new Series() };
  const cpu = { march: new Series(), comp: new Series() };
  const counts = { marches: 0, frames: 0 };
  let timer: Timer | null = null;
  let lastLog = 0;
  let info: Record<string, unknown> = {};
  let why = "";

  const timed = (gl: WebGL2RenderingContext, s: Series, fn: () => void) => {
    if (!timer || timer.active) return fn();
    const q = gl.createQuery()!;
    timer.active = true;
    gl.beginQuery(timer.ext.TIME_ELAPSED_EXT, q);
    try {
      fn();
    } finally {
      gl.endQuery(timer.ext.TIME_ELAPSED_EXT);
      timer.active = false;
    }
    timer.pending.push({ q, s });
  };
  const collect = (gl: WebGL2RenderingContext) => {
    if (!timer) return;
    const disjoint = gl.getParameter(timer.ext.GPU_DISJOINT_EXT);
    timer.pending = timer.pending.filter((p) => {
      if (!gl.getQueryParameter(p.q, gl.QUERY_RESULT_AVAILABLE)) return true;
      if (!disjoint) p.s.add(gl.getQueryParameter(p.q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(p.q);
      return false;
    });
    if (timer.pending.length > 40) timer.pending.splice(0, 20);
    const now = performance.now();
    if (now - lastLog > 1000) {
      lastLog = now;
      const m = gpu.march.summary();
      const c = gpu.comp.summary();
      if (m || c) console.info(`[clouds] gpu march ${m ? m.mean : "-"} ms (n=${m ? m.n : 0}), composite ${c ? c.mean : "-"} ms`);
    }
  };

  const build = () => {
    marchScene?.children.forEach((o) => (o as Mesh).material && ((o as Mesh).material as ShaderMaterial).dispose());
    march = new ShaderMaterial({
      uniforms: {
        uInv: { value: new Matrix4() },
        uSun: { value: new Vector3(0, 0, 1) },
        uCubeA: { value: null },
        uCubeB: { value: null },
        uMix: { value: 0 },
        uBase: { value: null },
        uDetail: { value: null },
        uDetailOn: { value: 1 },
        uWind: { value: new Vector3(TUNING.windDeg * DRIFT_SCALE, TUNING.tradeDeg * DRIFT_SCALE, TUNING.layerDays) },
        uDays: { value: 0 },
        uRBase: { value: 1 },
        uRTop: { value: 1 },
        uSteps: { value: 48 },
        uLightSteps: { value: 5 },
        uFade: { value: 1 },
        uFlash: { value: flashes },
        uFlashCount: { value: 0 },
        uOrbit: { value: 1 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: MARCH_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: NoBlending,
    });
    comp = new ShaderMaterial({
      uniforms: { tMap: { value: null }, uFade: { value: 1 }, uTexel: { value: new Vector2(1, 1) } },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    marchScene = new Scene();
    marchScene.add(Object.assign(new Mesh(tri, march), { frustumCulled: false }));
    compScene = new Scene();
    compScene.add(Object.assign(new Mesh(tri, comp), { frustumCulled: false }));
  };

  // A flash counts only when it can be seen: on the camera's side of the planet and not in full daylight, where it
  // is too faint to matter (the shader keeps a faint daytime glow for flashes that pass the test anyway).
  const visibleFrom = (cam: Vector3 | null) => (x: number, y: number, z: number) => {
    if (lastSun.x * x + lastSun.y * y + lastSun.z * z > 0.3) return false;
    if (!cam) return true;
    return cam.x * x + cam.y * y + cam.z * z > 0.85; // dot with the camera position > ~1 = above the horizon
  };

  // Flashes of this moment from the real-time schedule; the test hook injects one for visual checks.
  const computeFlashes = (storms: Float32Array, count: number): number => {
    const timeS = Date.now() / 1000;
    let n = activeFlashes(storms, count, timeS, flashes, visibleFrom(lastCam));
    if (debug.testFlash && (debug.forceFlash || n === 0)) {
      flashes.set([debug.testFlash[0], debug.testFlash[1], debug.testFlash[2], 1], 0);
      n = Math.max(n, 1);
    }
    return n;
  };

  const scheduleRepaint = () => {
    if (repaintTimer) return;
    repaintTimer = window.setTimeout(() => {
      repaintTimer = 0;
      map.triggerRepaint();
    }, FLASH_FRAME_MS);
  };

  // A zoom jump (wheel tick, double click, fly-to) must not blink the deck: the fade follows its target with a time
  // constant and the layer keeps asking for frames until it settles.
  const easeFade = (target: number, now: number): number => {
    if (!fadeReady) {
      fadeReady = true;
      fadeAt = now;
      fade = target;
      return fade;
    }
    const dt = Math.min(Math.max(now - fadeAt, 0), 100);
    fadeAt = now;
    fade += (target - fade) * (1 - Math.exp(-dt / FADE_TAU_MS));
    if (Math.abs(target - fade) < 0.002) fade = target;
    return fade;
  };

  const layer: maplibregl.CustomLayerInterface = {
    id: CLOUD_LAYER_ID,
    type: "custom",
    renderingMode: "2d",
    onAdd(_m, gl) {
      const g = gl as WebGL2RenderingContext;
      host = acquireHost(map, g);
      tex = acquireWeatherTextures(host);
      unsub = tex.subscribe(() => map.triggerRepaint());
      unRestore = host.onRestore(() => {
        target?.dispose();
        target = null;
        made = null;
        build();
      });
      build();
      if (dev) {
        const ext = g.getExtension("EXT_disjoint_timer_query_webgl2");
        timer = ext ? { ext: ext as unknown as Timer["ext"], pending: [], active: false } : null;
        info = { floatTargets: host.floatTargets, timerQuery: !!ext, renderer: g.getParameter(g.RENDERER) };
        Object.assign(window, {
          cloudsDebug: {
            stats: () => ({ gpuMarchMs: gpu.march.summary(), gpuCompositeMs: gpu.comp.summary(), cpuMarchMs: cpu.march.summary(), cpuCompositeMs: cpu.comp.summary(), ...counts }),
            reset: () => {
              for (const s of [gpu.march, gpu.comp, cpu.march, cpu.comp]) s.v = [];
              counts.marches = counts.frames = 0;
            },
            info: () => ({ ...info, why, active, fade, target: target ? [target.width, target.height] : null, flashCount, storms: lastTextures?.stormCount ?? 0, tex: lastTextures && { ready: lastTextures.ready, mix: lastTextures.mix, version: lastTextures.version, base: !!lastTextures.base, aImages: lastTextures.cubeA.images.length, bImages: lastTextures.cubeB.images.length } }),
            // inject a lightning flash at a lng/lat (null clears); force = even when real flashes exist
            testFlash: (v: [number, number, number] | null, force = true) => {
              debug.testFlash = v;
              debug.forceFlash = force;
              map.triggerRepaint();
            },
            // override the sun for visual checks: lng/lat of the subsolar point in degrees (null = the real sun)
            setSun: (ll: [number, number] | null) => {
              debug.sun = ll ? lngLatToSphere(ll[0], ll[1]) : null;
              made = null;
              map.triggerRepaint();
            },
            storms: () => (lastTextures ? Array.from(lastTextures.storms.slice(0, 16)) : null),
          },
        });
      }
      // The layer reacts to the toggle, the quality, the site and the game clock.
      stopEffect = effect(() => {
        void cloudsOn.value;
        void cloudQuality.value;
        void opts.site.value;
        void opts.clock.value;
        map.triggerRepaint();
      });
      // Lightning can start while the camera is still: look for a flash ten times a second and wake the map.
      poll = window.setInterval(() => {
        if (!active || !lastTextures || document.hidden) return;
        if (computeFlashes(lastTextures.storms, lastTextures.stormCount) > 0) map.triggerRepaint();
      }, 100);
    },
    onRemove() {
      stopEffect?.();
      unsub?.();
      unRestore?.();
      window.clearInterval(poll);
      window.clearTimeout(repaintTimer);
      repaintTimer = 0;
      marchScene?.children.forEach((o) => ((o as Mesh).material as ShaderMaterial).dispose());
      compScene?.children.forEach((o) => ((o as Mesh).material as ShaderMaterial).dispose());
      march?.dispose();
      comp?.dispose();
      tri.dispose();
      target?.dispose();
      target = null;
      tex?.release();
      tex = null;
      host?.release();
      host = null;
      made = null;
      active = false;
      if (dev) delete (window as unknown as { cloudsDebug?: unknown }).cloudsDebug;
    },
    prerender(gl, args) {
      active = false;
      why = "no host";
      if (!host || !tex || !march || !marchScene) return;
      const g = gl as WebGL2RenderingContext;
      collect(g);
      const site = opts.site.peek();
      why = "off/site/fade";
      if (!cloudsOn.peek() || !site) {
        fadeReady = false;
        return;
      }
      const now = performance.now();
      const targetFade = cloudOpacity(map.getZoom());
      fade = easeFade(targetFade, now);
      if (fade !== targetFade) map.triggerRepaint();
      if (fade <= MIN_OPACITY) return;
      const frame = host.frame(args.defaultProjectionData);
      why = `transition ${frame.transition}`;
      if (frame.transition <= 0 || !frame.inv) return;

      const quality = effectiveQuality(cloudQuality.peek(), host.floatTargets);
      const preset = PRESETS[quality];
      const clock = opts.clock.peek();
      const wt = tex.update(clock, site, CUBE_SIZE[quality]);
      lastTextures = wt;
      why = `textures ready=${wt?.ready} base=${!!wt?.base}`;
      if (!wt || !wt.ready || !wt.base || !wt.detail) return;
      why = "ok";
      active = true;

      const cam = transformPoint(frame.inv, [0, 0, -1]);
      lastCam = (lastCam ?? new Vector3()).set(cam[0], cam[1], cam[2]);

      const size = targetSize(g.drawingBufferWidth, g.drawingBufferHeight, preset.scale);
      if (!target || target.width !== size.width || target.height !== size.height) {
        target?.dispose();
        target = host.makeTarget(size.width, size.height);
        made = null;
      }

      const sun = debug.sun ?? weatherToSphere(sunDirection(clock, site.phase));
      lastSun.set(sun[0], sun[1], sun[2]);
      flashCount = computeFlashes(wt.storms, wt.stormCount);
      // The dissolve depends on the fade, so a change of the fade makes the cached march stale; 1/256 is invisible.
      const fadeKey = Math.round(fade * 256) / 256;
      const key = { matrix: frame.main, width: size.width, height: size.height, clock, fade: fadeKey, version: wt.version, quality, generation: host.generation, flash: flashCount > 0 };
      if (!needsMarch(made, key, flashCount > 0, now)) return;

      const t0 = now;
      const u = march.uniforms;
      u.uInv.value.fromArray(frame.inv32);
      u.uSun.value.copy(lastSun);
      u.uCubeA.value = wt.cubeA;
      u.uCubeB.value = wt.cubeB;
      u.uMix.value = wt.mix;
      u.uBase.value = wt.base;
      u.uDetail.value = wt.detail;
      u.uDetailOn.value = preset.detail ? 1 : 0;
      u.uDays.value = clock / DAY_MIN;
      u.uRBase.value = 1 + CLOUD_BASE_RADIUS;
      u.uRTop.value = 1 + CLOUD_TOP_RADIUS;
      u.uSteps.value = preset.steps;
      u.uLightSteps.value = preset.lightSteps;
      u.uFade.value = fade;
      u.uFlashCount.value = flashCount;
      u.uOrbit.value = 1 - smoothstep(2.6, 3.4, map.getZoom());
      const tgt = target;
      timed(g, gpu.march, () => {
        host!.draw((r) => {
          r.setRenderTarget(tgt);
          r.setClearColor(0x000000, 0);
          r.clear(true, false, false);
          r.render(marchScene!, ortho);
        });
      });
      made = { ...key, matrix: Float64Array.from(frame.main), at: now };
      counts.marches++;
      if (dev) cpu.march.add(performance.now() - t0);
      if (flashCount > 0) scheduleRepaint();
    },
    render(gl) {
      if (!host || !comp || !compScene || !target || !active || !made) return;
      const t0 = performance.now();
      const g = gl as WebGL2RenderingContext;
      timed(g, gpu.comp, () => {
        host!.draw((r) => {
          comp!.uniforms.tMap.value = target!.texture;
          comp!.uniforms.uFade.value = fade;
          comp!.uniforms.uTexel.value.set(1 / target!.width, 1 / target!.height);
          r.render(compScene!, ortho);
        });
      });
      counts.frames++;
      if (dev) cpu.comp.add(performance.now() - t0);
    },
  };
  return layer;
}
