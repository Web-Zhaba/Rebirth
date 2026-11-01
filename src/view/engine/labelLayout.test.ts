import { describe, expect, it } from "vitest";
import { labelPriority, labelTileZoom, pickLabels } from "./labelLayout";

describe("label layout", () => {
  it("reads names from the zoom a web map shows at that scale", () => {
    const mpp14 = (2 * Math.PI * 6378137 * Math.cos((55 * Math.PI) / 180)) / (512 * 2 ** 14);
    expect(labelTileZoom(mpp14 * 0.99, 55)).toBe(14);
    expect(labelTileZoom(mpp14 * 4, 55)).toBe(12);
    expect(labelTileZoom(1e6, 55)).toBe(0);
    expect(labelTileZoom(0.01, 55)).toBe(14);
  });

  it("keeps the important label when two overlap", () => {
    const shown = pickLabels([
      { x: 100, y: 100, w: 60, h: 14, priority: labelPriority("village", 9) },
      { x: 110, y: 104, w: 60, h: 14, priority: labelPriority("city", 2) },
      { x: 300, y: 100, w: 60, h: 14, priority: labelPriority("hamlet", 12) },
    ]);
    expect(shown.sort()).toEqual([1, 2]);
  });
});
