import { describe, expect, it } from "vitest";
import { mppAtZoom } from "../view/view";
import { articleMapMpp, articleMapTarget } from "./articleMapModel";

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
    expect(articleMapMpp(mppAtZoom(12))).toBeCloseTo(mppAtZoom(16.5), 9);
    expect(articleMapMpp(mppAtZoom(17))).toBeCloseTo(mppAtZoom(17), 9);
    expect(articleMapMpp(mppAtZoom(20))).toBeCloseTo(mppAtZoom(18), 9);
  });
});
