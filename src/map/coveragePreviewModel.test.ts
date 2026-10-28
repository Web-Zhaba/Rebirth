import { describe, expect, it } from "vitest";
import { coveragePreviewText, relationRadius } from "./coveragePreviewModel";

describe("coverage preview UI", () => {
  it("summarizes total and newly covered homes", () => {
    expect(coveragePreviewText({ houses: 18, residents: 46, newHouses: 11, newResidents: 29 })).toBe(
      "Охват: 18 домов · 46 жителей · новых: 11 домов, 29 жителей",
    );
    expect(coveragePreviewText({ houses: 4, residents: 9, newHouses: 0, newResidents: 0 })).toBe(
      "Охват: 4 домов · 9 жителей · новых нет",
    );
  });

  it("uses the relation radius of selected workplaces", () => {
    expect(relationRadius("gumno", undefined)).toBe(400);
    expect(relationRadius("woodcutter", undefined)).toBe(150);
    expect(relationRadius("fisher", undefined)).toBe(100);
    expect(relationRadius("dig", 73)).toBe(73);
    expect(relationRadius("market", undefined)).toBeNull();
  });
});
