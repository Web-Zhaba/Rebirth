import { describe, expect, it } from "vitest";
import { LANDMARK_LABELS, landmarkLabels } from "./semanticModel";

describe("semantic landmark labels", () => {
  it("keeps landmark labels non-empty and unique", () => {
    expect(landmarkLabels.every((x) => x.trim().length > 0)).toBe(true);
    expect(new Set(landmarkLabels).size).toBe(landmarkLabels.length);
  });

  it("names the main game regions", () => {
    expect(LANDMARK_LABELS.map).toContain("карта");
    expect(LANDMARK_LABELS.build).toBe("Строительство");
    expect(LANDMARK_LABELS.builders).toContain("строителей");
  });
});
