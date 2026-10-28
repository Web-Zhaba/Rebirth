import { describe, expect, it } from "vitest";
import { buildBuildingSpatialIndex, buildingSpatialCandidates } from "./buildingHitIndex";

describe("building spatial hit index", () => {
  it("returns only nearby candidates and indexes large footprints across buckets", () => {
    const index = buildBuildingSpatialIndex(
      [
        { id: 1, footprint: [[0, 0], [20, 0], [20, 20], [0, 20]] },
        { id: 2, footprint: [[70, 0], [90, 0], [90, 20], [70, 20]] },
        { id: 3, footprint: [[60, 60], [140, 60], [140, 80], [60, 80]] },
      ],
      64,
    );

    expect(buildingSpatialCandidates(index, 10, 10)).toContain(1);
    expect(buildingSpatialCandidates(index, 10, 10)).not.toContain(2);
    expect(buildingSpatialCandidates(index, 75, 10)).toContain(2);
    expect(buildingSpatialCandidates(index, 62, 70)).toContain(3);
    expect(buildingSpatialCandidates(index, 130, 70)).toContain(3);
  });
});
