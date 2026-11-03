import type { VectorTile } from "@mapbox/vector-tile";
import { heritageKind } from "../sim/heritage";
import type { Frame } from "./frame";
import { lngLatToTile } from "./mercator";
import { loadVector } from "./tiles";
import { lang } from "../i18n";

// The buried city: OpenFreeMap z14 features inside the revealed discs, in local meters
// (x east, y north). Pure geometry is exported separately so it can be tested offline.

export const OLDWORLD_ZOOM = 14;
export const HINT_BAND = 60; // m beyond a disc where notable POIs are still read (for typing and hints)

export type XY = [number, number];
export interface Disc {
  x: number;
  y: number;
  r: number;
}
export interface Foundation {
  id: string;
  ring: XY[];
  area: number;
  height?: number;
}
export interface Street {
  id: string;
  cls: string;
  name?: string;
  bridge?: true; // the way runs on a bridge
  pts: XY[];
}
export interface Poi {
  id: string;
  name: string;
  cls: string;
  subclass: string;
  x: number;
  y: number;
}
// A notable POI (curated class, named or not) inside a disc or in the band around it.
export interface Spot {
  id: string;
  name?: string;
  cls: string;
  subclass: string;
  x: number;
  y: number;
}
export interface OldWorld {
  foundations: Foundation[];
  streets: Street[];
  pois: Poi[];
  spots: Spot[];
}

export const STREET_CLASSES = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "service",
  "track",
  "path",
];

// ---------- pure geometry ----------

// Tile pixel (0..extent, y down) to lng/lat (inverse Web Mercator).
export function tilePointToLngLat(z: number, tx: number, ty: number, extent: number, px: number, py: number): XY {
  const n = 2 ** z;
  const lng = ((tx + px / extent) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + py / extent)) / n))) * 180) / Math.PI;
  return [lng, lat];
}

function signedArea(ring: XY[]): number {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return s / 2;
}

export function ringArea(ring: XY[]): number {
  return Math.abs(signedArea(ring));
}

// Area centroid; falls back to the vertex mean for degenerate rings.
export function ringCentroid(ring: XY[]): XY {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = ring.length || 1;
    return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function inDiscs(x: number, y: number, discs: Disc[]): boolean {
  for (const d of discs) if ((x - d.x) ** 2 + (y - d.y) ** 2 <= d.r * d.r) return true;
  return false;
}

export const growDiscs = (discs: Disc[], m: number): Disc[] => discs.map((d) => ({ x: d.x, y: d.y, r: d.r + m }));

// Parameter interval [t0, t1] (within 0..1) of segment a->b inside the disc, or null.
export function segmentDiscInterval(a: XY, b: XY, d: Disc): [number, number] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const fx = a[0] - d.x;
  const fy = a[1] - d.y;
  const A = dx * dx + dy * dy;
  if (A === 0) return fx * fx + fy * fy <= d.r * d.r ? [0, 1] : null;
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - d.r * d.r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  const t0 = Math.max(0, (-B - s) / (2 * A));
  const t1 = Math.min(1, (-B + s) / (2 * A));
  return t0 <= t1 ? [t0, t1] : null;
}

// Clip a polyline exactly to the union of discs; returns the pieces (each >= 2 points).
export function clipPolylineToDiscs(pts: XY[], discs: Disc[]): XY[][] {
  const out: XY[][] = [];
  let cur: XY[] = [];
  const flush = () => {
    if (cur.length >= 2) out.push(cur);
    cur = [];
  };
  const eq = (p: XY, q: XY) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const ivs: [number, number][] = [];
    for (const d of discs) {
      const iv = segmentDiscInterval(a, b, d);
      if (iv) ivs.push(iv);
    }
    ivs.sort((p, q) => p[0] - q[0]);
    const merged: [number, number][] = [];
    for (const iv of ivs) {
      const last = merged[merged.length - 1];
      if (last && iv[0] <= last[1] + 1e-9) last[1] = Math.max(last[1], iv[1]);
      else merged.push([iv[0], iv[1]]);
    }
    if (!merged.length) {
      flush();
      continue;
    }
    for (const [t0, t1] of merged) {
      const p: XY = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      const q: XY = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      if (cur.length && !eq(cur[cur.length - 1], p)) flush();
      if (!cur.length) cur.push(p);
      cur.push(q);
      if (t1 < 1) flush();
    }
  }
  flush();
  return out;
}

export function distToPolyline(x: number, y: number, pts: XY[]): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const dx = pts[i + 1][0] - ax;
    const dy = pts[i + 1][1] - ay;
    const L = dx * dx + dy * dy;
    const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

// Drop buildings with the same OSM key (`osm` field) or the same centroid within 0.5 m.
export function dedupeFoundations(list: (Foundation & { osm?: string })[]): Foundation[] {
  const seenOsm = new Set<string>();
  const kept: { f: Foundation; c: XY }[] = [];
  for (const f of list) {
    if (f.osm) {
      if (seenOsm.has(f.osm)) continue;
      seenOsm.add(f.osm);
    }
    const c = ringCentroid(f.ring);
    if (kept.some((k) => Math.abs(k.c[0] - c[0]) <= 0.5 && Math.abs(k.c[1] - c[1]) <= 0.5)) continue;
    const { osm: _osm, ...rest } = f;
    kept.push({ f: rest, c });
  }
  return kept.map((k) => k.f);
}

// Street names: a transportation line takes the name of the nearest transportation_name
// line (within `tol` m) measured at the midpoint of its longest segment.
export function matchStreetName(pts: XY[], named: { name: string; pts: XY[] }[], tol = 4): string | undefined {
  let bi = 0;
  let bl = -1;
  for (let i = 0; i + 1 < pts.length; i++) {
    const l = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    if (l > bl) {
      bl = l;
      bi = i;
    }
  }
  if (bl < 0) return undefined;
  const mx = (pts[bi][0] + pts[bi + 1][0]) / 2;
  const my = (pts[bi][1] + pts[bi + 1][1]) / 2;
  let best: string | undefined;
  let bd = tol;
  for (const n of named) {
    const d = distToPolyline(mx, my, n.pts);
    if (d <= bd) {
      bd = d;
      best = n.name;
    }
  }
  return best;
}

// z14 tiles touching the bounding boxes of the discs.
export function tilesForDiscs(frame: Frame, discs: Disc[], z = OLDWORLD_ZOOM): { x: number; y: number }[] {
  const set = new Map<string, { x: number; y: number }>();
  const n = 2 ** z;
  for (const d of discs) {
    const [lng0, lat0] = frame.toLngLat(d.x - d.r, d.y - d.r);
    const [lng1, lat1] = frame.toLngLat(d.x + d.r, d.y + d.r);
    const a = lngLatToTile(lng0, lat1, z);
    const b = lngLatToTile(lng1, lat0, z);
    const x1 = Math.max(Math.floor(a.x), Math.floor(b.x - 1e-9));
    const y1 = Math.max(Math.floor(a.y), Math.floor(b.y - 1e-9));
    for (let x = Math.floor(a.x); x <= x1; x++)
      for (let y = Math.floor(a.y); y <= y1; y++)
        if (y >= 0 && y < n) set.set(`${x}/${y}`, { x: ((x % n) + n) % n, y });
  }
  return [...set.values()];
}

// ---------- tile parsing ----------

const nameOf = (p: Record<string, unknown>): string | undefined => {
  const v = p[`name:${lang}`] ?? p.name;
  return typeof v === "string" && v ? v : undefined;
};
const idOf = (f: { id?: number }): string | undefined => (f.id === undefined || f.id === null ? undefined : String(f.id));

// ---------- buildings across tile borders ----------

// A vector tile cuts a building at its edge plus a 64 px buffer, so a building on a tile border comes once from every
// tile it touches, each copy cut differently and not always under the same id. Each copy is cut again exactly at the
// borders with the other loaded tiles, and pieces from different tiles that share a stretch of a border are joined back
// along it, whatever their ids: the edges they share on the border cancel out.

const TILE_PX = 4096; // world pixels per tile at the tile zoom, whatever a tile's own extent
const SEAM_SNAP = 2; // px (~0.7 m at z14): two cuts of one edge meet a border this close

// One outer ring of a building as one tile has it, in world pixels (y down), positive signed area.
export interface BuildingPiece {
  id: string; // the foundation id this piece alone would have
  tile: string; // "x/y"
  ring: XY[];
  height?: number;
}

// Sutherland-Hodgman against the window x0..x1, y0..y1 (an infinite side cuts nothing).
function clipToBox(ring: XY[], x0: number, y0: number, x1: number, y1: number): XY[] {
  const sides: [0 | 1, number, number][] = [
    [0, x0, 1],
    [0, x1, -1],
    [1, y0, 1],
    [1, y1, -1],
  ];
  let out = ring;
  for (const [axis, v, sign] of sides) {
    if (!Number.isFinite(v) || out.length === 0) continue;
    const src = out;
    out = [];
    const inside = (p: XY) => (p[axis] - v) * sign >= 0;
    for (let i = 0; i < src.length; i++) {
      const a = src[(i + src.length - 1) % src.length];
      const b = src[i];
      if (inside(a) !== inside(b)) {
        const t = (v - a[axis]) / (b[axis] - a[axis]);
        out.push(axis === 0 ? [v, a[1] + (b[1] - a[1]) * t] : [a[0] + (b[0] - a[0]) * t, v]);
      }
      if (inside(b)) out.push(b);
    }
  }
  return out;
}

// The building rings of one tile, cut at the borders with the loaded neighbours (`loaded(x, y)`).
export function buildingPieces(vt: VectorTile | null, tx: number, ty: number, loaded: (x: number, y: number) => boolean): BuildingPiece[] {
  const bl = vt?.layers.building;
  if (!bl) return [];
  const k = TILE_PX / bl.extent;
  const gx0 = tx * TILE_PX;
  const gy0 = ty * TILE_PX;
  const x0 = loaded(tx - 1, ty) ? gx0 : -Infinity;
  const x1 = loaded(tx + 1, ty) ? gx0 + TILE_PX : Infinity;
  const y0 = loaded(tx, ty - 1) ? gy0 : -Infinity;
  const y1 = loaded(tx, ty + 1) ? gy0 + TILE_PX : Infinity;
  const out: BuildingPiece[] = [];
  for (let i = 0; i < bl.length; i++) {
    const f = bl.feature(i);
    if (f.type !== 3) continue;
    const osm = idOf(f);
    const h = f.properties.render_height;
    const rings = f.loadGeometry().map((r) => r.map((p): XY => [gx0 + p.x * k, gy0 + p.y * k]));
    // First ring is outer; further rings of the same orientation are more outer parts, others holes.
    const sign = Math.sign(signedArea(rings[0] ?? []));
    let part = 0;
    for (const ring of rings) {
      if (ring.length < 3 || Math.sign(signedArea(ring)) !== sign) continue;
      const n = part++;
      const suffix = n ? `.${n}` : "";
      const cut = clipToBox(sign < 0 ? ring.slice().reverse() : ring, x0, y0, x1, y1);
      const r = cut.filter((p, j) => p[0] !== cut[(j + 1) % cut.length][0] || p[1] !== cut[(j + 1) % cut.length][1]);
      if (r.length < 3 || signedArea(r) <= 0) continue;
      const piece: BuildingPiece = { id: osm ? `osm:${osm}${suffix}` : `${OLDWORLD_ZOOM}/${tx}/${ty}#${i}${suffix}`, tile: `${tx}/${ty}`, ring: r };
      if (typeof h === "number") piece.height = h;
      out.push(piece);
    }
  }
  return out;
}

const onSeam = (v: number) => v % TILE_PX === 0;
const pushTo = <K, V>(m: Map<K, V[]>, k: K, v: V) => (m.get(k) ?? m.set(k, []).get(k)!).push(v);

// The pieces that meet across a border, in bunches (one building each): two pieces from different tiles are in one
// bunch when they have a stretch of the same border in common. A bunch that fails to join leaves the others alone.
function seamBunches(pieces: BuildingPiece[]): BuildingPiece[][] {
  const lines = new Map<string, { i: number; lo: number; hi: number }[]>();
  pieces.forEach((pc, i) => {
    for (let k = 0; k < pc.ring.length; k++) {
      const a = pc.ring[k];
      const b = pc.ring[(k + 1) % pc.ring.length];
      if (a[0] === b[0] && onSeam(a[0])) pushTo(lines, `x:${a[0]}`, { i, lo: Math.min(a[1], b[1]), hi: Math.max(a[1], b[1]) });
      else if (a[1] === b[1] && onSeam(a[1])) pushTo(lines, `y:${a[1]}`, { i, lo: Math.min(a[0], b[0]), hi: Math.max(a[0], b[0]) });
    }
  });
  const root = pieces.map((_, i) => i);
  const find = (i: number): number => (root[i] === i ? i : (root[i] = find(root[i])));
  for (const list of lines.values()) {
    list.sort((a, b) => a.lo - b.lo);
    for (let m = 0; m < list.length; m++)
      for (let n = m + 1; n < list.length && list[n].lo < list[m].hi - SEAM_SNAP; n++) {
        const s = list[m];
        const t = list[n];
        if (pieces[s.i].tile !== pieces[t.i].tile && Math.min(s.hi, t.hi) - t.lo > SEAM_SNAP) root[find(s.i)] = find(t.i);
      }
  }
  const bunches = new Map<number, BuildingPiece[]>();
  pieces.forEach((pc, i) => pushTo(bunches, find(i), pc));
  return [...bunches.values()];
}

// A bunch of pieces joined along the tile borders; null when they do not chain into rings (then the pieces stand as they
// are).
function joinPieces(pieces: BuildingPiece[]): { ring: XY[]; from: BuildingPiece }[] | null {
  // Where the cuts of one edge meet a border: the positions along each border line, clustered and snapped together.
  const along = new Map<string, number[]>(); // "x:4096" / "y:8192" -> positions along that line
  for (const pc of pieces)
    for (const [x, y] of pc.ring) {
      if (onSeam(x)) pushTo(along, `x:${x}`, y);
      if (onSeam(y)) pushTo(along, `y:${y}`, x);
    }
  const snapOf = new Map<string, Map<number, number>>();
  for (const [line, vs] of along) {
    vs.sort((a, b) => a - b);
    const m = new Map<number, number>();
    for (let i = 0; i < vs.length; ) {
      let j = i;
      while (j + 1 < vs.length && vs[j + 1] - vs[j] <= SEAM_SNAP) j++;
      for (let t = i; t <= j; t++) m.set(vs[t], vs[i]);
      i = j + 1;
    }
    snapOf.set(line, m);
  }
  const snap = ([x, y]: XY): XY => [onSeam(y) ? snapOf.get(`y:${y}`)!.get(x)! : x, onSeam(x) ? snapOf.get(`x:${x}`)!.get(y)! : y];

  type Edge = { a: XY; b: XY; from: BuildingPiece | null; used?: boolean };
  const edges: Edge[] = [];
  const cover = new Map<string, Map<number, number>>(); // border line -> position -> change of the directed cover
  for (const pc of pieces) {
    const r = pc.ring.map(snap);
    for (let i = 0; i < r.length; i++) {
      const a = r[i];
      const b = r[(i + 1) % r.length];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const axis = a[0] === b[0] && onSeam(a[0]) ? 0 : a[1] === b[1] && onSeam(a[1]) ? 1 : -1;
      if (axis < 0) {
        edges.push({ a, b, from: pc });
        continue;
      }
      const u = a[1 - axis];
      const v = b[1 - axis];
      const s = v > u ? 1 : -1;
      const line = axis === 0 ? `x:${a[0]}` : `y:${a[1]}`;
      const m = cover.get(line) ?? cover.set(line, new Map()).get(line)!;
      m.set(Math.min(u, v), (m.get(Math.min(u, v)) ?? 0) + s);
      m.set(Math.max(u, v), (m.get(Math.max(u, v)) ?? 0) - s);
    }
  }
  // What is left on a border after opposite edges cancel, one edge per stretch between two snapped positions.
  for (const [line, m] of cover) {
    const at = Number(line.slice(2));
    const pt = (u: number): XY => (line[0] === "x" ? [at, u] : [u, at]);
    const vs = [...m.keys()].sort((a, b) => a - b);
    let sum = 0;
    for (let i = 0; i + 1 < vs.length; i++) {
      sum += m.get(vs[i])!;
      if (sum > 0) edges.push({ a: pt(vs[i]), b: pt(vs[i + 1]), from: null });
      else if (sum < 0) edges.push({ a: pt(vs[i + 1]), b: pt(vs[i]), from: null });
    }
  }

  const key = (p: XY) => `${p[0]},${p[1]}`;
  const starts = new Map<string, Edge[]>();
  for (const e of edges) pushTo(starts, key(e.a), e);
  // Where parts of the building touch, several edges leave one point: the ring goes on along the tightest turn
  // (the least clockwise from the way back), so that it keeps to its own part.
  const next = (e: Edge): Edge | undefined => {
    const bx = e.a[0] - e.b[0];
    const by = e.a[1] - e.b[1];
    let best: Edge | undefined;
    let bestTurn = Infinity;
    for (const x of starts.get(key(e.b)) ?? []) {
      if (x.used) continue;
      const dx = x.b[0] - x.a[0];
      const dy = x.b[1] - x.a[1];
      let turn = -Math.atan2(bx * dy - by * dx, bx * dx + by * dy);
      if (turn <= 0) turn += 2 * Math.PI;
      if (turn < bestTurn) (bestTurn = turn), (best = x);
    }
    return best;
  };
  const out: { ring: XY[]; from: BuildingPiece }[] = [];
  for (const e0 of edges) {
    if (e0.used) continue;
    const ring: XY[] = [];
    const len = new Map<BuildingPiece, number>();
    let e: Edge | undefined = e0;
    let closed = false;
    while (e) {
      e.used = true;
      ring.push(e.a);
      if (e.from) len.set(e.from, (len.get(e.from) ?? 0) + Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]));
      e0.used = e === e0; // back at the start: the first edge competes with the others leaving there
      const n = next(e);
      e0.used = true;
      if (n === e0) {
        closed = true;
        break;
      }
      e = n;
    }
    if (!closed) return null; // an open chain: the cuts did not meet
    // drop the points where a border stretch goes on straight
    const clean = ring.filter((p, i) => {
      const a = ring[(i + ring.length - 1) % ring.length];
      const b = ring[(i + 1) % ring.length];
      return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1]));
    });
    if (clean.length < 3 || signedArea(clean) <= 0) continue; // a courtyard: holes are not kept
    let from: BuildingPiece | null = null;
    for (const [pc, l] of len) if (!from || l > len.get(from)!) from = pc;
    if (from) out.push({ ring: clean, from });
  }
  return out;
}

// Foundations from the building pieces of all loaded tiles: each building joined across the borders, in local meters,
// kept when its centroid is inside a disc. A joined ring keeps the id of the piece giving most of its outline.
export function joinBuildings(pieces: BuildingPiece[], z: number, frame: Frame, discs: Disc[]): Foundation[] {
  const toLocal = (p: XY): XY => frame.toLocal(...tilePointToLngLat(z, 0, 0, TILE_PX, p[0], p[1]));
  const as = (pc: BuildingPiece) => ({ ring: pc.ring, from: pc });
  // only the pieces cut at a border are joined; the rest (parts of one building may overlap) stand as they are
  const isCut = (pc: BuildingPiece) => pc.ring.some(([x, y]) => onSeam(x) || onSeam(y));
  const rings = [
    ...pieces.filter((pc) => !isCut(pc)).map(as),
    ...seamBunches(pieces.filter(isCut)).flatMap((b) => (b.length > 1 ? joinPieces(b) : null) ?? b.map(as)),
  ];
  rings.sort((a, b) => signedArea(b.ring) - signedArea(a.ring));
  const found: Foundation[] = [];
  const ids = new Set<string>();
  for (const { ring: px, from } of rings) {
    const ring = px.map(toLocal);
    const [cx, cy] = ringCentroid(ring);
    if (!inDiscs(cx, cy, discs)) continue;
    let id = from.id;
    for (let n = 2; ids.has(id); n++) id = `${from.id}~${n}`;
    ids.add(id);
    const fd: Foundation = { id, ring, area: ringArea(ring) };
    if (from.height !== undefined) fd.height = from.height;
    found.push(fd);
  }
  return dedupeFoundations(found);
}

// Parse one decoded tile and keep the features inside the discs (local meters).
export function parseOldWorldTile(
  vt: VectorTile | null,
  z: number,
  tx: number,
  ty: number,
  frame: Frame,
  discs: Disc[],
  band = HINT_BAND,
): OldWorld {
  return { ...parseTileFeatures(vt, z, tx, ty, frame, discs, band), foundations: joinBuildings(buildingPieces(vt, tx, ty, () => false), z, frame, discs) };
}

// Streets, POIs and spots of one tile (buildings come apart: joinBuildings joins them across tiles).
function parseTileFeatures(
  vt: VectorTile | null,
  z: number,
  tx: number,
  ty: number,
  frame: Frame,
  discs: Disc[],
  band: number,
): OldWorld {
  const out: OldWorld = { foundations: [], streets: [], pois: [], spots: [] };
  if (!vt) return out;
  const conv = (extent: number) => (p: { x: number; y: number }): XY => {
    const [lng, lat] = tilePointToLngLat(z, tx, ty, extent, p.x, p.y);
    return frame.toLocal(lng, lat);
  };
  const tag = `${z}/${tx}/${ty}`;
  const wide = growDiscs(discs, band);


  const named: { name: string; pts: XY[] }[] = [];
  const tn = vt.layers.transportation_name;
  if (tn) {
    const c = conv(tn.extent);
    for (let i = 0; i < tn.length; i++) {
      const f = tn.feature(i);
      const name = f.type === 2 ? nameOf(f.properties) : undefined;
      if (!name) continue;
      for (const line of f.loadGeometry()) named.push({ name, pts: line.map(c) });
    }
  }
  const tl = vt.layers.transportation;
  if (tl) {
    const c = conv(tl.extent);
    for (let i = 0; i < tl.length; i++) {
      const f = tl.feature(i);
      const cls = f.properties.class;
      if (f.type !== 2 || typeof cls !== "string" || !STREET_CLASSES.includes(cls)) continue;
      if (f.properties.brunnel === "tunnel") continue;
      const own = nameOf(f.properties);
      let k = 0;
      for (const line of f.loadGeometry()) {
        for (const piece of clipPolylineToDiscs(line.map(c), discs)) {
          const s: Street = { id: `${tag}#${i}.${k++}`, cls, pts: piece };
          const name = own ?? matchStreetName(piece, named);
          if (name) s.name = name;
          if (f.properties.brunnel === "bridge") s.bridge = true;
          out.streets.push(s);
        }
      }
    }
  }

  const pl = vt.layers.poi;
  if (pl) {
    const c = conv(pl.extent);
    for (let i = 0; i < pl.length; i++) {
      const f = pl.feature(i);
      if (f.type !== 1) continue;
      const name = nameOf(f.properties);
      const cls = String(f.properties.class ?? "");
      const subclass = String(f.properties.subclass ?? "");
      const notable = heritageKind(cls, subclass) !== null;
      if (!name && !notable) continue;
      const g = f.loadGeometry()[0]?.[0];
      if (!g) continue;
      const [x, y] = c(g);
      const id = idOf(f);
      const key = id ? `osm:${id}` : `${tag}#${i}`;
      if (notable && inDiscs(x, y, wide)) out.spots.push({ id: key, ...(name ? { name } : {}), cls, subclass, x, y });
      if (name && inDiscs(x, y, discs)) out.pois.push({ id: key, name, cls, subclass, x, y });
    }
  }
  return out;
}

// Merge per-tile results: buildings de-duplicated across tile borders, POIs by id or name+position.
export function mergeOldWorld(parts: OldWorld[]): OldWorld {
  const poiKeys = new Set<string>();
  const pois: Poi[] = [];
  for (const p of parts.flatMap((o) => o.pois)) {
    const key = `${p.name}@${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;
    if (poiKeys.has(p.id) || poiKeys.has(key)) continue;
    poiKeys.add(p.id);
    poiKeys.add(key);
    pois.push(p);
  }
  const spotKeys = new Set<string>();
  const spots: Spot[] = [];
  for (const p of parts.flatMap((o) => o.spots)) {
    const key = `${p.name ?? ""}@${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;
    if (spotKeys.has(p.id) || spotKeys.has(key)) continue;
    spotKeys.add(p.id);
    spotKeys.add(key);
    spots.push(p);
  }
  return {
    foundations: dedupeFoundations(parts.flatMap((o) => o.foundations)),
    streets: parts.flatMap((o) => o.streets),
    pois,
    spots,
  };
}

export async function loadOldWorld(frame: Frame, discs: Disc[]): Promise<OldWorld> {
  const tiles = tilesForDiscs(frame, growDiscs(discs, HINT_BAND)); // the band around a disc too: hints and typing
  const vts = await Promise.all(tiles.map((t) => loadVector(OLDWORLD_ZOOM, t.x, t.y)));
  const loaded = new Set(tiles.map((t) => `${t.x}/${t.y}`));
  const has = (x: number, y: number) => loaded.has(`${x}/${y}`);
  const world = mergeOldWorld(tiles.map((t, i) => parseTileFeatures(vts[i], OLDWORLD_ZOOM, t.x, t.y, frame, discs, HINT_BAND)));
  const pieces = tiles.flatMap((t, i) => buildingPieces(vts[i] ?? null, t.x, t.y, has));
  return { ...world, foundations: joinBuildings(pieces, OLDWORLD_ZOOM, frame, discs) };
}
