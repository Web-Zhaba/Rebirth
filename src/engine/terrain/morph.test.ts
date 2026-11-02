import { describe, expect, it } from "vitest";
import { buildView, defaultCamera, type CameraState } from "../camera/camera";
import { ecefToGeodetic } from "../geo/ellipsoid";
import { morphBand, morphFactor, morphPair, vertexError } from "./morph";
import { buildNodeVertices, FLOATS_PER_VERTEX, GRID, NODE_FLOATS } from "./nodeMesh";
import { DEFAULT_TAU, MAX_ZOOM, MERGE, NodeCache, projScale, selectNodes, type HeightRanges, type NodeInfo, type SelectView } from "./quadtree";

const flat: HeightRanges = { range: () => ({ min: 0, max: 0, z: 11 }) };
const opts = { tau: DEFAULT_TAU, maxZoom: MAX_ZOOM, maxNodes: 4000 };
const EQUATOR = 2 * Math.PI * 6378137;

function selectView(s: Partial<CameraState>): SelectView {
  const v = buildView({ ...defaultCamera(), ...s }, 1280, 720, () => 0);
  const g = ecefToGeodetic(v.eye);
  return { ...v, eyeLat: g.lat, eyeLng: g.lng, eyeAlt: g.h };
}

// Morph factors of every grid vertex of a node, computed like the vertex shader (flat ground: h = 0).
function morphs(z: number, x: number, y: number, v: SelectView): Float64Array {
  const verts = new Float32Array(NODE_FLOATS);
  const origin = new NodeCache().get(z, x, y).origin;
  buildNodeVertices(z, x, y, origin, verts);
  const band = morphBand(DEFAULT_TAU, MERGE, projScale(v));
  const cellK = (EQUATOR / 2 ** z / (GRID - 1)) * projScale(v);
  const out = new Float64Array(GRID * GRID);
  for (let g = 0; g < GRID * GRID; g++) {
    const o = g * FLOATS_PER_VERTEX;
    const d = Math.hypot(origin[0] + verts[o] - v.eye[0], origin[1] + verts[o + 1] - v.eye[1], origin[2] + verts[o + 2] - v.eye[2]);
    out[g] = morphFactor(vertexError(cellK, Math.hypot(verts[o + 4], verts[o + 5]), d), band.lo, band.hi);
  }
  return out;
}

// Grid indices along a node edge: 0 top, 1 right, 2 bottom, 3 left, in increasing i or j.
function edge(e: number): number[] {
  return Array.from({ length: GRID }, (_, t) => (e === 0 ? t : e === 1 ? t * GRID + GRID - 1 : e === 2 ? (GRID - 1) * GRID + t : t * GRID));
}

const VIEWS: Partial<CameraState>[] = [
  { lat: 47.2692, lng: 11.4041, distance: 9000, pitch: 75, heading: 40 },
  { lat: 47.27, lng: 11.4, distance: 3000, pitch: 30 },
  { lat: 60, lng: 179.99, distance: 40, pitch: 70, heading: 90 },
  { lat: 0.01, lng: 0.01, distance: 400_000, pitch: 50 },
];

describe("geomorph targets", () => {
  it("puts every vertex halfway between two vertices of the parent's grid, on the parent's triangles", () => {
    for (let j = 0; j < GRID; j++)
      for (let i = 0; i < GRID; i++) {
        const [a, b] = morphPair(i, j);
        for (const g of [a, b]) {
          expect(g).toBeGreaterThanOrEqual(0);
          expect(g).toBeLessThan(GRID * GRID);
          expect((g % GRID) % 2).toBe(0);
          expect(Math.floor(g / GRID) % 2).toBe(0);
        }
        // Midpoint in grid space is the vertex itself.
        expect(((a % GRID) + (b % GRID)) / 2).toBe(i);
        expect((Math.floor(a / GRID) + Math.floor(b / GRID)) / 2).toBe(j);
        // Odd/odd vertices sit on the parent quad's (i+1, j) - (i, j+1) diagonal, the one buildIndices splits along.
        if (i % 2 && j % 2) expect([a % GRID, Math.floor(a / GRID)]).toEqual([i + 1, j - 1]);
      }
  });

  it("morphs fully below lo, not at all above hi, monotonically between", () => {
    const { lo, hi } = morphBand(8, MERGE, 1080);
    expect(lo).toBe(4);
    expect(hi).toBeGreaterThan(lo);
    expect(hi).toBeLessThanOrEqual(8 * MERGE);
    expect(morphFactor(lo * 0.5, lo, hi)).toBe(1);
    expect(morphFactor(lo, lo, hi)).toBe(1);
    expect(morphFactor(hi, lo, hi)).toBe(0);
    expect(morphFactor(hi * 3, lo, hi)).toBe(0);
    let prev = 1;
    for (let s = lo; s <= hi; s += (hi - lo) / 20) {
      const m = morphFactor(s, lo, hi);
      expect(m).toBeLessThanOrEqual(prev + 1e-12);
      prev = m;
    }
  });

  it("measures a vertex's error like the node does: falling with distance and towards the poles", () => {
    expect(vertexError(100, 1, 10) / vertexError(100, 1, 100)).toBeCloseTo(10);
    expect(vertexError(100, 0.5, 10)).toBeCloseTo(vertexError(100, 1, 10) / 2);
  });
});

describe("geomorphing against the selection", () => {
  it("matches a coarser neighbour exactly: the finer edge is fully morphed, the coarser one not at all", () => {
    let checked = 0;
    for (const s of VIEWS) {
      const v = selectView(s);
      const sel = selectNodes(v, new NodeCache(), flat, new Set(), opts);
      const keys = new Set(sel.nodes.map((n) => `${n.z}/${n.x}/${n.y}`));
      for (const a of sel.nodes) {
        if (a.z < 2) continue;
        const n = 2 ** a.z;
        const ma = morphs(a.z, a.x, a.y, v);
        // Neighbour across each edge: same-level tile not selected, but its parent is (the coarser neighbour B).
        const across = [
          [0, -1, 0],
          [1, 0, 1],
          [0, 1, 2],
          [-1, 0, 3],
        ];
        for (const [dx, dy, e] of across) {
          const ny = a.y + dy;
          if (ny < 0 || ny >= n) continue;
          const nx = (((a.x + dx) % n) + n) % n;
          if (keys.has(`${a.z}/${nx}/${ny}`)) continue;
          const b = { z: a.z - 1, x: nx >> 1, y: ny >> 1 };
          if (!keys.has(`${b.z}/${b.x}/${b.y}`)) continue;
          for (const g of edge(e)) expect(ma[g]).toBe(1);
          // B's edge facing A (the opposite side), the half that A covers.
          const mb = morphs(b.z, b.x, b.y, v);
          const facing = edge((e + 2) % 4);
          const half = dx !== 0 ? (a.y & 1) : (a.x & 1);
          for (let t = half * 16; t <= half * 16 + 16; t++) expect(mb[facing[t]]).toBe(0);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("never morphs a split node, so merging it back does not pop (hysteresis included)", () => {
    for (const s of VIEWS) {
      const cache = new NodeCache();
      const s1 = selectNodes(selectView(s), cache, flat, new Set(), opts);
      // Back off a little: nodes held split by the hysteresis are the closest to merging.
      const v2 = selectView({ ...s, distance: s.distance! * 1.08 });
      const s2 = selectNodes(v2, cache, flat, new Set(s1.split), opts);
      const parents = new Map<string, NodeInfo>();
      for (const n of s2.nodes) if (n.z > 0) parents.set(`${n.z - 1}/${n.x >> 1}/${n.y >> 1}`, n);
      for (const key of parents.keys()) {
        const [z, x, y] = key.split("/").map(Number);
        const m = morphs(z, x, y, v2);
        for (const f of m) expect(f).toBe(0);
      }
    }
  });

  it("shows a node's children fully morphed the moment it splits", () => {
    let fresh = 0;
    for (const s of VIEWS) {
      const cache = new NodeCache();
      let prev = selectNodes(selectView(s), cache, flat, new Set(), opts);
      // Approach in small steps, as frames do: some leaves split on the way.
      for (let step = 1; step <= 20; step++) {
        const v = selectView({ ...s, distance: s.distance! * 0.995 ** step });
        const leaves = new Set(prev.nodes.map((n) => n.key));
        const next = selectNodes(v, cache, flat, new Set(prev.split), opts);
        for (const n of next.nodes) {
          if (n.z === 0 || !leaves.has(cache.get(n.z - 1, n.x >> 1, n.y >> 1).key)) continue;
          fresh++;
          for (const f of morphs(n.z, n.x, n.y, v)) expect(f).toBeGreaterThan(0.95);
        }
        prev = next;
      }
    }
    expect(fresh).toBeGreaterThan(0);
  });
});
