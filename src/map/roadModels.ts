import { ROAD_KINDS } from "../sim/roads";
import type { RoadKind } from "../sim/types";
import { PALETTE } from "../ui/palette";
import { Mesh, PATTERN, prism, rgb, shade, square, type Model, type RGB, type XY } from "./modelGeometry";

// Models of built roads and bridges: a chain's centre line in town metres + its kind -> mesh in the same metres, on the
// shared mesh of modelGeometry.ts (the layer, modelLayer.ts, draws them with the buildings).
//
// Ground roads are ribbons just above the ground with round joints and ends (discs), like the line caps they replace;
// their surface patterns (ruts, cobbles) are laid out in world space, so two roads overlapping at a junction match.
// Bridges are built along the chain resampled every half metre:
// - footbridge: a plank deck sagging between end posts, with ropes and hangers;
// - bridge: a plank deck on piles with railings, ramps at both ends;
// - stonebridge: a cobbled deck on arches between piers, with parapets.

const GROUND_Z: Partial<Record<RoadKind, number>> = { path: 0.02, dirt: 0.035, stone: 0.05 }; // apart, so junctions do not flicker
const GROUND_STEP = 6; // m; ground ribbons get a point this often, so they can follow the relief (groundSeat.ts)
const JOINT_TURN = 0.35; // rad: bends sharper than this get a round joint

type P3 = [number, number, number];

// A point of a centre line: position, distance along, unit tangent, left normal and the miter scale of the offset.
interface Station {
  p: XY;
  s: number;
  t: XY;
  n: XY;
  k: number;
}

// Stations of a polyline, with extra points every `step` metres when given (0: the polyline's own points only).
function stations(input: readonly XY[], step: number): Station[] {
  const pts: XY[] = [];
  for (const q of input) {
    if (!Number.isFinite(q[0]) || !Number.isFinite(q[1])) continue;
    const l = pts[pts.length - 1];
    if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 0.05) pts.push([q[0], q[1]]);
  }
  if (pts.length < 2) return [];
  const dense: XY[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = step > 0 ? Math.max(1, Math.ceil(len / step)) : 1;
    for (let k = 1; k <= n; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  const dir = (a: XY, b: XY): XY => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const out: Station[] = [];
  let s = 0;
  for (let i = 0; i < dense.length; i++) {
    if (i > 0) s += Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]);
    const dp = i > 0 ? dir(dense[i - 1], dense[i]) : null, dn = i + 1 < dense.length ? dir(dense[i], dense[i + 1]) : null;
    let t: XY = dp && dn ? [dp[0] + dn[0], dp[1] + dn[1]] : (dp ?? dn)!;
    const tl = Math.hypot(t[0], t[1]);
    t = tl > 1e-9 ? [t[0] / tl, t[1] / tl] : (dn ?? dp)!;
    const n: XY = [-t[1], t[0]];
    const ref = dp ?? dn!;
    const cos = n[0] * -ref[1] + n[1] * ref[0]; // cos of half the turn
    out.push({ p: dense[i], s, t, n, k: Math.min(2, 1 / Math.max(cos, 0.5)) });
  }
  return out;
}

const at = (st: Station, off: number): XY => [st.p[0] + st.n[0] * off * st.k, st.p[1] + st.n[1] * off * st.k];

// Horizontal strip between offsets a and b (left positive) at heights z; normals tilt with the slope (up, or down).
function strip(mesh: Mesh, st: readonly Station[], a: number, b: number, z: readonly number[], col: RGB, pat: number, w: number, down = false): void {
  let prev: [number, number] | null = null;
  for (let i = 0; i < st.length; i++) {
    const i0 = Math.max(0, i - 1), i1 = Math.min(st.length - 1, i + 1);
    const ds = st[i1].s - st[i0].s || 1;
    const g = (z[i1] - z[i0]) / ds;
    const l = Math.hypot(g, 1), sg = down ? -1 : 1;
    const nrm: P3 = [(-g * st[i].t[0] * sg) / l, (-g * st[i].t[1] * sg) / l, sg / l];
    const pa = at(st[i], a), pb = at(st[i], b);
    const va = mesh.vert(pa[0], pa[1], z[i], nrm, col, [st[i].s, a, w, pat]);
    const vb = mesh.vert(pb[0], pb[1], z[i], nrm, col, [st[i].s, b, w, pat]);
    if (prev) {
      mesh.idx(prev[0], prev[1], vb);
      mesh.idx(prev[0], vb, va);
    }
    prev = [va, vb];
  }
}

// Vertical strip at offset `off` from zlo to zhi, facing left (side 1) or right (side -1).
function wallStrip(mesh: Mesh, st: readonly Station[], off: number, zlo: readonly number[], zhi: readonly number[], side: 1 | -1, col: RGB, pat: number): void {
  let prev: [number, number] | null = null;
  const len = st[st.length - 1].s;
  for (let i = 0; i < st.length; i++) {
    const nrm: P3 = [st[i].n[0] * side, st[i].n[1] * side, 0];
    const p = at(st[i], off);
    const lo = mesh.vert(p[0], p[1], zlo[i], nrm, col, [st[i].s, len, 100, pat]);
    const hi = mesh.vert(p[0], p[1], Math.max(zhi[i], zlo[i]), nrm, col, [st[i].s, len, 100, pat]);
    if (prev) {
      mesh.idx(prev[0], lo, hi);
      mesh.idx(prev[0], hi, prev[1]);
    }
    prev = [lo, hi];
  }
}

// Flat disc (a round joint or end) of radius r at height z.
function disc(mesh: Mesh, c: XY, r: number, z: number, col: RGB, pat: number, w: number): void {
  const SEG = 12;
  const mid = mesh.vert(c[0], c[1], z, [0, 0, 1], col, [0, 0, -w, pat]);
  const ring: number[] = [];
  for (let k = 0; k < SEG; k++) {
    const a = (k / SEG) * Math.PI * 2;
    ring.push(mesh.vert(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r, z, [0, 0, 1], col, [0, r, -w, pat]));
  }
  for (let k = 0; k < SEG; k++) mesh.idx(mid, ring[k], ring[(k + 1) % SEG]);
}

// Height factor 0..1 rising over `ramp` metres at both ends of a chain `len` long.
const ramped = (s: number, len: number, ramp: number): number => {
  const e = Math.min(s, len - s) / Math.max(ramp, 1e-6);
  const t = Math.min(1, Math.max(0, e));
  return t * t * (3 - 2 * t);
};

// Stations every `every` metres between s0 and s1 (nearest stations), for posts and piles.
function every(st: readonly Station[], s0: number, s1: number, step: number): Station[] {
  const out: Station[] = [];
  if (s1 < s0) return out;
  const n = Math.max(1, Math.round((s1 - s0) / step));
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = s0 + ((s1 - s0) * k) / n;
    while (j + 1 < st.length && Math.abs(st[j + 1].s - s) <= Math.abs(st[j].s - s)) j++;
    out.push(st[j]);
  }
  return out;
}

const stationIndex = (st: readonly Station[], x: Station) => st.indexOf(x);

function groundRoad(mesh: Mesh, pts: readonly XY[], kind: RoadKind): void {
  const st = stations(pts, GROUND_STEP);
  const w = ROAD_KINDS[kind].width, hw = w / 2;
  const z = GROUND_Z[kind] ?? 0.03;
  const pat = kind === "stone" ? PATTERN.cobbles : kind === "dirt" ? PATTERN.ruts : PATTERN.track;
  const col = rgb(kind === "stone" ? PALETTE.roadStone : kind === "dirt" ? PALETTE.roadDirt : PALETTE.roadPath);
  if (!st.length) {
    if (pts.length && Number.isFinite(pts[0][0] + pts[0][1])) disc(mesh, pts[0], hw, z, col, pat, w);
    return;
  }
  strip(mesh, st, hw, -hw, st.map(() => z), col, pat, w);
  for (let i = 0; i < st.length; i++) {
    const end = i === 0 || i === st.length - 1;
    if (end || st[i].k > 1 / Math.cos(JOINT_TURN / 2)) disc(mesh, st[i].p, hw, z, col, pat, w);
  }
}

function footbridge(mesh: Mesh, pts: readonly XY[]): void {
  const st = stations(pts, 0.5);
  if (!st.length) return;
  const len = st[st.length - 1].s, hw = ROAD_KINDS.footbridge.width / 2;
  const deck = rgb(PALETTE.roadBridge), rope = rgb(PALETTE.roadBridgeEdge);
  const z = st.map((q) => ramped(q.s, len, 1.5) * (1.1 - 0.55 * Math.sin((Math.PI * q.s) / Math.max(len, 1e-6))));
  strip(mesh, st, hw, -hw, z, deck, PATTERN.deck, hw * 2);
  for (const side of [1, -1] as const) {
    const off = side * (hw + 0.05);
    wallStrip(mesh, st, off, z.map((v) => v + 0.92), z.map((v) => v + 1), side, rope, PATTERN.plain);
    for (const q of every(st, 1.5, len - 1.5, 1.5)) {
      const p = at(q, off), zi = z[stationIndex(st, q)];
      prism(mesh, square(p[0], p[1], 0.05), zi, zi + 0.95, rope, rope);
    }
    for (const q of [st[0], st[st.length - 1]]) {
      const p = at(q, side * (hw + 0.15));
      prism(mesh, square(p[0], p[1], 0.18), 0, 1.6, rope, shade(rope, 1.2));
    }
  }
}

function pileBridge(mesh: Mesh, pts: readonly XY[]): void {
  const st = stations(pts, 0.5);
  if (!st.length) return;
  const len = st[st.length - 1].s, hw = ROAD_KINDS.bridge.width / 2;
  const H = 1.8, ramp = Math.min(6, len * 0.3);
  const deck = rgb(PALETTE.roadBridge), wood = rgb(PALETTE.roadBridgeEdge);
  const z = st.map((q) => H * ramped(q.s, len, ramp));
  strip(mesh, st, hw, -hw, z, deck, PATTERN.deck, hw * 2);
  for (const side of [1, -1] as const) {
    wallStrip(mesh, st, side * hw, z.map((v) => Math.max(0, v - 0.3)), z, side, shade(deck, 0.75), PATTERN.boards);
    // railing: posts every 2 m on the raised part, a top and a middle rail
    const off = side * (hw - 0.08);
    for (const q of every(st, ramp * 0.5, len - ramp * 0.5, 2)) {
      const p = at(q, off), zi = z[stationIndex(st, q)];
      prism(mesh, square(p[0], p[1], 0.12), zi, zi + 1, wood, wood);
    }
    wallStrip(mesh, st, off, z.map((v) => v + 0.9), z.map((v) => v + 1), side, wood, PATTERN.plain);
    wallStrip(mesh, st, off, z.map((v) => v + 0.45), z.map((v) => v + 0.52), side, wood, PATTERN.plain);
  }
  // piles in pairs under the deck where it stands high, with a cap beam
  for (const q of every(st, ramp, len - ramp, 4.5)) {
    const zi = z[stationIndex(st, q)];
    if (zi < 0.8) continue;
    for (const side of [1, -1]) {
      const p = at(q, side * (hw - 0.35));
      prism(mesh, square(p[0], p[1], 0.3), 0, zi - 0.3, shade(wood, 0.9), wood);
    }
    const a = at(q, hw - 0.2), b = at(q, -(hw - 0.2));
    const tx = q.t[0] * 0.15, ty = q.t[1] * 0.15;
    const beam: XY[] = [[b[0] - tx, b[1] - ty], [a[0] - tx, a[1] - ty], [a[0] + tx, a[1] + ty], [b[0] + tx, b[1] + ty]];
    prism(mesh, beam, zi - 0.5, zi - 0.3, wood, wood);
  }
}

function stoneBridge(mesh: Mesh, pts: readonly XY[]): void {
  const st = stations(pts, 0.4);
  if (!st.length) return;
  const len = st[st.length - 1].s, hw = ROAD_KINDS.stonebridge.width / 2;
  const H = 3.2, ramp = Math.min(8, len * 0.3), PIER = 1.6, CROWN = 0.9;
  const stone = rgb(PALETTE.roadStone), wall = shade(stone, 0.88), top = shade(stone, 1.06);
  const z = st.map((q) => H * ramped(q.s, len, ramp));
  // arches over the raised middle: n spans with piers between them
  const mid = Math.max(0, len - 2 * ramp);
  const n = Math.max(1, Math.round(mid / 12));
  const span = (mid - (n - 1) * PIER) / n;
  const arch = (s: number, zDeck: number): number => {
    const l = s - ramp;
    if (span < 2 || l <= 0 || l >= mid) return 0;
    const r = l % (span + PIER);
    return r < span ? Math.max(0, zDeck - CROWN) * Math.pow(Math.sin((Math.PI * r) / span), 0.6) : 0;
  };
  const zb = st.map((q, i) => Math.min(arch(q.s, z[i]), z[i]));
  strip(mesh, st, hw - 0.35, -(hw - 0.35), z, stone, PATTERN.cobbles, hw * 2);
  strip(mesh, st, hw, -hw, zb, shade(stone, 0.7), PATTERN.plain, hw * 2, true); // the underside of the arches
  for (const side of [1, -1] as const) {
    wallStrip(mesh, st, side * hw, zb, z.map((v) => v + 0.9), side, wall, PATTERN.ashlar);
    wallStrip(mesh, st, side * (hw - 0.35), z, z.map((v) => v + 0.9), (-side) as 1 | -1, wall, PATTERN.ashlar);
    strip(mesh, st, side * hw, side * (hw - 0.35), z.map((v) => v + 0.9), top, PATTERN.plain, hw * 2);
  }
}

// Builds the model of one built road chain (centre line in town metres, chain order).
export function buildRoadModel(pts: readonly XY[], kind: RoadKind): Model {
  const mesh = new Mesh({ cx: 0, cy: 0, ux: 1, uy: 0, len: 0, wid: 0 });
  if (kind === "footbridge") footbridge(mesh, pts);
  else if (kind === "bridge") pileBridge(mesh, pts);
  else if (kind === "stonebridge") stoneBridge(mesh, pts);
  else groundRoad(mesh, pts, kind);
  return mesh.m;
}
