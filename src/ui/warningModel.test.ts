import { describe, expect, it } from "vitest";
import { freshWarnings, warningAction } from "./warningModel";

describe("warning transitions", () => {
  it("shows only newly appeared problems", () => {
    expect(freshWarnings(new Set(["lowfood"]), [{ id: "lowfood", text: "same" }, { id: "nologs", text: "new" }])).toEqual([
      { id: "nologs", text: "new" },
    ]);
  });

  it("can notify again after a problem resolved and reappeared", () => {
    expect(freshWarnings(new Set(["nologs"]), [])).toEqual([]);
    expect(freshWarnings(new Set(), [{ id: "nologs", text: "again" }])).toEqual([{ id: "nologs", text: "again" }]);
  });

  it("routes actionable economy warnings to the town panel", () => {
    expect(warningAction("famine")).toBe("town");
    expect(warningAction("nologs")).toBe("town");
    expect(warningAction("weather")).toBeNull();
  });
});
