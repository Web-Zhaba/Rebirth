import { describe, expect, it } from "vitest";
import { freshWarnings, serviceWarningText, warningAction } from "./warningModel";

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

  it("routes economy and service warnings to their useful target", () => {
    expect(warningAction("famine")).toBe("town");
    expect(warningAction("service:well")).toEqual({ overlay: "well" });
    expect(warningAction("service:bogus")).toBeNull();
    expect(warningAction("weather")).toBeNull();
  });

  it("formats Russian house counts", () => {
    expect(serviceWarningText("Вода", 1)).toBe("1 дом без услуги «Вода»");
    expect(serviceWarningText("Вода", 3)).toBe("3 дома без услуги «Вода»");
    expect(serviceWarningText("Вода", 11)).toBe("11 домов без услуги «Вода»");
    expect(serviceWarningText("Вода", 22)).toBe("22 дома без услуги «Вода»");
  });
});
