import { describe, expect, it } from "vitest";
import { MODEL_COLORS } from "../ui/palette";
import { buildHeritageModel, buildScaffold, modelFamily, orientedBox, prepareRing, type HeritageModel, type XY } from "./heritageModels";

const rect = (cx: number, cy: number, w: number, d: number, rot = 0): XY[] => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as XY[]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
};
const L_SHAPE: XY[] = [[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]];

const KINDS = ["house", "place_of_worship", "monastery", "castle", "town_hall", "monument", "station", "harbor", "school", "museum", "hospital", "car_repair", "mall"];

function check(m: HeritageModel): void {
  const n = m.positions.length / 3;
  expect(n).toBeGreaterThan(0);
  expect(m.normals.length).toBe(m.positions.length);
  expect(m.colors.length).toBe(m.positions.length);
  expect(m.indices.length % 3).toBe(0);
  expect(Math.max(...m.indices)).toBeLessThan(n);
  expect(Math.min(...m.indices)).toBeGreaterThanOrEqual(0);
  for (const v of [...m.positions, ...m.normals, ...m.colors]) expect(Number.isFinite(v)).toBe(true);
  for (let i = 0; i < n; i++) expect(Math.hypot(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2])).toBeCloseTo(1, 4);
}
const zRange = (m: HeritageModel): [number, number] => {
  const zs = m.positions.filter((_, i) => i % 3 === 2);
  return [Math.min(...zs), Math.max(...zs)];
};
const xyRange = (m: HeritageModel) => {
  const xs = m.positions.filter((_, i) => i % 3 === 0), ys = m.positions.filter((_, i) => i % 3 === 1);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};

describe("modelFamily", () => {
  it("maps OSM kinds to roof families", () => {
    expect(modelFamily("place_of_worship")).toBe("worship");
    expect(modelFamily("monastery")).toBe("worship");
    for (const k of ["castle", "town_hall", "monument"]) expect(modelFamily(k)).toBe("tower");
    for (const k of ["school", "college", "museum", "library", "theatre", "hospital"]) expect(modelFamily(k)).toBe("hip");
    for (const k of ["station", "harbor", "car_repair", "mall", "wholesale"]) expect(modelFamily(k)).toBe("flat");
    expect(modelFamily("bank")).toBe("house");
    expect(modelFamily("unknown")).toBe("house");
  });
  it("has a colour set per family", () => {
    for (const set of Object.values(MODEL_COLORS)) for (const c of Object.values(set)) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("prepareRing", () => {
  it("makes the ring counter-clockwise and drops the closing duplicate", () => {
    const cw = [...rect(0, 0, 10, 6)].reverse();
    const r = prepareRing([...cw, cw[0]]);
    expect(r).toHaveLength(4);
    let a = 0;
    for (let i = 0, j = 3; i < 4; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1];
    expect(a).toBeGreaterThan(0);
  });
  it("falls back to a box for tiny, collinear, empty, self-crossing or non-finite input", () => {
    for (const bad of [[], [[1, 1]], [[0, 0], [1, 0]], [[0, 0], [5, 0], [10, 0]], rect(0, 0, 1, 1), [[0, 0], [10, 10], [10, 0], [0, 10]], [[NaN, 0], [1, 1], [2, 5]]] as XY[][]) {
      const r = prepareRing(bad);
      expect(r).toHaveLength(4);
      for (const p of r) expect(Number.isFinite(p[0] + p[1])).toBe(true);
    }
  });
  it("caps many vertices", () => {
    const ring: XY[] = Array.from({ length: 400 }, (_, i) => [10 * Math.cos((i / 400) * 2 * Math.PI), 6 * Math.sin((i / 400) * 2 * Math.PI)]);
    const r = prepareRing(ring);
    expect(r.length).toBeLessThanOrEqual(48);
    expect(r.length).toBeGreaterThan(8);
  });
  it("finds the oriented box of a rotated rectangle", () => {
    const b = orientedBox(rect(5, 3, 20, 8, 0.6));
    expect(b.len).toBeCloseTo(20, 6);
    expect(b.wid).toBeCloseTo(8, 6);
    expect(b.cx).toBeCloseTo(5, 6);
    expect(b.cy).toBeCloseTo(3, 6);
  });
});

describe("buildHeritageModel", () => {
  it("builds valid meshes for every kind on rectangles, concave and degenerate rings", () => {
    for (const kind of KINDS)
      for (const ring of [rect(100, 200, 24, 10, 0.4), rect(0, 0, 8, 8), L_SHAPE, rect(0, 0, 40, 18), rect(0, 0, 0.5, 0.5), [] as XY[]]) check(buildHeritageModel(ring, 7, kind));
  });
  it("survives odd heights", () => {
    for (const h of [0, -3, NaN, 1e6]) check(buildHeritageModel(rect(0, 0, 12, 8), h, "house"));
  });
  it("stays inside the ring footprint (plus nothing sticking out)", () => {
    const ring = rect(50, -20, 16, 9);
    const m = buildHeritageModel(ring, 6, "house");
    const r = xyRange(m);
    expect(r.x0).toBeGreaterThan(50 - 8 - 1e-6);
    expect(r.x1).toBeLessThan(50 + 8 + 1e-6);
    expect(r.y0).toBeGreaterThan(-20 - 4.5 - 1e-6);
    expect(r.y1).toBeLessThan(-20 + 4.5 + 1e-6);
  });
  it("gives a gabled house a ridge above the eaves, within sane clamps", () => {
    const [z0, z1] = zRange(buildHeritageModel(rect(0, 0, 14, 8), 6, "house"));
    expect(z0).toBe(0);
    expect(z1).toBeGreaterThan(6 + 1.2 - 1e-9);
    expect(z1).toBeLessThanOrEqual(6 + 5.5 + 1e-9);
    const [, big] = zRange(buildHeritageModel(rect(0, 0, 80, 60), 6, "house"));
    expect(big).toBeLessThanOrEqual(6 + 5.5 + 1e-9);
  });
  it("puts the ridge along the long axis", () => {
    const m = buildHeritageModel(rect(0, 0, 20, 8), 5, "house");
    const top: [number, number][] = [];
    for (let i = 0; i < m.positions.length; i += 3) if (m.positions[i + 2] > 5 + 1.2) top.push([m.positions[i], m.positions[i + 1]]);
    expect(top.length).toBeGreaterThan(0);
    for (const p of top) expect(Math.abs(p[1])).toBeLessThan(1e-6);
  });
  it("flat roofs stay low, with a parapet", () => {
    const [, z1] = zRange(buildHeritageModel(rect(0, 0, 30, 20), 6, "station"));
    expect(z1).toBeCloseTo(6.6, 6);
  });
  it("hip roofs rise over the eaves", () => {
    const [, z1] = zRange(buildHeritageModel(rect(0, 0, 30, 14), 8, "school"));
    expect(z1).toBeGreaterThan(8.9);
    expect(z1).toBeLessThanOrEqual(8 + 5 + 1e-9);
  });
  it("worship buildings carry a dome above the roof, and a bell tower when long", () => {
    const [, short] = zRange(buildHeritageModel(rect(0, 0, 12, 10), 7, "place_of_worship"));
    const [, long] = zRange(buildHeritageModel(rect(0, 0, 30, 10), 7, "place_of_worship"));
    expect(short).toBeGreaterThan(7 + 3);
    expect(long).toBeGreaterThan(short);
    const house = zRange(buildHeritageModel(rect(0, 0, 12, 10), 7, "house"))[1];
    expect(short).toBeGreaterThan(house);
  });
  it("castles and town halls get a tower over the main volume", () => {
    for (const k of ["castle", "town_hall", "monument"]) {
      const [, z1] = zRange(buildHeritageModel(rect(0, 0, 20, 14), 8, k));
      expect(z1).toBeGreaterThan(8 + 3);
    }
  });
  it("triangulates concave rings without covering the notch", () => {
    // roof triangles all lie in the L; the notch centre (14, 14) must be uncovered
    const m = buildHeritageModel(L_SHAPE, 6, "station");
    const tris: number[][] = [];
    for (let i = 0; i < m.indices.length; i += 3) {
      const pts = [0, 1, 2].map((k) => m.indices[i + k] * 3);
      if (pts.every((p) => Math.abs(m.positions[p + 2] - 6) < 1e-9)) tris.push(pts.map((p) => m.positions[p]).concat(pts.map((p) => m.positions[p + 1])));
    }
    expect(tris.length).toBeGreaterThanOrEqual(4);
    let area = 0;
    for (const t of tris) area += Math.abs((t[1] - t[0]) * (t[5] - t[3]) - (t[2] - t[0]) * (t[4] - t[3])) / 2;
    expect(area).toBeCloseTo(20 * 8 + 8 * 12, 6);
  });
});

describe("buildScaffold", () => {
  it("grows with progress and never collapses to nothing", () => {
    const [, a] = zRange(buildScaffold(rect(0, 0, 10, 8), 10, 0.5));
    const [, b] = zRange(buildScaffold(rect(0, 0, 10, 8), 10, 1));
    const [, c] = zRange(buildScaffold(rect(0, 0, 10, 8), 10, 0));
    expect(a).toBeCloseTo(5, 6);
    expect(b).toBeCloseTo(10, 6);
    expect(c).toBeCloseTo(0.5, 6);
    check(buildScaffold(L_SHAPE, 7, 0.3));
  });
});
