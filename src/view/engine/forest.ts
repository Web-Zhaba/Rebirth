import { computed, effect, type ReadonlySignal } from "@preact/signals";
import { calendar } from "../../sim/clock";
import { ROAD_KINDS } from "../../sim/roads";
import type { WeatherState } from "../../sim/weather";
import { buildings, frame, roads, state, zones } from "../../simClient";
import { TREE_COLORS } from "../../ui/palette";
import type { Frame } from "../../world/frame";
import { latToMy, lngToMx } from "../../engine/geo/mercator";
import type { Engine } from "../../engine/engine";
import { enuAt, type Vec3 } from "../../engine/geo/ellipsoid";
import { Forest, type ForestKind, type ForestMask } from "../../engine/scene/forest";
import { sunStrength } from "../../map/clouds/shadowMath";
import { oldWorld } from "../../map/excavation";
import { forest3dOn, motionTime } from "../../map/graphicsSettings";
import { rgb } from "../../map/modelGeometry";
import { buildTree, crownAt, KIND_INFO, leafOf, reedAt } from "../../map/treeModels";
import { TREE_KINDS, TREES_FROM_ZOOM } from "../../map/treeScatter";
import { WIND_DIR } from "../../map/weatherMath";
import { ruinsShown } from "../ruinsShown";
import { mppAtZoom } from "../view";

// The forest on the engine (engine/scene/forest.ts): the old tree layer's models, look and rules, grown on the GPU
// from the land cover. The game's side is the mask of what keeps the forest away (lots, roads, zones and fields, a
// clearing as far as it is cut; ruins add bushes and stones), rasterised over the town into a square of web mercator
// whenever those change, and the look of each frame (sun, night, season, snow, wind).

const GROW_ZOOMS = 1; // the trees grow in over a zoom from TREES_FROM_ZOOM (the old layer's GROW_TO)
const WIND_FULL = 14;
const MASK_M = 2; // m per mask texel
const MASK_MAX = 2048;
const MARGIN = 10; // m around the mask's content
const PROGRESS_STEPS = 10;
const FALLBACK_LIGHT: Vec3 = [-0.45, -0.55, 0.7]; // view/engine/models.ts: the light as the sun sets

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const lerp3 = (a: number[], b: number[], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export interface ForestOptions {
  clock?: ReadonlySignal<number>;
  weather?: ReadonlySignal<WeatherState | null>;
  snow?: () => number; // 0..1 snow on the trees where the camera looks (view/engine/weather.ts); the town's otherwise
}

export function attachForest(engine: Engine, o: ForestOptions): Forest {
  const models = TREE_KINDS.map((k) => buildTree(k, 0));
  const kinds: ForestKind[] = TREE_KINDS.map((k) => {
    const info = KIND_INFO[k];
    return { tall: info.tall, season: info.season === "leaf" ? 1 : info.season === "reed" ? 2 : 0, sway: info.sway, leaf: rgb(leafOf(k)) as [number, number, number] };
  });
  const forest = new Forest(engine.device, engine.target, engine.frameU.layout, engine.terrain, engine.hiz, models, kinds);
  engine.drawables.push(forest);
  if (import.meta.env.DEV) Object.assign(window, { forest });

  // The mask: rebuilt (on the next frame) when anything that shapes it changes.
  const ruins = computed(() => (ruinsShown.value ? (oldWorld.value?.foundations ?? null) : null));
  let dirty = true;
  effect(() => {
    void frame.value;
    void buildings.value;
    void roads.value;
    void zones.value;
    void clearingSteps.value;
    void ruins.value;
    dirty = true;
  });

  const bare = rgb(TREE_COLORS.bare) as [number, number, number];
  const snowColour = rgb(TREE_COLORS.snow) as [number, number, number];
  engine.onBeforeFrame(() => {
    if (dirty) {
      dirty = false;
      const tf = frame.peek();
      forest.setMask(tf ? buildMask(tf, ruins.peek()) : null);
    }
    const s = engine.state;
    const zoom = Math.log2(mppAtZoom(0, s.lat) / engine.metersPerPixel());
    const g = Math.min(1, Math.max(0, (zoom - TREES_FROM_ZOOM) / GROW_ZOOMS));
    forest.grow = forest3dOn.peek() ? g * g * (3 - 2 * g) : 0; // off in the settings: the drape's forest colour alone
    if (forest.grow <= 0) return;

    // Light: the engine's sun in the target's frame, blended towards a fixed light as it sets (as the town's models).
    const e = enuAt(s.lat, s.lng);
    const sunE = engine.light(s).sun;
    const sun: Vec3 = [0, 1, 2].map((i) => [e.east, e.north, e.up][i].reduce((a, v, k) => a + v * sunE[k], 0)) as Vec3;
    const strength = sunStrength(sun[2]);
    const fb = norm(FALLBACK_LIGHT);
    const d = norm([sun[0], sun[1], Math.max(sun[2], 0.05)]);
    const clock = o.clock?.peek() ?? 0;
    const crown = crownAt(clock);
    const reed = reedAt(clock);
    const w = o.weather?.peek();
    const snow = o.snow ? o.snow() : Math.min(1, (w?.snowpack ?? 0) / 0.05);
    const leafA = lerp3(rgb(crown.a), rgb(crown.b), crown.t);
    const leafB = rgb(crown.b) as [number, number, number];
    const reedA = lerp3(rgb(reed.a), rgb(reed.b), reed.t);
    const reedB = rgb(reed.b) as [number, number, number];
    forest.look = {
      light: norm([fb[0] + (d[0] - fb[0]) * strength, fb[1] + (d[1] - fb[1]) * strength, fb[2] + (d[2] - fb[2]) * strength]),
      sunStrength: strength,
      daylight: Math.min(1, Math.max(0, (sun[2] + 0.12) / 0.32)),
      time: motionTime(),
      wind: Math.min(1, (w?.now.wind ?? 2) / WIND_FULL),
      windDir: WIND_DIR,
      bare,
      snowColour,
      kinds: kinds.map((k) =>
        k.season === 1
          ? { colA: leafA, colB: leafB, bare: crown.bare, snow: snow * crown.bare * 0.6 }
          : k.season === 2
            ? { colA: reedA, colB: reedB, bare: 0, snow: snow * 0.4 }
            : { colA: k.leaf, colB: k.leaf, bare: 0, snow },
      ),
    };
  });
  return forest;
}

// The clearings' progress in steps, so cutting a tree does not redraw the mask every tick.
const clearingSteps = computed(() => (state.value?.clearings ?? []).map((c) => `${c.id}:${Math.floor((c.done / Math.max(c.labor, 1e-9)) * PROGRESS_STEPS)}`).join(","));

type Box = [number, number, number, number];

// The mask over the town (town metres, y north), or null when nothing in the town keeps the forest away.
function buildMask(tf: Frame, ruins: readonly { ring: [number, number][] }[] | null): ForestMask | null {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  const grow = (x: number, y: number, r: number) => {
    box[0] = Math.min(box[0], x - r);
    box[1] = Math.min(box[1], y - r);
    box[2] = Math.max(box[2], x + r);
    box[3] = Math.max(box[3], y + r);
  };
  const lots = Object.values(buildings.peek() ?? {}).map((b) => ({ x: b.lot.cx, y: b.lot.cy, r: Math.hypot(b.lot.w, b.lot.d) / 2 + 2 }));
  const g = roads.peek();
  const lines: { a: [number, number]; b: [number, number]; w: number }[] = [];
  if (g)
    for (const e of Object.values(g.edges)) {
      const a = g.nodes[e.a];
      const b = g.nodes[e.b];
      if (a && b) lines.push({ a: [a.x, a.y], b: [b.x, b.y], w: (ROAD_KINDS[e.kind]?.width ?? 3) + 4 });
    }
  const z = zones.peek();
  const cells = (z?.cells ?? []).filter((c) => c.zone !== "none").map((c) => ({ x: c.cx, y: c.cy, r: 6 }));
  const polys = [
    ...(z?.fields ?? []).map((f) => ({ pts: f.pts, share: 1 })),
    ...(state.peek()?.clearings ?? []).map((c) => ({ pts: c.pts, share: Math.floor((c.done / Math.max(c.labor, 1e-9)) * PROGRESS_STEPS) / PROGRESS_STEPS })),
  ].filter((p) => p.share > 0 && p.pts.length > 2);
  const rings = (ruins ?? []).map((f) => f.ring).filter((r) => r.length > 2);
  for (const c of [...lots, ...cells]) grow(c.x, c.y, c.r);
  for (const l of lines) (grow(l.a[0], l.a[1], l.w / 2), grow(l.b[0], l.b[1], l.w / 2));
  for (const p of [...polys.map((q) => q.pts), ...rings]) for (const [x, y] of p) grow(x, y, 0);
  if (!(box[0] <= box[2])) return null;
  box[0] -= MARGIN;
  box[1] -= MARGIN;
  box[2] += MARGIN;
  box[3] += MARGIN;

  const wm = box[2] - box[0];
  const hm = box[3] - box[1];
  const k = Math.min(1 / MASK_M, MASK_MAX / wm, MASK_MAX / hm); // px per m
  const width = Math.max(1, Math.ceil(wm * k));
  const height = Math.max(1, Math.ceil(hm * k));
  const ctx = new OffscreenCanvas(width, height).getContext("2d", { willReadFrequently: true })!;
  ctx.globalCompositeOperation = "lighten"; // each channel keeps its largest value
  const px = (x: number) => (x - box[0]) * k;
  const py = (y: number) => (box[3] - y) * k;
  const red = (share: number) => `rgb(${Math.round(share * 255)},0,0)`;
  ctx.fillStyle = red(1);
  for (const c of [...lots, ...cells]) {
    ctx.beginPath();
    ctx.arc(px(c.x), py(c.y), c.r * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = red(1);
  ctx.lineCap = "round";
  for (const l of lines) {
    ctx.lineWidth = l.w * k;
    ctx.beginPath();
    ctx.moveTo(px(l.a[0]), py(l.a[1]));
    ctx.lineTo(px(l.b[0]), py(l.b[1]));
    ctx.stroke();
  }
  const fill = (pts: readonly [number, number][], style: string) => {
    ctx.fillStyle = style;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(px(x), py(y)) : ctx.moveTo(px(x), py(y))));
    ctx.closePath();
    ctx.fill();
  };
  for (const p of polys) fill(p.pts, red(p.share));
  for (const r of rings) fill(r, "rgb(0,255,0)");
  const rgba = new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);

  // The box in web mercator: town metres are conformal with it over a town, so the corners place it.
  const [w, n] = tf.toLngLat(box[0], box[3]);
  const [e, s] = tf.toLngLat(box[2], box[1]);
  return { rgba, width, height, box: [lngToMx(w), latToMy(n), lngToMx(e), latToMy(s)] };
}
