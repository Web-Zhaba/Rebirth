import { describe, expect, it } from "vitest";
import { buildView, defaultCamera, type CameraState } from "../camera/camera";
import { ecefToGeodetic } from "../geo/ellipsoid";
import { lngLatToTile, tileAt } from "../geo/mercator";
import { DEFAULT_TAU, MAX_ZOOM, NodeCache, screenSpaceError, selectNodes, type HeightRanges, type SelectView } from "./quadtree";

const flat: HeightRanges = { range: () => ({ min: 0, max: 0, z: 11 }) };
const opts = { tau: DEFAULT_TAU, maxZoom: MAX_ZOOM, maxNodes: 4000 };

function selectView(s: Partial<CameraState>): SelectView {
  const v = buildView({ ...defaultCamera(), ...s }, 1280, 720, () => 0);
  const g = ecefToGeodetic(v.eye);
  return { ...v, eyeLat: g.lat, eyeLng: g.lng, eyeAlt: g.h };
}

type T = { z: number; x: number; y: number };
const isAncestor = (a: T, b: T) => a.z < b.z && b.x >> (b.z - a.z) === a.x && b.y >> (b.z - a.z) === a.y;

describe("quadtree selection", () => {
  it("never selects a node together with its ancestor", () => {
    for (const s of [
      { lat: 47.2692, lng: 11.4041, distance: 9000, pitch: 75, heading: 40 },
      { lat: 45, lng: 20, distance: 12_000_000, pitch: 0 },
      { lat: 60, lng: 179.99, distance: 20, pitch: 60 },
    ]) {
      const sel = selectNodes(selectView(s), new NodeCache(), flat, new Set(), opts);
      expect(sel.nodes.length).toBeGreaterThan(0);
      for (const a of sel.nodes) for (const b of sel.nodes) expect(isAncestor(a, b)).toBe(false);
    }
  });

  it("goes to the deepest level under a street-level camera, across the antimeridian", () => {
    const sel = selectNodes(selectView({ lat: 60, lng: 179.99, distance: 20, pitch: 60, heading: 90 }), new NodeCache(), flat, new Set(), opts);
    const t = tileAt(179.99, 60, MAX_ZOOM);
    expect(sel.nodes.some((n) => n.z === MAX_ZOOM && n.x === t.x && n.y === t.y)).toBe(true);
    // Looking east, the other side of the antimeridian (x near 0) is drawn too.
    expect(sel.nodes.some((n) => n.x < 2 ** n.z / 4)).toBe(true);
    expect(sel.nodes.length).toBeLessThan(1000);
  });

  it("keeps the far globe coarse and culls the far side", () => {
    const sel = selectNodes(selectView({ lat: 45, lng: 20, distance: 12_000_000, pitch: 0 }), new NodeCache(), flat, new Set(), opts);
    expect(Math.max(...sel.nodes.map((n) => n.z))).toBeLessThanOrEqual(6);
    expect(sel.nodes.length).toBeLessThan(400);
    for (const n of sel.nodes.filter((n) => n.z >= 3)) {
      const anti = lngLatToTile(-160, -45, n.z);
      expect(n.x === Math.floor(anti.x) && n.y === Math.floor(anti.y)).toBe(false);
    }
  });

  it("refines more where the camera is closer", () => {
    const near = selectNodes(selectView({ lat: 47.27, lng: 11.4, distance: 2000 }), new NodeCache(), flat, new Set(), opts);
    const far = selectNodes(selectView({ lat: 47.27, lng: 11.4, distance: 200_000 }), new NodeCache(), flat, new Set(), opts);
    expect(Math.max(...near.nodes.map((n) => n.z))).toBeGreaterThan(Math.max(...far.nodes.map((n) => n.z)));
  });

  it("holds a split while the error stays above tau * 0.75 (hysteresis)", () => {
    const cache = new NodeCache();
    const v1 = selectView({ lat: 47.27, lng: 11.4, distance: 3000 });
    const s1 = selectNodes(v1, cache, flat, new Set(), opts);
    const s2 = selectNodes(v1, cache, flat, s1.split, opts);
    expect(s2.nodes.map((n) => n.key)).toEqual(s1.nodes.map((n) => n.key));
    // Back off 15 %: a fresh selection merges some nodes, one that remembers last frame keeps them split.
    const v2 = selectView({ lat: 47.27, lng: 11.4, distance: 3000 * 1.15 });
    const fresh = selectNodes(v2, new NodeCache(), flat, new Set(), opts);
    const held = selectNodes(v2, cache, flat, s1.split, opts);
    expect(held.split.size).toBeGreaterThan(fresh.split.size);
  });

  it("measures screen-space error falling with distance", () => {
    const cache = new NodeCache();
    const t = tileAt(11.4, 47.27, 12);
    const node = cache.get(12, t.x, t.y);
    const e1 = screenSpaceError(node, selectView({ lat: 47.27, lng: 11.4, distance: 5000 }));
    const e2 = screenSpaceError(node, selectView({ lat: 47.27, lng: 11.4, distance: 50_000 }));
    expect(e1 / e2).toBeGreaterThan(5);
  });
});
