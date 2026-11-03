import { computed, effect, signal, type ReadonlySignal } from "@preact/signals";
import { calendar } from "../../sim/clock";
import { frame } from "../../simClient";
import type { Frame } from "../../world/frame";
import type { Engine } from "../../engine/engine";
import { enuAt, geodeticToEcef } from "../../engine/geo/ellipsoid";
import { TOWN_VERTEX_FLOATS, TownMesh, type TownMeshData } from "../../engine/scene/townMesh";
import { EXAGGERATION } from "../../engine/terrain/terrain";
import { lightOpacity } from "../../map/life";
import type { Model } from "../../map/modelGeometry";
import { coverOf, demoModelItems, keyOf, lampOf, modelEmitters, quantise, seatedModelOf, type Emitter, type ModelItem } from "../../map/modelItems";
import { ruinWallModel } from "../../map/ruinsGeometry";
import { buildingItems } from "../layers/buildings";
import { roadItems } from "../layers/roads";
import { ruinWallPieces } from "../layers/ruins";
import { ruinsAutoShown, ruinsShown } from "../ruinsShown";
import { mppAtZoom } from "../view";
import { GroundSeat } from "./groundSeat";
import { townLight } from "./townLight";

// The town's buildings and built roads on the engine (scene/townMesh.ts), from the same items and model builders as the
// old three.js layer (map/modelItems.ts): each item's model is seated on the engine's ground, projected once into the
// origin's east/north/up frame in float64 and cached by everything that shapes it; a change of the list re-projects
// only the changed items. Lighting and the window lights follow the game clock every frame; the weather on them is the
// engine's (sky/weather.wgsl).

const RETRY_FRAMES = 20; // while the ground under the town is still streaming, look again this often
const RUIN_WALL_MPP = mppAtZoom(14); // the old walls' extrusion minzoom
const RUIN_CHUNK = 2000; // wall pieces built at a time
const RUIN_BUDGET_MS = 6; // of a frame spent building the walls: a large old city has 100k pieces, over a second's work

interface Pack {
  v: Float32Array; // TOWN_VERTEX_FLOATS per vertex
  i: Uint32Array;
  smoke: [number, number, number][];
}

export interface ModelOptions {
  light?: { clock: ReadonlySignal<number> };
  debug?: boolean; // every model kind instead of the town (map/modelItems.ts demoModelItems)
}

export function attachModels(engine: Engine, opts: ModelOptions): TownMesh {
  const mesh = new TownMesh(engine.device, engine.target, engine.frameU.layout);
  engine.drawables.push(mesh);
  const items: ReadonlySignal<ModelItem[]> = opts.debug ? signal(demoModelItems()) : computed(() => [...buildingItems.value, ...roadItems.value]);
  if (opts.debug && import.meta.env.DEV) Object.assign(window, { modelItems: items });
  const cache = new Map<string, Pack>();
  let originKey = "";
  let dirty = true;
  let wait = 0;
  let ruinsDirty = true;
  let ruinsWait = 0;
  let ruinsJob: { tf: Frame; pieces: { quad: [number, number][]; h: number }[]; at: number; packs: Pack[]; frames: number } | null = null;
  const seat = new GroundSeat(engine);
  const ruinsSeat = new GroundSeat(engine);

  effect(() => {
    void items.value;
    void frame.value;
    dirty = true;
  });
  effect(() => {
    void ruinWallPieces.value;
    void frame.value;
    ruinsDirty = true;
  });

  // The old city's broken walls: a model of every piece, rebuilt when the revealed old world changes. Built only while
  // they are shown and only on the final ground (one build, not one per page as the ground sharpens), a slice per frame.
  const startRuins = (tf: Frame) => {
    const list = ruinWallPieces.peek();
    ruinsSeat.cover(coverOf(list).map(([x, y]) => latLng(tf, x, y)));
    if (!ruinsSeat.settled()) return false;
    ruinsJob = { tf, pieces: list.flatMap((f) => f.pieces ?? []), at: 0, packs: [], frames: 0 };
    return true;
  };
  const stepRuins = () => {
    const job = ruinsJob!;
    const { tf, pieces } = job;
    const ground = (x: number, y: number) => {
      const [a, b] = tf.toLngLat(x, y);
      return engine.groundAt(b, a) ?? 0;
    };
    const project = projector(tf);
    const t0 = performance.now();
    while (job.at < pieces.length && performance.now() - t0 < RUIN_BUDGET_MS) {
      job.packs.push(project(ruinWallModel(pieces.slice(job.at, job.at + RUIN_CHUNK), ground), 0));
      job.at += RUIN_CHUNK;
    }
    job.frames++;
    if (job.at < pieces.length) return;
    const t1 = performance.now();
    mesh.setRuins(merge(job.packs));
    ruinsSeat.seated();
    ruinsJob = null;
    const ms = performance.now() - t1;
    if (import.meta.env.DEV && pieces.length > 10_000) console.info(`[models] ruins: ${pieces.length} pieces over ${job.frames} frames, last one ${Math.round(ms)} ms`);
  };

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
    const cover = coverOf(list);
    if (cover.some(([x, y]) => ground(x, y) === null)) return false;
    seat.cover(cover.map(([x, y]) => latLng(tf, x, y)));
    const finer = seat.finer();
    if (finer) cache.clear(); // the cached models sit on coarser ground than has come since
    const t0 = performance.now();
    let built = 0;
    seat.seated();
    const project = projector(tf);
    const used = new Set<string>();
    const roads: Pack[] = [];
    const buildings: Pack[] = [];
    const smoke: Emitter[] = [];
    const seatAt = (x: number, y: number) => ground(x, y) ?? 0;
    for (const it of list) {
      const onRoad = it.style === "road" || it.style === "junction";
      const p = it.style === "road" ? 1 : quantise(it.progress);
      const k = keyOf(it, p, EXAGGERATION);
      used.add(k);
      let pack = cache.get(k);
      if (!pack) cache.set(k, (pack = project(seatedModelOf({ ...it, progress: p }, seatAt), p >= 1 ? lampOf(it) : 0))), built++;
      (onRoad ? roads : buildings).push(pack);
      for (const [x, y, z] of pack.smoke) smoke.push({ id: it.id, kind: it.kind, style: it.style, lamp: it.lamp, x, y, z });
    }
    for (const k of [...cache.keys()]) if (!used.has(k)) cache.delete(k);
    mesh.setMeshes(merge(roads), merge(buildings));
    modelEmitters.value = smoke;
    const ms = performance.now() - t0;
    if (import.meta.env.DEV && ms > 100) console.info(`[models] rebuilt ${built} of ${list.length} in ${Math.round(ms)} ms${finer ? " (finer ground)" : ""}`);
    return true;
  };

  engine.onBeforeFrame(() => {
    const tf = frame.peek();
    // Finer ground under the town than it was seated on (pages still streaming at the first build): seat it again.
    if (!dirty && wait-- <= 0) {
      wait = RETRY_FRAMES;
      if (seat.finer()) (dirty = true), (wait = 0);
    }
    if (!ruinsDirty && ruinsWait-- <= 0) {
      ruinsWait = RETRY_FRAMES;
      if (ruinsSeat.finer()) (ruinsDirty = true), (ruinsWait = 0);
    }
    if (tf && dirty && wait-- <= 0) {
      if (rebuild(tf)) dirty = false;
      else wait = RETRY_FRAMES;
    }
    const s = engine.state;
    const mpp = (2 * s.distance * Math.tan((s.fovY * Math.PI) / 360)) / Math.max(1, engine.canvas.clientHeight);
    mesh.ruinsShown = (ruinsShown.peek() || ruinsAutoShown.peek()) && mpp <= RUIN_WALL_MPP;
    if (tf && mesh.ruinsShown && ruinsDirty && ruinsWait-- <= 0) {
      if (startRuins(tf)) ruinsDirty = false;
      else ruinsWait = RETRY_FRAMES;
    }
    if (ruinsJob && mesh.ruinsShown) stepRuins();
    // Light: the engine's sun in the town frame, blended towards a fixed light as it sets (the old layer's look).
    const { light, strength, daylight } = townLight(mesh.toLocal(engine.light(engine.state).sun));
    const clock = opts.light?.clock.peek();
    const cal = clock === undefined ? null : calendar(clock);
    const hour = cal ? cal.hour + cal.minute / 60 : 12;
    mesh.look = {
      sunStrength: strength,
      light,
      daylight,
      lamps: cal ? [lightOpacity("house", hour), lightOpacity("work", hour), lightOpacity("tavern", hour)] : [0, 0, 0],
    };
  });
  return mesh;
}

// Model in town metres -> vertices in the origin's east/north/up frame (f64 maths, stored f32).
function projector(tf: Frame): (m: Model, lamp: number) => Pack {
  const [lng0, lat0] = tf.toLngLat(0, 0);
  const o = geodeticToEcef(lat0, lng0, 0);
  const { east, north, up } = enuAt(lat0, lng0);
  return (m: Model, lamp: number): Pack => {
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
      for (let j = 0; j < 3; j++) (v[at + 3 + j] = m.normals[k * 3 + j]), (v[at + 6 + j] = m.colors[k * 3 + j]);
      for (let j = 0; j < 4; j++) v[at + 9 + j] = m.facade[k * 4 + j];
      v[at + 13] = p[k * 3 + 2] - (m.lift?.[k] ?? 0);
      v[at + 14] = lamp;
    }
    return { v, i: Uint32Array.from(m.indices), smoke: m.smoke ?? [] };
  };
}

function latLng(tf: Frame, x: number, y: number): [number, number] {
  const [lng, lat] = tf.toLngLat(x, y);
  return [lat, lng];
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
