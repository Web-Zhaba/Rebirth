import { effect, type ReadonlySignal } from "@preact/signals";
import type { Engine } from "../../engine/engine";
import { dot, enuAt, geodeticToEcef, type Vec3 } from "../../engine/geo/ellipsoid";
import { Smoke } from "../../engine/scene/smoke";
import { calendar } from "../../sim/clock";
import type { WeatherState } from "../../sim/weather";
import { frame } from "../../simClient";
import { sunStrength } from "../../map/clouds/shadowMath";
import { motionTime, smoke3dOn } from "../../map/graphicsSettings";
import { modelEmitters } from "../../map/modelItems";
import { smokeKindOf, smokeStrength, type SmokeKind } from "../../map/smokeMath";
import { WIND_DIR } from "../../map/weatherMath";
import { mppAtZoom } from "../view";

// Smoke from the chimneys of lived-in houses and working shops on the engine (scene/smoke.ts), with the old layer's
// rules (map/smokeMath.ts: which chimneys smoke and how hard by kind, cold, hour and rain) and its look and gates.

const SMOKE_MPP = mppAtZoom(15);
const FAR = 900; // m
const KIND: Record<SmokeKind, number> = { home: 0, furnace: 1, tavern: 2 };
const SIZE: Record<SmokeKind, number> = { home: 1, furnace: 1.35, tavern: 1.15 }; // puff size, m

const hashOf = (x: number, y: number) => {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return h - Math.floor(h);
};

export interface SmokeOptions {
  clock?: ReadonlySignal<number>;
  weather?: ReadonlySignal<WeatherState | null>;
}

export function attachSmoke(engine: Engine, o: SmokeOptions): void {
  const smoke = new Smoke(engine.device, engine.target, engine.frameU.layout);
  engine.drawables.push(smoke);
  let up: Vec3 = [0, 0, 1];

  // Chimneys (town metres, from the model builders) into the town origin's east/north/up frame, in f64.
  effect(() => {
    const tf = frame.value;
    const list = modelEmitters.value;
    if (!tf) return;
    const [lng0, lat0] = tf.toLngLat(0, 0);
    const origin = geodeticToEcef(lat0, lng0, 0);
    const axes = enuAt(lat0, lng0);
    up = axes.up;
    const out: number[] = [];
    for (const e of list) {
      const kind = smokeKindOf(e);
      if (!kind) continue;
      const [lng, lat] = tf.toLngLat(e.x, e.y);
      const p = geodeticToEcef(lat, lng, e.z);
      const d: Vec3 = [p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]];
      out.push(dot(d, axes.east), dot(d, axes.north), dot(d, axes.up), KIND[kind], hashOf(e.x, e.y), SIZE[kind]);
    }
    smoke.setChimneys(lat0, lng0, new Float32Array(out));
  });

  engine.onBeforeFrame(() => {
    if (!smoke3dOn.peek() || !frame.peek() || engine.metersPerPixel() > SMOKE_MPP) {
      smoke.look = null;
      return;
    }
    const w = o.weather?.peek();
    const cal = calendar(o.clock?.peek() ?? 0);
    const hour = cal.hour + cal.minute / 60;
    const temp = w?.now.temp ?? 10;
    const precip = w?.now.precip ?? 0;
    const sun = engine.light(engine.state).sun;
    const el = dot(sun, up);
    smoke.look = {
      strength: [smokeStrength("home", temp, hour, precip), smokeStrength("furnace", temp, hour, precip), smokeStrength("tavern", temp, hour, precip)],
      time: motionTime(),
      wind: [WIND_DIR[0], WIND_DIR[1], w?.now.wind ?? 2],
      sunStrength: sunStrength(el),
      daylight: Math.min(1, Math.max(0, (el + 0.12) / 0.32)), // the terrain's terminator, as the models
      far: FAR,
    };
  });
}
