import earcut from "earcut";
import type { XY } from "./modelGeometry";

// Geometry of the 3D water (waterLayer.ts), all in town metres: the water polygons of the landcover tiles cut into
// convex pieces, then per square chunk of the plane laid on a regular grid of cells (so the surface follows the relief
// between its vertices, and neighbouring pieces share every vertex on their common edges: no cracks), with the
// distance to the shore and the river's flow at every vertex. Streams and small rivers that exist only as lines become
// ribbons of water.

export type Box = [number, number, number, number]; // x0, y0, x1, y1
export const SHORE_CAP = 60; // m: farther from the shore than this the water is simply deep
export const FLOW_REACH = 150; // m: a polygon flows like the river line nearest to it within this

// The water of one tile: convex pieces and the real shore (not the edges where the tile cut the polygons).
export interface TileWater {
  pieces: XY[][];
  shores: number[]; // x0, y0, x1, y1 per segment
  pieceOf: number[]; // the polygon of each piece (its index in the tile)
  shoreOf: number[]; // the polygon of each shore segment
  tones: number[]; // per shore segment: 0 bare ground .. 1 forest on the land behind it (tileWater's `tone`)
}

// A waterway line, its points in town metres and in the direction it flows.
export interface Waterway {
  pts: XY[];
  half: number; // m, half its width as a ribbon
  speed: number; // 0..1
}

export interface WaterChunk {
  ribbons: number; // the first vertex of the ribbons (before it, the polygons'); they come in rows of left, centre, right
  piece: number[]; // per vertex of the polygons: the piece (index in the input) it lies in
  xy: number[]; // x, y per vertex
  shore: number[]; // m, capped at SHORE_CAP
  flow: number[]; // x, y per vertex: direction times speed
  tone: number[]; // per vertex: the tone of the nearest shore segment (0 ground .. 1 forest; -1 on a ribbon: no shore reflection)
  index: number[];
}

// Keeps the part of a convex polygon where nx * x + ny * y <= c.
function clipHalf(poly: XY[], nx: number, ny: number, c: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = nx * a[0] + ny * a[1] - c, db = nx * b[0] + ny * b[1] - c;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export function clipBox(poly: XY[], [x0, y0, x1, y1]: Box): XY[] {
  let p = clipHalf(poly, -1, 0, -x0);
  if (p.length >= 3) p = clipHalf(p, 1, 0, x1);
  if (p.length >= 3) p = clipHalf(p, 0, -1, -y0);
  if (p.length >= 3) p = clipHalf(p, 0, 1, y1);
  return p.length >= 3 ? p : [];
}

const area2 = (r: ArrayLike<number>) => {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i += 2) {
    const j = (i + 2) % n;
    a += r[i] * r[j + 1] - r[j] * r[i + 1];
  }
  return a;
};

// The water polygons of a tile (rings flat in tile coordinates, as world/tiles.ts gives them: a ring winding like the
// first starts a polygon, the others are its holes) -> convex pieces inside the tile and the shore, in town metres.
// `tone(x, y)` (tile coordinates) says what the land is there (0 ground .. 1 forest), probed `probe` tile units to both
// sides of every shore segment.
export function tileWater(polys: readonly { rings: number[][] }[], extent: number, toLocal: (tx: number, ty: number) => XY, tone?: (tx: number, ty: number) => number, probe = 0): TileWater {
  const pieces: XY[][] = [], shores: number[] = [], pieceOf: number[] = [], shoreOf: number[] = [], tones: number[] = [];
  const box: Box = [0, 0, extent, extent];
  // an edge along the tile's border or outside it on one side is where the tile cut the water, not a shore
  const cut = (ax: number, ay: number, bx: number, by: number) =>
    (ax <= 0 && bx <= 0) || (ax >= extent && bx >= extent) || (ay <= 0 && by <= 0) || (ay >= extent && by >= extent);
  polys.forEach((p, poly) => {
    let sign = 0;
    let groups: number[][][] = [];
    for (const r of p.rings) {
      if (r.length < 6) continue;
      const s = Math.sign(area2(r));
      if (!s) continue;
      if (!sign) sign = s;
      if (s === sign) groups.push([r]);
      else groups[groups.length - 1]?.push(r);
      for (let i = 0; i < r.length; i += 2) {
        const j = (i + 2) % r.length;
        if (cut(r[i], r[i + 1], r[j], r[j + 1])) continue;
        shores.push(...toLocal(r[i], r[i + 1]), ...toLocal(r[j], r[j + 1]));
        shoreOf.push(poly);
        if (tone) {
          const l = Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]) || 1;
          const mx = (r[i] + r[j]) / 2, my = (r[i + 1] + r[j + 1]) / 2, nx = (-(r[j + 1] - r[i + 1]) / l) * probe, ny = ((r[j] - r[i]) / l) * probe;
          tones.push(Math.max(tone(mx + nx, my + ny), tone(mx - nx, my - ny)));
        } else tones.push(0);
      }
    }
    for (const g of groups) {
      const data: number[] = [], holes: number[] = [];
      for (const r of g) {
        if (data.length) holes.push(data.length / 2);
        for (let i = 0; i < r.length; i++) data.push(r[i]);
      }
      const tri = earcut(data, holes);
      for (let t = 0; t < tri.length; t += 3) {
        const q = clipBox([0, 1, 2].map((k) => [data[tri[t + k] * 2], data[tri[t + k] * 2 + 1]] as XY), box);
        if (q.length) pieces.push(q.map(([x, y]) => toLocal(x, y)));
        if (q.length) pieceOf.push(poly);
      }
    }
    groups = [];
  });
  return { pieces, shores, pieceOf, shoreOf, tones };
}

// Nearest segment within `cap` of a point: segments binned in cells of `cap` over the region they are asked about.
function nearest(segs: readonly number[], cap: number, region: Box): (x: number, y: number) => { d: number; k: number } {
  const [rx0, ry0, rx1, ry1] = region;
  const nx = Math.max(1, Math.ceil((rx1 - rx0) / cap)), ny = Math.max(1, Math.ceil((ry1 - ry0) / cap));
  const cells = new Map<number, number[]>();
  const cl = (v: number, n: number) => Math.min(n - 1, Math.max(0, v));
  for (let k = 0; k < segs.length; k += 4) {
    const [ax, ay, bx, by] = [segs[k], segs[k + 1], segs[k + 2], segs[k + 3]];
    if (Math.max(ax, bx) < rx0 - cap || Math.min(ax, bx) > rx1 + cap || Math.max(ay, by) < ry0 - cap || Math.min(ay, by) > ry1 + cap) continue;
    const i0 = cl(Math.floor((Math.min(ax, bx) - cap - rx0) / cap), nx), i1 = cl(Math.floor((Math.max(ax, bx) + cap - rx0) / cap), nx);
    const j0 = cl(Math.floor((Math.min(ay, by) - cap - ry0) / cap), ny), j1 = cl(Math.floor((Math.max(ay, by) + cap - ry0) / cap), ny);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const key = i * ny + j;
        const list = cells.get(key);
        if (list) list.push(k);
        else cells.set(key, [k]);
      }
  }
  return (x, y) => {
    let d = cap, best = -1;
    const list = cells.get(cl(Math.floor((x - rx0) / cap), nx) * ny + cl(Math.floor((y - ry0) / cap), ny));
    for (const k of list ?? []) {
      const ax = segs[k], ay = segs[k + 1], dx = segs[k + 2] - ax, dy = segs[k + 3] - ay;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
      const e = Math.hypot(x - ax - dx * t, y - ay - dy * t);
      if (e < d) (d = e), (best = k);
    }
    return { d, k: best };
  };
}

// The waterways as segments (x0, y0, x1, y1) and the flow of each (direction times speed).
function flowSegments(ways: readonly Waterway[]): { segs: number[]; flow: number[] } {
  const segs: number[] = [], flow: number[] = [];
  for (const w of ways)
    for (let i = 0; i + 1 < w.pts.length; i++) {
      const [a, b] = [w.pts[i], w.pts[i + 1]];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!l) continue;
      segs.push(a[0], a[1], b[0], b[1]);
      flow.push(((b[0] - a[0]) / l) * w.speed, ((b[1] - a[1]) / l) * w.speed);
    }
  return { segs, flow };
}

// The shore segments near a region that have land on one side: where two water polygons meet (a river running into a
// lake, the tiles the water was cut into) both sides are water, and that is no shore.
// `tones` (one per segment) is carried along into `toneOut` for the segments kept.
export function realShores(shores: readonly number[], region: Box, water: (x: number, y: number) => boolean, tones?: readonly number[], toneOut?: number[]): number[] {
  const out: number[] = [];
  for (let k = 0; k < shores.length; k += 4) {
    const [ax, ay, bx, by] = [shores[k], shores[k + 1], shores[k + 2], shores[k + 3]];
    if (Math.max(ax, bx) < region[0] || Math.min(ax, bx) > region[2] || Math.max(ay, by) < region[1] || Math.min(ay, by) > region[3]) continue;
    const l = Math.hypot(bx - ax, by - ay);
    if (!l) continue;
    const mx = (ax + bx) / 2, my = (ay + by) / 2, nx = (-(by - ay) / l) * 0.5, ny = ((bx - ax) / l) * 0.5;
    if (water(mx + nx, my + ny) && water(mx - nx, my - ny)) continue;
    out.push(ax, ay, bx, by);
    toneOut?.push(tones?.[k / 4] ?? 0);
  }
  return out;
}

// One chunk of water: the pieces laid on cells of `cell` metres inside `box`, and the ribbons of the waterways whose
// segments start in it (a segment belongs to the chunk holding its first point), each split every `cell` metres.
// `shores` near the chunk only (realShores), `tones` one per segment of them.
export function buildWaterChunk(pieces: readonly XY[][], shores: readonly number[], rivers: readonly Waterway[], ribbons: readonly Waterway[], box: Box, cell: number, tones: readonly number[] = []): WaterChunk {
  const out: WaterChunk = { ribbons: 0, piece: [], xy: [], shore: [], flow: [], tone: [], index: [] };
  const region: Box = [box[0] - SHORE_CAP, box[1] - SHORE_CAP, box[2] + SHORE_CAP, box[3] + SHORE_CAP];
  const toShore = nearest(shores, SHORE_CAP, region);
  const fl = flowSegments(rivers);
  const toRiver = nearest(fl.segs, FLOW_REACH, [box[0] - FLOW_REACH, box[1] - FLOW_REACH, box[2] + FLOW_REACH, box[3] + FLOW_REACH]);
  const push = (x: number, y: number, shore: number, fx: number, fy: number, tone = -1) => {
    out.xy.push(x, y);
    out.shore.push(shore);
    out.tone.push(tone);
    out.flow.push(fx, fy);
    return out.xy.length / 2 - 1;
  };
  pieces.forEach((p, pi) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of p) (x0 = Math.min(x0, x)), (y0 = Math.min(y0, y)), (x1 = Math.max(x1, x)), (y1 = Math.max(y1, y));
    if (x1 < box[0] || x0 > box[2] || y1 < box[1] || y0 > box[3]) return;
    const i0 = Math.floor((Math.max(x0, box[0]) - box[0]) / cell), i1 = Math.ceil((Math.min(x1, box[2]) - box[0]) / cell);
    const j0 = Math.floor((Math.max(y0, box[1]) - box[1]) / cell), j1 = Math.ceil((Math.min(y1, box[3]) - box[1]) / cell);
    for (let i = i0; i < i1; i++)
      for (let j = j0; j < j1; j++) {
        const q = clipBox(p, [box[0] + i * cell, box[1] + j * cell, Math.min(box[2], box[0] + (i + 1) * cell), Math.min(box[3], box[1] + (j + 1) * cell)]);
        if (!q.length) continue;
        const ids = q.map(([x, y]) => {
          const r = toRiver(x, y);
          out.piece.push(pi);
          const sh = toShore(x, y);
          return push(x, y, sh.d, r.k < 0 ? 0 : fl.flow[r.k / 2], r.k < 0 ? 0 : fl.flow[r.k / 2 + 1], sh.k < 0 ? 0 : (tones[sh.k / 4] ?? 0));
        });
        for (let k = 1; k + 1 < ids.length; k++) out.index.push(ids[0], ids[k], ids[k + 1]);
      }
  });
  // ribbons: a left, centre and right row along each run, mitred at its bends
  out.ribbons = out.xy.length / 2;
  for (const w of ribbons) {
    const n = w.pts.length;
    const normal = (k: number): XY => {
      const a = w.pts[Math.max(0, k - 1)], b = w.pts[Math.min(n - 1, k + 1)];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
    };
    let prev: number[] | null = null;
    for (let k = 0; k + 1 < n; k++) {
      const a = w.pts[k], b = w.pts[k + 1];
      const inside = a[0] >= box[0] && a[0] < box[2] && a[1] >= box[1] && a[1] < box[3];
      if (!inside) {
        prev = null;
        continue;
      }
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (!len) continue;
      const fx = ((b[0] - a[0]) / len) * w.speed, fy = ((b[1] - a[1]) / len) * w.speed;
      const na = normal(k), nb = normal(k + 1);
      const steps = Math.max(1, Math.ceil(len / cell));
      const from: number = prev ? 1 : 0;
      for (let s = from; s <= steps; s++) {
        const t = s / steps;
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        let nx = na[0] + (nb[0] - na[0]) * t, ny = na[1] + (nb[1] - na[1]) * t;
        const nl = Math.hypot(nx, ny) || 1;
        (nx /= nl), (ny /= nl);
        const row: number[] = [push(x + nx * w.half, y + ny * w.half, 0, fx, fy), push(x, y, w.half, fx, fy), push(x - nx * w.half, y - ny * w.half, 0, fx, fy)];
        if (prev)
          for (let c = 0; c < 2; c++) out.index.push(prev[c], row[c], row[c + 1], prev[c], row[c + 1], prev[c + 1]);
        prev = row;
      }
    }
  }
  return out;
}

// The runs of a waterway outside the water polygons (split where a segment's middle lies in one).
export function runsOutside(w: Waterway, inside: (x: number, y: number) => boolean): Waterway[] {
  const runs: Waterway[] = [];
  let cur: XY[] = [];
  for (let k = 0; k + 1 < w.pts.length; k++) {
    const a = w.pts[k], b = w.pts[k + 1];
    if (inside((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) {
      if (cur.length > 1) runs.push({ ...w, pts: cur });
      cur = [];
      continue;
    }
    if (!cur.length) cur.push(a);
    cur.push(b);
  }
  if (cur.length > 1) runs.push({ ...w, pts: cur });
  return runs;
}

// ---------- piers of bridges (foam and wake in the water shader) ----------

export interface Pier {
  x: number;
  y: number;
  r: number; // m, how far its foam ring reaches from the middle
}

// The point at distance s along a polyline.
function pointAlong(pts: readonly XY[], s: number): XY | null {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (s <= l || i + 2 === pts.length) {
      const t = l > 0 ? Math.min(1, Math.max(0, s / l)) : 0;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    s -= l;
  }
  return null;
}

// What stands in the water under a built bridge, as roadModels.ts lays it out: a pile bridge has a pair of piles about
// every 4.5 m on its raised middle (one ring per 9 m here), a stone bridge has a pier between each two arches; a
// footbridge has posts on the banks only.
export function bridgePiers(pts: readonly XY[], kind: string): Pier[] {
  let len = 0;
  for (let i = 0; i + 1 < pts.length; i++) len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
  const out: Pier[] = [];
  const put = (s: number, r: number) => {
    const p = pointAlong(pts, s);
    if (p) out.push({ x: p[0], y: p[1], r });
  };
  if (kind === "bridge") {
    const ramp = Math.min(6, len * 0.3);
    for (let s = ramp + 2.25; s <= len - ramp; s += 9) put(s, 1.9);
  } else if (kind === "stonebridge") {
    const ramp = Math.min(8, len * 0.3), PIER = 1.6, mid = Math.max(0, len - 2 * ramp);
    const n = Math.max(1, Math.round(mid / 12));
    const span = (mid - (n - 1) * PIER) / n;
    if (span >= 2) for (let k = 1; k < n; k++) put(ramp + k * span + (k - 0.5) * PIER, 2.9);
  }
  return out;
}

// The `max` piers nearest to (x, y) within `reach` metres, nearest first.
export function nearestPiers(piers: readonly Pier[], x: number, y: number, max: number, reach: number): Pier[] {
  const r2 = reach * reach;
  return piers
    .map((p) => ({ p, d: (p.x - x) ** 2 + (p.y - y) ** 2 }))
    .filter((q) => q.d <= r2)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((q) => q.p);
}
