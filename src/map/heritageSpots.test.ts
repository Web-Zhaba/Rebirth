import { describe, expect, it } from "vitest";
import type { Disc, Foundation, Spot } from "../world/oldworld";
import { selectHints, typeFoundations, TYPED_PER_DISC } from "./heritageSpots";

const sq = (x: number, y: number, s: number): [number, number][] => [[x, y], [x + s, y], [x + s, y + s], [x, y + s]];
const fd = (id: string, x: number, y: number, s: number, height?: number): Foundation => ({ id, ring: sq(x, y, s), area: s * s, ...(height !== undefined ? { height } : {}) });
const spot = (id: string, x: number, y: number, cls: string, name?: string, subclass = cls): Spot => ({ id, cls, subclass, x, y, ...(name ? { name } : {}) });
const one = () => 1;

describe("typeFoundations", () => {
  it("types the foundation whose ring holds the POI, with name, height and domain", () => {
    const out = typeFoundations([fd("a", 0, 0, 10, 12), fd("b", 20, 0, 10)], [spot("p", 5, 5, "school", "Школа")], one);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a", cls: "school", name: "Школа", height: 12, domain: "learn", digId: 1 });
  });
  it("ignores POIs of other classes and outside any ring; a missing height stays missing", () => {
    const out = typeFoundations([fd("a", 0, 0, 10)], [spot("p", 5, 5, "cafe", "Кафе"), spot("q", 50, 5, "school", "Школа"), spot("r", 5, 5, "library")], one);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a", cls: "library" });
    expect("name" in out[0]).toBe(false);
    expect("height" in out[0]).toBe(false);
  });
  it("the smallest ring wins for nested foundations", () => {
    const out = typeFoundations([fd("big", 0, 0, 40), fd("small", 10, 10, 10)], [spot("p", 15, 15, "museum", "Музей")], one);
    expect(out.map((t) => t.id)).toEqual(["small"]);
  });
  it("a named POI beats an unnamed one for the same ring", () => {
    const out = typeFoundations([fd("a", 0, 0, 10)], [spot("p", 2, 2, "school"), spot("q", 6, 6, "library", "Библиотека")], one);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ cls: "library", name: "Библиотека" });
  });
  it("keeps at most 30 per dig, named first then larger area; digs count separately", () => {
    const fs: Foundation[] = [];
    const sp: Spot[] = [];
    for (let i = 0; i < 40; i++) {
      fs.push(fd(`f${i}`, i * 20, 0, 5 + (i % 7)));
      sp.push(spot(`p${i}`, i * 20 + 2, 2, "school", i < 8 ? undefined : `S${i}`)); // 8 unnamed, 32 named
    }
    const out = typeFoundations(fs, sp, one);
    expect(out).toHaveLength(TYPED_PER_DISC);
    expect(out.every((t) => t.name)).toBe(true); // 32 named: all unnamed and two of the named are cut
    const named = fs.filter((_, i) => i >= 8).sort((a, b) => b.area - a.area || (a.id < b.id ? -1 : 1));
    expect(out.map((t) => t.id)).toEqual(named.slice(0, TYPED_PER_DISC).map((f) => f.id));
    const two = typeFoundations(fs, sp, (x) => (x < 400 ? 1 : 2));
    expect(two.filter((t) => t.digId === 1).length).toBeLessThanOrEqual(TYPED_PER_DISC);
    expect(two.filter((t) => t.digId === 2).length).toBeLessThanOrEqual(TYPED_PER_DISC);
    expect(two.length).toBeGreaterThan(TYPED_PER_DISC);
  });
  it("drops a height outside 0..300", () => {
    const out = typeFoundations([fd("a", 0, 0, 10, 500)], [spot("p", 5, 5, "school", "Школа")], one);
    expect("height" in out[0]).toBe(false);
  });
});

describe("selectHints", () => {
  const disc: Disc = { x: 0, y: 0, r: 100 };
  const w = (spots: Spot[], foundations: Foundation[] = []) => ({ foundations, spots });
  it("takes only POIs in the band beyond the disc edge", () => {
    const spots = [spot("in", 50, 0, "school"), spot("near", 130, 0, "school"), spot("edge", 159, 0, "castle"), spot("far", 170, 0, "school")];
    expect(selectHints(w(spots), [disc]).map((h) => h.x)).toEqual([130, 159]);
  });
  it("skips POIs inside a revealed foundation and non-curated classes", () => {
    const spots = [spot("held", 105, 0, "school"), spot("free", 0, 120, "school"), spot("cafe", 0, -120, "cafe")];
    const out = selectHints(w(spots, [fd("a", 100, -5, 10)]), [disc]);
    expect(out).toEqual([{ x: 0, y: 120 }]);
  });
  it("uses the nearest of several discs", () => {
    const out = selectHints(w([spot("p", 330, 0, "school")]), [disc, { x: 300, y: 0, r: 20 }]);
    expect(out).toEqual([{ x: 330, y: 0 }]); // 10 m beyond the second disc
  });
  it("carries no name, type or colour", () => {
    expect(Object.keys(selectHints(w([spot("p", 130, 0, "school", "Школа")]), [disc])[0]).sort()).toEqual(["x", "y"]);
  });
});
