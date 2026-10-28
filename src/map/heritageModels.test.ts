import { describe, expect, it } from "vitest";
import { MODEL_COLORS } from "../ui/palette";
import { buildHeritageModel, modelFamily, pickVariant, type Variant } from "./heritageModels";
import { buildScaffold, orientedBox, PATTERN, pointInRing, prepareRing, ringSeed, type Model, type XY } from "./modelGeometry";

const rect = (cx: number, cy: number, w: number, d: number, rot = 0): XY[] => {
  const c = Math.cos(rot), s = Math.sin(rot);
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as XY[]).map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
};
const L_SHAPE: XY[] = [[0, 0], [20, 0], [20, 8], [8, 8], [8, 20], [0, 20]];

const KINDS = ["house", "place_of_worship", "monastery", "castle", "town_hall", "monument", "station", "harbor", "school", "museum", "hospital", "car_repair", "mall"];

function check(m: Model): void {
  const n = m.positions.length / 3;
  expect(n).toBeGreaterThan(0);
  expect(m.normals.length).toBe(m.positions.length);
  expect(m.colors.length).toBe(m.positions.length);
  expect(m.facade.length).toBe((m.positions.length / 3) * 4);
  expect(m.indices.length % 3).toBe(0);
  // one expect per property: this runs on hundreds of meshes
  expect(m.indices.every((i) => i >= 0 && i < n)).toBe(true);
  expect([...m.positions, ...m.normals, ...m.colors, ...m.facade].every(Number.isFinite)).toBe(true);
  let unit = true;
  for (let i = 0; i < n; i++) if (Math.abs(Math.hypot(m.normals[i * 3], m.normals[i * 3 + 1], m.normals[i * 3 + 2]) - 1) > 1e-4) unit = false;
  expect(unit).toBe(true);
}
const zRange = (m: Model): [number, number] => {
  const zs = m.positions.filter((_, i) => i % 3 === 2);
  return [Math.min(...zs), Math.max(...zs)];
};
const xyRange = (m: Model) => {
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
    for (const set of Object.values(MODEL_COLORS)) for (const list of Object.values(set)) for (const c of list) expect(c).toMatch(/^#[0-9a-f]{6}$/);
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

// First seed whose variant passes `ok` (the variant is a pure function of kind, seed and box size).
const seedWhere = (kind: string, len: number, wid: number, ok: (v: Variant) => boolean): number => {
  for (let s = 1; s < 5000; s++) if (ok(pickVariant(kind, s, len, wid))) return s;
  throw new Error("no seed");
};
const SEEDS = [1, 2, 3, 17, 99, 12345];

describe("buildModel", () => {
  it("builds valid meshes for every kind on rectangles, concave and degenerate rings, whatever the seed", () => {
    for (const kind of KINDS)
      for (const ring of [rect(100, 200, 24, 10, 0.4), rect(0, 0, 8, 8), L_SHAPE, rect(0, 0, 40, 18), rect(0, 0, 0.5, 0.5), [] as XY[]])
        for (const seed of SEEDS) check(buildHeritageModel(ring, 7, kind, seed));
  });
  it("survives odd heights", () => {
    for (const h of [0, -3, NaN, 1e6]) check(buildHeritageModel(rect(0, 0, 12, 8), h, "house"));
  });
  it("keeps a building's look: the default seed comes from the ring", () => {
    const ring = rect(50, -20, 16, 9);
    expect(buildHeritageModel(ring, 6, "house")).toEqual(buildHeritageModel(ring, 6, "house"));
    expect(buildHeritageModel(ring, 6, "house")).toEqual(buildHeritageModel(ring, 6, "house", ringSeed(prepareRing(ring))));
  });
  it("varies roof shapes, colours and chimneys between seeds", () => {
    const vs = Array.from({ length: 60 }, (_, s) => pickVariant("house", s + 1, 14, 8));
    expect(new Set(vs.map((v) => v.roof)).size).toBeGreaterThanOrEqual(4);
    expect(new Set(vs.map((v) => v.wall.join())).size).toBeGreaterThanOrEqual(3);
    expect(vs.some((v) => v.chimneys.length) && vs.some((v) => !v.chimneys.length)).toBe(true);
    const domes = Array.from({ length: 60 }, (_, s) => pickVariant("place_of_worship", s + 1, 30, 12));
    expect(new Set(domes.map((v) => v.dome)).size).toBe(3);
    expect(domes.some((v) => v.fiveDomes)).toBe(true);
  });
  it("stays on its footprint; only the eaves and cornice reach past the walls", () => {
    const ring = rect(50, -20, 16, 9);
    for (const kind of ["house", "station", "school"])
      for (const seed of SEEDS) {
        const r = xyRange(buildHeritageModel(ring, 6, kind, seed));
        expect(r.x0).toBeGreaterThan(50 - 8 - 0.7);
        expect(r.x1).toBeLessThan(50 + 8 + 0.7);
        expect(r.y0).toBeGreaterThan(-20 - 4.5 - 0.7);
        expect(r.y1).toBeLessThan(-20 + 4.5 + 0.7);
      }
  });
  it("gives a house a roof above the eaves, within sane clamps", () => {
    for (const seed of SEEDS) {
      const [z0, z1] = zRange(buildHeritageModel(rect(0, 0, 14, 8), 6, "house", seed));
      expect(z0).toBe(0);
      expect(z1).toBeGreaterThan(6 + 1);
      expect(z1).toBeLessThanOrEqual(6 + 5.5 + 1);
      const [, big] = zRange(buildHeritageModel(rect(0, 0, 80, 60), 6, "house", seed));
      expect(big).toBeLessThanOrEqual(6 + 5.5 + 1);
    }
  });
  it("puts a gable ridge along the long axis", () => {
    const seed = seedWhere("house", 20, 8, (v) => v.roof === "gable" && !v.chimneys.length);
    const m = buildHeritageModel(rect(0, 0, 20, 8), 5, "house", seed);
    const top: [number, number][] = [];
    for (let i = 0; i < m.positions.length; i += 3) if (m.positions[i + 2] > 5 + 1.2) top.push([m.positions[i], m.positions[i + 1]]);
    expect(top.length).toBeGreaterThan(0);
    for (const p of top) expect(Math.abs(p[1])).toBeLessThan(1e-6);
  });
  it("lets a pitched roof overhang the walls, dipping below the eaves", () => {
    const seed = seedWhere("house", 14, 8, (v) => v.roof === "gable" && v.overhang > 0.4);
    const m = buildHeritageModel(rect(0, 0, 14, 8), 6, "house", seed);
    const r = xyRange(m);
    expect(r.y1).toBeGreaterThan(4.4);
    expect(Math.min(...m.positions.filter((_, i) => i % 3 === 2 && Math.abs(m.positions[i - 1]) > 4.3))).toBeLessThan(6);
  });
  it("flat roofs stay low, with a parapet", () => {
    const seed = seedWhere("station", 16, 12, (v) => !v.boxes.length);
    const [, z1] = zRange(buildHeritageModel(rect(0, 0, 16, 12), 6, "station", seed));
    expect(z1).toBeCloseTo(6.6, 6);
  });
  it("hip roofs rise over the eaves", () => {
    for (const seed of SEEDS) {
      const [, z1] = zRange(buildHeritageModel(rect(0, 0, 30, 14), 8, "school", seed));
      expect(z1).toBeGreaterThan(8.9);
      expect(z1).toBeLessThanOrEqual(8 + 5.5 + 1);
    }
  });
  it("worship buildings carry a dome above the roof, and a bell tower when long", () => {
    for (const seed of SEEDS) {
      const [, short] = zRange(buildHeritageModel(rect(0, 0, 12, 10), 7, "place_of_worship", seed));
      const [, long] = zRange(buildHeritageModel(rect(0, 0, 30, 10), 7, "place_of_worship", seed));
      expect(short).toBeGreaterThan(7 + 3);
      expect(long).toBeGreaterThan(short);
      const house = zRange(buildHeritageModel(rect(0, 0, 12, 10), 7, "house", seed))[1];
      expect(short).toBeGreaterThan(house);
    }
  });
  it("castles and town halls get a tower over the main volume", () => {
    for (const k of ["castle", "town_hall", "monument"])
      for (const seed of SEEDS) {
        const [, z1] = zRange(buildHeritageModel(rect(0, 0, 20, 14), 8, k, seed));
        expect(z1).toBeGreaterThan(8 + 3);
      }
  });
  it("tags walls with their window pattern and pitched roofs with shingle rows", () => {
    const m = buildHeritageModel(rect(0, 0, 14, 8), 6, "house", 1);
    const pats = new Set<number>();
    for (let i = 0; i < m.facade.length; i += 4) {
      pats.add(m.facade[i + 3]);
      if (m.facade[i + 3] === PATTERN.house) {
        expect(m.facade[i]).toBeGreaterThanOrEqual(-1e-9);
        expect(m.facade[i]).toBeLessThanOrEqual(m.facade[i + 1] + 1e-9);
        expect(m.facade[i + 2]).toBe(6);
      }
    }
    expect(pats.has(PATTERN.house)).toBe(true);
    expect(pats.has(PATTERN.roof)).toBe(true);
  });
  it("triangulates concave rings without covering the notch", () => {
    // roof triangles all lie in the L; the notch centre (14, 14) must be uncovered (rooftop boxes stand above z = 6)
    const m = buildHeritageModel(L_SHAPE, 6, "station", 1);
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
  // top of the log walls (the deck)
  const deck = (m: Model) => Math.max(...m.positions.filter((_, i) => i % 3 === 2 && m.facade[((i - 2) / 3) * 4 + 3] === PATTERN.logs));
  it("grows with progress and never collapses to nothing", () => {
    expect(deck(buildScaffold(rect(0, 0, 10, 8), 10, 0.5))).toBeCloseTo(5, 6);
    expect(deck(buildScaffold(rect(0, 0, 10, 8), 10, 1))).toBeCloseTo(10, 6);
    expect(deck(buildScaffold(rect(0, 0, 10, 8), 10, 0))).toBeCloseTo(0.5, 6);
    check(buildScaffold(L_SHAPE, 7, 0.3));
  });
  it("stands corner posts at the full height while unfinished", () => {
    expect(zRange(buildScaffold(rect(0, 0, 10, 8), 10, 0.3))[1]).toBeCloseTo(10, 6);
    expect(zRange(buildScaffold(rect(0, 0, 10, 8), 10, 1))[1]).toBeCloseTo(10, 6);
  });
});

describe("smoke emitters", () => {
  it("sit on the chimney tops of pitched roofs, inside the footprint and over the roof", () => {
    let found = 0;
    for (const kind of ["house", "school", "monastery", "town_hall", "hospital"])
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        const ring = rect(0, 0, 18, 10);
        const m = buildHeritageModel(ring, 5, kind, seed);
        for (const [x, y, z] of m.smoke ?? []) {
          found++;
          expect(pointInRing(x, y, ring)).toBe(true);
          expect(z).toBeGreaterThan(5); // over the eaves
          expect(z).toBeLessThanOrEqual(zRange(m)[1] + 1e-9);
        }
      }
    expect(found).toBeGreaterThan(5);
  });
  it("a building site has none", () => {
    expect(buildScaffold(rect(0, 0, 18, 10), 5, 1).smoke ?? []).toHaveLength(0);
  });
});
