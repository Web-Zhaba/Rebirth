import { describe, expect, it } from "vitest";
import { DEFAULT_FLAG, FLAG_PATTERNS, FLAG_SYMBOLS, flagShapes, isFlagDesign } from "./heraldry";

describe("settlement flags", () => {
  it("keeps every field and charge within the cloth, even at maximum size in the corners", () => {
    for (const pattern of FLAG_PATTERNS) {
      for (const symbol of FLAG_SYMBOLS) {
        const layers = [[20, 20], [20, 80], [130, 20], [130, 80]].map(([x, y]) => ({ symbol, x, y, size: 50, color: "#ffc400" }));
        const flag = { ...DEFAULT_FLAG, pattern, layers };
        expect(isFlagDesign(flag)).toBe(true);
        const shapes = flagShapes(flag);
        expect(shapes[0].points).toEqual([[0, 0], [150, 0], [150, 100], [0, 100]]);
        expect(shapes.at(-1)?.color).toBe("#ffc400");
        expect(shapes.every(s => s.points.length >= 3 && s.points.every(([x, y]) => x >= 0 && x <= 150 && y >= 0 && y <= 100))).toBe(true);
      }
    }
  });

  it("rejects malformed artwork before it reaches either renderer", () => {
    const layer = DEFAULT_FLAG.layers[0];
    for (const changes of [
      { pattern: "unknown" }, { field: "url(#ink)" }, { layers: new Array(2) },
      { layers: Array(5).fill(layer) }, { layers: [{ ...layer, x: NaN }] },
      { layers: [{ ...layer, y: 81 }] }, { layers: [{ ...layer, size: 0 }] },
      { layers: [{ ...layer, symbol: "unknown" }] }, { extra: {} },
    ]) expect(isFlagDesign({ ...DEFAULT_FLAG, ...changes })).toBe(false);
    expect(isFlagDesign({ ...DEFAULT_FLAG, pattern: "plain", layers: [] })).toBe(true);
  });
});
