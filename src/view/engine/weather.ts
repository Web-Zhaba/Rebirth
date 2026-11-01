import type { ReadonlySignal } from "@preact/signals";
import type { CameraView } from "../../engine/camera/camera";
import type { Engine } from "../../engine/engine";
import { enuAt, geodeticToEcef, WGS84_A, WGS84_B, type Vec3 } from "../../engine/geo/ellipsoid";
import { Clouds } from "../../engine/sky/clouds";
import { Precip, PRECIP_MAX } from "../../engine/scene/precip";
import { requestCube, requestNoise } from "../../map/clouds/cloudData";
import { cloudOpacity, MIN_OPACITY, needsMarch, PRESETS, smoothstep, targetSize, type MadeMarch } from "../../map/clouds/cloudQuality";
import { CLOUD_BASE_M, CLOUD_TOP_M, CUBE_SIZE, FADE_TAU_MS, GLOBE_EXAGGERATION, interval, REBUILD_MIN } from "../../map/clouds/constants";
import { activeFlashes, FLASH_MAX } from "../../map/clouds/lightning";
import { cloudQuality, cloudsOn, type CloudSite } from "../../map/clouds/settings";
import { DRIFT_DEG, driftPhases, shadowHeight } from "../../map/clouds/shadowMath";
import { STORM_MAX } from "../../map/clouds/weatherCube";
import { precipDensity, precipSlant, precipVisibility, snowOpacity, weatherCoverVisibility, WIND_DIR } from "../../map/weatherMath";
import { weatherMapOn } from "../../map/weatherSettings";
import { rgb } from "../../map/modelGeometry";
import { DAY_MIN } from "../../sim/time";
import { TUNING, type WeatherState } from "../../sim/weather";
import { frame } from "../../simClient";
import { MAP_ONLY, PALETTE, TREE_COLORS } from "../../ui/palette";
import { zoomAtMpp } from "../view";
import { townWeather, wetness, type WeatherOverride } from "./townWeather";

// The sky and weather of the game on the engine (docs/PLAN-engine.md N7): the weather cube pair and the noise volumes
// from the cloud worker (map/clouds/cloudData.ts) into the engine's weather textures, the per-frame weather uniform
// (drift of the shadow noise, the town's snow, wet ground and ice), and the cloud volume of the globe views with its
// zoom fade, march cache and lightning (the old cloud layer's decisions, map/clouds/cloudQuality.ts), and the rain or
// snow falling around the eye near the town (the old map/precipLayer.ts).

// Visual speed of the cloud noise drift relative to the sim wind (map/clouds/cloudLayer.ts DRIFT_SCALE).
const DRIFT_SCALE = 0.08;

export interface WeatherOptions {
  clock: ReadonlySignal<number>; // game minutes (the map's clock)
  site: ReadonlySignal<CloudSite | null>;
  weather?: ReadonlySignal<WeatherState | null>;
}

interface Slot {
  k: number; // interval held, NaN when empty
  key: string; // site and size it was built for
  loaded: boolean;
  storms: Float32Array;
}

const emptySlot = (): Slot => ({ k: Number.NaN, key: "", loaded: false, storms: new Float32Array(0) });
const srgb = (hex: string): Vec3 => rgb(hex) as Vec3;

export interface EngineWeather {
  clouds: Clouds;
  precip: Precip;
  override: WeatherOverride; // DEV
}

export function attachWeather(engine: Engine, o: WeatherOptions): EngineWeather {
  const gpu = engine.weather;
  const clouds = new Clouds(engine.device, engine.target, engine.frameU.layout, () => engine.frameU.bindGroup, gpu.detail);
  const precip = new Precip(engine.device, engine.target, engine.frameU.layout);
  const override: WeatherOverride = {};
  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const rainColour = srgb(PALETTE.info);
  const flakeColour = srgb(MAP_ONLY.snowSheet);
  let slots: [Slot, Slot] = [emptySlot(), emptySlot()];
  let noiseAsked = false;
  let made: MadeMarch | null = null;
  let fade = 0;
  let fadeAt = -1;
  const flashes = new Float32Array(FLASH_MAX * 4);
  const snowColour = srgb(TREE_COLORS.snow);
  const iceColour = srgb(PALETTE.mapIce);

  // Cube A holds interval k, cube B k + 1; shaders mix them so fronts glide between rebuilds (map/clouds/weatherTextures.ts).
  const fill = (which: 0 | 1, k: number, key: string, site: CloudSite, size: number) => {
    const slot = slots[which];
    slot.k = k;
    slot.key = key;
    slot.loaded = false;
    requestCube(k * REBUILD_MIN, site.seed, site.phase, size).then(
      (res) => {
        // The slot may have been swapped or refilled meanwhile: find the one still waiting for this cube.
        const i = slots.findIndex((s) => s.k === k && s.key === key && !s.loaded);
        if (i < 0 || gpu.cubeSize !== size) return;
        gpu.writeCube(i as 0 | 1, res.faces);
        slots[i].loaded = true;
        slots[i].storms = res.storms.cells.length ? Float32Array.from(res.storms.cells) : new Float32Array(0);
      },
      (e: unknown) => console.warn("cloud cube failed", e),
    );
  };

  const cubes = (t: number, site: CloudSite, size: number): { ready: boolean; mix: number; storms: Float32Array } => {
    if (gpu.cubeSize !== size) {
      gpu.resizeCubes(size);
      slots = [emptySlot(), emptySlot()];
    }
    if (!noiseAsked) {
      noiseAsked = true;
      requestNoise().then(
        (n) => gpu.writeNoise(n.base, n.detail),
        (e: unknown) => {
          noiseAsked = false;
          console.warn("cloud noise failed", e);
        },
      );
    }
    const { k, f } = interval(t);
    const key = `${site.seed}:${site.phase}:${size}`;
    const [a, b] = slots;
    if (a.key === key && b.key === key && a.k === k - 1 && b.k === k) {
      // Time moved on by one interval: B becomes A, the old A is refilled as the new B.
      slots = [b, a];
      gpu.swapCubes();
      fill(1, k + 1, key, site, size);
    } else {
      if (a.key !== key || a.k !== k) fill(0, k, key, site, size);
      if (slots[1].key !== key || slots[1].k !== k + 1) fill(1, k + 1, key, site, size);
    }
    const [sa, sb] = slots;
    const mix = sb.loaded ? f : 0;
    return { ready: sa.loaded && gpu.noiseReady, mix, storms: (mix >= 0.5 ? sb : sa).storms };
  };

  // A zoom jump (wheel tick, double click, fly-to) must not blink the deck: the fade follows its target.
  const easeFade = (target: number, now: number): number => {
    if (fadeAt < 0) fade = target;
    else {
      const dt = Math.min(Math.max(now - fadeAt, 0), 100);
      fade += (target - fade) * (1 - Math.exp(-dt / FADE_TAU_MS));
      if (Math.abs(target - fade) < 0.002) fade = target;
    }
    fadeAt = now;
    return fade;
  };

  // Lightning of this moment from the real-time schedule, only where it can be seen: on the camera's side of the
  // planet and not in full daylight.
  const strikes = (storms: Float32Array, cam: Vec3, sun: Vec3): number =>
    activeFlashes(storms, Math.min(STORM_MAX, storms.length / 4), Date.now() / 1000, flashes, (x, y, z) => {
      if (sun[0] * x + sun[1] * y + sun[2] * z > 0.3) return false;
      return cam[0] * x + cam[1] * y + cam[2] * z > 0.85;
    });

  const update = (view: CameraView) => {
    const now = performance.now();
    const t = o.clock.peek();
    const site = o.site.peek();
    const zoom = zoomAtMpp(engine.metersPerPixel());
    const quality = cloudQuality.peek(); // WebGPU always renders to rgba16float: no step down
    const on = cloudsOn.peek() && !!site;
    const c = on && site ? cubes(t, site, CUBE_SIZE[quality]) : null;
    const ph = driftPhases(t / DAY_MIN);
    const tw = weatherMapOn.peek() ? townWeather(o.weather?.peek(), override) : null;
    const tf = frame.peek();
    let town = null;
    if (tf) {
      const [lng0, lat0] = tf.toLngLat(0, 0);
      const origin = geodeticToEcef(lat0, lng0, 0);
      const { east, north } = enuAt(lat0, lng0);
      town = { eye: [view.eye[0] - origin[0], view.eye[1] - origin[1], view.eye[2] - origin[2]] as Vec3, east, north };
    }
    const sunE = engine.light(engine.state).sun;
    gpu.write({
      weights: [ph[0].w, ph[1].w],
      ages: [ph[0].tau, ph[1].tau],
      offsets: [ph[0].off, ph[1].off],
      mix: c?.mix ?? 0,
      shadows: !!c?.ready,
      wind: [TUNING.windDeg * DRIFT_SCALE, TUNING.tradeDeg * DRIFT_SCALE, TUNING.layerDays],
      days: t / DAY_MIN,
      castHeight: shadowHeight(zoom),
      shadowDrift: DRIFT_DEG,
      snow: tw ? snowOpacity(tw.snowpack) / snowOpacity(1) : 0,
      wet: tw ? wetness(tw.precip, tw.snowing, tw.soil) : 0,
      ice: tw?.ice ?? 0,
      town,
      groundFade: weatherCoverVisibility(zoom),
      snowColour,
      iceColour,
    });

    // Rain and snow: the town's weather, at town scale.
    const density = tw && !reducedMotion ? precipDensity(tw.precip) : 0;
    const shown = density * precipVisibility(zoom);
    if (tw && shown > 0.01) {
      const slant = precipSlant(tw.wind) * (tw.snowing ? 0.5 : 1);
      const { up } = enuAt(engine.state.lat, engine.state.lng);
      const daylight = Math.min(1, Math.max(0, (up[0] * sunE[0] + up[1] * sunE[1] + up[2] * sunE[2] + 0.12) / 0.32));
      const colour = (tw.snowing ? flakeColour : rainColour).map((c) => c * (0.35 + 0.65 * daylight)) as Vec3;
      precip.look = {
        count: Math.max(1, PRECIP_MAX * density),
        box: Math.min(1500, Math.max(20, engine.state.distance * 0.8)),
        snow: tw.snowing,
        opacity: (tw.snowing ? 0.8 : 0.5) * (0.35 + 0.65 * density) * precipVisibility(zoom),
        drift: [WIND_DIR[0] * slant, WIND_DIR[1] * slant],
        colour,
        time: now / 1000,
      };
    } else precip.look = null;

    // The cloud volume: far globe views only.
    const f = easeFade(c?.ready ? cloudOpacity(zoom) : 0, now);
    if (!c?.ready || f <= MIN_OPACITY) {
      clouds.pass = null;
      made = null;
      clouds.forget();
      return;
    }
    const preset = PRESETS[quality];
    const sun: Vec3 = [sunE[1], sunE[2], sunE[0]];
    const cam: Vec3 = [view.eye[1] / WGS84_A, view.eye[2] / WGS84_B, view.eye[0] / WGS84_A];
    const flashCount = strikes(c.storms, cam, sun);
    const size = targetSize(engine.canvas.width, engine.canvas.height, preset.scale);
    const key = {
      matrix: [...view.viewProj, ...view.eye],
      width: size.width,
      height: size.height,
      clock: t,
      fade: Math.round(f * 256) / 256, // the dissolve depends on the fade; 1/256 is invisible
      version: gpu.version,
      quality,
      generation: 0,
      flash: flashCount > 0,
    };
    const march = needsMarch(made, key, flashCount > 0, now);
    if (march) made = { ...key, matrix: Float64Array.from(key.matrix), at: now };
    clouds.pass = {
      rBase: 1 + (CLOUD_BASE_M * GLOBE_EXAGGERATION) / WGS84_A,
      rTop: 1 + (CLOUD_TOP_M * GLOBE_EXAGGERATION) / WGS84_A,
      fade: f,
      orbit: 1 - smoothstep(2.6, 3.4, zoom),
      steps: preset.steps,
      lightSteps: preset.lightSteps,
      detail: preset.detail,
      scale: preset.scale,
      flashes,
      flashCount,
      march,
    };
  };

  // The uniform writer goes first, so the cloud pass it decides is there for the clouds' own update.
  engine.drawables.push({ update, draw: () => {} }, precip, clouds);
  if (import.meta.env.DEV) Object.assign(window, { engineWeather: { override, clouds, info: () => ({ slots: slots.map((s) => ({ k: s.k, loaded: s.loaded })), fade, marches: clouds.marches }) } });
  return { clouds, precip, override };
}
