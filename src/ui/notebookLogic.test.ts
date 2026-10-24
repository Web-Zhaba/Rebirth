import { describe, expect, it } from "vitest";
import { findsToEntries, formatDate, newestFirst, unseenCount } from "./notebookLogic";

describe("newestFirst", () => {
  it("sorts by time descending without mutating, later items first on ties", () => {
    const src = [
      { at: 5, n: "a" },
      { at: 9, n: "b" },
      { at: 5, n: "c" },
    ];
    expect(newestFirst(src).map((x) => x.n)).toEqual(["b", "c", "a"]);
    expect(src[0].n).toBe("a");
  });
});

describe("formatDate", () => {
  it("shows year, season and day of season", () => {
    expect(formatDate(0)).toBe("Год 1, весна, день 1");
    expect(formatDate(90 * 1440)).toBe("Год 1, лето, день 1");
    expect(formatDate(360 * 1440)).toBe("Год 2, весна, день 1");
  });
});

describe("unseenCount", () => {
  it("counts finds and articles beyond what was seen", () => {
    expect(unseenCount([1, 2, 3], [1], 1)).toBe(3);
    expect(unseenCount([1], [], 5)).toBe(0);
  });
});

describe("findsToEntries", () => {
  const place = (id: string, name: string, kind: string, digId: number, at: number) => ({ id, name, kind, digId, at });
  const fnd = (id: string, digId: number, at: number) => ({ id, ring: [[0, 0], [1, 0], [1, 1]] as [number, number][], area: 1, digId, at });
  it("maps places and streets one by one and foundations once per dig", () => {
    const finds = {
      pois: [place("p1", "Храм", "place_of_worship", 4, 10)],
      streets: [place("s1", "Милютина", "street", 4, 11)],
      foundations: [fnd("a", 4, 12), fnd("b", 4, 15), fnd("c", 9, 20)],
    };
    expect(findsToEntries(finds, [4, 9])).toEqual([
      { id: "poi:p1", kind: "poi", title: "Храм", detail: "place_of_worship", at: 10 },
      { id: "street:s1", kind: "street", title: "Милютина", detail: "улица", at: 11 },
      { id: "dig:4", kind: "foundations", title: "Раскоп №1: 2 фундамента", at: 15 },
      { id: "dig:9", kind: "foundations", title: "Раскоп №2: 1 фундамент", at: 20 },
    ]);
  });
  it("numbers digs by ascending id, also those without foundations, and pluralises in Russian", () => {
    const many = Array.from({ length: 37 }, (_, i) => fnd(`f${i}`, 9, 1));
    const e = findsToEntries({ pois: [], streets: [], foundations: many }, [3, 9]);
    expect(e.map((x) => x.title)).toEqual(["Раскоп №2: 37 фундаментов"]);
  });
  it("is empty without finds", () => {
    expect(findsToEntries(null)).toEqual([]);
    expect(findsToEntries({ pois: [], streets: [], foundations: [] })).toEqual([]);
  });
});
