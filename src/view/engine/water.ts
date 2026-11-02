import { effect, type ReadonlySignal } from "@preact/signals";
import type { CameraView } from "../../engine/camera/camera";
import { frustumPlanes, sphereInView } from "../../engine/camera/frustum";
import type { Engine } from "../../engine/engine";
import { dot, ecefToGeodetic, enuAt, geodeticToEcef, type Vec3 } from "../../engine/geo/ellipsoid";
import { lngLatToTile, tileToLngLat } from "../../engine/geo/mercator";
import { PIERS, Water, WATER_VERTEX_FLOATS, type WaterChunkGpu } from "../../engine/scene/water";
import { EXAGGERATION } from "../../engine/terrain/terrain";
import { calendar, daylight } from "../../sim/clock";
import type { WeatherState } from "../../sim/weather";
import { frame, roads as roadGraph } from "../../simClient";
import { mixHex, PALETTE } from "../../ui/palette";
import type { Frame } from "../../world/frame";
import { groundAt, loadGround } from "../../world/ground";
import { pointInRings } from "../../world/landcover";
import { metersPerPixel } from "../../world/mercator";
import { NATURE_MAXZOOM, WATERWAY_HALF_M, WATERWAY_ZOOM } from "../../world/nature";
import { getLandTile, getWaterwayTile } from "../../world/tiles";
import { motionTime, water3dOn } from "../../map/graphicsSettings";
import { rgb, type XY } from "../../map/modelGeometry";
import { roadChains } from "../../map/roadChains";
import { BORDER, bridgePiers, buildWaterChunk, FLOW_REACH, nearestPiers, OPPOSITE, realShores, runsOutside, SHORE_CAP, steamStrength, tileWater, type Box, type Pier, type TileWater, type Waterway } from "../../map/waterMesh";
import { iceOpacity, WIND_DIR } from "../../map/weatherMath";
import { weatherMapOn } from "../../map/weatherSettings";
import { mppAtZoom, zoomAtMpp } from "../view";
import { townLight } from "./townLight";

// The water surface on the engine (scene/water.ts), from the old 3D water layer's data and rules:
// the water polygons of the landcover tiles (the same the drape and the game read) and the streams of the waterway
// tiles, in square chunks on a grid of town metres, finer near the camera (map/waterMesh.ts). On the relief a lake or
// a river polygon is level at its shores: the DEM holds the bed of the large ones, so the surface takes the median
// ground height of its own shore around each corner of the chunk grid, bilinear between them, and never below the
// ground; streams lie on the ground along their line. Heights are the z11 DEM the rules and the near terrain read
// (world/ground.ts), with the engine's exaggeration. Vertices go into the town origin's east/north/up frame in f64.

const WATER_MPP = mppAtZoom(13); // the old WATER_FROM_ZOOM: closer than this the water is 3D
const WATER_FULL_ZOOM = 13.6; // from here it no longer fades into the terrain's water
const SIZE = 800; // m, side of a chunk
const CELLS = [20, 40, 160, 800]; // m per level of detail, nearest first (dividing SIZE: chunks of a level meet vertex to vertex)
const LEVEL_TO = [1200, 4000, 12_000]; // m from the eye: the farthest each level reaches
const FAR_CAP = 30_000; // m: no 3D water beyond
const RANGE = 150_000; // m from the founding point
const SLOPE = 120; // m: the relief within a chunk
const LIFT = 0.3; // m above the ground
const LEVEL_REACH = [1200, 3000, 8000]; // m around a grid corner to find the shore that sets its water level, nearest first
const LEVEL_SAMPLES = 400; // shore points per corner at most
const FRAME_BUDGET = 4; // ms of chunk building per frame
const MAX_CHUNKS = 1500; // cached; beyond it chunks unseen for a while are dropped
const RIVER: Record<string, { half: number; speed: number }> = { river: { half: WATERWAY_HALF_M, speed: 1 }, stream: { half: 2.5, speed: 0.6 } };
const WIND_FULL = 10; // m/s: full ripples
const RAIN_FULL = 4; // mm/h: rings everywhere
const PIER_REACH = 500; // m from the eye: farther the foam is faded out anyway
const TONES: Record<string, number> = { wood: 1, wetland: 0.6, rock: 0.3 }; // landcover class -> tone of the shore reflection
const TONE_PROBE_M = 25; // m: how far from a shore segment its land is looked at
const N12 = 2 ** NATURE_MAXZOOM;
const N14 = 2 ** WATERWAY_ZOOM;

// The sky the water reflects (the old map's sky and horizon, toward dusk by night).
const SKY = "#c9d6dc";
const HORIZON = "#e6e4d6";
const SKY_NIGHT = 0.8;
function skyColours(hour: number): { sky: string; horizon: string } {
  const n = (1 - daylight(hour)) * SKY_NIGHT;
  return { sky: mixHex(SKY, PALETTE.dusk, n), horizon: mixHex(HORIZON, PALETTE.dusk, n) };
}

interface Chunk {
  gpu: WaterChunkGpu | null; // null: no water in it
  seen: number;
}

type LandWater = TileWater & { boxes: Box[] };

export interface WaterOptions {
  clock?: ReadonlySignal<number>;
  weather?: ReadonlySignal<WeatherState | null>;
  rain?: () => number; // mm/h of rain (not snow) where the camera looks
}

export function attachWater(engine: Engine, o: WaterOptions): void {
  const colour = (hex: string, k = 1) => rgb(hex).map((v) => Math.min(1, v * k)) as Vec3;
  const water = new Water(engine.device, engine.target, engine.frameU.layout, {
    deep: colour(PALETTE.mapWater, 0.86),
    shallow: colour(mixHex(PALETTE.mapWater, PALETTE.mapShore, 0.35), 1.05),
    foam: colour(PALETTE.paperRaised),
    groundTone: colour(PALETTE.mapGrass, 0.55),
    forestTone: colour(PALETTE.mapForestDeep, 0.3),
  });
  let tilesFor: Frame | null = null;
  let originKey = "";
  let frameNo = 0;
  let steamForce: number | null = null; // devtools override
  const chunks = new Map<string, Chunk>(); // "i,j,level"
  const centres = new Map<string, Vec3>(); // "i,j" -> the chunk's middle at h = 0 in the origin's frame
  const land = new Map<string, LandWater | null>(); // null while loading
  const ways = new Map<string, Waterway[] | null>();
  const levels = new Map<string, number>(); // water level (exaggerated metres) of a polygon at a grid corner
  let piers: Pier[] = []; // the piers of all built bridges, town metres
  let inView = 0;

  const reset = () => {
    for (const c of chunks.values()) if (c.gpu) water.release(c.gpu);
    chunks.clear();
    water.shown = [];
  };

  // Height (exaggerated metres, as the engine draws it) at town points; null while the DEM loads.
  const heights = (tf: Frame, pts: readonly XY[]): number[] | null => {
    const at = pts.map(([x, y]) => tf.toLngLat(x, y));
    const hs = at.map(([a, b]) => groundAt(a, b));
    if (hs.some((h) => h === null)) {
      void loadGround(at.filter((_, q) => hs[q] === null));
      return null;
    }
    return hs.map((h) => Math.max(h!, 0) * EXAGGERATION);
  };

  // A tile of each kind, loaded on demand; undefined/null until it is in.
  const landTile = (tf: Frame, x: number, y: number) => {
    const key = `${x}/${y}`;
    if (!land.has(key)) {
      land.set(key, null);
      void getLandTile(((x % N12) + N12) % N12, y)
        .then(
          (t) => {
            const toLocal = (tx: number, ty: number): XY => {
              const ll = tileToLngLat(NATURE_MAXZOOM, x, y, tx / t.extent, ty / t.extent);
              return tf.toLocal(ll.lng, ll.lat);
            };
            // what the land is behind a shore: the landcover polygon under a probe point
            const tone = (px: number, py: number): number => {
              for (const q of t.land) if (px >= q.bbox[0] && px <= q.bbox[2] && py >= q.bbox[1] && py <= q.bbox[3] && pointInRings(px, py, q.rings)) return TONES[q.cls] ?? 0;
              return 0;
            };
            const probe = TONE_PROBE_M / ((metersPerPixel(tf.toLngLat(0, 0)[1], NATURE_MAXZOOM) * 256) / t.extent);
            const w = tileWater(t.water, t.extent, toLocal, tone, probe);
            const borders = w.borders.map((v, k) => (k % 4 >= 2 ? v / t.extent : v)); // runs as shares of the side
            return { ...w, borders, boxes: w.pieces.map(boxOf) };
          },
          (): LandWater => ({ pieces: [], shores: [], pieceOf: [], shoreOf: [], tones: [], borders: [], boxes: [] }),
        )
        .then((w) => {
          if (tilesFor === tf) land.set(key, w);
        });
    }
    return land.get(key);
  };
  const wayTile = (tf: Frame, x: number, y: number) => {
    const key = `${x}/${y}`;
    if (!ways.has(key)) {
      ways.set(key, null);
      void getWaterwayTile(((x % N14) + N14) % N14, y)
        .then(
          (t) => {
            const out: Waterway[] = [];
            const local = (tx: number, ty: number): XY => {
              const ll = tileToLngLat(WATERWAY_ZOOM, x, y, tx / t.extent, ty / t.extent);
              return tf.toLocal(ll.lng, ll.lat);
            };
            for (const l of t.lines) {
              const kind = RIVER[l.cls] ?? RIVER.stream;
              // each segment belongs to the tile holding its middle: the tiles overlap at their edges
              let run: XY[] = [];
              for (let i = 0; i + 3 < l.pts.length; i += 2) {
                const mx = (l.pts[i] + l.pts[i + 2]) / 2;
                const my = (l.pts[i + 1] + l.pts[i + 3]) / 2;
                if (mx >= 0 && mx < t.extent && my >= 0 && my < t.extent) {
                  if (!run.length) run.push(local(l.pts[i], l.pts[i + 1]));
                  run.push(local(l.pts[i + 2], l.pts[i + 3]));
                } else if (run.length) {
                  out.push({ pts: run, ...kind });
                  run = [];
                }
              }
              if (run.length) out.push({ pts: run, ...kind });
            }
            return out;
          },
          () => [] as Waterway[],
        )
        .then((w) => {
          if (tilesFor === tf) ways.set(key, w);
        });
    }
    return ways.get(key);
  };
  // The tiles of zoom z under a box of town metres.
  const tilesUnder = (tf: Frame, b: Box, z: number): [number, number][] => {
    const corners = [tf.toLngLat(b[0], b[1]), tf.toLngLat(b[2], b[1]), tf.toLngLat(b[0], b[3]), tf.toLngLat(b[2], b[3])].map(([lng, lat]) => lngLatToTile(lng, lat, z));
    const xs = corners.map((c) => Math.floor(c.x));
    const ys = corners.map((c) => Math.floor(c.y));
    const out: [number, number][] = [];
    for (let x = Math.min(...xs); x <= Math.max(...xs); x++) for (let y = Math.min(...ys); y <= Math.max(...ys); y++) out.push([x, y]);
    return out;
  };

  // The median ground height at some shore points; null while the ground loads.
  const median = (tf: Frame, pts: XY[]): number | null => {
    const step = Math.ceil(pts.length / LEVEL_SAMPLES);
    const hs = heights(
      tf,
      pts.filter((_, q) => q % step === 0),
    );
    if (!hs) return null;
    hs.sort((a, b) => a - b);
    return hs[hs.length >> 1];
  };
  // The polygons that are one water with a polygon (tile key, index in the tile) across the edges the tiles cut it at,
  // among the tiles under a box; null while one of them loads.
  const lakeOf = (tf: Frame, tile: string, poly: number, box: Box): { tile: string; poly: number }[] | null => {
    const allowed = new Set(tilesUnder(tf, box, NATURE_MAXZOOM).map(([a, b]) => `${a}/${b}`));
    const seen = new Set([`${tile}:${poly}`]);
    const out = [{ tile, poly }];
    for (let q = 0; q < out.length; q++) {
      const m = out[q];
      const b = land.get(m.tile)!.borders;
      const [tx, ty] = m.tile.split("/").map(Number);
      for (let k = 0; k < b.length; k += 4) {
        if (b[k] !== m.poly) continue;
        const side = b[k + 1];
        const nx = tx + (side === BORDER.west ? -1 : side === BORDER.east ? 1 : 0);
        const ny = ty + (side === BORDER.north ? -1 : side === BORDER.south ? 1 : 0);
        const nk = `${nx}/${ny}`;
        if (!allowed.has(nk)) continue;
        const nt = landTile(tf, nx, ny);
        if (!nt) return null;
        const nb = nt.borders;
        for (let j = 0; j < nb.length; j += 4) {
          if (nb[j + 1] !== OPPOSITE[side] || nb[j + 2] >= b[k + 3] || nb[j + 3] <= b[k + 2]) continue;
          const key = `${nk}:${nb[j]}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ tile: nk, poly: nb[j] });
        }
      }
    }
    return out;
  };

  // The water level of a polygon at a corner of the chunk grid: the median ground height of its own shore near the
  // corner (its own: of the whole water the tiles cut it from, so the pieces meet level at the tile edges), the nearest
  // reach that has any, else of all its shore; a polygon with no shore near (the middle of a large lake) takes any shore
  // near the corner, else the ground there. null while tiles or ground load.
  const levelAt = (tf: Frame, tile: string, poly: number, ci: number, cj: number): number | null => {
    const own = `${tile}:${poly}:${ci},${cj}`;
    const had = levels.get(own);
    if (had !== undefined) return had;
    const x = ci * SIZE;
    const y = cj * SIZE;
    const far = LEVEL_REACH[LEVEL_REACH.length - 1];
    const lake = lakeOf(tf, tile, poly, [x - far, y - far, x + far, y + far]);
    if (!lake) return null;
    const key = `${lake.map((m) => `${m.tile}:${m.poly}`).sort()[0]}:${ci},${cj}`;
    const shared = levels.get(key);
    if (shared !== undefined) {
      levels.set(own, shared);
      return shared;
    }
    const ends = (t: TileWater, keep: (k: number) => boolean, r: number): XY[] => {
      const out: XY[] = [];
      for (let k = 0; k < t.shores.length; k += 4) if (keep(k / 4) && Math.hypot(t.shores[k] - x, t.shores[k + 1] - y) <= r) out.push([t.shores[k], t.shores[k + 1]]);
      return out;
    };
    let pts: XY[] = [];
    for (const r of [...LEVEL_REACH, Infinity])
      if (!pts.length)
        pts = lake.flatMap((m) => {
          const t = land.get(m.tile)!;
          return ends(t, (s) => t.shoreOf[s] === m.poly, r);
        });
    for (const r of LEVEL_REACH) {
      if (pts.length) break;
      const ts = tilesUnder(tf, [x - r, y - r, x + r, y + r], NATURE_MAXZOOM).map(([a, b]) => landTile(tf, a, b));
      if (ts.some((t) => !t)) return null;
      for (const t of ts) pts.push(...ends(t!, () => true, r));
    }
    const level = pts.length ? median(tf, pts) : (heights(tf, [[x, y]])?.[0] ?? null);
    if (level !== null) {
      levels.set(key, level);
      levels.set(own, level);
    }
    return level;
  };

  // Builds one chunk at a level; null while its tiles or its ground load.
  const build = (i: number, j: number, level: number, tf: Frame): Chunk | null => {
    const box: Box = [i * SIZE, j * SIZE, (i + 1) * SIZE, (j + 1) * SIZE];
    const grow = (m: number): Box => [box[0] - m, box[1] - m, box[2] + m, box[3] + m];
    const lk = tilesUnder(tf, grow(FLOW_REACH), NATURE_MAXZOOM);
    const lt = lk.map(([x, y]) => landTile(tf, x, y));
    const wt = tilesUnder(tf, grow(FLOW_REACH), WATERWAY_ZOOM).map(([x, y]) => wayTile(tf, x, y));
    if (lt.some((t) => !t) || wt.some((t) => !t)) return null;
    const pieces: XY[][] = [];
    const boxes: Box[] = [];
    const owners: { tile: string; poly: number }[] = [];
    lt.forEach((t, q) =>
      t!.pieces.forEach((p, k) => {
        const b = t!.boxes[k];
        if (b[2] < box[0] - FLOW_REACH || b[0] > box[2] + FLOW_REACH || b[3] < box[1] - FLOW_REACH || b[1] > box[3] + FLOW_REACH) return;
        pieces.push(p);
        boxes.push(b);
        owners.push({ tile: `${lk[q][0]}/${lk[q][1]}`, poly: t!.pieceOf[k] });
      }),
    );
    const shores = lt.flatMap((t) => t!.shores);
    const allTones = lt.flatMap((t) => t!.tones);
    const rivers = wt.flatMap((t) => t!);
    const empty: Chunk = { gpu: null, seen: 0 };
    if (!pieces.length && !rivers.length) return empty;
    const inside = (x: number, y: number) => pieces.some((p, q) => x >= boxes[q][0] && x <= boxes[q][2] && y >= boxes[q][1] && y <= boxes[q][3] && inConvex(p, x, y));
    const ribbons = rivers.flatMap((w) => runsOutside(w, inside));
    const nearTones: number[] = [];
    const near = realShores(shores, grow(SHORE_CAP), inside, allTones, nearTones);
    const c = buildWaterChunk(pieces, near, rivers, ribbons, box, CELLS[level], nearTones);
    const n = c.xy.length / 2;
    if (!n) return empty;
    // heights: the polygons level with their shores, the ribbons on the ground under their line
    const z = new Float64Array(n).fill(LIFT);
    const corners = new Map<number, number[]>(); // piece -> its levels at the four corners
    for (const pi of new Set(c.piece)) {
      const { tile, poly } = owners[pi];
      const lv = [levelAt(tf, tile, poly, i, j), levelAt(tf, tile, poly, i + 1, j), levelAt(tf, tile, poly, i, j + 1), levelAt(tf, tile, poly, i + 1, j + 1)];
      if (lv.some((h) => h === null)) return null;
      corners.set(pi, lv as number[]);
    }
    const polyPts: XY[] = [];
    for (let v = 0; v < c.ribbons; v++) polyPts.push([c.xy[v * 2], c.xy[v * 2 + 1]]);
    const under = heights(tf, polyPts);
    if (!under) return null;
    for (let v = 0; v < c.ribbons; v++) {
      const [l00, l10, l01, l11] = corners.get(c.piece[v])!;
      const fx = Math.min(1, Math.max(0, (c.xy[v * 2] - box[0]) / SIZE));
      const fy = Math.min(1, Math.max(0, (c.xy[v * 2 + 1] - box[1]) / SIZE));
      z[v] += Math.max(under[v], l00 * (1 - fx) * (1 - fy) + l10 * fx * (1 - fy) + l01 * (1 - fx) * fy + l11 * fx * fy);
    }
    const centres: XY[] = [];
    for (let v = c.ribbons + 1; v < n; v += 3) centres.push([c.xy[v * 2], c.xy[v * 2 + 1]]);
    const gs = heights(tf, centres);
    if (!gs) return null;
    gs.forEach((h, q) => {
      for (let r = 0; r < 3; r++) z[c.ribbons + q * 3 + r] += h;
    });
    // into the origin's east/north/up frame, f64
    const [lng0, lat0] = tf.toLngLat(0, 0);
    const or = geodeticToEcef(lat0, lng0, 0);
    const { east, north, up } = enuAt(lat0, lng0);
    const vertices = new Float32Array(n * WATER_VERTEX_FLOATS);
    const p: Vec3 = [0, 0, 0];
    for (let v = 0; v < n; v++) {
      const [lng, lat] = tf.toLngLat(c.xy[v * 2], c.xy[v * 2 + 1]);
      geodeticToEcef(lat, lng, z[v], p);
      const d: Vec3 = [p[0] - or[0], p[1] - or[1], p[2] - or[2]];
      vertices.set([dot(d, east), dot(d, north), dot(d, up), c.shore[v], c.flow[v * 2], c.flow[v * 2 + 1], c.tone[v]], v * WATER_VERTEX_FLOATS);
    }
    return { gpu: water.upload({ vertices, indices: Uint32Array.from(c.index) }), seen: 0 };
  };

  // Is there water at a town point, as far as the loaded tiles know (an unloaded tile counts as water)?
  const waterAt = (tf: Frame, x: number, y: number): boolean => {
    const [tx, ty] = tilesUnder(tf, [x, y, x, y], NATURE_MAXZOOM)[0];
    const t = land.get(`${tx}/${ty}`);
    if (!t) return true;
    return t.pieces.some((p, k) => x >= t.boxes[k][0] && x <= t.boxes[k][2] && y >= t.boxes[k][1] && y <= t.boxes[k][3] && inConvex(p, x, y));
  };

  effect(() => {
    void frame.value;
    reset();
    land.clear();
    ways.clear();
    levels.clear();
    tilesFor = frame.peek();
  });
  // the built bridges of the road graph -> their piers
  effect(() => {
    const g = roadGraph.value;
    piers = [];
    if (!g) return;
    for (const ch of roadChains(g, (e) => (e.done >= e.labor ? "built" : "waiting"))) {
      if (ch.state !== "built" || (ch.kind !== "bridge" && ch.kind !== "stonebridge")) continue;
      const pts = ch.nodes.flatMap((n) => (g.nodes[n] ? [[g.nodes[n].x, g.nodes[n].y] as XY] : []));
      if (pts.length > 1) piers.push(...bridgePiers(pts, ch.kind));
    }
  });

  const update = (view: CameraView) => {
    const tf = frame.peek();
    const mpp = engine.metersPerPixel();
    if (!tf || !water3dOn.peek() || mpp > WATER_MPP) {
      water.look = null;
      water.shown = [];
      return;
    }
    const [lng0, lat0] = tf.toLngLat(0, 0);
    const key = `${lng0},${lat0}`;
    if (key !== originKey) {
      originKey = key;
      reset();
      centres.clear();
      water.setOrigin(lat0, lng0);
    }
    const or = geodeticToEcef(lat0, lng0, 0);
    const axes = enuAt(lat0, lng0);
    const rel: Vec3 = [or[0] - view.eye[0], or[1] - view.eye[1], or[2] - view.eye[2]];
    const eg = ecefToGeodetic(view.eye);
    const [ex, ey] = tf.toLocal(eg.lng, eg.lat);
    const planes = frustumPlanes(view);
    const below = engine.groundAt(eg.lat, eg.lng) ?? 0;
    // A chunk's middle on the ground in the origin's frame (exact: the town's metres drift from that frame by hundreds of
    // metres tens of kilometres out), cached; the ground under the eye stands in for its height.
    const centre = (i: number, j: number): Vec3 => {
      const k = `${i},${j}`;
      let c = centres.get(k);
      if (!c) {
        const [lng, lat] = tf.toLngLat((i + 0.5) * SIZE, (j + 0.5) * SIZE);
        const p = geodeticToEcef(lat, lng, 0);
        const d: Vec3 = [p[0] - or[0], p[1] - or[1], p[2] - or[2]];
        centres.set(k, (c = [dot(d, axes.east), dot(d, axes.north), dot(d, axes.up)]));
      }
      return c;
    };
    const camRel = (c: Vec3): Vec3 => [
      rel[0] + axes.east[0] * c[0] + axes.north[0] * c[1] + axes.up[0] * (c[2] + below),
      rel[1] + axes.east[1] * c[0] + axes.north[1] * c[1] + axes.up[1] * (c[2] + below),
      rel[2] + axes.east[2] * c[0] + axes.north[2] * c[1] + axes.up[2] * (c[2] + below),
    ];

    // The chunks in view within reach, each at its level, built nearest first within the budget; until then any level
    // of it already built stands in.
    const half = SIZE * Math.SQRT1_2;
    const seen: { i: number; j: number; d: number }[] = [];
    for (let i = Math.floor((ex - FAR_CAP) / SIZE); i <= Math.floor((ex + FAR_CAP) / SIZE); i++)
      for (let j = Math.floor((ey - FAR_CAP) / SIZE); j <= Math.floor((ey + FAR_CAP) / SIZE); j++) {
        const cx = (i + 0.5) * SIZE;
        const cy = (j + 0.5) * SIZE;
        if (Math.hypot(cx - ex, cy - ey) - half > FAR_CAP || Math.hypot(cx, cy) > RANGE) continue;
        const c = camRel(centre(i, j));
        if (!sphereInView(planes, c, half + SLOPE)) continue;
        seen.push({ i, j, d: Math.max(1, Math.hypot(c[0], c[1], c[2])) });
      }
    seen.sort((a, b) => a.d - b.d);
    inView = seen.length;
    frameNo++;
    const t0 = performance.now();
    const shown: WaterChunkGpu[] = [];
    for (const s of seen) {
      const near = LEVEL_TO.findIndex((d) => s.d < d);
      const level = near < 0 ? CELLS.length - 1 : near;
      const k = `${s.i},${s.j},${level}`;
      let c = chunks.get(k);
      if (!c && performance.now() - t0 < FRAME_BUDGET) {
        const built = build(s.i, s.j, level, tf);
        if (built) chunks.set(k, (c = built));
      }
      for (let l = 0; l < CELLS.length && !c; l++) c = chunks.get(`${s.i},${s.j},${l}`);
      if (!c) continue;
      c.seen = frameNo;
      if (c.gpu) shown.push(c.gpu);
    }
    water.shown = shown;
    if (chunks.size > MAX_CHUNKS)
      for (const [k, c] of chunks)
        if (frameNo - c.seen > 600) {
          if (c.gpu) water.release(c.gpu);
          chunks.delete(k);
        }
    if (!shown.length) {
      water.look = null;
      return;
    }

    const cal = calendar(o.clock?.peek() ?? 0);
    const hour = cal.hour + cal.minute / 60;
    const w = o.weather?.peek();
    const sun = water.toLocal(engine.light(engine.state).sun);
    const lit = townLight(sun);
    const sky = skyColours(hour);
    const zoom = zoomAtMpp(mpp);
    const t = Math.min(1, Math.max(0, (zoom - zoomAtMpp(WATER_MPP)) / (WATER_FULL_ZOOM - zoomAtMpp(WATER_MPP))));
    const rain = Math.min(1, (o.rain?.() ?? 0) / RAIN_FULL);
    const ice = weatherMapOn.peek() && w ? Math.min(1, iceOpacity(w.ice) / 0.55) : 0;
    const steam = steamForce ?? (w ? steamStrength(w.now.temp, hour, w.now.wind, w.now.cloud, w.now.snow ? 0 : w.now.precip, ice) : 0);
    // the nearest piers that stand in water, into the origin's frame (the town's metres drift from it away from the
    // founding point)
    const pt: Vec3 = [0, 0, 0];
    const list = nearestPiers(piers, ex, ey, PIERS * 2, PIER_REACH)
      .filter((q) => waterAt(tf, q.x, q.y))
      .slice(0, PIERS)
      .map((q) => {
        const [lng, lat] = tf.toLngLat(q.x, q.y);
        geodeticToEcef(lat, lng, 0, pt);
        const d: Vec3 = [pt[0] - or[0], pt[1] - or[1], pt[2] - or[2]];
        return { x: dot(d, axes.east), y: dot(d, axes.north), r: q.r };
      });
    const wind = Math.hypot(WIND_DIR[0], WIND_DIR[1]) || 1;
    water.look = {
      light: lit.light,
      sunStrength: lit.strength,
      sun,
      daylight: lit.daylight,
      time: motionTime(),
      windDir: [WIND_DIR[0] / wind, WIND_DIR[1] / wind],
      wind: Math.max(0.12, Math.min(1.2, (w?.now.wind ?? 3) / WIND_FULL)),
      rain,
      far: FAR_CAP,
      fadeIn: t * t * (3 - 2 * t),
      steam,
      sky: rgb(sky.sky),
      horizon: rgb(sky.horizon),
      piers: list,
    };
  };

  // The controller first, then the surface (before the forest: reeds and trees at the shore are depth-tested against
  // it), its steam with the transparent things.
  engine.drawables.push({ update, draw: () => {} }, water, water.steam);
  if (import.meta.env.DEV)
    Object.assign(window, {
      engineWater: {
        surface: water,
        stats: () => ({ inView, shown: water.shown.length, chunks: chunks.size, tiles: land.size + ways.size, tris: water.shown.reduce((a, c) => a + c.count / 3, 0) }),
        steam: (v: number | null) => (steamForce = v), // the steam's strength for a look; null gives it back to the weather
        piers: (list: Pier[]) => ((piers = list), piers.length), // test piers (town metres) until the roads change
      },
    });
}

const boxOf = (p: readonly XY[]): Box => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [a, b] of p) (x0 = Math.min(x0, a)), (y0 = Math.min(y0, b)), (x1 = Math.max(x1, a)), (y1 = Math.max(y1, b));
  return [x0, y0, x1, y1];
};

function inConvex(p: readonly XY[], x: number, y: number): boolean {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    const c = Math.sign((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]));
    if (!c) continue;
    if (!sign) sign = c;
    else if (c !== sign) return false;
  }
  return true;
}
