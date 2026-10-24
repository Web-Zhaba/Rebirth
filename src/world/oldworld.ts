import type { VectorTile } from "@mapbox/vector-tile";
import type { Frame } from "./frame";
import { lngLatToTile } from "./mercator";
import { loadVector } from "./tiles";

// The buried city: OpenFreeMap z14 features inside the revealed discs, in local meters
// (x east, y north). Pure geometry is exported separately so it can be tested offline.

export const OLDWORLD_ZOOM = 14;

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
export interface OldWorld {
  foundations: Foundation[];
  streets: Street[];
  pois: Poi[];
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
  const v = p["name:ru"] ?? p.name;
  return typeof v === "string" && v ? v : undefined;
};
const idOf = (f: { id?: number }): string | undefined => (f.id === undefined || f.id === null ? undefined : String(f.id));

// Parse one decoded tile and keep the features inside the discs (local meters).
export function parseOldWorldTile(
  vt: VectorTile | null,
  z: number,
  tx: number,
  ty: number,
  frame: Frame,
  discs: Disc[],
): OldWorld {
  const out: OldWorld = { foundations: [], streets: [], pois: [] };
  if (!vt) return out;
  const conv = (extent: number) => (p: { x: number; y: number }): XY => {
    const [lng, lat] = tilePointToLngLat(z, tx, ty, extent, p.x, p.y);
    return frame.toLocal(lng, lat);
  };
  const tag = `${z}/${tx}/${ty}`;

  const bl = vt.layers.building;
  const found: (Foundation & { osm?: string })[] = [];
  if (bl) {
    const c = conv(bl.extent);
    for (let i = 0; i < bl.length; i++) {
      const f = bl.feature(i);
      if (f.type !== 3) continue;
      const osm = idOf(f);
      const h = f.properties.render_height;
      const rings = f.loadGeometry().map((r) => r.map(c));
      // First ring is outer; further rings of the same orientation are more outer parts, others holes.
      const sign = Math.sign(signedArea(rings[0] ?? []));
      let part = 0;
      for (const ring of rings) {
        if (ring.length < 3 || Math.sign(signedArea(ring)) !== sign) continue;
        const k = part++;
        const [cx, cy] = ringCentroid(ring);
        if (!inDiscs(cx, cy, discs)) continue;
        const suffix = k ? `.${k}` : "";
        const fd: Foundation & { osm?: string } = {
          id: osm ? `osm:${osm}${suffix}` : `${tag}#${i}${suffix}`,
          ring,
          area: ringArea(ring),
        };
        if (typeof h === "number") fd.height = h;
        if (osm) fd.osm = `${osm}${suffix}`;
        found.push(fd);
      }
    }
  }
  out.foundations = dedupeFoundations(found);

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
      const name = f.type === 1 ? nameOf(f.properties) : undefined;
      if (!name) continue;
      const g = f.loadGeometry()[0]?.[0];
      if (!g) continue;
      const [x, y] = c(g);
      if (!inDiscs(x, y, discs)) continue;
      const osm = idOf(f);
      out.pois.push({
        id: osm ? `osm:${osm}` : `${tag}#${i}`,
        name,
        cls: String(f.properties.class ?? ""),
        subclass: String(f.properties.subclass ?? ""),
        x,
        y,
      });
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
  return {
    foundations: dedupeFoundations(parts.flatMap((o) => o.foundations)),
    streets: parts.flatMap((o) => o.streets),
    pois,
  };
}

export async function loadOldWorld(frame: Frame, discs: Disc[]): Promise<OldWorld> {
  const tiles = tilesForDiscs(frame, discs);
  const parts = await Promise.all(
    tiles.map(async (t) =>
      parseOldWorldTile(await loadVector(OLDWORLD_ZOOM, t.x, t.y), OLDWORLD_ZOOM, t.x, t.y, frame, discs),
    ),
  );
  return mergeOldWorld(parts);
}
