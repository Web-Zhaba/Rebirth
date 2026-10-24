import { describe, expect, it } from "vitest";
import { formatDate, newestFirst, unseenCount } from "./notebookLogic";

describe("newestFirst", () => {
  it("sorts by time descending without mutating, later items first on ties", () => {
    const src = [
      { at: 5, n: "a" },
      { at: 9, n: "b" },
      { at: 5, n: "c" },
    ];
    expect(newestFirst(src).map((x) => x.n)).toEqual(["b", "c", "a"]);
    expect(src[0].n).toBe("a");
  });
});

describe("formatDate", () => {
  it("shows year, season and day of season", () => {
    expect(formatDate(0)).toBe("Год 1, весна, день 1");
    expect(formatDate(90 * 1440)).toBe("Год 1, лето, день 1");
    expect(formatDate(360 * 1440)).toBe("Год 2, весна, день 1");
  });
});

describe("unseenCount", () => {
  it("counts finds and articles beyond what was seen", () => {
    expect(unseenCount([1, 2, 3], [1], 1)).toBe(3);
    expect(unseenCount([1], [], 5)).toBe(0);
  });
});
