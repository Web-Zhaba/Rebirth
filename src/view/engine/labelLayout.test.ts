import { describe, expect, it } from "vitest";
import { labelPriority, labelTileZoom, lineLabelAnchor, pickLabels, rotatedExtent, wrapExtent } from "./labelLayout";

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

describe("labels along a line", () => {
  it("centres the text at half the line and turns it along the line", () => {
    const a = lineLabelAnchor([[0, 0], [100, 0], [200, 0]], 60)!;
    expect(a.x).toBeCloseTo(100);
    expect(a.y).toBeCloseTo(0);
    expect(a.angle).toBeCloseTo(0);
  });

  it("keeps the text upright whichever way the line runs", () => {
    const a = lineLabelAnchor([[200, 10], [0, 10]], 60)!;
    expect(Math.abs(a.angle)).toBeLessThan(1e-9);
    const b = lineLabelAnchor([[0, 0], [-100, 100]], 40)!; // down-left: shown as up-right text
    expect(b.angle).toBeCloseTo(-Math.PI / 4);
  });

  it("needs the line longer on screen than the text", () => {
    expect(lineLabelAnchor([[0, 0], [50, 0]], 60)).toBeNull();
    expect(lineLabelAnchor([[0, 0]], 10)).toBeNull();
  });

  it("does not lay a label over a sharp turn under it, but over one away from it", () => {
    expect(lineLabelAnchor([[0, 0], [60, 0], [60, 60]], 80)).toBeNull();
    expect(lineLabelAnchor([[0, 0], [400, 0], [400, 20]], 80)).not.toBeNull();
  });

  it("boxes a turned text and wraps long names", () => {
    const e = rotatedExtent(100, 10, Math.PI / 2);
    expect(e.w).toBeCloseTo(10);
    expect(e.h).toBeCloseTo(100);
    expect(wrapExtent(50, 96)).toEqual({ lines: 1, w: 50 });
    const w = wrapExtent(250, 96);
    expect(w.lines).toBe(3);
    expect(w.w).toBeLessThanOrEqual(96);
  });
});
