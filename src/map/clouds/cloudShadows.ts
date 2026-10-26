import type maplibregl from "maplibre-gl";
import type { ReadonlySignal } from "@preact/signals";
import { BufferAttribute, BufferGeometry, Camera, Color, CustomBlending, DstColorFactor, Matrix4, Mesh, Scene, ShaderMaterial, Vector2, Vector3, ZeroFactor, OneFactor } from "three";
import { DAY_MIN } from "../../sim/time";
import { sunDirection } from "../../sim/weather";
import { PALETTE } from "../../ui/palette";
import { CUBE_SIZE } from "./constants";
import { invert4, lngLatToMercator, mercatorLocalMatrix, mercatorToLngLat, metresPerMercator, weatherToSphere, EARTH_RADIUS_M, type Vec3 } from "./frame";
import { cloudQuality, cloudsOn, type CloudSite } from "./settings";
import { driftPhases, localFrame, mercatorScaleK, NOISE_TILE_M, rayBasis, rotatePolar, shadowHeight, sunLocal, sunOffsetLocal, sunStrength, DRIFT_DEG } from "./shadowMath";
import { SHADOW_FRAG, SHADOW_VERT } from "./shadowShaders";
import { acquireHost, type ThreeHost } from "./three";
import { acquireWeatherTextures, type WeatherTextureSource } from "./weatherTextures";

// Cloud shadows on the ground and the overcast dimming (PLAN-clouds.md section 6). A custom layer added just under
// "night-tint" (`map.addLayer(layer, "night-tint")`): it darkens terrain, roads and roofs, not the lights.
//
// One full-screen pass. Per pixel: the ground point (globe matrix: ray against the unit sphere; mercator matrix: ray
// against the z = 0 plane of a local metre frame, see frame.ts), moved toward the sun by height / tan(elevation), then
// the shared weather cube (cover, type) and two taps of the base noise volume (the two wind-drifted layers).
//
// Blending: the output is the multiplier `1 - a * (1 - dusk)` and is blended as DstColor / Zero (dst * src, the
// equivalent of premultiplied "darken toward dusk": dst * (1 - a) + dst * dusk * a). Destination alpha is kept
// (SrcAlpha Zero, DstAlpha One). MapLibre's own premultiplied ONE / ONE_MINUS_SRC_ALPHA would only let us lighten or
// paint over, and a multiplication keeps the paper's lightness structure intact.

export const SHADOW_LAYER_ID = "cloud-shadows";

export interface ShadowTimings {
  gpuMs: { n: number; mean: number; p95: number; max: number } | null;
  cpuMs: { n: number; mean: number; p95: number; max: number } | null;
}
// `boost` multiplies the darkening amount; 1 in production, raise it in the console to see the pattern clearly.
export type ShadowLayer = maplibregl.CustomLayerInterface & { stats: () => ShadowTimings; boost: number };

interface Opts {
  clock: ReadonlySignal<number>; // game minutes
  site: ReadonlySignal<CloudSite | null>;
}

const SNAP_M = 1000; // the local mercator frame origin snaps to this grid, so it stays put while the view pans
const LAT_HOLD_DEG = 2; // and the mercator scale is held until the centre moves this far in latitude

class Series {
  v: number[] = [];
  add(x: number) {
    this.v.push(x);
    if (this.v.length > 240) this.v.shift();
  }
  summary() {
    if (!this.v.length) return null;
    const s = [...this.v].sort((a, b) => a - b);
    const r = (x: number) => +x.toFixed(3);
    return { n: s.length, mean: r(s.reduce((a, b) => a + b, 0) / s.length), p95: r(s[Math.floor(s.length * 0.95)]), max: r(s[s.length - 1]) };
  }
}

export function createShadowLayer(map: maplibregl.Map, { clock, site }: Opts): ShadowLayer {
  let host: ThreeHost | null = null;
  let weather: WeatherTextureSource | null = null;
  let unsub: (() => void) | null = null;
  let unRestore: (() => void) | null = null;
  let scene: Scene | null = null;
  let material: ShaderMaterial | null = null;
  const camera = new Camera();
  let latHold = Number.NaN;
  const cpu = new Series();
  const gpu = new Series();
  let timer: { ext: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number }; pending: WebGLQuery[] } | null = null;

  const build = () => {
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    material = new ShaderMaterial({
      uniforms: {
        uInv: { value: new Matrix4() },
        uCam: { value: new Vector3() },
        uRayA: { value: new Vector3() },
        uRayB: { value: new Vector3() },
        uRayC: { value: new Vector3() },
        uCamC: { value: 0 },
        uMode: { value: 0 },
        uSun: { value: new Vector3() },
        uHeight: { value: 0 },
        tCubeA: { value: null },
        tCubeB: { value: null },
        uMix: { value: 0 },
        tBase: { value: null },
        uW: { value: new Vector2() },
        uTau: { value: new Vector2() },
        uOff0: { value: new Vector3() },
        uOff1: { value: new Vector3() },
        uDusk: { value: new Color(PALETTE.dusk) },
        uBoost: { value: 1 },
        uO: { value: new Vector3() },
        uE: { value: new Vector3() },
        uN: { value: new Vector3() },
        uSunOff: { value: new Vector2() },
        uSunMerc: { value: 0 },
        uF0: { value: new Vector3() },
        uE0: { value: new Vector3() },
        uN0: { value: new Vector3() },
        uF1: { value: new Vector3() },
        uE1: { value: new Vector3() },
        uN1: { value: new Vector3() },
      },
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: CustomBlending,
      blendSrc: DstColorFactor,
      blendDst: ZeroFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
    });
    scene = new Scene();
    scene.add(Object.assign(new Mesh(geo, material), { frustumCulled: false }));
  };

  const collect = (gl: WebGL2RenderingContext) => {
    if (!timer) return;
    const disjoint = gl.getParameter(timer.ext.GPU_DISJOINT_EXT);
    timer.pending = timer.pending.filter((q) => {
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true;
      if (!disjoint) gpu.add(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(q);
      return false;
    });
    if (timer.pending.length > 30) timer.pending.splice(0, 15);
  };

  // Mercator local frame: the origin (snapped, double precision) with its metre scale held while panning.
  const mercatorUniforms = (main: Float64Array, u: ShaderMaterial["uniforms"], sun: Vec3, ph: ReturnType<typeof driftPhases>, height: number): boolean => {
    const c = map.getCenter();
    if (!Number.isFinite(latHold) || Math.abs(c.lat - latHold) > LAT_HOLD_DEG) latHold = c.lat;
    const s0 = metresPerMercator(latHold);
    const cell = SNAP_M / s0;
    const m = lngLatToMercator(c.lng, c.lat);
    const origin: [number, number] = [Math.round(m[0] / cell) * cell, Math.round(m[1] / cell) * cell];
    const ll = mercatorToLngLat(origin[0], origin[1]);
    const frame = localFrame(ll.lng, ll.lat);
    const strength = sunStrength(sunLocal(sun, frame).sinElev);
    if (strength <= 0) return false;
    const inv = invert4(mercatorLocalMatrix(main, origin, s0));
    if (!inv) return false;
    const k = mercatorScaleK(ll.lat, latHold);
    const off = sunOffsetLocal(sun, frame, height);
    (u.uInv.value as Matrix4).fromArray(Float32Array.from(inv));
    (u.uSunOff.value as Vector2).set(off[0], off[1]);
    u.uSunMerc.value = strength;
    (u.uO.value as Vector3).set(...frame.o);
    (u.uE.value as Vector3).set(...(frame.e.map((x) => (x * k) / EARTH_RADIUS_M) as Vec3));
    (u.uN.value as Vector3).set(...(frame.n.map((x) => (x * k) / EARTH_RADIUS_M) as Vec3));
    // Noise coordinates: each layer is the frame rotated about the pole by its drift angle.
    const rot = DRIFT_DEG;
    for (let i = 0; i < 2; i++) {
      const ang = (-rot * ph[i].tau * Math.PI) / 180;
      const o = rotatePolar(frame.o, ang);
      const e = rotatePolar(frame.e, ang);
      const n = rotatePolar(frame.n, ang);
      const scale = EARTH_RADIUS_M / NOISE_TILE_M;
      const fr = (x: number, a: number) => (x * scale + a) % 1; // fraction in double: float32 keeps the metres
      const F = u[`uF${i}`].value as Vector3;
      F.set(fr(o[0], ph[i].off[0]), fr(o[1], ph[i].off[1]), fr(o[2], ph[i].off[2]));
      (u[`uE${i}`].value as Vector3).set(...(e.map((x) => (x * k) / NOISE_TILE_M) as Vec3));
      (u[`uN${i}`].value as Vector3).set(...(n.map((x) => (x * k) / NOISE_TILE_M) as Vec3));
    }
    return true;
  };

  const layer: ShadowLayer = {
    id: SHADOW_LAYER_ID,
    type: "custom",
    renderingMode: "2d",
    onAdd(_m, gl) {
      const g = gl as WebGL2RenderingContext;
      host = acquireHost(map, g);
      weather = acquireWeatherTextures(host);
      unsub = weather.subscribe(() => map.triggerRepaint());
      build();
      const ext = import.meta.env.DEV ? g.getExtension("EXT_disjoint_timer_query_webgl2") : null;
      timer = ext ? { ext: ext as unknown as NonNullable<typeof timer>["ext"], pending: [] } : null;
      unRestore = host.onRestore(() => build());
    },
    onRemove() {
      unsub?.();
      unRestore?.();
      weather?.release();
      host?.release();
      material?.dispose();
      host = weather = null;
      unsub = unRestore = null;
      scene = null;
      material = null;
    },
    render(gl, args) {
      const s = site.value;
      if (!host || !weather || !scene || !material || !s || !cloudsOn.value) return;
      const t0 = performance.now();
      const g = gl as WebGL2RenderingContext;
      const t = clock.value;
      const tex = weather.update(t, s, CUBE_SIZE[cloudQuality.value]);
      if (!tex || !tex.ready || !tex.base) return;
      const frame = host.frame(args.defaultProjectionData);
      const u = material.uniforms;
      const sun = weatherToSphere(sunDirection(t, s.phase));
      const days = t / DAY_MIN;
      const height = shadowHeight(map.getZoom());
      const globe = frame.transition > 0;
      const ph = driftPhases(days);
      (u.uW.value as Vector2).set(ph[0].w, ph[1].w);
      if (globe) {
        if (!frame.inv) return;
        const rb = rayBasis(frame.inv);
        if (!rb) return;
        (u.uCam.value as Vector3).set(...rb.cam);
        (u.uRayA.value as Vector3).set(...rb.a);
        (u.uRayB.value as Vector3).set(...rb.b);
        (u.uRayC.value as Vector3).set(...rb.c);
        u.uCamC.value = rb.cam[0] ** 2 + rb.cam[1] ** 2 + rb.cam[2] ** 2 - 1;
        (u.uTau.value as Vector2).set(ph[0].tau, ph[1].tau);
        (u.uOff0.value as Vector3).set(...ph[0].off);
        (u.uOff1.value as Vector3).set(...ph[1].off);
      } else {
        if (!mercatorUniforms(frame.main, u, sun, ph, height)) return;
      }
      u.uMode.value = globe ? 0 : 1;
      u.uBoost.value = layer.boost;
      (u.uSun.value as Vector3).set(...sun);
      u.uHeight.value = height;
      u.tCubeA.value = tex.cubeA;
      u.tCubeB.value = tex.cubeB;
      u.uMix.value = tex.mix;
      u.tBase.value = tex.base;
      collect(g);
      let q: WebGLQuery | null = null;
      if (timer && timer.pending.length < 30) {
        q = g.createQuery();
        if (q) g.beginQuery(timer.ext.TIME_ELAPSED_EXT, q);
      }
      host.draw((r) => r.render(scene!, camera));
      if (q && timer) {
        g.endQuery(timer.ext.TIME_ELAPSED_EXT);
        timer.pending.push(q);
      }
      cpu.add(performance.now() - t0);
    },
    stats: () => ({ gpuMs: gpu.summary(), cpuMs: cpu.summary() }),
    boost: 1,
  };
  return layer;
}
