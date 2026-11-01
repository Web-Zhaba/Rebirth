import { computed, effect, signal, type ReadonlySignal } from "@preact/signals";
import { calendar } from "../../sim/clock";
import type { WeatherState } from "../../sim/weather";
import { frame } from "../../simClient";
import { TREE_COLORS } from "../../ui/palette";
import type { Frame } from "../../world/frame";
import type { Engine } from "../../engine/engine";
import { enuAt, geodeticToEcef } from "../../engine/geo/ellipsoid";
import { TOWN_VERTEX_FLOATS, TownMesh, type TownMeshData } from "../../engine/scene/townMesh";
import { EXAGGERATION } from "../../engine/terrain/terrain";
import { sunStrength } from "../../map/clouds/shadowMath";
import { lightOpacity } from "../../map/lifeLayer";
import { rgb, type Model } from "../../map/modelGeometry";
import { coverOf, demoModelItems, keyOf, lampOf, modelEmitters, quantise, seatedModelOf, type Emitter, type ModelItem } from "../../map/modelItems";
import { snowOpacity } from "../../map/weatherMath";
import { weatherMapOn } from "../../map/weatherSettings";
import { buildingItems } from "../layers/buildings";
import { roadItems } from "../layers/roads";

// The town's buildings and built roads on the engine (scene/townMesh.ts), from the same items and model builders as the
// old three.js layer (map/modelItems.ts): each item's model is seated on the engine's ground, projected once into the
// origin's east/north/up frame in float64 and cached by everything that shapes it; a change of the list re-projects
// only the changed items. Lighting, snow and the window lights follow the game clock and weather every frame.

const FALLBACK_LIGHT: [number, number, number] = [-0.45, -0.55, 0.7];
const RETRY_FRAMES = 20; // while the ground under the town is still streaming, look again this often

interface Pack {
  v: Float32Array; // TOWN_VERTEX_FLOATS per vertex
  i: Uint32Array;
  smoke: [number, number, number][];
}

const norm = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

export interface ModelOptions {
  light?: { clock: ReadonlySignal<number> };
  weather?: ReadonlySignal<WeatherState | null>;
  debug?: boolean; // every model kind instead of the town (map/modelItems.ts demoModelItems)
}

export function attachModels(engine: Engine, opts: ModelOptions): void {
  const mesh = new TownMesh(engine.device, engine.target, engine.frameU.layout);
  engine.drawables.push(mesh);
  const items: ReadonlySignal<ModelItem[]> = opts.debug ? signal(demoModelItems()) : computed(() => [...buildingItems.value, ...roadItems.value]);
  if (opts.debug && import.meta.env.DEV) Object.assign(window, { modelItems: items });
  const cache = new Map<string, Pack>();
  let originKey = "";
  let dirty = true;
  let wait = 0;

  effect(() => {
    void items.value;
    void frame.value;
    dirty = true;
  });

  const rebuild = (tf: Frame) => {
    const [lng0, lat0] = tf.toLngLat(0, 0);
    const key = `${lng0},${lat0}`;
    if (key !== originKey) {
      originKey = key;
      cache.clear();
      mesh.setOrigin(lat0, lng0);
    }
    const list = items.peek();
    // The ground under every item must be there first (the last meshes stay meanwhile).
    const ground = (x: number, y: number) => {
      const [a, b] = tf.toLngLat(x, y);
      return engine.groundAt(b, a);
    };
    if (coverOf(list).some(([x, y]) => ground(x, y) === null)) return false;
    const o = geodeticToEcef(lat0, lng0, 0);
    const { east, north, up } = enuAt(lat0, lng0);
    const project = (m: Model, lamp: number): Pack => {
      const p = m.positions;
      const n = p.length / 3;
      const v = new Float32Array(n * TOWN_VERTEX_FLOATS);
      for (let k = 0; k < n; k++) {
        const [lng, lat] = tf.toLngLat(p[k * 3], p[k * 3 + 1]);
        const e = geodeticToEcef(lat, lng, p[k * 3 + 2]);
        const dx = e[0] - o[0];
        const dy = e[1] - o[1];
        const dz = e[2] - o[2];
        const at = k * TOWN_VERTEX_FLOATS;
        v[at] = dx * east[0] + dy * east[1] + dz * east[2];
        v[at + 1] = dx * north[0] + dy * north[1] + dz * north[2];
        v[at + 2] = dx * up[0] + dy * up[1] + dz * up[2];
        v.set(m.normals.slice(k * 3, k * 3 + 3), at + 3);
        v.set(m.colors.slice(k * 3, k * 3 + 3), at + 6);
        v.set(m.facade.slice(k * 4, k * 4 + 4), at + 9);
        v[at + 13] = p[k * 3 + 2] - (m.lift?.[k] ?? 0);
        v[at + 14] = lamp;
      }
      return { v, i: Uint32Array.from(m.indices), smoke: m.smoke ?? [] };
    };
    const used = new Set<string>();
    const roads: Pack[] = [];
    const buildings: Pack[] = [];
    const smoke: Emitter[] = [];
    const seat = (x: number, y: number) => ground(x, y) ?? 0;
    for (const it of list) {
      const onRoad = it.style === "road" || it.style === "junction";
      const p = it.style === "road" ? 1 : quantise(it.progress);
      const k = keyOf(it, p, EXAGGERATION);
      used.add(k);
      let pack = cache.get(k);
      if (!pack) cache.set(k, (pack = project(seatedModelOf({ ...it, progress: p }, seat), p >= 1 ? lampOf(it) : 0)));
      (onRoad ? roads : buildings).push(pack);
      for (const [x, y, z] of pack.smoke) smoke.push({ id: it.id, kind: it.kind, style: it.style, lamp: it.lamp, x, y, z });
    }
    for (const k of [...cache.keys()]) if (!used.has(k)) cache.delete(k);
    mesh.setMeshes(merge(roads), merge(buildings));
    modelEmitters.value = smoke;
    return true;
  };

  const snowCol = rgb(TREE_COLORS.snow);
  engine.onBeforeFrame(() => {
    const tf = frame.peek();
    if (tf && dirty && wait-- <= 0) {
      if (rebuild(tf)) dirty = false;
      else wait = RETRY_FRAMES;
    }
    // Light: the engine's sun in the town frame, blended towards a fixed light as it sets (the old layer's look).
    const sun = mesh.toLocal(engine.light(engine.state).sun);
    const strength = sunStrength(sun[2]);
    const fb = norm(FALLBACK_LIGHT);
    const d = norm([sun[0], sun[1], Math.max(sun[2], 0.05)]);
    const light = norm([fb[0] + (d[0] - fb[0]) * strength, fb[1] + (d[1] - fb[1]) * strength, fb[2] + (d[2] - fb[2]) * strength]);
    const w = opts.weather?.peek();
    const clock = opts.light?.clock.peek();
    const cal = clock === undefined ? null : calendar(clock);
    const hour = cal ? cal.hour + cal.minute / 60 : 12;
    mesh.look = {
      sunStrength: strength,
      light,
      snow: weatherMapOn.peek() && w ? snowOpacity(w.snowpack) / snowOpacity(1) : 0,
      daylight: Math.min(1, Math.max(0, (sun[2] + 0.12) / 0.32)), // the terrain's terminator (atmosphere.wgsl sunLightAt)
      lamps: cal ? [lightOpacity("house", hour), lightOpacity("work", hour), lightOpacity("tavern", hour)] : [0, 0, 0],
      snowColour: snowCol,
    };
  });
}

function merge(list: readonly Pack[]): TownMeshData {
  let nv = 0;
  let ni = 0;
  for (const p of list) (nv += p.v.length / TOWN_VERTEX_FLOATS), (ni += p.i.length);
  const vertices = new Float32Array(nv * TOWN_VERTEX_FLOATS);
  const indices = new Uint32Array(ni);
  let v = 0;
  let k = 0;
  for (const p of list) {
    vertices.set(p.v, v * TOWN_VERTEX_FLOATS);
    for (let j = 0; j < p.i.length; j++) indices[k + j] = p.i[j] + v;
    v += p.v.length / TOWN_VERTEX_FLOATS;
    k += p.i.length;
  }
  return { vertices, indices };
}
