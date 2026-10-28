import { describe, expect, it } from "vitest";
import { cellsForKeys, indexCellsByKey } from "./zoneCellIndex";

describe("zone cell key index", () => {
  it("retrieves only requested cells in requested order", () => {
    const index = indexCellsByKey([
      { key: "a", n: 1 },
      { key: "b", n: 2 },
      { key: "c", n: 3 },
    ]);

    expect(index.size).toBe(3);
    expect(cellsForKeys(index, ["c", "a"]).map((x) => x.n)).toEqual([3, 1]);
    expect(cellsForKeys(index, ["missing", "b"]).map((x) => x.n)).toEqual([2]);
    expect(cellsForKeys(index, [])).toEqual([]);
  });
});
