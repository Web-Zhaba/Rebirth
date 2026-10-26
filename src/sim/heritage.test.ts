import { describe, expect, it } from "vitest";
import { DOMAIN_IDS } from "./domains";
import { heritageDomain, heritageKind, isHeritage } from "./heritage";

describe("heritage table", () => {
  it("maps real OpenMapTiles classes to domains", () => {
    const cases: [string, string | undefined, string | null][] = [
      ["castle", "castle", "build"],
      ["castle", "ruins", "build"],
      ["monument", "monument", "build"],
      ["town_hall", "townhall", "build"],
      ["town_hall", "courthouse", "build"],
      ["town_hall", "community_centre", null],
      ["school", "school", "learn"],
      ["school", "kindergarten", null],
      ["college", "university", "learn"],
      ["library", "library", "learn"],
      ["museum", "museum", "learn"],
      ["theatre", "theatre", "learn"],
      ["place_of_worship", "christian", "care"],
      ["place_of_worship", undefined, "care"],
      ["hospital", "clinic", "care"],
      ["doctors", "doctors", null],
      ["pharmacy", "pharmacy", null],
      ["bank", "bank", null],
      ["shop", "mall", null],
      ["railway", "halt", null],
      ["grocery", "marketplace", "trade"],
      ["grocery", "supermarket", null],
      ["railway", "station", "trade"],
      ["railway", "subway", null],
      ["harbor", "marina", "trade"],
      ["car", "car_repair", null],
      ["restaurant", "restaurant", null],
      ["shop", "bakery", null],
      ["parking", "parking", null],
    ];
    for (const [cls, sub, want] of cases) expect(heritageDomain(cls, sub), `${cls}/${sub}`).toBe(want);
  });
  it("every domain value is a real domain", () => {
    for (const [c, s] of [["castle"], ["school"], ["place_of_worship"], ["harbor"], ["railway", "station"]] as [string, string?][]) expect(DOMAIN_IDS).toContain(heritageDomain(c, s));
  });
  it("a stored kind reads back to its domain", () => {
    expect(heritageKind("grocery", "marketplace")).toBe("marketplace");
    expect(heritageDomain("marketplace")).toBe("trade");
    expect(heritageKind("school", "school")).toBe("school");
    expect(heritageKind("shop", "bakery")).toBeNull();
    expect(heritageDomain(undefined)).toBeNull();
    expect(isHeritage({ cls: "station" })).toBe(true);
    expect(isHeritage({ cls: "cafe" })).toBe(false);
    expect(isHeritage({})).toBe(false);
  });
});
