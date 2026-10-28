import { describe, expect, it } from "vitest";
import { articleMapTarget, articleMapZoom } from "./articleMapModel";

describe("Wikipedia article map targets", () => {
  it("uses valid article coordinates as lng/lat", () => {
    expect(articleMapTarget({ lat: 59.437, lng: 24.7536 })).toEqual([24.7536, 59.437]);
  });

  it("rejects invalid or non-finite coordinates", () => {
    expect(articleMapTarget({ lat: 91, lng: 0 })).toBeNull();
    expect(articleMapTarget({ lat: 0, lng: 181 })).toBeNull();
    expect(articleMapTarget({ lat: Number.NaN, lng: 0 })).toBeNull();
  });

  it("brings articles to a useful map scale without excessive zoom", () => {
    expect(articleMapZoom(12)).toBe(16.5);
    expect(articleMapZoom(17)).toBe(17);
    expect(articleMapZoom(20)).toBe(18);
  });
});
